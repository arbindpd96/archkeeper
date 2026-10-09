import { describe, expect, it } from 'vitest';
import { contentHash } from '../src/core/hash.js';
import { emptyLock, type Lock, readLock, serializeLock } from '../src/core/lock.js';
import { rebuildLock } from '../src/core/lock-rebuild.js';
import { planInstall } from '../src/core/plan.js';
import {
  applied,
  blockEntry,
  CONTEXT,
  fileEntry,
  snapshotOf,
  TEST_BRAND,
  TEST_KIT,
  treeOf,
} from './plan-fixtures.js';

const OLD = contentHash('old\n');
const NEW = contentHash('new\n');

function lock(version: string, files: Lock['files'], removed: Lock['removed'] = []): Lock {
  return {
    ...emptyLock({ name: 'acmekit', version }, [`m-${version.replaceAll('.', '-')}`]),
    files,
    removed,
  };
}

const owned = (base: string | null): { module: string; strategy: 'owned'; base: string | null } => ({
  module: 'm',
  strategy: 'owned',
  base,
});

describe('rebuildLock', () => {
  it('keeps each entry from the side the newer kit wrote and the union of removed[]', () => {
    const older = lock(
      '1.0.0',
      new Map([
        ['a.md', owned(OLD)],
        ['only-old.md', owned(OLD)],
      ]),
      [{ path: 'x.md' }],
    );
    const newer = lock('1.1.0', new Map([['a.md', owned(NEW)]]), [{ path: 'y.md' }]);
    const rebuilt = rebuildLock([older, newer], new Map(), new Set(), TEST_BRAND);
    expect(rebuilt?.kit.version).toBe('1.1.0');
    expect(rebuilt?.modules).toEqual(['m-1-1-0']);
    expect(rebuilt?.files.get('a.md')).toEqual(owned(NEW));
    expect(rebuilt?.files.get('only-old.md')).toEqual(owned(OLD));
    expect(rebuilt?.removed).toEqual([{ path: 'y.md' }, { path: 'x.md' }]);
  });

  it('takes the first side when both kits are the same version', () => {
    const ours = lock('1.0.0', new Map([['a.md', owned(OLD)]]));
    const theirs = lock('1.0.0', new Map([['a.md', owned(NEW)]]));
    expect(rebuildLock([ours, theirs], new Map(), new Set())?.files.get('a.md')).toEqual(owned(OLD));
  });

  it('takes as base the content on disk when it hashes to an existing blob', () => {
    const side = lock('1.0.0', new Map([['a.md', { ...owned(OLD), pending: NEW }]]));
    const rebuilt = rebuildLock([side], snapshotOf({ 'a.md': 'new\n' }), new Set([NEW]));
    expect(rebuilt?.files.get('a.md')).toEqual(owned(NEW));
  });

  it('takes as base the content on disk when either side recorded its hash', () => {
    const ours = lock('1.0.0', new Map([['a.md', owned(OLD)]]));
    const theirs = lock('1.0.0', new Map([['a.md', owned(NEW)]]));
    expect(
      rebuildLock([ours, theirs], snapshotOf({ 'a.md': 'new\n' }), new Set())?.files.get('a.md'),
    ).toEqual(owned(NEW));
  });

  it('leaves an entry whose content on disk is unknown as it was, so it counts as a user edit', () => {
    const side = lock('1.0.0', new Map([['a.md', owned(OLD)]]));
    const rebuilt = rebuildLock([side], snapshotOf({ 'a.md': 'mine\n' }), new Set([OLD]));
    expect(rebuilt?.files.get('a.md')).toEqual(owned(OLD));
  });

  it('rebases blocks by the hash of each block body on disk', () => {
    const side: Lock = {
      ...emptyLock(TEST_KIT),
      blocks: new Map([['AGENTS.md', new Map([['a', { base: OLD }]])]]),
    };
    const text = '<!-- acmekit:begin a -->\nnew\n<!-- acmekit:end a -->\n';
    const rebuilt = rebuildLock([side], snapshotOf({ 'AGENTS.md': text }), new Set([NEW]), TEST_BRAND);
    expect(rebuilt?.blocks.get('AGENTS.md')?.get('a')).toEqual({ base: NEW });
  });

  it('returns undefined when no side is readable, so planning starts as on first contact', () => {
    expect(rebuildLock([], new Map(), new Set())).toBeUndefined();
  });
});

describe('a lock a git merge left with conflict markers', () => {
  it('is rebuilt and planned without overwriting anything', () => {
    const tree = treeOf(['a.md', fileEntry('A\n')], ['AGENTS.md', blockEntry('rules', 'Rules.\n')]);
    const first = planInstall(tree, snapshotOf(), undefined, CONTEXT);
    const state = applied(snapshotOf(), first);
    const theirs = serializeLock({ ...first.lock, removed: [{ path: 'gone.md' }] });
    const text = `<<<<<<< HEAD\n${first.lockText}=======\n${theirs}>>>>>>> branch\n`;
    const read = readLock(text, TEST_KIT, TEST_BRAND);
    if (!read.conflicted) throw new Error('expected a conflicted lock');
    const rebuilt = rebuildLock(read.sides, state, new Set(first.blobs.keys()), TEST_BRAND);
    const plan = planInstall(tree, state, rebuilt, CONTEXT);
    expect(plan.writes.size).toBe(0);
    expect(plan.ops.every((op) => op.kind === 'skip')).toBe(true);
    expect(plan.lock.removed).toEqual([{ path: 'gone.md' }]);
  });
});
