import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';

const RESERVED_PREFIXES = ['claude-', 'anthropic-', 'anthropics-', 'cc-plugin-'];
const RESERVED_NAMES = new Set(['claude', 'anthropic', 'anthropics', 'claude-code', 'claude-mods']);
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Mirrors the name checks of `claude plugin validate` (reference §4.1): case-insensitive, separator runs collapsed.
function pluginNameProblems(name: string): string[] {
  const normalized = name.toLowerCase().replace(/[\s._-]+/g, '-');
  const problems: string[] = [];
  if (!KEBAB_CASE.test(name)) problems.push('not kebab-case');
  if (RESERVED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) problems.push('reserved prefix');
  if (RESERVED_NAMES.has(normalized)) problems.push('reserved name');
  if (/(?:^|-)official-(?:claude|anthropic)|(?:claude|anthropic)-official(?:-|$)/.test(normalized)) {
    problems.push('"official" next to claude or anthropic');
  }
  if (/(?:^|-)claude(?:-|$)/.test(normalized)) problems.push('"claude" as a whole word');
  return problems;
}

describe('BRAND', () => {
  it('is frozen, including its legacy slugs', () => {
    expect(Object.isFrozen(BRAND)).toBe(true);
    expect(Object.isFrozen(BRAND.legacySlugs)).toBe(true);
    expect(BRAND.legacySlugs).toEqual([]);
  });

  it('uses one slug for the package, the bin, the plugin and the marketplace', () => {
    const names = [BRAND.binName, BRAND.displayName, BRAND.pluginName, BRAND.marketplaceName];
    expect(names.every((name) => name === BRAND.npmName)).toBe(true);
  });

  it('keeps the state directory as a dot-folder at the project root, outside .claude/', () => {
    expect(BRAND.stateDir).toBe(`.${BRAND.npmName}`);
    expect(BRAND.stateDir).not.toContain('/');
  });

  it('derives the project paths and suffixes from the slug', () => {
    expect(BRAND.hookDir).toBe(`.claude/hooks/${BRAND.npmName}`);
    expect(BRAND.rulesDir).toBe(`.claude/rules/${BRAND.npmName}`);
    expect(BRAND.markerPrefix).toBe(BRAND.npmName);
    expect(BRAND.sidecarSuffix).toBe(`.${BRAND.npmName}-new`);
  });

  it('carries the non-affiliation disclaimer', () => {
    expect(BRAND.disclaimer).toMatch(/^Independent community project; not affiliated with, endorsed by/);
    expect(BRAND.disclaimer).toContain('Claude and Claude Code are trademarks of Anthropic, PBC.');
  });
});

describe('plugin and marketplace names', () => {
  it.each([
    ['pluginName', BRAND.pluginName],
    ['marketplaceName', BRAND.marketplaceName],
  ])('BRAND.%s passes the Claude Code plugin validator rules', (_, name) => {
    expect(pluginNameProblems(name)).toEqual([]);
  });

  it.each([
    ['claude-kit', 'reserved prefix'],
    ['Claude__Kit', 'reserved prefix'],
    ['anthropic-tools', 'reserved prefix'],
    ['anthropics-tools', 'reserved prefix'],
    ['cc-plugin-kit', 'reserved prefix'],
    ['claude-code', 'reserved name'],
    ['claude-mods', 'reserved name'],
    ['anthropic', 'reserved name'],
    ['official-claude-kit', '"official" next to claude or anthropic'],
    ['kit-for-claude', '"claude" as a whole word'],
    ['my kit', 'not kebab-case'],
    ['kit:core', 'not kebab-case'],
    ['kit/core', 'not kebab-case'],
  ])('rejects %s (%s)', (name, problem) => {
    expect(pluginNameProblems(name)).toContain(problem);
  });
});
