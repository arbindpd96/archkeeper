const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
const MASKED_START = /\\[!-/:-@[-`{-~]|`+|<!--/g;
const CANDIDATE = /(?<![^\s*_[])@((?:[^\s\\]|\\ )+)/g;
const LINK_TEXT = /^([^\]]*)\]\([^\s()]*\)/;
const IMPORTABLE = /^(?:[\w.-]|~\/|\/[\s\S])/;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

/** Finds, for a run of backticks, the next run of the same length, each list read once so the pass stays linear. */
function closingRuns(text) {
  const starts = new Map();
  for (const run of text.matchAll(/`+/g)) {
    const list = starts.get(run[0].length) ?? [];
    list.push(run.index);
    starts.set(run[0].length, list);
  }
  const cursors = new Map();
  return (from, length) => {
    const list = starts.get(length) ?? [];
    let cursor = cursors.get(length) ?? 0;
    while ((list[cursor] ?? Infinity) < from) cursor += 1;
    cursors.set(length, cursor);
    return list[cursor] ?? -1;
  };
}

/** Where what starts at `found` stops being text: after an escape, a code span or a closed comment, or -1. */
function maskedEnd(masking, found) {
  if (found[0].startsWith('\\')) return found.index + 2;
  if (found[0] === '<!--') {
    if (masking.commentClose !== -1 && masking.commentClose < found.index + 4) {
      masking.commentClose = masking.text.indexOf('-->', found.index + 4);
    }
    return masking.commentClose === -1 ? -1 : masking.commentClose + 3;
  }
  const closer = masking.closing(found.index + found[0].length, found[0].length);
  return closer === -1 ? -1 : closer + found[0].length;
}

/** The text with escapes, code spans and closed comments blanked out at the same offsets: none of them is text. */
function masked(text) {
  const masking = { text, closing: closingRuns(text), commentClose: 0 };
  const pattern = new RegExp(MASKED_START);
  let kept = '';
  let copied = 0;
  for (let found = pattern.exec(text); found !== null; found = pattern.exec(text)) {
    const end = maskedEnd(masking, found);
    if (end === -1) continue;
    kept += text.slice(copied, found.index) + ' '.repeat(end - found.index);
    copied = end;
    pattern.lastIndex = end;
  }
  return kept + text.slice(copied);
}

function startsWord(text, at) {
  return at === 0 || SPACE.test(text[at - 1] ?? '');
}

/** The run of `*` or `_` right before `at` that opens an emphasis, as in **@AGENTS.md** or _@AGENTS.md_. */
function openingRun(text, at) {
  const mark = text[at - 1];
  let start = at - 1;
  while (start > 0 && at - start < 4 && text[start - 1] === mark) start -= 1;
  return at - start <= 3 && startsWord(text, start) ? text.slice(start, at) : undefined;
}

/** Where `run` closes the emphasis in `word`: right after text, and not followed by more of its mark, or -1. */
function closingAt(word, run) {
  const mark = run[0];
  const end = word.indexOf(run);
  const after = word[end + run.length] ?? ' ';
  const touches = end > 0 && !SPACE.test(word[end - 1]);
  return touches && after !== mark && !(mark === '_' && ALPHANUMERIC.test(after)) ? end : -1;
}

/** The path of an emphasis opened right before the `@`: it ends where the same run closes the emphasis. */
function emphasisTarget(text, at, word) {
  const run = openingRun(text, at);
  const end = run === undefined ? -1 : closingAt(word, run);
  return end === -1 ? undefined : word.slice(0, end);
}

/** The path an `@` names where a text token starts: after whitespace, an emphasis opener, or a link's `[`. */
function writtenTarget(text, at, word) {
  if (startsWord(text, at)) return word;
  if (text[at - 1] !== '[') return emphasisTarget(text, at, word);
  return startsWord(text, at - 1) ? LINK_TEXT.exec(word)?.[1] : undefined;
}

/** The path Claude Code imports: cut at `#`, unescaped and trimmed, when it starts as a path can. */
function importPath(target) {
  const path = (target?.split('#', 1)[0] ?? '').replaceAll('\\ ', ' ');
  return IMPORTABLE.test(path) ? [path.trim()] : [];
}

/** The imports in Markdown text. */
function importsIn(text) {
  const hidden = masked(text);
  return [...hidden.matchAll(CANDIDATE)].flatMap((found) =>
    importPath(writtenTarget(hidden, found.index, found[1])),
  );
}

/**
 * The `@path` imports Claude Code reads in Markdown text, each cut at `#`, unescaped and trimmed: an `@` that
 * starts a text token or follows whitespace in it, outside code fences and code spans. A trailing `.` or `)`
 * stays in the path, as it does for Claude Code.
 */
export function importsOf(text) {
  const kept = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) kept.push(line);
  }
  return importsIn(kept.join('\n'));
}
