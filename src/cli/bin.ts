#!/usr/bin/env node
import { nodeVersionProblem } from './node-version.js';

const problem = nodeVersionProblem(process.versions.node);
if (problem !== undefined) {
  process.stderr.write(`${problem}\n`);
  process.exit(1);
}

// Imported only after the check, so on an old Node.js the program never starts to evaluate.
const { main } = await import('./main.js');
process.exitCode = main(process.argv.slice(2));
