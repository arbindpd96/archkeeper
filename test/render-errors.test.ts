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

const blockIn = (id: string, file: string): KitModule =>
  kit(
    id,
    {
      files: [{ to: file, strategy: 'blocks', target: 'project' }],
      blocks: [{ file, id: 'own', template: 'b.md' }],
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

  it.each<[string, () => KitModule[], string]>([
    ['in case', () => [owned('a', 'docs/Notes.md'), owned('b', 'docs/notes.md')], 'docs/Notes.md from a'],
    [
      'for blocks with their own ids',
      () => [block('a', 'one'), blockIn('b', 'agents.md')],
      'AGENTS.md from a',
    ],
  ])('two spellings of one path that differ only %s', (_name, modules, problem) => {
    const error = renderError(modules());
    expect(error.message).toContain(problem);
    expect(error.hint).toBe('spell the path the same way in every module');
  });

  it('names a module whose two targets render to one path', () => {
    const twice = kit(
      'm',
      {
        files: [
          { from: 'a.md', to: '{{brand.rulesDir}}/a.md', strategy: 'owned', target: 'project' },
          { from: 'a.md', to: `${BRAND.rulesDir}/a.md`, strategy: 'owned', target: 'project' },
        ],
      },
      { 'modules/m/files/a.md': 'A\n' },
    );
    const error = renderError([twice]);
    expect(error.message).toContain('is written by m twice');
    expect(error.hint).toContain('list the file once in files');
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
  it('refuses a target that a template value renders into the state folder', () => {
    const values = { local: { dir: BRAND.stateDir } };
    const run = (): unknown => render([owned('a', '{{local.dir}}/notes.md')], { stack: [], values });
    expect(run).toThrow(`files[0].to: renders to "${BRAND.stateDir}/notes.md", which is inside`);
  });

  it('refuses a target that a template value renders to a name with other characters', () => {
    const values = { local: { name: '\u017Fettings' } };
    const run = (): unknown => render([owned('a', '.claude/{{local.name}}.json')], { stack: [], values });
    expect(run).toThrow('renders to ".claude/\u017Fettings.json", which has a character other than ASCII');
  });

  it('refuses a target that a brand with other folders would put in its hook folder', () => {
    const brand: Brand = { ...BRAND, hookDir: 'docs/hooks' };
    expect(() => render([owned('a', 'docs/hooks/x.md')], { stack: [] }, brand)).toThrow(
      'which is inside docs/hooks, which the kit manages itself',
    );
  });
});

describe('render refuses output that holds a likely secret', () => {
  const token = `ghp_${'a'.repeat(36)}`;

  it.each<[string, () => KitModule, string, string]>([
    [
      'a token in stdio MCP args',
      () =>
        kit('m', {
          files: [{ to: '.mcp.json', strategy: 'json', target: 'project' }],
          mcpServers: [{ name: 'gh', type: 'stdio', command: 'gh-mcp', args: ['--profile', token] }],
        }),
      '.mcp.json',
      'GitHub token from m, on line 8 of its entry',
    ],
    [
      'a token in a stdio MCP command',
      () =>
        kit('m', {
          files: [{ to: '.mcp.json', strategy: 'json', target: 'project' }],
          mcpServers: [{ name: 'gh', type: 'stdio', command: `gh-mcp-${token}` }],
        }),
      '.mcp.json',
      'GitHub token',
    ],
    [
      'a private key in an owned template',
      () =>
        kit(
          'm',
          { files: [{ from: 'a.md', to: 'docs/a.md', strategy: 'owned', target: 'project' }] },
          { 'modules/m/files/a.md': `# Key\n${['-----BEGIN RSA PRIVATE', 'KEY-----'].join(' ')}\n` },
        ),
      'docs/a.md',
      'private key from m, on line 2',
    ],
  ])('%s', (_name, module, file, problem) => {
    const error = renderError([module()]);
    expect(error.file).toBe(file);
    expect(error.message).toContain(problem);
    expect(error.message).not.toContain(token);
  });

  it('refuses a secret that arrives through a template value', () => {
    const notes = owned('a', 'docs/notes.md');
    const withValue = kit(
      'b',
      { files: [{ from: 'b.md', to: 'docs/b.md', strategy: 'owned', target: 'project' }] },
      { 'modules/b/files/b.md': 'Token: {{detected.token}}\n' },
    );
    expect(() => render([notes, withValue], { stack: [], values: { detected: { token } } })).toThrow(
      'docs/b.md: would get a likely GitHub token from b',
    );
  });
});

describe('render checks each rendered gitignore line', () => {
  const ignores = (): KitModule =>
    kit('m', {
      files: [{ to: '.gitignore', strategy: 'blocks', target: 'project' }],
      gitignore: ['{{local.dir}}/'],
    });

  it('refuses a template value that renders a ! negation', () => {
    const run = (): unknown => render([ignores()], { stack: [], values: { local: { dir: '!secrets' } } });
    expect(run).toThrow(RenderError);
    expect(run).toThrow('m/module.json: gitignore[0]: renders to');
  });

  it('writes a value that stays one pattern', () => {
    const tree = render([ignores()], { stack: [], values: { local: { dir: 'tmp' } } });
    expect(tree.get('.gitignore')?.[0]?.content).toBe('tmp/\n');
  });
});

describe('render refuses template values that could change the file around them', () => {
  const notes = (): KitModule =>
    kit(
      'm',
      { files: [{ from: 'a.md', to: 'a.md', strategy: 'owned', target: 'project' }] },
      { 'modules/m/files/a.md': 'Test with {{detected.test}}\n' },
    );

  it.each([
    ['a newline that starts an import line', 'npm test\n@~/.ssh/id_rsa', 'holds a control character'],
    [
      'an import from the home folder mid-line',
      'npm test @~/.ssh/id_rsa',
      'holds an @ import of a file outside',
    ],
    ['an import from the root', 'see @/etc/hosts', 'holds an @ import of a file outside'],
    ['an import through ..', 'see @docs/../../secret.md', 'holds an @ import of a file outside'],
    ['a block marker', `<!-- ${BRAND.markerPrefix}:end base -->`, `holds ${BRAND.markerPrefix}:end`],
    [
      'a block marker in another case',
      `${BRAND.markerPrefix.toUpperCase()}:BEGIN x`,
      `holds ${BRAND.markerPrefix}:begin`,
    ],
  ])('refuses %s', (_name, test, problem) => {
    const run = (): unknown => render([notes()], { stack: [], values: { detected: { test } } });
    expect(run).toThrow(RenderError);
    expect(run).toThrow(`template values: detected.test: ${problem}`);
  });

  it("refuses a block marker under one of the brand's legacy slugs", () => {
    const renamed = { ...BRAND, legacySlugs: ['oldkit'] };
    const values = { detected: { test: '<!-- oldkit:end base -->' } };
    expect(() => render([notes()], { stack: [], values }, renamed)).toThrow('holds oldkit:end');
  });

  it('writes a one-line value as is', () => {
    const tree = render([notes()], { stack: [], values: { detected: { test: 'npm run test -- --run' } } });
    expect(tree.get('a.md')?.[0]?.content).toBe('Test with npm run test -- --run\n');
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
