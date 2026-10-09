import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type UserConfig } from 'tsdown';

const HOOK_SOURCES = path.join(import.meta.dirname, 'src/hooks');

// The target comes from engines.node. Output stays unminified: scripts/third-party-licenses.mjs reads its
// //#region markers, and onlyImport fails the build if a bundle would import anything but node: built-ins.
const shared = {
  platform: 'node',
  format: 'esm',
  dts: false,
  sourcemap: false,
  alias: { 'jsonc-parser': 'jsonc-parser/lib/esm/main.js' },
  outputOptions: { codeSplitting: false },
} satisfies UserConfig;

function hookFiles(): string[] {
  if (!existsSync(HOOK_SOURCES)) return [];
  return readdirSync(HOOK_SOURCES, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
    .map((entry) => entry.name)
    .sort();
}

// One build per hook keeps every hook bundle self-contained; with no hook sources there are no hook builds.
const hookBuilds = hookFiles().map((file): UserConfig => ({
  ...shared,
  entry: { [`hooks/${path.basename(file, '.ts')}`]: `src/hooks/${file}` },
  deps: { onlyBundle: [], onlyImport: [] },
}));

export default defineConfig([
  { ...shared, entry: { cli: 'src/cli/bin.ts' }, deps: { onlyImport: [] } },
  ...hookBuilds,
]);
