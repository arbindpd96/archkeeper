import { withoutComments } from '../../../core/imports.js';
import { markdownHeadings } from '../../../core/markdown-headings.js';
import { toLf } from '../../../core/text.js';

const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])[ \t]/;

/**
 * Markdown as the memory hooks read it: LF line endings and no HTML comments, which Claude Code strips from
 * CLAUDE.md but not from a hook's `additionalContext`.
 */
export function readableMarkdown(text: string): string {
  return withoutComments(toLf(text));
}

/**
 * The trimmed text under the first `##` heading whose title starts with `title`, in any case, such as
 * `## Decisions (never undo without asking)` for `Decisions`, up to the next `#` or `##` heading; undefined
 * when there is no such heading. A `#` line inside a code fence is code, not a heading.
 */
export function sectionText(markdown: string, title: string): string | undefined {
  const lines = markdown.split('\n');
  const headings = markdownHeadings(lines);
  const wanted = title.toLowerCase();
  const at = headings.findIndex(
    (heading) => heading.level === 2 && heading.title.toLowerCase().startsWith(wanted),
  );
  const start = headings[at];
  if (start === undefined) return undefined;
  const next = headings.slice(at + 1).find((heading) => heading.level <= 2);
  return lines
    .slice(start.line + 1, next?.line)
    .join('\n')
    .trim();
}

/** The last `count` top-level list items of a section, each with the lines that continue it, and how many it has. */
export function lastItems(text: string, count: number): { readonly items: string[]; readonly total: number } {
  const items: string[][] = [];
  for (const line of text.split('\n')) {
    if (LIST_ITEM.test(line)) items.push([line]);
    else if (line.trim() !== '') items.at(-1)?.push(line);
  }
  return { items: items.slice(-count).map((lines) => lines.join('\n')), total: items.length };
}
