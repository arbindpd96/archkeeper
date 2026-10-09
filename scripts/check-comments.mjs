#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_COMMENT_RATIO = 0.15;
const MIN_CODE_LINES_FOR_RATIO = 20;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const EXCLUDED = /(^|\/)(node_modules|dist|coverage|fixtures)\/|^plugin\//;

const DIRECTIVE = /^\s*(eslint-|@ts-|prettier-ignore|codekit:|global\s|c8\s|v8\s|istanbul\s|<reference\s)/;
const CODE_PUNCTUATION = /[;{}()=]/;
const UNTRACKED_TODO = /\b(TODO|FIXME|HACK|XXX)\b(?!\(#\d+\))/i;
const DIVIDER = /^\s*[-=*#_~/]{4,}\s*$/;

const ts = await import('typescript').then((module) => module.default).catch(() => null);

/** Prints a message to stderr and exits with the given code. */
function exitWith(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/** Picks the TypeScript script kind that matches a file extension. */
function scriptKindFor(file) {
  const ext = path.extname(file);
  if (ext === '.tsx' || ext === '.jsx') return ts.ScriptKind.TSX;
  if (['.js', '.mjs', '.cjs'].includes(ext)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Returns true for an expression statement that is an assignment, call or await. */
function isCodeExpression(expression) {
  if (ts.isBinaryExpression(expression)) return expression.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  return ts.isCallExpression(expression) || ts.isAwaitExpression(expression);
}

/** Returns true for a parsed statement that only real code would produce, never prose. */
function isCodeStatement(statement) {
  if (ts.isExpressionStatement(statement)) return isCodeExpression(statement.expression);
  return CODE_STATEMENT_KINDS.has(statement.kind);
}

/** Returns true when a comment line parses as code, which marks it as commented-out code. */
function looksLikeCode(line) {
  const text = line.trim();
  if (!CODE_PUNCTUATION.test(text)) return false;
  const parsed = ts.createSourceFile('line.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  return (
    parsed.parseDiagnostics.length === 0 &&
    parsed.statements.length > 0 &&
    parsed.statements.every(isCodeStatement)
  );
}

/** Walks the AST and returns comment ranges, attached JSDoc starts, and JSX text spans to ignore. */
function scanComments(sourceFile) {
  const text = sourceFile.getFullText();
  const ranges = new Map();
  const jsDocStarts = new Set();
  const jsxSpans = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) jsxSpans.push([node.pos, node.end]);
    for (const doc of node.jsDoc ?? []) jsDocStarts.add(doc.getStart(sourceFile));
    const found = [
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    ];
    for (const range of found) ranges.set(range.pos, range);
    for (const child of node.getChildren(sourceFile)) {
      if (!ts.isJSDoc(child)) visit(child);
    }
  };
  visit(sourceFile);
  const insideJsx = ({ pos }) => jsxSpans.some(([start, end]) => pos >= start && pos < end);
  const comments = [...ranges.values()].filter((range) => !insideJsx(range)).sort((a, b) => a.pos - b.pos);
  return { comments, jsDocStarts };
}

/** Strips comment delimiters and leading asterisks, returning the comment's lines. */
function commentBody(raw) {
  return raw
    .replace(/^\/\*\*?|\*\/$|^\/\/\/?/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*(?!\*)\s?/, ''));
}

/** Lists policy violations for one comment; JSDoc blocks are exempt from the code check. */
function commentProblems(body, isJsDoc) {
  const prose = body.join('\n');
  const problems = [];
  if (UNTRACKED_TODO.test(prose)) problems.push('TODO/FIXME must reference an issue, e.g. TODO(#12)');
  if (DIRECTIVE.test(prose)) return problems;
  if (body.some((line) => DIVIDER.test(line))) problems.push('decorative divider comment');
  if (!isJsDoc && body.some(looksLikeCode)) problems.push('commented-out code');
  return problems;
}

/** Counts lines that still contain code once every comment is blanked out. */
function codeLineCount(text, comments) {
  let stripped = text;
  for (const { pos, end } of comments) {
    stripped = stripped.slice(0, pos) + text.slice(pos, end).replace(/[^\n]/g, ' ') + stripped.slice(end);
  }
  return stripped.split('\n').filter((line) => line.trim() !== '').length;
}

/** Checks one file against the comment policy and returns `path:line message` findings. */
function checkFile(file) {
  const text = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const { comments, jsDocStarts } = scanComments(sourceFile);
  const findings = [];
  let commentLines = 0;

  for (const range of comments) {
    const raw = text.slice(range.pos, range.end);
    const body = commentBody(raw);
    const isJsDoc = jsDocStarts.has(range.pos);
    const line = sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1;
    for (const problem of commentProblems(body, isJsDoc)) findings.push(`${file}:${line}  ${problem}`);
    if (!isJsDoc && !DIRECTIVE.test(body.join('\n'))) commentLines += body.length;
  }

  const codeLines = codeLineCount(text, comments);
  if (codeLines >= MIN_CODE_LINES_FOR_RATIO && commentLines / codeLines > MAX_COMMENT_RATIO) {
    const percent = Math.round((commentLines / codeLines) * 100);
    findings.push(
      `${file}:1  comment lines are ${percent}% of code lines (max 15%); let names explain the code`,
    );
  }
  return findings;
}

/** Lists tracked and untracked (not ignored) source files in the current git repository. */
function repositorySourceFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split('\0').filter((file) => SOURCE_FILE.test(file));
  } catch {
    return exitWith('check-comments: not inside a git repository. Pass the files to check as arguments.', 2);
  }
}

/** Resolves the files to check: CLI arguments, or every source file in the repository. */
function targetFiles(args) {
  const files = args.length > 0 ? args : repositorySourceFiles();
  return files
    .map((file) => {
      const relative = path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/');
      return relative.startsWith('../') ? path.resolve(file) : relative;
    })
    .filter((file) => (path.isAbsolute(file) || !EXCLUDED.test(file)) && existsSync(file));
}

if (!ts) {
  const message = 'check-comments: typescript is not installed. Run npm install.';
  if (process.env.CI) exitWith(message, 1);
  exitWith(`${message} Skipping.`, 0);
}

const CODE_STATEMENT_KINDS = new Set([
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.IfStatement,
]);

const findings = targetFiles(process.argv.slice(2)).flatMap(checkFile);
if (findings.length > 0) {
  exitWith(`Comment policy violations (see CONTRIBUTING.md#comments):\n${findings.join('\n')}`, 1);
}
