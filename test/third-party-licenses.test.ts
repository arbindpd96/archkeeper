import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'tsdown';
import { describe, expect, it } from 'vitest';
import { inlinedModules } from '../tsdown.config.mjs';
import { runScript, tempDir, writeFiles, type RunResult } from './helpers.js';

const manifest = (name: string, version: string, fields: Record<string, unknown> = {}): string =>
  JSON.stringify({
    name,
    version,
    license: 'MIT',
    repository: { url: `https://example.com/${name}` },
    ...fields,
  });

const list = (files: string[]): string => JSON.stringify(files);

type Generated = RunResult & { output: () => string; rerun: () => RunResult };

function generateIn(root: string): Generated {
  const rerun = (): RunResult => runScript('scripts/third-party-licenses.mjs', { args: [root] });
  const output = (): string => readFileSync(path.join(root, 'dist/THIRD_PARTY_LICENSES.md'), 'utf8');
  return { ...rerun(), output, rerun };
}

function generate(files: Record<string, string>): Generated {
  const root = tempDir();
  writeFiles(root, files);
  return generateIn(root);
}

const LICENSED_BUNDLES = {
  'dist/cli.mjs': 'export {};\n',
  'dist/cli.inlined.json': list([
    'node_modules/alpha/lib/a.js',
    'node_modules/alpha/lib/b.js',
    'node_modules/@scope/beta/index.js',
  ]),
  'dist/hooks/stop.mjs': 'export {};\n',
  'dist/hooks/stop.inlined.json': list(['node_modules/alpha/node_modules/gamma/index.js']),
  'node_modules/alpha/package.json': manifest('alpha', '2.0.0'),
  'node_modules/alpha/LICENSE': 'Alpha license with ``` inside',
  'node_modules/@scope/beta/package.json': manifest('@scope/beta', '1.0.0', { license: 'Apache-2.0' }),
  'node_modules/@scope/beta/LICENSE.txt': 'Beta license',
  'node_modules/@scope/beta/NOTICE': 'Beta notice',
  'node_modules/alpha/node_modules/gamma/package.json': manifest('gamma', '0.1.0'),
};

describe('third-party-licenses', () => {
  it('lists each inlined package of every bundle once, sorted, with its license files', () => {
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
      'dist/cli.mjs': 'export {};\n',
      'dist/cli.inlined.json': list(['node_modules/delta/index.js', 'node_modules/epsilon/index.js']),
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

  it('refuses a listed file whose package folder escapes node_modules', () => {
    const result = generate({
      'dist/cli.mjs': 'export {};\n',
      'dist/cli.inlined.json': list(['../outside/node_modules/evil/index.js']),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is outside');
  });

  it('says so when the bundles inline no third-party package', () => {
    const result = generate({ 'dist/cli.mjs': 'export {};\n', 'dist/cli.inlined.json': list([]) });
    expect(result.status).toBe(0);
    expect(result.output()).toContain('inline no third-party packages');
  });

  it('fails on a bundle the build wrote no list for, because its packages cannot be known', () => {
    const result = generate({ 'dist/cli.mjs': 'export {};\n' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`cannot read ${path.join('dist', 'cli.inlined.json')}`);
    expect(result.stderr).toContain('Run npm run build');
  });

  it('fails on a list that is not an array of file paths', () => {
    const result = generate({ 'dist/cli.mjs': 'export {};\n', 'dist/cli.inlined.json': '{"a":1}' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not a list of file paths');
  });

  it('fails when there is nothing in dist/', () => {
    expect(generate({}).stderr).toContain('no bundles in dist/');
  });
});

describe('inlinedModules', () => {
  async function bundle(root: string): Promise<string> {
    await build({
      config: false,
      cwd: root,
      entry: { cli: 'src/cli.js' },
      outDir: 'dist',
      platform: 'node',
      format: 'esm',
      dts: false,
      logLevel: 'silent',
      plugins: [inlinedModules(root)],
    });
    return readFileSync(path.join(root, 'dist/cli.inlined.json'), 'utf8');
  }

  it('lists the node_modules files in the module graph, and the license script names their packages', async () => {
    const root = tempDir();
    writeFiles(root, {
      'src/cli.js':
        "import { alpha } from 'alpha';\nimport { local } from './local.js';\nexport { alpha, local };\n",
      'src/local.js': 'export const local = 1;\n',
      'node_modules/alpha/package.json': manifest('alpha', '2.0.0', { type: 'module', main: 'index.js' }),
      'node_modules/alpha/index.js': "import { BASE } from 'beta';\nexport const alpha = BASE + 1;\n",
      'node_modules/alpha/LICENSE': 'Alpha license',
      'node_modules/beta/package.json': manifest('beta', '1.0.0', { type: 'module', main: 'index.js' }),
      'node_modules/beta/index.js': 'export const BASE = 1;\n',
    });
    const first = await bundle(root);
    expect(JSON.parse(first)).toEqual(['node_modules/alpha/index.js', 'node_modules/beta/index.js']);
    expect(readFileSync(path.join(root, 'dist/cli.mjs'), 'utf8')).not.toContain('node_modules/beta');
    expect(await bundle(root)).toBe(first);
    const result = generateIn(root);
    expect(result.status).toBe(0);
    expect(result.output()).toContain('## alpha@2.0.0');
    expect(result.output()).toContain('## beta@1.0.0');
  });

  it('writes an empty list for a bundle that inlines no package', async () => {
    const root = tempDir();
    writeFiles(root, { 'src/cli.js': "export const local = 'no packages';\n" });
    expect(JSON.parse(await bundle(root))).toEqual([]);
  });
});
