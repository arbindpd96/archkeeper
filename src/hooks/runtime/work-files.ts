import { BRAND } from '../../core/brand.js';

// Docs are not the work a memory records or a test checks: anything under docs/, and Markdown and other markup
// anywhere. A .txt file counts as work, since requirements.txt and CMakeLists.txt are code.
const DOC_FILE = /\.(?:md|mdx|markdown|rst|adoc)$/i;

/**
 * Whether a project-relative path is work as the Stop hooks count it: not under `docs/`, not Markdown or other
 * markup, and not the kit's own state, such as the lock an update rewrites.
 */
export function isWorkFile(file: string): boolean {
  return !file.startsWith('docs/') && !file.startsWith(`${BRAND.stateDir}/`) && !DOC_FILE.test(file);
}
