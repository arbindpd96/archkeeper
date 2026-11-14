import type { Brand } from '../core/brand.js';
import { configPath } from '../core/config.js';
import { UsageError } from '../core/errors.js';
import { detectedTools } from '../core/format-tools.js';
import type { Stack } from '../core/schema-parts.js';
import type { StackProfile } from '../core/stack-profile.js';
import { isStringList, quoted } from '../core/text.js';
import { gitFix } from './init-answers.js';
import type { ConfigAnswers } from './init-config.js';
import { hookRuns, type InitRun, isSelected, type Planned } from './init-run.js';
import type { Settled } from './init-tools.js';

const MODULE = 'stop-check';
const OPTION = 'checks.stop';

function exitingTestScript(profile: StackProfile): boolean {
  return profile.commands.some(
    (command) => command.stack === 'ts' && command.purpose === 'test' && command.watches !== true,
  );
}

/**
 * The test command init proposes for the stop check (#38): the package.json `test` script through npm, whatever the
 * package manager, since npm ships with Node.js, unless the script starts a watcher, which would hold every stop
 * until its timeout, or Yarn Plug'n'Play installs the packages, which leaves no `node_modules/.bin` for npm to run the
 * script's tools from; else `pytest` where detection found it. TS/JS comes first in a mixed project, and only a stack
 * in effect counts.
 */
export function proposedStopCommand(
  profile: StackProfile,
  settled: Pick<Settled, 'stack' | 'tools'>,
): string[] | undefined {
  const npmRuns = profile.pnp !== true && exitingTestScript(profile);
  if (npmRuns && settled.stack.includes('ts')) return ['npm', 'run', 'test'];
  return settled.tools.includes('pytest') ? ['pytest'] : undefined;
}

function refuseFlag(problem: string, hint: string): never {
  throw new UsageError({ file: '--stop-check', location: '', problem, hint });
}

// The test commands detection found for a stack that --stack or the config's stack leaves out, each with its stack.
function leftOutCommands(profile: StackProfile, stack: readonly Stack[]): [command: string, owner: Stack][] {
  const found: [string, Stack][] = [];
  if (profile.pnp !== true && exitingTestScript(profile)) found.push(['npm run test', 'ts']);
  if (detectedTools(profile, ['python']).includes('pytest')) found.push(['pytest', 'python']);
  return found.filter(([, owner]) => !stack.includes(owner));
}

// A test command of a stack the run leaves out is there, but only a stack in effect counts; under Yarn Plug'n'Play,
// the test script is there but npm finds none of the tools it runs.
function refuseWithoutCommand(profile: StackProfile, stack: readonly Stack[], where: string): never {
  const leftOut = leftOutCommands(profile, stack);
  if (leftOut.length > 0) {
    const commands = leftOut.map(([command]) => quoted(command)).join(' and ');
    const owners = leftOut.map(([, owner]) => owner).join(' and ');
    const [is, stacks] = leftOut.length === 1 ? ['is', 'stack'] : ['are', 'stacks'];
    refuseFlag(
      `found no test command: the detected ${commands} ${is} for the ${owners} ${stacks}, which --stack or the config's stack leaves out`,
      `pass --stack ts,python, or set "${OPTION}" in ${where}`,
    );
  }
  if (profile.pnp === true && exitingTestScript(profile)) {
    refuseFlag(
      "found no test command: Yarn Plug'n'Play installs no node_modules for npm to run the test script from, and no pytest",
      'set nodeLinker: node-modules in .yarnrc.yml and run yarn install, then run init with --stop-check again',
    );
  }
  refuseFlag(
    'found no test command: no package.json test script that exits on its own, and no pytest',
    `set "${OPTION}" in ${where} to yours, such as ["vitest", "run"]`,
  );
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
  if (!isSelected(settled, MODULE)) {
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
  if (proposed === undefined) refuseWithoutCommand(profile, settled.stack, where);
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
  if (
    !run.asking.interactive ||
    !isSelected(settled, MODULE) ||
    Object.hasOwn(own, OPTION) ||
    proposed === undefined
  ) {
    return undefined;
  }
  const question = `Turn on the stop check? Before Claude stops, it runs ${quoted(proposed.join(' '))} without asking, and so whatever it collects in this folder, code Claude writes, clones or downloads included. The command must exit on its own, with no watch mode.`;
  const yes = await run.asking.prompter.confirm(question, false);
  if (yes !== true) return yes === undefined ? null : { [MODULE]: { [OPTION]: [] } };
  warnWithoutGit(run);
  return { [MODULE]: { [OPTION]: proposed } };
}

// The step for a check with no command offers --stop-check only where init finds one for the flag to set.
function offStep(planned: Planned, where: string): string {
  const tools = detectedTools(planned.profile, planned.stack);
  const proposed = proposedStopCommand(planned.profile, { stack: planned.stack, tools });
  const flag = proposed === undefined ? '' : ', or run init with --stop-check';
  return `The stop check is off: set ${where}${flag}.`;
}

/**
 * The Next steps line while the stop-check module is in: the command it runs and where the config sets it, or, while
 * the config sets no `checks.stop`, that it runs nothing until one is set; none after a no, recorded as `[]`. While
 * the module is left out but init keeps the hook it installed earlier, the line says the command still runs.
 */
export function stopCheckSteps(planned: Planned, brand: Brand): string[] {
  const selected = planned.modules.includes(MODULE);
  const command = planned.next.config.options[MODULE]?.[OPTION];
  const where = `${OPTION} in ${configPath(brand)}`;
  if (!hookRuns(planned, MODULE, brand)) return [];
  if (selected && command === undefined) return [offStep(planned, where)];
  if (!isStringList(command) || command.length === 0) return [];
  const runs = quoted(command.join(' '));
  return selected
    ? [`The stop check runs ${runs} before Claude stops (${where}).`]
    : [
        `The stop check still runs ${runs} before Claude stops, until update removes its hook; to turn it off now, set ${where} to [].`,
      ];
}
