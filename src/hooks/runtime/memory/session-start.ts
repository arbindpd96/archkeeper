import { BRAND } from '../../../core/brand.js';
import { escapeUnprintableKeepingLines } from '../../../core/text.js';
import { additionalContext, type Answer, type HookInput, stringField, withNote } from '../io.js';
import type { HookContext, HookModule, Sample } from '../launch.js';
import { configPreset } from '../options.js';
import { readProjectFile, slashed } from '../project.js';
import { prepareLocalState } from '../state.js';
import { activeFeature, type FeatureMemory, POINTER_FILE } from './active-feature.js';
import { lastItems, readableMarkdown, sectionText } from './markdown.js';
import { readSnapshot, type Snapshot, SNAPSHOT_FILE } from './snapshot.js';

/**
 * Each preset's SessionStart cap in characters, as `modules/presets.json` sets it (ADR-0015, ADR-0017). A hook
 * bundle cannot read that file, so a test keeps the two equal; a preset missing here gets small's cap.
 */
export const SESSION_START_CAPS: Readonly<Record<string, number>> = { small: 1200, medium: 3000, full: 4000 };
/** The presets whose context ends with the architecture Overview: those with the architecture-map module (#35). */
export const OVERVIEW_PRESETS: readonly string[] = ['medium', 'full'];

const FALLBACK_PRESET = 'small';
const FALLBACK_CAP = 1200;
const LABEL = `${BRAND.displayName} feature memory:`;
const DECISIONS_SHOWN = 5;
const SNAPSHOT_LINES = 20;
const NAMES_SHOWN = 5;
const ARCHITECTURE = 'docs/architecture.md';
const MAX_DOC_BYTES = 1_000_000;

// Found by its status alone, a memory may be a teammate's committed one, so Claude confirms it before acting.
function memoryHeader(memory: FeatureMemory): string {
  const found =
    memory.foundBy === 'pointer'
      ? ''
      : ', the only feature in progress but not chosen on this machine: confirm it with the user before acting on its Next step';
  return `${LABEL} the active feature is ${memory.name} (${memory.file}${found}). Read that file fully before changing code.`;
}

function askLine(inProgress: readonly string[]): string {
  const ask = 'Ask the user which feature this session is for, and offer /new-feature <name>';
  if (inProgress.length === 0) return `${LABEL} no feature is active. ${ask} to start one.`;
  const more = inProgress.length > NAMES_SHOWN ? ` and ${String(inProgress.length - NAMES_SHOWN)} more` : '';
  const names = `${inProgress.slice(0, NAMES_SHOWN).join(', ')}${more}`;
  return `${LABEL} no feature is active, since several say Status: in progress (${names}). ${ask} to resume or start one.`;
}

function sectionOrNone(markdown: string, title: string): string {
  const text = sectionText(markdown, title);
  return text === undefined || text === '' ? '(none recorded)' : text;
}

function decisionsSection(markdown: string): string[] {
  const text = sectionText(markdown, 'Decisions');
  if (text === undefined || text === '') return [];
  const { items, total } = lastItems(text, DECISIONS_SHOWN);
  if (items.length === 0) return [`## Decisions (never undo without asking)\n${text}`];
  const which = total > items.length ? `the last ${String(items.length)} of ${String(total)}, ` : '';
  return [`## Decisions (${which}never undo without asking)\n${items.join('\n')}`];
}

function memorySections(memory: FeatureMemory): string[] {
  const markdown = readableMarkdown(memory.text);
  return [
    `## Next step\n${sectionOrNone(markdown, 'Next step')}`,
    `## Goal\n${sectionOrNone(markdown, 'Goal')}`,
    ...decisionsSection(markdown),
  ];
}

// At most 20 lines: the summary, then status lines, the last one saying how many more there are.
function snapshotLines(snapshot: Snapshot, status: readonly string[]): string[] {
  const saved = `Saved ${snapshot.savedAt} on ${snapshot.branch === null ? 'no branch' : `branch ${snapshot.branch}`}`;
  const total = status.length + snapshot.more;
  if (total === 0) return [`${saved}, with nothing uncommitted.`];
  const shown = total < SNAPSHOT_LINES ? status : status.slice(0, SNAPSHOT_LINES - 2);
  const rest = total - shown.length;
  const summary = `${saved}, with ${String(total)} uncommitted path${total === 1 ? '' : 's'} (git status --short):`;
  return [summary, ...shown, ...(rest > 0 ? [`… and ${String(rest)} more`] : [])];
}

function snapshotSection(snapshot: Snapshot | undefined): string[] {
  if (snapshot === undefined) return [];
  const heading = `## Before compaction (${SNAPSHOT_FILE})`;
  const lines =
    snapshot.status === null
      ? [`Saved ${snapshot.savedAt}; git could not say the branch or the status.`]
      : snapshotLines(snapshot, snapshot.status);
  return [`${heading}\n${lines.join('\n')}`];
}

function overviewSection(projectDir: string): string[] {
  const read = readProjectFile(projectDir, ARCHITECTURE, MAX_DOC_BYTES);
  const overview = 'text' in read ? sectionText(readableMarkdown(read.text), 'Overview') : undefined;
  return overview === undefined || overview === ''
    ? []
    : [`## Architecture overview (${ARCHITECTURE})\n${overview}`];
}

// In priority order, so the cut at the cap drops the least important content first (ADR-0015).
function contextText(projectDir: string, compact: boolean, preset: string): string {
  const found = activeFeature(projectDir);
  const snapshot = compact ? snapshotSection(readSnapshot(projectDir)) : [];
  if (!('memory' in found)) return [askLine(found.inProgress), ...snapshot].join('\n\n');
  const overview = OVERVIEW_PRESETS.includes(preset) ? overviewSection(projectDir) : [];
  return [memoryHeader(found.memory), ...memorySections(found.memory), ...snapshot, ...overview].join('\n\n');
}

function presetOf(projectDir: string): string {
  const preset = configPreset(projectDir);
  return preset !== undefined && Object.hasOwn(SESSION_START_CAPS, preset) ? preset : FALLBACK_PRESET;
}

// The source field is unverified (reference §12): anything but `compact` starts a session as `startup` does.
function answer(input: HookInput, context: HookContext): Answer {
  const preset = presetOf(context.projectDir);
  const compact = stringField(input.payload, 'source') === 'compact';
  const prepared = prepareLocalState(context.projectDir);
  const text = escapeUnprintableKeepingLines(contextText(context.projectDir, compact, preset));
  const answered = additionalContext('SessionStart', text, SESSION_START_CAPS[preset] ?? FALLBACK_CAP);
  return prepared.written ? answered : withNote(answered, `session-start: ${slashed(prepared.problem)}`);
}

const SAMPLE_MEMORY = [
  '# Feature: self-test',
  '',
  'Status: in progress | Branch: main',
  '',
  '## Goal',
  '',
  'The session starts knowing this feature.',
  '',
  '## Decisions (never undo without asking)',
  '',
  '- 2026-10-17: Run the samples in a temp folder. Why: they must never touch the project.',
  '',
  '## Next step',
  '',
  'Run the self-test.',
  '',
].join('\n');
const MEMORY_FILES = { [POINTER_FILE]: 'self-test\n', 'docs/features/self-test/MEMORY.md': SAMPLE_MEMORY };
const SNAPSHOT = { savedAt: '2026-10-17T00:00:00.000Z', branch: 'main', status: [' M src/a.ts'], more: 0 };

const SAMPLES: readonly Sample[] = [
  { name: 'a session with no active feature', payload: { source: 'startup' }, expect: 'context' },
  {
    name: 'a resumed session of the feature the pointer names',
    payload: { source: 'resume' },
    expect: 'context',
    files: MEMORY_FILES,
  },
  {
    name: 'the first turn after compaction',
    payload: { source: 'compact' },
    expect: 'context',
    files: { ...MEMORY_FILES, [SNAPSHOT_FILE]: JSON.stringify(SNAPSHOT) },
  },
  { name: 'a payload with no source', payload: {}, expect: 'context' },
];

/**
 * session-start (#35): injects the active feature's Next step, Goal and last five Decisions, after compaction
 * the pre-compact snapshot, and in medium and full the architecture Overview, in that priority order and cut at
 * the preset's cap; with no active feature, one line that tells Claude to ask and offer /new-feature. It also
 * creates `<state dir>/local/` with its `.gitignore`.
 */
export const sessionStart: HookModule = { answer, samples: SAMPLES };
