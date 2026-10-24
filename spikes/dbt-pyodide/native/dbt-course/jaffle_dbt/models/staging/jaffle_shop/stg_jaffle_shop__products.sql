with

source as (

    select * from {{ source('jaffle_shop', 'products') }}

),

renamed as (

    select
        id as product_id,
        name as product_name,
        category,
        -- cents -> dollars, stored as an exact decimal (not a float)
        cast(price_cents / 100 as decimal(16, 2)) as price

    from source

)

select * from renamed
