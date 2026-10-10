import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectView } from '../src/cli/project-view.js';
import { detectStack } from '../src/core/detect.js';
import type { KitModule } from '../src/core/loader.js';
import { projectValues } from '../src/core/project-values.js';
import { render, type RenderTree } from '../src/core/render.js';
import { REPO_ROOT } from './helpers.js';
import { KIT } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const MODULE_IDS = readdirSync(path.join(REPO_ROOT, 'modules'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const FIXTURES = ['ts-app', 'py-app'];
const SNAPSHOTS = path.join(REPO_ROOT, 'test/__snapshots__/modules');

// A module renders with the modules it requires, as ADR-0003 asks: on its own, never with a whole preset.
function withRequires(id: string, found = new Map<string, KitModule>()): KitModule[] {
  const kit = KIT.modules.get(id);
  if (kit === undefined || found.has(id)) return [...found.values()];
  found.set(id, kit);
  for (const required of kit.manifest.requires) withRequires(required, found);
  return [...found.values()];
}

function treeText(tree: RenderTree): string {
  return [...tree]
    .flatMap(([file, entries]) =>
      entries.map(({ strategy, module, blockId, content }) => {
        const block = blockId === undefined ? '' : `, block ${blockId}`;
        return `=== ${file} (${strategy}, ${module}${block})\n${content}`;
      }),
    )
    .join('');
}

function renderedOn(id: string, fixture: string): string {
  const profile = detectStack(projectView(realpathSync.native(path.join(REPO_ROOT, 'examples', fixture))));
  const values = projectValues(profile, profile.stack);
  return `##### ${id} on examples/${fixture}\n${treeText(render(withRequires(id), { stack: profile.stack, values }, TEST_BRAND))}`;
}

describe.each(MODULE_IDS)('module %s (#29, ADR-0003)', (id) => {
  it('renders alone with its requirements against ts-app and py-app as its snapshot shows', async () => {
    const text = FIXTURES.map((fixture) => renderedOn(id, fixture)).join('\n');
    await expect(text).toMatchFileSnapshot(`__snapshots__/modules/${id}.txt`);
  });
});

describe('module snapshots', () => {
  it('belong only to modules that exist, so a removed module takes its snapshot along', () => {
    // Vitest writes new file snapshots once this file finishes, so the folder can still be missing on a first run.
    const files = existsSync(SNAPSHOTS) ? readdirSync(SNAPSHOTS) : [];
    const snapshots = files.map((file) => file.replace(/\.txt$/, ''));
    expect(snapshots.filter((name) => !MODULE_IDS.includes(name))).toEqual([]);
  });
});
