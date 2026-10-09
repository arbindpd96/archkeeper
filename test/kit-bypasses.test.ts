import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { ManifestError } from '../src/core/errors.js';
import { loadModule } from '../src/core/loader.js';
import { render } from '../src/core/render.js';
import {
  entry,
  type ManifestData,
  memoryReader,
  plainManifest,
  richManifest,
  richSources,
} from './kit-fixtures.js';

type Change = (manifest: ManifestData) => void;

function loadRich(change: Change): ReturnType<typeof loadModule> {
  const manifest = richManifest();
  change(manifest);
  return loadModule(
    'rich',
    memoryReader({ 'modules/rich/module.json': JSON.stringify(manifest), ...richSources() }),
  );
}

function refusal(change: Change): ManifestError {
  try {
    loadRich(change);
  } catch (error) {
    if (error instanceof ManifestError) return error;
    throw error;
  }
  throw new Error('the manifest loaded without an error');
}

describe('template targets that Claude Code reads from a subfolder or as secrets', () => {
  it.each<[string, string]>([
    ['pkg/.claude/settings.json', 'in a subfolder'],
    ['pkg/.mcp.json', 'in a subfolder'],
    ['pkg/.claude/settings.local.json', 'never writes personal settings'],
    ['deploy/app.env', 'which holds secrets'],
    ['.env-local', 'which holds secrets'],
    ['.env_prod', 'which holds secrets'],
    [`x${BRAND.sidecarSuffix}/y.md`, "the suffix of the kit's sidecars"],
  ])('refuses %j', (to, reason) => {
    expect(refusal((m) => (entry(m, 'files', 1).to = to)).message).toContain(reason);
  });

  it('refuses a name ending in the sidecar suffix of a legacy slug', () => {
    const module = loadModule(
      'm',
      memoryReader({
        'modules/m/module.json': JSON.stringify(
          plainManifest('m', {
            files: [{ from: 'a.md', to: 'a.md.oldkit-new', strategy: 'owned', target: 'project' }],
          }),
        ),
        'modules/m/files/a.md': 'A\n',
      }),
    );
    expect(() => render([module], { stack: [] }, { ...BRAND, legacySlugs: ['oldkit'] })).toThrow(
      'taken for one',
    );
  });
});
