import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import type { Payload } from '../src/hooks/runtime/io.js';
import { preCompact } from '../src/hooks/runtime/memory/pre-compact.js';
import {
  OVERVIEW_PRESETS,
  SESSION_START_CAPS,
  sessionStart,
} from '../src/hooks/runtime/memory/session-start.js';
import { SNAPSHOT_FILE } from '../src/hooks/runtime/memory/snapshot.js';
import { REPO_ROOT, tempDir, tempRepo, writeFiles } from './helpers.js';
import { injectedContext, memoryText } from './hook-helpers.js';

const POINTER = `${BRAND.stateDir}/local/active-feature`;
const CONFIG = `${BRAND.stateDir}/config.json`;
const LOGIN = 'docs/features/login/MEMORY.md';
const PRESETS = JSON.parse(readFileSync(path.join(REPO_ROOT, 'modules/presets.json'), 'utf8')) as {
  presets: { name: string; defaults: { sessionStartCap: number } }[];
};
const MAP_PRESETS = (
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'modules/architecture-map/module.json'), 'utf8')) as {
    presets: string[];
  }
).presets;
const ARCHITECTURE = '# Map\n\n## Overview\n\nThe app has three layers.\n\n## Index\n\nNot injected.\n';

function contextOf(projectDir: string, payload: Payload = { source: 'startup' }): string {
  return injectedContext(sessionStart.answer({ payload }, { projectDir, home: tempDir() }));
}

const SAVED_AT = new Date(Date.now() - 60_000).toISOString();

function snapshotJson(
  status: readonly string[] | null,
  more = 0,
  branch: string | null = 'main',
  savedAt = SAVED_AT,
): string {
  return JSON.stringify({ savedAt, branch, status, more });
}

/** A project of `preset` whose active feature, snapshot and map are each about `size` characters long. */
function projectOf(preset: string, size: number, config = JSON.stringify({ preset })): string {
  const dir = tempDir();
  const long = (word: string): string => `${word} `.repeat(Math.ceil(size / (word.length + 1))).trim();
  writeFiles(dir, {
    ...(config === '' ? {} : { [CONFIG]: config }),
    [POINTER]: 'login\n',
    [LOGIN]: memoryText({ next: long('next'), goal: long('goal'), decisions: [`- ${long('decision')}`] }),
    [SNAPSHOT_FILE]: snapshotJson([' M src/a.ts']),
    'docs/architecture.md': `# Map\n\n## Overview\n\n${long('overview')}\n`,
  });
  return dir;
}

const HEADINGS = [
  '## Next step',
  '## Goal',
  '## Decisions',
  '## Before compaction',
  '## Architecture overview',
];

describe('the SessionStart caps (ADR-0015, ADR-0017)', () => {
  it("equal each preset's cap in modules/presets.json, which a hook bundle cannot read", () => {
    const caps = Object.fromEntries(
      PRESETS.presets.map((preset) => [preset.name, preset.defaults.sessionStartCap]),
    );
    expect(SESSION_START_CAPS).toEqual(caps);
  });

  it('give the architecture Overview to the presets that have the architecture-map module', () => {
    expect([...OVERVIEW_PRESETS].sort()).toEqual([...MAP_PRESETS].sort());
  });

  it.each(Object.entries(SESSION_START_CAPS))(
    'cut %s at %d characters, keeping Next step, Goal, Decisions, the snapshot and the Overview in that order',
    (preset, cap) => {
      for (const size of [100, 400, 1_500, 5_000]) {
        const context = contextOf(projectOf(preset, size), { source: 'compact' });
        expect(context.length).toBeLessThanOrEqual(cap);
        const shown = HEADINGS.filter((heading) => context.includes(heading));
        expect(shown).toEqual(HEADINGS.slice(0, shown.length));
        if (!OVERVIEW_PRESETS.includes(preset)) expect(context).not.toContain('## Architecture overview');
        if (size === 100) expect(shown).toHaveLength(OVERVIEW_PRESETS.includes(preset) ? 5 : 4);
        if (size === 5_000) expect(shown).toEqual(['## Next step']);
      }
    },
  );

  it('cuts the Next step itself, marking the cut, when it alone is longer than the cap', () => {
    const context = contextOf(projectOf('small', 5_000));
    expect(context).toHaveLength(SESSION_START_CAPS.small ?? 0);
    expect(context).toMatch(/## Next step\nnext next[\s\S]*\n…\(truncated\)$/);
  });

  it.each([
    ['no config', ''],
    ['a config that is not JSON', '{'],
    ['a config with no preset', '{}'],
    ['an unknown preset', '{"preset":"huge"}'],
  ])('keeps the smallest cap, without the Overview, for %s', (_name, config) => {
    const context = contextOf(projectOf('full', 5_000, config));
    expect(context).toHaveLength(SESSION_START_CAPS.small ?? 0);
    expect(contextOf(projectOf('full', 100, config))).not.toContain('## Architecture overview');
  });
});

describe('session-start and the architecture Overview (#35)', () => {
  it.each(['medium', 'full'])(
    'adds only the Overview section of docs/architecture.md in %s, last',
    (preset) => {
      const dir = tempDir();
      writeFiles(dir, {
        [CONFIG]: JSON.stringify({ preset }),
        [LOGIN]: memoryText(),
        'docs/architecture.md': ARCHITECTURE,
      });
      const context = contextOf(dir);
      expect(
        context.endsWith('## Architecture overview (docs/architecture.md)\nThe app has three layers.'),
      ).toBe(true);
      expect(context).not.toContain('Not injected.');
    },
  );

  it('leaves the Overview out in small, and wherever no feature is active', () => {
    const dir = tempDir();
    writeFiles(dir, {
      [CONFIG]: '{"preset":"small"}',
      [LOGIN]: memoryText(),
      'docs/architecture.md': ARCHITECTURE,
    });
    expect(contextOf(dir)).not.toContain('Architecture overview');
    writeFiles(dir, { [CONFIG]: '{"preset":"full"}', [LOGIN]: memoryText({ status: 'done' }) });
    expect(contextOf(dir)).not.toContain('Architecture overview');
  });
});

describe('session-start after compaction (#35)', () => {
  it('re-injects the pre-compaction snapshot after compaction, and only then', () => {
    const dir = tempRepo({ [LOGIN]: memoryText() });
    writeFiles(dir, { 'src/new.ts': 'export {};\n' });
    preCompact.answer({ payload: { trigger: 'auto' } }, { projectDir: dir, home: tempDir() });
    const after = contextOf(dir, { source: 'compact' });
    expect(after).toContain(`## Before compaction (${SNAPSHOT_FILE})\nSaved `);
    expect(after).toContain('on branch main, with 1 uncommitted path (git status --short):\n?? src/');
    expect(contextOf(dir, { source: 'resume' })).not.toContain('Before compaction');
  });

  it('shows at most 20 lines of the snapshot, saying how many more there are', () => {
    const dir = tempDir();
    const status = Array.from({ length: 50 }, (_, index) => `?? f${String(index)}.ts`);
    writeFiles(dir, { [LOGIN]: memoryText(), [SNAPSHOT_FILE]: snapshotJson(status, 7) });
    const section = contextOf(dir, { source: 'compact' }).split('## Before compaction')[1] ?? '';
    const lines = section.trim().split('\n').slice(1);
    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe(
      `Saved ${SAVED_AT} on branch main, with 57 uncommitted paths (git status --short):`,
    );
    expect(lines.at(-1)).toBe('… and 39 more');
  });

  it('says when git could not give the branch or the status, or when nothing was uncommitted', () => {
    const dir = tempDir();
    writeFiles(dir, { [LOGIN]: memoryText(), [SNAPSHOT_FILE]: snapshotJson(null, 0, null) });
    expect(contextOf(dir, { source: 'compact' })).toContain('git could not say the branch or the status.');
    writeFiles(dir, { [SNAPSHOT_FILE]: snapshotJson([], 0, null) });
    expect(contextOf(dir, { source: 'compact' })).toContain('on no branch, with nothing uncommitted.');
  });

  it('adds the snapshot after the one line when no feature is active', () => {
    const dir = tempDir();
    writeFiles(dir, { [SNAPSHOT_FILE]: snapshotJson(['?? a.ts']) });
    const context = contextOf(dir, { source: 'compact' });
    expect(context).toMatch(/^\S+ feature memory: no feature is active\.[^\n]*\n\n## Before compaction/);
  });

  it.each([
    'not json',
    '[]',
    '{"savedAt":"yesterday","branch":null,"status":null,"more":0}',
    snapshotJson(['x'], -1),
  ])('ignores a snapshot file that is not a snapshot: %s', (text) => {
    const dir = tempDir();
    writeFiles(dir, { [LOGIN]: memoryText(), [SNAPSHOT_FILE]: text });
    expect(contextOf(dir, { source: 'compact' })).not.toContain('Before compaction');
  });

  it.each([
    ['over 15 minutes ago', -16 * 60_000],
    ['in the future', 60_000],
  ])('ignores a snapshot saved %s, which is not the one this compaction took', (_when, offsetMs) => {
    const dir = tempDir();
    const savedAt = new Date(Date.now() + offsetMs).toISOString();
    writeFiles(dir, {
      [LOGIN]: memoryText(),
      [SNAPSHOT_FILE]: snapshotJson(['?? a.ts'], 0, 'main', savedAt),
    });
    expect(contextOf(dir, { source: 'compact' })).not.toContain('Before compaction');
  });
});
