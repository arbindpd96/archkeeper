import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentPaths } from '../src/cli/backup.js';
import { tempDir } from './helpers.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, lstatSync: vi.fn(actual.lstatSync) };
});

const realLstat = vi.mocked(fs.lstatSync).getMockImplementation() ?? fs.lstatSync;

afterEach(() => {
  vi.mocked(fs.lstatSync).mockImplementation(realLstat);
});

describe('reading a path for a backup', () => {
  it.runIf(process.platform !== 'win32')(
    'reads a FIFO swapped in after the lstat as not a file, without blocking',
    () => {
      const dir = tempDir();
      const fifo = path.join(dir, 'AGENTS.md');
      fs.writeFileSync(path.join(dir, 'plain.md'), '# Plain\n');
      const plain = realLstat(path.join(dir, 'plain.md'));
      execFileSync('mkfifo', [fifo]);
      vi.mocked(fs.lstatSync).mockImplementation((target: fs.PathLike) =>
        target === fifo ? plain : realLstat(target),
      );
      const [found] = currentPaths([{ relative: 'AGENTS.md', absolute: fifo }]);
      expect(found?.saved).toEqual({ type: 'other' });
    },
  );
});
