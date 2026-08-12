# Cup Shup POS — Requirements Document

**Business:** Cup Shup, a cafe in Johar Town, Lahore, Pakistan
**Operating hours:** 3:00 PM to 3:00 AM, every day
**Purpose of this document:** This is the single source of truth for what the Cup Shup Point-of-Sale (POS) system must do. Every later build part (database, backend, frontend) must follow the rules written here. If a rule is not written here, it has not been decided yet — nobody should "just build it and see."

> **What is a POS?** POS stands for Point of Sale — the system a cashier uses to take an order, calculate the bill, and take payment. In this project, "POS" also refers to the whole software suite (ordering, kitchen screen, inventory, reports), not just the cash register screen.

---

## 1. Modules

The system is made of 8 modules. A module is a self-contained area of the app built for one job and (usually) one group of users.

### 1.1 POS Terminal
Used by: **Cashier / Order Taker**
This is the main order-taking screen. The cashier picks menu items, adds modifiers (e.g. "extra shot", "no sugar"), assigns the order to a table or marks it takeaway/delivery, and takes payment (cash, card, JazzCash, EasyPaisa, QR, or Foodpanda). It is the busiest screen in the building and must work even if the internet briefly drops.

### 1.2 Kitchen Display (KDS)
Used by: **Chef, Kitchen Staff, Tea Maker (Barista)**
KDS stands for Kitchen Display System — a screen in the kitchen that shows incoming orders the moment the cashier sends them, instead of printed paper tickets. Kitchen staff move each item through statuses (pending → preparing → ready → served) so the cashier and customer know progress in real time.

### 1.3 Inventory
Used by: **Manager, Chef** (Kitchen Staff and Barista get limited access — see Section 2)
Tracks how much of each raw ingredient (flour, milk, coffee beans, cups, etc.) the cafe has on hand. Stock goes down automatically when a recipe-linked item is sold, and can be adjusted for deliveries, wastage (spoiled or dropped items), staff meals, or manual stock counts.

### 1.4 Business Day & Cash
Used by: **Manager, Supervisor**
Because Cup Shup trades from 3 PM to 3 AM (crossing midnight), the system uses a "business day" concept instead of the calendar date — see Section 3.1. This module lets a manager or supervisor open the day, open/close cashier shifts, record cash float and cash drops, and close the day with a final cash count.

### 1.5 Expenses
Used by: **Manager, Supervisor**
Records money spent running the cafe — rent, utilities, small purchases, repairs. Some expenses are one-time (immediate), and some are spread over months (amortised), e.g. paying for a fridge repair that benefits several months.

### 1.6 Dashboard
Used by: **Manager, Owner**
A live summary screen: today's sales, top-selling items, cash vs digital split, low-stock warnings. Meant for a quick daily health check, not deep financial analysis.

### 1.7 Master P&L
Used by: **Owner only**
P&L stands for Profit & Loss — a report of money earned minus money spent, including ingredient cost (COGS — Cost of Goods Sold) and expenses, to show true profit. This is the most sensitive report in the system (it reveals margins and true profitability) and is restricted to the Owner only.

### 1.8 Menu Management
Used by: **Owner, Manager**
Add, edit, or retire menu items and categories; set prices (with price history, so an old receipt always shows the price that was actually charged that day); set up modifiers (e.g. size, add-ons); mark items "86" (temporarily unavailable) without deleting them.

---

## 2. Roles & Permissions

Every staff member has exactly one role. A role decides what a person can see and do in each module. Four permission levels are used:

- **None** — module is completely hidden from this role.
- **Read** — can view data but not change it.
- **Write** — can create/update records within the module (e.g. take an order, log wastage).
- **Approve** — can authorise sensitive actions that a lower role is not allowed to do alone (e.g. approve a void, approve an expense).

| Role | POS | KDS | Inventory | Business Day & Cash | Expenses | Dashboard | Master P&L | Menu Management | Void Orders |
|---|---|---|---|---|---|---|---|---|---|
| **Owner** | Write | Write | Write | Approve | Approve | Read | Read | Write | Approve |
| **Manager** | Write | Write | Write | Approve | Approve | Read | None | Write | Approve |
| **Supervisor** | Write | Write | Write | Write | Write | Read | None | None | Approve |
| **Cashier** | Write | None | None | None | None | None | None | None | None |
| **Chef** | None | Write | Write | None | None | None | None | Write (86-flag only) | None |
| **Kitchen Staff** | None | Write | Write (wastage only) | None | None | None | None | None | None |
| **Barista / Tea** | None | Write | Write (wastage only) | None | None | None | None | None | None |

Notes on the table:

- **"86-flag only"** — the food-industry term for marking an item temporarily out of stock. Chef can hide an item from the POS this way, but cannot change its name or price. That stays Owner/Manager-only.
- **"Wastage only"** — Kitchen Staff and Barista can log spoiled/dropped/wasted ingredients, but cannot record deliveries, transfers, or stock counts. Those require Manager or Chef.
- **Void = Approve for every role that has it** — nobody can void an order by themselves without a second person's authorisation, even a Manager acting alone must record who authorised it (see Section 3.3).
- Cashier has **no access** to Inventory, Expenses, Dashboard, or P&L. A cashier's phone or login should never be able to open the Master P&L, even if they guess the URL — this must be enforced on the server, not just hidden in the interface.

---

## 3. Business Rules

These are the rules that were **missing or wrong** in the old prototype. They are non-negotiable — every backend part built after this document must implement them exactly as written here.

### 3.1 Trading Day

> **Why this matters:** Cup Shup is open 3 PM to 3 AM. A calendar day (midnight to midnight) does not match how the cafe actually trades — the old system used calendar-day logic and this caused late-night orders to be booked two days in the past.

- The trading day runs from **3:00 PM to 3:00 AM** (12 hours, crossing midnight).
- An order placed at 2:00 AM belongs to the **same business day** that started at 3:00 PM the previous calendar evening. Example: an order at 2 AM on Tuesday belongs to Monday's business day.
- No order can be created **before** a business day has been opened by a Manager/Supervisor.
- No order can be created **after** a business day has been closed.
- Once a business day is closed, **it cannot be reopened**. If a mistake is discovered afterward, it is fixed with an adjustment entry recorded against the *next* open business day — never by editing the closed one.
- All business-day math happens on the server using a fixed timezone (`Asia/Karachi`), never using the customer's or staff member's device clock.

### 3.2 Tax (Punjab, effective 1 July 2026)

> **Why this matters:** The old prototype charged 18% on both cash and digital payments. The correct Punjab rates from 1 July 2026 are lower and split by payment type. Overcharging customers is both a compliance risk and simply wrong.

- **Cash and other non-digital payments: 16%**
- **Card, JazzCash, EasyPaisa, QR code, and Raast payments: 8%**
- Tax is calculated and applied **at the moment of payment**, not when the order is first created. An order's total is not finalised as taxed until it is paid.
- If a bill is **split across multiple payment methods** (e.g. half cash, half card), each portion is taxed at its own applicable rate — there is no single blended tax rate for a mixed-payment order.
- Tax rates are stored as data (with an effective-from date), not hard-coded in the program, because Pakistani tax law changes through yearly Finance Acts.

### 3.3 Order Rules

> **Why this matters:** A financial record that can be silently edited or deleted cannot be trusted or audited. Every correction must leave a paper trail.

- Once an order is created, it can **never be edited or deleted**.
- To fix a mistake, the order (or a single item on it) is **voided** — this writes a new reversal record; it does not erase the original.
- A void requires **Manager (or higher) authorisation**. A Cashier alone cannot void anything.
- Every void must include a **reason** (selected from a fixed list, e.g. wrong item, customer cancelled, kitchen ran out of stock, quality issue, staff training) plus an optional free-text note.

### 3.4 Inventory Rules

> **Why this matters:** If "current stock" is a single number that gets overwritten, there is no way to trace how it got there or catch errors. A ledger (a running log of every change) can always be re-added to check the total, and shows the full history.

- The current stock level of an ingredient is **never stored as a single column value**. It is always calculated as the **sum of every stock movement** ever recorded for that ingredient (deliveries in, sales out, wastage out, adjustments, etc.).
- When an order is **settled** (paid for), the ingredients used in its recipe are **automatically deducted** from stock — no manual step needed.
- **Wastage** (spoiled, dropped, or expired stock) is recorded as its own separate movement type, kept clearly apart from stock that left through a sale.

### 3.5 Money Rules

> **Why this matters:** Computers can make small rounding mistakes when working with decimals (e.g. 599.00 stored as 598.9999999). In a cash register, even one paisa of drift, multiplied across thousands of transactions, becomes a real accounting problem.

- Every amount of money is stored as a **whole integer number of paisa** (the smallest unit of Pakistani currency — 100 paisa = Rs 1). Example: Rs 599.00 is stored as the integer `59900`.
- **Decimals or floating-point numbers are never used for money**, anywhere in the system — not in the database, not in calculations, not in the interface state.
- All money calculations (subtotals, tax, discounts, totals, change) happen **on the server**. The browser/app only displays numbers the server already calculated — it never computes a final total that gets trusted for payment.

---

## 4. User Stories & Acceptance Criteria

Each user story follows the format:
*"As a `<role>`, I want to `<do something>`, so that `<benefit>`."*

Every story includes acceptance criteria — a checklist that says exactly when that story is considered "done and correct."

### 4.1 POS Terminal

**Story 1.** As a Cashier, I want to log in with my staff PIN, so that the system knows who is taking each order.
- [ ] Login requires an outlet-specific staff code + PIN, not a shared password.
- [ ] A wrong PIN shows an error but never reveals whether the code exists.
- [ ] Successful login starts a session tied to that staff member and terminal.

**Story 2.** As a Cashier, I want to add menu items and modifiers to a new order, so that I can build a customer's bill accurately.
- [ ] Items can only be added while the business day is open.
- [ ] An item marked "86" (out of stock) cannot be added.
- [ ] Modifier rules (minimum/maximum selections) are enforced before the item can be added.

**Story 3.** As a Cashier, I want to assign an order to a table, or mark it takeaway/delivery, so that the kitchen and floor staff know where it's going.
- [ ] Order type (dine-in / takeaway / delivery) is required before sending to kitchen.
- [ ] Dine-in orders must reference a valid table.

**Story 4.** As a Cashier, I want to take payment by cash, card, JazzCash, EasyPaisa, QR, or Foodpanda, so that I can settle the order.
- [ ] The correct tax rate (16% cash-class or 8% digital-class) is applied per the payment method used.
- [ ] Split payments across multiple methods are supported, each taxed at its own rate.
- [ ] Order status becomes "settled" only after full payment is recorded.

**Story 5.** As a Cashier, I want the register to keep working if the internet briefly disconnects, so that I don't lose a sale during a busy rush.
- [ ] Orders taken offline are queued locally and synced once the connection returns.
- [ ] No order can be double-submitted after reconnecting (idempotency key prevents duplicates).

**Story 6.** As a Manager, I want to authorise a void on a Cashier's order, so that mistakes can be corrected without deleting financial records.
- [ ] Void requires Manager-or-higher login/approval, a reason code, and creates a reversal record.
- [ ] The original order remains visible and unmodified in order history.

### 4.2 Kitchen Display (KDS)

**Story 1.** As a Chef, I want to see new orders appear on the kitchen screen the instant they're sent, so that I can start preparing them without waiting for a printed ticket.
- [ ] New orders appear on KDS within a couple of seconds of being sent from POS (real-time, not manual refresh).
- [ ] Each ticket shows item, quantity, modifiers, and any note from the cashier.

**Story 2.** As Kitchen Staff, I want to mark an item as "preparing" then "ready", so that the cashier and front-of-house know its progress.
- [ ] Item status moves only forward (pending → preparing → ready → served), never backward by mistake.
- [ ] Status changes are timestamped and tied to the staff member who made them.

**Story 3.** As a Chef, I want to mark a menu item "86" (temporarily unavailable) directly from the kitchen, so that cashiers stop selling something we've run out of.
- [ ] Toggling 86 hides the item from POS immediately.
- [ ] Chef cannot change the item's price or name — only the 86 flag.

**Story 4.** As Kitchen Staff, I want to log wastage (e.g. a dropped or spoiled item), so that inventory reflects reality even when nothing was sold.
- [ ] Wastage entries require a reason and reduce ingredient stock via a `wastage` movement type.
- [ ] Wastage is visible separately from sale-based stock depletion in reports.

**Story 5.** As a Barista, I want to see only drink-related tickets (if the outlet chooses to split kitchen vs. bar tickets), so that I'm not distracted by food items.
- [ ] KDS can optionally filter/route tickets by station (kitchen vs. bar), configurable per outlet.

### 4.3 Inventory

**Story 1.** As a Manager, I want to see current stock levels for every ingredient, so that I know what needs reordering.
- [ ] Displayed stock is always calculated as the sum of that ingredient's movement ledger, never read from a stored counter.
- [ ] Ingredients below their minimum stock threshold are flagged as low stock.

**Story 2.** As a Chef, I want ingredient stock to automatically decrease when a recipe-linked item is sold, so that I don't have to manually update counts all day.
- [ ] Settling an order creates one stock movement per recipe ingredient, sized by recipe quantity × items sold.
- [ ] This deduction happens exactly once per settled order (no double-deduction on retries).

**Story 3.** As a Manager, I want to record a delivery from a supplier, so that stock increases with an accurate cost.
- [ ] A delivery creates a `purchase` movement with quantity and unit cost, linked to a supplier.
- [ ] Ingredient moving-average cost updates based on the new delivery.

**Story 4.** As a Manager, I want to do a manual stock count and adjust for discrepancies, so that recorded stock matches what's physically on the shelf.
- [ ] A `count_adjustment` movement is created showing the difference between system stock and counted stock.
- [ ] The adjustment requires a note explaining the discrepancy.

**Story 5.** As Kitchen Staff or Barista, I want to log a wasted or spoiled ingredient, so that shrinkage is tracked honestly instead of silently disappearing from stock.
- [ ] Only a `wastage` movement type is available to these roles — no purchase, transfer, or count-adjustment access.

### 4.4 Business Day & Cash

**Story 1.** As a Manager, I want to open the business day before the cafe starts trading, so that cashiers can begin taking orders.
- [ ] Opening a day requires Manager/Supervisor role and records who opened it and when.
- [ ] No order can be created for an outlet with no open business day.

**Story 2.** As a Cashier, I want to open my shift with a starting cash float, so that end-of-shift cash counting has a correct baseline.
- [ ] Shift open records the opening float amount and links to the current open business day.

**Story 3.** As a Supervisor, I want to record a cash drop (removing cash from the drawer for safekeeping) during a shift, so that the drawer doesn't accumulate too much cash.
- [ ] Cash drops/pickups/paid-outs are recorded as typed cash movements tied to a shift.

**Story 4.** As a Cashier, I want to close my shift by counting the physical cash in the drawer, so that any variance from the expected amount is caught immediately.
- [ ] Shift close compares counted cash to expected cash (float + cash sales − drops) and records the variance.

**Story 5.** As a Manager, I want to close the business day at the end of trading, so that no further orders can be created against it.
- [ ] Day close requires all shifts within it to be closed first.
- [ ] Once closed, the business day's status becomes locked and cannot be reopened.

**Story 6.** As a Manager, I want to make an adjustment entry for a mistake discovered after a day was closed, so that the closed day's records stay untouched while the error is still corrected.
- [ ] Adjustments are always dated to the current (open) business day, never backdated into a closed one.

### 4.5 Expenses

**Story 1.** As a Manager, I want to log an expense with a category and amount, so that daily spending is tracked.
- [ ] Expense requires a category, amount (positive integer paisa), and payment method.
- [ ] Cash expenses are linked to the current shift's cash drawer for reconciliation.

**Story 2.** As a Supervisor, I want to attach a receipt photo to an expense, so that there's proof of the spend.
- [ ] Expenses support an optional receipt image URL.

**Story 3.** As a Manager, I want to mark some expenses as "amortised" over a period (e.g. an annual license fee), so that monthly P&L reflects a fair share of the cost instead of one big spike.
- [ ] Amortised expenses store a period start and end date.
- [ ] P&L reporting (Part 18) spreads the cost evenly across that period.

**Story 4.** As a Manager, I want an expense above a certain amount to require Owner or Manager approval, so that large or unusual spending doesn't happen unnoticed.
- [ ] Expenses have an `approved_by` field; the exact approval threshold is configured by the Owner.

**Story 5.** As an Owner, I want to see all expenses filtered by category and date range, so that I can review spending patterns.
- [ ] Expense list supports filtering by category, business day, and payment method.

### 4.6 Dashboard

**Story 1.** As a Manager, I want to see today's total sales and order count at a glance, so that I know how business is doing without digging through reports.
- [ ] Dashboard shows live totals for the current open business day, updating as orders settle.

**Story 2.** As an Owner, I want to see the cash vs. digital payment split for today, so that I can sanity-check the drawer count against digital settlements.
- [ ] Dashboard breaks down settled payments by method and by tax class (cash 16% vs digital 8%).

**Story 3.** As a Manager, I want to see the top-selling items for the day or week, so that I know what to prep more of.
- [ ] Dashboard ranks menu items by quantity sold over a selectable date range.

**Story 4.** As a Manager, I want to see low-stock ingredient warnings on the dashboard, so that I can reorder before running out mid-shift.
- [ ] Dashboard surfaces ingredients where current computed stock is at or below their minimum threshold.

**Story 5.** As an Owner, I want the Dashboard to exclude profit-margin and COGS details (that belongs only in Master P&L), so that day-to-day managers see operational data without seeing true profitability.
- [ ] Dashboard shows revenue and counts, never cost-of-goods or net-profit figures.

### 4.7 Master P&L

**Story 1.** As an Owner, I want to see total revenue, total COGS, total expenses, and net profit for a chosen date range, so that I know the cafe's real profitability.
- [ ] COGS is calculated from `unit_cost_paisa` snapshots recorded on each order item at time of sale, not current ingredient cost.
- [ ] Report is only accessible to the Owner role — verified on the server, not just hidden in the UI.

**Story 2.** As an Owner, I want P&L broken down by business day, so that I can compare day-to-day performance.
- [ ] Each business day in range shows its own revenue, COGS, expenses, and net profit subtotal.

**Story 3.** As an Owner, I want amortised expenses spread correctly across their period in the P&L, so that one big annual bill doesn't distort a single day's numbers.
- [ ] Amortised expense amount-per-day = total amount ÷ number of days in its period.

**Story 4.** As an Owner, I want to see gross margin percentage per menu item, so that I can identify which items are actually profitable.
- [ ] Margin = (item revenue − item COGS) ÷ item revenue, shown per menu item over the selected range.

**Story 5.** As an Owner, I want voided orders excluded from revenue and COGS in the P&L, so that cancelled sales don't inflate the numbers.
- [ ] Voided orders/items contribute zero to revenue, COGS, and tax totals in every P&L calculation.

### 4.8 Menu Management

**Story 1.** As a Manager, I want to add a new menu item with a category, price, and recipe, so that it becomes sellable on the POS.
- [ ] New item requires a category, at least one price entry, and (if it depletes stock) a recipe of ingredients + quantities.

**Story 2.** As an Owner, I want to change a menu item's price and have old orders keep showing the price that was actually charged, so that historical receipts stay accurate.
- [ ] Changing a price closes the current `menu_item_prices` row (sets `effective_to`) and opens a new one — it never overwrites the old price.

**Story 3.** As a Manager, I want to set up a modifier group (e.g. "Size: Small/Medium/Large") with minimum/maximum selection rules, so that the POS enforces valid combinations.
- [ ] Modifier groups define min/max select; POS blocks adding an item if the modifier selection violates those rules.

**Story 4.** As a Chef, I want to mark an item "86" without needing Manager approval, so that we can react instantly when we run out mid-shift.
- [ ] The 86 toggle is available to Chef role but restricted from changing any other menu field.

**Story 5.** As an Owner, I want to retire (deactivate) an old menu item without deleting it, so that historical orders referencing it still display correctly.
- [ ] Deactivating a menu item hides it from POS but keeps it (and its price history) intact in the database.

---

## 5. Glossary (plain-English explanations)

- **POS (Point of Sale):** the till/register system used to take orders and payment.
- **KDS (Kitchen Display System):** a screen replacing paper kitchen tickets, updated in real time.
- **RLS (Row Level Security):** a database feature (used starting Part 04) that enforces *who can see which rows* directly in the database, so a broken frontend can't accidentally leak data.
- **Business day:** Cup Shup's trading day, running 3 PM–3 AM, as opposed to a calendar day (midnight–midnight).
- **Ledger:** a running, append-only log of every change to a value (e.g. stock), so the current value is always the sum of history rather than a single overwritten number.
- **COGS (Cost of Goods Sold):** how much it actually cost in ingredients to make what was sold.
- **P&L (Profit & Loss):** revenue minus COGS minus expenses — the real profit report.
- **Void:** cancelling an order or item by writing a reversal record, never by deleting the original.
- **86 (eighty-six):** restaurant-industry term for marking an item temporarily unavailable.
- **Paisa:** the smallest unit of Pakistani Rupee; 100 paisa = Rs 1. All money in this system is stored as a whole number of paisa, never as a decimal Rupee amount.
- **Idempotency key:** a unique token attached to an action (like submitting an order) so that if it's accidentally sent twice (e.g. due to a network retry), the system only processes it once.

---

## 6. Acceptance Criteria — This Document

- [x] `docs/requirements.md` file created
- [x] All 8 modules defined
- [x] Role permission table written
- [x] Trading day rules written
- [x] Tax rules written (16% / 8%)
- [x] Order immutability and void rule written
- [x] Inventory ledger rule written
- [x] Money = paisa integer rule written

**Next part:** `02-architecture-and-stack.md`
