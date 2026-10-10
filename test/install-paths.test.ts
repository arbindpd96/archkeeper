import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { removeFile, renameWithRetry } from '../src/cli/atomic-files.js';
import { compressed, MAX_BLOB_BYTES, readBlob } from '../src/cli/blob-store.js';
import { install } from '../src/cli/install.js';
import { confinedPath } from '../src/cli/project-files.js';
import { ApplyError, LockError, PathSafetyError } from '../src/core/errors.js';
import { contentHash } from '../src/core/hash.js';
import { canSymlink, tempDir, writeFiles } from './helpers.js';
import { filesUnder, fixtureTree, OPTIONS } from './install-helpers.js';

const LINKS = canSymlink();
const UNREADABLE = process.platform !== 'win32' && process.getuid?.() !== 0;

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('write targets on disk (#23)', () => {
  it.runIf(LINKS)(
    'refuses a folder that a symlink takes outside the project, before writing anything',
    () => {
      const dir = tempDir();
      const outside = tempDir();
      symlinkSync(outside, path.join(dir, '.claude'), 'dir');
      const run = (): unknown => install(dir, fixtureTree(), OPTIONS);
      expect(run).toThrow(PathSafetyError);
      expect(run).toThrow('resolves through a symlink to a place outside the project');
      expect(filesUnder(outside)).toEqual([]);
      expect(filesUnder(dir).filter((file) => !file.startsWith('.claude'))).toEqual([]);
    },
  );

  it.runIf(LINKS)('refuses a folder that a symlink takes into .git', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, '.git/info'), { recursive: true });
    symlinkSync(path.join(dir, '.git'), path.join(dir, 'docs'), 'dir');
    expect(() => install(dir, fixtureTree(), OPTIONS)).toThrow('to a path that lies inside .git');
    expect(existsSync(path.join(dir, '.git/notes.md'))).toBe(false);
  });

  it.runIf(LINKS)('writes through a symlinked folder that stays inside the project', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'shared/skills'), { recursive: true });
    mkdirSync(path.join(dir, '.claude'));
    symlinkSync(path.join(dir, 'shared/skills'), path.join(dir, '.claude/skills'), 'dir');
    install(dir, fixtureTree(), OPTIONS);
    expect(existsSync(path.join(dir, 'shared/skills/why/SKILL.md'))).toBe(true);
  });

  it.runIf(LINKS)('never writes through a symlinked file, offering the kit content in a sidecar', () => {
    const dir = tempDir();
    writeFiles(dir, { 'AGENTS.md': '# Shared rules\n' });
    symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'), 'file');
    install(dir, fixtureTree(), OPTIONS);
    expect(readlinkSync(path.join(dir, 'CLAUDE.md'))).toBe('AGENTS.md');
    expect(readFileSync(path.join(dir, 'CLAUDE.md.acmekit-new'), 'utf8')).toContain('@AGENTS.md');
    expect(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).not.toContain('@AGENTS.md');
    expect(install(dir, fixtureTree(), OPTIONS).applied.changed).toBe(false);
  });

  it.runIf(LINKS)('never deletes through a symlink, even where the lock says the kit wrote the file', () => {
    const dir = tempDir();
    const outside = tempDir();
    writeFileSync(path.join(outside, 'keep.md'), 'keep me\n');
    const tree = fixtureTree();
    install(dir, tree, OPTIONS);
    const rule = path.join(dir, '.claude/rules/acmekit/python.md');
    rmSync(rule);
    symlinkSync(path.join(outside, 'keep.md'), rule, 'file');
    const smaller = new Map([...tree].filter(([file]) => file !== '.claude/rules/acmekit/python.md'));
    install(dir, smaller, { ...OPTIONS, ownable: () => true });
    expect(readlinkSync(rule)).toBe(path.join(outside, 'keep.md'));
    expect(readFileSync(path.join(outside, 'keep.md'), 'utf8')).toBe('keep me\n');
    expect(() => {
      removeFile(rule);
    }).toThrow('not a regular file');
  });

  it.runIf(LINKS)('refuses a lock that is a symlink', () => {
    const dir = tempDir();
    writeFiles(dir, { 'elsewhere.json': '{}\n' });
    mkdirSync(path.join(dir, '.acmekit'));
    symlinkSync(path.join(dir, 'elsewhere.json'), path.join(dir, '.acmekit/lock.json'), 'file');
    expect(() => install(dir, fixtureTree(), OPTIONS)).toThrow(LockError);
  });

  it('leaves a file that is not UTF-8 text alone and offers the kit version in a sidecar', () => {
    const dir = tempDir();
    const bytes = Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]);
    mkdirSync(path.join(dir, '.claude/rules/acmekit'), { recursive: true });
    writeFileSync(path.join(dir, '.claude/rules/acmekit/guard.md'), bytes);
    install(dir, fixtureTree(), OPTIONS);
    expect(readFileSync(path.join(dir, '.claude/rules/acmekit/guard.md')).equals(bytes)).toBe(true);
    expect(existsSync(path.join(dir, '.claude/rules/acmekit/guard.md.acmekit-new'))).toBe(true);
  });

  it.runIf(process.platform !== 'win32')('reads a FIFO at a kit path as not a file, without blocking', () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'docs'));
    execFileSync('mkfifo', [path.join(dir, 'docs/notes.md')]);
    const { plan } = install(dir, fixtureTree(), OPTIONS);
    expect(plan.ops.find((op) => op.path === 'docs/notes.md')?.kind).toBe('skip');
  });

  it.runIf(LINKS)('refuses a kit folder that is a broken symlink, naming the link and the fix', () => {
    const dir = tempDir();
    symlinkSync(path.join(tempDir(), 'missing'), path.join(dir, '.claude'), 'dir');
    const run = (): unknown => install(dir, fixtureTree(), OPTIONS);
    expect(run).toThrow(PathSafetyError);
    expect(run).toThrow('resolves through .claude, a symlink to nothing (ENOENT)');
    expect(run).toThrow('Try: remove or repoint the broken symlink .claude, and run again');
  });

  it.runIf(UNREADABLE)('refuses a kit path it cannot read, naming the file and the fix', () => {
    const dir = tempDir();
    writeFiles(dir, { 'AGENTS.md': '# Mine\n' });
    chmodSync(path.join(dir, 'AGENTS.md'), 0o000);
    const run = (): unknown => install(dir, fixtureTree(), OPTIONS);
    expect(run).toThrow(ApplyError);
    expect(run).toThrow('AGENTS.md: read for the plan: could not be read (EACCES), so the kit wrote nothing');
    expect(filesUnder(dir)).toEqual(['AGENTS.md']);
  });

  it('refuses a path the lexical checks refuse before touching the disk', () => {
    expect(() => confinedPath(tempDir(), 'docs/NUL.txt', 'a test')).toThrow('reserved device name');
  });
});

describe('renameWithRetry', () => {
  it('retries EBUSY and EPERM with backoff, then succeeds', () => {
    const codes = ['EBUSY', 'EPERM'];
    let calls = 0;
    renameWithRetry('a', 'b', () => {
      calls += 1;
      const code = codes.shift();
      if (code !== undefined) throw errno(code);
    });
    expect(calls).toBe(3);
  });

  it('throws other errors at once', () => {
    let calls = 0;
    const rename = (): void => {
      calls += 1;
      throw errno('ENOENT');
    };
    expect(() => {
      renameWithRetry('a', 'b', rename);
    }).toThrow('ENOENT');
    expect(calls).toBe(1);
  });

  it('gives up after its last retry', () => {
    let calls = 0;
    const rename = (): void => {
      calls += 1;
      throw errno('EPERM');
    };
    expect(() => {
      renameWithRetry('a', 'b', rename);
    }).toThrow('EPERM');
    expect(calls).toBe(7);
  });
});

describe('base blobs', () => {
  it('are gzip named by the hash of their LF content, the same bytes on every OS', () => {
    const content = '# Rule\n';
    const gzip = compressed(content);
    expect(gzip[9]).toBe(0xff);
    expect(readBlob(contentHash(content), gzip)).toBe(content);
  });

  it('refuse a blob that does not hash to its name', () => {
    expect(() => readBlob(contentHash('a\n'), compressed('b\n'))).toThrow('does not hash to its name');
  });

  it('refuse a gzip bomb instead of exhausting memory', () => {
    const bomb = gzipSync(Buffer.alloc(MAX_BLOB_BYTES + 1));
    expect(bomb.length).toBeLessThan(5000);
    expect(() => readBlob(contentHash('x'), bomb)).toThrow(RangeError);
  });
});
