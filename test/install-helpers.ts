import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { readBlob } from '../src/cli/blob-store.js';
import type { InstallOptions } from '../src/cli/install.js';
import { loadModule, type ReadKitFile } from '../src/core/loader.js';
import { render } from '../src/core/render.js';
import type { RenderTree } from '../src/core/render-tree.js';
import { toImport } from '../src/core/template.js';
import { compareText } from '../src/core/text.js';
import { REPO_ROOT } from './helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const FIXTURE = path.join(REPO_ROOT, 'test/fixtures/render');

// dist/ is gitignored everywhere, so the fixture keeps its hook bundles in hook-bundles/.
const readFixture: ReadKitFile = (file) => {
  const local = path.join(FIXTURE, file.replace(/^dist\/hooks\//, 'hook-bundles/'));
  return existsSync(local) ? readFileSync(local, 'utf8') : undefined;
};

/** The render fixture's three modules rendered for the test brand. */
export function fixtureTree(): RenderTree {
  const modules = ['core-docs', 'guard', 'servers'].map((id) => loadModule(id, readFixture));
  const values = { imports: { agents: toImport('AGENTS.md'), design: toImport('Design Docs/api.md') } };
  return render(modules, { stack: ['ts', 'python'], values }, TEST_BRAND);
}

/** Install options for the test brand and kit. */
export const OPTIONS: InstallOptions = {
  kit: { name: 'acmekit', version: '1.0.0' },
  modules: ['core-docs', 'guard', 'servers'],
  brand: TEST_BRAND,
};

/** Every file under `dir` as a relative path with forward slashes, sorted, folders and backups left out. */
export function filesUnder(dir: string, relative = ''): string[] {
  const entries = readdirSync(path.join(dir, relative), { withFileTypes: true });
  return entries
    .flatMap((entry) => {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      return entry.isDirectory() ? filesUnder(dir, child) : [child];
    })
    .sort(compareText);
}

function describeFile(dir: string, file: string): string {
  const absolute = path.join(dir, file);
  if (lstatSync(absolute).isSymbolicLink()) return `-> ${readlinkSync(absolute)}\n`;
  const name = path.basename(file);
  if (file.startsWith(`${TEST_BRAND.stateDir}/base/`)) {
    return `<gzip blob of ${String(readBlob(name, readFileSync(absolute)).length)} characters>\n`;
  }
  // Snapshots are stored with LF on every OS, so a CR the kit keeps or writes must show as text.
  return readFileSync(absolute, 'utf8').replaceAll('\r', '<CR>');
}

/** The project as text for a snapshot: each file and its content; blobs are checked and summarised, backups left out. */
export function projectText(dir: string): string {
  const backups = `${TEST_BRAND.stateDir}/local/backup/`;
  return filesUnder(dir)
    .filter((file) => !file.startsWith(backups))
    .map((file) => `=== ${file}\n${describeFile(dir, file)}`)
    .join('');
}
