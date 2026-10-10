import { workerData } from 'node:worker_threads';
import { importsInText } from './markdown-imports.mjs';

// The worker thread of markdown-imports.mjs's importsOf: it reads each text it is sent on the deeper stack it was
// started with, replies with the imports or the error, then wakes the caller waiting on the signal.
const { port, signal } = workerData;

function reply(text) {
  try {
    return { imports: importsInText(text) };
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

port.on('message', (text) => {
  try {
    port.postMessage(reply(text));
  } finally {
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
  }
});
