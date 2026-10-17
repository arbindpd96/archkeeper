import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { gitRunner } from '../src/hooks/runtime/git.js';
import { memoryStop } from '../src/hooks/runtime/memory/memory-stop.js';
import { preCompact } from '../src/hooks/runtime/memory/pre-compact.js';
import { SNAPSHOT_FILE } from '../src/hooks/runtime/memory/snapshot.js';
import { fakeBin, git, stubEnv, tempDir, tempRepo, writeFiles } from './helpers.js';
import { blockReason, memoryText, setModified } from './hook-helpers.js';

const LOCAL = `${BRAND.stateDir}/local`;
const LOGIN = 'docs/features/login/MEMORY.md';

/** A repository whose active feature saved its memory an hour ago, with a tracked file changed since. */
function changedRepo(files: Record<string, string> = {}): string {
  const dir = tempRepo({ [LOGIN]: memoryText(), 'src/auth.ts': 'export {};\n', ...files });
  writeFiles(dir, { [`${LOCAL}/active-feature`]: 'login\n', [`${LOCAL}/.gitignore`]: '*\n' });
  setModified(dir, LOGIN, -3_600_000);
  writeFiles(dir, { 'src/auth.ts': 'export const refresh = 1;\n' });
  return dir;
}

/** Whether a memory hook read git status: pre-compact saved one, or memory-stop asked about the changed file. */
function readStatus(hook: string, projectDir: string): boolean {
  const context = { projectDir, home: tempDir() };
  if (hook === 'memory-stop') return blockReason(memoryStop.answer({ payload: {} }, context)) !== undefined;
  preCompact.answer({ payload: {} }, context);
  const snapshot = JSON.parse(readFileSync(path.join(projectDir, SNAPSHOT_FILE), 'utf8')) as {
    status: unknown;
  };
  return snapshot.status !== null;
}

describe.each(['pre-compact', 'memory-stop'])('%s and the git it runs (ADR-0015, ADR-0018)', (hook) => {
  it('reads git status in a plain repository', () => {
    expect(readStatus(hook, changedRepo())).toBe(true);
  });

  it.each([
    ['extensions.partialClone', 'origin'],
    ['remote.origin.promisor', 'true'],
  ])('runs no git status where the repository config sets %s, so status fetches nothing', (key, value) => {
    const dir = changedRepo();
    git(dir, 'config', key, value);
    expect(readStatus(hook, dir)).toBe(false);
  });

  it('runs no git status, and so no filter program, where the repository config sets one', () => {
    const marker = path.join(tempDir(), 'ran');
    const dir = changedRepo({ '.gitattributes': '* filter=evil\n' });
    git(dir, 'config', 'filter.evil.clean', `touch '${marker}'; cat`);
    expect(readStatus(hook, dir)).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it('never starts the fsmonitor program the repository config names, and still reads the status', () => {
    const marker = path.join(tempDir(), 'ran');
    const dir = changedRepo();
    git(dir, 'config', 'core.fsmonitor', `touch '${marker}'; false`);
    expect(readStatus(hook, dir)).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });
});

// The stand-in git is a shell script, which Windows does not run as git.exe.
describe.skipIf(process.platform === 'win32')("the hooks' git runner", () => {
  it('gives git GIT_NO_LAZY_FETCH and the caller GIT_CEILING_DIRECTORIES, but no other GIT_ variable', () => {
    const script =
      '#!/bin/sh\nprintf "%s|%s|%s" "$GIT_NO_LAZY_FETCH" "$GIT_CEILING_DIRECTORIES" "$GIT_DIR"\n';
    stubEnv('PATH', [fakeBin('git', script), process.env.PATH ?? ''].join(path.delimiter));
    stubEnv('GIT_CEILING_DIRECTORIES', '/ceiling');
    stubEnv('GIT_DIR', '/elsewhere/.git');
    stubEnv('GIT_NO_LAZY_FETCH', '0');
    expect(gitRunner(tempDir())?.(['status']).stdout).toBe('1|/ceiling|');
  });
});
