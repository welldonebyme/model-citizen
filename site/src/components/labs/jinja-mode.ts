/**
 * A small CodeMirror stream mode for dbt files: SQL with Jinja ({{ }}, {% %}, {# #}). Light on purpose
 * (the official lang-jinja package pulls in the whole HTML language).
 */
import type { StreamParser } from '@codemirror/language';

const SQL_KW = new Set(('select from where group by order having limit offset with as on join left right inner outer full cross union all ' +
  'distinct case when then else end and or not in is null like between exists insert into values update set delete create replace ' +
  'table view schema drop alter if cast over partition window qualify asc desc true false interval date timestamp using except intersect').split(' '));
const JINJA_KW = new Set(('if elif else endif for endfor in set endset macro endmacro call endcall filter endfilter raw endraw do ' +
  'not and or is true false none True False None loop return import from as with without context recursive').split(' '));

interface State { inJinja: null | 'expr' | 'stmt' | 'comment'; inString: string | null; inSqlComment: boolean }

export const jinjaSql: StreamParser<State> = {
  name: 'jinja-sql',
  startState: () => ({ inJinja: null, inString: null, inSqlComment: false }),
  token(stream, state) {
    if (state.inJinja === 'comment') {
      if (stream.skipTo('#}')) { stream.match('#}'); state.inJinja = null; } else stream.skipToEnd();
      return 'comment';
    }
    if (state.inJinja) {
      if (state.inString) {
        while (!stream.eol()) {
          const ch = stream.next();
          if (ch === '\\') { stream.next(); continue; }
          if (ch === state.inString) { state.inString = null; break; }
        }
        return 'string';
      }
      if (stream.match(state.inJinja === 'expr' ? /^-?\}\}/ : /^-?%\}/)) { state.inJinja = null; return 'meta'; }
      if (stream.eatSpace()) return null;
      const ch = stream.peek();
      if (ch === '"' || ch === "'") { stream.next(); state.inString = ch; return 'string'; }
      if (stream.match(/^\d+(\.\d+)?/)) return 'number';
      if (stream.match(/^[A-Za-z_][\w]*/)) {
        const w = stream.current();
        if (JINJA_KW.has(w)) return 'keyword';
        if (stream.peek() === '(') return 'variableName.function';
        return 'variableName';
      }
      stream.next();
      return 'punctuation';
    }
    if (state.inSqlComment) {
      if (stream.skipTo('*/')) { stream.match('*/'); state.inSqlComment = false; } else stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('{#')) { state.inJinja = 'comment'; return 'comment'; }
    if (stream.match(/^\{\{-?/)) { state.inJinja = 'expr'; return 'meta'; }
    if (stream.match(/^\{%-?/)) { state.inJinja = 'stmt'; return 'meta'; }
    if (stream.match('--')) {
      // a SQL comment, but Jinja inside it is still rendered: stop at the next tag
      while (!stream.eol() && !stream.match(/^\{[{%#]/, false)) stream.next();
      return 'comment';
    }
    if (stream.match('/*')) { state.inSqlComment = true; return 'comment'; }
    if (stream.match(/^'([^']|'')*'?/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    if (stream.match(/^[A-Za-z_][\w$]*/)) {
      const w = stream.current().toLowerCase();
      if (SQL_KW.has(w)) return 'keyword';
      if (stream.peek() === '(') return 'variableName.function';
      return null;
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '--', block: { open: '/*', close: '*/' } } },
};
