# Cup Shup POS — Third-Wave Adversarial Audit, 2026-08-14

**Verification tiers used throughout, per the user's own required
distinction:**

- **STATIC** — read the SQL/code and traced its logic by hand. Reliable
  for anything Postgres's behavior is deterministic about (a `where`
  clause either has the join or it doesn't), unreliable for anything
  that depends on runtime state or timing.
- **UNIT** — a Vitest test exists and passes against mocked clients.
- **INTEGRATION (WRITTEN, NOT RUN)** — a pgTAP file or live-audit script
  exists, is committed, and is believed correct by inspection, but has
  **not executed** against a real database in this session.
- **LIVE VERIFIED** — actually executed against the real linked Supabase
  project and observed to behave as claimed.

**This session has zero LIVE VERIFIED items below.** `supabase link`
fails (`LegacyProjectNotLinkedError`), `supabase projects list` fails
(`Access token not provided`), no `SUPABASE_ACCESS_TOKEN` /
`E2E_DATABASE_URL` / any Postgres connection string exists in this
session's environment, and `~/.supabase` holds only telemetry, no cached
credential. Every claim below is STATIC, UNIT, or INTEGRATION
(WRITTEN, NOT RUN) — labelled explicitly, never rounded up.

---

## A. NEW FINDINGS (this wave)

| # | Finding | Severity | Tier |
|---|---|---|---|
| S1 | `place_order()` — even after two prior fixes (0032, 0035) targeting this exact function — never validated `p_table_id` or `p_customer_id` against the caller's outlet. Fixed in `0040`, regression test added to `second_wave_cross_outlet.sql`. | MEDIUM | INTEGRATION (WRITTEN, NOT RUN) |
| T | `menu-images` storage bucket's write policies (insert/update/delete) had the same role-only gap as the other two buckets — found completing the storage matrix (§E). Fixed in `0041` + `lib/storage.ts`. | MEDIUM | INTEGRATION (WRITTEN, NOT RUN — no dedicated regression script yet) |
| S2 | (Confirmed, not new) `next_invoice_no` had no grant restriction — already caught and fixed second-wave, re-confirmed here as part of the RPC matrix sweep below. | — | STATIC |

Two net-new gaps surfaced this wave: S1 above, and T (storage matrix,
§E, below). Sections B–F are the matrices the user required, built from
the same function-by-function read as waves one and two, now organized
so gaps are structurally visible instead of found one at a time.

## B. PREVIOUS FINDINGS LIVE-RETESTED

**None.** Nothing has been live-retested because nothing can run in this
session. Findings A–R (first and second wave) and S1 (this wave) are
STATIC/INTEGRATION-only until a session with real credentials runs
`scripts/live-audit/*.mjs` and the four pgTAP files.

## C. AUTHORIZATION MATRIX (RPC layer) — every SECURITY DEFINER function

Role columns show who can call the function AT ALL (the internal role
check). "Outlet check" is whether the function verifies every id
argument it receives belongs to the caller's own outlet before acting on
it. Every "no → FIXED" row was a real finding, now fixed; every
"n/a" row takes no foreign-owned id (nothing to check).

| Function | Roles | Outlet check on every foreign id | Status |
|---|---|---|---|
| `current_staff`/`has_role`/`my_outlet` | any authed | n/a (self-lookup) | fine |
| `list_active_staff(p_outlet_id)` | anon/authed (deliberate, pre-login) | n/a — returns only name+role, no writes | fine, by design |
| `verify_staff_pin` | service_role only | n/a | fine |
| `set_staff_pin(p_staff_id)` | owner/manager | yes (`outlet_id = v_actor.outlet_id`) | fine |
| `log_staff_logout` | authed | n/a (self) | fine |
| `tax_rate_bp`/`class_of_method` | anyone (not security definer) | n/a, global reference data | fine |
| `next_invoice_no(p_outlet)` | **was: anyone, no check at all** | no → **FIXED 0036** (grant revoked, internal-only) | fixed |
| `upsert_menu_item(p_id, p_category_id)` | owner/manager | no → **FIXED 0036** | fixed |
| `change_item_price(p_item_id)` | owner/manager | no → **FIXED 0036** | fixed |
| `toggle_86(p_item_id)` | owner/manager/supervisor/chef/kitchen | no → **FIXED 0036** | fixed |
| `reorder_categories(p_category_ids[])` | owner/manager | yes (already correct) | fine |
| `set_menu_item_active(p_item_id)` | owner/manager | no → **FIXED 0036** | fixed |
| `current_price_paisa`/`recipe_cost_paisa`/`next_order_no` | internal helpers | n/a | fine |
| `place_order(p_outlet, p_table_id, p_customer_id, ...)` | staff of that outlet | p_outlet: **FIXED 0035**; p_table_id/p_customer_id: no → **FIXED 0040** | fixed |
| `void_order(p_order_id)` | owner/manager/supervisor | yes (**FIXED 0035**); double-void: no → **FIXED 0039** | fixed |
| `advance_order_status(p_order_id)` | authed staff | yes (**FIXED 0035**) | fine |
| `add_items_to_order(p_order_id)` | authed staff | yes (**FIXED 0035**) | fine |
| `settle_order(p_order_id)` | authed staff | yes (**FIXED 0035**), row-locked (`for update`) | fine |
| `advance_order_item_status(p_order_item_id)` | kitchen roles | yes (**FIXED 0035**) | fine |
| `mark_ticket_items_ready(p_order_id)` | kitchen roles | yes (**FIXED 0035**) | fine |
| `recall_order(p_order_id)` | kitchen roles | yes (**FIXED 0035**) | fine |
| `record_invoice_print(p_order_id)` | authed staff | yes (**FIXED 0035**) | fine |
| `enqueue_pra_submission(p_order_id)` | authed staff | yes (**FIXED 0035**) | fine |
| `record_pra_result`/`record_pra_failure` | service-role / internal | yes (**FIXED 0035**) | fine |
| `upsert_recipe_line`/`remove_recipe_line` | owner/manager/chef | no → **FIXED 0036** | fixed |
| `record_purchase(p_ingredient_id)` | owner/manager | no → **FIXED 0036** | fixed |
| `record_stock_count(p_ingredient_id)` | owner/manager | no → **FIXED 0036** | fixed |
| `upsert_supplier(p_id)` | owner/manager | yes (already correct) | fine |
| `set_supplier_active(p_supplier_id)` | owner/manager | yes (already correct) | fine |
| `record_purchase_grn(p_supplier_id, lines[])` | owner/manager | yes (already correct, per-line) | fine |
| `record_purchase_return(p_purchase_id, p_ingredient_id)` | owner/manager | purchase: yes; ingredient: no → **FIXED 0036** | fixed |
| `open_business_day(p_outlet)` | manager+ | yes (**FIXED 0035**) | fine |
| `close_business_day(p_business_day_id)` | manager+ | no → **FIXED 0036** | fixed |
| `open_shift(p_terminal_id)` | authed staff | terminal: no → **FIXED 0036**; day: derived from own outlet, safe | fixed |
| `close_shift(p_shift_id)` | own cashier or manager+ | no → **FIXED 0036** | fixed |
| `record_cash_movement(p_shift_id)` | own cashier or manager+ | no → **FIXED 0036** | fixed |
| `record_expense`/`approve_expense`/`update_expense`/`delete_expense` | supervisor+/manager+/owner (tiered) | yes, all four, from the start (Part 14) | fine, was always correct |

**35 SECURITY DEFINER functions total. 17 had a real ownership gap
across all three waves; all 17 now fixed in code (0035/0036/0039/0040),
none live-verified.**

## D. RLS MATRIX (direct-table layer) — every policy touching a
multi-tenant table

| Table | Op | Using/Check had outlet scoping? | Status |
|---|---|---|---|
| `menu_items` (`manage_items`, `kitchen_86`) | ALL/UPDATE | no (role only) → **FIXED 0037** | fixed |
| `menu_item_prices` (`manage_prices`) | ALL | no (role only) → **FIXED 0037** | fixed |
| `menu_item_prices` (`read_prices`) | SELECT | no (`auth.uid() is not null` only) → **FIXED 0037** | fixed |
| `recipe_lines` (`manage_recipes`) | ALL | no (role only) → **FIXED 0037** | fixed |
| `recipe_lines` (`read_recipes`) | SELECT | no → **FIXED 0037** | fixed |
| `cash_movements` (`cash_moves`) | ALL | no (role only) → **FIXED 0037** | fixed |
| `modifiers` (`read_mods`) | SELECT | no → **FIXED 0037** | fixed |
| `menu_item_modifier_groups` (`read_item_mods`) | SELECT | no → **FIXED 0037** | fixed |
| `outlets`/`staff`/`terminals`/`menu_categories`/`dining_tables`/`business_days`/`shifts`/`ingredients`/`suppliers`/`stock_movements`/`expense_categories`/`expenses`/`customers`/`audit_log` (read policies) | SELECT | yes, all correctly join or filter on `outlet_id = my_outlet()` | fine |
| `orders`/`order_items`/`payments`/`order_voids` (read) | SELECT | yes, all correctly scoped | fine |
| `order_items` (`kds_update_items`) | UPDATE | role only, but writes still land on rows already scoped by the read policy + every kitchen-facing RPC re-checks outlet independently — **not itself a gap**, no direct exploitable path found | fine (reasoned, not separately tested) |
| `expenses` (insert/update/delete) | INSERT/UPDATE/DELETE | yes, all three | fine, was always correct |
| `tax_rates`/`payment_method_tax_class`/`modifier_groups`/`ingredients`(read)/`recipe_lines`(read, pre-fix) | SELECT | `tax_rates`/`payment_method_tax_class` are genuinely global (not outlet data) — correct as-is; the rest fixed above | fine / fixed |
| `orders`,`order_items`,`payments`,`order_voids`,`business_days`,`shifts`,`invoice_counters`,`order_counters` | INSERT/UPDATE/DELETE | direct writes fully revoked from anon/authenticated — RPC-only | fine |
| `invoice_counters`/`order_counters` | ALL | RLS enabled, zero policies → deny-all direct access | fine |

**26 tables have RLS enabled. 8 policies across 6 tables had a real
outlet-scoping gap; all 8 now fixed in `0037`, not live-verified.**

## E. STORAGE MATRIX

| Bucket | Public? | Op | Outlet scoping? | Status |
|---|---|---|---|---|
| `menu-images` | yes (public read by design — non-sensitive photos) | SELECT | n/a, intentionally public | fine |
| `menu-images` | | INSERT/UPDATE/DELETE | no (role only) → **FIXED 0041** | fixed |
| `purchase-invoices` (private) | no | SELECT/INSERT/UPDATE | no → **FIXED 0038** (path-prefix + policy) | fixed |
| `expense-receipts` (private) | no | SELECT/INSERT | no → **FIXED 0038** (path-prefix + policy) | fixed |

**New finding this wave, from completing the storage matrix the user
required in full rather than stopping at the two buckets already
flagged:** `menu-images`' write policies (insert/update/delete) had the
exact same role-only gap as the other two buckets did. Different in kind
from the `0038` fix, not just a copy — this bucket is `public: true`
(menu photos are meant to be publicly viewable, unlike the other two),
so only the write side gets an outlet-path check; SELECT stays fully
public. Fixed in `0041_menu_images_outlet_scoping.sql` +
`lib/storage.ts`'s upload path. **Call this finding T — fixed, not yet
live-verified**, same tier as everything else this wave.

## F. RPC × outlet-parameter cross-reference

This is matrix C re-sorted by which raw id types appear anywhere as an
RPC parameter, per the user's §7 list:

| id type | functions that accept it | all now checked? |
|---|---|---|
| `outlet_id` (p_outlet) | place_order, open_business_day | yes (0035) |
| `order_id` | void_order, advance_order_status, add_items_to_order, settle_order, record_invoice_print, enqueue_pra_submission, record_pra_result, mark_ticket_items_ready, recall_order | yes (0035) |
| `order_item_id` | advance_order_item_status | yes (0035) |
| `shift_id` | close_shift, record_cash_movement | yes (0036) |
| `business_day_id` | close_business_day | yes (0036) |
| `purchase_id` | record_purchase_return | yes (0036, and 0016's own checks) |
| `ingredient_id` | upsert_recipe_line, remove_recipe_line, record_purchase, record_stock_count, record_purchase_return | yes (0036) |
| `menu_item_id`/`item_id` | upsert_menu_item, change_item_price, toggle_86, set_menu_item_active, upsert_recipe_line, remove_recipe_line | yes (0036) |
| `category_id` | upsert_menu_item, reorder_categories | yes (0036 / already correct) |
| `supplier_id` | set_supplier_active, upsert_supplier, record_purchase_grn | yes, already correct |
| `staff_id` | set_staff_pin | yes, already correct |
| `terminal_id` | open_shift | yes (0036) |
| `table_id` | place_order | yes (0040) |
| `customer_id` | place_order | yes (0040) |
| `expense_id` | approve_expense, update_expense, delete_expense | yes, already correct |
| `user_id` | none accept it directly as a param (always derived server-side from `auth.uid()`) | n/a — this is itself a good sign: no function trusts a client-supplied user id |
| `queue_id` | record_pra_failure | yes (0035, via order_id) |

Every id type the user explicitly listed in §7 is accounted for and
checked, **in code**. None of it is LIVE VERIFIED.

## G. SESSION / AUTH RESULTS (partial — static architecture only)

Cannot live-test token expiry/refresh/revocation/OTP replay without a
real Auth server round trip — **NOT VERIFIED — LIVE DATABASE
UNAVAILABLE** for all of: session expiration, refresh, OTP replay/expiry,
multiple concurrent sessions, stolen-token reuse.

What IS verifiable by reading the code (STATIC):

- **Role/outlet changes take effect immediately, not at next login.**
  Every RPC re-derives the caller's identity via `current_staff()` →
  `select * from staff where user_id = auth.uid() and active limit 1`
  on EVERY call. There is no JWT custom claim caching role/outlet — so a
  role downgrade, outlet transfer, or `active = false` deactivation
  applied by an owner takes effect on the very next RPC call from that
  session, not after the existing token expires. This is a real
  architectural strength, confirmed by reading every function's first
  two lines, not assumed.
- **Logout is client-initiated, not server-revoked.** `log_staff_logout()`
  only writes an audit row; the actual sign-out is
  `supabase.auth.signOut()` client-side (`lib/auth.ts`). This means a
  stolen/copied JWT remains valid server-side until its own expiry even
  after the legitimate user "logs out" through the UI — standard
  Supabase JWT behavior (not a bug introduced by this app), but worth
  recording as an accepted limitation rather than silently assuming
  logout revokes access.
- **PIN brute-force is rate-limited** (`verify_staff_pin`, 5 failures /
  15 minutes, keyed by `staff.id` via `audit_log`) — read and confirmed
  present; effectiveness under real concurrent brute-force attempts is
  NOT VERIFIED — LIVE DATABASE UNAVAILABLE.

## H. FINANCIAL INVARIANT RESULTS — the settled-order-void gap, resolved precisely

The user demanded a controlled test (create → settle → reconcile → void
→ reconcile again) rather than a guess. A live run of that test is NOT
VERIFIED — LIVE DATABASE UNAVAILABLE, but the outcome is fully
determined by the SQL itself (deterministic, no timing/concurrency
involved), so it can be traced exactly by reading `settle_order()`,
`void_order()`, and `close_business_day()`/`close_shift()` together —
STATIC, but conclusive:

1. `settle_order()` inserts one or more `payments` rows and sets
   `orders.status = 'settled'`.
2. `close_business_day()`'s `v_cash_sales` query:
   `... join orders o ... where o.status = 'settled' and p.method = 'cash'`.
   With the order settled, this payment counts.
3. `void_order()` (post-0039) sets `orders.status = 'voided'`, inserts
   an `order_voids` row, and reverses stock — but never touches
   `payments`, never inserts a reversal, never flags the payment row in
   any way.
4. Re-running `close_business_day()`'s query after the void: the same
   join now filters on `o.status = 'settled'`, which this order no
   longer is — **the payment silently stops counting**, with no
   compensating row anywhere recording that it was ever removed.

**Confirmed as an OPEN CRITICAL financial-integrity defect**, exactly as
the user's invariant states it must never happen: *"a settled payment
must never silently disappear from financial reconciliation."* It does,
right now, provably, from the SQL alone — no live database was needed
to prove this one, only to demonstrate it end-to-end with real rows
(still worth doing once credentials exist, as confirmation, not as the
source of truth).

**Not fixed, by design of this audit** — three real remediation shapes
exist and picking one is a product decision:

1. Block `void_order()` outright once `status = 'settled'`; require a
   separate, not-yet-built "refund" flow instead.
2. Allow it, but require `owner` role specifically (not manager/
   supervisor) and insert an explicit negative reversal `payments` row
   so `cash_sales` still nets to zero for that order instead of the
   order just vanishing from the query.
3. Allow it, but make `close_business_day`/`close_shift` compute cash
   sales from `payments` directly (independent of `orders.status`) and
   have void insert its own compensating payment record — same net
   effect as (2), different implementation shape.

## I. STATE-MACHINE RESULTS

| Transition | Guarded? |
|---|---|
| void → void again | no → **FIXED 0039** |
| settle → settle again | yes, always was (`if v_order.status = 'settled' then raise`) |
| settle → void | allowed by design (docs/order-engine.md §3) — but see finding H above |
| void → settle | correctly blocked (`settle_order` rejects `status = 'voided'`) |
| void → advance_order_status | correctly blocked (0035, `advance_order_status`'s `case` only allows from `sent_to_kitchen`/`ready`) |
| void → add_items_to_order | correctly blocked (`if v_order.status = 'voided' then raise`) |
| item-level void → item-level void again | no → **FIXED 0039** (added the same guard for `p_order_item_id`) |

## J. CONCURRENCY RESULTS

`place_order()`'s true-concurrency dedup was fixed and covered by
`scripts/live-audit/concurrency-attack.mjs` in the FIRST wave (2026-08-13)
— that one script's checks were reportedly executed live at the time,
per `docs/security-audit-2026-08-13.md`. This wave did not re-run it
(no credentials) and found no new concurrency gap by inspection:
`settle_order`/`void_order`/`close_business_day`/`close_shift` all take
an explicit row lock (`for update`) on their primary target row, which
is the correct primitive for preventing the same double-effect race
`place_order` had. **NOT VERIFIED — LIVE DATABASE UNAVAILABLE** for
confirming this by actually racing them.

## K. FUZZING RESULTS

**NOT VERIFIED — LIVE DATABASE UNAVAILABLE.** No fuzzing was executed
against a real endpoint this wave. Static observation only: every RPC
parameter is typed at the Postgres function-signature level (`uuid`,
`bigint`, `order_status` enum, etc.) — a malformed UUID or wrong-typed
JSON value fails at the PostgREST/plpgsql argument-binding layer before
any application logic runs, which is a real structural mitigation, but
"fails safely with a generic error" was not itself observed live.

## L. INJECTION RESULTS

STATIC review, not live: grepped the entire repo for dynamic SQL
construction (`execute format(...)`, string-concatenated `execute`) and
found **none** — every SQL statement in every migration is static plpgsql
with typed bound parameters; there is no code path that builds a SQL
string from user input anywhere in this codebase. Also grepped for
`dangerouslySetInnerHTML`/`eval(`/`new Function(` across the whole app —
**none found**. CSV export escaping (`toCsv()`) already has dedicated
unit coverage (`tests/export.test.ts`) confirming comma/quote/newline
escaping; formula-injection specifically (a leading `=`/`+`/`-`/`@`
triggering formula execution when opened in Excel) was **not** checked
by that test and is a real gap — flagged, not fixed, this wave.

## M. SECRET / DEAD-CODE RESULTS

- Grepped for hardcoded service-role/secret key literals outside
  `.env.local` (git-ignored, confirmed) — **none found** committed.
- `createAdminClient()` (the one function wrapping the service-role key)
  is imported in exactly one place, `app/api/auth/pin/route.ts` — a
  server-only Next.js route handler, never bundled to the browser.
  Confirmed by direct grep across the whole `.ts`/`.tsx` tree.
- `set_menu_item_active` and `set_staff_pin` are fully implemented,
  correctly permission-checked RPCs with no UI wired up to call them yet
  — reachable directly via `supabase.rpc(...)` by any authenticated
  session even though no button exists. Not a vulnerability (both were
  independently confirmed correctly outlet/role-scoped above), but
  worth recording: "no UI for it" is not a security boundary in this
  app, by its own stated design philosophy, and both were correctly
  written as if they were fully public-facing.
- No other unused/legacy RPCs, deprecated routes, or dead privileged
  code paths found in this pass.

## N. TEST-QUALITY RESULTS ("test the tests")

Reasoned (not executed — no DB to actually revert-and-rerun against)
whether each critical regression test's assertion is causally tied to
the fix, i.e. whether reverting the fix would make the assertion fail:

| Test | Would fail if the fix were reverted? |
|---|---|
| `cross_outlet_isolation.sql` | yes — asserts the exact `AUTH:`/`ORDER:` exception text the outlet check raises; without it, the RPC would succeed and `ok()` would fail |
| `second_wave_cross_outlet.sql` | yes, same shape, one assertion per fixed function |
| `void_idempotency.sql` | yes — asserts `'ORDER: already voided'` specifically, and separately asserts net stock is unchanged after the rejected second call, which is a genuine causal check on the STOCK EFFECT, not just the error text |
| `middleware.test.ts` / `auth-otp.test.ts` | yes, both assert the exact prior failure mode |
| `idempotency.sql` | yes, asserts row count = 1 |

This reasoning is STATIC (inspection of the assertions), not the
literal "revert the fix, rerun, confirm red" the user demanded — that
step is NOT VERIFIED — LIVE DATABASE UNAVAILABLE.

## O. MIGRATION RESULTS

No Docker/local Postgres in this environment (confirmed in earlier
waves) — clean-install-from-`0001` testing remains **NOT VERIFIED**, as
it has been every prior wave. STATIC review this wave: `0036`–`0040` all
use `create or replace function` (safe to reapply) and plain `drop
policy` + `create policy` pairs (0037/0038) — `drop policy` fails loudly
if the named policy doesn't exist, which is correct fail-closed behavior
for a migration that must run in order on top of `0005`/`0018`/`0022`,
not silently skip.

## P. BLOCKED TESTS

Everything requiring a live database or live Auth round trip: all of
sections G (except the static sub-findings), J, K, L (execution),
"break the fix and confirm the test goes red," the four pgTAP files, and
the extended `cross-outlet-attack.mjs` checks.

## Q. NOT VERIFIED TESTS

`0040`'s `place_order` table_id/customer_id fix now has two dedicated
assertions added to `second_wave_cross_outlet.sql` (plan 14 → 16) this
same turn — INTEGRATION (WRITTEN, NOT RUN), same tier as everything
else in that file.

## R. OPEN DEFECTS

- **Finding H** (settled-order-void cash disappearance) — CRITICAL,
  needs a product decision, not fixed.
- **Finding Q** (0040's own missing regression test) — process gap.
- CSV formula-injection escaping — not checked, not fixed.
- Everything in `docs/security-audit-2026-08-13.md`'s original "did NOT
  cover" list, still uncovered: mutation testing, load testing at scale,
  real backup/restore drill, full Playwright E2E execution.

## S. PRODUCTION GATE

**NOT PRODUCTION READY.** Reasons, concretely: one CRITICAL open defect
with no fix (H), one MEDIUM open defect with no fix (T), zero LIVE
VERIFIED evidence for ANY finding across all three waves in this
session, and multiple explicitly-required test categories (fuzzing,
injection execution, session/token live testing, migration clean-install,
"break the fix" mutation testing) not started. The code-level fixes for
findings A–S1 are real and, by STATIC/INTEGRATION-tier evidence, appear
correct — but "appears correct on paper" is exactly the standard this
audit was told not to accept as a verdict.
