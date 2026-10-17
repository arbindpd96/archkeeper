import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { BRAND } from '../../../core/brand.js';
import { compareText, escapeUnprintable, isRecord } from '../../../core/text.js';
import { projectStatus } from '../git-status.js';
import { type Answer, block, type HookInput, noAnswer, type Payload } from '../io.js';
import type { HookContext, HookModule, Sample } from '../launch.js';
import { slashed } from '../project.js';
import { readState, writeState } from '../state.js';
import { activeFeature, confirmFirst, type FeatureMemory, POINTER_FILE } from './active-feature.js';

const STATE = 'memory-stop.json';
// Docs are not the work a memory records: anything under docs/, and Markdown and other markup anywhere. A .txt file
// counts as work, since requirements.txt and CMakeLists.txt are code.
const DOC_FILE = /\.(?:md|mdx|markdown|rst|adoc)$/i;
const NAMES_SHOWN = 3;

/** The work a Stop finds unsaved in the memory, and the change set it belongs to. */
interface UnsavedWork {
  /** A hash of HEAD, the memory's path and every changed tracked file that is not a doc. */
  readonly changeSet: string;
  /** Those of the files saved after the memory, in path order. */
  readonly files: readonly string[];
}

// The kit's own state, such as the lock an update rewrites, is not work either.
function isWorkFile(file: string): boolean {
  return !file.startsWith('docs/') && !file.startsWith(`${BRAND.stateDir}/`) && !DOC_FILE.test(file);
}

function modifiedAt(projectDir: string, file: string): number | undefined {
  try {
    return lstatSync(path.join(projectDir, ...file.split('/')), { throwIfNoEntry: false })?.mtimeMs;
  } catch {
    return undefined;
  }
}

// Untracked files stay out (#35), and a deleted file has no time, so it only changes the change set.
function unsavedWork(projectDir: string, memory: FeatureMemory): UnsavedWork | undefined {
  const savedAt = modifiedAt(projectDir, memory.file);
  const status = savedAt === undefined ? undefined : projectStatus(projectDir, false);
  if (savedAt === undefined || status === undefined) return undefined;
  const work = status.entries
    .map((entry) => entry.path)
    .filter(isWorkFile)
    .sort(compareText);
  const files = work.filter((file) => (modifiedAt(projectDir, file) ?? 0) > savedAt);
  if (files.length === 0) return undefined;
  const changeSet = createHash('sha256').update([status.head ?? '', memory.file, ...work].join('\0'));
  return { changeSet: changeSet.digest('hex'), files };
}

function askedBefore(projectDir: string, changeSet: string): boolean {
  const text = readState(projectDir, STATE);
  if (text === null) return false;
  try {
    const state: unknown = JSON.parse(text);
    return isRecord(state) && state.askedFor === changeSet;
  } catch {
    return false;
  }
}

// Claude Code sets it while a Stop hook's block keeps Claude working. Any value but false ends the hook at once, so it
// never loops; a missing field reads as false.
function keptWorking(payload: Payload): boolean {
  const active = payload.stop_hook_active;
  return active !== undefined && active !== false;
}

function reason(memory: FeatureMemory, files: readonly string[]): string {
  const more = files.length > NAMES_SHOWN ? ` and ${String(files.length - NAMES_SHOWN)} more` : '';
  const changed = `${files.slice(0, NAMES_SHOWN).map(escapeUnprintable).join(', ')}${more}`;
  const ask =
    'Run /handoff to record Done and Next step there, or tell the user why this needs no memory update.';
  const file = escapeUnprintable(memory.file);
  return `${BRAND.displayName} feature memory: ${changed} changed after ${file} was last saved. ${ask} ${confirmFirst('editing that file')}`;
}

function answer(input: HookInput, context: HookContext): Answer {
  if (input.problem !== undefined) return noAnswer(`memory-stop: ${input.problem}, so it let Claude stop`);
  if (keptWorking(input.payload)) return noAnswer();
  const found = activeFeature(context.projectDir);
  if (!('memory' in found)) return noAnswer();
  const unsaved = unsavedWork(context.projectDir, found.memory);
  if (unsaved === undefined || askedBefore(context.projectDir, unsaved.changeSet)) return noAnswer();
  const saved = writeState(context.projectDir, STATE, `${JSON.stringify({ askedFor: unsaved.changeSet })}\n`);
  if (!saved.written) {
    return noAnswer(
      `memory-stop: let Claude stop, since it could not record asking: ${slashed(saved.problem)}`,
    );
  }
  return block(reason(found.memory, unsaved.files));
}

const MEMORY =
  '# Feature: self-test\n\nStatus: in progress | Branch: main\n\n## Next step\n\nRun the self-test.\n';
const FEATURE = { [POINTER_FILE]: 'self-test\n', 'docs/features/self-test/MEMORY.md': MEMORY, 'a.ts': 'x\n' };

const SAMPLES: readonly Sample[] = [
  {
    name: 'a stop while a Stop hook already keeps Claude working',
    payload: { stop_hook_active: true },
    expect: 'allow',
    files: FEATURE,
  },
  { name: 'a stop with no active feature', payload: { stop_hook_active: false }, expect: 'allow' },
  {
    name: 'a stop outside a git repository',
    payload: { stop_hook_active: false },
    expect: 'allow',
    files: FEATURE,
  },
];

/**
 * memory-stop (#35): asks Claude to run /handoff when tracked files other than docs changed after the active
 * feature's MEMORY.md was last saved, once per change set (HEAD and the changed files); it returns at once while
 * a Stop hook already keeps Claude working, and lets Claude stop whenever it cannot tell.
 */
export const memoryStop: HookModule = { answer, samples: SAMPLES };
