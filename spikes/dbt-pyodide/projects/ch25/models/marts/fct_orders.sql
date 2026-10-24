{#
    Incremental: each run only processes the orders loaded since the last run.
    - unique_key='order_id': an order that changes (new status, new payment) replaces its old row
    - merge: an upsert on order_id (update the rows that exist, insert the new ones)
#}
{{
    config(
        materialized='incremental',
        unique_key='order_id',
        incremental_strategy='merge',
        on_schema_change='append_new_columns'
    )
}}

with

orders as (

    select * from {{ ref('int_orders__enriched') }}

    {% if is_incremental() %}
    -- only the orders loaded after the newest row already in this table
    -- (coalesce: if the table is empty, for example after --empty, max() is NULL -> take every row)
    where loaded_at > (select coalesce(max(loaded_at), '1900-01-01') from {{ this }})
    {% endif %}

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
        orders.paid_amount as amount,
        orders.loaded_at

    from orders
    left join payment_methods
        on orders.order_id = payment_methods.order_id

)

select * from final
