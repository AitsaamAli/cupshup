# Cup Shup POS — Second-Wave Adversarial Audit, 2026-08-14

**Why this exists:** after the 2026-08-13 audit (`docs/security-audit-2026-08-13.md`)
fixed five bugs — one CRITICAL — the user explicitly rejected treating
that as evidence the system was safe, and demanded every function
accepting a foreign resource id be independently re-checked for the SAME
class of gap Finding A exposed, not just the ones already proven
exploitable, plus a fresh pass on state machines and financial
reconciliation. This is that sweep.

**Status: code-complete, NOT YET live-verified in this session.** Every
fix below was written and (for the CRITICAL/HIGH ones) has a permanent
regression test written against it. This session's shell had no
`SUPABASE_ACCESS_TOKEN`, no linked project (`supabase link` fails with
`LegacyProjectNotLinkedError`), and no direct Postgres connection string
— so nothing here has actually been pushed to or executed against the
real project yet, unlike the 2026-08-13 findings which were reproduced
live end to end. This is an infrastructure/credentials gap in this
session, not a decision to skip verification — see "What's still needed"
below for the exact commands to run once credentials are available.

---

## Method

Went file-by-file through `supabase/migrations/*.sql`, listing every
`SECURITY DEFINER` function (35 across the whole migration set) and,
for each one taking a foreign resource id, asking exactly the question
the user specified: **does this operation verify the target row belongs
to the caller's own outlet, or does it only check the caller's role and
trust the id?** Then did the same for every RLS policy on every table
those same functions touch (`0005_rls.sql`), and separately re-read the
order-lifecycle functions for state-machine gaps (not cross-outlet ones)
since Finding A's own fix (0035) never changed that logic.

## Findings

| # | Title | Severity | Layer | Fix |
|---|---|---|---|---|
| F | `close_business_day` — any outlet's manager+ could close/lock a different outlet's business day | **CRITICAL** | RPC | 0036 |
| G | `close_shift` — any outlet's manager+ could close and reconcile a different outlet's shift | **CRITICAL** | RPC | 0036 |
| H | `record_cash_movement` — any outlet's manager+ could post a fabricated drop/pickup/paid-in against a different outlet's shift | **CRITICAL** | RPC | 0036 |
| I | `record_purchase` / `record_stock_count` — wrote to the ingredient's REAL outlet regardless of caller's outlet; any outlet's owner/manager could tamper with another outlet's inventory ledger and moving-average cost | **CRITICAL** | RPC | 0036 |
| J | `manage_items` / `kitchen_86` (menu_items), `manage_prices` (menu_item_prices), `manage_recipes` (recipe_lines), `cash_moves` (cash_movements) RLS policies checked ROLE only, no outlet — direct `supabase.from(table).update()` calls bypassed the RPC layer entirely | **CRITICAL** | RLS | 0037 |
| K | `purchase-invoices` / `expense-receipts` private storage buckets — RLS checked role only, no outlet; any owner/manager could list/read/write another outlet's private invoice and receipt photos | **CRITICAL** | Storage RLS | 0038 |
| L | `upsert_menu_item`, `change_item_price`, `toggle_86`, `set_menu_item_active` — no ownership check on `p_item_id` (or `p_category_id`) | **HIGH** | RPC | 0036 |
| M | `upsert_recipe_line` / `remove_recipe_line` — no ownership check on `p_menu_item_id`/`p_ingredient_id` | **HIGH** | RPC | 0036 |
| N | `void_order()` had no guard against re-voiding an already-voided order — double-call duplicated the stock give-back for every ingredient the order used | **HIGH** | State machine | 0039 |
| O | `record_purchase_return` — ingredient id checked against neither the caller's outlet nor the purchase's own outlet | **MEDIUM** | RPC | 0036 |
| P | `next_invoice_no` — no `revoke`/`grant` at all, left directly callable by `anon`/`authenticated` with zero auth check, letting anyone burn/advance any outlet's "gapless" invoice sequence | **MEDIUM** | Grants | 0036 |
| Q | `open_shift`'s `p_terminal_id` never checked against caller's outlet (data-integrity only — the shift itself stays correctly scoped) | **LOW** | RPC | 0036 |
| R | `read_prices` (menu_item_prices), `read_recipes` (recipe_lines), `read_mods` (modifiers), `read_item_mods` (menu_item_modifier_groups) RLS policies used `auth.uid() is not null` as their only check — every outlet's price history, recipes (a direct COGS/trade-secret input), and modifier definitions were readable by every logged-in staff member at every outlet | **HIGH** (confidentiality) | RLS | 0037 |

## Findings NOT fixed — flagged, not guessed at

**Voiding an already-SETTLED order silently drops its cash from
reconciliation.** `docs/order-engine.md` §3 explicitly diagrams
`settled -> (voided)` as an intended transition, and `void_order()`
still allows it (0039 only blocks re-voiding an already-*voided* order).
But `close_business_day()`/`close_shift()` both compute `cash_sales` by
joining `payments` to `orders` filtered on `o.status = 'settled'` — so
the instant a settled cash order is voided, its real payment silently
stops counting toward expected cash, while `void_order()` never touches
the `payments` table or reverses/flags it. If a cashier settles an order
for cash and later voids it, the drawer keeps the cash, "expected cash"
drops to match, and the variance report shows nothing wrong — a classic
post-void cash-skimming pattern real POS systems specifically guard
against. Fixing this means deciding actual financial-policy questions
(does a post-settlement void require a mandatory linked refund? owner-
only approval? a negative reversal payment row visible in reports?) —
not something to silently pick and ship as a one-line SQL patch. **This
needs a product decision before it gets fixed.**

## What's still needed

1. **Apply the four new migrations** (`0036`–`0039`) to the real linked
   project — `supabase link` then `supabase db push`, or paste each file
   into the Supabase SQL editor in order, from an environment that has
   the project's access token / DB credentials (this session's shell has
   neither).
2. **Run the live-audit script** against the real project once linked:
   `node --env-file=.env.local scripts/live-audit/cross-outlet-attack.mjs`
   — extended this session with checks for every fix in the table above
   (F, G, H, I, L, M, plus two direct-table RLS bypass attempts for
   finding J). Every check currently only exists as code; none has run.
3. **Run the two new pgTAP files** —
   `supabase/tests/database/second_wave_cross_outlet.sql` (14 assertions
   covering F–M plus three direct-table RLS attacks) and
   `supabase/tests/database/void_idempotency.sql` (4 assertions covering
   N) — the same way every other file in that directory was run (see
   `docs/testing-strategy.md` §3): a raw `pg.Client` multi-statement
   query, since `supabase db query --file` can't execute a pgTAP script.
4. **Decide the settled-order-void policy** above before it's fixed.
5. Everything `docs/security-audit-2026-08-13.md`'s own "what this audit
   did NOT cover" section already listed remains equally uncovered here
   (mutation testing, load testing at scale, a real backup/restore
   drill, migration-from-clean-database testing, the full Playwright E2E
   suite).

## What this second wave did NOT get to

The user's directive also asked for a full role×operation×resource×
outlet matrix, a fresh session/token-lifecycle attack pass, input
fuzzing, an error-path/swallowed-exception sweep, dead-code/secrets
search, and injection testing. This session's time went to the
sibling-search method the user specified FIRST ("audit all 13 fixed
functions and their neighbors... then inspect functions written by the
same build parts") applied exhaustively across every migration file,
plus one state-machine re-read of the order lifecycle — which is what
actually found findings F through R above. The remaining categories are
real, requested, and **not started** — not silently assumed fine.
