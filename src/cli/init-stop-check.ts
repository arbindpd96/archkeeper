import type { Brand } from '../core/brand.js';
import { configPath } from '../core/config.js';
import { UsageError } from '../core/errors.js';
import type { StackProfile } from '../core/stack-profile.js';
import { quoted } from '../core/text.js';
import type { ConfigAnswers } from './init-config.js';
import type { InitRun, Planned } from './init-run.js';
import type { Settled } from './init-tools.js';

const MODULE = 'stop-check';
const OPTION = 'checks.stop';

const selected = (settled: Settled): boolean =>
  settled.resolution.modules.some((kit) => kit.manifest.id === MODULE);

/**
 * The test command init proposes for the stop check (#38): the package.json `test` script through npm, whatever the
 * package manager, since npm ships with Node.js; else `pytest` where detection found it. TS/JS comes first in a
 * mixed project, and only a stack in effect counts.
 */
export function proposedStopCommand(profile: StackProfile, settled: Settled): string[] | undefined {
  const testScript = profile.commands.some((command) => command.stack === 'ts' && command.purpose === 'test');
  if (testScript && settled.stack.includes('ts')) return ['npm', 'run', 'test'];
  return settled.tools.includes('pytest') ? ['pytest'] : undefined;
}

function refuseFlag(problem: string, hint: string): never {
  throw new UsageError({ file: '--stop-check', location: '', problem, hint });
}

// --stop-check turns the check on with the detected command, an earlier no included, and keeps a command the config
// already runs.
function flagged(run: InitRun, settled: Settled, profile: StackProfile): ConfigAnswers['options'] {
  const where = `options.${MODULE} in ${configPath(run.brand)}`;
  if (!selected(settled)) {
    refuseFlag(
      'needs the stop-check module, which only the full preset has',
      `pass --preset full or --modules +stop-check; ${where} holds its command`,
    );
  }
  const current = settled.next.config.options[MODULE]?.[OPTION];
  if (Array.isArray(current) && current.length > 0) return undefined;
  const proposed = proposedStopCommand(profile, settled);
  if (proposed === undefined) {
    refuseFlag(
      'found no test command: no package.json test script and no pytest',
      `set "${OPTION}" in ${where} to yours, such as ["vitest", "run"]`,
    );
  }
  return { [MODULE]: { [OPTION]: proposed } };
}

/**
 * The stop check's command init records in the config (#38, ADR-0015), while the stop-check module is selected:
 * `--stop-check` sets the detected one; else, while the config has no `checks.stop`, an interactive run asks with the
 * exact command, defaulting to no, and records a no as `[]`, so it never asks again, and a scripted run records
 * nothing. Null when the user cancels the question.
 */
export async function stopCheckOptions(
  run: InitRun,
  settled: Settled,
  profile: StackProfile,
): Promise<ConfigAnswers['options'] | null> {
  if (run.flags.stopCheck === true) return flagged(run, settled, profile);
  const own = settled.next.config.options[MODULE] ?? {};
  const proposed = proposedStopCommand(profile, settled);
  if (!run.asking.interactive || !selected(settled) || Object.hasOwn(own, OPTION) || proposed === undefined) {
    return undefined;
  }
  const question = `Turn on the stop check? Before Claude stops, it runs ${quoted(proposed.join(' '))} when code changed.`;
  const yes = await run.asking.prompter.confirm(question, false);
  if (yes === undefined) return null;
  return { [MODULE]: { [OPTION]: yes ? proposed : [] } };
}

/** The Next steps line while the stop check is on: the command it runs and where the config sets it. */
export function stopCheckSteps(planned: Planned, brand: Brand): string[] {
  const command = planned.next.config.options[MODULE]?.[OPTION];
  if (!planned.modules.includes(MODULE) || !Array.isArray(command) || command.length === 0) return [];
  const runs = quoted(command.join(' '));
  return [`The stop check runs ${runs} before Claude stops (${OPTION} in ${configPath(brand)}).`];
}
