# Cup Shup POS — PRA Tax Engine & Compliance

**Depends on:** Part 03 (schema), Part 04 (RLS)
**Code delivered in this part:** `supabase/migrations/0002_tax_functions.sql`, tax rows in `supabase/migrations/0004_seed.sql`
**Still outstanding (real-world, not code):** PRA registration, PRA eIMS integration vendor

---

## 1. The rates were wrong — this is the single most important fix

| Payment method | Old prototype charged | Correct PRA rate |
|---|---|---|
| Cash | 18% | **16%** |
| Card | 8% | 8% ✅ (already correct) |
| JazzCash | 18% | **8%** |
| EasyPaisa | 18% | **8%** |
| QR / Raast | — (not handled) | **8%** |

Under the **Punjab Finance Act 2026**, the reduced digital rate moved from 5% to **8%**, effective **1 July 2026**. It applies to *every* non-cash rail — debit card, credit card, mobile wallet, and QR — which is why JazzCash and EasyPaisa belong at 8%, not 16%. Everything else (cash, and anything not on the digital list) is taxed at the standard **16%**.

**What this means in plain terms:** the old prototype was overcharging cash customers by 2 percentage points and wallet customers by a full 10 percentage points. That's not a rounding error — it's money that shouldn't have been collected.

---

## 2. Why tax rates live in the database, not in code

```sql
create table tax_rates (
  class          tax_class,      -- 'cash' or 'digital'
  rate_bp        int,            -- basis points: 1600 = 16.00%
  effective_from date,
  effective_to   date,           -- null = the current rate
  notification_ref text          -- which Finance Act / SRO set this rate
);
```

> **What's a basis point?** 1 basis point (bp) = 0.01%. So 1600 bp = 16.00% and 800 bp = 8.00%. Storing tax as an integer number of basis points avoids the same float-rounding problem covered in `docs/architecture.md` — `16%` as a decimal can drift after enough multiplications; `1600` as an integer never does.

**The reason this is a table, not a constant in the code:** the Finance Act changes this rate roughly every year. If the rate were hardcoded, every rate change would need a code deploy — and worse, every *old* invoice would silently get recalculated at the *new* rate the next time anyone looked at it, which is factually wrong (a receipt from March should always show March's tax, forever).

Instead, a rate change is just a new row: close the old row (`effective_to = '2027-07-01'`) and insert a new one starting that date. `tax_rate_bp(class, date)` — the lookup function below — always finds whichever row was active on the date being asked about, so historical invoices never move.

```sql
-- supabase/migrations/0002_tax_functions.sql
create or replace function tax_rate_bp(p_class tax_class, p_on date default current_date)
returns int language sql stable as $$
  select rate_bp from tax_rates
  where class = p_class
    and effective_from <= p_on
    and (effective_to is null or effective_to > p_on)
  order by effective_from desc
  limit 1;
$$;
```

`class_of_method(payment_method)` maps a payment method straight to `'cash'` or `'digital'`, so nowhere in the app does a developer ever have to write "if JazzCash or EasyPaisa, use 8%" by hand — that mapping lives in the `payment_method_tax_class` table too, seeded in `0004_seed.sql`:

```sql
insert into payment_method_tax_class (method, class) values
  ('cash','cash'), ('card','digital'), ('jazzcash','digital'),
  ('easypaisa','digital'), ('qr','digital'), ('foodpanda','digital');
```

The seed also keeps the **old 5% digital rate** as a closed-out history row (`effective_from '2020-01-01'`, `effective_to '2026-07-01'`) — proof that the "rate change = new row, never edit history" pattern works from day one.

---

## 3. A note for your accountant

The 8% digital-payment tax is typically **deducted by the bank or payment processor at settlement time** and sent directly to the government — it never lands in the restaurant's bank account as collectible revenue the way cash tax does. Because of this, **no input tax adjustment is available** on that portion. It gets booked differently in your accounts than cash-collected tax does.

Don't assume "we collect it and file it ourselves" for digital payments — **confirm the exact accounting treatment with your PRA-registered consultant** before your first tax filing under the new rates.

---

## 4. PRA eIMS — what it is and why it's mandatory

**PRA** is the Punjab Revenue Authority. **eIMS** (electronic Invoice Monitoring System, also referred to as RIMS in some PRA material) is the system restaurants, cafes, and coffee shops in Punjab must transmit every sale to, in real time. PRA has recently banned handwritten receipts entirely — every sale needs a system-generated, PRA-recognised invoice.

Two concrete requirements fall out of this:

1. **Every invoice must carry a QR code** that a customer can scan with the PRA Tax App to verify the sale was actually reported.
2. **Every invoice needs a PRA-issued fiscal invoice number** — a number *PRA's system* returns to you, not one your own software invents.

### What a compliant invoice needs that the old prototype didn't have

| PRA requirement | Old prototype |
|---|---|
| PRA fiscal invoice number | ❌ (used `"CS-" + Date.now()` tail) |
| QR code | ❌ |
| STRN / NTN | ❌ |
| Business address & phone | ❌ |
| Terminal / cashier ID on the invoice | ❌ |
| Sequential, gapless invoice numbering | ❌ — repeated every ~16 minutes |
| Real-time transmission to PRA | ❌ |

> **STRN** = Sales Tax Registration Number. **NTN** = National Tax Number. Both identify the business to tax authorities and must be printed on every invoice.

### The invoice layout — full field list (built in Part 19)

This document specifies the requirement; the actual printed receipt template is built in **Part 19 — Printing & PRA Invoice**. Every Cup Shup invoice must show:

- Business name, address, phone (`outlets.name/address/phone`)
- STRN and NTN (`outlets.strn`, `outlets.ntn`)
- PRA registration number (`outlets.pra_reg_no`)
- Terminal name and cashier name (`terminals.name`, `staff.name`)
- Sequential invoice number in `CS-YYYYMMDD-NNNN` format (see below)
- PRA fiscal invoice number, once returned by eIMS (`orders.pra_invoice_no`)
- A QR code area, populated from `orders.pra_qr_payload` once PRA returns it
- Itemised lines with quantity, unit price, and line total
- Subtotal, discount, service charge, tax (with the rate shown), and grand total
- Payment method(s) used, with the tax rate applied to each split

The schema (Part 03) already has every column this needs: `orders.pra_invoice_no`, `orders.pra_qr_payload`, `orders.pra_synced_at`, and the outlet/terminal/staff fields above. Part 19 wires these into an actual ESC/POS thermal-printer template.

### Your own invoice number was also a bug, independent of PRA

```js
"CS-" + String(order.ts).slice(-6)
```

The last 6 digits of a millisecond timestamp repeat roughly every 1000 seconds (~16 minutes) — meaning a single busy shift produced duplicate invoice numbers. `next_invoice_no()` (in `0002_tax_functions.sql`) replaces this with a real per-outlet, per-day sequence backed by a database row (`invoice_counters`), producing gapless numbers like `CS-20260812-0001`, `CS-20260812-0002`, ...:

```sql
create or replace function next_invoice_no(p_outlet uuid, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare n bigint; pfx text;
begin
  insert into invoice_counters (outlet_id, business_date, last_no) values (p_outlet, p_date, 1)
  on conflict (outlet_id, business_date)
    do update set last_no = invoice_counters.last_no + 1
  returning last_no into n;
  select invoice_prefix into pfx from outlets where id = p_outlet;
  return pfx || '-' || to_char(p_date, 'YYYYMMDD') || '-' || lpad(n::text, 4, '0');
end $$;
```

---

## 5. Order flow with PRA in the loop

Getting a fiscal invoice number **isn't an add-on feature bolted on later** — it changes the shape of the settle step, because that number has to come from PRA before the receipt can be printed as PRA-compliant:

```
Cashier taps "Settle"
        │
        ▼
settle_order() runs in Postgres:
  - locks the order
  - looks up tax_rate_bp() per payment split
  - writes payments, computes total_paisa
  - calls next_invoice_no() for the LOCAL sequential number
        │
        ▼
Edge Function transmits the settled order to PRA eIMS
        │
        ├─── PRA responds immediately ───────────────┐
        │    (fiscal number + QR payload returned)    │
        │                                              ▼
        │                            orders.pra_invoice_no,
        │                            pra_qr_payload, pra_synced_at
        │                            written back
        │                                              │
        └─── PRA unreachable / times out ──────────┐   │
             (see Section 6 — offline handling)      │   │
                                                       ▼   ▼
                                              Receipt prints:
                                       local invoice_no always,
                                    PRA number + QR if available,
                                  "pending PRA sync" note if not yet
```

The **local** `invoice_no` (from `next_invoice_no()`) always exists the instant the order settles — the cashier is never blocked waiting on PRA to hand back a real-time response before printing something. The **PRA** fiscal number and QR populate onto the order asynchronously, whether that takes 200ms or, on a bad connection, several minutes.

## 6. What happens when the internet is down

This is a designed behaviour, not a fallback bolted on afterward:

1. The order settles locally and prints with its local sequential invoice number regardless of connectivity — service never stops because PRA is unreachable.
2. The transmission to PRA is queued (this queue is built in Part 20 — Offline, Testing & Deployment, alongside the rest of the app's offline handling).
3. Once connectivity returns, queued orders are sent to PRA in the order they were created, and `pra_invoice_no` / `pra_qr_payload` / `pra_synced_at` get filled in retroactively.
4. A reconciliation view (built alongside Part 19/20) flags any settled order whose `pra_synced_at` is still null after some threshold, so staff can follow up rather than silently losing track of an unsynced sale.

---

## 7. PRA registration — the steps (start this now, separately from the code)

This is real-world paperwork, not something that gets built in this repository, and PRA has said it can take longer than the software does. The rough sequence:

1. **Register the business with PRA** for sales tax on services (restaurants/cafes fall under PRA's services tax net). This produces the STRN that goes on every invoice.
2. **Confirm your NTN** with FBR is current and linked correctly — PRA registration typically references it.
3. **Apply for eIMS/RIMS integration access.** PRA either provides an API directly or requires going through a PRA-approved integration vendor (this is also listed as its own pending item in `PROGRESS.md` — "PRA-registered eIMS integration vendor se baat").
4. **Get sandbox/test credentials** from PRA or the vendor before going live, so Part 19's Edge Function can be built and tested against something real before the first live transaction.
5. **Confirm the accounting treatment** for digital-payment tax settlement (Section 3 above) with a PRA-registered tax consultant before the new rates go live.

None of this blocks continuing the software build — Parts 06 onward don't require live PRA credentials — but it has its own lead time, so it should run in parallel starting now, exactly as `PROGRESS.md` already flags it.

---

## 8. Acceptance Criteria — This Part

- [x] `tax_rates` table exists (Part 03), seeded with 16% cash + 8% digital from 2026-07-01 (`0004_seed.sql`)
- [x] The old 5% digital rate kept as a closed history row
- [x] `payment_method_tax_class` maps JazzCash, EasyPaisa, and QR to `digital`
- [x] `tax_rate_bp(class, date)` function built (`0002_tax_functions.sql`)
- [x] No hardcoded `0.18` or `0.08` anywhere in the codebase
- [x] `next_invoice_no()` produces sequential numbers in `CS-YYYYMMDD-NNNN` format
- [x] Required invoice fields specified (STRN, NTN, address, phone, terminal, cashier) — actual layout built in Part 19
- [x] QR code placement specified in the invoice field list above — actual rendering built in Part 19
- [x] `docs/pra-compliance.md` written
- [ ] **PRA registration process started** — real-world step, needs you; see Section 7

**Next part:** `06-money-and-calculation-rules.md`
