import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import type { Answer, Payload } from '../src/hooks/runtime/io.js';
import { memoryStop } from '../src/hooks/runtime/memory/memory-stop.js';
import { canSymlink, commitFiles, git, tempDir, tempRepo, writeFiles } from './helpers.js';
import { blockReason, memoryText, setModified } from './hook-helpers.js';

const POINTER = `${BRAND.stateDir}/local/active-feature`;
const LOGIN = 'docs/features/login/MEMORY.md';
const STOP: Payload = { session_id: 's1', stop_hook_active: false };

function stop(projectDir: string, payload: Payload = STOP): Answer {
  return memoryStop.answer({ payload }, { projectDir, home: tempDir() });
}

/** A repository whose active feature, login, saved its memory an hour ago, with the given files committed too. */
function featureRepo(files: Record<string, string> = {}): string {
  const dir = tempRepo({ [LOGIN]: memoryText(), 'src/auth.ts': 'export {};\n', ...files });
  writeFiles(dir, { [POINTER]: 'login\n' });
  setModified(dir, LOGIN, -3_600_000);
  return dir;
}

describe('memory-stop (#35)', () => {
  it('lets Claude stop when no tracked file changed', () => {
    expect(stop(featureRepo())).toEqual({ kind: 'done' });
  });

  it('asks for /handoff when a tracked file changed after MEMORY.md was saved, naming both', () => {
    const dir = featureRepo();
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 1;\n' });
    expect(blockReason(stop(dir))).toBe(
      `${BRAND.displayName} feature memory: src/auth.ts changed after ${LOGIN} was last saved. ` +
        'Run /handoff to record Done and Next step there, or tell the user why this needs no memory update.',
    );
  });

  it('asks once per change set, however often the same files change again', () => {
    const dir = featureRepo();
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 1;\n' });
    expect(blockReason(stop(dir))).toBeDefined();
    expect(stop(dir)).toEqual({ kind: 'done' });
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 2;\n' });
    expect(stop(dir)).toEqual({ kind: 'done' });
  });

  it('asks again when another file joins the change set', () => {
    const dir = featureRepo({ 'src/limit.ts': 'export {};\n' });
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 1;\n' });
    stop(dir);
    writeFiles(dir, { 'src/limit.ts': 'export const limit = 5;\n' });
    expect(blockReason(stop(dir))).toContain('src/auth.ts, src/limit.ts changed after');
  });

  it('asks again once a commit starts a new change set', () => {
    const dir = featureRepo();
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 1;\n' });
    stop(dir);
    commitFiles(dir, {}, { message: 'refresh' });
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 2;\n' });
    expect(blockReason(stop(dir))).toContain('src/auth.ts changed after');
  });

  it('lets Claude stop once MEMORY.md was saved after the change', () => {
    const dir = featureRepo();
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 1;\n' });
    setModified(dir, LOGIN, 60_000);
    expect(stop(dir)).toEqual({ kind: 'done' });
  });

  it("never counts docs, Markdown or text files, or the kit's own state", () => {
    const dir = featureRepo({
      'README.md': '# App\n',
      'docs/site/page.tsx': 'export {};\n',
      'notes.txt': 'x\n',
      [`${BRAND.stateDir}/config.json`]: '{}\n',
    });
    writeFiles(dir, {
      'README.md': '# App, edited\n',
      'docs/site/page.tsx': 'export const page = 1;\n',
      'notes.txt': 'y\n',
      [`${BRAND.stateDir}/config.json`]: '{"preset":"small"}\n',
    });
    expect(stop(dir)).toEqual({ kind: 'done' });
  });

  it('counts a new file only once it is tracked', () => {
    const dir = featureRepo();
    writeFiles(dir, { 'src/new.ts': 'export {};\n' });
    expect(stop(dir)).toEqual({ kind: 'done' });
    git(dir, 'add', 'src/new.ts');
    expect(blockReason(stop(dir))).toContain('src/new.ts changed after');
  });

  it('names three files and counts the rest, with forward slashes on every OS (6d2d423)', () => {
    const files = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((name) => [`src/deep/${name}.ts`, 'x\n']));
    const dir = featureRepo(files);
    writeFiles(dir, Object.fromEntries(Object.keys(files).map((file) => [file, 'y\n'])));
    const reason = blockReason(stop(dir)) ?? '';
    expect(reason).toContain('src/deep/a.ts, src/deep/b.ts, src/deep/c.ts and 2 more changed after');
    expect(reason).toContain(`after ${LOGIN} was last saved`);
    expect(reason).not.toContain('\\');
  });

  it('checks the only feature in progress when no pointer names one', () => {
    const dir = tempRepo({ [LOGIN]: memoryText(), 'src/auth.ts': 'export {};\n' });
    setModified(dir, LOGIN, -3_600_000);
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 1;\n' });
    expect(blockReason(stop(dir))).toContain(`after ${LOGIN} was last saved`);
  });

  it('looks only at the project folder of a monorepo, naming files relative to it', () => {
    const repo = tempRepo({
      'packages/app/src/a.ts': 'x\n',
      [`packages/app/${LOGIN}`]: memoryText(),
      'top.ts': 'x\n',
    });
    const app = path.join(repo, 'packages/app');
    setModified(app, LOGIN, -3_600_000);
    writeFiles(repo, { 'top.ts': 'y\n' });
    expect(stop(app)).toEqual({ kind: 'done' });
    writeFiles(app, { 'src/a.ts': 'y\n' });
    expect(blockReason(stop(app))).toContain('src/a.ts changed after');
  });
});

describe('memory-stop lets Claude stop when it should not or cannot tell (ADR-0015)', () => {
  it.each<[string, unknown]>([
    ['true', true],
    ['a string', 'true'],
    ['a number', 1],
  ])('returns at once when stop_hook_active is %s', (_name, active) => {
    const dir = featureRepo();
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 1;\n' });
    expect(stop(dir, { stop_hook_active: active })).toEqual({ kind: 'done' });
    expect(existsSync(path.join(dir, BRAND.stateDir, 'local/memory-stop.json'))).toBe(false);
  });

  it('lets Claude stop, with a note, on stdin it cannot read', () => {
    const answer = memoryStop.answer(
      { payload: {}, problem: 'stdin was not valid JSON' },
      { projectDir: featureRepo(), home: tempDir() },
    );
    expect(answer).toEqual({
      kind: 'done',
      note: 'memory-stop: stdin was not valid JSON, so it let Claude stop',
    });
  });

  it('lets Claude stop when no feature is active', () => {
    const dir = tempRepo({ [LOGIN]: memoryText({ status: 'done' }), 'src/auth.ts': 'export {};\n' });
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 1;\n' });
    expect(stop(dir)).toEqual({ kind: 'done' });
  });

  it('lets Claude stop outside a git repository', () => {
    const dir = tempDir();
    writeFiles(dir, { [POINTER]: 'login', [LOGIN]: memoryText(), 'src/auth.ts': 'x\n' });
    setModified(dir, LOGIN, -3_600_000);
    expect(stop(dir)).toEqual({ kind: 'done' });
  });

  it('lets Claude stop, running no git status, where the repository config sets a filter program', () => {
    const marker = path.join(tempDir(), 'ran');
    const dir = featureRepo({ '.gitattributes': '* filter=evil\n' });
    git(dir, 'config', 'filter.evil.clean', `touch '${marker}'; cat`);
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 1;\n' });
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(existsSync(marker)).toBe(false);
  });
});

describe.skipIf(!canSymlink())('memory-stop state safety (ADR-0015)', () => {
  it('lets Claude stop, noting why, when it cannot record that it asked', () => {
    const dir = tempRepo({ [LOGIN]: memoryText(), 'src/auth.ts': 'export {};\n' });
    setModified(dir, LOGIN, -3_600_000);
    const outside = tempDir();
    mkdirSync(path.join(dir, BRAND.stateDir));
    symlinkSync(outside, path.join(dir, BRAND.stateDir, 'local'));
    writeFiles(dir, { 'src/auth.ts': 'export const refresh = 1;\n' });
    const answer = stop(dir);
    expect(blockReason(answer)).toBeUndefined();
    expect(answer.kind === 'done' ? answer.note : '').toMatch(
      /^memory-stop: let Claude stop, since it could not record/,
    );
    expect(existsSync(path.join(outside, 'memory-stop.json'))).toBe(false);
  });
});
