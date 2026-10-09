import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Rolldown, type UserConfig } from 'tsdown';

const ROOT = import.meta.dirname;
const HOOK_SOURCES = path.join(ROOT, 'src/hooks');
const NODE_MODULES = /(?:^|\/)node_modules\//;

/**
 * Writes `<bundle>.inlined.json` beside each bundle, listing the `node_modules` files in its build's module
 * graph, relative to `root` and sorted. scripts/third-party-licenses.mjs reads these lists, so the license file
 * comes from the bundler rather than from comments in the output (#71). package.json `files` leaves them out.
 */
export function inlinedModules(root: string): Rolldown.Plugin {
  // Module ids may be real paths (macOS /var is a symlink) or keep the root as given (a Windows 8.3 short
  // name), so each id is made relative to whichever form contains it.
  const roots = [...new Set([realpathSync.native(root), path.resolve(root)])];
  const relative = (id: string): string => {
    const inside = roots.map((base) => path.relative(base, id)).find((file) => !file.startsWith('..'));
    return (inside ?? path.relative(roots[0] ?? root, id)).replaceAll('\\', '/');
  };
  return {
    name: 'inlined-modules',
    generateBundle(_options, bundle) {
      // The whole graph, not chunk.moduleIds: a module whose constants were folded into another module drops
      // out of moduleIds, yet its code still ships. Listing a package that tree-shaking emptied costs nothing.
      const files = [...this.getModuleIds()]
        .filter((id) => !id.startsWith('\0'))
        .map(relative)
        .filter((file) => NODE_MODULES.test(file));
      const source = `${JSON.stringify([...new Set(files)].sort(), null, 2)}\n`;
      const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
      for (const chunk of chunks) {
        this.emitFile({ type: 'asset', fileName: chunk.fileName.replace(/\.mjs$/, '.inlined.json'), source });
      }
    },
  };
}

// The target comes from engines.node, and onlyImport fails the build if a bundle would import anything but
// node: built-ins. Output stays unminified, so a stack trace from a user's machine points at readable code.
const shared = {
  platform: 'node',
  format: 'esm',
  dts: false,
  sourcemap: false,
  alias: { 'jsonc-parser': 'jsonc-parser/lib/esm/main.js' },
  outputOptions: { codeSplitting: false },
  plugins: [inlinedModules(ROOT)],
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
