import { BRAND, type Brand } from './brand.js';
import { withoutComments } from './imports.js';
import { markerPattern, markerStyle, parseMarker } from './markers.js';
import type { RenderedEntry, RenderTree } from './render-tree.js';
import { toLf } from './text.js';

const IMPORT_LINE = /^@\S+$/;
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
const CODE_SPAN = /`[^`\n]*`/g;
// Claude Code reads an `@path` after a space or right after inline markdown, such as **@AGENTS.md**, never inside
// a word such as an email address, and the path ends where that markdown closes (reference §2.1).
const IMPORT = /(?<![\w@])@((?:\\ |[^\s])+)/g;
const MARKDOWN_CLOSE = /[*_~)\],.;:!?]+$/;
/** Memory files Claude Code loads together with a file the kit writes, so their imports count as made too. */
const COMPANIONS: Readonly<Record<string, readonly string[]>> = { 'CLAUDE.md': ['.claude/CLAUDE.md'] };

function importLines(entry: RenderedEntry): string[] {
  return entry.content.split('\n').filter((line) => line.trim() !== '');
}

function isImportBlock(entry: RenderedEntry): boolean {
  const lines = importLines(entry);
  return entry.strategy === 'blocks' && lines.length > 0 && lines.every((line) => IMPORT_LINE.test(line));
}

function folderOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

// The project path an import names: relative to the importing file's folder, as Claude Code resolves it.
function resolved(folder: string, target: string): string {
  const parts: string[] = [];
  for (const part of [...folder.split('/'), ...target.split('/')]) {
    if (part === '..') parts.pop();
    else if (part !== '' && part !== '.') parts.push(part);
  }
  return parts.join('/');
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

// Claude Code reads no import inside a code span (reference §2.1), even one with spaces around the `@`.
function importsIn(text: string, folder: string, brand: Brand): string[] {
  const prose = withoutComments(userText(text, brand)).replace(CODE_SPAN, ' ');
  return [...prose.matchAll(IMPORT)].map(([, target = '']) =>
    resolved(folder, target.replace(MARKDOWN_CLOSE, '').replaceAll('\\ ', ' ')),
  );
}

function importsMade(path: string, read: (path: string) => string | undefined, brand: Brand): Set<string> {
  const files = [path, ...(COMPANIONS[path] ?? [])];
  return new Set(
    files.flatMap((file) => {
      const text = read(file);
      return text === undefined ? [] : importsIn(text, folderOf(file), brand);
    }),
  );
}

/**
 * Leaves out each rendered block made only of `@` imports, such as base's `@AGENTS.md`, that its Markdown file, or
 * a memory file loaded with it such as `.claude/CLAUDE.md`, already makes outside the kit's blocks, code and HTML
 * comments, so an import a user wrote is never duplicated (#28). `read` gives a file's current text, or undefined
 * when it is absent or not a text file.
 */
export function withoutImportedBlocks(
  tree: RenderTree,
  read: (path: string) => string | undefined,
  brand: Brand = BRAND,
): RenderTree {
  const kept = new Map<string, readonly RenderedEntry[]>();
  for (const [path, entries] of tree) {
    const blocks = entries.filter(isImportBlock);
    const made =
      markerStyle(path) === 'html' && blocks.length > 0 ? importsMade(path, read, brand) : new Set();
    const isMade = (line: string): boolean => made.has(resolved(folderOf(path), line.slice(1)));
    const left = entries.filter((entry) => !blocks.includes(entry) || !importLines(entry).every(isMade));
    if (left.length > 0) kept.set(path, left);
  }
  return kept;
}
