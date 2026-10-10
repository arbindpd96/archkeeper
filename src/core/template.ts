import type { Brand } from './brand.js';
import { RenderError } from './errors.js';
import { importProblem } from './imports.js';
import { markerIn, type MarkerBrand } from './markers.js';
import { hasControlCharacter, relativePathProblem } from './paths.js';
import { quoted } from './text.js';

/**
 * The values a template can read, nested in plain objects: `{{brand.hookDir}}` reads `scope.brand.hookDir`. A list
 * of strings is the one multi-line form: each item is one line, checked like any value, and the list fills its
 * variable joined with newlines, such as the detected commands table.
 */
export interface TemplateScope {
  readonly [name: string]: string | number | readonly string[] | TemplateScope;
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
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLines(value: unknown): value is readonly string[] {
  return Array.isArray(value);
}

/** A template value that may not reach a template: its dotted name and why. */
export interface UnsafeValue {
  readonly name: string;
  readonly problem: string;
}

function valueProblem(value: string, markers: MarkerBrand): string | undefined {
  if (hasControlCharacter(value)) return 'holds a control character, such as a newline';
  const imported = importProblem(value);
  if (imported !== undefined) return imported;
  const marker = markerIn(value, markers);
  return marker === undefined ? undefined : `holds ${marker}, which marks a managed block`;
}

function unsafeLine(key: string, lines: readonly string[], markers: MarkerBrand): UnsafeValue | undefined {
  for (const [index, line] of lines.entries()) {
    const problem = valueProblem(line, markers);
    if (problem !== undefined) return { name: `${key}[${String(index)}]`, problem };
  }
  return undefined;
}

/**
 * Finds the first string in `scope`, or line in a list of lines, that holds a control character, an `@` import
 * that `importProblem` refuses, or a block marker of `markers` (see `markerPattern`). Values carry project data,
 * such as detected commands, into templates as is: an `@path` in CLAUDE.md is an import, and a marker could end a
 * managed block early. Imports of ordinary project files, such as `toImport('AGENTS.md')`, stay allowed.
 */
export function unsafeValue(scope: TemplateScope, markers: MarkerBrand): UnsafeValue | undefined {
  for (const [key, value] of Object.entries(scope)) {
    if (typeof value === 'number') continue;
    if (isLines(value)) {
      const line = unsafeLine(key, value, markers);
      if (line !== undefined) return line;
      continue;
    }
    const inner = isScope(value) ? unsafeValue(value, markers) : undefined;
    if (inner !== undefined) return { ...inner, name: `${key}.${inner.name}` };
    const problem = typeof value === 'string' ? valueProblem(value, markers) : undefined;
    if (problem !== undefined) return { name: key, problem };
  }
  return undefined;
}

function lineOf(text: string, offset: number): string {
  return `line ${String(text.slice(0, offset).split('\n').length)}`;
}

interface Where {
  readonly file: string;
  readonly location: string;
}

function valueText(value: unknown, name: string, where: Where): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (isLines(value)) return value.join('\n');
  const first = isScope(value) ? Object.keys(value)[0] : undefined;
  const hint = `name one of its values, such as {{${name}.${first ?? 'name'}}}`;
  throw new RenderError({ ...where, problem: `{{${name}}} is a group of values, not one value`, hint });
}

function lookup(scope: TemplateScope, name: string, where: Where): string {
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
  return valueText(value, name, where);
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
 * space escaped as `\ ` (reference §2.1). `toImport('Design Docs/api.md')` is `@Design\ Docs/api.md`. A path
 * that leaves the project, such as `../x`, `/etc/x` or `~/x`, throws RenderError: it would pull an outside
 * file into Claude's context. Claude Code resolves an import from the importing file, so the result is right
 * only in a file at the project root, such as `CLAUDE.md`; a nested file needs a path relative to itself.
 */
export function toImport(path: string): string {
  const privateFile =
    importProblem(`@${path.replaceAll(' ', '\\ ')}`) === undefined ? undefined : 'names a private file';
  const problem =
    relativePathProblem(path) ?? (path.startsWith('~') ? 'starts with ~, the home folder' : privateFile);
  if (problem !== undefined) {
    throw new RenderError({
      file: quoted(path),
      location: '',
      problem: `cannot be written as an @import: it ${problem}`,
      hint: 'pass a path inside the project with forward slashes, such as docs/api.md',
    });
  }
  return `@${path.replaceAll(' ', '\\ ')}`;
}
