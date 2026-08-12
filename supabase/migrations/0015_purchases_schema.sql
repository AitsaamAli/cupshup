-- =====================================================================
-- Cup Shup POS — Purchases & Suppliers: schema
-- Part 12. Not in the reference file — purchases/purchase_lines/
-- purchase_returns don't exist in 0001_schema.sql, and this part's own
-- brief specifies their shape directly. suppliers itself already
-- existed (Part 03); this adds an `active` flag so a supplier can be
-- retired the same way a menu item is (never deleted, Part 08's rule).
-- =====================================================================

alter table suppliers add column if not exists active boolean not null default true;

-- ---------------------------------------------------------------------
-- GRN header. Immutable once created — corrections are a
-- purchase_returns row (Section below), never an edit or delete, same
-- append-only pattern as orders (Part 09).
-- ---------------------------------------------------------------------
create table purchases (
  id                 uuid primary key default gen_random_uuid(),
  outlet_id          uuid not null references outlets(id) on delete restrict,
  supplier_id        uuid not null references suppliers(id) on delete restrict,
  business_day_id    uuid references business_days(id),
  invoice_ref        text,
  invoice_photo_url  text,
  total_paisa        bigint not null default 0,
  payment_status     text not null default 'credit'
                        check (payment_status in ('paid','credit','partial')),
  amount_paid_paisa  bigint not null default 0,
  received_by        uuid references staff(id),
  note               text,
  created_at         timestamptz not null default now()
);
create index on purchases (outlet_id, created_at desc);
create index on purchases (supplier_id);

create table purchase_lines (
  id                uuid primary key default gen_random_uuid(),
  purchase_id       uuid not null references purchases(id) on delete restrict,
  ingredient_id     uuid not null references ingredients(id) on delete restrict,
  qty               numeric(12,4) not null check (qty > 0),
  unit_cost_paisa   bigint not null check (unit_cost_paisa >= 0),
  line_total_paisa  bigint not null
);
create index on purchase_lines (purchase_id);
create index on purchase_lines (ingredient_id);

-- ---------------------------------------------------------------------
-- Purchase returns / credit notes — "kharab maal wapas" without ever
-- deleting the original GRN. Each row is its own reversal record.
-- ---------------------------------------------------------------------
create table purchase_returns (
  id               uuid primary key default gen_random_uuid(),
  purchase_id      uuid not null references purchases(id) on delete restrict,
  ingredient_id    uuid not null references ingredients(id) on delete restrict,
  qty              numeric(12,4) not null check (qty > 0),
  unit_cost_paisa  bigint not null,
  reason           text,
  performed_by     uuid references staff(id),
  created_at       timestamptz not null default now()
);
create index on purchase_returns (purchase_id);

-- ---------------------------------------------------------------------
-- RLS — same shape as every other financial table: read scoped by
-- outlet, no direct write policy at all (writes only through the RPCs
-- in 0016_purchases_functions.sql, which are SECURITY DEFINER).
-- ---------------------------------------------------------------------
alter table purchases         enable row level security;
alter table purchase_lines    enable row level security;
alter table purchase_returns  enable row level security;

create policy read_purchases on purchases for select
  using (outlet_id = my_outlet());

create policy read_purchase_lines on purchase_lines for select
  using (exists (select 1 from purchases p where p.id = purchase_id and p.outlet_id = my_outlet()));

create policy read_purchase_returns on purchase_returns for select
  using (exists (select 1 from purchases p where p.id = purchase_id and p.outlet_id = my_outlet()));
