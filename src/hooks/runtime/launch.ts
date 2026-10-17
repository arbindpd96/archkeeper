import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { BRAND } from '../../core/brand.js';
import {
  type Answer,
  type HookInput,
  type HookStreams,
  noAnswer,
  type Payload,
  permission,
  readInput,
  respond,
} from './io.js';
import { isRecord } from '../../core/text.js';
import { projectDirOf, slashed } from './project.js';

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

/** A sample payload embedded in a hook, the files its project holds, and the outcome `--self-test` expects. */
export interface Sample {
  readonly name: string;
  readonly payload: Payload;
  readonly expect: Outcome;
  /** Text files written into the sample's project before the hook answers, by project-relative path. */
  readonly files?: Readonly<Record<string, string>>;
}

/** A hook's logic, loaded lazily so that a failure while loading it still meets its failure policy. */
export interface HookModule {
  readonly answer: (input: HookInput, context: HookContext) => Answer;
  readonly samples: readonly Sample[];
}

/** Where one `--self-test` sample runs, and how to remove that folder once the hook has answered. */
export interface SampleRun {
  readonly context: HookContext;
  readonly remove: () => void;
}

/** What a launch reads and writes, so tests run a hook in-process. */
export interface LaunchIo {
  readonly argv: readonly string[];
  readonly input: () => HookInput;
  readonly context: () => HookContext;
  /**
   * A fresh temp folder as the project of one `--self-test` sample, never the real project: no project config
   * applies there, and no state a sample makes lands in the project (ROADMAP v0.1 M5).
   */
  readonly sampleRun: () => SampleRun;
  readonly streams: HookStreams;
}

function homeFolder(): string {
  try {
    return homedir();
  } catch {
    return '';
  }
}

// A folder left behind in the temp folder costs nothing, so failing to remove it is noted, not a failed sample.
function tempProject(): SampleRun {
  const projectDir = mkdtempSync(path.join(tmpdir(), `${BRAND.npmName}-self-test-`));
  const remove = (): void => {
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      process.stderr.write(`could not remove the self-test folder ${slashed(projectDir)}\n`);
    }
  };
  return { context: { projectDir, home: homeFolder() }, remove };
}

/** The launch IO of a hook process: its arguments, stdin, environment and standard streams. */
export function processIo(): LaunchIo {
  return {
    argv: process.argv.slice(2),
    input: readInput,
    context: () => ({ projectDir: projectDirOf(process.env, process.cwd()), home: homeFolder() }),
    sampleRun: tempProject,
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

function writeSampleFiles(projectDir: string, files: Readonly<Record<string, string>>): void {
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(projectDir, ...relative.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}

function sampleOutcome(hook: HookModule, sample: Sample, io: LaunchIo): Outcome {
  const run = io.sampleRun();
  try {
    writeSampleFiles(run.context.projectDir, sample.files ?? {});
    return outcomeOf(hook.answer({ payload: sample.payload }, run.context));
  } finally {
    run.remove();
  }
}

function selfTest(name: string, hook: HookModule, io: LaunchIo): number {
  const failures = hook.samples.flatMap((sample) => {
    const got = sampleOutcome(hook, sample, io);
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
