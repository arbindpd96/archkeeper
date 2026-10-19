import { launch } from './runtime/launch.js';

// The logic loads behind a dynamic import, so a failure while loading it still lets the edit stand (ADR-0015).
process.exitCode = await launch(
  'format-on-edit',
  async () => (await import('./runtime/format/format-on-edit.js')).formatOnEdit,
);
