import { BRAND } from '../../core/brand.js';

/** How a path relates to the files that keep the guards running: one of them, a folder above one, or neither. */
export type GuardFileMatch = 'inside' | 'holds' | null;

/** Compares a path segment, lower-cased, with a protected one; guard-bash passes a glob-aware comparison. */
export type SegmentMatch = (actual: string, protectedSegment: string) => boolean;

interface GuardFile {
  readonly segments: readonly string[];
  readonly folder: boolean;
}

// The hook bundles, the settings that register them and the config that holds their options (ADR-0015).
const GUARD_FILES: readonly GuardFile[] = [
  { segments: ['.claude', 'hooks'], folder: true },
  { segments: ['.claude', 'settings.json'], folder: false },
  { segments: ['.claude', 'settings.local.json'], folder: false },
  { segments: [...BRAND.stateDir.toLowerCase().split('/'), 'config.json'], folder: false },
];

const equal: SegmentMatch = (actual, protectedSegment) => actual === protectedSegment;

function matchAt(tail: readonly string[], guard: GuardFile, same: SegmentMatch): GuardFileMatch {
  const { segments, folder } = guard;
  const shared = Math.min(tail.length, segments.length);
  if (!tail.slice(0, shared).every((segment, index) => same(segment, segments[index] ?? ''))) return null;
  if (tail.length < segments.length) return 'holds';
  return folder || tail.length === segments.length ? 'inside' : null;
}

/**
 * Tells whether a path, as lower-cased segments, names a hook bundle under `.claude/hooks`, a Claude Code settings
 * file or the kit's config wherever they sit, or a folder that holds one; `inside` wins over `holds`.
 */
export function guardFileMatch(segments: readonly string[], same: SegmentMatch = equal): GuardFileMatch {
  let found: GuardFileMatch = null;
  for (let start = 0; start < segments.length; start += 1) {
    const tail = segments.slice(start);
    for (const guard of GUARD_FILES) {
      const match = matchAt(tail, guard, same);
      if (match === 'inside') return match;
      found ??= match;
    }
  }
  return found;
}
