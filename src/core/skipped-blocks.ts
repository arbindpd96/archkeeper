import { withoutComments } from './imports.js';
import { htmlBlock, NOT_CLOSED, wholeLine } from './markdown-html.js';
import { BLANK, expanded, FENCE_START, indentOf, unquoted } from './markdown-lines.js';
import type { Line } from './paragraph-step.js';

const FENCE_CLOSER_TAIL = /^[`~]* *$/;

/** Text Claude Code reads `@` imports in: inline Markdown, or what an HTML comment block leaves, which it reads raw. */
export interface ImportText {
  readonly text: string;
  readonly raw: boolean;
}

/** A fence or HTML block being skipped: its blockquote depth and indent, and where its last line ends it. */
export interface OpenBlock {
  readonly depth: number;
  readonly indent: number;
  readonly end: (content: string) => number;
  readonly comment?: string[];
}

/** What skipping a block changes in a pass over a file: the text read, the open paragraph and block, a stop. */
export interface Skipping {
  readonly texts: ImportText[];
  paragraph: string[];
  open: OpenBlock | undefined;
  stopped: boolean;
}

/** Reads nothing more, not even the open paragraph, whose rest could have hidden what it holds. */
export function stop(scan: Skipping): void {
  scan.stopped = true;
  scan.paragraph = [];
}

function closeBlock(scan: Skipping, block: OpenBlock): void {
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

/** Opens the fence `content` starts, read from `column` on, and says whether it did. */
export function startFence(scan: Skipping, content: string, depth: number, column = 0): boolean {
  const fence = FENCE_START.exec(expanded(content).slice(column))?.[1];
  if (fence !== undefined) scan.open = { depth, indent: indentOf(content), end: fenceEnd(fence, column) };
  return fence !== undefined;
}

/** An HTML block that a list item or a lazy quote line opens ends with them, so the reader stops at one. */
function openHtml(scan: Skipping, block: OpenBlock, line: Line): void {
  if (line.inList || line.lazy) stop(scan);
  else scan.open = block;
}

/** Opens the HTML comment block `content` starts, or reads what it leaves when it ends on that line. */
export function startComment(scan: Skipping, content: string, line: Line): void {
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
export function readHtml(scan: Skipping, content: string, line: Line): boolean {
  const html = htmlBlock(content);
  if (html === undefined) return false;
  const rest = html.from < content.length ? html.end(content.slice(html.from)) : NOT_CLOSED;
  if (rest === NOT_CLOSED) {
    openHtml(scan, { depth: line.depth, indent: indentOf(content), end: html.end }, line);
  } else if (!BLANK.test(content.slice(html.from + rest))) stop(scan);
  return true;
}

/**
 * A fence or HTML block in a quote ends where the quote does; neither goes on lazily. One that opened indented
 * may sit in a list item, which a line indented less can end, so the reader stops there.
 */
export function readOpenLine(scan: Skipping, block: OpenBlock, line: string): boolean {
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
