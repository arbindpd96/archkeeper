import { type Answer, noAnswer } from '../io.js';
import type { HookContext, HookModule, Sample } from '../launch.js';
import { slashed } from '../project.js';
import { saveSnapshot, takeSnapshot } from './snapshot.js';

// The payload holds nothing the snapshot needs, so input it cannot read changes nothing.
function answer(_input: unknown, context: HookContext): Answer {
  const saved = saveSnapshot(context.projectDir, takeSnapshot(context.projectDir, new Date()));
  return saved.written
    ? noAnswer()
    : noAnswer(`pre-compact: skipped the snapshot: ${slashed(saved.problem)}`);
}

const SAMPLES: readonly Sample[] = [
  { name: 'a manual compaction', payload: { trigger: 'manual' }, expect: 'allow' },
  { name: 'an automatic compaction', payload: { trigger: 'auto' }, expect: 'allow' },
  { name: 'a payload with no trigger', payload: {}, expect: 'allow' },
];

/**
 * pre-compact (#35): before Claude Code compacts the conversation, saves the time, the branch and the project's
 * `git status --short` (50 lines at most) to `<state dir>/local/snapshots/latest.json`; it never calls a model.
 */
export const preCompact: HookModule = { answer, samples: SAMPLES };
