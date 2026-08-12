# app/manage/day

Business Day & Shift control — **built in Part 13**. Open/close the
trading day (3pm–3am), open/close each cashier's own shift, record cash
drops/pickups/paid-in/paid-out, and the closing report (real gross
profit, cash reconciliation) once the day is closed.

The actual enforcement — no order without an open day, none after it
closes, a closed day can never reopen — lives in `place_order()`
(Part 09) and `open_business_day()` (Part 13), not in this UI. This
screen only gives staff a way to trigger those RPCs; the database is
what actually stops a bad request regardless of what this page shows.

See `docs/business-day-and-shifts.md` for why per-shift cash-expense
attribution is still incomplete until Part 14 wires up `expenses.shift_id`.
