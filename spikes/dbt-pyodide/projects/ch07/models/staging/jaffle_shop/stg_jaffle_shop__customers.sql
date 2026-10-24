with

source as (

    select * from {{ source('jaffle_shop', 'customers') }}

),

renamed as (

    select
        id as customer_id,
        first_name,
        last_name,
        lower(email) as email,
        country,
        signup_date

    from source

)

select * from renamed
