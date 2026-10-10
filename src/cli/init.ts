import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { configPath } from '../core/config.js';
import { detectStack } from '../core/detect.js';
import { type ProblemReport, UsageError } from '../core/errors.js';
import { withoutImportedBlocks, withoutRefusedImports } from '../core/import-blocks.js';
import { resolveOptions } from '../core/options.js';
import { summarizePlan } from '../core/plan-summary.js';
import { projectValues } from '../core/project-values.js';
import { render, type RenderTree } from '../core/render.js';
import { resolveModules } from '../core/resolve.js';
import type { StackProfile } from '../core/stack-profile.js';
import { escapeUnprintable, quoted } from '../core/text.js';
import type { CliContext, CommandSetup, Session } from './context.js';
import {
  checkInitFlags,
  choosePreset,
  confirmApply,
  goOnWithoutGit,
  goOnWithoutGuards,
  guardsLeftOut,
  moduleChanges,
  presetLine,
  stackFlag,
} from './init-answers.js';
import { type ExistingConfig, nextConfig, readExistingConfig, withConfig } from './init-config.js';
import { applyPlanned, finishDryRun } from './init-finish.js';
import { detectedLines, planLines, reporterFor } from './init-report.js';
import { type InitFlags, type InitRun, type Planned, textAt, writesAnything } from './init-run.js';
import { planProject } from './install.js';
import { lstatOrUndefined } from './project-files.js';
import { projectView } from './project-view.js';

// Only a missing path, or one through a file, is not a folder; any other failure, such as EACCES, is thrown.
function isFolder(absolute: string): boolean {
  try {
    return statSync(absolute).isDirectory();
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

// CLAUDE.md in the home folder or a file system root loads in every project below it, and the settings later
// modules write would merge into the user's own ~/.claude/settings.json.
function sharedRootProblem(rootReal: string, home: string): string | undefined {
  if (rootReal === path.parse(rootReal).root) return 'is a file system root, above every project';
  const homeReal = isFolder(home) ? realpathSync.native(home) : undefined;
  return rootReal === homeReal ? 'is your home folder, above every project of yours' : undefined;
}

function refuseRoot(root: string, problem: string): never {
  const hint = 'pass --cwd an existing project folder, or run init inside one';
  throw new UsageError({ file: quoted(root), location: '', problem, hint });
}

function projectRoot(context: CliContext, cwd: string | undefined): [root: string, rootReal: string] {
  const root = path.resolve(context.cwd, cwd ?? '.');
  if (!isFolder(root)) refuseRoot(root, 'is not a folder');
  const rootReal = realpathSync.native(root);
  const problem = sharedRootProblem(rootReal, context.home);
  if (problem !== undefined) refuseRoot(root, problem);
  return [root, rootReal];
}

function startRun(session: Session, flags: InitFlags): InitRun {
  const { context, info, catalog } = session;
  const globals = session.flags();
  checkInitFlags(flags, catalog);
  const [root, rootReal] = projectRoot(context, globals.cwd);
  const [json, yes] = [globals.json === true, globals.yes === true];
  const report = reporterFor(context.output, json);
  const interactive = context.interactive && !yes && !json;
  return {
    session,
    flags,
    root,
    rootReal,
    brand: context.brand,
    kit: { name: context.brand.npmName, version: info.version },
    asking: { interactive, yes, json, prompter: context.prompter, report },
    json,
  };
}

// A memory file such as .claude/CLAUDE.md is read only in a real folder: one linked elsewhere, as in a dotfiles
// setup, is never read through, and the kit then keeps its own import block.
function memoryText(rootReal: string, file: string): string | undefined {
  const folder = path.dirname(path.join(rootReal, ...file.split('/')));
  if (folder !== rootReal && lstatOrUndefined(folder)?.isDirectory() !== true) return undefined;
  return textAt(rootReal, file);
}

// Claude Code follows a link, so AGENTS.md linked to a private file elsewhere would load it in every session; render
// refuses an outside @ import in a value the same way. A link whose target cannot be resolved counts as outside.
function resolvesOutside(rootReal: string, target: string): boolean {
  const absolute = path.join(rootReal, ...target.split('/'));
  if (lstatOrUndefined(absolute) === undefined) return false;
  try {
    const relative = path.relative(rootReal, realpathSync.native(absolute));
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  } catch {
    return true;
  }
}

// The kit's import blocks, left out where the user's own memory files already make the import or where the
// imported file resolves outside the project.
function treeToWrite(run: InitRun, rendered: RenderTree): RenderTree {
  const read = (file: string): string | undefined => memoryText(run.rootReal, file);
  const imported = withoutImportedBlocks(rendered, read, run.brand);
  const { tree, refused } = withoutRefusedImports(imported, (target) =>
    resolvesOutside(run.rootReal, target),
  );
  for (const { file, target } of refused) {
    run.asking.report.warn(
      `${file}: the kit leaves out its @${target} import, since ${target} resolves outside the project ` +
        `(make ${target} a regular file in the project to have it imported)`,
    );
  }
  return tree;
}

function warnAll(run: InitRun, reports: readonly ProblemReport[]): void {
  for (const { file, location, problem, hint } of reports) {
    run.asking.report.warn(`${file}: ${location === '' ? '' : `${location}: `}${problem} (${hint})`);
  }
}

function planInit(
  run: InitRun,
  profile: StackProfile,
  existing: ExistingConfig | undefined,
  preset: string,
): Planned {
  const { catalog } = run.session;
  const stackGiven = stackFlag(run.flags.stack);
  const changes = moduleChanges(run.flags.modules, existing?.config, catalog);
  const answers = { preset, ...changes, ...(stackGiven === undefined ? {} : { stack: stackGiven }) };
  const next = nextConfig(existing, answers, run.kit.version, run.brand);
  const stack = next.config.stack ?? profile.stack;
  const { options, warnings } = resolveOptions(next.config, catalog, run.brand);
  warnAll(run, [...next.warnings, ...warnings]);
  const { add, remove } = next.config.modules;
  const { modules: kits } = resolveModules({ preset, stack, add, remove, options }, catalog, run.brand);
  const rendered = render(kits, { stack, options, values: projectValues(profile, stack) }, run.brand);
  const tree = treeToWrite(run, rendered);
  const modules = kits.map((kit) => kit.manifest.id);
  const installPlan = planProject(run.rootReal, tree, { kit: run.kit, modules, brand: run.brand });
  const plan = withConfig(installPlan, next, existing, run.brand);
  const writes = writesAnything(run.rootReal, plan, run.brand);
  return { profile, existing, next, stack, modules, tree, plan, writes };
}

function showPlan(run: InitRun, planned: Planned): void {
  const { say, paint } = run.asking.report;
  say(presetLine(planned.next.config.preset));
  say(`Stack: ${planned.stack.join(', ') || 'none'}`);
  say(`Modules: ${planned.modules.join(', ')}`);
  say();
  say(paint('bold', 'Plan:'));
  for (const line of planLines(summarizePlan(planned.plan), paint)) say(line);
  const state = [
    ...(planned.next.changed ? [configPath(run.brand)] : []),
    ...(planned.writes ? ['the lock and base blobs'] : []),
  ];
  if (state.length > 0) say(`  and ${escapeUnprintable(state.join(', '))}`);
  const guards = guardsLeftOut(planned.next.config);
  if (guards.length > 0) {
    run.asking.report.warn(
      `modules.remove in ${configPath(run.brand)} leaves out ${guards.join(', ')}, so the guards against ` +
        'dangerous commands and leaked secrets are off for everyone who runs init with this config',
    );
  }
}

function cancelled(run: InitRun): number {
  run.asking.report.say('Cancelled. Nothing was written.');
  return 1;
}

// Step 1 of #27: the detected stack, with a warning for each file detection could not read.
function detect(run: InitRun): StackProfile {
  const { say, paint } = run.asking.report;
  say(paint('bold', `${run.brand.displayName} init in ${escapeUnprintable(run.root)}`));
  const profile = detectStack(projectView(run.rootReal));
  for (const line of detectedLines(profile)) say(escapeUnprintable(line));
  warnAll(run, profile.warnings);
  return profile;
}

// Only a plan that writes asks: about guards the config leaves out, a folder git cannot undo, then for the yes.
async function goAhead(run: InitRun, planned: Planned): Promise<boolean> {
  if (!(await goOnWithoutGuards(run.asking, guardsLeftOut(planned.next.config)))) return false;
  const git = run.session.context.gitState(run.rootReal);
  return (await goOnWithoutGit(run.asking, git, run.root)) && confirmApply(run.asking);
}

async function runInit(run: InitRun): Promise<number> {
  const { asking, session } = run;
  const profile = detect(run);
  const existing = readExistingConfig(run.rootReal, run.brand);
  if (existing !== undefined) {
    asking.report.say(`Using ${escapeUnprintable(configPath(run.brand))}, as update would.`);
  }
  const preset = await choosePreset(asking, session.catalog, {
    flag: run.flags.preset,
    configured: existing?.config.preset,
  });
  if (preset === undefined) return cancelled(run);
  const planned = planInit(run, profile, existing, preset);
  showPlan(run, planned);
  if (run.flags.dryRun === true) return finishDryRun(run, planned);
  if (planned.writes && !(await goAhead(run, planned))) return cancelled(run);
  return applyPlanned(run, planned);
}

/** `init` (#27): detect the stack, show the plan, ask, then write it; scripted with flags, --yes or no terminal. */
export const setupInit: CommandSetup = (command, session) => {
  const { catalog } = session;
  const presets = catalog.presets.map((preset) => preset.name).join(', ');
  command
    .option('--preset <name>', `The preset: ${presets} (default ${catalog.defaultPreset})`)
    .option('--modules <list>', 'Modules to add or leave out, such as +knowledge,-format-on-edit')
    .option('--stack <list>', 'The stack, kept in the config: ts, python, ts,python or none')
    .option('--dry-run', 'Print the plan and a unified diff, and write nothing')
    .action(async (flags: InitFlags) => {
      session.finish(await runInit(startRun(session, flags)));
    });
};
