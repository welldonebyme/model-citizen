// The terminal view: scrollback (role=log), one input line, history, Ctrl+L, Ctrl+C, copy.
import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import { TerminalModel, type TermBlock, type TermLine } from '../../lib/dbt/terminal-model';

export interface TerminalHandle {
  focus(): void;
  setInput(text: string): void;
}

interface Props {
  model: TerminalModel;
  prompt: string;           // "jaffle_dbt $"
  promptTitle?: string;     // full path, shown as a tooltip
  running: boolean;
  disabled?: boolean;
  history: string[];
  onRun(line: string): void;
  onStop(): void;
  onOpenFile?(path: string): void;
  status?: string;          // announced politely (screen readers)
  ref?: Ref<TerminalHandle>;
  label?: string;
}

const NOTE_TAG: Record<string, string> = { info: 'Browser', warn: 'Browser', error: 'Browser', ok: 'Browser' };

function Line({ line, onOpenFile }: { line: TermLine; onOpenFile?: (p: string) => void }) {
  if (line.kind === 'note') {
    const n = line.note!;
    return (
      <div className={`t-line t-note t-note-${n.tone ?? 'info'}`} data-kind="note">
        <span className="t-note-tag">{NOTE_TAG[n.tone ?? 'info']}<span className="visually-hidden"> note: </span></span>
        <span className="t-note-text">{n.text}</span>
        {n.link && (
          <> <a className="t-link" href={n.link.href}>{n.link.label}</a></>
        )}
        {n.openFile && onOpenFile && (
          <> <button type="button" className="t-action" onClick={() => onOpenFile(n.openFile!)}>Open in a new tab</button></>
        )}
      </div>
    );
  }
  if (line.kind === 'cmd') {
    return <div className="t-line t-sub" data-kind="cmd"><span className="t-prompt" aria-hidden="true">$</span> {line.text}</div>;
  }
  if (line.kind === 'sys') return <div className="t-line t-sys" data-kind="sys">{line.text}</div>;
  return (
    <div className={`t-line t-out${line.kind === 'err' ? ' t-err' : ''}${line.box ? ' t-box' : ''}`} data-kind={line.kind}>
      {line.segs && line.segs.length ? line.segs.map((s, i) => (s.cls ? <span key={i} className={s.cls}>{s.text}</span> : s.text)) : line.text || ' '}
    </div>
  );
}

const Block = memo(function Block({ block, onOpenFile }: { block: TermBlock; version: number; onOpenFile?: (p: string) => void }) {
  const body = block.lines.map((l) => <Line key={l.id} line={l} onOpenFile={onOpenFile} />);
  if (block.title) {
    return (
      <details className="t-group">
        <summary>{block.title}{block.running ? '' : ` (${block.lines.filter((l) => l.kind === 'cmd').length} commands)`}</summary>
        <div className="t-group-body">{body}</div>
      </details>
    );
  }
  return (
    <div className="t-block" data-code={block.code ?? ''}>
      {block.command != null && (
        <div className="t-line t-cmdline">
          <span className="t-prompt">{block.prompt}</span> <span className="t-typed">{block.command}</span>
        </div>
      )}
      {body}
      {!block.running && block.code != null && block.code !== 0 && block.command != null && (
        <div className="t-line t-exit"><span className="visually-hidden">Exit code </span><span aria-hidden="true">exit code </span>{block.code}</div>
      )}
    </div>
  );
}, (a, b) => a.block === b.block && a.version === b.version);

export function Terminal({ model, prompt, promptTitle, running, disabled, history, onRun, onStop, onOpenFile, status, ref, label = 'Terminal' }: Props) {
  const blocks = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [value, setValue] = useState('');
  const [histPos, setHistPos] = useState<number | null>(null);
  const draft = useRef('');
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [copied, setCopied] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    setInput: (t: string) => { setValue(t); setHistPos(null); requestAnimationFrame(() => { input.current?.focus(); const n = t.length; input.current?.setSelectionRange(n, n); }); },
  }), []);

  // keep the view at the bottom while output arrives, unless the learner scrolled up to read
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [blocks]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const submit = useCallback(() => {
    if (running || disabled) return;
    const line = value;
    setValue('');
    setHistPos(null);
    draft.current = '';
    stick.current = true;
    onRun(line);
  }, [value, running, disabled, onRun]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (k === 'Enter') { e.preventDefault(); submit(); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'l') { e.preventDefault(); model.clear(); return; }
    if (e.ctrlKey && k.toLowerCase() === 'c') {
      const el = input.current;
      const hasSel = !!el && el.selectionStart !== el.selectionEnd;
      const pageSel = typeof window !== 'undefined' && String(window.getSelection() ?? '').length > 0;
      if (hasSel || pageSel) return; // copy, as usual
      e.preventDefault();
      if (running) onStop();
      else if (value) { const b = model.start({ prompt, command: value + '^C' }); model.end(b); setValue(''); }
      return;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      if (!history.length) return;
      e.preventDefault();
      let pos = histPos;
      if (k === 'ArrowUp') {
        if (pos === null) { draft.current = value; pos = history.length - 1; } else pos = Math.max(0, pos - 1);
      } else {
        if (pos === null) return;
        pos = pos + 1;
        if (pos >= history.length) { setHistPos(null); setValue(draft.current); return; }
      }
      setHistPos(pos);
      setValue(history[pos]);
      requestAnimationFrame(() => { const n = history[pos!].length; input.current?.setSelectionRange(n, n); });
      return;
    }
    if (k === 'Escape' && value) { e.preventDefault(); setValue(''); setHistPos(null); }
  };

  const copy = async (what: 'last' | 'all') => {
    const text = what === 'last' ? model.lastOutput() : model.allText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what === 'last' ? 'Last output copied' : 'All output copied');
    } catch {
      setCopied('Copy did not work here: select the text and press Ctrl+C');
    }
    setTimeout(() => setCopied(null), 2200);
  };

  // a click on the empty part of the terminal puts the cursor in the input, unless text is being selected
  const onMouseUp = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a,button,summary,input')) return;
    if (String(window.getSelection() ?? '')) return;
    input.current?.focus({ preventScroll: true });
  };

  const isBusy = running || !!disabled;
  return (
    <section className="t-term" aria-label={label}>
      <div className="t-bar">
        <span className="t-bar-title">{label}</span>
        <span className="t-bar-actions">
          {running && <button type="button" className="t-btn t-btn-stop" onClick={onStop}>Stop</button>}
          <button type="button" className="t-btn" onClick={() => copy('last')}>Copy last output</button>
          <button type="button" className="t-btn" onClick={() => copy('all')}>Copy all</button>
          <button type="button" className="t-btn" onClick={() => model.clear()} aria-keyshortcuts="Control+L">Clear</button>
        </span>
      </div>
      <div className="t-screen" ref={scroller} onScroll={onScroll} onMouseUp={onMouseUp}>
        <div className="t-log" role="log" aria-live="polite" aria-busy={running} aria-label={`${label} output`} tabIndex={0}>
          {blocks.map((b) => <Block key={b.id} block={b} version={b.version} onOpenFile={onOpenFile} />)}
        </div>
        <form className="t-input-row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label className="t-prompt" htmlFor={`${label.replace(/\W+/g, '-')}-input`} title={promptTitle}>{prompt}</label>
          <input
            id={`${label.replace(/\W+/g, '-')}-input`}
            ref={input}
            className="t-input"
            type="text"
            value={value}
            onChange={(e) => { setValue(e.target.value); setHistPos(null); }}
            onKeyDown={onKey}
            readOnly={isBusy}
            aria-label={`Command (${prompt})`}
            aria-describedby={`${label.replace(/\W+/g, '-')}-hint`}
            placeholder={running ? 'Running. Press Ctrl+C or Stop to stop it.' : disabled ? '' : 'Type a command, for example dbt build'}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
        </form>
      </div>
      <p className="visually-hidden" id={`${label.replace(/\W+/g, '-')}-hint`}>Enter runs the command. Up and Down arrows: earlier commands. Control L clears the screen.</p>
      <p className="visually-hidden" role="status" aria-live="polite">{copied ?? status ?? ''}</p>
      {copied && <p className="t-toast" aria-hidden="true">{copied}</p>}
    </section>
  );
}
