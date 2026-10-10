import { describe, expect, it } from 'vitest';
import { gitState } from '../src/cli/git-state.js';
import { commitFiles, tempDir, tempRepo, writeFiles } from './helpers.js';
import path from 'node:path';

describe('gitState', () => {
  it('says a folder outside any repository is not a repository', () => {
    expect(gitState(tempDir())).toBe('not-a-repo');
  });

  it('says a committed project is clean and one with an untracked file is dirty', () => {
    const repo = tempRepo({ 'README.md': '# App\n' });
    expect(gitState(repo)).toBe('clean');
    writeFiles(repo, { 'notes.md': 'draft\n' });
    expect(gitState(repo)).toBe('dirty');
  });

  it('looks at the project folder only, so a change elsewhere in a monorepo does not count', () => {
    const repo = tempRepo({ 'packages/web/package.json': '{}\n', 'packages/api/package.json': '{}\n' });
    writeFiles(repo, { 'packages/api/draft.md': 'draft\n' });
    expect(gitState(path.join(repo, 'packages/web'))).toBe('clean');
    expect(gitState(path.join(repo, 'packages/api'))).toBe('dirty');
  });

  it('says a folder its repository ignores is ignored, since git can neither show nor undo changes there', () => {
    const repo = tempRepo({ '.gitignore': 'scratch/\n' });
    commitFiles(repo, {}, { message: 'ignore scratch' });
    writeFiles(repo, { 'scratch/app/package.json': '{}\n' });
    expect(gitState(path.join(repo, 'scratch/app'))).toBe('ignored');
  });
});
