#!/usr/bin/env node
import { nodeVersionProblem } from './node-version.js';

const problem = nodeVersionProblem(process.versions.node);
if (problem !== undefined) {
  process.stderr.write(`${problem}\n`);
  process.exit(1);
}

// The dynamic import defers the program, and the node: built-ins it links, until the check passes: the build
// emits it as its own chunk, check-package fails a bin that links a built-in statically, and the CI node-gate
// job runs dist/cli.mjs on old Node.js to prove the check is reached.
const { main } = await import('./main.js');
process.exitCode = await main(process.argv.slice(2));
