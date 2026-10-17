import { BRAND, type Brand } from '../../core/brand.js';
import { BYTE_ORDER_MARK, isRecord } from '../../core/text.js';
import { readProjectFile } from './project.js';

const MAX_CONFIG_BYTES = 256_000;

const withoutByteOrderMark = (text: string): string =>
  text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;

/** A module's options as the project config gives them, or why they could not be read. */
export type ModuleOptions =
  { readonly values: Readonly<Record<string, unknown>> } | { readonly problem: string };

/** The project config's path, as hooks name it in their reasons. */
export function configFile(brand: Brand = BRAND): string {
  return `${brand.stateDir}/config.json`;
}

type ConfigRead = { readonly config: unknown } | { readonly missing: true } | { readonly problem: string };

function readConfig(projectDir: string, brand: Brand): ConfigRead {
  const read = readProjectFile(projectDir, configFile(brand), MAX_CONFIG_BYTES);
  if (!('text' in read)) return read;
  try {
    return { config: JSON.parse(withoutByteOrderMark(read.text)) };
  } catch {
    return { problem: 'it is not valid JSON' };
  }
}

/** The project config's `preset`, or undefined when the config is missing, unreadable or names no preset. */
export function configPreset(projectDir: string, brand: Brand = BRAND): string | undefined {
  const read = readConfig(projectDir, brand);
  const preset = 'config' in read && isRecord(read.config) ? read.config.preset : undefined;
  return typeof preset === 'string' ? preset : undefined;
}

/**
 * Reads one module's `options` from the project config (ADR-0014), the user's reviewed record of intent. A
 * missing config or entry gives no values; a config that is a symlink, outside the project, too large or not
 * JSON gives the problem, so a hook can meet its failure policy instead of silently dropping an option.
 */
export function readModuleOptions(projectDir: string, moduleId: string, brand: Brand = BRAND): ModuleOptions {
  const read = readConfig(projectDir, brand);
  if ('missing' in read) return { values: {} };
  if ('problem' in read) return { problem: read.problem };
  const config = read.config;
  const options = isRecord(config) ? config.options : undefined;
  if (options === undefined) return { values: {} };
  const values = isRecord(options) ? options[moduleId] : undefined;
  if (values === undefined) return { values: {} };
  return isRecord(values) ? { values } : { problem: `options.${moduleId} is not an object` };
}

/** A boolean option's value, the fallback when it is unset, or undefined when it is not a boolean. */
export function booleanOption(
  values: Readonly<Record<string, unknown>>,
  name: string,
  fallback: boolean,
): boolean | undefined {
  const value = values[name];
  if (value === undefined) return fallback;
  return typeof value === 'boolean' ? value : undefined;
}

/** A string-list option's value, `[]` when it is unset, or undefined when it is not a list of strings. */
export function stringListOption(
  values: Readonly<Record<string, unknown>>,
  name: string,
): string[] | undefined {
  const value = values[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  return value.every((item): item is string => typeof item === 'string') ? value : undefined;
}
