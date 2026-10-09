import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { type RunResult, runScript, tempRepo, writeFiles } from './helpers.js';

const SLUG = BRAND.npmName;
const brandedPackage = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: SLUG, bin: { [BRAND.binName]: 'dist/cli.mjs' }, ...overrides });

function checkBrand(files: Record<string, string>, untracked: Record<string, string> = {}): RunResult {
  const repo = tempRepo({ 'package.json': brandedPackage(), ...files });
  writeFiles(repo, untracked);
  return runScript('scripts/check-brand.mjs', { args: [repo] });
}

describe('check-brand', () => {
  it('accepts the slug in the brand file, package metadata, docs and the dogfood setup', () => {
    const result = checkBrand({
      'src/core/brand.ts': `const SLUG = '${SLUG}';\n`,
      'README.md': `# ${SLUG}\n`,
      'docs/adr/0001.md': `${SLUG} decision\n`,
      '.claude/hooks/guard.mjs': `export const label = '${SLUG} guard';\n`,
      'src/cli/main.ts': 'export const ready = true;\n',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('reports a slug literal outside the allowlist with its file and line', () => {
    const result = checkBrand({ 'src/cli/main.ts': `export const a = 1;\nexport const dir = '.${SLUG}';\n` });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/cli/main.ts:2');
  });

  it('checks untracked files, so a leak is caught before it is committed', () => {
    const result = checkBrand({}, { 'modules/memory/files/CLAUDE.md': `<!-- ${SLUG}:begin memory -->\n` });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('modules/memory/files/CLAUDE.md:1');
  });

  it('fails when the package name differs from BRAND.npmName', () => {
    const result = checkBrand({ 'package.json': brandedPackage({ name: 'other-name' }) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('differs from BRAND.npmName');
  });

  it('fails when the bin does not map exactly BRAND.binName', () => {
    const result = checkBrand({ 'package.json': brandedPackage({ bin: { other: 'dist/cli.mjs' } }) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bin must map exactly one command');
  });
});
