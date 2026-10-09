import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSecret } from '../src/core/secrets.js';
import { REPO_ROOT } from './helpers.js';
import { LOOKALIKE_SAMPLES, SECRET_SAMPLES } from './secret-samples.js';

/** Each `{ name, pattern }` entry of a pattern list, as its source text spells it. */
function patternEntries(file: string): string[] {
  const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const entries = text.matchAll(/name: '([^']+)',\s*pattern:\s*(\/.+\/[a-z]*),?\s*\}/g);
  return [...entries].map(([, name, pattern]) => `${name ?? ''} ${pattern ?? ''}`);
}

describe('findSecret', () => {
  // #32 gives the shipped guard and the renderer one list; until then the two copies must not drift.
  it('uses the same patterns as the guard-secrets hook', () => {
    const hook = patternEntries('.claude/hooks/guard-secrets.mjs');
    expect(hook).toHaveLength(13);
    expect(patternEntries('src/core/secrets.ts')).toEqual(hook);
  });

  it.each(SECRET_SAMPLES)('finds a %s, which the guard-secrets hook denies', (name, secret) => {
    expect(findSecret(`# Notes\nconst value = '${secret}';\n`), name).toMatchObject({ line: 2 });
  });

  it.each(LOOKALIKE_SAMPLES)('finds nothing in a %s, which the guard-secrets hook allows', (_name, text) => {
    expect(findSecret(text)).toBeUndefined();
  });
});
