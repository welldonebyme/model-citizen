{#
    Print the number of rows of every model built as one of the given
    materializations. Run it with:
        dbt run-operation print_row_counts
        dbt run-operation print_row_counts --args '{materializations: [view]}'
#}
{% macro print_row_counts(materializations=['table', 'incremental']) %}

    {% if execute %}
        {% for node in graph.nodes.values()
              | selectattr('resource_type', 'equalto', 'model')
              | sort(attribute='name') %}
            {% if node.config.materialized in materializations %}
                {% set relation = adapter.get_relation(
                    database=node.database,
                    schema=node.schema,
                    identifier=node.alias) %}
                {% if relation is none %}
                    {{ log(node.name ~ ': not built yet', info=true) }}
                {% else %}
                    {% set result = run_query('select count(*) from ' ~ relation) %}
                    {{ log(node.name ~ ': ' ~ result.columns[0].values()[0] ~ ' rows', info=true) }}
                {% endif %}
            {% endif %}
        {% endfor %}
    {% endif %}

{% endmacro %}
