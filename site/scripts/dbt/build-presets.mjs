#!/usr/bin/env node
// Generate the lab presets of "dbt in the browser" into public/presets/dbt/ (committed: small text files).
//
// A preset = the state of the learner's workspace at the START or the END of a chapter's labs:
//   - the project files (reference repository at a git tag; start of chapter N = tag of chapter N-1),
//   - ~/.dbt/profiles.yml as the book has it at that moment (copied from the golden logs),
//   - the practice database, prepared IN THE BROWSER by real commands (setup.sql, day2.sql, fresh_load.sql,
//     dbt build ...) listed in `steps`, so the learner can see exactly how the state was made.
//
// Inputs (local, read-only): the reference repository (git tags, read with `git archive`), the practice kit
// (labs/setup.sql, data/, updates/), the golden logs (profiles), and the dbt packages (GitHub tarballs pinned by
// sha256, the same files `dbt deps` installs).
//
// Usage: node scripts/dbt/build-presets.mjs        (needs ../dbt-bible next to the repository, and the network
//        once for the two package tarballs, cached in .cache/dbt-presets/)
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTar } from './tar.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..', '..');
const ACADEMY = path.resolve(SITE, '..');
const BIBLE = process.env.DBT_BIBLE || path.resolve(ACADEMY, '..', 'dbt-bible');
const LABS = path.join(BIBLE, 'labs');
const JAFFLE_REPO = path.join(LABS, 'practice-project', 'jaffle_dbt');
const GOLDEN = path.join(ACADEMY, 'reference', 'builder-logs');
const OUT = path.join(SITE, 'public', 'presets', 'dbt');
const CACHE = path.join(SITE, '.cache', 'dbt-presets');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log('[dbt-presets]', ...a);

// ---- dbt packages: the exact tarballs `dbt deps` downloads for package-lock.yml (hub -> GitHub codeload) ----------
const PACKAGES = [
  { name: 'dbt_utils', package: 'dbt-labs/dbt_utils', version: '1.4.1', url: 'https://codeload.github.com/dbt-labs/dbt-utils/tar.gz/1.4.1', sha256: '31cd5d8a8b14ab8030d55c4f70a7e7a2e15e6005cc3dcf075021dd5667d78b5a' },
  { name: 'audit_helper', package: 'dbt-labs/audit_helper', version: '0.14.0', url: 'https://codeload.github.com/dbt-labs/dbt-audit-helper/tar.gz/0.14.0', sha256: '24014beba8a0789ed6933857f534a717491669a20803ecc3f084c3d61add1f15' },
];

async function pinnedDownload({ url, sha256: want }) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, want.slice(0, 16) + '-' + url.split('/').slice(-3).join('-') + '.tgz');
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === want) return fs.readFileSync(file);
  log('downloading', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== want) throw new Error(`sha256 mismatch for ${url}: ${sha256(buf)}`);
  fs.writeFileSync(file, buf);
  return buf;
}

// ---- bundles -------------------------------------------------------------------------------------------------
/** { path: text } or { path: { b64 } } for files that are not valid UTF-8. */
function encodeFiles(entries) {
  const files = {};
  for (const { name, data } of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const text = data.toString('utf8');
    files[name] = Buffer.from(text, 'utf8').equals(data) ? text : { b64: data.toString('base64') };
  }
  return files;
}

function writeJson(rel, obj) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(obj) + '\n';
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
  return { path: rel, bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text)).slice(0, 16) };
}

function gitTagFiles(repo, tag) {
  const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', tag], { maxBuffer: 64 * 1024 * 1024 });
  return readTar(tar);
}

/** Text of the first ```text block after the line `$ <command>` in a golden log. */
function goldenOutput(file, command) {
  const text = fs.readFileSync(path.join(GOLDEN, file), 'utf8');
  const i = text.indexOf('$ ' + command + '\n');
  if (i < 0) throw new Error(`${file}: command not found: ${command}`);
  const m = text.slice(i).match(/```text\n([\s\S]*?)```/);
  if (!m) throw new Error(`${file}: no output after ${command}`);
  return m[1];
}

function chapterTitles() {
  const t = {};
  for (const f of fs.readdirSync(GOLDEN)) {
    const m = f.match(/^ch(\d\d)\.md$/);
    if (!m) continue;
    const first = fs.readFileSync(path.join(GOLDEN, f), 'utf8').split('\n')[0];
    const mm = first.match(/^# Chapter \d+ - (.*) \(tag ch\d\d\)$/);
    if (mm) t[Number(m[1])] = mm[1];
  }
  return t;
}

// ---- the jaffle_dbt practice project ----------------------------------------------------------------------------
const tag = (n) => `ch${String(n).padStart(2, '0')}`;
const CD_PRACTICE = 'cd ~/dbt-course/practice';
const CD_PROJECT = 'cd ~/dbt-course/jaffle_dbt';
const SETUP = 'duckdb practice.duckdb < setup.sql';
const DAY2 = 'duckdb practice.duckdb < updates/day2.sql';
const FRESH = 'duckdb practice.duckdb < updates/fresh_load.sql';
// From Chapter 19 on, a fresh database needs one build without unit tests first (docs/08-dbt-facts.md).
const build = (filesN) => (filesN >= 19 ? 'dbt build --exclude-resource-type unit_test' : 'dbt build');

/** Raw-data timeline of the book (reference/builder-logs/INDEX.md). */
function dataAt(n, state) {
  if (state === 'start') return n <= 13 ? 'day1' : n === 14 ? 'day1-after-day2' : n <= 21 ? 'day2' : 'fresh2';
  return n <= 12 ? 'day1' : n <= 20 ? 'day2' : 'fresh2';
}
const DATA_TEXT = {
  day1: 'Raw data of day 1 (setup.sql).',
  day2: 'Raw data of day 2 (setup.sql, then updates/day2.sql). Snapshots have their day 1 and day 2 versions.',
  'day1-after-day2': 'Raw data reset to day 1 (setup.sql again after day 2, as the chapter starts). The dbt tables and snapshots still have the day 2 rows.',
  fresh2: 'Raw data of day 2 plus 2 fresh loads (updates/fresh_load.sql twice, run when this workspace was prepared). Snapshots have their history.',
};
function profileAt(n, state) {
  if (state === 'start') return n <= 10 ? 'ch06' : n <= 23 ? 'ch10' : 'ch24';
  return n <= 9 ? 'ch06' : n <= 23 ? 'ch10' : 'ch24';
}
const prodAt = (n, state) => (state === 'start' ? n >= 24 : n >= 23);

function jaffleSteps(filesN, data, prod, hasPackages) {
  const steps = [{ run: CD_PRACTICE }, { run: SETUP }];
  if (filesN == null) return steps;
  steps.push({ checkout: tag(filesN), bundle: `jaffle/files-${tag(filesN)}.json` }, { run: CD_PROJECT });
  if (hasPackages) steps.push({ run: 'dbt deps' });
  const b = build(filesN);
  if (data === 'day1') {
    steps.push({ run: b });
    return steps;
  }
  if (filesN >= 13) steps.push({ run: 'dbt snapshot' }); // the day 1 version of the snapshots
  steps.push({ run: CD_PRACTICE }, { run: DAY2 });
  if (data === 'fresh2') steps.push({ run: FRESH }, { run: FRESH });
  steps.push({ run: CD_PROJECT });
  if (prod) {
    steps.push({ run: b + ' --target prod' }, { run: 'mkdir -p prod-artifacts' },
      { run: 'cp target/manifest.json target/run_results.json prod-artifacts/' });
  }
  steps.push({ run: b });
  if (data === 'day1-after-day2') steps.push({ run: CD_PRACTICE }, { run: SETUP }, { run: CD_PROJECT });
  return steps;
}

async function main() {
  if (!fs.existsSync(JAFFLE_REPO)) throw new Error(`reference repository not found: ${JAFFLE_REPO} (set DBT_BIBLE)`);
  const titles = chapterTitles();

  // practice kit (what the learner has in ~/dbt-course/practice)
  const practice = [{ name: 'setup.sql', data: fs.readFileSync(path.join(LABS, 'setup.sql')) }];
  for (const f of fs.readdirSync(path.join(LABS, 'data')).filter((f) => f.endsWith('.csv'))) practice.push({ name: 'data/' + f, data: fs.readFileSync(path.join(LABS, 'data', f)) });
  for (const f of fs.readdirSync(path.join(LABS, 'updates')).filter((f) => /\.(sql|md)$/.test(f))) practice.push({ name: 'updates/' + f, data: fs.readFileSync(path.join(LABS, 'updates', f)) });
  const practiceBundle = writeJson('jaffle/practice.json', { files: encodeFiles(practice) });

  // dbt packages, pre-installed (dbt deps cannot reach hub.getdbt.com from a web page: no CORS)
  const pkgFiles = [];
  for (const p of PACKAGES) {
    const entries = readTar(await pinnedDownload(p), { gzip: true });
    for (const e of entries) pkgFiles.push({ name: p.name + '/' + e.name.split('/').slice(1).join('/'), data: e.data });
  }
  const packagesBundle = writeJson('jaffle/packages.json', {
    packages: PACKAGES.map(({ name, package: pkg, version }) => ({ name, package: pkg, version })),
    files: encodeFiles(pkgFiles),
  });

  // profiles, exactly as the book shows them
  const profiles = {
    ch06: goldenOutput('ch06.md', 'cat ~/.dbt/profiles.yml'),
    ch10: goldenOutput('ch10.md', 'cat ~/.dbt/profiles.yml'),
    ch24: goldenOutput('ch24.md', 'cat ~/.dbt/profiles.yml'),
  };

  // project files per tag
  const tags = execFileSync('git', ['-C', JAFFLE_REPO, 'tag', '--list', 'ch*'], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  const tagInfo = {};
  for (const t of tags) {
    const entries = gitTagFiles(JAFFLE_REPO, t);
    const names = entries.map((e) => e.name);
    tagInfo[t] = {
      bundle: writeJson(`jaffle/files-${t}.json`, { tag: t, files: encodeFiles(entries) }),
      files: names.length,
      packages: names.includes('packages.yml'),
      python: names.some((n) => n.startsWith('models/') && n.endsWith('.py')),
      snapshots: names.some((n) => n.startsWith('snapshots/') && /\.(yml|sql)$/.test(n)),
    };
  }

  const presets = [];
  for (let n = 6; n <= 25; n++) {
    for (const state of ['start', 'end']) {
      const filesN = state === 'start' ? (n === 6 ? null : n - 1) : n;
      const t = filesN == null ? null : tag(filesN);
      if (t && !tagInfo[t]) throw new Error(`missing tag ${t}`);
      const info = t ? tagInfo[t] : null;
      const data = dataAt(n, state);
      const prod = prodAt(n, state) && filesN != null;
      const steps = jaffleSteps(filesN, data, prod, !!info?.packages);
      const summary = [];
      summary.push(t ? `Project files: the reference project at tag ${t}${state === 'start' ? ` (the end of Chapter ${filesN})` : ''}.` : 'No project yet: you create it with dbt init jaffle_dbt --skip-profile-setup.');
      summary.push(DATA_TEXT[data]);
      if (t) summary.push(`Models already built with ${build(filesN)}${info.packages ? ' (packages installed from a saved copy)' : ''}.`);
      if (prod) summary.push('Production built (--target prod) and its artifacts saved in prod-artifacts/.');
      summary.push(`Profile ~/.dbt/profiles.yml as in Chapter ${Number(profileAt(n, state).slice(2))}.`);
      const preset = {
        id: `${tag(n)}-${state}`,
        project: 'jaffle',
        chapter: n,
        state,
        title: `Chapter ${n}, ${state === 'start' ? 'start' : 'end'} of the labs`,
        chapterTitle: titles[n] ?? '',
        filesTag: t,
        filesBundle: info ? info.bundle.path : null,
        profile: profileAt(n, state),
        packages: !!info?.packages,
        python: !!info?.python,
        cwd: t ? '~/dbt-course/jaffle_dbt' : '~/dbt-course',
        summary,
        steps,
      };
      preset.hash = sha256(Buffer.from(JSON.stringify([preset, info?.bundle.sha256, practiceBundle.sha256, packagesBundle.sha256, profiles[preset.profile]]))).slice(0, 12);
      presets.push(preset);
    }
  }

  const index = {
    $comment: 'Generated by scripts/dbt/build-presets.mjs. Do not edit by hand.',
    schema: 1,
    projects: {
      jaffle: {
        title: 'jaffle_dbt, the practice project of Chapters 6 to 25',
        dir: 'jaffle_dbt',
        practiceDir: 'practice',
        database: 'practice.duckdb',
        practiceBundle: practiceBundle.path,
        packagesBundle: packagesBundle.path,
        packages: PACKAGES.map(({ name, package: pkg, version }) => ({ name, package: pkg, version })),
        profiles,
        onMachine: 'The reference repository has one git tag per chapter (ch06 to ch25).',
      },
    },
    presets,
  };
  writeJson('index.json', index);
  const total = fs.readdirSync(path.join(OUT, 'jaffle')).reduce((s, f) => s + fs.statSync(path.join(OUT, 'jaffle', f)).size, 0);
  log(`${presets.length} presets, ${tags.length} tags, bundles ${(total / 1e6).toFixed(2)} MB (before gzip)`);
}

main().catch((e) => {
  console.error('[dbt-presets] FAILED:', e.stack || e.message);
  process.exit(1);
});
