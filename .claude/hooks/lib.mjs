import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

export const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const FEATURES_DIR = path.join(projectDir, 'docs', 'features');
const STATE_DIR = path.join(projectDir, '.claude', 'state');
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** Reads the hook payload Claude Code sends on stdin; returns {} when absent or malformed. */
export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

/** Runs git in the project directory and returns trimmed stdout, or '' on failure. */
export function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** Writes a JSON hook response to stdout. */
export function respond(payload) {
  process.stdout.write(JSON.stringify(payload));
}

/** Returns the body under a `## heading` in a markdown document, without the heading line. */
export function section(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return '';
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

/** Returns true when `file` exists, is not a symlink, and resolves inside the project directory. */
export function isProjectFile(file) {
  try {
    if (lstatSync(file).isSymbolicLink()) return false;
    const root = realpathSync(projectDir);
    return realpathSync(file).startsWith(root + path.sep);
  } catch {
    return false;
  }
}

/** Lists features whose MEMORY.md is marked `Status: in progress`. */
export function activeFeatures() {
  if (!isProjectFile(FEATURES_DIR)) return [];
  return readdirSync(FEATURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => {
      const file = path.join(FEATURES_DIR, entry.name, 'MEMORY.md');
      const memory = isProjectFile(file) ? readFileSync(file, 'utf8') : '';
      return { name: entry.name, file: path.relative(projectDir, file).split(path.sep).join('/'), memory };
    })
    .filter((feature) => /^status:\s*in progress/im.test(feature.memory));
}

/** Returns a path inside `.claude/state/`, refusing symlinks anywhere on the way out of the project. */
function statePath(name) {
  for (const dir of [path.dirname(STATE_DIR), STATE_DIR]) {
    if (existsSync(dir) && !isProjectFile(dir)) throw new Error(`${dir} is a symlink or outside the project`);
  }
  mkdirSync(STATE_DIR, { recursive: true });
  return path.join(STATE_DIR, name);
}

/** Reads a text file from `.claude/state/`, returning null when missing, unreadable or a symlink. */
export function readStateText(name) {
  try {
    const fd = openSync(statePath(name), constants.O_RDONLY | NO_FOLLOW);
    try {
      return readFileSync(fd, 'utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** Reads a JSON file from `.claude/state/`, returning `fallback` when missing or invalid. */
export function readState(name, fallback) {
  try {
    return JSON.parse(readStateText(name) ?? '');
  } catch {
    return fallback;
  }
}

/** Writes a file into `.claude/state/` without following symlinks; returns false when the write is refused. */
export function writeState(name, content) {
  const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NO_FOLLOW;
  try {
    const fd = openSync(statePath(name), flags, 0o600);
    try {
      writeSync(fd, data);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

/** Returns working-tree paths with uncommitted changes (staged, unstaged or untracked). */
export function changedFiles() {
  return git('status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^.* -> /, ''));
}

/** Shortens text to `max` characters, marking the cut. */
export function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;
}
