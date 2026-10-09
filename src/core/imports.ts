const OUTSIDE_START = /@(?:[~/\\]|[A-Za-z]:)/;
const PARENT_SEGMENT = /(?:^|[/\\@])\.\.(?=[/\\@]|$)/;
const ENV_NAME = /\.env(?:rc)?(?![a-z0-9])/g;
const ENV_TEMPLATE = /^\.env\.(?:example|sample|template)(?=$|[/\\#])/;
// macOS and Windows fold names such as the long s (U+017F) onto ASCII letters, so ſettings.local.json opens
// settings.local.json. Kit paths are ASCII, so a non-ASCII name after an @ is refused rather than folded.
const NON_ASCII = /[^\x20-\x7E]/;
const PERSONAL_NAMES = ['settings.local.json', 'claude.local.md'];

// Claude Code cuts an import path at #, at a trailing escaped space, or where inline markdown ends, so a private
// name counts wherever it appears after the @, not only as the last name of the word.
function namesPrivateFile(text: string): boolean {
  if (PERSONAL_NAMES.some((name) => text.includes(name))) return true;
  for (const match of text.matchAll(ENV_NAME)) {
    if (!ENV_TEMPLATE.test(text.slice(match.index, match.index + 16))) return true;
  }
  return false;
}

function wordProblem(word: string): string | undefined {
  const at = word.indexOf('@');
  if (at === -1) return undefined;
  const imported = word.slice(at + 1);
  if (OUTSIDE_START.test(word) || PARENT_SEGMENT.test(imported)) {
    return 'holds an @ import of a file outside the project';
  }
  if (NON_ASCII.test(imported)) return 'holds an @ import with a non-ASCII name';
  // Windows can open .env by its 8.3 short name, such as ENV~1, and kit paths never hold a ~.
  if (imported.includes('~')) return 'holds an @ import with a ~, which Windows can read as a short name';
  return namesPrivateFile(imported.toLowerCase())
    ? 'holds an @ import of a secrets or personal file'
    : undefined;
}

// Claude Code drops HTML comments before it looks for imports, so `@.<!---->env` reads as `@.env`.
function withoutComments(text: string): string {
  let kept = '';
  let from = 0;
  let start = text.indexOf('<!--');
  while (start !== -1) {
    const end = text.indexOf('-->', start + 4);
    if (end === -1) break;
    kept += text.slice(from, start);
    from = end + 3;
    start = text.indexOf('<!--', from);
  }
  return kept + text.slice(from);
}

function firstProblem(text: string): string | undefined {
  for (const word of text.split(/(?<!\\)\s+/)) {
    const problem = wordProblem(word);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/**
 * Says why `text` holds an `@` import that the kit must never write, or returns undefined. Claude Code imports
 * `@path` wherever an `@` starts a text token in CLAUDE.md, after a space or right after inline markdown such as
 * a code span, once HTML comments are gone (reference §2.1), and loads project files with no prompt and no Read
 * deny rule. So an `@` followed by an outside path (home, root, drive or `..`) or by a `.env` name, CLAUDE.local.md
 * or the personal settings file anywhere in its word is refused, with and without comments. Each word, split at
 * whitespace that no `\` escapes, is checked once from its first `@`, so the check is linear.
 */
export function importProblem(text: string): string | undefined {
  return firstProblem(text) ?? firstProblem(withoutComments(text));
}
