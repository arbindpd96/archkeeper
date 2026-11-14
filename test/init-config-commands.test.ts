import { describe, expect, it } from 'vitest';
import { configCommandWarnings } from '../src/cli/init-config-commands.js';
import type { Planned } from '../src/cli/init-run.js';
import { fixtureCopy, writeFiles } from './helpers.js';
import { projectText } from './install-helpers.js';
import { runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const CONFIG = `${TEST_BRAND.stateDir}/config.json`;
const QUESTION = 'Continue, letting the hooks run these commands?';
const PAYLOAD = { 'stop-check': { 'checks.stop': ['node', '-e', 'x'] } };
const STOP_WARNING = `checks.stop in ${CONFIG} runs "node -e x" before Claude stops, without asking; remove it unless you trust whoever wrote it`;
const SHIPPED = 'git tracks files in .venv/, so format-on-edit would run tools this repository ships';
const SHIPPED_WARNING = `${SHIPPED} rather than ones you installed, without asking; delete those files and install your own unless you trust whoever committed them`;
const UNANSWERED_WARNING =
  'git cannot say whether you installed the tools in .venv/, so format-on-edit would run whatever is there, without asking; delete that folder and install your own unless you trust where this project came from';

/** ts-app with a config whose options name commands for the hooks, as a cloned repository may ship one. */
function clonedWith(preset: string, options: object): string {
  const { dir } = fixtureCopy('ts-app');
  writeFiles(dir, { [CONFIG]: `${JSON.stringify({ preset, options, compose: {} }, null, 2)}\n` });
  return dir;
}

describe('init names the commands a config has the hooks run (#37, #38, ADR-0015)', () => {
  it('warns about a checks.stop the config on disk sets, which this user never confirmed', async () => {
    const result = await runInit(clonedWith('full', PAYLOAD), ['--yes']);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(STOP_WARNING);
  });

  it("warns about format-on-edit's commands from the config, which run after every edit", async () => {
    const commands = [
      ['node', 'scripts/check.mjs'],
      ['mypy', '--strict'],
    ];
    const result = await runInit(clonedWith('medium', { 'format-on-edit': { commands } }), ['--yes']);
    expect(result.stderr).toContain(
      `commands in ${CONFIG} run "node scripts/check.mjs", "mypy --strict" after each edit Claude makes, without asking; remove them unless you trust whoever wrote them`,
    );
  });

  it('asks on a terminal before it applies, defaulting to no, and writes nothing after a no', async () => {
    const dir = clonedWith('full', PAYLOAD);
    const before = projectText(dir);
    const result = await runInit(dir, [], { interactive: true, answers: [false] });
    expect(result.code).toBe(1);
    expect([result.asked, result.defaults]).toEqual([[QUESTION], [false]]);
    expect(projectText(dir)).toBe(before);
  });

  it('applies after a yes, asking for the plan as usual', async () => {
    const result = await runInit(clonedWith('full', PAYLOAD), [], {
      interactive: true,
      answers: [true, true],
    });
    expect(result.code).toBe(0);
    expect(result.asked).toEqual([QUESTION, 'Apply this plan?']);
  });

  it('names no format-on-edit commands from a value the hook would not run, such as one with an empty command', () => {
    const options = { 'format-on-edit': { commands: [['node', 'scripts/check.mjs'], []] } };
    const existing = { config: { options } };
    const planned = {
      modules: ['format-on-edit'],
      existing,
      hooksKept: [],
      shipped: { folders: [], tracked: true },
    } as unknown as Planned;
    expect(configCommandWarnings(planned, TEST_BRAND)).toEqual([]);
  });

  it('warns and asks about the command of a module left out whose hook init keeps, which still runs it', async () => {
    const { dir } = fixtureCopy('py-app');
    expect((await runInit(dir, ['--yes', '--preset', 'full', '--stop-check'])).code).toBe(0);
    const result = await runInit(dir, ['--modules', '-stop-check'], {
      interactive: true,
      answers: ['no', true, true],
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      `checks.stop in ${CONFIG} runs "pytest" before Claude stops, without asking;`,
    );
    expect(result.asked.slice(1)).toEqual([QUESTION, 'Apply this plan?']);
    expect(result.stdout).toContain(
      `The stop check still runs "pytest" before Claude stops, until update removes its hook; to turn it off now, set checks.stop under options.stop-check in ${CONFIG} to [].`,
    );
  });

  it('warns and asks when git tracks files in .venv, where format-on-edit would find its ruff', async () => {
    const { dir } = fixtureCopy('py-app');
    writeFiles(dir, { '.venv/bin/ruff': '#!/bin/sh\n' });
    const before = projectText(dir);
    const setup = { interactive: true, answers: ['no', false], shipped: ['.venv'] };
    const result = await runInit(dir, ['--preset', 'medium'], setup);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(SHIPPED_WARNING);
    expect(result.asked.slice(1)).toEqual([QUESTION]);
    expect(projectText(dir)).toBe(before);
  });

  it('names the stop check beside format-on-edit once checks.stop names a command', async () => {
    const args = ['--yes', '--preset', 'full', '--stop-check'];
    const result = await runInit(fixtureCopy('py-app').dir, args, { shipped: ['node_modules', '.venv'] });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      'git tracks files in node_modules/ and .venv/, so format-on-edit and the stop check would run tools',
    );
  });

  it('warns and asks where git cannot say whether the user installed the tools in a .venv that exists', async () => {
    const { dir } = fixtureCopy('py-app');
    writeFiles(dir, { '.venv/bin/ruff': '#!/bin/sh\n' });
    const before = projectText(dir);
    const setup = { interactive: true, answers: ['no', false], shipped: null };
    const result = await runInit(dir, ['--preset', 'medium'], setup);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(UNANSWERED_WARNING);
    expect(result.asked.slice(1)).toEqual([QUESTION]);
    expect(projectText(dir)).toBe(before);
  });

  it('names no folder where git cannot say and neither node_modules nor .venv exists', async () => {
    const args = ['--yes', '--preset', 'medium'];
    const result = await runInit(fixtureCopy('py-app').dir, args, { shipped: null });
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain('git cannot say');
  });

  it('names no tools a repository ships while no hook runs one', async () => {
    const args = ['--yes', '--preset', 'small'];
    const result = await runInit(fixtureCopy('py-app').dir, args, { shipped: ['.venv'] });
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain('git tracks files in');
  });

  it('names no command this run set, and none of a module the preset leaves out', async () => {
    const flagged = await runInit(fixtureCopy('py-app').dir, ['--yes', '--preset', 'full', '--stop-check']);
    const medium = await runInit(clonedWith('medium', PAYLOAD), ['--yes']);
    expect([flagged.code, medium.code]).toEqual([0, 0]);
    expect(flagged.stderr).not.toContain('without asking');
    expect(medium.stderr).not.toContain('without asking');
  });
});
