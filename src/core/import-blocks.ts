import { BRAND, type Brand } from './brand.js';
import { memoryImports, skipsMemoryFile } from './memory-imports.js';
import { markerPattern, markerStyle, parseMarker } from './markers.js';
import type { RenderedEntry, RenderTree } from './render-tree.js';
import { toLf } from './text.js';

const IMPORT_LINE = /^@\S+$/;
const KIT_LINE = '<!-- -->';
const OUTSIDE_START = /^(?:[~/\\]|[A-Za-z]:)/;
const OUTSIDE_REASON = 'it may name a file outside the project';
/** Memory files Claude Code loads together with a file the kit writes (reference §2.1), so their imports count too. */
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

// The project path an import names, relative to the importing file's folder as Claude Code resolves it, or
// undefined for a path outside the project: an absolute, home or drive path, a `..` above the root, or any path
// with a backslash, which Windows reads as a separator. Only the project's own AGENTS.md may count as the import.
function resolved(folder: string, target: string): string | undefined {
  if (OUTSIDE_START.test(target) || target.includes('\\')) return undefined;
  const parts: string[] = [];
  for (const part of [...folder.split('/'), ...target.split('/')]) {
    if (part === '..' && parts.length === 0) return undefined;
    if (part === '..') parts.pop();
    else if (part !== '' && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

// The user's own text, where each line of the kit's managed blocks reads as an empty comment, as their markers do.
function userText(text: string, brand: Brand): string {
  const pattern = markerPattern(brand);
  let inBlock = false;
  const lines = toLf(text)
    .split('\n')
    .map((line) => {
      const marker = pattern.test(line) ? parseMarker(line, 'html', brand) : undefined;
      const kit = inBlock || marker !== undefined;
      if (marker !== undefined) inBlock = marker.edge === 'begin';
      return kit ? KIT_LINE : line;
    });
  return lines.join('\n');
}

function importsIn(text: string, folder: string, brand: Brand): string[] {
  if (skipsMemoryFile(text)) return [];
  return memoryImports(userText(text, brand)).flatMap((target) => {
    const path = resolved(folder, target);
    return path === undefined ? [] : [path];
  });
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
 * comments, so an import a user wrote is never duplicated (#28). An import that may name a file outside the
 * project, such as `@../../AGENTS.md` in a workspace package, never counts. `read` gives a file's current text, or
 * undefined when it is absent or not a text file.
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
    const isMade = (line: string): boolean => {
      const target = resolved(folderOf(path), line.slice(1));
      return target !== undefined && made.has(target);
    };
    const left = entries.filter((entry) => !blocks.includes(entry) || !importLines(entry).every(isMade));
    if (left.length > 0) kept.set(path, left);
  }
  return kept;
}

/** A kit import block left out, with the reason its import was refused. */
export interface RefusedImport {
  readonly file: string;
  readonly target: string;
  readonly reason: string;
}

/**
 * Leaves out each rendered block made only of `@` imports with an import `refusal` gives a reason against, such as
 * AGENTS.md linked to a private file, or one that may name a file outside the project, which `refusal` never sees,
 * and lists each one with its file, its project-relative target (or the import as written) and that reason.
 */
export function withoutRefusedImports(
  tree: RenderTree,
  refusal: (target: string, file: string) => string | undefined,
): { readonly tree: RenderTree; readonly refused: readonly RefusedImport[] } {
  const kept = new Map<string, readonly RenderedEntry[]>();
  const found: RefusedImport[] = [];
  for (const [path, entries] of tree) {
    const refusedIn = (entry: RenderedEntry): RefusedImport[] => {
      if (markerStyle(path) !== 'html' || !isImportBlock(entry)) return [];
      return importLines(entry).flatMap((line) => {
        const target = resolved(folderOf(path), line.slice(1));
        if (target === undefined) return [{ file: path, target: line.slice(1), reason: OUTSIDE_REASON }];
        const reason = refusal(target, path);
        return reason === undefined ? [] : [{ file: path, target, reason }];
      });
    };
    const left = entries.filter((entry) => {
      const refusals = refusedIn(entry);
      found.push(...refusals);
      return refusals.length === 0;
    });
    if (left.length > 0) kept.set(path, left);
  }
  return { tree: kept, refused: found };
}
