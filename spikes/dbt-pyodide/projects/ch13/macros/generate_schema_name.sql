{#
    Common dev/prod pattern:
    - prod target: use the custom schema as it is (marts -> marts),
      or the target schema when the model has no custom schema (-> prod)
    - any other target (dev, ci...): everything goes to the target schema
      (dbt_adnane), so each developer keeps one personal schema
#}
{% macro generate_schema_name(custom_schema_name, node) -%}

    {%- set default_schema = target.schema -%}

    {%- if target.name == 'prod' and custom_schema_name is not none -%}

        {{ custom_schema_name | trim }}

    {%- else -%}

        {{ default_schema }}

    {%- endif -%}

{%- endmacro %}
