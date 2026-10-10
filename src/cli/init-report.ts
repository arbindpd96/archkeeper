import type { Brand } from '../core/brand.js';
import type { OpKind } from '../core/plan-types.js';
import type { PathSummary, PlanGroup } from '../core/plan-summary.js';
import type { Language, StackProfile } from '../core/stack-profile.js';
import { escapeUnprintable } from '../core/text.js';
import { type CliOutput, type StyleFormat, styled } from './output.js';

/** What init prints: lines on stdout unless --json is set, warnings on stderr always. */
export interface Reporter {
  readonly say: (text?: string) => void;
  readonly warn: (text: string) => void;
  readonly paint: (format: StyleFormat, text: string) => string;
}

/** A reporter over `output`; with `json` set, only warnings and the final JSON reach the terminal. */
export function reporterFor(output: CliOutput, json: boolean): Reporter {
  return {
    say: (text = '') => {
      if (!json) output.stdout(`${text}\n`);
    },
    warn: (text) => {
      output.stderr(`${styled(output, 'yellow', 'Warning:', 'stderr')} ${escapeUnprintable(text)}\n`);
    },
    paint: (format, text) => styled(output, format, text),
  };
}

const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
};

function toolLine(profile: StackProfile): string[] {
  const { formatters, linters, typeCheckers, testRunners } = profile.tools;
  const jobs: [string, readonly string[]][] = [
    ['format', formatters],
    ['lint', linters],
    ['types', typeCheckers],
    ['tests', testRunners],
  ];
  const found = jobs
    .filter(([, tools]) => tools.length > 0)
    .map(([job, tools]) => `${job}: ${tools.join(', ')}`);
  return found.length === 0 ? [] : [`  ${found.join('; ')}`];
}

function extrasLine(profile: StackProfile): string[] {
  const { claudeMd, agentsMd, settings, hooks, skills } = profile.claude;
  const setup = [
    ...(claudeMd ? ['CLAUDE.md'] : []),
    ...(agentsMd ? ['AGENTS.md'] : []),
    ...(settings ? ['.claude/settings.json'] : []),
    ...(hooks ? ['.claude/hooks'] : []),
    ...(skills ? ['.claude/skills'] : []),
  ];
  const extras = [
    ...(profile.frameworks.length > 0 ? [`frameworks: ${profile.frameworks.join(', ')}`] : []),
    ...(profile.monorepo ? ['a monorepo root'] : []),
    ...(setup.length > 0 ? [`already has ${setup.join(', ')}`] : []),
  ];
  return extras.length === 0 ? [] : [`  ${extras.join('; ')}`];
}

/** The detected stack in a few lines, the first step of init (#27). */
export function detectedLines(profile: StackProfile): string[] {
  const languages = profile.languages.map((language) => LANGUAGE_NAMES[language]).join(' and ');
  const managers = [profile.packageManager, profile.pythonManager].filter((name) => name !== null);
  const found = languages === '' ? 'no TS/JS or Python project files' : languages;
  const using = managers.length === 0 ? '' : ` (${managers.join(', ')})`;
  return [`Detected: ${found}${using}`, ...toolLine(profile), ...extrasLine(profile)];
}

const GROUP_STYLE: Readonly<Record<PlanGroup, StyleFormat>> = {
  create: 'green',
  modify: 'yellow',
  conflict: 'red',
  skip: 'dim',
};

const OP_WORDS: Readonly<Record<OpKind, string>> = {
  create: 'write',
  insertBlock: 'add block',
  replaceBlock: 'update block',
  mergeJson: 'add',
  sidecar: 'sidecar',
  adopt: 'adopt',
  skip: 'keep',
  delete: 'remove',
  respectRemoval: 'keep removed',
};

function detail(summary: PathSummary): string {
  if (summary.group === 'conflict') {
    const sidecar = summary.ops.find((op) => op.kind === 'sidecar');
    return sidecar === undefined ? '' : `: ${sidecar.reason}`;
  }
  if (summary.group !== 'modify') return '';
  const changes = summary.ops.filter((op) => !['skip', 'adopt'].includes(op.kind));
  const words = changes.map((op) => `${OP_WORDS[op.kind]}${op.entry === undefined ? '' : ` ${op.entry}`}`);
  return words.length === 0 ? '' : ` (${words.join(', ')})`;
}

/** The plan grouped as create, modify, conflict and skip (#27); every path, entry and reason escaped. */
export function planLines(summaries: readonly PathSummary[], paint: Reporter['paint']): string[] {
  if (summaries.length === 0) return ['  nothing to plan'];
  return summaries.map((summary) => {
    const label = paint(GROUP_STYLE[summary.group], summary.group.padEnd(8));
    return `  ${label}  ${escapeUnprintable(`${summary.path}${detail(summary)}`)}`;
  });
}

const DIFF_STYLE: readonly [prefix: string, format: StyleFormat][] = [
  ['+++', 'bold'],
  ['---', 'bold'],
  ['@@', 'cyan'],
  ['+', 'green'],
  ['-', 'red'],
];

/** A unified diff for the terminal: each line escaped and coloured by its kind. */
export function diffLines(diff: string, paint: Reporter['paint']): string[] {
  return diff
    .trimEnd()
    .split('\n')
    .map((line) => {
      const format = DIFF_STYLE.find(([prefix]) => line.startsWith(prefix))?.[1];
      const text = escapeUnprintable(line);
      return format === undefined ? text : paint(format, text);
    });
}

/** What to do once init has applied its plan (#27): restart Claude Code, then start a feature. */
export function nextStepLines(sidecars: readonly string[], brand: Brand): string[] {
  const review =
    sidecars.length === 0
      ? []
      : [
          `  Review each sidecar (${sidecars.map(escapeUnprintable).join(', ')}), take what you want into the file, delete the sidecar,`,
          `  and commit it together with ${brand.stateDir}/lock.json.`,
        ];
  return [
    'Next steps:',
    ...review,
    '  1. Restart Claude Code so it loads the new instructions, settings and hooks.',
    '  2. In Claude Code, run /new-feature <name> to start your first feature.',
  ];
}
