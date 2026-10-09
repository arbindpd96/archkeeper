import { describe, expect, it } from 'vitest';
import { ManifestError } from '../src/core/errors.js';
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

const server = (m: ManifestData, index: number): Record<string, unknown> => entry(m, 'mcpServers', index);
const HEX_KEY = '0123456789abcdef'.repeat(2);

describe('module manifest MCP servers', () => {
  it.each<[string, Change, string, string]>([
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
      'a literal key in an MCP URL path',
      (m) => (server(m, 0).url = `https://mcp.example.com/api/mcp/s/${HEX_KEY}/mcp`),
      'mcpServers[0].url',
      'keep keys out of the URL',
    ],
    [
      'a literal key in an MCP host name',
      (m) => (server(m, 0).url = `https://${HEX_KEY}.mcp.example.com/mcp`),
      'mcpServers[0].url',
      'keep keys out of the URL',
    ],
    [
      'a literal value after a key flag in stdio args',
      (m) => (server(m, 1).args = ['--api-key', 'hunter2']),
      'mcpServers[1].args[1]',
      'such as --token ${GITHUB_TOKEN}',
    ],
    [
      'a literal value in a --token= stdio arg',
      (m) => (server(m, 1).args = ['--token=hunter2']),
      'mcpServers[1].args[0]',
      'such as --token ${GITHUB_TOKEN}',
    ],
    [
      'a key-like stdio arg',
      (m) => (server(m, 1).args = ['--profile', HEX_KEY]),
      'mcpServers[1].args[1]',
      'pass the key from the environment',
    ],
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
      'a plain http MCP URL for a host on the network',
      (m) => (server(m, 0).url = 'http://mcp.example.com/mcp'),
      'mcpServers[0].url',
      'http only for localhost',
    ],
    [
      'a plain http MCP URL for a host that starts like localhost',
      (m) => (server(m, 0).url = 'http://localhost.example.com/mcp'),
      'mcpServers[0].url',
      'http only for localhost',
    ],
    [
      'an MCP header name with a line break',
      (m) => (server(m, 0).headers = { 'X-A\r\nB': '${TEAM_ID}' }),
      'mcpServers[0].headers["X-A\\r\\nB"]',
      'HTTP header name',
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
      'an MCP server name with a dot',
      (m) => (server(m, 0).name = 'docs.site'),
      'mcpServers[0].name',
      'letters',
    ],
  ])('rejects %s', (_name, change, location, fix) => {
    const error = load(change);
    expect(error.location).toBe(location);
    expect(error.message).toContain(`modules/rich/module.json: ${location}: `);
    expect(error.hint).toContain(fix);
  });

  it.each(['http://localhost:6006/mcp', 'http://127.0.0.1:3845/mcp', 'http://[::1]/mcp'])(
    'accepts the plain http MCP URL %s of a server on this machine',
    (address) => {
      const manifest = richManifest();
      server(manifest, 0).url = address;
      const read = memoryReader({ 'modules/rich/module.json': JSON.stringify(manifest), ...richSources() });
      expect(loadModule('rich', read).manifest.mcpServers[0]).toMatchObject({ url: address });
    },
  );

  it('accepts stdio args that reference keys and project paths, and plain names and versions', () => {
    const manifest = richManifest();
    server(manifest, 1).command = 'npx';
    server(manifest, 1).args = [
      '-y',
      '@modelcontextprotocol/server-filesystem@2026.1.14',
      '--token',
      '${GITHUB_TOKEN}',
      '--root=${CLAUDE_PROJECT_DIR:-.}/docs',
      '--author',
      'Acme Docs Team',
    ];
    const read = memoryReader({ 'modules/rich/module.json': JSON.stringify(manifest), ...richSources() });
    expect(loadModule('rich', read).manifest.mcpServers[1]).toMatchObject({ args: server(manifest, 1).args });
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

  it('never shows an env or header value it refuses, since that value can be a pasted token', () => {
    const token = `ghp_${'a'.repeat(36)}`;
    const env = load((m) => (server(m, 1).env = { TOKEN: token }));
    const header = load((m) => (server(m, 0).headers = { Authorization: `Bearer ${token}` }));
    for (const error of [env, header]) {
      expect(error.message).not.toContain(token);
      expect(error.message).toContain('does not have the required form');
    }
  });
});
