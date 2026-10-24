-- =====================================================================
--  day2.sql -- "the next loading day" for the practice database
--
--  It simulates what the source systems send on 2 January 2026:
--    * jaffle_shop.customers : 5 customers change (3 move to another
--                              country, 1 NULL email gets a value,
--                              1 email is rewritten in lower case)
--    * jaffle_shop.orders    : the 10 'placed' orders become 'shipped',
--                              3 'shipped' orders become 'completed'
--                              (every changed row gets a new _loaded_at
--                              on 2026-01-02), and 20 NEW orders
--                              (ids 301-320, 2026-01-01 .. 2026-01-04)
--    * jaffle_shop.order_items : 32 new items (ids 607-638) for the
--                              new orders
--    * stripe.payments       : 30 new successful payments (ids 342-371):
--                              20 for the new orders, 10 for the orders
--                              that were 'placed' (created 2026-01-02)
--
--  From your practice folder (DuckDB CLI closed everywhere else):
--      duckdb practice.duckdb < updates/day2.sql
--
--  The script is safe to run twice: updates write the same values again
--  and inserts skip ids that already exist.
--  To go back to the original data, re-run setup.sql.
-- =====================================================================

begin transaction;

-- ---------------------------------------------------------------------
-- 1. customers: 5 changed rows
-- ---------------------------------------------------------------------
update jaffle_shop.customers as c
set country = v.new_country
from (values
    (5,  'France'),     -- was Morocco
    (12, 'Spain'),      -- was Morocco
    (40, 'Germany')     -- was Spain
) as v(id, new_country)
where c.id = v.id;

-- a customer who had no email gives one
update jaffle_shop.customers
set email = 'leo.fernandez17@example.com'
where id = 17;          -- was NULL

-- a customer fixes the case of their email
update jaffle_shop.customers
set email = 'youssef.wilson11@example.com'
where id = 11;          -- was YOUSSEF.WILSON11@EXAMPLE.COM

-- ---------------------------------------------------------------------
-- 2. orders: 13 changed rows (new status + new _loaded_at)
-- ---------------------------------------------------------------------
update jaffle_shop.orders as o
set status = v.new_status,
    _loaded_at = v.new_loaded_at
from (values
    -- the 10 'placed' orders are now shipped
    (288, 'shipped',   timestamp '2026-01-02 07:00:00'),
    (289, 'shipped',   timestamp '2026-01-02 07:05:00'),
    (290, 'shipped',   timestamp '2026-01-02 07:10:00'),
    (292, 'shipped',   timestamp '2026-01-02 07:15:00'),
    (295, 'shipped',   timestamp '2026-01-02 07:20:00'),
    (296, 'shipped',   timestamp '2026-01-02 07:25:00'),
    (297, 'shipped',   timestamp '2026-01-02 07:30:00'),
    (298, 'shipped',   timestamp '2026-01-02 07:35:00'),
    (299, 'shipped',   timestamp '2026-01-02 07:40:00'),
    (300, 'shipped',   timestamp '2026-01-02 07:45:00'),
    -- 3 shipped orders are now completed
    (255, 'completed', timestamp '2026-01-02 07:50:00'),
    (276, 'completed', timestamp '2026-01-02 07:55:00'),
    (291, 'completed', timestamp '2026-01-02 08:00:00')
) as v(id, new_status, new_loaded_at)
where o.id = v.id;

-- ---------------------------------------------------------------------
-- 3. orders: 20 new orders (ids 301-320)
-- ---------------------------------------------------------------------
insert into jaffle_shop.orders (id, user_id, order_date, status, _loaded_at)
select * from (values
    (301, 96, date '2026-01-01', 'completed', timestamp '2026-01-01 08:00:00'),
    (302,  5, date '2026-01-01', 'completed', timestamp '2026-01-01 10:07:00'),
    (303, 23, date '2026-01-01', 'completed', timestamp '2026-01-01 12:14:00'),
    (304, 61, date '2026-01-01', 'completed', timestamp '2026-01-01 14:21:00'),
    (305, 14, date '2026-01-01', 'completed', timestamp '2026-01-01 16:28:00'),
    (306, 97, date '2026-01-02', 'completed', timestamp '2026-01-02 08:35:00'),
    (307, 40, date '2026-01-02', 'completed', timestamp '2026-01-02 10:42:00'),
    (308,  8, date '2026-01-02', 'completed', timestamp '2026-01-02 12:49:00'),
    (309, 72, date '2026-01-02', 'completed', timestamp '2026-01-02 14:56:00'),
    (310, 33, date '2026-01-02', 'completed', timestamp '2026-01-02 16:03:00'),
    (311,  2, date '2026-01-03', 'shipped',   timestamp '2026-01-03 08:10:00'),
    (312, 45, date '2026-01-03', 'shipped',   timestamp '2026-01-03 10:17:00'),
    (313, 19, date '2026-01-03', 'shipped',   timestamp '2026-01-03 12:24:00'),
    (314, 88, date '2026-01-03', 'shipped',   timestamp '2026-01-03 14:31:00'),
    (315,  6, date '2026-01-03', 'shipped',   timestamp '2026-01-03 16:38:00'),
    (316, 54, date '2026-01-04', 'shipped',   timestamp '2026-01-04 08:45:00'),
    (317, 12, date '2026-01-04', 'shipped',   timestamp '2026-01-04 10:52:00'),
    (318, 70, date '2026-01-04', 'shipped',   timestamp '2026-01-04 12:59:00'),
    (319,  3, date '2026-01-04', 'shipped',   timestamp '2026-01-04 14:06:00'),
    (320, 29, date '2026-01-04', 'shipped',   timestamp '2026-01-04 16:13:00')
) as v(id, user_id, order_date, status, _loaded_at)
where v.id not in (select id from jaffle_shop.orders);

-- ---------------------------------------------------------------------
-- 4. order_items: 32 new items for the new orders (ids 607-638)
-- ---------------------------------------------------------------------
insert into jaffle_shop.order_items (id, order_id, product_id, quantity)
select * from (values
    (607, 301,  2, 1), (608, 301,  7, 1),
    (609, 302,  1, 2),
    (610, 303,  6, 1), (611, 303,  9, 2),
    (612, 304,  3, 1), (613, 304, 10, 1),
    (614, 305, 11, 1),
    (615, 306,  4, 2), (616, 306,  8, 1),
    (617, 307,  5, 1),
    (618, 308,  2, 2), (619, 308,  7, 2),
    (620, 309, 12, 1), (621, 309,  1, 1),
    (622, 310,  3, 1),
    (623, 311,  6, 2),
    (624, 312,  8, 1), (625, 312,  4, 1),
    (626, 313,  1, 1), (627, 313,  9, 1),
    (628, 314, 11, 1), (629, 314, 12, 1),
    (630, 315,  5, 2), (631, 315, 10, 1),
    (632, 316,  2, 1),
    (633, 317,  7, 3),
    (634, 318,  3, 2), (635, 318,  9, 1),
    (636, 319,  4, 1),
    (637, 320,  6, 1), (638, 320, 10, 2)
) as v(id, order_id, product_id, quantity)
where v.id not in (select id from jaffle_shop.order_items);

-- ---------------------------------------------------------------------
-- 5. payments: 30 new successful payments (ids 342-371), amounts in
--    CENTS, always equal to the total of the order's items
-- ---------------------------------------------------------------------
insert into stripe.payments (id, orderid, paymentmethod, status, amount, created, _loaded_at)
select * from (values
    -- the 20 new orders
    (342, 301, 'credit_card',   'success',  600, date '2026-01-01', timestamp '2026-01-01 08:03:00'),
    (343, 302, 'credit_card',   'success',  500, date '2026-01-01', timestamp '2026-01-01 10:10:00'),
    (344, 303, 'bank_transfer', 'success',  840, date '2026-01-01', timestamp '2026-01-01 12:17:00'),
    (345, 304, 'credit_card',   'success',  720, date '2026-01-01', timestamp '2026-01-01 14:24:00'),
    (346, 305, 'gift_card',     'success', 1400, date '2026-01-01', timestamp '2026-01-01 16:31:00'),
    (347, 306, 'credit_card',   'success', 1650, date '2026-01-02', timestamp '2026-01-02 08:38:00'),
    (348, 307, 'credit_card',   'success',  300, date '2026-01-02', timestamp '2026-01-02 10:45:00'),
    (349, 308, 'bank_transfer', 'success', 1200, date '2026-01-02', timestamp '2026-01-02 12:52:00'),
    (350, 309, 'credit_card',   'success', 1450, date '2026-01-02', timestamp '2026-01-02 14:59:00'),
    (351, 310, 'gift_card',     'success',  400, date '2026-01-02', timestamp '2026-01-02 16:06:00'),
    (352, 311, 'credit_card',   'success',  960, date '2026-01-03', timestamp '2026-01-03 08:13:00'),
    (353, 312, 'credit_card',   'success', 1200, date '2026-01-03', timestamp '2026-01-03 10:20:00'),
    (354, 313, 'bank_transfer', 'success',  430, date '2026-01-03', timestamp '2026-01-03 12:27:00'),
    (355, 314, 'credit_card',   'success', 2600, date '2026-01-03', timestamp '2026-01-03 14:34:00'),
    (356, 315, 'gift_card',     'success',  920, date '2026-01-03', timestamp '2026-01-03 16:41:00'),
    (357, 316, 'credit_card',   'success',  380, date '2026-01-04', timestamp '2026-01-04 08:48:00'),
    (358, 317, 'credit_card',   'success',  660, date '2026-01-04', timestamp '2026-01-04 10:55:00'),
    (359, 318, 'bank_transfer', 'success',  980, date '2026-01-04', timestamp '2026-01-04 13:02:00'),
    (360, 319, 'credit_card',   'success',  450, date '2026-01-04', timestamp '2026-01-04 14:09:00'),
    (361, 320, 'gift_card',     'success', 1120, date '2026-01-04', timestamp '2026-01-04 16:16:00'),
    -- the 10 orders that were 'placed' are paid on 2 January
    (362, 288, 'credit_card',   'success', 3400, date '2026-01-02', timestamp '2026-01-02 07:01:00'),
    (363, 289, 'credit_card',   'success', 2640, date '2026-01-02', timestamp '2026-01-02 07:06:00'),
    (364, 290, 'credit_card',   'success', 1500, date '2026-01-02', timestamp '2026-01-02 07:11:00'),
    (365, 292, 'credit_card',   'success', 2910, date '2026-01-02', timestamp '2026-01-02 07:16:00'),
    (366, 295, 'credit_card',   'success', 3550, date '2026-01-02', timestamp '2026-01-02 07:21:00'),
    (367, 296, 'credit_card',   'success', 3650, date '2026-01-02', timestamp '2026-01-02 07:26:00'),
    (368, 297, 'credit_card',   'success', 1140, date '2026-01-02', timestamp '2026-01-02 07:31:00'),
    (369, 298, 'credit_card',   'success',  750, date '2026-01-02', timestamp '2026-01-02 07:36:00'),
    (370, 299, 'credit_card',   'success', 1980, date '2026-01-02', timestamp '2026-01-02 07:41:00'),
    (371, 300, 'credit_card',   'success', 3600, date '2026-01-02', timestamp '2026-01-02 07:46:00')
) as v(id, orderid, paymentmethod, status, amount, created, _loaded_at)
where v.id not in (select id from stripe.payments);

commit;

-- quick check: one row per table with its row count
select 'jaffle_shop.customers' as table_name, count(*) as n_rows from jaffle_shop.customers
union all select 'jaffle_shop.orders', count(*) from jaffle_shop.orders
union all select 'jaffle_shop.order_items', count(*) from jaffle_shop.order_items
union all select 'jaffle_shop.products', count(*) from jaffle_shop.products
union all select 'stripe.payments', count(*) from stripe.payments;
