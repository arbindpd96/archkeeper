import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { parseStatus } from '../src/hooks/runtime/git-status.js';
import type { Answer } from '../src/hooks/runtime/io.js';
import { preCompact } from '../src/hooks/runtime/memory/pre-compact.js';
import { SNAPSHOT_FILE, type Snapshot } from '../src/hooks/runtime/memory/snapshot.js';
import { canSymlink, commitFiles, git, tempDir, tempRepo, writeFiles } from './helpers.js';

function compact(projectDir: string): Answer {
  return preCompact.answer({ payload: { trigger: 'manual' } }, { projectDir, home: tempDir() });
}

function snapshotIn(projectDir: string): Snapshot {
  return JSON.parse(readFileSync(path.join(projectDir, SNAPSHOT_FILE), 'utf8')) as Snapshot;
}

describe('pre-compact (#35)', () => {
  it('saves the time, the branch and git status --short of the project, untracked files included', () => {
    const dir = tempRepo({ 'src/a.ts': 'export {};\n' });
    writeFiles(dir, { 'src/a.ts': 'export const a = 1;\n', 'src/new-file.ts': 'export {};\n' });
    expect(compact(dir)).toEqual({ kind: 'done' });
    const snapshot = snapshotIn(dir);
    expect(snapshot).toMatchObject({
      branch: 'main',
      status: [' M src/a.ts', '?? src/new-file.ts'],
      more: 0,
    });
    expect(Date.parse(snapshot.savedAt)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('writes the snapshot with its local folder ignored, so git never lists it', () => {
    const dir = tempRepo();
    compact(dir);
    compact(dir);
    expect(readFileSync(path.join(dir, BRAND.stateDir, 'local/.gitignore'), 'utf8')).toBe('*\n');
    expect(snapshotIn(dir).status).toEqual([]);
  });

  it('replaces the snapshot instead of appending to it on each compaction', () => {
    const dir = tempRepo();
    compact(dir);
    writeFiles(dir, { 'b.ts': 'export {};\n' });
    compact(dir);
    expect(snapshotIn(dir).status).toEqual(['?? b.ts']);
  });

  it('is the same for the same project, but for its time', () => {
    const dir = tempRepo({ 'a.ts': 'export {};\n' });
    writeFiles(dir, { 'a.ts': 'export const a = 1;\n' });
    compact(dir);
    const first = { ...snapshotIn(dir), savedAt: '' };
    compact(dir);
    expect({ ...snapshotIn(dir), savedAt: '' }).toEqual(first);
  });

  it('keeps the first 50 status lines and counts the rest', () => {
    const dir = tempRepo({ 'src/keep.ts': 'export {};\n' });
    const files = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`src/f${String(index).padStart(2, '0')}.ts`, 'x\n']),
    );
    writeFiles(dir, files);
    compact(dir);
    const snapshot = snapshotIn(dir);
    expect(snapshot.status).toHaveLength(50);
    expect(snapshot.status?.[0]).toBe('?? src/f00.ts');
    expect(snapshot.more).toBe(10);
  });

  it('lists only the project folder, with paths relative to it, when the project is a folder of a repository', () => {
    const repo = tempRepo({ 'packages/app/src/a.ts': 'export {};\n', 'top.ts': 'export {};\n' });
    writeFiles(repo, { 'packages/app/src/a.ts': 'export const a = 1;\n', 'top.ts': 'export const t = 1;\n' });
    const app = path.join(repo, 'packages/app');
    compact(app);
    expect(snapshotIn(app).status).toEqual([' M src/a.ts']);
  });

  it('shows a rename as git status --short does', () => {
    const dir = tempRepo({ 'old name.ts': 'export {};\n' });
    git(dir, 'mv', 'old name.ts', 'new name.ts');
    compact(dir);
    expect(snapshotIn(dir).status).toEqual(['R  old name.ts -> new name.ts']);
  });

  it('records no branch on a detached HEAD', () => {
    const dir = tempRepo({ 'a.ts': 'export {};\n' });
    commitFiles(dir, { 'b.ts': 'export {};\n' }, { message: 'second' });
    git(dir, 'checkout', '-q', '--detach');
    compact(dir);
    expect(snapshotIn(dir)).toMatchObject({ branch: null, status: [] });
  });

  it('records no branch and no status outside a git repository', () => {
    const dir = tempDir();
    compact(dir);
    expect(snapshotIn(dir)).toMatchObject({ branch: null, status: null, more: 0 });
  });
});

describe.skipIf(!canSymlink())('pre-compact state safety (ADR-0015)', () => {
  it('never writes through a symlink at the snapshot, and says it skipped it', () => {
    const dir = tempRepo();
    const outside = path.join(tempDir(), 'victim.txt');
    writeFileSync(outside, 'original secret\n');
    mkdirSync(path.join(dir, BRAND.stateDir, 'local/snapshots'), { recursive: true });
    symlinkSync(outside, path.join(dir, SNAPSHOT_FILE));
    const answer = compact(dir);
    expect(readFileSync(outside, 'utf8')).toBe('original secret\n');
    expect(answer.kind === 'done' ? answer.note : '').toContain('skipped the snapshot');
  });

  it('never writes into a state folder that is a symlink', () => {
    const dir = tempRepo();
    const outside = tempDir();
    mkdirSync(path.join(dir, BRAND.stateDir), { recursive: true });
    symlinkSync(outside, path.join(dir, BRAND.stateDir, 'local'));
    compact(dir);
    expect(existsSync(path.join(outside, 'snapshots'))).toBe(false);
  });
});

describe('the git status reader', () => {
  const record = (kind: string, code: string, file: string): string =>
    `${kind} ${code} N... 100644 100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} ${file}`;

  it('reads the branch, the commit and each kind of entry, paths made relative to the project', () => {
    const output = [
      `# branch.oid ${'c'.repeat(40)}`,
      '# branch.head feat/login',
      record('1', '.M', 'app/src/a b.ts'),
      `2 R. N... 100644 100644 100644 ${'a'.repeat(40)} ${'a'.repeat(40)} R100 app/new.ts`,
      'app/old.ts',
      `u UU N... 100644 100644 100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} ${'c'.repeat(40)} app/c.ts`,
      '? app/d.ts',
      '',
    ].join('\0');
    expect(parseStatus(output, 'app/')).toEqual({
      branch: 'feat/login',
      head: 'c'.repeat(40),
      entries: [
        { code: ' M', path: 'src/a b.ts' },
        { code: 'R ', path: 'new.ts', from: 'old.ts' },
        { code: 'UU', path: 'c.ts' },
        { code: '??', path: 'd.ts' },
      ],
    });
  });

  it('reads no branch on a detached HEAD and no commit before the first one', () => {
    const output = ['# branch.oid (initial)', '# branch.head (detached)', ''].join('\0');
    expect(parseStatus(output, '')).toEqual({ branch: undefined, head: undefined, entries: [] });
  });
});
