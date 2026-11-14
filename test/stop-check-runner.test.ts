import { describe, expect, it } from 'vitest';
import { stopCommand } from '../src/hooks/runtime/stop/runner.js';
import { tempDir } from './helpers.js';

describe('the commands checks.stop may name (#38, ADR-0015)', () => {
  it('runs npm through its own JS entry with --ignore-scripts first, never after --', () => {
    const found = stopCommand(tempDir(), ['npm', 'run', 'test', '--', '--watch=false']);
    expect(found).toMatchObject({
      tool: { entry: expect.stringMatching(/npm-cli\.js$/) as string },
      args: ['--ignore-scripts', '--no-update-notifier', 'run', 'test', '--', '--watch=false'],
    });
  });

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
