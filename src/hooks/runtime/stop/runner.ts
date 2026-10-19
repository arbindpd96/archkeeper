import path from 'node:path';
import { type CommandLookup, isRegularFile, programTool } from '../project-tools.js';
import { realOrUndefined } from '../project.js';
import { findProgram } from '../tools.js';

// Node.js installs npm beside itself, in node_modules on Windows and in ../lib/node_modules elsewhere; Homebrew keeps
// it apart and links npm on PATH to its npm-cli.js. Without npm on PATH, '' has no real path and adds no candidate.
function npmCli(projectDir: string): string | undefined {
  const folder = path.dirname(process.execPath);
  const linked = realOrUndefined(findProgram('npm', projectDir) ?? '') ?? '';
  return [
    path.join(folder, 'node_modules/npm/bin/npm-cli.js'),
    path.join(folder, '../lib/node_modules/npm/bin/npm-cli.js'),
    linked,
  ].find((file) => file.endsWith('npm-cli.js') && isRegularFile(file));
}

// npm runs only the script it is asked for: no pre- or post-script (ADR-0015), and no check of the registry for a
// newer npm, which it otherwise makes once a week (ADR-0018).
function npmCommand(projectDir: string, args: readonly string[]): CommandLookup {
  const [command, ...rest] = args;
  const options = rest.slice(0, rest.includes('--') ? rest.indexOf('--') : rest.length);
  const script = command === 'test' || (command === 'run' && !(rest[0] ?? '-').startsWith('-'));
  if (!script || options.some((arg) => arg.startsWith('-'))) {
    return { refused: 'npm runs only as npm test or npm run <script>, its options after --' };
  }
  const entry = npmCli(projectDir);
  if (entry === undefined) return { missing: 'npm beside Node.js or on PATH' };
  return { tool: { entry }, args: ['--ignore-scripts', '--no-update-notifier'].concat(args) };
}

/**
 * The program `checks.stop` names and its arguments, run with no shell (ADR-0015, #38): npm only as `npm test` or
 * `npm run <script>`, through npm's own JS entry with `--ignore-scripts` before the rest; else a JS bin from
 * node_modules or a program from `.venv` or PATH, never a shell, wrapper or package runner. npm install, exec and
 * ci are refused with every other npm command.
 */
export function stopCommand(projectDir: string, argv: readonly string[]): CommandLookup {
  const [first = '', ...rest] = argv;
  if (/^npm(?:\.exe)?$/i.test(first)) return npmCommand(projectDir, rest);
  const found = programTool(projectDir, first);
  return 'tool' in found ? { tool: found.tool, args: rest } : found;
}
