import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import { Lexer } from 'marked';

// The context budget's copy of the kit's port of Claude Code 2.1.295's import extractor (src/core/memory-imports.ts),
// on the same marked from node_modules (docs/decisions.md says why a script may import it). It has no lexing
// budget: the budget counts every import Claude Code loads, and its gate reads only the kit's own output.
const MEMORY_FILE_BYTES = 4_194_304;
// Claude Code runs on Bun, whose stack lets marked nest about four times deeper than Node.js's default, so the
// budget reads imports on a worker thread whose stack nests deeper still (about 24,600 quotes, to Bun's 12,500).
const WORKER_STACK_MB = 8;
const WORKER_WAIT_MS = 120_000;
const BYTE_ORDER_MARK = '\uFEFF';
const FRONTMATTER = /^---\s*\n([\s\S]*?)---\s*\n?/;
const IMPORT = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
const SYMBOLS_ONLY = /^[#%^&*()]+/;
const PATH_START = /^[a-zA-Z0-9._-]/;
const LEADING_SEPARATOR = /^[\\/]/;
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
    if (path.includes('\0')) {
      // Claude Code's path guard (ZP) drops some paths with a leading separator, such as UNC and device paths,
      // before its path expansion throws on a NUL, so only a NUL in a path without one surely skips the file.
      if (LEADING_SEPARATOR.test(path)) continue;
      throw new SkippedFile('a NUL in an import path');
    }
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

/** Lexes `text` and lists its imports on the calling thread; markdown-imports-worker.mjs runs it for importsOf. */
export function importsInText(text) {
  const tokens = new Lexer({ gfm: false }).lex(withoutFrontmatter(text));
  const found = new Set();
  try {
    walk(tokens, found);
  } catch (error) {
    if (error instanceof SkippedFile) return [];
    throw error;
  }
  return [...found];
}

let worker;

function startedWorker() {
  if (worker !== undefined) return worker;
  const { port1, port2 } = new MessageChannel();
  const signal = new Int32Array(new SharedArrayBuffer(4));
  new Worker(new URL('markdown-imports-worker.mjs', import.meta.url), {
    workerData: { port: port2, signal },
    transferList: [port2],
    resourceLimits: { stackSizeMb: WORKER_STACK_MB },
  }).unref();
  worker = { port: port1, signal };
  return worker;
}

// Waits for the worker, so that importsOf stays synchronous. A text marked cannot lex fails the budget rather than
// count no import: the kit's own output never holds one, so the error is the budget's to fix.
function importsOnWorker(text) {
  const { port, signal } = startedWorker();
  Atomics.store(signal, 0, 0);
  port.postMessage(text);
  if (Atomics.wait(signal, 0, 0, WORKER_WAIT_MS) === 'timed-out') {
    throw new Error(`The import reader's worker did not answer within ${String(WORKER_WAIT_MS / 1000)} s.`);
  }
  const reply = receiveMessageOnPort(port)?.message;
  if (reply?.imports === undefined) {
    throw new Error(`marked could not lex a memory file: ${String(reply?.error)}`);
  }
  return reply.imports;
}

/**
 * The `@path` imports Claude Code 2.1.295 reads in a memory file's text, as written: each cut at `#`, `\ `
 * unescaped and trimmed, from its text tokens and what closed HTML comments leave. None for a file it skips: over
 * 4 MiB, or one with a NUL in an import path; it throws for a text marked cannot lex even on its deeper stack.
 * `bytes` is the file's size on disk, which is what Claude Code checks; it defaults to the text's UTF-8 length,
 * which is longer for bytes that are not UTF-8.
 */
export function importsOf(text, bytes = Buffer.byteLength(text, 'utf8')) {
  if (bytes > MEMORY_FILE_BYTES || !text.includes('@')) return [];
  return importsOnWorker(text);
}
