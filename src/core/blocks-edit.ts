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

/** A part of the file as kept, user text or a managed block, with its new text. */
interface KeptPart {
  readonly text: string;
  readonly block: boolean;
}

function keptParts(file: BlocksFile, edits: BlockEdits): KeptPart[] {
  return file.parts.map((part) => {
    if (part.kind === 'text') return { text: part.text, block: false };
    if (edits.remove.has(part.id)) return { text: '', block: true };
    const body = edits.replace.get(part.id);
    return {
      text: `${part.begin}${body === undefined ? part.body : withEol(body, file.eol)}${part.end}`,
      block: true,
    };
  });
}

// Claude Code reads YAML frontmatter only at the very top of a Markdown memory file, so the first new block goes
// on the line after a frontmatter's closing `---`, or after the kept block that line falls in, never inside it.
function firstBlockAt(file: BlocksFile, parts: readonly KeptPart[]): number {
  const text = parts.map((part) => part.text).join('');
  const close = file.style === 'html' ? frontmatterEnd(text) : 0;
  if (close === 0) return 0;
  const lineEnd = text.indexOf('\n', close);
  const at = lineEnd === -1 ? text.length : lineEnd + 1;
  let start = 0;
  for (const part of parts) {
    const end = start + part.text.length;
    if (part.block && start < at && at < end) return end;
    start = end;
  }
  return at;
}

function withFirst(file: BlocksFile, text: string, at: number, blocks: readonly string[]): string {
  const head = text.slice(0, at);
  const rest = text.slice(at);
  const ended = head === '' || head.endsWith('\n') ? head : `${head}${file.eol}`;
  return ended + blocks.join(file.eol) + (rest === '' ? '' : file.eol) + rest;
}

/**
 * Applies block edits to a parsed file and returns its new text. Bytes outside managed blocks, the byte-order
 * mark and the line endings stay as they are. A new block of `@` imports goes first, after any YAML frontmatter
 * of a Markdown file (after the managed block its closing line falls in), followed by a blank line; any other new block is appended after a blank line. New markers
 * use `prefix`; existing ones keep theirs.
 */
export function editBlocks(file: BlocksFile, edits: BlockEdits, prefix: string): string {
  const { eol } = file;
  const render = (block: NewBlock): string => renderBlock(file, prefix, block);
  const first = edits.insert.filter((block) => importsOnly(block.body)).map(render);
  const last = edits.insert.filter((block) => !importsOnly(block.body)).map(render);
  const parts = keptParts(file, edits);
  let text = parts.map((part) => part.text).join('');
  if (first.length > 0) text = withFirst(file, text, firstBlockAt(file, parts), first);
  if (last.length > 0) {
    const ended = text === '' || text.endsWith('\n') ? text : `${text}${eol}`;
    text = (ended === '' ? '' : `${ended}${eol}`) + last.join(eol);
  }
  return (file.bom ? BYTE_ORDER_MARK : '') + text;
}
