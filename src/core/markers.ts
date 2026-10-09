import type { Brand } from './brand.js';

/** How a managed-block marker is written: an HTML comment in Markdown, a `#` comment anywhere else. */
export type MarkerStyle = 'html' | 'hash';

/** Which end of a managed block a marker line opens or closes. */
export type MarkerEdge = 'begin' | 'end';

/** The prefixes, edge and syntax every marker of one brand shares. */
export type MarkerBrand = Pick<Brand, 'markerPrefix' | 'legacySlugs'>;

const KEBAB = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
const MARKDOWN = /\.(?:md|mdx|markdown)$/i;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function prefixes(brand: MarkerBrand): string {
  return [brand.markerPrefix, ...brand.legacySlugs].map(escaped).join('|');
}

/**
 * Matches `<prefix>:begin` or `<prefix>:end` anywhere in a text, for the brand's prefix and its legacy slugs, in
 * any case. The one regex serves both sides of a managed block: `render` refuses a template value that matches
 * it, and the block parser reads every line that matches it as a marker, so no value can open or close a block.
 */
export function markerPattern(brand: MarkerBrand): RegExp {
  return new RegExp(`(?:${prefixes(brand)}):(?:begin|end)`, 'iu');
}

/** The marker found in `text`, written in lower case, such as `<prefix>:end`, or undefined when it has none. */
export function markerIn(text: string, brand: MarkerBrand): string | undefined {
  return markerPattern(brand).exec(text)?.[0].toLowerCase();
}

/** The marker style of a blocks file: HTML comments for Markdown, which Claude Code strips from context. */
export function markerStyle(path: string): MarkerStyle {
  return MARKDOWN.test(path) ? 'html' : 'hash';
}

/** One marker line, such as `<!-- <prefix>:begin imports -->` or `# <prefix>:end base`. */
export function markerLine(style: MarkerStyle, prefix: string, edge: MarkerEdge, id: string): string {
  const marker = `${prefix}:${edge} ${id}`;
  return style === 'html' ? `<!-- ${marker} -->` : `# ${marker}`;
}

/** A well-formed marker line, read back. */
export interface Marker {
  readonly prefix: string;
  readonly edge: MarkerEdge;
  readonly id: string;
}

/**
 * Reads a line that {@link markerPattern} matched as a marker in `style`, or returns undefined when it is not
 * exactly one: the whole line, in lower case, with one space between parts and only trailing blanks after it.
 */
export function parseMarker(line: string, style: MarkerStyle, brand: MarkerBrand): Marker | undefined {
  const body = `(${prefixes(brand)}):(begin|end) (${KEBAB})`;
  const form = style === 'html' ? `<!-- ${body} -->` : `# ${body}`;
  const match = new RegExp(`^${form}[ \\t]*$`).exec(line);
  if (match === null) return undefined;
  const [, prefix = '', edge = '', id = ''] = match;
  return { prefix, edge: edge === 'begin' ? 'begin' : 'end', id };
}
