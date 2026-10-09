import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  activeFeatures,
  changedFiles,
  git,
  projectDir,
  readInput,
  respond,
  section,
  truncate,
} from './lib.mjs';

const input = readInput();
const lines = ['# Session context (from .claude/hooks/session-start.mjs)'];

const branch = git('branch', '--show-current') || '(detached)';
lines.push(`Branch: ${branch} · uncommitted files: ${changedFiles().length}`);

const features = activeFeatures();
if (features.length === 0) {
  lines.push('No feature is in progress. Ask the user which feature to work on, then run /new-feature.');
} else {
  lines.push('Features in progress. Read the relevant MEMORY.md fully before changing code:');
  for (const feature of features) {
    const next = section(feature.memory, 'Next step') || '(no next step recorded)';
    lines.push(`- ${feature.name} (${feature.file})\n  Next step: ${truncate(next, 600)}`);
  }
}

lines.push(
  'Before creating anything new, check docs/architecture.md and search for existing code.',
  'Never contradict docs/decisions.md or a feature Decision without asking the user.',
);

if (input.source === 'compact') {
  try {
    const snapshot = readFileSync(path.join(projectDir, '.claude', 'state', 'compact-snapshot.md'), 'utf8');
    lines.push('', '## Pre-compaction snapshot', truncate(snapshot, 2500));
  } catch {
    lines.push('', 'Context was compacted. Re-read the active MEMORY.md before continuing.');
  }
}

respond({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } });
