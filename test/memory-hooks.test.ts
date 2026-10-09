import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript, tempDir, tempRepo, writeFiles } from './helpers.js';

const ACTIVE_MEMORY = `# Feature: login
Status: in progress | Branch: feat/login

## Next step
Wire the token refresh in src/auth.ts.
`;

function sessionContext(projectDir: string, source: string): string {
  const { stdout } = runScript('.claude/hooks/session-start.mjs', {
    payload: { source },
    env: { CLAUDE_PROJECT_DIR: projectDir },
  });
  const output = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
  return output.hookSpecificOutput.additionalContext;
}

function stop(projectDir: string, payload: Record<string, unknown>): string {
  return runScript('.claude/hooks/stop-guard.mjs', { payload, env: { CLAUDE_PROJECT_DIR: projectDir } })
    .stdout;
}

describe('session-start', () => {
  it('injects the next step of each in-progress feature', () => {
    const dir = tempRepo({ 'docs/features/login/MEMORY.md': ACTIVE_MEMORY });
    expect(sessionContext(dir, 'startup')).toContain('Next step: Wire the token refresh in src/auth.ts.');
  });

  it('asks for a feature when none is in progress', () => {
    const dir = tempRepo();
    expect(sessionContext(dir, 'startup')).toContain('No feature is in progress');
  });

  it('re-injects the pre-compaction snapshot after compaction', () => {
    const dir = tempRepo({ 'docs/features/login/MEMORY.md': ACTIVE_MEMORY });
    runScript('.claude/hooks/pre-compact.mjs', {
      payload: { trigger: 'auto' },
      env: { CLAUDE_PROJECT_DIR: dir },
    });
    expect(sessionContext(dir, 'compact')).toContain('## Pre-compaction snapshot');
  });
});

describe('pre-compact', () => {
  it('writes a snapshot listing uncommitted files', () => {
    const dir = tempRepo();
    writeFiles(dir, { 'src/new-file.ts': 'export {};\n' });
    runScript('.claude/hooks/pre-compact.mjs', {
      payload: { trigger: 'manual' },
      env: { CLAUDE_PROJECT_DIR: dir },
    });
    const snapshot = path.join(dir, '.claude', 'state', 'compact-snapshot.md');
    expect(existsSync(snapshot)).toBe(true);
    expect(readFileSync(snapshot, 'utf8')).toContain('src/new-file.ts');
  });

  it('replaces the snapshot instead of appending on each run', () => {
    const dir = tempRepo();
    const env = { CLAUDE_PROJECT_DIR: dir };
    runScript('.claude/hooks/pre-compact.mjs', { payload: { trigger: 'auto' }, env });
    runScript('.claude/hooks/pre-compact.mjs', { payload: { trigger: 'auto' }, env });
    const snapshot = readFileSync(path.join(dir, '.claude', 'state', 'compact-snapshot.md'), 'utf8');
    expect(snapshot.match(/^Saved:/gm)).toHaveLength(1);
  });
});

describe.skipIf(process.platform === 'win32')('hook state symlink safety', () => {
  function repoWithStateLink(): { dir: string; outside: string } {
    const dir = tempRepo();
    const outside = path.join(tempDir(), 'victim.txt');
    writeFileSync(outside, 'original secret\n');
    mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
    symlinkSync(outside, path.join(dir, '.claude', 'state', 'compact-snapshot.md'));
    return { dir, outside };
  }

  it('never writes through a committed symlink', () => {
    const { dir, outside } = repoWithStateLink();
    runScript('.claude/hooks/pre-compact.mjs', {
      payload: { trigger: 'auto' },
      env: { CLAUDE_PROJECT_DIR: dir },
    });
    expect(readFileSync(outside, 'utf8')).toBe('original secret\n');
  });

  it('never injects a symlinked file into the session context', () => {
    const { dir } = repoWithStateLink();
    expect(sessionContext(dir, 'compact')).not.toContain('original secret');
  });

  it('refuses a symlinked .claude/state directory', () => {
    const dir = tempRepo();
    const outsideDir = tempDir();
    mkdirSync(path.join(dir, '.claude'), { recursive: true });
    symlinkSync(outsideDir, path.join(dir, '.claude', 'state'));
    runScript('.claude/hooks/pre-compact.mjs', {
      payload: { trigger: 'auto' },
      env: { CLAUDE_PROJECT_DIR: dir },
    });
    expect(existsSync(path.join(outsideDir, 'compact-snapshot.md'))).toBe(false);
  });
});

describe('stop-guard', () => {
  it('lets Claude stop when no code changed', () => {
    const dir = tempRepo({ 'docs/features/login/MEMORY.md': ACTIVE_MEMORY });
    expect(stop(dir, { session_id: 's1' })).toBe('');
  });

  it('asks once per session for a memory update when code changed', () => {
    const dir = tempRepo({ 'docs/features/login/MEMORY.md': ACTIVE_MEMORY });
    writeFiles(dir, { 'scripts/tool.mjs': 'export {};\n' });
    const first = JSON.parse(stop(dir, { session_id: 's1' })) as { decision: string; reason: string };
    expect(first.decision).toBe('block');
    expect(first.reason).toContain('docs/features/login/MEMORY.md');
    expect(stop(dir, { session_id: 's1' })).toBe('');
  });

  it('never blocks when a stop hook is already active', () => {
    const dir = tempRepo({ 'docs/features/login/MEMORY.md': ACTIVE_MEMORY });
    writeFiles(dir, { 'scripts/tool.mjs': 'export {};\n' });
    expect(stop(dir, { session_id: 's1', stop_hook_active: true })).toBe('');
  });
});
