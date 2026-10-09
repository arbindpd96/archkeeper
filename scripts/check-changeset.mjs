#!/usr/bin/env node
import { exitWith, git, gitRevision } from './lib.mjs';

const USAGE =
  'Usage: node scripts/check-changeset.mjs <base> <head>\n' +
  'Reads the pull request labels from PR_LABELS, one per line.';
// The folders that reach users: src/ is bundled into dist/, and the rest are published as they are.
const RELEASED = /^(src|modules|packs|schema)\//;
const CHANGESET = /^\.changeset\/(?!README\.md$)[^/]+\.md$/;
const SKIP_LABEL = 'no-release';
const SHOWN_FILES = 5;

/** Lists the files a pull request changes, with git's status letter, from the merge base of `base` and `head`. */
function changedFiles(base, head) {
  const output = git(['diff', '--name-status', '--no-renames', '-z', `${base}...${head}`, '--'], {
    action: `compare ${base} with ${head}`,
    nextStep: 'Fetch the full history (actions/checkout fetch-depth: 0) and pass two existing commits.',
  });
  const fields = output.split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    changes.push({ status: fields[index], file: fields[index + 1] });
  }
  return changes;
}

const [base, head] = [process.argv[2], process.argv[3]].map((value) => gitRevision(value, USAGE));
const labels = (process.env.PR_LABELS ?? '').split('\n').map((label) => label.trim());
if (labels.includes(SKIP_LABEL)) {
  process.stdout.write(`check-changeset: skipped, the pull request is labelled ${SKIP_LABEL}.\n`);
  process.exit(0);
}

const changes = changedFiles(base, head);
const released = changes.filter(({ file }) => RELEASED.test(file)).map(({ file }) => file);
const hasChangeset = changes.some(({ status, file }) => status !== 'D' && CHANGESET.test(file));
if (released.length > 0 && !hasChangeset) {
  const more = released.length > SHOWN_FILES ? ` and ${String(released.length - SHOWN_FILES)} more` : '';
  exitWith(
    `check-changeset: this pull request changes ${released.slice(0, SHOWN_FILES).join(', ')}${more} ` +
      'but adds no changeset (ADR-0013).\n' +
      'Run npm run changeset and commit the .changeset/*.md file it writes. If the change needs no ' +
      `release, label the pull request ${SKIP_LABEL} and re-run this job.`,
    1,
  );
}
process.stdout.write(
  released.length > 0
    ? 'check-changeset: the pull request adds a changeset.\n'
    : 'check-changeset: nothing under src/, modules/, packs/ or schema/ changed, so no changeset is needed.\n',
);
