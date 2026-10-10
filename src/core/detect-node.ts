import type { Agent } from 'package-manager-detector';
import { resolveCommand } from 'package-manager-detector/commands';
import { AGENTS, LOCKS } from 'package-manager-detector/constants';
import type { ProblemReport } from './errors.js';
import { parseJson } from './json.js';
import {
  type CommandPurpose,
  type DetectedCommand,
  type Framework,
  type Language,
  PURPOSES,
  type ProjectView,
  recordOf,
  type StackSignals,
  type Tool,
} from './stack-profile.js';

const PACKAGE_JSON = 'package.json';

/** A tool's package and the config file names that also give it away. */
const TOOLS: readonly (readonly [tool: Tool, pkg: string, config: RegExp])[] = [
  ['prettier', 'prettier', /^(?:\.prettierrc(?:\.\w+)?|prettier\.config\.[cm]?[jt]s)$/],
  ['eslint', 'eslint', /^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.\w+)?)$/],
  ['biome', '@biomejs/biome', /^biome\.jsonc?$/],
  ['tsc', 'typescript', /^tsconfig\.json$/],
  ['vitest', 'vitest', /^vitest\.(?:config|workspace)\.[cm]?[jt]s$/],
  ['jest', 'jest', /^jest\.config\.(?:[cm]?[jt]s|json)$/],
];
const NODE_FRAMEWORKS: readonly Framework[] = ['react', 'next'];
// `npm init` writes a test script that only fails; listing it would tell agents to run a command that always fails.
const NPM_PLACEHOLDER = 'no test specified';
const WORKSPACE_FILES = ['pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json', 'rush.json'];
const SCRIPT_NAMES: Readonly<Record<CommandPurpose, readonly string[]>> = {
  build: ['build'],
  test: ['test'],
  lint: ['lint'],
  format: ['format', 'fmt'],
  typecheck: ['typecheck', 'type-check', 'types'],
};
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** What the kit reads from package.json, each field read on its own so one odd field drops only itself. */
interface PackageFacts {
  readonly packages: ReadonlySet<string>;
  readonly scripts: ReadonlySet<string>;
  readonly manager: string | undefined;
  readonly workspaces: boolean;
}

const NO_FACTS: PackageFacts = {
  packages: new Set(),
  scripts: new Set(),
  manager: undefined,
  workspaces: false,
};

function stringKeys(value: unknown): string[] {
  const record = recordOf(value);
  return record === undefined ? [] : Object.keys(record).filter((key) => typeof record[key] === 'string');
}

// The script's text only rules a script out; it never reaches a template.
function scriptNames(value: unknown): Set<string> {
  const scripts = recordOf(value) ?? {};
  return new Set(
    stringKeys(scripts).filter((name) => {
      const text = scripts[name];
      return typeof text === 'string' && !text.includes(NPM_PLACEHOLDER);
    }),
  );
}

// The packageManager field reads `pnpm@9.1.0+sha512...`; devEngines names the manager on its own.
function declaredManager(manifest: Readonly<Record<string, unknown>>): string | undefined {
  const field = manifest.packageManager;
  const engines = recordOf(recordOf(manifest.devEngines)?.packageManager);
  const named = typeof field === 'string' ? field.replace(/^\^/, '').split('@')[0] : engines?.name;
  return typeof named === 'string' && (AGENTS as readonly string[]).includes(named) ? named : undefined;
}

function packageFacts(text: string, warnings: ProblemReport[]): PackageFacts {
  const parsed = parseJson(text);
  const manifest = parsed.ok ? recordOf(parsed.value) : undefined;
  if (manifest === undefined) {
    const finding = parsed.ok
      ? { location: '', problem: 'is not a JSON object', hint: 'fix package.json' }
      : parsed.finding;
    warnings.push({ file: PACKAGE_JSON, ...finding, problem: `${finding.problem}, so it was skipped` });
    return NO_FACTS;
  }
  return {
    packages: new Set(DEPENDENCY_FIELDS.flatMap((field) => stringKeys(manifest[field]))),
    scripts: scriptNames(manifest.scripts),
    manager: declaredManager(manifest),
    workspaces: manifest.workspaces !== undefined,
  };
}

// As package-manager-detector's detect() decides it: the manager package.json names, else the first lockfile's.
function packageManager(names: readonly string[], facts: PackageFacts): string {
  if (facts.manager !== undefined) return facts.manager;
  if (names.includes('rush.json')) return 'pnpm';
  const lock = Object.keys(LOCKS).find((file) => names.includes(file));
  return (lock === undefined ? undefined : LOCKS[lock]) ?? 'npm';
}

function runCommand(manager: string, script: string): string {
  const resolved = resolveCommand(manager as Agent, 'run', [script]);
  return resolved === null ? `${manager} run ${script}` : [resolved.command, ...resolved.args].join(' ');
}

// Commands come from fixed script names, never from a script's text, so no project data reaches a template.
function scriptCommands(scripts: ReadonlySet<string>, manager: string): DetectedCommand[] {
  return PURPOSES.flatMap((purpose) => {
    const script = SCRIPT_NAMES[purpose].find((name) => scripts.has(name));
    return script === undefined
      ? []
      : [{ stack: 'ts' as const, purpose, command: runCommand(manager, script) }];
  });
}

function language(names: readonly string[], packages: ReadonlySet<string>): Language {
  return names.includes('tsconfig.json') || packages.has('typescript') ? 'typescript' : 'javascript';
}

/** The JS/TS package manager and signals of a project root, or undefined when it has no package.json (#25). */
export function nodeSignals(
  view: ProjectView,
  names: readonly string[],
): (StackSignals & { readonly packageManager: string }) | undefined {
  const text = names.includes(PACKAGE_JSON) ? view.read(PACKAGE_JSON) : undefined;
  if (text === undefined) return undefined;
  const warnings: ProblemReport[] = [];
  const facts = packageFacts(text, warnings);
  const manager = packageManager(names, facts);
  const tools = TOOLS.filter(
    ([, pkg, config]) => facts.packages.has(pkg) || names.some((name) => config.test(name)),
  );
  return {
    languages: [language(names, facts.packages)],
    packageManager: manager,
    tools: tools.map(([tool]) => tool),
    frameworks: NODE_FRAMEWORKS.filter((framework) => facts.packages.has(framework)),
    monorepo: facts.workspaces || WORKSPACE_FILES.some((file) => names.includes(file)),
    commands: scriptCommands(facts.scripts, manager),
    warnings,
  };
}
