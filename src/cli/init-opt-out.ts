import type { Brand } from '../core/brand.js';
import { configPath } from '../core/config.js';
import type { ProblemReport } from '../core/errors.js';
import type { KitModule } from '../core/loader.js';
import type { Lock } from '../core/lock.js';
import { SETTINGS_FILE } from '../core/manifest-schema.js';
import { type OptedOut, optedOutEntries, optOutNames, OPT_OUT, unknownOptOuts } from '../core/opt-out.js';
import { moduleOptions, type ResolvedOptions } from '../core/options.js';
import type { PlanOp } from '../core/plan-types.js';
import { quoted } from '../core/text.js';

/** One optOut entry of a selected module, with what it leaves out. */
export interface ModuleOptOut extends OptedOut {
  readonly module: string;
}

/** Every known optOut entry of the selected modules, with the settings keys and hook scripts it leaves out. */
export function optOutsOf(
  kits: readonly KitModule[],
  options: ResolvedOptions,
  brand: Brand,
): ModuleOptOut[] {
  return kits.flatMap(({ manifest }) =>
    optedOutEntries(manifest, moduleOptions(options, manifest), brand).map((entry) => ({
      module: manifest.id,
      ...entry,
    })),
  );
}

/** A warning for each optOut entry that names none of its module's deny rules or guards, such as a typo. */
export function unknownOptOutReports(
  kits: readonly KitModule[],
  options: ResolvedOptions,
  brand: Brand,
): ProblemReport[] {
  return kits.flatMap(({ manifest }) =>
    unknownOptOuts(manifest, moduleOptions(options, manifest)).map((entry) => ({
      file: configPath(brand),
      location: `options.${manifest.id}.${OPT_OUT}`,
      problem: `${quoted(entry)} names none of this module's rules or guards, so it leaves nothing out`,
      hint: `use one of: ${optOutNames(manifest).join(', ')}`,
    })),
  );
}

// Once an apply put the entry in effect, the lock lists the module and the plan removes nothing the entry leaves
// out: what is left is gone, or kept because the user changed it, which the kit no longer touches.
function isRecorded(entry: ModuleOptOut, lock: Lock | undefined, ops: readonly PlanOp[]): boolean {
  if (lock?.modules.includes(entry.module) !== true) return false;
  return !ops.some(
    (op) =>
      op.kind === 'delete' &&
      (op.entry === undefined
        ? entry.scripts.includes(op.path)
        : op.path === SETTINGS_FILE && entry.keys.includes(op.entry)),
  );
}

/**
 * The optOut entries the lock does not record yet, as `<module>: <entry>`. init warns about these the first time it
 * meets them (#33): warning on every run would undo ADR-0014's "optOut silences the warning".
 */
export function unrecordedOptOuts(
  entries: readonly ModuleOptOut[],
  lock: Lock | undefined,
  ops: readonly PlanOp[],
): string[] {
  return entries
    .filter((entry) => !isRecorded(entry, lock, ops))
    .map((entry) => `${entry.module}: ${entry.name}`);
}
