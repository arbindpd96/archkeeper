import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const FEATURES_DIR = path.join(projectDir, 'docs', 'features');
const STATE_DIR = path.join(projectDir, '.claude', 'state');

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

/** Lists features whose MEMORY.md is marked `Status: in progress`. */
export function activeFeatures() {
  if (!existsSync(FEATURES_DIR)) return [];
  return readdirSync(FEATURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => {
      const file = path.join(FEATURES_DIR, entry.name, 'MEMORY.md');
      const memory = existsSync(file) ? readFileSync(file, 'utf8') : '';
      return { name: entry.name, file: path.relative(projectDir, file).split(path.sep).join('/'), memory };
    })
    .filter((feature) => /^status:\s*in progress/im.test(feature.memory));
}

/** Reads a JSON file from `.claude/state/`, returning `fallback` when missing or invalid. */
export function readState(name, fallback) {
  try {
    return JSON.parse(readFileSync(path.join(STATE_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

/** Writes a file into the gitignored `.claude/state/` directory. */
export function writeState(name, content) {
  mkdirSync(STATE_DIR, { recursive: true });
  const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  writeFileSync(path.join(STATE_DIR, name), data);
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
