import { describe, expect, it } from 'vitest';
import { commitFiles, runScript, tempRepo, type RunResult } from './helpers.js';

const CHANGESET = "---\n'fixture-kit': minor\n---\n\nAdd init.\n";

function checkChangeset(files: Record<string, string>, labels = ''): RunResult {
  const repo = tempRepo({ 'src/cli/main.ts': 'export const a = 1;\n' });
  const head = commitFiles(repo, files, { message: 'feat: change' });
  return runScript('scripts/check-changeset.mjs', {
    args: ['main~1', head],
    cwd: repo,
    env: { PR_LABELS: labels },
  });
}

describe('check-changeset', () => {
  it('fails a change under src/ without a changeset and says how to fix it', () => {
    const result = checkChangeset({ 'src/cli/main.ts': 'export const a = 2;\n' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('changes src/cli/main.ts but adds no changeset');
    expect(result.stderr).toContain('npm run changeset');
    expect(result.stderr).toContain('label the pull request no-release');
  });

  it('fails a change under modules/ without a changeset', () => {
    const result = checkChangeset({ 'modules/memory/module.json': '{}\n' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('modules/memory/module.json');
  });

  it('passes a change under src/ that adds a changeset', () => {
    const result = checkChangeset({
      'src/cli/main.ts': 'export const a = 2;\n',
      '.changeset/brave-owls.md': CHANGESET,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('does not count the .changeset README as a changeset', () => {
    const result = checkChangeset({
      'src/cli/main.ts': 'export const a = 2;\n',
      '.changeset/README.md': '# Notes\n',
    });
    expect(result.status).toBe(1);
  });

  it('passes a src/ change on a pull request labelled no-release', () => {
    const result = checkChangeset({ 'src/cli/main.ts': 'export const a = 2;\n' }, 'type:ci\nno-release\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('labelled no-release');
  });

  it('passes changes outside src/ and modules/ without a changeset', () => {
    const result = checkChangeset({ 'docs/guide.md': '# Guide\n', 'test/a.test.ts': 'export {};\n' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no changeset is needed');
  });

  it.each([[[]], [['--output=/tmp/x', 'HEAD']], [['main', '$(touch pwned)']]])(
    'rejects missing or option-like revisions %j with usage',
    (args) => {
      const result = runScript('scripts/check-changeset.mjs', { args, cwd: tempRepo() });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Usage: node scripts/check-changeset.mjs <base> <head>');
    },
  );

  it("shows git's error when a revision does not exist", () => {
    const result = runScript('scripts/check-changeset.mjs', { args: ['main', 'missing'], cwd: tempRepo() });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('git could not compare main with missing');
    expect(result.stderr).toContain('fetch-depth: 0');
  });
});
