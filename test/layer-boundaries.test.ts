import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.js';

const BOUNDARY_RULES = new Set([
  'no-restricted-imports',
  'no-restricted-properties',
  'no-restricted-globals',
  'no-restricted-syntax',
]);

// The fixtures mirror src/ under their own root and sit outside tsconfig, so type-aware rules are off.
const eslint = new ESLint({
  cwd: path.join(REPO_ROOT, 'test/fixtures/layers'),
  overrideConfigFile: path.join(REPO_ROOT, 'eslint.config.mjs'),
  overrideConfig: tseslint.configs.disableTypeChecked,
  ignore: false,
});

async function boundaryViolations(file: string): Promise<{ ruleId: string; message: string }[]> {
  const [result] = await eslint.lintFiles([file]);
  return (result?.messages ?? [])
    .filter((message) => BOUNDARY_RULES.has(message.ruleId ?? ''))
    .map(({ ruleId, message }) => ({ ruleId: ruleId ?? '', message }));
}

describe('layer boundaries (ADR-0011)', () => {
  it.each([
    ['src/core/imports-cli.ts', 'no-restricted-imports'],
    ['src/core/imports-commander.ts', 'no-restricted-imports'],
    ['src/core/imports-clack.ts', 'no-restricted-imports'],
    ['src/core/calls-process-exit.ts', 'no-restricted-properties'],
    ['src/core/imports-exit-from-node-process.ts', 'no-restricted-imports'],
    ['src/core/imports-exit-from-process.ts', 'no-restricted-imports'],
    ['src/core/global-this-process-exit.ts', 'no-restricted-syntax'],
    ['src/core/uses-console.ts', 'no-restricted-globals'],
    ['src/core/imports-node-console.ts', 'no-restricted-imports'],
    ['src/core/imports-console.ts', 'no-restricted-imports'],
    ['src/core/global-this-console.ts', 'no-restricted-properties'],
    ['src/core/uses-process-env.ts', 'no-restricted-globals'],
    ['src/core/global-this-process.ts', 'no-restricted-properties'],
    ['src/core/imports-node-fs.ts', 'no-restricted-imports'],
    ['src/core/imports-fs-promises.ts', 'no-restricted-imports'],
    ['src/hooks/imports-core.ts', 'no-restricted-imports'],
    ['src/hooks/runtime/imports-package.ts', 'no-restricted-imports'],
  ])('%s breaks %s', async (file, ruleId) => {
    expect(await boundaryViolations(file)).toContainEqual({
      ruleId,
      message: expect.stringContaining('ADR-0011') as string,
    });
  });

  it.each(['src/hooks/allowed.ts', 'src/hooks/runtime/allowed.ts'])(
    '%s imports only what its layer allows',
    async (file) => {
      expect(await boundaryViolations(file)).toEqual([]);
    },
  );
});
