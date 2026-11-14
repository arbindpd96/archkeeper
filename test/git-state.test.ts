import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitState, trackedFiles, trackedFolders } from '../src/cli/git-state.js';
import { compareText } from '../src/core/text.js';
import { commitFiles, git, stubEnv, tempDir, tempRepo, writeFiles } from './helpers.js';

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

  it('is unknown when no PATH folder holds git', () => {
    const repo = tempRepo({ 'README.md': '# App\n' });
    stubEnv('PATH', '');
    expect(gitState(repo)).toBe('unknown');
  });
});

describe('gitState hardening', () => {
  it('never runs a git or git.exe the project ships, whatever PATH says about the project folder', () => {
    const marker = path.join(tempDir(), 'ran');
    const stub = `#!/bin/sh\ntouch '${marker}'\nexit 1\n`;
    const repo = tempRepo({ '.gitignore': 'git\ngit.exe\n', 'README.md': '# App\n' });
    writeFiles(repo, { git: stub, 'git.exe': stub });
    for (const name of ['git', 'git.exe']) chmodSync(path.join(repo, name), 0o755);
    stubEnv('PATH', ['', '.', repo, process.env.PATH ?? ''].join(path.delimiter));
    expect(gitState(repo)).toBe('clean');
    expect(existsSync(marker)).toBe(false);
  });

  it('counts a project folder whose name starts with two dots as inside the project', () => {
    const marker = path.join(tempDir(), 'ran');
    const repo = tempRepo({ '.gitignore': '..bin/\n', 'README.md': '# App\n' });
    const folder = path.join(repo, '..bin');
    writeFiles(folder, { git: `#!/bin/sh\ntouch '${marker}'\nexit 1\n` });
    chmodSync(path.join(folder, 'git'), 0o755);
    stubEnv('PATH', [folder, process.env.PATH ?? ''].join(path.delimiter));
    expect(gitState(repo)).toBe('clean');
    expect(existsSync(marker)).toBe(false);
  });

  it('ignores GIT_DIR from the environment, as a git hook would export it', () => {
    const other = tempRepo({ 'README.md': '# Other\n' });
    stubEnv('GIT_DIR', path.join(other, '.git'));
    expect(gitState(tempDir())).toBe('not-a-repo');
  });

  it('never starts the fsmonitor hook a repository config names', () => {
    const marker = path.join(tempDir(), 'ran');
    const repo = tempRepo({ 'README.md': '# App\n' });
    git(repo, 'config', 'core.fsmonitor', `touch '${marker}'; false`);
    expect(gitState(repo)).toBe('clean');
    expect(existsSync(marker)).toBe(false);
  });

  it('does not run git status when the repository config sets a filter program, which status could run', () => {
    const marker = path.join(tempDir(), 'ran');
    const repo = tempRepo({ '.gitattributes': '* filter=evil\n', 'README.md': '# App\n' });
    git(repo, 'config', 'filter.evil.clean', `touch '${marker}'; cat`);
    writeFiles(repo, { 'README.md': '# App, edited\n' });
    expect(gitState(repo)).toBe('filters');
    expect(existsSync(marker)).toBe(false);
  });

  it.each([
    ['extensions.partialClone', 'origin'],
    ['remote.origin.promisor', 'true'],
  ])(
    'does not run git status where the repository config sets %s, which status could fetch from',
    (key, value) => {
      const repo = tempRepo({ 'README.md': '# App\n' });
      git(repo, 'config', key, value);
      expect(gitState(repo)).toBe('filters');
    },
  );

  it('keeps git status out of a submodule, whose own config could set a filter program', () => {
    const marker = path.join(tempDir(), 'ran');
    const repo = tempRepo({ 'README.md': '# App\n' });
    const sub = path.join(repo, 'sub');
    mkdirSync(sub);
    writeFiles(sub, { '.gitattributes': '* filter=evil\n', 'README.md': '# Sub\n' });
    git(sub, 'init', '-q', '-b', 'main');
    git(sub, 'add', '-A');
    git(sub, 'commit', '-q', '-m', 'sub');
    git(sub, 'config', 'filter.evil.clean', `touch '${marker}'; cat`);
    git(repo, 'add', 'sub');
    git(repo, 'commit', '-q', '-m', 'add the submodule');
    writeFiles(sub, { 'README.md': '# Sub, edited\n' });
    expect(gitState(repo)).toBe('clean');
    expect(existsSync(marker)).toBe(false);
  });

  it('answers for a folder whose name holds shell syntax, since no shell is involved', () => {
    const repo = tempRepo({ 'README.md': '# App\n' });
    const folder = path.join(repo, `it's $HOME & a;b (x)`);
    mkdirSync(folder);
    writeFiles(folder, { 'notes.md': 'draft\n' });
    expect(gitState(folder)).toBe('dirty');
  });
});

describe('trackedFiles (#36)', () => {
  it.skipIf(process.platform === 'win32')(
    'lists every tracked file with its name as it is: spaces, non-ASCII letters and a line break',
    () => {
      const files = { 'README.md': '', 'my notes/a b.md': '', 'données/é.txt': '', 'src/a\nb.ts': '' };
      const repo = tempRepo(files);
      writeFiles(repo, { 'untracked.ts': '' });
      expect(trackedFiles(repo)?.sort(compareText)).toEqual(Object.keys(files).sort(compareText));
    },
  );

  it('lists only the files of a project folder inside a repository, relative to that folder', () => {
    const repo = tempRepo({ 'packages/web/src/a.ts': '', 'packages/api/b.ts': '', 'README.md': '' });
    expect(trackedFiles(path.join(repo, 'packages/web'))).toEqual(['src/a.ts']);
  });

  it('lists nothing in a repository with no tracked file', () => {
    expect(trackedFiles(tempRepo())).toEqual([]);
  });

  it('gives no list outside a repository or when no PATH folder holds git', () => {
    expect(trackedFiles(tempDir())).toBeUndefined();
    const repo = tempRepo({ 'README.md': '' });
    stubEnv('PATH', '');
    expect(trackedFiles(repo)).toBeUndefined();
  });
});

describe('trackedFolders (#37, #38)', () => {
  it('names each folder that holds a file git tracks, matching its name in any case', () => {
    const repo = tempRepo({
      '.venv/bin/ruff': '#!/bin/sh\n',
      'Node_Modules/prettier/package.json': '{}\n',
      'src/a.ts': '',
    });
    expect(trackedFolders(repo, ['node_modules', '.venv', 'venv'])).toEqual(['node_modules', '.venv']);
  });

  it('names no folder whose files git does not track', () => {
    const repo = tempRepo({ '.gitignore': 'node_modules/\n', 'src/a.ts': '' });
    writeFiles(repo, { '.venv/bin/ruff': '#!/bin/sh\n', 'node_modules/prettier/package.json': '{}\n' });
    expect(trackedFolders(repo, ['node_modules', '.venv'])).toEqual([]);
  });

  it('reads only to the first names of a folder git tracks in full', () => {
    const files = Object.fromEntries(
      Array.from({ length: 400 }, (_, index) => [`node_modules/pkg-${String(index)}/index.js`, '']),
    );
    expect(trackedFolders(tempRepo(files), ['node_modules'])).toEqual(['node_modules']);
  });

  it('gives no answer outside a repository', () => {
    expect(trackedFolders(tempDir(), ['.venv'])).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('gives no answer when the git it finds cannot start', () => {
    const repo = tempRepo({ 'src/a.ts': '' });
    const bin = tempDir();
    writeFiles(bin, { git: '#!/nonexistent/interpreter\n' });
    chmodSync(path.join(bin, 'git'), 0o755);
    stubEnv('PATH', bin);
    expect(trackedFolders(repo, ['node_modules', '.venv'])).toBeUndefined();
  });
});
