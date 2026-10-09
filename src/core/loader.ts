import type * as z from 'zod/mini';
import { type Finding, ManifestError } from './errors.js';
import { checkSchema } from './issues.js';
import { parseJson } from './json.js';
import { manifestRuleFinding } from './manifest-rules.js';
import {
  type ModuleManifest,
  moduleManifestSchema,
  type PresetCatalog,
  presetCatalogSchema,
} from './manifest-schema.js';

/** Reads a kit file by its package-relative path with forward slashes; returns undefined when it does not exist. */
export type ReadKitFile = (path: string) => string | undefined;

/** A validated module with the text of every template and hook script its manifest references. */
export interface KitModule {
  readonly manifest: ModuleManifest;
  /** Package-relative path of the manifest, for messages. */
  readonly file: string;
  /** Template and hook-script text by package-relative path. */
  readonly sources: ReadonlyMap<string, string>;
}

/** A preset from `modules/presets.json`. */
export type Preset = PresetCatalog['presets'][number];

/** Everything the kit ships: its modules by id, in id order, and its presets in chain order. */
export interface Catalog {
  readonly modules: ReadonlyMap<string, KitModule>;
  readonly presets: readonly Preset[];
  readonly defaultPreset: string;
}

const MODULE_SCHEMA = 'schema/module.schema.json';
const PRESETS_FILE = 'modules/presets.json';
const PRESETS_SCHEMA = 'presetCatalogSchema in src/core/manifest-schema.ts';

/** The package-relative path of a module's manifest. */
export function manifestPath(id: string): string {
  return `modules/${id}/module.json`;
}

/** The package-relative path of a template that a module's manifest names relative to its `files/` folder. */
export function templatePath(id: string, template: string): string {
  return `modules/${id}/files/${template}`;
}

function fail(file: string, finding: Finding): never {
  throw new ManifestError({ file, ...finding });
}

function readJson(file: string, read: ReadKitFile): unknown {
  const text = read(file);
  if (text === undefined) fail(file, { location: '', problem: 'does not exist', hint: 'restore the file' });
  const parsed = parseJson(text);
  if (!parsed.ok) fail(file, parsed.finding);
  return parsed.value;
}

function validate<Schema extends z.ZodMiniType>(
  schema: Schema,
  value: unknown,
  file: string,
  schemaName: string,
): z.output<Schema> {
  const result = checkSchema(schema, value, schemaName);
  if (!result.ok) fail(file, result.finding);
  return result.data;
}

function referencedSources(manifest: ModuleManifest): { field: string; path: string }[] {
  const fromFiles = manifest.files.flatMap((entry, index) =>
    entry.from === undefined
      ? []
      : [{ field: `files[${String(index)}].from`, path: templatePath(manifest.id, entry.from) }],
  );
  const fromBlocks = manifest.blocks.map((entry, index) => ({
    field: `blocks[${String(index)}].template`,
    path: templatePath(manifest.id, entry.template),
  }));
  const scripts = manifest.hooks.map((entry, index) => ({
    field: `hooks[${String(index)}].script`,
    path: entry.script,
  }));
  return [...fromFiles, ...fromBlocks, ...scripts];
}

function readSources(manifest: ModuleManifest, file: string, read: ReadKitFile): ReadonlyMap<string, string> {
  const sources = new Map<string, string>();
  for (const { field, path } of referencedSources(manifest)) {
    const text = read(path);
    if (text === undefined) {
      fail(file, {
        location: field,
        problem: `names ${path}, which does not exist`,
        hint: 'add the file or fix the path',
      });
    }
    sources.set(path, text);
  }
  return sources;
}

/** Loads and validates `modules/<id>/module.json` and the files it references, throwing ManifestError on the first problem. */
export function loadModule(id: string, read: ReadKitFile): KitModule {
  const file = manifestPath(id);
  const manifest = validate(moduleManifestSchema, readJson(file, read), file, MODULE_SCHEMA);
  if (manifest.id !== id) {
    fail(file, {
      location: 'id',
      problem: `"${manifest.id}" differs from its folder "${id}"`,
      hint: `set id to "${id}"`,
    });
  }
  const broken = manifestRuleFinding(manifest);
  if (broken !== undefined) fail(file, broken);
  return { manifest, file, sources: readSources(manifest, file, read) };
}

function loadPresets(read: ReadKitFile): PresetCatalog {
  const catalog = validate(presetCatalogSchema, readJson(PRESETS_FILE, read), PRESETS_FILE, PRESETS_SCHEMA);
  const names = catalog.presets.map((preset) => preset.name);
  const repeated = names.findIndex((name, index) => names.indexOf(name) !== index);
  if (repeated !== -1) {
    fail(PRESETS_FILE, {
      location: `presets[${String(repeated)}].name`,
      problem: 'repeats a preset',
      hint: 'name each preset once',
    });
  }
  if (!names.includes(catalog.default)) {
    fail(PRESETS_FILE, {
      location: 'default',
      problem: `"${catalog.default}" is not a preset`,
      hint: `use one of ${names.join(', ')}`,
    });
  }
  return catalog;
}

// Presets form a chain (small ⊂ medium ⊂ full), so a module in one preset must be in every later one.
function presetFinding(manifest: ModuleManifest, chain: readonly string[]): Finding | undefined {
  const unknown = manifest.presets.findIndex((name) => !chain.includes(name));
  if (unknown !== -1) {
    return {
      location: `presets[${String(unknown)}]`,
      problem: 'is not a preset',
      hint: `use ${chain.join(', ')}`,
    };
  }
  const first = chain.findIndex((name) => manifest.presets.includes(name));
  const missing =
    first === -1 ? undefined : chain.slice(first).find((name) => !manifest.presets.includes(name));
  if (missing === undefined) return undefined;
  return {
    location: 'presets',
    problem: `lists "${chain[first] ?? ''}" but not "${missing}"`,
    hint: `add "${missing}": each preset contains the one before it (${chain.join(' ⊂ ')})`,
  };
}

/** Loads every module in `moduleIds` and `modules/presets.json`, checking each module's presets against the chain. */
export function loadCatalog(moduleIds: readonly string[], read: ReadKitFile): Catalog {
  const presets = loadPresets(read);
  const chain = presets.presets.map((preset) => preset.name);
  const modules = new Map<string, KitModule>();
  for (const id of [...moduleIds].sort()) {
    const kit = loadModule(id, read);
    const broken = presetFinding(kit.manifest, chain);
    if (broken !== undefined) fail(kit.file, broken);
    modules.set(id, kit);
  }
  return { modules, presets: presets.presets, defaultPreset: presets.default };
}
