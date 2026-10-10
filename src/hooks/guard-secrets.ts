import { launch } from './runtime/launch.js';

// The checks load behind a dynamic import, so a failure while loading them still asks (ADR-0015).
process.exitCode = await launch(
  'guard-secrets',
  async () => (await import('./runtime/secrets/guard.js')).guardSecrets,
);
