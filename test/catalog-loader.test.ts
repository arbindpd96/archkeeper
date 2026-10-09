import { describe, expect, it } from 'vitest';
import { ManifestError } from '../src/core/errors.js';
import { loadCatalog } from '../src/core/loader.js';
import { kitFiles, type ManifestData, memoryReader, plainManifest, PRESETS } from './kit-fixtures.js';

function failure(run: () => unknown): ManifestError {
  try {
    run();
  } catch (error) {
    if (error instanceof ManifestError) return error;
    throw error;
  }
  throw new Error('no ManifestError was thrown');
}

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
