## What does this pull request change?

<!-- One or two sentences: which models, and why. -->

## How was it tested?

- [ ] `dbt build --select state:modified+` passes locally (dev)
- [ ] New or changed models have tests (data tests and, for logic, unit tests)
- [ ] Descriptions are up to date (`dbt docs generate` works)
- [ ] I compared the results with production when a model changed
      (for example with `audit_helper` or `except` queries)

## Impact

- [ ] Breaking change for downstream users? (contract, column removed or renamed)
      If yes: new model version, deprecation_date on the old one
- [ ] Exposures (dashboards, notebooks) affected:

## Checklist

- [ ] The CI job is green
- [ ] Naming follows the project conventions (stg_ / int_ / fct_ / dim_)
