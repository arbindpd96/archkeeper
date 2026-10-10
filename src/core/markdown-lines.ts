import { htmlBlock } from './markdown-html.js';
import { BYTE_ORDER_MARK } from './text.js';

const FRONTMATTER = /^---\s*\n[\s\S]*?---\s*\n?/;
const LIST_MARKERS = /^(?: {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]+|$))+/;
const BARE_BULLET = / {0,3}(?:[*+-]|\d{1,9}[.)])[ \t]$/;
const CODE_AFTER_MARKER = /(?:[*+-]|\d[.)]) {5}/;

export const QUOTE_MARKER = /^ {0,3}>[ \t]?/;
export const BLANK = /^[ \t]*$/;
export const INDENTED_CODE = /^(?: {4}| {0,3}\t)/;
export const FENCE_START = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
export const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
export const THEMATIC_BREAK = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/;
export const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+) *$/;
export const COMMENT_START = /^ {0,3}<!--/;
export const ITEM_HTML = /^ {0,3}<(?:[a-z].*>|!--)/i;
export const MAYBE_DEFINITION = /^ {0,3}\[[^\]]*\]:/;
export const OPEN_LABEL = /^ {0,3}\[[^\]]*$/;
export const DEFINITION =
  /^ {0,3}\[(?!\s*\])(?:\\.|[^[\]\\])+\]: *(?:(?:[^<\s]\S*|<.*?>)(?: +(?:"[^"]*"|'[^']*'|\([^()]*\)))?)? *$/;

const SETEXT_TEXT_ENDS = [
  BLANK,
  /^(?:[*+-]|\d{1,9}[.)]) /,
  INDENTED_CODE,
  /^ {0,3}(?:`{3,}|~{3,})/,
  /^ {0,3}>/,
  /^ {0,3}#{1,6}/,
  /^ {0,3}<[^>]+>$/,
];

/** The text as Claude Code lexes it: without a leading byte-order mark and YAML frontmatter, when it has some. */
export function withoutFrontmatter(text: string): string {
  const body = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  const frontmatter = body.includes('---', 3) ? FRONTMATTER.exec(body) : null;
  return frontmatter === null ? text : body.slice(frontmatter[0].length);
}

/** Strips up to `most` blockquote markers and says how many it found. */
export function unquoted(line: string, most: number): { readonly depth: number; readonly content: string } {
  let depth = 0;
  let content = line;
  for (let marker = QUOTE_MARKER.exec(content); marker !== null && depth < most; depth += 1) {
    content = content.slice(marker[0].length);
    marker = QUOTE_MARKER.exec(content);
  }
  return { depth, content };
}

/** Counts the spaces and tabs that start `content`. */
export function indentOf(content: string): number {
  return content.length - content.trimStart().length;
}

/** The line as marked reads a list item's lines, with each leading tab as four spaces. */
export function expanded(content: string): string {
  return content.replace(/^[ \t]+/, (lead) => lead.replaceAll('\t', '    '));
}

/** The column the text of `content` starts at, each leading tab counting four. */
export function columnsOf(content: string): number {
  return indentOf(expanded(content));
}

/**
 * The list bullets that start `content`, with the spaces after each, or an empty string. A bullet followed by one
 * space and nothing else starts no list for marked, though it is an item in one.
 */
export function listMarker(content: string, inList: boolean): string {
  const marker = LIST_MARKERS.exec(content)?.[0] ?? '';
  const outer = marker === content ? marker.replace(BARE_BULLET, '') : marker;
  return outer === '' && inList ? marker : outer;
}

/** Whether marked would read `content` as text of a setext heading rather than as a new block. */
export function isSetextText(content: string): boolean {
  return !SETEXT_TEXT_ENDS.some((end) => end.test(content));
}

/** For each line, whether a setext underline ends the run of heading text that may go on from it. */
export function setextRuns(lines: readonly string[]): boolean[] {
  const ahead = new Array<boolean>(lines.length + 1).fill(false);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const { depth, content } = unquoted(lines[index] ?? '', Infinity);
    const sameQuote = unquoted(lines[index + 1] ?? '', Infinity).depth === depth;
    const text = isSetextText(content) && sameQuote && (ahead[index + 1] ?? false);
    ahead[index] = SETEXT_UNDERLINE.test(content) || text;
  }
  return ahead;
}

/** Whether `content` opens a fence, a quote or an HTML block, comments included. */
export function isBlock(content: string): boolean {
  return (
    FENCE_START.test(content) ||
    QUOTE_MARKER.test(content) ||
    COMMENT_START.test(content) ||
    htmlBlock(content) !== undefined
  );
}

/** Whether `content` opens a block, or inline HTML that ends a list item, once in an item. */
export function opensInItem(content: string): boolean {
  return isBlock(content) || ITEM_HTML.test(content);
}

/** Whether `content`, or the text after its bullets, opens a block or code inside a list item. */
export function hidesInItem(content: string): boolean {
  const marker = LIST_MARKERS.exec(content)?.[0] ?? '';
  const code = CODE_AFTER_MARKER.test(marker) || marker.includes('\t');
  return opensInItem(content) || (marker !== '' && (code || opensInItem(content.slice(marker.length))));
}

/** Whether a bullet of `marker` is followed by five spaces, which makes the item's first line code. */
export function codeAfterMarker(marker: string): boolean {
  return CODE_AFTER_MARKER.test(marker);
}
