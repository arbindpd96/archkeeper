import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findProgram, runNodeTool, runProgram } from '../src/hooks/runtime/tools.js';
import { tempDir, writeFiles } from './helpers.js';

const onWindows = process.platform === 'win32';
const PRINT_COLOUR = 'process.stdout.write(`${process.env.FORCE_COLOR}|${process.env.NO_COLOR}`);';
// A test run that fails at once, leaving a process that holds its output for 4 seconds, as a server it started would.
// That process works in the system temp folder, since Windows cannot delete a folder a live process works in.
const LEAVES_A_PROCESS =
  "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { cwd: require('node:os').tmpdir(), stdio: 'inherit', detached: true }).unref();\nconsole.log('1 failed');\nprocess.exit(1);";
const IGNORES_SIGTERM = "process.on('SIGTERM', () => {});\nsetTimeout(() => process.exit(1), 5000);";
// A crash, or the OOM killer, ends a program with a signal no deadline sent.
const KILLS_ITSELF = "require('node:fs').writeSync(1, 'crashed\\n');\nprocess.kill(process.pid, 'SIGKILL');";

describe('programs a hook runs (ADR-0015)', () => {
  it('runs a Node.js tool through the Node.js that runs the hook, with no shell', () => {
    const dir = tempDir();
    writeFiles(dir, { 'tool.mjs': 'process.stdout.write(process.argv.slice(2).join("|"));' });
    const run = runNodeTool(path.join(dir, 'tool.mjs'), ['a b', '$HOME', ';ls'], { cwd: dir });
    expect(run).toEqual({ status: 0, stdout: 'a b|$HOME|;ls', stderr: '' });
  });

  it('turns colour off for a program run with no environment of its own, and keeps one it is given', () => {
    const dir = tempDir();
    writeFiles(dir, { 'tool.mjs': PRINT_COLOUR });
    const entry = path.join(dir, 'tool.mjs');
    expect(runNodeTool(entry, [], { cwd: dir }).stdout).toBe('0|1');
    const env = { ...process.env, FORCE_COLOR: '3', NO_COLOR: '' };
    expect(runNodeTool(entry, [], { cwd: dir, env }).stdout).toBe('3|');
  });

  it('keeps the exit status of a program that exited while a process it left holds its output', () => {
    const dir = tempDir();
    writeFiles(dir, { 'tool.cjs': LEAVES_A_PROCESS });
    const run = runNodeTool(path.join(dir, 'tool.cjs'), [], { cwd: dir, timeoutMs: 2000 });
    expect(run).toMatchObject({ status: 1, stdout: '1 failed\n' });
  });

  it('kills a program that ignores SIGTERM at its deadline, with no status', () => {
    const dir = tempDir();
    writeFiles(dir, { 'tool.cjs': IGNORES_SIGTERM });
    const started = Date.now();
    const run = runNodeTool(path.join(dir, 'tool.cjs'), [], { cwd: dir, timeoutMs: 1000 });
    expect(run.status).toBeNull();
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it.skipIf(onWindows)(
    'gives a program a signal ended on its own 128 plus the signal number, as a shell does',
    () => {
      const dir = tempDir();
      writeFiles(dir, { 'tool.cjs': KILLS_ITSELF });
      const run = runNodeTool(path.join(dir, 'tool.cjs'), [], { cwd: dir });
      expect(run).toMatchObject({ status: 137, stdout: 'crashed\n' });
    },
  );

  it('stops a program that prints more than maxBuffer bytes, with no status', () => {
    const dir = tempDir();
    writeFiles(dir, { 'tool.mjs': 'process.stdout.write("x".repeat(2048));' });
    const entry = path.join(dir, 'tool.mjs');
    expect(runNodeTool(entry, [], { cwd: dir, maxBuffer: 1024 }).status).toBeNull();
    expect(runNodeTool(entry, [], { cwd: dir, maxBuffer: 4096 })).toMatchObject({ status: 0 });
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
