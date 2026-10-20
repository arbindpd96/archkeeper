import { configPath } from '../core/config.js';
import { pendingSidecars, summarizePlan } from '../core/plan-summary.js';
import { escapeUnprintable } from '../core/text.js';
import { unifiedDiff } from '../core/unified-diff.js';
import type { ApplyResult } from './apply.js';
import { composeSteps } from './init-compose.js';
import { diffLines, nextStepLines, nextSteps, numberedSteps, sidecarLines } from './init-report.js';
import { type InitRun, type Planned, textAt } from './init-run.js';
import { stopCheckSteps } from './init-stop-check.js';
import { install } from './install.js';

// The steps after the usual ones: the stop check's, then each chosen tool's install commands and warning.
function moreSteps(run: InitRun, planned: Planned): string[] {
  return [...stopCheckSteps(planned, run.brand), ...composeSteps(planned, run.session.catalog.compose)];
}

// The install commands and warning --with asked for in this run, which a run that changes nothing still prints,
// since nothing records whether the user ran them (#39).
function chosenSteps(run: InitRun, planned: Planned): string[] {
  return run.flags.with === undefined ? [] : composeSteps(planned, run.session.catalog.compose);
}

// The steps the run printed: the Next steps of an apply that changed something, else what --with chose.
function printedSteps(run: InitRun, planned: Planned, applied: ApplyResult | null): string[] {
  if (applied === null) return [];
  return applied.changed
    ? nextSteps([...planned.tree.keys()], moreSteps(run, planned))
    : chosenSteps(run, planned);
}

/**
 * Prints the run as one JSON line for --json: the answers, the modules and those left out with why, the detected
 * stack, the plan, what applying did and the steps it printed: the Next steps, or, when it changed nothing, only the
 * commands `--with` asked for.
 */
function printJson(run: InitRun, planned: Planned, applied: ApplyResult | null, exitCode: number): void {
  if (!run.json) return;
  const value = {
    command: 'init',
    root: run.root,
    dryRun: run.flags.dryRun === true,
    preset: planned.next.config.preset,
    stack: planned.stack,
    modules: planned.modules,
    dropped: planned.dropped,
    compose: planned.next.config.compose,
    detected: planned.profile,
    plan: summarizePlan(planned.plan),
    config: { path: configPath(run.brand), changed: planned.next.changed },
    sidecars: pendingSidecars(planned.plan, run.brand),
    applied,
    nextSteps: printedSteps(run, planned, applied),
    exitCode,
  };
  run.session.context.output.stdout(`${escapeUnprintable(JSON.stringify(value))}\n`);
}

/** `--dry-run` (#27): a unified diff of every file the plan writes, the config included, and nothing written. */
export function finishDryRun(run: InitRun, planned: Planned): number {
  const { say, paint } = run.asking.report;
  for (const [file, text] of planned.plan.writes) {
    const diff = unifiedDiff(file, textAt(run.rootReal, file), text ?? undefined);
    if (diff === '') continue;
    say();
    for (const line of diffLines(diff, paint)) say(line);
  }
  say();
  say('Dry run: nothing was written.');
  printJson(run, planned, null, 0);
  return 0;
}

// A run that changed nothing says so, lists the sidecars still waiting for review, and prints what --with chose.
function sayUnchanged(run: InitRun, planned: Planned, sidecars: readonly string[]): void {
  const { say } = run.asking.report;
  if (sidecars.length > 0) {
    say('Nothing to change, but sidecars still wait for review:');
    for (const line of sidecarLines(sidecars, run.brand)) say(line);
  } else {
    say('Nothing to change: the project already matches the plan.');
  }
  const chosen = chosenSteps(run, planned);
  if (chosen.length === 0) return;
  say('To add what --with chose:');
  for (const line of numberedSteps(chosen)) say(line);
}

/**
 * Applies the plan init showed through `install`, which refuses it when a file, the lock or the config changed
 * since (#27), then reports: exit 2 while any sidecar waits for review, from this run or an earlier one.
 */
export function applyPlanned(run: InitRun, planned: Planned): number {
  const { say, warn } = run.asking.report;
  const options = { kit: run.kit, modules: planned.modules, brand: run.brand };
  const { applied } = install(run.rootReal, planned.tree, options, planned.plan);
  for (const warning of applied.warnings) warn(warning);
  const sidecars = pendingSidecars(planned.plan, run.brand);
  say();
  if (applied.changed) {
    const backup = applied.backup === undefined ? '' : ` A backup of what changed is in ${applied.backup}.`;
    say(escapeUnprintable(`Done.${backup}`));
    say();
    const files = [...planned.tree.keys()];
    for (const line of nextStepLines(sidecars, files, run.brand, moreSteps(run, planned))) say(line);
  } else {
    sayUnchanged(run, planned, sidecars);
  }
  const exitCode = sidecars.length > 0 ? 2 : 0;
  printJson(run, planned, applied, exitCode);
  return exitCode;
}
