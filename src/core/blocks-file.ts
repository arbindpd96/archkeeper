import { MergeError } from './errors.js';
import {
  type Marker,
  type MarkerBrand,
  markerIn,
  markerLine,
  markerPattern,
  markerStyle,
  type MarkerStyle,
  parseMarker,
} from './markers.js';
import { BYTE_ORDER_MARK } from './text.js';

/** User text between managed blocks, kept byte for byte. */
export interface TextPart {
  readonly kind: 'text';
  readonly text: string;
}

/** One managed block: its marker lines as written, with their line endings, and the lines between them. */
export interface BlockPart {
  readonly kind: 'block';
  readonly id: string;
  readonly begin: string;
  readonly body: string;
  readonly end: string;
}

/** A blocks file split into user text and managed blocks; joining the parts gives back every byte. */
export interface BlocksFile {
  readonly bom: boolean;
  readonly eol: '\n' | '\r\n';
  readonly style: MarkerStyle;
  readonly parts: readonly (TextPart | BlockPart)[];
}

interface OpenBlock {
  readonly id: string;
  readonly begin: string;
  readonly line: number;
  body: string;
}

interface ParseState {
  readonly path: string;
  readonly brand: MarkerBrand;
  readonly style: MarkerStyle;
  readonly pattern: RegExp;
  readonly parts: (TextPart | BlockPart)[];
  readonly closed: Map<string, number>;
  text: string;
  open: OpenBlock | undefined;
}

function malformed(path: string, line: number, problem: string): MergeError {
  return new MergeError({
    file: path,
    location: `line ${String(line)}`,
    problem,
    hint: 'fix or remove that marker line; the kit writes nothing until every block has one begin and one end marker',
  });
}

function openBlock(state: ParseState, marker: Marker, raw: string, line: number): void {
  const { open, path } = state;
  if (open !== undefined) {
    throw malformed(
      path,
      line,
      `opens block "${marker.id}" inside block "${open.id}", opened on line ${String(open.line)}`,
    );
  }
  const earlier = state.closed.get(marker.id);
  if (earlier !== undefined) {
    throw malformed(
      path,
      line,
      `repeats block "${marker.id}", which already opens on line ${String(earlier)}`,
    );
  }
  if (state.text !== '') state.parts.push({ kind: 'text', text: state.text });
  state.text = '';
  state.open = { id: marker.id, begin: raw, line, body: '' };
}

function closeBlock(state: ParseState, marker: Marker, raw: string, line: number): void {
  const { open, path } = state;
  if (open === undefined) throw malformed(path, line, `closes block "${marker.id}", which is not open`);
  if (open.id !== marker.id) {
    throw malformed(
      path,
      line,
      `closes block "${marker.id}" while block "${open.id}" from line ${String(open.line)} is open`,
    );
  }
  state.parts.push({ kind: 'block', id: open.id, begin: open.begin, body: open.body, end: raw });
  state.closed.set(open.id, open.line);
  state.open = undefined;
}

function readLine(state: ParseState, raw: string, line: number): void {
  const { brand, style } = state;
  const bare = raw.replace(/\r?\n$/, '');
  if (!state.pattern.test(bare)) {
    if (state.open === undefined) state.text += raw;
    else state.open.body += raw;
    return;
  }
  const marker = parseMarker(bare, style, brand);
  if (marker === undefined) {
    const example = markerLine(style, brand.markerPrefix, 'begin', '<id>');
    throw malformed(
      state.path,
      line,
      `holds ${markerIn(bare, brand) ?? 'a marker'} but is not a whole marker line such as ${example}`,
    );
  }
  if (marker.edge === 'begin') openBlock(state, marker, raw, line);
  else closeBlock(state, marker, raw, line);
}

/**
 * Splits a blocks file into user text and managed blocks (ADR-0014). Every line that holds a marker of the brand
 * or a legacy slug, in any case, must be a whole marker line in the file's style, and the markers must pair up
 * with each id once; anything else throws MergeError naming the line, before any write.
 */
export function parseBlocks(path: string, text: string, brand: MarkerBrand): BlocksFile {
  const bom = text.startsWith(BYTE_ORDER_MARK);
  const source = bom ? text.slice(1) : text;
  const style = markerStyle(path);
  const pattern = markerPattern(brand);
  const state: ParseState = {
    path,
    brand,
    style,
    pattern,
    parts: [],
    closed: new Map(),
    text: '',
    open: undefined,
  };
  const lines = source === '' ? [] : source.split(/(?<=\n)/);
  lines.forEach((raw, index) => {
    readLine(state, raw, index + 1);
  });
  if (state.open !== undefined) {
    throw malformed(path, state.open.line, `opens block "${state.open.id}", which is never closed`);
  }
  if (state.text !== '') state.parts.push({ kind: 'text', text: state.text });
  return { bom, eol: source.includes('\r\n') ? '\r\n' : '\n', style, parts: state.parts };
}

/** An empty blocks file in the style of `path`, for a file the kit is about to create. */
export function emptyBlocks(path: string): BlocksFile {
  return { bom: false, eol: '\n', style: markerStyle(path), parts: [] };
}

/** The managed blocks of a parsed file by id. */
export function blockParts(file: BlocksFile): ReadonlyMap<string, BlockPart> {
  return new Map(file.parts.flatMap((part) => (part.kind === 'block' ? [[part.id, part] as const] : [])));
}
