import { guardFileMatch, type SegmentMatch } from '../guard-files.js';
import type { Command } from '../shell/commands.js';
import { hasExpansion } from '../shell/syntax.js';
import { absoluteTargets, portablePath, resolveSegments } from './dangerous-paths.js';
import { globMatches } from './glob-match.js';
import type { JudgeContext } from './judge-context.js';
import { ask, type Verdict } from './verdicts.js';

const GUARD_FILES_CHANGED = ask(
  'This command changes the guards themselves (.claude/hooks, Claude Code settings or the project config). Confirm with the user.',
);
const WRITERS: ReadonlySet<string> = new Set([
  ...['rm', 'unlink', 'rmdir', 'shred', 'mv', 'cp', 'ln', 'install'],
  ...['rsync', 'tee', 'truncate', 'touch', 'dd', 'chmod', 'chown', 'chgrp'],
]);
const IN_PLACE_EDITORS: ReadonlySet<string> = new Set(['sed', 'gsed', 'perl', 'ruby']);
const IN_PLACE = /^(?:-[a-z]*i|--in-place(?:=|$))/i;

// A glob segment such as `*` does not match a dot file, as in every shell without dotglob.
const segmentMatches: SegmentMatch = (actual, protectedSegment) =>
  actual === protectedSegment ||
  (/[*?[]/.test(actual) &&
    (actual.startsWith('.') || !protectedSegment.startsWith('.')) &&
    globMatches(actual, protectedSegment));

function writtenWords({ program, args, redirects }: Command): string[] {
  const named =
    WRITERS.has(program) || (IN_PLACE_EDITORS.has(program) && args.some((arg) => IN_PLACE.test(arg)));
  const words = named ? args.map((arg) => arg.replace(/^of=/, '')) : [];
  return [...words, ...redirects];
}

function namesGuardFile(word: string, context: JudgeContext): boolean {
  if (hasExpansion(word)) return false;
  const own = resolveSegments(portablePath(word)).map((segment) => segment.toLowerCase());
  return [own, ...absoluteTargets(word, context.paths)].some(
    (segments) => guardFileMatch(segments, segmentMatches) !== null,
  );
}

/**
 * Asks before a command writes, moves or deletes a hook bundle, a Claude Code settings file or the kit's config, or
 * a folder that holds one: a missing or emptied bundle makes `node` fail, which Claude Code does not block on.
 */
export function guardFilesRule(command: Command, context: JudgeContext): Verdict | null {
  return writtenWords(command).some((word) => namesGuardFile(word, context)) ? GUARD_FILES_CHANGED : null;
}
