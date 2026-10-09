import { describe, expect, it } from 'vitest';
import { type BlocksJob, planBlocks } from '../src/core/blocks-plan.js';
import { BYTE_ORDER_MARK } from '../src/core/blocks-file.js';
import { MergeError } from '../src/core/errors.js';
import { contentHash } from '../src/core/hash.js';
import type { BlockEntry } from '../src/core/lock.js';
import type { PathState } from '../src/core/plan-types.js';
import type { RenderedEntry } from '../src/core/render-tree.js';
import { blockEntry, TEST_BRAND } from './kit-fixtures.js';

const begin = (id: string): string => `<!-- acmekit:begin ${id} -->`;
const end = (id: string): string => `<!-- acmekit:end ${id} -->`;
const block = (id: string, body: string, eol = '\n'): string =>
  `${begin(id)}${eol}${body.replaceAll('\n', eol)}${end(id)}${eol}`;
const file = (content: string): PathState => ({ kind: 'file', content });
const base = (body: string, pending?: string): BlockEntry => ({
  base: contentHash(body),
  ...(pending === undefined ? {} : { pending: contentHash(pending) }),
});

function plan(
  entries: readonly RenderedEntry[],
  job: Partial<Omit<BlocksJob, 'lock'>> & { lock?: Record<string, BlockEntry>; removed?: string[] } = {},
): ReturnType<typeof planBlocks> {
  const { lock, removed = [], ...rest } = job;
  return planBlocks({
    path: 'AGENTS.md',
    entries,
    state: undefined,
    sidecar: undefined,
    lock: lock === undefined ? undefined : new Map(Object.entries(lock)),
    isRemoved: (id) => removed.includes(id),
    ownable: () => false,
    brand: TEST_BRAND,
    ...rest,
  });
}

describe('the blocks strategy', () => {
  it('creates a missing file with the import block first', () => {
    const outcome = plan([blockEntry('imports', '@AGENTS.md\n'), blockEntry('notes', 'Notes.\n')], {
      path: 'CLAUDE.md',
    });
    expect(outcome.content).toBe(`${block('imports', '@AGENTS.md\n')}\n${block('notes', 'Notes.\n')}`);
    expect(outcome.ops.map((op) => op.kind)).toEqual(['insertBlock', 'insertBlock']);
    expect(outcome.blocks).toEqual(
      new Map([
        ['imports', base('@AGENTS.md\n')],
        ['notes', base('Notes.\n')],
      ]),
    );
  });

  it('appends a block to a file without markers and keeps every user byte', () => {
    const mine = '# My agents file\r\n\r\nNo trailing newline';
    const outcome = plan([blockEntry('rules', 'Be careful.\n')], { state: file(mine) });
    expect(outcome.content).toBe(`${mine}\r\n\r\n${block('rules', 'Be careful.\n', '\r\n')}`);
  });

  it('replaces a block unchanged since the kit wrote it, in place, with a BOM and CRLF intact', () => {
    const text = `${BYTE_ORDER_MARK}before\r\n${block('rules', 'Old.\n', '\r\n')}after\r\n`;
    const outcome = plan([blockEntry('rules', 'New.\n')], {
      state: file(text),
      lock: { rules: base('Old.\n') },
    });
    expect(outcome.ops).toMatchObject([{ kind: 'replaceBlock', entry: 'rules' }]);
    expect(outcome.content).toBe(`${BYTE_ORDER_MARK}before\r\n${block('rules', 'New.\n', '\r\n')}after\r\n`);
    expect(outcome.blocks?.get('rules')).toEqual(base('New.\n'));
  });

  it('keeps a block the user changed and writes the whole file with the kit version to one sidecar', () => {
    const text = `top\n${block('a', 'Old A.\n')}${block('b', 'My B.\n')}bottom\n`;
    const outcome = plan([blockEntry('a', 'New A.\n'), blockEntry('b', 'New B.\n')], {
      state: file(text),
      lock: { a: base('Old A.\n'), b: base('Old B.\n') },
    });
    expect(outcome.ops.map((op) => op.kind)).toEqual(['replaceBlock', 'sidecar']);
    expect(outcome.content).toBe(`top\n${block('a', 'New A.\n')}${block('b', 'My B.\n')}bottom\n`);
    expect(outcome.sidecar).toBe(`top\n${block('a', 'New A.\n')}${block('b', 'New B.\n')}bottom\n`);
    expect(outcome.blocks?.get('b')).toEqual(base('Old B.\n', 'New B.\n'));
  });

  it('records a kit block the user deleted in removed[] and never adds it back', () => {
    const outcome = plan([blockEntry('a', 'A.\n')], { state: file('mine\n'), lock: { a: base('A.\n') } });
    expect(outcome.ops[0]?.kind).toBe('respectRemoval');
    expect(outcome.removed).toEqual([{ path: 'AGENTS.md', blockId: 'a' }]);
    expect(outcome.content).toBeUndefined();
    expect(outcome.blocks?.has('a')).toBe(false);
  });

  it('respects an earlier removal', () => {
    const outcome = plan([blockEntry('a', 'A.\n')], { state: file('mine\n'), removed: ['a'] });
    expect(outcome.ops[0]?.kind).toBe('respectRemoval');
    expect(outcome.content).toBeUndefined();
  });

  it('adopts a block found with the kit content on first contact', () => {
    const outcome = plan([blockEntry('a', 'A.\n')], { state: file(block('a', 'A.\n')) });
    expect(outcome.ops[0]?.kind).toBe('adopt');
    expect(outcome.content).toBeUndefined();
    expect(outcome.blocks?.get('a')).toEqual(base('A.\n'));
  });

  it('keeps a different block found on first contact, with base null', () => {
    const outcome = plan([blockEntry('a', 'A.\n')], { state: file(block('a', 'Theirs.\n')) });
    expect(outcome.ops[0]?.kind).toBe('sidecar');
    expect(outcome.blocks?.get('a')).toEqual({ base: null, pending: contentHash('A.\n') });
  });

  it('refuses malformed markers before planning anything, naming the line', () => {
    const run = (): unknown => plan([blockEntry('a', 'A.\n')], { state: file(`ok\n${begin('a')}\n`) });
    expect(run).toThrow(MergeError);
    expect(run).toThrow('AGENTS.md: line 2: opens block "a", which is never closed');
  });

  it('never writes through a symlink, and offers the blocks in a sidecar', () => {
    const outcome = plan([blockEntry('a', 'A.\n')], { state: { kind: 'symlink' } });
    expect(outcome.content).toBeUndefined();
    expect(outcome.sidecar).toBe(block('a', 'A.\n'));
    expect(outcome.ops[0]?.reason).toContain('is a symlink');
  });

  it('removes an unchanged block the kit no longer writes when the current kit could own it', () => {
    const outcome = plan([], {
      state: file(`mine\n${block('old', 'Old.\n')}`),
      lock: { old: base('Old.\n') },
      ownable: () => true,
    });
    expect(outcome.ops[0]?.kind).toBe('delete');
    expect(outcome.content).toBe('mine\n');
  });

  it('leaves a block the kit no longer writes when no current module could own it', () => {
    const outcome = plan([], { state: file(block('old', 'Old.\n')), lock: { old: base('Old.\n') } });
    expect(outcome.ops[0]?.kind).toBe('skip');
    expect(outcome.content).toBeUndefined();
    expect(outcome.blocks?.get('old')).toEqual(base('Old.\n'));
  });

  it('moves a block base to pending once its sidecar is gone', () => {
    const outcome = plan([blockEntry('a', 'New.\n')], {
      state: file(block('a', 'Mine.\n')),
      lock: { a: base('Old.\n', 'New.\n') },
    });
    expect(outcome.ops[0]).toMatchObject({
      kind: 'adopt',
      reason: expect.stringContaining('counts as seen') as string,
    });
    expect(outcome.sidecar).toBeUndefined();
    expect(outcome.blocks?.get('a')).toEqual(base('New.\n'));
  });

  it('never overwrites a blocks sidecar the user edited', () => {
    const outcome = plan([blockEntry('a', 'Newer.\n')], {
      state: file(block('a', 'Mine.\n')),
      sidecar: file('my notes on the update\n'),
      lock: { a: base('Old.\n', 'New.\n') },
    });
    expect(outcome.ops[0]?.kind).toBe('skip');
    expect(outcome.sidecar).toBeUndefined();
    expect(outcome.blocks?.get('a')).toEqual(base('Old.\n', 'New.\n'));
  });

  it('rewrites a blocks sidecar the kit wrote when the kit content changes again', () => {
    const outcome = plan([blockEntry('a', 'Newer.\n')], {
      state: file(block('a', 'Mine.\n')),
      sidecar: file(block('a', 'New.\n')),
      lock: { a: base('Old.\n', 'New.\n') },
    });
    expect(outcome.ops[0]?.kind).toBe('sidecar');
    expect(outcome.sidecar).toBe(block('a', 'Newer.\n'));
  });
});
