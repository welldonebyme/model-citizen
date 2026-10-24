{% docs __overview__ %}
# Jaffle Shop analytics (practice project)

This project turns the raw data of the Jaffle Shop (schemas `jaffle_shop` and `stripe`)
into tested, documented tables for the finance and marketing teams.

- **staging**: one model per raw table, light cleaning only (rename, cast, cents to dollars)
- **intermediate**: reusable building blocks (private to the finance group)
- **marts**: the tables people use: `fct_orders`, `fct_monthly_revenue`, `dim_customers`, ...

Built with dbt Core 1.11 on DuckDB while studying for the dbt Analytics Engineering Certification.
{% enddocs %}

{% docs order_status %}
One of the following values:

| status         | meaning                                                   |
|----------------|-----------------------------------------------------------|
| placed         | The order is placed but not yet paid or shipped           |
| shipped        | The order has been shipped to the customer                |
| completed      | The order has been received by the customer               |
| return_pending | The customer asked to return the order                    |
| returned       | The order has been returned and refunded                  |
{% enddocs %}
