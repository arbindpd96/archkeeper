import path from 'node:path';
import type { KitModule } from '../core/loader.js';
import type { Lock } from '../core/lock.js';
import { mapValues } from '../core/map-seed.js';
import { projectValues } from '../core/project-values.js';
import type { Stack } from '../core/schema-parts.js';
import type { StackProfile } from '../core/stack-profile.js';
import type { TemplateScope } from '../core/template.js';
import type { InitRun } from './init-run.js';
import { lstatOrUndefined } from './project-files.js';
import { projectView } from './project-view.js';

const MAP_MODULE = 'architecture-map';

/** What says whether init may still write the map: the modules it installs and the lock the last apply left. */
export interface MapState {
  readonly kits: readonly KitModule[];
  readonly lock: Lock | undefined;
}

// The map is create-only, so init writes it only where nothing is at its path yet and the lock does not record it,
// as written once, which makes a missing file the user's removal, or as removed (ADR-0014); only then are the files
// git tracks, which can take 5 s and 32 MiB to list in a large repository, worth listing.
function seedsMap(rootReal: string, { kits, lock }: MapState): boolean {
  const files = kits.find((kit) => kit.manifest.id === MAP_MODULE)?.manifest.files ?? [];
  const target = files.find((file) => file.strategy === 'create-only')?.to;
  if (target === undefined || lock?.files.has(target) === true) return false;
  if (lock?.removed.some((removal) => removal.path === target) === true) return false;
  return lstatOrUndefined(path.join(rootReal, ...target.split('/'))) === undefined;
}

/**
 * The template values init renders with: AGENTS.md's commands and docs (#28) and the architecture map's seed
 * (#36), whose folder table comes from the files git tracks, listed before planning, `--dry-run` included, and only
 * while init may still write the map: its module is among the kits, nothing is at its create-only path yet, and the
 * previous lock records that path neither as written nor as removed.
 */
export function initValues(
  run: InitRun,
  profile: StackProfile,
  stack: readonly Stack[],
  map: MapState,
): TemplateScope {
  const tracked = seedsMap(run.rootReal, map) ? run.session.context.trackedFiles(run.rootReal) : undefined;
  return {
    ...projectValues(profile, stack),
    ...mapValues(profile, projectView(run.rootReal), tracked, run.brand),
  };
}
