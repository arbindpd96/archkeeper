import { describe, expect, it } from 'vitest';
import { PathSafetyError, RenderError } from '../src/core/errors.js';
import { contentHash } from '../src/core/hash.js';
import { emptyLock, type Lock } from '../src/core/lock.js';
import { planInstall, snapshotPaths, STATE_BLOCK, withStateBlock } from '../src/core/plan.js';
import {
  applied,
  blockEntry,
  CONTEXT,
  denyEntry,
  fileEntry,
  opsOf,
  snapshotOf,
  TEST_BRAND,
  TEST_KIT,
  textAt,
  treeOf,
} from './plan-fixtures.js';

const TREE = treeOf(
  ['AGENTS.md', blockEntry('rules', 'Be careful.\n')],
  ['CLAUDE.md', blockEntry('imports', '@AGENTS.md\n')],
  ['.claude/rules/acmekit/a.md', fileEntry('# A\n')],
  ['.claude/settings.json', denyEntry(['Read(**/.env)'])],
  ['docs/notes.md', fileEntry('# Notes\n', 'create-only')],
);

describe('planInstall', () => {
  it('returns ordered operations, each with a reason, for a fresh project', () => {
    const plan = planInstall(TREE, snapshotOf(), undefined, CONTEXT);
    expect(opsOf(plan)).toEqual([
      'create .claude/rules/acmekit/a.md',
      'mergeJson .claude/settings.json#$schema',
      'mergeJson .claude/settings.json#permissions.deny Read(**/.env)',
      `insertBlock .gitattributes#${STATE_BLOCK}`,
      'insertBlock AGENTS.md#rules',
      'insertBlock CLAUDE.md#imports',
      'create docs/notes.md',
    ]);
    expect(plan.ops.every((op) => op.reason.length > 0)).toBe(true);
    expect(textAt(applied(new Map(), plan), '.gitattributes')).toBe(
      `# acmekit:begin ${STATE_BLOCK}\n.acmekit/base/** binary linguist-generated\n# acmekit:end ${STATE_BLOCK}\n`,
    );
  });

  it('keeps a blob of each owned file and block, and none of create-only files or JSON entries', () => {
    const plan = planInstall(TREE, snapshotOf(), undefined, CONTEXT);
    const contents = [...plan.blobs.values()].sort();
    expect(contents).toEqual([
      '# A\n',
      '.acmekit/base/** binary linguist-generated\n',
      '@AGENTS.md\n',
      'Be careful.\n',
    ]);
    for (const [hash, content] of plan.blobs) expect(contentHash(content)).toBe(hash);
    expect(plan.lock.files.get('docs/notes.md')).toEqual({
      module: 'm',
      strategy: 'create-only',
      base: contentHash('# Notes\n'),
    });
  });

  it('records the running kit and the modules in the lock', () => {
    const plan = planInstall(TREE, snapshotOf(), undefined, { ...CONTEXT, modules: ['base', 'safety'] });
    expect(plan.lock.kit).toEqual(TEST_KIT);
    expect(plan.lock.modules).toEqual(['base', 'safety']);
  });

  it('adopts an untracked file identical to the kit output and reports a different one', () => {
    const snapshot = snapshotOf({ '.claude/rules/acmekit/a.md': '# A\r\n', 'docs/notes.md': '# My notes\n' });
    const plan = planInstall(TREE, snapshot, undefined, CONTEXT);
    expect(plan.ops.find((op) => op.path === '.claude/rules/acmekit/a.md')?.kind).toBe('adopt');
    expect(plan.ops.find((op) => op.path === 'docs/notes.md')).toMatchObject({ kind: 'skip' });
    expect(plan.writes.has('docs/notes.md')).toBe(false);
    expect(plan.writes.has('.claude/rules/acmekit/a.md')).toBe(false);
  });

  it('records a kit file the user deleted in removed[] and never recreates it', () => {
    const first = planInstall(TREE, snapshotOf(), undefined, CONTEXT);
    const state = applied(snapshotOf(), first);
    state.delete('.claude/rules/acmekit/a.md');
    const second = planInstall(TREE, state, first.lock, CONTEXT);
    expect(second.lock.removed).toEqual([{ path: '.claude/rules/acmekit/a.md' }]);
    expect(second.writes.has('.claude/rules/acmekit/a.md')).toBe(false);
    const third = planInstall(TREE, applied(state, second), second.lock, CONTEXT);
    expect(third.ops.find((op) => op.path === '.claude/rules/acmekit/a.md')?.kind).toBe('respectRemoval');
    expect(third.writes.size).toBe(0);
  });

  it('plans only skips against the state its own apply left, so a second run writes nothing', () => {
    const user = snapshotOf({ 'AGENTS.md': '# Mine\n', '.claude/settings.json': '{ "model": "opus" }\n' });
    const first = planInstall(TREE, user, undefined, CONTEXT);
    const second = planInstall(TREE, applied(user, first), first.lock, CONTEXT);
    expect(second.ops.map((op) => op.kind)).toEqual(second.ops.map(() => 'skip'));
    expect(second.writes.size).toBe(0);
    expect(second.lockText).toBe(first.lockText);
  });

  it('checks every path the lock names, since the lock is untrusted', () => {
    const lock: Lock = {
      ...emptyLock(TEST_KIT),
      files: new Map([['.GIT/hooks/pre-commit', { module: 'm', strategy: 'owned', base: null }]]),
    };
    const run = (): unknown => planInstall(TREE, snapshotOf(), lock, CONTEXT);
    expect(run).toThrow(PathSafetyError);
    expect(run).toThrow('".GIT/hooks/pre-commit": listed in the lock: is refused');
  });

  it('deletes what the tree no longer renders only where the caller says the current kit could own it', () => {
    const first = planInstall(TREE, snapshotOf(), undefined, CONTEXT);
    const state = applied(snapshotOf(), first);
    const smaller = treeOf(['CLAUDE.md', blockEntry('imports', '@AGENTS.md\n')]);
    const kept = planInstall(smaller, state, first.lock, CONTEXT);
    expect(kept.writes.size).toBe(0);
    const owned = planInstall(smaller, state, first.lock, { ...CONTEXT, ownable: () => true });
    expect(owned.writes.get('.claude/rules/acmekit/a.md')).toBeNull();
    expect(owned.writes.get('AGENTS.md')).toBe('');
    expect(owned.writes.has('docs/notes.md')).toBe(false);
  });
});

describe('the kit state block', () => {
  it('is added to every tree, so the base blobs are always binary and generated', () => {
    expect(withStateBlock(new Map(), TEST_BRAND).get('.gitattributes')).toEqual([
      {
        strategy: 'blocks',
        module: 'acmekit',
        blockId: STATE_BLOCK,
        content: '.acmekit/base/** binary linguist-generated\n',
      },
    ]);
  });

  it('refuses a module that writes .gitattributes another way or uses its block id', () => {
    expect(() => withStateBlock(treeOf(['.gitattributes', fileEntry('* text\n')]), TEST_BRAND)).toThrow(
      RenderError,
    );
    expect(() =>
      withStateBlock(treeOf(['.gitattributes', blockEntry(STATE_BLOCK, 'x\n')]), TEST_BRAND),
    ).toThrow('which the kit keeps for itself');
  });

  it('keeps a module block in .gitattributes next to its own', () => {
    const tree = withStateBlock(treeOf(['.gitattributes', blockEntry('eol', '* text=auto\n')]), TEST_BRAND);
    expect(tree.get('.gitattributes')?.map((entry) => entry.blockId)).toEqual(['eol', STATE_BLOCK]);
  });
});

describe('snapshotPaths', () => {
  it('lists every tree and lock path with its sidecar, sorted', () => {
    const lock: Lock = { ...emptyLock(TEST_KIT), blocks: new Map([['OLD.md', new Map()]]) };
    expect(snapshotPaths(treeOf(['a.md', fileEntry('A\n')]), [lock], TEST_BRAND)).toEqual([
      '.gitattributes',
      '.gitattributes.acmekit-new',
      'OLD.md',
      'OLD.md.acmekit-new',
      'a.md',
      'a.md.acmekit-new',
    ]);
  });
});
