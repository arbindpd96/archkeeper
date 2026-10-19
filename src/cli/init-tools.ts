import type { ProblemReport } from '../core/errors.js';
import { formatTools } from '../core/format-tools.js';
import { resolveOptions, type ResolvedOptions } from '../core/options.js';
import { type Resolution, resolveModules } from '../core/resolve.js';
import type { Stack } from '../core/schema-parts.js';
import type { StackProfile } from '../core/stack-profile.js';
import { type ConfigAnswers, type ExistingConfig, nextConfig, type NextConfig } from './init-config.js';
import type { InitRun } from './init-run.js';

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

/**
 * Settles the config init leaves and the modules it installs (#27, #37): the stack in effect, the tools detection
 * found for it, the config's options over each module's defaults, and the modules the resolver keeps and leaves out.
 */
export function settleModules(
  run: InitRun,
  profile: StackProfile,
  existing: ExistingConfig | undefined,
  answers: ConfigAnswers,
): Settled {
  const { catalog } = run.session;
  const next = nextConfig(existing, answers, run.kit.version, run.brand);
  const stack = next.config.stack ?? profile.stack;
  const tools = formatTools(profile, stack).detected;
  const { options, warnings } = resolveOptions(next.config, catalog, run.brand);
  const { add, remove } = next.config.modules;
  const request = { preset: answers.preset, stack, add, remove, options, tools };
  const resolution = resolveModules(request, catalog, run.brand);
  return { next, stack, tools, options, resolution, warnings: [...next.warnings, ...warnings] };
}
