import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BRAND } from '../core/brand.js';

/** Where the CLI writes; tests pass collectors instead of the process streams. */
export interface CliOutput {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** The fields the CLI reads from its own package.json. */
export interface PackageInfo {
  version: string;
  description: string;
}

const PROCESS_OUTPUT: CliOutput = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};

const OPTIONS = {
  version: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' },
} as const;

/** Reads the nearest package.json above `fromUrl`, which is the package root both in src/ and in dist/. */
export function readPackageInfo(fromUrl: string = import.meta.url): PackageInfo {
  let directory = path.dirname(fileURLToPath(fromUrl));
  while (!existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`No package.json found above ${fileURLToPath(fromUrl)}.`);
    directory = parent;
  }
  const manifest: unknown = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const { version, description } = (manifest ?? {}) as Partial<Record<keyof PackageInfo, unknown>>;
  if (typeof version !== 'string' || typeof description !== 'string') {
    throw new Error(
      `${directory}/package.json needs a string "version" and "description". Reinstall the package.`,
    );
  }
  return { version, description };
}

function helpText({ description }: PackageInfo): string {
  return [
    `Usage: ${BRAND.binName} [options]`,
    '',
    description,
    '',
    'Options:',
    '  -v, --version  Print the version',
    '  -h, --help     Print this help',
    '',
    BRAND.disclaimer,
    '',
  ].join('\n');
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs the CLI with the given arguments and returns the process exit code. */
export function main(
  args: readonly string[],
  output: CliOutput = PROCESS_OUTPUT,
  readInfo: () => PackageInfo = readPackageInfo,
): number {
  let flags: { version?: boolean; help?: boolean };
  let info: PackageInfo;
  try {
    flags = parseArgs({ args: [...args], options: OPTIONS, strict: true, allowPositionals: false }).values;
  } catch (error) {
    output.stderr(`${reasonOf(error)}\nRun ${BRAND.binName} --help for usage.\n`);
    return 1;
  }
  try {
    info = readInfo();
  } catch (error) {
    output.stderr(
      `${reasonOf(error)}\nThe ${BRAND.displayName} install looks damaged. Reinstall it and try again.\n`,
    );
    return 1;
  }
  output.stdout(flags.version === true ? `${info.version}\n` : helpText(info));
  return 0;
}
