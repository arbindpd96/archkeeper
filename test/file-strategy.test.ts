import { describe, expect, it } from 'vitest';
import { type FileJob, planFile } from '../src/core/file-plan.js';
import { contentHash } from '../src/core/hash.js';
import type { FileEntry } from '../src/core/lock.js';
import type { PathState } from '../src/core/plan-types.js';
import { fileEntry, TEST_BRAND } from './kit-fixtures.js';

const PATH = '.claude/rules/acmekit/a.md';
const OLD = '# Rule\n\nVersion one.\n';
const NEW = '# Rule\n\nVersion two.\n';
const MINE = '# Rule\n\nMy own words.\n';

const file = (content: string): PathState => ({ kind: 'file', content });
const owned = (base: string | null, pending?: string): FileEntry => ({
  module: 'm',
  strategy: 'owned',
  base,
  ...(pending === undefined ? {} : { pending }),
});

function plan(job: Partial<FileJob> & { content?: string }): ReturnType<typeof planFile> {
  const { content = NEW, ...rest } = job;
  return planFile({
    path: PATH,
    entry: fileEntry(content),
    state: undefined,
    sidecar: undefined,
    lock: undefined,
    removed: false,
    ownable: false,
    brand: TEST_BRAND,
    ...rest,
  });
}

describe('the owned strategy', () => {
  it('creates a new kit file and records its base', () => {
    const outcome = plan({});
    expect(outcome.ops).toEqual([{ kind: 'create', path: PATH, reason: 'new kit file' }]);
    expect(outcome.content).toBe(NEW);
    expect(outcome.file).toEqual(owned(contentHash(NEW)));
  });

  it('adopts an untracked file identical to the kit version, even with CRLF endings', () => {
    const outcome = plan({ state: file(NEW.replaceAll('\n', '\r\n')) });
    expect(outcome.ops[0]?.kind).toBe('adopt');
    expect(outcome.content).toBeUndefined();
    expect(outcome.file).toEqual(owned(contentHash(NEW)));
  });

  it('leaves a different untracked file alone, with base null, and offers the kit version in a sidecar', () => {
    const outcome = plan({ state: file(MINE) });
    expect(outcome.ops[0]?.kind).toBe('sidecar');
    expect(outcome.ops[0]?.reason).toContain(`${PATH}.acmekit-new`);
    expect(outcome.content).toBeUndefined();
    expect(outcome.sidecar).toBe(NEW);
    expect(outcome.file).toEqual(owned(null, contentHash(NEW)));
  });

  it('rewrites a file unchanged since the kit wrote it, keeping its CRLF endings', () => {
    const outcome = plan({ state: file(OLD.replaceAll('\n', '\r\n')), lock: owned(contentHash(OLD)) });
    expect(outcome.ops[0]?.kind).toBe('create');
    expect(outcome.content).toBe(NEW.replaceAll('\n', '\r\n'));
    expect(outcome.file).toEqual(owned(contentHash(NEW)));
  });

  it('skips a file the user changed when the kit has nothing new', () => {
    const outcome = plan({ state: file(MINE), lock: owned(contentHash(NEW)) });
    expect(outcome.ops[0]).toMatchObject({
      kind: 'skip',
      reason: 'the user changed it and the kit has nothing new',
    });
    expect(outcome.sidecar).toBeUndefined();
  });

  it('keeps a file the user changed and writes the new kit version to the sidecar, keeping the base', () => {
    const outcome = plan({ state: file(MINE), lock: owned(contentHash(OLD)) });
    expect(outcome.ops[0]?.kind).toBe('sidecar');
    expect(outcome.content).toBeUndefined();
    expect(outcome.sidecar).toBe(NEW);
    expect(outcome.file).toEqual(owned(contentHash(OLD), contentHash(NEW)));
  });

  it('leaves a sidecar that already holds the kit version', () => {
    const outcome = plan({
      state: file(MINE),
      sidecar: file(NEW),
      lock: owned(contentHash(OLD), contentHash(NEW)),
    });
    expect(outcome.ops[0]?.kind).toBe('skip');
    expect(outcome.sidecar).toBeUndefined();
  });

  it('rewrites an unedited sidecar when the kit content changes again', () => {
    const pending = '# Rule\n\nVersion one and a half.\n';
    const outcome = plan({
      state: file(MINE),
      sidecar: file(pending),
      lock: owned(contentHash(OLD), contentHash(pending)),
    });
    expect(outcome.ops[0]?.kind).toBe('sidecar');
    expect(outcome.sidecar).toBe(NEW);
  });

  it('never overwrites a sidecar the user edited, and reports it', () => {
    const pending = '# Rule\n\nVersion one and a half.\n';
    const outcome = plan({
      state: file(MINE),
      sidecar: file('edited'),
      lock: owned(contentHash(OLD), contentHash(pending)),
    });
    expect(outcome.ops[0]).toMatchObject({ kind: 'skip' });
    expect(outcome.ops[0]?.reason).toContain('was edited or is not the kit');
    expect(outcome.sidecar).toBeUndefined();
    expect(outcome.file).toEqual(owned(contentHash(OLD), contentHash(pending)));
  });

  it('moves the base to pending once the user deletes the sidecar', () => {
    const outcome = plan({ state: file(MINE), lock: owned(contentHash(OLD), contentHash(NEW)) });
    expect(outcome.ops[0]).toMatchObject({
      kind: 'adopt',
      reason: expect.stringContaining('counts as seen') as string,
    });
    expect(outcome.sidecar).toBeUndefined();
    expect(outcome.file).toEqual(owned(contentHash(NEW)));
  });

  it('records a kit file the user deleted in removed[] and never recreates it', () => {
    const outcome = plan({ lock: owned(contentHash(OLD)) });
    expect(outcome.ops[0]?.kind).toBe('respectRemoval');
    expect(outcome.removed).toEqual([{ path: PATH }]);
    expect(outcome.content).toBeUndefined();
    expect(outcome.file).toBeUndefined();
  });

  it('respects an earlier removal', () => {
    const outcome = plan({ removed: true });
    expect(outcome.ops[0]?.kind).toBe('respectRemoval');
    expect(outcome.content).toBeUndefined();
  });

  it.each([
    ['a symlink', { kind: 'symlink' } as const],
    ['a folder', { kind: 'other' } as const],
  ])('never writes through %s and offers the kit version in a sidecar', (_name, state) => {
    const outcome = plan({ state, lock: owned(contentHash(OLD)) });
    expect(outcome.ops[0]?.kind).toBe('sidecar');
    expect(outcome.content).toBeUndefined();
    expect(outcome.sidecar).toBe(NEW);
  });
});

describe('a file the kit no longer writes', () => {
  const dropped = (job: Partial<FileJob>): ReturnType<typeof planFile> =>
    plan({ entry: undefined, lock: owned(contentHash(OLD)), ...job });

  it('is deleted when it is unchanged and the current kit could own it', () => {
    const outcome = dropped({ state: file(OLD), ownable: true });
    expect(outcome.ops[0]?.kind).toBe('delete');
    expect(outcome.content).toBeNull();
  });

  it('is left alone when no current module could own it, as the lock is untrusted', () => {
    const outcome = dropped({ state: file(OLD), ownable: false });
    expect(outcome.ops[0]?.kind).toBe('skip');
    expect(outcome.content).toBeUndefined();
    expect(outcome.file).toEqual(owned(contentHash(OLD)));
  });

  it('is kept when the user changed it', () => {
    const outcome = dropped({ state: file(MINE), ownable: true });
    expect(outcome.ops[0]?.kind).toBe('skip');
    expect(outcome.content).toBeUndefined();
  });

  it('is never deleted through a symlink', () => {
    expect(dropped({ state: { kind: 'symlink' }, ownable: true }).content).toBeUndefined();
  });
});

describe('the create-only strategy', () => {
  const createOnly = (job: Partial<FileJob>): ReturnType<typeof planFile> =>
    plan({ entry: fileEntry(NEW, 'create-only'), ...job });
  const entry = (base: string | null): FileEntry => ({ module: 'm', strategy: 'create-only', base });

  it('writes the file once when the path is free, recording its hash but no blob', () => {
    const outcome = createOnly({});
    expect(outcome.ops[0]?.kind).toBe('create');
    expect(outcome.file).toEqual(entry(contentHash(NEW)));
  });

  it('skips a path that exists, without a sidecar or a lock entry', () => {
    const outcome = createOnly({ state: file(MINE) });
    expect(outcome.ops[0]?.kind).toBe('skip');
    expect(outcome.sidecar).toBeUndefined();
    expect(outcome.file).toBeUndefined();
  });

  it('never touches a file it wrote, even when the kit content changes', () => {
    const outcome = createOnly({ state: file(OLD), lock: entry(contentHash(OLD)) });
    expect(outcome.ops[0]?.kind).toBe('skip');
    expect(outcome.content).toBeUndefined();
  });

  it('records a deleted file in removed[] instead of writing it again', () => {
    const outcome = createOnly({ lock: entry(contentHash(OLD)) });
    expect(outcome.removed).toEqual([{ path: PATH }]);
    expect(outcome.content).toBeUndefined();
  });

  it('stays when the kit stops writing it', () => {
    expect(
      plan({ entry: undefined, state: file(OLD), lock: entry(contentHash(OLD)), ownable: true }).content,
    ).toBeUndefined();
  });
});
