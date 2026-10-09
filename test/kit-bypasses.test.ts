import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { ManifestError, RenderError } from '../src/core/errors.js';
import { importProblem } from '../src/core/imports.js';
import { type KitModule, loadModule } from '../src/core/loader.js';
import { render } from '../src/core/render.js';
import { toImport } from '../src/core/template.js';
import {
  entry,
  type ManifestData,
  memoryReader,
  plainManifest,
  richManifest,
  richSources,
} from './kit-fixtures.js';

type Change = (manifest: ManifestData) => void;

function loadRich(change: Change): ReturnType<typeof loadModule> {
  const manifest = richManifest();
  change(manifest);
  return loadModule(
    'rich',
    memoryReader({ 'modules/rich/module.json': JSON.stringify(manifest), ...richSources() }),
  );
}

function refusal(change: Change): ManifestError {
  try {
    loadRich(change);
  } catch (error) {
    if (error instanceof ManifestError) return error;
    throw error;
  }
  throw new Error('the manifest loaded without an error');
}

const stdio = (m: ManifestData): Record<string, unknown> => entry(m, 'mcpServers', 1);

describe('MCP stdio values that hide a credential', () => {
  it.each<[string, string[], string]>([
    ['a camelCase token flag', ['--accessToken', 'hunter2'], 'args[1]'],
    ['a camelCase secret flag with =', ['--clientSecret=hunter2'], 'args[0]'],
    ['a passphrase flag', ['--passphrase', 'hunter2'], 'args[1]'],
    ['a camelCase NAME=value pair', ['apiToken=hunter2'], 'args[0]'],
    ['a pair inside a flag value', ['--env=API_KEY=hunter2'], 'args[0]'],
    ['an Authorization header argument', ['--header', 'Authorization: Bearer hunter2'], 'args[1]'],
    ['a Bearer value after any flag', ['--x', 'Bearer hunter2'], 'args[1]'],
    ['a header with a space before its colon', ['-H', 'Authorization : Bearer hunter2'], 'args[1]'],
    ['a cookie header', ['-H', 'Cookie: session=hunter2'], 'args[1]'],
    ['a key in a URL query argument', ['https://mcp.example.com/sse?api_key=hunter2'], 'args[0]'],
    ['a token in a --url= query', ['--url=https://mcp.example.com/sse?token=hunter2'], 'args[0]'],
    ['a key in a JSON argument', ['{"apiKey": "hunter2"}'], 'args[0]'],
    ['a key in JSON that also holds a URL query', ['{"url":"https://x/?a=b","apiKey":"hunter2"}'], 'args[0]'],
    ['a key in a JSON array', ['[{"token": "hunter2"}]'], 'args[0]'],
    ['a key after a ; query separator', ['https://mcp.example.com/sse?a=b;token=hunter2'], 'args[0]'],
    ['a plural secrets flag', ['--secrets', 'hunter2'], 'args[1]'],
    ['a numbered key flag', ['--key2', 'hunter2'], 'args[1]'],
    ['a pw flag', ['--pw', 'hunter2'], 'args[1]'],
  ])('refuses %s', (_name, args, location) => {
    expect(refusal((m) => (stdio(m).args = args)).location).toBe(`mcpServers[1].${location}`);
  });

  it.each(['bin\\graph-mcp', '.\\graph-mcp.exe', '${PWD}/bin/graph-mcp'])(
    'refuses the stdio command %j, which resolves from where Claude Code started',
    (command) => {
      expect(refusal((m) => (stdio(m).command = command)).hint).toContain('${CLAUDE_PROJECT_DIR:-.}/<path>');
    },
  );

  it.each(['toString', 'hasOwnProperty', 'valueOf'])(
    'refuses the inherited object name %j for a server',
    (name) => {
      expect(refusal((m) => (entry(m, 'mcpServers', 0).name = name)).hint).toBe('choose another name');
    },
  );

  it('accepts a referenced Bearer value, a project command and plain words', () => {
    const loaded = loadRich((m) => {
      stdio(m).command = '${CLAUDE_PROJECT_DIR:-.}/bin/graph-mcp';
      stdio(m).args = [
        '--author',
        'Acme',
        '--header',
        'Authorization: Bearer ${API_TOKEN}',
        'https://x.example/sse?team=acme&token=${TOKEN}',
      ];
    });
    expect(loaded.manifest.mcpServers).toHaveLength(2);
  });

  it('checks a header-shaped argument padded with spaces in linear time', () => {
    const started = performance.now();
    loadRich((m) => (stdio(m).args = [`a:${' '.repeat(100_000)}x\n`]));
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('checks a value with thousands of unclosed ${ in linear time', () => {
    const started = performance.now();
    loadRich((m) => (entry(m, 'mcpServers', 0).url = `https://x.example/${'${'.repeat(40_000)}`));
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('template targets that Claude Code reads from a subfolder or as secrets', () => {
  it.each<[string, string]>([
    ['pkg/.claude/settings.json', 'in a subfolder'],
    ['pkg/.mcp.json', 'in a subfolder'],
    ['pkg/.claude/settings.local.json', 'never writes personal settings'],
    ['deploy/app.env', 'which holds secrets'],
    ['.env-local', 'which holds secrets'],
    ['.env_prod', 'which holds secrets'],
    [`x${BRAND.sidecarSuffix}/y.md`, "the suffix of the kit's sidecars"],
  ])('refuses %j', (to, reason) => {
    expect(refusal((m) => (entry(m, 'files', 1).to = to)).message).toContain(reason);
  });

  it('refuses a name ending in the sidecar suffix of a legacy slug', () => {
    const module = loadModule(
      'm',
      memoryReader({
        'modules/m/module.json': JSON.stringify(
          plainManifest('m', {
            files: [{ from: 'a.md', to: 'a.md.oldkit-new', strategy: 'owned', target: 'project' }],
          }),
        ),
        'modules/m/files/a.md': 'A\n',
      }),
    );
    expect(() => render([module], { stack: [] }, { ...BRAND, legacySlugs: ['oldkit'] })).toThrow(
      'taken for one',
    );
  });
});

describe('@ imports the kit never writes', () => {
  it.each([
    '`a`@~/.ssh/id_rsa',
    '*a*@/etc/passwd',
    '_a_@C:/x.md',
    '[a](b)@../../x.md',
    'see@docs/../../x.md',
  ])('finds an import of an outside file in %j', (text) => {
    expect(importProblem(text)).toContain('outside the project');
  });

  it.each([
    'jest @.env',
    '@./.env',
    '@config/.env.local',
    '`x`@CLAUDE.local.md',
    '@.claude/settings.local.json',
    '[@.env](x)',
    'npm test @.env#x',
    '@.env/',
    '@./.env/.',
    '*@.env*',
    '<b>@.env</b>',
    '`x`@.env`y`',
    '@.env<!-- -->',
    '@.env\\ ',
    '@deploy/app.env#',
    '@.envrc/',
    '@.claude//settings.local.json',
    '<!---->@.<!---->env',
    '@.env.example.local',
  ])('finds an import of a private file in %j', (text) => {
    expect(importProblem(text)).toContain('secrets or personal file');
  });

  it.each([
    '@AGENTS.md',
    'npm i @scope/pkg',
    'mail me@example.com',
    '@Design\\ Docs/api.md',
    '@.env.example',
    '@docs/environment.md',
  ])('allows %j', (text) => {
    expect(importProblem(text)).toBeUndefined();
  });

  it('refuses an @ import with a non-ASCII name, which macOS can fold onto a private file', () => {
    expect(importProblem('@.claude/\u017Fettings.local.json')).toContain('non-ASCII');
    expect(() => toImport('.claude/\u017Fettings.local.json')).toThrow(RenderError);
  });

  it('refuses an @ import with a ~, which Windows can read as an 8.3 short name', () => {
    expect(importProblem('@ENV~1')).toContain('short name');
  });

  it('finds an outside import that an HTML comment splits', () => {
    expect(importProblem('<!---->@.<!---->./.ssh/id_rsa')).toContain('outside the project');
  });

  it.each(['.env', 'docs/.env.local', 'Design Docs/.env', '.env#x'])(
    'toImport refuses the private file %j',
    (path) => {
      expect(() => toImport(path)).toThrow(RenderError);
    },
  );

  it('refuses an import that two values form only side by side', () => {
    const notes: KitModule = loadModule(
      'm',
      memoryReader({
        'modules/m/module.json': JSON.stringify(
          plainManifest('m', { files: [{ from: 'a.md', to: 'a.md', strategy: 'owned', target: 'project' }] }),
        ),
        'modules/m/files/a.md': 'Run {{cmd.a}}{{cmd.b}}\n',
      }),
    );
    const values = { cmd: { a: 'npm test @', b: '~/.ssh/id_rsa' } };
    expect(() => render([notes], { stack: [], values })).toThrow(
      'a.md: would get an @ import of a file outside',
    );
  });
});
