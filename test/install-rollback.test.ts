import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { install } from '../src/cli/install.js';
import { ApplyError } from '../src/core/errors.js';
import type { RenderTree } from '../src/core/render-tree.js';
import { canSymlink, tempDir, writeFiles } from './helpers.js';
import { fixtureTree, OPTIONS } from './install-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    closeSync: vi.fn(actual.closeSync),
  };
});

const realRename = vi.mocked(fs.renameSync).getMockImplementation() ?? fs.renameSync;
const realWrite = vi.mocked(fs.writeFileSync).getMockImplementation() ?? fs.writeFileSync;
const realClose = vi.mocked(fs.closeSync).getMockImplementation() ?? fs.closeSync;
const LOCAL = `${TEST_BRAND.stateDir}/local`;

afterEach(() => {
  vi.mocked(fs.renameSync).mockImplementation(realRename);
  vi.mocked(fs.writeFileSync).mockImplementation(realWrite);
  vi.mocked(fs.closeSync).mockImplementation(realClose);
});

/** Every file and folder outside the kit's local folder, with each file's exact bytes. */
function contents(dir: string, relative = ''): Map<string, string> {
  const found = new Map<string, string>();
  for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (child === LOCAL) continue;
    if (entry.isDirectory()) {
      if (child !== TEST_BRAND.stateDir) found.set(`${child}/`, '');
      for (const [file, bytes] of contents(dir, child)) found.set(file, bytes);
    } else {
      found.set(child, fs.readFileSync(path.join(dir, child)).toString('base64'));
    }
  }
  return found;
}

// Fails the `failing`th write through a file descriptor, as a full disk would.
function failDescriptorWriteAt(failing: number): void {
  let calls = 0;
  vi.mocked(fs.writeFileSync).mockImplementation((file, data, options) => {
    if (typeof file === 'number') calls += 1;
    if (calls === failing) throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
    realWrite(file, data, options);
  });
}

function tempFiles(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.tmp'));
}

function failRenameAt(failing: number): void {
  let calls = 0;
  vi.mocked(fs.renameSync).mockImplementation((from, to) => {
    calls += 1;
    if (calls === failing) throw Object.assign(new Error('injected failure'), { code: 'EIO' });
    realRename(from, to);
  });
}

// Fails the apply at every rename in turn, checking each time that the project is exactly as it was.
function expectRollbackAtEveryStep(dir: string, tree: RenderTree, options = OPTIONS): number {
  const before = contents(dir);
  let failing = 1;
  for (; ; failing += 1) {
    failRenameAt(failing);
    try {
      install(dir, tree, options);
      break;
    } catch (error) {
      expect(error, `failure at rename ${String(failing)}`).toBeInstanceOf(ApplyError);
      expect((error as ApplyError).message).toContain('every file it touched was restored');
      expect(contents(dir), `after a failure at rename ${String(failing)}`).toEqual(before);
    }
  }
  return failing - 1;
}

describe('a failure in the middle of an apply', () => {
  it('restores every file of a first install byte for byte and leaves no lock', () => {
    const dir = tempDir();
    writeFiles(dir, {
      'CLAUDE.md': '# Mine\r\n',
      '.claude/settings.json': '{\n  // mine\n  "model": "opus"\n}\n',
      '.claude/rules/acmekit/guard.md': 'Different.\n',
    });
    fs.mkdirSync(path.join(dir, LOCAL), { recursive: true });
    fs.writeFileSync(path.join(dir, LOCAL, '.gitignore'), '*\n');
    const steps = expectRollbackAtEveryStep(dir, fixtureTree());
    expect(steps).toBeGreaterThan(10);
    expect(fs.existsSync(path.join(dir, TEST_BRAND.stateDir, 'lock.json'))).toBe(true);
  });

  it('restores an update that rewrites, deletes and adds files, and keeps the previous lock', () => {
    const dir = tempDir();
    const tree = fixtureTree();
    install(dir, tree, OPTIONS);
    fs.writeFileSync(
      path.join(dir, 'AGENTS.md'),
      `# Mine\n${fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')}`,
    );
    const changed: RenderTree = new Map(
      [...tree]
        .filter(([file]) => file !== '.claude/skills/why/SKILL.md')
        .map(([file, entries]) => [
          file,
          entries.map((entry) => ({ ...entry, content: entry.content.replace('Python', 'Python 3') })),
        ]),
    );
    const lock = fs.readFileSync(path.join(dir, TEST_BRAND.stateDir, 'lock.json'));
    expect(expectRollbackAtEveryStep(dir, changed, { ...OPTIONS, ownable: () => true })).toBeGreaterThan(1);
    expect(fs.readFileSync(path.join(dir, TEST_BRAND.stateDir, 'lock.json')).equals(lock)).toBe(false);
    expect(fs.existsSync(path.join(dir, '.claude/skills/why/SKILL.md'))).toBe(false);
  });

  function applyError(dir: string): ApplyError {
    try {
      install(dir, fixtureTree(), OPTIONS);
    } catch (error) {
      if (error instanceof ApplyError) return error;
      throw error;
    }
    throw new Error('the install succeeded');
  }

  it('names the file that failed and the backup that holds the files as they were', () => {
    const dir = tempDir();
    writeFiles(dir, { [`${LOCAL}/.gitignore`]: '*\n' });
    failRenameAt(1);
    const { file, message } = applyError(dir);
    expect(file).toMatch(/^\.acmekit\/base\/[0-9a-f]{64}$/);
    expect(message).toContain('injected failure');
    expect(message).toMatch(
      /the files as they were are in \.acmekit\/local\/backup\/\d{8}T\d{9}Z-[0-9a-f]{8}/,
    );
  });

  it('leaves alone a path the run never reached, such as a file saved meanwhile', () => {
    const dir = tempDir();
    writeFiles(dir, { [`${LOCAL}/.gitignore`]: '*\n' });
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Saved meanwhile\n');
      throw Object.assign(new Error('injected failure'), { code: 'EIO' });
    });
    expect(applyError(dir).message).toContain('every file it touched was restored');
    expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe('# Saved meanwhile\n');
  });

  it.runIf(canSymlink())(
    'refuses a write once a folder on its way became a symlink out of the project',
    () => {
      const dir = tempDir();
      const outside = tempDir();
      writeFiles(dir, { [`${LOCAL}/.gitignore`]: '*\n' });
      vi.mocked(fs.renameSync).mockImplementation((from, to) => {
        realRename(from, to);
        if (String(to).endsWith('guard.mjs')) fs.symlinkSync(outside, path.join(dir, '.claude/rules'), 'dir');
      });
      expect(applyError(dir).message).toContain('resolves through a symlink to a place outside the project');
      expect(fs.readdirSync(outside)).toEqual([]);
    },
  );

  it.runIf(canSymlink())('never restores through a folder swapped for a symlink out of the project', () => {
    const dir = tempDir();
    const outside = tempDir();
    writeFiles(dir, { [`${LOCAL}/.gitignore`]: '*\n' });
    fs.writeFileSync(path.join(outside, 'guard.mjs'), 'victim\n');
    let swapped = false;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (swapped) throw Object.assign(new Error('injected failure'), { code: 'EIO' });
      realRename(from, to);
      if (!String(to).endsWith('guard.mjs')) return;
      const folder = path.dirname(String(to));
      fs.rmSync(folder, { recursive: true });
      fs.symlinkSync(outside, folder, 'dir');
      swapped = true;
    });
    expect(applyError(dir).message).toContain('these could not be restored');
    expect(fs.readFileSync(path.join(outside, 'guard.mjs'), 'utf8')).toBe('victim\n');
  });

  it('leaves no temp file and no change behind when any write fails, such as on a full disk', () => {
    const dir = tempDir();
    writeFiles(dir, { 'CLAUDE.md': '# Mine\n', [`${LOCAL}/.gitignore`]: '*\n' });
    const before = contents(dir);
    for (let failing = 1; ; failing += 1) {
      failDescriptorWriteAt(failing);
      try {
        install(dir, fixtureTree(), OPTIONS);
        break;
      } catch (error) {
        expect(error, `failure at write ${String(failing)}`).toBeInstanceOf(ApplyError);
      }
      expect(tempFiles(dir), `after a failure at write ${String(failing)}`).toEqual([]);
      expect(contents(dir), `after a failure at write ${String(failing)}`).toEqual(before);
    }
  });

  it('reports the full disk, not a close that failed after it', () => {
    const dir = tempDir();
    writeFiles(dir, { [`${LOCAL}/.gitignore`]: '*\n' });
    let writeFailed = false;
    vi.mocked(fs.writeFileSync).mockImplementation((file, data, options) => {
      if (typeof file === 'number' && !writeFailed) {
        writeFailed = true;
        throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
      }
      realWrite(file, data, options);
    });
    vi.mocked(fs.closeSync).mockImplementation((descriptor) => {
      realClose(descriptor);
      if (writeFailed) throw Object.assign(new Error('close failed'), { code: 'EIO' });
    });
    const { message } = applyError(dir);
    expect(message).toContain('no space left');
    expect(message).not.toContain('close failed');
  });

  it('changes nothing in the project when the backup itself cannot be made', () => {
    const dir = tempDir();
    writeFiles(dir, { 'CLAUDE.md': '# Mine\n' });
    failRenameAt(1);
    const { file, message } = applyError(dir);
    expect(file).toBe(`${LOCAL}/backup`);
    expect(message).toContain('nothing in the project was changed');
    expect(fs.readdirSync(dir).sort()).toEqual(['.acmekit', 'CLAUDE.md']);
  });
});
