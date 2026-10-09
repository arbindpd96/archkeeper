import { BRAND, type Brand } from './brand.js';
import { configPath } from './config.js';
import type { OptionValue, ProjectConfig } from './config-schema.js';
import { ConfigError, type ProblemReport } from './errors.js';
import { jsonPath } from './issues.js';
import type { Catalog } from './loader.js';
import type { ModuleManifest, OptionSpec } from './manifest-schema.js';

/** One module's option values, defaults included. */
export type ModuleOptions = Readonly<Record<string, OptionValue>>;

/** Every catalog module's option values by module id. */
export type ResolvedOptions = ReadonlyMap<string, ModuleOptions>;

/** The defaults a module's manifest declares for its options. */
export function optionDefaults(manifest: ModuleManifest): ModuleOptions {
  return Object.fromEntries(Object.entries(manifest.options).map(([name, spec]) => [name, spec.default]));
}

function matchesType(spec: OptionSpec, value: OptionValue): boolean {
  if (spec.type === 'string-list') return Array.isArray(value);
  return typeof value === spec.type;
}

const EXPECTED = { boolean: 'true or false', string: 'a string', 'string-list': 'a list of strings' };

function typeHint(name: string, spec: OptionSpec): string {
  return `set ${name} to ${EXPECTED[spec.type]} (default ${JSON.stringify(spec.default)}): ${spec.description}`;
}

function warning(file: string, path: readonly string[], problem: string, hint: string): ProblemReport {
  return { file, location: jsonPath(['options', ...path]), problem, hint };
}

function moduleValues(
  manifest: ModuleManifest,
  given: Readonly<Record<string, OptionValue>>,
  file: string,
  warnings: ProblemReport[],
): ModuleOptions {
  const values: Record<string, OptionValue> = { ...optionDefaults(manifest) };
  for (const [name, value] of Object.entries(given)) {
    const spec = manifest.options[name];
    if (spec === undefined) {
      const known = Object.keys(manifest.options).join(', ') || 'none';
      warnings.push(
        warning(
          file,
          [manifest.id, name],
          'is not an option of this module, so it is ignored',
          `use one of: ${known}`,
        ),
      );
      continue;
    }
    if (!matchesType(spec, value)) {
      const location = jsonPath(['options', manifest.id, name]);
      throw new ConfigError({
        file,
        location,
        problem: `must be ${EXPECTED[spec.type]}`,
        hint: typeHint(name, spec),
      });
    }
    values[name] = value;
  }
  return values;
}

/**
 * Merges the config's `options` over each catalog module's defaults (#19). A value of the wrong type throws
 * ConfigError with the option's description; options for unknown modules or options are warnings.
 */
export function resolveOptions(
  config: ProjectConfig,
  catalog: Catalog,
  brand: Brand = BRAND,
): { readonly options: ResolvedOptions; readonly warnings: readonly ProblemReport[] } {
  const file = configPath(brand);
  const warnings: ProblemReport[] = [];
  const known = [...catalog.modules.keys()];
  for (const id of Object.keys(config.options).filter((candidate) => !catalog.modules.has(candidate))) {
    warnings.push(
      warning(file, [id], 'is not a module, so its options are ignored', `use one of: ${known.join(', ')}`),
    );
  }
  const options = new Map<string, ModuleOptions>();
  for (const [id, kit] of catalog.modules) {
    options.set(id, moduleValues(kit.manifest, config.options[id] ?? {}, file, warnings));
  }
  return { options, warnings };
}
