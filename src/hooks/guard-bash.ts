import { launch } from './runtime/launch.js';

// The rules load behind a dynamic import, so a failure while loading them still asks (ADR-0015).
process.exitCode = await launch(
  'guard-bash',
  async () => (await import('./runtime/bash/guard.js')).guardBash,
);
