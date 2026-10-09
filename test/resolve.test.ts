import { describe, expect, it } from 'vitest';
import { configPath } from '../src/core/config.js';
import { ResolveError } from '../src/core/errors.js';
import { type Catalog, loadCatalog } from '../src/core/loader.js';
import { type ResolveRequest, resolveModules } from '../src/core/resolve.js';
import { kitFiles, type ManifestData, memoryReader, plainManifest } from './kit-fixtures.js';

const ALL = ['small', 'medium', 'full'];
const MEDIUM_UP = ['medium', 'full'];

function catalogOf(manifests: readonly ManifestData[]): Catalog {
  const ids = manifests.map((manifest) => String(manifest.id));
  return loadCatalog(ids, memoryReader(kitFiles(manifests)));
}

const CATALOG = catalogOf([
  plainManifest('base', { presets: ALL }),
  plainManifest('safety', { presets: ALL, requires: ['base'] }),
  plainManifest('alpha', { presets: ALL, requires: ['base'] }),
  plainManifest('knowledge', { presets: MEDIUM_UP, requires: ['base'] }),
  plainManifest('extras', { requires: ['knowledge'] }),
  plainManifest('python-rules', { presets: MEDIUM_UP, requires: ['base'], when: { stack: ['python'] } }),
  plainManifest('python-lint', { presets: ['full'], requires: ['python-rules'] }),
]);

function ids(request: ResolveRequest, catalog = CATALOG): string[] {
  return resolveModules(request, catalog).modules.map((kit) => kit.manifest.id);
}

function resolveError(request: ResolveRequest, catalog = CATALOG): ResolveError {
  try {
    resolveModules(request, catalog);
  } catch (error) {
    if (error instanceof ResolveError) return error;
    throw error;
  }
  throw new Error('the modules resolved without an error');
}

describe('resolveModules', () => {
  it('installs each module after what it requires, breaking ties by id', () => {
    expect(ids({ preset: 'medium', stack: ['ts', 'python'] })).toEqual([
      'base',
      'alpha',
      'knowledge',
      'python-rules',
      'safety',
    ]);
  });

  it('gives the same order whatever the order of the catalog and the request', () => {
    const manifests = [...CATALOG.modules.values()].map((kit): ManifestData => ({ ...kit.manifest }));
    const request = { preset: 'small', stack: [], add: ['extras', 'knowledge'] } as const;
    const expected = ids(request);
    for (const shuffled of [manifests.slice().reverse(), [...manifests.slice(3), ...manifests.slice(0, 3)]]) {
      expect(ids({ ...request, add: [...request.add].reverse() }, catalogOf(shuffled))).toEqual(expected);
    }
  });

  it('adds what an added module requires', () => {
    expect(ids({ preset: 'small', stack: ['ts'], add: ['extras'] })).toEqual([
      'base',
      'alpha',
      'knowledge',
      'extras',
      'safety',
    ]);
  });

  it('leaves out a module whose when does not match, with the reason, and the modules that need it', () => {
    const resolution = resolveModules({ preset: 'full', stack: ['ts'] }, CATALOG);
    expect(resolution.modules.map((kit) => kit.manifest.id)).not.toContain('python-rules');
    expect(resolution.dropped).toEqual([
      { id: 'python-lint', reason: 'requires python-rules, which was left out' },
      { id: 'python-rules', reason: 'needs the python stack, and the project stack is ts' },
    ]);
  });

  it('leaves out a module that only a left-out module required', () => {
    const catalog = catalogOf([
      plainManifest('base', { presets: ALL }),
      plainManifest('python-only', {
        presets: ALL,
        requires: ['python-helper'],
        when: { stack: ['python'] },
      }),
      plainManifest('python-helper', { requires: ['base'] }),
    ]);
    const resolution = resolveModules({ preset: 'small', stack: ['ts'] }, catalog);
    expect(resolution.modules.map((kit) => kit.manifest.id)).toEqual(['base']);
    expect(resolution.dropped).toEqual([
      { id: 'python-helper', reason: 'only left-out modules need it, such as python-only' },
      { id: 'python-only', reason: 'needs the python stack, and the project stack is ts' },
    ]);
  });

  it('lets modules.remove drop a requirement of a module that is left out anyway', () => {
    const catalog = catalogOf([
      plainManifest('base', { presets: ALL }),
      plainManifest('python-only', {
        presets: ALL,
        requires: ['python-helper'],
        when: { stack: ['python'] },
      }),
      plainManifest('python-helper', { presets: ALL, requires: ['base'] }),
    ]);
    const request = { preset: 'small', stack: ['ts'], remove: ['python-helper'] } as const;
    expect(ids(request, catalog)).toEqual(['base']);
    expect(() => resolveModules({ ...request, stack: ['python'] }, catalog)).toThrow(
      'removes "python-helper", which is required: preset small → python-only → python-helper',
    );
  });

  it('honours modules.remove and returns the preset it resolved', () => {
    const resolution = resolveModules({ preset: 'small', stack: [], remove: ['safety'] }, CATALOG);
    expect(resolution.modules.map((kit) => kit.manifest.id)).toEqual(['base', 'alpha']);
    expect(resolution.preset.defaults.sessionStartCap).toBe(1200);
  });

  it('evaluates when against the option values it is given, or the defaults', () => {
    const catalog = catalogOf([
      plainManifest('base', { presets: ALL }),
      plainManifest('strict', {
        presets: ALL,
        options: { enabled: { type: 'boolean', default: false, description: 'Turns the module on.' } },
        when: { options: { enabled: true } },
      }),
    ]);
    const byDefault = resolveModules({ preset: 'small', stack: [] }, catalog);
    expect(byDefault.dropped).toEqual([{ id: 'strict', reason: 'needs option enabled to be true' }]);
    const options = new Map([['strict', { enabled: true }]]);
    expect(ids({ preset: 'small', stack: [], options }, catalog)).toEqual(['base', 'strict']);
  });

  it('says the project has no stack when a stack-specific module is left out', () => {
    expect(resolveModules({ preset: 'medium', stack: [] }, CATALOG).dropped).toEqual([
      { id: 'python-rules', reason: 'needs the python stack, and the project stack is none' },
    ]);
  });
});

describe('resolveModules errors', () => {
  const config = configPath();
  const broken = catalogOf([
    plainManifest('base', { presets: ALL }),
    plainManifest('knowledge', { presets: MEDIUM_UP, requires: ['base', 'ghost'] }),
    plainManifest('cycle-a', { requires: ['cycle-b'] }),
    plainManifest('cycle-b', { requires: ['cycle-a'] }),
    plainManifest('linter', { requires: ['base'], conflicts: ['formatter'] }),
    plainManifest('formatter', { requires: ['base'] }),
  ]);

  interface ErrorCase {
    name: string;
    request: ResolveRequest;
    file: string;
    location: string;
    problem: string;
    fix: string;
  }
  const cases: ErrorCase[] = [
    {
      name: 'an unknown preset',
      request: { preset: 'huge', stack: [] },
      file: config,
      location: 'preset',
      problem: '"huge" is not a preset',
      fix: 'use one of small',
    },
    {
      name: 'an unknown module to add',
      request: { preset: 'small', stack: [], add: ['ghost'] },
      file: config,
      location: 'modules.add[0]',
      problem: '"ghost" is not a module',
      fix: 'use one of base',
    },
    {
      name: 'an unknown module to remove',
      request: { preset: 'small', stack: [], remove: ['ghost'] },
      file: config,
      location: 'modules.remove[0]',
      problem: 'is not a module',
      fix: 'use one of',
    },
    {
      name: 'a module both added and removed',
      request: { preset: 'small', stack: [], add: ['linter'], remove: ['linter'] },
      file: config,
      location: 'modules.remove[0]',
      problem: 'is also in modules.add',
      fix: 'not both',
    },
    {
      name: 'a missing dependency',
      request: { preset: 'medium', stack: [] },
      file: 'modules/knowledge/module.json',
      location: 'requires[1]',
      problem: 'requires "ghost", which is not a module: preset medium → knowledge → ghost',
      fix: 'add modules/ghost/module.json',
    },
    {
      name: 'removing a module another one requires',
      request: { preset: 'small', stack: [], add: ['formatter'], remove: ['base'] },
      file: config,
      location: 'modules.remove[0]',
      problem: 'removes "base", which is required: modules.add → formatter → base',
      fix: 'also remove formatter',
    },
    {
      name: 'a cycle',
      request: { preset: 'small', stack: [], add: ['cycle-a'] },
      file: 'modules/cycle-a/module.json',
      location: 'requires',
      problem: 'cycle: cycle-a → cycle-b → cycle-a',
      fix: 'remove one of these requires',
    },
    {
      name: 'a conflict',
      request: { preset: 'small', stack: [], add: ['linter', 'formatter'] },
      file: 'modules/linter/module.json',
      location: 'conflicts[0]',
      problem:
        'conflicts with "formatter" (modules.add → formatter), and both are selected: modules.add → linter',
      fix: 'modules.remove',
    },
  ];

  it.each(cases)('rejects $name with the chain and a fix', ({ request, file, location, problem, fix }) => {
    const error = resolveError(request, broken);
    expect(error.file).toBe(file);
    expect(error.location).toBe(location);
    expect(error.message).toContain(problem);
    expect(error.hint).toContain(fix);
  });

  it('keeps the chain as data for the CLI', () => {
    expect(resolveError({ preset: 'medium', stack: [] }, broken).chain).toEqual([
      'preset medium',
      'knowledge',
      'ghost',
    ]);
  });
});
