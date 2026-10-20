import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importProblem } from '../src/core/imports.js';
import { mapValues } from '../src/core/map-seed.js';
import { findSecret } from '../src/core/secrets.js';
import type { ProjectView, StackProfile } from '../src/core/stack-profile.js';
import { unsafeValue } from '../src/core/template.js';
import { REPO_ROOT } from './helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';
import { SECRET_SAMPLES } from './secret-samples.js';

const NO_LAYOUT = ['Run `/update-map` to list the project folders here.'];
const NO_ENTRY_POINTS = ['None found in `package.json` or `pyproject.toml`.'];
const HEADER = ['| Path | Purpose |', '| --- | --- |'];
const EMPTY = profileOf('empty');

function profileOf(fixture: string): StackProfile {
  const file = path.join(REPO_ROOT, 'test/fixtures/detect', fixture, 'expected.json');
  return JSON.parse(readFileSync(file, 'utf8')) as StackProfile;
}

function viewOf(files: Readonly<Record<string, string>> = {}): ProjectView {
  return { list: () => Object.keys(files), read: (file) => files[file] };
}

interface Seed {
  readonly stack: string;
  readonly layout: readonly string[];
  readonly entryPoints: readonly string[];
}

function seedOf(tracked: readonly string[] | undefined, files: Readonly<Record<string, string>> = {}): Seed {
  return mapValues(EMPTY, viewOf(files), tracked, TEST_BRAND).map as unknown as Seed;
}

function layoutOf(tracked: readonly string[]): readonly string[] {
  return seedOf(tracked).layout;
}

function rows(...folders: string[]): string[] {
  return [...HEADER, ...folders.map((folder) => `| \`${folder}\` | |`)];
}

function entryPointsOf(files: Readonly<Record<string, string>>): readonly string[] {
  return seedOf(undefined, files).entryPoints;
}

describe('the map stack line (#36)', () => {
  it.each([
    ['empty', 'not detected'],
    ['ts-npm', 'TypeScript (npm)'],
    ['next', 'TypeScript (bun); frameworks: react, next'],
    ['py-uv', 'Python (uv); frameworks: fastapi'],
    ['mixed', 'TypeScript and Python (npm, uv)'],
  ])('names the languages, managers and frameworks detected in %s', (fixture, line) => {
    expect(mapValues(profileOf(fixture), viewOf(), [], TEST_BRAND).map).toMatchObject({ stack: line });
  });
});

describe('the map layout (#36)', () => {
  it('lists folders of depth 1, then depth 2, each sorted, and no file or deeper folder', () => {
    const tracked = [
      'README.md',
      'src/cli/main.ts',
      'src/a/b/c/d.ts',
      'docs/x.md',
      'src/index.ts',
      'Zeta/y.ts',
    ];
    expect(layoutOf(tracked)).toEqual(rows('Zeta/', 'docs/', 'src/', 'src/a/', 'src/cli/'));
  });

  it('sorts by UTF-16 code units, the same on every OS and locale', () => {
    const tracked = ['b/x', 'a-b/x', 'a/x', 'B/x', '.github/x', 'é/x', 'a/b-c/x', 'a/b/x'];
    expect(layoutOf(tracked)).toEqual(rows('.github/', 'B/', 'a-b/', 'a/', 'b/', 'é/', 'a/b-c/', 'a/b/'));
  });

  it('keeps 40 rows: 39 folders and a last row saying how many more, top-level folders first', () => {
    const top = Array.from({ length: 30 }, (_, index) => `top${String(index).padStart(2, '0')}/f.ts`);
    const nested = Array.from({ length: 15 }, (_, index) => `top00/n${String(index).padStart(2, '0')}/f.ts`);
    const layout = layoutOf([...nested, ...top]);
    expect(layout).toHaveLength(2 + 40);
    expect(layout.slice(2, 32)).toEqual(rows(...top.map((file) => file.replace('f.ts', ''))).slice(2));
    expect(layout[32]).toBe('| `top00/n00/` | |');
    expect(layout.at(-2)).toBe('| `top00/n08/` | |');
    expect(layout.at(-1)).toBe('| … and 6 more folders | |');
  });

  it('shows exactly 40 folders with no row of more', () => {
    const tracked = Array.from({ length: 40 }, (_, index) => `f${String(index).padStart(2, '0')}/x.ts`);
    const layout = layoutOf(tracked);
    expect(layout).toHaveLength(42);
    expect(layout.at(-1)).toBe('| `f39/` | |');
  });

  it.each([
    'node_modules',
    '.yarn',
    'bower_components',
    'jspm_packages',
    'vendor',
    'dist',
    'build',
    'out',
    'coverage',
    'target',
    '.venv',
    'venv',
    '__pycache__',
    '.next',
    '.turbo',
    '.cache',
    TEST_BRAND.stateDir,
  ])('leaves out %s and what it holds, at the top or one level down', (name) => {
    const tracked = [`${name}/a/x.js`, `app/${name}/x.js`, 'app/src/x.js'];
    expect(layoutOf(tracked)).toEqual(rows('app/', 'app/src/'));
  });

  it('keeps a folder that only starts like the state folder', () => {
    expect(layoutOf([`${TEST_BRAND.stateDir}-notes/x.md`])).toEqual(rows(`${TEST_BRAND.stateDir}-notes/`));
  });

  const [, awsKey = ''] = SECRET_SAMPLES.find(([kind]) => kind === 'AWS access key') ?? [];
  const [, githubToken = ''] = SECRET_SAMPLES.find(([kind]) => kind === 'GitHub fine-grained token') ?? [];
  it.each([
    ['a backtick', 'a`b'],
    ['a bar', 'a|b'],
    ['a line break', 'a\nb'],
    ['a tab', 'a\tb'],
    ['a C1 control character', 'a\u0085b'],
    ['a bidirectional override', 'a‮b'],
    ['a block marker', `${TEST_BRAND.markerPrefix}:begin x`],
    ['a legacy block marker', 'OLDKIT:END x'],
    ['an HTML comment opener', 'a<!--b'],
    ['an HTML comment closer', 'a-->b'],
    ['an AWS access key', awsKey],
    ['a GitHub token', githubToken],
    ['an @ import of the home folder', 'notes@~'],
    ['an @ import of a parent folder', '@..'],
    ['an @ import of a secrets file', 'x@.env'],
  ])('leaves out a folder with %s, and the folders under it', (_kind, name) => {
    expect(layoutOf([`${name}/x.ts`, `${name}/sub/x.ts`, `ok/${name}/x.ts`, 'ok/x.ts'])).toEqual(rows('ok/'));
  });

  it('keeps an @ in a folder name that imports no outside or private file', () => {
    expect(layoutOf(['@types/x.d.ts'])).toEqual(rows('@types/'));
  });

  it('asks for /update-map without a list of tracked files, or with no folder in it', () => {
    expect(layoutOf(['README.md'])).toEqual(NO_LAYOUT);
    expect(layoutOf([])).toEqual(NO_LAYOUT);
    expect(seedOf(undefined).layout).toEqual(NO_LAYOUT);
  });

  it('gives the same lines for the same files in any order', () => {
    const tracked = ['src/b/x.ts', 'docs/a.md', 'src/a/y.ts', 'test/x.ts'];
    expect(layoutOf([...tracked].reverse())).toEqual(layoutOf(tracked));
  });
});

describe('the map entry points (#36)', () => {
  it('lists package.json bin, main and exports, then pyproject.toml scripts, in file order', () => {
    const files = {
      'package.json': JSON.stringify({
        name: 'shop',
        bin: { shop: './bin/shop.js', 'shop-admin': './bin/admin.js' },
        main: './dist/index.js',
        exports: { '.': './dist/index.js', './cart': './dist/cart.js' },
      }),
      'pyproject.toml': '[project]\nname = "shop"\n\n[project.scripts]\nshop-py = "shop.cli:main"\n',
    };
    expect(entryPointsOf(files)).toEqual([
      '- `package.json` bin `shop`: `./bin/shop.js`',
      '- `package.json` bin `shop-admin`: `./bin/admin.js`',
      '- `package.json` main: `./dist/index.js`',
      '- `package.json` exports `.`: `./dist/index.js`',
      '- `package.json` exports `./cart`: `./dist/cart.js`',
      '- `pyproject.toml` script `shop-py`: `shop.cli:main`',
    ]);
  });

  it.each([
    [{ name: '@acme/shop', bin: './cli.js' }, '- `package.json` bin `shop`: `./cli.js`'],
    [{ name: 'shop', bin: './cli.js' }, '- `package.json` bin `shop`: `./cli.js`'],
    [{ bin: './cli.js' }, '- `package.json` bin: `./cli.js`'],
  ])('names a string bin after the package without its scope: %j', (manifest, line) => {
    expect(entryPointsOf({ 'package.json': JSON.stringify(manifest) })).toEqual([line]);
  });

  it('lists exports as one string, as conditions, and as subpaths with nested conditions', () => {
    const exportsOf = (value: unknown): readonly string[] =>
      entryPointsOf({ 'package.json': JSON.stringify({ exports: value }) });
    expect(exportsOf('./index.js')).toEqual(['- `package.json` exports `.`: `./index.js`']);
    expect(exportsOf({ import: './index.mjs', require: './index.cjs' })).toEqual([
      '- `package.json` exports `.` (import): `./index.mjs`',
      '- `package.json` exports `.` (require): `./index.cjs`',
    ]);
    expect(exportsOf({ './cart': { node: { import: './cart.mjs' }, default: './cart.js' } })).toEqual([
      '- `package.json` exports `./cart` (node, import): `./cart.mjs`',
      '- `package.json` exports `./cart` (default): `./cart.js`',
    ]);
  });

  it('skips values that name no file: null, arrays, numbers, empty strings and conditions nested too deep', () => {
    const deep = { a: { b: { c: { d: { e: './deep.js' } } } } };
    const manifest = {
      bin: { '': './x.js', x: 1 },
      main: '',
      exports: { '.': null, './a': ['./a.js'], './d': deep },
    };
    expect(entryPointsOf({ 'package.json': JSON.stringify(manifest) })).toEqual(NO_ENTRY_POINTS);
  });

  it('gives none from a malformed package.json or pyproject.toml, and still reads the other', () => {
    const scripts = '[project.scripts]\nshop = "shop.cli:main"\n';
    expect(entryPointsOf({ 'package.json': '{"bin": ', 'pyproject.toml': scripts })).toEqual([
      '- `pyproject.toml` script `shop`: `shop.cli:main`',
    ]);
    const manifest = JSON.stringify({ main: './index.js' });
    expect(entryPointsOf({ 'package.json': manifest, 'pyproject.toml': '[project\n' })).toEqual([
      '- `package.json` main: `./index.js`',
    ]);
    expect(entryPointsOf({ 'package.json': '[]', 'pyproject.toml': 'project = 1\n' })).toEqual(
      NO_ENTRY_POINTS,
    );
  });

  it('leaves out an entry point whose name, condition or target could break the line or that render refuses', () => {
    const bin = { 'a`b': './a.js', 'c|d': './c.js', ok: './ok.js', bad: '@~/x.js', marker: 'oldkit:begin x' };
    const exports = { '.': { 'a\nb': './a.js', 'x-->': './x.js' } };
    expect(entryPointsOf({ 'package.json': JSON.stringify({ bin, exports }) })).toEqual([
      '- `package.json` bin `ok`: `./ok.js`',
    ]);
  });

  it('keeps 20 lines: 19 entry points and a last line saying how many more', () => {
    const exports = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`./m${String(index)}`, './x.js']),
    );
    const lines = entryPointsOf({ 'package.json': JSON.stringify({ exports }) });
    expect(lines).toHaveLength(20);
    expect(lines.at(-1)).toBe('- … and 6 more');
  });

  it('says none were found where neither file declares one', () => {
    expect(entryPointsOf({})).toEqual(NO_ENTRY_POINTS);
  });
});

describe('mapValues (#36)', () => {
  it('gives the same values for the same input', () => {
    const files = {
      'package.json': JSON.stringify({ name: 'x', bin: './x.js', exports: { '.': './x.js' } }),
    };
    const tracked = ['src/a.ts', 'src/b/c.ts', 'docs/d.md'];
    const first = JSON.stringify(mapValues(profileOf('ts-npm'), viewOf(files), tracked, TEST_BRAND));
    expect(JSON.stringify(mapValues(profileOf('ts-npm'), viewOf(files), [...tracked], TEST_BRAND))).toBe(
      first,
    );
  });

  it('never gives a value or a file that render refuses, whatever the tracked paths are named', () => {
    const name = fc.stringMatching(/^[a-z@.~`|<>!\-\n‮:]{1,8}$/);
    const paths = fc.array(fc.array(name, { minLength: 1, maxLength: 3 }).map((parts) => parts.join('/')));
    fc.assert(
      fc.property(paths, (tracked) => {
        const values = mapValues(EMPTY, viewOf(), tracked, TEST_BRAND);
        expect(unsafeValue(values, TEST_BRAND)).toBeUndefined();
        const text = (values.map as unknown as Seed).layout.join('\n');
        expect(importProblem(text)).toBeUndefined();
        expect(findSecret(text)).toBeUndefined();
      }),
      { numRuns: 500 },
    );
  });
});
