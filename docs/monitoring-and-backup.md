# Cup Shup POS — Monitoring & Backup

**Depends on:** Part 19 (PRA queue), this part's own offline/print queues
**Code delivered in this part:** `instrumentation.ts`, `instrumentation-client.ts`,
`sentry.server.config.ts`, the PRA-stuck alert in `lib/pra.ts`

---

## 1. Monitoring

| What | Tool | Status |
|---|---|---|
| Errors (client + server) | Sentry | Wired, inert until `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` set |
| PRA sync stuck | Sentry, custom | Wired — `lib/pra.ts` fires a warning after 5 failed attempts (~30+ min of backoff) |
| Slow queries | Supabase dashboard | Built into every Supabase project — Database → Query Performance. Nothing to configure. |
| Uptime | UptimeRobot (or similar) | External SaaS, not code — point it at `/` (or a dedicated `/api/health` route, not built in this part) on a 5-minute check |
| Daily backup verify | Scheduled job | See Section 3 — this is the one item that genuinely needs a decision, not just setup |

Sentry is deliberately **inert by default** — same pattern as Part 19's
PRA mock: the code is real and ready, but does nothing until a DSN is
actually set, so this build never silently starts phoning home to a
Sentry project no one created. Session replay is explicitly disabled
(`instrumentation-client.ts`) — a POS session can show a customer's
phone number (Part 16 delivery lookup) and real menu prices; nothing
should record screen content without that being a deliberate, reviewed
decision, not a monitoring library's default.

## 2. Backup

Supabase's own **Point-in-Time Recovery (PITR)** is the primary backup
— available on paid Supabase plans, restores to any point within its
retention window. Confirm this project is on a plan with PITR enabled
before going live; the free tier does not include it.

A second, independent copy matters too — PITR restores through
Supabase's own tooling, so a Supabase-side incident affecting that
tooling is exactly the scenario a second copy exists for:

```sh
# Daily, via cron or a scheduled GitHub Action — not built in this
# part, this is the exact command it should run:
supabase db dump --db-url "$PRODUCTION_SUPABASE_DB_URL" -f "backup-$(date +%F).sql"
# then upload backup-*.sql to Supabase Storage (a private bucket) or
# any off-platform storage — the point of a second copy is it doesn't
# depend on the same platform as the first one.
```

## 3. The restore drill — the actual point of this section

**A backup that has never been restored is not a backup, it's a hope.**
Once a month, actually do this, on staging (never production):

1. Take staging's most recent automated backup (or a fresh PITR
   restore point).
2. Restore it into a throwaway Supabase project (or reset staging to
   it, if staging has no other purpose that week).
3. Run the pgTAP suite (`supabase/tests/database/`) and a handful of
   real queries — `select count(*) from orders`, `select business_date
   from business_days order by business_date desc limit 1` — against
   the restored database and confirm the numbers look like the real
   business, not stale or truncated.
4. Write down: how long the restore took, and whether anything about
   the process needed a human to make a judgment call. Both matter more
   in the middle of a real incident than they do in a calm monthly
   drill — that's exactly why the drill happens monthly, not once.

Nothing in this build automates this drill — it's explicitly a human
process, on a calendar, not a script. A restore drill that's fully
automated and never actually watched by a person stops catching the
kind of failure (a backup that "succeeds" but is subtly wrong) it
exists to catch.
