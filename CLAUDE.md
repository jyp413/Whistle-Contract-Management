# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical: Next.js version

@AGENTS.md says this Next.js (16.x) has breaking changes from training-data versions. **Read `node_modules/next/dist/docs/` before writing or editing any Next.js code** — especially `01-app/` for App Router APIs. Heed deprecation warnings.

The root file is `proxy.ts`, NOT `middleware.ts`. Next.js 16 renamed the convention; the function must be exported as `proxy` (or default), not `middleware`. Vercel's bundler rejects the old name.

## Commands

```bash
npm run dev      # next dev (Turbopack)
npm run build    # next build (also runs TypeScript type check)
npm run start    # next start (production, requires prior build)
npm run lint     # eslint
```

For local preview, use `mcp__Claude_Preview__preview_start` (configured in `.claude/launch.json`) instead of running `npm run dev` directly. The dev server holds a per-directory port lock — only one instance can run per project at a time.

`.env.local` must contain `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See `.env.example`. Production env vars on Vercel additionally need `SUPABASE_SERVICE_ROLE_KEY` (cron) and `CRON_SECRET`.

### Vercel CLI on Korean Windows

If the OS hostname is non-ASCII (e.g. `박정열`), the Vercel CLI fails at HTTP User-Agent construction (`Error: ... is not a legal HTTP header value` from Node 24's strict header validator). Run via the shim instead:

```bash
node --require ./.vercel-shim.cjs "$(npm root -g)/vercel/dist/vc.js" <args>
```

`.vercel-shim.cjs` monkey-patches `os.hostname()` and `os.userInfo()` to ASCII before Vercel boots. The shim is git-ignored.

## Database changes

Use the Supabase MCP server, **not** local migration files:
- `mcp__263e0873-...__apply_migration` — DDL changes (auto-named, idempotent on re-run if you guard properly)
- `mcp__263e0873-...__execute_sql` — read-only ad-hoc queries
- `mcp__263e0873-...__generate_typescript_types` — regenerate after any schema change; paste the result into `lib/types/database.ts`

The `Database` type in `lib/types/database.ts` is hand-maintained. Keep the `Relationships: [...]` arrays — supabase-js's PostgREST inference falls back to `never` without them, breaking `.select()` types.

Public RPCs currently exposed: `get_kpi_summary`, `get_region_stats`, `apply_correction`, `terminate_expired_contracts`, `current_user_role`. The trigger-only `handle_new_auth_user` / `handle_auth_user_email_changed` have EXECUTE revoked from anon/authenticated.

## Architecture

### Domain model — read first

This is a **계약 건 (contract) 단위 상태 관리 시스템**. Key invariants that span multiple files:

1. **Status lives only on `contracts.status`.** Never derive status from history. One 지자체 holds N contracts independently — distinguished by (`contracting_party`, `contract_type`, `master_contract_id`).
2. **Effective expiry** = `COALESCE(extended_expiry_date, expiry_date)`. Always compute via `effectiveExpiry()` in `lib/utils.ts` — never compare `expiry_date` raw. **Entry-time guard:** `createContractAction` ([app/(app)/contracts/new/actions.ts](app/(app)/contracts/new/actions.ts)) and `updateContractMeta` ([app/(app)/contracts/[id]/actions.ts](app/(app)/contracts/[id]/actions.ts)) both reject `expiry_date < today` unless `extended_expiry_date` is also provided and itself `≥ today` — keeps active contracts from sitting in an "expired but marked active" state. When the form ships both columns at creation, the action also writes a `contract_extensions` row with `reason='초기 등록 시 입력된 연장 정보'` so history stays consistent with later `extendContract` activity.
8. **Main vs supplement (`master_contract_id`).** `contract_type='parking_enforcement'` is the **main** contract type and must have `master_contract_id IS NULL`. Other types (`personal_info_outsourcing`, `mou`, `other`) are **supplements** that must point to a main contract in the *same LG* via `master_contract_id`. Enforced by trigger `trg_validate_master_link` ([validate_master_contract_link()](.) function — BEFORE INSERT/UPDATE). Don't reuse `parent_contract_id` (which tracks renewal chains) for this — they are orthogonal concepts.
9. **Main termination cascades to supplements.** Trigger `trg_cascade_terminate` (SECURITY DEFINER) — when a main contract transitions to `terminated`, all of its alive supplements are auto-terminated with `termination_reason='메인 계약 종료에 따른 자동 종료'`, plus matching `contract_status_history` (`trigger_event='cascade_terminate'`) and `activity_logs` (`event_type='cascade_terminate'`) rows. UI should warn before terminating a main with supplements.
10. **`get_region_stats` counts main contracts only** (`master_contract_id IS NULL`). Supplements don't inflate the dashboard map / region stats. If you change the count semantics, also update this RPC.
3. **History tables are INSERT-ONLY.** A DB trigger rejects UPDATE/DELETE on `contract_status_history`, `contract_extensions`, `activity_logs`. Don't try to "fix" rows by editing — append corrections.
4. **Status transitions are whitelisted by trigger** `validate_contract_status_transition()`. Only six pairs are allowed; everything else raises `check_violation`.
5. **Corrections bypass the trigger** via `apply_correction` RPC, which sets `app.in_correction='true'` GUC inside a SECURITY DEFINER function. The trigger checks the GUC. Never UPDATE status backwards from the app — always go through the RPC.
6. **`contracts.version` is an optimistic lock.** Every mutation reads `version`, updates with `WHERE version = expected`, and treats `affected_rows = 0` as conflict (HTTP 409 / refresh prompt). The pattern is repeated in every action in `app/(app)/contracts/[id]/actions.ts`.
7. **`activity_logs.target_id` is polymorphic** — no FK. Branch on `target_type` when joining.

### Auth flow

- `auth.users` is Supabase-managed. A trigger `handle_new_auth_user()` mirrors signups into `public.users` with `role='viewer'`, `is_active=FALSE` (Master must approve via `/users`). **Email `pjy413@gmail.com` is hard-coded to auto-promote to `master` + `is_active=TRUE`** in that trigger. The trigger also auto-confirms the email (`email_confirmed_at = NOW()`) — `confirmed_at` is a generated column and must NOT be UPDATEd directly.
- `proxy.ts` (Next.js root) → `lib/supabase/proxy.ts` runs on every non-API/non-static request, refreshes the Supabase session, redirects unauthenticated users to `/login`, and bounces authenticated users away from auth pages.
- The proxy matcher excludes `api/`, `_next/static`, `_next/image`, image extensions, **and `geo/` + `*.json`** (the static topojson under `public/geo/` is huge — keep it out of the edge function).
- Server Components/Actions get the user via `lib/auth.ts`: `requireUser()` / `requireWriter()` (master+accounting) / `requireMaster()`. `requireUser()` redirects unauthenticated → `/login`, soft-deleted → `/login`, **inactive (승인 대기) → `/pending`**. The `(app)` route group in `app/(app)/layout.tsx` calls `requireUser()` once and renders the shell with role-aware nav.

### RLS model

Every public table has RLS. Policies reference `public.current_user_role()` which is SECURITY DEFINER. **`authenticated` MUST keep `EXECUTE` on this function** — Postgres checks EXECUTE permission on the caller role *before* running the SECURITY DEFINER body, so revoking it breaks every RLS evaluation (manifests as `permission denied for function current_user_role` or empty result sets). The function only returns the user's own role, so its REST `/rpc/current_user_role` exposure is acceptable. Trigger-only functions (`handle_new_auth_user`, etc.) DO have EXECUTE revoked from anon/authenticated since they never need direct call.

**Soft-delete trap:** `contracts_select_all` USING is `(deleted_at IS NULL OR current_user_role() = 'master')`. The `OR master` clause is required — Postgres applies the SELECT USING qual to the **new** row of an UPDATE in addition to WITH CHECK (so the updated row remains visible to its updater). Without that clause, setting `deleted_at = NOW()` fails as `new row violates row-level security policy for table "contracts"`. App queries still filter `.is('deleted_at', null)` explicitly, so user-visible behaviour is unchanged for non-master and the master-sees-all clause is the foundation for a future trash page.

**`activity_logs` INSERT policy:** there must be a `logs_insert_self` policy with `WITH CHECK (actor_id = auth.uid() AND current_user_role() IN (...))`. Server actions write logs as the user JWT (not service_role), so without this policy every `.insert()` silently fails (PostgREST returns 401 but most action code does `await supabase.from(...).insert(...)` without checking `error`).

**RLS-filtered RETURNING trap:** for soft delete, `await sb.update({deleted_at: now}).eq(...).select('id').maybeSingle()` returns `data: null` because the new row's `deleted_at IS NOT NULL` is filtered out by the SELECT policy after UPDATE. Some PostgREST paths even roll back the UPDATE in this case. Use `{ count: 'exact' }` instead of `.select()` for soft-delete-style mutations:
```ts
const { error, count } = await sb.from('contracts').update({...}, { count: 'exact' }).eq(...);
```

Effective access:
- `master` — full
- `accounting` — read all + write contracts/files/history/extensions; owns reads on activity_logs
- `viewer` — read contracts/files/lg only; cannot download (enforced at app layer); preview is allowed (PRD §6)

### Mutation pattern

All write paths follow this shape (see `app/(app)/contracts/[id]/actions.ts` for canonical examples):

1. Server action with `'use server'`
2. `await requireWriter()` (or master)
3. Read current row, check business preconditions including `version`
4. Update `contracts` with `eq('version', expected)`, return `{ error }` if no row affected
5. Insert into appropriate history table
6. Insert into `activity_logs`
7. `revalidatePath(\`/contracts/${id}\`)` and return result

Keep this sequence intact when adding new actions — RLS + trigger + history + log together is the audit guarantee.

### Storage

Bucket `contract-files` is private, 50MB cap, PDF mime-type enforced at the bucket level. Uploads go directly from the browser via `supabase.storage.from('contract-files').upload(path)`, then a server action `registerUploadedFile` creates the `contract_files` row, decrements old rows' `is_latest`, and writes the activity log. The partial unique index `idx_files_one_latest` guarantees at most one `is_latest=TRUE` row per contract.

**Storage key character set:** keys must be ASCII (Supabase Storage validation rejects Korean filenames). Use a UUID-based path; preserve the human-readable name in `contract_files.original_filename`:
```ts
const path = `${contractId}/${Date.now()}-${crypto.randomUUID()}.pdf`;
```

PDF preview uses `react-pdf` (pdfjs-dist) with worker loaded from `unpkg.com` matching the installed pdfjs version. Inline canvas rendering avoids Chrome's "Download PDFs" setting.

### Region map (대시보드)

Drill-down choropleth on `/dashboard`. **Three view levels** (2-tier or 3-tier depending on region):
- `nation`: 17 시도 폴리곤. Click → `sido` view.
- `sido`: 시도 내 시·군·구 폴리곤. **일반구 보유 시(수원·성남·…·창원)는 `topojson.merge`로 통합 시 폴리곤 1개로 묶어 표시** — 클릭하면 `si` view로 drill. 일반구 없는 시·군(가평군 등)은 leaf 패널.
- `si`: 한 시 안의 일반구들 (3-tier drill 시에만 도달). 모두 leaf.

Data flow:
- DB: `local_governments.geo_code` (5-digit text) is the join key from LG ↔ topojson polygon. Seed in `document/seed_local_governments_geo_code.sql`.
- RPC: `get_region_stats` returns `LgStat[]` (per-LG counts per status, security-invoker so RLS applies). Type in `lib/map/types.ts`.
- Static asset: `public/geo/korea-admin.topo.json` (~870KB) — `objects.sido` + `objects.sigungu`, each feature has `properties: { code, name }`.
- Client: `components/map/region-map.tsx` (`d3-geo` + `topojson-client`) renders SVG; breadcrumb (`region-breadcrumb.tsx`) + side panel (`region-leaf-panel.tsx`).
- Pure helpers (no React, reusable): `lib/map/derive.ts`, `match.ts`, `rate.ts`.

**Coverage rate** (the value driving the choropleth color and `XX%` label) is defined in `lib/map/rate.ts`:
```
coverage = (지역 내 'completed' 1건 이상 보유 LG 수) / (지역 내 전체 LG 수)
```
Single function `coverageRate(lgs)`. Swap point if the formula changes.

**TopoJSON manual property patches** (do NOT regenerate from raw kostat without re-applying):
- polygon `22320` `군위군` — original kostat code was `37310` (경상북도). 2023-07 transferred to 대구; we move the polygon into the `22` (대구) prefix so 대구 sido drill-down includes 군위군. DB `geo_code` matches `22320`.
- polygon `23030` name `미추홀구` — original was `남구`. 2018-07 인천 남구 → 미추홀구 개명.
- 부천시 — kostat already has 1 통합 폴리곤 `31050`; DB has 3 LG rows (옛 일반구 원미·소사·오정) all sharing `geo_code='31050'`. Don't try to "fix" by adding sub-polygons.

The seed file reflects the patched codes. If you re-run mapshaper on raw kostat input, re-apply these property edits before overwriting `korea-admin.topo.json`.

**Form ↔ map parity**: `app/(app)/contracts/new/form.tsx` reads `local_governments` directly (sido + leaf 시군구 dropdown). The map joins through the same table via `geo_code`. Both are guaranteed consistent — when adding a new LG, also seed `geo_code`.

**Naming gotchas** (`lib/map/derive.ts`):
- `SIDO_BY_GEO_CODE` uses post-rename names (`강원특별자치도`, `전북특별자치도`) — must match DB `local_governments.sido` exactly.
- `PARENT_SI_PREFIXES` lists 시s that have 일반구 children. Polygon name `'수원시장안구'` (no space) is split into `parent_si='수원시'`, `leaf='장안구'`. **부천시** stays in the list as documentation but its polygon no longer carries the prefix.
- The proxy matcher MUST exclude `geo/` and `*.json`, otherwise the topojson goes through Edge runtime on every dashboard load.

### Layout conventions

- Pages are async Server Components. Side-effect mutations live in colocated `actions.ts` files.
- Modals/forms that need state are client components in the same folder (`upload-card.tsx`, `contract-actions.tsx`, etc.).
- Date inputs handle nullable dates by passing `''` as the empty value, converted to `null` in the action.
- Status enum values come from `Database['public']['Enums']['contract_status']`. Do not redefine them as string literals.
- All visible labels use the maps in `lib/utils.ts` (`STATUS_LABEL`, `ROLE_LABEL`, etc.) — keep these in sync with the DB ENUMs.
- Reusable success popup: `app/components/success-modal.tsx`. Use this for write-action completion (signed-in users want explicit acknowledgement before navigating away).

### Cron / batch endpoints

`app/api/cron/terminate-expired/route.ts` is the only scheduled endpoint. It requires `CRON_SECRET` and uses `SUPABASE_SERVICE_ROLE_KEY` to act as the first available master user. `vercel.json` has the schedule (daily KST 01:00).

## Local conventions

- `lib/types/database.ts` is the source of truth for table/enum types. Don't recreate them inline.
- Korean labels are intentional and load-bearing — UI is Korean-only, no i18n abstraction.
- The `document/` folder contains the PRD v3.0, ERD spec, ERD diagram, and seed SQL. These are reference artifacts; treat them as the spec.
- See `README.md` for phase-by-phase implementation status and the canonical list of design points (status SSOT, renewal chain via `parent_contract_id`, etc.).
