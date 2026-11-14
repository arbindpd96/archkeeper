import path from 'node:path';
import type { Brand } from '../core/brand.js';
import { configPath } from '../core/config.js';
import { isCommandList, isStringList, quoted } from '../core/text.js';
import type { Asking } from './init-answers.js';
import { hookRuns, type InitRun, type Planned, type ShippedFolders } from './init-run.js';
import { sandboxSettings } from './init-sandbox.js';
import { lstatOrUndefined } from './project-files.js';

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

// The folders the hooks take project tools from that hold files git tracks, since a repository that commits its own
// ruff or prettier there has the hooks run that one, or, where git gives no answer, as in a copy downloaded without
// .git, those that exist.
function shippedToolFolders(run: InitRun): ShippedFolders {
  const tracked = run.session.context.trackedFolders(run.rootReal, TOOL_FOLDERS);
  if (tracked !== undefined) return { folders: [...tracked], tracked: true };
  const present = TOOL_FOLDERS.filter(
    (folder) => lstatOrUndefined(path.join(run.rootReal, folder)) !== undefined,
  );
  return { folders: present, tracked: false };
}

/**
 * What makes the project tools the hooks run riskier than the user may know, while format-on-edit or the stop check
 * runs tools (#37, #38): the folders `node_modules` and `.venv` that may hold tools the user never installed, and the
 * settings file that turns on Claude Code's sandbox, which hooks run outside of. Neither while no hook runs tools.
 */
export function toolRisks(run: InitRun, planned: ToolPlan): Pick<Planned, 'shipped' | 'sandbox'> {
  if (toolHooks(planned, run.brand).length === 0) {
    return { shipped: { folders: [], tracked: true }, sandbox: undefined };
  }
  return {
    shipped: shippedToolFolders(run),
    sandbox: sandboxSettings(run.rootReal, run.session.context.home),
  };
}

// Who put the tools there: the repository, where git tracks them, or anyone, where git cannot say.
function shippedWarning({ folders, tracked }: ShippedFolders, hooks: readonly string[]): string {
  const named = folders.map((folder) => `${folder}/`).join(' and ');
  const runs = hooks.join(' and ');
  if (tracked) {
    return `git tracks files in ${named}, so ${runs} would run tools this repository ships rather than ones you installed, without asking; delete those files and install your own unless you trust whoever committed them`;
  }
  const them = folders.length === 1 ? 'that folder' : 'those folders';
  return `git cannot say whether you installed the tools in ${named}, so ${runs} would run whatever is there, without asking; delete ${them} and install your own unless you trust where this project came from`;
}

// Claude Code's sandbox wraps shell commands only, and runs command hooks with the user's full access, so what a
// sandboxed command writes for a hook to run, such as a tool's config or a test, leaves the sandbox at the next edit.
function sandboxWarning(settings: string, hooks: readonly string[]): string {
  const them = hooks.length === 1 ? 'it' : 'them';
  return `Claude Code's sandbox is on in ${settings}, but hooks run outside it with your full access, so ${hooks.join(' and ')} would run, unsandboxed, what a sandboxed command writes in this project, such as a tool config, a package in node_modules or a test; leave ${them} out unless you accept that`;
}

// The warnings about the tools the hooks would run: those a repository ships, and, while the sandbox is on, whatever a
// sandboxed command writes.
function toolWarnings(planned: Planned, brand: Brand): string[] {
  const { shipped, sandbox } = planned;
  if (shipped.folders.length === 0 && sandbox === undefined) return [];
  const hooks = toolHooks(planned, brand);
  if (hooks.length === 0) return [];
  return [
    ...(shipped.folders.length > 0 ? [shippedWarning(shipped, hooks)] : []),
    ...(sandbox === undefined ? [] : [sandboxWarning(sandbox, hooks)]),
  ];
}

// The value the config on disk gives an option of a module whose hook runs once init is done. This run's answers, such
// as a yes to the stop check, are not on disk yet.
function onDisk(planned: Planned, module: string, option: string, brand: Brand): unknown {
  return hookRuns(planned, module, brand) ? planned.existing?.config.options[module]?.[option] : undefined;
}

/**
 * Warnings for what the kit's hooks would run without asking that the user never chose (#37, #38, ADR-0015): the
 * commands the config already on disk sets, the stop check's `checks.stop` before Claude stops and format-on-edit's
 * `commands` after each edit, while the module is selected or the previous lock still owns its hook, the tools a
 * repository ships in the folders {@link toolRisks} names, and, while Claude Code's sandbox is on, whatever a sandboxed
 * command writes for the hooks to run outside it. init records no `commands`, and a `checks.stop` this run sets is not
 * on disk yet, so whoever wrote the config set each of these, such as the author of a repository the user cloned.
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
  return [...warnings, ...toolWarnings(planned, brand)];
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
