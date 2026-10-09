import { RenderError } from './errors.js';
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

function checkClash(draft: Draft, existing: readonly Draft[]): void {
  for (const other of existing) {
    const who = `${other.module} and ${draft.module}`;
    if (other.strategy !== draft.strategy) {
      const problem = `is written as ${other.strategy} by ${other.module} and as ${draft.strategy} by ${draft.module}`;
      throw clash(draft.path, problem, 'declare the file with one strategy in every module');
    }
    if (draft.strategy === 'owned' || draft.strategy === 'create-only') {
      throw clash(
        draft.path,
        `is written by both ${who}`,
        'give the file to one module, or make it a blocks file',
      );
    }
    if (draft.blockId !== undefined && draft.blockId === other.blockId) {
      throw clash(draft.path, `gets block "${draft.blockId}" from both ${who}`, 'give each block its own id');
    }
    const key = sharedKey(draft, other);
    if (key !== undefined) {
      throw clash(draft.path, `gets ${key} from both ${who}`, 'keep the entry in one module');
    }
  }
}

function entryOrder(left: Draft, right: Draft): number {
  return compareText(left.blockId ?? '', right.blockId ?? '') || compareText(left.module, right.module);
}

function entryOf({ content, strategy, module, blockId }: Draft): RenderedEntry {
  return blockId === undefined ? { content, strategy, module } : { content, strategy, module, blockId };
}

/** Groups drafts by path in sorted order, refusing two modules that write one owned path, block or JSON entry. */
export function collectEntries(drafts: readonly Draft[]): RenderTree {
  const byPath = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const existing = byPath.get(draft.path) ?? [];
    checkClash(draft, existing);
    byPath.set(draft.path, [...existing, draft]);
  }
  const paths = [...byPath.keys()].sort(compareText);
  return new Map(paths.map((path) => [path, (byPath.get(path) ?? []).sort(entryOrder).map(entryOf)]));
}
