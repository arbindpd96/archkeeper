import * as z from 'zod/mini';
import { type Refusal, refusing } from './schema-parts.js';

const ENV_HINT =
  'write ${NAME}: values reference an environment variable and never hold a literal value (ADR-0007)';
const REFERENCE = String.raw`\$\{[A-Za-z_][A-Za-z0-9_]*\}`;
const REFERENCE_ONLY = new RegExp(`^${REFERENCE}$`);
const envReference = z.string().check(z.regex(REFERENCE_ONLY, { error: ENV_HINT }));
const serverName = z.string().check(z.regex(/^[A-Za-z0-9_-]+$/, { error: 'use letters, digits, _ and -' }));

// A run of 20 or more letters and digits that mixes both, such as a 32-character hex key, is a literal key.
function holdsLiteralKey(text: string): boolean {
  const runs = text.replaceAll(/\$\{[^}]*\}/g, ' ').match(/[A-Za-z0-9]{20,}/g) ?? [];
  return runs.some((run) => /\d/.test(run) && /[A-Za-z]/.test(run));
}
const LITERAL_KEY = 'holds what looks like a literal key or token';

// Claude Code reads these variables as empty in a remote url or header (reference §5.1).
const CREDENTIAL_NAME = /TOKEN|SECRET|PASSWORD|KEY|AUTH/i;
const OAUTH_HINT =
  'authenticate the server with OAuth or a headersHelper script: a credential variable reads as empty here';
const noCredentialVariable = refusing((value) => {
  const name = [...value.matchAll(/\$\{([^}]*)\}/g)].find((match) => CREDENTIAL_NAME.test(match[1] ?? ''));
  if (name === undefined) return undefined;
  return { problem: `uses \${${name[1] ?? ''}}, which Claude Code reads as empty`, hint: OAUTH_HINT };
});
const URL_KEY_HINT = 'keep keys out of the URL: authenticate the server with OAuth or a headersHelper script';
const noLiteralKey = refusing((value) =>
  holdsLiteralKey(value) ? { problem: LITERAL_KEY, hint: URL_KEY_HINT } : undefined,
);

const QUERY_PART = String.raw`[^\s=&#]+=${REFERENCE}`;
// Plain http is only for a server on this machine, so headers and helper output never cross a network in clear.
const ORIGIN = String.raw`(?:https:\/\/[^\s/?#@]+|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)`;
const URL_SHAPE = String.raw`^${ORIGIN}(?:\/[^\s?#]*)?(?:\?${QUERY_PART}(?:&${QUERY_PART})*)?$`;
const URL_HINT =
  'use an https URL (http only for localhost, 127.0.0.1 or [::1]) with no user:password@ and no #fragment, ' +
  'whose query values are ${NAME} references';
const url = z
  .string()
  .check(z.regex(new RegExp(URL_SHAPE), { error: URL_HINT }), noCredentialVariable, noLiteralKey);
const remoteReference = envReference.check(noCredentialVariable);
const headerName = z
  .string()
  .check(
    z.regex(/^[\w!#$%&'*+.^`|~-]+$/, { error: 'use the letters, digits and symbols of an HTTP header name' }),
  );
const HELPER_HINT =
  'name a script in the project, such as ${CLAUDE_PROJECT_DIR:-.}/scripts/mcp-headers.sh, with no arguments: ' +
  'it prints the headers, so .mcp.json holds no secret and no command line';
const headersHelper = z
  .string()
  .check(
    z.regex(/^\$\{CLAUDE_PROJECT_DIR:-\.\}(?:\/(?!\.\.?(?:\/|$))[\w.][\w.-]*)+$/, { error: HELPER_HINT }),
  );

const CREDENTIAL_FLAG = /^--?(?:[a-z0-9]+[-_])*(?:key|token|secret|password|auth)(?:[-_][a-z0-9]+)*$/i;
const ARG_KEY_HINT =
  'pass the key from the environment as ${NAME}, such as --token ${GITHUB_TOKEN}: the kit never writes a secret ' +
  '(ADR-0007)';

function stdioValueRefusal(value: string, flag: string | undefined): Refusal | undefined {
  if (flag !== undefined && CREDENTIAL_FLAG.test(flag) && !REFERENCE_ONLY.test(value)) {
    return { problem: `gives ${flag} a literal value`, hint: ARG_KEY_HINT };
  }
  return holdsLiteralKey(value) ? { problem: LITERAL_KEY, hint: ARG_KEY_HINT } : undefined;
}

// An argument is a --flag=value pair, or a value for the flag before it.
function argRefusal(arg: string, previous: string | undefined): Refusal | undefined {
  const pair = /^(--?[\w-]+)=(.*)$/.exec(arg);
  return pair === null ? stdioValueRefusal(arg, previous) : stdioValueRefusal(pair[2] ?? '', pair[1]);
}

const command = z.string().check(
  z.minLength(1),
  refusing((value) => stdioValueRefusal(value, undefined)),
);
const args = z.array(z.string()).check(
  z.superRefine((values: string[], context) => {
    for (const [index, arg] of values.entries()) {
      const refusal = argRefusal(arg, values[index - 1]);
      if (refusal === undefined) continue;
      const { problem, hint } = refusal;
      context.addIssue({ code: 'custom', input: arg, path: [index], message: hint, params: { problem } });
      return;
    }
  }),
);

/** An MCP server entry for `.mcp.json`: configure-only, with no literal secret (ADR-0007, reference §5.1). */
export const mcpServerSchema = z.discriminatedUnion('type', [
  z.strictObject({
    name: serverName,
    type: z.literal('stdio'),
    command,
    args: z.optional(args),
    env: z.optional(z.record(z.string(), envReference)),
  }),
  z.strictObject({
    name: serverName,
    type: z.enum(['http', 'sse']),
    url,
    headers: z.optional(z.record(headerName, remoteReference)),
    headersHelper: z.optional(headersHelper),
  }),
]);
