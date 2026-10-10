const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|' +
  'dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|' +
  'menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|' +
  'thead|title|tr|track|ul';
const INTERRUPTING = new RegExp(
  `^(?:</?(?:${BLOCK_TAGS})(?: +|/?>|$)|<(?:script|pre|style|textarea|!--))`,
  'i',
);
const RAW_TAG_START = /^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i;
const ENDED_BY: readonly (readonly [RegExp, string])[] = [
  [/^ {0,3}<\?/, '?>'],
  [/^ {0,3}<![A-Z]/i, '>'],
  [/^ {0,3}<!\[CDATA\[/, ']]>'],
];
const ATTRIBUTE = ` +[a-zA-Z:_][\\w.:-]*(?: *= *"[^"]*"| *= *'[^']*'| *= *[^\\s"'=<>\`]+)?`;
const BARE_BLOCK_TAG = new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})$`, 'i');
const BLANK_ENDED = [
  new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?: +|/?>|$)`, 'i'),
  new RegExp(`^ {0,3}<(?!script|pre|style|textarea)[a-z][\\w-]*(?:${ATTRIBUTE})*? */?>[ \\t]*$`, 'i'),
  /^ {0,3}<\/(?!script|pre|style|textarea)[a-z][\w-]*\s*>[ \t]*$/i,
];
const BLANK = /^[ \t]*$/;

/** What `end` returns for a line that does not end the block. */
export const NOT_CLOSED = -1;

/** An HTML block other than a comment: where its first line's opener ends, and where a line ends the block. */
export interface HtmlBlock {
  readonly from: number;
  readonly end: (content: string) => number;
}

/** Ends a block after the whole line on which `ends` holds. */
export function wholeLine(ends: (content: string) => boolean): (content: string) => number {
  return (content) => (ends(content) ? content.length : NOT_CLOSED);
}

// `<?`, `<!X` and `<![CDATA[` blocks end right after their marker; the rest of that line starts a new block.
function markerEnd(marker: string): (content: string) => number {
  return (content) => {
    const at = content.toLowerCase().indexOf(marker);
    return at === NOT_CLOSED ? NOT_CLOSED : at + marker.length;
  };
}

/** Whether `content` starts HTML that may interrupt a paragraph: a comment, `<pre>`-like or a block-level tag. */
export function htmlInterrupts(content: string): boolean {
  return INTERRUPTING.test(content);
}

/** The HTML block other than a comment that `content` opens as marked's block rule reads it, or undefined. */
export function htmlBlock(content: string): HtmlBlock | undefined {
  const raw = RAW_TAG_START.exec(content);
  if (raw !== null) {
    const closer = `</${(raw[1] ?? '').toLowerCase()}>`;
    return { from: raw[0].length, end: wholeLine((line) => line.toLowerCase().includes(closer)) };
  }
  for (const [start, marker] of ENDED_BY) {
    const opened = start.exec(content);
    if (opened !== null) return { from: opened[0].length, end: markerEnd(marker) };
  }
  if (!BLANK_ENDED.some((start) => start.test(content))) return undefined;
  return { from: content.length, end: blankEnd(BARE_BLOCK_TAG.test(content)) };
}

// A block tag that ends its line, such as `<div`, takes the line end with it, so a blank line ends the block
// only after a line of text.
function blankEnd(bare: boolean): (content: string) => number {
  let text = !bare;
  return wholeLine((line) => {
    const blank = BLANK.test(line);
    const ends = blank && text;
    text ||= !blank;
    return ends;
  });
}
