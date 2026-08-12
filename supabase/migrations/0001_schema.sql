-- =====================================================================
-- Cup Shup POS — 0001 Core Schema
-- Postgres / Supabase.  All money is BIGINT paisa (Rs 599.00 = 59900).
-- Never float. Never client timestamps.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type staff_role       as enum ('owner','manager','supervisor','cashier','chef','kitchen','barista');
create type order_type       as enum ('dine_in','takeaway','delivery');
create type order_status     as enum ('open','sent_to_kitchen','ready','served','settled','voided');
create type order_item_status as enum ('pending','preparing','ready','served','voided');
create type payment_method   as enum ('cash','card','jazzcash','easypaisa','qr','foodpanda');
create type tax_class        as enum ('cash','digital');
create type day_status       as enum ('open','closed','locked');
create type movement_type    as enum ('purchase','sale_depletion','wastage','staff_meal','count_adjustment','transfer','void_return');
create type accrual_type     as enum ('immediate','monthly','annual');
create type cash_movement_type as enum ('float_in','drop','pickup','paid_out','paid_in');

-- ---------------------------------------------------------------------
-- OUTLETS / STAFF / TERMINALS
-- ---------------------------------------------------------------------
create table outlets (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  address         text,
  phone           text,
  ntn             text,
  strn            text,
  pra_reg_no      text,
  timezone        text not null default 'Asia/Karachi',
  day_start_hour  int  not null default 15,          -- 3pm–3am trading day
  invoice_prefix  text not null default 'CS',
  created_at      timestamptz not null default now()
);

create table staff (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users(id) on delete set null,
  outlet_id   uuid not null references outlets(id) on delete cascade,
  code        text not null,
  name        text not null,
  role        staff_role not null,
  pin_hash    text,                                   -- bcrypt; NEVER plaintext
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (outlet_id, code)
);
create index on staff (user_id);

create table terminals (
  id            uuid primary key default gen_random_uuid(),
  outlet_id     uuid not null references outlets(id) on delete cascade,
  name          text not null,
  printer_config jsonb not null default '{}'::jsonb,
  active        boolean not null default true
);

-- ---------------------------------------------------------------------
-- TAX  (rates live in data, not in code — Finance Act changes yearly)
-- ---------------------------------------------------------------------
create table tax_rates (
  id               uuid primary key default gen_random_uuid(),
  authority        text not null default 'PRA',
  class            tax_class not null,
  rate_bp          int  not null check (rate_bp between 0 and 10000),  -- basis points
  effective_from   date not null,
  effective_to     date,
  notification_ref text,
  constraint tax_rate_period check (effective_to is null or effective_to > effective_from)
);
create unique index tax_rates_current on tax_rates (class) where effective_to is null;

-- Payment method -> tax class mapping (digital = 8%, cash = 16%)
create table payment_method_tax_class (
  method  payment_method primary key,
  class   tax_class not null
);

-- ---------------------------------------------------------------------
-- MENU
-- ---------------------------------------------------------------------
create table menu_categories (
  id         uuid primary key default gen_random_uuid(),
  outlet_id  uuid not null references outlets(id) on delete cascade,
  name       text not null,
  sort_order int  not null default 0,
  color      text,
  image_url  text,
  active     boolean not null default true,
  unique (outlet_id, name)
);

create table menu_items (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references menu_categories(id) on delete restrict,
  name         text not null,
  sku          text,
  sort_order   int not null default 0,
  active       boolean not null default true,
  is_86        boolean not null default false,        -- temporarily out of stock
  price_unconfirmed boolean not null default false,   -- your `flagged` items
  image_url    text,
  created_at   timestamptz not null default now()
);
create index on menu_items (category_id);

-- Price history: an old invoice must keep the price that was valid that day
create table menu_item_prices (
  id             uuid primary key default gen_random_uuid(),
  menu_item_id   uuid not null references menu_items(id) on delete cascade,
  price_paisa    bigint not null check (price_paisa >= 0),
  effective_from date not null default current_date,
  effective_to   date,
  constraint price_period check (effective_to is null or effective_to > effective_from)
);
create unique index menu_item_price_current on menu_item_prices (menu_item_id) where effective_to is null;

create table modifier_groups (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null references outlets(id) on delete cascade,
  name        text not null,
  min_select  int not null default 0,
  max_select  int not null default 1
);
create table modifiers (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references modifier_groups(id) on delete cascade,
  name              text not null,
  price_delta_paisa bigint not null default 0
);
create table menu_item_modifier_groups (
  menu_item_id uuid references menu_items(id) on delete cascade,
  group_id     uuid references modifier_groups(id) on delete cascade,
  primary key (menu_item_id, group_id)
);

-- ---------------------------------------------------------------------
-- INVENTORY  (append-only ledger — current stock is a SUM, never a column)
-- ---------------------------------------------------------------------
create table ingredients (
  id                    uuid primary key default gen_random_uuid(),
  outlet_id             uuid not null references outlets(id) on delete cascade,
  name                  text not null,
  unit                  text not null,                 -- kg | L | pcs | g | ml
  min_stock             numeric(12,3) not null default 0,
  moving_avg_cost_paisa bigint not null default 0,
  active                boolean not null default true,
  unique (outlet_id, name)
);

create table recipe_lines (
  menu_item_id  uuid references menu_items(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete restrict,
  qty           numeric(12,4) not null check (qty > 0),
  primary key (menu_item_id, ingredient_id)
);

create table suppliers (
  id        uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  name      text not null,
  phone     text,
  terms     text
);

create table stock_movements (
  id              uuid primary key default gen_random_uuid(),
  outlet_id       uuid not null references outlets(id) on delete cascade,
  ingredient_id   uuid not null references ingredients(id) on delete restrict,
  movement_type   movement_type not null,
  qty             numeric(12,4) not null,               -- signed: + in, - out
  unit_cost_paisa bigint,
  reference_type  text,
  reference_id    uuid,
  reason          text,
  performed_by    uuid references staff(id),
  created_at      timestamptz not null default now()
);
create index on stock_movements (ingredient_id, created_at desc);
create index on stock_movements (reference_type, reference_id);

create view ingredient_stock as
select i.id, i.outlet_id, i.name, i.unit, i.min_stock, i.moving_avg_cost_paisa,
       coalesce(sum(m.qty), 0)::numeric(14,4) as current_stock,
       (coalesce(sum(m.qty), 0) <= i.min_stock) as is_low
from ingredients i
left join stock_movements m on m.ingredient_id = i.id
where i.active
group by i.id;

-- ---------------------------------------------------------------------
-- TRADING DAY / SHIFTS / TABLES
-- ---------------------------------------------------------------------
create table business_days (
  id             uuid primary key default gen_random_uuid(),
  outlet_id      uuid not null references outlets(id) on delete cascade,
  business_date  date not null,
  status         day_status not null default 'open',
  opened_by      uuid references staff(id),
  opened_at      timestamptz not null default now(),
  closed_by      uuid references staff(id),
  closed_at      timestamptz,
  closing_snapshot jsonb,
  unique (outlet_id, business_date)
);

create table shifts (
  id                  uuid primary key default gen_random_uuid(),
  business_day_id     uuid not null references business_days(id) on delete cascade,
  cashier_id          uuid not null references staff(id),
  terminal_id         uuid references terminals(id),
  opened_at           timestamptz not null default now(),
  opening_float_paisa bigint not null default 0,
  closed_at           timestamptz,
  counted_cash_paisa  bigint,
  expected_cash_paisa bigint,
  variance_paisa      bigint
);
create index on shifts (business_day_id);

create table dining_tables (
  id        uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  label     text not null,
  seats     int,
  zone      text,
  unique (outlet_id, label)
);

create table customers (
  id             uuid primary key default gen_random_uuid(),
  outlet_id      uuid not null references outlets(id) on delete cascade,
  phone          text not null,
  name           text,
  address        text,
  notes          text,
  loyalty_points int not null default 0,
  created_at     timestamptz not null default now(),
  unique (outlet_id, phone)
);

-- ---------------------------------------------------------------------
-- ORDERS  (immutable once settled — corrections are reversals)
-- ---------------------------------------------------------------------
create table orders (
  id                   uuid primary key default gen_random_uuid(),
  outlet_id            uuid not null references outlets(id) on delete restrict,
  business_day_id      uuid not null references business_days(id) on delete restrict,
  shift_id             uuid references shifts(id),
  table_id             uuid references dining_tables(id),
  customer_id          uuid references customers(id),

  order_no             bigint not null,                -- per outlet, sequential
  invoice_no           text,                           -- assigned at settlement
  pra_invoice_no       text,                           -- fiscal number FROM PRA eIMS
  pra_qr_payload       text,
  pra_synced_at        timestamptz,

  order_type           order_type not null,
  status               order_status not null default 'open',

  subtotal_paisa       bigint not null default 0,
  discount_paisa       bigint not null default 0,
  service_charge_paisa bigint not null default 0,
  delivery_fee_paisa   bigint not null default 0,
  tax_paisa            bigint not null default 0,
  total_paisa          bigint not null default 0,
  cogs_paisa           bigint not null default 0,

  idempotency_key      text not null,
  note                 text,
  created_by           uuid references staff(id),
  created_at           timestamptz not null default now(),
  settled_at           timestamptz,

  unique (outlet_id, idempotency_key),
  unique (outlet_id, order_no),
  constraint totals_nonneg check (subtotal_paisa >= 0 and total_paisa >= 0)
);
create index on orders (business_day_id, created_at desc);
create index on orders (status) where status in ('open','sent_to_kitchen','ready');

create table order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  menu_item_id     uuid references menu_items(id),
  name_snapshot    text not null,
  qty              numeric(10,2) not null check (qty > 0),
  unit_price_paisa bigint not null check (unit_price_paisa >= 0),
  unit_cost_paisa  bigint not null default 0,          -- COGS snapshot at sale time
  modifiers        jsonb not null default '[]'::jsonb,
  line_total_paisa bigint not null,
  status           order_item_status not null default 'pending',
  note             text,
  created_at       timestamptz not null default now()
);
create index on order_items (order_id);

create table order_voids (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete restrict,
  order_item_id  uuid references order_items(id),      -- null = full order void
  reason_code    text not null,                        -- wrong_item|customer_cancel|kitchen_86|quality|training
  reason_note    text,
  authorised_by  uuid not null references staff(id),   -- manager/owner ONLY
  created_at     timestamptz not null default now()
);

create table payments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete restrict,
  method          payment_method not null,
  class           tax_class not null,
  base_paisa      bigint not null check (base_paisa >= 0),  -- pre-tax portion
  tax_rate_bp     int    not null,
  tax_paisa       bigint not null,
  amount_paisa    bigint not null,                          -- base + tax
  tendered_paisa  bigint,
  change_paisa    bigint,
  processor_ref   text,
  created_at      timestamptz not null default now()
);
create index on payments (order_id);

-- ---------------------------------------------------------------------
-- MONEY OUT
-- ---------------------------------------------------------------------
create table expense_categories (
  id           uuid primary key default gen_random_uuid(),
  outlet_id    uuid not null references outlets(id) on delete cascade,
  name         text not null,
  accrual_type accrual_type not null default 'immediate',
  color        text,
  unique (outlet_id, name)
);

create table expenses (
  id              uuid primary key default gen_random_uuid(),
  outlet_id       uuid not null references outlets(id) on delete cascade,
  business_day_id uuid references business_days(id),
  category_id     uuid not null references expense_categories(id),
  amount_paisa    bigint not null check (amount_paisa > 0),
  payment_method  payment_method not null default 'cash',   -- drawer only if cash
  vendor          text,
  note            text,
  receipt_url     text,
  period_start    date,                                     -- for amortised expenses
  period_end      date,
  created_by      uuid references staff(id),
  approved_by     uuid references staff(id),
  created_at      timestamptz not null default now()
);
create index on expenses (business_day_id);

create table cash_movements (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references shifts(id) on delete cascade,
  type         cash_movement_type not null,
  amount_paisa bigint not null check (amount_paisa > 0),
  reason       text,
  performed_by uuid references staff(id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- GOVERNANCE
-- ---------------------------------------------------------------------
create table audit_log (
  id          bigserial primary key,
  outlet_id   uuid,
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index on audit_log (entity_type, entity_id, created_at desc);

create table invoice_counters (
  outlet_id     uuid not null references outlets(id) on delete cascade,
  business_date date not null,
  last_no       bigint not null default 0,
  primary key (outlet_id, business_date)
);

create table order_counters (
  outlet_id uuid primary key references outlets(id) on delete cascade,
  last_no   bigint not null default 0
);
