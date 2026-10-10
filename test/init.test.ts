import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { fixtureCopy, runCliProcess, tempDir, withEnv, writeFiles } from './helpers.js';
import { projectText } from './install-helpers.js';
import { runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const CONFIG = `${TEST_BRAND.stateDir}/config.json`;

function read(dir: string, file: string): string {
  return readFileSync(path.join(dir, file), 'utf8');
}

interface JsonResult {
  readonly plan: readonly { path: string; group: string }[];
  readonly exitCode: number;
  readonly preset: string;
  readonly stack: readonly string[];
}

function jsonOf(stdout: string): JsonResult {
  const lines = stdout.trimEnd().split('\n');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] ?? '') as JsonResult;
}

describe('init, scripted', () => {
  it('sets up a fresh project with --yes and changes nothing on a second run', async () => {
    const { dir } = fixtureCopy('ts-app');
    const first = await runInit(dir, ['--yes']);
    expect(first.code).toBe(0);
    expect(read(dir, 'CLAUDE.md')).toContain('@AGENTS.md');
    expect(read(dir, 'AGENTS.md')).toContain('| `npm run test` | Run the tests |');
    expect(JSON.parse(read(dir, CONFIG))).toEqual({
      $schema: 'https://cdn.jsdelivr.net/npm/acmekit@1.0.0/schema/config.schema.json',
      version: 1,
      preset: 'medium',
    });
    const before = projectText(dir);
    const second = await runInit(dir, ['--json']);
    expect(second.code).toBe(0);
    expect(jsonOf(second.stdout).plan.every((path) => path.group === 'skip')).toBe(true);
    expect(projectText(dir)).toBe(before);
  });

  it('needs --yes to write when there is no terminal, and names the flags', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'Try: pass --yes to apply the plan, or --dry-run to see it without writing',
    );
    expect(existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
  });

  it.each([
    ['not-a-repo', 'is not a git repository', 'run git init and commit first, or pass --yes'],
    ['dirty', 'has uncommitted changes', 'commit or stash your changes first, or pass --yes'],
  ] as const)('stops on a project that %s without --yes', async (git, problem, fix) => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, [], { git });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(problem);
    expect(result.stderr).toContain(`Try: ${fix}`);
  });

  it('warns and goes on with --yes when git cannot undo the changes', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, ['--yes'], { git: 'dirty' });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Warning:');
    expect(result.stderr).toContain('has uncommitted changes');
  });

  it('prints a unified diff with --dry-run and writes nothing', async () => {
    const { dir } = fixtureCopy('py-app');
    const before = projectText(dir);
    const result = await runInit(dir, ['--dry-run']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('--- /dev/null\n+++ b/CLAUDE.md\n@@ -0,0 +1,');
    expect(result.stdout).toContain('+| `pytest` | Run the tests |');
    expect(result.stdout).toContain(`+++ b/${CONFIG}`);
    expect(result.stdout).toContain('Dry run: nothing was written.');
    expect(projectText(dir)).toBe(before);
  });

  it('prints one JSON line with --json and asks nothing', async () => {
    const { dir } = fixtureCopy('mixed');
    const result = await runInit(dir, ['--json', '--yes', '--preset', 'small'], { interactive: true });
    expect(result.code).toBe(0);
    expect(result.asked).toEqual([]);
    const json = jsonOf(result.stdout);
    expect(json).toMatchObject({ preset: 'small', stack: ['ts', 'python'], exitCode: 0 });
    expect(json.plan.map((entry) => [entry.path, entry.group])).toContainEqual(['CLAUDE.md', 'create']);
  });

  it('names --json as what keeps it from asking for a yes on a terminal', async () => {
    const { dir } = fixtureCopy('mixed');
    const result = await runInit(dir, ['--json'], { interactive: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--json runs without questions');
  });

  it('keeps --stack and --modules in the config', async () => {
    const { dir } = fixtureCopy('mixed');
    const result = await runInit(dir, ['--yes', '--stack', 'python', '--modules', '-knowledge,+stop-check']);
    expect(result.code).toBe(0);
    expect(JSON.parse(read(dir, CONFIG))).toMatchObject({
      stack: ['python'],
      modules: { add: ['stop-check'], remove: ['knowledge'] },
    });
    expect(read(dir, 'AGENTS.md')).not.toContain('npm run');
    expect(result.stdout).toContain(
      'Modules: base, architecture-map, feature-memory, format-on-edit, safety, stop-check',
    );
  });

  it.each([
    [['--stack', 'rust'], '--stack: "rust" is not a stack'],
    [['--modules', '+nope'], '--modules: "nope" is not a module'],
    [['--preset', 'huge'], '--preset: "huge" is not a preset'],
    [['--cwd', 'missing'], 'is not a folder'],
  ])('refuses %j before it asks or writes anything', async (args, message) => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, ['--yes', ...args]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(message);
    expect(existsSync(path.join(dir, TEST_BRAND.stateDir))).toBe(false);
  });

  it('re-runs from the config like update, keeping a preset chosen earlier', async () => {
    const { dir } = fixtureCopy('ts-app');
    await runInit(dir, ['--yes', '--preset', 'small']);
    const again = await runInit(dir, ['--json']);
    expect(jsonOf(again.stdout).preset).toBe('small');
  });
});

describe('init, interactive', () => {
  it('shows the stack, asks for a preset with its token budget, shows the plan, confirms, then writes', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, [], { interactive: true, answers: ['full', true] });
    expect(result.code).toBe(0);
    const order = [
      'Detected: TypeScript (npm)',
      '[? Choose a preset',
      'Plan:',
      '[? Apply this plan?]',
      'Next steps:',
    ];
    const positions = order.map((text) => result.transcript.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
    expect(result.asked[0]).toContain('up to 1.5k tokens always loaded');
    expect(result.asked[0]).toContain('up to 4.5k tokens always loaded');
    expect(JSON.parse(read(dir, CONFIG))).toMatchObject({ preset: 'full' });
  });

  it('asks, once the plan is shown, before going on in a project git cannot undo, and stops on a no', async () => {
    const { dir } = fixtureCopy('ts-app');
    const before = projectText(dir);
    const answers = ['medium', false];
    const result = await runInit(dir, [], { interactive: true, git: 'not-a-repo', answers });
    expect(result.code).toBe(1);
    expect(result.asked.slice(1)).toEqual(['Continue anyway?']);
    expect(result.transcript.indexOf('Plan:')).toBeLessThan(
      result.transcript.indexOf('[? Continue anyway?]'),
    );
    expect(result.stdout).toContain('Cancelled. Nothing was written.');
    expect(projectText(dir)).toBe(before);
  });

  it.each([
    ['declines the plan', ['medium', false]],
    ['cancels the preset question', [undefined]],
  ])('writes nothing when the user %s', async (_name, answers) => {
    const { dir } = fixtureCopy('ts-app');
    const before = projectText(dir);
    const result = await runInit(dir, [], { interactive: true, answers });
    expect(result.code).toBe(1);
    expect(projectText(dir)).toBe(before);
  });

  it('refuses the plan it showed when a file changes before the yes', async () => {
    const { dir } = fixtureCopy('ts-app');
    const whileAsking = (question: string): void => {
      if (question === 'Apply this plan?') {
        writeFileSync(path.join(dir, 'CLAUDE.md'), '# Written meanwhile\n');
      }
    };
    const result = await runInit(dir, [], { interactive: true, answers: ['medium', true], whileAsking });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('CLAUDE.md');
    expect(read(dir, 'CLAUDE.md')).toBe('# Written meanwhile\n');
    expect(existsSync(path.join(dir, 'AGENTS.md'))).toBe(false);
  });
});

describe('init with a closed stdin', () => {
  it('never waits on a prompt: without --yes it exits 1 at once with the flags to pass', () => {
    const dir = tempDir();
    writeFiles(dir, { 'package.json': '{"scripts":{"test":"vitest"}}\n' });
    const result = runCliProcess(['init', '--cwd', dir], { env: withEnv({ CI: '' }), timeoutMs: 20_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--yes');
    expect(existsSync(path.join(dir, BRAND.stateDir))).toBe(false);
  });

  it('applies the plan with --yes', () => {
    const dir = tempDir();
    const result = runCliProcess(['init', '--cwd', dir, '--yes'], { timeoutMs: 20_000 });
    expect(result.stderr).not.toContain('Error:');
    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, 'CLAUDE.md'))).toBe(true);
  });
});
