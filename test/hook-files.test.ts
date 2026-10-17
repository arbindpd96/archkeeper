import { execFileSync } from 'node:child_process';
import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readModuleOptions } from '../src/hooks/runtime/options.js';
import { readProjectFile, readRegularFile } from '../src/hooks/runtime/project.js';
import { readState, writeState } from '../src/hooks/runtime/state.js';
import { findProgram, runNodeTool, runProgram } from '../src/hooks/runtime/tools.js';
import { canSymlink, tempDir, writeFiles } from './helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const LOCAL = `${TEST_BRAND.stateDir}/local`;
const onWindows = process.platform === 'win32';

describe('hook state under the local state folder (ADR-0014, ADR-0015)', () => {
  it('writes state with its own ignore-all .gitignore, and reads it back', () => {
    const dir = tempDir();
    expect(writeState(dir, 'snapshots/latest.json', '{"a":1}', TEST_BRAND)).toEqual({ written: true });
    expect(readState(dir, 'snapshots/latest.json', TEST_BRAND)).toBe('{"a":1}');
    expect(readFileSync(path.join(dir, LOCAL, '.gitignore'), 'utf8')).toBe('*\n');
  });

  it.skipIf(onWindows)('creates state files with mode 0600', () => {
    const dir = tempDir();
    writeState(dir, 'active-feature', 'x', TEST_BRAND);
    expect(statSync(path.join(dir, LOCAL, 'active-feature')).mode & 0o777).toBe(0o600);
  });

  it('rewrites a local .gitignore that does not ignore everything', () => {
    const dir = tempDir();
    writeFiles(dir, { [`${LOCAL}/.gitignore`]: '!keep\n' });
    writeState(dir, 'x', 'y', TEST_BRAND);
    expect(readFileSync(path.join(dir, LOCAL, '.gitignore'), 'utf8')).toBe('*\n');
  });

  it.each(['../escape', '/abs', 'a/../b', '.', 'a\\b', ''])('refuses the state name %j', (name) => {
    const result = writeState(tempDir(), name, 'x', TEST_BRAND);
    expect(result).toMatchObject({
      written: false,
      problem: expect.stringContaining('not a plain') as string,
    });
  });

  it('skips and reports a write to a state file that is not a regular file', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, LOCAL, 'x'), { recursive: true });
    expect(writeState(dir, 'x', 'y', TEST_BRAND)).toMatchObject({ written: false });
  });

  it('writes through no hardlink planted at the state name', () => {
    const dir = tempDir();
    const outside = path.join(tempDir(), 'bashrc');
    writeFileSync(outside, 'mine\n');
    mkdirSync(path.join(dir, LOCAL), { recursive: true });
    linkSync(outside, path.join(dir, LOCAL, 'state'));
    expect(writeState(dir, 'state', 'hook', TEST_BRAND)).toEqual({ written: true });
    expect(readFileSync(outside, 'utf8')).toBe('mine\n');
  });

  it('leaves no temp file behind', () => {
    const dir = tempDir();
    writeState(dir, 'a', 'b', TEST_BRAND);
    expect(readdirSync(path.join(dir, LOCAL)).sort()).toEqual(['.gitignore', 'a']);
  });

  it('leaves the same tree when it writes the same state twice', () => {
    const dir = tempDir();
    writeState(dir, 'snapshots/latest.json', '{"a":1}', TEST_BRAND);
    const ignore = statSync(path.join(dir, LOCAL, '.gitignore'));
    const tree = (): string[] =>
      readdirSync(path.join(dir, LOCAL), { recursive: true, encoding: 'utf8' }).sort();
    const first = tree();
    expect(writeState(dir, 'snapshots/latest.json', '{"a":1}', TEST_BRAND)).toEqual({ written: true });
    expect(tree()).toEqual(first);
    expect(first).toEqual(['.gitignore', 'snapshots', path.join('snapshots', 'latest.json')]);
    expect(statSync(path.join(dir, LOCAL, '.gitignore'))).toMatchObject({
      ino: ignore.ino,
      mtimeMs: ignore.mtimeMs,
    });
    expect(readState(dir, 'snapshots/latest.json', TEST_BRAND)).toBe('{"a":1}');
  });

  it('reads missing state without creating the local folder', () => {
    const dir = tempDir();
    expect(readState(dir, 'active-feature', TEST_BRAND)).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses to write over the local ignore-all file', () => {
    const dir = tempDir();
    expect(writeState(dir, '.gitignore', '!*\n', TEST_BRAND)).toMatchObject({ written: false });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reads state only from a local folder as a write leaves it, whose .gitignore ignores everything', () => {
    const dir = tempDir();
    writeFiles(dir, { [`${LOCAL}/state`]: 'planted' });
    expect(readState(dir, 'state', TEST_BRAND)).toBeNull();
    writeFiles(dir, { [`${LOCAL}/.gitignore`]: '!state\n' });
    expect(readState(dir, 'state', TEST_BRAND)).toBeNull();
    writeFiles(dir, { [`${LOCAL}/.gitignore`]: '*\r\n' });
    expect(readState(dir, 'state', TEST_BRAND)).toBe('planted');
    expect(readdirSync(path.join(dir, LOCAL)).sort()).toEqual(['.gitignore', 'state']);
  });
});

describe.skipIf(!canSymlink())('hook state through symlinks', () => {
  it('refuses a local folder that is a symlink', () => {
    const dir = tempDir();
    const elsewhere = tempDir();
    mkdirSync(path.join(dir, TEST_BRAND.stateDir));
    symlinkSync(elsewhere, path.join(dir, LOCAL), 'dir');
    expect(writeState(dir, 'x', 'y', TEST_BRAND)).toMatchObject({
      written: false,
      problem: expect.stringContaining('symlink') as string,
    });
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('refuses a state folder that is a symlink', () => {
    const dir = tempDir();
    symlinkSync(tempDir(), path.join(dir, TEST_BRAND.stateDir), 'dir');
    expect(writeState(dir, 'x', 'y', TEST_BRAND)).toMatchObject({ written: false });
  });

  it('refuses a symlink planted at the state name and writes nothing through it', () => {
    const dir = tempDir();
    const outside = path.join(tempDir(), 'target');
    writeFileSync(outside, 'mine\n');
    mkdirSync(path.join(dir, LOCAL), { recursive: true });
    symlinkSync(outside, path.join(dir, LOCAL, 'state'));
    expect(writeState(dir, 'state', 'hook', TEST_BRAND)).toMatchObject({ written: false });
    expect(readFileSync(outside, 'utf8')).toBe('mine\n');
    expect(readState(dir, 'state', TEST_BRAND)).toBeNull();
  });

  it('reads no state where a write is refused because local/.gitignore is a symlink', () => {
    const dir = tempDir();
    const outside = path.join(tempDir(), 'ignore');
    writeFileSync(outside, '*\n');
    writeFiles(dir, { [`${LOCAL}/state`]: 'planted' });
    symlinkSync(outside, path.join(dir, LOCAL, '.gitignore'));
    expect(writeState(dir, 'other', 'hook', TEST_BRAND)).toMatchObject({ written: false });
    expect(readState(dir, 'state', TEST_BRAND)).toBeNull();
  });
});

describe('project files a hook reads', () => {
  it('reads a regular project file and names a missing one', () => {
    const dir = tempDir();
    writeFiles(dir, { 'a/b.txt': 'hi' });
    expect(readProjectFile(dir, 'a/b.txt', 100)).toEqual({ text: 'hi' });
    expect(readProjectFile(dir, 'a/c.txt', 100)).toEqual({ missing: true });
  });

  it('refuses a file over its size cap', () => {
    const dir = tempDir();
    writeFiles(dir, { 'big.txt': 'x'.repeat(101) });
    expect(readProjectFile(dir, 'big.txt', 100)).toMatchObject({ problem: expect.any(String) as string });
  });

  it.skipIf(!canSymlink())('refuses a project file that is a symlink', () => {
    const dir = tempDir();
    writeFiles(dir, { 'real.txt': 'x' });
    symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'link.txt'));
    expect(readProjectFile(dir, 'link.txt', 100)).toEqual({ problem: 'it is a symlink' });
  });

  it.skipIf(onWindows)('reads no FIFO, and never waits on one', () => {
    const fifo = path.join(tempDir(), 'pipe');
    execFileSync('mkfifo', [fifo]);
    expect(readRegularFile(fifo, 100)).toBeNull();
  });
});

describe('module options from the project config', () => {
  const config = (dir: string, text: string): void => {
    writeFiles(dir, { [`${TEST_BRAND.stateDir}/config.json`]: text });
  };

  it('gives no values without a config or an entry for the module', () => {
    const dir = tempDir();
    expect(readModuleOptions(dir, 'safety', TEST_BRAND)).toEqual({ values: {} });
    config(dir, '{"version":1,"preset":"small"}');
    expect(readModuleOptions(dir, 'safety', TEST_BRAND)).toEqual({ values: {} });
  });

  it("reads the module's options", () => {
    const dir = tempDir();
    config(dir, '{"options":{"safety":{"blockNoVerify":true}}}');
    expect(readModuleOptions(dir, 'safety', TEST_BRAND)).toEqual({ values: { blockNoVerify: true } });
  });

  it('reads a config saved with a byte-order mark, as editors on Windows may save it', () => {
    const dir = tempDir();
    config(dir, '\uFEFF{"options":{"safety":{"blockNoVerify":true}}}');
    expect(readModuleOptions(dir, 'safety', TEST_BRAND)).toEqual({ values: { blockNoVerify: true } });
  });

  it.each(['{', '{"options":{"safety":[]}}'])('names the problem with the config %j', (text) => {
    const dir = tempDir();
    config(dir, text);
    expect(readModuleOptions(dir, 'safety', TEST_BRAND)).toMatchObject({
      problem: expect.any(String) as string,
    });
  });
});

describe('programs a hook runs (ADR-0015)', () => {
  it('runs a Node.js tool through the Node.js that runs the hook, with no shell', () => {
    const dir = tempDir();
    writeFiles(dir, { 'tool.mjs': 'process.stdout.write(process.argv.slice(2).join("|"));' });
    const run = runNodeTool(path.join(dir, 'tool.mjs'), ['a b', '$HOME', ';ls'], { cwd: dir });
    expect(run).toEqual({ status: 0, stdout: 'a b|$HOME|;ls', stderr: '' });
  });

  it.each(['git', 'C:/tools/npm.cmd', '/x/y.BAT'])(
    'refuses to run %j, which is no absolute path to a real program',
    (file) => {
      expect(() => runProgram(file, [], { cwd: tempDir() })).toThrow(
        'not an absolute path to a real program',
      );
    },
  );

  it.skipIf(onWindows)('finds a program only in absolute PATH folders outside the project', () => {
    const project = tempDir();
    const outside = tempDir();
    for (const folder of [path.join(project, 'bin'), outside]) {
      writeFiles(folder, { tool: '#!/bin/sh\n' });
      execFileSync('chmod', ['+x', path.join(folder, 'tool')]);
    }
    const pathValue = ['bin', '', path.join(project, 'bin'), outside].join(path.delimiter);
    expect(findProgram('tool', project, pathValue)).toBe(path.join(outside, 'tool'));
    expect(findProgram('tool', project, path.join(project, 'bin'))).toBeUndefined();
  });
});
