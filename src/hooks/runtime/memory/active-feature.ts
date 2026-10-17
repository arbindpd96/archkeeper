import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { BRAND } from '../../../core/brand.js';
import { compareText, toLf } from '../../../core/text.js';
import { readProjectFile } from '../project.js';
import { readState } from '../state.js';

/** The pointer's state name under `<state dir>/local/`, which `/new-feature` writes (ADR-0014). */
const POINTER_STATE = 'active-feature';
/** The pointer's project-relative path, as hooks name it. */
export const POINTER_FILE = `${BRAND.stateDir}/local/${POINTER_STATE}`;
const FEATURES = 'docs/features';
const KEBAB_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IN_PROGRESS = /^status:[ \t]*in progress\b/im;
const MAX_MEMORY_BYTES = 1_000_000;
const STATUS_BYTES = 4096;
const MAX_SCANNED_FOLDERS = 200;
const ABSENT = new Set(['ENOENT', 'ENOTDIR']);

/** The active feature's memory: its folder name, its path, its text with LF line endings, and how it was found. */
export interface FeatureMemory {
  readonly name: string;
  /** The MEMORY.md path relative to the project, with forward slashes on every OS (6d2d423). */
  readonly file: string;
  readonly text: string;
  /** `pointer` when the pointer names the feature, `scan` when its MEMORY.md is the only one in progress. */
  readonly foundBy: 'pointer' | 'scan';
}

/** The active feature's memory, or the features in progress to ask about when no single one is active. */
export type ActiveFeature = { readonly memory: FeatureMemory } | { readonly inProgress: readonly string[] };

/**
 * What both memory hooks ask before Claude acts on, or edits, the active memory however they found it: a commit can
 * set the pointer (`git add -f`) as well as a status, so neither proves that the user chose the feature.
 */
export function confirmFirst(action: string): string {
  return `Unless the user chose or confirmed this feature in this session, confirm it with them before ${action}.`;
}

function memoryInProgress(
  projectDir: string,
  name: string,
  foundBy: FeatureMemory['foundBy'],
): FeatureMemory | undefined {
  const file = `${FEATURES}/${name}/MEMORY.md`;
  const read = readProjectFile(projectDir, file, MAX_MEMORY_BYTES);
  if (!('text' in read)) return undefined;
  const text = toLf(read.text);
  return IN_PROGRESS.test(text) ? { name, file, text, foundBy } : undefined;
}

// The pointer counts only as one kebab-case name, never a path, so it can never reach outside docs/features/.
function pointedFeature(projectDir: string): FeatureMemory | undefined {
  const name = readState(projectDir, POINTER_STATE)?.trim();
  return name !== undefined && KEBAB_NAME.test(name)
    ? memoryInProgress(projectDir, name, 'pointer')
    : undefined;
}

function isRealFolder(folder: string): boolean {
  return lstatSync(folder, { throwIfNoEntry: false })?.isDirectory() === true;
}

// Only kebab-case names count, as for the pointer: no name holds a line break or a control character, and the template
// in `_template`, which says `Status: in progress` too, never counts. A Stop with no pointer scans, so at most 200.
function featureFolders(projectDir: string): string[] {
  const root = path.join(projectDir, ...FEATURES.split('/'));
  try {
    if (!isRealFolder(root)) return [];
    const names = readdirSync(root).filter((name) => KEBAB_NAME.test(name));
    const first = names.sort(compareText).slice(0, MAX_SCANNED_FOLDERS);
    return first.filter((name) => isRealFolder(path.join(root, name)));
  } catch (error) {
    if (ABSENT.has((error as NodeJS.ErrnoException).code ?? '')) return [];
    throw error;
  }
}

// The status line tops a memory, so the scan reads only the head of each.
function saysInProgress(projectDir: string, name: string): boolean {
  const read = readProjectFile(projectDir, `${FEATURES}/${name}/MEMORY.md`, STATUS_BYTES, true);
  return 'text' in read && IN_PROGRESS.test(read.text);
}

/**
 * The active feature, found as `/handoff` finds it (the v0.1-m5-memory decision of 2026-10-17): the folder the
 * pointer names, when it holds one kebab-case name whose MEMORY.md says `Status: in progress`; else the only
 * MEMORY.md in a kebab-case folder of `docs/features/` that says so in its first 4 KB, among the first 200 folders.
 * Each read refuses symlinks and files outside the project.
 */
export function activeFeature(projectDir: string): ActiveFeature {
  const pointed = pointedFeature(projectDir);
  if (pointed !== undefined) return { memory: pointed };
  const inProgress = featureFolders(projectDir).filter((name) => saysInProgress(projectDir, name));
  const [only] = inProgress;
  if (inProgress.length !== 1 || only === undefined) return { inProgress };
  const memory = memoryInProgress(projectDir, only, 'scan');
  return memory === undefined ? { inProgress: [] } : { memory };
}
