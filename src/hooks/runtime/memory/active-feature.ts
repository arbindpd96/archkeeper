import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { BRAND } from '../../../core/brand.js';
import { compareText, toLf } from '../../../core/text.js';
import { readProjectFile } from '../project.js';
import { readState } from '../state.js';

/** The pointer's state name under `<state dir>/local/`, which `/new-feature` writes (ADR-0014). */
export const POINTER_STATE = 'active-feature';
/** The pointer's project-relative path, as hooks name it. */
export const POINTER_FILE = `${BRAND.stateDir}/local/${POINTER_STATE}`;
const FEATURES = 'docs/features';
const KEBAB_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IN_PROGRESS = /^status:[ \t]*in progress\b/im;
const MAX_MEMORY_BYTES = 1_000_000;
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
// in `_template`, which says `Status: in progress` too, never counts.
function featureFolders(projectDir: string): string[] {
  const root = path.join(projectDir, ...FEATURES.split('/'));
  try {
    const names = readdirSync(root).filter((name) => KEBAB_NAME.test(name));
    return names.filter((name) => isRealFolder(path.join(root, name))).sort(compareText);
  } catch (error) {
    if (ABSENT.has((error as NodeJS.ErrnoException).code ?? '')) return [];
    throw error;
  }
}

/**
 * The active feature, found as `/handoff` finds it (the v0.1-m5-memory decision of 2026-10-17): the folder the
 * pointer names, when it holds one kebab-case name whose MEMORY.md says `Status: in progress`; else the only
 * MEMORY.md in a kebab-case folder of `docs/features/` that says so. Each read refuses symlinks and files outside
 * the project.
 */
export function activeFeature(projectDir: string): ActiveFeature {
  const pointed = pointedFeature(projectDir);
  if (pointed !== undefined) return { memory: pointed };
  const found = featureFolders(projectDir).flatMap((name) => {
    const memory = memoryInProgress(projectDir, name, 'scan');
    return memory === undefined ? [] : [memory];
  });
  const [only] = found;
  return found.length === 1 && only !== undefined
    ? { memory: only }
    : { inProgress: found.map((memory) => memory.name) };
}
