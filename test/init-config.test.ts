import { realpathSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type ConfigAnswers,
  type ExistingConfig,
  nextConfig,
  readExistingConfig,
} from '../src/cli/init-config.js';
import { tempDir, writeFiles } from './helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const CONFIG = `${TEST_BRAND.stateDir}/config.json`;
const WRITTEN = {
  $schema: 'https://example.com/old.schema.json',
  version: 1,
  preset: 'small',
  team: { owner: 'billing' },
  modules: { add: [], remove: [], note: 'kept on purpose' },
};
const SAME: ConfigAnswers = { preset: 'small', add: [], remove: [] };

function existingConfig(text: string): ExistingConfig {
  const dir = tempDir();
  writeFiles(dir, { [CONFIG]: text });
  const existing = readExistingConfig(realpathSync.native(dir), TEST_BRAND);
  if (existing === undefined) throw new Error('the config was not read');
  return existing;
}

describe('nextConfig', () => {
  it('leaves the file byte for byte when the answers match it', () => {
    const text = `${JSON.stringify(WRITTEN, null, 4)}\r\n`;
    const next = nextConfig(existingConfig(text), SAME, '2.0.0', TEST_BRAND);
    expect(next.changed).toBe(false);
    expect(next.text).toBe(text);
  });

  it('keeps unknown keys, $schema and extra modules keys when an answer changes', () => {
    const next = nextConfig(
      existingConfig(JSON.stringify(WRITTEN)),
      { ...SAME, preset: 'full' },
      '2.0.0',
      TEST_BRAND,
    );
    expect(next.changed).toBe(true);
    expect(JSON.parse(next.text)).toEqual({ ...WRITTEN, preset: 'full' });
  });
});
