import { hasExpansion } from '../shell/syntax.js';
import { globMatches } from './glob-match.js';

const HOME_ANCHORS: ReadonlySet<string> = new Set([
  '~',
  '$HOME',
  '$PWD',
  '$CLAUDE_PROJECT_DIR',
  '$(pwd)',
  '`pwd`',
]);
const HOME_PARENTS: readonly string[] = ['home', 'users'];
const SYSTEM_DIRS: ReadonlySet<string> = new Set([
  ...['bin', 'boot', 'dev', 'etc', 'home', 'lib', 'lib32', 'lib64', 'media', 'mnt', 'nix', 'opt', 'proc'],
  ...['root', 'run', 'sbin', 'snap', 'srv', 'sys', 'tmp', 'usr', 'var'],
  ...['applications', 'cores', 'library', 'private', 'system', 'users', 'volumes'],
  ...['windows', 'program files', 'program files (x86)', 'programdata'],
]);
const GLOB = /[*?[]/;
const HOME_PREFIX = /^(?:~|\$HOME|\$\{HOME(?::?[-=?+][^}]*)?\})(?=\/|$)/;
const ANCHORED_PREFIX = /^(?:~|\$\{?(?:HOME|PWD|CLAUDE_PROJECT_DIR)\}?)\//;
const DRIVE = /^([A-Za-z]):(?=\/|$)/;
const CYGDRIVE = /^\/cygdrive\/([A-Za-z])(?=\/|$)/;

/** The folders a recursive delete must never remove or hold: the user's home and the project, as segments. */
export interface PathContext {
  readonly home: string;
  readonly protectedDirs: readonly (readonly string[])[];
}

const isHomeAnchor = (segment: string): boolean => HOME_ANCHORS.has(segment) || /^~[\w.+-]*$/.test(segment);
const isWildcard = (segment: string): boolean => segment.includes('*') && /^[*?.]+$/.test(segment);
const isUpward = (segments: readonly string[]): boolean => segments.every((segment) => segment === '..');
const segmentMatches = (pattern: string, actual: string): boolean =>
  pattern === actual || (GLOB.test(pattern) && globMatches(pattern, actual));

/**
 * One spelling of a path for every OS: forward slashes, and a Windows drive (`C:\`, Git Bash's `/c/`, Cygwin's
 * `/cygdrive/c/`) as `/c/`, so a home or project folder on a drive is protected however it is written (#31).
 */
export function portablePath(file: string): string {
  const slashed = file.replaceAll('\\', '/');
  const drive = (_: string, letter: string): string => `/${letter.toLowerCase()}`;
  return slashed.replace(DRIVE, drive).replace(CYGDRIVE, drive);
}

function climb(segments: string[], absolute: boolean): void {
  const last = segments.at(-1);
  if (last !== undefined && last !== '..' && !isHomeAnchor(last)) segments.pop();
  else if (!absolute || last !== undefined) segments.push('..');
}

/** Resolves `.`, `..` and empty segments of a path, keeping a leading `..` that climbs above where it starts. */
export function resolveSegments(file: string): string[] {
  const absolute = file.startsWith('/');
  const segments: string[] = [];
  for (const part of file.split('/')) {
    const segment = part.replace(/^\$\{(\w+)(?::?[-=?+][^}]*)?\}$/, '$$$1');
    if (segment === '..') climb(segments, absolute);
    else if (segment !== '' && segment !== '.') segments.push(segment);
  }
  while (segments.length > 0 && isWildcard(segments.at(-1) ?? '')) segments.pop();
  return segments;
}

/** The context for judging paths: the home folder and the project, and every folder above them, are protected. */
export function pathContext(home: string, projectDir: string): PathContext {
  const portableHome = portablePath(home);
  const protectedDirs = [portableHome, portablePath(projectDir)]
    .filter((dir) => dir.startsWith('/'))
    .map((dir) => resolveSegments(dir).map((segment) => segment.toLowerCase()));
  return { home: portableHome, protectedDirs };
}

function isRootLevel(lower: readonly string[]): boolean {
  const [top = ''] = lower;
  const topLevel = lower.length === 1 && (SYSTEM_DIRS.has(top) || GLOB.test(top));
  const homeLevel = lower.length === 2 && HOME_PARENTS.some((parent) => segmentMatches(top, parent));
  return lower.length === 0 || topLevel || homeLevel;
}

// A path on a drive (`/c/Users/me`) is also judged as if the drive were the root.
function isProtectedAbsolute(segments: readonly string[], context: PathContext): boolean {
  const lower = segments.map((segment) => segment.toLowerCase());
  const onDrive = /^[a-z]$/.test(lower[0] ?? '') ? [lower.slice(1)] : [];
  const holdsProtected = context.protectedDirs.some(
    (dir) =>
      lower.length <= dir.length &&
      lower.every((segment, index) => segmentMatches(segment, dir[index] ?? '')),
  );
  return holdsProtected || [lower, ...onDrive].some(isRootLevel);
}

/** Tells whether a path is decided at run time by a variable or command, beyond a known home or project prefix. */
export function isUncheckedPath(word: string): boolean {
  return hasExpansion(word.replace(ANCHORED_PREFIX, ''));
}

/** Tells whether deleting `word` recursively would remove a root, system, home or project folder or a parent of one. */
export function isDangerousPath(word: string, context: PathContext): boolean {
  if (word === '') return false;
  const portable = portablePath(word);
  // `~/Documents` holds the project when it lives there, which only the absolute form reveals.
  const file = context.home.startsWith('/') ? portable.replace(HOME_PREFIX, context.home) : portable;
  const segments = resolveSegments(file);
  if (file.startsWith('/')) return isProtectedAbsolute(segments, context);
  const [first = '', ...rest] = segments;
  return isUpward(segments) || (isHomeAnchor(first) && isUpward(rest));
}
