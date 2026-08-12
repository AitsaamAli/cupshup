# Cup Shup POS — Go-Live Checklist

Part 20. Consolidates the brief's own checklist (§5) with what this
build has actually confirmed vs. what's still a real-world action item
— cross-referenced against `PROGRESS.md`'s own "Code se bahar ke kaam"
list, which has tracked several of these since Part 01.

## Compliance

- [ ] PRA registration complete
- [ ] eIMS integration tested and approved with a real PRA-registered
      vendor (`app/api/pra/submit/route.ts` is ready for one — Part 19)
- [ ] Tax rates confirmed current (16% cash / 8% digital — `tax_rates`
      table, Part 05; verify against that year's actual Finance Act)
- [ ] Invoice shows NTN, STRN, PRA reg — built and tested
      (`docs/printing-and-pra-invoice.md`); confirm `outlets.ntn`/`strn`/
      `pra_reg_no` hold the REAL registered values, not placeholders
- [ ] Reviewed by an actual tax/PRA consultant — nothing in this build
      substitutes for that review

## Data

- [ ] Full menu, real prices (`menu_items`/`menu_item_prices`)
- [ ] Every item's recipe (`recipe_lines`) — required for real COGS/
      margin (Part 09, Part 18) to mean anything
- [ ] Ingredient costs from real purchase invoices
      (`ingredients.moving_avg_cost_paisa`) — the seed data's starting
      figures (`0006_seed.sql`) are placeholders, not real costs
- [ ] Opening stock count (`record_stock_count()`, Part 11)
- [ ] Real staff accounts and PINs (no `E2E-`/`PGTAP-`/`pgTAP`-prefixed
      rows left over from testing — confirmed clean as of this session,
      re-check before launch since more testing may run before then)

## Technical

- [ ] All tests pass — `npm test` (168 unit), pgTAP
      (`supabase/tests/database/`, confirmed live this part),
      `npm run test:e2e` (written, not yet run — `docs/testing-strategy.md` §5)
- [ ] Backup configured **and a restore drill actually completed**
      (`docs/monitoring-and-backup.md` §3) — not just backups existing
- [ ] Offline mode tested with the internet genuinely turned off on a
      real device, not just `e2e/offline.spec.ts` — that spec is
      written but unexecuted (`docs/testing-strategy.md` §5)
- [ ] Printers tested against real hardware — `print-agent/` has never
      touched a physical thermal printer in this environment
      (`docs/printing-and-pra-invoice.md` §7)
- [ ] Sentry actually configured (`SENTRY_DSN` set) — currently inert
      by design (`docs/monitoring-and-backup.md` §1)
- [ ] Two weeks of load — real shifts, real order volume, before
      trusting this as the only system

## Training

- [ ] Cashier: keyboard shortcuts card — `docs/training/cashier-shortcuts.md`
- [ ] Kitchen: KDS guide — `docs/training/kds-guide.md`
- [ ] Manager: day-close guide — `docs/training/manager-day-close.md`
- [ ] Everyone: what to do when the internet drops —
      `docs/training/offline-runbook.md`
- [ ] Owner: Master P&L and Menu Engineering Matrix walkthrough —
      `docs/reports-and-pl.md` is the technical reference; someone
      should walk the actual owner through the live screen at
      `/reports/pl` before day one, not hand them a document

## Launch plan

- [ ] **Week one: run the old system in parallel.** Every real sale
      recorded in both. This is the single most important risk-reducer
      in the whole checklist — a bug this build's own testing didn't
      catch shows up as a mismatch against the old system's total, not
      as a customer being wrong-charged with no one noticing.
- [ ] Daily totals reconciled between both systems, every day of that
      week — not just spot-checked once
- [ ] A developer physically present (or immediately reachable) for the
      first three real business days
- [ ] Only after that week: retire the old system — never in one day,
      per the brief's own explicit warning (§6)
