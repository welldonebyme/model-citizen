/** Where dbt 1.11.16 differs from the documentation (or surprises), each with a command that shows it. */

export interface Fact {
  title: string;
  docs: string;
  real: string;
  exam: string;
  project: string;
  cmd: string;
  scenario?: string;
  demo?: boolean;
}

export const FACTS: Fact[] = [
  {
    title: 'A comma followed by a space',
    docs: '"a,b" is an intersection.',
    real: '"tag:finance, tag:marketing" is two items: "tag:finance," (it matches nothing, with a warning) and "tag:marketing". Only the second one counts.',
    exam: 'Never put a space after the comma.',
    project: 'jaffle-ch16', cmd: 'dbt ls -s "tag:finance, tag:marketing" --resource-type model',
  },
  {
    title: 'A bare word never matches a source',
    docs: 'A bare word uses the fqn: method.',
    real: 'fqn: looks at models, tests, seeds, snapshots, analyses, exposures and unit tests, never at sources. "orders" selects nothing.',
    exam: 'Use source:jaffle_shop.orders for a source.',
    project: 'jaffle-ch16', cmd: 'dbt ls -s orders',
  },
  {
    title: 'The selector: method',
    docs: 'The current docs show selector:<name> inside --select.',
    real: 'It arrived in dbt 1.12. In 1.11 dbt stops: \'selector\' is not a valid method name.',
    exam: 'Use --selector <name>.',
    project: 'jaffle-ch16', cmd: 'dbt ls -s selector:nightly',
  },
  {
    title: '--selector ignores --select and --exclude',
    docs: '(1.12 prints a warning and adds the selector: method.)',
    real: 'With --selector, dbt 1.11 ignores --select and --exclude without any message.',
    exam: 'In 1.11 only the YAML selector counts.',
    project: 'jaffle-ch16', cmd: 'dbt ls --selector finance_marts --select dim_customers --exclude fct_orders',
  },
  {
    title: 'A CLI-style string in selectors.yml',
    docs: 'A string definition can use spaces (union) and commas (intersection).',
    real: 'In 1.11.16 the whole string is ONE criterion: \'tag:finance+ tag:marketing+\' selects nothing, with no error. Graph operators (+x, @x) work.',
    exam: 'Use the union: and intersection: keys.',
    project: 'jaffle-ch16', cmd: 'dbt ls --selector cli_union --resource-type model', demo: true,
  },
  {
    title: '1+result:fail+',
    docs: 'Re-runs the models of the failed tests and everything downstream.',
    real: 'A test has no children: the last + adds nothing. You get the failed test and the models it checks, nothing below them.',
    exam: 'Accept the docs\' description; in practice add result:skipped or use dbt retry.',
    project: 'jaffle-ch24', cmd: 'dbt ls -s 1+result:fail+ --state ../last_run --resource-type model', scenario: 'ch24-test-fail',
  },
  {
    title: 'A failed test is not an error',
    docs: 'result:error re-runs what failed.',
    real: 'Models end with error, tests end with fail. After a build where only a test failed, result:error+ selects nothing.',
    exam: 'result:fail for tests, result:error for models.',
    project: 'jaffle-ch24', cmd: 'dbt ls -s result:error+ --state ../last_run', scenario: 'ch24-test-fail',
  },
  {
    title: 'group and meta changes, state:modified',
    docs: 'meta is not compared; a group change can flag the node.',
    real: 'meta changes are detected (modified.configs) and a group change is ignored.',
    exam: 'Use tags as the "not detected" example; do not rely on group or meta.',
    project: 'jaffle-ch24', cmd: 'dbt ls -s state:modified --state prod-artifacts --exclude fct_monthly_revenue', scenario: 'ch24-group',
  },
  {
    title: 'A new exposure (or source) is not state:modified',
    docs: 'state:modified = new nodes + changed nodes.',
    real: 'In 1.11.16 a new exposure or source is state:new, but also state:unmodified, and NOT state:modified (real comparison of tag ch21 with tag ch20).',
    exam: 'Answer the docs\' rule: modified includes new nodes.',
    project: 'jaffle-ch21', cmd: 'dbt ls -s state:modified --state ../state --resource-type exposure', scenario: 'prev-tag',
  },
];

interface Props {
  onTry: (f: Fact) => void;
}

export default function Facts({ onTry }: Props) {
  return (
    <section className="msl-panel msl-pad" aria-labelledby="msl-facts-h">
      <details>
        <summary><h2 id="msl-facts-h" style={{ display: 'inline', fontSize: 'var(--fs-md)' }}>Where dbt 1.11.16 differs from the documentation</h2></summary>
        <p className="msl-small msl-muted" style={{ margin: '8px 0 12px' }}>The exam follows the documentation. Real dbt 1.11.16 does these things differently: learn both. Each "Try it" runs a command that shows it.</p>
        <ul className="msl-facts">
          {FACTS.map((f) => (
            <li key={f.title}>
              <h3>{f.title}</h3>
              <p><b>Docs:</b> {f.docs}</p>
              <p><b>dbt 1.11.16:</b> {f.real}</p>
              <p><b>For the exam:</b> {f.exam}</p>
              <button type="button" className="msl-btn msl-btn-small" onClick={() => onTry(f)}>Try it: <code className="msl-mono">{f.cmd.replace(/^dbt /, '')}</code></button>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
