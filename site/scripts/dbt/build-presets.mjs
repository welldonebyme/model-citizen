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
const CAPSTONE = path.join(LABS, 'capstone');
const SHOP_REPO = path.join(CAPSTONE, 'shopflow_dbt');
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

// ---- the ShopFlow capstone (Chapter 26, milestones m00..m14) ----------------------------------------------------------
// Data timeline (reference/capstone-logs/README.md): fresh_load in m01, day2 in m08 (snapshots before and after),
// day3 in m09, fresh_load again in m14. Production is built in m13 from main BEFORE the feature (code of m12) with
// --selector nightly, and its artifacts are saved in prod-artifacts/.
const mtag = (n) => `m${String(n).padStart(2, '0')}`;
const CD_DATA = 'cd ~/dbt-course/shopflow-data';
const CD_SHOP = 'cd ~/dbt-course/shopflow_dbt';
const SHOP_SETUP = 'duckdb shopflow.duckdb < setup.sql';
const shopData_ = (n, state) => {
  const end = state === 'end';
  return { fresh1: (end && n >= 1) || n >= 2, day2: (end && n >= 8) || n >= 9, day3: (end && n >= 9) || n >= 10, fresh2: end && n >= 14 };
};
const shopProd = (n, state) => (state === 'end' ? n >= 13 : n >= 14);

// "main before the feature" (m13 log): the files of m13 (selectors.yml with `nightly`, the ci target) with the
// models of m12 (fct_sessions without is_bounce). Production is built from it; the feature then shows in state:modified.
const PROD_BASE = { checkout: 'm13-before-feature', bundle: 'shopflow/files-m13-before-feature.json', label: 'm13 without the feature: fct_sessions without is_bounce (main before the feature)' };

function shopSteps(filesN, data, prod, info) {
  const steps = [{ run: CD_DATA }, { run: SHOP_SETUP }];
  if (data.fresh1) steps.push({ run: 'duckdb shopflow.duckdb < updates/fresh_load.sql' });
  if (filesN == null) return steps;
  // with production, the history is built on "main before the feature", then the files move on
  const hist = prod ? info.m13 : info[mtag(filesN)];
  const buildFor = (t) => (t.unitTests ? 'dbt build --exclude-resource-type unit_test' : 'dbt build');
  steps.push(prod ? { ...PROD_BASE } : { checkout: mtag(filesN), bundle: `shopflow/files-${mtag(filesN)}.json` }, { run: CD_SHOP });
  if (hist.packages) steps.push({ run: 'dbt deps' });
  if (data.day2 && hist.snapshots) steps.push({ run: 'dbt snapshot' }); // day 1 version
  if (data.day2) steps.push({ run: CD_DATA }, { run: 'duckdb shopflow.duckdb < updates/day2.sql' }, { run: CD_SHOP });
  if (data.day3 && hist.snapshots) steps.push({ run: 'dbt snapshot' }); // day 2 version
  if (data.day3) steps.push({ run: CD_DATA }, { run: 'duckdb shopflow.duckdb < updates/day3.sql' }, { run: CD_SHOP });
  if (prod) {
    steps.push({ run: 'dbt build --target prod --selector nightly' }, { run: 'mkdir -p prod-artifacts' },
      { run: 'cp target/manifest.json target/run_results.json prod-artifacts/' },
      { checkout: mtag(filesN), bundle: `shopflow/files-${mtag(filesN)}.json` });
  }
  // m14's fresh load comes after the production build of m13
  if (data.fresh2) steps.push({ run: CD_DATA }, { run: 'duckdb shopflow.duckdb < updates/fresh_load.sql' }, { run: CD_SHOP });
  steps.push({ run: buildFor(info[mtag(filesN)]) });
  return steps;
}

function tagFacts(entries) {
  const names = entries.map((e) => e.name);
  return {
    files: names.length,
    packages: names.includes('packages.yml'),
    python: names.some((n) => n.startsWith('models/') && n.endsWith('.py')),
    snapshots: names.some((n) => n.startsWith('snapshots/') && /\.(yml|sql)$/.test(n)),
    unitTests: entries.some((e) => /\.ya?ml$/.test(e.name) && /^unit_tests:/m.test(e.data.toString('utf8'))),
  };
}

function finishPreset(preset, extra) {
  preset.hash = sha256(Buffer.from(JSON.stringify([preset, ...extra]))).slice(0, 12);
  return preset;
}

async function main() {
  if (!fs.existsSync(JAFFLE_REPO)) throw new Error(`reference repository not found: ${JAFFLE_REPO} (set DBT_BIBLE)`);
  const titles = chapterTitles();

  // dbt packages, pre-installed (dbt deps cannot reach hub.getdbt.com from a web page: no CORS); shared by both projects
  const pkgFiles = [];
  for (const p of PACKAGES) {
    const entries = readTar(await pinnedDownload(p), { gzip: true });
    for (const e of entries) pkgFiles.push({ name: p.name + '/' + e.name.split('/').slice(1).join('/'), data: e.data });
  }
  const packagesBundle = writeJson('packages.json', {
    packages: PACKAGES.map(({ name, package: pkg, version }) => ({ name, package: pkg, version })),
    files: encodeFiles(pkgFiles),
  });
  const pkgList = PACKAGES.map(({ name, package: pkg, version }) => ({ name, package: pkg, version }));

  // ---- jaffle_dbt ----
  const practice = [{ name: 'setup.sql', data: fs.readFileSync(path.join(LABS, 'setup.sql')) }];
  for (const f of fs.readdirSync(path.join(LABS, 'data')).filter((f) => f.endsWith('.csv'))) practice.push({ name: 'data/' + f, data: fs.readFileSync(path.join(LABS, 'data', f)) });
  for (const f of fs.readdirSync(path.join(LABS, 'updates')).filter((f) => /\.(sql|md)$/.test(f))) practice.push({ name: 'updates/' + f, data: fs.readFileSync(path.join(LABS, 'updates', f)) });
  const practiceBundle = writeJson('jaffle/practice.json', { files: encodeFiles(practice) });
  const profiles = {
    ch06: goldenOutput('ch06.md', 'cat ~/.dbt/profiles.yml'),
    ch10: goldenOutput('ch10.md', 'cat ~/.dbt/profiles.yml'),
    ch24: goldenOutput('ch24.md', 'cat ~/.dbt/profiles.yml'),
  };
  const tags = execFileSync('git', ['-C', JAFFLE_REPO, 'tag', '--list', 'ch*'], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  const tagInfo = {};
  for (const t of tags) {
    const entries = gitTagFiles(JAFFLE_REPO, t);
    tagInfo[t] = { bundle: writeJson(`jaffle/files-${t}.json`, { tag: t, files: encodeFiles(entries) }), ...tagFacts(entries) };
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
      presets.push(finishPreset({
        id: `${tag(n)}-${state}`, project: 'jaffle', chapter: n, label: `Chapter ${n}`, state,
        title: `Chapter ${n}, ${state} of the labs`, chapterTitle: titles[n] ?? '',
        filesTag: t, filesBundle: info ? info.bundle.path : null, profile: profileAt(n, state),
        packages: !!info?.packages, python: !!info?.python, cwd: t ? '~/dbt-course/jaffle_dbt' : '~/dbt-course',
        summary, steps,
      }, [info?.bundle.sha256, practiceBundle.sha256, packagesBundle.sha256, profiles[profileAt(n, state)]]));
    }
  }

  // ---- ShopFlow capstone ----
  const projects = {
    jaffle: {
      title: 'jaffle_dbt, the practice project of Chapters 6 to 25', dir: 'jaffle_dbt', practiceDir: 'practice', database: 'practice.duckdb',
      practiceBundle: practiceBundle.path, packagesBundle: packagesBundle.path, packages: pkgList, profiles,
      onMachine: 'The reference repository has one git tag per chapter (ch06 to ch25).',
    },
  };
  if (fs.existsSync(SHOP_REPO)) {
    const shopData = [{ name: 'setup.sql', data: fs.readFileSync(path.join(CAPSTONE, 'setup.sql')) }];
    for (const f of fs.readdirSync(path.join(CAPSTONE, 'data')).filter((f) => f.endsWith('.csv'))) shopData.push({ name: 'data/' + f, data: fs.readFileSync(path.join(CAPSTONE, 'data', f)) });
    for (const f of fs.readdirSync(path.join(CAPSTONE, 'updates')).filter((f) => f.endsWith('.sql'))) shopData.push({ name: 'updates/' + f, data: fs.readFileSync(path.join(CAPSTONE, 'updates', f)) });
    const dataBundle = writeJson('shopflow/data.json', { files: encodeFiles(shopData) });
    const mtags = execFileSync('git', ['-C', SHOP_REPO, 'tag', '--list', 'm*'], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
    const minfo = {};
    const shopProfiles = {};
    const subject = {};
    for (const t of mtags) {
      const entries = gitTagFiles(SHOP_REPO, t);
      minfo[t] = { bundle: writeJson(`shopflow/files-${t}.json`, { tag: t, files: encodeFiles(entries) }), ...tagFacts(entries) };
      // ~/.dbt/profiles.yml = the jaffle_dbt profile (Chapter 24) + the shopflow block of profiles.example.yml at this tag
      const example = entries.find((e) => e.name === 'profiles.example.yml')?.data.toString('utf8') ?? '';
      const block = example.slice(Math.max(0, example.search(/^shopflow:/m)));
      const text = profiles.ch24.replace(/\n*$/, '\n\n') + block;
      const key = Object.keys(shopProfiles).find((k) => shopProfiles[k] === text) ?? t;
      shopProfiles[key] = text;
      minfo[t].profile = key;
      subject[t] = execFileSync('git', ['-C', SHOP_REPO, 'log', '-1', '--format=%s', t], { encoding: 'utf8' }).trim().replace(/^m\d\d:\s*/, '');
    }
    // the production base of m13 (see PROD_BASE)
    {
      const m12 = new Map(gitTagFiles(SHOP_REPO, 'm12').map((e) => [e.name, e.data]));
      const base = gitTagFiles(SHOP_REPO, 'm13').map((e) => (e.name.startsWith('models/') && m12.has(e.name) ? { name: e.name, data: m12.get(e.name) } : e))
        .filter((e) => !e.name.startsWith('models/') || m12.has(e.name));
      writeJson(PROD_BASE.bundle, { tag: PROD_BASE.checkout, files: encodeFiles(base) });
    }
    for (let n = 0; n <= 14; n++) {
      for (const state of ['start', 'end']) {
        const filesN = state === 'start' ? (n === 0 ? null : n - 1) : n;
        const t = filesN == null ? null : mtag(filesN);
        const info = t ? minfo[t] : null;
        const data = shopData_(n, state);
        const prod = shopProd(n, state) && filesN != null;
        const steps = shopSteps(filesN, data, prod, minfo);
        const dataText = ['Raw data of day 1 (setup.sql)'];
        if (data.fresh1) dataText.push('fresh_load.sql (m01)');
        if (data.day2) dataText.push('day2.sql (m08)');
        if (data.day3) dataText.push('day3.sql (m09)');
        if (data.fresh2) dataText.push('fresh_load.sql again (m14)');
        const summary = [
          t ? `Project files: the reference solution at tag ${t}${state === 'start' ? ` (the end of milestone ${t})` : ''}.` : 'No project yet: you create it with dbt init shopflow_dbt --skip-profile-setup.',
          `${dataText.join(', then ')}.${data.day2 && (prod ? minfo.m13 : info)?.snapshots ? ' Snapshots have their history.' : ''}`,
        ];
        if (t) summary.push(`Models already built with ${info.unitTests ? 'dbt build --exclude-resource-type unit_test' : 'dbt build'}${info.packages ? ' (dbt_utils installed from a saved copy)' : ''}.`);
        if (prod) summary.push('Production built from main before the feature (m13 without is_bounce) with --selector nightly, artifacts in prod-artifacts/.');
        const profileKey = (info ?? minfo.m00).profile;
        presets.push(finishPreset({
          id: `${mtag(n)}-${state}`, project: 'shopflow', chapter: 26, milestone: mtag(n), label: `Capstone ${mtag(n)}`, state,
          title: `Capstone milestone ${mtag(n)}, ${state}`, chapterTitle: subject[mtag(n)] ?? '',
          filesTag: t, filesBundle: info ? info.bundle.path : null, profile: profileKey,
          packages: !!info?.packages, python: !!info?.python || (prod && minfo.m13.python), cwd: t ? '~/dbt-course/shopflow_dbt' : '~/dbt-course',
          summary, steps,
        }, [info?.bundle.sha256, dataBundle.sha256, packagesBundle.sha256, shopProfiles[profileKey]]));
      }
    }
    projects.shopflow = {
      title: 'shopflow_dbt, the capstone of Chapter 26', dir: 'shopflow_dbt', practiceDir: 'shopflow-data', database: 'shopflow.duckdb',
      practiceBundle: dataBundle.path, packagesBundle: packagesBundle.path, packages: pkgList, profiles: shopProfiles,
      onMachine: 'The reference solution has one git tag per milestone (m00 to m14).',
    };
  } else {
    log('capstone repository not found, skipped:', SHOP_REPO);
  }

  writeJson('index.json', { $comment: 'Generated by scripts/dbt/build-presets.mjs. Do not edit by hand.', schema: 1, projects, presets });
  let total = 0;
  for (const d of ['jaffle', 'shopflow']) if (fs.existsSync(path.join(OUT, d))) for (const f of fs.readdirSync(path.join(OUT, d))) total += fs.statSync(path.join(OUT, d, f)).size;
  log(`${presets.length} presets, bundles ${(total / 1e6).toFixed(2)} MB + packages (before gzip)`);
}

main().catch((e) => {
  console.error('[dbt-presets] FAILED:', e.stack || e.message);
  process.exit(1);
});
