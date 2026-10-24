// Design review D1, D2, D4, D22: inline code wraps only at separators, figures get their sizes from their own
// text size, YAML and Jinja code of Chapters 5, 11 and 22 links to its playground, selector names keep their end.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeBreaks } from '../../src/components/content/Inline';
import { Blocks, figureSize, playgroundFor, PlaygroundContext } from '../../src/components/content/Blocks';
import { clipMiddle } from '../../src/components/selector/DagView';
import type { Block } from '../../src/lib/content-types';

const html = (v: string) => renderToStaticMarkup(createElement('code', null, codeBreaks(v)));
/** the pieces between break opportunities */
const parts = (v: string) => html(v).replace(/^<code>|<\/code>$/g, '').replace(/<span class="mc-nw">|<\/span>/g, '').split('<wbr/>');

describe('inline code: breaks only after a separator (D1)', () => {
  it('splits qualified names and paths after . / _ __ and keeps short tails whole', () => {
    expect(parts('analytics.crm.accounts_v2')).toEqual(['analytics.', 'crm.', 'accounts_v2']);
    expect(parts('analytics.dbt_adnane.accounts_v2')).toEqual(['analytics.', 'dbt_', 'adnane.', 'accounts_v2']);
    expect(parts('stg_jaffle_shop__orders')).toEqual(['stg_', 'jaffle_', 'shop__', 'orders']);
    expect(parts('_jaffle_shop__sources.yml')).toEqual(['_jaffle_', 'shop__', 'sources.yml']);
    expect(parts('jaffle_dbt/models/example/schema.yml')).toEqual(['jaffle_', 'dbt/', 'models/', 'example/', 'schema.yml']);
  });
  it('never breaks inside a word, and keeps hyphenated options on one line', () => {
    for (const w of ['description', 'identifier', 'database', 'quoting', 'accounts_v2', 'name']) expect(parts(w)).toEqual([w]);
    expect(parts('data_tests')).toEqual(['data_', 'tests']);
    expect(html('dbt ls --resource-type source')).toBe('<code>dbt ls <span class="mc-nw">--resource-type</span> source</code>');
  });
  it('keeps the text unchanged', () => {
    const v = "dbt build --select state:modified+ --defer --state prod-artifacts source('jaffle_shop', 'orders')";
    expect(html(v).replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'")).toBe(v);
  });
});

describe('figures: sizes from the figure text (D2)', () => {
  const dir = 'src/generated/figures/';
  const svgs = readdirSync(dir).filter((f) => f.endsWith('.svg'));
  it('gives every book figure its sizes', () => {
    expect(svgs.length).toBeGreaterThan(0);
    for (const f of svgs) {
      const st = figureSize(readFileSync(dir + f, 'utf8')) as Record<string, string> | undefined;
      expect(st, f).toBeDefined();
      const book = Number(readFileSync(dir + f, 'utf8').match(/<svg\b[^>]*?\swidth="([\d.]+)"/)![1]);
      // never smaller than in the book, at most twice as large on a computer
      expect(parseFloat(st!['--fig-max']), f).toBeGreaterThanOrEqual(book);
      expect(parseFloat(st!['--fig-max']), f).toBeLessThanOrEqual(book * 2 + 1);
      expect(parseFloat(st!['--fig-phone']), f).toBeGreaterThanOrEqual(book);
    }
  });
  it('draws a PDF-size figure with 5-unit text at 12 px text on a phone', () => {
    const st = figureSize('<svg viewBox="0 0 448.92 171.23" width="599" height="228"><text font-size="5.021">a</text></svg>') as Record<string, string>;
    expect(st['--fig-phone']).toBe(`${Math.round((448.92 * 12) / 5.021)}px`);
  });
});

describe('playground links (D4)', () => {
  const code = (id: string, lang: string, text = 'x'): Block => ({ t: 'code', id, lang, text } as Block);
  it('links YAML of Chapters 5 and 22 and Jinja of Chapters 5 and 11', () => {
    expect(playgroundFor(code('ch05-c11', 'yaml'))?.href).toBe('labs/yaml/');
    expect(playgroundFor(code('ch22-c7', 'yaml'))?.href).toBe('labs/yaml/');
    expect(playgroundFor(code('ch05-c37', 'jinja', '{% for x in y %}'))?.href).toBe('labs/jinja/');
    expect(playgroundFor(code('ch11-c22', 'dbt', "{{ cents_to_dollars('amount') }}"))?.href).toBe('labs/jinja/');
    expect(playgroundFor(code('ch11-c3', 'dbt', 'select 1'))).toBeUndefined();
    expect(playgroundFor(code('ch07-c3', 'yaml'))).toBeUndefined();
  });
  it('shows the link on static pages only', () => {
    const blocks = [code('ch05-c11', 'yaml')];
    expect(renderToStaticMarkup(createElement(Blocks, { blocks }))).not.toContain('labs/yaml/');
    expect(renderToStaticMarkup(createElement(PlaygroundContext.Provider, { value: true }, createElement(Blocks, { blocks })))).toContain('Try in the YAML playground');
  });
});

describe('selector graph names keep their end (D22)', () => {
  it('cuts the middle', () => {
    expect(clipMiddle('stg_jaffle_shop__order_items', 24)).toBe('stg_jaffle…__order_items');
    expect(clipMiddle('stg_jaffle_shop__customers', 24)).toBe('stg_jaffle_…__customers');
    expect(clipMiddle('stg_jaffle_shop__orders', 24)).toBe('stg_jaffle_shop__orders');
    expect(clipMiddle('int_orders__payment_methods_pivoted', 24).endsWith('_pivoted')).toBe(true);
    for (const n of ['stg_jaffle_shop__order_items', 'int_orders__payment_methods_pivoted', 'x'.repeat(80)]) expect(clipMiddle(n, 24).length).toBeLessThanOrEqual(24);
  });
});
