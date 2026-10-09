#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_COMMENT_RATIO = 0.15;
const MIN_CODE_LINES_FOR_RATIO = 20;
const SOURCE_GLOBS = ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'];
const EXCLUDED = /(^|\/)(node_modules|dist|coverage|fixtures|plugin)\//;

const DIRECTIVE = /^\s*(eslint-|@ts-|prettier-ignore|codekit:|global\s|c8\s|v8\s|istanbul\s|<reference\s)/;
const COMMENTED_OUT_CODE =
  /^\s*((import|export|const|let|var|function|return|if|for|while|await|class|throw)\b.*[;{(=]|.*[;{}]\s*$)/;
const UNTRACKED_TODO = /\b(TODO|FIXME|HACK|XXX)\b(?!\(#\d+\))/;
const DIVIDER = /^[\s\-=*#_~/]{4,}$/;

const ts = await import('typescript').then((module) => module.default).catch(() => null);

/** Picks the TypeScript script kind that matches a file extension. */
function scriptKindFor(file) {
  const ext = path.extname(file);
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (['.js', '.mjs', '.cjs'].includes(ext)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Returns every comment range in the file, found through the leading and trailing trivia of each token. */
function commentRanges(sourceFile) {
  const text = sourceFile.getFullText();
  const ranges = new Map();
  const visit = (node) => {
    const found = [
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    ];
    for (const range of found) ranges.set(range.pos, range);
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  return [...ranges.values()].sort((a, b) => a.pos - b.pos);
}

/** Strips comment delimiters and leading asterisks, returning the comment's lines of prose. */
function commentBody(raw) {
  return raw
    .replace(/^\/\*\*?|\*\/$|^\/\/\/?/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''));
}

/** Counts lines that still contain code once every comment is blanked out. */
function codeLineCount(text, ranges) {
  let stripped = text;
  for (const { pos, end } of ranges) {
    const blank = text.slice(pos, end).replace(/[^\n]/g, ' ');
    stripped = stripped.slice(0, pos) + blank + stripped.slice(end);
  }
  return stripped.split('\n').filter((line) => line.trim() !== '').length;
}

/** Lists policy violations for a single comment. */
function commentProblems(raw) {
  const body = commentBody(raw);
  const prose = body.join('\n');
  const problems = [];
  if (UNTRACKED_TODO.test(prose)) problems.push('TODO/FIXME must reference an issue, e.g. TODO(#12)');
  if (raw.startsWith('/**') || DIRECTIVE.test(prose)) return problems;
  if (body.some((line) => DIVIDER.test(line))) problems.push('decorative divider comment');
  if (body.some((line) => COMMENTED_OUT_CODE.test(line))) problems.push('commented-out code');
  return problems;
}

/** Checks one file against the comment policy and returns `path:line message` findings. */
function checkFile(file) {
  const text = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const ranges = commentRanges(sourceFile);
  const findings = [];
  let commentLines = 0;

  for (const range of ranges) {
    const raw = text.slice(range.pos, range.end);
    const line = sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1;
    for (const problem of commentProblems(raw)) findings.push(`${file}:${line}  ${problem}`);
    if (!raw.startsWith('/**')) commentLines += raw.split('\n').length;
  }

  const codeLines = codeLineCount(text, ranges);
  const ratio = codeLines === 0 ? 0 : commentLines / codeLines;
  if (codeLines >= MIN_CODE_LINES_FOR_RATIO && ratio > MAX_COMMENT_RATIO) {
    const percent = Math.round(ratio * 100);
    findings.push(
      `${file}:1  ${percent}% comment lines (max ${MAX_COMMENT_RATIO * 100}%); let names explain the code`,
    );
  }
  return findings;
}

/** Resolves the files to check: CLI arguments, or every tracked source file. */
function targetFiles(args) {
  const files =
    args.length > 0
      ? args
      : execFileSync('git', ['ls-files', ...SOURCE_GLOBS], { encoding: 'utf8' }).split('\n');
  return files.filter((file) => file && !EXCLUDED.test(file.replaceAll('\\', '/')));
}

if (!ts) {
  process.stderr.write('check-comments: typescript is not installed; skipping.\n');
  process.exit(0);
}

const findings = targetFiles(process.argv.slice(2)).flatMap(checkFile);
if (findings.length > 0) {
  process.stderr.write(`Comment policy violations (see CONTRIBUTING.md#comments):\n${findings.join('\n')}\n`);
  process.exit(1);
}
