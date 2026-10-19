import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureCopy, tempDir, writeFiles } from './helpers.js';
import { projectText } from './install-helpers.js';
import { runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const CONFIG = `${TEST_BRAND.stateDir}/config.json`;
const question = (command: string): string =>
  `Turn on the stop check? Before Claude stops, it runs "${command}" when code changed.`;
const step = (command: string): string =>
  `The stop check runs "${command}" before Claude stops (checks.stop in ${CONFIG}).`;

interface Summary {
  readonly plan: readonly { readonly ops: readonly { readonly kind: string }[] }[];
}

function stopCheckOf(dir: string): unknown {
  const config = JSON.parse(readFileSync(path.join(dir, CONFIG), 'utf8')) as {
    options?: Record<string, unknown>;
  };
  return config.options?.['stop-check'];
}

function writeConfig(dir: string, stop: readonly string[]): void {
  const options = { 'stop-check': { 'checks.stop': stop } };
  writeFiles(dir, { [CONFIG]: `${JSON.stringify({ preset: 'full', options }, null, 2)}\n` });
}

describe('init asks to turn on the stop check in full (#38, ADR-0015)', () => {
  it('asks after the preset, showing the exact command and defaulting to no, and records a yes', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, [], { interactive: true, answers: ['full', true, true] });
    expect(result.code).toBe(0);
    expect(result.asked[1]).toBe(question('npm run test'));
    expect(result.defaults[1]).toBe(false);
    expect(result.transcript.indexOf(`[? ${question('npm run test')}]`)).toBeLessThan(
      result.transcript.indexOf('Plan:'),
    );
    expect(stopCheckOf(dir)).toEqual({ 'checks.stop': ['npm', 'run', 'test'] });
    expect(result.stdout).toContain(`\n  3. ${step('npm run test')}\n`);
  });

  it('records a no as an empty command, says nothing of it, and asks nothing on the next init', async () => {
    const { dir } = fixtureCopy('py-app');
    const result = await runInit(dir, [], { interactive: true, answers: ['full', false, true] });
    expect(result.asked[1]).toBe(question('pytest'));
    expect(stopCheckOf(dir)).toEqual({ 'checks.stop': [] });
    expect(result.stdout).not.toContain('The stop check runs');
    const again = await runInit(dir, [], { interactive: true });
    expect([again.code, again.asked]).toEqual([0, []]);
  });

  it.each([
    ['the npm test script on a mixed project', [], 'npm run test'],
    ['pytest where Python is the stack in effect', ['--stack', 'python'], 'pytest'],
  ])('proposes %s', async (_name, args, command) => {
    const { dir } = fixtureCopy('mixed');
    const result = await runInit(dir, args, { interactive: true, answers: ['full', true, true] });
    expect(result.asked[1]).toBe(question(command));
    expect(stopCheckOf(dir)).toEqual({ 'checks.stop': command.split(' ') });
  });

  it('never asks with the medium preset, which has no stop check', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, [], { interactive: true, answers: ['medium', true] });
    expect(result.asked).toHaveLength(2);
    expect(result.asked[1]).toBe('Apply this plan?');
  });

  it('asks nothing where it detects no test command', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'package.json': JSON.stringify({ devDependencies: { prettier: '^3.0.0' } }) });
    const result = await runInit(dir, [], { interactive: true, answers: ['full', true] });
    expect(result.asked.slice(1)).toEqual(['Apply this plan?']);
  });

  it('writes nothing when the question is cancelled', async () => {
    const { dir } = fixtureCopy('ts-app');
    const before = projectText(dir);
    const result = await runInit(dir, [], { interactive: true, answers: ['full', undefined] });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('Cancelled. Nothing was written.');
    expect(projectText(dir)).toBe(before);
  });
});

describe('init sets the stop check in a scripted run only with --stop-check (#38)', () => {
  it('leaves checks.stop unset without the flag', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, ['--yes', '--preset', 'full']);
    expect(result.code).toBe(0);
    expect(stopCheckOf(dir)).toBeUndefined();
    expect(result.stdout).not.toContain('The stop check runs');
  });

  it('records the detected command with the flag, and a second init plans no change', async () => {
    const { dir } = fixtureCopy('py-app');
    const result = await runInit(dir, ['--yes', '--preset', 'full', '--stop-check']);
    expect(result.code).toBe(0);
    expect(stopCheckOf(dir)).toEqual({ 'checks.stop': ['pytest'] });
    expect(result.stdout).toContain(step('pytest'));
    const before = projectText(dir);
    const again = await runInit(dir, ['--json', '--stop-check']);
    const { plan } = JSON.parse(again.stdout) as Summary;
    expect(plan.flatMap((entry) => entry.ops).filter((op) => op.kind !== 'skip')).toEqual([]);
    expect(projectText(dir)).toBe(before);
  });

  it('turns on a check an earlier no turned off', async () => {
    const { dir } = fixtureCopy('ts-app');
    writeConfig(dir, []);
    expect((await runInit(dir, ['--yes', '--stop-check'])).code).toBe(0);
    expect(stopCheckOf(dir)).toEqual({ 'checks.stop': ['npm', 'run', 'test'] });
  });

  it('keeps a command the config already runs', async () => {
    const { dir } = fixtureCopy('ts-app');
    writeConfig(dir, ['vitest', 'run']);
    expect((await runInit(dir, ['--yes', '--stop-check'])).code).toBe(0);
    expect(stopCheckOf(dir)).toEqual({ 'checks.stop': ['vitest', 'run'] });
  });

  it('refuses the flag with a preset that has no stop check, naming where its command lives', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, ['--yes', '--stop-check']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      '--stop-check: needs the stop-check module, which only the full preset has',
    );
    expect(result.stderr).toContain(`options.stop-check in ${CONFIG}`);
  });

  it('refuses the flag where it detects no test command, naming the option to set', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'package.json': JSON.stringify({ devDependencies: { prettier: '^3.0.0' } }) });
    const result = await runInit(dir, ['--yes', '--preset', 'full', '--stop-check']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--stop-check: found no test command');
    expect(result.stderr).toContain(`"checks.stop" in options.stop-check in ${CONFIG}`);
  });
});
