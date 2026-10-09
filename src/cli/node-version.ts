import { BRAND } from '../core/brand.js';

/** Node.js releases the published CLI runs on (ADR-0011); `engines.node` in package.json must equal it. */
export const SUPPORTED_NODE_RANGE = '^22.17.1 || ^24.4.1 || >=26';

type Version = readonly [number, number, number];

function parseVersion(text: string): Version {
  const [major = 0, minor = 0, patch = 0] = text
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  return [major, minor, patch];
}

function compareVersions(left: Version, right: Version): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

// The range uses only two comparator forms: `^x.y.z` (that major line, from x.y.z) and `>=x` (from x on).
function satisfies(version: Version, comparator: string): boolean {
  const minimum = parseVersion(comparator.replace(/^(\^|>=)/, ''));
  const onSameLine = !comparator.startsWith('^') || version[0] === minimum[0];
  return onSameLine && compareVersions(version, minimum) >= 0;
}

/** Returns an upgrade message when `version` is outside SUPPORTED_NODE_RANGE, otherwise undefined. */
export function nodeVersionProblem(version: string): string | undefined {
  const parsed = parseVersion(version);
  const comparators = SUPPORTED_NODE_RANGE.split('||').map((comparator) => comparator.trim());
  if (comparators.some((comparator) => satisfies(parsed, comparator))) return undefined;
  return (
    `${BRAND.displayName} needs Node.js ${SUPPORTED_NODE_RANGE}, but this is Node.js ${version}.\n` +
    'Install a supported LTS release from https://nodejs.org and run the command again.'
  );
}
