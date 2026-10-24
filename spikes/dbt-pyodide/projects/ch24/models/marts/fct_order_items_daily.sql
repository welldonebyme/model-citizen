{#
    Microbatch: dbt splits the work into batches of one month (batch_size) on
    order_date (event_time), from 2025-01-01 (begin). Each batch only reads the
    rows of fct_order_items whose event_time is inside the batch.
    A normal run re-processes the current batch and 1 previous batch (lookback).
#}
-- concurrent_batches=False: run the batches one after the other. Since Chapter 20,
-- persist_docs writes a COMMENT ON TABLE in every batch; on DuckDB, batches that
-- change the same table at the same time fail with "Catalog write-write conflict".
{{
    config(
        materialized='incremental',
        incremental_strategy='microbatch',
        event_time='order_date',
        begin='2025-01-01',
        batch_size='month',
        lookback=1,
        concurrent_batches=False
    )
}}

with

order_items as (

    select * from {{ ref('fct_order_items') }}

)

select
    order_date,
    product_id,
    product_name,
    category,
    count(distinct order_id) as number_of_orders,
    sum(quantity) as quantity,
    sum(line_amount) as revenue

from order_items
group by 1, 2, 3, 4
