import * as z from 'zod/mini';
import { described, KEBAB_ID, kebabId, listOf, optionName, STACKS } from './schema-parts.js';

/** The config format this kit writes and reads (ADR-0014); a config without `version` is version 1. */
export const CONFIG_VERSION = 1;

/** The keys of `modules`, which adjust the preset. */
export const modulesShape = {
  add: listOf(kebabId, 'Modules to enable on top of the preset.'),
  remove: listOf(kebabId, 'Modules of the preset to leave out.'),
};

/** The keys of `compose`: the tools init offers to compose with (ADR-0008). */
export const composeShape = {
  superpowers: described(
    z._default(z.boolean(), false),
    'Whether to use obra/superpowers alongside the kit.',
  ),
  specKit: described(z._default(z.boolean(), false), 'Whether to use github/spec-kit alongside the kit.'),
};

const optionValue = z.union([z.boolean(), z.string(), z.array(z.string())], {
  error: "set it to true or false, a string, or a list of strings, as the module's option declares",
});
const PRESET_HINT = 'set preset to the preset to install, such as small, medium or full';

/**
 * The contract of the project config (ADR-0014): user intent only, which `update` renders from. Objects are
 * not strict, so an unknown key is a warning rather than an error (#19).
 */
export const configSchema = z
  .object({
    $schema: described(z.optional(z.string()), 'The JSON Schema for this file, for editors.'),
    version: described(
      z.optional(z.literal(CONFIG_VERSION, { error: `set version to ${String(CONFIG_VERSION)}` })),
      'The config format version.',
    ),
    preset: described(
      z.string({ error: PRESET_HINT }).check(z.regex(KEBAB_ID, { error: PRESET_HINT })),
      'The preset.',
    ),
    modules: described(
      z._default(z.object(modulesShape), { add: [], remove: [] }),
      'Modules to add to or remove from the preset.',
    ),
    stack: described(
      z.optional(z.array(z.enum(STACKS))),
      'The project stack, overriding detection; an empty list means none.',
    ),
    options: described(
      z._default(z.record(kebabId, z.record(optionName, optionValue)), {}),
      'Module options by module id; each module declares its options and their defaults.',
    ),
    compose: described(
      z._default(z.object(composeShape), { superpowers: false, specKit: false }),
      'Tools init offered to compose with (ADR-0008); v0.1 prints their install commands only.',
    ),
  })
  .register(z.globalRegistry, {
    title: 'Project config',
    description: 'The project config: which preset and modules to install, and their options (ADR-0014).',
  });

/** A validated project config, with every default filled in. */
export type ProjectConfig = z.output<typeof configSchema>;

/** A module option value in the project config. */
export type OptionValue = z.output<typeof optionValue>;
