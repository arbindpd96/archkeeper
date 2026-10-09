import { BRAND, type Brand } from './brand.js';
import { planBlocks } from './blocks-plan.js';
import { PathSafetyError, RenderError } from './errors.js';
import { planFile } from './file-plan.js';
import { contentHash } from './hash.js';
import { planJson } from './json-plan.js';
import {
  type BlockEntry,
  emptyLock,
  type FileEntry,
  type KitId,
  type Lock,
  type Removal,
  serializeLock,
} from './lock.js';
import { assertSafePath } from './path-safety.js';
import { foldedPath } from './paths.js';
import type { Ownable, PathOutcome, PlanOp, Snapshot } from './plan-types.js';
import type { RenderedEntry, RenderTree, Strategy } from './render-tree.js';
import { sidecarPath } from './sidecar.js';
import { compareText } from './text.js';

/** What a plan depends on besides the tree, the snapshot and the lock. */
export interface PlanContext {
  /** The running kit, recorded in the lock. */
  readonly kit: KitId;
  /** The selected modules in install order, recorded in the lock. */
  readonly modules: readonly string[];
  readonly brand?: Brand;
  /**
   * Whether the current kit's manifests could own a path, block or JSON entry the tree no longer renders, so the
   * plan may delete it (ADR-0014: the lock is untrusted). By default nothing outside the tree is deleted.
   */
  readonly ownable?: Ownable;
}

/** A reviewable install plan (#21): the operations, the bytes they write, and the lock to write last. */
export interface Plan {
  readonly ops: readonly PlanOp[];
  /** The new content of each path the plan writes, sidecars included; null deletes the path. */
  readonly writes: ReadonlyMap<string, string | null>;
  readonly lock: Lock;
  readonly lockText: string;
  /** The LF content of every base and pending blob the new lock references and this run can provide, by hash. */
  readonly blobs: ReadonlyMap<string, string>;
}

/** The kit's own `.gitattributes` block, which marks the base blobs as binary and generated (ADR-0014). */
export const STATE_BLOCK = 'base-blobs';
const GITATTRIBUTES_FILE = '.gitattributes';

function stateBlock(brand: Brand): RenderedEntry {
  const content = `${brand.stateDir}/base/** binary linguist-generated\n`;
  return { strategy: 'blocks', module: brand.binName, blockId: STATE_BLOCK, content };
}

/** The tree plus the kit's own `.gitattributes` block; a module may not write that file another way or that block. */
export function withStateBlock(tree: RenderTree, brand: Brand = BRAND): RenderTree {
  const existing = tree.get(GITATTRIBUTES_FILE) ?? [];
  const clash = existing.find((entry) => entry.strategy !== 'blocks' || entry.blockId === STATE_BLOCK);
  if (clash !== undefined) {
    throw new RenderError({
      file: GITATTRIBUTES_FILE,
      location: '',
      problem: `gets ${clash.blockId === STATE_BLOCK ? `block "${STATE_BLOCK}"` : `a ${clash.strategy} file`} from ${clash.module}, which the kit keeps for itself`,
      hint: `write ${GITATTRIBUTES_FILE} as a blocks file with another block id`,
    });
  }
  const files = new Map(tree).set(GITATTRIBUTES_FILE, [...existing, stateBlock(brand)]);
  return new Map([...files].sort(([left], [right]) => compareText(left, right)));
}

function lockPaths(lock: Lock): string[] {
  return [...lock.files.keys(), ...lock.blocks.keys(), ...lock.json.keys()];
}

/** Every path a plan reads: the tree's paths and the locks' paths, each with its sidecar, in sorted order. */
export function snapshotPaths(tree: RenderTree, locks: readonly Lock[], brand: Brand = BRAND): string[] {
  const paths = new Set([...withStateBlock(tree, brand).keys(), ...locks.flatMap(lockPaths)]);
  return [...paths].sort(compareText).flatMap((path) => [path, sidecarPath(path, brand)]);
}

function removalKey(path: string, blockId = '', key = ''): string {
  return JSON.stringify([path, blockId, key]);
}

interface Planning {
  readonly tree: RenderTree;
  readonly snapshot: Snapshot;
  readonly lock: Lock;
  readonly brand: Brand;
  readonly ownable: Ownable;
  readonly removed: ReadonlySet<string>;
  /** Whether the next lock gives a hook script a base, known once the owned files are planned. */
  readonly kitScript: (path: string) => boolean;
}

// The lock is untrusted, so a lock entry may not name the kit's own state, such as the lock or a blob.
function assertPlannable(path: string, rendered: boolean, brand: Brand): void {
  assertSafePath(path, rendered ? 'rendered by the kit' : 'listed in the lock');
  const state = foldedPath(brand.stateDir);
  const folded = foldedPath(path);
  if (rendered || (folded !== state && !folded.startsWith(`${state}/`))) return;
  throw new PathSafetyError({
    file: JSON.stringify(path),
    location: 'listed in the lock',
    problem: `is refused: it is inside ${brand.stateDir}, which only the kit manages`,
    hint: 'restore lock.json from git; no lock entry names the kit state folder',
  });
}

function strategyOf({ tree, lock }: Planning, path: string): Strategy {
  return (
    tree.get(path)?.[0]?.strategy ??
    lock.files.get(path)?.strategy ??
    (lock.blocks.has(path) ? 'blocks' : 'json')
  );
}

function planPath(input: Planning, path: string): PathOutcome {
  const { tree, snapshot, lock, brand, ownable, removed } = input;
  assertPlannable(path, tree.has(path), brand);
  const entries = tree.get(path) ?? [];
  const strategy = strategyOf(input, path);
  const state = snapshot.get(path);
  const sidecar = snapshot.get(sidecarPath(path, brand));
  if (strategy === 'blocks') {
    const isRemoved = (blockId: string): boolean => removed.has(removalKey(path, blockId));
    return planBlocks({
      path,
      entries,
      state,
      sidecar,
      lock: lock.blocks.get(path),
      isRemoved,
      ownable,
      brand,
    });
  }
  if (strategy === 'json') {
    const isRemoved = (key: string): boolean => removed.has(removalKey(path, '', key));
    const json = { path, entries, state, sidecar, lock: lock.json.get(path), isRemoved, ownable, brand };
    return planJson({ ...json, kitScript: input.kitScript });
  }
  const job = { path, entry: entries[0], state, sidecar, lock: lock.files.get(path), brand };
  return planFile({ ...job, removed: removed.has(removalKey(path)), ownable: ownable(path) });
}

// JSON files go last: a hook is registered only when its script has a base, which planning the script decides.
function planPaths(input: Planning, paths: readonly string[]): [string, PathOutcome][] {
  const files = paths.filter((path) => strategyOf(input, path) !== 'json');
  const planned = new Map(files.map((path) => [path, planPath(input, path)]));
  const kitScript = (path: string): boolean => (planned.get(path)?.file?.base ?? null) !== null;
  for (const path of paths) {
    if (!planned.has(path)) planned.set(path, planPath({ ...input, kitScript }, path));
  }
  return paths.map((path) => [path, planned.get(path) ?? { ops: [], removed: [] }]);
}

function uniqueRemovals(removals: readonly Removal[]): Removal[] {
  const seen = new Map(
    removals.map((removal) => [removalKey(removal.path, removal.blockId, removal.key), removal]),
  );
  return [...seen.values()];
}

// Owned files and blocks keep a blob of each base and pending; create-only files and JSON entries keep none.
function blobContents(tree: RenderTree, lock: Lock): Map<string, string> {
  const kit = new Map<string, string>();
  for (const entries of tree.values()) {
    for (const { strategy, content } of entries) {
      if (strategy === 'owned' || strategy === 'blocks') kit.set(contentHash(content), content);
    }
  }
  const owned = [...lock.files.values()].filter((entry) => entry.strategy === 'owned');
  const entries: readonly (FileEntry | BlockEntry)[] = [
    ...owned,
    ...[...lock.blocks.values()].flatMap((blocks) => [...blocks.values()]),
  ];
  const referenced = entries.flatMap(({ base, pending }) => [base ?? '', pending ?? '']);
  return new Map(referenced.flatMap((hash) => (kit.has(hash) ? [[hash, kit.get(hash) ?? '']] : [])));
}

function assemble(
  outcomes: readonly [string, PathOutcome][],
  previous: Lock,
  context: PlanContext,
  brand: Brand,
): Omit<Plan, 'blobs'> {
  const writes = new Map<string, string | null>();
  const files = new Map<string, FileEntry>();
  const blocks = new Map<string, ReadonlyMap<string, BlockEntry>>();
  const json = new Map<string, ReadonlyMap<string, string>>();
  const removed = [...previous.removed];
  for (const [path, outcome] of outcomes) {
    if (outcome.content !== undefined) writes.set(path, outcome.content);
    if (outcome.sidecar !== undefined) writes.set(sidecarPath(path, brand), outcome.sidecar);
    if (outcome.file !== undefined) files.set(path, outcome.file);
    if (outcome.blocks !== undefined && outcome.blocks.size > 0) blocks.set(path, outcome.blocks);
    if (outcome.json !== undefined && outcome.json.size > 0) json.set(path, outcome.json);
    removed.push(...outcome.removed);
  }
  const lock: Lock = {
    lockfileVersion: 1,
    kit: context.kit,
    modules: context.modules,
    files,
    blocks,
    json,
    removed: uniqueRemovals(removed),
  };
  return { ops: outcomes.flatMap(([, outcome]) => outcome.ops), writes, lock, lockText: serializeLock(lock) };
}

/**
 * Plans an install without any IO (#21, ADR-0014): turns the rendered tree, a snapshot of the project and the lock
 * into ordered operations, each with a reason, plus the bytes to write and the lock to write last. Every path,
 * including each one the untrusted lock names, passes the path-safety checks. Planning against the state the
 * previous apply left yields only `skip` operations, so a second run writes nothing.
 */
export function planInstall(
  tree: RenderTree,
  snapshot: Snapshot,
  lock: Lock | undefined,
  context: PlanContext,
): Plan {
  const brand = context.brand ?? BRAND;
  const full = withStateBlock(tree, brand);
  const previous = lock ?? emptyLock(context.kit);
  const removed = new Set(
    previous.removed.map((removal) => removalKey(removal.path, removal.blockId, removal.key)),
  );
  const input: Planning = {
    tree: full,
    snapshot,
    lock: previous,
    brand,
    ownable: context.ownable ?? (() => false),
    kitScript: () => false,
    removed,
  };
  const paths = [...new Set([...full.keys(), ...lockPaths(previous)])].sort(compareText);
  const plan = assemble(planPaths(input, paths), previous, context, brand);
  return { ...plan, blobs: blobContents(full, plan.lock) };
}
