import { configPath } from '../core/config.js';
import { pendingSidecars, summarizePlan } from '../core/plan-summary.js';
import { escapeUnprintable } from '../core/text.js';
import { unifiedDiff } from '../core/unified-diff.js';
import type { ApplyResult } from './apply.js';
import { diffLines, nextStepLines, sidecarLines } from './init-report.js';
import { type InitRun, type Planned, textAt } from './init-run.js';
import { install } from './install.js';

/** Prints the run as one JSON line for --json: the answers, the detected stack, the plan and what applying did. */
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
    sidecars: pendingSidecars(planned.plan, run.brand),
    applied,
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
    for (const line of nextStepLines(sidecars, [...planned.tree.keys()], run.brand)) say(line);
  } else if (sidecars.length > 0) {
    say('Nothing to change, but sidecars still wait for review:');
    for (const line of sidecarLines(sidecars, run.brand)) say(line);
  } else {
    say('Nothing to change: the project already matches the plan.');
  }
  const exitCode = sidecars.length > 0 ? 2 : 0;
  printJson(run, planned, applied, exitCode);
  return exitCode;
}
