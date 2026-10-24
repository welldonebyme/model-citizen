with

order_items as (

    select * from {{ ref('stg_jaffle_shop__order_items') }}

),

orders as (

    select * from {{ ref('stg_jaffle_shop__orders') }}

),

products as (

    select * from {{ ref('stg_jaffle_shop__products') }}

),

final as (

    select
        {{ dbt_utils.generate_surrogate_key(['order_items.order_id', 'order_items.product_id']) }}
            as order_item_key,
        order_items.order_item_id,
        order_items.order_id,
        orders.order_date,
        order_items.product_id,
        products.product_name,
        products.category,
        order_items.quantity,
        products.price as unit_price,
        order_items.quantity * products.price as line_amount

    from order_items
    inner join orders
        on order_items.order_id = orders.order_id
    left join products
        on order_items.product_id = products.product_id

)

select * from final
