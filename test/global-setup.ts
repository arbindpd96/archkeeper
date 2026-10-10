import { build } from 'tsdown';
import { hookBuilds } from '../tsdown.config.mjs';

/**
 * Builds every hook bundle into dist/hooks/ before the tests run, as `npm run build` does: modules name their
 * hooks by bundle (ADR-0015), so a kit loaded from this repository, by a test or by the CLI a test runs, needs them.
 */
export async function setup(): Promise<void> {
  for (const config of hookBuilds) {
    await build({ ...config, config: false, clean: false, logLevel: 'error' });
  }
}
