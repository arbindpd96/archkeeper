import { chmodSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript, tempDir, writeFiles, type RunResult } from './helpers.js';

// A stand-in for gh: it records its arguments and fills --dir with the files of an artifact.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.FAKE_GH_ARGS, JSON.stringify(args));
if (process.env.FAKE_GH_FAIL) process.exit(1);
const dir = args[args.indexOf('--dir') + 1];
for (const name of ['init.gif', '_smoke.gif', 'notes.txt']) fs.writeFileSync(path.join(dir, name), name);
`;

function pullGifs(args: string[], env: NodeJS.ProcessEnv = {}): RunResult & { root: string; ghArgs: string } {
  const root = tempDir();
  const bin = tempDir();
  writeFiles(root, { 'docs/media/.keep': '' });
  writeFiles(bin, { gh: FAKE_GH });
  chmodSync(path.join(bin, 'gh'), 0o755);
  const ghArgs = path.join(bin, 'args.json');
  const result = runScript('scripts/pull-gifs.mjs', {
    args,
    cwd: root,
    env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, FAKE_GH_ARGS: ghArgs, ...env },
  });
  return { ...result, root, ghArgs: existsSync(ghArgs) ? readFileSync(ghArgs, 'utf8') : '' };
}

describe.skipIf(process.platform === 'win32')('pull-gifs', () => {
  it('copies the feature GIFs of a demo-gifs run into docs/media and skips pipeline GIFs', () => {
    const result = pullGifs(['12345']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.ghArgs)).toEqual(
      expect.arrayContaining(['run', 'download', '12345', '--name', 'demo-gifs']),
    );
    expect(readFileSync(path.join(result.root, 'docs/media/init.gif'), 'utf8')).toBe('init.gif');
    expect(existsSync(path.join(result.root, 'docs/media/_smoke.gif'))).toBe(false);
    expect(existsSync(path.join(result.root, 'docs/media/notes.txt'))).toBe(false);
    expect(result.stdout).toContain('run npm run demos');
  });

  it.each([[[]], [['latest']], [['12', '34']]])('rejects run id arguments %j with usage', (args) => {
    const result = pullGifs(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: npm run gifs:pull -- <run-id>');
    expect(result.ghArgs).toBe('');
  });

  it('reports a failed download', () => {
    const result = pullGifs(['12345'], { FAKE_GH_FAIL: '1' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gh could not download the demo-gifs artifact of run 12345');
  });
});
