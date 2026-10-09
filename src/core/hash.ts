import { createHash } from 'node:crypto';
import { toLf } from './text.js';

/** The form of every hash in the lock and every blob name: 64 lowercase hex digits, so none can name a path. */
export const HASH = /^[0-9a-f]{64}$/;

/** The sha256 of `text` in hex, after LF normalisation, so an autocrlf checkout reads as unchanged (ADR-0014). */
export function contentHash(text: string): string {
  return createHash('sha256').update(toLf(text), 'utf8').digest('hex');
}

/** The sha256 of the exact UTF-8 bytes of `text` in hex, for telling whether a file changed at all. */
export function exactHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
