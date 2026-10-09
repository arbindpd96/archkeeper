import { BRAND, type Brand } from './brand.js';
import {
  composeShape,
  CONFIG_VERSION,
  configSchema,
  modulesShape,
  type ProjectConfig,
} from './config-schema.js';
import { ConfigError, type ProblemReport } from './errors.js';
import { checkSchema, jsonPath } from './issues.js';
import { parseJson } from './json.js';

const CONFIG_SCHEMA = 'schema/config.schema.json';

/** A project config together with the warnings about keys the kit does not know. */
export interface ParsedConfig {
  readonly config: ProjectConfig;
  readonly warnings: readonly ProblemReport[];
}

/** The project-relative path of the config file. */
export function configPath(brand: Brand = BRAND): string {
  return `${brand.stateDir}/config.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeys(value: unknown, known: readonly string[], path: readonly string[]): string[] {
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => jsonPath([...path, key]));
}

function unknownKeyWarnings(raw: Record<string, unknown>, file: string): ProblemReport[] {
  const locations = [
    ...unknownKeys(raw, Object.keys(configSchema.shape), []),
    ...unknownKeys(raw.modules, Object.keys(modulesShape), ['modules']),
    ...unknownKeys(raw.compose, Object.keys(composeShape), ['compose']),
  ];
  return locations.map((location) => ({
    file,
    location,
    problem: 'is not a known key, so it is ignored',
    hint: `remove it, or check its spelling against ${CONFIG_SCHEMA}`,
  }));
}

function refuseNewerVersion(raw: Record<string, unknown>, file: string, brand: Brand): void {
  const { version } = raw;
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= CONFIG_VERSION) return;
  throw new ConfigError({
    file,
    location: 'version',
    problem: `${String(version)} is newer than this ${brand.displayName} understands (${String(CONFIG_VERSION)})`,
    hint: `upgrade ${brand.displayName} (npx ${brand.npmName}@latest) and run it again`,
  });
}

/**
 * Parses and validates the project config (#19, ADR-0014). Invalid JSON, an invalid value or a config written
 * by a newer kit throws ConfigError with the fix; unknown keys are returned as warnings.
 */
export function parseConfig(text: string, brand: Brand = BRAND): ParsedConfig {
  const file = configPath(brand);
  const parsed = parseJson(text);
  if (!parsed.ok) throw new ConfigError({ file, ...parsed.finding });
  if (!isRecord(parsed.value)) {
    throw new ConfigError({
      file,
      location: '',
      problem: 'must be a JSON object',
      hint: `see ${CONFIG_SCHEMA}`,
    });
  }
  refuseNewerVersion(parsed.value, file, brand);
  const checked = checkSchema(configSchema, parsed.value, CONFIG_SCHEMA);
  if (!checked.ok) throw new ConfigError({ file, ...checked.finding });
  return { config: checked.data, warnings: unknownKeyWarnings(parsed.value, file) };
}
