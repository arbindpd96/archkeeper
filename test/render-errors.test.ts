import { describe, expect, it } from 'vitest';
import { BRAND, type Brand } from '../src/core/brand.js';
import { RenderError } from '../src/core/errors.js';
import { type KitModule, loadModule } from '../src/core/loader.js';
import { render } from '../src/core/render.js';
import { type ManifestData, memoryReader, plainManifest } from './kit-fixtures.js';

function kit(id: string, fields: ManifestData, sources: Record<string, string> = {}): KitModule {
  const files = { [`modules/${id}/module.json`]: JSON.stringify(plainManifest(id, fields)), ...sources };
  return loadModule(id, memoryReader(files));
}

const owned = (id: string, to: string, strategy = 'owned'): KitModule =>
  kit(
    id,
    { files: [{ from: 'a.md', to, strategy, target: 'project' }] },
    { [`modules/${id}/files/a.md`]: 'A\n' },
  );

const block = (id: string, blockId: string): KitModule =>
  kit(
    id,
    {
      files: [{ to: 'AGENTS.md', strategy: 'blocks', target: 'project' }],
      blocks: [{ file: 'AGENTS.md', id: blockId, template: 'b.md' }],
    },
    { [`modules/${id}/files/b.md`]: 'B\n' },
  );

const settings = (id: string, fields: ManifestData): KitModule =>
  kit(
    id,
    { files: [{ to: '.claude/settings.json', strategy: 'json', target: 'project' }], ...fields },
    { 'dist/hooks/guard.mjs': 'export {};\n' },
  );

const guardHook = {
  hooks: [{ event: 'PreToolUse', matcher: 'Bash', script: 'dist/hooks/guard.mjs', timeout: 10 }],
};

function renderError(modules: readonly KitModule[]): RenderError {
  try {
    render(modules, { stack: [] });
  } catch (error) {
    if (error instanceof RenderError) return error;
    throw error;
  }
  throw new Error('the modules rendered without an error');
}

describe('render refuses two modules writing one thing', () => {
  it.each<[string, () => KitModule[], string, string]>([
    [
      'the same owned file',
      () => [owned('a', 'docs/x.md'), owned('b', 'docs/x.md')],
      'docs/x.md',
      'is written by both a and b',
    ],
    [
      'the same create-only file',
      () => [owned('a', 'x.md', 'create-only'), owned('b', 'x.md', 'create-only')],
      'x.md',
      'both a and b',
    ],
    [
      'one file with two strategies',
      () => [owned('a', 'x.md'), owned('b', 'x.md', 'create-only')],
      'x.md',
      'as owned by a and as create-only by b',
    ],
    [
      'the same block',
      () => [block('a', 'rules'), block('b', 'rules')],
      'AGENTS.md',
      'gets block "rules" from both a and b',
    ],
    [
      'the same permission rule',
      () => [
        settings('a', { permissions: { deny: ['Bash(x)'] } }),
        settings('b', { permissions: { deny: ['Bash(x)'] } }),
      ],
      '.claude/settings.json',
      'gets permissions.deny Bash(x) from both a and b',
    ],
    [
      'the same hook registration',
      () => [settings('a', guardHook), settings('b', guardHook)],
      '.claude/settings.json',
      'gets hooks.PreToolUse',
    ],
  ])('%s', (_name, modules, file, problem) => {
    const error = renderError(modules());
    expect(error.file).toBe(file);
    expect(error.message).toContain(problem);
  });

  it('lets several modules add their own blocks and JSON entries to one file', () => {
    const tree = render(
      [block('a', 'first'), block('b', 'second'), settings('c', { permissions: { deny: ['Bash(c)'] } })],
      { stack: [] },
    );
    expect(tree.get('AGENTS.md')).toHaveLength(2);
    expect(tree.get('.claude/settings.json')).toHaveLength(1);
  });
});

describe('render refuses reserved targets', () => {
  it('refuses a target that renders into the state folder of the brand it is given', () => {
    const error = renderError([owned('a', '{{ brand.stateDir }}/notes.md')]);
    expect(error.location).toBe('files[0].to');
    expect(error.message).toContain(`renders to "${BRAND.stateDir}/notes.md", which is inside`);
  });

  it('refuses a target that a brand with other folders would put in its hook folder', () => {
    const brand: Brand = { ...BRAND, hookDir: 'docs/hooks' };
    expect(() => render([owned('a', 'docs/hooks/x.md')], { stack: [] }, brand)).toThrow(
      'which is inside docs/hooks, which the kit manages itself',
    );
  });
});

describe('render output', () => {
  it('turns CRLF templates into LF text and adds the trailing newline', () => {
    const crlf = kit(
      'crlf',
      { files: [{ from: 'a.md', to: 'a.md', strategy: 'owned', target: 'project' }] },
      { 'modules/crlf/files/a.md': 'one\r\ntwo' },
    );
    expect(render([crlf], { stack: [] }).get('a.md')?.[0]?.content).toBe('one\ntwo\n');
  });

  it('reports an unknown variable with the template path and line', () => {
    const broken = kit(
      'broken',
      { files: [{ from: 'a.md', to: 'a.md', strategy: 'owned', target: 'project' }] },
      { 'modules/broken/files/a.md': 'fine\n{{brand.nope}}\n' },
    );
    const error = renderError([broken]);
    expect(error.file).toBe('modules/broken/files/a.md');
    expect(error.location).toBe('line 2');
  });
});
