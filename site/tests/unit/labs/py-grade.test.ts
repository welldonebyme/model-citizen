// Unit tests of the YAML / Jinja text comparison and graders (src/lib/py/grade.ts), and of the case files.
import { describe, expect, test } from 'vitest';
import { compareText, gradeJinja, gradeYaml, jinjaRequest, yamlRequest, type JinjaCase, type YamlCase } from '../../../src/lib/py/grade.ts';
import yamlCases from '../../../src/lib/py/cases/yaml-cases.json';
import jinjaCases from '../../../src/lib/py/cases/jinja-cases.json';
import yamlEx from '../../../src/lib/py/cases/yaml-exercises.json';
import jinjaEx from '../../../src/lib/py/cases/jinja-exercises.json';
import lock from '../../../src/lib/py/pyodide-lock.labs.json';

describe('compareText', () => {
  test('equal: exact, lines, ws', () => {
    expect(compareText('a\n  b', 'a\n  b')).toEqual({ exact: true, lines: true, ws: true });
    expect(compareText('a\nb', 'a  \n\nb ')).toEqual({ exact: false, lines: true, ws: true });
    expect(compareText('a b', 'a\nb')).toEqual({ exact: false, lines: false, ws: true });
    expect(compareText('a', 'b')).toEqual({ exact: false, lines: false, ws: false });
    expect(compareText('a', null)).toEqual({ exact: false, lines: false, ws: false });
  });
  test('within and segments', () => {
    expect(compareText('b\nc', 'a\nb\nc\nd', 'within')).toEqual({ exact: true, lines: true, ws: true });
    expect(compareText('x', 'a\nb', 'within').ws).toBe(false);
    expect(compareText('a\n...\nd', 'a\nb\nc\nd', 'segments')).toEqual({ exact: true, lines: true, ws: true });
    expect(compareText('d\n...\na', 'a\nb\nc\nd', 'segments').ws).toBe(false); // order counts
  });
});

describe('case files', () => {
  test('book cases', () => {
    expect(yamlCases.cases).toHaveLength(37);
    expect(jinjaCases.cases).toHaveLength(41);
    expect(new Set(yamlCases.cases.map((c) => c.id)).size).toBe(37);
    expect(new Set(jinjaCases.cases.map((c) => c.id)).size).toBe(41);
  });
  test('exercises have a start that differs from the solution', () => {
    for (const e of yamlEx.exercises) expect(e.start, e.id).not.toBe(e.solution);
    for (const e of jinjaEx.exercises.filter((x) => x.id !== 'source-compile' && x.id !== 'pivot-model')) {
      expect(e.template + (e.macros ?? ''), e.id).not.toBe(e.solution.template + (e.solution.macros ?? ''));
    }
  });
  test('the labs lock has exactly the 3 wheels', () => {
    expect(Object.keys(lock.packages).sort()).toEqual(['jinja2', 'markupsafe', 'pyyaml']);
    expect(lock.info.python).toBe('3.14.2');
  });
});

describe('graders', () => {
  const y = yamlCases.cases as unknown as YamlCase[];
  test('yaml request: path relative to the project, project fixture', () => {
    const c = y.find((x) => x.id === 'ch05-m2-nospace')!;
    expect(yamlRequest(c)).toMatchObject({ engine: 'dbt', path: 'models/staging/_stg_models.yml', project: 'ch05', project_name: 'jaffle_practice' });
  });
  test('yaml contains: phrases and position', () => {
    const c = y.find((x) => x.id === 'ch05-quiz2')!;
    const mark = { line: 10, column: 33, index: 0 };
    const base = { ok: false, engine: 'dbt' as const, libyaml: true, libyaml_version: '0.1.7', pyyaml_version: '6.0.3' };
    const err = { type: 'x', message: 'mapping values are not allowed in this context', context: null, problem: 'mapping values are not allowed in this context', context_mark: null, problem_mark: mark };
    expect(gradeYaml(c, { ...base, error: err }).passed).toBe(true);
    expect(gradeYaml(c, { ...base, error: { ...err, problem_mark: { ...mark, line: 9 } } }).passed).toBe(false);
    expect(gradeYaml(c, { ...base, ok: true }).passed).toBe(false);
  });
  test('jinja compiled: whitespace-insensitive pass, byte-exact reported', () => {
    const c = (jinjaCases.cases as unknown as JinjaCase[]).find((x) => x.id === 'ch05-plain-837')!;
    const book = String(c.expect.book);
    expect(gradeJinja(c, { status: 'ok', compiled: book, error: null }).byteExact).toBe(true);
    const g = gradeJinja(c, { status: 'ok', compiled: book.replace(/\n/g, '\n\n'), error: null });
    expect(g.passed).toBe(true);
    expect(g.byteExact).toBe(false);
    expect(gradeJinja(c, { status: 'ok', compiled: book + ',', error: null }).passed).toBe(false);
    expect(jinjaRequest(c)).toMatchObject({ mode: 'plain', project: 'ch11' });
  });
  test('jinja error: phrase and phase', () => {
    const c = (jinjaCases.cases as unknown as JinjaCase[]).find((x) => x.id === 'ch11-run-query-no-guard')!;
    const err = { phase: 'parse', message: "'None' has no attribute 'table'" };
    expect(gradeJinja(c, { status: 'error', compiled: null, error: err }).passed).toBe(true);
    expect(gradeJinja(c, { status: 'error', compiled: null, error: { ...err, phase: 'execute' } }).passed).toBe(false);
  });
});
