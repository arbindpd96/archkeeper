import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ALLOW_PRAGMA = 'archkeeper:allow-secret';
const MAX_ON_DISK_BYTES = 1_000_000;

const SECRET_PATTERNS = [
  { name: 'AWS access key', pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'AWS secret key', pattern: /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/i },
  { name: 'GitHub token', pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', pattern: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'Slack token', pattern: /\b(xox[abprs]-[A-Za-z0-9-]{10,}|xapp-\d-[A-Za-z0-9-]{10,})/ },
  { name: 'Slack webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/ },
  { name: 'Stripe secret', pattern: /\b([sr]k_live_[0-9a-zA-Z]{24,}|whsec_[A-Za-z0-9]{24,})/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}|_authToken\s*=\s*[^\s$]{8,}/ },
  { name: 'private key', pattern: /-----BEGIN ([A-Z]+ )*PRIVATE KEY( BLOCK)?-----/ },
  { name: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    name: 'credentialed URL',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:(?![$<{]|(password|pass|secret|changeme)@)[^\s@/]{3,}@/i,
  },
];

/** Collects every string the tool call would write into the file. */
function writtenText(toolInput) {
  const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
  return [
    toolInput.content,
    toolInput.new_string,
    toolInput.new_source,
    ...edits.map((edit) => edit?.new_string),
  ]
    .filter((value) => typeof value === 'string')
    .join('\n');
}

/** Builds a PreToolUse permission response. */
function decide(permissionDecision, reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: `archkeeper guard: ${reason}`,
    },
  };
}

/** Names the secret rules that match a line. */
function secretsIn(line) {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(line)).map(({ name }) => name);
}

/** Returns the lines of the target file; none when it is missing, too large, a symlink or outside the project. */
function linesOnDisk(target, { projectDir, isProjectFile }) {
  if (typeof target !== 'string') return new Set();
  const file = path.resolve(projectDir, target);
  try {
    if (!isProjectFile(file) || statSync(file).size > MAX_ON_DISK_BYTES) return new Set();
    return new Set(readFileSync(file, 'utf8').split(/\r?\n/));
  } catch {
    return new Set();
  }
}

/** Returns the permission response for a write, or null when the write is safe. */
function evaluate(toolInput, helpers) {
  const target = toolInput.file_path ?? toolInput.notebook_path;
  const fileName = typeof target === 'string' ? path.basename(target) : '';
  if (helpers.isEnvFileName(fileName)) {
    return decide('ask', `${fileName} holds secrets. Confirm with the user before editing it.`);
  }
  const lines = writtenText(toolInput)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
  const leaks = lines.filter((line) => !line.includes(ALLOW_PRAGMA)).flatMap(secretsIn);
  if (leaks.length > 0) {
    return decide(
      'deny',
      `possible ${[...new Set(leaks)].join(', ')} in written content. Use an env var instead.`,
    );
  }
  // An agent could add the pragma to its own secret, so only a line already in the file keeps its exemption.
  const onDisk = linesOnDisk(target, helpers);
  const newPragmaLines = lines.filter(
    (line) => line.includes(ALLOW_PRAGMA) && secretsIn(line).length > 0 && !onDisk.has(line),
  );
  if (newPragmaLines.length === 0) return null;
  return decide(
    'ask',
    `a new line marks a likely secret with ${ALLOW_PRAGMA}. Confirm with the user that it is a fixture.`,
  );
}

try {
  const [{ readInput, respond, projectDir, isProjectFile }, { isEnvFileName }] = await Promise.all([
    import('./lib.mjs'),
    import('./env-files.mjs'),
  ]);
  const response = evaluate(readInput().tool_input ?? {}, { isEnvFileName, isProjectFile, projectDir });
  if (response) respond(response);
} catch {
  // Fail closed: if the hook cannot load or crashes, the write must not go through unchecked.
  process.stdout.write(JSON.stringify(decide('ask', 'could not inspect this write. Confirm with the user.')));
}
