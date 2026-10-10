import { type Command, parseCommands } from '../shell/commands.js';
import { ShellSyntaxError } from '../shell/syntax.js';
import { findPipedToRm, findRule, rmRule } from './delete-rules.js';
import { gitEnvironmentRule } from './git-config.js';
import { gitRule } from './git-rules.js';
import { interpreterVerdict } from './interpreter-rules.js';
import type { JudgeContext, Rule } from './judge-context.js';
import { PIPED_SCRIPT, pipedScriptVerdict } from './piped-scripts.js';
import {
  chmodRule,
  denyCommandsRule,
  environmentRule,
  ghRule,
  publishRule,
  secretsFileRule,
  sudoRule,
  unknownProgramRule,
} from './program-rules.js';
import { strictest, type Verdict } from './verdicts.js';
import { workingFolders } from './working-folders.js';

const MAX_SCRIPT_DEPTH = 3;

const PROGRAM_RULES: ReadonlyMap<string, Rule> = new Map<string, Rule>([
  ['rm', rmRule],
  ['find', findRule],
  ['git', gitRule],
  ['chmod', chmodRule],
  ['gh', ghRule],
  ...['npm', 'pnpm', 'yarn', 'bun'].map((program): [string, Rule] => [program, publishRule]),
  ...['', 'export', 'declare', 'typeset', 'readonly', 'local'].map((program): [string, Rule] => [
    program,
    environmentRule,
  ]),
]);
const ANY_PROGRAM_RULES: readonly Rule[] = [...new Set(PROGRAM_RULES.values())];
const COMMAND_RULES: readonly Rule[] = [
  sudoRule,
  secretsFileRule,
  unknownProgramRule,
  gitEnvironmentRule,
  denyCommandsRule,
];

// A program named by an expansion could be any program, so every program's rules apply to it.
function rulesFor(command: Command): readonly Rule[] {
  if (command.dynamicProgram) return [...ANY_PROGRAM_RULES, ...COMMAND_RULES];
  const programRule = PROGRAM_RULES.get(command.program);
  return programRule === undefined ? COMMAND_RULES : [programRule, ...COMMAND_RULES];
}

// Text piped into a shell, or its decoded form, may not parse; that text alone becomes unknown, and the verdicts
// on the rest of the command still count.
function judgeScriptAt(depth: number, context: JudgeContext): (script: string) => Verdict | null {
  return (script) => {
    if (depth >= MAX_SCRIPT_DEPTH) return PIPED_SCRIPT;
    try {
      return judgeAt(parseCommands(script), depth + 1, context);
    } catch (error) {
      if (error instanceof ShellSyntaxError) return PIPED_SCRIPT;
      throw error;
    }
  };
}

function judgeAt(commands: readonly Command[], depth: number, context: JudgeContext): Verdict | null {
  const folders = workingFolders(commands, context.paths);
  const verdicts = commands.flatMap((command) => {
    const own = { ...context, paths: folders.at(command) };
    return rulesFor(command).map((rule) => rule(command, own));
  });
  verdicts.push(
    interpreterVerdict(commands),
    pipedScriptVerdict(commands, judgeScriptAt(depth, { ...context, paths: folders.last })),
    findPipedToRm(commands, folders.at),
  );
  return strictest(verdicts);
}

/** Judges parsed commands and returns the strictest verdict (deny beats ask), or null when none applies. */
export function judgeCommands(commands: readonly Command[], context: JudgeContext): Verdict | null {
  return judgeAt(commands, 0, context);
}
