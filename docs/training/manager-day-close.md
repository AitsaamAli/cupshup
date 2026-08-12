# Manager: Opening & Closing the Day — Cup Shup POS

## Opening

1. `/manage/day`, enter the opening cash float, **Open Day**.
2. No orders can be taken before the day is opened — this is enforced
   by the system itself, not just a reminder.

## During the day

- Each cashier opens their own shift (their own float) when they start,
  closes it when they hand off the register.
- Cash drops/pickups/paid-outs are logged from the same screen — every
  rupee that leaves or enters the drawer outside a sale should be
  recorded here, not just remembered.

## Closing

1. Count the physical cash in the drawer.
2. `/manage/day` → **Close Day**, enter the counted amount.
3. The system shows **expected vs. counted** — a mismatch (variance) is
   normal within a small amount; anything larger is worth asking the
   cashier about before the day fully closes.
4. The closing report — revenue, real cost of goods, real gross profit
   (not a guessed percentage), expenses, net profit, cash variance —
   prints automatically. Keep it.

## What "real" means here

Every profit number on this report comes from the actual recipe cost of
what was sold that day, not an estimate. If gross profit ever looks
wrong, the first place to check is whether a recipe (`/manage/inventory/
recipes`) or an ingredient cost (`/manage/purchases`) needs updating —
the math itself doesn't guess.
