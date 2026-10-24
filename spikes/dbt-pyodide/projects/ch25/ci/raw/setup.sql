-- =====================================================================
--  setup.sql -- builds the practice database used in the whole bible
--
--  From the labs/ folder, run:
--      duckdb practice.duckdb < setup.sql
--  You can run it again at any time to reset the data.
-- =====================================================================

create schema if not exists jaffle_shop;   -- the shop's application data
create schema if not exists stripe;        -- the payment provider's data

create or replace table jaffle_shop.customers as
select * from read_csv('data/customers.csv', header = true,
    columns = {'id': 'INTEGER', 'first_name': 'VARCHAR', 'last_name': 'VARCHAR',
               'email': 'VARCHAR', 'country': 'VARCHAR', 'signup_date': 'DATE'});

create or replace table jaffle_shop.orders as
select * from read_csv('data/orders.csv', header = true,
    columns = {'id': 'INTEGER', 'user_id': 'INTEGER', 'order_date': 'DATE',
               'status': 'VARCHAR', '_loaded_at': 'TIMESTAMP'});

create or replace table jaffle_shop.order_items as
select * from read_csv('data/order_items.csv', header = true,
    columns = {'id': 'INTEGER', 'order_id': 'INTEGER', 'product_id': 'INTEGER',
               'quantity': 'INTEGER'});

create or replace table jaffle_shop.products as
select * from read_csv('data/products.csv', header = true,
    columns = {'id': 'INTEGER', 'name': 'VARCHAR', 'category': 'VARCHAR',
               'price_cents': 'INTEGER'});

create or replace table stripe.payments as
select * from read_csv('data/payments.csv', header = true,
    columns = {'id': 'INTEGER', 'orderid': 'INTEGER', 'paymentmethod': 'VARCHAR',
               'status': 'VARCHAR', 'amount': 'INTEGER', 'created': 'DATE',
               '_loaded_at': 'TIMESTAMP'});

-- quick check: one row per table with its row count
select 'jaffle_shop.customers' as table_name, count(*) as n_rows from jaffle_shop.customers
union all select 'jaffle_shop.orders', count(*) from jaffle_shop.orders
union all select 'jaffle_shop.order_items', count(*) from jaffle_shop.order_items
union all select 'jaffle_shop.products', count(*) from jaffle_shop.products
union all select 'stripe.payments', count(*) from stripe.payments;
