import type { BlocksFile } from './blocks-file.js';
import { markerLine } from './markers.js';
import { frontmatterEnd } from './memory-imports.js';
import { BYTE_ORDER_MARK } from './text.js';

/** A block the kit adds to a file, with its LF content. */
export interface NewBlock {
  readonly id: string;
  readonly body: string;
}

/** Changes to the blocks of one file: bodies to replace (LF), blocks to remove, and blocks to add in order. */
export interface BlockEdits {
  readonly replace: ReadonlyMap<string, string>;
  readonly remove: ReadonlySet<string>;
  readonly insert: readonly NewBlock[];
}

function withEol(text: string, eol: string): string {
  return eol === '\n' ? text : text.replaceAll('\n', eol);
}

// A CLAUDE.md import block, such as `@AGENTS.md`, goes first so the shared rules load before anything else.
function importsOnly(body: string): boolean {
  const lines = body.split('\n').filter((line) => line.trim() !== '');
  return lines.length > 0 && lines.every((line) => line.startsWith('@'));
}

function renderBlock(file: BlocksFile, prefix: string, block: NewBlock): string {
  const { eol, style } = file;
  const begin = markerLine(style, prefix, 'begin', block.id);
  const end = markerLine(style, prefix, 'end', block.id);
  return `${begin}${eol}${withEol(block.body, eol)}${end}${eol}`;
}

function keptParts(file: BlocksFile, edits: BlockEdits): string {
  return file.parts
    .map((part) => {
      if (part.kind === 'text') return part.text;
      if (edits.remove.has(part.id)) return '';
      const body = edits.replace.get(part.id);
      return `${part.begin}${body === undefined ? part.body : withEol(body, file.eol)}${part.end}`;
    })
    .join('');
}

// Claude Code reads YAML frontmatter only at the very top of a Markdown memory file, so the first new block goes
// on the line after a frontmatter's closing `---`.
function firstBlockAt(file: BlocksFile, text: string): number {
  const close = file.style === 'html' ? frontmatterEnd(text) : 0;
  if (close === 0) return 0;
  const lineEnd = text.indexOf('\n', close);
  return lineEnd === -1 ? text.length : lineEnd + 1;
}

function withFirst(file: BlocksFile, text: string, blocks: readonly string[]): string {
  const at = firstBlockAt(file, text);
  const head = text.slice(0, at);
  const rest = text.slice(at);
  const ended = head === '' || head.endsWith('\n') ? head : `${head}${file.eol}`;
  return ended + blocks.join(file.eol) + (rest === '' ? '' : file.eol) + rest;
}

/**
 * Applies block edits to a parsed file and returns its new text. Bytes outside managed blocks, the byte-order
 * mark and the line endings stay as they are. A new block of `@` imports goes first, after any YAML frontmatter
 * of a Markdown file, followed by a blank line; any other new block is appended after a blank line. New markers
 * use `prefix`; existing ones keep theirs.
 */
export function editBlocks(file: BlocksFile, edits: BlockEdits, prefix: string): string {
  const { eol } = file;
  const render = (block: NewBlock): string => renderBlock(file, prefix, block);
  const first = edits.insert.filter((block) => importsOnly(block.body)).map(render);
  const last = edits.insert.filter((block) => !importsOnly(block.body)).map(render);
  let text = keptParts(file, edits);
  if (first.length > 0) text = withFirst(file, text, first);
  if (last.length > 0) {
    const ended = text === '' || text.endsWith('\n') ? text : `${text}${eol}`;
    text = (ended === '' ? '' : `${ended}${eol}`) + last.join(eol);
  }
  return (file.bom ? BYTE_ORDER_MARK : '') + text;
}
