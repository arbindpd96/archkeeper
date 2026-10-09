#!/usr/bin/env node
import { nodeVersionProblem } from './node-version.js';

const problem = nodeVersionProblem(process.versions.node);
if (problem !== undefined) {
  process.stderr.write(`${problem}\n`);
  process.exit(1);
}

// The dynamic import defers the program's own code until the check passes. Bundled node: imports are still
// hoisted above the check, so the CI node-gate job runs dist/cli.mjs on old Node.js to prove it is reached.
const { main } = await import('./main.js');
process.exitCode = main(process.argv.slice(2));
