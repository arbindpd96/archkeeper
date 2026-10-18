import { describe, expect, it } from 'vitest';
import {
  condensedPlanLines,
  diffLines,
  planLines,
  stateLines,
  verboseHintLines,
} from '../src/cli/init-report.js';
import type { PathSummary, PlanRow } from '../src/core/plan-summary.js';
import { TEST_BRAND } from './kit-fixtures.js';

const RLO = String.fromCharCode(0x202e);
const paint = (format: unknown, text: string): string => `<${String(format)}>${text}`;

describe('diffLines', () => {
  it('styles only the two file lines as headers, so a removed --- rule reads as a removal', () => {
    const diff = '--- a/AGENTS.md\n+++ b/AGENTS.md\n@@ -1,2 +1,1 @@\n----\n+++ added\n kept\n';
    expect(diffLines(diff, paint)).toEqual([
      '<bold>--- a/AGENTS.md',
      '<bold>+++ b/AGENTS.md',
      '<cyan>@@ -1,2 +1,1 @@',
      '<red>----',
      '<green>+++ added',
      ' kept',
    ]);
  });

  it('escapes control characters a file line holds', () => {
    expect(diffLines('--- a/x\n+++ b/x\n@@ -0,0 +1,1 @@\n+\u001b[2J', paint)[3]).toBe('<green>+\\u001b[2J');
  });
});

describe('planLines', () => {
  it('escapes the path, entry and reason of every operation', () => {
    const summary: PathSummary = {
      path: `docs/${RLO}evil.md`,
      group: 'conflict',
      ops: [{ kind: 'sidecar', path: `docs/${RLO}evil.md`, reason: 'kept\u0007' }],
    };
    expect(planLines([summary], paint)).toEqual(['  <red>conflict  docs/\\u202eevil.md: kept\\u0007']);
  });
});

describe('condensedPlanLines', () => {
  it("prints root names, a folder's count and a path with its changes in planLines' columns", () => {
    const claude: PathSummary = {
      path: 'CLAUDE.md',
      group: 'modify',
      ops: [{ kind: 'insertBlock', path: 'CLAUDE.md', entry: 'imports', reason: 'adds the block' }],
    };
    const rows: PlanRow[] = [
      { kind: 'root', group: 'create', names: ['.gitignore', 'AGENTS.md'] },
      { kind: 'folder', group: 'create', folder: '.claude', count: 3 },
      { kind: 'path', summary: claude },
    ];
    expect(condensedPlanLines(rows, paint)).toEqual([
      '  <green>create    .gitignore, AGENTS.md',
      '  <green>create    3 files in .claude/',
      '  <yellow>modify    CLAUDE.md (add block imports)',
    ]);
  });

  it('escapes every root name and folder', () => {
    const rows: PlanRow[] = [
      { kind: 'root', group: 'skip', names: [`${RLO}a.md`, 'b\u0007.md'] },
      { kind: 'folder', group: 'skip', folder: `${RLO}docs`, count: 2 },
    ];
    expect(condensedPlanLines(rows, paint)).toEqual([
      '  <dim>skip      \\u202ea.md, b\\u0007.md',
      '  <dim>skip      2 files in \\u202edocs/',
    ]);
  });

  it('says there is nothing to plan when there are no rows', () => {
    expect(condensedPlanLines([], paint)).toEqual(['  nothing to plan']);
  });
});

describe('verboseHintLines', () => {
  it('names --verbose only when a folder row hides files', () => {
    const folder: PlanRow = { kind: 'folder', group: 'create', folder: 'docs', count: 2 };
    const root: PlanRow = { kind: 'root', group: 'create', names: ['AGENTS.md', 'CLAUDE.md'] };
    expect(verboseHintLines([root, folder])).toEqual(['  Add --verbose to list every file.']);
    expect(verboseHintLines([root])).toEqual([]);
  });
});

describe('stateLines', () => {
  const config = `${TEST_BRAND.stateDir}/config.json`;
  const lock = `${TEST_BRAND.stateDir}/lock.json`;
  const blob = `${TEST_BRAND.stateDir}/base/${'a'.repeat(64)}`;

  it('names only the kit files the apply writes', () => {
    expect(stateLines(['CLAUDE.md', lock], TEST_BRAND)).toEqual(['  and the lock']);
    expect(stateLines([blob], TEST_BRAND)).toEqual(['  and the base blobs']);
    expect(stateLines([config, 'CLAUDE.md'], TEST_BRAND)).toEqual([`  and ${config}`]);
  });

  it('lists several with commas and a final and', () => {
    expect(stateLines([blob, config, lock], TEST_BRAND)).toEqual([
      `  and ${config}, the lock and the base blobs`,
    ]);
  });

  it('prints nothing when the apply writes none of them', () => {
    expect(stateLines(['AGENTS.md'], TEST_BRAND)).toEqual([]);
  });
});
