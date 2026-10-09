import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

const ALLOW_PRAGMA = 'archkeeper:allow-secret';
const MAX_CHECKED_BYTES = 1_000_000;
const OUTSIDE = Symbol('outside the project');

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

/** Reads the real file behind a project path, or names why it cannot. */
function readRealFile(real, readRegularFile) {
  const stat = lstatSync(real);
  if (!stat.isFile()) return { cause: 'it is not a regular file' };
  if (stat.size > MAX_CHECKED_BYTES) return { cause: 'it is over 1 MB' };
  const text = readRegularFile(real, MAX_CHECKED_BYTES);
  return text === null ? { cause: 'it changed while being read' } : { text };
}

/**
 * Returns `{ text }` for the file a write targets ('' when it does not exist yet), OUTSIDE when its real path
 * is outside the project, or `{ cause }` naming why it cannot be read. A symlink is followed only to a file
 * inside the project, read through its real path.
 */
function readTarget(target, { projectDir, isProjectFile, readRegularFile }) {
  if (typeof target !== 'string') return { cause: 'the call names no file' };
  const file = path.resolve(projectDir, target);
  try {
    if (lstatSync(file, { throwIfNoEntry: false }) === undefined) return { text: '' };
    const real = realpathSync(file);
    return isProjectFile(real) ? readRealFile(real, readRegularFile) : OUTSIDE;
  } catch {
    return { cause: 'it could not be read' };
  }
}

/** Asks when the written lines mark a likely secret on a line that is not already in the file `read` returns. */
function judgeMarkedLines(lines, read) {
  const marked = lines.filter((line) => line.includes(ALLOW_PRAGMA) && secretsIn(line).length > 0);
  if (marked.length === 0) return null;
  const found = read();
  const onDisk = new Set(found.text === undefined ? [] : linesOf(found.text));
  return marked.every((line) => onDisk.has(line)) ? null : decide('ask', NEW_PRAGMA_REASON);
}

/** Returns the edits of an Edit or MultiEdit call, or null for a call that writes whole text. */
function editsOf(toolInput) {
  if (Array.isArray(toolInput.edits)) return toolInput.edits;
  const isEdit = typeof toolInput.old_string === 'string' || typeof toolInput.new_string === 'string';
  return isEdit ? [toolInput] : null;
}

/** Applies one edit as the Edit tool does; null when it is malformed or its old_string is not in the text. */
function applyEdit(text, edit) {
  if (typeof edit?.old_string !== 'string' || typeof edit.new_string !== 'string') return null;
  if (!['undefined', 'boolean'].includes(typeof edit.replace_all)) return null;
  const search = edit.old_string.replaceAll('\r\n', '\n');
  const replacement = edit.new_string.replaceAll('\r\n', '\n');
  if (search === '') return text === '' ? replacement : null;
  if (!text.includes(search)) return null;
  if (edit.replace_all === true) return text.split(search).join(replacement);
  return text.replace(search, () => replacement);
}

/** Returns the text the edits leave behind, null when one cannot be applied, or as soon as it is over the cap. */
function editedText(text, edits) {
  let result = text;
  for (const edit of edits) {
    result = applyEdit(result, edit);
    if (result === null || result.length > MAX_CHECKED_BYTES) return result;
  }
  return result;
}

/**
 * Replays the edits on a project file and asks about every new line that holds a likely secret. An edit to
 * part of a line, such as the token on a marked line, never shows that line in its new_string. A file outside
 * the project is judged by the written text alone.
 */
function judgeEdits(target, edits, lines, helpers) {
  const found = readTarget(target, helpers);
  if (found === OUTSIDE) return judgeMarkedLines(lines, () => OUTSIDE);
  if (found.cause) {
    return decide('ask', `could not check this edit because ${found.cause}. Confirm with the user.`);
  }
  const before = found.text.replaceAll('\r\n', '\n');
  const after = editedText(before, edits);
  if (after === null) return decide('ask', 'could not replay this edit on the file. Confirm with the user.');
  if (after.length > MAX_CHECKED_BYTES) {
    return decide('ask', 'the edited file would be over 1 MB. Confirm with the user.');
  }
  const original = new Set(linesOf(before));
  const added = linesOf(after).filter((line) => !original.has(line) && secretsIn(line).length > 0);
  if (added.length === 0) return null;
  if (added.some((line) => line.includes(ALLOW_PRAGMA))) return decide('ask', NEW_PRAGMA_REASON);
  return decide(
    'ask',
    `this edit leaves a new line with a possible ${secretNames(added)}. Confirm with the user.`,
  );
}

/** Returns the permission response for a write, or null when the write is safe. */
function evaluate(toolInput, helpers) {
  const target = toolInput.file_path ?? toolInput.notebook_path;
  const fileName = typeof target === 'string' ? path.basename(target) : '';
  if (helpers.isEnvFileName(fileName)) {
    return decide('ask', `${fileName} holds secrets. Confirm with the user before editing it.`);
  }
  const text = writtenText(toolInput);
  if (text.length > MAX_CHECKED_BYTES) {
    return decide('ask', 'the written text is over 1 MB. Confirm with the user.');
  }
  const lines = linesOf(text);
  const unmarked = lines.filter((line) => !line.includes(ALLOW_PRAGMA));
  if (unmarked.some((line) => secretsIn(line).length > 0)) {
    return decide('deny', `possible ${secretNames(unmarked)} in written content. Use an env var instead.`);
  }
  // An agent could add the pragma to its own secret, so only a line already in the file keeps its exemption.
  const edits = editsOf(toolInput);
  if (edits !== null) return judgeEdits(target, edits, lines, helpers);
  return judgeMarkedLines(lines, () => readTarget(target, helpers));
}

try {
  const [lib, { isEnvFileName }] = await Promise.all([import('./lib.mjs'), import('./env-files.mjs')]);
  const { readInput, respond, projectDir, isProjectFile, readRegularFile } = lib;
  const helpers = { isEnvFileName, isProjectFile, projectDir, readRegularFile };
  const response = evaluate(readInput().tool_input ?? {}, helpers);
  if (response) respond(response);
} catch {
  // Fail closed: if the hook cannot load or crashes, the write must not go through unchecked.
  process.stdout.write(JSON.stringify(decide('ask', 'could not inspect this write. Confirm with the user.')));
}
