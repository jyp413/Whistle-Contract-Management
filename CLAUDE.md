# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical: Next.js version

@AGENTS.md says this Next.js (16.x) has breaking changes from training-data versions. **Read `node_modules/next/dist/docs/` before writing or editing any Next.js code** — especially `01-app/` for App Router APIs. Heed deprecation warnings (e.g. `middleware` is deprecated in favor of `proxy` per build output).

## Commands

```bash
npm run dev      # next dev (Turbopack)
npm run build    # next build (also runs TypeScript type check)
npm run start    # next start (production, requires prior build)
npm run lint     # eslint
```

For local preview, use `mcp__Claude_Preview__preview_start` (configured in `.claude/launch.json`) instead of running `npm run dev` directly. The dev server holds a per-directory port lock — only one instance can run per project at a time.

`.env.local` must contain `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See `.env.example`.

## Database changes

Use the Supabase MCP server, **not** local migration files:
- `mcp__263e0873-...__apply_migration` — DDL changes (auto-named, idempotent on re-run if you guard properly)
- `mcp__263e0873-...__execute_sql` — read-only ad-hoc queries
- `mcp__263e0873-...__generate_typescript_types` — regenerate after any schema change; paste the result into `lib/types/database.ts`

The `Database` type in `lib/types/database.ts` is hand-maintained. Keep the `Relationships: [...]` arrays — supabase-js's PostgREST inference falls back to `never` without them, breaking `.select()` types.

## Architecture

### Domain model — read first

This is a **계약 건 (contract) 단위 상태 관리 시스템**. Key invariants that span multiple files:

1. **Status lives only on `contracts.status`.** Never derive status from history. One 지자체 holds N contracts independently.
2. **Effective expiry** = `COALESCE(extended_expiry_date, expiry_date)`. Always compute via `effectiveExpiry()` in `lib/utils.ts` — never compare `expiry_date` raw.
3. **History tables are INSERT-ONLY.** A DB trigger rejects UPDATE/DELETE on `contract_status_history`, `contract_extensions`, `activity_logs`. Don't try to "fix" rows by editing — append corrections.
4. **Status transitions are whitelisted by trigger** `validate_contract_status_transition()`. Only six pairs are allowed; everything else raises `check_violation`.
5. **Corrections bypass the trigger** via `apply_correction` RPC, which sets `app.in_correction='true'` GUC inside a SECURITY DEFINER function. The trigger checks the GUC. Never UPDATE status backwards from the app — always go through the RPC.
6. **`contracts.version` is an optimistic lock.** Every mutation reads `version`, updates with `WHERE version = expected`, and treats `affected_rows = 0` as conflict (HTTP 409 / refresh prompt). The pattern is repeated in every action in `app/(app)/contracts/[id]/actions.ts`.
7. **`activity_logs.target_id` is polymorphic** — no FK. Branch on `target_type` when joining.

### Auth flow

- `auth.users` is Supabase-managed. A trigger `handle_new_auth_user()` mirrors signups into `public.users` with `role='viewer'` by default. **Email `pjy413@gmail.com` is hard-coded to auto-promote to `master`** in that trigger.
- `middleware.ts` (Next.js root) → `lib/supabase/middleware.ts` runs on every request, refreshes the Supabase session, redirects unauthenticated users to `/login`, and bounces authenticated users away from auth pages.
- Server Components/Actions get the user via `lib/auth.ts`: `requireUser()` / `requireWriter()` (master+accounting) / `requireMaster()`. These redirect on failure, so callers don't need to handle unauthenticated cases.
- The `(app)` route group in `app/(app)/layout.tsx` calls `requireUser()` once and renders the shell with role-aware nav.

### RLS model

Every public table has RLS. Policies reference `public.current_user_role()` which is SECURITY DEFINER. **`authenticated` MUST keep `EXECUTE` on this function** — Postgres checks EXECUTE permission on the caller role *before* running the SECURITY DEFINER body, so revoking it breaks every RLS evaluation (manifests as `permission denied for function current_user_role` or empty result sets). The function only returns the user's own role, so its REST `/rpc/current_user_role` exposure is acceptable. Trigger-only functions (`handle_new_auth_user`, etc.) DO have EXECUTE revoked from anon/authenticated since they never need direct call.

Effective access:
- `master` — full
- `accounting` — read all + write contracts/files/history/extensions; owns reads on activity_logs
- `viewer` — read contracts/files/lg only; cannot download (enforced at app layer)

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

### Layout conventions

- Pages are async Server Components. Side-effect mutations live in colocated `actions.ts` files.
- Modals/forms that need state are client components in the same folder (`upload-card.tsx`, `contract-actions.tsx`, etc.).
- Date inputs handle nullable dates by passing `''` as the empty value, converted to `null` in the action.
- Status enum values come from `Database['public']['Enums']['contract_status']`. Do not redefine them as string literals.
- All visible labels use the maps in `lib/utils.ts` (`STATUS_LABEL`, `ROLE_LABEL`, etc.) — keep these in sync with the DB ENUMs.

### Cron / batch endpoints

`app/api/cron/terminate-expired/route.ts` is the only scheduled endpoint. It requires `CRON_SECRET` and uses `SUPABASE_SERVICE_ROLE_KEY` to act as the first available master user. `vercel.json` has the schedule (daily KST 01:00).

## Local conventions

- `lib/types/database.ts` is the source of truth for table/enum types. Don't recreate them inline.
- Korean labels are intentional and load-bearing — UI is Korean-only, no i18n abstraction.
- The `document/` folder contains the PRD v3.0, ERD spec, ERD diagram, and seed SQL. These are reference artifacts; treat them as the spec.
- See `README.md` for phase-by-phase implementation status and the canonical list of design points (status SSOT, renewal chain via `parent_contract_id`, etc.).
