import { homedir } from 'node:os';
import { globMatches } from './glob-match.mjs';

const HOME_ANCHORS = new Set(['~', '$HOME', '$PWD', '$CLAUDE_PROJECT_DIR', '$(pwd)', '`pwd`']);
const HOME_PARENTS = ['home', 'users'];
const SYSTEM_DIRS = new Set(
  'bin boot dev etc home lib lib32 lib64 media mnt nix opt proc root run sbin snap srv sys tmp usr var'
    .concat(' applications cores library private system users volumes')
    .split(' '),
);
const GLOB = /[*?[]/;

const isHomeAnchor = (segment) => HOME_ANCHORS.has(segment) || /^~[\w.+-]*$/.test(segment);
const isWildcard = (segment) => segment.includes('*') && /^[*?.]+$/.test(segment);
const isUpward = (segments) => segments.every((segment) => segment === '..');
const segmentMatches = (pattern, actual) =>
  pattern === actual || (GLOB.test(pattern) && globMatches(pattern, actual));

function climb(segments, absolute) {
  const last = segments.at(-1);
  if (last !== undefined && last !== '..' && !isHomeAnchor(last)) segments.pop();
  else if (!absolute || last !== undefined) segments.push('..');
}

function resolveSegments(path) {
  const absolute = path.startsWith('/');
  const segments = [];
  for (const part of path.split('/')) {
    const segment = part.replace(/^\$\{(\w+)(?::?[-=?+][^}]*)?\}$/, '$$$1');
    if (segment === '..') climb(segments, absolute);
    else if (segment !== '' && segment !== '.') segments.push(segment);
  }
  while (segments.length > 0 && isWildcard(segments.at(-1))) segments.pop();
  return segments;
}

// The user's home and the project root, and every directory above them, must never be deleted wholesale.
const PROTECTED_DIRS = [homedir(), process.env.CLAUDE_PROJECT_DIR ?? process.cwd()]
  .map((dir) => dir.replaceAll('\\', '/'))
  .filter((dir) => dir.startsWith('/'))
  .map((dir) => resolveSegments(dir).map((segment) => segment.toLowerCase()));

function isProtectedAbsolute(segments) {
  const lower = segments.map((segment) => segment.toLowerCase());
  const [top = ''] = lower;
  const topLevel = lower.length === 1 && (SYSTEM_DIRS.has(top) || GLOB.test(top));
  const homeLevel = lower.length === 2 && HOME_PARENTS.some((parent) => segmentMatches(top, parent));
  const holdsProtected = PROTECTED_DIRS.some(
    (dir) => lower.length <= dir.length && lower.every((segment, i) => segmentMatches(segment, dir[i])),
  );
  return lower.length === 0 || topLevel || homeLevel || holdsProtected;
}

/** Tells whether a path is decided at run time by a variable or command, beyond a known home or project prefix. */
export function isUncheckedPath(path) {
  return /[$`]/.test(path.replace(/^(?:~|\$\{?(?:HOME|PWD|CLAUDE_PROJECT_DIR)\}?)\//, ''));
}

/** Tells whether deleting `path` recursively would remove a root, system, home or project directory or a parent of one. */
export function isDangerousPath(path) {
  if (path === '') return false;
  const segments = resolveSegments(path);
  if (path.startsWith('/')) return isProtectedAbsolute(segments);
  const [first, ...rest] = segments;
  return isUpward(segments) || (isHomeAnchor(first) && isUpward(rest));
}
