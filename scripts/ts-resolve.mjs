import { registerHooks } from 'node:module';

// src/ imports its siblings as `./x.js` (NodeNext); Node's type stripping finds the `.ts` file only by its name.
// Importing this file (or passing it to node --import) lets plain Node.js run src/ without a build.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('.') || !specifier.endsWith('.js')) return nextResolve(specifier, context);
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
  },
});
