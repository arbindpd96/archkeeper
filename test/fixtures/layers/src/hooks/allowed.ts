import { writeFileSync } from 'node:fs';
import { readPayload } from './runtime/allowed.js';

writeFileSync(1, JSON.stringify(readPayload()));
