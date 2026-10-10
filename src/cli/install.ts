import { readdirSync, realpathSync } from 'node:fs';
import { BRAND, type Brand } from '../core/brand.js';
import { LockError } from '../core/errors.js';
import { HASH } from '../core/hash.js';
import { type KitId, type Lock, lockFilePath, type LockRead, readLock } from '../core/lock.js';
import { rebuildLock } from '../core/lock-rebuild.js';
import { type Plan, planInstall, snapshotPaths } from '../core/plan.js';
import type { Ownable } from '../core/plan-types.js';
import type { RenderTree } from '../core/render-tree.js';
import { type ApplyResult, applyPlan } from './apply.js';
import { assertRealStateFolders } from './backup.js';
import { baseFolder } from './blob-store.js';
import { confinedPath, lstatOrUndefined, readConfined, readSnapshot } from './project-files.js';

/** What an install depends on besides the project and the rendered tree. */
export interface InstallOptions {
  readonly kit: KitId;
  readonly modules: readonly string[];
  readonly brand?: Brand;
  readonly ownable?: Ownable;
}

/** A plan made against a project, and what applying it did. */
export interface InstallResult {
  readonly plan: Plan;
  readonly applied: ApplyResult;
}

function readProjectLock(rootReal: string, kit: KitId, brand: Brand): LockRead | undefined {
  const relative = lockFilePath(brand);
  const state = readConfined(rootReal, relative, 'the kit lock');
  if (state === undefined) return undefined;
  if (state.kind !== 'file') {
    throw new LockError({
      file: relative,
      location: '',
      problem: 'is not a regular text file, so the kit does not read it',
      hint: 'replace it with the lock.json from git',
    });
  }
  return readLock(state.content, kit, brand);
}

function blobNames(rootReal: string, brand: Brand): Set<string> {
  const folder = confinedPath(rootReal, baseFolder(brand), 'the kit base folder');
  if (lstatOrUndefined(folder)?.isDirectory() !== true) return new Set();
  return new Set(readdirSync(folder).filter((name) => HASH.test(name)));
}

/**
 * Plans an install against the project at `root` without writing anything: reads the lock (rebuilding one that
 * a git merge left with conflict markers), takes a snapshot of every path the plan needs, and plans (#21).
 */
export function planProject(root: string, tree: RenderTree, options: InstallOptions): Plan {
  const brand = options.brand ?? BRAND;
  const rootReal = realpathSync.native(root);
  assertRealStateFolders(rootReal, brand);
  const read = readProjectLock(rootReal, options.kit, brand);
  const sides: readonly Lock[] = read === undefined ? [] : read.conflicted ? read.sides : [read.lock];
  const snapshot = readSnapshot(rootReal, snapshotPaths(tree, sides, brand));
  const lock =
    read?.conflicted === true
      ? rebuildLock(read.sides, snapshot, blobNames(rootReal, brand), brand)
      : read?.lock;
  return planInstall(tree, snapshot, lock, {
    kit: options.kit,
    modules: options.modules,
    brand,
    ...(options.ownable === undefined ? {} : { ownable: options.ownable }),
  });
}

/** Plans an install against the project at `root` and applies it transactionally (#21–#24). */
export function install(root: string, tree: RenderTree, options: InstallOptions): InstallResult {
  const plan = planProject(root, tree, options);
  return { plan, applied: applyPlan(root, plan, options.brand ?? BRAND) };
}
