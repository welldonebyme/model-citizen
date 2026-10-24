with

orders as (

    select * from {{ ref('int_orders__enriched') }}

),

payment_methods as (

    select * from {{ ref('int_orders__payment_methods_pivoted') }}

),

final as (

    select
        orders.order_id,
        orders.customer_id,
        orders.order_date,
        orders.status,
        coalesce(payment_methods.bank_transfer_amount, 0) as bank_transfer_amount,
        coalesce(payment_methods.coupon_amount, 0) as coupon_amount,
        coalesce(payment_methods.credit_card_amount, 0) as credit_card_amount,
        coalesce(payment_methods.gift_card_amount, 0) as gift_card_amount,
        orders.paid_amount as amount

    from orders
    left join payment_methods
        on orders.order_id = payment_methods.order_id

)

select * from final
