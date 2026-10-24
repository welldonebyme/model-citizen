with

source as (

    select * from {{ source('stripe', 'payments') }}

),

renamed as (

    select
        id as payment_id,
        orderid as order_id,
        paymentmethod as payment_method,
        status,
        -- cents -> dollars, stored as an exact decimal (not a float)
        cast(amount / 100 as decimal(16, 2)) as amount,
        created as created_at,
        _loaded_at as loaded_at

    from source

)

select * from renamed
