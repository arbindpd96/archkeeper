import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeBin, runScript, tempDir, writeFiles, type RunResult } from './helpers.js';

const OWN_RUN = {
  path: '.github/workflows/demo-gifs.yml',
  conclusion: 'success',
  branch: 'feat/init',
  sha: '0123456789abcdef0123456789abcdef01234567',
  actor: 'maintainer',
  triggeringActor: 'maintainer',
  head: 'owner/repo',
  repo: 'owner/repo',
};
const MANIFEST = JSON.stringify({
  repository: { type: 'git', url: 'git+https://github.com/owner/repo.git' },
});

// A stand-in for gh: it logs every call, prints FAKE_GH_RUN for `api`, and fills --dir for `run download`.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'api') {
  process.stdout.write(process.env.FAKE_GH_RUN);
  process.exit(0);
}
if (process.env.FAKE_GH_FAIL) process.exit(1);
const dir = args[args.indexOf('--dir') + 1];
for (const name of ['init.gif', '_smoke.gif', 'notes.txt']) fs.writeFileSync(path.join(dir, name), name);
`;

interface PullOptions {
  run?: Record<string, string>;
  files?: Record<string, string>;
  env?: NodeJS.ProcessEnv;
  prepare?: (root: string) => void;
}

function pullGifs(
  args: string[],
  options: PullOptions = {},
): RunResult & { root: string; calls: string[][] } {
  const root = tempDir();
  const bin = fakeBin('gh', FAKE_GH);
  writeFiles(root, { 'package.json': MANIFEST, 'docs/media/tapes/init.tape': '', ...options.files });
  options.prepare?.(root);
  const log = path.join(bin, 'calls.log');
  writeFiles(bin, { 'calls.log': '' });
  const result = runScript('scripts/pull-gifs.mjs', {
    args,
    cwd: root,
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      FAKE_GH_LOG: log,
      FAKE_GH_RUN: JSON.stringify(options.run ?? OWN_RUN),
      ...options.env,
    },
  });
  const calls = readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
  return { ...result, root, calls };
}

describe.skipIf(process.platform === 'win32')('pull-gifs', () => {
  it('copies the feature GIFs of a demo-gifs run into docs/media and skips pipeline GIFs', () => {
    const result = pullGifs(['12345']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(result.root, 'docs/media/init.gif'), 'utf8')).toBe('init.gif');
    expect(existsSync(path.join(result.root, 'docs/media/_smoke.gif'))).toBe(false);
    expect(existsSync(path.join(result.root, 'docs/media/notes.txt'))).toBe(false);
    expect(result.stdout).toContain('run npm run demos');
  });

  it('names the repository from package.json in both gh calls', () => {
    const { calls } = pullGifs(['12345']);
    expect(calls[0]).toEqual(expect.arrayContaining(['api', 'repos/owner/repo/actions/runs/12345']));
    expect(calls[1]).toEqual(
      expect.arrayContaining(['run', 'download', '12345', '--repo', 'owner/repo', '--name', 'demo-gifs']),
    );
  });

  it("prints the run's commit and branch before copying", () => {
    const { stdout } = pullGifs(['12345']);
    expect(stdout).toContain(`run 12345 rendered ${OWN_RUN.sha} on feat/init.`);
    expect(stdout.indexOf('rendered')).toBeLessThan(stdout.indexOf('docs/media/init.gif'));
  });

  it('replaces an existing GIF that is a regular file', () => {
    const result = pullGifs(['12345'], { files: { 'docs/media/init.gif': 'old' } });
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(result.root, 'docs/media/init.gif'), 'utf8')).toBe('init.gif');
  });

  it('refuses to write through a symlink in docs/media', () => {
    const outside = path.join(tempDir(), 'target.txt');
    writeFiles(path.dirname(outside), { 'target.txt': 'keep' });
    const prepare = (root: string): void => {
      symlinkSync(outside, path.join(root, 'docs/media/init.gif'));
    };
    const result = pullGifs(['12345'], { prepare });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/media/init.gif exists and is not a regular file');
    expect(readFileSync(outside, 'utf8')).toBe('keep');
  });

  it.each([
    ['a fork', { ...OWN_RUN, head: 'someone/fork' }, 'it ran for a fork'],
    ['another workflow', { ...OWN_RUN, path: '.github/workflows/ci.yml' }, 'it ran .github/workflows/ci.yml'],
    ['a failed run', { ...OWN_RUN, conclusion: 'failure' }, 'it ended with failure'],
    [
      'a Dependabot branch',
      { ...OWN_RUN, branch: 'dependabot/npm_and_yarn/x-1.2.3' },
      'Dependabot started it',
    ],
    [
      'a run Dependabot triggered',
      { ...OWN_RUN, triggeringActor: 'dependabot[bot]' },
      'Dependabot started it',
    ],
  ])('refuses the artifact of %s', (_name, run, message) => {
    const result = pullGifs(['12345'], { run });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing run 12345: ${message}`);
    expect(result.calls.map((call) => call[0])).toEqual(['api']);
  });

  it('refuses a package.json without a GitHub repository URL', () => {
    const result = pullGifs(['12345'], { files: { 'package.json': '{}' } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package.json repository must be a github.com URL');
    expect(result.calls).toEqual([]);
  });

  it.each([[[]], [['latest']], [['12', '34']]])('rejects run id arguments %j with usage', (args) => {
    const result = pullGifs(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: npm run gifs:pull -- <run-id>');
    expect(result.calls).toEqual([]);
  });

  it('reports a failed download', () => {
    const result = pullGifs(['12345'], { env: { FAKE_GH_FAIL: '1' } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gh could not download the demo-gifs artifact of run 12345');
  });
});
