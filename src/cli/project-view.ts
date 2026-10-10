import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { ProjectView } from '../core/stack-profile.js';
import { compareText } from '../core/text.js';
import { confinedPath, lstatOrUndefined, readConfined } from './project-files.js';

const SOURCE = 'read to detect the stack';

/**
 * The project at `rootReal` as stack detection reads it (#25): every path is confined to the project (#23), a
 * symlink is never read or listed through, so a `.claude` linked to a dotfiles folder lists as empty, and a folder
 * lists its names in a fixed order.
 */
export function projectView(rootReal: string): ProjectView {
  return {
    list: (folder) => {
      if (folder === '') return readdirSync(rootReal).sort(compareText);
      if (lstatOrUndefined(path.join(rootReal, ...folder.split('/')))?.isDirectory() !== true) return [];
      return readdirSync(confinedPath(rootReal, folder, SOURCE)).sort(compareText);
    },
    read: (file) => {
      const state = readConfined(rootReal, file, SOURCE);
      return state?.kind === 'file' ? state.content : undefined;
    },
  };
}
