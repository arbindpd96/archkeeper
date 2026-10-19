import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, tempRepo } from './helpers.js';
import { DEMO_TAPE, packedCli, project, renderTapes } from './render-tapes-helpers.js';

const REPO_TAPE = `# repo\n${DEMO_TAPE}`;

function renderArgs(root: string): string[] {
  return ['--out', path.join(root, 'gifs'), '--tarball', packedCli()];
}

describe.skipIf(process.platform === 'win32')('render-tapes on a tape marked # repo', () => {
  it('runs it in a fixture copy that is a git repository with one commit', () => {
    const root = project({ 'committed.tape': REPO_TAPE, 'plain.tape': DEMO_TAPE });
    const result = renderTapes(root, renderArgs(root));
    expect(result.status).toBe(0);
    const repoByTape = new Map(result.runs.map((run) => [path.basename(path.dirname(run.cwd)), run.repo]));
    expect(repoByTape.get('committed')).toEqual({ commits: '1', status: '' });
    expect(repoByTape.get('plain')).toBeNull();
  });

  it('commits the fixture copy into its own repository even when GIT_DIR names another one', () => {
    const other = tempRepo({ 'README.md': '# Other\n' });
    const root = project({ 'committed.tape': REPO_TAPE });
    const result = renderTapes(root, renderArgs(root), { GIT_DIR: path.join(other, '.git') });
    expect(result.status).toBe(0);
    expect(result.runs[0]?.repo).toEqual({ commits: '1', status: '' });
    expect(git(other, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
  });

  it("points the copy's core.hooksPath at an empty folder in its .git, so no global hook runs there", () => {
    const root = project({ 'committed.tape': REPO_TAPE });
    const result = renderTapes(root, renderArgs(root));
    expect(result.status).toBe(0);
    const [run] = result.runs;
    expect(run?.hooks?.files).toEqual([]);
    expect(path.relative(run?.cwd ?? '', run?.hooks?.path ?? '')).toMatch(/^\.git[/\\][^/\\]+$/);
  });

  it('refuses to commit a fixture copy that has a git remote after git init', () => {
    const root = project({ 'committed.tape': REPO_TAPE });
    const fixture = path.join(root, 'examples/app');
    git(fixture, 'init', '-q', '-b', 'main');
    git(fixture, 'remote', 'add', 'origin', 'https://example.com/app.git');
    const result = renderTapes(root, renderArgs(root));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('git remote lists origin in the copy of examples/app');
    expect(result.runs).toHaveLength(0);
  });
});
