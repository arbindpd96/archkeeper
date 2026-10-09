import type { Brand } from './brand.js';
import { MCP_FILE, SETTINGS_FILE } from './manifest-schema.js';
import { foldedPath as folded } from './paths.js';

/** The personal settings file of Claude Code, which the kit never writes. */
export const LOCAL_SETTINGS_FILE = '.claude/settings.local.json';

/** The kit names a file written from a template may not use: its state and hook folders and sidecar suffixes. */
export type KitFolders = Pick<Brand, 'stateDir' | 'hookDir' | 'sidecarSuffix' | 'legacySlugs'>;

// `.env`, `.env.local`, `.env-prod`, `.env_prod`, `.env~`, `.envrc` and docker-compose `app.env`.
const ENV_FILE = /^\.env(?:rc)?(?:$|[.~_-])|\.env$/;
const ENV_TEMPLATE = /^\.env\.(?:example|sample|template)$/;
const PERSONAL_MEMORY = 'claude.local.md';

/** Tells whether a file name holds secrets or personal memory: a `.env` file other than a template, or CLAUDE.local.md. */
export function isPrivateFileName(name: string): boolean {
  const base = folded(name);
  return (ENV_FILE.test(base) && !ENV_TEMPLATE.test(base)) || base === PERSONAL_MEMORY;
}

/** Why a target path is refused, and the fix. */
export interface TargetProblem {
  readonly problem: string;
  readonly hint: string;
}

function inside(path: string, folder: string): boolean {
  return path === folded(folder) || path.startsWith(`${folded(folder)}/`);
}

/**
 * Says why a file written from a template (owned, create-only or blocks) may not use `path`, or returns
 * undefined when it may. The settings and MCP files are built from objects (ADR-0014, #20), and `.git`, the
 * personal settings file and the kit's own folders are never written from a template. Case is ignored.
 */
export function reservedTarget(path: string, folders: KitFolders): TargetProblem | undefined {
  const name = folded(path);
  const built = [SETTINGS_FILE, MCP_FILE].find((file) => name === folded(file));
  const nested = [SETTINGS_FILE, MCP_FILE].find((file) => name.endsWith(`/${folded(file)}`));
  if (nested !== undefined) {
    return {
      problem: `is ${nested} in a subfolder, which Claude Code reads when started there`,
      hint: 'remove it: the kit builds only the root settings and MCP files, from manifest data',
    };
  }
  if (built !== undefined) {
    return {
      problem: `is ${built}, which the kit builds from manifest data`,
      hint: 'declare it with strategy json and add hooks, permissions or mcpServers (ADR-0014)',
    };
  }
  if (name === folded(LOCAL_SETTINGS_FILE) || name.endsWith(`/${folded(LOCAL_SETTINGS_FILE)}`)) {
    return {
      problem: `is ${LOCAL_SETTINGS_FILE}`,
      hint: 'remove it: the kit never writes personal settings',
    };
  }
  if (name.split('/').includes('.git')) {
    return { problem: 'is inside .git', hint: 'remove it: the kit never writes into .git' };
  }
  return personalFile(name) ?? kitName(name, folders);
}

function personalFile(name: string): TargetProblem | undefined {
  const base = name.slice(name.lastIndexOf('/') + 1);
  if (!isPrivateFileName(base)) return undefined;
  return base === PERSONAL_MEMORY
    ? { problem: 'is CLAUDE.local.md', hint: 'remove it: the kit never writes personal memory' }
    : { problem: 'is a .env file, which holds secrets', hint: 'remove it: the kit never writes secrets' };
}

function kitName(name: string, folders: KitFolders): TargetProblem | undefined {
  const suffixes = [folders.sidecarSuffix, ...folders.legacySlugs.map((slug) => `.${slug}-new`)];
  const segments = name.split('/');
  const suffix = suffixes.find((candidate) =>
    segments.some((segment) => segment.endsWith(folded(candidate))),
  );
  if (suffix !== undefined) {
    return {
      problem: `has a name ending in ${suffix}, the suffix of the kit's sidecars`,
      hint: 'rename it: a kit file named like a sidecar would be taken for one (ADR-0014)',
    };
  }
  const folder = [folders.stateDir, folders.hookDir].find((candidate) => inside(name, candidate));
  if (folder === undefined) return undefined;
  return {
    problem: `is inside ${folder}, which the kit manages itself`,
    hint: 'write the file to another folder: the state folder and the hook folder hold only kit-built files',
  };
}
