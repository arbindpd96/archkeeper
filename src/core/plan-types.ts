import type { BlockEntry, FileEntry, Removal } from './lock.js';

/**
 * What the kit found at a project path, read without following symlinks: a text file with its content, a symlink
 * (never read or written through), or anything else, such as a folder, a FIFO or a file that is not UTF-8 text.
 */
export type PathState =
  | { readonly kind: 'file'; readonly content: string }
  | { readonly kind: 'symlink' }
  | { readonly kind: 'other' };

/** The project as the planner sees it: the state of each path it asked for; a missing path is absent. */
export type Snapshot = ReadonlyMap<string, PathState>;

/** What one planned operation does (#21, ADR-0014). */
export type OpKind =
  | 'create'
  | 'insertBlock'
  | 'replaceBlock'
  | 'mergeJson'
  | 'sidecar'
  | 'adopt'
  | 'skip'
  | 'delete'
  | 'respectRemoval';

/** One planned operation on a file, block or JSON entry, with the reason a user reads in the plan. */
export interface PlanOp {
  readonly kind: OpKind;
  readonly path: string;
  /** The block id or owned JSON key the operation is about; absent for a whole file. */
  readonly entry?: string;
  readonly reason: string;
}

/** What planning one path decides: its operations, the bytes to write, and its next lock entries. */
export interface PathOutcome {
  readonly ops: readonly PlanOp[];
  /** The new content of the path, or null to delete it; absent leaves it as it is. */
  readonly content?: string | null;
  /** The content of the path's sidecar to write; absent leaves the sidecar as it is. */
  readonly sidecar?: string;
  readonly file?: FileEntry;
  readonly blocks?: ReadonlyMap<string, BlockEntry>;
  readonly json?: ReadonlyMap<string, string>;
  readonly removed: readonly Removal[];
}

/**
 * What a hook script holds once a plan is applied: exactly the kit's script, nothing, or anything else, such as
 * a user's own script, a symlink or a kit script the user changed. Only the kit's script is registered (ADR-0014).
 */
export type ScriptState = 'kit' | 'missing' | 'other';

/** Whether the current kit could own a path, or a block or JSON entry in it; the lock is untrusted (ADR-0014). */
export type Ownable = (path: string, entry?: string) => boolean;
