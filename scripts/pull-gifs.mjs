#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { constants, copyFileSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exitWith } from './lib.mjs';

const ARTIFACT = 'demo-gifs';
const WORKFLOW = '.github/workflows/demo-gifs.yml';
const MEDIA = 'docs/media';
const RUN_ID = /^\d+$/;
const GITHUB_REPOSITORY = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/;
// Pipeline GIFs such as _smoke.gif never land in docs/media; anything else must be a plain tape name.
const FEATURE_GIF = /^[a-z0-9][a-z0-9-]*\.gif$/;
const RUN_FACTS =
  '{path, conclusion, branch: .head_branch, sha: .head_sha, actor: .actor.login, ' +
  'triggeringActor: .triggering_actor.login, head: .head_repository.full_name, repo: .repository.full_name}';

/** Runs gh without a shell and returns stdout, or exits saying what could not be done. */
function gh(args, action) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch {
    return exitWith(`pull-gifs: gh could not ${action}. Check the run id and gh auth status.`, 1);
  }
}

/** Reads `<owner>/<repo>` from package.json `repository`, so gh never guesses it from a git remote. */
function repositorySlug() {
  const { repository } = JSON.parse(readFileSync('package.json', 'utf8'));
  const url = typeof repository === 'string' ? repository : repository?.url;
  const slug = GITHUB_REPOSITORY.exec(String(url ?? ''))?.[1];
  if (slug === undefined) exitWith('pull-gifs: package.json repository must be a github.com URL.', 1);
  return slug;
}

/** Says why a run's artifact cannot be trusted, or returns undefined when it can. */
function runProblem(facts) {
  if (String(facts.path).split('@')[0] !== WORKFLOW) return `it ran ${String(facts.path)}, not ${WORKFLOW}`;
  if (facts.conclusion !== 'success') return `it ended with ${String(facts.conclusion)}`;
  if (facts.head !== facts.repo) return 'it ran for a fork, whose pull request controls the artifact';
  const byDependabot = [facts.actor, facts.triggeringActor].includes('dependabot[bot]');
  if (byDependabot || String(facts.branch).startsWith('dependabot/')) {
    return 'Dependabot started it, so dependency code built what it rendered';
  }
  return undefined;
}

/** Copies a GIF into docs/media, replacing only a regular file and never writing through a symlink. */
function copyGif(source, name) {
  const destination = path.join(MEDIA, name);
  let existing;
  try {
    existing = lstatSync(destination);
  } catch {
    existing = undefined;
  }
  if (existing !== undefined && !existing.isFile()) {
    exitWith(`pull-gifs: ${destination} exists and is not a regular file; remove it first.`, 1);
  }
  if (existing !== undefined) rmSync(destination);
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
  process.stdout.write(`pull-gifs: ${destination}\n`);
}

const [runId, ...extra] = process.argv.slice(2);
if (!RUN_ID.test(runId ?? '') || extra.length > 0) {
  exitWith('Usage: npm run gifs:pull -- <run-id>   (a demo-gifs workflow run, from gh run list)', 2);
}
const repo = repositorySlug();
const facts = JSON.parse(
  gh(['api', `repos/${repo}/actions/runs/${runId}`, '--jq', RUN_FACTS], `read run ${runId}`),
);
const problem = runProblem(facts);
if (problem !== undefined) {
  exitWith(
    `pull-gifs: refusing run ${runId}: ${problem}. Re-render with workflow_dispatch on your branch.`,
    1,
  );
}
if (!lstatSync(MEDIA, { throwIfNoEntry: false })?.isDirectory()) {
  exitWith(`pull-gifs: ${MEDIA} must be a real folder; run it from the repository root.`, 1);
}
process.stdout.write(`pull-gifs: run ${runId} rendered ${String(facts.sha)} on ${String(facts.branch)}.\n`);
const download = mkdtempSync(path.join(tmpdir(), 'pull-gifs-'));
process.on('exit', () => rmSync(download, { recursive: true, force: true }));
gh(
  ['run', 'download', runId, '--repo', repo, '--name', ARTIFACT, '--dir', download],
  `download the ${ARTIFACT} artifact of run ${runId}`,
);
const gifs = readdirSync(download).filter((file) => FEATURE_GIF.test(file));
for (const gif of gifs) copyGif(path.join(download, gif), gif);
process.stdout.write(
  gifs.length === 0
    ? 'pull-gifs: the artifact has no feature GIFs, only pipeline ones such as _smoke.gif.\n'
    : 'pull-gifs: run npm run demos, then commit each GIF with its tape and README section.\n',
);
