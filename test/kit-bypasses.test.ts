import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { ManifestError, RenderError } from '../src/core/errors.js';
import { importProblem } from '../src/core/imports.js';
import { type KitModule, loadModule } from '../src/core/loader.js';
import { render } from '../src/core/render.js';
import { toImport } from '../src/core/template.js';
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

describe('@ imports the kit never writes', () => {
  it.each([
    '`a`@~/.ssh/id_rsa',
    '*a*@/etc/passwd',
    '_a_@C:/x.md',
    '[a](b)@../../x.md',
    'see@docs/../../x.md',
  ])('finds an import of an outside file in %j', (text) => {
    expect(importProblem(text)).toContain('outside the project');
  });

  it.each([
    'jest @.env',
    '@./.env',
    '@config/.env.local',
    '`x`@CLAUDE.local.md',
    '@.claude/settings.local.json',
  ])('finds an import of a private file in %j', (text) => {
    expect(importProblem(text)).toContain('secrets or personal file');
  });

  it.each([
    '@AGENTS.md',
    'npm i @scope/pkg',
    'mail me@example.com',
    '@Design\\ Docs/api.md',
    '@.env.example',
  ])('allows %j', (text) => {
    expect(importProblem(text)).toBeUndefined();
  });

  it.each(['.env', 'docs/.env.local', 'Design Docs/.env'])('toImport refuses the private file %j', (path) => {
    expect(() => toImport(path)).toThrow(RenderError);
  });

  it('refuses an import that two values form only side by side', () => {
    const notes: KitModule = loadModule(
      'm',
      memoryReader({
        'modules/m/module.json': JSON.stringify(
          plainManifest('m', { files: [{ from: 'a.md', to: 'a.md', strategy: 'owned', target: 'project' }] }),
        ),
        'modules/m/files/a.md': 'Run {{cmd.a}}{{cmd.b}}\n',
      }),
    );
    const values = { cmd: { a: 'npm test @', b: '~/.ssh/id_rsa' } };
    expect(() => render([notes], { stack: [], values })).toThrow(
      'a.md: would get an @ import of a file outside',
    );
  });
});
