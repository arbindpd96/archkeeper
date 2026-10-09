import * as z from 'zod/mini';
import { refusing } from './schema-parts.js';

const ENV_HINT =
  'write ${NAME}: values reference an environment variable and never hold a literal value (ADR-0007)';
const REFERENCE = String.raw`\$\{[A-Za-z_][A-Za-z0-9_]*\}`;
const envReference = z.string().check(z.regex(new RegExp(`^${REFERENCE}$`), { error: ENV_HINT }));
const serverName = z.string().check(z.regex(/^[A-Za-z0-9_-]+$/, { error: 'use letters, digits, _ and -' }));
const nonEmpty = z.string().check(z.minLength(1));

// Claude Code reads these variables as empty in a remote url or header (reference §5.1).
const CREDENTIAL_NAME = /TOKEN|SECRET|PASSWORD|KEY|AUTH/i;
const OAUTH_HINT =
  'authenticate the server with OAuth or a headersHelper script: a credential variable reads as empty here';
const noCredentialVariable = refusing((value) => {
  const name = [...value.matchAll(/\$\{([^}]*)\}/g)].find((match) => CREDENTIAL_NAME.test(match[1] ?? ''));
  if (name === undefined) return undefined;
  return { problem: `uses \${${name[1] ?? ''}}, which Claude Code reads as empty`, hint: OAUTH_HINT };
});

const QUERY_PART = String.raw`[^\s=&#]+=${REFERENCE}`;
const URL_SHAPE = String.raw`^https?:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?(?:\?${QUERY_PART}(?:&${QUERY_PART})*)?$`;
const URL_HINT =
  'use an http(s) URL with no user:password@ and no #fragment, whose query values are ${NAME} references';
const url = z.string().check(z.regex(new RegExp(URL_SHAPE), { error: URL_HINT }), noCredentialVariable);
const remoteReference = envReference.check(noCredentialVariable);
const HELPER_HINT =
  'name a script in the project, such as ${CLAUDE_PROJECT_DIR:-.}/scripts/mcp-headers.sh, with no arguments: ' +
  'it prints the headers, so .mcp.json holds no secret and no command line';
const headersHelper = z
  .string()
  .check(
    z.regex(/^\$\{CLAUDE_PROJECT_DIR:-\.\}(?:\/(?!\.\.?(?:\/|$))[\w.][\w.-]*)+$/, { error: HELPER_HINT }),
  );
/** An MCP server entry for `.mcp.json`: configure-only, with no literal secret (ADR-0007, reference §5.1). */
export const mcpServerSchema = z.discriminatedUnion('type', [
  z.strictObject({
    name: serverName,
    type: z.literal('stdio'),
    command: nonEmpty,
    args: z.optional(z.array(z.string())),
    env: z.optional(z.record(z.string(), envReference)),
  }),
  z.strictObject({
    name: serverName,
    type: z.enum(['http', 'sse']),
    url,
    headers: z.optional(z.record(z.string(), remoteReference)),
    headersHelper: z.optional(headersHelper),
  }),
]);
