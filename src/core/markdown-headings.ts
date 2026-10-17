// No imports, so scripts load it from source as they load brand.ts; every pattern is linear on any line.
const HEADING = /^(#{1,6})[ \t]+([\s\S]*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})([\s\S]*)$/;
const CLOSING_HASHES = /(?:^|[ \t])#+$/;

/** One ATX heading of a Markdown text: its line index, its level and its trimmed title. */
export interface MarkdownHeading {
  readonly line: number;
  readonly level: number;
  /** The title without the optional closing run of `#`s. */
  readonly title: string;
}

// As CommonMark has it: a backtick fence's info string holds no backtick, and only a fence of at least as many of the
// same character, with nothing after it, closes a block.
function fenceAfter(open: string | undefined, line: string): string | undefined {
  const match = FENCE.exec(line);
  if (match === null) return open;
  const [, marker = '', rest = ''] = match;
  if (open === undefined) return marker.startsWith('`') && rest.includes('`') ? undefined : marker;
  return marker.startsWith(open) && rest.trim() === '' ? undefined : open;
}

/** The ATX headings of a Markdown text split into lines, leaving out every line inside a fenced code block. */
export function markdownHeadings(lines: readonly string[]): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let fence: string | undefined;
  for (const [line, text] of lines.entries()) {
    const fenced = fence !== undefined;
    fence = fenceAfter(fence, text);
    const match = fenced || fence !== undefined ? null : HEADING.exec(text);
    if (match === null) continue;
    const title = (match[2] ?? '').trim().replace(CLOSING_HASHES, '').trimEnd();
    headings.push({ line, level: match[1]?.length ?? 0, title });
  }
  return headings;
}
