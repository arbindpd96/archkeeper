import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { importsOf } from '../scripts/context-rules.mjs';
import type { Brand } from '../src/core/brand.js';

const SETTINGS_SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const FORBIDDEN_TOP = ['model', 'autoMode', 'enabledMcpServers'];

// ADR-0015's allowlists of generated skill and agent frontmatter.
const SKILL_KEYS = new Set([
  'name',
  'description',
  'disable-model-invocation',
  'user-invocable',
  'allowed-tools',
  'arguments',
  'paths',
]);
const AGENT_KEYS = new Set([
  'name',
  'description',
  'tools',
  'disallowedTools',
  'model',
  'permissionMode',
  'maxTurns',
  'memory',
  'skills',
]);
const AGENT_VALUES: Readonly<Record<string, readonly string[]>> = {
  permissionMode: ['default', 'plan'],
  model: ['inherit', 'sonnet', 'opus', 'haiku'],
  memory: ['project', 'local'],
};
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const RUNNERS = new Set(
  'bash sh zsh fish dash pwsh powershell cmd env xargs sudo doas node python python3 deno bun ruby perl php npx uvx pipx'.split(
    ' ',
  ),
);
const RUNNER_PAIRS = ['npm exec', 'npm run', 'pnpm dlx', 'pnpm exec', 'yarn dlx', 'bunx'];
const RISKY_FLAGS =
  /(?:^|\s)(?:--output|-O|--open-files-in-pager|--ext-diff|--textconv|--exec|--upload-pack|--pre)\b/;

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

function hookProblems(event: string, handler: Json, brand: Brand): string[] {
  const problems: string[] = [];
  const script = new RegExp(String.raw`^\$\{CLAUDE_PROJECT_DIR\}/${brand.hookDir}/[a-z0-9-]+\.mjs$`);
  const args = Array.isArray(handler.args) ? handler.args : [];
  if (handler.command !== 'node' || args.length !== 1 || !script.test(String(args[0]))) {
    problems.push(`a ${event} hook is not exec form: node plus one script path`);
  }
  if ('shell' in handler || 'once' in handler) problems.push(`a ${event} hook sets shell or once`);
  if ('if' in handler && !TOOL_EVENTS.has(event)) {
    problems.push(`a ${event} hook sets if on a non-tool event`);
  }
  return problems;
}

/** Breaks of ADR-0015's generated-settings rules in a settings.json text (reference §1.2, §1.9, §11, §12). */
export function settingsProblems(text: string, brand: Brand): string[] {
  const settings = record(JSON.parse(text));
  const problems = FORBIDDEN_TOP.filter((key) => key in settings).map((key) => `settings set ${key}`);
  if ('defaultMode' in record(settings.permissions)) problems.push('settings set permissions.defaultMode');
  if (settings.$schema !== SETTINGS_SCHEMA) problems.push('settings carry no SchemaStore $schema');
  for (const [event, groups] of Object.entries(record(settings.hooks))) {
    for (const group of Array.isArray(groups) ? groups : []) {
      const handlers = record(group).hooks;
      for (const handler of Array.isArray(handlers) ? handlers : []) {
        problems.push(...hookProblems(event, record(handler), brand));
      }
    }
  }
  return problems;
}

/** Breaks of the CLAUDE.md rules: under 100 lines and exactly one `@AGENTS.md` import (reference §11). */
export function claudeMdProblems(text: string): string[] {
  const problems: string[] = [];
  if (text.split('\n').length >= 100) problems.push('CLAUDE.md has 100 lines or more');
  const imports = importsOf(text.replaceAll('\r', '')).filter(
    (target) => target.replace(/^\.\//, '') === 'AGENTS.md',
  );
  if (imports.length !== 1) problems.push(`CLAUDE.md imports AGENTS.md ${String(imports.length)} times`);
  return problems;
}

/** A simple frontmatter reader: `key: value` lines, and `- item` lines as a list under the key before them. */
export function frontmatterOf(text: string): Map<string, string | string[]> | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  if (block === undefined) return undefined;
  const fields = new Map<string, string | string[]>();
  let last = '';
  for (const line of block.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line)?.[1];
    if (item === undefined) {
      const colon = line.indexOf(':');
      last = line.slice(0, colon).trim();
      fields.set(last, line.slice(colon + 1).trim());
      continue;
    }
    const before = fields.get(last);
    fields.set(last, [...(Array.isArray(before) ? before : []), item]);
  }
  return fields;
}

function toolProblems(tool: string): string[] {
  if (READ_ONLY_TOOLS.has(tool)) return [];
  const command = /^Bash\((.+)\)$/.exec(tool)?.[1];
  if (command === undefined) return [`allowed-tools lists ${tool}`];
  const first = command.split(/\s+/)[0] ?? '';
  if (command.includes('*') || command.includes(':')) return [`allowed-tools has a wildcard in ${tool}`];
  if (RUNNERS.has(first) || RUNNER_PAIRS.some((pair) => command.startsWith(pair))) {
    return [`allowed-tools lets ${first} run anything`];
  }
  return RISKY_FLAGS.test(command) ? [`allowed-tools has a flag that writes or runs: ${tool}`] : [];
}

/** Breaks of ADR-0015's skill frontmatter allowlist, its allowed-tools rules and the no-load-time-command rule. */
export function skillProblems(text: string): string[] {
  const fields = frontmatterOf(text);
  if (fields === undefined) return ['the skill has no frontmatter'];
  const problems = [...fields.keys()].filter((key) => !SKILL_KEYS.has(key)).map((key) => `skill key ${key}`);
  const tools = fields.get('allowed-tools') ?? [];
  const list = Array.isArray(tools) ? tools : tools.split(/,\s*|\s+(?=[A-Z])/).filter(Boolean);
  problems.push(...list.flatMap(toolProblems));
  if (/!`[^`]*`/.test(text)) problems.push('the skill runs a command at load time');
  return problems;
}

/** Breaks of ADR-0015's agent frontmatter allowlist and its allowed values; `tools` must be explicit. */
export function agentProblems(text: string): string[] {
  const fields = frontmatterOf(text);
  if (fields === undefined) return ['the agent has no frontmatter'];
  const problems = [...fields.keys()].filter((key) => !AGENT_KEYS.has(key)).map((key) => `agent key ${key}`);
  for (const [key, allowed] of Object.entries(AGENT_VALUES)) {
    const value = fields.get(key);
    if (typeof value === 'string' && !allowed.includes(value)) problems.push(`agent ${key} is ${value}`);
  }
  if (!fields.has('tools')) problems.push('the agent lists no tools');
  return problems;
}

function filesIn(folder: string, name: RegExp): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && name.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Every static rule ADR-0015 and the roadmap set for a generated setup, over a project the kit just set up. */
export function generatedProblems(dir: string, brand: Brand, settingsAreKits: boolean): string[] {
  const read = (file: string): string => readFileSync(file, 'utf8');
  const settings = path.join(dir, '.claude/settings.json');
  return [
    ...claudeMdProblems(read(path.join(dir, 'CLAUDE.md'))),
    ...(settingsAreKits && existsSync(settings) ? settingsProblems(read(settings), brand) : []),
    ...filesIn(path.join(dir, '.claude/skills'), /^SKILL\.md$/).flatMap((file) => skillProblems(read(file))),
    ...filesIn(path.join(dir, '.claude/agents'), /\.md$/).flatMap((file) => agentProblems(read(file))),
  ];
}
