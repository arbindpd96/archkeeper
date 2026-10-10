import { homedir } from 'node:os';
import path from 'node:path';
import {
  type Answer,
  type HookInput,
  type HookStreams,
  isRecord,
  noAnswer,
  type Payload,
  permission,
  readInput,
  respond,
} from './io.js';
import { projectDirOf } from './project.js';

/** What a hook does when it cannot do its job (ADR-0015): `ask`, which fails closed, or `open`, which lets the action go on. */
export type FailurePolicy = 'ask' | 'open';

/** ADR-0015's failure policy of every hook the kit ships, by bundle name; both guards fail closed. */
export const FAILURE_POLICY: Readonly<Record<string, FailurePolicy>> = {
  'guard-bash': 'ask',
  'guard-secrets': 'ask',
};

/** Where a hook runs: the project folder Claude Code names and the user's home folder. */
export interface HookContext {
  readonly projectDir: string;
  readonly home: string;
}

/** What a hook's answer is, as its self-test samples name it; `allow` is no output, which lets the call go on. */
export type Outcome = 'allow' | 'ask' | 'deny' | 'context' | 'block' | 'refuse';

/** A sample payload embedded in a hook, with the outcome `--self-test` expects for it. */
export interface Sample {
  readonly name: string;
  readonly payload: Payload;
  readonly expect: Outcome;
}

/** A hook's logic, loaded lazily so that a failure while loading it still meets its failure policy. */
export interface HookModule {
  readonly answer: (input: HookInput, context: HookContext) => Answer;
  readonly samples: readonly Sample[];
}

/** What a launch reads and writes, so tests run a hook in-process. */
export interface LaunchIo {
  readonly argv: readonly string[];
  readonly input: () => HookInput;
  readonly context: () => HookContext;
  /** Where `--self-test` runs the samples: no project config there, so a project's options cannot change them. */
  readonly sampleContext: () => HookContext;
  readonly streams: HookStreams;
}

function homeFolder(): string {
  try {
    return homedir();
  } catch {
    return '';
  }
}

/** The launch IO of a hook process: its arguments, stdin, environment and standard streams. */
export function processIo(): LaunchIo {
  return {
    argv: process.argv.slice(2),
    input: readInput,
    context: () => ({ projectDir: projectDirOf(process.env, process.cwd()), home: homeFolder() }),
    sampleContext: () => ({ projectDir: path.dirname(process.argv[1] ?? '.'), home: homeFolder() }),
    streams: {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
  };
}

/** Names what an answer does, in the words of a sample's `expect`. */
export function outcomeOf(answer: Answer): Outcome {
  if (answer.kind === 'refuse') return 'refuse';
  const output = answer.output ?? {};
  const specific = isRecord(output.hookSpecificOutput) ? output.hookSpecificOutput : {};
  const decision = specific.permissionDecision;
  if (decision === 'ask' || decision === 'deny' || decision === 'allow') return decision;
  if (typeof specific.additionalContext === 'string') return 'context';
  return output.decision === 'block' ? 'block' : 'allow';
}

function selfTest(name: string, hook: HookModule, io: LaunchIo): number {
  const context = io.sampleContext();
  const failures = hook.samples.flatMap((sample) => {
    const got = outcomeOf(hook.answer({ payload: sample.payload }, context));
    return got === sample.expect ? [] : [`${name}: ${sample.name}: expected ${sample.expect}, got ${got}`];
  });
  for (const failure of failures) io.streams.stdout(`FAIL ${failure}\n`);
  const passed = hook.samples.length - failures.length;
  io.streams.stdout(`${name}: ${String(passed)} of ${String(hook.samples.length)} samples passed\n`);
  return failures.length === 0 && hook.samples.length > 0 ? 0 : 1;
}

function failure(name: string, policy: FailurePolicy, error: unknown): Answer {
  const kind = error instanceof Error ? error.name : typeof error;
  const note = `${name}: could not do its job (${kind})`;
  if (policy === 'open') return noAnswer(note);
  const answer = permission('ask', `${name} could not check this call, so it asks. Confirm with the user.`);
  return answer.kind === 'done' ? { ...answer, note } : answer;
}

/**
 * Runs a hook under its failure policy (ADR-0015): loads its logic, answers the payload on stdin (or runs its
 * samples with `--self-test`) and returns the exit code. A hook that cannot load or throws asks or lets the
 * action go on, as FAILURE_POLICY says, so a crash never silently allows what a guard should check.
 */
export async function launch(
  name: string,
  load: () => Promise<HookModule>,
  io: LaunchIo = processIo(),
  policies: Readonly<Record<string, FailurePolicy>> = FAILURE_POLICY,
): Promise<number> {
  const policy = policies[name] ?? 'ask';
  try {
    const hook = await load();
    if (io.argv.includes('--self-test')) return selfTest(name, hook, io);
    return respond(hook.answer(io.input(), io.context()), io.streams);
  } catch (error) {
    if (io.argv.includes('--self-test')) {
      io.streams.stdout(`FAIL ${name}: the hook could not run its samples\n`);
      return 1;
    }
    return respond(failure(name, policy, error), io.streams);
  }
}
