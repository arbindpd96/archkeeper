import { readdirSync } from 'node:fs';
import type { ProjectView } from '../core/stack-profile.js';
import { compareText } from '../core/text.js';
import { confinedPath, lstatOrUndefined, readConfined } from './project-files.js';

const SOURCE = 'read to detect the stack';

/**
 * The project at `rootReal` as stack detection reads it (#25): every path is confined to the project (#23), a
 * symlink is never read through, and a folder lists its names in a fixed order.
 */
export function projectView(rootReal: string): ProjectView {
  return {
    list: (folder) => {
      const absolute = folder === '' ? rootReal : confinedPath(rootReal, folder, SOURCE);
      if (lstatOrUndefined(absolute)?.isDirectory() !== true) return [];
      return readdirSync(absolute).sort(compareText);
    },
    read: (file) => {
      const state = readConfined(rootReal, file, SOURCE);
      return state?.kind === 'file' ? state.content : undefined;
    },
  };
}
