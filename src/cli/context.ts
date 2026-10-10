import type { Command } from 'commander';
import type { Brand } from '../core/brand.js';
import type { Catalog } from '../core/loader.js';
import type { GitState } from './git-state.js';
import type { CliOutput } from './output.js';
import type { Prompter } from './prompts.js';

/** The fields the CLI reads from its own package.json. */
export interface PackageInfo {
  readonly version: string;
  readonly description: string;
}

/** Everything the CLI takes from its surroundings, so a test can run it without the process or the package. */
export interface CliContext {
  readonly output: CliOutput;
  readonly readInfo: () => PackageInfo;
  readonly loadKit: () => Catalog;
  readonly brand: Brand;
  /** The folder the CLI started in, which `--cwd` is relative to. */
  readonly cwd: string;
  /** The user's home folder, which init refuses as a project. */
  readonly home: string;
  /** Whether prompts can run: stdin and stdout are terminals and no CI is detected (#27). */
  readonly interactive: boolean;
  readonly prompter: Prompter;
  readonly gitState: (root: string) => GitState;
}

/** The global flags of every command (#26). */
export interface GlobalFlags {
  readonly cwd?: string;
  readonly json?: boolean;
  readonly yes?: boolean;
  readonly debug?: boolean;
}

/** What a command's action runs with: the context, the kit that loaded, the global flags and its exit code. */
export interface Session {
  readonly context: CliContext;
  readonly info: PackageInfo;
  readonly catalog: Catalog;
  readonly flags: () => GlobalFlags;
  /** Records the exit code the command finished with: 0 done, 1 error, 2 done with sidecars to review. */
  readonly finish: (code: number) => void;
}

/** Adds a registry command's options and action to its commander command. */
export type CommandSetup = (command: Command, session: Session) => void;
