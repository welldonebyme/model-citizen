-- Revenue per sales region (ad-hoc question from the finance team).
-- Analyses are compiled by dbt but never run: copy the compiled SQL from
-- target/compiled/jaffle_dbt/analyses/revenue_by_region.sql, or use dbt show.

with

monthly_revenue as (

    select * from {{ ref('fct_monthly_revenue') }}

),

country_regions as (

    select * from {{ ref('country_regions') }}

)

select
    country_regions.region,
    sum(monthly_revenue.number_of_orders) as number_of_orders,
    sum(monthly_revenue.revenue) as revenue

from monthly_revenue
left join country_regions
    on monthly_revenue.country = country_regions.country
group by country_regions.region
order by revenue desc
