import * as z from 'zod/mini';
import type { composeShape } from './config-schema.js';
import { kebabId, oneLine } from './schema-parts.js';

const date = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'write the date as YYYY-MM-DD' }));
const version = z
  .string()
  .check(z.regex(/^\d+\.\d+\.\d+$/, { error: 'write the version as major.minor.patch, such as 1.2.1' }));
const repository = z
  .string()
  .check(z.regex(/^[\w.-]+\/[\w.-]+$/, { error: 'write the GitHub repository as owner/name' }));
const skillPrefix = z.string().check(
  z.regex(/^[a-z][a-z0-9]*[.-]$/, {
    error: 'write a prefix of lowercase letters and digits ending in . or -, such as speckit-',
  }),
);

const tool = z.strictObject({
  name: oneLine,
  repository,
  description: oneLine,
  knownGood: z.strictObject({ version, released: date }),
  commands: z.array(oneLine).check(z.minLength(1)),
  warning: z.optional(oneLine),
  skills: z.array(kebabId),
  skillPrefixes: z.array(skillPrefix),
});

const tools: Record<keyof typeof composeShape, typeof tool> = { superpowers: tool, specKit: tool };

/**
 * The contract of `modules/compose.json` (ADR-0008): for each tool the config's `compose` names, the version known
 * to work, the exact commands init prints (it runs none), and the skill names and prefixes the kit's skills avoid.
 */
export const composeCatalogSchema = z.strictObject({ checked: date, checkedWith: oneLine, ...tools });

/** A validated `modules/compose.json`. */
export type ComposeCatalog = z.output<typeof composeCatalogSchema>;

/** One tool of `modules/compose.json`, such as Spec Kit. */
export type ComposeTool = ComposeCatalog['superpowers'];
