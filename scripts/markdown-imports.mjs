const FRONTMATTER = /^---\s*\n[\s\S]*?---\s*\n?/;
const BLANK = /^[ \t]*$/;
const INDENTED_CODE = /^(?: {4}| {0,3}\t)/;
const FENCE_START = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const FENCE_CLOSER_TAIL = /^[`~]* *$/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,}|=+ *|-+ *)$/;
const COMMENT_START = /^ {0,3}<!--/;
const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|' +
  'dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|' +
  'menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|' +
  'thead|title|tr|track|ul';
const BLOCK_TAG = new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?: +|/?>|$)`, 'i');
const TAG_LINE = /^ {0,3}<\/?[a-z][\w-]*(?:\s[^>]*)?\/?>[ \t]*$/i;
const MASKED_START = /\\[!-/:-@[-`{-~]|`+|<!--/g;
const CANDIDATE = /(?<![^\s*_[])@((?:[^\s\\]|\\ )+)/g;
const RAW_CANDIDATE = /(?<!\S)@((?:[^\s\\]|\\ )+)/g;
const LINK_TEXT = /^([^\]]*)\]\([^\s()]*\)/;
const IMPORTABLE = /^(?:[\w.-]|~\/|\/[\s\S])/;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

/** The text without a leading byte-order mark and YAML frontmatter, as Claude Code lexes a memory file. */
function withoutFrontmatter(text) {
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  const frontmatter = body.includes('---', 3) ? FRONTMATTER.exec(body) : null;
  return frontmatter === null ? text : body.slice(frontmatter[0].length);
}

/** Whether `line` closes a fence opened with `fence`: the same character, as many or more, three spaces in at most. */
function closesFence(line, fence) {
  const code = line.replace(/^ {0,3}/, '');
  return code.startsWith(fence) && FENCE_CLOSER_TAIL.test(code.slice(fence.length));
}

/** The text with closed HTML comments cut out, as Claude Code reads what an HTML comment block leaves. */
function withoutComments(text) {
  let kept = '';
  let from = 0;
  for (let start = text.indexOf('<!--'); start !== -1; start = text.indexOf('<!--', from)) {
    const end = text.indexOf('-->', start + 4);
    if (end === -1) break;
    kept += text.slice(from, start);
    from = end + 3;
  }
  return kept + text.slice(from);
}

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

/** The imports in Markdown text, or in what an HTML comment block leaves, which Claude Code reads raw. */
function importsIn(text, raw) {
  if (raw) return [...text.matchAll(RAW_CANDIDATE)].flatMap((found) => importPath(found[1]));
  const hidden = masked(text);
  return [...hidden.matchAll(CANDIDATE)].flatMap((found) =>
    importPath(writtenTarget(hidden, found.index, found[1])),
  );
}

/** Closes the open paragraph and reads its imports. */
function endParagraph(scan) {
  if (scan.paragraph.length > 0) scan.found.push(...importsIn(scan.paragraph.join('\n'), false));
  scan.paragraph = [];
}

/** Reads a line of an open HTML block, and the text a comment block leaves once it closes. */
function readHtml(scan, line) {
  const { open } = scan;
  open.lines.push(line);
  if (!open.ends(line)) return;
  scan.open = undefined;
  if (open.comment) scan.found.push(...importsIn(withoutComments(open.lines.join('\n')), true));
}

/** Reads a line inside an open fence or HTML block, closing it on its last line. */
function readOpen(scan, line) {
  if (scan.open.fence === undefined) readHtml(scan, line);
  else if (closesFence(line, scan.open.fence)) scan.open = undefined;
}

/** Opens the HTML block `line` starts: a comment, which ends at `-->`, or a tag, which ends at a blank line. */
function openHtml(scan, line) {
  if (COMMENT_START.test(line)) {
    const body = line.slice(line.indexOf('<!--') + 4);
    const open = { comment: true, lines: [line], ends: (text) => text.includes('-->') };
    if (/^-?>/.test(body) || body.includes('-->')) scan.found.push(...importsIn(withoutComments(line), true));
    else scan.open = open;
    return true;
  }
  if (!BLOCK_TAG.test(line) && !TAG_LINE.test(line)) return false;
  scan.open = { comment: false, lines: [], ends: (text) => BLANK.test(text) };
  return true;
}

/** Whether `line` ends the open paragraph: a heading, fence, comment or block-level tag at the start of the line. */
function interrupts(line) {
  return HEADING.test(line) || FENCE_START.test(line) || COMMENT_START.test(line) || BLOCK_TAG.test(line);
}

/** Reads a line that no fence, HTML block or paragraph takes. */
function readBlockStart(scan, line) {
  const fence = FENCE_START.exec(line)?.[1];
  if (INDENTED_CODE.test(line)) return;
  if (HEADING.test(line)) scan.found.push(...importsIn(line, false));
  else if (fence !== undefined) scan.open = { fence };
  else if (!openHtml(scan, line)) scan.paragraph.push(line);
}

/** Reads one line of a memory file's text. */
function readLine(scan, line) {
  if (scan.open !== undefined) return readOpen(scan, line);
  if (BLANK.test(line) || RULE.test(line)) return endParagraph(scan);
  if (scan.paragraph.length > 0 && !interrupts(line)) return scan.paragraph.push(line);
  endParagraph(scan);
  return readBlockStart(scan, line);
}

/**
 * The `@path` imports Claude Code reads in Markdown text, each cut at `#`, unescaped and trimmed: an `@` that
 * starts a text token or follows whitespace in it, outside frontmatter, code fences, indented code, code spans
 * and HTML blocks. A trailing `.` or `)` stays in the path, as it does for Claude Code.
 */
export function importsOf(text) {
  const scan = { found: [], paragraph: [], open: undefined };
  for (const line of withoutFrontmatter(text).split('\n')) readLine(scan, line);
  endParagraph(scan);
  return scan.found;
}
