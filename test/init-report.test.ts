import { describe, expect, it } from 'vitest';
import { diffLines, planLines } from '../src/cli/init-report.js';
import type { PathSummary } from '../src/core/plan-summary.js';

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
