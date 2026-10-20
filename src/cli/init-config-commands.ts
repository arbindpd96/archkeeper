import type { Brand } from '../core/brand.js';
import { configPath } from '../core/config.js';
import { isCommandList, isStringList, quoted } from '../core/text.js';
import type { Asking } from './init-answers.js';
import type { Planned } from './init-run.js';

const shown = (command: readonly string[]): string => quoted(command.join(' '));

// The value the config on disk gives an option of a module whose hook runs: one selected in this run, or one left out
// whose bundle the previous lock still owns, since init removes nothing it installed. This run's answers, such as a
// yes to the stop check, are not on disk yet.
function onDisk(planned: Planned, module: string, option: string, brand: Brand): unknown {
  const runs =
    planned.modules.includes(module) || planned.hooksKept.includes(`${brand.hookDir}/${module}.mjs`);
  return runs ? planned.existing?.config.options[module]?.[option] : undefined;
}

/**
 * Warnings for the commands the config already on disk has the kit's hooks run without asking (#37, #38,
 * ADR-0015): the stop check's `checks.stop` before Claude stops, and format-on-edit's `commands` after each edit,
 * while the module is selected or the previous lock still owns its hook. init records no `commands`, and a
 * `checks.stop` this run sets is not on disk yet, so whoever wrote the config set each of these, such as the author
 * of a repository the user cloned.
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
  return warnings;
}

/**
 * Asks whether to go on when the config has the hooks run commands of its own (see {@link configCommandWarnings}),
 * defaulting to no; the plan has warned already, and only a terminal asks, as for guards the config leaves out.
 */
export async function goOnWithCommands(asking: Asking, warnings: readonly string[]): Promise<boolean> {
  if (warnings.length === 0 || !asking.interactive) return true;
  return (await asking.prompter.confirm('Continue, letting the hooks run these commands?', false)) === true;
}
