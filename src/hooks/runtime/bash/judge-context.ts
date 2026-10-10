import type { Command } from '../shell/commands.js';
import type { PathContext } from './dangerous-paths.js';
import type { Verdict } from './verdicts.js';

/** The module whose `options` in the project config hold guard-bash's options. */
export const SAFETY_MODULE = 'safety';

/** The safety module's guard-bash options, off by default (ADR-0015): repo policies and extra denied commands. */
export interface BashOptions {
  /** Deny AI co-author trailers and "Generated with" lines in commit and PR commands. */
  readonly blockAiAttribution: boolean;
  /** Deny skipping git hooks: `--no-verify`, `HUSKY=0` and pointing `core.hooksPath` elsewhere. */
  readonly blockNoVerify: boolean;
  /** Commands to deny, each as its program and leading words, such as `terraform destroy`. */
  readonly denyCommands: readonly string[];
}

/** Everything a rule may know besides the command: the options, the protected paths and the file system. */
export interface JudgeContext {
  readonly options: BashOptions;
  readonly paths: PathContext;
  /** Tells whether a literal path names an existing file, relative to where the command runs. */
  readonly exists: (file: string) => boolean;
}

/** A guard rule: a verdict on one parsed command, or null when it has nothing to say. */
export type Rule = (command: Command, context: JudgeContext) => Verdict | null;

/** The options when the project config sets none. */
export const DEFAULT_OPTIONS: BashOptions = Object.freeze({
  blockAiAttribution: false,
  blockNoVerify: false,
  denyCommands: Object.freeze([]),
});
