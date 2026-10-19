import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import { readKit } from '../src/cli/kit.js';
import { BRAND } from '../src/core/brand.js';
import { commitFiles, fixtureCopy, git, REPO_ROOT, withEnv, writeFiles } from './helpers.js';
import { moduleEntries, renderedKit, runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const catalog = readKit(REPO_ROOT);
const manifest = catalog.modules.get('stop-check')?.manifest;
// A stand-in test runner, installed as a JS bin, that fails the way pytest does.
const FAILING = "console.log('FAILED tests/test_greet.py::test_greets_by_name');\nprocess.exit(1);\n";

interface Handler {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeout: number;
}
interface Settings {
  readonly hooks: { readonly Stop: readonly { hooks: readonly Handler[] }[] };
}

describe('the stop-check module (#38, ADR-0015)', () => {
  it('is in the full preset only and registers its Stop hook with a 600-second timeout', () => {
    expect(manifest?.presets).toEqual(['full']);
    expect(
      manifest?.hooks.map(({ event, matcher, script, timeout }) => [event, matcher, script, timeout]),
    ).toEqual([['Stop', undefined, 'dist/hooks/stop-check.mjs', 600]]);
  });

  it('runs nothing until checks.stop is set: the command starts empty, the timeout at 300 seconds', () => {
    const options = Object.entries(manifest?.options ?? {}).map(([name, spec]) => [
      name,
      spec.type,
      spec.default,
    ]);
    expect(options).toEqual([
      ['checks.stop', 'string-list', []],
      ['checks.stopTimeout', 'number', 300],
    ]);
  });

  it('writes its bundle and its registration only, and no AGENTS.md block', () => {
    expect(moduleEntries(renderedKit(['base', 'stop-check']), 'stop-check')).toEqual([
      [`${TEST_BRAND.hookDir}/stop-check.mjs`, 'owned', ''],
      ['.claude/settings.json', 'json', ''],
    ]);
  });
});

describe('the installed stop-check hook, run as Claude Code runs it', () => {
  it('is the real bundle, under a path with a space, and blocks once with what the failing command printed', async () => {
    const { dir } = fixtureCopy('py-app');
    expect((await runInit(dir, ['--yes', '--preset', 'full'], { catalog })).code).toBe(0);
    // The real bundle reads the real brand's config, and init tests write the test brand's.
    const options = { 'stop-check': { 'checks.stop': ['checker', '-q'] } };
    writeFiles(dir, {
      [`${BRAND.stateDir}/config.json`]: JSON.stringify({ preset: 'full', options }),
      'node_modules/checker/package.json': JSON.stringify({ name: 'checker', bin: './check.js' }),
      'node_modules/checker/check.js': FAILING,
    });
    git(dir, 'init', '-q', '-b', 'main');
    commitFiles(dir, {}, { message: 'init' });
    writeFiles(dir, { 'src/py_app/__init__.py': 'def greet(name):\n    return f"Hi, {name}!"\n' });
    const settings = parse(readFileSync(path.join(dir, '.claude/settings.json'), 'utf8')) as Settings;
    const handler = settings.hooks.Stop.flatMap((group) => group.hooks).find((entry) =>
      entry.args[0]?.endsWith('/stop-check.mjs'),
    );
    expect(handler).toMatchObject({ command: 'node', timeout: 600 });
    const args = (handler?.args ?? []).map((arg) => arg.replace('${CLAUDE_PROJECT_DIR}', dir));
    expect(args[0]).toContain(' ');
    const stop = (): ReturnType<typeof spawnSync> =>
      spawnSync(process.execPath, args, {
        cwd: dir,
        input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false }),
        encoding: 'utf8',
        env: withEnv({ CLAUDE_PROJECT_DIR: dir }),
      });
    const first = stop();
    expect(first.status).toBe(0);
    expect(JSON.parse(String(first.stdout))).toEqual({
      decision: 'block',
      reason: `${BRAND.displayName} stop check: "checker -q" exited 1; fix it or tell the user why:\nFAILED tests/test_greet.py::test_greets_by_name`,
    });
    expect(stop().stdout).toBe('');
  });
});
