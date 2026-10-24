{#
    Compare the refactored fct_monthly_revenue with the legacy SQL of Chapter 9,
    using the audit_helper package. Run it with:
        dbt show --select audit_fct_monthly_revenue
#}

{% set legacy_query %}
SELECT DATE_TRUNC('month', X.ORDER_DATE) AS ORDER_MONTH, C.COUNTRY,
COUNT(*) AS NUMBER_OF_ORDERS, SUM(X.PAID_CENTS) / 100 AS REVENUE
FROM (SELECT O.ID, O.USER_ID, O.ORDER_DATE,
        COALESCE((SELECT SUM(P.AMOUNT) FROM PRACTICE.STRIPE.PAYMENTS P
                  WHERE P.ORDERID = O.ID AND P.STATUS = 'success'), 0) AS PAID_CENTS
      FROM PRACTICE.JAFFLE_SHOP.ORDERS O
      WHERE O.STATUS NOT IN ('returned', 'return_pending')) X
LEFT JOIN (SELECT ID, COUNTRY FROM PRACTICE.JAFFLE_SHOP.CUSTOMERS) C ON C.ID = X.USER_ID
GROUP BY 1, 2
{% endset %}

{% set refactored_query %}
select order_month, country, number_of_orders, revenue
from {{ ref('fct_monthly_revenue') }}
{% endset %}

{{ audit_helper.compare_queries(
    a_query=legacy_query,
    b_query=refactored_query,
    summarize=true
) }}
