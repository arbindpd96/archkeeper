import { chmodSync, copyFileSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commandTool,
  nodeTool,
  programTool,
  type ProjectTool,
  pythonTool,
  runProjectTool,
} from '../src/hooks/runtime/project-tools.js';
import { canSymlink, stubEnv, tempDir, writeFiles } from './helpers.js';

const onWindows = process.platform === 'win32';
const ECHO = 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n';
// Every name project-tools refuses, held here word by word, so a word dropped from its lists fails a test: shells,
// wrappers, package runners and task runners (ADR-0015, ADR-0018).
const REFUSED_NAMES = [
  ...'sh bash zsh dash ksh fish csh tcsh cmd powershell pwsh'.split(' '),
  ...'env xargs sudo doas nohup timeout nice exec'.split(' '),
  ...'npm npx pnpm pnpx yarn yarnpkg bun bunx deno corepack uv uvx pip pip3 pipx poetry pipenv pdm hatch rye pixi'.split(
    ' ',
  ),
  ...'conda mamba micromamba'.split(' '),
  ...'tox nox pre-commit make just'.split(' '),
];

/** A project folder whose path holds a space, real so that paths compare as the lookups give them. */
function project(): string {
  const dir = path.join(tempDir(), 'my project');
  mkdirSync(dir);
  return realpathSync.native(dir);
}

/** A package in the project's node_modules with this package.json and a bin script that prints its arguments. */
function nodePackage(dir: string, pkg: string, manifest: object, script = 'bin/tool.js'): string {
  const folder = path.join(dir, 'node_modules', ...pkg.split('/'));
  writeFiles(folder, { 'package.json': JSON.stringify(manifest), [script]: ECHO });
  return path.join(folder, ...script.split('/'));
}

/** A real executable named `name` in `folder`: a copy of this Node.js on Windows, a shell script elsewhere. */
function program(folder: string, name: string): string {
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, onWindows ? `${name}.exe` : name);
  if (onWindows) copyFileSync(process.execPath, file);
  else writeFiles(folder, { [name]: '#!/bin/sh\nprintf "%s|" "$@"\n' });
  chmodSync(file, 0o755);
  return file;
}

const toolOf = (lookup: object): ProjectTool | undefined =>
  'tool' in lookup ? (lookup.tool as ProjectTool) : undefined;

describe('Node.js tools from node_modules (ADR-0015)', () => {
  it('runs the bin a package names as a string, through this Node.js, with the arguments as given', () => {
    const dir = project();
    const entry = nodePackage(dir, 'prettier', { name: 'prettier', bin: './bin/tool.js' });
    const tool = toolOf(nodeTool(dir, 'prettier'));
    expect(tool).toEqual({ entry });
    const run = runProjectTool(tool ?? { entry }, ['--write', 'a b.ts', ';ls'], { cwd: dir });
    expect(run).toMatchObject({ status: 0, stdout: '["--write","a b.ts",";ls"]' });
  });

  it('takes the entry a bin object names after the tool', () => {
    const dir = project();
    const entry = nodePackage(dir, 'eslint', { bin: { 'eslint-other': 'x.js', eslint: './bin/tool.js' } });
    expect(nodeTool(dir, 'eslint')).toEqual({ tool: { entry } });
  });

  it('finds biome in its @biomejs/biome package and tsc in typescript', () => {
    const dir = project();
    const biome = nodePackage(dir, '@biomejs/biome', { bin: { biome: 'bin/biome' } }, 'bin/biome');
    const tsc = nodePackage(dir, 'typescript', { bin: { tsc: './bin/tsc' } }, 'bin/tsc');
    expect(nodeTool(dir, 'biome')).toEqual({ tool: { entry: biome } });
    expect(nodeTool(dir, 'tsc')).toEqual({ tool: { entry: tsc } });
  });

  it.each<[string, object]>([
    ['no bin', { name: 'prettier' }],
    ['a bin object without the tool', { bin: { other: './bin/tool.js' } }],
    ['a bin outside the package', { bin: '../../outside.js' }],
    ['a bin that is missing', { bin: './bin/missing.js' }],
  ])('counts a package with %s as missing', (_name, manifest) => {
    const dir = project();
    writeFiles(dir, { 'outside.js': ECHO });
    nodePackage(dir, 'prettier', manifest);
    expect(nodeTool(dir, 'prettier')).toEqual({ missing: 'node_modules/prettier' });
  });

  it('counts a tool with no package folder as missing', () => {
    expect(nodeTool(project(), 'prettier')).toEqual({ missing: 'node_modules/prettier' });
  });

  it.skipIf(!canSymlink())(
    "counts a package as missing when its bin links out of the package's own folder, even into the project",
    () => {
      const dir = project();
      writeFiles(dir, { 'evil.js': ECHO, 'node_modules/prettier/package.json': '{"bin":"./bin/tool.js"}' });
      mkdirSync(path.join(dir, 'node_modules', 'prettier', 'bin'));
      symlinkSync(path.join(dir, 'evil.js'), path.join(dir, 'node_modules', 'prettier', 'bin', 'tool.js'));
      expect(nodeTool(dir, 'prettier')).toEqual({ missing: 'node_modules/prettier' });
    },
  );

  it.skipIf(!canSymlink())(
    'follows a package folder linked elsewhere, as pnpm links it, to its own bin',
    () => {
      const dir = project();
      const store = path.join(tempDir(), 'store', 'prettier');
      writeFiles(store, { 'package.json': JSON.stringify({ bin: 'bin/tool.js' }), 'bin/tool.js': ECHO });
      mkdirSync(path.join(dir, 'node_modules'));
      symlinkSync(store, path.join(dir, 'node_modules', 'prettier'), 'dir');
      expect(nodeTool(dir, 'prettier')).toEqual({
        tool: { entry: realpathSync.native(path.join(store, 'bin', 'tool.js')) },
      });
    },
  );
});

describe('programs from .venv or PATH (ADR-0015)', () => {
  it.skipIf(onWindows)('takes .venv/bin/ruff, a regular executable file', () => {
    const dir = project();
    const ruff = program(path.join(dir, '.venv', 'bin'), 'ruff');
    stubEnv('PATH', '');
    expect(pythonTool(dir, 'ruff')).toEqual({ tool: { program: ruff } });
    expect(runProjectTool({ program: ruff }, ['check', 'a;b.py'], { cwd: dir }).stdout).toBe('check|a;b.py|');
  });

  it.skipIf(!onWindows)('takes .venv/Scripts/ruff.exe, a real executable, and runs it', () => {
    const dir = project();
    const ruff = program(path.join(dir, '.venv', 'Scripts'), 'ruff');
    stubEnv('PATH', '');
    expect(pythonTool(dir, 'ruff')).toEqual({ tool: { program: ruff } });
    const run = runProjectTool({ program: ruff }, ['-e', 'process.stdout.write("ran")'], { cwd: dir });
    expect(run).toMatchObject({ status: 0, stdout: 'ran' });
  });

  it.skipIf(!canSymlink() || onWindows)('passes over a .venv program that is a symlink', () => {
    const dir = project();
    const target = program(tempDir(), 'ruff');
    mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true });
    symlinkSync(target, path.join(dir, '.venv', 'bin', 'ruff'));
    stubEnv('PATH', '');
    expect(pythonTool(dir, 'ruff')).toEqual({ missing: '.venv or PATH' });
  });

  it('looks on PATH only in absolute folders outside the project', () => {
    const dir = project();
    program(path.join(dir, 'tools'), 'ruff');
    const outside = program(tempDir(), 'ruff');
    stubEnv('PATH', ['tools', path.join(dir, 'tools'), path.dirname(outside)].join(path.delimiter));
    expect(pythonTool(dir, 'ruff')).toEqual({ tool: { program: outside } });
    stubEnv('PATH', ['tools', path.join(dir, 'tools')].join(path.delimiter));
    expect(pythonTool(dir, 'ruff')).toHaveProperty('missing');
  });

  it('never takes a .cmd or .bat shim, in .venv or on PATH', () => {
    const dir = project();
    const scripts = path.join(dir, '.venv', onWindows ? 'Scripts' : 'bin');
    const outside = tempDir();
    writeFiles(scripts, { 'ruff.cmd': '@echo off\r\n', 'ruff.bat': '@echo off\r\n' });
    writeFiles(outside, { 'ruff.cmd': '@echo off\r\n', 'ruff.bat': '@echo off\r\n' });
    stubEnv('PATH', outside);
    expect(pythonTool(dir, 'ruff')).toHaveProperty('missing');
    expect(pythonTool(dir, 'ruff.cmd')).toHaveProperty('refused');
    expect(pythonTool(dir, 'ruff.bat')).toHaveProperty('refused');
  });
});

describe('programs by name (#38)', () => {
  it('finds a JS bin, then a program from .venv or PATH, and says where it looked for one it misses', () => {
    const dir = project();
    const entry = nodePackage(dir, 'vitest', { bin: { vitest: 'bin/tool.js' } });
    const pytest = program(tempDir(), 'pytest');
    stubEnv('PATH', path.dirname(pytest));
    expect(programTool(dir, 'vitest')).toEqual({ tool: { entry } });
    expect(programTool(dir, 'pytest')).toEqual({ tool: { program: pytest } });
    expect(programTool(dir, 'nope')).toEqual({ missing: 'node_modules, .venv or PATH' });
  });

  it.each(['bash', 'Uv.exe', 'npx', 'poetry', './run-tests', '--help', 'pytest.cmd'])(
    'refuses %s',
    (name) => {
      expect(programTool(project(), name)).toHaveProperty('refused');
    },
  );

  it.each(['tox', 'nox', 'pre-commit', 'make', 'Just.exe'])(
    'refuses %s, a runner that runs recipes through a shell or installs packages, even on PATH',
    (name) => {
      const runner = program(tempDir(), name.replace(/\.exe$/i, '').toLowerCase());
      stubEnv('PATH', path.dirname(runner));
      expect(programTool(project(), name)).toEqual({ refused: `${name} is a shell, wrapper or runner` });
    },
  );
});

describe('the names project-tools refuses (ADR-0015)', () => {
  it.each(REFUSED_NAMES)(
    'refuses %s in any case and with .exe, even with a program of that name on PATH',
    (name) => {
      const dir = project();
      const folder = tempDir();
      const file = onWindows ? `${name}.exe` : name;
      writeFiles(folder, { [file]: '#!/bin/sh\n' });
      chmodSync(path.join(folder, file), 0o755);
      stubEnv('PATH', folder);
      const capital = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
      for (const given of [name, capital, `${name}.exe`, `${name.toUpperCase()}.EXE`]) {
        const refused = { refused: `${given} is a shell, wrapper or runner` };
        expect(programTool(dir, given)).toEqual(refused);
        expect(commandTool(dir, [given, '--version'])).toEqual(refused);
      }
    },
  );
});

describe('commands from the config (#37)', () => {
  it('runs node with a JS file of the project and the arguments after it', () => {
    const dir = project();
    writeFiles(dir, { 'scripts/check-comments.mjs': ECHO });
    const found = commandTool(dir, ['node', 'scripts/check-comments.mjs', '--strict']);
    expect(found).toEqual({
      tool: { entry: path.join(dir, 'scripts', 'check-comments.mjs') },
      args: ['--strict'],
    });
  });

  it('runs a JS bin from node_modules, then a program from .venv or PATH', () => {
    const dir = project();
    const entry = nodePackage(dir, 'stylelint', { bin: 'bin/tool.js' });
    const mypy = program(tempDir(), 'mypy');
    stubEnv('PATH', path.dirname(mypy));
    expect(commandTool(dir, ['stylelint', '--fix'])).toEqual({ tool: { entry }, args: ['--fix'] });
    expect(commandTool(dir, ['mypy', '--strict'])).toEqual({ tool: { program: mypy }, args: ['--strict'] });
    expect(commandTool(dir, ['nope'])).toEqual({ missing: 'node_modules, .venv or PATH' });
  });

  it.skipIf(!canSymlink())(
    'refuses node with a project script that links to a file outside the project',
    () => {
      const dir = project();
      const outside = tempDir();
      writeFiles(outside, { 'check.mjs': ECHO });
      mkdirSync(path.join(dir, 'scripts'));
      symlinkSync(path.join(outside, 'check.mjs'), path.join(dir, 'scripts', 'check.mjs'));
      expect(commandTool(dir, ['node', 'scripts/check.mjs'])).toEqual({
        refused: 'scripts/check.mjs is not a file inside the project',
      });
    },
  );

  it.each<[string, readonly string[]]>([
    ['npm, which runs scripts through a shell', ['npm', 'run', 'lint']],
    ['a shell', ['bash', '-c', 'echo hi']],
    ['a Windows shell', ['CMD.EXE', '/c', 'dir']],
    ['a wrapper', ['env', 'ruff']],
    ['a package runner', ['npx', 'prettier']],
    ['uv', ['uv', 'run', 'ruff']],
    ['poetry', ['poetry', 'run', 'ruff']],
    ['a path', ['./scripts/check.sh']],
    ['an option', ['--help']],
    ['a .cmd shim', ['ruff.cmd']],
    ['node with an option', ['node', '-e', 'process.exit(1)']],
    ['node with a script that is not JS', ['node', 'scripts/check.sh']],
    ['node with a script outside the project', ['node', '../outside.mjs']],
  ])('refuses %s', (_name, argv) => {
    const dir = project();
    writeFiles(path.dirname(dir), { 'outside.mjs': ECHO });
    writeFiles(dir, { 'scripts/check.sh': 'echo hi\n' });
    expect(commandTool(dir, argv)).toHaveProperty('refused');
  });
});
