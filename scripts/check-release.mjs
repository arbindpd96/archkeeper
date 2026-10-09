#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { exitWith, npm } from './lib.mjs';

const MIN_NPM = '11.15.0';
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const NUMERIC_VERSION = /^(\d+)\.(\d+)\.(\d+)/;
const SAFE_OUTPUT = /^[\w@./~-]+$/;
const USAGE = 'Usage: node scripts/check-release.mjs [--tag vX.Y.Z] [--dry-run] [--notes <file>]';
const OPTIONS = { tag: { type: 'string' }, 'dry-run': { type: 'boolean' }, notes: { type: 'string' } };

/** Reads the command line, exiting with usage on an unknown or malformed option. */
function readOptions() {
  try {
    return parseArgs({ options: OPTIONS, strict: true }).values;
  } catch (error) {
    return exitWith(`check-release: ${error.message}\n${USAGE}`, 2);
  }
}

/** Reads package.json from the current directory, or exits naming the file. */
function readManifest(root) {
  const file = path.join(root, 'package.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return exitWith(
      `check-release: cannot read ${file}: ${error.message}. Run it from the repository root.`,
      1,
    );
  }
}

/** Returns true when `version` is below `minimum`, or when it is not a numeric version at all. */
function isOlder(version, minimum) {
  const actual = NUMERIC_VERSION.exec(version)?.slice(1).map(Number);
  const wanted = NUMERIC_VERSION.exec(minimum).slice(1).map(Number);
  if (actual === undefined) return true;
  const differs = actual.findIndex((part, index) => part !== wanted[index]);
  return differs !== -1 && actual[differs] < wanted[differs];
}

/** Names the npm in use when it is too old for `npm stage publish`. */
function npmProblem() {
  const version = npm(['--version'], { nextStep: `Install npm ${MIN_NPM} or later.` }).trim();
  if (!isOlder(version, MIN_NPM)) return undefined;
  return `npm ${version} is older than ${MIN_NPM}, which npm stage publish needs. Use the latest Node.js 24.`;
}

/** Returns the body of the `## <version>` section of CHANGELOG.md, or undefined when it has none. */
function changelogSection(root, version) {
  const file = path.join(root, 'CHANGELOG.md');
  if (!existsSync(file)) return undefined;
  const lines = readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
  return body === '' ? undefined : body;
}

/** Lists what stops this commit from being released under `tag`. */
function releaseProblems(manifest, tag, notes) {
  const { version } = manifest;
  const problems = [];
  if (!RELEASE_VERSION.test(String(version))) {
    problems.push(`package.json version "${version}" is not X.Y.Z or X.Y.Z-<pre>.N.`);
  }
  if (tag !== `v${version}`) {
    problems.push(`Tag ${tag ?? '(none)'} does not match package.json version ${version}; tag v${version}.`);
  }
  if (manifest.private === true) {
    problems.push('package.json is "private": true, so npm refuses it. Remove it in the release commit.');
  }
  if (notes === undefined) {
    problems.push(`CHANGELOG.md has no "## ${version}" section. Run npm run version-packages first.`);
  }
  return problems;
}

/** Writes the release facts later steps need to GITHUB_OUTPUT, refusing values that could break it. */
function writeOutputs(manifest) {
  const prerelease = String(manifest.version).includes('-');
  const outputs = {
    name: manifest.name,
    version: manifest.version,
    bin: Object.keys(manifest.bin ?? {})[0] ?? manifest.name,
    prerelease: String(prerelease),
    'dist-tag': prerelease ? 'next' : 'latest',
  };
  const unsafe = Object.entries(outputs).filter(([, value]) => !SAFE_OUTPUT.test(String(value)));
  if (unsafe.length > 0) {
    exitWith(`check-release: package.json has an unusable ${unsafe.map(([key]) => key).join(', ')}.`, 1);
  }
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join(''));
  return outputs;
}

/** Reports what a real release would refuse, without failing the dry run. */
function warnDryRun(problems) {
  for (const problem of problems) {
    const line =
      process.env.GITHUB_ACTIONS === 'true'
        ? `::warning title=Release dry run::${problem}`
        : `check-release: a release would stop here: ${problem}`;
    process.stdout.write(`${line}\n`);
  }
}

const options = readOptions();
const dryRun = options['dry-run'] === true;
const root = process.cwd();
const manifest = readManifest(root);
const tag = options.tag ?? (dryRun ? `v${manifest.version}` : process.env.GITHUB_REF_NAME || undefined);
const notes = changelogSection(root, manifest.version);
const blocking = [npmProblem()].filter((problem) => problem !== undefined);
const releaseIssues = releaseProblems(manifest, tag, notes);
if (dryRun) warnDryRun(releaseIssues);
else blocking.push(...releaseIssues);
if (blocking.length > 0) exitWith(`check-release: cannot release (ADR-0013):\n- ${blocking.join('\n- ')}`, 1);

if (options.notes !== undefined && notes !== undefined) writeFileSync(options.notes, `${notes}\n`);
const outputs = writeOutputs(manifest);
const verb = dryRun ? 'dry run passed; a release would stage' : 'ready to stage';
process.stdout.write(
  `check-release: ${verb} ${outputs.name}@${outputs.version} (dist-tag ${outputs['dist-tag']}).\n`,
);
