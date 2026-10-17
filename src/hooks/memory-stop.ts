import { launch } from './runtime/launch.js';

// The logic loads behind a dynamic import, so a failure while loading it still lets Claude stop (ADR-0015).
process.exitCode = await launch(
  'memory-stop',
  async () => (await import('./runtime/memory/memory-stop.js')).memoryStop,
);
