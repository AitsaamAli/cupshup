-- =====================================================================
-- Cup Shup POS — Patch 1: Khata/Credit (House Accounts) — schema
-- =====================================================================
-- restaurant-system-master-prompt.md §4.5: "koi bhi bill creation ya
-- payment recording screen bina Khata/Credit option ke nahi honi
-- chahiye jahan applicable ho." Corporate/regular customers eat daily,
-- settle monthly — the settle screen currently has no way to defer
-- payment at all.
--
-- Split into two migrations on purpose (schema here, functions in
-- 0047): adding a new payment_method enum value and USING that value
-- (in a function body, or an INSERT) in the same transaction is a real
-- Postgres restriction, not a style preference — confirmed the hard way
-- earlier this session with 0044's index-expression IMMUTABLE error, so
-- this one is being sequenced correctly from the start instead of found
-- by a failed push.
--
-- Purely additive per the master prompt's §1 rule: no existing table,
-- column, or enum value is touched. payment_method gains ONE new value;
-- every existing value/row is untouched.
-- =====================================================================

alter type payment_method add value 'house_account';

-- ---------------------------------------------------------------------
-- house_accounts — one row per corporate/regular customer with a
-- standing credit arrangement. Linked to `customers` (optional — the
-- account can exist before/without a customer record) rather than
-- folded into it, since most customers are NOT house accounts and this
-- keeps the common case (walk-in, delivery customer) untouched.
-- ---------------------------------------------------------------------
create table house_accounts (
  id                  uuid primary key default gen_random_uuid(),
  outlet_id           uuid not null references outlets(id) on delete cascade,
  customer_id         uuid references customers(id) on delete set null,
  name                text not null,
  credit_limit_paisa  bigint not null default 0 check (credit_limit_paisa >= 0),
  billing_day         int not null default 1 check (billing_day between 1 and 28),
  active              boolean not null default true,
  created_by          uuid references staff(id),
  created_at          timestamptz not null default now()
);
create index on house_accounts (outlet_id);

-- ---------------------------------------------------------------------
-- house_account_charges — one row per order settled to an account.
-- Deliberately NOT just "sum payments where method = house_account" —
-- keeping this its own table (rather than deriving outstanding from
-- `payments` alone) means a statement/ledger view never has to guess
-- which house_account a house_account-method payment belonged to, and
-- keeps this feature's data model self-contained instead of overloading
-- the generic payments table with a foreign key it doesn't otherwise
-- need. payment_id is nullable only so a charge can never be blocked by
-- payments-table timing — set together, in the same transaction, by
-- settle_order() in 0047.
-- ---------------------------------------------------------------------
create table house_account_charges (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references house_accounts(id) on delete restrict,
  order_id       uuid not null references orders(id) on delete restrict,
  payment_id     uuid references payments(id) on delete restrict,
  amount_paisa   bigint not null check (amount_paisa > 0),
  created_at     timestamptz not null default now()
);
create index on house_account_charges (account_id);
create index on house_account_charges (order_id);

-- ---------------------------------------------------------------------
-- house_account_payments — money the customer pays back against their
-- running balance (the monthly settlement this whole feature exists
-- for). Separate from `payments` (which is always tied to one order) —
-- a house-account payment is typically one lump sum against many
-- orders' worth of charges, not attributable to any single order.
-- ---------------------------------------------------------------------
create table house_account_payments (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references house_accounts(id) on delete restrict,
  amount_paisa   bigint not null check (amount_paisa > 0),
  method         payment_method not null,
  note           text,
  received_by    uuid references staff(id),
  created_at     timestamptz not null default now()
);
create index on house_account_payments (account_id);

alter table house_accounts enable row level security;
alter table house_account_charges enable row level security;
alter table house_account_payments enable row level security;

-- Read-only policies, same shape as `suppliers`/`payments` — every write
-- goes through a SECURITY DEFINER RPC (0047) that does its own
-- permission + outlet-ownership check, not a table-level "manage"
-- policy. house_account_charges/payments have no outlet_id column of
-- their own, so their read policy joins through house_accounts, same
-- pattern read_payments already uses joining through orders.
create policy read_house_accounts on house_accounts for select
  using (outlet_id = my_outlet());

create policy read_house_account_charges on house_account_charges for select
  using (exists (
    select 1 from house_accounts ha where ha.id = account_id and ha.outlet_id = my_outlet()
  ));

create policy read_house_account_payments on house_account_payments for select
  using (exists (
    select 1 from house_accounts ha where ha.id = account_id and ha.outlet_id = my_outlet()
  ));
