import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript, tempDir, writeFiles, type RunResult } from './helpers.js';

const BIN = [
  '#!/usr/bin/env node',
  "process.stdout.write(process.argv.includes('--version') ? '1.0.0\\n' : 'Usage: fixture-kit\\n');",
  '',
].join('\n');

const BUDGETS = {
  tarball: { maxBytes: 300_000 },
  runtimeDependencies: { max: 0 },
  hookBundle: { maxBytes: 100 },
};

function fixture(manifest: Record<string, unknown> = {}, files: Record<string, string> = {}): string {
  const root = tempDir();
  writeFiles(root, {
    'package.json': JSON.stringify({
      name: 'fixture-kit',
      version: '1.0.0',
      description: 'Fixture package.',
      type: 'module',
      bin: { 'fixture-kit': 'dist/cli.mjs' },
      files: ['dist'],
      ...manifest,
    }),
    'budgets.json': JSON.stringify(BUDGETS),
    'dist/cli.mjs': BIN,
    'scripts/package-files.txt': 'dist/cli.mjs\npackage.json\n',
    ...files,
  });
  return root;
}

function checkPackage(root: string, ...args: string[]): RunResult {
  return runScript('scripts/check-package.mjs', { args: [...args, root] });
}

describe('check-package', () => {
  it('passes a light package and writes the sizes to the job summary', () => {
    const summary = path.join(tempDir(), 'summary.md');
    const result = runScript('scripts/check-package.mjs', {
      args: [fixture()],
      env: { GITHUB_STEP_SUMMARY: summary },
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('| Runtime dependencies | 0 | 0 |');
    expect(readFileSync(summary, 'utf8')).toContain('### Package size');
  });

  it('still finds npm, beside Node.js or on PATH, when npm did not launch it', () => {
    const result = runScript('scripts/check-package.mjs', { args: [fixture()], env: { npm_execpath: '' } });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails on a runtime dependency', () => {
    const result = checkPackage(fixture({ dependencies: { leftpad: '1.0.0' } }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('runtime dependencies over budget: leftpad');
  });

  it('fails on an install script', () => {
    const result = checkPackage(fixture({ scripts: { postinstall: 'node setup.js' } }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('remove postinstall');
  });

  it('fails when the published files differ from the snapshot, and --update accepts them', () => {
    const root = fixture({}, { 'dist/extra.mjs': 'export {};\n' });
    const result = checkPackage(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('+ dist/extra.mjs');
    const snapshot = path.join(root, 'scripts/package-files.txt');
    expect(checkPackage(root, '--update').status).toBe(0);
    const updated = readFileSync(snapshot, 'utf8');
    expect(updated).toBe('dist/cli.mjs\ndist/extra.mjs\npackage.json\n');
    expect(checkPackage(root, '--update').status).toBe(0);
    expect(readFileSync(snapshot, 'utf8')).toBe(updated);
    expect(checkPackage(root).status).toBe(0);
  });

  it('fails when the tarball is over its budget', () => {
    const budgets = JSON.stringify({ ...BUDGETS, tarball: { maxBytes: 10 } });
    const result = checkPackage(fixture({}, { 'budgets.json': budgets }));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/tarball is \d+\.\d kB, over its budget/);
  });

  it('names every missing or invalid budget and cites ADR-0017', () => {
    const budgets = JSON.stringify({ tarball: { maxBytes: -1 }, runtimeDependencies: { max: 'none' } });
    const result = checkPackage(fixture({}, { 'budgets.json': budgets }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'budgets.json needs a non-negative number for tarball.maxBytes, runtimeDependencies.max, hookBundle.maxBytes (ADR-0017)',
    );
  });

  it('asks for a build when dist/ is missing', () => {
    const root = fixture();
    rmSync(path.join(root, 'dist'), { recursive: true });
    const result = checkPackage(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dist/ is missing. Run npm run build first.');
  });

  it('fails when the built bin prints a version other than package.json', () => {
    const stale =
      "#!/usr/bin/env node\nprocess.stdout.write(process.argv.includes('--version') ? '9.9.9\\n' : 'Usage:\\n');\n";
    const result = checkPackage(fixture({}, { 'dist/cli.mjs': stale }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bin --version printed "9.9.9", not 1.0.0');
  });

  it('fails when a hook bundle is over its budget', () => {
    const hook = `export const padding = '${'x'.repeat(200)}';\n`;
    const snapshot = 'dist/cli.mjs\ndist/hooks/stop.mjs\npackage.json\n';
    const root = fixture({}, { 'dist/hooks/stop.mjs': hook, 'scripts/package-files.txt': snapshot });
    const result = checkPackage(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dist/hooks/stop.mjs is 0.2 kB, over its budget');
  });

  it('reports publint errors', () => {
    const result = checkPackage(fixture({ main: 'dist/missing.mjs' }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('publint:');
  });
});
