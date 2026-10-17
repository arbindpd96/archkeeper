import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { CliContext, PackageInfo } from '../src/cli/context.js';
import type { GitState } from '../src/cli/git-state.js';
import { kitReader } from '../src/cli/kit.js';
import { main } from '../src/cli/main.js';
import type { Prompter } from '../src/cli/prompts.js';
import { type Catalog, type KitModule, loadCatalog, type ReadKitFile } from '../src/core/loader.js';
import { render, type RenderTree } from '../src/core/render.js';
import { fixtureCopy, REPO_ROOT, writeFiles } from './helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

/** The Claude Code setup a user had before init: CLAUDE.md with CRLF and its own import, AGENTS.md, settings, a skill. */
export const USER_SETUP = {
  'CLAUDE.md': '# Billing service\r\n\r\nRun make test before pushing.\r\n\r\n@AGENTS.md\r\n',
  'AGENTS.md': '# Billing service\n\nNever log card numbers.\n',
  '.claude/settings.json':
    '{\n  // Reviewed in PRs.\n  "model": "opus",\n  "permissions": { "deny": ["Read(**/.env)"] },\n}\n',
  '.claude/skills/why/SKILL.md':
    '---\nname: why\ndescription: My own notes on past decisions.\n---\n\nAsk Ada.\n',
} as const;

/**
 * The `existing-claude-setup` fixture: a copy of examples/ts-app plus {@link USER_SETUP}. It is built here rather
 * than kept in examples/, where Claude Code would load its CLAUDE.md and skill in this repository's own sessions.
 */
export function existingClaudeSetup(): string {
  const { dir } = fixtureCopy('ts-app');
  writeFiles(dir, USER_SETUP);
  return dir;
}

const BUNDLE = /^dist\/hooks\/([a-z0-9-]+)\.mjs$/;

/**
 * Reads the kit under `root` with each hook bundle replaced by a one-line stand-in, so golden trees and module
 * snapshots change when a module does, not with every hook build; test/hook-bundles.test.ts covers the real bundles.
 */
export function standInReader(root: string): ReadKitFile {
  const read = kitReader(root);
  return (file) => {
    const hook = BUNDLE.exec(file)?.[1];
    return hook === undefined ? read(file) : `// Stand-in for the ${hook} bundle that npm run build makes.\n`;
  };
}

const MODULE_IDS = readdirSync(path.join(REPO_ROOT, 'modules'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/** The kit as this repository ships it, loaded once, with stand-ins for its hook bundles. */
export const KIT = loadCatalog(MODULE_IDS, standInReader(REPO_ROOT));

/**
 * init's exit code on `fixture` with `preset`: 2, done with a sidecar to review, on existing-claude-setup wherever
 * the preset has the knowledge module, whose why skill meets the user's own (ADR-0014); 0 everywhere else.
 */
export function doneCode(fixture: string, preset: string): number {
  const knowledge = KIT.modules.get('knowledge')?.manifest.presets.includes(preset) ?? false;
  return fixture === 'existing-claude-setup' && knowledge ? 2 : 0;
}

/** The kit's modules named by `ids` rendered for the test brand, on a TS stack with no detected commands. */
export function renderedKit(ids: readonly string[]): RenderTree {
  const modules = ids.map((id): KitModule => {
    const kit = KIT.modules.get(id);
    if (kit === undefined) throw new Error(`modules/${id} is missing`);
    return kit;
  });
  return render(modules, { stack: ['ts'], values: { project: { reference: [] } } }, TEST_BRAND);
}

/** Each path `module` renders into `tree`, with its strategy and block id (empty for a whole file), in path order. */
export function moduleEntries(tree: RenderTree, module: string): string[][] {
  return [...tree].flatMap(([file, entries]) =>
    entries
      .filter((entry) => entry.module === module)
      .map((entry) => [file, entry.strategy, entry.blockId ?? '']),
  );
}

/** What `module` renders into `file` of `tree`, a whole file or its block; throws when it renders nothing there. */
export function moduleContent(tree: RenderTree, module: string, file: string): string {
  const entry = tree.get(file)?.find((candidate) => candidate.module === module);
  if (entry === undefined) throw new Error(`${module} renders nothing into ${file}`);
  return entry.content;
}

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
  /** The kit version to run as, such as a newer one after an upgrade. */
  readonly version?: string;
  /** The home folder to run with, so a test never involves the real one. */
  readonly home?: string;
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
    readInfo: () => ({ ...INFO, version: setup.version ?? INFO.version }),
    loadKit: () => setup.catalog ?? KIT,
    brand: TEST_BRAND,
    cwd: dir,
    home: setup.home ?? REPO_ROOT,
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
