import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { REPO_ROOT, canSymlink, runScript, tempDir, tempRepo } from './helpers.js';

const LINT_ERROR_SOURCE = 'export const answer = 42; // trailing comment\n';
// The hook starts Prettier and ESLint in turn; on a busy Windows runner that took over 15 s.
const HOOK_TIMEOUT_MS = 60_000;

function formatLint(projectDir: string, filePath: string): { status: number | null; stderr: string } {
  return runScript('.claude/hooks/format-lint.mjs', {
    payload: { tool_input: { file_path: filePath } },
    env: { CLAUDE_PROJECT_DIR: projectDir },
    timeoutMs: HOOK_TIMEOUT_MS,
  });
}

function repoScratchFile(name: string, content: string): string {
  const dir = path.join(REPO_ROOT, 'tmp', 'format-lint-tests');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, content);
  onTestFinished(() => {
    rmSync(file, { force: true });
  });
  return file;
}

describe('format-lint', { timeout: HOOK_TIMEOUT_MS + 5_000 }, () => {
  it('reports lint errors for a file inside the project with exit code 2', () => {
    const file = repoScratchFile('inline-comment.mjs', LINT_ERROR_SOURCE);
    const result = formatLint(REPO_ROOT, file);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('no-inline-comments');
  });

  it('ignores files outside the project', () => {
    const outside = path.join(tempDir(), 'outside.mjs');
    writeFileSync(outside, LINT_ERROR_SOURCE);
    expect(formatLint(REPO_ROOT, outside).status).toBe(0);
    expect(readFileSync(outside, 'utf8')).toBe(LINT_ERROR_SOURCE);
  });

  it.skipIf(!canSymlink())('ignores a symlink that points outside the project', () => {
    const outside = path.join(tempDir(), 'target.mjs');
    writeFileSync(outside, LINT_ERROR_SOURCE);
    const link = path.join(REPO_ROOT, 'tmp', 'format-lint-tests', 'link.mjs');
    mkdirSync(path.dirname(link), { recursive: true });
    rmSync(link, { force: true });
    symlinkSync(outside, link);
    onTestFinished(() => {
      rmSync(link, { force: true });
    });
    expect(formatLint(REPO_ROOT, link).status).toBe(0);
  });

  it('does nothing in a project without installed tools', () => {
    const dir = tempRepo({ 'src/a.mjs': LINT_ERROR_SOURCE });
    expect(formatLint(dir, path.join(dir, 'src', 'a.mjs')).status).toBe(0);
  });
});
