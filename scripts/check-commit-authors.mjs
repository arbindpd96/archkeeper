#!/usr/bin/env node
import { AI_ATTRIBUTION } from '../.claude/hooks/attribution.mjs';
import { exitWith, git, gitRevision } from './lib.mjs';

const USAGE =
  'Usage: node scripts/check-commit-authors.mjs <base> <head>\n' +
  'Reads the pull request author from PR_AUTHOR.';
const DEPENDABOT = {
  login: 'dependabot[bot]',
  name: 'dependabot[bot]',
  email: '49699333+dependabot[bot]@users.noreply.github.com',
};
const BOT = /\[bot\]/i;
// AI coding tools that author or co-author commits under their own identity; [bot] accounts match BOT.
const AI_IDENTITIES = [
  /noreply@anthropic\.com/i,
  /^\d+\+copilot@users\.noreply\.github\.com$/i,
  /^cursoragent@cursor\.com$/i,
  /^openhands@all-hands\.dev$/i,
  /\(aider\)$/i,
];
const CO_AUTHOR = /^co-authored-by:\s*(.*?)\s*<([^>]*)>\s*$/gim;
const FIELD = '\x1f';
const RECORD = '\x1e';

/** Reads every commit in `base..head` with its author and full message. */
function commits(base, head) {
  const output = git(
    ['log', `--format=%H${FIELD}%an${FIELD}%ae${FIELD}%B${RECORD}`, `${base}..${head}`, '--'],
    {
      action: `list the commits in ${base}..${head}`,
      nextStep: 'Fetch the full history (actions/checkout fetch-depth: 0) and pass two existing commits.',
    },
  );
  return output
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [sha = '', name = '', email = '', message = ''] = record.split(FIELD);
      return { sha, name, email, message };
    });
}

/** Says why an identity may not author or co-author a commit, or returns undefined when it may. */
function identityProblem({ name, email }, dependabotAllowed) {
  const isDependabot = name === DEPENDABOT.name && email === DEPENDABOT.email;
  if (isDependabot && dependabotAllowed) return undefined;
  if (BOT.test(name) || BOT.test(email)) {
    return isDependabot ? 'is Dependabot outside a Dependabot pull request' : 'is a bot';
  }
  const tool = AI_IDENTITIES.find((pattern) => pattern.test(email) || pattern.test(name));
  return tool === undefined ? undefined : 'is an AI coding tool';
}

/** Lists the authorship problems of one commit: its author, its co-authors and AI attribution lines. */
function commitProblems(commit, dependabotAllowed) {
  const label = `${commit.sha.slice(0, 7)} "${commit.message.split('\n')[0] ?? ''}"`;
  const problems = [];
  const author = identityProblem(commit, dependabotAllowed);
  if (author !== undefined) problems.push(`${label}: author ${commit.name} <${commit.email}> ${author}.`);
  for (const [, name = '', email = ''] of commit.message.matchAll(CO_AUTHOR)) {
    const coAuthor = identityProblem({ name, email }, false);
    if (coAuthor !== undefined) problems.push(`${label}: co-author ${name} <${email}> ${coAuthor}.`);
  }
  if (AI_ATTRIBUTION.test(commit.message)) problems.push(`${label}: the message carries AI attribution.`);
  return problems;
}

const [base, head] = [process.argv[2], process.argv[3]].map((value) => gitRevision(value, USAGE));
const dependabotAllowed = process.env.PR_AUTHOR === DEPENDABOT.login;
const checked = commits(base, head);
const problems = checked.flatMap((commit) => commitProblems(commit, dependabotAllowed));
if (problems.length > 0) {
  exitWith(
    'check-commit-authors: commits on main are authored by people, with no AI attribution:\n' +
      `${problems.join('\n')}\n` +
      'Re-author or reword them (git rebase -i, then git commit --amend --reset-author or edit the message) ' +
      'and push with --force-with-lease. Dependabot keeps its authorship only on its own pull requests.',
    1,
  );
}
process.stdout.write(`check-commit-authors: ${String(checked.length)} commits checked.\n`);
