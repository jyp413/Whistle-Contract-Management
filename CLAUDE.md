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
npx tsc --noEmit # standalone type check (faster than full build for verifying types)
```

**No automated test suite** — there is no jest/vitest/playwright setup. Verification is manual via the preview server (`mcp__Claude_Preview__preview_start`) and DB inspection via Supabase MCP. `npx tsc --noEmit` + dev-server error logs are the strongest pre-commit signals.

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

Public RPCs currently exposed: `get_kpi_summary`, `get_region_stats`, `apply_correction`, `soft_delete_contract_file`, `terminate_expired_contracts`, `current_user_role`, `contract_effective_expiry`. `soft_delete_contract_file` is SECURITY DEFINER and exists because the `contract_files.files_select_all` policy (USING `deleted_at IS NULL`) makes direct `UPDATE deleted_at=NOW()` from supabase-js fail with a post-update RLS violation — see the **RLS-filtered RETURNING trap** below. `contract_effective_expiry(expiry, extended_expiry, auto_renewal, period_months, end_date)` is the SQL-side SSOT for effective expiry (see invariant #2 below). The trigger-only `handle_new_auth_user` / `handle_auth_user_email_changed` / `validate_master_contract_link` / `cascade_terminate_supplements` have EXECUTE revoked from anon/authenticated.

## Architecture

### Domain model — read first

This is a **계약 건 (contract) 단위 상태 관리 시스템**. Key invariants that span multiple files:

1. **Status lives only on `contracts.status`.** Never derive status from history. One 지자체 holds N contracts independently — distinguished by (`contracting_party`, `contract_type`, `master_contract_id`).
2. **Effective expiry is not a simple COALESCE.** Three cases, in priority order:
   1. `extended_expiry_date` if set (one-time manual extension wins),
   2. else if `auto_renewal=true` and `auto_renewal_period_months` is set → roll `expiry_date` forward by N*period months until ≥ today, capped by `auto_renewal_end_date` if set,
   3. else `expiry_date`.

   Two **mirrored** implementations: `effectiveExpiry()` in [lib/utils.ts](lib/utils.ts) (JS — used by every page/server action that touches dates) and SQL function `public.contract_effective_expiry(...)` (used by `get_kpi_summary` and `terminate_expired_contracts`). **If you change the algorithm, change both.** Never inline `COALESCE(extended_expiry_date, expiry_date)` anywhere — it silently breaks auto-renewing contracts.

   **Entry-time guard:** `createContractBatch` / `createContractAction` ([app/(app)/contracts/new/actions.ts](app/(app)/contracts/new/actions.ts)) and `updateContractMeta` ([app/(app)/contracts/[id]/actions.ts](app/(app)/contracts/[id]/actions.ts)) reject `expiry_date < today` **unless** `extended_expiry_date` is also provided and itself `≥ today` **or** `auto_renewal=true` (auto-renewal rolls expiry forward automatically). When the form ships `extended_expiry_date` at creation, the action also writes a `contract_extensions` row with `reason='초기 등록 시 입력된 연장 정보'` so history stays consistent with later `extendContract` activity.
3. **Main vs supplement (`master_contract_id`).** `contract_type='parking_enforcement'` is the **main** contract type and must have `master_contract_id IS NULL`. Other types (`personal_info_outsourcing`, `mou`, `other`) are **supplements** that must point to a main contract in the *same LG* via `master_contract_id`. Enforced by trigger `trg_validate_master_link` ([validate_master_contract_link()](.) function — BEFORE INSERT/UPDATE). Don't reuse `parent_contract_id` (which tracks renewal chains) for this — they are orthogonal concepts.
4. **Main termination cascades to supplements.** Trigger `trg_cascade_terminate` (SECURITY DEFINER) — when a main contract transitions to `terminated`, all of its alive supplements are auto-terminated with `termination_reason='메인 계약 종료에 따른 자동 종료'`, plus matching `contract_status_history` (`trigger_event='cascade_terminate'`) and `activity_logs` (`event_type='cascade_terminate'`) rows. UI should warn before terminating a main with supplements.
5. **`get_region_stats` AND `get_kpi_summary` count main contracts only** (`master_contract_id IS NULL`). Supplements don't inflate the dashboard map, region stats, KPI cards, or the expiring-buckets. If you change the count semantics, update **both** RPCs together. (Historical bug: `get_kpi_summary` originally lacked the filter and inflated the "계약완료" KPI by counting attached `personal_info_outsourcing` / `mou` / `other` supplements — fixed in migration `get_kpi_summary_mains_only`.)
6. **Supplements inherit dates from their main — `personal_info_outsourcing` / `other` only.** `createContractBatch` ([new/actions.ts](app/(app)/contracts/new/actions.ts)) copies `signed_date / effective_date / expiry_date / extended_expiry_date / auto_renewal*` from the main into these two supplement types at INSERT time. **`mou` (유지보수) is the exception** — mou supplements carry their own dates + auto-renewal + `amount_krw` because real-world 유지보수 용역 계약서 has independent terms from the parking enforcement contract. The supplements payload uses `z.discriminatedUnion('type', ...)` — mou variant requires the full date/amount payload, the other two variants only carry `type`. Cascade-terminate still applies to all supplement types; no cascade for date *updates* on the main (UI shows stale warning).
7. **`contracts.amount_krw` is mou-only.** `bigint`, NULL allowed, `CHECK (amount_krw IS NULL OR amount_krw >= 0)`. Other contract types are always NULL. `updateContractMeta` enforces this — when `contract_type !== 'mou'` it sets `amount_krw = NULL` regardless of input (prevents stale values after type change). Displayed in: `/maintenance` list, `/api/export/maintenance.xlsx`, `/contracts/[id]` detail dl (mou-only row), and `<SupplementCard>` on the main detail page.
8. **mou는 모노플랫폼 직접 단일 주체.** DB CHECK `(contract_type <> 'mou' OR contracting_party = 'monoplatform')` 강제. `createContractBatch` 의 mou 부속 INSERT, `updateContractMeta` 의 mou type 전환 모두 `contracting_party='monoplatform'` 으로 덮어쓴다 — 폼에서 imcity가 보내져도 무시. `/maintenance` 리스트·엑셀에서 주체 컬럼은 제거 (정보량 없음).
9. **mou는 기간 연장 개념 없음.** 매년 재계약 (`startRenewal`) 으로 새 row를 만들고 `parent_contract_id` 로 chain 연결. mou는 `extended_expiry_date / auto_renewal / auto_renewal_period_months / auto_renewal_end_date` 모두 항상 `null` / `false` 강제 — `/contracts/new` 폼의 mou sub-section은 이 필드를 노출하지 않으며 `MouSupplementSchema` 에도 없음. `createContractBatch` 가 INSERT 시 null/false 강제, `updateContractMeta` 가 `contract_type === 'mou'` 일 때 동일하게 강제. `EditMetaModal` 도 mou 일 때 자동연장 섹션·연장 후 만료일 필드를 미렌더. `ContractActions` 는 mou 일 때 `[기간 연장]` 버튼을 미렌더. `startRenewal` 은 부모의 `contract_type / contracting_party / master_contract_id` 를 새 row에 그대로 복사 (mou는 amount_krw + memo 도 prefill). mou의 만료일 입력 가드: `expiry_date < today` 즉시 거부 (자동연장/연장 fallback 없음 — 갱신 신규 등록 안내).
10. **History tables are INSERT-ONLY.** A DB trigger rejects UPDATE/DELETE on `contract_status_history`, `contract_extensions`, `activity_logs`. Don't try to "fix" rows by editing — append corrections.

    **Every history/log insert must capture `error` and `console.error` on failure.** Server actions write logs as the user's JWT, so if the `logs_insert_self` policy or any other RLS clause is misconfigured, PostgREST returns the error inside the response body (no JS throw). Fire-and-forget `await sb.from('activity_logs').insert(...)` would silently drop audit rows while the action reports success. Canonical pattern:
    ```ts
    const { error: logErr } = await sb.from('activity_logs').insert({...});
    if (logErr) console.error('[actionName] activity_logs insert failed:', logErr);
    ```
    Same applies to `contract_status_history` and `contract_extensions` inserts in every action.
11. **Status transitions are whitelisted by trigger** `validate_contract_status_transition()`. Only six pairs are allowed; everything else raises `check_violation`.
12. **Corrections bypass the trigger** via `apply_correction` RPC, which sets `app.in_correction='true'` GUC inside a SECURITY DEFINER function. The trigger checks the GUC. Never UPDATE status backwards from the app — always go through the RPC.
13. **`contracts.version` is an optimistic lock.** Every mutation reads `version`, updates with `WHERE version = expected`, and treats `affected_rows = 0` as conflict (HTTP 409 / refresh prompt). The pattern is repeated in every action in `app/(app)/contracts/[id]/actions.ts`.
14. **`activity_logs.target_id` is polymorphic** — no FK. Branch on `target_type` when joining.

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
4. Update `contracts` with `{ count: 'exact' }` + `eq('version', expected)`; treat both `error` and `!count` as conflict. **Do NOT use `.select().maybeSingle()` for soft-delete-style updates** (see RLS-filtered RETURNING trap) — and even for non-soft-delete updates the `count: 'exact'` pattern is what every existing action uses
5. Insert into appropriate history table — **capture error and `console.error`** (see invariant #10)
6. Insert into `activity_logs` — same error-capture rule
7. `revalidatePath(\`/contracts/${id}\`)` and return result

Keep this sequence intact when adding new actions — RLS + trigger + history + log together is the audit guarantee.

**IDOR guard for client-supplied IDs.** If an action accepts an ID that references another row (e.g. `existing_master_id`), load that row first and assert it belongs to the expected scope before writing — clients can submit arbitrary UUIDs. See `createContractBatch` ([new/actions.ts](app/(app)/contracts/new/actions.ts)): the chosen `existing_master_id` master contract is loaded and rejected if its `local_government_id` doesn't match the form's LG (and if it's `terminated`).

**Force-flag duplicate-check pattern** (for `create*` actions). Domain allows multiple contracts of the same `(LG, party, type, master_contract_id)` (e.g. parallel during renewal), but accidental duplicates are common. Pattern:
1. Action schema includes `force: z.boolean().optional().default(false)`
2. When `!force`, run a preflight `findDuplicates(supabase, v)` that queries living rows (`status != 'terminated' AND deleted_at IS NULL`) matching the same key — for main: `(local_government_id, contracting_party, 'parking_enforcement', master_contract_id IS NULL)`; for supplement: `(master_contract_id, contract_type)`. If hits, return `{ duplicates: DuplicateHit[] }` (no insert).
3. Client form catches the `duplicates` branch, shows a modal listing existing rows + links, two buttons: 취소 / "그대로 등록" → re-call action with `force: true`.

Canonical implementation: `createContractBatch` + `findDuplicates` in [new/actions.ts](app/(app)/contracts/new/actions.ts), form modal in [new/form.tsx](app/(app)/contracts/new/form.tsx). The action's result type is a discriminated union: `{error}` | `{duplicates}` | `{created}` — order checks accordingly in the form (duplicates first, then error, then success).

**Creation flow has two entry points**: `createContractAction` (single contract — kept for backwards compatibility, not used by current UI) and `createContractBatch` ([app/(app)/contracts/new/actions.ts](app/(app)/contracts/new/actions.ts), used by the new contract form). The batch path inserts main first → captures its id → inserts each checked supplement with `master_contract_id` set, copying main's dates. On partial failure (e.g. main OK, second supplement fails) the error message lists which types succeeded so the user can re-create only the missing ones. PDF uploads run client-side after the batch returns: for each created contract with a file, the form uploads to Storage then calls `registerUploadedFile`. File failures don't roll back contract creation — the user re-uploads from the detail page.

### Storage

Bucket `contract-files` is private, 50MB cap, PDF mime-type enforced at the bucket level. Uploads go directly from the browser via `supabase.storage.from('contract-files').upload(path)`, then a server action `registerUploadedFile` creates the `contract_files` row, decrements old rows' `is_latest`, and writes the activity log. The partial unique index `idx_files_one_latest` guarantees at most one `is_latest=TRUE` row per contract.

**Storage key character set:** keys must be ASCII (Supabase Storage validation rejects Korean filenames). Use a UUID-based path; preserve the human-readable name in `contract_files.original_filename`:
```ts
const path = `${contractId}/${Date.now()}-${crypto.randomUUID()}.pdf`;
```

**`registerUploadedFile` guards** ([app/(app)/contracts/[id]/actions.ts](app/(app)/contracts/[id]/actions.ts)) — required because the client picks the path:
1. `storagePath` must start with `${contractId}/` (no cross-contract registration)
2. The Storage object must actually exist (`supabase.storage.from(...).list(contractId, { search })`) — prevents registering a row pointing to nothing
3. `fileSizeBytes` must be `> 0 && ≤ 50MB`

**PDF preview goes through `/api/preview/[fileId]`, not direct `createSignedUrl`.** The client must NOT call `supabase.storage.createSignedUrl()` for previews — that issues a 5-minute public URL anyone with the link can curl, defeating the viewer-no-download rule. The proxy route ([app/api/preview/[fileId]/route.ts](app/api/preview/[fileId]/route.ts)):
- **writer** (master/accounting) → 302 redirect to a server-issued signed URL (fast)
- **viewer** → streams the bytes inline with `Content-Disposition: inline` (URL is session-bound; can't be shared)

`FilePreviewButton` takes `fileId` (NOT `storagePath`) and points `<Document file={...}>` at `/api/preview/${fileId}`. Worker still loads from `unpkg.com/pdfjs-dist@${pdfjs.version}` matching the installed pdfjs version.

**`FilePreviewButton` is lazy-loaded** via `next/dynamic({ ssr: false })` from `row-preview.tsx` and `supplement-card.tsx` because `react-pdf` + worker is ~500KB. Do not switch back to static import — it bloats the list/detail page bundle even for users who never click preview.

### Region map (대시보드)

Drill-down choropleth on `/dashboard`. **Three view levels** (2-tier or 3-tier depending on region):
- `nation`: 17 시도 폴리곤. Click → `sido` view.
- `sido`: 시도 내 시·군·구 폴리곤. **일반구 보유 시(수원·성남·…·창원)는 `topojson.merge`로 통합 시 폴리곤 1개로 묶어 표시** — 클릭하면 `si` view로 drill. 일반구 없는 시·군(가평군 등)은 leaf 패널.
- `si`: 한 시 안의 일반구들 (3-tier drill 시에만 도달). 모두 leaf.

Data flow:
- DB: `local_governments.geo_code` (5-digit text) is the join key from LG ↔ topojson polygon. Seed in `document/seed_local_governments_geo_code.sql`.
- RPC: `get_region_stats` returns `LgStat[]` (per-LG counts per status + `completed_monoplatform` / `completed_imcity` breakdown for color decisions, security-invoker so RLS applies). **Only counts main contracts (`master_contract_id IS NULL`)** — supplements don't inflate map stats. Type in `lib/map/types.ts`.
- Static asset: `public/geo/korea-admin.topo.json` (~870KB) — `objects.sido` + `objects.sigungu`, each feature has `properties: { code, name }`.
- Client: `components/map/region-map.tsx` (`d3-geo` + `topojson-client`) renders SVG; breadcrumb (`region-breadcrumb.tsx`) + three side panels:
  - `region-nation-panel.tsx` — nation view default (시도별 합계 카드)
  - `region-sido-panel.tsx` — sido view default (광역시도 내 시군구별 체결 현황)
  - `region-leaf-panel.tsx` — leaf 클릭 시
- Pure helpers (no React, reusable): `lib/map/derive.ts`, `match.ts`, `rate.ts`, `aggregate-by-sido.ts`.

**Polygon color** (`lib/map/rate.ts` `partyRateColor`) combines two axes:
1. **Tint** = contracting_party 우선순위 — `completed_monoplatform > 0` 면 orange, else `completed_imcity > 0` 면 sky, else 회색 slate-200
2. **Shade** = `coverageRate` (해당 폴리곤 내 `completed > 0` LG 비율) → 6-bucket Tailwind 단계 100~600 (예: orange-100 ~ orange-600)

If the color formula changes, swap there. The legacy single-color `colorClass(rate)` is kept for non-map callers but unused by the map itself.

**제주·울릉 inset transform** (nation view only): polygon code prefix `50*` (제주) and `37320` (울릉) get rendered inside an SVG `<g transform="translate(...) scale(...)">` so the mainland fitExtent can ignore them — 본토가 더 크게 보임. 좌표는 `size` 비율 기반(좌하단 = 제주, 우상단 = 울릉). sido/si view에서는 inset 비활성.

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
- Date inputs handle nullable dates by passing `''` as the empty value, converted to `null` in the action. **All date inputs use `<DateInput>` ([app/components/date-input.tsx](app/components/date-input.tsx))** — text-only field that accepts `20260109` (8자리 자동 정규화) or `2026-01-09`. Native `<input type="date">` 사용 금지 (사용자 요청 — 키보드 입력 우선, native picker 마찰 제거).
- **Money inputs use `<AmountKrwInput>` ([app/components/amount-krw-input.tsx](app/components/amount-krw-input.tsx))** — `value: number | null` controlled prop, raw digits internal state, `Intl.NumberFormat('ko-KR')` 콤마 표시 + 우측 "원" suffix. `<input type="number">` 사용 금지 (천 단위 콤마 표시 불가, 음수 입력 가능). 신규 등록 mou sub-section 및 `EditMetaModal` mou 한정 입력에 모두 같은 컴포넌트.
- Status enum values come from `Database['public']['Enums']['contract_status']`. Do not redefine them as string literals.
- All visible labels use the maps in `lib/utils.ts` (`STATUS_LABEL`, `PARTY_LABEL`, `TYPE_LABEL`, `ROLE_LABEL`, etc.) — keep these in sync with the DB ENUMs. Badge color classes follow the same `_BADGE` pattern.
- Reusable success popup: `app/components/success-modal.tsx`. Use this for write-action completion (signed-in users want explicit acknowledgement before navigating away).
- Reusable LG selector: `app/components/lg-combobox.tsx` ([LgCombobox](app/components/lg-combobox.tsx)). Search-as-you-type with keyboard nav + match highlighting; the new contract form pairs it with the legacy cascading sido/sigungu dropdowns so users can use whichever they prefer (both bind to the same `lg_id` state).
- **Reusable Modal**: `app/components/modal.tsx` — base modal with Escape close, `role="dialog"` + `aria-modal`, backdrop click, configurable `maxWidth` (`sm|md|lg|xl|2xl`), optional `title` (renders header bar with × button). Do not hand-roll `<div className="fixed inset-0 z-50 bg-...">` modals — every existing one was migrated.
- **Reusable Badges**: `app/components/badges.tsx` exports `<StatusBadge status>`, `<TypeBadge ctype isSupplement?>`, `<PartyBadge party>` with `size?: 'sm'|'md'`. Used in contracts table, expiring page, search results, detail page, supplement cards. Do not duplicate the `inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded ring-1 ring-inset ${STATUS_BADGE[s]}` pattern — sizes drift.
- **Brand**: orange-500 is the primary action color (login button, "등록" button, auto-renewal badge). Logo is `public/logo-whistle.png` (휘슬 CI from 010car.kr) — shown in the `(app)` header and on `/login`, `/signup`, `/pending`.
- **Manage supplements from main's detail page.** When a main contract's detail page renders, it fetches its supplements + each supplement's latest file and shows them in a "부속 계약 (N)" section via `SupplementCard` ([app/(app)/contracts/[id]/supplement-card.tsx](app/(app)/contracts/[id]/supplement-card.tsx)) — each card has its own client-side PDF upload (Storage upload + `registerUploadedFile` against the supplement's contract id). This avoids forcing users to navigate to each supplement's detail page just to attach a file. Each supplement still has its own detail page reachable via the "상세 →" link in the card.
- **Contract list groups supplements under main.** `ContractsTable` ([app/(app)/contracts/contracts-table.tsx](app/(app)/contracts/contracts-table.tsx)) is a client component that detects supplements (via `master_contract_id`) and hides them by default behind a `+` toggle on each main row, with a "전부 펼치기/접기" header. Active only when sorting by `lg_name`; other sorts render flat. The server page does data fetching/sorting; the client component owns expand state.
- **Cascade/stale warnings on main edit & terminate.** The detail page computes `aliveSupplementCount` (status≠terminated) and passes it to both `ContractActions` and `EditMetaButton`. `TerminateModal` shows a red cascade warning + requires an explicit "동의" checkbox when terminating a main with live supplements (trigger `trg_cascade_terminate` will auto-terminate them). `EditMetaModal` shows an amber "부속에 자동 반영되지 않습니다" warning when a main's date/auto-renewal fields are edited while live supplements exist (no cascade for updates — see invariant #6).
- **Renewal overlap guard on `confirmCompletion`.** When completing a contract that has a `parent_contract_id` (i.e. a 갱신 계약), the action checks the parent: if the parent is still `completed` and its `effectiveExpiry()` is `≥ today`, it returns `{ overlapWarning: { parentExpiry } }` instead of completing (unless `force: true`). 권장 워크플로우는 갱신 계약을 `갱신중`으로 두었다가 원계약 만료(자동 종료) 후 완료 처리 — 그래야 `계약완료` 2건이 겹쳐 KPI가 일시적으로 부풀려지지 않음. 완료 팝업(`ContractActions`, `SupplementCard`)은 경고 + "동의" 체크박스를 띄우고 동의 시 `force: true` 로 재호출 — 강제 차단이 아니라 예외 상황(조기 가동) 허용.
- **Filter labels are derived from `STATUS_LABEL` / `TYPE_LABEL` / `PARTY_LABEL`** maps, not hardcoded — `Object.entries(LABEL_MAP)` in [contracts/page.tsx](app/(app)/contracts/page.tsx). Hardcoding (e.g. filter chip "모노플랫폼" vs detail badge "모노플랫폼 직접") creates two names for the same value that drift over time.
- **Tables wrap with `overflow-x-auto` + `min-w-[N]`** (not `overflow-hidden`) — the contracts/expiring/activity/users tables otherwise clip columns on mobile.
- **List pagination convention** (currently only `/contracts`): querystring `page` (default 1) + `size` ∈ `{10, 20, 50, 100}` (default 10). Server fetches with `.limit(SERVER_FETCH_CAP=500)` and shows an amber warning when the cap is hit. Client-side slice for the visible page. **Grouping-aware**: when `sort=lg_name`, page by main rows and include each main's supplements on the same page (so a main and its 부속 never split across pages). When sorted by anything else, flat pagination. Filter/sort changes reset `page` to 1; `size` is preserved across navigation. Only the visible page's contract IDs are passed to the `contract_files` fetch — keep that scope minimal.

### Contract contact info & dashboard search

- **Per-contract contact** (4 columns on `contracts`: `contact_department`, `contact_name`, `contact_phone`, `contact_email`). 담당자는 **계약 단위** — 같은 지자체라도 계약별로 다를 수 있다 (예: 주차단속 메인은 주차 부서, 유지보수는 회계과). Edited via `updateContractContact` action ([app/(app)/contracts/[id]/actions.ts](app/(app)/contracts/[id]/actions.ts)) and rendered as `ContactCard` ([contact-card.tsx](app/(app)/contracts/[id]/contact-card.tsx)) on the detail page. Activity log: `event_type='contract_update'`, `target_type='contract'`. `updateContractContact` 는 version 낙관락을 쓰지 않음 (담당자는 메타/상태와 독립 필드). **신규 등록 시**: `/contracts/new` 폼의 "계약 담당자" 섹션이 메인 + 일반 부속(`personal_info_outsourcing`/`other`)에 적용 (일자 상속과 동일하게 — `contactSource`), mou 부속은 sub-section에서 자체 담당자 입력. 부속만 등록 시엔 기존 마스터의 담당자를 상속. (이전엔 `local_governments` 의 컬럼이었으나 마이그레이션 `move_contact_columns_to_contracts` 로 `contracts` 로 이동 — `local_governments` 에는 더 이상 contact 컬럼 없음.)
- **Dashboard search** (`searchAll` server action, [app/(app)/dashboard/actions.ts](app/(app)/dashboard/actions.ts)) does ILIKE across: `contracts.memo` / `termination_reason` / 4 contact columns, `local_governments.full_name`, `contract_files.original_filename`. 담당자 매치는 계약 단위라 contract id 직접 hit (LG fan-out 불필요); `full_name` 만 LG→계약 fan-out. Returns contract hits with a `matches: SearchMatch[]` array so the UI can chip-tag which field matched. Min 2 chars; 100 char cap; 100 hit cap. Available to all authenticated roles (RLS still constrains visibility).
- **Search query implementation: per-column `.ilike()` chains via `Promise.all`, NOT PostgREST `.or()` string template.** The `.or('memo.ilike.<pat>,full_name.ilike.<pat>,...')` style is forbidden — it interpolates raw user input into a comma/dot-delimited filter DSL, so a needle containing `,`, `(`, `.` etc. lets an authenticated user inject additional filter clauses (and `\` isn't the default LIKE ESCAPE either). The current implementation runs one `.ilike()` per column in parallel and unions the row IDs. GIN trigram indexes (`pg_trgm`) exist on every searched text column (`contracts.contact_*` included) — keep them in sync if you add a column.

### Cron / batch endpoints

`app/api/cron/terminate-expired/route.ts` is the only scheduled endpoint. It requires `CRON_SECRET` via `Authorization: Bearer <secret>` **header only** (or `x-cron-secret`) — the URL `?secret=` fallback was removed because Vercel access logs / referrer / browser history leak querystrings. Vercel Cron supports header-based auth natively. The route exports `runtime = 'nodejs'` and `maxDuration = 60`.

Uses `SUPABASE_SERVICE_ROLE_KEY` to act as the first available master user. `vercel.json` has the schedule (daily KST 01:00). The underlying RPC `terminate_expired_contracts` uses `contract_effective_expiry()`, so auto-renewing contracts are correctly skipped (their effective expiry always rolls into the future) until `auto_renewal_end_date` is reached.

### Export routes

Four endpoints under `app/api/export/`. All `requireWriter()` (viewer cannot export), all log to `activity_logs` with `event_type='zip_download'` + `after_value.type` discriminator for filtering, all `export const runtime = 'nodejs'`.

**Excel (`exceljs`)** — header row navy `FF1F3864` + white bold text, columns sized for Korean labels:
- `contracts.xlsx?status=&type=&party=&q=` — full contract list with filters
- `expiring.xlsx?window=30|60|90` — `/expiring` data; client uses `effectiveExpiry()` + `daysUntil()` in JS, server fetches `status='completed'` rows with `.limit(1000)` then enriches/filters
- `uncontracted.xlsx?cls=si|gun|gu` — `/uncontracted` data; calls `get_region_stats` RPC, filters live mains = 0, sorts by sido → classification → name. Includes a second "요약" sheet with totals + 계약률.

**ZIP** (`contracts.zip`) — N-file PDF archive. Pattern:
- `export const maxDuration = 300; const MAX_FILES_PER_ZIP = 500;` — slice and note truncation in `_manifest.txt`
- **Input is lazy**: each `zip.file(path, asyncPromise)` where the promise resolves to a single PDF Buffer — JSZip pulls them one at a time as the output stream is consumed
- **Output is streamed**: `zip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 1 } })` wrapped in a manual `new ReadableStream({ start(controller) { ... } })` because `Readable.toWeb()` doesn't accept JSZip's `NodeJS.ReadableStream` interface return type. Compression level 1 because PDFs are already compressed.

Do not switch ZIP back to `zip.generateAsync({ type: 'arraybuffer' })` — it buffers the entire archive in lambda memory and OOMs on real-world data (50MB/file × 30 files > 1024MB Vercel limit).

When adding a new export route, the page header puts the "📥 엑셀 내보내기" button on the right side, gated by `canWrite(me.role)` so viewers don't see it. Querystring values flow straight from the page filter into the export URL.

### Expiring contracts page

`/expiring` (and the dashboard summary) use **30/60/90일** buckets — not the legacy 7/30/60. `get_kpi_summary` returns `expiring_30d / expiring_60d / expiring_90d`. D-day color thresholds: ≤30 red, ≤60 amber, else slate.

The dashboard "만료 임박" table filters `master_contract_id IS NULL` (mains only) — matching `get_region_stats` and `get_kpi_summary` (both mains-only per invariant #5). The `/expiring` page itself shows both mains and supplements with `·메인/·부속` badges, and each bucket card displays a "메인 X · 부속 Y" split underneath the count.

**자동연장 구분**: `/expiring` 의 D-day는 자동연장 계약에선 "종료 임박"이 아니라 "다음 주기로 갱신되는 시점"이다. 그래서 ① 실효 만료일 옆에 `🔄` 배지, ② `isSafeRenewal()` (= `auto_renewal` 이면서 종료일 cap 미도달 — `effectiveExpiry()` 가 `auto_renewal_end_date` 와 일치하지 않음) 인 행은 D-day를 회색 + "자동갱신" 표기로 약화, ③ 버킷 카드에 `자동연장 N · 조치 필요 M` split 추가 (조치 필요 = `isSafeRenewal` 아닌 것 = 만료 전 갱신 착수가 실제로 필요한 건수). `expiring.xlsx` 도 `자동연장` / `구분`(자동갱신·조치 필요) 컬럼 포함. 자동연장이어도 종료일 cap 에 도달한 계약은 진짜 종료 위험이므로 빨강/주황 유지.

### Uncontracted (미계약) page

`/uncontracted` lists LGs with no living main contract. **"미계약" 정의**: `s.completed + s.in_progress + s.updating == 0` (a `terminated`-only LG still counts as uncontracted — they need a new contract). Data source: `get_region_stats` RPC (no new RPC — re-slices existing result). Renders:
- Summary card: count + 계약률 progress bar + per-classification (시/군/구) tile
- Classification filter chip (전체/시/군/구)
- Sections grouped by sido (sorted by name), within sido sorted by `classification → sigungu`. Each section shows the per-sido count emphasized in rose, and a small table with No (1..N within sido) / 지자체 / 분류 / 종료 이력 columns

Do not re-add the per-LG contact-info badges or a "+ 신규 등록" inline button — both were tried and explicitly removed for being noise. The page is read-only by design.

### Maintenance (유지보수) page

`/maintenance` lists all mou contracts ([page.tsx](app/(app)/maintenance/page.tsx)). Read-mostly — no separate registration form; users register mou via the standard `/contracts/new` flow with the **유지보수** supplement checkbox checked, which reveals a sub-section for independent dates + 자동연장 + 계약금액 (see invariant #6). The list is a flat table (no main/supplement grouping — every row is a mou supplement).

**연도별 계약현황**이 페이지 핵심 컨셉. 검색 폼 영역에 **용역 제공 연도 드랍다운** + 선택 연도 요약 inline 표시(`{N}년 용역: X건 · 총 Y원`). 연도 기준은 **`effectiveExpiry()` 의 연도** (= mou는 연장/자동연장 없으므로 `expiry_date` 연도) — 체결일이 전년도 말(예: 2025-12 체결, 계약기간 2026년)이라도 2026년 용역으로 집계. `signed_date` 기준 아님 — 유지보수는 "용역을 제공하는 연도"가 의미 단위라서. 드랍다운 옵션은 그 연도들의 distinct + "전체". 표는 선택 연도로 필터. mou는 단일 주체(모노플랫폼) + 갱신 chain 으로 status가 거의 'completed' 또는 'updating' 둘 중 하나라 status/party 필터 칩은 없음 (invariant #8). 필터는 연도 + q(지자체명·담당부서·담당자·전화·이메일·메모 column-wise ilike — `.or()` 금지, CLAUDE.md 보안 경고).

컬럼: No / 지자체 / 담당부서·담당자 / 연락처(전화·이메일) / 상태 / 계약체결일 / 실효 만료일 / **계약금액(KRW)** / 최종 수정 / 동작(미리보기·수정). 주체 컬럼 없음. PDF preview reuses [RowPreview](app/(app)/contracts/row-preview.tsx); LG 담당자 info is read from `local_governments.contact_*` (shared across the LG's contracts). Excel export at `/api/export/maintenance.xlsx` — separate ExcelJS route with `excel_export_maintenance` audit type (writer-only), 같은 연도+q 필터 적용. Pagination identical to `/contracts`. Row click → standard `/contracts/{id}` detail page (no separate detail).

매년 재계약은 mou 상세의 `[갱신 착수]` 버튼으로 — 새 row가 `parent_contract_id=작년id`, `master_contract_id=메인id`, status='갱신중'으로 생성되며 부모의 type/party/master/amount/auto_renewal/memo가 prefill. 자세한 흐름은 invariant #9.

### next.config

`/geo/*` (TopoJSON assets) get `Cache-Control: public, max-age=86400, immutable` via `next.config.ts` `headers()`. Next.js defaults to `max-age=0, must-revalidate` for `public/` files, which would force re-validation of the ~870KB `korea-admin.topo.json` on every dashboard nav. When the topojson content changes, rename the file (include a content hash) so the immutable cache busts.

## Local conventions

- `lib/types/database.ts` is the source of truth for table/enum types. Don't recreate them inline.
- Korean labels are intentional and load-bearing — UI is Korean-only, no i18n abstraction.
- The `document/` folder contains the PRD v3.0, ERD spec, ERD diagram, and seed SQL. These are reference artifacts; treat them as the spec.
- See `README.md` for project intro + tech stack + role table + env vars. README's "Phase 0~3 진행 상황" and "핵심 설계 포인트" section are **historical** — Phase 4 (maintenance, /maintenance tab, amount_krw, mou domain rules) is not in README, and README's design point #6 (`COALESCE(extended_expiry_date, expiry_date)`) is **outdated** and contradicts invariant #2 (auto-renewal). When in doubt, trust this file over README.
