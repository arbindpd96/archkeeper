import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { install } from '../src/cli/install.js';
import { ApplyError } from '../src/core/errors.js';
import type { RenderTree } from '../src/core/render-tree.js';
import { tempDir, writeFiles } from './helpers.js';
import { fixtureTree, OPTIONS } from './install-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const realRename = vi.mocked(fs.renameSync).getMockImplementation() ?? fs.renameSync;
const LOCAL = `${TEST_BRAND.stateDir}/local`;

afterEach(() => {
  vi.mocked(fs.renameSync).mockImplementation(realRename);
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
      /the files as they were are in \.acmekit\/local\/backup\/\d{8}T\d{6}Z-[0-9a-f]{8}/,
    );
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
