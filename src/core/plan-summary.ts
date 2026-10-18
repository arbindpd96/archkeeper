import { BRAND, type Brand } from './brand.js';
import type { Plan } from './plan.js';
import type { PlanOp } from './plan-types.js';
import { sidecarPath } from './sidecar.js';
import { compareText } from './text.js';

/** How a path fares in a plan, as #27 groups it: created, modified, left with a sidecar, or left as it is. */
export type PlanGroup = 'create' | 'modify' | 'conflict' | 'skip';

const PLAN_GROUPS: readonly PlanGroup[] = ['create', 'modify', 'conflict', 'skip'];

/** One project path of a plan with its group and its operations. */
export interface PathSummary {
  readonly path: string;
  readonly group: PlanGroup;
  readonly ops: readonly PlanOp[];
}

function groupOf(plan: Plan, path: string, ops: readonly PlanOp[]): PlanGroup {
  if (ops.some((op) => op.kind === 'sidecar')) return 'conflict';
  if (!plan.writes.has(path)) return 'skip';
  return plan.expected.get(path) === null ? 'create' : 'modify';
}

/**
 * The sidecars a plan leaves waiting for review (ADR-0014): one written now, and one from an earlier run whose
 * kit version the lock still holds as `pending`, which a re-run plans as a skip. Sorted, each named once.
 */
export function pendingSidecars(plan: Plan, brand: Pick<Brand, 'sidecarSuffix'> = BRAND): string[] {
  const written = plan.ops.filter((op) => op.kind === 'sidecar').map((op) => op.path);
  const files = [...plan.lock.files].filter(([, entry]) => entry.pending !== undefined).map(([path]) => path);
  const blocks = [...plan.lock.blocks]
    .filter(([, entries]) => [...entries.values()].some((entry) => entry.pending !== undefined))
    .map(([path]) => path);
  const paths = new Set([...written, ...files, ...blocks]);
  return [...paths].sort(compareText).map((path) => sidecarPath(path, brand));
}

/**
 * Groups a plan's operations by project path (#27): `conflict` when the kit's version goes to a sidecar, `create`
 * when the path is new, `modify` when an existing file changes, and `skip` when the plan leaves it as it is. Paths
 * come in group order, then path order.
 */
export function summarizePlan(plan: Plan): PathSummary[] {
  const byPath = new Map<string, PlanOp[]>();
  for (const op of plan.ops) byPath.set(op.path, [...(byPath.get(op.path) ?? []), op]);
  const summaries = [...byPath].map(([path, ops]) => ({ path, group: groupOf(plan, path, ops), ops }));
  const rank = (group: PlanGroup): number => PLAN_GROUPS.indexOf(group);
  return summaries.sort(
    (left, right) => rank(left.group) - rank(right.group) || compareText(left.path, right.path),
  );
}

/**
 * One row of init's short plan: one path with its summary, a group's files at the project root by name, or how many
 * of a group's files one top-level folder holds.
 */
export type PlanRow =
  | { readonly kind: 'path'; readonly summary: PathSummary }
  | { readonly kind: 'root'; readonly group: PlanGroup; readonly names: readonly string[] }
  | { readonly kind: 'folder'; readonly group: PlanGroup; readonly folder: string; readonly count: number };

const CONDENSED_GROUPS: readonly PlanGroup[] = ['create', 'skip'];

function topFolder(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function folderRow(group: PlanGroup, folder: string, summaries: readonly PathSummary[]): PlanRow {
  if (folder === '') return { kind: 'root', group, names: summaries.map((summary) => summary.path) };
  const [first, ...others] = summaries;
  if (first !== undefined && others.length === 0) return { kind: 'path', summary: first };
  return { kind: 'folder', group, folder, count: summaries.length };
}

function rowsByFolder(group: PlanGroup, summaries: readonly PathSummary[]): PlanRow[] {
  const byFolder = new Map<string, PathSummary[]>();
  for (const summary of summaries) {
    const folder = topFolder(summary.path);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), summary]);
  }
  return [...byFolder]
    .sort(([left], [right]) => compareText(left, right))
    .map(([folder, inFolder]) => folderRow(group, folder, inFolder));
}

/**
 * The short plan init prints by default. The kit's new and unchanged files, `create` and `skip`, become a row of the
 * group's root files by name and a count per top-level folder, a folder of one file showing its path; each `modify`
 * and `conflict` path keeps its own row, since those touch the user's own files. Rows come in group order, then the
 * root files, then folders and paths in text order, whatever the order of `summaries`.
 */
export function condensePlan(summaries: readonly PathSummary[]): readonly PlanRow[] {
  return PLAN_GROUPS.flatMap((group) => {
    const inGroup = summaries
      .filter((summary) => summary.group === group)
      .sort((left, right) => compareText(left.path, right.path));
    if (CONDENSED_GROUPS.includes(group)) return rowsByFolder(group, inGroup);
    return inGroup.map((summary): PlanRow => ({ kind: 'path', summary }));
  });
}
