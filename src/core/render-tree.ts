import { RenderError } from './errors.js';
import { foldedPath } from './paths.js';
import { compareText } from './text.js';

/** An ownership strategy of ADR-0014. */
export type Strategy = 'owned' | 'blocks' | 'json' | 'create-only';

/** One piece of rendered output: a whole file, one managed block, or one module's entries in a JSON file. */
export interface RenderedEntry {
  readonly content: string;
  readonly strategy: Strategy;
  readonly module: string;
  readonly blockId?: string;
}

/** Rendered output by project path in sorted order; a blocks or json path holds one entry per block or module. */
export type RenderTree = ReadonlyMap<string, readonly RenderedEntry[]>;

/** An entry on its way into the tree, with its path and, for JSON, the keys it owns. */
export interface Draft extends RenderedEntry {
  readonly path: string;
  readonly keys?: readonly string[];
}

function clash(path: string, problem: string, hint: string): RenderError {
  return new RenderError({ file: path, location: '', problem, hint });
}

function sharedKey(left: Draft, right: Draft): string | undefined {
  return left.keys?.find((key) => right.keys?.includes(key));
}

interface Shared {
  readonly problem: string;
  readonly hint: string;
}

function sharedEntry(draft: Draft, other: Draft): Shared | undefined {
  if (draft.strategy === 'owned' || draft.strategy === 'create-only') {
    return { problem: 'is written by', hint: 'give the file to one module, or make it a blocks file' };
  }
  if (draft.blockId !== undefined && draft.blockId === other.blockId) {
    return { problem: `gets block "${draft.blockId}" from`, hint: 'give each block its own id' };
  }
  const key = sharedKey(draft, other);
  return key === undefined
    ? undefined
    : { problem: `gets ${key} from`, hint: 'keep the entry in one module' };
}

function sameEntryClash(draft: Draft, other: Draft, shared: Shared): RenderError {
  if (draft.module === other.module) {
    const hint = 'list the file once in files: two of its targets render to this path';
    return clash(draft.path, `${shared.problem} ${draft.module} twice`, hint);
  }
  return clash(draft.path, `${shared.problem} both ${other.module} and ${draft.module}`, shared.hint);
}

function checkClash(draft: Draft, existing: readonly Draft[]): void {
  for (const other of existing) {
    if (other.path !== draft.path) {
      const problem = `and ${other.path} from ${other.module} name one file on macOS and Windows`;
      throw clash(draft.path, problem, 'spell the path the same way in every module');
    }
    if (other.strategy !== draft.strategy) {
      const problem = `is written as ${other.strategy} by ${other.module} and as ${draft.strategy} by ${draft.module}`;
      throw clash(draft.path, problem, 'declare the file with one strategy in every module');
    }
    const shared = sharedEntry(draft, other);
    if (shared !== undefined) throw sameEntryClash(draft, other, shared);
  }
}

function entryOrder(left: Draft, right: Draft): number {
  return compareText(left.blockId ?? '', right.blockId ?? '') || compareText(left.module, right.module);
}

function entryOf({ content, strategy, module, blockId }: Draft): RenderedEntry {
  return blockId === undefined ? { content, strategy, module } : { content, strategy, module, blockId };
}

/**
 * Groups drafts by path in sorted order, refusing two writers of one owned path, block or JSON entry, and two
 * spellings of one path that differ only in case or Unicode normalisation.
 */
export function collectEntries(drafts: readonly Draft[]): RenderTree {
  const byFile = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const existing = byFile.get(foldedPath(draft.path)) ?? [];
    checkClash(draft, existing);
    byFile.set(foldedPath(draft.path), [...existing, draft]);
  }
  const files = [...byFile.values()].map((entries) => [...entries].sort(entryOrder));
  const tree = files.map((entries) => [entries[0]?.path ?? '', entries.map(entryOf)] as const);
  return new Map(tree.sort(([left], [right]) => compareText(left, right)));
}
