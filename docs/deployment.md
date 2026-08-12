# Cup Shup POS — Deployment

**Depends on:** every prior part
**Code delivered in this part:** `.github/workflows/*.yml`

---

## 1. Two Supabase projects, not one

**Staging and production are separate Supabase projects**, not one
project with two branches of data. This build has used exactly one
project throughout (`xvhfnuadanjthsvwdehp`, linked 2026-08-12) — that
one becomes **production**. Before going live, create a second,
genuinely separate project for staging, and re-run every migration in
`supabase/migrations/` against it (`supabase db push --db-url
<staging-url>`) so it starts from the identical schema. Never point
staging and production at the same database — the whole reason staging
exists is to test a risky change (a new migration, an RLS policy edit)
somewhere a mistake can't touch a real sale.

## 2. Branches → environments

```
main     -> production Supabase + Vercel production   (deploy-production.yml)
staging  -> staging Supabase + Vercel staging          (deploy-staging.yml)
any PR   -> Vercel preview (build only, no migrations) (ci.yml)
```

`ci.yml` runs on every PR and every push to `main`/`staging`: lint,
typecheck, unit tests, build. It never touches a database. Only the two
deploy workflows run migrations, and only via `supabase db push` inside
CI — never a developer's own terminal against a real project. This
build's own history is full of `supabase db push --db-url ...` run by
hand from this session, which was the right call while there was no CI
yet to do it instead; that stops being true the moment these workflows
are wired up for real.

## 3. Secrets these workflows need (none configured yet)

Set in the GitHub repo's Settings → Secrets and variables → Actions:

| Secret | Where it comes from |
|---|---|
| `STAGING_SUPABASE_DB_URL` | Staging project's Settings → Database → Connection string |
| `PRODUCTION_SUPABASE_DB_URL` | This project's own connection string (Settings → Database) |
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Vercel project Settings → Tokens / General |

## 4. Environment variables (Vercel)

Every variable in `.env.local.example`, set per-environment
(Preview/Staging get the staging Supabase project's values; Production
gets production's):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SUPABASE_OUTLET_ID
SUPABASE_SERVICE_ROLE_KEY        -- server-only, never NEXT_PUBLIC_
NEXT_PUBLIC_PRINT_AGENT_URL      -- optional, defaults to localhost:9100
PRA_API_URL / PRA_API_KEY        -- unset = mock (app/api/pra/submit), Part 19
NEXT_PUBLIC_SENTRY_DSN / SENTRY_DSN  -- unset = Sentry inert, Section 5 below
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security entirely
(Part 04's own rule #2) — it must never carry the `NEXT_PUBLIC_` prefix,
which is the one thing in this whole list that would leak it to every
browser tab.

## 5. What's live-verified vs. what needs a real GitHub remote

This repository has no GitHub remote configured (`git remote -v`
returns nothing) — every migration and every piece of live verification
in this entire build happened via direct `supabase db push --db-url`
from this session, not through the CI/CD pipeline described above. The
workflow files are real, complete, and ready; they have never actually
run, because there's no GitHub Actions runner to run them without a
remote repository to trigger from. Connecting one (`git remote add
origin ...`, `git push -u origin master`) and setting the secrets in
Section 3 is what turns this from "written" into "working."
