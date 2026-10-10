import { htmlInterrupts } from './markdown-html.js';
import {
  BLANK,
  DEFINITION,
  FENCE_START,
  HEADING,
  INDENTED_CODE,
  isBlock,
  listMarker,
  OPEN_LABEL,
  SETEXT_UNDERLINE,
  THEMATIC_BREAK,
} from './markdown-lines.js';
import { type Continuation, inListItem, leavesList } from './markdown-lists.js';

const SPACES_ONLY = /^ *$/;
const INTERRUPTING_ITEM = /^ {0,3}(?:[*+-]|1[.)]) /;

/**
 * Where a line sits: its quote depth, whether a fence or an underline may end a paragraph there, its list, the
 * innermost item and the one it sits in, and the line as its list item reads it, from the item's column.
 */
export interface Line {
  readonly afterQuoteText: boolean;
  readonly nextInQuote: boolean;
  readonly setextAhead: boolean;
  readonly depth: number;
  readonly lazy: boolean;
  readonly inList: boolean;
  readonly itemColumn: number | undefined;
  readonly ownerColumn: number | undefined;
  readonly inItem: string;
}

/** What ending the open paragraph depends on: whether all its lines may be setext heading text, and its depth. */
export interface OpenParagraph {
  readonly setextable: boolean;
  readonly depth: number;
}

/** How the open paragraph takes a line: the end the line makes, the step, and whether it closes list items. */
export interface ParagraphStep {
  readonly end: 'blank' | 'underline' | 'rule' | undefined;
  readonly next: Continuation;
  readonly leaves: boolean;
}

/**
 * The first lazy line after a quote is lexed as a new block, where any block or link definition starts; an
 * indented one joins the paragraph as code and leaves the next line at a block start. The reader stops at both.
 */
function lazyLine(content: string): Continuation {
  const block = isBlock(content) || listMarker(content, false) !== '' || DEFINITION.test(content);
  return block || OPEN_LABEL.test(content) || INDENTED_CODE.test(content) ? 'stop' : 'continue';
}

/** marked ends a paragraph at a fence only when another line of the same quote follows it. */
function interrupts(content: string, line: Line): boolean {
  return (
    HEADING.test(line.inItem) ||
    (FENCE_START.test(content) && line.nextInQuote) ||
    INTERRUPTING_ITEM.test(content) ||
    htmlInterrupts(content)
  );
}

/**
 * Whether a quote takes `content` as a lazy line. After a quote's line of text, marked reads every line up to one
 * that would end a paragraph as the quote's own, and as a new block there.
 */
export function quoteTakes(content: string, line: Line): boolean {
  const ends = SPACES_ONLY.test(content) || THEMATIC_BREAK.test(content) || interrupts(content, line);
  return !ends;
}

/**
 * A list item ends at a fence either way, so the reader stops at a fence that does not end the paragraph. A
 * quote's paragraph in an item takes lazy lines as a paragraph does outside lists, so where an item's text would
 * end there, the reader stops.
 */
function continuation(content: string, line: Line, paragraph: OpenParagraph): Continuation {
  if (interrupts(content, line)) {
    return line.inList && leavesList(content, line.itemColumn) ? 'leave' : 'interrupt';
  }
  if (FENCE_START.test(content)) return 'stop';
  const lazy = line.lazy ? lazyLine(content) : 'continue';
  if (lazy !== 'continue' || !line.inList) return lazy;
  const step = inListItem(content, line.itemColumn, line.ownerColumn);
  return step !== 'continue' && line.depth < paragraph.depth ? 'stop' : step;
}

/**
 * An underline ends only a top-level paragraph that may be heading text; in a list, a bullet left of the item's
 * text is a new item, and one in the item's text an underline.
 */
function isUnderline(content: string, line: Line, paragraph: OpenParagraph): boolean {
  const item = line.inList && line.inItem === content && listMarker(content, true) !== '';
  const text = paragraph.setextable && paragraph.depth === 0;
  return SETEXT_UNDERLINE.test(line.inItem) && !item && text && !line.lazy;
}

/** marked indents a `===` or `---` line inside a quote by four spaces, so there it is text, not a rule. */
function isRule(content: string, line: Line): boolean {
  return THEMATIC_BREAK.test(content) && !(SETEXT_UNDERLINE.test(content) && line.depth > 0);
}

/**
 * A quote's last line of spaces ends no paragraph for marked, which reads it without a line break after it. A
 * `===` or `---` line in a quote may underline a heading, end a quote nested deeper, or go on as text.
 */
function quoteBeyondReader(content: string, line: Line): boolean {
  const lastSpaces = content !== '' && SPACES_ONLY.test(content) && !line.nextInQuote;
  return line.depth > 0 && (lastSpaces || SETEXT_UNDERLINE.test(content));
}

function paragraphEnd(content: string, line: Line, paragraph: OpenParagraph): ParagraphStep['end'] {
  const text = line.inItem;
  if (SPACES_ONLY.test(text) || (line.inList && BLANK.test(text))) return 'blank';
  if (isUnderline(content, line, paragraph)) return 'underline';
  return isRule(text, line) ? 'rule' : undefined;
}

/**
 * How the open paragraph takes `content`. marked reads a setext heading's text before it looks for what ends a
 * paragraph, so a line that would end one is still heading text when an underline follows; the reader does not
 * join them, so it stops there.
 */
export function paragraphStep(content: string, line: Line, paragraph: OpenParagraph): ParagraphStep {
  if (quoteBeyondReader(content, line)) return { end: undefined, next: 'stop', leaves: false };
  const end = paragraphEnd(content, line, paragraph);
  const found =
    end !== undefined || line.depth > paragraph.depth ? 'interrupt' : continuation(content, line, paragraph);
  const next = found !== 'continue' && headingGoesOn(line, end) ? 'stop' : found;
  const ruleLeaves = isRule(content, line) && line.inList && leavesList(content, line.itemColumn);
  return { end, next, leaves: next === 'leave' || ruleLeaves };
}

function headingGoesOn(line: Line, end: ParagraphStep['end']): boolean {
  return line.setextAhead && end !== 'blank' && end !== 'underline';
}
