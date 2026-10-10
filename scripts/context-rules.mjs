import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { importsOf } from './markdown-imports.mjs';

export { importsOf };

/** Characters per token in the estimate ADR-0017 fixes. */
export const CHARS_PER_TOKEN = 4;

// Claude Code follows imports up to four hops deep (reference §2.1).
const MAX_IMPORT_DEPTH = 4;
const COMMENT_LINE = /^\s*<!--.*-->\s*$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const MISSING = new Set(['ENOENT', 'ENOTDIR']);

/** Returns `fallback` for a path that does not exist and rethrows any other error, which must not lower a count. */
function absentOr(error, fallback) {
  if (MISSING.has(error?.code)) return fallback;
  throw error;
}

/** Reads a regular file as text, or returns undefined when it is absent, a link or a folder. */
function readText(file) {
  try {
    return lstatSync(file).isFile() ? readFileSync(file, 'utf8') : undefined;
  } catch (error) {
    return absentOr(error, undefined);
  }
}

/** The text Claude Code keeps of an instruction file: block-level HTML comments, such as markers, cost nothing. */
function loadedText(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !COMMENT_LINE.test(line))
    .join('\n');
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Characters of CLAUDE.md, `.claude/CLAUDE.md` and every project file they import, each counted once. */
function instructionChars(root) {
  const seen = new Set();
  let chars = 0;
  const visit = (file, depth) => {
    if (seen.has(file) || depth > MAX_IMPORT_DEPTH || !inside(root, file)) return;
    const text = readText(file);
    if (text === undefined) return;
    seen.add(file);
    const kept = loadedText(text);
    chars += kept.length;
    for (const target of importsOf(kept)) visit(path.resolve(path.dirname(file), target), depth + 1);
  };
  for (const entry of ['CLAUDE.md', '.claude/CLAUDE.md']) visit(path.join(root, entry), 0);
  return chars;
}

/** Every file under `folder` whose name ends in `.md`, at any depth. */
function markdownFiles(folder) {
  let entries;
  try {
    entries = readdirSync(folder, { withFileTypes: true, recursive: true });
  } catch (error) {
    return absentOr(error, []);
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** A frontmatter key's one-line value, unquoted, or undefined when the text has no such key. */
function frontmatterValue(text, key) {
  const block = FRONTMATTER.exec(text)?.[1] ?? '';
  const line = block.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}:`));
  return line
    ?.slice(key.length + 1)
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2');
}

/** Characters of the rules without `paths:`, which load in every session (reference §2.2). */
function ruleChars(root) {
  return markdownFiles(path.join(root, '.claude', 'rules'))
    .map((file) => readText(file) ?? '')
    .filter((text) => frontmatterValue(text, 'paths') === undefined)
    .reduce((sum, text) => sum + loadedText(text).length, 0);
}

/** Characters of the descriptions of skills Claude may invoke on its own, which sit in every session's index. */
function skillChars(root) {
  return markdownFiles(path.join(root, '.claude', 'skills'))
    .filter((file) => path.basename(file) === 'SKILL.md')
    .map((file) => readText(file) ?? '')
    .filter((text) => frontmatterValue(text, 'disable-model-invocation') !== 'true')
    .reduce((sum, text) => sum + (frontmatterValue(text, 'description') ?? '').length, 0);
}

/**
 * Estimates the context Claude Code loads in every session of the project at `root`, as ADR-0017 counts it:
 * CLAUDE.md with its imports, rules without `paths:`, the descriptions of model-invocable skills and the
 * SessionStart output at the preset's cap, in characters and in tokens (characters / 4, rounded up).
 */
export function alwaysOnContext(root, sessionStartCap) {
  const parts = {
    instructions: instructionChars(root),
    rules: ruleChars(root),
    skills: skillChars(root),
    sessionStart: sessionStartCap,
  };
  const chars = Object.values(parts).reduce((sum, value) => sum + value, 0);
  return { ...parts, chars, tokens: Math.ceil(chars / CHARS_PER_TOKEN) };
}
