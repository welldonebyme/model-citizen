{{ config(materialized='ephemeral') }}

with

payments as (

    select * from {{ ref('stg_stripe__payments') }}

),

successful as (

    select
        payment_id,
        order_id,
        payment_method,
        amount,
        created_at

    from payments
    where status = 'success'

)

select * from successful
