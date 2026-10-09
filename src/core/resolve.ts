import { BRAND, type Brand } from './brand.js';
import { configPath } from './config.js';
import { ResolveError } from './errors.js';
import { installOrder } from './install-order.js';
import type { Catalog, KitModule, Preset } from './loader.js';
import { optionDefaults, type ResolvedOptions } from './options.js';
import type { Stack } from './schema-parts.js';
import { compareText } from './text.js';
import { whenMismatch } from './when.js';

/** What to install: a preset adjusted by `add` and `remove`, for a stack, with resolved option values. */
export interface ResolveRequest {
  readonly preset: string;
  readonly stack: readonly Stack[];
  readonly add?: readonly string[];
  readonly remove?: readonly string[];
  readonly options?: ResolvedOptions;
}

/** A selected module left out because its `when` does not hold, with the reason for the CLI to show. */
export interface DroppedModule {
  readonly id: string;
  readonly reason: string;
}

/** The modules to install, in install order, and the ones left out. */
export interface Resolution {
  readonly preset: Preset;
  readonly modules: readonly KitModule[];
  readonly dropped: readonly DroppedModule[];
}

/** Why a module was selected: named by the preset or `modules.add`, or required by another module. */
type Origin = { readonly label: string } | { readonly requiredBy: string };

interface Context {
  readonly request: ResolveRequest;
  readonly catalog: Catalog;
  readonly config: string;
  readonly origins: Map<string, Origin>;
}

interface Failure {
  readonly file: string;
  readonly location: string;
  readonly chain: readonly string[];
  readonly problem: string;
  readonly hint: string;
}

function fail({ file, location, chain, problem, hint }: Failure): never {
  const shown = chain.length === 0 ? problem : `${problem}: ${chain.join(' → ')}`;
  throw new ResolveError({ file, location, problem: shown, hint, chain });
}

function chainOf(id: string, origins: ReadonlyMap<string, Origin>): string[] {
  const chain = [id];
  let origin = origins.get(id);
  while (origin !== undefined && 'requiredBy' in origin) {
    chain.unshift(origin.requiredBy);
    origin = origins.get(origin.requiredBy);
  }
  if (origin !== undefined) chain.unshift(origin.label);
  return chain;
}

function knownIds(catalog: Catalog): string {
  return [...catalog.modules.keys()].join(', ');
}

function findPreset({ request, catalog, config }: Context): Preset {
  const preset = catalog.presets.find((candidate) => candidate.name === request.preset);
  if (preset !== undefined) return preset;
  const names = catalog.presets.map((candidate) => candidate.name).join(', ');
  return fail({
    file: config,
    location: 'preset',
    chain: [],
    problem: `"${request.preset}" is not a preset`,
    hint: `use one of ${names}`,
  });
}

function checkRequestedIds({ request, catalog, config }: Context): void {
  for (const [list, ids] of [
    ['add', request.add ?? []],
    ['remove', request.remove ?? []],
  ] as const) {
    const index = ids.findIndex((id) => !catalog.modules.has(id));
    if (index === -1) continue;
    const problem = `"${ids[index] ?? ''}" is not a module`;
    fail({
      file: config,
      location: `modules.${list}[${String(index)}]`,
      chain: [],
      problem,
      hint: `use one of ${knownIds(catalog)}`,
    });
  }
  const both = (request.remove ?? []).findIndex((id) => (request.add ?? []).includes(id));
  if (both === -1) return;
  const problem = `"${request.remove?.[both] ?? ''}" is also in modules.add`;
  fail({
    file: config,
    location: `modules.remove[${String(both)}]`,
    chain: [],
    problem,
    hint: 'list it in add or in remove, not both',
  });
}

function seed(context: Context, preset: Preset): void {
  const removed = new Set(context.request.remove ?? []);
  for (const [id, kit] of context.catalog.modules) {
    if (kit.manifest.presets.includes(preset.name) && !removed.has(id))
      context.origins.set(id, { label: `preset ${preset.name}` });
  }
  for (const id of context.request.add ?? []) {
    if (!context.origins.has(id)) context.origins.set(id, { label: 'modules.add' });
  }
}

function requireModule(context: Context, kit: KitModule, index: number): string | undefined {
  const { catalog, config, origins, request } = context;
  const id = kit.manifest.requires[index] ?? '';
  const chain = [...chainOf(kit.manifest.id, origins), id];
  if (!catalog.modules.has(id)) {
    const hint = `fix the id in ${kit.file}, or add modules/${id}/module.json`;
    fail({
      file: kit.file,
      location: `requires[${String(index)}]`,
      chain,
      problem: `requires "${id}", which is not a module`,
      hint,
    });
  }
  const removed = (request.remove ?? []).indexOf(id);
  if (removed !== -1) {
    const hint = `keep ${id}, or also remove ${kit.manifest.id}`;
    fail({
      file: config,
      location: `modules.remove[${String(removed)}]`,
      chain,
      problem: `removes "${id}", which is required`,
      hint,
    });
  }
  if (origins.has(id)) return undefined;
  origins.set(id, { requiredBy: kit.manifest.id });
  return id;
}

function addRequirements(context: Context): void {
  const queue = [...context.origins.keys()].sort();
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const kit = context.catalog.modules.get(next);
    for (let index = 0; kit !== undefined && index < kit.manifest.requires.length; index += 1) {
      const added = requireModule(context, kit, index);
      if (added !== undefined) queue.push(added);
    }
  }
}

function unmatched({ request, catalog, origins }: Context): Map<string, string> {
  const dropped = new Map<string, string>();
  for (const id of [...origins.keys()].sort()) {
    const manifest = catalog.modules.get(id)?.manifest;
    if (manifest === undefined) continue;
    const options = request.options?.get(id) ?? optionDefaults(manifest);
    const reason = whenMismatch(manifest.when, request.stack, options);
    if (reason !== undefined) dropped.set(id, reason);
  }
  return dropped;
}

// A module that requires a left-out module is left out too, until nothing changes.
function dropUnmatched(context: Context): Map<string, string> {
  const dropped = unmatched(context);
  const requires = (id: string): readonly string[] =>
    context.catalog.modules.get(id)?.manifest.requires ?? [];
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...context.origins.keys()].sort().filter((candidate) => !dropped.has(candidate))) {
      const missing = requires(id).find((required) => dropped.has(required));
      if (missing === undefined) continue;
      dropped.set(id, `requires ${missing}, which was left out`);
      changed = true;
    }
  }
  return dropped;
}

function checkConflicts({ config, origins }: Context, kept: ReadonlyMap<string, KitModule>): void {
  for (const [id, kit] of kept) {
    const index = kit.manifest.conflicts.findIndex((other) => kept.has(other));
    if (index === -1) continue;
    const other = kit.manifest.conflicts[index] ?? '';
    const problem = `conflicts with "${other}" (${chainOf(other, origins).join(' → ')}), and both are selected`;
    const hint = `leave one of them out with modules.remove in ${config}`;
    fail({
      file: kit.file,
      location: `conflicts[${String(index)}]`,
      chain: chainOf(id, origins),
      problem,
      hint,
    });
  }
}

/**
 * Resolves a preset plus `add` and `remove` into the modules to install (#19): requirements are added,
 * modules whose `when` does not hold are left out with a reason, and the result is in install order with ties
 * broken by id. A missing dependency, a cycle or a conflict throws ResolveError that shows the chain and a fix.
 */
export function resolveModules(request: ResolveRequest, catalog: Catalog, brand: Brand = BRAND): Resolution {
  const context: Context = { request, catalog, config: configPath(brand), origins: new Map() };
  const preset = findPreset(context);
  checkRequestedIds(context);
  seed(context, preset);
  addRequirements(context);
  const dropped = dropUnmatched(context);
  const kept = new Map(
    [...context.origins.keys()]
      .filter((id) => !dropped.has(id))
      .sort()
      .flatMap((id) => {
        const kit = catalog.modules.get(id);
        return kit === undefined ? [] : [[id, kit] as const];
      }),
  );
  checkConflicts(context, kept);
  const reasons = [...dropped]
    .sort(([left], [right]) => compareText(left, right))
    .map(([id, reason]) => ({ id, reason }));
  return { preset, modules: installOrder(kept), dropped: reasons };
}
