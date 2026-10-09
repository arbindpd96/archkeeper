import { ResolveError } from './errors.js';
import type { KitModule } from './loader.js';

function byId(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function cycleFrom(start: string, remaining: ReadonlyMap<string, KitModule>): string[] {
  const path = [start];
  let current = start;
  for (;;) {
    const next = remaining
      .get(current)
      ?.manifest.requires.filter((id) => remaining.has(id))
      .sort(byId)[0];
    if (next === undefined) return path;
    const seen = path.indexOf(next);
    if (seen !== -1) return [...path.slice(seen), next];
    path.push(next);
    current = next;
  }
}

function cycleError(remaining: ReadonlyMap<string, KitModule>): ResolveError {
  const [start = ''] = [...remaining.keys()].sort(byId);
  const cycle = cycleFrom(start, remaining);
  const first = remaining.get(cycle[0] ?? start);
  return new ResolveError({
    file: first?.file ?? '',
    location: 'requires',
    problem: `the modules require each other in a cycle: ${cycle.join(' → ')}`,
    hint: 'remove one of these requires, so the modules can be installed in order',
    chain: cycle,
  });
}

/**
 * Orders modules so that each comes after everything it requires, breaking ties by id, so the order never
 * depends on the input order (#19). A cycle throws ResolveError that shows it.
 */
export function installOrder(modules: ReadonlyMap<string, KitModule>): KitModule[] {
  const remaining = new Map(modules);
  const ordered: KitModule[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((kit) => kit.manifest.requires.every((id) => !remaining.has(id)))
      .map((kit) => kit.manifest.id)
      .sort(byId)[0];
    const next = ready === undefined ? undefined : remaining.get(ready);
    if (next === undefined) throw cycleError(remaining);
    ordered.push(next);
    remaining.delete(next.manifest.id);
  }
  return ordered;
}
