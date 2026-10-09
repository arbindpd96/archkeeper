#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exitWith } from './lib.mjs';

const ARTIFACT = 'demo-gifs';
const MEDIA = 'docs/media';
const RUN_ID = /^\d+$/;
// Pipeline GIFs such as _smoke.gif never land in docs/media; anything else must be a plain tape name.
const FEATURE_GIF = /^[a-z0-9][a-z0-9-]*\.gif$/;

const [runId, ...extra] = process.argv.slice(2);
if (!RUN_ID.test(runId ?? '') || extra.length > 0) {
  exitWith('Usage: npm run gifs:pull -- <run-id>   (a demo-gifs workflow run, from gh run list)', 2);
}
const download = mkdtempSync(path.join(tmpdir(), 'pull-gifs-'));
process.on('exit', () => rmSync(download, { recursive: true, force: true }));
try {
  execFileSync('gh', ['run', 'download', runId, '--name', ARTIFACT, '--dir', download], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
} catch {
  exitWith(
    `pull-gifs: gh could not download the ${ARTIFACT} artifact of run ${runId}. Check gh auth status.`,
    1,
  );
}
const gifs = readdirSync(download).filter((file) => FEATURE_GIF.test(file));
for (const gif of gifs) {
  copyFileSync(path.join(download, gif), path.join(MEDIA, gif));
  process.stdout.write(`pull-gifs: ${MEDIA}/${gif}\n`);
}
process.stdout.write(
  gifs.length === 0
    ? 'pull-gifs: the artifact has no feature GIFs, only pipeline ones such as _smoke.gif.\n'
    : 'pull-gifs: run npm run demos, then commit each GIF with its tape and README section.\n',
);
