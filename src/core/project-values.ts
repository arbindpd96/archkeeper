import type { Stack } from './schema-parts.js';
import type { CommandPurpose, StackProfile } from './stack-profile.js';
import type { TemplateScope } from './template.js';

const PURPOSE_TEXT: Readonly<Record<CommandPurpose, string>> = {
  build: 'Build',
  test: 'Run the tests',
  lint: 'Lint',
  format: 'Format',
  typecheck: 'Check types',
};
const NO_COMMANDS =
  'No build, test or lint commands were detected. Check the README, or ask before running anything.';
const NONE_FOR_STACKS =
  'No build, test or lint commands were detected for the stacks this setup covers. Check the README, or ask ' +
  'before running anything.';
// A backtick would close the code span a command sits in, and a bar would split its table row.
const BREAKS_MARKDOWN = /[`|]/;

function commandRows(profile: StackProfile, stack: readonly Stack[]): string[] {
  const commands = profile.commands.filter(
    (command) => stack.includes(command.stack) && !BREAKS_MARKDOWN.test(command.command),
  );
  if (commands.length === 0) return [profile.commands.length === 0 ? NO_COMMANDS : NONE_FOR_STACKS];
  const rows = commands.map((command) => `| \`${command.command}\` | ${PURPOSE_TEXT[command.purpose]} |`);
  return ['| Command | What it does |', '| --- | --- |', ...rows];
}

function docLines(profile: StackProfile): string[] {
  const docs = profile.docs.filter((doc) => !BREAKS_MARKDOWN.test(doc));
  return docs.length === 0 ? [] : ['', '## Project docs', '', ...docs.map((doc) => `- \`${doc}\``)];
}

/**
 * The template values detection gives the modules (#28): `project.reference` is the Commands section of AGENTS.md,
 * a table of the commands of the stacks in effect, followed by the project docs that exist. Commands and doc names
 * sit in code spans, where Claude Code reads no `@` import (reference §2.1), and are one line each.
 */
export function projectValues(profile: StackProfile, stack: readonly Stack[]): TemplateScope {
  return {
    project: { reference: ['## Commands', '', ...commandRows(profile, stack), ...docLines(profile)] },
  };
}
