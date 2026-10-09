#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exitWith } from './lib.mjs';

const ARTIFACT = 'demo-gifs';
const WORKFLOW = '.github/workflows/demo-gifs.yml';
const MEDIA = 'docs/media';
const RUN_ID = /^\d+$/;
// Pipeline GIFs such as _smoke.gif never land in docs/media; anything else must be a plain tape name.
const FEATURE_GIF = /^[a-z0-9][a-z0-9-]*\.gif$/;
const RUN_FACTS = '{path, conclusion, head: .head_repository.full_name, repo: .repository.full_name}';

/** Runs gh without a shell and returns stdout, or exits saying what could not be done. */
function gh(args, action) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch {
    return exitWith(`pull-gifs: gh could not ${action}. Check the run id and gh auth status.`, 1);
  }
}

/** Exits unless the run is a successful demo-gifs run of this repository, never a fork's run. */
function requireOwnDemoRun(runId) {
  const facts = JSON.parse(
    gh(['api', `repos/{owner}/{repo}/actions/runs/${runId}`, '--jq', RUN_FACTS], `read run ${runId}`),
  );
  const fromFork = facts.head !== facts.repo;
  if (String(facts.path).split('@')[0] !== WORKFLOW || facts.conclusion !== 'success' || fromFork) {
    exitWith(
      `pull-gifs: run ${runId} is not a successful ${ARTIFACT} run from this repository ` +
        `(workflow ${String(facts.path)}, ${String(facts.conclusion)}${fromFork ? ', from a fork' : ''}). ` +
        'Re-render a fork contribution with workflow_dispatch on a maintainer branch.',
      1,
    );
  }
}

const [runId, ...extra] = process.argv.slice(2);
if (!RUN_ID.test(runId ?? '') || extra.length > 0) {
  exitWith('Usage: npm run gifs:pull -- <run-id>   (a demo-gifs workflow run, from gh run list)', 2);
}
requireOwnDemoRun(runId);
const download = mkdtempSync(path.join(tmpdir(), 'pull-gifs-'));
process.on('exit', () => rmSync(download, { recursive: true, force: true }));
gh(
  ['run', 'download', runId, '--name', ARTIFACT, '--dir', download],
  `download the ${ARTIFACT} artifact of run ${runId}`,
);
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
