import type { Finding } from './errors.js';
import { jsonPath } from './issues.js';
import { GITIGNORE_FILE, MCP_FILE, type ModuleManifest, SETTINGS_FILE } from './manifest-schema.js';

type Rule = (manifest: ModuleManifest) => Finding | undefined;

const PLUGIN_FOLDERS = ['.claude/skills/', '.claude/agents/'];

function finding(path: readonly PropertyKey[], problem: string, hint: string): Finding {
  return { location: jsonPath(path), problem, hint };
}

function firstDuplicate(values: readonly string[]): { index: number; first: number } | undefined {
  const seen = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    const first = seen.get(value);
    if (first !== undefined) return { index, first };
    seen.set(value, index);
  }
  return undefined;
}

const demoOrInternal: Rule = ({ demo, internal }) => {
  if ((demo === undefined) !== (internal === undefined)) return undefined;
  const problem =
    demo === undefined ? 'declares neither demo nor internal' : 'declares both demo and internal';
  return finding(
    demo === undefined ? [] : ['internal'],
    problem,
    'declare demo {tape, section} for a user-facing module, or internal: true for one without its own feature',
  );
};

const uniqueLists: Rule = (manifest) => {
  const lists = {
    requires: manifest.requires,
    conflicts: manifest.conflicts,
    presets: manifest.presets,
    files: manifest.files.map((entry) => entry.to),
    blocks: manifest.blocks.map((entry) => `${entry.file}#${entry.id}`),
    hooks: manifest.hooks.map((entry) => `${entry.event} ${entry.script}`),
    mcpServers: manifest.mcpServers.map((entry) => entry.name),
    'permissions.allow': manifest.permissions.allow ?? [],
    'permissions.ask': manifest.permissions.ask ?? [],
    'permissions.deny': manifest.permissions.deny ?? [],
  };
  for (const [name, values] of Object.entries(lists)) {
    const duplicate = firstDuplicate(values);
    if (duplicate === undefined) continue;
    const path = [...name.split('.'), duplicate.index];
    return finding(path, `repeats entry ${String(duplicate.first)}`, 'list each entry once');
  }
  return undefined;
};

const noSelfReference: Rule = ({ id, requires, conflicts }) => {
  const required = requires.indexOf(id);
  if (required !== -1) return finding(['requires', required], 'names the module itself', 'remove it');
  const conflicting = conflicts.indexOf(id);
  if (conflicting !== -1) return finding(['conflicts', conflicting], 'names the module itself', 'remove it');
  const both = requires.findIndex((other) => conflicts.includes(other));
  if (both === -1) return undefined;
  return finding(
    ['conflicts', conflicts.indexOf(requires[both] ?? '')],
    'is also in requires',
    'keep it in one list',
  );
};

const pluginTargets: Rule = ({ files }) => {
  const index = files.findIndex(
    (entry) => entry.target === 'plugin' && !PLUGIN_FOLDERS.some((folder) => entry.to.startsWith(folder)),
  );
  if (index === -1) return undefined;
  return finding(
    ['files', index, 'target'],
    'is plugin for a file outside .claude/skills/ and .claude/agents/',
    'use project: the plugin carries only skills and agents (ADR-0016)',
  );
};

function declares(manifest: ModuleManifest, strategy: 'blocks' | 'json', to: string): boolean {
  return manifest.files.some((entry) => entry.strategy === strategy && entry.to === to);
}

const blocksDeclared: Rule = (manifest) => {
  const index = manifest.blocks.findIndex((entry) => !declares(manifest, 'blocks', entry.file));
  if (index === -1) return undefined;
  return finding(
    ['blocks', index, 'file'],
    'is not declared in files with the blocks strategy',
    `add {to: "${manifest.blocks[index]?.file ?? ''}", strategy: "blocks", target: "project"} to files`,
  );
};

function undeclaredJson(manifest: ModuleManifest): { field: string; file: string } | undefined {
  const { hooks, permissions, mcpServers } = manifest;
  const hasRules = [permissions.allow, permissions.ask, permissions.deny].some(
    (list) => (list ?? []).length > 0,
  );
  if (hooks.length > 0 && !declares(manifest, 'json', SETTINGS_FILE)) {
    return { field: 'hooks', file: SETTINGS_FILE };
  }
  if (hasRules && !declares(manifest, 'json', SETTINGS_FILE)) {
    return { field: 'permissions', file: SETTINGS_FILE };
  }
  if (mcpServers.length > 0 && !declares(manifest, 'json', MCP_FILE)) {
    return { field: 'mcpServers', file: MCP_FILE };
  }
  return undefined;
}

const jsonDeclared: Rule = (manifest) => {
  const missing = undeclaredJson(manifest);
  if (missing === undefined) return undefined;
  return finding(
    [missing.field],
    `needs ${missing.file} declared in files with the json strategy`,
    `add {to: "${missing.file}", strategy: "json", target: "project"} to files`,
  );
};

const gitignoreDeclared: Rule = (manifest) => {
  if (manifest.gitignore.length === 0) return undefined;
  if (!declares(manifest, 'blocks', GITIGNORE_FILE)) {
    return finding(
      ['gitignore'],
      `needs ${GITIGNORE_FILE} declared in files with the blocks strategy`,
      `add {to: "${GITIGNORE_FILE}", strategy: "blocks", target: "project"} to files`,
    );
  }
  const clash = manifest.blocks.findIndex(
    (entry) => entry.file === GITIGNORE_FILE && entry.id === manifest.id,
  );
  if (clash === -1) return undefined;
  return finding(
    ['blocks', clash, 'id'],
    'is the block the gitignore lines go to',
    'give this block another id',
  );
};

function whenOptionFinding(
  manifest: ModuleManifest,
  when: ModuleManifest['when'],
  path: readonly PropertyKey[],
): Finding | undefined {
  for (const [name, value] of Object.entries(when?.options ?? {})) {
    const spec = manifest.options[name];
    const location = [...path, 'options', name];
    if (spec === undefined) {
      const known = Object.keys(manifest.options).join(', ') || 'none yet';
      return finding(
        location,
        'is not an option of this module',
        `declare it in options (declared: ${known})`,
      );
    }
    if (spec.type !== typeof value) {
      return finding(
        location,
        `is compared with a ${typeof value}`,
        `compare it with a ${spec.type}, its option type`,
      );
    }
  }
  return undefined;
}

const whenOptions: Rule = (manifest) => {
  const own = whenOptionFinding(manifest, manifest.when, ['when']);
  if (own !== undefined) return own;
  for (const [index, entry] of manifest.files.entries()) {
    const result = whenOptionFinding(manifest, entry.when, ['files', index, 'when']);
    if (result !== undefined) return result;
  }
  return undefined;
};

const RULES: readonly Rule[] = [
  demoOrInternal,
  uniqueLists,
  noSelfReference,
  pluginTargets,
  blocksDeclared,
  jsonDeclared,
  gitignoreDeclared,
  whenOptions,
];

/** Returns the first cross-field rule a schema-valid manifest breaks, or undefined when it breaks none. */
export function manifestRuleFinding(manifest: ModuleManifest): Finding | undefined {
  for (const rule of RULES) {
    const result = rule(manifest);
    if (result !== undefined) return result;
  }
  return undefined;
}
