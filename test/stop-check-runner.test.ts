import { chmodSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { stopCommand } from '../src/hooks/runtime/stop/runner.js';
import { tempDir, writeFiles } from './helpers.js';

describe('the commands checks.stop may name (#38, ADR-0015)', () => {
  it('runs npm through its own JS entry with --ignore-scripts first, never after --', () => {
    const found = stopCommand(tempDir(), ['npm', 'run', 'test', '--', '--watch=false']);
    expect(found).toMatchObject({
      tool: { entry: expect.stringMatching(/npm-cli\.js$/) as string },
      args: ['--ignore-scripts', '--no-update-notifier', 'run', 'test', '--', '--watch=false'],
    });
  });

  it.skipIf(process.platform === 'win32')(
    'takes npm on PATH only where it links to npm-cli.js in an npm package, not any file of that name',
    () => {
      const dir = tempDir();
      writeFiles(dir, { 'elsewhere/npm-cli.js': '' });
      const planted = path.join(dir, 'elsewhere', 'npm-cli.js');
      chmodSync(planted, 0o755);
      mkdirSync(path.join(dir, 'bin'));
      symlinkSync(planted, path.join(dir, 'bin', 'npm'));
      vi.stubEnv('PATH', path.join(dir, 'bin'));
      try {
        const found = stopCommand(tempDir(), ['npm', 'test']);
        expect(found).not.toMatchObject({ tool: { entry: realpathSync.native(planted) } });
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it.each<[string, readonly string[]]>([
    ['npm install', ['npm', 'install']],
    ['npm exec', ['npm', 'exec', 'vitest']],
    ['npm ci', ['npm', 'ci']],
    ['npm run with no script', ['npm', 'run']],
    ['npm t', ['npm', 't']],
    ['an npm option before the script', ['npm', 'run', '--silent', 'test']],
    ['an npm option before --', ['npm', 'test', '--ignore-scripts=false']],
    ['npx', ['npx', 'vitest', 'run']],
    ['poetry', ['poetry', 'run', 'pytest']],
    ['a shell', ['sh', '-c', 'pytest']],
  ])('refuses %s', (_name, argv) => {
    expect(stopCommand(tempDir(), argv)).toHaveProperty('refused');
  });
});
