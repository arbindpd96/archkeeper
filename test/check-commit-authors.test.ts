import { describe, expect, it } from 'vitest';
import { commitFiles, runScript, tempRepo, type RunResult } from './helpers.js';

const HUMAN = 'Ada Lovelace <ada@example.com>';
const DEPENDABOT = 'dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>';

interface Commit {
  message: string;
  author?: string;
}

function checkAuthors(commits: Commit[], prAuthor = 'ada'): RunResult {
  const repo = tempRepo();
  commits.forEach((commit, index) =>
    commitFiles(repo, { [`file${String(index)}.txt`]: `${String(index)}\n` }, commit),
  );
  return runScript('scripts/check-commit-authors.mjs', {
    args: ['main~' + String(commits.length), 'HEAD'],
    cwd: repo,
    env: { PR_AUTHOR: prAuthor },
  });
}

describe('check-commit-authors', () => {
  it('lets human contributors keep their own authorship', () => {
    const result = checkAuthors([
      { message: 'feat: one', author: HUMAN },
      { message: 'fix: two\n\nCo-authored-by: Grace Hopper <grace@example.com>' },
    ]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2 commits checked');
  });

  it('fails a commit authored by a bot', () => {
    const result = checkAuthors([
      { message: 'chore: bump', author: 'renovate[bot] <renovate[bot]@example.com>' },
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('author renovate[bot] <renovate[bot]@example.com> is a bot');
    expect(result.stderr).toContain('--force-with-lease');
  });

  it('keeps Dependabot authorship on a Dependabot pull request', () => {
    const result = checkAuthors([{ message: 'chore(deps): bump x', author: DEPENDABOT }], 'dependabot[bot]');
    expect(result.status).toBe(0);
  });

  it('fails a Dependabot commit inside someone else’s pull request', () => {
    const result = checkAuthors([{ message: 'chore(deps): bump x', author: DEPENDABOT }]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is Dependabot outside a Dependabot pull request');
  });

  it('fails a bot that borrows the Dependabot name with another address', () => {
    const fake = 'dependabot[bot] <bot@example.com>';
    const result = checkAuthors([{ message: 'chore(deps): bump x', author: fake }], 'dependabot[bot]');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is a bot');
  });

  it.each([
    ['an Anthropic no-reply address', 'Claude <noreply@anthropic.com>'],
    ['the Copilot agent address', 'Copilot <198982749+Copilot@users.noreply.github.com>'],
    ['an aider author name', 'Ada Lovelace (aider) <ada@example.com>'],
  ])('fails a commit authored by %s', (_name, author) => {
    const result = checkAuthors([{ message: 'feat: generated', author }]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is an AI coding tool');
  });

  it('fails an AI co-author address, even under a human name', () => {
    const result = checkAuthors([
      { message: 'feat: x\n\nCo-authored-by: Helper <noreply@anthropic.com>', author: HUMAN },
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('co-author Helper <noreply@anthropic.com> is an AI coding tool');
  });

  it('fails a bot co-author', () => {
    const coAuthor = 'Co-authored-by: copilot-swe-agent[bot] <198982749+Copilot@users.noreply.github.com>';
    const result = checkAuthors([{ message: `feat: x\n\n${coAuthor}`, author: HUMAN }]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('co-author copilot-swe-agent[bot]');
  });

  it('fails a "Generated with Claude Code" line', () => {
    const result = checkAuthors([
      { message: 'feat: x\n\nGenerated with [Claude Code](https://claude.com)', author: HUMAN },
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('the message carries AI attribution');
  });

  it.each([[[]], [['main']], [['-p', 'HEAD']]])('rejects revisions %j with usage', (args) => {
    const result = runScript('scripts/check-commit-authors.mjs', { args, cwd: tempRepo() });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: node scripts/check-commit-authors.mjs <base> <head>');
  });
});
