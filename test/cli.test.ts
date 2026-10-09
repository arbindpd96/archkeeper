import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readKit } from '../src/cli/kit.js';
import { main, readPackageInfo, type CliOutput, type PackageInfo } from '../src/cli/main.js';
import { nodeVersionProblem, SUPPORTED_NODE_RANGE } from '../src/cli/node-version.js';
import { BRAND } from '../src/core/brand.js';
import { ManifestError } from '../src/core/errors.js';
import { REPO_ROOT, tempDir, writeFiles } from './helpers.js';

const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  version: string;
  engines: { node: string };
};

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const written = { stdout: '', stderr: '' };
  const output: CliOutput = {
    stdout: (text) => (written.stdout += text),
    stderr: (text) => (written.stderr += text),
  };
  return { code: main(args, output), ...written };
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
  it('prints the package version for --version and -v', () => {
    expect(run(['--version'])).toEqual({ code: 0, stdout: `${manifest.version}\n`, stderr: '' });
    expect(run(['-v']).stdout).toBe(`${manifest.version}\n`);
  });

  it.each([[['--help']], [['-h']], [[]]])('prints usage and the disclaimer for %j', (args) => {
    const result = run(args);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`Usage: ${BRAND.binName} [options]`);
    expect(result.stdout).toContain(BRAND.disclaimer);
  });

  it.each([[['--bogus']], [['init']]])('rejects %j with a pointer to --help', (args) => {
    const result = run(args);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`Run ${BRAND.binName} --help for usage.`);
  });

  it('reports an unreadable package.json as a damaged install instead of a stack trace', () => {
    let stderr = '';
    const output: CliOutput = { stdout: () => undefined, stderr: (text) => (stderr += text) };
    const unreadable = (): never => {
      throw new Error('No package.json found above /x/dist/cli.mjs.');
    };
    expect(main(['--version'], output, unreadable)).toBe(1);
    expect(stderr).toBe(
      `No package.json found above /x/dist/cli.mjs.\nThe ${BRAND.displayName} install looks damaged. Reinstall it and try again.\n`,
    );
  });

  it('reports a module catalog that does not load as a damaged install, with its file and fix', () => {
    let stderr = '';
    const output: CliOutput = { stdout: () => undefined, stderr: (text) => (stderr += text) };
    const info = (): PackageInfo => ({ version: '1.0.0', description: 'Kit.' });
    const broken = (): never => {
      throw new ManifestError({
        file: 'modules/base/module.json',
        location: 'id',
        problem: 'is wrong',
        hint: 'fix it',
      });
    };
    expect(main(['--version'], output, info, broken)).toBe(1);
    expect(stderr).toBe(
      'modules/base/module.json: id: is wrong\nTry: fix it\n' +
        `The ${BRAND.displayName} install looks damaged. Reinstall it and try again.\n`,
    );
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
