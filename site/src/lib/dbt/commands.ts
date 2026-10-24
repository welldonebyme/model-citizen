// The dbt command lines of a shell block as the lessons print it, for "Try in the browser terminal".
// Same rules as CodeBlock's dbtCommands, plus the PowerShell form of the Windows panes, where a dbt command often
// comes with its environment variable on the same line: $env:X = "1"; dbt build; Remove-Item Env:X
import { splitList } from './shell.ts';

const PROMPT = /^\s*(?:\([^)]*\)\s*)?(?:\$|PS>|PS [^>]*>)\s+(.*)$/;
const DBT = /^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)*dbt(\s|$)/;

/** Command lines of a shell block; a command whose quotes are still open goes on over the next lines. */
export function commandsOf(text: string): string[] {
  const lines = text.split('\n');
  const hasPrompt = lines.some((l) => PROMPT.test(l));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PROMPT);
    if (hasPrompt && !m) continue;
    let cmd = (m ? m[1] : lines[i]).trim();
    while (!splitList(cmd).ok && i + 1 < lines.length && (!hasPrompt || !PROMPT.test(lines[i + 1]))) cmd += '\n' + lines[++i];
    if (cmd) out.push(cmd);
  }
  return out;
}

export function dbtCommandLines(text: string): string[] {
  const cmds = commandsOf(text);
  return cmds.filter((l) => {
    if (DBT.test(l)) return true;
    const parts = splitList(l);
    return parts.ok && parts.items.some((p) => DBT.test(p.text.trim()));
  });
}
