with

orders as (

    select * from {{ ref('stg_jaffle_shop__orders') }}

),

customers as (

    select * from {{ ref('stg_jaffle_shop__customers') }}

),

payments as (

    select * from {{ ref('int_payments__successful') }}

),

order_payments as (

    select
        order_id,
        sum(amount) as paid_amount

    from payments
    group by order_id

),

final as (

    select
        orders.order_id,
        orders.customer_id,
        orders.order_date,
        orders.status,
        orders.loaded_at,
        customers.country,
        coalesce(order_payments.paid_amount, 0) as paid_amount

    from orders
    left join customers
        on orders.customer_id = customers.customer_id
    left join order_payments
        on orders.order_id = order_payments.order_id

)

select * from final
