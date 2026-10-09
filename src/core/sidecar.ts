import type { Brand } from './brand.js';
import type { PathState } from './plan-types.js';
import { toLf } from './text.js';

/** What to do with a sidecar: write it, leave it because it already holds the content, or keep what is there. */
export type SidecarAction = 'write' | 'same' | 'kept';

/** The sidecar of a project path, such as `CLAUDE.md` plus the sidecar suffix of the brand (ADR-0014). */
export function sidecarPath(path: string, brand: Pick<Brand, 'sidecarSuffix'>): string {
  return `${path}${brand.sidecarSuffix}`;
}

/**
 * Decides whether a sidecar may be written with `content`. A missing sidecar is written; one that already holds
 * the content is left alone; one that `unedited` recognises as the kit's earlier sidecar is rewritten; anything
 * else, such as a sidecar the user edited, a symlink or a user's own file at that path, is never overwritten.
 */
export function sidecarAction(
  state: PathState | undefined,
  content: string,
  unedited: (text: string) => boolean,
): SidecarAction {
  if (state === undefined) return 'write';
  if (state.kind !== 'file') return 'kept';
  if (toLf(state.content) === toLf(content)) return 'same';
  return unedited(state.content) ? 'write' : 'kept';
}

/** The reason a sidecar was not written, for the plan. */
export function keptSidecarReason(path: string, brand: Pick<Brand, 'sidecarSuffix'>): string {
  return `${sidecarPath(path, brand)} was edited or is not the kit's, so it is left alone and the kit version is not offered`;
}
