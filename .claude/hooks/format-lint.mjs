import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { projectDir, readInput } from './lib.mjs';

const FORMATTABLE = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml']);
const LINTABLE = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

/** Runs a locally installed tool from node_modules/.bin; returns null when it is not installed. */
function runLocal(tool, args) {
  const bin = path.join(projectDir, 'node_modules', '.bin', process.platform === 'win32' ? `${tool}.cmd` : tool);
  if (!existsSync(bin)) return null;
  return spawnSync(bin, args, { cwd: projectDir, encoding: 'utf8', shell: process.platform === 'win32' });
}

const filePath = readInput().tool_input?.file_path;
const ext = filePath ? path.extname(filePath) : '';

if (filePath && existsSync(filePath) && FORMATTABLE.has(ext)) {
  runLocal('prettier', ['--write', '--ignore-unknown', '--log-level', 'warn', filePath]);

  const problems = [];
  if (LINTABLE.has(ext)) {
    const lint = runLocal('eslint', ['--max-warnings=0', '--no-warn-ignored', filePath]);
    if (lint && lint.status !== 0) problems.push(lint.stdout || lint.stderr);
  }

  const commentCheck = path.join(projectDir, 'scripts', 'check-comments.mjs');
  if (LINTABLE.has(ext) && existsSync(commentCheck)) {
    const check = spawnSync(process.execPath, [commentCheck, filePath], { cwd: projectDir, encoding: 'utf8' });
    if (check.status !== 0) problems.push(check.stdout || check.stderr);
  }

  if (problems.length > 0) {
    process.stderr.write(`Fix these before moving on:\n${problems.join('\n').trim()}\n`);
    process.exit(2);
  }
}
