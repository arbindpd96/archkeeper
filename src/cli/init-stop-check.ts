import type { Brand } from '../core/brand.js';
import { configPath } from '../core/config.js';
import { UsageError } from '../core/errors.js';
import type { StackProfile } from '../core/stack-profile.js';
import { isStringList, quoted } from '../core/text.js';
import { gitFix } from './init-answers.js';
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

// A command the config already runs is the config's, so --stop-check keeps it, and says so where it is not the one
// init detected.
function warnKept(run: InitRun, kept: readonly string[], detected: readonly string[] | undefined): void {
  if (detected === undefined || JSON.stringify(kept) === JSON.stringify(detected)) return;
  const [keptText, detectedText] = [quoted(kept.join(' ')), quoted(detected.join(' '))];
  run.asking.report.warn(
    `--stop-check keeps ${keptText} from ${OPTION} in ${configPath(run.brand)}, not the detected ${detectedText}`,
  );
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
  const proposed = proposedStopCommand(profile, settled);
  if (isStringList(current) && current.length > 0) {
    warnKept(run, current, proposed);
    return undefined;
  }
  if (proposed === undefined) {
    refuseFlag(
      'found no test command: no package.json test script and no pytest',
      `set "${OPTION}" in ${where} to yours, such as ["vitest", "run"]`,
    );
  }
  return { [MODULE]: { [OPTION]: proposed } };
}

// The hook checks only the changes git lists, so init says where git lists none, and records the command all the
// same: the folder may become a repository later.
function warnWithoutGit(run: InitRun): void {
  const state = run.session.context.gitState(run.rootReal);
  if (state === 'clean' || state === 'dirty') return;
  run.asking.report.warn(
    `the stop check runs only on changes git lists, and git cannot list them in ${run.root}, so it runs nothing ` +
      `there; ${gitFix(state)}.`,
  );
}

/**
 * The stop check's command init records in the config (#38, ADR-0015), while the stop-check module is selected:
 * `--stop-check` sets the detected one; else, while the config has no `checks.stop`, an interactive run asks with the
 * exact command, defaulting to no, and records a no as `[]`, so it never asks again, and a scripted run records
 * nothing. Turning it on where git cannot list the folder's changes warns. Null when the user cancels the question.
 */
export async function stopCheckOptions(
  run: InitRun,
  settled: Settled,
  profile: StackProfile,
): Promise<ConfigAnswers['options'] | null> {
  if (run.flags.stopCheck === true) {
    const options = flagged(run, settled, profile);
    warnWithoutGit(run);
    return options;
  }
  const own = settled.next.config.options[MODULE] ?? {};
  const proposed = proposedStopCommand(profile, settled);
  if (!run.asking.interactive || !selected(settled) || Object.hasOwn(own, OPTION) || proposed === undefined) {
    return undefined;
  }
  const question = `Turn on the stop check? Before Claude stops, it runs ${quoted(proposed.join(' '))}, and so the code Claude wrote, without asking.`;
  const yes = await run.asking.prompter.confirm(question, false);
  if (yes !== true) return yes === undefined ? null : { [MODULE]: { [OPTION]: [] } };
  warnWithoutGit(run);
  return { [MODULE]: { [OPTION]: proposed } };
}

/**
 * The Next steps line while the stop-check module is in: the command it runs and where the config sets it, or, while
 * the config sets no `checks.stop`, that it runs nothing until one is set; none after a no, recorded as `[]`.
 */
export function stopCheckSteps(planned: Planned, brand: Brand): string[] {
  if (!planned.modules.includes(MODULE)) return [];
  const command = planned.next.config.options[MODULE]?.[OPTION];
  const where = `${OPTION} in ${configPath(brand)}`;
  if (command === undefined) return [`The stop check is off: set ${where}, or run init with --stop-check.`];
  if (!isStringList(command) || command.length === 0) return [];
  return [`The stop check runs ${quoted(command.join(' '))} before Claude stops (${where}).`];
}
