{#
    Custom generic test: fails for every row where the column is not positive.
    Use allow_zero: true to accept 0 (for example an order that is not paid yet).
#}
{% test is_positive(model, column_name, allow_zero=false) %}

select *
from {{ model }}
where {{ column_name }} {{ '<' if allow_zero else '<=' }} 0

{% endtest %}
