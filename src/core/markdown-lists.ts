import {
  BLANK,
  columnsOf,
  expanded,
  FENCE_START,
  hidesInItem,
  indentOf,
  isBlock,
  ITEM_HTML,
  listMarker,
  MAYBE_DEFINITION,
  THEMATIC_BREAK,
} from './markdown-lines.js';

const BULLETS = /( {0,3})(?:[*+-]|\d{1,9}[.)])([ \t]*)/g;
const CODE_TEXT = /^(?: {4}| {0,3}\t)[ \t]*\S/;
const ITEM_ENDS = [/^ {0,3}(?:```|~~~)/, /^ {0,3}#/, THEMATIC_BREAK, ITEM_HTML];

/** An open list item: the column its text starts at, and whether a blank line or an empty first line came in it. */
export interface Item {
  readonly column: number;
  blank: boolean;
}

/** The list items open at a line, the quote depth of their list, the line read, and the last empty item's line. */
export interface ListState {
  inList: boolean;
  listDepth: number;
  items: Item[];
  line: number;
  emptyItemAt: number;
}

/** A line of a list as the list's own lines read it: the whole line in the list's quote, and the line before. */
export interface ListLine {
  readonly raw: string;
  readonly content: string;
  readonly previous: string;
  readonly afterEmptyItem: boolean;
}

/** How a line goes on from the open paragraph: in it, as a new block, ending items, or where the reader stops. */
export type Continuation = 'continue' | 'interrupt' | 'leave' | 'stop';

/** What closing items did: nothing, closed the innermost ones, or left an outer item open, where the reader stops. */
export type Closing = 'kept' | 'closed' | 'stop';

/**
 * Each bullet on the line opens an item inside the one before. One followed by five spaces or more, or by nothing,
 * has its text one column after it.
 */
function bulletItems(marker: string, empty: boolean): Item[] {
  const bullets = [...marker.matchAll(BULLETS)];
  return bullets.map((bullet, index) => {
    const gap = bullet[2] ?? '';
    const last = index === bullets.length - 1;
    const close = (last && empty) || gap.length === 0 || gap.length > 4;
    const column = bullet.index + bullet[0].length - (close ? gap.length - 1 : 0);
    return { column, blank: last && empty };
  });
}

/** Opens the items whose bullets start the line, and closes the open ones they are not nested in. */
export function enterItem(list: ListState, marker: string, inner: string, depth: number): void {
  const empty = BLANK.test(inner);
  const bullet = indentOf(marker);
  const open = list.inList && depth === list.listDepth ? list.items : [];
  list.items = [...open.filter((item) => item.column <= bullet), ...bulletItems(marker, empty)];
  list.inList = true;
  list.listDepth = depth;
  list.emptyItemAt = empty ? list.line : -2;
}

/** The bullets that open items on a line in a list; a rule such as `- - -` opens none, and ends the list. */
function itemMarker(content: string): string {
  return THEMATIC_BREAK.test(content) ? '' : listMarker(content, true);
}

/** Whether a line starts a fence, heading, rule or HTML, which ends each item it sits left of. */
export function endsItems(content: string): boolean {
  return ITEM_ENDS.some((end) => end.test(content));
}

function endsItemText(before: string, column: number): boolean {
  const indent = ` {0,${String(Math.min(3, column - 1))}}`;
  const ends = [
    new RegExp(`^${indent}(?:\`\`\`|~~~)`),
    new RegExp(`^${indent}#`),
    new RegExp(`^${indent}(?:(?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})$`),
    CODE_TEXT,
  ];
  return ends.some((end) => end.test(before));
}

/** The line before as marked reads it for an item: after the bullet that opened the item, or cut at its column. */
function itemText(previous: string, column: number): string {
  const marker = listMarker(previous, true);
  const bullets = [...marker.matchAll(BULLETS)];
  const items = bulletItems(marker, BLANK.test(previous.slice(marker.length)));
  const bullet = bullets[items.findIndex((item) => item.column === column)];
  if (bullet === undefined) return expanded(previous).slice(column);
  return previous.slice(bullet.index + bullet[0].length - (bullet[2] ?? '').length);
}

/**
 * The items still open at a line. marked ends an empty item at a blank line after it, and an item at a line
 * indented less than it that starts a fence, heading, rule or HTML, once the item had a blank line, or when the
 * line before, cut at the item's column, starts one of those or code; any other line goes on lazily. An outer
 * item takes its lines before the items in it do, so where it ends, they end too.
 */
export function itemsLeft(list: ListState, line: ListLine): Item[] {
  const items = [...list.items];
  if (BLANK.test(line.raw)) {
    for (const item of items) item.blank = true;
    return line.afterEmptyItem ? items.slice(0, -1) : items;
  }
  const columns = itemMarker(line.content) === '' ? columnsOf(line.content) : Infinity;
  const startsBlock = endsItems(line.content);
  const ends = (item: Item): boolean =>
    startsBlock || item.blank || endsItemText(itemText(line.previous, item.column), item.column);
  const first = items.findIndex((item) => item.column > columns && ends(item));
  return first === -1 ? items : items.slice(0, first);
}

/**
 * Keeps `items` open; the list itself stays open over a blank line, for a next item. marked reads what follows
 * an inner list in its outer item as top-level text, which the reader does not follow, so it stops there.
 */
export function closeItems(list: ListState, items: Item[], content: string): Closing {
  const closed = items.length < list.items.length;
  list.items = items;
  list.inList &&= items.length > 0 || BLANK.test(content) || itemMarker(content) !== '';
  if (!closed) return 'kept';
  return items.length > 0 && itemMarker(content) === '' ? 'stop' : 'closed';
}

/** Closes the items that `content` sits left of. */
export function leaveItems(list: ListState, content: string): Closing {
  return closeItems(
    list,
    list.items.filter((item) => item.column <= columnsOf(content)),
    content,
  );
}

/** The line as its list item reads it: from the item's column on, when it sits there or further in. */
export function inItemText(content: string, inList: boolean, column: number | undefined): string {
  if (!inList || column === undefined || columnsOf(content) < column) return content;
  return expanded(content).slice(column);
}

/** The column of the innermost open item that `content` sits in: at that item's column or right of it. */
export function ownerColumn(items: readonly Item[], content: string): number | undefined {
  const indent = columnsOf(content);
  return items.findLast((item) => item.column <= indent)?.column;
}

/** Whether `content` opens a fence in the item at `column`, such as `    ```bash` under `- Run:`. */
export function itemFence(content: string, column: number | undefined): boolean {
  if (column === undefined) return false;
  return columnsOf(content) >= column && FENCE_START.test(expanded(content).slice(column));
}

/** Whether a block that interrupts an item's text from left of the item's column ends the item. */
export function leavesList(content: string, column: number | undefined): boolean {
  return endsItems(content) && columnsOf(content) < (column ?? 1) && itemMarker(content) === '';
}

/**
 * How a line goes on from a list item's paragraph. marked lexes an item's lines as new blocks, so any block or
 * item interrupts its text. A link definition may take the next line as its destination, and a line that may sit
 * in the item or end it, which the reader cannot tell, makes the reader stop.
 */
export function inListItem(
  content: string,
  column: number | undefined,
  owner: number | undefined,
): Continuation {
  if (MAYBE_DEFINITION.test(content)) return 'stop';
  if (isBlock(content) || startsItem(content, owner) || itemFence(content, column)) return 'interrupt';
  return outsideItem(content, column);
}

/**
 * Whether `content` opens an item, in this list or in one nested less than four columns into the item it sits in,
 * at `owner`. A line four columns in but left of every item goes on lazily, as code that cannot interrupt text.
 */
function startsItem(content: string, owner: number | undefined): boolean {
  const nested = owner !== undefined && columnsOf(content) - owner < 4;
  return itemMarker(content) !== '' || (nested && itemMarker(content.trimStart()) !== '');
}

function outsideItem(content: string, column: number | undefined): Continuation {
  const ends = endsItems(content);
  if (ends && columnsOf(content) < (column ?? 1)) return 'leave';
  return (ends && column === undefined) || hidesInItem(content.trimStart()) ? 'stop' : 'continue';
}
