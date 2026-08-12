# app/reports

Reporting screens — Part 18.

- `dashboard/page.tsx` — the Manager Dashboard: revenue, GST (16%/8%
  split), real gross profit, amortised expenses, net profit, average
  order value, average ticket time, void count/value, low stock, plus
  the hourly heatmap, payment mix, top items, and category revenue
  charts. CSV export lives here too. Visible to owner/manager/supervisor.
- `pl/page.tsx` — Master P&L, owner only, both by RLS (every owner-only
  view embeds its own `has_role('owner')` gate — see
  `docs/reports-and-pl.md` §2) and by PIN (`useStaffSession("pl")`'s
  5-minute idle timeout). The Menu Engineering Matrix, stock variance in
  rupees, cash/void analysis by cashier, reprint tracking, labour cost
  %, and the day-wise/month-wise P&L tables.

Every number on both screens comes from a server-side Postgres view
(`supabase/migrations/0028_reports_views.sql`, read through
`lib/reports.ts`) — never the raw `orders` table loaded row-by-row into
the browser.
