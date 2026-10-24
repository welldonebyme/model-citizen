-- Singular test: when an order is paid, the payments must equal the total of
-- its order lines (quantity x unit price). Returns the orders that do not match.

with

items as (

    select
        order_id,
        sum(line_amount) as items_amount
    from {{ ref('fct_order_items') }}
    group by order_id

)

select
    orders.order_id,
    orders.amount,
    items.items_amount

from {{ ref('fct_orders') }} as orders
inner join items
    on orders.order_id = items.order_id
where orders.amount > 0
  and orders.amount <> items.items_amount
