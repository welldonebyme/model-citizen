with

orders as (

    select * from {{ ref('int_orders__enriched') }}

),

valid_orders as (

    select * from orders
    where status not in ('returned', 'return_pending')

),

final as (

    select
        cast(date_trunc('month', order_date) as date) as order_month,
        country,
        count(*) as number_of_orders,
        sum(paid_amount) as revenue

    from valid_orders
    group by 1, 2

)

select * from final
