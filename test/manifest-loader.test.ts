import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { ManifestError } from '../src/core/errors.js';
import { loadCatalog, loadModule } from '../src/core/loader.js';
import {
  entry,
  kitFiles,
  type ManifestData,
  memoryReader,
  plainManifest,
  PRESETS,
  richManifest,
  richSources,
} from './kit-fixtures.js';

type Change = (manifest: ManifestData) => void;

function failure(run: () => unknown): ManifestError {
  try {
    run();
  } catch (error) {
    if (error instanceof ManifestError) return error;
    throw error;
  }
  throw new Error('no ManifestError was thrown');
}

function loadRich(change: Change, sources = richSources()): ManifestError {
  const manifest = richManifest();
  change(manifest);
  const read = memoryReader({ 'modules/rich/module.json': JSON.stringify(manifest), ...sources });
  return failure(() => loadModule('rich', read));
}

function files(manifest: ManifestData): Record<string, unknown>[] {
  return manifest.files as Record<string, unknown>[];
}

describe('loadModule cross-field rules', () => {
  it.each<[string, Change, string, string]>([
    [
      'both demo and internal',
      (m) => (m.demo = { tape: 'init', section: 'Quick start' }),
      'internal',
      'declare demo',
    ],
    ['neither demo nor internal', (m) => delete m.internal, '', 'internal: true'],
    [
      'a repeated requires entry',
      (m) => (m.requires = ['base', 'base']),
      'requires[1]',
      'list each entry once',
    ],
    [
      'a repeated target path',
      (m) => files(m).push({ to: 'AGENTS.md', strategy: 'blocks', target: 'project' }),
      'files[6]',
      'once',
    ],
    [
      'a repeated deny rule',
      (m) => (m.permissions = { deny: ['Bash(x)', 'Bash(x)'] }),
      'permissions.deny[1]',
      'once',
    ],
    ['a module that requires itself', (m) => (m.requires = ['rich']), 'requires[0]', 'remove it'],
    ['a module that conflicts with itself', (m) => (m.conflicts = ['rich']), 'conflicts[0]', 'remove it'],
    [
      'a module both required and conflicting',
      (m) => (m.conflicts = ['base']),
      'conflicts[0]',
      'keep it in one list',
    ],
    [
      'a plugin target outside skills and agents',
      (m) => (entry(m, 'files', 0).to = 'docs/x.md'),
      'files[0].target',
      'ADR-0016',
    ],
    [
      'a block in an undeclared file',
      (m) => (entry(m, 'blocks', 0).file = 'CLAUDE.md'),
      'blocks[0].file',
      'strategy: "blocks"',
    ],
    ['hooks without settings.json declared', (m) => files(m).splice(4, 1), 'hooks', '.claude/settings.json'],
    [
      'permissions without settings.json declared',
      (m) => {
        m.hooks = [];
        files(m).splice(4, 1);
      },
      'permissions',
      'json',
    ],
    ['MCP servers without .mcp.json declared', (m) => files(m).splice(5, 1), 'mcpServers', '.mcp.json'],
    ['gitignore lines without .gitignore declared', (m) => files(m).splice(3, 1), 'gitignore', '.gitignore'],
    [
      'a block that takes the gitignore block id',
      (m) => (m.blocks = [{ file: '.gitignore', id: 'rich', template: 'agents.md' }]),
      'blocks[0].id',
      'another id',
    ],
    [
      'a when option the module does not declare',
      (m) => (entry(m, 'files', 1).when = { options: { nope: true } }),
      'files[1].when.options.nope',
      'declare it in options',
    ],
    [
      'a when option named like an inherited member',
      (m) => (m.when = { options: { constructor: true } }),
      'when.options.constructor',
      'declare it in options',
    ],
    [
      'a when option compared with the wrong type',
      (m) => (entry(m, 'files', 1).when = { options: { blockNoVerify: 'yes' } }),
      'files[1].when.options.blockNoVerify',
      'compare it with a boolean',
    ],
    [
      'a when that compares a string-list option',
      (m) => (entry(m, 'files', 1).when = { options: { optOut: 'x' } }),
      'files[1].when.options.optOut',
      'a when can compare only those',
    ],
    ['an id that differs from its folder', (m) => (m.id = 'other'), 'id', 'set id to "rich"'],
  ])('rejects %s', (_name, change, location, fix) => {
    const error = loadRich(change);
    expect(error.location).toBe(location);
    expect(error.hint).toContain(fix);
  });

  it.each<[string, string, string]>([
    ['settings.json as an owned template', '.claude/settings.json', 'strategy json'],
    ['.mcp.json as a create-only template', '.mcp.json', 'strategy json'],
    ['settings.json spelled in another case', '.Claude/Settings.JSON', 'strategy json'],
    ['the personal settings file', '.claude/settings.local.json', 'never writes personal settings'],
    ['a git hook', '.git/hooks/pre-commit', 'never writes into .git'],
    ['a nested .git folder', 'packages/app/.GIT/config', 'never writes into .git'],
    ['a file in the state folder', `${BRAND.stateDir}/config.json`, 'another folder'],
    ['a file in the state folder by brand variable', '{{brand.stateDir}}/local/x', 'another folder'],
    ['a file in the hook folder', `${BRAND.hookDir}/guard.mjs`, 'another folder'],
    ['a file in the hook folder by brand variable', '{{brand.hookDir}}/guard.mjs', 'another folder'],
    ['a file in the state folder by a spaced brand variable', '{{ brand.stateDir }}/x.md', 'another folder'],
  ])('rejects %s as the target of a file written from a template', (_name, to, fix) => {
    const error = loadRich((m) => (entry(m, 'files', 1).to = to));
    expect(error.location).toBe('files[1].to');
    expect(error.hint).toContain(fix);
  });

  it('rejects a reserved target for an owned and a blocks file too', () => {
    expect(loadRich((m) => (entry(m, 'files', 0).to = '.git/x')).location).toBe('files[0].to');
    expect(loadRich((m) => (entry(m, 'files', 2).to = '.mcp.json')).location).toBe('files[2].to');
  });

  it.each([
    'Bash(npm test)',
    'Bash(node:*)',
    'Bash(sh -c:*)',
    'Edit(.claude/**)',
    'Write(.git/hooks/*)',
    'Read(//etc/**)',
    'Read(**/.en*)',
    'WebFetch(domain:*)',
    'mcp__docs__search',
  ])('rejects the allow rule %s, since modules add none yet', (rule) => {
    const error = loadRich((m) => (m.permissions = { allow: [rule] }));
    expect(error.location).toBe('permissions.allow[0]');
    expect(error.message).toContain('skip the permission prompt');
    expect(error.hint).toContain('move it to ask');
  });

  it('accepts ask and deny rules', () => {
    const manifest = richManifest();
    manifest.permissions = { ask: ['Bash(git push:*)'], deny: ['Read(**/.env)', 'Bash(rm -rf:*)'] };
    const read = memoryReader({ 'modules/rich/module.json': JSON.stringify(manifest), ...richSources() });
    expect(loadModule('rich', read).manifest.permissions).toEqual(manifest.permissions);
  });

  it.each(['.github/notes.md', '.claude/settings.md', `${BRAND.stateDir}-notes/x.md`, 'docs/.gitkeep'])(
    'accepts %s, which only looks like a reserved target',
    (to) => {
      const manifest = richManifest();
      entry(manifest, 'files', 1).to = to;
      const read = memoryReader({ 'modules/rich/module.json': JSON.stringify(manifest), ...richSources() });
      expect(loadModule('rich', read).manifest.files[1]?.to).toBe(to);
    },
  );

  it.each([
    ['a template', 'modules/rich/files/notes.md', 'files[1].from'],
    ['a block template', 'modules/rich/files/agents.md', 'blocks[0].template'],
    ['a hook script', 'dist/hooks/guard-bash.mjs', 'hooks[0].script'],
  ])('rejects %s that does not exist', (_name, missing, location) => {
    const sources = Object.fromEntries(Object.entries(richSources()).filter(([path]) => path !== missing));
    const error = loadRich(() => undefined, sources);
    expect(error.location).toBe(location);
    expect(error.message).toContain(`names ${missing}, which does not exist`);
  });

  it('keeps the text of every template and hook script it references', () => {
    const read = memoryReader({
      'modules/rich/module.json': JSON.stringify(richManifest()),
      ...richSources(),
    });
    expect([...loadModule('rich', read).sources.keys()].sort()).toEqual(Object.keys(richSources()).sort());
  });
});

describe('loadModule files', () => {
  it('reports a JSON syntax error with its line and column', () => {
    const read = memoryReader({
      'modules/base/module.json': '{\n  "id": "base",\n  "internal": true\n  "x": 1\n}',
    });
    const error = failure(() => loadModule('base', read));
    expect(error.location).toBe('line 4, column 3');
    expect(error.message).toContain('is not valid JSON (comma expected)');
  });

  it('locates a syntax error that JSON.parse reports without a position', () => {
    const read = memoryReader({ 'modules/base/module.json': '{"id":}' });
    expect(failure(() => loadModule('base', read)).location).toBe('line 1, column 7');
  });

  it('reports a missing manifest', () => {
    const error = failure(() => loadModule('base', memoryReader({})));
    expect(error.message).toBe('modules/base/module.json: does not exist\nTry: restore the file');
  });

  it('accepts a manifest that starts with a byte-order mark', () => {
    const text = `${String.fromCodePoint(0xfeff)}${JSON.stringify(plainManifest('base'))}`;
    expect(loadModule('base', memoryReader({ 'modules/base/module.json': text })).manifest.id).toBe('base');
  });
});

describe('loadCatalog', () => {
  const small = plainManifest('base', { presets: ['small', 'medium', 'full'] });

  it('loads every module in id order with the presets in chain order', () => {
    const catalog = loadCatalog(['zeta', 'base'], memoryReader(kitFiles([plainManifest('zeta'), small])));
    expect([...catalog.modules.keys()]).toEqual(['base', 'zeta']);
    expect(catalog.presets.map((preset) => preset.name)).toEqual(['small', 'medium', 'full']);
    expect(catalog.defaultPreset).toBe('medium');
  });

  it.each<[string, ManifestData, string, string]>([
    [
      'an unknown preset',
      plainManifest('base', { presets: ['tiny'] }),
      'presets[0]',
      'use small, medium, full',
    ],
    [
      'a gap in the preset chain',
      plainManifest('base', { presets: ['small', 'full'] }),
      'presets',
      'add "medium"',
    ],
    [
      'a conflict with an id that is not a module',
      plainManifest('base', { presets: ['small', 'medium', 'full'], conflicts: ['formater'] }),
      'conflicts[0]',
      'use one of base',
    ],
  ])('rejects a module with %s', (_name, manifest, location, fix) => {
    const error = failure(() => loadCatalog(['base'], memoryReader(kitFiles([manifest]))));
    expect(error.file).toBe('modules/base/module.json');
    expect(error.location).toBe(location);
    expect(error.hint).toContain(fix);
  });

  it.each<[string, unknown, string, string]>([
    [
      'a default that is not a preset',
      { ...PRESETS, default: 'huge' },
      'default',
      'use one of small, medium, full',
    ],
    [
      'a repeated preset',
      { ...PRESETS, presets: [...PRESETS.presets, PRESETS.presets[0]] },
      'presets[3].name',
      'once',
    ],
    [
      'a SessionStart cap over the hook output limit',
      {
        default: 'small',
        presets: [{ name: 'small', description: 'S.', defaults: { sessionStartCap: 20_000 } }],
      },
      'presets[0].defaults.sessionStartCap',
      '10,000-character',
    ],
  ])('rejects presets.json with %s', (_name, presets, location, fix) => {
    const files = { ...kitFiles([small]), 'modules/presets.json': JSON.stringify(presets) };
    const error = failure(() => loadCatalog(['base'], memoryReader(files)));
    expect(error.file).toBe('modules/presets.json');
    expect(error.location).toBe(location);
    expect(error.hint).toContain(fix);
  });
});
