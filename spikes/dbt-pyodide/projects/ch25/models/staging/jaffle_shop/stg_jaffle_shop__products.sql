with

source as (

    select * from {{ source('jaffle_shop', 'products') }}

),

renamed as (

    select
        id as product_id,
        name as product_name,
        category,
        {{ cents_to_dollars('price_cents') }} as price

    from source

)

select * from renamed
