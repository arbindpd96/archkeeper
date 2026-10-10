import { withoutComments } from './imports.js';
import { htmlBlock, NOT_CLOSED, wholeLine } from './markdown-html.js';
import {
  BLANK,
  codeAfterMarker,
  COMMENT_START,
  DEFINITION,
  expanded,
  FENCE_START,
  HEADING,
  hidesInItem,
  indentOf,
  INDENTED_CODE,
  isSetextText,
  listMarker,
  MAYBE_DEFINITION,
  OPEN_LABEL,
  opensInItem,
  SETEXT_UNDERLINE,
  setextRuns,
  THEMATIC_BREAK,
  unquoted,
  withoutFrontmatter,
} from './markdown-lines.js';
import {
  type Closing,
  closeItems,
  endsItems,
  enterItem,
  itemFence,
  itemsLeft,
  leaveItems,
  type ListLine,
  type ListState,
} from './markdown-lists.js';
import { type Line, paragraphStep } from './paragraph-step.js';

const FENCE_CLOSER_TAIL = /^[`~]* *$/;
const SINGLE_MARKER = /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]+|$)/;
const BARE_DEFINITION = /^ {0,3}\[(?!\s*\])(?:\\.|[^[\]\\])+\]: *$/;
const TITLE_START = /^[ \t]*["'(]/;
const DESTINATION = /^[ \t]*(?:[^<\s]\S*|<.*?>)(?: +(?:"[^"]*"|'[^']*'|\([^()]*\)))? *$/;

/** Text Claude Code reads `@` imports in: inline Markdown, or what an HTML comment block leaves, which it reads raw. */
export interface ImportText {
  readonly text: string;
  readonly raw: boolean;
}

/** A fence or HTML block being skipped: its blockquote depth and indent, and where its last line ends it. */
interface OpenBlock {
  readonly depth: number;
  readonly indent: number;
  readonly end: (content: string) => number;
  readonly comment?: string[];
}

/** The state of one pass over a file's lines. */
interface Scan extends ListState {
  readonly texts: ImportText[];
  paragraph: string[];
  paragraphDepth: number;
  setextable: boolean;
  unsure: boolean;
  textBefore: boolean;
  depth: number;
  open: OpenBlock | undefined;
  line: number;
  definedAt: number;
  label: string | undefined;
  lastContent: string;
  stopped: boolean;
}

/** Reads nothing more, not even the open paragraph, whose rest could have hidden what it holds. */
function stop(scan: Scan): void {
  scan.stopped = true;
  scan.paragraph = [];
}

/**
 * A paragraph that may be a link definition, or the title of one, is left unread. A label left open may run on
 * past blank lines, so the reader stops there.
 */
function startParagraph(scan: Scan, content: string, depth: number): void {
  const inner = content.slice(listMarker(content, scan.inList).length);
  scan.paragraph = [content];
  scan.paragraphDepth = depth;
  scan.setextable = isSetextText(inner);
  scan.unsure = scan.definedAt === scan.line - 1 || MAYBE_DEFINITION.test(inner);
  if (OPEN_LABEL.test(inner)) stop(scan);
}

function endParagraph(scan: Scan): void {
  if (scan.paragraph.length > 0 && !scan.unsure) {
    scan.texts.push({ text: scan.paragraph.join('\n'), raw: false });
  }
  scan.paragraph = [];
}

function settle(scan: Scan, closing: Closing): void {
  if (closing !== 'kept') endParagraph(scan);
  if (closing === 'stop') stop(scan);
}

function closeBlock(scan: Scan, block: OpenBlock): void {
  scan.open = undefined;
  if (block.comment !== undefined) {
    scan.texts.push({ text: withoutComments(block.comment.join('\n')), raw: true });
  }
}

function fenceEnd(fence: string, column: number): (content: string) => number {
  return wholeLine((content) => {
    const spaces = content.length - content.replace(/^ +/, '').length;
    const code = content.slice(spaces);
    const closes = code.startsWith(fence) && FENCE_CLOSER_TAIL.test(code.slice(fence.length));
    return closes && spaces - column <= 3;
  });
}

function startFence(scan: Scan, content: string, depth: number, column = 0): boolean {
  const fence = FENCE_START.exec(expanded(content).slice(column))?.[1];
  if (fence !== undefined) scan.open = { depth, indent: indentOf(content), end: fenceEnd(fence, column) };
  return fence !== undefined;
}

/** An HTML block that a list item or a lazy quote line opens ends with them, so the reader stops at one. */
function openHtml(scan: Scan, block: OpenBlock, line: Line): void {
  if (line.inList || line.lazy) stop(scan);
  else scan.open = block;
}

function startComment(scan: Scan, content: string, line: Line): void {
  const from = content.indexOf('<!--') + 4;
  const ends = (text: string): boolean => text.includes('-->');
  const block: OpenBlock = {
    depth: line.depth,
    indent: indentOf(content),
    end: wholeLine(ends),
    comment: [content],
  };
  if (/^-?>/.test(content.slice(from)) || ends(content.slice(from))) closeBlock(scan, block);
  else openHtml(scan, block, line);
}

/**
 * A `<?…?>`, `<!X …>` or CDATA block ends right after its marker, and the rest of that line starts a new block,
 * which the reader does not follow, so it stops there.
 */
function readHtml(scan: Scan, content: string, line: Line): boolean {
  const html = htmlBlock(content);
  if (html === undefined) return false;
  const rest = html.from < content.length ? html.end(content.slice(html.from)) : NOT_CLOSED;
  if (rest === NOT_CLOSED) {
    openHtml(scan, { depth: line.depth, indent: indentOf(content), end: html.end }, line);
  } else if (!BLANK.test(content.slice(html.from + rest))) stop(scan);
  return true;
}

/**
 * An item whose text is only an empty inner item still has text, so the next line goes on lazily. marked reads
 * a list inside a quote again with the quote's lazy lines, which the reader does not follow, so it stops there.
 */
function readListItem(scan: Scan, content: string, inner: string, depth: number): void {
  const nested = (SINGLE_MARKER.exec(content)?.[0].length ?? 0) < content.length - inner.length;
  if (opensInItem(inner) || depth > 0) stop(scan);
  else if (BLANK.test(inner)) scan.textBefore = nested;
  else if (!THEMATIC_BREAK.test(inner)) startParagraph(scan, content, depth);
  if (HEADING.test(inner)) endParagraph(scan);
}

/** An indented line in a list may be the item's own text; the reader stops where that text could hide more. */
function readCode(scan: Scan, content: string, line: Line): void {
  const text = content.trimStart();
  const column = line.itemColumn;
  if (!line.inList) return;
  if (hidesInItem(text) || text.startsWith('[') || column === undefined) stop(scan);
  else if (!INDENTED_CODE.test(expanded(content).slice(column))) startParagraph(scan, content, line.depth);
}

/** A paragraph on a lazy line may belong to the quote above, and join its next lines, so the reader stops. */
function readParagraphStart(scan: Scan, content: string, line: Line): void {
  if (line.lazy) stop(scan);
  else startParagraph(scan, content, line.depth);
}

/** A link definition may name its destination on the next line, which then belongs to the definition. */
function readDefinition(scan: Scan, content: string, inner: string): void {
  scan.definedAt = scan.line;
  scan.textBefore = true;
  scan.label = BARE_DEFINITION.test(inner) ? content : undefined;
}

function readOwnBlock(scan: Scan, content: string, line: Line): void {
  if (HEADING.test(content)) scan.texts.push({ text: content, raw: false });
  else if (COMMENT_START.test(content)) startComment(scan, content, line);
  else if (!startFence(scan, content, line.depth) && !readHtml(scan, content, line)) {
    readParagraphStart(scan, content, line);
  }
}

function readBlock(scan: Scan, content: string, line: Line): void {
  const marker = listMarker(content, line.inList);
  const inner = content.slice(marker.length);
  if (marker !== '') enterItem(scan, marker, inner, line.depth);
  if (marker.includes('\t')) stop(scan);
  else if (codeAfterMarker(marker) && !BLANK.test(inner)) return;
  else if (DEFINITION.test(inner)) readDefinition(scan, content, inner);
  else if (marker !== '') readListItem(scan, content, inner, line.depth);
  else readOwnBlock(scan, content, line);
}

/**
 * marked indents a `===` or `---` line inside a quote by four spaces unless it opens the quote's text; the
 * reader does not tell which, so it stops at one.
 */
function readBlockStart(scan: Scan, content: string, line: Line): void {
  if (scan.stopped) return;
  if (itemFence(content, line.itemColumn)) startFence(scan, content, line.depth, line.itemColumn);
  else if (line.depth > 0 && SETEXT_UNDERLINE.test(content)) stop(scan);
  else if (BLANK.test(content) || THEMATIC_BREAK.test(content)) return;
  else if (INDENTED_CODE.test(content)) readCode(scan, content, line);
  else readBlock(scan, content, line);
}

/** Adds `content` to the open paragraph, or ends it and returns false when `content` starts a block. */
function continuesParagraph(scan: Scan, content: string, line: Line): boolean {
  const paragraph = { setextable: scan.setextable, depth: scan.paragraphDepth };
  const { end, next, leaves } = paragraphStep(content, line, paragraph);
  if (leaves) settle(scan, leaveItems(scan, content));
  if (next === 'interrupt' || next === 'leave') {
    endParagraph(scan);
    return end !== undefined;
  }
  scan.setextable &&= isSetextText(content);
  if (next === 'continue') scan.paragraph.push(content);
  else stop(scan);
  return true;
}

/**
 * A fence or HTML block in a quote ends where the quote does; neither goes on lazily. One that opened indented
 * may sit in a list item, which a line indented less can end, so the reader stops there.
 */
function readOpenLine(scan: Scan, block: OpenBlock, line: string): boolean {
  const { depth, content } = unquoted(line, block.depth);
  if (depth < block.depth) {
    scan.open = undefined;
    return false;
  }
  scan.stopped = !BLANK.test(content) && indentOf(content) < block.indent;
  block.comment?.push(content);
  const ended = scan.stopped ? NOT_CLOSED : block.end(content);
  if (ended === NOT_CLOSED) return true;
  closeBlock(scan, block);
  scan.stopped = !BLANK.test(content.slice(ended));
  return true;
}

/**
 * A link definition may go on with a destination on the next line, or a title, which may run over more lines
 * that the reader does not follow, so it stops there. A label with no destination after it was no definition
 * but the start of a paragraph, read as unsure.
 */
function readsDefinition(scan: Scan, content: string, depth: number): boolean {
  const { label } = scan;
  const destination = label !== undefined && isDestination(scan, content, depth);
  scan.label = undefined;
  if (scan.definedAt === scan.line - 1 && TITLE_START.test(content)) stop(scan);
  if (label !== undefined && !destination) {
    startParagraph(scan, label, scan.depth);
    scan.unsure = true;
  }
  if (!destination && !scan.stopped) return false;
  scan.definedAt = scan.line;
  scan.textBefore = true;
  return true;
}

/** A definition's destination stays in its quote, and in its list item unless the line ends the item. */
function isDestination(scan: Scan, content: string, depth: number): boolean {
  return depth === scan.depth && !(scan.inList && endsItems(content)) && DESTINATION.test(content);
}

/** A lazy line keeps the list of the quote it continues. */
function updateList(scan: Scan, line: ListLine, depth: number, textBefore: boolean): void {
  if (!scan.inList) return;
  settle(scan, closeItems(scan, itemsLeft(scan, line), line.content));
  scan.inList &&= depth >= scan.listDepth || textBefore || BLANK.test(line.raw);
}

/** The lines around one: the line after it, and whether a setext underline ends heading text going on from it. */
interface Around {
  readonly next: string | undefined;
  readonly setextAhead: boolean;
}

function placeLine(scan: Scan, line: string, previous: string, around: Around): Line {
  const { depth } = unquoted(line, Infinity);
  const textBefore = scan.textBefore || scan.paragraph.length > 0;
  const content = unquoted(line, scan.listDepth).content;
  const afterEmptyItem = scan.emptyItemAt === scan.line - 1;
  scan.textBefore = false;
  updateList(scan, { raw: line, content, previous, afterEmptyItem }, depth, textBefore);
  const { next, setextAhead } = around;
  const fenceInterrupts = next !== undefined && unquoted(next, depth).depth >= depth;
  const inList = scan.inList && (depth === scan.listDepth || (depth < scan.listDepth && textBefore));
  const lazy = depth < scan.depth;
  return { fenceInterrupts, setextAhead, depth, lazy, inList, itemColumn: scan.items.at(-1)?.column };
}

function readLine(scan: Scan, line: string, around: Around): void {
  scan.line += 1;
  const previous = scan.lastContent;
  scan.lastContent = unquoted(line, scan.listDepth).content;
  if (scan.stopped || (scan.open !== undefined && readOpenLine(scan, scan.open, line))) return;
  const { depth, content } = unquoted(line, Infinity);
  if (readsDefinition(scan, content, depth)) return;
  const placed = placeLine(scan, line, previous, around);
  scan.depth = depth;
  if (scan.paragraph.length > 0 && continuesParagraph(scan, content, placed)) return;
  readBlockStart(scan, content, {
    ...placed,
    inList: placed.inList && scan.inList,
    itemColumn: scan.items.at(-1)?.column,
  });
}

/**
 * Splits a Markdown memory file into the text Claude Code 2.1.295 reads `@` imports in, as its lexer (marked
 * 15 without GFM) does: no frontmatter, code, HTML block other than a closed comment, or link definition. Where
 * the reader cannot follow the lexer, such as a fence opened on a list item's first line, it stops reading.
 */
export function importTexts(text: string): ImportText[] {
  const scan: Scan = {
    texts: [],
    paragraph: [],
    paragraphDepth: 0,
    setextable: false,
    unsure: false,
    textBefore: false,
    depth: 0,
    open: undefined,
    line: 0,
    definedAt: -2,
    label: undefined,
    lastContent: '',
    stopped: false,
    inList: false,
    listDepth: 0,
    items: [],
    emptyItemAt: -2,
  };
  const lines = withoutFrontmatter(text).split('\n');
  const setext = setextRuns(lines);
  lines.forEach((line, index) => {
    readLine(scan, line, { next: lines[index + 1], setextAhead: setext[index] ?? false });
  });
  endParagraph(scan);
  return scan.texts;
}
