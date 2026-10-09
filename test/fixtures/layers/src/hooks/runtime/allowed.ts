import { readFileSync } from 'node:fs';
import { BRAND } from '../../core/brand.js';

export function readPayload(): unknown {
  return { brand: BRAND.npmName, payload: JSON.parse(readFileSync(0, 'utf8')) as unknown };
}
