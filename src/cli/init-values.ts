import { mapValues } from '../core/map-seed.js';
import { projectValues } from '../core/project-values.js';
import type { Stack } from '../core/schema-parts.js';
import type { StackProfile } from '../core/stack-profile.js';
import type { TemplateScope } from '../core/template.js';
import type { InitRun } from './init-run.js';
import { projectView } from './project-view.js';

const MAP_MODULE = 'architecture-map';

/**
 * The template values init renders with: AGENTS.md's commands and docs (#28) and the architecture map's seed
 * (#36), whose folder table comes from the files git tracks, listed before planning, `--dry-run` included, and only
 * when `modules` holds the map's module, the one template that reads them.
 */
export function initValues(
  run: InitRun,
  profile: StackProfile,
  stack: readonly Stack[],
  modules: readonly string[],
): TemplateScope {
  const tracked = modules.includes(MAP_MODULE) ? run.session.context.trackedFiles(run.rootReal) : undefined;
  return {
    ...projectValues(profile, stack),
    ...mapValues(profile, projectView(run.rootReal), tracked, run.brand),
  };
}
