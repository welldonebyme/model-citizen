{#
    Convert an integer amount in cents into dollars, as an exact decimal.
    Example: {{ cents_to_dollars('amount') }}  ->  cast(amount / 100 as decimal(16, 2))
#}
{% macro cents_to_dollars(column_name, scale=2) -%}
    cast({{ column_name }} / 100 as decimal(16, {{ scale }}))
{%- endmacro %}
