with

source as (

    select * from {{ source('jaffle_shop', 'order_items') }}

),

renamed as (

    select
        id as order_item_id,
        order_id,
        product_id,
        quantity

    from source

)

select * from renamed
