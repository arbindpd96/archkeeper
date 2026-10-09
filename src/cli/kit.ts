import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Catalog, loadCatalog, type ReadKitFile } from '../core/loader.js';

/** The nearest folder above `fromUrl` that holds a package.json: the package root, both in src/ and in dist/. */
export function packageRoot(fromUrl: string = import.meta.url): string {
  let directory = path.dirname(fileURLToPath(fromUrl));
  while (!existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`No package.json found above ${fileURLToPath(fromUrl)}.`);
    directory = parent;
  }
  return directory;
}

/** Reads kit files by package-relative path under `root`; a file that does not exist reads as undefined. */
export function kitReader(root: string): ReadKitFile {
  return (file) => {
    try {
      return readFileSync(path.join(root, file), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };
}

/** Loads and validates the modules and presets the package ships under `<root>/modules`. */
export function readKit(root: string = packageRoot()): Catalog {
  const ids = readdirSync(path.join(root, 'modules'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return loadCatalog(ids, kitReader(root));
}
