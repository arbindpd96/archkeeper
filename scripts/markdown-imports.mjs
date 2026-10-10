import { Lexer } from 'marked';

// The context budget's copy of the kit's port of Claude Code 2.1.295's import extractor (src/core/memory-imports.ts),
// on the same marked from node_modules (docs/decisions.md says why a script may import it). It has no lexing
// budget: the budget counts every import Claude Code loads, and its gate reads only the kit's own output.
const MEMORY_FILE_BYTES = 4_194_304;
const BYTE_ORDER_MARK = '﻿';
const FRONTMATTER = /^---\s*\n([\s\S]*?)---\s*\n?/;
const IMPORT = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
const SYMBOLS_ONLY = /^[#%^&*()]+/;
const PATH_START = /^[a-zA-Z0-9._-]/;
const SKIPPED_TYPES = new Set(['code', 'codespan']);

/** Thrown where Claude Code's path expansion throws, which makes it skip the whole memory file. */
class SkippedFile extends Error {}

/** The text after a leading byte-order mark and YAML frontmatter, or the text unchanged when it has none. */
function withoutFrontmatter(text) {
  const body = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  const frontmatter = body.includes('---', 3) ? FRONTMATTER.exec(body) : null;
  return frontmatter === null ? text : body.slice(frontmatter[0].length);
}

function importable(path) {
  if (path.startsWith('./') || path.startsWith('~/') || (path.startsWith('/') && path !== '/')) return true;
  return !path.startsWith('@') && !SYMBOLS_ONLY.test(path) && PATH_START.test(path);
}

function addImports(text, found) {
  for (const match of text.matchAll(IMPORT)) {
    const path = (match[1] ?? '').split('#', 1)[0].replaceAll('\\ ', ' ');
    if (path === '' || !importable(path)) continue;
    if (path.includes('\0')) throw new SkippedFile('a NUL in an import path');
    found.add(path.trim());
  }
}

/** The text with every closed HTML comment cut out, as /<!--[\s\S]*?-->/g cuts them, in linear time. */
function withoutComments(text) {
  let kept = '';
  let from = 0;
  let start = text.indexOf('<!--');
  while (start !== -1) {
    const end = text.indexOf('-->', start + 4);
    if (end === -1) break;
    kept += text.slice(from, start);
    from = end + 3;
    start = text.indexOf('<!--', from);
  }
  return kept + text.slice(from);
}

/** What an HTML token that opens with a closed comment leaves once its comments are cut out; '' otherwise. */
function commentLeftover(raw) {
  const opened = raw.trimStart();
  return opened.startsWith('<!--') && opened.includes('-->') ? withoutComments(raw) : '';
}

function walk(tokens, found) {
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

function lexed(text) {
  try {
    return new Lexer({ gfm: false }).lex(withoutFrontmatter(text));
  } catch {
    return undefined;
  }
}

/**
 * The `@path` imports Claude Code 2.1.295 reads in a memory file's text, as written: each cut at `#`, `\ `
 * unescaped and trimmed, from its text tokens and what closed HTML comments leave. None for a file it skips: over
 * 4 MiB, one marked cannot lex, or one with a NUL in an import path. `bytes` is the file's size on disk, which is
 * what Claude Code checks; it defaults to the text's UTF-8 length, which is longer for bytes that are not UTF-8.
 */
export function importsOf(text, bytes = Buffer.byteLength(text, 'utf8')) {
  if (bytes > MEMORY_FILE_BYTES || !text.includes('@')) return [];
  const tokens = lexed(text);
  if (tokens === undefined) return [];
  const found = new Set();
  try {
    walk(tokens, found);
  } catch (error) {
    if (error instanceof SkippedFile) return [];
    throw error;
  }
  return [...found];
}
