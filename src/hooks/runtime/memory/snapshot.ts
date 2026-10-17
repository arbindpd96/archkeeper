import { BRAND } from '../../../core/brand.js';
import { isRecord } from '../../../core/text.js';
import { projectStatus, type StatusEntry } from '../git-status.js';
import { readState, type StateWrite, writeState } from '../state.js';

/** The snapshot's state name under `<state dir>/local/` (ADR-0014). */
export const SNAPSHOT_STATE = 'snapshots/latest.json';
/** The snapshot's project-relative path, as hooks name it. */
export const SNAPSHOT_FILE = `${BRAND.stateDir}/local/${SNAPSHOT_STATE}`;
const MAX_STATUS_LINES = 50;

/** What pre-compact saves before Claude Code compacts the conversation, from the clock and git alone. */
export interface Snapshot {
  readonly savedAt: string;
  /** The branch, or null on a detached HEAD or when git could not say. */
  readonly branch: string | null;
  /** The first 50 lines of `git status --short` for the project folder, or null when git could not say. */
  readonly status: readonly string[] | null;
  /** How many status lines were left out after the first 50. */
  readonly more: number;
}

function shortLine(entry: StatusEntry): string {
  const name = entry.from === undefined ? entry.path : `${entry.from} -> ${entry.path}`;
  return `${entry.code} ${name}`;
}

/** Takes a project's snapshot at `now`: the branch and `git status --short`, untracked files included. */
export function takeSnapshot(projectDir: string, now: Date): Snapshot {
  const status = projectStatus(projectDir, true);
  const lines = status?.entries.map(shortLine) ?? [];
  return {
    savedAt: now.toISOString(),
    branch: status?.branch ?? null,
    status: status === undefined ? null : lines.slice(0, MAX_STATUS_LINES),
    more: Math.max(0, lines.length - MAX_STATUS_LINES),
  };
}

/** Saves a snapshot as the latest, through the runtime's confined state write. */
export function saveSnapshot(projectDir: string, snapshot: Snapshot): StateWrite {
  return writeState(projectDir, SNAPSHOT_STATE, `${JSON.stringify(snapshot, null, 2)}\n`);
}

const isTime = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isLines = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function snapshotOf(value: unknown): Snapshot | undefined {
  if (!isRecord(value)) return undefined;
  const { savedAt, branch, status, more } = value;
  const branchOk = branch === null || typeof branch === 'string';
  const statusOk = status === null || isLines(status);
  return isTime(savedAt) && branchOk && statusOk && isCount(more)
    ? { savedAt, branch, status, more }
    : undefined;
}

/** The latest saved snapshot, or undefined when there is none or it does not hold a snapshot's fields. */
export function readSnapshot(projectDir: string): Snapshot | undefined {
  const text = readState(projectDir, SNAPSHOT_STATE);
  if (text === null) return undefined;
  try {
    return snapshotOf(JSON.parse(text));
  } catch {
    return undefined;
  }
}
