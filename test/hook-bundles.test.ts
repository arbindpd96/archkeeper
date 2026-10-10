import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAILURE_POLICY } from '../src/hooks/runtime/launch.js';
import { BRAND } from '../src/core/brand.js';
import { REPO_ROOT, tempDir, withEnv, writeFiles } from './helpers.js';

const HOOK_SOURCES = readdirSync(path.join(REPO_ROOT, 'src/hooks'))
  .filter((file) => file.endsWith('.ts'))
  .map((file) => path.basename(file, '.ts'))
  .sort();
// A bundle's static imports, one per line as tsdown writes them; its dynamic imports are inlined.
const STATIC_IMPORT = /^import\s(?:[^'"]*\sfrom\s*)?["']([^"']+)["']/gm;
const NETWORK = /node:(?:net|http|https|http2|tls|dgram|dns)\b|\bfetch\(|\bWebSocket\b/;

// A preload that makes any attempt to reach the network fail loudly, so a hook that tried would show it.
const NETWORK_STUB = `
import dns from 'node:dns';
import net from 'node:net';
const refuse = (what) => () => { process.stderr.write('NETWORK ' + what + '\\n'); throw new Error('network'); };
net.Socket.prototype.connect = refuse('socket');
dns.lookup = refuse('dns');
globalThis.fetch = refuse('fetch');
`;

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A copy of a built hook alone in a temp folder whose path has a space and a non-ASCII character. */
function isolatedCopy(hook: string): string {
  const folder = path.join(tempDir(), 'my hooks é');
  mkdirSync(folder);
  const copy = path.join(folder, `${hook}.mjs`);
  copyFileSync(path.join(REPO_ROOT, 'dist/hooks', `${hook}.mjs`), copy);
  return copy;
}

function run(
  script: string,
  input: string,
  args: readonly string[] = [],
  { preload = [], project = tempDir() }: { preload?: readonly string[]; project?: string } = {},
): Run {
  const result = spawnSync(process.execPath, [...preload, script, ...args], {
    cwd: project,
    input,
    encoding: 'utf8',
    env: withEnv({ CLAUDE_PROJECT_DIR: project }),
    timeout: 15_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('hook bundles (#30, ADR-0015)', () => {
  it('give every hook a failure policy, both guards failing closed with ask', () => {
    expect(Object.keys(FAILURE_POLICY).sort()).toEqual(HOOK_SOURCES);
    expect(FAILURE_POLICY['guard-bash']).toBe('ask');
    expect(FAILURE_POLICY['guard-secrets']).toBe('ask');
  });

  it.each(HOOK_SOURCES)('%s imports only node: built-ins and names no network API', (hook) => {
    const bundle = readFileSync(path.join(REPO_ROOT, 'dist/hooks', `${hook}.mjs`), 'utf8');
    const specifiers = [...bundle.matchAll(STATIC_IMPORT)].map((match) => match[1] ?? '');
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => !specifier.startsWith('node:'))).toEqual([]);
    expect(bundle).not.toMatch(/\bimport\(/);
    expect(bundle).not.toMatch(NETWORK);
  });

  it.each(HOOK_SOURCES)(
    '%s never returns updatedInput, which parallel hooks race over (reference §1.7)',
    (hook) => {
      expect(readFileSync(path.join(REPO_ROOT, 'dist/hooks', `${hook}.mjs`), 'utf8')).not.toContain(
        'updatedInput',
      );
    },
  );

  it.each(HOOK_SOURCES)('%s passes its self-test alone in a folder with no node_modules', (hook) => {
    const result = run(isolatedCopy(hook), '', ['--self-test']);
    expect(result.stdout).toMatch(new RegExp(`^${hook}: (\\d+) of \\1 samples passed\\n$`));
    expect(result.status).toBe(0);
  });

  it.each(HOOK_SOURCES)(
    '%s answers with exit 0 and JSON, never with exit 2, and asks on input it cannot read',
    (hook) => {
      const result = run(isolatedCopy(hook), 'not json');
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(output.hookSpecificOutput?.permissionDecision).toBe('ask');
    },
  );

  it.each(HOOK_SOURCES)('%s reaches for no network while it answers its samples', (hook) => {
    const stub = path.join(tempDir(), 'stub-network.mjs');
    writeFileSync(stub, NETWORK_STUB);
    const result = run(isolatedCopy(hook), '', ['--self-test'], {
      preload: ['--import', pathToFileURL(stub).href],
    });
    expect(result.stderr).not.toContain('NETWORK');
    expect(result.status).toBe(0);
  });

  it("passes its self-test in a project whose options would deny a sample's command", () => {
    const project = tempDir();
    const options = { options: { safety: { denyCommands: ['npm test'], blockNoVerify: true } } };
    writeFiles(project, { [`${BRAND.stateDir}/config.json`]: JSON.stringify(options) });
    expect(run(isolatedCopy('guard-bash'), '', ['--self-test'], { project }).status).toBe(0);
  });

  it('denies a force-push given on stdin, as Claude Code sends it', () => {
    const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main -f' } });
    const result = run(isolatedCopy('guard-bash'), payload);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });
});
