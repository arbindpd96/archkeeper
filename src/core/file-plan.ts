import type { Brand } from './brand.js';
import { contentHash } from './hash.js';
import type { FileEntry } from './lock.js';
import type { OpKind, PathOutcome, PathState } from './plan-types.js';
import type { RenderedEntry } from './render-tree.js';
import { keptSidecarReason, sidecarAction, sidecarPath } from './sidecar.js';

/** Everything the planner knows about one owned or create-only path. */
export interface FileJob {
  readonly path: string;
  /** The kit's file; undefined when only the lock still lists the path. */
  readonly entry: RenderedEntry | undefined;
  readonly state: PathState | undefined;
  readonly sidecar: PathState | undefined;
  readonly lock: FileEntry | undefined;
  readonly removed: boolean;
  readonly ownable: boolean;
  readonly brand: Brand;
}

/** One kit file being planned: the job, the kit content and the lock entry with any resolved sidecar applied. */
interface KitFile {
  readonly job: FileJob;
  readonly entry: RenderedEntry;
  readonly kitHash: string;
  /** The base the kit last wrote, or null where it never wrote. */
  readonly base: string | null;
  readonly pending: string | undefined;
}

type Change = Omit<PathOutcome, 'ops' | 'removed'>;

function entryText(entry: FileEntry | undefined): string {
  return entry === undefined ? '' : JSON.stringify([entry.module, entry.strategy, entry.base, entry.pending]);
}

function adoptReason(job: FileJob): string {
  if (job.lock?.pending !== undefined && job.sidecar === undefined) {
    return 'its sidecar is gone, so the kit version it held now counts as seen';
  }
  return 'its lock entry now names the module and strategy that write it';
}

// A skip that still moves the lock entry, such as a resolved sidecar, is reported as an adoption.
function outcome(job: FileJob, kind: OpKind, reason: string, change: Change = {}): PathOutcome {
  const moved = kind === 'skip' && entryText(change.file) !== entryText(job.lock);
  const op = moved ? { kind: 'adopt' as const, reason: adoptReason(job) } : { kind, reason };
  return { ops: [{ ...op, path: job.path }], removed: [], ...change };
}

function entryOf(file: KitFile, base: string | null, pending?: string): FileEntry {
  const strategy = file.entry.strategy === 'create-only' ? 'create-only' : 'owned';
  return { module: file.entry.module, strategy, base, ...(pending === undefined ? {} : { pending }) };
}

// "The next run finds pending with no sidecar on disk and moves base to pending" (ADR-0014).
function kitFile(job: FileJob, entry: RenderedEntry): KitFile {
  const kitHash = contentHash(entry.content);
  const { lock } = job;
  if (lock?.pending !== undefined && job.sidecar === undefined) {
    return { job, entry, kitHash, base: lock.pending, pending: undefined };
  }
  return { job, entry, kitHash, base: lock?.base ?? null, pending: lock?.pending };
}

function userDeleted(job: FileJob): PathOutcome {
  const reason = 'the user deleted it; recorded in removed[] so the kit never recreates it';
  return { ops: [{ kind: 'respectRemoval', path: job.path, reason }], removed: [{ path: job.path }] };
}

function toSidecar(file: KitFile, why: string): PathOutcome {
  const { job, entry, kitHash } = file;
  const sidecar = sidecarPath(job.path, job.brand);
  const action = sidecarAction(job.sidecar, entry.content, (text) => contentHash(text) === file.pending);
  if (action === 'kept') {
    const kept = entryOf(file, file.base, file.pending);
    return outcome(job, 'skip', `${why}; ${keptSidecarReason(job.path, job.brand)}`, { file: kept });
  }
  const next = entryOf(file, file.base, kitHash);
  if (action === 'same') {
    return outcome(job, 'skip', `${why}; ${sidecar} already holds the kit version`, { file: next });
  }
  const reason = `${why}, so it is left alone and the kit version goes to ${sidecar}`;
  return outcome(job, 'sidecar', reason, { file: next, sidecar: entry.content });
}

function withEolOf(content: string, previous: string): string {
  return previous.includes('\r\n') ? content.replaceAll('\n', '\r\n') : content;
}

function planExisting(file: KitFile, content: string): PathOutcome {
  const { job, entry, kitHash, base } = file;
  const current = contentHash(content);
  if (current === kitHash) {
    const kept = base === kitHash && file.pending === undefined;
    const reason = kept ? 'unchanged' : 'already holds the kit version, which is recorded as its base';
    return outcome(job, kept ? 'skip' : 'adopt', reason, { file: entryOf(file, kitHash) });
  }
  if (base !== null && current === base) {
    const reason = 'unchanged since the kit wrote it, so it is rewritten with the new kit version';
    return outcome(job, 'create', reason, {
      content: withEolOf(entry.content, content),
      file: entryOf(file, kitHash),
    });
  }
  if (base === kitHash) {
    const reason = 'the user changed it and the kit has nothing new';
    return outcome(job, 'skip', reason, { file: entryOf(file, kitHash, file.pending) });
  }
  return toSidecar(
    file,
    base === null ? 'differs from the kit version, which never wrote it' : 'the user changed it',
  );
}

function planOwned(file: KitFile): PathOutcome {
  const { job, entry, kitHash } = file;
  const { state } = job;
  if (state === undefined && file.base !== null) return userDeleted(job);
  if (state === undefined) {
    return outcome(job, 'create', 'new kit file', { content: entry.content, file: entryOf(file, kitHash) });
  }
  if (state.kind === 'file') return planExisting(file, state.content);
  return toSidecar(
    file,
    `is ${state.kind === 'symlink' ? 'a symlink' : 'not a regular text file'}, which the kit never writes through`,
  );
}

function planCreateOnly(file: KitFile): PathOutcome {
  const { job, entry, kitHash } = file;
  const { state, lock } = job;
  if (state === undefined && lock !== undefined) return userDeleted(job);
  if (state === undefined) {
    return outcome(job, 'create', 'new kit file', { content: entry.content, file: entryOf(file, kitHash) });
  }
  if (lock !== undefined) {
    const reason = 'written once by the kit; create-only files are never touched again';
    return outcome(job, 'skip', reason, { file: entryOf(file, lock.base) });
  }
  if (state.kind === 'file' && contentHash(state.content) === kitHash) {
    return outcome(job, 'adopt', 'already holds the kit version', { file: entryOf(file, kitHash) });
  }
  return outcome(job, 'skip', 'already exists; a create-only file is written only where none is');
}

function planDropped(job: FileJob, lock: FileEntry): PathOutcome {
  const keep = { file: lock };
  const { state } = job;
  if (!job.ownable) {
    return outcome(job, 'skip', 'the lock lists it, but no selected module writes it; left alone', keep);
  }
  if (lock.strategy === 'create-only') {
    return outcome(job, 'skip', 'create-only files stay after the kit stops writing them', keep);
  }
  if (state === undefined) {
    return outcome(job, 'delete', 'the kit no longer writes it, and it is already gone');
  }
  const unchanged = state.kind === 'file' && lock.base !== null && contentHash(state.content) === lock.base;
  if (!unchanged) {
    return outcome(job, 'skip', 'the kit no longer writes it, but it is not as the kit wrote it; kept', keep);
  }
  const reason = 'the kit no longer writes it, and it is unchanged since the kit wrote it';
  return outcome(job, 'delete', reason, { content: null });
}

/**
 * Plans an owned or create-only path (#22, ADR-0014). An owned file unchanged since the kit wrote it is rewritten;
 * a file the user changed, or found different on first contact, is never overwritten and the kit version goes
 * to its sidecar; a file identical to the kit version is adopted; a kit file the user deleted goes to `removed[]`.
 * A create-only file is written only where none exists. A symlink is never written through.
 */
export function planFile(job: FileJob): PathOutcome {
  const { entry, lock } = job;
  if (entry === undefined) return lock === undefined ? { ops: [], removed: [] } : planDropped(job, lock);
  if (job.removed) {
    // Only a lock entry left beside the removal, as a rebuilt lock can hold, still changes the lock.
    const kind = lock === undefined ? 'skip' : 'respectRemoval';
    const reason = 'the user deleted it earlier; the kit never recreates it';
    return { ops: [{ kind, path: job.path, reason }], removed: [] };
  }
  const file = kitFile(job, entry);
  return entry.strategy === 'create-only' ? planCreateOnly(file) : planOwned(file);
}
