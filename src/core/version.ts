/** A semantic version such as `0.1.0` or `0.1.0-rc.0`, with an optional `+build` suffix. */
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

interface Version {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

function parse(text: string): Version {
  const match = SEMVER.exec(text);
  if (match === null) throw new RangeError(`"${text}" is not a semantic version.`);
  const [, major = '0', minor = '0', patch = '0', pre] = match;
  return { core: [Number(major), Number(minor), Number(patch)], prerelease: pre?.split('.') ?? [] };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left);
  const rightNumber = /^\d+$/.test(right);
  if (leftNumber && rightNumber) return Number(left) - Number(right);
  if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrereleases(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return right.length - left.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = compareIdentifiers(left[index] ?? '', right[index] ?? '');
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

/** Orders two semantic versions by precedence, so `0.1.0-rc.0` comes before `0.1.0`; build metadata is ignored. */
export function compareVersions(left: string, right: string): number {
  const a = parse(left);
  const b = parse(right);
  const core = a.core[0] - b.core[0] || a.core[1] - b.core[1] || a.core[2] - b.core[2];
  return core === 0 ? comparePrereleases(a.prerelease, b.prerelease) : core;
}
