import { utimesSync } from 'node:fs';
import path from 'node:path';
import { pathContext } from '../src/hooks/runtime/bash/dangerous-paths.js';
import { judgeCommand } from '../src/hooks/runtime/bash/guard.js';
import {
  type BashOptions,
  DEFAULT_OPTIONS,
  type JudgeContext,
} from '../src/hooks/runtime/bash/judge-context.js';
import type { Answer, Payload } from '../src/hooks/runtime/io.js';
import { type HookModule, outcomeOf } from '../src/hooks/runtime/launch.js';

/** The home folder and project the guard-bash tables judge commands in. */
export const HOME = '/home/u';
export const PROJECT = '/home/u/work/project-x';

/** Files that exist where a table's commands run, for `git checkout <file>`. */
const EXISTING = new Set(['README.md', 'package.json', 'src/a.ts']);

/** Where a table's commands run: the home folder, the project, the session's working folder and real paths. */
export interface Where {
  readonly home?: string;
  readonly project?: string;
  readonly cwd?: string;
  readonly realDirs?: readonly string[];
}

/** A guard-bash context for the tables: the options, the home folder, the project and the working folder. */
export function bashContext(options: Partial<BashOptions> = {}, where: Where = {}): JudgeContext {
  const project = where.project ?? PROJECT;
  return {
    options: { ...DEFAULT_OPTIONS, ...options },
    paths: pathContext(where.home ?? HOME, project, where.cwd ?? project, where.realDirs),
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

/** The parts of a feature MEMORY.md a memory hook reads; each has a default. */
export interface MemoryParts {
  readonly status?: string;
  readonly goal?: string;
  readonly decisions?: readonly string[];
  readonly next?: string;
}

/** A feature MEMORY.md in the layout of the kit's template, with `Status: in progress` unless `status` says otherwise. */
export function memoryText(parts: MemoryParts = {}): string {
  return [
    '# Feature: x',
    '',
    `Status: ${parts.status ?? 'in progress'} | Branch: main`,
    '',
    '## Goal',
    '',
    parts.goal ?? 'Rate-limit failed logins.',
    '',
    '## Decisions (never undo without asking)',
    '',
    ...(parts.decisions ?? ['- 2026-10-17: Count failures per account. Why: per-IP counts miss botnets.']),
    '',
    '## Done',
    '',
    '- [ ] The limiter.',
    '',
    '## Next step',
    '',
    parts.next ?? 'Wire the token refresh in src/auth.ts.',
    '',
  ].join('\n');
}

/** The `additionalContext` a hook answered with; throws when it answered none. */
export function injectedContext(answer: Answer): string {
  const output = answer.kind === 'done' ? answer.output : undefined;
  const specific = output?.hookSpecificOutput as { additionalContext?: unknown } | undefined;
  if (typeof specific?.additionalContext !== 'string') throw new Error('the hook injected no context');
  return specific.additionalContext;
}

/** The reason of a `decision: block` answer, or undefined when the answer lets Claude stop. */
export function blockReason(answer: Answer): string | undefined {
  const output = answer.kind === 'done' ? answer.output : undefined;
  return output?.decision === 'block' ? String(output.reason) : undefined;
}

/** Sets a file's access and modification times to `offsetMs` from now, such as an hour ago. */
export function setModified(dir: string, file: string, offsetMs: number): void {
  const time = new Date(Date.now() + offsetMs);
  utimesSync(path.join(dir, file), time, time);
}
