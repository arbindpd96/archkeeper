import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import type { Answer, Payload } from '../src/hooks/runtime/io.js';
import { outcomeOf } from '../src/hooks/runtime/launch.js';
import { stopCommand } from '../src/hooks/runtime/stop/runner.js';
import { stopCheck } from '../src/hooks/runtime/stop/stop-check.js';
import { canSymlink, commitFiles, git, stubEnv, tempDir, tempRepo, writeFiles } from './helpers.js';
import { blockReason } from './hook-helpers.js';

const onWindows = process.platform === 'win32';
const CONFIG = `${BRAND.stateDir}/config.json`;
const STATE = `${BRAND.stateDir}/local/stop-check.json`;
const SOURCE = 'src/a.ts';
const GIT_CANNOT_SAY = 'stop-check: git could not say what changed, so nothing ran';
// A stand-in test runner, installed as a JS bin: it logs each run beside itself, fails with 60 coloured lines while
// src/a.ts says broken, sleeps while it says slow, and prints 17 MB while it says loud.
const RUNNER = `const fs = require('node:fs');
fs.appendFileSync(__filename + '.log', JSON.stringify(process.argv.slice(2)) + '\\n');
const source = fs.readFileSync('src/a.ts', 'utf8');
if (source.includes('slow')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
if (source.includes('loud')) process.stdout.write('x'.repeat(17000000));
if (source.includes('broken')) {
  for (let line = 1; line <= 60; line += 1) console.log('\\u001b[31mline ' + line + '\\u001b[0m');
  process.exit(1);
}
console.log('all passed');
`;

/** A git repository whose config sets these stop-check options, with the stand-in runner in its node_modules. */
function project(options: object): string {
  const dir = tempRepo({
    '.gitignore': 'node_modules/\n.venv/\n',
    [SOURCE]: 'export const a = 1;\n',
    'README.md': '# App\n',
    'docs/guide.md': 'A guide.\n',
  });
  writeFiles(dir, {
    [CONFIG]: JSON.stringify({ preset: 'full', options: { 'stop-check': options } }),
    'node_modules/checker/package.json': JSON.stringify({ name: 'checker', bin: './bin/check.js' }),
    'node_modules/checker/bin/check.js': RUNNER,
  });
  return realpathSync.native(dir);
}

function stop(dir: string, payload: Payload = { stop_hook_active: false }): Answer {
  return stopCheck.answer({ payload }, { projectDir: dir, home: tempDir() });
}

function runs(dir: string): string[][] {
  const log = path.join(dir, 'node_modules/checker/bin/check.js.log');
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as string[]);
}

const noteOf = (answer: Answer): string | undefined => (answer.kind === 'done' ? answer.note : undefined);
const messageOf = (answer: Answer): unknown =>
  answer.kind === 'done' ? answer.output?.systemMessage : undefined;

describe('stop-check runs nothing it should not (#38, ADR-0015)', () => {
  it.each([
    ['unset', {}],
    ['empty', { 'checks.stop': [] }],
    ['of the wrong type', { 'checks.stop': 'checker' }],
  ])('runs nothing while checks.stop is %s', (_name, options) => {
    const dir = project(options);
    writeFiles(dir, { [SOURCE]: 'export const a = 2;\n' });
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(runs(dir)).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['true', true],
    ['a string', 'true'],
  ])('returns at once while stop_hook_active is %s, writing nothing', (_name, active) => {
    const dir = project({ 'checks.stop': ['checker'] });
    writeFiles(dir, { [SOURCE]: 'export const a = 2;\n' });
    expect(stop(dir, { stop_hook_active: active })).toEqual({ kind: 'done' });
    expect(runs(dir)).toEqual([]);
    expect(existsSync(path.join(dir, STATE))).toBe(false);
  });

  it('runs nothing, and says nothing, on a tree that matches HEAD', () => {
    const dir = project({ 'checks.stop': ['checker'] });
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(runs(dir)).toEqual([]);
  });

  it("runs nothing when only docs, Markdown or the kit's state changed", () => {
    const dir = project({ 'checks.stop': ['checker'] });
    writeFiles(dir, {
      'README.md': '# App, edited\n',
      'docs/guide.md': 'A better guide.\n',
      'docs/site/page.ts': 'export {};\n',
      [`${BRAND.stateDir}/lock.json`]: '{}\n',
    });
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(runs(dir)).toEqual([]);
  });

  it('lets Claude stop, running nothing, outside a git repository, noting that git could not say', () => {
    const dir = tempDir();
    writeFiles(dir, {
      [CONFIG]: JSON.stringify({ options: { 'stop-check': { 'checks.stop': ['checker'] } } }),
    });
    writeFiles(dir, { [SOURCE]: 'x\n', 'node_modules/checker/package.json': '{"bin":"./bin/check.js"}' });
    writeFiles(dir, { 'node_modules/checker/bin/check.js': RUNNER });
    expect(stop(dir)).toEqual({ kind: 'done', note: GIT_CANNOT_SAY });
    expect(runs(dir)).toEqual([]);
  });

  it("fails open, running nothing, with the note, where the repository's own config sets a filter program", () => {
    const dir = project({ 'checks.stop': ['checker'] });
    git(dir, 'config', 'filter.x.clean', 'node -e 1');
    writeFiles(dir, { [SOURCE]: 'export const a = 2;\n' });
    expect(stop(dir)).toEqual({ kind: 'done', note: GIT_CANNOT_SAY });
    expect(runs(dir)).toEqual([]);
  });
});

describe('stop-check runs once per change set (#38)', () => {
  it('runs the check when work files changed, then not again for the same change set once it passed', () => {
    const dir = project({ 'checks.stop': ['checker', '--run'] });
    writeFiles(dir, { [SOURCE]: 'export const a = 2;\n' });
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(runs(dir)).toEqual([['--run']]);
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(runs(dir)).toHaveLength(1);
  });

  it('blocks once with a header and the last 39 lines, escaped, and not again for the same change set', () => {
    const dir = project({ 'checks.stop': ['checker'] });
    writeFiles(dir, { [SOURCE]: 'export const a = "broken";\n' });
    const lines = (blockReason(stop(dir)) ?? '').split('\n');
    expect(lines).toHaveLength(40);
    expect(lines[0]).toBe(
      `${BRAND.displayName} stop check: "checker" exited 1; fix it or tell the user why:`,
    );
    expect(lines[1]).toBe('\\u001b[31mline 22\\u001b[0m');
    expect(lines.at(-1)).toBe('\\u001b[31mline 60\\u001b[0m');
    expect(lines.join('\n')).not.toContain('\u001b');
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(runs(dir)).toHaveLength(1);
  });

  it('runs again, and blocks again, once the change set changes', () => {
    const dir = project({ 'checks.stop': ['checker'] });
    writeFiles(dir, { [SOURCE]: 'export const a = "broken";\n' });
    expect(blockReason(stop(dir))).toBeDefined();
    writeFiles(dir, { [SOURCE]: 'export const a = "still broken";\n' });
    expect(blockReason(stop(dir))).toBeDefined();
    writeFiles(dir, { [SOURCE]: 'export const a = 3;\n' });
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(runs(dir)).toHaveLength(3);
  });

  it('skips a change set that passed before, after a failing one in between', () => {
    const dir = project({ 'checks.stop': ['checker'] });
    writeFiles(dir, { [SOURCE]: 'export const a = 2;\n' });
    stop(dir);
    writeFiles(dir, { [SOURCE]: 'export const a = "broken";\n' });
    expect(blockReason(stop(dir))).toBeDefined();
    writeFiles(dir, { [SOURCE]: 'export const a = 2;\n' });
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(runs(dir)).toHaveLength(2);
  });

  it('counts an untracked new file as a change', () => {
    const dir = project({ 'checks.stop': ['checker'] });
    writeFiles(dir, { 'src/new.ts': 'export const n = 1;\n' });
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(runs(dir)).toHaveLength(1);
  });

  it('starts a new change set with a new commit', () => {
    const dir = project({ 'checks.stop': ['checker'] });
    writeFiles(dir, { [SOURCE]: 'export const a = 2;\n' });
    stop(dir);
    commitFiles(dir, { 'src/b.ts': 'export const b = 1;\n' }, { message: 'b' });
    writeFiles(dir, { [SOURCE]: 'export const a = 3;\n' });
    stop(dir);
    expect(runs(dir)).toHaveLength(2);
  });

  it('takes its timeout from checks.stopTimeout, and lets Claude stop, once, when the run does not finish', () => {
    const dir = project({ 'checks.stop': ['checker'], 'checks.stopTimeout': 1 });
    writeFiles(dir, { [SOURCE]: 'export const a = "slow";\n' });
    const started = Date.now();
    const answer = stop(dir);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(blockReason(answer)).toBeUndefined();
    expect(noteOf(answer)).toBe('stop-check: "checker" did not finish in 1 s or could not start');
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(runs(dir)).toHaveLength(1);
  });

  it('notes a run stopped for printing over 16 MB with the same words, not as a timeout alone', () => {
    const dir = project({ 'checks.stop': ['checker'] });
    writeFiles(dir, { [SOURCE]: 'export const a = "loud";\n' });
    const answer = stop(dir);
    expect(blockReason(answer)).toBeUndefined();
    expect(noteOf(answer)).toBe('stop-check: "checker" did not finish in 300 s or could not start');
  });
});

describe('stop-check runners (#38, ADR-0015)', () => {
  it('runs npm test through npm-cli.js with --ignore-scripts, so a pretest script never runs', () => {
    const dir = project({ 'checks.stop': ['npm', 'test'] });
    const scripts = { pretest: 'node mark.js pretest-ran', test: 'node mark.js test-ran' };
    writeFiles(dir, {
      'package.json': JSON.stringify({ name: 'app', version: '1.0.0', scripts }),
      'mark.js': "require('node:fs').writeFileSync(process.argv[2], 'x');\n",
    });
    // The real npm runs here: its user config and its cache, where it writes a log on every run, stay in temp folders.
    const npm = tempDir();
    writeFiles(npm, { npmrc: '' });
    stubEnv('npm_config_userconfig', path.join(npm, 'npmrc'));
    stubEnv('npm_config_cache', path.join(npm, 'cache'));
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(existsSync(path.join(dir, 'test-ran'))).toBe(true);
    expect(existsSync(path.join(dir, 'pretest-ran'))).toBe(false);
    expect(readdirSync(path.join(npm, 'cache', '_logs'))).not.toEqual([]);
  });

  it.skipIf(onWindows)('runs a Python tool from the .venv as a real executable', () => {
    const dir = project({ 'checks.stop': ['pytest', '-q'] });
    const log = path.join(dir, '.venv', 'bin', 'pytest.log');
    writeFiles(dir, { '.venv/bin/pytest': `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\n` });
    chmodSync(path.join(dir, '.venv/bin/pytest'), 0o755);
    writeFiles(dir, { [SOURCE]: 'export const a = 2;\n' });
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(readFileSync(log, 'utf8')).toBe('-q\n');
  });

  it.each([
    [['uv', 'run', 'pytest'], 'uv is a shell, wrapper or runner'],
    [['bash', '-c', 'npm test'], 'bash is a shell, wrapper or runner'],
    [['make', 'test'], 'make is a shell, wrapper or runner'],
    [['npm', 'install'], 'npm runs only as npm test or npm run <script>, its options after --'],
    [['no-such-runner'], 'not found in node_modules, .venv or PATH'],
  ])('skips %j with a single hint for the user', (command, why) => {
    const dir = project({ 'checks.stop': command });
    writeFiles(dir, { [SOURCE]: 'export const a = 2;\n' });
    const first = stop(dir);
    expect(outcomeOf(first)).toBe('message');
    expect(messageOf(first)).toBe(
      `${BRAND.displayName} stop check skipped ${JSON.stringify(command.join(' '))} from checks.stop in ${CONFIG}: ${why}.`,
    );
    writeFiles(dir, { [SOURCE]: 'export const a = 3;\n' });
    expect(stop(dir)).toEqual({ kind: 'done' });
    expect(runs(dir)).toEqual([]);
  });
});

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

describe.skipIf(!canSymlink())('stop-check state safety (ADR-0015)', () => {
  it('never blocks, noting why with forward slashes, when it cannot record the result', () => {
    // A backslash in a folder name stands in for a Windows path's separators on every OS.
    const moved = path.join(tempDir(), 'back\\slash');
    mkdirSync(path.dirname(moved), { recursive: true });
    renameSync(project({ 'checks.stop': ['checker'] }), moved);
    const dir = realpathSync.native(moved);
    const outside = tempDir();
    mkdirSync(path.join(dir, BRAND.stateDir), { recursive: true });
    symlinkSync(outside, path.join(dir, BRAND.stateDir, 'local'));
    writeFiles(dir, { [SOURCE]: 'export const a = "broken";\n' });
    const answer = stop(dir);
    expect(blockReason(answer)).toBeUndefined();
    expect(noteOf(answer)).toMatch(/^stop-check: \S*\/back\/slash\/\S*local is a symlink$/);
    expect(existsSync(path.join(outside, 'stop-check.json'))).toBe(false);
  });
});
