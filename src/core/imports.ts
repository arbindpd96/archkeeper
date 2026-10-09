import { LOCAL_SETTINGS_FILE, isPrivateFileName } from './targets.js';

const OUTSIDE_START = /@(?:[~/\\]|[A-Za-z]:)/;
const PARENT_SEGMENT = /(?:^|[/\\@])\.\.(?=[/\\@]|$)/;

function wordProblem(word: string): string | undefined {
  const at = word.indexOf('@');
  if (at === -1) return undefined;
  if (OUTSIDE_START.test(word) || PARENT_SEGMENT.test(word.slice(at + 1))) {
    return 'holds an @ import of a file outside the project';
  }
  const tail = word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1);
  const imported = tail.split('@').some(isPrivateFileName);
  if (imported || word.toLowerCase().includes(LOCAL_SETTINGS_FILE)) {
    return 'holds an @ import of a secrets or personal file';
  }
  return undefined;
}

/**
 * Says why `text` holds an `@` import that the kit must never write, or returns undefined. Claude Code imports
 * `@path` wherever an `@` starts a text token in CLAUDE.md, after a space or right after inline markdown such as
 * a code span (reference §2.1), and loads project files with no prompt and no Read deny rule. So any `@` path
 * outside the project (home, root, drive or `..`) or naming a `.env` file, CLAUDE.local.md or the personal
 * settings file is refused. Each word, split at whitespace that no `\` escapes, is checked once, so the check is
 * linear.
 */
export function importProblem(text: string): string | undefined {
  for (const word of text.split(/(?<!\\)\s+/)) {
    const problem = wordProblem(word);
    if (problem !== undefined) return problem;
  }
  return undefined;
}
