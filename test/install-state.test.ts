import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { install } from '../src/cli/install.js';
import { PathSafetyError } from '../src/core/errors.js';
import { canSymlink, tempDir, writeFiles } from './helpers.js';
import { filesUnder, fixtureTree, OPTIONS } from './install-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const LINKS = canSymlink();
const UNREADABLE = process.platform !== 'win32' && process.getuid?.() !== 0;
const STATE = TEST_BRAND.stateDir;

describe('the kit state folders on disk', () => {
  it.runIf(LINKS).each([STATE, `${STATE}/local`, `${STATE}/local/backup`, `${STATE}/base`])(
    'refuses %s as a symlink, before writing anything',
    (folder) => {
      const dir = tempDir();
      writeFiles(dir, { 'AGENTS.md': '# Mine\n', 'vendor-cache/.gitignore': 'node_modules/\n' });
      mkdirSync(path.join(dir, path.dirname(folder)), { recursive: true });
      symlinkSync(path.join(dir, 'vendor-cache'), path.join(dir, folder), 'dir');
      const run = (): unknown => install(dir, fixtureTree(), OPTIONS);
      expect(run).toThrow(PathSafetyError);
      expect(run).toThrow(`"${folder}": the kit state folder: is refused: it is a symlink`);
      expect(filesUnder(path.join(dir, 'vendor-cache'))).toEqual(['.gitignore']);
      expect(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toBe('# Mine\n');
    },
  );

  it('refuses a state folder that is a file', () => {
    const dir = tempDir();
    writeFiles(dir, { [`${STATE}/base`]: 'not a folder\n' });
    expect(() => install(dir, fixtureTree(), OPTIONS)).toThrow('is refused: it is not a folder');
  });

  it.runIf(LINKS)('refuses an ignore file in local/ that is a symlink', () => {
    const dir = tempDir();
    writeFiles(dir, { 'mine.txt': '!backup\n' });
    mkdirSync(path.join(dir, STATE, 'local'), { recursive: true });
    symlinkSync(path.join(dir, 'mine.txt'), path.join(dir, STATE, 'local/.gitignore'), 'file');
    expect(() => install(dir, fixtureTree(), OPTIONS)).toThrow('is refused: it is not a regular file');
    expect(readFileSync(path.join(dir, 'mine.txt'), 'utf8')).toBe('!backup\n');
  });

  it.runIf(UNREADABLE)('reports a cleanup that fails after the lock is written as a warning', () => {
    const dir = tempDir();
    install(dir, fixtureTree(), OPTIONS);
    rmSync(path.join(dir, '.claude/rules/acmekit/guard.md'));
    const base = path.join(dir, STATE, 'base');
    chmodSync(base, 0o300);
    try {
      const { applied } = install(dir, fixtureTree(), OPTIONS);
      expect(applied.changed).toBe(true);
      expect(applied.warnings).toEqual([
        expect.stringContaining(`${STATE}/base could not be cleaned up after the lock was written`),
      ]);
      expect(readFileSync(path.join(dir, STATE, 'lock.json'), 'utf8')).toContain('"removed": [\n    {');
    } finally {
      chmodSync(base, 0o700);
    }
  });

  it('rewrites an ignore file in local/ that does not ignore everything', () => {
    const dir = tempDir();
    writeFiles(dir, { [`${STATE}/local/.gitignore`]: '*\n!backup/\n' });
    install(dir, fixtureTree(), OPTIONS);
    expect(readFileSync(path.join(dir, STATE, 'local/.gitignore'), 'utf8')).toBe('*\n');
  });
});
