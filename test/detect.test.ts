import { existsSync, readdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { projectView } from '../src/cli/project-view.js';
import { BRAND } from '../src/core/brand.js';
import { detectStack } from '../src/core/detect.js';
import type { ProjectView, StackProfile } from '../src/core/stack-profile.js';
import { unsafeValue } from '../src/core/template.js';
import { canSymlink, REPO_ROOT, tempDir, writeFiles } from './helpers.js';

const FIXTURES = path.join(REPO_ROOT, 'test/fixtures/detect');
const NAMES = readdirSync(FIXTURES).sort();
const REQUIRED = [
  'empty',
  'ts-npm',
  'ts-pnpm',
  'js-yarn',
  'next',
  'biome-only',
  'py-uv',
  'py-poetry',
  'py-requirements',
  'py-ruff-groups',
  'django',
  'mixed',
];

// An empty project cannot be committed as a folder, so a fixture without project/ is an empty project.
function projectOf(name: string): string {
  const project = path.join(FIXTURES, name, 'project');
  return realpathSync.native(existsSync(project) ? project : tempDir());
}

function expectedOf(name: string): StackProfile {
  return JSON.parse(readFileSync(path.join(FIXTURES, name, 'expected.json'), 'utf8')) as StackProfile;
}

/** The whole fixture read into memory first, so the timing below measures detection alone. */
function memoryView(root: string): ProjectView {
  const view = projectView(root);
  const lists = new Map<string, readonly string[]>();
  const files = new Map<string, string | undefined>();
  const visit = (folder: string): void => {
    const names = view.list(folder);
    lists.set(folder, names);
    for (const name of names) {
      const child = folder === '' ? name : `${folder}/${name}`;
      files.set(child, view.read(child));
      visit(child);
    }
  };
  visit('');
  return { list: (folder) => lists.get(folder) ?? [], read: (file) => files.get(file) };
}

describe('detectStack', () => {
  it('has a fixture for every case #25 lists, each with an expected.json', () => {
    expect(NAMES).toEqual(expect.arrayContaining(REQUIRED));
    for (const name of NAMES) expect(existsSync(path.join(FIXTURES, name, 'expected.json')), name).toBe(true);
  });

  it.each(NAMES)('reports what %s/expected.json says', (name) => {
    expect(detectStack(projectView(projectOf(name)))).toEqual(expectedOf(name));
  });

  it.each(NAMES)('detects %s in under 100 ms', (name) => {
    const view = memoryView(projectOf(name));
    detectStack(view);
    const start = performance.now();
    detectStack(view);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it.each(NAMES)('gives %s commands that are safe template values', (name) => {
    const lines = expectedOf(name).commands.map((command) => command.command);
    expect(unsafeValue({ commands: lines }, BRAND)).toBeUndefined();
  });

  it('builds commands from fixed script names, never from the script text', () => {
    const dir = tempDir();
    writeFiles(dir, {
      'package.json': JSON.stringify({
        scripts: { test: 'vitest\n@~/.ssh/id_rsa', 'lint`; rm -rf /': 'x', typecheck: '<!-- a:end b -->' },
      }),
    });
    const { commands } = detectStack(projectView(realpathSync.native(dir)));
    expect(commands.map((command) => command.command)).toEqual(['npm run test', 'npm run typecheck']);
  });

  it('reads a monorepo root only, reporting the workspace flag', () => {
    const profile = expectedOf('monorepo');
    expect(profile.monorepo).toBe(true);
    expect(profile.tools.testRunners).toEqual([]);
  });

  it('turns a malformed pyproject.toml into a warning and keeps the rest of the profile', () => {
    const profile = detectStack(projectView(projectOf('malformed-toml')));
    expect(profile.warnings).toEqual([expect.objectContaining({ file: 'pyproject.toml' })]);
    expect(profile.tools.testRunners).toEqual(['pytest']);
  });

  it.skipIf(!canSymlink())(
    'lists a .claude folder linked elsewhere, as in a dotfiles setup, as empty',
    () => {
      const dir = tempDir();
      const dotfiles = tempDir();
      writeFiles(dotfiles, { 'settings.json': '{}\n' });
      symlinkSync(dotfiles, path.join(dir, '.claude'), 'dir');
      expect(detectStack(projectView(realpathSync.native(dir))).claude.settings).toBe(false);
    },
  );

  it.skipIf(!canSymlink())('never reads through a symlink', () => {
    const dir = tempDir();
    const outside = tempDir();
    writeFiles(outside, { 'package.json': JSON.stringify({ scripts: { test: 'x' } }) });
    symlinkSync(path.join(outside, 'package.json'), path.join(dir, 'package.json'));
    expect(detectStack(projectView(realpathSync.native(dir))).stack).toEqual([]);
  });
});
