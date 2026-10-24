import { describe, expect, it } from 'vitest';
import { bashLines, commandsOnly } from '../../src/lib/highlight';

describe('shell prompts', () => {
  it('copies only the commands, whatever the prompt', () => {
    const block = ['(.venv) $ dbt build -s stg_orders', '12:00:01  Running with dbt=1.11.16', '$ git status', 'PS> dbt --version', 'PS C:\\Users\\amal> uv pip list', 'Done. PASS=3'].join('\n');
    expect(commandsOnly(block)).toBe(['dbt build -s stg_orders', 'git status', 'dbt --version', 'uv pip list'].join('\n'));
    expect(bashLines(block).map((l) => l.cmd)).toEqual([true, false, true, true, true, false]);
  });
  it('keeps a block without prompts as it is', () => {
    expect(commandsOnly('dbt run\ndbt test')).toBe('dbt run\ndbt test');
  });
  it('does not treat output in brackets as a prompt', () => {
    expect(bashLines('(2 rows)').map((l) => l.cmd)).toEqual([false]);
  });
});
