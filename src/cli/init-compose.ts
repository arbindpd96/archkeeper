import type { ComposeCatalog, ComposeTool } from '../core/compose-schema.js';
import type { ProjectConfig } from '../core/config-schema.js';
import { UsageError } from '../core/errors.js';
import { quoted } from '../core/text.js';
import type { ExistingConfig } from './init-config.js';
import type { InitRun, Planned } from './init-run.js';
import type { Choice } from './prompts.js';

/** The tools to compose with, as the config's `compose` records them (ADR-0008). */
export type ComposeChoice = ProjectConfig['compose'];

type Answer = 'no' | 'superpowers' | 'speckit' | 'both';

const ANSWERS: Readonly<Record<Answer, ComposeChoice>> = {
  no: { superpowers: false, specKit: false },
  superpowers: { superpowers: true, specKit: false },
  speckit: { superpowers: false, specKit: true },
  both: { superpowers: true, specKit: true },
};
const TOOLS: readonly (keyof ComposeChoice)[] = ['superpowers', 'specKit'];
const QUESTION = 'Add Superpowers or Spec Kit? init only prints their install commands';

/** Reads `--with superpowers,speckit` (#39): either name or both, or undefined when the flag is absent. */
export function composeFlag(value: string | undefined): ComposeChoice | undefined {
  if (value === undefined) return undefined;
  const names = value.split(',').map((name) => name.trim());
  const unknown = names.find((name) => name !== 'superpowers' && name !== 'speckit');
  if (unknown !== undefined) {
    throw new UsageError({
      file: '--with',
      location: '',
      problem: `${quoted(unknown)} is not a tool init offers`,
      hint: 'pass --with superpowers, speckit or superpowers,speckit',
    });
  }
  return { superpowers: names.includes('superpowers'), specKit: names.includes('speckit') };
}

function choices({ superpowers, specKit }: ComposeCatalog): Choice<Answer>[] {
  return [
    { value: 'no', label: 'No' },
    { value: 'superpowers', label: superpowers.name, hint: superpowers.description },
    { value: 'speckit', label: specKit.name, hint: specKit.description },
    { value: 'both', label: 'Both' },
  ];
}

/**
 * The compose choice init records (#39, ADR-0008): `--with`'s, else, on a terminal while the config has no
 * `compose`, the answer to one select, defaulting to no. Undefined records nothing, so the config's choice stays and
 * `--yes` alone means no; null when the user cancels the question.
 */
export async function chooseCompose(
  run: InitRun,
  existing: ExistingConfig | undefined,
): Promise<ComposeChoice | undefined | null> {
  const flagged = composeFlag(run.flags.with);
  if (flagged !== undefined) return flagged;
  if (!run.asking.interactive || existing?.raw.compose !== undefined) return undefined;
  const answer = await run.asking.prompter.select(QUESTION, choices(run.session.catalog.compose), 'no');
  return answer === undefined ? null : ANSWERS[answer];
}

function toolSteps(tool: ComposeTool): string[] {
  return [
    `Add ${tool.name}: ${tool.commands.join(', then ')}`,
    ...(tool.warning === undefined ? [] : [tool.warning]),
  ];
}

/** The Next steps lines for each tool the config composes with: its exact commands, then its warning; none runs. */
export function composeSteps(planned: Planned, compose: ComposeCatalog): string[] {
  const chosen = planned.next.config.compose;
  return TOOLS.filter((tool) => chosen[tool]).flatMap((tool) => toolSteps(compose[tool]));
}
