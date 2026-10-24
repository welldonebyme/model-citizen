// CodeMirror 6 editor for the workspace files (SQL with Jinja, YAML, Python, plain text). Loaded on demand.
import { useEffect, useRef } from 'react';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, indentUnit } from '@codemirror/language';
import { sql, StandardSQL } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { python } from '@codemirror/lang-python';
import { tags as t } from '@lezer/highlight';

// colours come from the design tokens (light and dark)
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--tok-kw)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--tok-str)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--tok-num)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--tok-cmt)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--tok-fn)' },
  { tag: [t.propertyName, t.definition(t.propertyName), t.attributeName], color: 'var(--tok-key)' },
  { tag: [t.punctuation, t.separator, t.bracket], color: 'var(--tok-punct)' },
  { tag: t.typeName, color: 'var(--tok-fn)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--code-bg)', color: 'var(--code-ink)', fontSize: '0.875rem' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--muted)', border: 'none', borderRight: '1px solid var(--code-line)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent-soft) 45%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '&.cm-focused': { outline: '3px solid var(--focus)', outlineOffset: '-3px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--ink)' },
  '.cm-jinja': { color: 'var(--tok-jinja)', fontWeight: '600' },
  '.cm-jinja-comment, .cm-jinja-comment *': { color: 'var(--tok-cmt) !important', fontStyle: 'italic', fontWeight: '400 !important' },
  '.cm-matchingBracket': { outline: '1px solid var(--line-strong)' },
});

// Jinja blocks ({{ }}, {% %}, {# #}) drawn over the SQL highlighting
const jinjaMark = Decoration.mark({ class: 'cm-jinja' });
const jinjaComment = Decoration.mark({ class: 'cm-jinja-comment' });
const jinjaMarks = new MatchDecorator({
  regexp: /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g,
  decoration: (m) => (m[0].startsWith('{#') ? jinjaComment : jinjaMark),
});
const jinja = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = jinjaMarks.createDeco(view); }
  update(u: ViewUpdate) { this.decorations = jinjaMarks.updateDeco(u, this.decorations); }
}, { decorations: (v) => v.decorations });

export function languageFor(path: string): Extension {
  const p = path.toLowerCase();
  if (p.endsWith('.sql')) return [sql({ dialect: StandardSQL }), jinja];
  if (p.endsWith('.yml') || p.endsWith('.yaml')) return [yaml(), jinja];
  if (p.endsWith('.py')) return python();
  if (p.endsWith('.md')) return jinja;
  return [];
}

interface Props {
  path: string;
  text: string;
  readOnly?: boolean;
  onChange(text: string): void;
  onSave(): void;
  label: string;
}

export default function CodeEditor({ path, text, readOnly, onChange, onSave, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const ro = useRef(new Compartment());
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), indentOnInput(), bracketMatching(),
          indentUnit.of('  '), EditorState.tabSize.of(2),
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { cb.current.onSave(); return true; } }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          syntaxHighlighting(highlight), theme, lang.current.of(languageFor(path)), ro.current.of(EditorState.readOnly.of(!!readOnly)),
          // tabindex: the editable area is already in the tab order; saying it lets axe see the scroller is reachable
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', tabindex: '0' }),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // the editor is created once per file (the parent gives it a key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the file changed on disk (dbt rewrote it) and the learner has no unsaved change: show the new text
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
  }, [text]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(!!readOnly)) });
  }, [readOnly]);

  return <div className="dbt-cm" ref={host} />;
}
