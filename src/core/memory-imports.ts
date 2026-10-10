import { lexedTokens } from './bounded-lexer.js';
import { withoutComments } from './imports.js';
import { BYTE_ORDER_MARK } from './text.js';

/** Claude Code 2.1.295 skips a memory file larger than this many bytes, imports and all (reference §2.1). */
const MEMORY_FILE_BYTES = 4_194_304;
const FRONTMATTER = /^(---\s*\n[\s\S]*?---)\s*\n?/;
const IMPORT = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
const SYMBOLS_ONLY = /^[#%^&*()]+/;
const PATH_START = /^[a-zA-Z0-9._-]/;

/** The fields of a marked token that Claude Code's import walk reads. */
interface WalkedToken {
  readonly type: string;
  readonly raw?: string;
  readonly text?: string;
  readonly tokens?: readonly WalkedToken[];
  readonly items?: readonly WalkedToken[];
}

/** Thrown where Claude Code's path expansion throws, which makes it skip the whole memory file. */
class SkippedFile extends Error {}

/** Whether Claude Code skips a memory file of this text for its size, so that none of its imports load. */
export function skipsMemoryFile(text: string): boolean {
  // A UTF-16 unit takes one to three UTF-8 bytes, so only a length between a third of the limit and the limit
  // needs the text encoded.
  if (text.length * 3 <= MEMORY_FILE_BYTES) return false;
  if (text.length > MEMORY_FILE_BYTES) return true;
  return new TextEncoder().encode(text).byteLength > MEMORY_FILE_BYTES;
}

function frontmatterIn(body: string): RegExpExecArray | null {
  return body.includes('---', 3) ? FRONTMATTER.exec(body) : null;
}

/**
 * Where the YAML frontmatter Claude Code reads at the top of a memory file without a byte-order mark ends: just
 * after its closing `---`, or 0 when the text opens with none.
 */
export function frontmatterEnd(body: string): number {
  return frontmatterIn(body)?.[1]?.length ?? 0;
}

/** The text after a leading byte-order mark and YAML frontmatter, or the text unchanged when it has none. */
function withoutFrontmatter(text: string): string {
  const body = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  const frontmatter = frontmatterIn(body);
  return frontmatter === null ? text : body.slice(frontmatter[0].length);
}

function importable(path: string): boolean {
  if (path.startsWith('./') || path.startsWith('~/') || (path.startsWith('/') && path !== '/')) return true;
  return !path.startsWith('@') && !SYMBOLS_ONLY.test(path) && PATH_START.test(path);
}

function addImports(text: string, found: Set<string>): void {
  for (const match of text.matchAll(IMPORT)) {
    const path = (match[1] ?? '').split('#', 1)[0]?.replaceAll('\\ ', ' ') ?? '';
    if (path === '' || !importable(path)) continue;
    if (path.includes('\0')) throw new SkippedFile('a NUL in an import path');
    found.add(path.trim());
  }
}

// What an HTML token that opens with a closed comment leaves once its comments are cut out; '' otherwise. Claude
// Code cuts them with /<!--[\s\S]*?-->/g, which rescans to the end from each unclosed `<!--`; withoutComments
// gives the same text in linear time.
function commentLeftover(raw: string): string {
  const opened = raw.trimStart();
  return opened.startsWith('<!--') && opened.includes('-->') ? withoutComments(raw) : '';
}

const SKIPPED_TYPES = new Set(['code', 'codespan']);

function walk(tokens: readonly WalkedToken[], found: Set<string>): void {
  for (const token of tokens) {
    if (SKIPPED_TYPES.has(token.type)) continue;
    if (token.type === 'html') {
      const left = commentLeftover(token.raw ?? '');
      if (left.trim().length > 0) addImports(left, found);
      continue;
    }
    if (token.type === 'text') addImports(token.text ?? '', found);
    walk(token.tokens ?? [], found);
    walk(token.items ?? [], found);
  }
}

/**
 * Lists the `@` imports Claude Code 2.1.295 reads in a memory file's text, as written: each cut at `#`, `\ `
 * unescaped and trimmed. This ports its extractor word for word (functions FOe, z7n with ni, and Q7n in the
 * 2.1.295 binary; reference §2.1): drop a leading byte-order mark and YAML frontmatter, lex with marked 15.0.6
 * (the version it bundles) without GFM, and match `(?:^|\s)@((?:[^\s\\]|\\ )+)` in every text token and in what
 * a closed HTML comment token leaves, skipping code. Path checks are left to the caller. It lists none for a
 * text Claude Code skips (over 4 MiB, a marked error, a NUL in a path) or that takes more work than the kit
 * spends on it (see bounded-lexer.ts).
 */
export function memoryImports(text: string): string[] {
  if (skipsMemoryFile(text) || !text.includes('@')) return [];
  const tokens: readonly WalkedToken[] | undefined = lexedTokens(withoutFrontmatter(text));
  if (tokens === undefined) return [];
  const found = new Set<string>();
  try {
    walk(tokens, found);
  } catch (error) {
    if (error instanceof SkippedFile) return [];
    throw error;
  }
  return [...found];
}
