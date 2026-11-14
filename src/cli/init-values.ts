import path from 'node:path';
import type { KitModule } from '../core/loader.js';
import { mapValues } from '../core/map-seed.js';
import { projectValues } from '../core/project-values.js';
import type { Stack } from '../core/schema-parts.js';
import type { StackProfile } from '../core/stack-profile.js';
import type { TemplateScope } from '../core/template.js';
import type { InitRun } from './init-run.js';
import { lstatOrUndefined } from './project-files.js';
import { projectView } from './project-view.js';

const MAP_MODULE = 'architecture-map';

// The map is create-only, so init writes it only where nothing is at its path yet (ADR-0014), and only then are the
// files git tracks, which can take 5 s and 32 MiB to list in a large repository, worth listing.
function seedsMap(rootReal: string, kits: readonly KitModule[]): boolean {
  const files = kits.find((kit) => kit.manifest.id === MAP_MODULE)?.manifest.files ?? [];
  const target = files.find((file) => file.strategy === 'create-only')?.to;
  return target !== undefined && lstatOrUndefined(path.join(rootReal, ...target.split('/'))) === undefined;
}

/**
 * The template values init renders with: AGENTS.md's commands and docs (#28) and the architecture map's seed
 * (#36), whose folder table comes from the files git tracks, listed before planning, `--dry-run` included, and only
 * while init may still write the map: its module is among `kits` and nothing is at its create-only path yet.
 */
export function initValues(
  run: InitRun,
  profile: StackProfile,
  stack: readonly Stack[],
  kits: readonly KitModule[],
): TemplateScope {
  const tracked = seedsMap(run.rootReal, kits) ? run.session.context.trackedFiles(run.rootReal) : undefined;
  return {
    ...projectValues(profile, stack),
    ...mapValues(profile, projectView(run.rootReal), tracked, run.brand),
  };
}
