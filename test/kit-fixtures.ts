import type { ReadKitFile } from '../src/core/loader.js';

/** A module manifest as plain JSON data, for tests to change before loading. */
export type ManifestData = Record<string, unknown>;

/** The object at `manifest[field][key]`, for a test to change in place; throws when there is none. */
export function entry(manifest: ManifestData, field: string, key: number | string): Record<string, unknown> {
  const container = manifest[field] as Record<number | string, unknown> | undefined;
  const value = container?.[key];
  if (typeof value !== 'object' || value === null) {
    throw new Error(`No ${field}[${String(key)}] in the manifest.`);
  }
  return value as Record<string, unknown>;
}

/** A reader over an in-memory map of package-relative paths, as the CLI's file reader would see them. */
export function memoryReader(files: Readonly<Record<string, string>>): ReadKitFile {
  return (path) => files[path];
}

/** The presets file of v0.1: small ⊂ medium ⊂ full with their SessionStart caps. */
export const PRESETS = {
  default: 'medium',
  presets: [
    { name: 'small', description: 'Small.', defaults: { sessionStartCap: 1200 } },
    { name: 'medium', description: 'Medium.', defaults: { sessionStartCap: 3000 } },
    { name: 'full', description: 'Full.', defaults: { sessionStartCap: 4000 } },
  ],
};

/** A manifest that uses every field, so a test can break one field at a time. */
export function richManifest(): ManifestData {
  return {
    $schema: '../../schema/module.schema.json',
    schemaVersion: 1,
    id: 'rich',
    description: 'Uses every manifest field.',
    requires: ['base'],
    presets: ['medium', 'full'],
    files: [
      { from: 'skill.md', to: '.claude/skills/why/SKILL.md', strategy: 'owned', target: 'plugin' },
      {
        from: 'notes.md',
        to: 'docs/notes.md',
        strategy: 'create-only',
        target: 'project',
        when: { stack: ['python'], options: { blockNoVerify: true } },
      },
      { to: 'AGENTS.md', strategy: 'blocks', target: 'project' },
      { to: '.gitignore', strategy: 'blocks', target: 'project' },
      { to: '.claude/settings.json', strategy: 'json', target: 'project' },
      { to: '.mcp.json', strategy: 'json', target: 'project' },
    ],
    blocks: [{ file: 'AGENTS.md', id: 'rules', template: 'agents.md' }],
    hooks: [
      {
        event: 'PreToolUse',
        matcher: 'Bash',
        script: 'dist/hooks/guard-bash.mjs',
        timeout: 10,
        if: 'Bash(git *)',
      },
      { event: 'SessionStart', matcher: 'startup', script: 'dist/hooks/session-start.mjs', timeout: 10 },
    ],
    permissions: { deny: ['Bash(rm -rf:*)'] },
    gitignore: ['CLAUDE.local.md'],
    options: {
      blockNoVerify: { type: 'boolean', default: false, description: 'Deny git commit --no-verify.' },
      optOut: { type: 'string-list', default: [], description: 'Rules removed on purpose.' },
    },
    mcpServers: [
      { name: 'docs', type: 'http', url: 'https://example.com/mcp', headers: { 'X-Team': '${TEAM_ID}' } },
      {
        name: 'graph',
        type: 'stdio',
        command: 'graph-mcp',
        args: ['--root', '${CLAUDE_PROJECT_DIR:-.}'],
        env: { TOKEN: '${GRAPH_TOKEN}' },
      },
    ],
    internal: true,
  };
}

/** The files `richManifest` references, keyed by package-relative path. */
export function richSources(id = 'rich'): Record<string, string> {
  return {
    [`modules/${id}/files/skill.md`]: '# Why\n',
    [`modules/${id}/files/notes.md`]: '# Notes\n',
    [`modules/${id}/files/agents.md`]: 'Rules for {{brand.displayName}}.\n',
    'dist/hooks/guard-bash.mjs': 'export {};\n',
    'dist/hooks/session-start.mjs': 'export {};\n',
  };
}

/** A minimal internal manifest for module `id`. */
export function plainManifest(id: string, fields: ManifestData = {}): ManifestData {
  return { schemaVersion: 1, id, description: `The ${id} module.`, internal: true, ...fields };
}

/** The kit files for a set of manifests plus `modules/presets.json`. */
export function kitFiles(
  manifests: readonly ManifestData[],
  extra: Record<string, string> = {},
): Record<string, string> {
  const files: Record<string, string> = { 'modules/presets.json': JSON.stringify(PRESETS), ...extra };
  for (const manifest of manifests) {
    files[`modules/${String(manifest.id)}/module.json`] = JSON.stringify(manifest);
  }
  return files;
}
