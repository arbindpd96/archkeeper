import { type BlockEdits, editBlocks } from './blocks-edit.js';
import { blockParts, type BlocksFile, parseBlocks } from './blocks-file.js';
import { BRAND, type Brand } from './brand.js';
import { MergeError } from './errors.js';
import { memoryImports, skipsMemoryFile } from './memory-imports.js';
import { markerPattern, markerStyle, parseMarker } from './markers.js';
import type { RenderedEntry, RenderTree } from './render-tree.js';
import { BYTE_ORDER_MARK } from './text.js';

const IMPORT_LINE = /^@\S+$/;
const KIT_LINE = '<!-- -->';
const LINE_END = /\r?\n$/;
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
// Its byte-order mark and line endings stay, since Claude Code finds frontmatter only before an LF; markers are
// read as the block parser reads them, after the mark and without the line ending.
function userText(text: string, brand: Brand): string {
  const pattern = markerPattern(brand);
  const bom = text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
  let inBlock = false;
  const lines = text
    .slice(bom.length)
    .split(/(?<=\n)/)
    .map((line) => {
      const bare = line.replace(LINE_END, '');
      const marker = pattern.test(bare) ? parseMarker(bare, 'html', brand) : undefined;
      const kit = inBlock || marker !== undefined;
      if (marker !== undefined) inBlock = marker.edge === 'begin';
      return kit ? KIT_LINE + line.slice(bare.length) : line;
    });
  return bom + lines.join('');
}

function parsedOrUndefined(path: string, text: string, brand: Brand): BlocksFile | undefined {
  try {
    return parseBlocks(path, text, brand);
  } catch (error) {
    if (error instanceof MergeError) return undefined;
    throw error;
  }
}

// The file as Claude Code reads it once the kit writes it, without the import blocks being decided on: as it is
// now, which a kept conflict leaves, and with the kit's other blocks as rendered. Undefined for broken markers,
// where the kit writes nothing.
function writtenTexts(
  path: string,
  text: string,
  entries: readonly RenderedEntry[],
  brand: Brand,
): string[] | undefined {
  const file = parsedOrUndefined(path, text, brand);
  if (file === undefined) return undefined;
  const present = blockParts(file);
  const blocks = entries.flatMap((entry) =>
    entry.blockId === undefined
      ? []
      : [{ id: entry.blockId, body: entry.content, imports: isImportBlock(entry) }],
  );
  const remove = new Set(blocks.filter((block) => block.imports).map((block) => block.id));
  const others = blocks.filter((block) => !block.imports);
  const rendered: BlockEdits = {
    replace: new Map(others.filter(({ id }) => present.has(id)).map(({ id, body }) => [id, body])),
    remove,
    insert: others.filter(({ id }) => !present.has(id)),
  };
  const now: BlockEdits = { replace: new Map(), remove, insert: [] };
  return [now, rendered].map((edits) => editBlocks(file, edits, brand.markerPrefix));
}

function importedPaths(text: string, folder: string): Set<string> {
  return new Set(
    memoryImports(text).flatMap((target) => {
      const path = resolved(folder, target);
      return path === undefined ? [] : [path];
    }),
  );
}

// An import counts only when the user's text, with the kit's blocks masked, makes it and the file as Claude Code
// reads it once written makes it too: a block's lines can open HTML or a fence, or end one, where a mask cannot.
function importsIn(path: string, text: string, entries: readonly RenderedEntry[], brand: Brand): string[] {
  if (skipsMemoryFile(text)) return [];
  const written = entries.length === 0 ? [text] : writtenTexts(path, text, entries, brand);
  if (written === undefined) return [];
  let found: string[] | undefined;
  for (const view of new Set([userText(text, brand), ...written])) {
    const paths = importedPaths(view, folderOf(path));
    found = (found ?? [...paths]).filter((target) => paths.has(target));
    if (found.length === 0) return [];
  }
  return found ?? [];
}

function importsMade(
  path: string,
  entries: readonly RenderedEntry[],
  read: (path: string) => string | undefined,
  brand: Brand,
): Set<string> {
  const files = [path, ...(COMPANIONS[path] ?? [])];
  return new Set(
    files.flatMap((file) => {
      const text = read(file);
      return text === undefined ? [] : importsIn(file, text, file === path ? entries : [], brand);
    }),
  );
}

/**
 * Leaves out each rendered block made only of `@` imports, such as base's `@AGENTS.md`, that its Markdown file, or
 * a memory file loaded with it such as `.claude/CLAUDE.md`, already makes outside the kit's blocks, code and HTML
 * comments, and still makes once the kit writes the file, so an import a user wrote is never duplicated (#28). An import that may name a file outside the
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
      markerStyle(path) === 'html' && blocks.length > 0 ? importsMade(path, entries, read, brand) : new Set();
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
