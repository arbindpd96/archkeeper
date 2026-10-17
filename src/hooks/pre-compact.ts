import { launch } from './runtime/launch.js';

// The logic loads behind a dynamic import, so a failure while loading it still lets compaction go on (ADR-0015).
process.exitCode = await launch(
  'pre-compact',
  async () => (await import('./runtime/memory/pre-compact.js')).preCompact,
);
