import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript, tempDir, tempRepo, writeFiles, type RunResult } from './helpers.js';

const MANIFEST = {
  name: 'fixture-kit',
  version: '1.2.0',
  files: ['dist'],
  scripts: { test: 'vitest run', prepare: 'husky' },
};
const STRIPPED = { ...MANIFEST, scripts: { test: 'vitest run' } };

function release(edits: Record<string, string>): RunResult & { outputs: string; destination: string } {
  const repo = tempRepo({
    'package.json': `${JSON.stringify(MANIFEST, null, 2)}\n`,
    '.gitignore': 'dist/\n',
  });
  writeFiles(repo, { 'dist/cli.mjs': 'export {};\n', ...edits });
  const destination = path.join(tempDir(), 'release');
  const outputFile = path.join(tempDir(), 'github-output');
  writeFiles(path.dirname(outputFile), { 'github-output': '' });
  const result = runScript('scripts/pack-release.mjs', {
    args: [destination],
    cwd: repo,
    env: { GITHUB_OUTPUT: outputFile, npm_config_cache: tempDir(), npm_config_update_notifier: 'false' },
  });
  return { ...result, outputs: readFileSync(outputFile, 'utf8'), destination };
}

describe('pack-release', () => {
  it('packs the tagged commit with prepare stripped and outputs the tarball, integrity and shasum', () => {
    const result = release({ 'package.json': `${JSON.stringify(STRIPPED, null, 2)}\n` });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.outputs).toMatch(
      /^tarball=fixture-kit-1\.2\.0\.tgz\nintegrity=sha512-\S+\nshasum=[\da-f]{40}\n$/,
    );
    expect(existsSync(path.join(result.destination, 'fixture-kit-1.2.0.tgz'))).toBe(true);
  });

  it('refuses while prepare is still in the manifest', () => {
    const result = release({});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'package.json differs from the tagged commit by more than removing prepare',
    );
    expect(result.outputs).toBe('');
  });

  it('refuses a manifest changed beyond the prepare strip', () => {
    const result = release({ 'package.json': JSON.stringify({ ...STRIPPED, version: '9.9.9' }) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('differs from the tagged commit');
  });

  it('refuses any other changed or new file', () => {
    const result = release({ 'package.json': JSON.stringify(STRIPPED), 'README.md': '# changed\n' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('?? README.md');
  });

  it('rejects a missing destination with usage', () => {
    const result = runScript('scripts/pack-release.mjs', { cwd: tempRepo() });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: node scripts/pack-release.mjs <destination>');
  });
});
