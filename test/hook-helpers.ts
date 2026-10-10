import { pathContext } from '../src/hooks/runtime/bash/dangerous-paths.js';
import { judgeCommand } from '../src/hooks/runtime/bash/guard.js';
import {
  type BashOptions,
  DEFAULT_OPTIONS,
  type JudgeContext,
} from '../src/hooks/runtime/bash/judge-context.js';
import type { Payload } from '../src/hooks/runtime/io.js';
import { type HookModule, outcomeOf } from '../src/hooks/runtime/launch.js';

/** The home folder and project the guard-bash tables judge commands in. */
export const HOME = '/home/u';
export const PROJECT = '/home/u/work/project-x';

/** Files that exist where a table's commands run, for `git checkout <file>`. */
const EXISTING = new Set(['README.md', 'package.json', 'src/a.ts']);

/** A guard-bash context for the tables: the options, the home folder and the project. */
export function bashContext(
  options: Partial<BashOptions> = {},
  where: { readonly home?: string; readonly project?: string } = {},
): JudgeContext {
  return {
    options: { ...DEFAULT_OPTIONS, ...options },
    paths: pathContext(where.home ?? HOME, where.project ?? PROJECT),
    exists: (file) => EXISTING.has(file),
  };
}

/** guard-bash's decision on a command line: deny, ask or allow. */
export function bashDecision(command: string, context: JudgeContext = bashContext()): string {
  return judgeCommand(command, context)?.decision ?? 'allow';
}

/** guard-bash's decision and reason on a command line; the reason is empty when it allows. */
export function bashVerdict(
  command: string,
  context: JudgeContext = bashContext(),
): { decision: string; reason: string } {
  const verdict = judgeCommand(command, context);
  return { decision: verdict?.decision ?? 'allow', reason: verdict?.reason ?? '' };
}

/** A hook's outcome and reason for a payload, answered in-process. */
export function hookAnswer(
  hook: HookModule,
  payload: Payload,
  where: { readonly projectDir: string; readonly home?: string },
): { outcome: string; reason: string } {
  const answer = hook.answer({ payload }, { projectDir: where.projectDir, home: where.home ?? HOME });
  const output = answer.kind === 'done' ? answer.output : undefined;
  const specific = output?.hookSpecificOutput as { permissionDecisionReason?: string } | undefined;
  return { outcome: outcomeOf(answer), reason: specific?.permissionDecisionReason ?? '' };
}
