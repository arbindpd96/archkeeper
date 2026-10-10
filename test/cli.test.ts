import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliContext } from '../src/cli/context.js';
import { readKit } from '../src/cli/kit.js';
import { EXIT_CODES, main, readPackageInfo, type CliOutput, type PackageInfo } from '../src/cli/main.js';
import { nodeVersionProblem, SUPPORTED_NODE_RANGE } from '../src/cli/node-version.js';
import { printError } from '../src/cli/output.js';
import { BRAND } from '../src/core/brand.js';
import { LockError, ManifestError } from '../src/core/errors.js';
import { REPO_ROOT, runCliProcess, tempDir, withEnv, writeFiles } from './helpers.js';

const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  version: string;
  engines: { node: string };
};

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[], context: Partial<CliContext> = {}): Promise<Ran> {
  const written = { stdout: '', stderr: '' };
  const output: CliOutput = {
    stdout: (text) => (written.stdout += text),
    stderr: (text) => (written.stderr += text),
  };
  return { code: await main(args, { output, ...context }), ...written };
}

describe('nodeVersionProblem', () => {
  it('enforces exactly the published engines.node range', () => {
    expect(manifest.engines.node).toBe(SUPPORTED_NODE_RANGE);
  });

  it('uses only the comparator forms the gate understands', () => {
    for (const comparator of SUPPORTED_NODE_RANGE.split('||')) {
      expect(comparator.trim()).toMatch(/^(?:\^\d+\.\d+\.\d+|>=\d+(?:\.\d+){0,2})$/);
    }
  });

  it.each(['18.20.8', '20.19.5', '22.12.0', 'v22.13.1', '22.17.0', '23.11.0', '24.4.0', '25.2.1'])(
    'asks Node.js %s to upgrade',
    (version) => {
      expect(nodeVersionProblem(version)).toContain(`needs Node.js ${SUPPORTED_NODE_RANGE}`);
    },
  );

  it.each(['22.17.1', '22.22.2', 'v24.4.1', '24.15.0', '26.0.0', '26.5.1', '27.1.0'])(
    'accepts Node.js %s',
    (version) => {
      expect(nodeVersionProblem(version)).toBeUndefined();
    },
  );
});

describe('main', () => {
  it('prints the package version for --version and -v', async () => {
    expect(await run(['--version'])).toEqual({ code: 0, stdout: `${manifest.version}\n`, stderr: '' });
    expect((await run(['-v'])).stdout).toBe(`${manifest.version}\n`);
  });

  it.each([[['--help']], [['-h']], [[]]])('prints usage and the disclaimer for %j', async (args) => {
    const result = await run(args);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`Usage: ${BRAND.binName} [options]`);
    expect(result.stdout).toContain(BRAND.disclaimer);
  });

  it('lists the global flags and the exit codes in --help', async () => {
    const { stdout } = await run(['--help']);
    for (const flag of ['--cwd <dir>', '--yes', '--json', '--debug', '--version', '--help']) {
      expect(stdout).toContain(flag);
    }
    expect(stdout).toContain(EXIT_CODES);
  });

  it.each([[['--bogus']], [['no-such-command']]])(
    'rejects %j with one error line and a Try line',
    async (args) => {
      const result = await run(args);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/^error: .+\n/);
      expect(result.stderr).toContain(`Try: ${BRAND.binName} --help\n`);
    },
  );

  it('escapes control characters a flag echoes into an error', async () => {
    const { stderr } = await run(['--\u001b[2Jx']);
    expect(stderr).not.toContain('\u001b');
    expect(stderr).toContain('\\u001b[2Jx');
  });

  it('reports an unreadable package.json as a damaged install instead of a stack trace', async () => {
    const unreadable = (): never => {
      throw new Error('No package.json found above /x/dist/cli.mjs.');
    };
    const result = await run(['--version'], { readInfo: unreadable });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `No package.json found above /x/dist/cli.mjs.\nThe ${BRAND.displayName} install looks damaged. Reinstall it and try again.\n`,
    );
  });

  it('reports a module catalog that does not load as a damaged install, with its file and one fix', async () => {
    const info = (): PackageInfo => ({ version: '1.0.0', description: 'Kit.' });
    const broken = (): never => {
      throw new ManifestError({
        file: 'modules/base/module.json',
        location: 'id',
        problem: 'is wrong',
        hint: 'fix it',
      });
    };
    const result = await run(['--version'], { readInfo: info, loadKit: broken });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'modules/base/module.json: id: is wrong\n' +
        `The ${BRAND.displayName} install looks damaged. Reinstall it and try again.\n`,
    );
  });
});

describe('printError', () => {
  function printed(error: unknown, debug = false): string {
    let stderr = '';
    printError({ stdout: () => undefined, stderr: (text) => (stderr += text) }, error, debug);
    return stderr;
  }

  const lockError = new LockError({
    file: '.kit/lock.json',
    location: 'files',
    problem: 'names "\u202Ecod.md"',
    hint: 'restore lock.json from git',
  });

  it('prints an ArchkeeperError as one escaped line and a Try line, with no stack trace', () => {
    expect(printed(lockError)).toBe(
      'Error: .kit/lock.json: files: names "\\u202ecod.md"\nTry: restore lock.json from git\n',
    );
  });

  it('adds the stack trace only with --debug', () => {
    const text = printed(lockError, true);
    expect(text.split('\n').length).toBeGreaterThan(3);
    expect(text).toContain('LockError');
  });

  it('prints an unexpected error with a pointer to --debug', () => {
    expect(printed(new TypeError('x is undefined'))).toBe(
      'Error: unexpected error: x is undefined\nTry: run again with --debug to see where it failed\n',
    );
  });

  it('styles the label for stderr when the output takes colour', () => {
    let stderr = '';
    const style = (format: unknown, text: string, stream: string): string =>
      `<${JSON.stringify(format)}:${stream}>${text}`;
    printError({ stdout: () => undefined, stderr: (text) => (stderr += text), style }, lockError, false);
    expect(stderr).toMatch(/^<\["bold","red"\]:stderr>Error: /);
  });
});

describe('the bin process', () => {
  it('colours errors with FORCE_COLOR and prints them plain with NO_COLOR', () => {
    const forced = runCliProcess(['--bogus'], { env: withEnv({ FORCE_COLOR: '1' }) });
    expect(forced.status).toBe(1);
    expect(forced.stderr).toContain('\u001b[');
    const plain = withEnv({ NO_COLOR: '1' });
    delete plain.FORCE_COLOR;
    const uncoloured = runCliProcess(['--bogus'], { env: plain });
    expect(uncoloured.status).toBe(1);
    expect(uncoloured.stderr).not.toContain('\u001b[');
    expect(uncoloured.stderr).toContain(`Try: ${BRAND.binName} --help`);
  });
});

describe('readKit', () => {
  it('loads the modules and presets this package ships', () => {
    const catalog = readKit(REPO_ROOT);
    expect(catalog.modules.has('base')).toBe(true);
    expect(catalog.presets.map((preset) => preset.name)).toEqual(['small', 'medium', 'full']);
  });

  it('throws ManifestError for a shipped manifest that does not load', () => {
    const root = tempDir();
    writeFiles(root, {
      'modules/presets.json': readFileSync(path.join(REPO_ROOT, 'modules/presets.json'), 'utf8'),
    });
    writeFiles(root, { 'modules/base/module.json': '{"id": "base"}' });
    expect(() => readKit(root)).toThrow(ManifestError);
  });

  it('fails when the package has no modules folder', () => {
    expect(() => readKit(tempDir())).toThrow(/ENOENT/);
  });
});

describe('readPackageInfo', () => {
  it('finds the package root above a bundled file', () => {
    const root = tempDir();
    writeFiles(root, { 'package.json': JSON.stringify({ version: '1.2.3', description: 'Kit.' }) });
    const bundle = pathToFileURL(path.join(root, 'dist', 'cli.mjs')).href;
    expect(readPackageInfo(bundle)).toEqual({ version: '1.2.3', description: 'Kit.' });
  });

  it('explains what is wrong with an incomplete package.json', () => {
    const root = tempDir();
    writeFiles(root, { 'package.json': JSON.stringify({ version: '1.2.3' }) });
    const bundle = pathToFileURL(path.join(root, 'dist', 'cli.mjs')).href;
    expect(() => readPackageInfo(bundle)).toThrow('needs a string "version" and "description"');
  });
});

describe('bin', () => {
  const nodeVersion = Object.getOwnPropertyDescriptor(process.versions, 'node');

  function stubNodeVersion(value: string): void {
    Object.defineProperty(process.versions, 'node', { ...nodeVersion, value });
  }

  async function startBin(): Promise<{ loaded: () => boolean; stderr: string }> {
    let loaded = false;
    let stderr = '';
    vi.resetModules();
    vi.doMock('../src/cli/main.js', () => {
      loaded = true;
      return { main: () => 0 };
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((text) => {
      stderr += String(text);
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${String(code)}`);
    });
    await import('../src/cli/bin.js').catch((error: unknown) => {
      stderr += `\n${String(error)}`;
    });
    return { loaded: () => loaded, stderr };
  }

  afterEach(() => {
    if (nodeVersion) Object.defineProperty(process.versions, 'node', nodeVersion);
    vi.doUnmock('../src/cli/main.js');
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('prints an upgrade message and exits 1 on Node.js 22.17.0 without loading the program', async () => {
    stubNodeVersion('22.17.0');
    const { loaded, stderr } = await startBin();
    expect(stderr).toContain(`needs Node.js ${SUPPORTED_NODE_RANGE}, but this is Node.js 22.17.0`);
    expect(stderr).toContain('exit 1');
    expect(loaded()).toBe(false);
  });

  it('loads and runs the program on Node.js 22.17.1', async () => {
    stubNodeVersion('22.17.1');
    const { loaded, stderr } = await startBin();
    expect(stderr).toBe('');
    expect(loaded()).toBe(true);
    expect(process.exitCode).toBe(0);
  });
});
