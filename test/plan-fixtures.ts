import type { KitId } from '../src/core/lock.js';
import { type Plan, planInstall } from '../src/core/plan.js';
import type { PathState, Snapshot } from '../src/core/plan-types.js';
import type { RenderedEntry, RenderTree } from '../src/core/render-tree.js';
import { compareText } from '../src/core/text.js';
import { TEST_BRAND } from './kit-fixtures.js';

export { blockEntry, denyEntry, fileEntry, TEST_BRAND } from './kit-fixtures.js';

/** The kit that writes the test locks. */
export const TEST_KIT: KitId = { name: 'acmekit', version: '1.0.0' };

/** The plan context for the test brand and kit. */
export const CONTEXT = { kit: TEST_KIT, modules: ['m'], brand: TEST_BRAND } as const;

/** A render tree from path and entry pairs, grouped by path in sorted order. */
export function treeOf(...pairs: readonly (readonly [string, RenderedEntry])[]): RenderTree {
  const grouped = new Map<string, RenderedEntry[]>();
  for (const [path, entry] of pairs) grouped.set(path, [...(grouped.get(path) ?? []), entry]);
  return new Map([...grouped].sort(([left], [right]) => compareText(left, right)));
}

/** A snapshot of text files by path. */
export function snapshotOf(files: Readonly<Record<string, string>> = {}): Map<string, PathState> {
  return new Map(Object.entries(files).map(([path, content]) => [path, { kind: 'file', content }]));
}

/** The snapshot a plan leaves behind once applied, computed without any IO. */
export function applied(snapshot: Snapshot, plan: Plan): Map<string, PathState> {
  const next = new Map(snapshot);
  for (const [path, content] of plan.writes) {
    if (content === null) next.delete(path);
    else next.set(path, { kind: 'file', content });
  }
  return next;
}

/** The text content of a path in a snapshot; throws when it is not a text file. */
export function textAt(snapshot: Snapshot, path: string): string {
  const state = snapshot.get(path);
  if (state?.kind !== 'file') throw new Error(`No text file at ${path}.`);
  return state.content;
}

/** Each operation as `<kind> <path>[#<entry>]`, for compact assertions. */
export function opsOf(plan: Plan): string[] {
  return plan.ops.map((op) => `${op.kind} ${op.path}${op.entry === undefined ? '' : `#${op.entry}`}`);
}

/** Plans an install, applies it to the snapshot in memory, and returns both. */
export function planAndApply(
  tree: RenderTree,
  snapshot: Snapshot,
  plan?: Plan,
): { plan: Plan; snapshot: Map<string, PathState> } {
  const first = planInstall(tree, snapshot, plan?.lock, CONTEXT);
  return { plan: first, snapshot: applied(snapshot, first) };
}
