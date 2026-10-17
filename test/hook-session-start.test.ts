import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import type { Payload } from '../src/hooks/runtime/io.js';
import { sessionStart } from '../src/hooks/runtime/memory/session-start.js';
import { SNAPSHOT_FILE } from '../src/hooks/runtime/memory/snapshot.js';
import { canSymlink, tempDir, writeFiles } from './helpers.js';
import { injectedContext, memoryText } from './hook-helpers.js';

const LOCAL = `${BRAND.stateDir}/local`;
const POINTER = `${LOCAL}/active-feature`;
const LOGIN = 'docs/features/login/MEMORY.md';

/** What session-start injects for a project, given the event's payload. */
function contextOf(projectDir: string, payload: Payload = { source: 'startup' }): string {
  return injectedContext(sessionStart.answer({ payload }, { projectDir, home: tempDir() }));
}

describe('session-start finds the active feature (#35)', () => {
  it('injects the next step, goal and decisions of the feature the pointer names, labelled with its path', () => {
    const dir = tempDir();
    writeFiles(dir, {
      [POINTER]: 'login\n',
      [LOGIN]: memoryText(),
      'docs/features/other/MEMORY.md': memoryText(),
    });
    const context = contextOf(dir);
    expect(context).toMatch(
      /^\S+ feature memory: the active feature is login \(docs\/features\/login\/MEMORY\.md\)\./,
    );
    expect(context).toContain('## Next step\nWire the token refresh in src/auth.ts.');
    expect(context).toContain('## Goal\nRate-limit failed logins.');
    expect(context).toContain('- 2026-10-17: Count failures per account. Why: per-IP counts miss botnets.');
    expect(context.indexOf('## Next step')).toBeLessThan(context.indexOf('## Goal'));
    expect(context.indexOf('## Goal')).toBeLessThan(context.indexOf('## Decisions'));
  });

  it('reports the memory path with forward slashes on every OS (6d2d423)', () => {
    const dir = tempDir();
    writeFiles(dir, { [POINTER]: 'login\n', [LOGIN]: memoryText() });
    const context = contextOf(dir);
    expect(context).toContain('(docs/features/login/MEMORY.md)');
    expect(context).not.toContain('\\');
  });

  it('takes the only MEMORY.md in progress when no pointer names one, and asks Claude to confirm it', () => {
    const dir = tempDir();
    writeFiles(dir, { [LOGIN]: memoryText(), 'docs/features/old/MEMORY.md': memoryText({ status: 'done' }) });
    expect(contextOf(dir)).toContain(
      `the active feature is login (${LOGIN}, the only feature in progress but not chosen on this machine: confirm it with the user`,
    );
  });

  it('never counts a folder whose name starts with _, such as the template', () => {
    const dir = tempDir();
    writeFiles(dir, { 'docs/features/_template/MEMORY.md': memoryText(), [LOGIN]: memoryText() });
    expect(contextOf(dir)).toContain('the active feature is login');
  });

  it("falls back to the only feature in progress when the pointer's feature is done or has no memory", () => {
    const dir = tempDir();
    writeFiles(dir, { [POINTER]: 'old\n', 'docs/features/old/MEMORY.md': memoryText({ status: 'done' }) });
    writeFiles(dir, { [LOGIN]: memoryText() });
    expect(contextOf(dir)).toContain('the active feature is login (docs/features/login/MEMORY.md, the only');
    writeFiles(dir, { [POINTER]: 'gone\n' });
    expect(contextOf(dir)).toContain('the active feature is login (docs/features/login/MEMORY.md, the only');
  });

  it.each(['../login', 'docs/features/login', 'login\nother', 'Login', 'login/', '-login', ''])(
    'never follows a pointer that is not one kebab-case name: %j',
    (pointer) => {
      const dir = tempDir();
      writeFiles(dir, {
        [POINTER]: pointer,
        [LOGIN]: memoryText(),
        'docs/features/other/MEMORY.md': memoryText(),
      });
      expect(contextOf(dir)).toContain(
        'no feature is active, since several say Status: in progress (login, other)',
      );
    },
  );

  it('tells Claude in one line to ask, and to offer /new-feature, when no feature is in progress', () => {
    const dir = tempDir();
    writeFiles(dir, { 'docs/features/old/MEMORY.md': memoryText({ status: 'done' }) });
    const context = contextOf(dir);
    expect(context).toMatch(
      /^\S+ feature memory: no feature is active\. Ask the user which feature this session is for/,
    );
    expect(context).toContain('offer /new-feature <name> to start one.');
    expect(context.split('\n')).toHaveLength(1);
  });

  it('names the features in progress in its one line when several are, and asks which', () => {
    const dir = tempDir();
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    writeFiles(
      dir,
      Object.fromEntries(names.map((name) => [`docs/features/${name}/MEMORY.md`, memoryText()])),
    );
    const context = contextOf(dir);
    expect(context).toContain('several say Status: in progress (a, b, c, d, e and 2 more). Ask the user');
    expect(context.split('\n')).toHaveLength(1);
  });
});

describe('session-start reads the memory as Claude Code reads instructions (#35)', () => {
  it('reads a memory with CRLF line endings', () => {
    const dir = tempDir();
    writeFiles(dir, { [POINTER]: 'login\r\n', [LOGIN]: memoryText().replaceAll('\n', '\r\n') });
    expect(contextOf(dir)).toContain('## Next step\nWire the token refresh in src/auth.ts.');
  });

  it('strips HTML comments, and escapes control characters while keeping line breaks', () => {
    const dir = tempDir();
    const next = 'Step one.<!-- a private note -->\nStep two \u001b[31mred\u001b[0m and ‮flipped.';
    writeFiles(dir, { [POINTER]: 'login', [LOGIN]: memoryText({ next }) });
    const context = contextOf(dir);
    expect(context).toContain(
      '## Next step\nStep one.\nStep two \\u001b[31mred\\u001b[0m and \\u202eflipped.',
    );
    expect(context).not.toContain('private note');
  });

  it('keeps the last five decisions, each with the lines that continue it', () => {
    const dir = tempDir();
    const decisions = ['- one', '- two', '- three', '  more of three', '- four', '- five', '- six'];
    writeFiles(dir, { [POINTER]: 'login', [LOGIN]: memoryText({ decisions }) });
    expect(contextOf(dir)).toContain(
      '## Decisions (the last 5 of 6, never undo without asking)\n- two\n- three\n  more of three\n- four\n- five\n- six',
    );
  });

  it('reads on past a Decision that quotes a backtick fence inside a tilde one, as CommonMark closes fences', () => {
    const dir = tempDir();
    const decisions = ['- 2026-10-18: Quote fences as text.', '  ~~~md', '  ```', '  ~~~'];
    writeFiles(dir, { [POINTER]: 'login', [LOGIN]: memoryText({ decisions }) });
    expect(contextOf(dir)).toContain('## Next step\nWire the token refresh in src/auth.ts.');
  });

  it('says so when the memory records no next step', () => {
    const dir = tempDir();
    writeFiles(dir, { [POINTER]: 'login', [LOGIN]: '# Feature: login\n\nStatus: in progress\n' });
    expect(contextOf(dir)).toContain('## Next step\n(none recorded)\n\n## Goal\n(none recorded)');
  });
});

describe('session-start state (ADR-0014, ADR-0015)', () => {
  it('creates the local state folder with its ignore-all .gitignore, which no skill writes', () => {
    const dir = tempDir();
    contextOf(dir);
    expect(readFileSync(path.join(dir, LOCAL, '.gitignore'), 'utf8')).toBe('*\n');
    if (process.platform !== 'win32') expect(statSync(path.join(dir, LOCAL)).mode & 0o777).toBe(0o700);
  });

  it('leaves only that .gitignore in the local state folder, however often it runs', () => {
    const dir = tempDir();
    writeFiles(dir, { [LOGIN]: memoryText() });
    contextOf(dir);
    contextOf(dir, { source: 'compact' });
    expect(readdirSync(path.join(dir, LOCAL))).toEqual(['.gitignore']);
  });
});

describe.skipIf(!canSymlink())('session-start symlink safety (ADR-0015)', () => {
  it('never injects a MEMORY.md, a pointer or a feature folder that is a symlink', () => {
    const dir = tempDir();
    const outside = tempDir();
    writeFiles(outside, { 'MEMORY.md': memoryText({ next: 'original secret' }), pointer: 'login\n' });
    mkdirSync(path.join(dir, 'docs/features/login'), { recursive: true });
    mkdirSync(path.join(dir, LOCAL), { recursive: true });
    symlinkSync(path.join(outside, 'MEMORY.md'), path.join(dir, LOGIN));
    symlinkSync(outside, path.join(dir, 'docs/features/linked'));
    symlinkSync(path.join(outside, 'pointer'), path.join(dir, POINTER));
    const context = contextOf(dir);
    expect(context).not.toContain('original secret');
    expect(context).toContain('no feature is active.');
  });

  it('notes a local state folder that is a symlink, writes nothing through it, and still injects the memory', () => {
    const dir = tempDir();
    const outside = tempDir();
    writeFiles(dir, { [LOGIN]: memoryText() });
    mkdirSync(path.join(dir, BRAND.stateDir));
    symlinkSync(outside, path.join(dir, LOCAL));
    const answer = sessionStart.answer({ payload: {} }, { projectDir: dir, home: tempDir() });
    expect(injectedContext(answer)).toContain('the active feature is login');
    expect(answer.kind === 'done' ? answer.note : '').toMatch(/^session-start: .*local is a symlink$/);
    expect(existsSync(path.join(outside, '.gitignore'))).toBe(false);
  });

  it('reads neither the pointer nor the snapshot where a write is refused, as with a symlinked .gitignore', () => {
    const dir = tempDir();
    const outside = path.join(tempDir(), 'ignore');
    const snapshot = { savedAt: new Date().toISOString(), branch: 'main', status: [], more: 0 };
    writeFiles(dir, {
      [POINTER]: 'login\n',
      [SNAPSHOT_FILE]: JSON.stringify(snapshot),
      [LOGIN]: memoryText(),
      'docs/features/other/MEMORY.md': memoryText(),
    });
    writeFileSync(outside, '*\n');
    symlinkSync(outside, path.join(dir, LOCAL, '.gitignore'));
    const answer = sessionStart.answer(
      { payload: { source: 'compact' } },
      { projectDir: dir, home: tempDir() },
    );
    expect(injectedContext(answer)).toBe(
      `${BRAND.displayName} feature memory: no feature is active, since several say Status: in progress ` +
        '(login, other). Ask the user which feature this session is for, and offer /new-feature <name> to ' +
        'resume or start one.',
    );
    expect(answer.kind === 'done' ? answer.note : '').toMatch(/\.gitignore is not a regular file$/);
  });
});

describe('session-start input (reference §12)', () => {
  it.each<[string, Payload]>([
    ['no source', {}],
    ['a source that is not a string', { source: 42 }],
    ['an unknown source', { source: 'fork' }],
  ])('starts as a fresh session for %s', (_name, payload) => {
    const dir = tempDir();
    writeFiles(dir, { [POINTER]: 'login', [LOGIN]: memoryText() });
    expect(contextOf(dir, payload)).toContain('## Next step\nWire the token refresh');
  });
});
