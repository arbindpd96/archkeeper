import { toLf } from '../../../core/text.js';
import { type CommandLookup, commandTool, nodeTool, pythonTool, runProjectTool } from '../project-tools.js';
import type { EditedFile } from './edited-file.js';

const SCRIPTS = '.js .jsx .mjs .cjs .ts .tsx .mts .cts';
const DATA = '.json .jsonc .css .graphql .gql';

/** A tool format-on-edit knows: its config list, its name, whether node_modules holds it, what it takes, its arguments. */
interface ToolSpec {
  readonly list: 'formatters' | 'linters';
  readonly name: string;
  readonly node: boolean;
  /** The extensions it takes, separated by spaces. */
  readonly takes: string;
  /** Its arguments before the file, separated by spaces. */
  readonly args: string;
}

// Formatters change the file in place and their output is dropped; eslint reports errors and fixes nothing, and ruff
// fixes what it fixes safely, then reports the rest. Formatters come first, prettier before biome. eslint's --quiet
// also drops the warning for an ignored file, which then exits 0 under flat config and eslintrc alike; eslintrc
// refuses --no-warn-ignored. prettier takes no Markdown: it would re-pad the kit's blocks in AGENTS.md and CLAUDE.md,
// which would then no longer match the lock and read as the user's edits.
const TOOLS: readonly ToolSpec[] = [
  {
    list: 'formatters',
    name: 'prettier',
    node: true,
    takes: `${SCRIPTS} ${DATA} .json5 .scss .less .html .vue .yaml .yml`,
    args: '--write --ignore-unknown --log-level warn',
  },
  { list: 'formatters', name: 'biome', node: true, takes: `${SCRIPTS} ${DATA}`, args: 'format --write' },
  { list: 'formatters', name: 'ruff', node: false, takes: '.py .pyi', args: 'format --force-exclude' },
  { list: 'linters', name: 'eslint', node: true, takes: SCRIPTS, args: '--quiet' },
  { list: 'linters', name: 'ruff', node: false, takes: '.py .pyi', args: 'check --fix --force-exclude' },
];

/** What the config asks format-on-edit to run: its `formatters`, `linters` and extra `commands`. */
export interface FormatSettings {
  readonly formatters: readonly string[];
  readonly linters: readonly string[];
  readonly commands: readonly (readonly string[])[];
}

/** One run on the edited file: a recorded tool or an extra command, looked up just before it runs. */
export interface Job {
  readonly list: 'formatters' | 'linters' | 'commands';
  /** The tool's name, or the command as written. */
  readonly name: string;
  readonly lookup: () => CommandLookup;
}

/** What the runs on an edited file came to: what the checks report, the runs skipped and why, and notes for stderr. */
export interface Results {
  /** Each failing check's name line, then its output lines, each quoted with `> `, or how it exited when it printed nothing. */
  readonly reports: string[];
  readonly skipped: { readonly job: Job; readonly why: string }[];
  readonly notes: string[];
}

function toolJob(spec: ToolSpec, projectDir: string): Job {
  const lookup = (): CommandLookup => {
    const found = spec.node ? nodeTool(projectDir, spec.name) : pythonTool(projectDir, spec.name);
    return 'tool' in found ? { tool: found.tool, args: spec.args.split(' ') } : found;
  };
  return { list: spec.list, name: spec.name, lookup };
}

/**
 * The runs for an edited file, in order: the recorded formatter that takes its extension (biome only where prettier
 * does not run), the recorded linters that take it, then each extra command.
 */
export function jobsFor(edited: EditedFile, settings: FormatSettings, projectDir: string): Job[] {
  const specs = TOOLS.filter(
    (spec) => settings[spec.list].includes(spec.name) && spec.takes.split(' ').includes(edited.extension),
  );
  const prettier = specs.some((spec) => spec.name === 'prettier');
  const tools = specs
    .filter((spec) => !prettier || spec.name !== 'biome')
    .map((spec) => toolJob(spec, projectDir));
  const commands = settings.commands.map((argv): Job => ({
    list: 'commands',
    name: argv.join(' '),
    lookup: () => commandTool(projectDir, argv),
  }));
  return [...tools, ...commands];
}

/** Where a batch of runs works: the edited file, the project folder, and the results it adds to. */
interface Batch {
  readonly edited: EditedFile;
  readonly projectDir: string;
  readonly results: Results;
}

// A formatter's failure is only noted. A linter reports what is left with exit 1, and any other failure means it
// could not lint; any failing command reports.
function runJob(job: Job, { edited, projectDir, results }: Batch, remainingMs: number): void {
  const found = job.lookup();
  if (!('tool' in found)) {
    results.skipped.push({ job, why: 'missing' in found ? `not found in ${found.missing}` : found.refused });
    return;
  }
  const options = { cwd: projectDir, timeoutMs: remainingMs };
  const run = runProjectTool(found.tool, [...found.args, edited.file], options);
  if (run.status === 0) return;
  const exited =
    run.status === null ? `${job.name} did not finish` : `${job.name} exited ${String(run.status)}`;
  if (run.status === null || job.list === 'formatters' || (job.list === 'linters' && run.status !== 1)) {
    results.notes.push(exited);
    return;
  }
  const output = toLf(`${run.stdout}\n${run.stderr}`)
    .replace(/^(?:[ \t]*\n)+/, '')
    .trimEnd();
  const printed = output === '' ? [exited] : output.split('\n').map((line) => `> ${line}`);
  results.reports.push(`${job.name}:`, ...printed);
}

/** Runs the jobs one after another on the edited file's real path, all within one budget of `budgetMs`. */
export function runJobs(
  jobs: readonly Job[],
  edited: EditedFile,
  projectDir: string,
  budgetMs: number,
): Results {
  const deadline = Date.now() + budgetMs;
  const batch: Batch = { edited, projectDir, results: { reports: [], skipped: [], notes: [] } };
  for (const job of jobs) {
    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) runJob(job, batch, remainingMs);
    else batch.results.notes.push(`${job.name} ran out of time`);
  }
  return batch.results;
}
