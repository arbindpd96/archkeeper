#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { exitWith } from './lib.mjs';

const OUTPUT = 'THIRD_PARTY_LICENSES.md';
const LIST_SUFFIX = '.inlined.json';
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-_.][\w.-]+)?$/i;
const NODE_MODULES = 'node_modules/';
const REBUILD = 'Run npm run build: tsdown.config.mts writes the list beside each bundle.';

/** Lists every bundle under dist/, sorted so the output never depends on directory order. */
function bundles(dist) {
  return readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

/** Maps an inlined file such as `node_modules/@scope/pkg/lib/x.js` to its package folder. */
function packageFolder(file) {
  const start = file.lastIndexOf(NODE_MODULES);
  if (start === -1) return undefined;
  const segments = file.slice(start + NODE_MODULES.length).split('/');
  const nameLength = segments[0]?.startsWith('@') ? 2 : 1;
  return file.slice(0, start + NODE_MODULES.length) + segments.slice(0, nameLength).join('/');
}

/** Reads the files the bundler inlined into one bundle, from the list the build wrote beside it. */
function inlinedFiles(bundle, root) {
  const list = path.relative(root, bundle.replace(/\.mjs$/, LIST_SUFFIX));
  let files;
  try {
    files = JSON.parse(readFileSync(path.join(root, list), 'utf8'));
  } catch (error) {
    return exitWith(`third-party-licenses: cannot read ${list} (${error.message}).\n${REBUILD}`, 1);
  }
  if (!Array.isArray(files) || !files.every((file) => typeof file === 'string')) {
    exitWith(`third-party-licenses: ${list} is not a list of file paths.\n${REBUILD}`, 1);
  }
  return files.map((file) => file.replaceAll('\\', '/'));
}

/** Resolves a package folder, refusing any folder outside `<root>/node_modules`. */
function resolvePackageFolder(root, folder) {
  const nodeModules = path.join(root, 'node_modules');
  const resolved = path.resolve(root, folder);
  if (!resolved.startsWith(nodeModules + path.sep)) {
    exitWith(`third-party-licenses: ${folder} is outside ${nodeModules}; refusing to read it.`, 1);
  }
  return resolved;
}

/** Returns the license, including the legacy object and `licenses` array forms. */
function licenseOf({ license, licenses }) {
  if (typeof license === 'string') return license;
  const entries = [license, ...(Array.isArray(licenses) ? licenses : [])];
  const types = entries.map((entry) => entry?.type).filter((type) => typeof type === 'string');
  return types.length > 0 ? types.join(' OR ') : 'not declared';
}

/** Returns the source URL from a string or object `repository`, falling back to `homepage`. */
function repositoryOf({ repository, homepage }) {
  const url = typeof repository === 'string' ? repository : repository?.url;
  if (typeof url === 'string') return url;
  return typeof homepage === 'string' ? homepage : 'not declared';
}

/** Reads a package's name, version, license and license files. */
function readPackage(folder) {
  const manifest = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8'));
  const files = readdirSync(folder)
    .filter((file) => LICENSE_FILE.test(file))
    .sort()
    .map((file) => ({ file, text: readFileSync(path.join(folder, file), 'utf8').trim() }));
  return {
    id: `${manifest.name}@${manifest.version}`,
    license: licenseOf(manifest),
    repository: repositoryOf(manifest),
    files,
  };
}

/** Renders one package section, fencing each license text with more backticks than it contains. */
function renderPackage({ id, license, repository, files }) {
  const texts = files.map(({ file, text }) => {
    const fence = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)));
    return `### ${file}\n\n${fence}text\n${text}\n${fence}`;
  });
  const missing = files.length === 0 ? ['The package ships no license file.'] : [];
  return [`## ${id}`, `- License: ${license}\n- Source: ${repository}`, ...missing, ...texts].join('\n\n');
}

/** Builds the whole THIRD_PARTY_LICENSES.md text. */
function render(packages) {
  const intro =
    packages.length === 0
      ? 'The bundles in `dist/` inline no third-party packages.'
      : 'The bundles in `dist/` inline code from the npm packages below (ADR-0011). Their licenses follow.';
  return `${['# Third-party licenses', intro, ...packages.map(renderPackage)].join('\n\n')}\n`;
}

const root = path.resolve(process.argv[2] ?? '.');
const dist = path.join(root, 'dist');
const files = existsSync(dist) ? bundles(dist) : [];
if (files.length === 0) exitWith('third-party-licenses: no bundles in dist/. Run tsdown first.', 1);

const inlined = files.flatMap((bundle) => inlinedFiles(bundle, root));
const folders = new Set(inlined.map(packageFolder).filter(Boolean));
const byId = new Map(
  [...folders].map((folder) => readPackage(resolvePackageFolder(root, folder))).map((pkg) => [pkg.id, pkg]),
);
const packages = [...byId.keys()].sort().map((id) => byId.get(id));
writeFileSync(path.join(dist, OUTPUT), render(packages));
