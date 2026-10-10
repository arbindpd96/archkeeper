import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Command, CommanderError } from 'commander';
import { BRAND } from '../core/brand.js';
import { ArchkeeperError } from '../core/errors.js';
import type { Catalog } from '../core/loader.js';
import { escapeUnprintable } from '../core/text.js';
import { COMMANDS } from './commands.js';
import type { CliContext, CommandSetup, GlobalFlags, PackageInfo, Session } from './context.js';
import { packageRoot, readKit } from './kit.js';
import { PROCESS_OUTPUT, printError, styled } from './output.js';

export type { PackageInfo } from './context.js';
export type { CliOutput } from './output.js';

/** The options and action of each command in the registry, by name. */
const SETUPS: ReadonlyMap<string, CommandSetup> = new Map();

// Every run registers every command, so a registry entry without a setup fails the first test that runs main.
function setupOf(name: string): CommandSetup {
  const setup = SETUPS.get(name);
  if (setup === undefined) {
    throw new Error(`src/cli/commands.ts lists "${name}", but src/cli/main.ts has no setup for it.`);
  }
  return setup;
}

/** The exit codes every command shares (#26), printed in --help. */
export const EXIT_CODES =
  'Exit codes: 0 done, 1 error or cancelled, 2 done with sidecars or conflicts to review.';

/** Reads the nearest package.json above `fromUrl`, which is the package root both in src/ and in dist/. */
export function readPackageInfo(fromUrl: string = import.meta.url): PackageInfo {
  const directory = packageRoot(fromUrl);
  const manifest: unknown = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const { version, description } = (manifest ?? {}) as Partial<Record<keyof PackageInfo, unknown>>;
  if (typeof version !== 'string' || typeof description !== 'string') {
    throw new Error(
      `${directory}/package.json needs a string "version" and "description". Reinstall the package.`,
    );
  }
  return { version, description };
}

function defaultContext(): CliContext {
  return {
    output: PROCESS_OUTPUT,
    readInfo: readPackageInfo,
    loadKit: readKit,
    brand: BRAND,
    cwd: process.cwd(),
  };
}

// Reinstalling is the fix for a damaged kit file, so the error's own Try line would offer a second one.
function damageOf(error: unknown): string {
  if (!(error instanceof ArchkeeperError)) return error instanceof Error ? error.message : String(error);
  const [problem = error.message] = error.message.split('\n');
  return problem;
}

function loadInstall(context: CliContext): { info: PackageInfo; catalog: Catalog } | undefined {
  try {
    // Every run validates the shipped modules, so a damaged install fails before any command runs.
    return { info: context.readInfo(), catalog: context.loadKit() };
  } catch (error) {
    const { brand, output } = context;
    output.stderr(
      `${escapeUnprintable(damageOf(error))}\nThe ${brand.displayName} install looks damaged. Reinstall it and try again.\n`,
    );
    return undefined;
  }
}

function programOf(context: CliContext, info: PackageInfo): Command {
  const { brand, output } = context;
  return new Command(brand.binName)
    .description(info.description)
    .version(info.version, '-v, --version', 'Print the version')
    .helpOption('-h, --help', 'Print this help')
    .helpCommand(false)
    .option('-C, --cwd <dir>', 'Run in <dir> instead of the current folder')
    .option('-y, --yes', 'Answer yes to every question, so nothing prompts')
    .option('--json', 'Print the result as JSON and run without prompts')
    .option('--debug', 'Print the stack trace of an error')
    .showHelpAfterError(`Try: ${brand.binName} --help`)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        output.stdout(text);
      },
      writeErr: (text) => {
        output.stderr(text);
      },
      outputError: (text, write) => {
        write(`${styled(output, 'red', escapeUnprintable(text.trimEnd()), 'stderr')}\n`);
      },
    })
    .addHelpText('after', `\n${EXIT_CODES}\n\n${brand.disclaimer}\n`);
}

/**
 * Runs the CLI with the given arguments and returns the process exit code (#26): 0 done, 1 error or cancelled,
 * 2 done with sidecars or conflicts to review. An ArchkeeperError prints one line and a `Try:` line; a stack
 * trace only with --debug. Every command comes from the registry in `commands.ts`.
 */
export async function main(args: readonly string[], overrides: Partial<CliContext> = {}): Promise<number> {
  const context: CliContext = { ...defaultContext(), ...overrides };
  const loaded = loadInstall(context);
  if (loaded === undefined) return 1;
  const program = programOf(context, loaded.info);
  let exitCode = 0;
  const session: Session = {
    context,
    ...loaded,
    flags: () => program.opts<GlobalFlags>(),
    finish: (code) => {
      exitCode = code;
    },
  };
  for (const { name, summary } of COMMANDS) {
    setupOf(name)(program.command(name).description(summary), session);
  }
  try {
    await program.parseAsync(args.length === 0 ? ['--help'] : [...args], { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 1;
    printError(context.output, error, session.flags().debug === true);
    return 1;
  }
}
