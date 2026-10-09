import type { Brand } from './brand.js';
import { RenderError } from './errors.js';
import { hasControlCharacter } from './paths.js';

/** The values a template can read, nested in plain objects: `{{brand.hookDir}}` reads `scope.brand.hookDir`. */
export interface TemplateScope {
  readonly [name: string]: string | number | TemplateScope;
}

// `\{{` is a literal `{{`; `{{ a.b }}` is a variable; any other `{{` is an error. There is nothing else.
const TOKEN = /\\\{\{|\{\{([^{}]*)\}\}|\{\{/g;
const VARIABLE = /^\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*$/;
const NO_LOGIC = 'templates take only {{name.path}} variables: no helpers, partials or logic';

/** The brand's string fields, as templates read them under `brand.*`. */
export function brandScope(brand: Brand): TemplateScope {
  return Object.fromEntries(
    Object.entries(brand).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function isScope(value: unknown): value is TemplateScope {
  return typeof value === 'object' && value !== null;
}

function lineOf(text: string, offset: number): string {
  return `line ${String(text.slice(0, offset).split('\n').length)}`;
}

function lookup(scope: TemplateScope, name: string, where: { file: string; location: string }): string {
  let value: unknown = scope;
  const path: string[] = [];
  for (const part of name.split('.')) {
    if (!isScope(value) || !Object.hasOwn(value, part)) {
      const known = isScope(value) ? Object.keys(value).map((key) => [...path, key].join('.')) : [];
      const hint = known.length > 0 ? `use one of ${known.join(', ')}` : NO_LOGIC;
      throw new RenderError({ ...where, problem: `{{${name}}} is not a known variable`, hint });
    }
    value = value[part];
    path.push(part);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  const first = isScope(value) ? Object.keys(value)[0] : undefined;
  const hint = `name one of its values, such as {{${name}.${first ?? 'name'}}}`;
  throw new RenderError({ ...where, problem: `{{${name}}} is a group of values, not one value`, hint });
}

/**
 * Fills `{{a.b}}` variables from `scope`, logic-less and deterministic (#20): `\{{` writes a literal `{{`, and an
 * unknown variable, an unclosed `{{` or anything that is not a variable throws RenderError with the line.
 */
export function renderTemplate(template: string, scope: TemplateScope, file: string): string {
  return template.replace(TOKEN, (match: string, expression: string | undefined, offset: number) => {
    if (match === '\\{{') return '{{';
    const location = lineOf(template, offset);
    if (expression === undefined) {
      throw new RenderError({
        file,
        location,
        problem: 'opens {{ without a closing }}',
        hint: 'close it, or write \\{{ for a literal {{',
      });
    }
    const name = VARIABLE.exec(expression)?.[1];
    if (name === undefined) {
      throw new RenderError({
        file,
        location,
        problem: `{{${expression}}} is not a variable`,
        hint: NO_LOGIC,
      });
    }
    return lookup(scope, name, { file, location });
  });
}

/**
 * Writes a CLAUDE.md import of a project path: `@path`, never quoted (a quoted path is not imported), with each
 * space escaped as `\ ` (reference §2.1). `toImport('Design Docs/api.md')` is `@Design\ Docs/api.md`.
 */
export function toImport(path: string): string {
  if (path === '' || path.includes('\\') || hasControlCharacter(path)) {
    throw new RenderError({
      file: path,
      location: '',
      problem: 'cannot be written as an @import',
      hint: 'pass a non-empty path with forward slashes, on one line',
    });
  }
  return `@${path.replaceAll(' ', '\\ ')}`;
}
