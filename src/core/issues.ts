import * as z from 'zod/mini';
import type { Finding } from './errors.js';

type Issue = z.core.$ZodIssue;
type Described = Omit<Finding, 'location'> & { readonly location?: string };

// zod's message when a schema sets no error of its own; schemas in src/core set their fix as the message.
const DEFAULT_MESSAGE = 'Invalid input';
const PLAIN_KEY = /^[A-Za-z_$][\w$-]*$/;
const MAX_SHOWN = 60;

/** Formats a path such as `['hooks', 0, 'event']` as `hooks[0].event`, quoting keys that are not plain words. */
export function jsonPath(path: readonly PropertyKey[]): string {
  return path
    .map((key, index) => {
      if (typeof key === 'number') return `[${String(key)}]`;
      const name = String(key);
      if (!PLAIN_KEY.test(name)) return `[${JSON.stringify(name)}]`;
      return index === 0 ? name : `.${name}`;
    })
    .join('');
}

function show(value: unknown): string {
  if (value === undefined) return 'nothing';
  const text = JSON.stringify(value);
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN - 1)}…` : text;
}

function oneOf(values: readonly unknown[]): string {
  return `one of ${values.map(show).join(', ')}`;
}

function article(type: string): string {
  if (type === 'array') return 'a list';
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

function invalidType(issue: Extract<Issue, { code: 'invalid_type' }>): Described {
  if (issue.expected === 'never') return { problem: 'is not allowed here', hint: 'remove it' };
  if (issue.input === undefined) {
    return { problem: 'is required', hint: `add it as ${article(issue.expected)}` };
  }
  return { problem: `must be ${article(issue.expected)}`, hint: `set it to ${article(issue.expected)}` };
}

function invalidUnion(issue: Extract<Issue, { code: 'invalid_union' }>): Described {
  const { discriminator, options = [] } = issue as { discriminator?: string; options?: unknown[] };
  if (discriminator === undefined) {
    return { problem: 'matches none of the allowed forms', hint: 'see the schema' };
  }
  const value = (issue.input as Record<string, unknown> | undefined)?.[discriminator];
  const problem = value === undefined ? 'is required' : `${show(value)} is not allowed`;
  return { problem, hint: `use ${oneOf(options)}` };
}

function sizeIssue(issue: Extract<Issue, { code: 'too_small' | 'too_big' }>): Described {
  const limit = issue.code === 'too_small' ? issue.minimum : issue.maximum;
  const bound = issue.code === 'too_small' ? 'at least' : 'at most';
  if (issue.origin === 'array') {
    const entries = `${String(limit)} ${limit === 1 ? 'entry' : 'entries'}`;
    return { problem: `needs ${bound} ${entries}`, hint: `list ${bound} ${entries}` };
  }
  if (issue.origin === 'string' && limit === 1) return { problem: 'must not be empty', hint: 'fill it in' };
  return { problem: `must be ${bound} ${String(limit)}`, hint: `use a value ${bound} ${String(limit)}` };
}

function unknownKey(issue: Extract<Issue, { code: 'unrecognized_keys' }>): Described {
  return {
    location: jsonPath([...issue.path, issue.keys[0] ?? '']),
    problem: 'is not a known key',
    hint: 'remove it, or check its spelling against the schema',
  };
}

function customIssue(issue: Extract<Issue, { code: 'custom' }>): Described {
  const problem = (issue.params as { problem?: string } | undefined)?.problem;
  return { problem: problem ?? `${show(issue.input)} is not valid`, hint: 'see the schema' };
}

type Describers = { readonly [Code in Issue['code']]?: (issue: Extract<Issue, { code: Code }>) => Described };

const DESCRIBERS: Describers = {
  unrecognized_keys: unknownKey,
  invalid_type: invalidType,
  invalid_value: (issue) => ({
    problem: `${show(issue.input)} is not allowed`,
    hint: `use ${oneOf(issue.values)}`,
  }),
  invalid_union: invalidUnion,
  invalid_key: (issue) => ({
    problem: 'is not a valid key',
    hint: issue.issues[0]?.message ?? 'see the schema',
  }),
  too_small: sizeIssue,
  too_big: sizeIssue,
  custom: customIssue,
};

function describe(issue: Issue): Described {
  // TypeScript cannot pair a code with its own describer through the lookup, so the entry is widened.
  const describer = DESCRIBERS[issue.code] as ((issue: Issue) => Described) | undefined;
  return describer?.(issue) ?? { problem: `${show(issue.input)} is not valid`, hint: 'see the schema' };
}

/** The data when `value` matches `schema`, or the finding for zod's first issue. */
export type Checked<Data> =
  { readonly ok: true; readonly data: Data } | { readonly ok: false; readonly finding: Finding };

/** Validates `value` against `schema`; `schemaName` is what generic hints point the reader to. */
export function checkSchema<Schema extends z.ZodMiniType>(
  schema: Schema,
  value: unknown,
  schemaName: string,
): Checked<z.output<Schema>> {
  const result = z.safeParse(schema, value, { reportInput: true });
  if (result.success) return { ok: true, data: result.data };
  const [issue] = result.error.issues;
  if (issue === undefined) {
    return { ok: false, finding: { location: '', problem: 'is not valid', hint: 'fix it' } };
  }
  return { ok: false, finding: describeIssue(issue, schemaName) };
}

/**
 * Turns a zod issue (parsed with `reportInput`) into a finding. A schema's own error message is its fix and
 * replaces the generic hint; `schema` names the JSON Schema the generic hints point to.
 */
export function describeIssue(issue: Issue, schema: string): Finding {
  const described = describe(issue);
  const custom = issue.message === DEFAULT_MESSAGE ? undefined : issue.message;
  const hint = custom ?? described.hint.replace(/the schema$/, schema);
  const location = described.location ?? jsonPath(issue.path);
  return { location, problem: described.problem, hint };
}
