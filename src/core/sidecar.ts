import type { Brand } from './brand.js';
import type { BlockEntry, FileEntry } from './lock.js';
import type { OpKind, PathState } from './plan-types.js';
import { toLf } from './text.js';

/** What to do with a sidecar: write it, leave it because it already holds the content, or keep what is there. */
export type SidecarAction = 'write' | 'same' | 'kept';

/** The sidecar of a project path, such as `CLAUDE.md` plus the sidecar suffix of the brand (ADR-0014). */
export function sidecarPath(path: string, brand: Pick<Brand, 'sidecarSuffix'>): string {
  return `${path}${brand.sidecarSuffix}`;
}

/**
 * Decides whether a sidecar may be written with `content`. A missing sidecar is written; one that already holds
 * the content is left alone; one that `unedited` recognises as the kit's earlier sidecar is rewritten; anything
 * else, such as a sidecar the user edited, a symlink or a user's own file at that path, is never overwritten.
 */
export function sidecarAction(
  state: PathState | undefined,
  content: string,
  unedited: (text: string) => boolean,
): SidecarAction {
  if (state === undefined) return 'write';
  if (state.kind !== 'file') return 'kept';
  if (toLf(state.content) === toLf(content)) return 'same';
  return unedited(state.content) ? 'write' : 'kept';
}

/** The reason a sidecar was not written, for the plan. */
export function keptSidecarReason(path: string, brand: Pick<Brand, 'sidecarSuffix'>): string {
  return `${sidecarPath(path, brand)} was edited or is not the kit's, so it is left alone and the kit version is not offered`;
}

/** A file's or a block's lock entry, as a plan compares it before and after. */
type LockEntry = Partial<Pick<FileEntry, 'module' | 'strategy'>> & BlockEntry;

/** How a path's lock entry changes with one decision: before and after it, and the sidecar found beside it. */
export interface EntryChange {
  readonly before: LockEntry | undefined;
  readonly after: LockEntry | undefined;
  readonly sidecar: PathState | undefined;
  /** Why the entry moves when no resolved sidecar explains it. */
  readonly moved: string;
}

function entryText(entry: LockEntry | undefined): string {
  return entry === undefined ? '' : JSON.stringify([entry.module, entry.strategy, entry.base, entry.pending]);
}

/**
 * Reports a skip that still moves the lock entry as `adopt`, since applying it writes the lock (#21): either the
 * sidecar the entry was pending on is gone, so that kit version now counts as seen (ADR-0014), or `moved`.
 */
export function settledOp(
  kind: OpKind,
  reason: string,
  change: EntryChange,
): { kind: OpKind; reason: string } {
  if (kind !== 'skip' || entryText(change.before) === entryText(change.after)) return { kind, reason };
  const resolved = change.before?.pending !== undefined && change.sidecar === undefined;
  const why = resolved ? 'its sidecar is gone, so the kit version it held now counts as seen' : change.moved;
  return { kind: 'adopt', reason: why };
}
