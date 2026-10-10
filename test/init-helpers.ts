import type { CliContext, PackageInfo } from '../src/cli/context.js';
import type { GitState } from '../src/cli/git-state.js';
import { readKit } from '../src/cli/kit.js';
import { main } from '../src/cli/main.js';
import type { Prompter } from '../src/cli/prompts.js';
import type { Catalog } from '../src/core/loader.js';
import { REPO_ROOT } from './helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

/** The kit as this repository ships it, loaded once. */
export const KIT = readKit(REPO_ROOT);

/** The package info init tests run with, so a release changes no snapshot. */
export const INFO: PackageInfo = { version: '1.0.0', description: 'Test kit.' };

/** What a test init run printed and asked, and how it ended. */
export interface InitRan {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout and every question, in order, each question as `[? message]`. */
  readonly transcript: string;
  readonly asked: readonly string[];
}

/** How a test runs init: a terminal or not, the answers to give, what git says, and the kit. */
export interface InitSetup {
  readonly interactive?: boolean;
  /** Answers in the order the questions come; undefined cancels, as Ctrl+C does. */
  readonly answers?: readonly (string | boolean | undefined)[];
  readonly git?: GitState;
  readonly catalog?: Catalog;
  /** Runs before each answer is given, such as an edit made while init waits. */
  readonly whileAsking?: (question: string) => void;
}

function scriptedPrompter(setup: InitSetup, log: (question: string) => void): Prompter {
  const answers = [...(setup.answers ?? [])];
  const answer = (question: string): unknown => {
    log(question);
    setup.whileAsking?.(question);
    if (answers.length === 0) throw new Error(`init asked "${question}" with no answer left`);
    return answers.shift();
  };
  return {
    select: (message, choices) => {
      const given = answer(
        `${message}: ${choices.map((choice) => `${choice.label} (${choice.hint ?? ''})`).join(' | ')}`,
      );
      return Promise.resolve(given as (typeof choices)[number]['value'] | undefined);
    },
    confirm: (message) => Promise.resolve(answer(message) as boolean | undefined),
  };
}

/** Runs `init --cwd <dir> ...args` in-process with the test brand, as a terminal or as CI. */
export async function runInit(
  dir: string,
  args: readonly string[] = [],
  setup: InitSetup = {},
): Promise<InitRan> {
  const written = { stdout: '', stderr: '', transcript: '' };
  const asked: string[] = [];
  const context: Partial<CliContext> = {
    output: {
      stdout: (text) => {
        written.stdout += text;
        written.transcript += text;
      },
      stderr: (text) => {
        written.stderr += text;
      },
    },
    readInfo: () => INFO,
    loadKit: () => setup.catalog ?? KIT,
    brand: TEST_BRAND,
    cwd: dir,
    interactive: setup.interactive ?? false,
    prompter: scriptedPrompter(setup, (question) => {
      asked.push(question);
      written.transcript += `[? ${question}]\n`;
    }),
    gitState: () => setup.git ?? 'clean',
  };
  const code = await main(['init', '--cwd', dir, ...args], context);
  return { code, ...written, asked };
}
