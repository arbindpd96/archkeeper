import * as childProcess from 'node:child_process';
import dns from 'node:dns';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitState } from '../src/cli/git-state.js';
import { REPO_ROOT, fixtureCopy, tempDir, writeFiles } from './helpers.js';
import { projectText } from './install-helpers.js';
import { KIT, runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  const spied = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;
  return { ...actual, ...Object.fromEntries(spied.map((name) => [name, vi.fn(actual[name])])) };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const CONFIG = `${TEST_BRAND.stateDir}/config.json`;
const QUESTION = 'Add Superpowers or Spec Kit? init only prints their install commands';
const SUPERPOWERS =
  'Add Superpowers: claude plugin install superpowers@claude-plugins-official --scope project';
const SPEC_KIT =
  'Add Spec Kit: uv tool install specify-cli==1.2.1, then specify init --here --integration claude';
const WARNING =
  'Commit first: specify init --here may replace files. Read specify init --help before --force.';
// The compose tape's frame: 1100×560 in JetBrains Mono 16 holds 23 rows of 100 columns on the CI renderer, whose
// cells measure 10.3 px in a rendered frame, and the shell's prompt takes the row after init's output.
const SCREEN = { rows: 22, columns: 100 };

interface Json {
  readonly compose: unknown;
  readonly plan: readonly { readonly ops: readonly { readonly kind: string }[] }[];
  readonly nextSteps: readonly string[];
}

function configOf(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(dir, CONFIG), 'utf8')) as Record<string, unknown>;
}

function writeConfig(dir: string, compose: object): void {
  writeFiles(dir, { [CONFIG]: `${JSON.stringify({ preset: 'medium', compose }, null, 2)}\n` });
}

/** The spied `node:child_process` functions that were called, whatever module called them. */
function programsStarted(): string[] {
  return Object.entries(childProcess)
    .filter(([, member]) => vi.isMockFunction(member) && member.mock.calls.length > 0)
    .map(([name]) => name);
}

function changesOf(stdout: string): readonly { readonly kind: string }[] {
  return (JSON.parse(stdout) as Json).plan.flatMap((entry) => entry.ops).filter((op) => op.kind !== 'skip');
}

describe('init offers Superpowers and Spec Kit after the preset (#39, ADR-0008)', () => {
  it('asks one select right after the preset, defaulting to no, and records a no with no command', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, [], { interactive: true, answers: ['medium', 'no', true] });
    expect(result.code).toBe(0);
    expect(result.asked[0]).toMatch(/^Choose a preset/);
    expect(result.asked[1]).toMatch(new RegExp(`^${QUESTION.replace('?', String.raw`\?`)}: `));
    expect(result.defaults[1]).toBe('no');
    expect(configOf(dir).compose).toEqual({ superpowers: false, specKit: false });
    expect(result.stdout).not.toContain('Add Superpowers');
    expect(result.stdout).not.toContain('Add Spec Kit');
    const again = await runInit(dir, [], { interactive: true });
    expect([again.code, again.asked]).toEqual([0, []]);
  });

  it('offers no, Superpowers, Spec Kit and both, each tool with what it is', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, [], { interactive: true, answers: ['medium', 'no', true] });
    const { superpowers, specKit } = KIT.compose;
    expect(result.asked[1]).toBe(
      `${QUESTION}: No () | Superpowers (${superpowers.description}) | Spec Kit (${specKit.description}) | Both ()`,
    );
  });

  it('records a yes in config.json and prints the exact commands, then the --force warning', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, [], { interactive: true, answers: ['medium', 'both', true] });
    expect(result.code).toBe(0);
    expect(configOf(dir).compose).toEqual({ superpowers: true, specKit: true });
    expect(result.stdout).toContain(`\n  3. ${SUPERPOWERS}\n  4. ${SPEC_KIT}\n  5. ${WARNING}\n`);
  });

  it.each([
    ['superpowers,speckit', { superpowers: true, specKit: true }, [SUPERPOWERS, SPEC_KIT, WARNING]],
    ['speckit', { superpowers: false, specKit: true }, [SPEC_KIT, WARNING]],
    [' superpowers ', { superpowers: true, specKit: false }, [SUPERPOWERS]],
  ])('answers it with --with %j in a scripted run', async (names, compose, steps) => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, ['--yes', '--with', names]);
    expect(result.code).toBe(0);
    expect(configOf(dir).compose).toEqual(compose);
    const printed = result.stdout.split('\n').filter((line) => / {2}\d\. (?:Add |Commit first)/.test(line));
    expect(printed.map((line) => line.replace(/^ {2}\d\. /, ''))).toEqual(steps);
  });

  it.each(['superpowers,bmad', '', 'Speckit'])(
    'refuses --with %j, naming the flag, before it writes anything',
    async (names) => {
      const { dir } = fixtureCopy('ts-app');
      const result = await runInit(dir, ['--yes', '--with', names]);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/--with: ".*" is not a tool init offers/);
      expect(result.stderr).toContain('Try: pass --with superpowers, speckit or superpowers,speckit');
      expect(existsSync(path.join(dir, TEST_BRAND.stateDir))).toBe(false);
    },
  );

  it('takes --yes alone as a no: it records no compose and prints no command', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, ['--yes']);
    expect(result.code).toBe(0);
    expect(Object.hasOwn(configOf(dir), 'compose')).toBe(false);
    expect(result.stdout).not.toMatch(/Superpowers|Spec Kit|specify/);
  });

  it("reuses the config's choice without asking, keeping it as written", async () => {
    const { dir } = fixtureCopy('ts-app');
    writeConfig(dir, { superpowers: true });
    const result = await runInit(dir, [], { interactive: true, answers: [true] });
    expect(result.code).toBe(0);
    expect(result.asked).toEqual(['Apply this plan?']);
    expect(configOf(dir).compose).toEqual({ superpowers: true });
    expect(result.stdout).toContain(`  3. ${SUPERPOWERS}\n`);
    expect(result.stdout).not.toContain('Add Spec Kit');
  });

  it("replaces the config's choice with --with, keeping other keys the user wrote there", async () => {
    const { dir } = fixtureCopy('ts-app');
    writeConfig(dir, { superpowers: true, mine: 'kept' });
    expect((await runInit(dir, ['--yes', '--with', 'speckit'])).code).toBe(0);
    expect(configOf(dir).compose).toEqual({ superpowers: false, mine: 'kept', specKit: true });
  });

  it('plans no operation on a second init, with --with or without, and --json shows the choice', async () => {
    const { dir } = fixtureCopy('ts-app');
    expect((await runInit(dir, ['--yes', '--with', 'superpowers,speckit'])).code).toBe(0);
    const before = projectText(dir);
    const plain = await runInit(dir, ['--json']);
    const chosen = await runInit(dir, ['--json', '--with', 'speckit,superpowers']);
    for (const again of [plain, chosen]) {
      expect(again.code).toBe(0);
      expect(changesOf(again.stdout)).toEqual([]);
      expect((JSON.parse(again.stdout) as Json).compose).toEqual({ superpowers: true, specKit: true });
    }
    expect((JSON.parse(plain.stdout) as Json).nextSteps).toEqual([]);
    expect((JSON.parse(chosen.stdout) as Json).nextSteps).toEqual([SUPERPOWERS, SPEC_KIT, WARNING]);
    expect(projectText(dir)).toBe(before);
  });

  it('prints the commands --with asks for even when the run changes nothing', async () => {
    const { dir } = fixtureCopy('ts-app');
    expect((await runInit(dir, ['--yes', '--with', 'speckit'])).code).toBe(0);
    const again = await runInit(dir, ['--yes', '--with', 'speckit']);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain(
      `\nNothing to change: the project already matches the plan.\nTo add what --with chose:\n  1. ${SPEC_KIT}\n  2. ${WARNING}\n`,
    );
    expect((await runInit(dir, ['--yes'])).stdout).not.toContain('To add what --with chose:');
  });

  it('lists the exact commands and the warning a yes prints under nextSteps in --json', async () => {
    const result = await runInit(fixtureCopy('ts-app').dir, ['--json', '--yes', '--with', 'speckit']);
    expect(result.code).toBe(0);
    expect((JSON.parse(result.stdout) as Json).nextSteps.slice(-2)).toEqual([SPEC_KIT, WARNING]);
  });

  it('writes nothing when the select is cancelled', async () => {
    const { dir } = fixtureCopy('ts-app');
    const before = projectText(dir);
    const result = await runInit(dir, [], { interactive: true, answers: ['medium', undefined] });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('Cancelled. Nothing was written.');
    expect(projectText(dir)).toBe(before);
  });

  it("fits compose.tape's screen: init --yes --with superpowers,speckit on ts-app", async () => {
    const result = await runInit(fixtureCopy('ts-app').dir, ['--yes', '--with', 'superpowers,speckit']);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(SCREEN.rows);
    // The first line names the project's folder, whose temp path differs on the renderer.
    expect(lines.slice(1).filter((line) => line.length > SCREEN.columns)).toEqual([]);
  });

  it("prints the text compose.tape waits for on one line, so the render's wait matches", async () => {
    const tape = readFileSync(path.join(REPO_ROOT, 'docs/media/tapes/compose.tape'), 'utf8');
    const waitsFor = new RegExp(/^Wait\+Screen \/(.+)\/$/m.exec(tape)?.[1] ?? '^$');
    const result = await runInit(fixtureCopy('ts-app').dir, ['--yes', '--with', 'superpowers,speckit']);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines.filter((line) => waitsFor.test(line) && line.length <= SCREEN.columns)).toHaveLength(1);
  });
});

describe('init composes offline (#39, ADR-0018)', () => {
  it('starts no program and reaches for no network, answering by --with or on a terminal', async () => {
    const refuse = (): never => {
      throw new Error('network');
    };
    const connect = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(refuse);
    const lookup = vi.spyOn(dns, 'lookup').mockImplementation(refuse);
    const fetch = vi.fn(refuse);
    vi.stubGlobal('fetch', fetch);
    const scripted = await runInit(fixtureCopy('ts-app').dir, ['--yes', '--with', 'superpowers,speckit']);
    const asked = await runInit(fixtureCopy('py-app').dir, [], {
      interactive: true,
      answers: ['full', 'both', true, true],
    });
    expect([scripted.code, asked.code]).toEqual([0, 0]);
    expect(asked.stdout).toContain(SPEC_KIT);
    expect(programsStarted()).toEqual([]);
    expect([connect, lookup, fetch].map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
  });

  it('sees a program the kit does start, so the check above is not vacuous', () => {
    expect(gitState(tempDir())).toBe('not-a-repo');
    expect(programsStarted()).not.toEqual([]);
  });
});
