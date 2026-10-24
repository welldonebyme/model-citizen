-- =====================================================================
--  fresh_load.sql -- "data arrived a moment ago"
--
--  Adds 2 small new orders (with their items and successful payments)
--  whose _loaded_at is the current time. Use it when you want
--  `dbt source freshness` to report PASS (Chapter 21).
--
--  From your practice folder (DuckDB CLI closed everywhere else):
--      duckdb practice.duckdb < updates/fresh_load.sql
--
--  Unlike day2.sql, every run adds 2 MORE orders: the new ids are
--  "current max id + 1" and "current max id + 2".
--  To go back to the original data, re-run setup.sql.
--
--  Why "at time zone 'UTC'"? _loaded_at has no time zone (TIMESTAMP).
--  dbt reads such values as UTC when it computes the age of the data,
--  so we store the current UTC time, whatever your computer's time zone.
-- =====================================================================

begin transaction;

-- the batch to load: 2 orders, 1 item each, 1 payment each
create temp table fresh_batch as
select
    (select max(id) from jaffle_shop.orders) + v.n       as order_id,
    v.user_id,
    (select max(id) from jaffle_shop.order_items) + v.n  as order_item_id,
    v.product_id,
    v.quantity,
    (select max(id) from stripe.payments) + v.n          as payment_id,
    cast(current_timestamp at time zone 'UTC' as timestamp) as loaded_at
from (values
    (1, 1, 2, 1),       -- customer 1 buys 1 Cappuccino
    (2, 2, 7, 2)        -- customer 2 buys 2 Croissants
) as v(n, user_id, product_id, quantity);

insert into jaffle_shop.orders (id, user_id, order_date, status, _loaded_at)
select order_id, user_id, cast(loaded_at as date), 'completed', loaded_at
from fresh_batch;

insert into jaffle_shop.order_items (id, order_id, product_id, quantity)
select order_item_id, order_id, product_id, quantity
from fresh_batch;

insert into stripe.payments (id, orderid, paymentmethod, status, amount, created, _loaded_at)
select
    b.payment_id,
    b.order_id,
    'credit_card',
    'success',
    b.quantity * p.price_cents,        -- amount in CENTS = the item total
    cast(b.loaded_at as date),
    b.loaded_at
from fresh_batch as b
inner join jaffle_shop.products as p
    on p.id = b.product_id;

drop table fresh_batch;

commit;

-- quick check: the newest load time per table with a _loaded_at column
select 'jaffle_shop.orders' as table_name, count(*) as n_rows, max(_loaded_at) as max_loaded_at
from jaffle_shop.orders
union all
select 'stripe.payments', count(*), max(_loaded_at)
from stripe.payments;
