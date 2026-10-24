import pandas as pd


def model(dbt, session):
    # configs can be set here (like config() in SQL) or in a properties file
    dbt.config(materialized="table")

    # dbt.ref() returns a DuckDB relation; .df() turns it into a pandas DataFrame
    customers = dbt.ref("dim_customers").df()

    def segment(row):
        if row["number_of_orders"] == 0:
            return "no orders"
        if row["number_of_orders"] >= 4 or row["lifetime_value"] >= 100:
            return "loyal"
        if row["number_of_orders"] >= 2:
            return "regular"
        return "new"

    customers["segment"] = customers.apply(segment, axis=1)

    # value tier: quartiles of lifetime value among customers who ordered
    buyers = customers["number_of_orders"] > 0
    customers["value_tier"] = "none"
    if buyers.sum() >= 4:  # qcut needs data: an empty input (dbt build --empty) must not crash
        customers.loc[buyers, "value_tier"] = pd.qcut(
            customers.loc[buyers, "lifetime_value"].rank(method="first"),
            q=4,
            labels=["bronze", "silver", "gold", "platinum"],
        ).astype(str)

    return customers[
        ["customer_id", "country", "number_of_orders", "lifetime_value", "segment", "value_tier"]
    ]
