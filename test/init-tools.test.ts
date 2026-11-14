import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureCopy, tempDir, writeFiles } from './helpers.js';
import { projectText } from './install-helpers.js';
import { runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const CONFIG = `${TEST_BRAND.stateDir}/config.json`;
const LEFT_OUT =
  'Left out: format-on-edit (needs prettier, biome or ruff, and none was detected for the ts stack)';

interface Summary {
  readonly plan: readonly { readonly ops: readonly { readonly kind: string }[] }[];
}

const configOf = (dir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(dir, CONFIG), 'utf8')) as Record<string, unknown>;

const recordedIn = (dir: string): unknown =>
  (configOf(dir).options as Record<string, unknown> | undefined)?.['format-on-edit'];

describe('init records the tools format-on-edit runs (#37)', () => {
  it.each([
    ['ts-app', [], { formatters: ['prettier'], linters: ['eslint'] }],
    ['py-app', [], { formatters: ['ruff'], linters: ['ruff'] }],
    ['mixed', [], { formatters: ['prettier', 'ruff'], linters: ['eslint', 'ruff'] }],
    ['mixed', ['--stack', 'python'], { formatters: ['ruff'], linters: ['ruff'] }],
  ])('on %s %j, then plans no change on a second init', async (fixture, args, recorded) => {
    const { dir } = fixtureCopy(fixture);
    expect((await runInit(dir, ['--yes', ...args])).code).toBe(0);
    expect(recordedIn(dir)).toEqual(recorded);
    const before = projectText(dir);
    const again = await runInit(dir, ['--json']);
    const { plan } = JSON.parse(again.stdout) as Summary;
    expect(plan.flatMap((entry) => entry.ops).filter((op) => op.kind !== 'skip')).toEqual([]);
    expect(projectText(dir)).toBe(before);
  });

  it('leaves format-on-edit out, saying why, where no formatter is detected, and records nothing', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'package.json': JSON.stringify({ devDependencies: { eslint: '^10.0.0' } }) });
    const result = await runInit(dir, ['--yes', '--preset', 'full']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`\n${LEFT_OUT}\n`);
    expect(result.stdout).toMatch(/^Modules: (?!.*format-on-edit).*$/m);
    expect(recordedIn(dir)).toBeUndefined();
    expect(readFileSync(path.join(dir, '.claude/settings.json'), 'utf8')).not.toContain('format-on-edit');
    const json = JSON.parse((await runInit(dir, ['--json'])).stdout) as { readonly dropped: unknown };
    expect(json.dropped).toEqual([
      {
        id: 'format-on-edit',
        reason: 'needs prettier, biome or ruff, and none was detected for the ts stack',
      },
    ]);
  });

  it.each([
    ['python', 'none was detected for the python stack'],
    ['none', 'the project stack is none'],
  ])(
    'names the stack in effect when --stack %s leaves out the one prettier was found for',
    async (stack, why) => {
      const dir = tempDir();
      writeFiles(dir, {
        'package.json': JSON.stringify({ devDependencies: { prettier: '^3.0.0' } }),
        'pyproject.toml': '[project]\nname = "app"\n',
      });
      const result = await runInit(dir, ['--yes', '--stack', stack]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        `\nLeft out: format-on-edit (needs prettier, biome or ruff, and ${why})\n`,
      );
    },
  );

  it('never changes a tool list the config sets, even to add the other one', async () => {
    const { dir } = fixtureCopy('ts-app');
    const options = {
      'format-on-edit': { formatters: ['biome'], commands: [['node', 'scripts/check.mjs']] },
    };
    writeFiles(dir, { [CONFIG]: `${JSON.stringify({ preset: 'medium', options }, null, 2)}\n` });
    const before = readFileSync(path.join(dir, CONFIG), 'utf8');
    expect((await runInit(dir, ['--yes'])).code).toBe(0);
    expect(readFileSync(path.join(dir, CONFIG), 'utf8')).toBe(before);
  });

  it('keeps every key the user wrote beside the tools it records', async () => {
    const { dir } = fixtureCopy('ts-app');
    const written = { preset: 'medium', team: 'billing', options: { safety: { blockNoVerify: true } } };
    writeFiles(dir, { [CONFIG]: JSON.stringify(written) });
    expect((await runInit(dir, ['--yes'])).code).toBe(0);
    expect(configOf(dir)).toEqual({
      ...written,
      options: {
        safety: { blockNoVerify: true },
        'format-on-edit': { formatters: ['prettier'], linters: ['eslint'] },
      },
    });
  });
});
