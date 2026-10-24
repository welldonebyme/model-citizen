/**
 * CodeMirror 6 editor used by the SQL workspace and the YAML / Jinja playgrounds.
 *
 * - Server-side (and before hydration) it renders the text in a <pre>, so the code is readable at once.
 * - Ctrl/Cmd + Enter calls onRun. Tab indents; Esc then Tab leaves the editor (CodeMirror's rule), the
 *   footer of each tool says so.
 * - Colours come from the site's design tokens (light and dark).
 * - `diagnostics` (YAML errors) are shown as underlines + gutter markers with the message.
 */
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, placeholder as cmPlaceholder, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, bracketMatching, indentUnit } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export type EditorLang = 'sql' | 'yaml' | 'jinja';

export interface EditorDiagnostic {
  /** 1-based line and column (column may be 0 = whole line) */
  line: number;
  column?: number;
  message: string;
  severity?: 'error' | 'warning';
}

export interface CodeEditorHandle {
  getValue(): string;
  setValue(text: string): void;
  focus(): void;
}

export interface CodeEditorProps {
  lang: EditorLang;
  /** the CodeMirror language support (each tool imports only its own: lang-sql, lang-yaml, jinja-mode) */
  language: Extension;
  initial: string;
  ariaLabel: string;
  onRun?: () => void;
  onChange?: (text: string) => void;
  readOnly?: boolean;
  minLines?: number;
  diagnostics?: EditorDiagnostic[];
  placeholder?: string;
  testId?: string;
  handle?: Ref<CodeEditorHandle | null>;
}

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.definitionKeyword, t.controlKeyword], color: 'var(--tok-kw)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--tok-str)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--tok-num)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--tok-cmt)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.standard(t.name), t.typeName], color: 'var(--tok-fn)' },
  { tag: [t.propertyName, t.definition(t.propertyName), t.attributeName], color: 'var(--tok-key)' },
  { tag: [t.meta, t.processingInstruction, t.brace], color: 'var(--tok-jinja)', fontWeight: '600' },
  { tag: [t.punctuation, t.separator, t.bracket], color: 'var(--tok-punct)' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--code-ink)', fontSize: '0.875rem' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 14px 0 6px' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted)', border: 'none', paddingLeft: '4px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent-soft) 45%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--line-strong)' },
  '.cm-placeholder': { color: 'var(--muted)' },
  '.mc-diag-line': { backgroundColor: 'var(--bad-bg)' },
  '.mc-diag-mark': { textDecoration: 'underline wavy var(--bad)', textUnderlineOffset: '3px', textDecorationSkipInk: 'none' },
  '.mc-diag-line.mc-warn': { backgroundColor: 'var(--warn-bg)' },
});

// --- diagnostics as decorations (no lint panel: the tools show the message themselves, in full)
const setDiags = StateEffect.define<EditorDiagnostic[]>();
const diagField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setDiags)) continue;
      const doc = tr.state.doc;
      const ranges = [];
      for (const d of e.value) {
        if (d.line < 1 || d.line > doc.lines) continue;
        const line = doc.line(d.line);
        const cls = d.severity === 'warning' ? 'mc-diag-line mc-warn' : 'mc-diag-line';
        ranges.push(Decoration.line({ class: cls, attributes: { title: d.message } }).range(line.from));
        if (d.column && d.column > 0 && line.length > 0) {
          const from = Math.min(line.from + d.column - 1, line.to - 1);
          ranges.push(Decoration.mark({ class: 'mc-diag-mark' }).range(Math.max(line.from, from), Math.min(line.to, Math.max(from + 1, line.from + 1))));
        }
      }
      deco = Decoration.set(ranges, true);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function CodeEditor(props: CodeEditorProps) {
  const { lang, initial, ariaLabel, readOnly, minLines = 4, testId } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [mounted, setMounted] = useState(false);
  const cb = useRef(props);
  cb.current = props;

  useImperativeHandle(props.handle, () => ({
    getValue: () => view.current?.state.doc.toString() ?? initial,
    setValue: (text: string) => {
      const v = view.current;
      if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, selection: { anchor: 0 } });
    },
    focus: () => view.current?.focus(),
  }), [initial]);

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(), history(), drawSelection(), highlightActiveLine(), bracketMatching(),
          indentUnit.of('  '), EditorState.tabSize.of(2),
          props.language, syntaxHighlighting(highlight), theme, diagField,
          EditorView.lineWrapping,
          keymap.of([
            { key: 'Mod-Enter', preventDefault: true, run: () => { cb.current.onRun?.(); return true; } },
            indentWithTab, ...defaultKeymap, ...historyKeymap,
          ]),
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, ...(testId ? { 'data-testid': testId } : {}), spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange?.(u.state.doc.toString()); }),
          ...(props.placeholder ? [cmPlaceholder(props.placeholder)] : []),
        ],
      }),
    });
    view.current = v;
    setMounted(true);
    return () => { v.destroy(); view.current = null; };
    // the editor is created once; later text changes go through the handle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: setDiags.of(props.diagnostics ?? []) });
  }, [props.diagnostics, mounted]);

  const minHeight = `calc(${minLines} * 1.6 * 0.875rem + 20px)`;
  return (
    <div className="mc-editor" data-lang={lang} style={{ minHeight }}>
      {!mounted && <pre className="mc-editor-fallback" aria-label={ariaLabel}><code>{initial}</code></pre>}
      <div ref={host} hidden={!mounted} />
    </div>
  );
}
