import { editBlocks, type NewBlock } from './blocks-edit.js';
import { blockParts, emptyBlocks, parseBlocks } from './blocks-file.js';
import type { BlocksJob } from './blocks-plan.js';
import { MergeError } from './errors.js';
import { contentHash } from './hash.js';
import type { BlockEntry } from './lock.js';
import type { OpKind, PathOutcome } from './plan-types.js';
import { keptSidecarReason, sidecarAction, sidecarPath } from './sidecar.js';
import { toLf } from './text.js';

function sidecarText(job: BlocksJob, blocks: readonly NewBlock[]): string {
  const edits = { replace: new Map<string, string>(), remove: new Set<string>(), insert: blocks };
  return editBlocks(emptyBlocks(job.path), edits, job.brand.markerPrefix);
}

// The kit's sidecar holds only kit blocks, laid out as the kit writes them, each with content the lock records as
// its base or pending; any other byte in it is the user's, and such a sidecar is never rewritten (ADR-0014).
function kitSidecar(job: BlocksJob, text: string): boolean {
  try {
    const parts = [...blockParts(parseBlocks(job.path, text, job.brand)).values()];
    const known = parts.every((part) => {
      const entry = job.lock?.get(part.id);
      const hash = contentHash(part.body);
      return entry !== undefined && (hash === entry.base || hash === entry.pending);
    });
    const layout = sidecarText(
      job,
      parts.map((part) => ({ id: part.id, body: toLf(part.body) })),
    );
    return known && toLf(layout) === toLf(text);
  } catch (error) {
    if (error instanceof MergeError) return false;
    throw error;
  }
}

function op(job: BlocksJob, kind: OpKind, reason: string): PathOutcome['ops'] {
  return [{ kind, path: job.path, reason }];
}

function nothingNew(job: BlocksJob, lock: ReadonlyMap<string, BlockEntry>, why: string): PathOutcome {
  const resolved =
    job.sidecar === undefined && [...(job.lock ?? [])].some(([, entry]) => entry.pending !== undefined);
  const ops = resolved
    ? op(job, 'adopt', 'its sidecar is gone, so the kit blocks it held now count as seen')
    : op(job, 'skip', `${why}; the kit has nothing new for it`);
  return { ops, blocks: lock, removed: [] };
}

/**
 * Plans a blocks path the kit never writes through, such as a symlinked `CLAUDE.md` (ADR-0014): the kit blocks
 * whose version the user has not seen go to the path's sidecar, each recording that version as `pending`. Once
 * the user deletes the sidecar, those versions count as seen; a sidecar the user edited is never overwritten.
 */
export function planUnwritableBlocks(
  job: BlocksJob,
  lock: ReadonlyMap<string, BlockEntry>,
  what: string,
): PathOutcome {
  const blocks = job.entries
    .filter((entry) => !job.isRemoved(entry.blockId ?? ''))
    .map((entry) => ({ id: entry.blockId ?? '', body: entry.content }));
  const why = `is ${what}, which the kit never writes through`;
  if (blocks.length === 0) return { ops: [], blocks: lock, removed: [] };
  const offered = blocks.filter((block) => lock.get(block.id)?.base !== contentHash(block.body));
  if (offered.length === 0) return nothingNew(job, lock, why);
  const text = sidecarText(job, blocks);
  const action = sidecarAction(job.sidecar, text, (existing) => kitSidecar(job, existing));
  const sidecar = sidecarPath(job.path, job.brand);
  if (action === 'kept') {
    const reason = `${why}; ${keptSidecarReason(job.path, job.brand)}`;
    return { ops: op(job, 'skip', reason), blocks: job.lock ?? lock, removed: [] };
  }
  const next = new Map(lock);
  for (const { id, body } of offered) {
    next.set(id, { base: lock.get(id)?.base ?? null, pending: contentHash(body) });
  }
  if (action === 'write') {
    return {
      ops: op(job, 'sidecar', `${why}; its blocks go to ${sidecar}`),
      sidecar: text,
      blocks: next,
      removed: [],
    };
  }
  const recorded = offered.every(({ id, body }) => lock.get(id)?.pending === contentHash(body));
  const ops = recorded
    ? op(job, 'skip', `${why}; ${sidecar} already holds the kit blocks`)
    : op(job, 'adopt', `records the kit blocks that ${sidecar} already holds`);
  return { ops, blocks: next, removed: [] };
}
