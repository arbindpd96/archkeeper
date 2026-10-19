import { accessSync, constants, lstatSync, statSync } from 'node:fs';
import path from 'node:path';
import { isRecord } from '../../core/text.js';
import { isInside, readRegularFile, realOrUndefined } from './project.js';
import { findProgram, runNodeTool, runProgram, type ToolOptions, type ToolRun } from './tools.js';

// A program's bare name, never a path or an option, so it can name only a package folder or a program.
const PROGRAM_NAME = /^[A-Za-z0-9][\w.+-]*$/;
const SHIM = /\.(?:cmd|bat)$/i;
/** The packages of the Node.js tools whose bin is named otherwise, such as biome's `@biomejs/biome`. */
const PACKAGE_OF: ReadonlyMap<string, string> = new Map([
  ['biome', '@biomejs/biome'],
  ['tsc', 'typescript'],
]);
// Shells, wrappers and package runners run whatever follows them, through a shell or after installing it over the
// network (ADR-0015, ADR-0018); npm runs scripts through a shell.
const SHELLS = 'bash sh zsh dash ksh fish csh tcsh cmd powershell pwsh';
const WRAPPERS = 'env xargs sudo doas nohup timeout nice exec';
const RUNNERS =
  'npm npx pnpm yarn bun bunx deno corepack uv uvx pip pip3 pipx poetry pipenv pdm hatch rye conda';
const REFUSED = new Set(`${SHELLS} ${WRAPPERS} ${RUNNERS}`.split(' '));

/** A tool to run: a Node.js tool's JS entry file, which runs with `process.execPath`, or a program's absolute path. */
export type ProjectTool = { readonly entry: string } | { readonly program: string };

/** A tool found, or why not: `missing` names where it was looked for, `refused` why it never runs. */
export type ToolLookup =
  { readonly tool: ProjectTool } | { readonly missing: string } | { readonly refused: string };

/** The tool a command names first and the arguments that follow it, or why it does not run. */
export type CommandLookup =
  | { readonly tool: ProjectTool; readonly args: readonly string[] }
  | { readonly missing: string }
  | { readonly refused: string };

function isRegularFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// npm names a string bin after the package, and an object bin by its keys.
function binOf(folder: string, name: string): string | undefined {
  try {
    const manifest: unknown = JSON.parse(readRegularFile(path.join(folder, 'package.json'), 1_000_000) ?? '');
    const bin = isRecord(manifest) ? manifest.bin : undefined;
    const entry = isRecord(bin) && Object.hasOwn(bin, name) ? bin[name] : bin;
    return typeof entry === 'string' ? entry : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A Node.js tool's JS entry file: the `bin` of its package's package.json in the project's node_modules (a string,
 * or the tool's name in an object), whose real path stays inside the package's real folder. A package folder linked
 * elsewhere, as pnpm links it, is followed to its own entry. It runs with `process.execPath`, never npx or a shim.
 */
export function nodeTool(projectDir: string, name: string): ToolLookup {
  if (!PROGRAM_NAME.test(name)) return { refused: `${name} is not a program name` };
  const pkg = PACKAGE_OF.get(name) ?? name;
  const folder = realOrUndefined(path.join(projectDir, 'node_modules', ...pkg.split('/')));
  const bin = folder === undefined ? undefined : binOf(folder, name);
  const entry =
    folder === undefined || bin === undefined ? undefined : realOrUndefined(path.resolve(folder, bin));
  if (folder === undefined || entry === undefined || !isInside(folder, entry) || !isRegularFile(entry)) {
    return { missing: `node_modules/${pkg}` };
  }
  return { tool: { entry } };
}

function venvProgram(projectDir: string, name: string): string | undefined {
  const windows = process.platform === 'win32';
  const file = path.join(projectDir, '.venv', windows ? 'Scripts' : 'bin', windows ? `${name}.exe` : name);
  try {
    accessSync(file, constants.X_OK);
    return lstatSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A program such as ruff, as a real executable: the project's `.venv/bin/<name>`, or `.venv\Scripts\<name>.exe` on
 * Windows, when it is a regular file and no symlink, else the one in an absolute PATH folder outside the project.
 */
export function pythonTool(projectDir: string, name: string): ToolLookup {
  if (!PROGRAM_NAME.test(name) || SHIM.test(name)) return { refused: `${name} is not a program name` };
  const program = venvProgram(projectDir, name) ?? findProgram(name, projectDir);
  return program === undefined ? { missing: '.venv or PATH' } : { tool: { program } };
}

function scriptCommand(projectDir: string, args: readonly string[]): CommandLookup {
  const [script = '', ...rest] = args;
  if (script.startsWith('-') || !/\.[cm]?js$/i.test(script)) {
    return { refused: 'node runs only a .js, .mjs or .cjs file of the project' };
  }
  const real = realOrUndefined(path.resolve(projectDir, script));
  const root = realOrUndefined(projectDir);
  if (real === undefined) return { missing: script };
  if (root === undefined || !isInside(root, real) || !isRegularFile(real)) {
    return { refused: `${script} is not a file inside the project` };
  }
  return { tool: { entry: real }, args: rest };
}

/**
 * The tool an argument array names first, run with no shell (ADR-0015): `node` with a JS file of the project, a JS
 * bin from node_modules, or a program from `.venv` or PATH. A path, an option, a `.cmd` or `.bat` shim, a shell, a
 * wrapper and a package runner are refused, npm included, since it runs scripts through a shell.
 */
export function commandTool(projectDir: string, argv: readonly string[]): CommandLookup {
  const [first = '', ...rest] = argv;
  const bare = first.replace(/\.exe$/i, '');
  if (!PROGRAM_NAME.test(first) || SHIM.test(first)) return { refused: `${first} is not a program name` };
  if (REFUSED.has(bare.toLowerCase())) return { refused: `${first} is a shell, wrapper or package runner` };
  if (bare.toLowerCase() === 'node') return scriptCommand(projectDir, rest);
  const node = nodeTool(projectDir, bare);
  const found = 'tool' in node ? node : pythonTool(projectDir, bare);
  return 'tool' in found ? { tool: found.tool, args: rest } : { missing: 'node_modules, .venv or PATH' };
}

/** Runs a project tool with an argument array and no shell: a JS entry through `runNodeTool`, else the program. */
export function runProjectTool(tool: ProjectTool, args: readonly string[], options: ToolOptions): ToolRun {
  return 'entry' in tool ? runNodeTool(tool.entry, args, options) : runProgram(tool.program, args, options);
}
