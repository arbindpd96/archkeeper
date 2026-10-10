import { createHash } from 'node:crypto';
import { toLf } from './text.js';

/** The form of every hash in the lock and every blob name: 64 lowercase hex digits, so none can name a path. */
export const HASH = /^[0-9a-f]{64}$/;

/** The sha256 of `text` in hex, after LF normalisation, so an autocrlf checkout reads as unchanged (ADR-0014). */
export function contentHash(text: string): string {
  return createHash('sha256').update(toLf(text), 'utf8').digest('hex');
}

/** The sha256 in hex of exact bytes (a string as UTF-8), for telling whether a file changed at all. */
export function exactHash(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
