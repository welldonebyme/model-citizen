-- Singular test: for every order, the amount in fct_orders must equal
--   (1) the sum of its 4 payment-method columns, and
--   (2) the sum of its successful payments in stg_stripe__payments.
-- The test FAILS if this query returns at least one row.

with

orders as (

    select * from {{ ref('fct_orders') }}

),

payments as (

    select
        order_id,
        sum(amount) as paid_amount
    from {{ ref('stg_stripe__payments') }}
    where status = 'success'
    group by order_id

)

select
    orders.order_id,
    orders.amount,
    orders.bank_transfer_amount + orders.coupon_amount
        + orders.credit_card_amount + orders.gift_card_amount as sum_of_methods,
    coalesce(payments.paid_amount, 0) as paid_amount

from orders
left join payments
    on orders.order_id = payments.order_id
where orders.amount <> orders.bank_transfer_amount + orders.coupon_amount
                       + orders.credit_card_amount + orders.gift_card_amount
   or orders.amount <> coalesce(payments.paid_amount, 0)
