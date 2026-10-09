import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isProjectFile, projectDir, readInput } from './lib.mjs';

const FORMATTABLE = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml']);
const LINTABLE = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const TOOL_TIMEOUT_MS = 18_000;
const TOOL_ENTRIES = {
  prettier: path.join('node_modules', 'prettier', 'bin', 'prettier.cjs'),
  eslint: path.join('node_modules', 'eslint', 'bin', 'eslint.js'),
  comments: path.join('scripts', 'check-comments.mjs'),
};

/** Runs a project-local Node tool without a shell; returns null when the tool is not installed. */
function runTool(tool, args) {
  const entry = path.join(projectDir, TOOL_ENTRIES[tool]);
  if (!existsSync(entry)) return null;
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: TOOL_TIMEOUT_MS,
  });
}

/** Collects lint and comment-policy failures for a formatted file. */
function problemsFor(filePath) {
  const checks = [
    runTool('eslint', ['--max-warnings=0', '--no-warn-ignored', filePath]),
    runTool('comments', [filePath]),
  ];
  return checks
    .filter((run) => run && run.status !== 0)
    .map((run) =>
      run.error
        ? `A check timed out or could not start; run \`npm run check\` (${run.error.code ?? 'error'}).`
        : run.stdout || run.stderr,
    );
}

const filePath = readInput().tool_input?.file_path;
const ext = typeof filePath === 'string' ? path.extname(filePath) : '';

if (FORMATTABLE.has(ext) && isProjectFile(filePath)) {
  runTool('prettier', ['--write', '--ignore-unknown', '--log-level', 'warn', filePath]);
  const problems = LINTABLE.has(ext) ? problemsFor(filePath) : [];
  if (problems.length > 0) {
    process.stderr.write(`Fix these before moving on:\n${problems.join('\n').trim()}\n`);
    process.exit(2);
  }
}
