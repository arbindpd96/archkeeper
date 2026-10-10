import { BRAND, type Brand } from './brand.js';
import { withoutComments } from './imports.js';
import { markerPattern, markerStyle, parseMarker } from './markers.js';
import type { RenderedEntry, RenderTree } from './render-tree.js';
import { toLf } from './text.js';

const IMPORT_LINE = /^@\S+$/;
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
const WORDS = /(?<!\\)\s+/;

function importLines(entry: RenderedEntry): string[] {
  return entry.content.split('\n').filter((line) => line.trim() !== '');
}

function isImportBlock(entry: RenderedEntry): boolean {
  const lines = importLines(entry);
  return entry.strategy === 'blocks' && lines.length > 0 && lines.every((line) => IMPORT_LINE.test(line));
}

function sameImport(word: string): string {
  return word.replace(/^@\.\//, '@');
}

// The user's own text: every line outside the kit's managed blocks and outside fenced code.
function userText(text: string, brand: Brand): string {
  const pattern = markerPattern(brand);
  const kept: string[] = [];
  let inBlock = false;
  let inFence = false;
  for (const line of toLf(text).split('\n')) {
    const marker = pattern.test(line) ? parseMarker(line, 'html', brand) : undefined;
    if (marker !== undefined) inBlock = marker.edge === 'begin';
    else if (!inBlock && FENCE.test(line)) inFence = !inFence;
    else if (!inBlock && !inFence) kept.push(line);
  }
  return kept.join('\n');
}

function importsIn(text: string): Set<string> {
  const words = withoutComments(text).split(WORDS);
  return new Set(words.filter((word) => word.startsWith('@')).map(sameImport));
}

/**
 * Leaves out each rendered block made only of `@` imports, such as base's `@AGENTS.md`, that its Markdown file
 * already makes outside the kit's blocks, code fences and HTML comments, so an import a user wrote is never
 * duplicated (#28). `read` gives a file's current text, or undefined when it is absent or not a text file.
 */
export function withoutImportedBlocks(
  tree: RenderTree,
  read: (path: string) => string | undefined,
  brand: Brand = BRAND,
): RenderTree {
  const kept = new Map<string, readonly RenderedEntry[]>();
  for (const [path, entries] of tree) {
    const text = markerStyle(path) === 'html' && entries.some(isImportBlock) ? read(path) : undefined;
    const made = text === undefined ? new Set<string>() : importsIn(userText(text, brand));
    const left = entries.filter(
      (entry) => !isImportBlock(entry) || !importLines(entry).every((line) => made.has(sameImport(line))),
    );
    if (left.length > 0) kept.set(path, left);
  }
  return kept;
}
