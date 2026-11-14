import type { Brand } from '../core/brand.js';
import { configPath } from '../core/config.js';
import { isCommandList, isStringList, quoted } from '../core/text.js';
import type { Asking } from './init-answers.js';
import { hookRuns, type InitRun, type Planned } from './init-run.js';

const TOOL_FOLDERS = ['node_modules', '.venv'];

/** What says which hooks run project tools once init is done: the modules, the hooks the lock keeps, the config. */
type ToolPlan = Pick<Planned, 'modules' | 'hooksKept' | 'next'>;

const shown = (command: readonly string[]): string => quoted(command.join(' '));

// The hooks that run project tools once init is done: format-on-edit, and the stop check while checks.stop names a
// command, this run's answer included.
function toolHooks(planned: ToolPlan, brand: Brand): string[] {
  const stop = planned.next.config.options['stop-check']?.['checks.stop'];
  const stops = hookRuns(planned, 'stop-check', brand) && isStringList(stop) && stop.length > 0;
  return [
    ...(hookRuns(planned, 'format-on-edit', brand) ? ['format-on-edit'] : []),
    ...(stops ? ['the stop check'] : []),
  ];
}

/**
 * The folders the hooks take project tools from, `node_modules` and `.venv`, that hold files git tracks, while
 * format-on-edit or the stop check runs tools (#37, #38): a repository that commits its own ruff or prettier there has
 * the hooks run that one, not one the user installed. Empty while no hook runs tools, and when git gives no answer.
 */
export function shippedToolFolders(run: InitRun, planned: ToolPlan): string[] {
  if (toolHooks(planned, run.brand).length === 0) return [];
  return [...(run.session.context.trackedFolders(run.rootReal, TOOL_FOLDERS) ?? [])];
}

// The value the config on disk gives an option of a module whose hook runs once init is done. This run's answers, such
// as a yes to the stop check, are not on disk yet.
function onDisk(planned: Planned, module: string, option: string, brand: Brand): unknown {
  return hookRuns(planned, module, brand) ? planned.existing?.config.options[module]?.[option] : undefined;
}

/**
 * Warnings for what the kit's hooks would run without asking that the user never chose (#37, #38, ADR-0015): the
 * commands the config already on disk sets, the stop check's `checks.stop` before Claude stops and format-on-edit's
 * `commands` after each edit, while the module is selected or the previous lock still owns its hook, and the tools a
 * repository ships in the folders {@link shippedToolFolders} names. init records no `commands`, and a `checks.stop`
 * this run sets is not on disk yet, so whoever wrote the config set each of these, such as the author of a repository
 * the user cloned.
 */
export function configCommandWarnings(planned: Planned, brand: Brand): string[] {
  const config = configPath(brand);
  const stop = onDisk(planned, 'stop-check', 'checks.stop', brand);
  const extra = onDisk(planned, 'format-on-edit', 'commands', brand);
  const commands = isCommandList(extra) ? extra : [];
  const warnings: string[] = [];
  if (isStringList(stop) && stop.length > 0) {
    warnings.push(
      `checks.stop in ${config} runs ${shown(stop)} before Claude stops, without asking; remove it unless you trust whoever wrote it`,
    );
  }
  if (commands.length > 0) {
    warnings.push(
      `commands in ${config} run ${commands.map(shown).join(', ')} after each edit Claude makes, without asking; remove them unless you trust whoever wrote them`,
    );
  }
  const hooks = planned.shipped.length === 0 ? [] : toolHooks(planned, brand);
  if (hooks.length > 0) {
    const folders = planned.shipped.map((folder) => `${folder}/`).join(' and ');
    warnings.push(
      `git tracks files in ${folders}, so ${hooks.join(' and ')} would run tools this repository ships rather than ones you installed, without asking; delete those files and install your own unless you trust whoever committed them`,
    );
  }
  return warnings;
}

/**
 * Asks whether to go on when the hooks would run commands or tools the user never chose (see
 * {@link configCommandWarnings}), defaulting to no; the plan has warned already, and only a terminal asks, as for
 * guards the config leaves out.
 */
export async function goOnWithCommands(asking: Asking, warnings: readonly string[]): Promise<boolean> {
  if (warnings.length === 0 || !asking.interactive) return true;
  return (await asking.prompter.confirm('Continue, letting the hooks run these commands?', false)) === true;
}
