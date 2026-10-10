import type { Brand } from './brand.js';
import { type BlockEdits, editBlocks } from './blocks-edit.js';
import { blockParts, type BlocksFile, emptyBlocks, parseBlocks } from './blocks-file.js';
import { planUnwritableBlocks } from './blocks-unwritable.js';
import { MergeError } from './errors.js';
import { contentHash } from './hash.js';
import type { BlockEntry, Removal } from './lock.js';
import type { OpKind, Ownable, PathOutcome, PathState, PlanOp } from './plan-types.js';
import type { RenderedEntry } from './render-tree.js';
import { sidecarAction, sidecarPath } from './sidecar.js';
import { toLf } from './text.js';

/** Everything the planner knows about one blocks path. */
export interface BlocksJob {
  readonly path: string;
  readonly entries: readonly RenderedEntry[];
  readonly state: PathState | undefined;
  readonly sidecar: PathState | undefined;
  readonly lock: ReadonlyMap<string, BlockEntry> | undefined;
  readonly isRemoved: (blockId: string) => boolean;
  readonly ownable: Ownable;
  readonly brand: Brand;
}

/** What the planner decided for one block. */
interface Decision {
  readonly id: string;
  readonly op: OpKind;
  readonly reason: string;
  /** The next lock entry; undefined drops the block from the lock. */
  readonly entry?: BlockEntry;
  /** Kit content written in place (insert or replace), or only into the sidecar (`sidecar`). */
  readonly body?: string;
  /** Removes the block from the file. */
  readonly strip?: boolean;
  /** Records the block in `removed[]`. */
  readonly removal?: boolean;
}

/** One kit block being planned, with the lock entry after any resolved sidecar. */
interface KitBlock {
  readonly id: string;
  readonly body: string;
  readonly kitHash: string;
  /** The content the kit last wrote to the block, or null where it never wrote. */
  readonly base: string | null;
  readonly pending: string | undefined;
}

function entryOf(base: string | null, pending?: string): BlockEntry {
  return pending === undefined ? { base } : { base, pending };
}

function kitBlock(entry: RenderedEntry, lock: BlockEntry | undefined): KitBlock {
  const body = entry.content;
  const base = lock?.base ?? null;
  return { id: entry.blockId ?? '', body, kitHash: contentHash(body), base, pending: lock?.pending };
}

function missingBlock(block: KitBlock): Decision {
  const { id, body, kitHash } = block;
  if (block.base === null) {
    return { id, op: 'insertBlock', reason: 'adds the kit block', entry: { base: kitHash }, body };
  }
  const reason = 'the user deleted the kit block; recorded in removed[] so it is never added back';
  return { id, op: 'respectRemoval', reason, removal: true };
}

function presentBlock(block: KitBlock, current: string): Decision {
  const { id, body, kitHash, base } = block;
  if (current === kitHash) {
    const kept = base === kitHash && block.pending === undefined;
    const reason = kept ? 'unchanged' : 'already holds the kit version, which is recorded as its base';
    return { id, op: kept ? 'skip' : 'adopt', reason, entry: { base: kitHash } };
  }
  if (base !== null && current === base) {
    const reason = 'unchanged since the kit wrote it, so it gets the new kit version';
    return { id, op: 'replaceBlock', reason, entry: { base: kitHash }, body };
  }
  if (base === kitHash) {
    const reason = 'the user changed it and the kit has nothing new';
    return { id, op: 'skip', reason, entry: entryOf(base, block.pending) };
  }
  const reason = base === null ? 'differs from the kit version, which never wrote it' : 'the user changed it';
  return { id, op: 'sidecar', reason, entry: entryOf(base, kitHash), body };
}

function droppedDecision(
  job: BlocksJob,
  id: string,
  current: string | undefined,
  lock: BlockEntry,
): Decision {
  if (!job.ownable(job.path, id)) {
    return {
      id,
      op: 'skip',
      reason: 'the lock lists it, but no selected module writes it; left alone',
      entry: lock,
    };
  }
  if (current === undefined) {
    return { id, op: 'delete', reason: 'the kit no longer writes it, and it is already gone' };
  }
  if (lock.base !== null && current === lock.base) {
    const reason = 'the kit no longer writes it, and it is unchanged since the kit wrote it';
    return { id, op: 'delete', reason, strip: true };
  }
  return {
    id,
    op: 'skip',
    reason: 'the kit no longer writes it, but the user changed it; kept',
    entry: lock,
  };
}

// "The next run finds pending with no sidecar on disk and moves base to pending" (ADR-0014).
function resolvedLock(job: BlocksJob): ReadonlyMap<string, BlockEntry> {
  const lock = job.lock ?? new Map<string, BlockEntry>();
  if (job.sidecar !== undefined) return lock;
  return new Map(
    [...lock].map(([id, entry]) => [id, entry.pending === undefined ? entry : { base: entry.pending }]),
  );
}

function decide(job: BlocksJob, file: BlocksFile): Decision[] {
  const current = new Map([...blockParts(file)].map(([id, part]) => [id, contentHash(part.body)]));
  const lock = resolvedLock(job);
  const decisions = job.entries.map((entry): Decision => {
    const block = kitBlock(entry, lock.get(entry.blockId ?? ''));
    if (job.isRemoved(block.id)) {
      // Only a lock entry left beside the removal, as a rebuilt lock can hold, still changes the lock.
      const op = lock.has(block.id) ? 'respectRemoval' : 'skip';
      return { id: block.id, op, reason: 'the user deleted it earlier; the kit never adds it back' };
    }
    const found = current.get(block.id);
    return found === undefined ? missingBlock(block) : presentBlock(block, found);
  });
  const kit = new Set(job.entries.map((entry) => entry.blockId));
  for (const [id, entry] of lock) {
    if (!kit.has(id)) decisions.push(droppedDecision(job, id, current.get(id), entry));
  }
  return decisions;
}

function entryText(entry: BlockEntry | undefined): string {
  return entry === undefined ? '' : JSON.stringify([entry.base, entry.pending]);
}

// A skip that still moves the lock entry, such as a resolved sidecar, is reported as an adoption.
function settled(job: BlocksJob, decision: Decision): Decision {
  const before = job.lock?.get(decision.id);
  if (decision.op !== 'skip' || entryText(before) === entryText(decision.entry)) return decision;
  const resolved = before?.pending !== undefined && job.sidecar === undefined;
  const reason = resolved
    ? 'its sidecar is gone, so the kit version it held now counts as seen'
    : `records the kit version that ${sidecarPath(job.path, job.brand)} already holds`;
  return { ...decision, op: 'adopt', reason };
}

function edits(decisions: readonly Decision[], withSidecar: boolean): BlockEdits {
  const written = (op: OpKind): boolean => op === 'replaceBlock' || (withSidecar && op === 'sidecar');
  return {
    replace: new Map(
      decisions.flatMap((d) => (written(d.op) && d.body !== undefined ? [[d.id, d.body] as const] : [])),
    ),
    remove: new Set(decisions.filter((d) => d.strip === true).map((d) => d.id)),
    insert: decisions.flatMap((d) =>
      d.op === 'insertBlock' && d.body !== undefined ? [{ id: d.id, body: d.body }] : [],
    ),
  };
}

// The kit's sidecar is the file as it is now with each pending block holding its pending content. Any other
// byte, in a block or between blocks, is the user's, and a sidecar that holds one is never rewritten (ADR-0014).
function uneditedSidecar(job: BlocksJob, file: BlocksFile, text: string): boolean {
  const pending = [...(job.lock ?? [])].filter(([, entry]) => entry.pending !== undefined);
  if (pending.length === 0) return false;
  try {
    const parts = blockParts(parseBlocks(job.path, text, job.brand));
    const replace = new Map<string, string>();
    for (const [id, entry] of pending) {
      const part = parts.get(id);
      if (part === undefined || contentHash(part.body) !== entry.pending) return false;
      replace.set(id, toLf(part.body));
    }
    const kit = editBlocks(file, { replace, remove: new Set(), insert: [] }, job.brand.markerPrefix);
    return toLf(kit) === toLf(text);
  } catch (error) {
    if (error instanceof MergeError) return false;
    throw error;
  }
}

// The lock keeps no hash of the whole sidecar, so once the user edits the file outside its blocks, the kit's own
// sidecar no longer matches and is kept like an edited one, though ADR-0014 would rewrite it (a known gap).
function keptBlocksSidecarReason(sidecar: string, path: string): string {
  return `${sidecar} no longer matches ${path} with the kit blocks swapped in, so the kit cannot tell it from one the user edited and leaves it alone; delete it and run again to get the newest kit version`;
}

function withSidecar(
  job: BlocksJob,
  file: BlocksFile,
  decisions: Decision[],
): { decisions: Decision[]; sidecar?: string } {
  if (!decisions.some((decision) => decision.op === 'sidecar')) return { decisions };
  const text = editBlocks(file, edits(decisions, true), job.brand.markerPrefix);
  const action = sidecarAction(job.sidecar, text, (existing) => uneditedSidecar(job, file, existing));
  const sidecar = sidecarPath(job.path, job.brand);
  if (action === 'write') {
    const reason = (why: string): string =>
      `${why}, so it is kept and the file with the kit version goes to ${sidecar}`;
    return {
      decisions: decisions.map((d) => (d.op === 'sidecar' ? { ...d, reason: reason(d.reason) } : d)),
      sidecar: text,
    };
  }
  return {
    decisions: decisions.map((d) => {
      if (d.op !== 'sidecar') return d;
      const kept =
        action === 'same'
          ? `${sidecar} already holds the kit version`
          : keptBlocksSidecarReason(sidecar, job.path);
      const entry = (action === 'same' ? d.entry : job.lock?.get(d.id)) ?? { base: null };
      return { ...d, op: 'skip', reason: `${d.reason}; ${kept}`, entry };
    }),
  };
}

function outcome(job: BlocksJob, file: BlocksFile, decided: Decision[]): PathOutcome {
  const { decisions: offered, sidecar } = withSidecar(job, file, decided);
  const decisions = offered.map((decision) => settled(job, decision));
  const changes = edits(decisions, false);
  const changed = changes.replace.size + changes.remove.size + changes.insert.length > 0;
  const ops: PlanOp[] = decisions.map(({ op, id, reason }) => ({
    kind: op,
    path: job.path,
    entry: id,
    reason,
  }));
  const blocks = new Map(decisions.flatMap((d) => (d.entry === undefined ? [] : [[d.id, d.entry] as const])));
  const removed: Removal[] = decisions
    .filter((d) => d.removal === true)
    .map((d) => ({ path: job.path, blockId: d.id }));
  return {
    ops,
    removed,
    blocks,
    ...(changed ? { content: editBlocks(file, changes, job.brand.markerPrefix) } : {}),
    ...(sidecar === undefined ? {} : { sidecar }),
  };
}

/**
 * Plans a blocks file (#22, ADR-0014): the kit owns only the regions between its markers, and every byte outside
 * them stays as it is. Blocks are judged one by one against their base: an unchanged block is replaced in place,
 * a block the user changed is kept and the file's one sidecar holds the file with the kit version, and a block
 * the user deleted goes to `removed[]`. Broken markers throw MergeError naming the line, before any write.
 */
export function planBlocks(job: BlocksJob): PathOutcome {
  const { state } = job;
  if (state !== undefined && state.kind !== 'file') {
    const what = state.kind === 'symlink' ? 'a symlink' : 'not a regular text file';
    return planUnwritableBlocks(job, resolvedLock(job), what);
  }
  const file = state === undefined ? emptyBlocks(job.path) : parseBlocks(job.path, state.content, job.brand);
  return outcome(job, file, decide(job, file));
}
