#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { exitWith } from './lib.mjs';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const PACKAGE_ID = /^[\w@./-]+$/;
const DIST_TAG = /^[\w.-]+$/;
const USAGE = 'Usage: node scripts/stage-summary.mjs <npm-stage-publish.json> --dist-tag <tag> [--dry-run]';

/** Reads the command line, exiting with usage when the file or a valid dist-tag is missing. */
function readOptions() {
  try {
    const { values, positionals } = parseArgs({
      options: { 'dist-tag': { type: 'string' }, 'dry-run': { type: 'boolean' } },
      allowPositionals: true,
    });
    const distTag = values['dist-tag'] ?? '';
    if (positionals.length === 1 && DIST_TAG.test(distTag)) {
      return { file: positionals[0], distTag, dryRun: values['dry-run'] === true };
    }
  } catch {
    return exitWith(USAGE, 2);
  }
  return exitWith(USAGE, 2);
}

/** Returns the one package entry that `npm stage publish --json` printed, or exits when there is none. */
function readStaged(file) {
  let printed;
  try {
    printed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return exitWith(`stage-summary: cannot read ${file}: ${error.message}`, 1);
  }
  const entries = printed !== null && typeof printed === 'object' ? Object.values(printed) : [];
  const staged = entries.length === 1 ? entries[0] : undefined;
  if (typeof staged?.id !== 'string' || !PACKAGE_ID.test(staged.id)) {
    exitWith(`stage-summary: ${file} is not the output of npm stage publish --json for one package.`, 1);
  }
  return staged;
}

/** Builds the job summary: the exact approve command for a real stage, or what a dry run would stage. */
function summary(staged, { distTag, dryRun }) {
  if (dryRun) {
    return `### Release dry run\n\nnpm would stage \`${staged.id}\` with dist-tag \`${distTag}\`.\n`;
  }
  if (typeof staged.stageId !== 'string' || !UUID.test(staged.stageId)) {
    exitWith(
      `stage-summary: npm staged ${staged.id} but printed no stage id. Find it with npm stage list.`,
      1,
    );
  }
  const id = staged.stageId;
  return [
    `### Staged \`${staged.id}\` with dist-tag \`${distTag}\``,
    '',
    'Nothing is public until the maintainer approves it with 2FA:',
    '',
    '```sh',
    `npm stage approve ${id}`,
    '```',
    '',
    `Inspect it first with \`npm stage view ${id}\`, or reject it with \`npm stage reject ${id}\`.`,
    '',
  ].join('\n');
}

const options = readOptions();
const text = summary(readStaged(options.file), options);
process.stdout.write(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
