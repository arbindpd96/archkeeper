import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript, tempDir, writeFiles, type RunResult } from './helpers.js';

const manifest = (name: string, version: string, fields: Record<string, unknown> = {}): string =>
  JSON.stringify({
    name,
    version,
    license: 'MIT',
    repository: { url: `https://example.com/${name}` },
    ...fields,
  });

type Generated = RunResult & { output: () => string; rerun: () => RunResult };

function generate(files: Record<string, string>): Generated {
  const root = tempDir();
  writeFiles(root, files);
  const rerun = (): RunResult => runScript('scripts/third-party-licenses.mjs', { args: [root] });
  const output = (): string => readFileSync(path.join(root, 'dist/THIRD_PARTY_LICENSES.md'), 'utf8');
  return { ...rerun(), output, rerun };
}

const LICENSED_BUNDLES = {
  'dist/cli.mjs': [
    '//#region src/cli/bin.ts',
    '//#region node_modules/alpha/lib/a.js',
    '//#region node_modules/alpha/lib/b.js',
    '//#region node_modules/@scope/beta/index.js',
  ].join('\n'),
  'dist/hooks/stop.mjs': '//#region node_modules/alpha/node_modules/gamma/index.js\n',
  'node_modules/alpha/package.json': manifest('alpha', '2.0.0'),
  'node_modules/alpha/LICENSE': 'Alpha license with ``` inside',
  'node_modules/@scope/beta/package.json': manifest('@scope/beta', '1.0.0', { license: 'Apache-2.0' }),
  'node_modules/@scope/beta/LICENSE.txt': 'Beta license',
  'node_modules/@scope/beta/NOTICE': 'Beta notice',
  'node_modules/alpha/node_modules/gamma/package.json': manifest('gamma', '0.1.0'),
};

describe('third-party-licenses', () => {
  it('lists each inlined package once, sorted, with its license files', () => {
    const result = generate(LICENSED_BUNDLES);
    expect(result.status).toBe(0);
    const output = result.output();
    const headings = output.split('\n').filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## @scope/beta@1.0.0', '## alpha@2.0.0', '## gamma@0.1.0']);
    expect(output).toContain('- License: Apache-2.0');
    expect(output).toContain('### NOTICE\n\n```text\nBeta notice\n```');
    expect(output).toContain('````text\nAlpha license with ``` inside\n````');
    expect(output).toContain(
      '## gamma@0.1.0\n\n- License: MIT\n- Source: https://example.com/gamma\n\nThe package ships',
    );
  });

  it('writes the same file when it runs again', () => {
    const result = generate(LICENSED_BUNDLES);
    const first = result.output();
    expect(result.rerun().status).toBe(0);
    expect(result.output()).toBe(first);
  });

  it('finds suffixed license files and renders object-style license and repository fields', () => {
    const output = generate({
      'dist/cli.mjs': '//#region node_modules/delta/index.js\n//#region node_modules/epsilon/index.js\n',
      'node_modules/delta/package.json': manifest('delta', '1.0.0', {
        license: { type: 'BSD-3-Clause', url: 'https://example.com/bsd' },
        repository: 'github:example/delta',
      }),
      'node_modules/delta/LICENSE-MIT': 'Delta MIT text',
      'node_modules/delta/license_apache.txt': 'Delta Apache text',
      'node_modules/epsilon/package.json': manifest('epsilon', '3.0.0', {
        license: undefined,
        licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }],
        repository: undefined,
        homepage: 'https://example.com/epsilon',
      }),
    }).output();
    expect(output).toContain('## delta@1.0.0\n\n- License: BSD-3-Clause\n- Source: github:example/delta');
    expect(output).toContain('### LICENSE-MIT\n\n```text\nDelta MIT text\n```');
    expect(output).toContain('### license_apache.txt\n\n```text\nDelta Apache text\n```');
    expect(output).toContain('- License: MIT OR Apache-2.0\n- Source: https://example.com/epsilon');
    expect(output).not.toContain('[object Object]');
  });

  it('refuses a region path that escapes node_modules', () => {
    const result = generate({ 'dist/cli.mjs': '//#region ../outside/node_modules/evil/index.js\n' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is outside');
  });

  it('says so when the bundles inline no third-party package', () => {
    const result = generate({ 'dist/cli.mjs': '//#region src/cli/bin.ts\n' });
    expect(result.status).toBe(0);
    expect(result.output()).toContain('inline no third-party packages');
  });

  it('fails on a bundle without region markers, because its packages cannot be listed', () => {
    const result = generate({ 'dist/cli.mjs': 'export{};\n' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no //#region markers');
  });

  it('fails when there is nothing in dist/', () => {
    expect(generate({}).stderr).toContain('no bundles in dist/');
  });
});
