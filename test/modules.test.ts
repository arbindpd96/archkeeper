import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCatalog, type ReadKitFile } from '../src/core/loader.js';
import { resolveModules } from '../src/core/resolve.js';
import { REPO_ROOT } from './helpers.js';

const readKit: ReadKitFile = (file) => {
  const absolute = path.join(REPO_ROOT, file);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
};
const moduleIds = readdirSync(path.join(REPO_ROOT, 'modules'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const catalog = loadCatalog(moduleIds, readKit);

// The v0.1 preset table in docs/ROADMAP.md and #19.
const MEMBERSHIP: Record<string, readonly string[]> = {
  base: ['small', 'medium', 'full'],
  safety: ['small', 'medium', 'full'],
  'feature-memory': ['small', 'medium', 'full'],
  knowledge: ['medium', 'full'],
  'architecture-map': ['medium', 'full'],
  'format-on-edit': ['medium', 'full'],
  'stop-check': ['full'],
};

describe('the v0.1 modules', () => {
  it('are exactly the seven modules of the v0.1 table, and every manifest loads', () => {
    expect([...catalog.modules.keys()].sort()).toEqual(Object.keys(MEMBERSHIP).sort());
  });

  it.each(Object.entries(MEMBERSHIP))('%s lists the presets of the v0.1 table', (id, presets) => {
    expect(catalog.modules.get(id)?.manifest.presets).toEqual(presets);
  });

  it.each(['small', 'medium', 'full'])('the %s preset resolves to its column of the table', (preset) => {
    const expected = Object.keys(MEMBERSHIP).filter((id) => MEMBERSHIP[id]?.includes(preset));
    const resolved = resolveModules({ preset, stack: ['ts'] }, catalog).modules.map((kit) => kit.manifest.id);
    expect([...resolved].sort()).toEqual(expected.sort());
    expect(resolved[0]).toBe('base');
  });

  it('form the small ⊂ medium ⊂ full chain with the SessionStart caps of ADR-0015', () => {
    expect(catalog.presets.map(({ name, defaults }) => [name, defaults.sessionStartCap])).toEqual([
      ['small', 1200],
      ['medium', 3000],
      ['full', 4000],
    ]);
    expect(catalog.defaultPreset).toBe('medium');
  });

  it('give the safety module an optOut list for protections removed on purpose', () => {
    expect(catalog.modules.get('safety')?.manifest.options.optOut).toMatchObject({
      type: 'string-list',
      default: [],
    });
  });
});
