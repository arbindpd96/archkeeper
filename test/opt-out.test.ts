import { describe, expect, it } from 'vitest';
import type { KitModule } from '../src/core/loader.js';
import {
  optedOutEntries,
  optOutNames,
  optOutOwnable,
  unknownOptOuts,
  withoutOptedOut,
} from '../src/core/opt-out.js';
import { render } from '../src/core/render.js';
import { KIT } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

function moduleNamed(id: string): KitModule {
  const kit = KIT.modules.get(id);
  if (kit === undefined) throw new Error(`The kit has no ${id} module.`);
  return kit;
}

const safety = moduleNamed('safety');
const HOOKS = TEST_BRAND.hookDir;

function rendered(optOut: readonly string[]): ReturnType<typeof render> {
  const options = new Map([['safety', { optOut: [...optOut] }]]);
  return render([safety], { stack: [], options }, TEST_BRAND);
}

describe('the optOut option (#33, ADR-0014)', () => {
  it("names every one of the module's rules and guards", () => {
    expect(optOutNames(safety.manifest)).toEqual([
      'Read(**/.env)',
      'Read(**/.env.*)',
      'Read(**/.envrc)',
      'Bash(rm -rf:*)',
      'Bash(git push --force:*)',
      'Bash(git push -f:*)',
      'guard-bash',
      'guard-secrets',
    ]);
  });

  it('leaves the listed rules and guards out of the manifest and keeps the rest', () => {
    const manifest = withoutOptedOut(safety.manifest, { optOut: ['Bash(rm -rf:*)', 'guard-bash'] });
    expect(manifest.permissions.deny).not.toContain('Bash(rm -rf:*)');
    expect(manifest.permissions.deny).toHaveLength(5);
    expect(manifest.hooks.map((hook) => hook.script)).toEqual(['dist/hooks/guard-secrets.mjs']);
  });

  it("renders neither an opted-out rule nor an opted-out guard's registration or script", () => {
    const tree = rendered(['Bash(rm -rf:*)', 'guard-bash']);
    const settings = tree.get('.claude/settings.json')?.[0]?.content ?? '';
    expect(settings).not.toContain('Bash(rm -rf:*)');
    expect(settings).not.toContain('guard-bash.mjs');
    expect(settings).toContain('guard-secrets.mjs');
    expect(tree.has(`${HOOKS}/guard-bash.mjs`)).toBe(false);
    expect(tree.has(`${HOOKS}/guard-secrets.mjs`)).toBe(true);
  });

  it('renders no settings file once every entry of the module is opted out', () => {
    expect(rendered(optOutNames(safety.manifest)).has('.claude/settings.json')).toBe(false);
  });

  it('names the entries that match nothing, such as a rule written another way', () => {
    expect(
      unknownOptOuts(safety.manifest, { optOut: ['Bash(rm -rf *)', 'guard-bash', 'guard-env'] }),
    ).toEqual(['Bash(rm -rf *)', 'guard-env']);
  });

  it('says which settings keys and scripts each entry leaves out', () => {
    const entries = optedOutEntries(
      safety.manifest,
      { optOut: ['Bash(rm -rf:*)', 'guard-bash'] },
      TEST_BRAND,
    );
    expect(entries).toEqual([
      { name: 'Bash(rm -rf:*)', keys: ['permissions.deny Bash(rm -rf:*)'], scripts: [] },
      {
        name: 'guard-bash',
        keys: [`hooks.PreToolUse ${HOOKS}/guard-bash.mjs`],
        scripts: [`${HOOKS}/guard-bash.mjs`],
      },
    ]);
  });

  it('lets the planner remove exactly what the entries leave out', () => {
    const ownable = optOutOwnable(optedOutEntries(safety.manifest, { optOut: ['guard-bash'] }, TEST_BRAND));
    expect(ownable(`${HOOKS}/guard-bash.mjs`)).toBe(true);
    expect(ownable('.claude/settings.json', `hooks.PreToolUse ${HOOKS}/guard-bash.mjs`)).toBe(true);
    expect(ownable(`${HOOKS}/guard-secrets.mjs`)).toBe(false);
    expect(ownable('.claude/settings.json', 'permissions.deny Bash(rm -rf:*)')).toBe(false);
  });
});
