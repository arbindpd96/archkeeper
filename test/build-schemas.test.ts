import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, runScript, tempDir } from './helpers.js';

const SCRIPT = 'scripts/build-schemas.mjs';
const GENERATED = ['schema/config.schema.json', 'schema/module.schema.json'];

describe('build-schemas', () => {
  it('finds the committed schemas current', () => {
    const result = runScript(SCRIPT, { args: ['--check', REPO_ROOT] });
    expect(result.stderr).not.toContain('build-schemas:');
    expect(result.status).toBe(0);
  });

  it('writes every schema, and the check then passes', () => {
    const root = tempDir();
    expect(runScript(SCRIPT, { args: [root] }).status).toBe(0);
    for (const file of GENERATED) {
      expect(readFileSync(path.join(root, file), 'utf8')).toBe(
        readFileSync(path.join(REPO_ROOT, file), 'utf8'),
      );
    }
    expect(runScript(SCRIPT, { args: ['--check', root] }).status).toBe(0);
  });

  it('fails the check when a schema is missing, naming the fix', () => {
    const result = runScript(SCRIPT, { args: ['--check', tempDir()] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'schema/config.schema.json, schema/module.schema.json differ from the zod schemas in src/core',
    );
    expect(result.stderr).toContain('Run npm run schema and commit schema/.');
  });

  it('fails the check when a schema was edited by hand', () => {
    const root = tempDir();
    runScript(SCRIPT, { args: [root] });
    const file = path.join(root, 'schema/module.schema.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"Module manifest"', '"Edited"'));
    expect(runScript(SCRIPT, { args: ['--check', root] }).status).toBe(1);
  });

  it('rejects an unknown option with usage', () => {
    const result = runScript(SCRIPT, { args: ['--write'] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: node scripts/build-schemas.mjs');
  });
});
