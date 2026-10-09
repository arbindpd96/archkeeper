export function stop(): never {
  return globalThis.process.exit(1);
}
