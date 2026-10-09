import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript, tempDir, writeFiles, type RunResult } from './helpers.js';

const manifest = (name: string, version: string, license = 'MIT'): string =>
  JSON.stringify({ name, version, license, repository: { url: `https://example.com/${name}` } });

function generate(files: Record<string, string>): RunResult & { output: () => string } {
  const root = tempDir();
  writeFiles(root, files);
  const result = runScript('scripts/third-party-licenses.mjs', { args: [root] });
  return { ...result, output: () => readFileSync(path.join(root, 'dist/THIRD_PARTY_LICENSES.md'), 'utf8') };
}

describe('third-party-licenses', () => {
  it('lists each inlined package once, sorted, with its license files', () => {
    const result = generate({
      'dist/cli.mjs': [
        '//#region src/cli/bin.ts',
        '//#region node_modules/alpha/lib/a.js',
        '//#region node_modules/alpha/lib/b.js',
        '//#region node_modules/@scope/beta/index.js',
      ].join('\n'),
      'dist/hooks/stop.mjs': '//#region node_modules/alpha/node_modules/gamma/index.js\n',
      'node_modules/alpha/package.json': manifest('alpha', '2.0.0'),
      'node_modules/alpha/LICENSE': 'Alpha license with ``` inside',
      'node_modules/@scope/beta/package.json': manifest('@scope/beta', '1.0.0', 'Apache-2.0'),
      'node_modules/@scope/beta/LICENSE.txt': 'Beta license',
      'node_modules/@scope/beta/NOTICE': 'Beta notice',
      'node_modules/alpha/node_modules/gamma/package.json': manifest('gamma', '0.1.0'),
    });
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
