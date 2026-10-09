import { BRAND } from '../core/brand.js';

/** Oldest Node.js release the published CLI runs on; `engines.node` in package.json must match it. */
export const MIN_NODE_VERSION = '22.12.0';

function versionParts(version: string): number[] {
  return version
    .replace(/^v/, '')
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function isOlder(version: string, minimum: string): boolean {
  const actual = versionParts(version);
  const required = versionParts(minimum);
  const index = required.findIndex((part, position) => (actual[position] ?? 0) !== part);
  return index !== -1 && (actual[index] ?? 0) < (required[index] ?? 0);
}

/** Returns an upgrade message when `version` is older than MIN_NODE_VERSION, otherwise undefined. */
export function nodeVersionProblem(version: string): string | undefined {
  if (!isOlder(version, MIN_NODE_VERSION)) return undefined;
  return (
    `${BRAND.displayName} needs Node.js ${MIN_NODE_VERSION} or newer, but this is Node.js ${version}.\n` +
    'Upgrade Node.js (https://nodejs.org) and run the command again.'
  );
}
