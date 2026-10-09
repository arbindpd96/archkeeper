import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

const ALLOW_PRAGMA = 'archkeeper:allow-secret';
const MAX_CHECKED_SIZE = 1_000_000;
const MAX_REPLAY_WORK = 50_000_000;

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
  // The lookbehinds start each match once per run of token characters, which keeps the scan linear.
  {
    name: 'JWT',
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    name: 'credentialed URL',
    pattern:
      /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/@]+:(?![$<{]|(password|pass|secret|changeme)@)[^\s@/]{3,}@/i,
  },
];

const NEW_PRAGMA_REASON = `a new line marks a likely secret with ${ALLOW_PRAGMA}. Confirm with the user that it is a fixture.`;

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

/** Names, once each, the secret rules that match any of the lines. */
function secretNames(lines) {
  return [...new Set(lines.flatMap(secretsIn))].join(', ');
}

/** Splits text into lines without their line endings. */
function linesOf(text) {
  return text.split('\n').map((line) => line.replace(/\r$/, ''));
}

/**
 * Finds the file a write targets: `file` resolved against the session's working directory, and `real`, its path
 * with every symlink resolved, or null when it does not exist yet. `cause` says why it cannot be found.
 */
function locate(target, baseDir) {
  if (typeof target !== 'string' || target === '') return { file: '', cause: 'the call names no file' };
  const file = path.resolve(baseDir, target);
  try {
    const exists = lstatSync(file, { throwIfNoEntry: false }) !== undefined;
    return { file, real: exists ? realpathSync(file) : null };
  } catch {
    return { file, cause: 'its path could not be resolved' };
  }
}

/**
 * Reads the target through its real path, wherever that is: `{ text }` ('' when it does not exist yet), or
 * `{ cause }` naming why it cannot be read. Whether a path is inside the project is not decided here, because
 * case-insensitive file systems, firmlinks and hardlinks make a path prefix check unreliable.
 */
function readTarget({ real, cause }, readRegularFile) {
  if (cause) return { cause };
  if (real === null) return { text: '' };
  try {
    const stat = lstatSync(real);
    if (!stat.isFile()) return { cause: 'it is not a regular file' };
    if (stat.size > MAX_CHECKED_SIZE) return { cause: 'it is over 1 MB' };
    const text = readRegularFile(real, MAX_CHECKED_SIZE);
    return text === null ? { cause: 'it changed while being read' } : { text };
  } catch {
    return { cause: 'it could not be read' };
  }
}

/** Asks when the written lines mark a likely secret on a line that is not already in the file `read` returns. */
function judgeMarkedLines(lines, read) {
  const marked = lines.filter((line) => line.includes(ALLOW_PRAGMA) && secretsIn(line).length > 0);
  if (marked.length === 0) return null;
  const found = read();
  if (found.cause) {
    return decide('ask', `could not check the marked line because ${found.cause}. Confirm with the user.`);
  }
  const onDisk = new Set(linesOf(found.text));
  return marked.every((line) => onDisk.has(line)) ? null : decide('ask', NEW_PRAGMA_REASON);
}

/** Returns the edits of an Edit or MultiEdit call, or null for a call that writes whole text. */
function editsOf(toolInput) {
  if (Array.isArray(toolInput.edits)) return toolInput.edits;
  const isEdit = typeof toolInput.old_string === 'string' || typeof toolInput.new_string === 'string';
  return isEdit ? [toolInput] : null;
}

/** Applies one edit as the Edit tool does: `{ text }` with the result, or `{ cause }` naming why it cannot. */
function applyEdit(text, edit) {
  if (typeof edit?.old_string !== 'string' || typeof edit.new_string !== 'string') {
    return { cause: 'an edit has no old_string or new_string' };
  }
  if (!['undefined', 'boolean'].includes(typeof edit.replace_all)) {
    return { cause: 'replace_all is not true or false' };
  }
  const search = edit.old_string.replaceAll('\r\n', '\n');
  const replacement = edit.new_string.replaceAll('\r\n', '\n');
  if (search === '') return text === '' ? { text: replacement } : { cause: 'an old_string is empty' };
  if (!text.includes(search)) return { cause: 'an old_string is not in the file' };
  if (edit.replace_all === true) return { text: text.split(search).join(replacement) };
  return { text: text.replace(search, () => replacement) };
}

/**
 * Returns `{ text }` that the edits leave behind, or `{ cause }`, early once the text is over the size cap or
 * the characters the edits scan, counted as they grow the text, are over the work cap.
 */
function editedText(text, edits) {
  let result = { text };
  let work = 0;
  for (const edit of edits) {
    work += result.text.length + (edit?.old_string?.length ?? 0);
    if (work > MAX_REPLAY_WORK) return { cause: 'its edits are too many to replay in time' };
    result = applyEdit(result.text, edit);
    if (result.cause) return result;
    if (result.text.length > MAX_CHECKED_SIZE) return { cause: 'the edited file would be over 1 MB' };
  }
  return result;
}

/** Asks about an edit the guard could not check, naming the cause. */
function cannotCheckEdit(cause) {
  return decide('ask', `could not check this edit because ${cause}. Confirm with the user.`);
}

/**
 * Replays the edits on the file and asks about every new line that holds a likely secret. An edit to part of
 * a line, such as the token on a marked line, never shows that line in its new_string.
 */
function judgeEdits(location, edits, readRegularFile) {
  const found = readTarget(location, readRegularFile);
  if (found.cause) return cannotCheckEdit(found.cause);
  const before = found.text.replaceAll('\r\n', '\n');
  const after = editedText(before, edits);
  if (after.cause) return cannotCheckEdit(after.cause);
  const original = new Set(linesOf(before));
  const added = linesOf(after.text).filter((line) => !original.has(line) && secretsIn(line).length > 0);
  if (added.length === 0) return null;
  if (added.some((line) => line.includes(ALLOW_PRAGMA))) return decide('ask', NEW_PRAGMA_REASON);
  return decide(
    'ask',
    `this edit leaves a new line with a possible ${secretNames(added)}. Confirm with the user.`,
  );
}

/** Returns the permission response for a write, or null when the write is safe. */
function evaluate(input, helpers) {
  const toolInput = input.tool_input ?? {};
  const baseDir =
    typeof input.cwd === 'string' && path.isAbsolute(input.cwd) ? input.cwd : helpers.projectDir;
  const location = locate(toolInput.file_path ?? toolInput.notebook_path, baseDir);
  const envName = [location.file, location.real]
    .filter(Boolean)
    .map((file) => path.basename(file))
    .find(helpers.isEnvFileName);
  if (envName) return decide('ask', `${envName} holds secrets. Confirm with the user before editing it.`);
  const text = writtenText(toolInput);
  if (text.length > MAX_CHECKED_SIZE) {
    return decide('ask', 'the written text is over 1 MB. Confirm with the user.');
  }
  const lines = linesOf(text);
  const unmarked = lines.filter((line) => !line.includes(ALLOW_PRAGMA));
  if (unmarked.some((line) => secretsIn(line).length > 0)) {
    return decide('deny', `possible ${secretNames(unmarked)} in written content. Use an env var instead.`);
  }
  // An agent could add the pragma to its own secret, so only a line already in the file keeps its exemption.
  const edits = editsOf(toolInput);
  if (edits !== null) return judgeEdits(location, edits, helpers.readRegularFile);
  return judgeMarkedLines(lines, () => readTarget(location, helpers.readRegularFile));
}

try {
  const [lib, { isEnvFileName }] = await Promise.all([import('./lib.mjs'), import('./env-files.mjs')]);
  const { readInput, respond, projectDir, readRegularFile } = lib;
  const response = evaluate(readInput(), { isEnvFileName, projectDir, readRegularFile });
  if (response) respond(response);
} catch {
  // Fail closed: if the hook cannot load or crashes, the write must not go through unchecked.
  process.stdout.write(JSON.stringify(decide('ask', 'could not inspect this write. Confirm with the user.')));
}
