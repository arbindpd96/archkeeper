#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { exitWith } from './lib.mjs';

const USAGE = 'Usage: node scripts/build-schemas.mjs [--check] [<repo-root>]';
const FIX = 'Run npm run schema and commit schema/.';

// src/ imports its siblings as `./x.js` (NodeNext); Node's type stripping finds the `.ts` file only by its name.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('.') || !specifier.endsWith('.js')) return nextResolve(specifier, context);
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
  },
});

const z = await import('zod/mini');
const { moduleManifestSchema } = await import('../src/core/manifest-schema.ts');
const { configSchema } = await import('../src/core/config-schema.ts');

/** The generated files and the zod schemas they come from. */
const SCHEMAS = {
  'schema/config.schema.json': configSchema,
  'schema/module.schema.json': moduleManifestSchema,
};

/** Renders one schema as JSON Schema draft 7, which editors support best, describing the input a user writes. */
function render(schema) {
  return `${JSON.stringify(z.toJSONSchema(schema, { io: 'input', target: 'draft-7' }), null, 2)}\n`;
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const positionals = args.filter((arg) => !arg.startsWith('--'));
if (positionals.length > 1 || args.some((arg) => arg.startsWith('--') && arg !== '--check')) {
  exitWith(USAGE, 2);
}
const root = path.resolve(positionals[0] ?? '.');

const stale = [];
for (const [file, schema] of Object.entries(SCHEMAS)) {
  const target = path.join(root, file);
  const text = render(schema);
  if (check) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) stale.push(file);
    continue;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}
if (stale.length > 0) {
  exitWith(`build-schemas: ${stale.join(', ')} differ from the zod schemas in src/core.\n${FIX}`, 1);
}
