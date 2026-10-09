import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeBin, runScript, tempDir, writeFiles, type RunResult } from './helpers.js';

const OWN_RUN = {
  path: '.github/workflows/demo-gifs.yml',
  conclusion: 'success',
  head: 'owner/repo',
  repo: 'owner/repo',
};

// A stand-in for gh: `api` prints FAKE_GH_RUN, and `run download` records its arguments and fills --dir.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'api') {
  process.stdout.write(process.env.FAKE_GH_RUN);
  process.exit(0);
}
fs.writeFileSync(process.env.FAKE_GH_ARGS, JSON.stringify(args));
if (process.env.FAKE_GH_FAIL) process.exit(1);
const dir = args[args.indexOf('--dir') + 1];
for (const name of ['init.gif', '_smoke.gif', 'notes.txt']) fs.writeFileSync(path.join(dir, name), name);
`;

function pullGifs(
  args: string[],
  run: Record<string, string> = OWN_RUN,
  env: NodeJS.ProcessEnv = {},
): RunResult & { root: string; downloaded: string } {
  const root = tempDir();
  const bin = fakeBin('gh', FAKE_GH);
  writeFiles(root, { 'docs/media/.keep': '' });
  const ghArgs = path.join(bin, 'args.json');
  const result = runScript('scripts/pull-gifs.mjs', {
    args,
    cwd: root,
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      FAKE_GH_ARGS: ghArgs,
      FAKE_GH_RUN: JSON.stringify(run),
      ...env,
    },
  });
  return { ...result, root, downloaded: existsSync(ghArgs) ? readFileSync(ghArgs, 'utf8') : '' };
}

describe.skipIf(process.platform === 'win32')('pull-gifs', () => {
  it('copies the feature GIFs of a demo-gifs run into docs/media and skips pipeline GIFs', () => {
    const result = pullGifs(['12345']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.downloaded)).toEqual(
      expect.arrayContaining(['run', 'download', '12345', '--name', 'demo-gifs']),
    );
    expect(readFileSync(path.join(result.root, 'docs/media/init.gif'), 'utf8')).toBe('init.gif');
    expect(existsSync(path.join(result.root, 'docs/media/_smoke.gif'))).toBe(false);
    expect(existsSync(path.join(result.root, 'docs/media/notes.txt'))).toBe(false);
    expect(result.stdout).toContain('run npm run demos');
  });

  it.each([
    ['a fork', { ...OWN_RUN, head: 'someone/fork' }, 'from a fork'],
    [
      'another workflow',
      { ...OWN_RUN, path: '.github/workflows/ci.yml' },
      'workflow .github/workflows/ci.yml',
    ],
    ['a failed run', { ...OWN_RUN, conclusion: 'failure' }, 'failure'],
  ])('refuses the artifact of %s', (_name, run, message) => {
    const result = pullGifs(['12345'], run);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not a successful demo-gifs run from this repository');
    expect(result.stderr).toContain(message);
    expect(result.downloaded).toBe('');
  });

  it.each([[[]], [['latest']], [['12', '34']]])('rejects run id arguments %j with usage', (args) => {
    const result = pullGifs(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: npm run gifs:pull -- <run-id>');
    expect(result.downloaded).toBe('');
  });

  it('reports a failed download', () => {
    const result = pullGifs(['12345'], OWN_RUN, { FAKE_GH_FAIL: '1' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gh could not download the demo-gifs artifact of run 12345');
  });
});
