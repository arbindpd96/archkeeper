const ENV_FILE = /^\.env(?:rc)?(?![a-z0-9_-])/i;
const ENV_TEMPLATE = /^\.env\.(?:example|sample|template)$/i;

/** Tells whether a file name (no directories) is a secrets file such as `.env`, `.env.local`, `.envrc` or `.env~`. */
export function isEnvFileName(name) {
  return ENV_FILE.test(name) && !ENV_TEMPLATE.test(name);
}

/** Tells whether a file name is a committed template such as `.env.example`, which holds no secrets. */
export function isEnvTemplateName(name) {
  return ENV_TEMPLATE.test(name);
}
