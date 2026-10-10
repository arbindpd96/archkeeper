import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { RenderError } from '../src/core/errors.js';
import {
  brandScope,
  renderTemplate,
  type TemplateScope,
  toImport,
  unsafeValue,
} from '../src/core/template.js';

const SCOPE: TemplateScope = { brand: brandScope(BRAND), docs: { map: 'docs/architecture.md' }, cap: 1200 };
const FILE = 'modules/base/files/AGENTS.md';

function renderError(template: string): RenderError {
  try {
    renderTemplate(template, SCOPE, FILE);
  } catch (error) {
    if (error instanceof RenderError) return error;
    throw error;
  }
  throw new Error('the template rendered without an error');
}

describe('renderTemplate', () => {
  it('fills {{a.b}} variables, brand values included, with or without inner spaces', () => {
    expect(renderTemplate('See {{docs.map}} and {{ brand.hookDir }} ({{cap}}).', SCOPE, FILE)).toBe(
      `See docs/architecture.md and ${BRAND.hookDir} (1200).`,
    );
  });

  it('writes a literal {{ for \\{{ and leaves a lone }} alone', () => {
    expect(renderTemplate('Write \\{{name}} or }} as text.', SCOPE, FILE)).toBe(
      'Write {{name}} or }} as text.',
    );
  });

  it('reads only string brand fields', () => {
    expect(Object.keys(SCOPE.brand as TemplateScope)).not.toContain('legacySlugs');
  });

  it.each<[string, string, string, string]>([
    ['an unknown variable', 'a\n{{brand.nope}}', 'line 2', 'use one of brand.npmName'],
    ['an unknown root variable', '{{nope}}', 'line 1', 'use one of brand, docs, cap'],
    ['an inherited property', '{{brand.constructor}}', 'line 1', 'use one of brand.'],
    ['a group of values', '\n\n{{brand}}', 'line 3', 'such as {{brand.npmName}}'],
    ['a value read as a group', '{{cap.size}}', 'line 1', 'no helpers, partials or logic'],
    ['a helper', '{{#if brand.npmName}}x{{/if}}', 'line 1', 'no helpers, partials or logic'],
    ['a partial', '{{> header}}', 'line 1', 'no helpers, partials or logic'],
    ['an unclosed {{', 'text {{brand.npmName', 'line 1', 'write \\{{ for a literal {{'],
  ])('throws RenderError with the template path and line for %s', (_name, template, location, fix) => {
    const error = renderError(template);
    expect(error.file).toBe(FILE);
    expect(error.location).toBe(location);
    expect(error.message).toContain(`${FILE}: ${location}: `);
    expect(error.hint).toContain(fix);
  });
});

describe('a list of lines, the one multi-line value', () => {
  const lines: TemplateScope = { detected: { table: ['| `npm test` |', '| `uv run pytest` |'] } };

  it('fills its variable with the lines joined by newlines', () => {
    expect(renderTemplate('Commands:\n{{detected.table}}\n', lines, FILE)).toBe(
      'Commands:\n| `npm test` |\n| `uv run pytest` |\n',
    );
  });

  it('passes the value check when every line is safe', () => {
    expect(unsafeValue(lines, BRAND)).toBeUndefined();
  });

  it.each([
    ['a line that holds a newline', ['ok', 'npm test\n@~/.ssh/id_rsa'], 'table[1]', 'control character'],
    ['a line with an outside import', ['see @~/.ssh/id_rsa'], 'table[0]', 'outside the project'],
    ['a line with a block marker', [`<!-- ${BRAND.markerPrefix}:end base -->`], 'table[0]', 'managed block'],
  ])('is refused for %s, naming the line', (_name, table, name, problem) => {
    const unsafe = unsafeValue({ detected: { table } }, BRAND);
    expect(unsafe?.name).toBe(`detected.${name}`);
    expect(unsafe?.problem).toContain(problem);
  });
});

describe('toImport', () => {
  it('writes an unquoted @path with each space escaped', () => {
    expect(toImport('Design Docs/api.md')).toBe('@Design\\ Docs/api.md');
    expect(toImport('AGENTS.md')).toBe('@AGENTS.md');
  });

  it.each(['', 'docs\\api.md', 'docs/a\nb.md'])('refuses %j, which no import can name', (path) => {
    expect(() => toImport(path)).toThrow(RenderError);
  });

  it.each(['/etc/passwd', '~/.aws/credentials', '../../secret.md', 'docs/../../x.md', 'C:/x.md'])(
    'refuses %j, which lies outside the project',
    (path) => {
      expect(() => toImport(path)).toThrow('pass a path inside the project');
    },
  );
});
