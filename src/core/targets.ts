import type { Brand } from './brand.js';
import { MCP_FILE, SETTINGS_FILE } from './manifest-schema.js';
import { foldedPath as folded } from './paths.js';

/** The personal settings file of Claude Code, which the kit never writes. */
export const LOCAL_SETTINGS_FILE = '.claude/settings.local.json';

/** The kit names a file written from a template may not use: the state and hook folders and the sidecar suffix. */
export type KitFolders = Pick<Brand, 'stateDir' | 'hookDir' | 'sidecarSuffix'>;

const ENV_FILE = /^\.env(?:rc)?(?![a-z0-9_-])/;
const ENV_TEMPLATE = /^\.env\.(?:example|sample|template)$/;
const PERSONAL_MEMORY = 'claude.local.md';

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
  if (built !== undefined) {
    return {
      problem: `is ${built}, which the kit builds from manifest data`,
      hint: 'declare it with strategy json and add hooks, permissions or mcpServers (ADR-0014)',
    };
  }
  if (name === folded(LOCAL_SETTINGS_FILE)) {
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
  if (ENV_FILE.test(base) && !ENV_TEMPLATE.test(base)) {
    return {
      problem: 'is a .env file, which holds secrets',
      hint: 'remove it: the kit never writes secrets',
    };
  }
  if (base === PERSONAL_MEMORY) {
    return { problem: 'is CLAUDE.local.md', hint: 'remove it: the kit never writes personal memory' };
  }
  return undefined;
}

function kitName(name: string, folders: KitFolders): TargetProblem | undefined {
  if (name.endsWith(folded(folders.sidecarSuffix))) {
    return {
      problem: `ends in ${folders.sidecarSuffix}, the suffix of the kit's sidecars`,
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
