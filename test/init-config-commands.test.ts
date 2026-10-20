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
const STOP_WARNING = `checks.stop in ${CONFIG} runs "node -e x" before Claude stops, without asking`;

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
      `commands in ${CONFIG} run "node scripts/check.mjs", "mypy --strict" after each edit Claude makes, without asking`,
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
    const planned = { modules: ['format-on-edit'], existing: { config: { options } } } as unknown as Planned;
    expect(configCommandWarnings(planned, TEST_BRAND)).toEqual([]);
  });

  it('names no command this run set, and none of a module the preset leaves out', async () => {
    const flagged = await runInit(fixtureCopy('py-app').dir, ['--yes', '--preset', 'full', '--stop-check']);
    const medium = await runInit(clonedWith('medium', PAYLOAD), ['--yes']);
    expect([flagged.code, medium.code]).toEqual([0, 0]);
    expect(flagged.stderr).not.toContain('without asking');
    expect(medium.stderr).not.toContain('without asking');
  });
});
