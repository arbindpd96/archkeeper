import { describe, expect, it } from 'vitest';
import { planInstall } from '../src/core/plan.js';
import { condensePlan, type PathSummary, type PlanGroup, summarizePlan } from '../src/core/plan-summary.js';
import type { PlanOp } from '../src/core/plan-types.js';
import {
  blockEntry,
  CONTEXT,
  denyEntry,
  fileEntry,
  planAndApply,
  snapshotOf,
  treeOf,
} from './plan-fixtures.js';

const TREE = treeOf(
  ['AGENTS.md', blockEntry('rules', 'Be careful.\n')],
  ['CLAUDE.md', blockEntry('imports', '@AGENTS.md\n')],
  ['.claude/rules/acmekit/a.md', fileEntry('# A\n')],
  ['.claude/settings.json', denyEntry(['Read(**/.env)'])],
  ['docs/decisions.md', fileEntry('# Decisions\n', 'create-only')],
  ['docs/notes.md', fileEntry('# Notes\n', 'create-only')],
);

function summary(path: string, group: PlanGroup, ops: readonly PlanOp[] = []): PathSummary {
  return { path, group, ops };
}

describe('condensePlan', () => {
  it("names a fresh plan's root files on one row and counts the files of each folder", () => {
    const plan = planInstall(TREE, snapshotOf(), undefined, CONTEXT);
    expect(condensePlan(summarizePlan(plan))).toEqual([
      { kind: 'root', group: 'create', names: ['.gitattributes', 'AGENTS.md', 'CLAUDE.md'] },
      { kind: 'folder', group: 'create', folder: '.claude', count: 2 },
      { kind: 'folder', group: 'create', folder: 'docs', count: 2 },
    ]);
  });

  it('condenses a re-run that only skips into the same rows', () => {
    const first = planAndApply(TREE, snapshotOf());
    const again = planInstall(TREE, first.snapshot, first.plan.lock, CONTEXT);
    expect(condensePlan(summarizePlan(again))).toEqual([
      { kind: 'root', group: 'skip', names: ['.gitattributes', 'AGENTS.md', 'CLAUDE.md'] },
      { kind: 'folder', group: 'skip', folder: '.claude', count: 2 },
      { kind: 'folder', group: 'skip', folder: 'docs', count: 2 },
    ]);
  });

  it('shows the full path of a folder that holds one file', () => {
    const settings = summary('.claude/settings.json', 'create');
    expect(condensePlan([settings])).toEqual([{ kind: 'path', summary: settings }]);
  });

  it("names each group's root files on a row of its own, even a single one", () => {
    const rows = condensePlan([
      summary('CLAUDE.md', 'skip'),
      summary('AGENTS.md', 'create'),
      summary('.gitignore', 'create'),
    ]);
    expect(rows).toEqual([
      { kind: 'root', group: 'create', names: ['.gitignore', 'AGENTS.md'] },
      { kind: 'root', group: 'skip', names: ['CLAUDE.md'] },
    ]);
  });

  it('keeps every modify and conflict path on its own row with its operations, even in one folder', () => {
    const settingsOp: PlanOp = {
      kind: 'mergeJson',
      path: '.claude/settings.json',
      entry: 'permissions.deny Read(**/.env)',
      reason: 'adds the entry the kit owns',
    };
    const settings = summary('.claude/settings.json', 'modify', [settingsOp]);
    const rule = summary('.claude/rules/acmekit/a.md', 'modify', [
      { kind: 'delete', path: '.claude/rules/acmekit/a.md', reason: 'its module was left out' },
    ]);
    const skill = summary('.claude/skills/why/SKILL.md', 'conflict', [
      { kind: 'sidecar', path: '.claude/skills/why/SKILL.md', reason: 'the user has their own' },
    ]);
    expect(condensePlan([skill, settings, rule])).toEqual([
      { kind: 'path', summary: rule },
      { kind: 'path', summary: settings },
      { kind: 'path', summary: skill },
    ]);
  });

  it('orders rows by group, then root files first, then folders and paths in text order', () => {
    const userFile = summary('CLAUDE.md', 'modify');
    const userSkill = summary('AGENTS.md', 'conflict');
    const rows = condensePlan([
      summary('README.md', 'skip'),
      summary('docs/b.md', 'create'),
      userSkill,
      summary('.claude/y.md', 'create'),
      userFile,
      summary('docs/a.md', 'create'),
      summary('.gitignore', 'create'),
      summary('.claude/x.md', 'create'),
    ]);
    expect(rows).toEqual([
      { kind: 'root', group: 'create', names: ['.gitignore'] },
      { kind: 'folder', group: 'create', folder: '.claude', count: 2 },
      { kind: 'folder', group: 'create', folder: 'docs', count: 2 },
      { kind: 'path', summary: userFile },
      { kind: 'path', summary: userSkill },
      { kind: 'root', group: 'skip', names: ['README.md'] },
    ]);
  });

  it('has no rows for an empty plan', () => {
    expect(condensePlan([])).toEqual([]);
  });
});
