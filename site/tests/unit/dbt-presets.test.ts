// The generated presets (public/presets/dbt/, scripts/dbt/build-presets.mjs) are complete and consistent.
// Whether each one really prepares is checked with the engine: npm run dbt:verify-presets (long).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PresetIndex } from '../../src/lib/dbt/types';

const DIR = path.resolve(__dirname, '..', '..', 'public', 'presets', 'dbt');
const index: PresetIndex = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));

describe('dbt presets', () => {
  it('start and end of every chapter 6-25 and capstone milestone m00-m14', () => {
    const ids = index.presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let n = 6; n <= 25; n++) for (const s of ['start', 'end']) expect(ids).toContain(`ch${String(n).padStart(2, '0')}-${s}`);
    for (let n = 0; n <= 14; n++) for (const s of ['start', 'end']) expect(ids).toContain(`m${String(n).padStart(2, '0')}-${s}`);
  });

  it('the start of a chapter is the previous tag; every bundle and profile exists', () => {
    for (const p of index.presets) {
      const project = index.projects[p.project];
      expect(project, p.id).toBeTruthy();
      expect(project.profiles[p.profile], `${p.id} profile`).toBeTruthy();
      for (const rel of [project.practiceBundle, project.packagesBundle, ...(p.filesBundle ? [p.filesBundle] : [])]) {
        expect(fs.existsSync(path.join(DIR, rel)), `${p.id}: ${rel}`).toBe(true);
      }
      for (const st of p.steps) if ('checkout' in st) expect(fs.existsSync(path.join(DIR, st.bundle)), `${p.id}: ${st.bundle}`).toBe(true);
      const n = Number(p.id.replace(/^\D+/, '').slice(0, 2));
      const prefix = p.project === 'jaffle' ? 'ch' : 'm';
      const first = p.project === 'jaffle' ? 6 : 0;
      const expected = p.state === 'end' ? n : n === first ? null : n - 1;
      expect(p.filesTag, p.id).toBe(expected == null ? null : `${prefix}${String(expected).padStart(2, '0')}`);
      expect(p.steps.length).toBeGreaterThan(0);
      expect(p.summary.length).toBeGreaterThan(1);
    }
  });

  it('follows the book: fresh-database rule from ch19, day 2 from ch13 end, production from ch23 end', () => {
    const steps = (id: string) => index.presets.find((p) => p.id === id)!.steps.map((s) => ('run' in s ? s.run : `checkout ${s.checkout}`));
    expect(steps('ch18-end')).toContain('dbt build');
    expect(steps('ch19-end')).toContain('dbt build --exclude-resource-type unit_test');
    expect(steps('ch19-end')).not.toContain('dbt build');
    expect(steps('ch13-start')).not.toContain('duckdb practice.duckdb < updates/day2.sql');
    expect(steps('ch13-end')).toContain('duckdb practice.duckdb < updates/day2.sql');
    expect(steps('ch14-start').at(-2)).toBe('duckdb practice.duckdb < setup.sql'); // reset to day 1 as Chapter 14 starts
    expect(steps('ch22-end').filter((s) => s.endsWith('fresh_load.sql'))).toHaveLength(2);
    expect(steps('ch23-start').some((s) => s.includes('--target prod'))).toBe(false);
    expect(steps('ch23-end')).toContain('cp target/manifest.json target/run_results.json prod-artifacts/');
    expect(steps('m13-end')).toContain('dbt build --target prod --selector nightly');
    expect(index.presets.find((p) => p.id === 'ch15-end')!.python).toBe(true);
    expect(index.presets.find((p) => p.id === 'ch14-end')!.python).toBe(false);
  });

  it('profiles come from the golden logs (dev and prod; ci from Chapter 24)', () => {
    const j = index.projects.jaffle.profiles;
    expect(j.ch06).toContain('path: ../practice/practice.duckdb');
    expect(j.ch10).toContain("env_var('DBT_DUCKDB_PATH', '../practice/practice.duckdb')");
    expect(j.ch24).toContain('schema: dbt_ci');
    expect(index.projects.shopflow.profiles.m00).toContain('shopflow:');
  });
});
