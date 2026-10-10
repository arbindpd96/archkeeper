import type { Plan } from './plan.js';
import type { PlanOp } from './plan-types.js';
import { compareText } from './text.js';

/** How a path fares in a plan, as #27 groups it: created, modified, left with a sidecar, or left as it is. */
export type PlanGroup = 'create' | 'modify' | 'conflict' | 'skip';

/** The groups in the order a plan summary shows them. */
export const PLAN_GROUPS: readonly PlanGroup[] = ['create', 'modify', 'conflict', 'skip'];

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
