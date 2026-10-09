import { activeFeatures, changedFiles, git, readInput, respond, truncate, writeState } from './lib.mjs';

const input = readInput();
const changed = changedFiles();

const snapshot = [
  `Saved: ${new Date().toISOString()} (trigger: ${input.trigger ?? 'unknown'})`,
  `Branch: ${git('branch', '--show-current') || '(detached)'}`,
  `Last commit: ${git('log', '-1', '--format=%h %s') || '(none)'}`,
  `Active features: ${
    activeFeatures()
      .map((f) => f.file)
      .join(', ') || '(none)'
  }`,
  '',
  `Uncommitted files (${changed.length}):`,
  truncate(changed.map((file) => `- ${file}`).join('\n') || '- (none)', 2000),
].join('\n');

const saved = writeState('compact-snapshot.md', snapshot);
respond({
  systemMessage: saved
    ? 'archkeeper: saved a pre-compaction snapshot. It is re-injected after compaction.'
    : 'archkeeper: skipped the pre-compaction snapshot because .claude/state is not a safe project folder.',
});
