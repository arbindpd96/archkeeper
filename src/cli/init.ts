import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Brand } from '../core/brand.js';
import { configPath } from '../core/config.js';
import { detectStack } from '../core/detect.js';
import { type ProblemReport, UsageError } from '../core/errors.js';
import { withoutImportedBlocks } from '../core/import-blocks.js';
import type { KitId } from '../core/lock.js';
import { resolveOptions } from '../core/options.js';
import type { Plan } from '../core/plan.js';
import { summarizePlan } from '../core/plan-summary.js';
import { projectValues } from '../core/project-values.js';
import { render, type RenderTree } from '../core/render.js';
import { resolveModules } from '../core/resolve.js';
import type { Stack } from '../core/schema-parts.js';
import type { StackProfile } from '../core/stack-profile.js';
import { escapeUnprintable, quoted } from '../core/text.js';
import { unifiedDiff } from '../core/unified-diff.js';
import type { ApplyResult } from './apply.js';
import type { CommandSetup, Session } from './context.js';
import {
  type Asking,
  checkInitFlags,
  choosePreset,
  confirmApply,
  goOnWithoutGit,
  moduleChanges,
  presetLine,
  stackFlag,
} from './init-answers.js';
import {
  type ExistingConfig,
  type NextConfig,
  nextConfig,
  readExistingConfig,
  writeConfig,
} from './init-config.js';
import { detectedLines, diffLines, nextStepLines, planLines, reporterFor } from './init-report.js';
import { install, planProject } from './install.js';
import { readConfined } from './project-files.js';
import { projectView } from './project-view.js';

/** The flags of `init` itself (#27); the global ones come from the session. */
interface InitFlags {
  readonly preset?: string;
  readonly modules?: string;
  readonly stack?: string;
  readonly dryRun?: boolean;
}

interface InitRun {
  readonly session: Session;
  readonly flags: InitFlags;
  readonly root: string;
  readonly rootReal: string;
  readonly brand: Brand;
  readonly kit: KitId;
  readonly asking: Asking;
  readonly json: boolean;
}

interface Planned {
  readonly profile: StackProfile;
  readonly existing: ExistingConfig | undefined;
  readonly next: NextConfig;
  readonly stack: readonly Stack[];
  readonly modules: readonly string[];
  readonly tree: RenderTree;
  readonly plan: Plan;
}

function isFolder(absolute: string): boolean {
  try {
    return statSync(absolute).isDirectory();
  } catch {
    return false;
  }
}

function startRun(session: Session, flags: InitFlags): InitRun {
  const { context, info, catalog } = session;
  const globals = session.flags();
  checkInitFlags(flags, catalog);
  const root = path.resolve(context.cwd, globals.cwd ?? '.');
  if (!isFolder(root)) {
    const hint = 'pass --cwd an existing project folder, or run init inside one';
    throw new UsageError({ file: quoted(root), location: '', problem: 'is not a folder', hint });
  }
  const [json, yes] = [globals.json === true, globals.yes === true];
  const report = reporterFor(context.output, json);
  const interactive = context.interactive && !yes && !json;
  return {
    session,
    flags,
    root,
    rootReal: realpathSync.native(root),
    brand: context.brand,
    kit: { name: context.brand.npmName, version: info.version },
    asking: { interactive, yes, prompter: context.prompter, report },
    json,
  };
}

function textAt(rootReal: string, file: string): string | undefined {
  const state = readConfined(rootReal, file, 'read for the plan');
  return state?.kind === 'file' ? state.content : undefined;
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
  const { modules: kits } = resolveModules(
    { preset, stack, add: next.config.modules.add, remove: next.config.modules.remove, options },
    catalog,
    run.brand,
  );
  const rendered = render(kits, { stack, options, values: projectValues(profile, stack) }, run.brand);
  const tree = withoutImportedBlocks(rendered, (file) => textAt(run.rootReal, file), run.brand);
  const modules = kits.map((kit) => kit.manifest.id);
  const plan = planProject(run.rootReal, tree, { kit: run.kit, modules, brand: run.brand });
  return { profile, existing, next, stack, modules, tree, plan };
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
    ...(planned.plan.writes.size > 0 ? ['the lock and base blobs'] : []),
  ];
  if (state.length > 0) say(`  and ${escapeUnprintable(state.join(', '))}`);
}

function printJson(run: InitRun, planned: Planned, applied: ApplyResult | null, exitCode: number): void {
  if (!run.json) return;
  const value = {
    command: 'init',
    root: run.root,
    dryRun: run.flags.dryRun === true,
    preset: planned.next.config.preset,
    stack: planned.stack,
    modules: planned.modules,
    detected: planned.profile,
    plan: summarizePlan(planned.plan),
    config: { path: configPath(run.brand), changed: planned.next.changed },
    applied,
    exitCode,
  };
  run.session.context.output.stdout(`${escapeUnprintable(JSON.stringify(value))}\n`);
}

function finishDryRun(run: InitRun, planned: Planned): number {
  const { say, paint } = run.asking.report;
  const config = configPath(run.brand);
  const changes = [...planned.plan.writes].map(
    ([file, text]) => [file, textAt(run.rootReal, file), text ?? undefined] as const,
  );
  const configChange = planned.next.changed
    ? [[config, planned.existing?.text, planned.next.text] as const]
    : [];
  for (const [file, before, after] of [...changes, ...configChange]) {
    const diff = unifiedDiff(file, before, after);
    if (diff === '') continue;
    say();
    for (const line of diffLines(diff, paint)) say(line);
  }
  say();
  say('Dry run: nothing was written.');
  printJson(run, planned, null, 0);
  return 0;
}

function apply(run: InitRun, planned: Planned): number {
  const { say, warn } = run.asking.report;
  const options = { kit: run.kit, modules: planned.modules, brand: run.brand };
  const { applied } = install(run.rootReal, planned.tree, options, planned.plan);
  writeConfig(run.rootReal, planned.next, planned.existing, run.brand);
  for (const warning of applied.warnings) warn(warning);
  const conflicts = planned.plan.ops.filter((op) => op.kind === 'sidecar');
  const exitCode = conflicts.length > 0 ? 2 : 0;
  say();
  if (applied.changed || planned.next.changed) {
    say(
      applied.backup === undefined
        ? 'Done.'
        : `Done. A backup of what changed is in ${escapeUnprintable(applied.backup)}.`,
    );
    say();
    const sidecars = conflicts.map((op) => `${op.path}${run.brand.sidecarSuffix}`);
    for (const line of nextStepLines(sidecars, run.brand)) say(line);
  } else {
    say('Nothing to change: the project already matches the plan.');
  }
  printJson(run, planned, applied, exitCode);
  return exitCode;
}

function cancelled(run: InitRun): number {
  run.asking.report.say('Cancelled. Nothing was written.');
  return 1;
}

// Steps 1 and 2 of #27: show the detected stack, then warn and ask when git cannot undo what init writes.
async function detect(run: InitRun): Promise<StackProfile | undefined> {
  const { say, paint } = run.asking.report;
  say(paint('bold', `${run.brand.displayName} init in ${escapeUnprintable(run.root)}`));
  const profile = detectStack(projectView(run.rootReal));
  for (const line of detectedLines(profile)) say(escapeUnprintable(line));
  warnAll(run, profile.warnings);
  const git = run.flags.dryRun === true ? 'clean' : run.session.context.gitState(run.rootReal);
  return (await goOnWithoutGit(run.asking, git, run.root)) ? profile : undefined;
}

async function runInit(run: InitRun): Promise<number> {
  const { asking, session } = run;
  const profile = await detect(run);
  if (profile === undefined) return cancelled(run);
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
  const writes = planned.plan.writes.size > 0 || planned.next.changed;
  if (writes && !(await confirmApply(asking))) return cancelled(run);
  return apply(run, planned);
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
