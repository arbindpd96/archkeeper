import { mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeFeature } from '../src/hooks/runtime/memory/active-feature.js';
import { canSymlink, tempDir, writeFiles } from './helpers.js';
import { memoryText } from './hook-helpers.js';

const memoryOf = (name: string): string => `docs/features/${name}/MEMORY.md`;

/** The name of the memory activeFeature takes, or the features in progress it would ask about. */
function scanned(projectDir: string): string | readonly string[] {
  const found = activeFeature(projectDir);
  return 'memory' in found ? found.memory.name : found.inProgress;
}

describe('the scan for the feature in progress when no pointer names one (#35)', () => {
  it('reads the status from the first 4 KB of each MEMORY.md alone', () => {
    const dir = tempDir();
    writeFiles(dir, { [memoryOf('late')]: `# Feature: late\n\n${'x'.repeat(4_096)}\n\n${memoryText()}` });
    expect(scanned(dir)).toEqual([]);
    writeFiles(dir, { [memoryOf('login')]: memoryText() });
    expect(scanned(dir)).toBe('login');
  });

  it('takes no memory over 1 MB, which it could not inject whole, though its status says in progress', () => {
    const dir = tempDir();
    writeFiles(dir, { [memoryOf('huge')]: `${memoryText()}${'x'.repeat(1_000_000)}\n` });
    expect(scanned(dir)).toEqual([]);
  });

  it('reads at most the first 200 kebab-case folders, in name order', () => {
    const dir = tempDir();
    const names = Array.from({ length: 201 }, (_, index) => `f${String(index).padStart(3, '0')}`);
    writeFiles(
      dir,
      Object.fromEntries(names.map((name) => [memoryOf(name), memoryText({ status: 'done' })])),
    );
    writeFiles(dir, { [memoryOf('f200')]: memoryText() });
    expect(scanned(dir)).toEqual([]);
    writeFiles(dir, { [memoryOf('f199')]: memoryText() });
    expect(scanned(dir)).toBe('f199');
  });
});

describe.skipIf(!canSymlink())('the scan and symlinks (ADR-0015)', () => {
  it('lists no docs/features that is a symlink, even to a folder inside the project', () => {
    const dir = tempDir();
    writeFiles(dir, { 'docs/notes/login/MEMORY.md': memoryText() });
    symlinkSync('notes', path.join(dir, 'docs/features'), 'dir');
    expect(scanned(dir)).toEqual([]);
  });

  it('skips a feature folder that is a symlink', () => {
    const dir = tempDir();
    writeFiles(dir, { 'notes/login/MEMORY.md': memoryText() });
    mkdirSync(path.join(dir, 'docs/features'), { recursive: true });
    symlinkSync(path.join(dir, 'notes/login'), path.join(dir, 'docs/features/login'), 'dir');
    expect(scanned(dir)).toEqual([]);
  });
});
