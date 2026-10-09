import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BRAND, type Brand } from '../src/core/brand.js';
import { RenderError } from '../src/core/errors.js';
import { type KitModule, loadModule, type ReadKitFile } from '../src/core/loader.js';
import { render, type RenderContext, type RenderTree } from '../src/core/render.js';
import { toImport } from '../src/core/template.js';
import { git, REPO_ROOT } from './helpers.js';

const FIXTURE = path.join(REPO_ROOT, 'test/fixtures/render');

// dist/ is gitignored everywhere, so the fixture keeps its hook bundles in hook-bundles/.
const readFixture: ReadKitFile = (file) => {
  const local = path.join(FIXTURE, file.replace(/^dist\/hooks\//, 'hook-bundles/'));
  return existsSync(local) ? readFileSync(local, 'utf8') : undefined;
};
const MODULES: readonly KitModule[] = ['core-docs', 'guard', 'servers'].map((id) =>
  loadModule(id, readFixture),
);
const CONTEXT: RenderContext = {
  stack: ['ts', 'python'],
  values: { imports: { agents: toImport('AGENTS.md'), design: toImport('Design Docs/api.md') } },
};

const ACME: Brand = Object.freeze({
  npmName: 'acmekit',
  binName: 'acmekit',
  displayName: 'Acme Kit',
  pluginName: 'acmekit',
  marketplaceName: 'acmekit',
  markerPrefix: 'acmekit',
  stateDir: '.acmekit',
  hookDir: '.claude/hooks/acmekit',
  rulesDir: '.claude/rules/acmekit',
  sidecarSuffix: '.acmekit-new',
  disclaimer: 'Acme Kit is a test brand.',
  legacySlugs: Object.freeze([]),
});

/** The whole tree as text: one header per entry, then its content. */
function treeText(tree: RenderTree): string {
  return [...tree]
    .flatMap(([file, entries]) =>
      entries.map((entry) => {
        const owner = entry.blockId === undefined ? entry.module : `${entry.module}#${entry.blockId}`;
        return `=== ${file} [${entry.strategy} ${owner}]\n${entry.content}`;
      }),
    )
    .join('');
}

function entry(tree: RenderTree, file: string, index = 0): string {
  const content = tree.get(file)?.[index]?.content;
  if (content === undefined) throw new Error(`No entry ${String(index)} at ${file}.`);
  return content;
}

describe('render', () => {
  // The snapshot uses the test brand, so check-brand finds no slug in it and a rename leaves it unchanged.
  it('renders the fixture modules to the committed snapshot on every OS', async () => {
    await expect(treeText(render(MODULES, CONTEXT, ACME))).toMatchFileSnapshot(
      '__snapshots__/render-tree.txt',
    );
  });

  it('renders the same bytes twice and in any module order', () => {
    const expected = treeText(render(MODULES, CONTEXT));
    expect(treeText(render(MODULES, CONTEXT))).toBe(expected);
    fc.assert(
      fc.property(fc.shuffledSubarray([...MODULES], { minLength: MODULES.length }), (shuffled) => {
        expect(treeText(render(shuffled, CONTEXT))).toBe(expected);
      }),
    );
  });

  it('writes LF text with a trailing newline and no absolute path', () => {
    for (const [file, entries] of render(MODULES, CONTEXT)) {
      for (const { content } of entries) {
        expect(content, file).not.toContain('\r');
        expect(content.endsWith('\n'), file).toBe(true);
        expect(content, file).not.toContain(REPO_ROOT);
        expect(content, file).not.toContain(tmpdir());
      }
    }
  });

  it('contains no trace of the real slug when rendered for another brand', () => {
    const text = treeText(render(MODULES, CONTEXT, ACME));
    expect(text).not.toContain(BRAND.npmName);
    expect(text).toContain('=== .claude/hooks/acmekit/guard.mjs [owned guard]');
    expect(text).toContain('=== .claude/rules/acmekit/guard.md [owned guard]');
    expect(text).toContain('.acmekit/local/');
  });

  it('builds settings.json entries as exec-form hooks and deny rules with a stable key order', () => {
    const settings = JSON.parse(entry(render(MODULES, CONTEXT), '.claude/settings.json')) as {
      hooks: Record<string, { matcher?: string; hooks: Record<string, unknown>[] }[]>;
      permissions: Record<string, string[]>;
    };
    expect(Object.keys(settings)).toEqual(['hooks', 'permissions']);
    expect(Object.keys(settings.hooks)).toEqual(['SessionStart', 'PreToolUse']);
    const [handler] = settings.hooks.PreToolUse?.[0]?.hooks ?? [];
    expect(handler).toEqual({
      type: 'command',
      command: 'node',
      args: [`\${CLAUDE_PROJECT_DIR}/${BRAND.hookDir}/guard.mjs`],
      timeout: 10,
      if: 'Bash(git *)',
    });
    expect(Object.keys(handler ?? {})).toEqual(['type', 'command', 'args', 'timeout', 'if']);
    expect(settings.permissions).toEqual({ deny: ['Read(**/.env)', 'Bash(rm -rf:*)'] });
  });

  it('installs a hook script once even when it is registered on two events', () => {
    const tree = render(MODULES, CONTEXT);
    expect(tree.get(`${BRAND.hookDir}/guard.mjs`)).toEqual([
      { strategy: 'owned', module: 'guard', content: "export const guard = 'guard';\n" },
    ]);
  });

  it('builds .mcp.json servers with sorted env keys and no other fields', () => {
    const mcp = JSON.parse(entry(render(MODULES, CONTEXT), '.mcp.json')) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(mcp.mcpServers.graph?.env as object)).toEqual(['ALPHA', 'ZETA']);
    expect(mcp.mcpServers.docs).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { 'X-Team': '${TEAM_ID}' },
    });
  });

  it('renders a file only when its when holds', () => {
    const python = `${BRAND.rulesDir}/python.md`;
    expect(render(MODULES, CONTEXT).has(python)).toBe(true);
    expect(render(MODULES, { ...CONTEXT, stack: ['ts'] }).has(python)).toBe(false);
  });

  it('keeps several modules blocks in one file, ordered by block id', () => {
    const blocks = render(MODULES, CONTEXT).get('AGENTS.md') ?? [];
    expect(blocks.map(({ module, blockId }) => [module, blockId])).toEqual([
      ['guard', 'guard'],
      ['core-docs', 'principles'],
    ]);
  });

  it('keeps templates and render snapshots LF in every checkout', () => {
    const files = [
      'modules/base/files/AGENTS.md',
      'test/fixtures/render/a.md',
      'test/__snapshots__/render-tree.txt',
    ];
    const attributes = git(REPO_ROOT, 'check-attr', 'text', 'eol', '--', ...files);
    for (const file of files) {
      expect(attributes).toContain(`${file}: text: set\n`);
      expect(attributes).toContain(`${file}: eol: lf\n`);
    }
  });

  it('refuses a brand whose folders would render a path outside the project', () => {
    const outside: Brand = { ...ACME, rulesDir: '../rules' };
    expect(() => render(MODULES, CONTEXT, outside)).toThrow(RenderError);
    expect(() => render(MODULES, CONTEXT, outside)).toThrow(
      'renders to "../rules/guard.md", which has a ".." segment',
    );
  });
});
