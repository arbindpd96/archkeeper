import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { RenderError } from '../src/core/errors.js';
import { brandScope, renderTemplate, type TemplateScope, toImport } from '../src/core/template.js';

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

describe('toImport', () => {
  it('writes an unquoted @path with each space escaped', () => {
    expect(toImport('Design Docs/api.md')).toBe('@Design\\ Docs/api.md');
    expect(toImport('AGENTS.md')).toBe('@AGENTS.md');
  });

  it.each(['', 'docs\\api.md', 'docs/a\nb.md'])('refuses %j, which no import can name', (path) => {
    expect(() => toImport(path)).toThrow(RenderError);
  });
});
