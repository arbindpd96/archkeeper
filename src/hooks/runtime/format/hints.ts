import { readState, type StateWrite, writeState } from '../state.js';

const STATE = 'format-on-edit.json';
const MAX_KEPT = 100;

/** A hint for the user that shows once on a machine: its key in the hint state, and its text. */
export interface Hint {
  readonly key: string;
  readonly text: string;
}

/** The keys of the hints already shown on this machine, from `<state dir>/local/format-on-edit.json`. */
export function shownHints(projectDir: string): ReadonlySet<string> {
  try {
    const keys: unknown = JSON.parse(readState(projectDir, STATE) ?? '[]');
    return new Set(Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Records hints as shown through the runtime's confined state write, keeping the newest 100 keys. */
export function recordShown(
  projectDir: string,
  shown: ReadonlySet<string>,
  hints: readonly Hint[],
): StateWrite {
  const keys = [...new Set([...shown, ...hints.map((hint) => hint.key)])].slice(-MAX_KEPT);
  return writeState(projectDir, STATE, `${JSON.stringify(keys)}\n`);
}
