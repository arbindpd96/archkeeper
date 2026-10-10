import { describe, expect, it } from 'vitest';
import { TEST_BRAND } from './kit-fixtures.js';
import { agentProblems, claudeMdProblems, settingsProblems, skillProblems } from './static-rules.js';

const SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';
const GUARD = `\${CLAUDE_PROJECT_DIR}/${TEST_BRAND.hookDir}/guard-bash.mjs`;

function settings(value: Record<string, unknown>): string {
  return JSON.stringify({ $schema: SCHEMA, ...value });
}

function hook(event: string, handler: Record<string, unknown>): string {
  return settings({ hooks: { [event]: [{ hooks: [{ type: 'command', timeout: 10, ...handler }] }] } });
}

describe('the generated-settings rules (ADR-0015)', () => {
  it('pass exec-form hooks and deny rules under the SchemaStore $schema', () => {
    const text = settings({
      permissions: { deny: ['Bash(rm -rf:*)'] },
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'node', args: [GUARD], if: 'Bash(git *)' }],
          },
        ],
      },
    });
    expect(settingsProblems(text, TEST_BRAND)).toEqual([]);
  });

  it.each([
    ['no $schema', JSON.stringify({ permissions: {} }), 'no SchemaStore $schema'],
    ['a model id', settings({ model: 'claude-opus-5' }), 'settings set model'],
    ['autoMode', settings({ autoMode: { allow: [] } }), 'settings set autoMode'],
    ['enabledMcpServers', settings({ enabledMcpServers: ['x'] }), 'settings set enabledMcpServers'],
    ['permissions.defaultMode', settings({ permissions: { defaultMode: 'acceptEdits' } }), 'defaultMode'],
    ['a shell-form hook', hook('Stop', { command: `node ${GUARD}` }), 'not exec form'],
    [
      'a hook outside the kit folder',
      hook('Stop', { command: 'node', args: ['/tmp/x.mjs'] }),
      'not exec form',
    ],
    ['once', hook('Stop', { command: 'node', args: [GUARD], once: true }), 'sets shell or once'],
    [
      'if on a non-tool event',
      hook('SessionStart', { command: 'node', args: [GUARD], if: 'Bash(x)' }),
      'non-tool event',
    ],
  ])('refuse %s', (_name, text, problem) => {
    expect(settingsProblems(text, TEST_BRAND).join('\n')).toContain(problem);
  });
});

describe('the CLAUDE.md rules', () => {
  it('pass a short file with one import, wherever it sits', () => {
    expect(claudeMdProblems('# Notes\r\n\r\n@AGENTS.md\r\n')).toEqual([]);
  });

  it.each([
    ['no import', '# Notes\n', 'imports AGENTS.md 0 times'],
    ['two imports', '@AGENTS.md\n\n@./AGENTS.md\n', 'imports AGENTS.md 2 times'],
    ['an import only in a code span', 'Write `@AGENTS.md`.\n', 'imports AGENTS.md 0 times'],
    ['100 lines', `@AGENTS.md\n${'line\n'.repeat(99)}`, 'has 100 lines or more'],
  ])('refuse %s', (_name, text, problem) => {
    expect(claudeMdProblems(text)).toContain(`CLAUDE.md ${problem}`);
  });
});

describe('the skill and agent frontmatter allowlists (ADR-0015)', () => {
  const skill = (fields: string, body = 'Search docs/decisions.md.\n'): string =>
    `---\n${fields}\n---\n\n${body}`;
  const agent = (fields: string): string =>
    `---\nname: reviewer\ndescription: Reviews.\n${fields}\n---\n\nReview.\n`;

  it('pass a skill of allowed keys whose tools only read or run one exact command', () => {
    const text = skill(
      'name: why\ndescription: Explain a decision.\nallowed-tools:\n  - Read\n  - Grep\n  - Bash(git log --oneline)',
    );
    expect(skillProblems(text)).toEqual([]);
  });

  it.each([
    ['hooks', 'name: x\nhooks: {}', 'skill key hooks'],
    ['mcpServers', 'name: x\nmcpServers: {}', 'skill key mcpServers'],
    ['a wildcard Bash rule', 'allowed-tools: Bash(git log:*)', 'wildcard'],
    ['a shell', 'allowed-tools: Bash(bash scripts/x.sh)', 'lets bash run anything'],
    ['a package runner', 'allowed-tools: Bash(npm exec prettier)', 'run anything'],
    ['a flag that writes', 'allowed-tools: Bash(git log --output=x)', 'writes or runs'],
    ['Edit', 'allowed-tools: Read, Edit', 'allowed-tools lists Edit'],
  ])('refuse a skill with %s', (_name, fields, problem) => {
    expect(skillProblems(skill(fields)).join('\n')).toContain(problem);
  });

  it('refuses a load-time command in a skill body', () => {
    expect(skillProblems(skill('name: x', 'Status: !`git status`\n'))).toContain(
      'the skill runs a command at load time',
    );
  });

  it('passes an agent with explicit tools and allowed values', () => {
    expect(
      agentProblems(agent('tools: Read, Grep, Bash\nmodel: sonnet\npermissionMode: plan\nmemory: project')),
    ).toEqual([]);
  });

  it.each([
    ['no tools', 'model: opus', 'lists no tools'],
    ['a model id', 'tools: Read\nmodel: claude-opus-5', 'model is claude-opus-5'],
    ['bypassPermissions', 'tools: Read\npermissionMode: bypassPermissions', 'permissionMode is'],
    ['user memory', 'tools: Read\nmemory: user', 'memory is user'],
    ['hooks', 'tools: Read\nhooks: {}', 'agent key hooks'],
  ])('refuse an agent with %s', (_name, fields, problem) => {
    expect(agentProblems(agent(fields)).join('\n')).toContain(problem);
  });
});
