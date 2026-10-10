import path from 'node:path';
import type { Brand } from '../core/brand.js';
import { CONFIG_VERSION, type ProjectConfig } from '../core/config-schema.js';
import { configPath, configSchemaUrl, parseConfig } from '../core/config.js';
import { ApplyError, ConfigError, type ProblemReport } from '../core/errors.js';
import { isRecord, parseJson } from '../core/json.js';
import type { Stack } from '../core/schema-parts.js';
import { ensureFolder, writeAtomically } from './atomic-files.js';
import { confinedPath, readConfined } from './project-files.js';

const SOURCE = 'the project config';

/** A project config already on disk: its exact text, its object as written, its parsed value and warnings. */
export interface ExistingConfig {
  readonly text: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly config: ProjectConfig;
  readonly warnings: readonly ProblemReport[];
}

/** What init settles for the config: the preset, the module changes, and the stack when the user named one. */
export interface ConfigAnswers {
  readonly preset: string;
  readonly add: readonly string[];
  readonly remove: readonly string[];
  readonly stack?: readonly Stack[];
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

function sameAnswers(config: ProjectConfig, answers: ConfigAnswers): boolean {
  return (
    config.preset === answers.preset &&
    sameList(config.modules.add, answers.add) &&
    sameList(config.modules.remove, answers.remove) &&
    (answers.stack === undefined || sameList(config.stack, answers.stack))
  );
}

function modulesField(raw: Readonly<Record<string, unknown>>, answers: ConfigAnswers): object {
  if (raw.modules === undefined && answers.add.length === 0 && answers.remove.length === 0) return {};
  const modules = isRecord(raw.modules) ? raw.modules : {};
  return { modules: { ...modules, add: answers.add, remove: answers.remove } };
}

/**
 * The config init writes (#27, ADR-0014): the existing file untouched when the answers match it, or its keys,
 * unknown ones included, with the preset, modules and named stack changed. A new config starts with `$schema`
 * (see `configSchemaUrl`) and `version`. `stack` is written only when the user named one, so detection decides
 * otherwise.
 */
export function nextConfig(
  existing: ExistingConfig | undefined,
  answers: ConfigAnswers,
  version: string,
  brand: Brand,
): NextConfig {
  if (existing !== undefined && sameAnswers(existing.config, answers)) {
    return { text: existing.text, changed: false, config: existing.config, warnings: existing.warnings };
  }
  const raw = existing?.raw ?? { $schema: configSchemaUrl(version, brand), version: CONFIG_VERSION };
  const stack = answers.stack === undefined ? {} : { stack: answers.stack };
  const value = { ...raw, preset: answers.preset, ...modulesField(raw, answers), ...stack };
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return { text, changed: true, ...parseConfig(text, brand) };
}

/**
 * Writes the config when it changed, atomically and inside the project, refusing when the file on disk is no
 * longer the one init read, so an edit made while init waited for a yes is never overwritten.
 */
export function writeConfig(
  rootReal: string,
  next: NextConfig,
  existing: ExistingConfig | undefined,
  brand: Brand,
): void {
  if (!next.changed) return;
  const file = configPath(brand);
  const now = readConfined(rootReal, file, SOURCE);
  if ((now?.kind === 'file' ? now.content : now?.kind) !== existing?.text) {
    throw new ApplyError({
      file,
      location: '',
      problem: 'changed while init was running, so init left it as it is',
      hint: 'run init again to plan with the config as it is now',
    });
  }
  const absolute = confinedPath(rootReal, file, SOURCE);
  ensureFolder(path.dirname(absolute), []);
  writeAtomically(absolute, next.text);
}
