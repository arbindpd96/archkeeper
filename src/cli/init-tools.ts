import type { ProblemReport } from '../core/errors.js';
import { detectedTools, formatTools } from '../core/format-tools.js';
import { resolveOptions, type ResolvedOptions } from '../core/options.js';
import { type Resolution, resolveModules } from '../core/resolve.js';
import type { Stack } from '../core/schema-parts.js';
import type { StackProfile } from '../core/stack-profile.js';
import { chooseCompose } from './init-compose.js';
import { type ConfigAnswers, type ExistingConfig, nextConfig, type NextConfig } from './init-config.js';
import type { InitRun } from './init-run.js';
import { stopCheckOptions } from './init-stop-check.js';

const FORMAT_ON_EDIT = 'format-on-edit';

/** What init settles before it renders: the config it leaves, the stack in effect, its tools, the options and modules. */
export interface Settled {
  readonly next: NextConfig;
  readonly stack: readonly Stack[];
  /** The detected tools of the stacks in effect, which a module's or a file's `when.tools` reads. */
  readonly tools: readonly string[];
  readonly options: ResolvedOptions;
  readonly resolution: Resolution;
  /** The config's warnings, then those of its options. */
  readonly warnings: readonly ProblemReport[];
}

function settle(
  run: InitRun,
  profile: StackProfile,
  existing: ExistingConfig | undefined,
  answers: ConfigAnswers,
): Settled {
  const { catalog } = run.session;
  const next = nextConfig(existing, answers, run.kit.version, run.brand);
  const stack = next.config.stack ?? profile.stack;
  const tools = detectedTools(profile, stack);
  const { options, warnings } = resolveOptions(next.config, catalog, run.brand);
  const { add, remove } = next.config.modules;
  const request = { preset: answers.preset, stack, add, remove, options, tools };
  const resolution = resolveModules(request, catalog, run.brand);
  return { next, stack, tools, options, resolution, warnings: [...next.warnings, ...warnings] };
}

// format-on-edit runs only what the config records, so init records the detected tools once, while the config sets
// neither list: a value the config has, even an empty list, is the user's and stays as it is.
function recordedTools(settled: Settled, profile: StackProfile): ConfigAnswers['options'] {
  const selected = settled.resolution.modules.some((kit) => kit.manifest.id === FORMAT_ON_EDIT);
  const own = settled.next.config.options[FORMAT_ON_EDIT] ?? {};
  if (!selected || Object.hasOwn(own, 'formatters') || Object.hasOwn(own, 'linters')) return undefined;
  const { formatters, linters } = formatTools(profile, settled.stack);
  return { [FORMAT_ON_EDIT]: { formatters: [...formatters], linters: [...linters] } };
}

/**
 * Settles the config init leaves and the modules it installs (#27, #37, #38, #39): the compose choice, as
 * `chooseCompose` gives it right after the preset, the stack in effect, the tools detection found for it, the
 * config's options over each module's defaults, and the modules the resolver keeps and leaves out. When
 * format-on-edit is selected and the config sets neither of its tool lists, the config records the tools it runs for
 * the stacks in effect; the stop check's command is recorded as `stopCheckOptions` says. Both of those may ask;
 * undefined when the user cancels a question.
 */
export async function settleModules(
  run: InitRun,
  profile: StackProfile,
  existing: ExistingConfig | undefined,
  answers: ConfigAnswers,
): Promise<Settled | undefined> {
  const compose = await chooseCompose(run, existing);
  if (compose === null) return undefined;
  const answered = compose === undefined ? answers : { ...answers, compose };
  const settled = settle(run, profile, existing, answered);
  const stopCheck = await stopCheckOptions(run, settled, profile);
  if (stopCheck === null) return undefined;
  const options = { ...recordedTools(settled, profile), ...stopCheck };
  if (Object.keys(options).length === 0) return settled;
  return settle(run, profile, existing, { ...answered, options: { ...answered.options, ...options } });
}
