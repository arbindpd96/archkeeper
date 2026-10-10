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

/** Where a line sits: its quote depth, whether a fence or an underline may end a paragraph there, and its list. */
export interface Line {
  readonly fenceInterrupts: boolean;
  readonly setextAhead: boolean;
  readonly depth: number;
  readonly lazy: boolean;
  readonly inList: boolean;
  readonly itemColumn: number | undefined;
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
    HEADING.test(content) ||
    (FENCE_START.test(content) && line.fenceInterrupts) ||
    INTERRUPTING_ITEM.test(content) ||
    htmlInterrupts(content)
  );
}

/** A list item ends at a fence either way, so the reader stops at a fence that does not end the paragraph. */
function continuation(content: string, line: Line): Continuation {
  if (interrupts(content, line)) {
    return line.inList && leavesList(content, line.itemColumn) ? 'leave' : 'interrupt';
  }
  if (FENCE_START.test(content)) return 'stop';
  const lazy = line.lazy ? lazyLine(content) : 'continue';
  return lazy === 'continue' && line.inList ? inListItem(content, line.itemColumn) : lazy;
}

/** An underline ends only a top-level paragraph that may be heading text; in a list, a bullet is an item. */
function isUnderline(content: string, line: Line, paragraph: OpenParagraph): boolean {
  const item = line.inList && listMarker(content, true) !== '';
  const text = paragraph.setextable && paragraph.depth === 0;
  return SETEXT_UNDERLINE.test(content) && !item && text && !line.lazy;
}

/** marked indents a `===` or `---` line inside a quote by four spaces, so there it is text, not a rule. */
function isRule(content: string, line: Line): boolean {
  return THEMATIC_BREAK.test(content) && !(SETEXT_UNDERLINE.test(content) && line.depth > 0);
}

function paragraphEnd(content: string, line: Line, paragraph: OpenParagraph): ParagraphStep['end'] {
  if (SPACES_ONLY.test(content) || (line.inList && BLANK.test(content))) return 'blank';
  if (isUnderline(content, line, paragraph)) return 'underline';
  return isRule(content, line) ? 'rule' : undefined;
}

/**
 * How the open paragraph takes `content`. marked reads a setext heading's text before it looks for what ends a
 * paragraph, so a line that would end one is still heading text when an underline follows; the reader does not
 * join them, so it stops there.
 */
export function paragraphStep(content: string, line: Line, paragraph: OpenParagraph): ParagraphStep {
  const end = paragraphEnd(content, line, paragraph);
  const found = end !== undefined || line.depth > paragraph.depth ? 'interrupt' : continuation(content, line);
  const heading = line.setextAhead && end !== 'blank' && end !== 'underline';
  const next = found !== 'continue' && heading ? 'stop' : found;
  const ruleLeaves = isRule(content, line) && line.inList && leavesList(content, line.itemColumn);
  return { end, next, leaves: next === 'leave' || ruleLeaves };
}
