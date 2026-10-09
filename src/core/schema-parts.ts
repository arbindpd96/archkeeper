import * as z from 'zod/mini';
import { relativePathProblem, RELATIVE_PATH_HINT, TARGET_PATH_HINT } from './paths.js';

/** Stacks a module or the project config can name (ADR-0006). */
export const STACKS = ['ts', 'python'] as const;

/** A stack name from {@link STACKS}. */
export type Stack = (typeof STACKS)[number];

/** The form of a module, preset or block id: kebab-case, so it is safe in paths, markers and messages. */
export const KEBAB_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A module, preset or block id in {@link KEBAB_ID} form. */
export const kebabId = z
  .string()
  .check(z.regex(KEBAB_ID, { error: 'use kebab-case: lowercase letters, digits, single hyphens' }));

/** A module option name, in camelCase with dots between groups, such as `checks.stop`. */
export const optionName = z
  .string()
  .check(
    z.regex(/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/, { error: 'use camelCase words joined by dots' }),
  );

/** One line of text, such as a description. */
export const oneLine = z
  .string()
  .check(z.regex(/^\S[^\r\n]*$/, { error: 'write one line that does not start with a space' }));

/** Why a value is refused, and the fix. */
export interface Refusal {
  readonly problem: string;
  readonly hint: string;
}

/** A check that refuses a string with the problem and fix `refuse` returns; the message never shows the string. */
export function refusing(refuse: (value: string) => Refusal | undefined): z.core.$ZodCheck<string> {
  return z.superRefine((value: string, context) => {
    const refusal = refuse(value);
    if (refusal === undefined) return;
    const { problem, hint } = refusal;
    context.addIssue({ code: 'custom', input: value, message: hint, params: { problem } });
  });
}

/** A relative path with forward slashes that stays inside its root (see `relativePathProblem`). */
export const relativePath = z.string().check(
  refusing((value) => {
    const problem = relativePathProblem(value);
    return problem === undefined ? undefined : { problem, hint: RELATIVE_PATH_HINT };
  }),
);

/**
 * A project path a module writes: a {@link relativePath} of portable names (see `targetPathProblem`), with
 * `{{name}}` variables that render to such names.
 */
export const targetPath = relativePath.check(
  z.regex(/^(?:[\w. /-]|\{\{[^{}]*\}\})*$/, { error: TARGET_PATH_HINT }),
);

/** A copy of `schema` with a description that the generated JSON Schema shows in editors. */
export function described<Schema extends z.ZodMiniType>(schema: Schema, description: string): Schema {
  // Metadata belongs to a schema instance, so describing a shared one would describe every use of it.
  const copy = schema.clone();
  z.globalRegistry.add(copy, { description });
  return copy;
}

/** A list that defaults to empty when the key is left out. */
export function listOf<Item extends z.ZodMiniType>(
  item: Item,
  description: string,
): z.ZodMiniDefault<z.ZodMiniArray<Item>> {
  return described(z._default(z.array(item), []), description);
}
