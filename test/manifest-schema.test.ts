import { describe, expect, it } from 'vitest';
import { ArchkeeperError, ManifestError } from '../src/core/errors.js';
import { loadModule } from '../src/core/loader.js';
import { entry, type ManifestData, memoryReader, richManifest, richSources } from './kit-fixtures.js';

type Change = (manifest: ManifestData) => void;

function load(change: Change): ManifestError {
  const manifest = richManifest();
  change(manifest);
  const read = memoryReader({ 'modules/rich/module.json': JSON.stringify(manifest), ...richSources() });
  try {
    loadModule('rich', read);
  } catch (error) {
    if (error instanceof ManifestError) return error;
    throw error;
  }
  throw new Error('the manifest loaded without an error');
}

const hook = (m: ManifestData, index: number): Record<string, unknown> => entry(m, 'hooks', index);
const file = (m: ManifestData, index: number): Record<string, unknown> => entry(m, 'files', index);
const server = (m: ManifestData, index: number): Record<string, unknown> => entry(m, 'mcpServers', index);
const option = (m: ManifestData, name: string): Record<string, unknown> => entry(m, 'options', name);

describe('module manifest schema', () => {
  it('accepts a manifest that uses every field, and fills the defaults', () => {
    const manifest = richManifest();
    delete manifest.conflicts;
    const read = memoryReader({ 'modules/rich/module.json': JSON.stringify(manifest), ...richSources() });
    const loaded = loadModule('rich', read);
    expect(loaded.manifest.conflicts).toEqual([]);
    expect(loaded.manifest.hooks).toHaveLength(2);
    expect(loaded.file).toBe('modules/rich/module.json');
  });

  it.each<[string, Change, string, string]>([
    ['an unknown key', (m) => (m.extra = 1), 'extra', 'remove it'],
    ['a newer schemaVersion', (m) => (m.schemaVersion = 2), 'schemaVersion', 'set schemaVersion to 1'],
    ['a missing description', (m) => delete m.description, 'description', 'add it as a string'],
    ['a description over two lines', (m) => (m.description = 'a\nb'), 'description', 'write one line'],
    ['an id that is not kebab-case', (m) => (m.id = 'Rich_Module'), 'id', 'use kebab-case'],
    ['a requires entry that is not an id', (m) => (m.requires = ['Base']), 'requires[0]', 'use kebab-case'],
    [
      'a hook event outside the allowlist',
      (m) => (hook(m, 0).event = 'Notification'),
      'hooks[0].event',
      '"Stop"',
    ],
    ['once on a hook', (m) => (hook(m, 0).once = true), 'hooks[0].once', 'only skill frontmatter honours it'],
    [
      'if on a non-tool event',
      (m) => (hook(m, 1).if = 'Bash(x)'),
      'hooks[1].if',
      'never runs on a non-tool event',
    ],
    [
      'a shell-form hook command',
      (m) => (hook(m, 0).command = 'node x.mjs'),
      'hooks[0].command',
      'remove it',
    ],
    [
      'a hook script outside dist/hooks',
      (m) => (hook(m, 0).script = 'scripts/x.mjs'),
      'hooks[0].script',
      'dist/hooks/',
    ],
    [
      'a hook script that climbs out',
      (m) => (hook(m, 0).script = 'dist/hooks/../x.mjs'),
      'hooks[0].script',
      'dist/hooks/',
    ],
    ['a zero hook timeout', (m) => (hook(m, 0).timeout = 0), 'hooks[0].timeout', 'at least 1'],
    ['a hook timeout over 600 s', (m) => (hook(m, 0).timeout = 601), 'hooks[0].timeout', 'at most 600'],
    ['an absolute target path', (m) => (file(m, 1).to = '/etc/notes.md'), 'files[1].to', 'forward slashes'],
    ['a drive-letter target path', (m) => (file(m, 1).to = 'C:/notes.md'), 'files[1].to', 'forward slashes'],
    [
      'a target path with ..',
      (m) => (file(m, 1).to = 'docs/../../notes.md'),
      'files[1].to',
      'no ".." segment',
    ],
    [
      'a target path with a backslash',
      (m) => (file(m, 1).to = 'docs\\notes.md'),
      'files[1].to',
      'forward slashes',
    ],
    [
      'a template path with ..',
      (m) => (file(m, 1).from = '../base/files/x.md'),
      'files[1].from',
      'no ".." segment',
    ],
    ['an unknown strategy', (m) => (file(m, 1).strategy = 'merge'), 'files[1].strategy', '"create-only"'],
    [
      'a plugin target for a create-only file',
      (m) => (file(m, 1).target = 'plugin'),
      'files[1].target',
      'ADR-0016',
    ],
    [
      'an owned file without a template',
      (m) => delete file(m, 0).from,
      'files[0].from',
      'add it as a string',
    ],
    ['a template for a blocks file', (m) => (file(m, 2).from = 'agents.md'), 'files[2].from', 'remove from'],
    ['a json file other than settings', (m) => (file(m, 4).to = 'x.json'), 'files[4].to', '.mcp.json'],
    [
      'a malformed permission rule',
      (m) => (m.permissions = { deny: ['rm -rf'] }),
      'permissions.deny[0]',
      'Bash(',
    ],
    [
      'a literal MCP env value',
      (m) => (server(m, 1).env = { TOKEN: 'abc' }),
      'mcpServers[1].env.TOKEN',
      'never hold a literal',
    ],
    [
      'a literal MCP header',
      (m) => (server(m, 0).headers = { 'X-Team': 't1' }),
      'mcpServers[0].headers.X-Team',
      'never hold',
    ],
    ['an MCP server without a type', (m) => delete server(m, 0).type, 'mcpServers[0].type', '"stdio"'],
    [
      'an MCP URL with credentials',
      (m) => (server(m, 0).url = 'https://me:pw@example.com/mcp'),
      'mcpServers[0].url',
      'user:password@',
    ],
    [
      'a literal secret in an MCP URL query',
      (m) => (server(m, 0).url = 'https://api.example.com/mcp?api_key=sk-live-123'),
      'mcpServers[0].url',
      'query values are ${NAME} references',
    ],
    [
      'an MCP URL query key without a value',
      (m) => (server(m, 0).url = 'https://api.example.com/mcp?sk-live-123'),
      'mcpServers[0].url',
      'query values are ${NAME} references',
    ],
    [
      'an MCP URL with a fragment',
      (m) => (server(m, 0).url = 'https://api.example.com/mcp#token=x'),
      'mcpServers[0].url',
      'no #fragment',
    ],
    [
      'a credential variable in an MCP URL query',
      (m) => (server(m, 0).url = 'https://api.example.com/mcp?key=${API_KEY}'),
      'mcpServers[0].url',
      'OAuth or a headersHelper script',
    ],
    [
      'a credential variable in a remote MCP header',
      (m) => (server(m, 0).headers = { Authorization: '${API_TOKEN}' }),
      'mcpServers[0].headers.Authorization',
      'OAuth or a headersHelper script',
    ],
    [
      'an inline headersHelper command',
      (m) => (server(m, 0).headersHelper = `echo '{"Authorization":"Bearer abc"}'`),
      'mcpServers[0].headersHelper',
      'name a script in the project',
    ],
    [
      'a headersHelper with arguments',
      (m) => (server(m, 0).headersHelper = '${CLAUDE_PROJECT_DIR:-.}/scripts/headers.sh --token abc'),
      'mcpServers[0].headersHelper',
      'with no arguments',
    ],
    [
      'a headersHelper outside the project',
      (m) => (server(m, 0).headersHelper = '${CLAUDE_PROJECT_DIR:-.}/../headers.sh'),
      'mcpServers[0].headersHelper',
      'name a script in the project',
    ],
    [
      'an absolute headersHelper',
      (m) => (server(m, 0).headersHelper = '/opt/bin/headers.sh'),
      'mcpServers[0].headersHelper',
      'name a script in the project',
    ],
    [
      'an option default of the wrong type',
      (m) => (option(m, 'blockNoVerify').default = 'no'),
      'options.blockNoVerify.default',
      'a boolean',
    ],
    [
      'an unknown option type',
      (m) => (option(m, 'blockNoVerify').type = 'number'),
      'options.blockNoVerify.type',
      '"string-list"',
    ],
    [
      'an option name that is not camelCase',
      (m) => (m.options = { 'Block-It': {} }),
      'options.Block-It',
      'camelCase',
    ],
    ['a gitignore comment line', (m) => (m.gitignore = ['# local files']), 'gitignore[0]', 'not a comment'],
    ['an empty when stack list', (m) => (m.when = { stack: [] }), 'when.stack', 'list at least 1 entry'],
    ['a when stack that is not supported', (m) => (m.when = { stack: ['go'] }), 'when.stack[0]', '"python"'],
    [
      'an MCP server name with a dot',
      (m) => (server(m, 0).name = 'docs.site'),
      'mcpServers[0].name',
      'letters',
    ],
    [
      'a demo tape that is not an id',
      (m) => (m.demo = { tape: 'Init Tape', section: 'S' }),
      'demo.tape',
      'kebab-case',
    ],
  ])('rejects %s', (_name, change, location, fix) => {
    const error = load(change);
    expect(error.file).toBe('modules/rich/module.json');
    expect(error.location).toBe(location);
    expect(error.message).toContain(`modules/rich/module.json: ${location}: `);
    expect(error.hint).toContain(fix);
  });

  it('accepts referenced query values, a project headers script and credential variables for stdio', () => {
    const manifest = richManifest();
    Object.assign(server(manifest, 0), {
      url: 'https://api.example.com/mcp?team=${TEAM_ID}&region=${REGION}',
      headersHelper: '${CLAUDE_PROJECT_DIR:-.}/.claude/mcp-headers.sh',
    });
    server(manifest, 1).env = { GITHUB_TOKEN: '${GITHUB_TOKEN}' };
    const read = memoryReader({ 'modules/rich/module.json': JSON.stringify(manifest), ...richSources() });
    expect(loadModule('rich', read).manifest.mcpServers).toHaveLength(2);
  });

  it('names the offending path and value in the problem', () => {
    expect(load((m) => (file(m, 1).to = '/etc/notes.md')).message).toContain('files[1].to: is absolute');
    expect(load((m) => (hook(m, 0).event = 'Notification')).message).toContain(
      '"Notification" is not allowed',
    );
  });

  it('never shows an env or header value it refuses, since that value can be a pasted token', () => {
    const token = `ghp_${'a'.repeat(36)}`;
    const env = load((m) => (server(m, 1).env = { TOKEN: token }));
    const header = load((m) => (server(m, 0).headers = { Authorization: `Bearer ${token}` }));
    for (const error of [env, header]) {
      expect(error.message).not.toContain(token);
      expect(error.message).toContain('does not have the required form');
    }
  });

  it('is an ArchkeeperError whose message ends with the fix on a Try line', () => {
    const error = load((m) => (m.extra = 1));
    expect(error).toBeInstanceOf(ArchkeeperError);
    expect(error.name).toBe('ManifestError');
    expect(error.message).toBe(
      'modules/rich/module.json: extra: is not a known key\n' +
        'Try: remove it, or check its spelling against schema/module.schema.json',
    );
  });
});
