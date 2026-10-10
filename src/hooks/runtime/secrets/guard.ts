import path from 'node:path';
import { BRAND } from '../../../core/brand.js';
import { secretKinds } from '../../../core/secrets.js';
import { escapeUnprintable, isRecord } from '../../../core/text.js';
import { isEnvFileName } from '../env-files.js';
import { type Answer, type HookInput, noAnswer, permission, stringField } from '../io.js';
import type { HookContext, HookModule, Sample } from '../launch.js';
import { isInside, slashed } from '../project.js';
import { editedText, type Edit, editsOf, writtenText } from './edits.js';
import { locate, type Location, MAX_CHECKED_SIZE, readTarget } from './target.js';

// The pragma is also accepted under every legacy slug, since it sits on users' own lines (ADR-0012).
const PRAGMAS: readonly string[] = [BRAND.markerPrefix, ...BRAND.legacySlugs].map(
  (prefix) => `${prefix}:allow-secret`,
);
const PRAGMA = PRAGMAS[0] ?? '';

const hasPragma = (line: string): boolean => PRAGMAS.some((pragma) => line.includes(pragma));
const hasSecret = (line: string): boolean => secretKinds(line).length > 0;
const kindsIn = (lines: readonly string[]): string => [...new Set(lines.flatMap(secretKinds))].join(', ');
const linesOf = (text: string): string[] => text.split('\n').map((line) => line.replace(/\r$/, ''));
const ask = (reason: string): Answer => permission('ask', reason);

// The file as reasons name it: relative to the project when it is there, with forward slashes, and with control and
// bidirectional characters escaped, so a crafted name cannot dress up the prompt the user reads. Display only.
function shown(file: string, projectDir: string): string {
  const relative = path.relative(projectDir, file);
  const inside = relative !== '' && isInside(projectDir, file);
  return escapeUnprintable(slashed(inside ? relative : file));
}

const newPragma = (file: string): Answer =>
  ask(
    `a new line in ${file} marks a likely secret with ${PRAGMA}. Confirm with the user that it is a fixture.`,
  );

/** Asks when the written lines mark a likely secret on a line that is not already in the file on disk. */
function judgeMarkedLines(lines: readonly string[], location: Location, file: string): Answer | null {
  const marked = lines.filter((line) => hasPragma(line) && hasSecret(line));
  if (marked.length === 0) return null;
  const found = readTarget(location);
  if ('cause' in found) {
    return ask(`could not check the marked line in ${file} because ${found.cause}. Confirm with the user.`);
  }
  const onDisk = new Set(linesOf(found.text));
  return marked.every((line) => onDisk.has(line)) ? null : newPragma(file);
}

/**
 * Replays the edits on the file and asks about every new line that holds a likely secret: an edit to part of a
 * line, such as the token on a marked line, never shows that line in its new_string (ADR-0015).
 */
function judgeEdits(location: Location, edits: readonly Edit[], file: string): Answer | null {
  const found = readTarget(location);
  const before = 'text' in found ? found.text.replaceAll('\r\n', '\n') : '';
  const after = 'text' in found ? editedText(before, edits) : found;
  if ('cause' in after) {
    return ask(`could not check this edit of ${file} because ${after.cause}. Confirm with the user.`);
  }
  const original = new Set(linesOf(before));
  const added = linesOf(after.text).filter((line) => !original.has(line) && hasSecret(line));
  if (added.length === 0) return null;
  if (added.some(hasPragma)) return newPragma(file);
  return ask(
    `this edit leaves a new line in ${file} with a possible ${kindsIn(added)}. Confirm with the user.`,
  );
}

function envName(location: Location): string | undefined {
  const names = [location.file, 'real' in location ? location.real : null];
  return names
    .filter((name): name is string => name !== null && name !== '')
    .map((name) => path.basename(name))
    .find(isEnvFileName);
}

function judgeWrite(
  toolInput: Readonly<Record<string, unknown>>,
  location: Location,
  file: string,
): Answer | null {
  const text = writtenText(toolInput);
  if (text.length > MAX_CHECKED_SIZE) {
    return ask(`the text written to ${file} is over 1 MB. Confirm with the user.`);
  }
  const lines = linesOf(text);
  const unmarked = lines.filter((line) => !hasPragma(line));
  if (unmarked.some(hasSecret)) {
    return permission(
      'deny',
      `possible ${kindsIn(unmarked)} in the text written to ${file}. Use an env var instead.`,
    );
  }
  // An agent could add the pragma to its own secret, so only a line already in the file keeps its exemption.
  const edits = editsOf(toolInput);
  return edits === null ? judgeMarkedLines(lines, location, file) : judgeEdits(location, edits, file);
}

function judge(input: HookInput, context: HookContext): Answer | null {
  if (input.problem !== undefined) {
    return ask(`could not check this write because ${input.problem}. Confirm with the user.`);
  }
  const toolInput = isRecord(input.payload.tool_input) ? input.payload.tool_input : {};
  const cwd = stringField(input.payload, 'cwd');
  const baseDir = cwd !== undefined && path.isAbsolute(cwd) ? cwd : context.projectDir;
  const location = locate(toolInput.file_path ?? toolInput.notebook_path, baseDir);
  if ('cause' in location) {
    return ask(`could not check this write because ${location.cause}. Confirm with the user.`);
  }
  const name = envName(location);
  if (name !== undefined) {
    return ask(`${escapeUnprintable(name)} holds secrets. Confirm with the user before editing it.`);
  }
  return judgeWrite(toolInput, location, shown(location.file, context.projectDir));
}

function answer(input: HookInput, context: HookContext): Answer {
  return judge(input, context) ?? noAnswer();
}

const write = (file_path: string, content: string): Sample['payload'] => ({
  tool_name: 'Write',
  tool_input: { file_path, content },
});
// Built at run time, so the hook's own text holds no likely secret.
const TOKEN = `ghp_${'a'.repeat(36)}`;

const SAMPLES: readonly Sample[] = [
  { name: 'ordinary code', payload: write('self-test/a.ts', 'export const answer = 42;\n'), expect: 'allow' },
  {
    name: 'a likely secret',
    payload: write('self-test/a.ts', `const token = '${TOKEN}';\n`),
    expect: 'deny',
  },
  {
    name: 'a new marked line',
    payload: write('self-test/a.ts', `'${TOKEN}'; // ${PRAGMA}\n`),
    expect: 'ask',
  },
  { name: 'a .env file', payload: write('self-test/.env.local', 'KEY=value\n'), expect: 'ask' },
  { name: 'an env template', payload: write('self-test/.env.example', 'KEY=\n'), expect: 'allow' },
  {
    name: 'an edit of a folder',
    payload: { tool_name: 'Edit', tool_input: { file_path: '.', old_string: 'a', new_string: 'b' } },
    expect: 'ask',
  },
  { name: 'a call that names no file', payload: { tool_name: 'Write' }, expect: 'ask' },
];

/** guard-secrets (#32): denies likely secrets in writes and asks before `.env` edits and unchecked edits; fails closed. */
export const guardSecrets: HookModule = { answer, samples: SAMPLES };
