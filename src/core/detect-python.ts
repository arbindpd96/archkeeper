import { parse, TomlError } from 'smol-toml';
import type { ProblemReport } from './errors.js';
import {
  type CommandPurpose,
  type DetectedCommand,
  type Framework,
  type ProjectView,
  type PythonManager,
  recordOf,
  type StackSignals,
  stringsOf,
  type Tool,
} from './stack-profile.js';

type Table = Readonly<Record<string, unknown>>;

const PYPROJECT = 'pyproject.toml';
const REQUIREMENTS = /^requirements[\w.-]*\.txt$/i;
const PYLOCK = /^pylock(?:\.[\w-]+)?\.toml$/;
const PROJECT_FILES = [PYPROJECT, 'setup.py', 'setup.cfg', 'Pipfile', 'uv.lock', 'poetry.lock'];
/** A tool and the config file names that give it away besides its `[tool.<name>]` table. */
const TOOLS: readonly (readonly [tool: Tool, configs: readonly string[]])[] = [
  ['ruff', ['ruff.toml', '.ruff.toml']],
  ['black', []],
  ['mypy', ['mypy.ini', '.mypy.ini']],
  ['pyright', ['pyrightconfig.json']],
  ['pytest', ['pytest.ini', 'conftest.py']],
];
const PYTHON_FRAMEWORKS: readonly Framework[] = ['django', 'fastapi'];
/**
 * Each command a Python tool gives, by purpose, in the order the first present tool wins. black formats before
 * ruff: a project with both keeps black as its formatter and ruff for linting.
 */
const TOOL_COMMANDS: readonly (readonly [CommandPurpose, tool: Tool, command: string])[] = [
  ['test', 'pytest', 'pytest'],
  ['lint', 'ruff', 'ruff check .'],
  ['format', 'black', 'black .'],
  ['format', 'ruff', 'ruff format .'],
  ['typecheck', 'mypy', 'mypy .'],
  ['typecheck', 'pyright', 'pyright'],
];
const REQUIREMENT_NAME = /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/;

/** A distribution name as PEP 503 compares it: lower case, with each run of `-`, `_` and `.` as one `-`. */
function normalized(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function requirementName(requirement: string): string[] {
  const name = REQUIREMENT_NAME.exec(requirement)?.[1];
  return name === undefined ? [] : [normalized(name)];
}

function readToml(view: ProjectView, file: string, warnings: ProblemReport[]): Table | undefined {
  const text = view.read(file);
  if (text === undefined) return undefined;
  try {
    return parse(text);
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    warnings.push({
      file,
      location: `line ${String(error.line)}, column ${String(error.column)}`,
      problem: 'is not valid TOML, so its dependencies and tool settings were skipped',
      hint: 'fix the TOML at that spot and run again',
    });
    return undefined;
  }
}

function listsIn(table: Table | undefined): string[] {
  return Object.values(table ?? {}).flatMap(stringsOf);
}

function keysIn(table: Table | undefined): string[] {
  return Object.keys(table ?? {});
}

// PEP 621 dependencies and extras, PEP 735 [dependency-groups], uv's dev-dependencies and Poetry's tables.
function pyprojectPackages(document: Table): string[] {
  const project = recordOf(document.project);
  const tool = recordOf(document.tool);
  const poetry = recordOf(tool?.poetry);
  const requirements = [
    ...stringsOf(project?.dependencies),
    ...listsIn(recordOf(project?.['optional-dependencies'])),
    ...listsIn(recordOf(document['dependency-groups'])),
    ...stringsOf(recordOf(tool?.uv)?.['dev-dependencies']),
  ];
  const groups = Object.values(recordOf(poetry?.group) ?? {});
  const poetryNames = [
    ...keysIn(recordOf(poetry?.dependencies)),
    ...keysIn(recordOf(poetry?.['dev-dependencies'])),
    ...groups.flatMap((group) => keysIn(recordOf(recordOf(group)?.dependencies))),
  ];
  return [...requirements.flatMap(requirementName), ...poetryNames.map(normalized)];
}

function requirementsPackages(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/(?:^|\s)#.*$/, ''))
    .filter((line) => !line.trimStart().startsWith('-'))
    .flatMap(requirementName);
}

// A PEP 751 lock lists every package by name, under [[packages]].
function pylockPackages(document: Table): string[] {
  const packages = Array.isArray(document.packages) ? document.packages : [];
  return packages.flatMap((entry) => {
    const name = recordOf(entry)?.name;
    return typeof name === 'string' ? requirementName(name) : [];
  });
}

interface PythonFacts {
  readonly packages: ReadonlySet<string>;
  readonly toolTables: Table;
}

function pythonFacts(view: ProjectView, names: readonly string[], warnings: ProblemReport[]): PythonFacts {
  const pyproject = names.includes(PYPROJECT) ? readToml(view, PYPROJECT, warnings) : undefined;
  const requirements = names.filter((name) => REQUIREMENTS.test(name));
  const locks = names.filter((name) => PYLOCK.test(name));
  const packages = [
    ...(pyproject === undefined ? [] : pyprojectPackages(pyproject)),
    ...requirements.flatMap((file) => requirementsPackages(view.read(file) ?? '')),
    ...locks.flatMap((file) => {
      const lock = readToml(view, file, warnings);
      return lock === undefined ? [] : pylockPackages(lock);
    }),
  ];
  return { packages: new Set(packages), toolTables: recordOf(pyproject?.tool) ?? {} };
}

function manager(names: readonly string[], tables: Table): PythonManager {
  if (names.includes('uv.lock') || tables.uv !== undefined) return 'uv';
  if (names.includes('poetry.lock') || tables.poetry !== undefined) return 'poetry';
  return 'pip';
}

function toolCommands(tools: readonly string[], python: PythonManager): DetectedCommand[] {
  const prefix = python === 'pip' ? '' : `${python} run `;
  const commands = new Map<CommandPurpose, string>();
  for (const [purpose, tool, command] of TOOL_COMMANDS) {
    if (!commands.has(purpose) && tools.includes(tool)) commands.set(purpose, `${prefix}${command}`);
  }
  return [...commands].map(([purpose, command]) => ({ stack: 'python' as const, purpose, command }));
}

function hasPython(names: readonly string[]): boolean {
  return names.some((name) => PROJECT_FILES.includes(name) || REQUIREMENTS.test(name) || PYLOCK.test(name));
}

/**
 * The Python manager and signals of a project root, or undefined when it has no Python files (#25). pyproject.toml
 * and pylock files are parsed with smol-toml; a malformed one becomes a warning and the rest still counts.
 */
export function pythonSignals(
  view: ProjectView,
  names: readonly string[],
): (StackSignals & { readonly pythonManager: PythonManager }) | undefined {
  if (!hasPython(names)) return undefined;
  const warnings: ProblemReport[] = [];
  const { packages, toolTables } = pythonFacts(view, names, warnings);
  const tools = TOOLS.filter(
    ([tool, configs]) =>
      packages.has(tool) || toolTables[tool] !== undefined || configs.some((file) => names.includes(file)),
  ).map(([tool]) => tool);
  const python = manager(names, toolTables);
  return {
    languages: ['python'],
    pythonManager: python,
    tools,
    frameworks: PYTHON_FRAMEWORKS.filter((framework) => packages.has(framework)),
    monorepo: recordOf(toolTables.uv)?.workspace !== undefined,
    commands: toolCommands(tools, python),
    warnings,
  };
}
