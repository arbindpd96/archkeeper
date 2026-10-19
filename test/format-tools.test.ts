import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatTools, TOOL_STACK } from '../src/core/format-tools.js';
import type { Stack } from '../src/core/schema-parts.js';
import { type StackProfile, TOOLS, type ToolsByJob } from '../src/core/stack-profile.js';
import { REPO_ROOT } from './helpers.js';

/** The profile detection gives a fixture of test/fixtures/detect, with its tools changed where a case needs it. */
function profileOf(fixture: string, tools: Partial<ToolsByJob> = {}): StackProfile {
  const file = path.join(REPO_ROOT, 'test/fixtures/detect', fixture, 'expected.json');
  const profile = JSON.parse(readFileSync(file, 'utf8')) as StackProfile;
  return { ...profile, tools: { ...profile.tools, ...tools } };
}

interface Recorded {
  readonly formatters: readonly string[];
  readonly linters: readonly string[];
}

describe('formatTools (#37)', () => {
  it.each<[string, StackProfile, readonly Stack[], Recorded]>([
    ['prettier and eslint', profileOf('ts-npm'), ['ts'], { formatters: ['prettier'], linters: ['eslint'] }],
    [
      'biome alone, as a formatter only',
      profileOf('biome-only'),
      ['ts'],
      { formatters: ['biome'], linters: [] },
    ],
    [
      'prettier before biome',
      profileOf('biome-only', { formatters: ['prettier', 'biome'] }),
      ['ts'],
      { formatters: ['prettier'], linters: [] },
    ],
    [
      'ruff, which formats and lints Python',
      profileOf('py-uv'),
      ['python'],
      { formatters: ['ruff'], linters: ['ruff'] },
    ],
    [
      'ruff as a linter only where black formats the Python',
      profileOf('py-uv', { formatters: ['ruff', 'black'] }),
      ['python'],
      { formatters: [], linters: ['ruff'] },
    ],
    [
      'nothing for black alone, which format-on-edit does not run',
      profileOf('py-poetry'),
      ['python'],
      { formatters: [], linters: [] },
    ],
    ['nothing in a project with no tools', profileOf('empty'), [], { formatters: [], linters: [] }],
  ])('records %s', (_name, profile, stack, recorded) => {
    expect(formatTools(profile, stack)).toMatchObject(recorded);
  });

  it('counts only the tools of the stacks in effect, in TOOL_JOBS order', () => {
    const mixed = profileOf('mixed', { formatters: ['prettier', 'ruff'], linters: ['eslint', 'ruff'] });
    expect(formatTools(mixed, ['ts', 'python'])).toEqual({
      formatters: ['prettier', 'ruff'],
      linters: ['eslint', 'ruff'],
      detected: ['prettier', 'ruff', 'eslint', 'tsc', 'vitest', 'pytest'],
    });
    expect(formatTools(mixed, ['python'])).toEqual({
      formatters: ['ruff'],
      linters: ['ruff'],
      detected: ['ruff', 'pytest'],
    });
    expect(formatTools(mixed, [])).toEqual({ formatters: [], linters: [], detected: [] });
  });

  it('gives every tool detection knows a stack', () => {
    expect(Object.keys(TOOL_STACK).sort()).toEqual([...TOOLS].sort());
  });
});
