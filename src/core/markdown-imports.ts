import { importTexts } from './markdown-blocks.js';
import type { ImportText } from './skipped-blocks.js';

const MASKED_START = /\\[!-/:-@[-`{-~]|`+|<|!\[|\]\(/g;
const CLOSING_TAG = /<\/[a-zA-Z][\w:-]*\s*>/y;
const OPENING_TAG =
  /<[a-zA-Z][\w-]*(?:\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?)*?\s*\/?>/y;
const DECLARATION = /<![a-zA-Z]+\s/y;
const SIMPLE_LINK = /(?=!?\[)(?<!(?<!\\)\\(?:\\\\)*)!?\[(?:\\[^[\]`]|[^[\]`\\])*\]\([^\s()`<>\\]*\)/g;
const HIDDEN = '\u0000';
const EMPHASIS_SKIP = /\[[^[\]]*?\]\((?:\\.|[^\\()]|\((?:\\.|[^\\()])*\))*\)|`[^`]*?`|<[^<>]*?>/g;
const CANDIDATE = /(?<![^\s*_[])@((?:[^\s\\]|\\ )+)/g;
const RAW_CANDIDATE = /(?<!\S)@((?:[^\s\\]|\\ )+)/g;
const IMPORTABLE = /^(?:[\w.-]|~\/|\/[\s\S])/;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const SPACE = /\s/;
const NONE = -1;

/** Finds the inline code spans and HTML of one text left to right; each end marker is searched for once. */
interface Masking {
  readonly text: string;
  readonly closing: (from: number, length: number) => number | undefined;
  readonly firstFound: Map<string, number>;
  readonly links: ReadonlyMap<number, RegExpExecArray>;
  readonly firstBracket: number;
  unsure: boolean;
}

/** A part of the text that is no text token, and what replaces it: a space where it ends the text around it. */
interface Span {
  readonly start: number;
  readonly end: number;
  readonly fill: string;
}

/** Inline Markdown as written, and with its code spans and inline HTML blanked out at the same offsets. */
interface Inline {
  readonly written: string;
  readonly masked: string;
  readonly skipsEmphasis: (at: number) => boolean;
  readonly noOpenerBefore: (at: number) => boolean;
  readonly noLinkBefore: (at: number) => boolean;
  readonly firstMasked: number;
}

function closingRuns(text: string): (from: number, length: number) => number | undefined {
  const starts = new Map<number, number[]>();
  for (const run of text.matchAll(/`+/g)) {
    const list = starts.get(run[0].length) ?? [];
    list.push(run.index);
    starts.set(run[0].length, list);
  }
  const cursors = new Map<number, number>();
  return (from, length) => {
    const list = starts.get(length) ?? [];
    let cursor = cursors.get(length) ?? 0;
    while ((list[cursor] ?? Infinity) < from) cursor += 1;
    cursors.set(length, cursor);
    return list[cursor];
  };
}

function firstAfter(masking: Masking, marker: string, from: number): number {
  const known = masking.firstFound.get(marker);
  if (known === NONE || (known !== undefined && known >= from)) return known;
  const found = masking.text.indexOf(marker, from);
  masking.firstFound.set(marker, found);
  return found;
}

function markerEnd(masking: Masking, marker: string, from: number): number | undefined {
  const at = firstAfter(masking, marker, from);
  return at === NONE ? undefined : at + marker.length;
}

function sticky(pattern: RegExp, text: string, at: number): number | undefined {
  pattern.lastIndex = at;
  return pattern.test(text) ? pattern.lastIndex : undefined;
}

/** Where marked's inline HTML at `at` ends: a comment, a closing or opening tag, `<?…?>`, `<!X …>` or CDATA. */
function tagEnd(masking: Masking, at: number): number | undefined {
  const { text } = masking;
  if (text.startsWith('<!--', at)) {
    if (/^-?>/.test(text.slice(at + 4, at + 6))) return text.indexOf('>', at + 4) + 1;
    return markerEnd(masking, '-->', at + 4);
  }
  if (text.startsWith('<?', at)) return markerEnd(masking, '?>', at + 2);
  if (text.startsWith('<![CDATA[', at)) return markerEnd(masking, ']]>', at + 9);
  const tag = sticky(CLOSING_TAG, text, at) ?? sticky(OPENING_TAG, text, at);
  if (tag !== undefined) return tag;
  const declaration = sticky(DECLARATION, text, at);
  return declaration === undefined ? undefined : markerEnd(masking, '>', declaration);
}

function span(start: number, end: number | undefined, fill = ' '): Span | undefined {
  return end === undefined ? undefined : { start, end, fill };
}

/** The simple links and images of a text, by where their `](` stands; no bracket in one is escaped. */
function simpleLinks(text: string): Map<number, RegExpExecArray> {
  return new Map([...text.matchAll(SIMPLE_LINK)].map((link) => [link.index + link[0].indexOf(']('), link]));
}

/**
 * An image is no text token, and a link's destination is not either. Where a simple link is no link for marked,
 * it is text, so the reader hides a destination without ending the text around it. A `](` the reader cannot
 * match simply leaves the whole text unsure, and it reads no import there.
 */
function linkSpan(masking: Masking, found: string, start: number): Span | undefined {
  const link = masking.links.get(found === '![' ? firstAfter(masking, '](', start) : start);
  const image = link?.index === start && found === '![';
  masking.unsure ||= found === '](' && link === undefined;
  if (image) return span(start, start + link[0].length);
  return found === '](' && link !== undefined ? span(start, link.index + link[0].length, HIDDEN) : undefined;
}

/**
 * A code span or inline HTML that holds a link's `](`, after a `[`, may be in the link's text instead, since
 * marked reads a link from its `[` on; the reader cannot tell, so the text is unsure.
 */
function hidesLinkEnd(masking: Masking, found: RegExpExecArray, part: Span): boolean {
  const code = found[0].startsWith('`') || found[0] === '<';
  return (
    code && masking.firstBracket < part.start && masking.text.slice(part.start, part.end + 1).includes('](')
  );
}

function maskedSpan(masking: Masking, found: RegExpExecArray): Span | undefined {
  const start = found.index;
  if (found[0].startsWith('\\')) return span(start, start + 2);
  if (found[0] === '![' || found[0] === '](') return linkSpan(masking, found[0], start);
  if (found[0] === '<') return span(start, tagEnd(masking, start));
  const length = found[0].length;
  const closer = masking.closing(start + length, length);
  return span(start, closer === undefined ? undefined : closer + length);
}

/**
 * The text with what is no text token blanked out at the same offsets, or undefined when the reader cannot tell.
 * Claude Code reads imports in text tokens only, so an escape, a code span or inline HTML ends the text around
 * it. marked reads them left to right, so a backtick after a backslash opens no code span.
 */
function masked(text: string): string | undefined {
  const links = simpleLinks(text);
  const masking: Masking = {
    text,
    closing: closingRuns(text),
    firstFound: new Map(),
    links,
    firstBracket: text.indexOf('['),
    unsure: false,
  };
  const pattern = new RegExp(MASKED_START);
  let kept = '';
  let copied = 0;
  for (let found = pattern.exec(text); found !== null; found = pattern.exec(text)) {
    const part = maskedSpan(masking, found);
    if (part === undefined) continue;
    masking.unsure ||= hidesLinkEnd(masking, found, part);
    kept += text.slice(copied, part.start) + part.fill.repeat(part.end - part.start);
    copied = part.end;
    pattern.lastIndex = part.end;
  }
  return masking.unsure ? undefined : kept + text.slice(copied);
}

/** Whether marked skips `at` when it looks for an emphasis closer: in a link, backtick pair or angle brackets. */
function emphasisSkips(text: string): (at: number) => boolean {
  let regions: readonly RegExpExecArray[] | undefined;
  let next = 0;
  return (at) => {
    regions ??= [...text.matchAll(EMPHASIS_SKIP)];
    while ((regions[next]?.index ?? Infinity) + (regions[next]?.[0].length ?? 0) <= at) next += 1;
    return (regions[next]?.index ?? Infinity) <= at;
  };
}

/**
 * Whether no `*` or `_` stands before `at` outside code and HTML. An emphasis that opens earlier may wrap a later
 * one, or take a code span's backticks into its text, as marked pairs them, and change what it reads there.
 */
function noOpenerBefore(masked: string): (at: number) => boolean {
  const first = masked.search(/[*_]/);
  return (at) => first === -1 || first >= at;
}

function firstDifference(written: string, hidden: string): number {
  let at = 0;
  while (at < written.length && written[at] === hidden[at]) at += 1;
  return at;
}

function startsWord(text: string, at: number): boolean {
  return at === 0 || SPACE.test(text[at - 1] ?? '');
}

/** The run of `*` or `_` that opens an emphasis right before `at`, as in **@AGENTS.md** or _@AGENTS.md_. */
function openingRun(inline: Inline, at: number): string | undefined {
  const { written } = inline;
  const mark = written[at - 1] ?? '';
  let start = at - 1;
  while (start > 0 && at - start < 4 && written[start - 1] === mark) start -= 1;
  const opens = at - start <= 3 && startsWord(written, start) && inline.noOpenerBefore(start);
  return opens ? written.slice(start, at) : undefined;
}

/** Where the run that closes the emphasis stands in `word`: right after text, and not followed by more of it. */
function closingAt(word: string, run: string): number | undefined {
  const mark = run[0] ?? '';
  const end = word.indexOf(run);
  const after = word[end + run.length] ?? ' ';
  const touches = end > 0 && !SPACE.test(word[end - 1] ?? ' ');
  const closes = touches && after !== mark && !(mark === '_' && ALPHANUMERIC.test(after));
  return closes ? end : undefined;
}

/** The emphasis's closer ends the path. */
function emphasisTarget(inline: Inline, at: number, word: string): string | undefined {
  const run = openingRun(inline, at);
  const end = run === undefined ? undefined : closingAt(word, run);
  return end === undefined || inline.skipsEmphasis(at + 1 + end) ? undefined : word.slice(0, end);
}

function cutByMask(inline: Inline, at: number, word: string): boolean {
  const after = inline.written[at + 1 + word.length];
  return !startsWord(inline.written, at) || (after !== undefined && !SPACE.test(after));
}

/** A word after a masked span, or one that a masked span ends, counts only with no `*` or `_` before it. */
function plainTarget(inline: Inline, at: number, word: string): string | undefined {
  const masks = cutByMask(inline, at, word) || inline.firstMasked < at;
  return masks && !inline.noOpenerBefore(at) ? undefined : word;
}

/** `[@AGENTS.md](AGENTS.md)` opens a link whose text starts with the `@`; the link's `](` ends the path. */
function linkTarget(inline: Inline, at: number, word: string): string | undefined {
  const text = word.split(HIDDEN, 1)[0] ?? '';
  const link = text !== word && inline.written.startsWith('](', at + 1 + text.length);
  return link && startsWord(inline.written, at - 1) && inline.noLinkBefore(at - 1) ? text : undefined;
}

function writtenTarget(inline: Inline, at: number, word: string): string | undefined {
  if (startsWord(inline.masked, at)) return plainTarget(inline, at, word);
  return inline.written[at - 1] === '[' ? linkTarget(inline, at, word) : emphasisTarget(inline, at, word);
}

function importPath(target: string | undefined): string[] {
  const path = (target?.split('#', 1)[0] ?? '').replaceAll('\\ ', ' ');
  return IMPORTABLE.test(path) && !path.includes(HIDDEN) ? [path.trim()] : [];
}

function importsIn(text: ImportText): string[] {
  if (text.raw) return [...text.text.matchAll(RAW_CANDIDATE)].flatMap((found) => importPath(found[1]));
  const hidden = masked(text.text);
  if (hidden === undefined) return [];
  const firstOpen = hidden.search(/[[(]/);
  const inline: Inline = {
    written: text.text,
    masked: hidden,
    skipsEmphasis: emphasisSkips(text.text),
    noLinkBefore: (at) => firstOpen === -1 || firstOpen >= at,
    firstMasked: firstDifference(text.text, hidden),
    noOpenerBefore: noOpenerBefore(hidden),
  };
  return [...inline.masked.matchAll(CANDIDATE)].flatMap((found) =>
    importPath(writtenTarget(inline, found.index, found[1] ?? '')),
  );
}

/**
 * Lists the `@` imports Claude Code 2.1.295 reads in a Markdown memory file, each cut at `#`, unescaped and
 * trimmed: an `@` that starts a text token or follows whitespace in it, outside code, HTML and link destinations.
 * A trailing `.` or `)` stays in the path, as it does for Claude Code. Where this reader cannot follow Claude
 * Code's lexer, it reads fewer imports, never more.
 */
export function markdownImports(text: string): string[] {
  return importTexts(text).flatMap(importsIn);
}
