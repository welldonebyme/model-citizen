with

source as (

    select * from {{ source('jaffle_shop', 'orders') }}

),

renamed as (

    select
        id as order_id,
        user_id as customer_id,
        order_date,
        status,
        _loaded_at as loaded_at

    from source

)

select * from renamed

{% if target.name == 'dev' -%}
-- dev only: work on a smaller slice of data when needed (dbt run --vars ...)
where order_date >= '{{ var("dev_start_date") }}'
{%- endif %}
