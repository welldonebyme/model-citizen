import type { ReactNode } from 'react';
import type { CodeBlock as CodeBlockT } from '../../lib/content-types';
import { highlight, commandsOnly } from '../../lib/highlight';

const LABEL: Record<string, string> = { sql: 'SQL', dbt: 'dbt SQL', yaml: 'YAML', jinja: 'Jinja', python: 'Python', bash: 'Terminal', output: 'Result', plain: 'Text' };
const OSNAME: Record<string, string> = { mac: 'macOS', win: 'Windows PowerShell', wsl: 'WSL' };

export interface CodeBlockProps {
  block: CodeBlockT;
  /** shows "Run in workspace" (lab pages wire the button) */
  runnable?: boolean;
  /** hotspot questions: lines become buttons */
  onLine?: (line: number) => void;
  selectedLine?: number | null;
  lineState?: Record<number, 'right' | 'wrong'>;
  hideCopy?: boolean;
}

/** dbt command lines of a shell block ("$ dbt build", "$ DBT_X=1 dbt run"): offered to the browser terminal. */
export function dbtCommands(text: string): string[] {
  return commandsOnly(text).split('\n').map((l) => l.trim()).filter((l) => /^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)*dbt(\s|$)/.test(l));
}

function lines(block: CodeBlockT, text: string): string[] {
  return highlight(block.lang, text).split('\n');
}

export function CodeBlock({ block, runnable, onLine, selectedLine, lineState, hideCopy }: CodeBlockProps): ReactNode {
  const isTerm = block.lang === 'bash';
  const isOut = block.lang === 'output';
  const v = isTerm ? block.variants : undefined;
  // Each pane lists the OSes it serves; the book's pane serves every OS without its own variant.
  const others = [v?.win ? 'win' : '', v?.wsl ? 'wsl' : ''].filter(Boolean);
  const panes = [
    { os: ['mac', 'win', 'wsl'].filter((o) => o === 'mac' || !others.includes(o)).join(' '), text: block.text },
    ...(v?.win ? [{ os: 'win', text: v.win }] : []),
    ...(v?.wsl ? [{ os: 'wsl', text: v.wsl }] : []),
  ];
  const multi = panes.length > 1;
  // Hidden until a dbt workspace is on the page (components/dbt/DbtWorkspace un-hides it and handles the click).
  const dbtTry = isTerm ? dbtCommands(block.text) : [];
  const first = block.firstLine ?? 1;
  const cls = ['mc-code', `mc-lang-${block.lang}`, isTerm && 'mc-term-block', isOut && 'mc-out', block.small && 'mc-small', block.lineNumbers && 'mc-numbered', onLine && 'mc-hotspot'].filter(Boolean).join(' ');

  return (
    <figure className={cls} data-code="" id={block.id} data-lang={block.lang}>
      <figcaption className="mc-code-head">
        <span className="mc-code-label">
          {block.title ?? LABEL[block.lang]}
          {multi && panes.map((p) => (
            <span key={p.os} className="mc-os-note" data-os-only={p.os}> for {p.os.split(' ').map((o) => OSNAME[o]).join(' and ')}</span>
          ))}
        </span>
        <span className="mc-code-actions">
          {runnable && <button type="button" className="mc-code-act" data-send-to-workspace={block.id}>Run in workspace</button>}
          {dbtTry.length > 0 && <button type="button" className="mc-code-act" data-dbt-try={dbtTry.join('\n')} hidden>Try in the browser terminal</button>}
          {!isOut && !hideCopy && <button type="button" className="mc-code-act" data-copy="">{isTerm ? 'Copy commands' : 'Copy'}</button>}
        </span>
      </figcaption>
      {panes.map((p) => {
        const ls = lines(block, p.text);
        return (
          <pre
            key={p.os}
            className="mc-code-body"
            data-os-only={multi ? p.os : undefined}
            data-copy-source=""
            data-copy-text={isTerm ? commandsOnly(p.text) : p.text}
            aria-label={multi ? p.os.split(' ').map((o) => OSNAME[o]).join(', ') : undefined}
          >
            {block.lineNumbers || onLine ? (
              <code>
                {ls.map((html, i) => {
                  const n = first + i;
                  const state = lineState?.[n];
                  const inner = (
                    <>
                      <span className="mc-n" aria-hidden="true">{n}</span>
                      <span className="mc-lc" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
                    </>
                  );
                  return onLine ? (
                    <button
                      key={i} type="button" className="mc-ln" data-line={n}
                      aria-pressed={selectedLine === n} data-state={state}
                      aria-label={`Line ${n}`}
                      onClick={() => onLine(n)}
                    >{inner}</button>
                  ) : (
                    <span key={i} className="mc-ln" data-line={n}>{inner}</span>
                  );
                })}
              </code>
            ) : (
              <code dangerouslySetInnerHTML={{ __html: ls.join('\n') }} />
            )}
          </pre>
        );
      })}
    </figure>
  );
}
