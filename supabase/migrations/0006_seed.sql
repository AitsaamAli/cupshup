-- =====================================================================
-- Cup Shup POS — 0004 Seed
-- Menu transcribed from the prototype. Prices in PAISA.
-- =====================================================================

-- ---------------------------------------------------------------------
-- OUTLET
-- ---------------------------------------------------------------------
insert into outlets (id, name, address, timezone, day_start_hour, invoice_prefix)
values ('00000000-0000-0000-0000-000000000001',
        'Cup Shup — Johar Town', 'Johar Town, Lahore', 'Asia/Karachi', 15, 'CS')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- TAX — Punjab Finance Act 2026, effective 01-07-2026
--   Cash / non-digital  : 16%
--   Card, wallet, QR    :  8%
-- The prototype had 18% / 8% and taxed JazzCash + EasyPaisa at 18%.
-- Both were wrong. Never hardcode these again.
-- ---------------------------------------------------------------------
insert into tax_rates (authority, class, rate_bp, effective_from, effective_to, notification_ref) values
  ('PRA', 'cash',    1600, '2026-07-01', null, 'Punjab Finance Act 2026'),
  ('PRA', 'digital',  800, '2026-07-01', null, 'PRA/Member Legal/816/26 dt. 02.07.2026'),
  -- history, so old invoices still recalculate correctly:
  ('PRA', 'digital',  500, '2020-01-01', '2026-07-01', 'pre-2026 reduced rate');

insert into payment_method_tax_class (method, class) values
  ('cash','cash'), ('card','digital'), ('jazzcash','digital'),
  ('easypaisa','digital'), ('qr','digital'), ('foodpanda','digital');

-- ---------------------------------------------------------------------
-- MENU
-- ---------------------------------------------------------------------
insert into menu_categories (outlet_id, name, sort_order, color) values
  ('00000000-0000-0000-0000-000000000001','Appetizers',      1,'#D64545'),
  ('00000000-0000-0000-0000-000000000001','Fries',           2,'#E0A72E'),
  ('00000000-0000-0000-0000-000000000001','Salad & Soup',    3,'#4C9A63'),
  ('00000000-0000-0000-0000-000000000001','Sandwiches',      4,'#C97A4A'),
  ('00000000-0000-0000-0000-000000000001','Burgers',         5,'#A8563D'),
  ('00000000-0000-0000-0000-000000000001','Pasta',           6,'#B8862F'),
  ('00000000-0000-0000-0000-000000000001','Wraps',           7,'#D9A441'),
  ('00000000-0000-0000-0000-000000000001','Stuffed Chicken', 8,'#B0433A'),
  ('00000000-0000-0000-0000-000000000001','Steaks',          9,'#8E4A3C'),
  ('00000000-0000-0000-0000-000000000001','Chinese',        10,'#D1548B'),
  ('00000000-0000-0000-0000-000000000001','Pizza',          11,'#DDA520'),
  ('00000000-0000-0000-0000-000000000001','Shakes',         12,'#C85C9E'),
  ('00000000-0000-0000-0000-000000000001','Frappe',         13,'#8B5FBF'),
  ('00000000-0000-0000-0000-000000000001','Mocktail',       14,'#2FA6A0'),
  ('00000000-0000-0000-0000-000000000001','Coffee',         15,'#6B4FA0'),
  ('00000000-0000-0000-0000-000000000001','Chai',           16,'#C9902E'),
  ('00000000-0000-0000-0000-000000000001','Kahwa',          17,'#B07A2E'),
  ('00000000-0000-0000-0000-000000000001','Lagoon',         18,'#2E9E9E'),
  ('00000000-0000-0000-0000-000000000001','Drinks',         19,'#3D8FBF'),
  ('00000000-0000-0000-0000-000000000001','Desserts',       20,'#C74A9A'),
  ('00000000-0000-0000-0000-000000000001','Icecream',       21,'#5AB8C4');

-- items(category, name, price_rupees, price_unconfirmed)
with src(cat, item, rupees, unconfirmed) as (values
  ('Appetizers','Cheese Balls',599,false),
  ('Appetizers','Stuffed Chillies',599,false),
  ('Appetizers','Chicken Strips',649,false),
  ('Appetizers','Hot Shots',599,false),
  ('Fries','Plain Fries',529,false),
  ('Fries','Masala Fries',539,false),
  ('Fries','Loaded Fries',749,false),
  ('Fries','Cheese Fries',699,false),
  ('Fries','Mexican Tacos',749,false),
  ('Salad & Soup','Chicken Pineapple Salad',599,false),
  ('Salad & Soup','Hot n Sour Soup',449,false),
  ('Salad & Soup','Chicken Corn Soup',399,false),
  ('Salad & Soup','Family Bowl Soup',1399,false),
  ('Sandwiches','Special Sandwich',799,false),
  ('Sandwiches','Delight Crispy Sandwich',829,false),
  ('Sandwiches','Cocktail Sandwich',849,false),
  ('Burgers','Thunder Grilled Burger',849,false),
  ('Burgers','Smokey Beef Burger',949,false),
  ('Burgers','Molten Cheese Burger',899,false),
  ('Pasta','Fettuccino Pasta',899,false),
  ('Pasta','Alfredo Pasta',849,false),
  ('Wraps','Crunch Wrap',799,false),
  ('Wraps','Loaded Wrap',829,false),
  ('Stuffed Chicken','Polo Chicken',1699,false),
  ('Stuffed Chicken','Chicken Alakive',1699,false),
  ('Stuffed Chicken','Chicken Stuffed Capsicum',1649,false),
  ('Steaks','Tarragon Steak',1549,false),
  ('Steaks','Jalapeno Steak',1549,false),
  ('Steaks','Mexican Steak',1549,false),
  ('Steaks','Casserole (Chicken Special)',1699,false),
  ('Chinese','Manchurian',1079,false),
  ('Chinese','Chilli Dry',1099,false),
  ('Chinese','Cashew Nut',1129,false),
  ('Chinese','Egg Fried Rice',599,true),
  ('Chinese','Masala Rice',649,true),
  ('Pizza','Chicken Fajita Pizza 6"',999,false),
  ('Pizza','Chicken Fajita Pizza 9"',1349,false),
  ('Pizza','Chicken Fajita Pizza 14"',1999,false),
  ('Pizza','Super Supreme Pizza 6"',999,false),
  ('Pizza','Super Supreme Pizza 9"',1349,false),
  ('Pizza','Super Supreme Pizza 14"',1999,false),
  ('Pizza','Malai Boti Pizza 6"',999,false),
  ('Pizza','Malai Boti Pizza 9"',1349,false),
  ('Pizza','Malai Boti Pizza 14"',1999,false),
  ('Shakes','Kitkat Shake',799,false),
  ('Shakes','Coffee/Caramel Shake',799,false),
  ('Shakes','Chocolate Shake',799,false),
  ('Shakes','Strawberry Shake',799,false),
  ('Shakes','Vanilla/Oreo Shake',799,false),
  ('Shakes','Mango Shake',799,false),
  ('Frappe','Mint Frappe',499,false),
  ('Frappe','Irish/Caramel Frappe',499,false),
  ('Frappe','Vanilla/Hazelnut Frappe',549,false),
  ('Frappe','Cookies & Cream Frappe',549,false),
  ('Mocktail','Mint Mojito',549,true),
  ('Mocktail','Guava Mint',549,false),
  ('Mocktail','Blue Colada',599,false),
  ('Mocktail','Pinacolada',599,false),
  ('Mocktail','Blueberry Fantasy',599,false),
  ('Mocktail','Strawberry Mojito',599,false),
  ('Coffee','Cappuccino',599,false),
  ('Coffee','Cafe Latte',599,false),
  ('Coffee','Mocha',599,false),
  ('Coffee','Hot Chocolate',649,false),
  ('Coffee','Caramel Coffee',699,false),
  ('Coffee','Hazelnut Coffee',699,false),
  ('Coffee','Vanilla Coffee',699,false),
  ('Coffee','Black Coffee',449,false),
  ('Chai','Karak Chai',329,false),
  ('Chai','Dodh Pati Chai',329,false),
  ('Chai','Cardamom Chai',349,true),
  ('Chai','Chocolate Chai',349,true),
  ('Chai','Malai Chai',349,true),
  ('Chai','Ginger-Fennel Chai',349,false),
  ('Kahwa','Green Tea Kahwa',229,false),
  ('Kahwa','Sulemani Kahwa',229,false),
  ('Kahwa','Peshawari Kahwa',229,false),
  ('Kahwa','Lemon Grass Kahwa',229,false),
  ('Lagoon','Lagoon Peach',549,false),
  ('Lagoon','Lagoon Green Apple',549,false),
  ('Lagoon','Lagoon Blue/Kiwi',549,false),
  ('Drinks','Water (Small)',60,true),
  ('Drinks','Soft Drink',109,false),
  ('Drinks','Cold Drink 0.5L',149,false),
  ('Drinks','Fresh Lime',169,false),
  ('Drinks','Mint Margarita',399,false),
  ('Drinks','Lemonade',429,false),
  ('Desserts','Gulab Jaman',399,false),
  ('Desserts','Brownie',649,false),
  ('Desserts','Lava Cake',699,false),
  ('Icecream','Strawberry Icecream',399,false),
  ('Icecream','Vanilla Icecream',399,false),
  ('Icecream','Chocolate Icecream',399,false)
),
ins as (
  insert into menu_items (category_id, name, sort_order, price_unconfirmed)
  select c.id, s.item, row_number() over (partition by s.cat order by s.item), s.unconfirmed
  from src s
  join menu_categories c
    on c.name = s.cat and c.outlet_id = '00000000-0000-0000-0000-000000000001'
  returning id, name
)
insert into menu_item_prices (menu_item_id, price_paisa, effective_from)
select ins.id, s.rupees * 100, '2026-01-01'
from ins join src s on s.item = ins.name;

-- ---------------------------------------------------------------------
-- EXPENSE CATEGORIES  (accrual_type stops rent from wrecking the daily P&L)
-- ---------------------------------------------------------------------
insert into expense_categories (outlet_id, name, accrual_type, color) values
  ('00000000-0000-0000-0000-000000000001','Rent',        'monthly',  '#D64545'),
  ('00000000-0000-0000-0000-000000000001','Utilities',   'monthly',  '#E0A72E'),
  ('00000000-0000-0000-0000-000000000001','Salaries',    'monthly',  '#4C9A63'),
  ('00000000-0000-0000-0000-000000000001','Daily Wages', 'immediate','#5AB8C4'),
  ('00000000-0000-0000-0000-000000000001','Supplies',    'immediate','#3D8FBF'),
  ('00000000-0000-0000-0000-000000000001','Gas & Fuel',  'immediate','#C97A4A'),
  ('00000000-0000-0000-0000-000000000001','Maintenance', 'immediate','#8B5FBF'),
  ('00000000-0000-0000-0000-000000000001','Marketing',   'monthly',  '#C74A9A'),
  ('00000000-0000-0000-0000-000000000001','Other',       'immediate','#748078');

-- ---------------------------------------------------------------------
-- INGREDIENTS — starter list. Add real moving_avg_cost_paisa from your
-- actual purchase invoices; every profit figure depends on these numbers.
-- ---------------------------------------------------------------------
insert into ingredients (outlet_id, name, unit, min_stock, moving_avg_cost_paisa) values
  ('00000000-0000-0000-0000-000000000001','Chicken','kg',8,   85000),
  ('00000000-0000-0000-0000-000000000001','Beef','kg',5,     120000),
  ('00000000-0000-0000-0000-000000000001','Cheese','kg',4,    180000),
  ('00000000-0000-0000-0000-000000000001','Burger Buns','pcs',20, 4000),
  ('00000000-0000-0000-0000-000000000001','Pizza Dough','pcs',10, 8000),
  ('00000000-0000-0000-0000-000000000001','Fries','kg',6,      45000),
  ('00000000-0000-0000-0000-000000000001','Pasta','kg',3,      52000),
  ('00000000-0000-0000-0000-000000000001','Cooking Oil','L',10,58000),
  ('00000000-0000-0000-0000-000000000001','Milk','L',8,        22000),
  ('00000000-0000-0000-0000-000000000001','Coffee Beans','kg',2,320000),
  ('00000000-0000-0000-0000-000000000001','Tea Leaves','kg',2, 140000),
  ('00000000-0000-0000-0000-000000000001','Sugar','kg',5,      18000);

-- ---------------------------------------------------------------------
-- EXAMPLE RECIPE — this is the pattern to repeat for every item.
-- Until recipes exist, cogs_paisa is 0 and margin reporting is blind.
-- Karak Chai: 150ml milk, 5g tea, 15g sugar
-- ---------------------------------------------------------------------
insert into recipe_lines (menu_item_id, ingredient_id, qty)
select mi.id, ing.id, v.qty
from (values ('Milk',0.150),('Tea Leaves',0.005),('Sugar',0.015)) as v(ing_name, qty)
join ingredients ing on ing.name = v.ing_name
join menu_items mi on mi.name = 'Karak Chai';
