import { launch } from './runtime/launch.js';

// The logic loads behind a dynamic import, so a failure while loading it still lets the session start (ADR-0015).
process.exitCode = await launch(
  'session-start',
  async () => (await import('./runtime/memory/session-start.js')).sessionStart,
);
