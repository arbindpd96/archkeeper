import type { Brand } from '../core/brand.js';
import { CONFIG_VERSION, type OptionValue, type ProjectConfig } from '../core/config-schema.js';
import { configPath, configSchemaUrl, parseConfig } from '../core/config.js';
import { ConfigError, type ProblemReport } from '../core/errors.js';
import { exactHash } from '../core/hash.js';
import { isRecord, parseJson } from '../core/json.js';
import type { Plan } from '../core/plan.js';
import type { Stack } from '../core/schema-parts.js';
import { readConfined } from './project-files.js';

const SOURCE = 'the project config';

/** A project config already on disk: its exact text, its object as written, its parsed value and warnings. */
export interface ExistingConfig {
  readonly text: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly config: ProjectConfig;
  readonly warnings: readonly ProblemReport[];
}

/**
 * What init settles for the config: the preset, the module changes, the stack when the user named one, module
 * option values init records, by module id, such as the tools format-on-edit runs, and the compose choice when the
 * user gave one in this run.
 */
export interface ConfigAnswers {
  readonly preset: string;
  readonly add: readonly string[];
  readonly remove: readonly string[];
  readonly stack?: readonly Stack[];
  readonly options?: Readonly<Record<string, Readonly<Record<string, OptionValue>>>>;
  readonly compose?: ProjectConfig['compose'];
}

/** The config init leaves: its text, whether that differs from the file on disk, its parsed value and warnings. */
export interface NextConfig {
  readonly text: string;
  readonly changed: boolean;
  readonly config: ProjectConfig;
  readonly warnings: readonly ProblemReport[];
}

/** Reads and validates `<state dir>/config.json` (ADR-0014), or returns undefined when there is none. */
export function readExistingConfig(rootReal: string, brand: Brand): ExistingConfig | undefined {
  const file = configPath(brand);
  const state = readConfined(rootReal, file, SOURCE);
  if (state === undefined) return undefined;
  if (state.kind !== 'file') {
    throw new ConfigError({
      file,
      location: '',
      problem: 'is not a regular text file, so the kit does not read it',
      hint: 'replace it with a regular file, or delete it to start from the defaults',
    });
  }
  const parsed = parseJson(state.content);
  const raw = parsed.ok && isRecord(parsed.value) ? parsed.value : {};
  return { text: state.content, raw, ...parseConfig(state.content, brand) };
}

function sameList(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameOptions(config: ProjectConfig, answers: ConfigAnswers): boolean {
  return Object.entries(answers.options ?? {}).every(([id, values]) =>
    Object.entries(values).every(
      ([name, value]) => JSON.stringify(config.options[id]?.[name]) === JSON.stringify(value),
    ),
  );
}

// A config without compose reads as no to both, so a no is on disk only where the config has the key.
function sameCompose(existing: ExistingConfig, answers: ConfigAnswers): boolean {
  if (answers.compose === undefined) return true;
  const { superpowers, specKit } = existing.config.compose;
  return (
    existing.raw.compose !== undefined &&
    superpowers === answers.compose.superpowers &&
    specKit === answers.compose.specKit
  );
}

function sameAnswers(existing: ExistingConfig, answers: ConfigAnswers): boolean {
  const { config } = existing;
  return (
    config.preset === answers.preset &&
    sameList(config.modules.add, answers.add) &&
    sameList(config.modules.remove, answers.remove) &&
    (answers.stack === undefined || sameList(config.stack, answers.stack)) &&
    sameOptions(config, answers) &&
    sameCompose(existing, answers)
  );
}

function modulesField(raw: Readonly<Record<string, unknown>>, answers: ConfigAnswers): object {
  if (raw.modules === undefined && answers.add.length === 0 && answers.remove.length === 0) return {};
  const modules = isRecord(raw.modules) ? raw.modules : {};
  return { modules: { ...modules, add: answers.add, remove: answers.remove } };
}

// The options init records join the config's own, so every key the user wrote stays, in its module and beside it.
function optionsField(raw: Readonly<Record<string, unknown>>, answers: ConfigAnswers): object {
  if (answers.options === undefined) return {};
  const options = isRecord(raw.options) ? raw.options : {};
  const recorded = Object.entries(answers.options).map(([id, values]) => {
    const own = options[id];
    return [id, { ...(isRecord(own) ? own : {}), ...values }] as const;
  });
  return { options: { ...options, ...Object.fromEntries(recorded) } };
}

function composeField(raw: Readonly<Record<string, unknown>>, answers: ConfigAnswers): object {
  if (answers.compose === undefined) return {};
  return { compose: { ...(isRecord(raw.compose) ? raw.compose : {}), ...answers.compose } };
}

/**
 * The config init writes (#27, ADR-0014): the existing file untouched when the answers match it, or its keys,
 * unknown ones included, with the preset, modules, named stack, recorded options and compose choice changed. A new
 * config starts with `$schema` (see `configSchemaUrl`) and `version`. `stack` is written only when the user named
 * one, so detection decides otherwise, and `compose` only when the user answered in this run.
 */
export function nextConfig(
  existing: ExistingConfig | undefined,
  answers: ConfigAnswers,
  version: string,
  brand: Brand,
): NextConfig {
  if (existing !== undefined && sameAnswers(existing, answers)) {
    return { text: existing.text, changed: false, config: existing.config, warnings: existing.warnings };
  }
  const raw = existing?.raw ?? { $schema: configSchemaUrl(version, brand), version: CONFIG_VERSION };
  const stack = answers.stack === undefined ? {} : { stack: answers.stack };
  const value = {
    ...raw,
    preset: answers.preset,
    ...modulesField(raw, answers),
    ...stack,
    ...optionsField(raw, answers),
    ...composeField(raw, answers),
  };
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return { text, changed: true, ...parseConfig(text, brand) };
}

/**
 * The plan with the config written in the same transaction when it changed (ADR-0014): backed up and rolled back
 * with every other file, and refused with them when the config on disk is no longer the one init read, so an
 * edit made while init waited for a yes never meets files planned from the older config.
 */
export function withConfig(
  plan: Plan,
  next: NextConfig,
  existing: ExistingConfig | undefined,
  brand: Brand,
): Plan {
  if (!next.changed) return plan;
  const file = configPath(brand);
  return {
    ...plan,
    writes: new Map(plan.writes).set(file, next.text),
    expected: new Map(plan.expected).set(file, existing === undefined ? null : exactHash(existing.text)),
  };
}
