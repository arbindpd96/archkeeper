import path from 'node:path';
import { readInput, respond } from './lib.mjs';

const ALLOW_PRAGMA = 'codekit:allow-secret';

const SECRET_PATTERNS = [
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', pattern: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe live key', pattern: /\b[sr]k_live_[0-9a-zA-Z]{24,}/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'private key', pattern: /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/ },
];

const ENV_FILE = /^\.env(\..+)?$/;

/** Collects every string the tool call would write into the file. */
function writtenText(toolInput) {
  const edits = toolInput.edits ?? [];
  return [toolInput.content, toolInput.new_string, toolInput.new_source, ...edits.map((e) => e.new_string)]
    .filter((value) => typeof value === 'string')
    .join('\n');
}

/** Builds a PreToolUse permission response. */
function decide(permissionDecision, reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: `claude-codekit guard: ${reason}`,
    },
  };
}

const toolInput = readInput().tool_input ?? {};
const fileName = path.basename(toolInput.file_path ?? toolInput.notebook_path ?? '');

if (ENV_FILE.test(fileName) && fileName !== '.env.example') {
  respond(decide('ask', `${fileName} holds secrets. Confirm with the user before editing it.`));
} else {
  const leaks = writtenText(toolInput)
    .split('\n')
    .filter((line) => !line.includes(ALLOW_PRAGMA))
    .flatMap((line) => SECRET_PATTERNS.filter(({ pattern }) => pattern.test(line)).map(({ name }) => name));

  if (leaks.length > 0) {
    const kinds = [...new Set(leaks)].join(', ');
    respond(decide('deny', `possible ${kinds} in written content. Use an env var instead.`));
  }
}
