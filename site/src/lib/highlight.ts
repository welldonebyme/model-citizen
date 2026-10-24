// Build-time syntax highlighting for the book's code languages. Deterministic, dependency-free,
// output is HTML with <span class="tok-*"> classes styled by CSS variables (light and dark themes).

export type Lang = 'sql' | 'dbt' | 'yaml' | 'jinja' | 'python' | 'bash' | 'output' | 'plain';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, s: string) => (s ? `<span class="tok-${cls}">${esc(s)}</span>` : '');

const SQL_KW = new Set(
  `select from where and or not in is null as with join left right inner outer full cross on using group by order
  having limit offset union all distinct case when then else end create table view replace insert into values update
  set delete drop alter add column primary key unique references default if exists over partition window rows range
  unbounded preceding following current row qualify asc desc nulls first last between like ilike true false cast
  interval merge matched returning lateral filter within recursive schema describe show summarize pivot unpivot except
  intersect exclude temporary temp begin commit rollback grant to truncate natural`
    .split(/\s+/).filter(Boolean),
);
const SQL_FN = new Set(
  `count sum avg min max coalesce nullif round abs date_trunc extract date_diff datediff date_part strftime
  current_date current_timestamp now lag lead row_number rank dense_rank ntile first_value last_value string_agg
  list struct greatest least concat lower upper trim length substr substring replace split_part regexp_matches
  read_csv read_csv_auto try_cast md5 hash iff to_date to_timestamp epoch_ms make_date age generate_series unnest`
    .split(/\s+/).filter(Boolean),
);
const PY_KW = new Set(
  `def return import from as if elif else for while in not and or is None True False class with try except finally
  raise pass break continue lambda yield global nonlocal assert del async await`.split(/\s+/).filter(Boolean),
);
const JINJA_KW = new Set(
  `if elif else endif for endfor in set endset macro endmacro call endcall filter endfilter do return not and or is
  true false none True False None import from as include extends block endblock raw endraw materialization endmaterialization
  test endtest snapshot endsnapshot docs enddocs`.split(/\s+/).filter(Boolean),
);

function sqlTokens(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^--[^\n]*/))) { out += span('cmt', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^\/\*[\s\S]*?(\*\/|$)/))) { out += span('cmt', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^'(?:[^']|'')*'?/))) { out += span('str', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^"(?:[^"]|"")*"?/))) { out += esc(m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^\d+(?:\.\d+)?\b/))) { out += span('num', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/))) {
      const w = m[0];
      const lw = w.toLowerCase();
      const isCall = /^\s*\(/.test(src.slice(i + w.length));
      if (SQL_KW.has(lw)) out += span('kw', w);
      else if (isCall && SQL_FN.has(lw)) out += span('fn', w);
      else out += esc(w);
      i += w.length;
      continue;
    }
    out += esc(src[i]);
    i++;
  }
  return out;
}

function jinjaInner(src: string): string {
  // inside {{ }} / {% %}: keywords, strings, the rest plain
  return src
    .split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/)
    .map((part, k) => {
      if (k % 2 === 1) return span('str', part);
      return part.split(/(\b[A-Za-z_][A-Za-z0-9_]*\b)/).map((w, j) => (j % 2 === 1 && JINJA_KW.has(w) ? span('kw', w) : esc(w))).join('');
    })
    .join('');
}

/** SQL (or plain text) with Jinja segments: {{ }}, {% %}, {# #}. */
function withJinja(src: string, host: (s: string) => string): string {
  let out = '';
  const re = /(\{#[\s\S]*?#\})|(\{\{-?)([\s\S]*?)(-?\}\})|(\{%-?)([\s\S]*?)(-?%\})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out += host(src.slice(last, m.index));
    if (m[1]) out += span('cmt', m[1]);
    else if (m[2]) out += span('jinja', m[2]) + jinjaInner(m[3]) + span('jinja', m[4]);
    else out += span('jinja', m[5]) + jinjaInner(m[6]) + span('jinja', m[7]);
    last = m.index + m[0].length;
  }
  return out + host(src.slice(last));
}

function yamlLine(line: string): string {
  const cm = line.match(/^(.*?)(\s#.*|^#.*)$/);
  let body = line;
  let comment = '';
  if (cm && !/['"][^'"]*#/.test(cm[1] + cm[2].slice(0, 1))) { body = cm[1]; comment = cm[2]; }
  let out = '';
  const km = body.match(/^(\s*)(- )?([A-Za-z0-9_.+\-"' ]+?)(:)(\s|$)(.*)$/);
  if (km && !/^\s*- ['"]/.test(body)) {
    out += esc(km[1]) + (km[2] ? span('punct', '-') + ' ' : '') + span('key', km[3]) + span('punct', km[4]) + km[5] + yamlValue(km[6]);
  } else {
    const lm = body.match(/^(\s*)(- )(.*)$/);
    out += lm ? esc(lm[1]) + span('punct', '-') + ' ' + yamlValue(lm[3]) : yamlValue(body);
  }
  return out + span('cmt', comment);
}
function yamlValue(v: string): string {
  if (!v) return '';
  if (/^\s*(true|false|null|yes|no|~)\s*$/i.test(v)) return span('kw', v);
  if (/^\s*-?\d+(\.\d+)?\s*$/.test(v)) return span('num', v);
  if (/^\s*['"]/.test(v)) return withJinja(v, (s) => span('str', s));
  return withJinja(v, esc);
}

function pythonTokens(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^#[^\n]*/))) { out += span('cmt', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^("""[\s\S]*?("""|$)|'''[\s\S]*?('''|$)|[rfb]?"(?:[^"\\\n]|\\.)*"?|[rfb]?'(?:[^'\\\n]|\\.)*'?)/))) { out += span('str', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^\d+(?:\.\d+)?\b/))) { out += span('num', m[0]); i += m[0].length; continue; }
    if ((m = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/))) {
      const w = m[0];
      if (PY_KW.has(w)) out += span('kw', w);
      else if (/^\s*\(/.test(src.slice(i + w.length))) out += span('fn', w);
      else out += esc(w);
      i += w.length;
      continue;
    }
    out += esc(src[i]);
    i++;
  }
  return out;
}

function bashCommand(cmd: string): string {
  // command word, flags, strings, comments
  let out = '';
  const parts = cmd.split(/(\s+#.*$|'[^']*'?|"(?:[^"\\]|\\.)*"?|\s+)/);
  let first = true;
  for (const p of parts) {
    if (!p) continue;
    if (/^\s+#/.test(p)) out += span('cmt', p);
    else if (/^['"]/.test(p)) out += span('str', p);
    else if (/^\s+$/.test(p)) out += p;
    else if (first) { out += span('fn', p); first = false; }
    else if (/^--?[A-Za-z]/.test(p)) out += span('kw', p);
    else { out += esc(p); }
    if (/[|;&]$/.test(p) || p === '|' || p === '&&') first = true;
  }
  return out;
}

/** Shell blocks: lines starting with "$ " are commands; other lines are output. */
export function bashLines(text: string): { cmd: boolean; html: string }[] {
  return text.split('\n').map((line) => {
    const m = line.match(/^(\$|PS>|>)\s(.*)$/);
    if (m) return { cmd: true, html: `<span class="tok-prompt">${esc(m[1])}</span> ${bashCommand(m[2])}` };
    return { cmd: false, html: `<span class="tok-out">${esc(line)}</span>` };
  });
}

export function commandsOnly(text: string): string {
  const lines = text.split('\n');
  const cmds = lines.filter((l) => /^(\$|PS>)\s/.test(l)).map((l) => l.replace(/^(\$|PS>)\s/, ''));
  return cmds.length ? cmds.join('\n') : text;
}

export function highlight(lang: Lang, text: string): string {
  switch (lang) {
    case 'sql': return sqlTokens(text);
    case 'dbt': return withJinja(text, sqlTokens);
    case 'jinja': return withJinja(text, esc);
    case 'yaml': return text.split('\n').map(yamlLine).join('\n');
    case 'python': return pythonTokens(text);
    case 'bash': return bashLines(text).map((l) => l.html).join('\n');
    default: return esc(text);
  }
}
