import { readFileSync } from 'node:fs';
import { BRAND } from '../../core/brand.js';
import { isRecord } from '../../core/text.js';

/** A hook payload as Claude Code sends it on stdin; every field is read defensively (reference §1.4). */
export type Payload = Readonly<Record<string, unknown>>;

/** The payload read from stdin, with why it was replaced by `{}` when stdin held no JSON object. */
export interface HookInput {
  readonly payload: Payload;
  readonly problem?: string;
}

/** A PreToolUse permission decision a guard returns (reference §1.5). */
export type Decision = 'allow' | 'ask' | 'deny';

/** The JSON a hook prints on stdout with exit 0. */
export type HookOutput = Readonly<Record<string, unknown>>;

/**
 * What a hook answers: exit 0 with optional JSON on stdout and an optional one-line note on stderr, or exit 2
 * with a message on stderr, which Claude Code shows Claude. It never prints JSON and exits 2 (ADR-0015).
 */
export type Answer =
  | { readonly kind: 'done'; readonly output?: HookOutput; readonly note?: string }
  | { readonly kind: 'refuse'; readonly message: string };

/** Where a hook writes its answer. */
export interface HookStreams {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Reads a hook payload from text: `{}` with the problem named when it is empty, not JSON or not an object. */
export function parseInput(text: string): HookInput {
  if (text.trim() === '') return { payload: {}, problem: 'stdin was empty' };
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? { payload: value } : { payload: {}, problem: 'stdin was not a JSON object' };
  } catch {
    return { payload: {}, problem: 'stdin was not valid JSON' };
  }
}

/** Reads the payload Claude Code sends on stdin; a stdin that cannot be read counts as empty. */
export function readInput(): HookInput {
  try {
    return parseInput(readFileSync(0, 'utf8'));
  } catch {
    return { payload: {}, problem: 'stdin could not be read' };
  }
}

/** Reads a string field of an object, or undefined when it is missing or not a string. */
export function stringField(record: unknown, name: string): string | undefined {
  if (!isRecord(record)) return undefined;
  const value = record[name];
  return typeof value === 'string' ? value : undefined;
}

/** An answer with nothing to say: exit 0 and no output, which lets a tool call go on. */
export function noAnswer(note?: string): Answer {
  return note === undefined ? { kind: 'done' } : { kind: 'done', note };
}

/** A PreToolUse permission decision whose reason names the guard, as Claude and the user see it. */
export function permission(decision: Decision, reason: string): Answer {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: `${BRAND.displayName} guard: ${reason}`,
    },
  };
  return { kind: 'done', output };
}

const TRUNCATED = '\n…(truncated)';

// Cuts at most `cap` UTF-16 units, never between the halves of a surrogate pair.
function cutAt(text: string, cap: number): string {
  const end = Math.max(0, cap);
  const last = text.charCodeAt(end - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

/** Context injected into Claude's session, cut to `cap` characters so it stays inside its budget (ADR-0017). */
export function additionalContext(event: string, text: string, cap: number): Answer {
  const marked =
    cap >= TRUNCATED.length ? `${cutAt(text, cap - TRUNCATED.length)}${TRUNCATED}` : cutAt(text, cap);
  const cut = text.length <= cap ? text : marked;
  return { kind: 'done', output: { hookSpecificOutput: { hookEventName: event, additionalContext: cut } } };
}

/** A `decision: block` answer, which keeps Claude working on Stop or blocks on PostToolUse (reference §1.5). */
export function block(reason: string): Answer {
  return { kind: 'done', output: { decision: 'block', reason } };
}

/** Blocks the action with exit 2 and sends the message to Claude on stderr. */
export function refuse(message: string): Answer {
  return { kind: 'refuse', message };
}

/** Writes an answer and returns the exit code to end with: 0 and JSON, or 2 and stderr, never both. */
export function respond(answer: Answer, streams: HookStreams): number {
  if (answer.kind === 'refuse') {
    streams.stderr(`${answer.message}\n`);
    return 2;
  }
  if (answer.note !== undefined) streams.stderr(`${answer.note}\n`);
  if (answer.output !== undefined) streams.stdout(JSON.stringify(answer.output));
  return 0;
}
