const SLUG = 'archkeeper';

/** Every string derived from the product name; core APIs take one as `brand: Brand = BRAND`. */
export interface Brand {
  readonly npmName: string;
  readonly binName: string;
  readonly displayName: string;
  readonly pluginName: string;
  readonly marketplaceName: string;
  /** Prefix of managed-block markers, as in `<!-- archkeeper:begin <id> -->`. */
  readonly markerPrefix: string;
  /** Project-root dot-folder for the lockfile and base blobs, kept outside `.claude/`. */
  readonly stateDir: string;
  /** Project folder that receives the generated hook scripts. */
  readonly hookDir: string;
  /** Project folder that receives the generated path-scoped rules. */
  readonly rulesDir: string;
  /** Suffix of the file an update writes beside a user-edited file instead of overwriting it. */
  readonly sidecarSuffix: string;
  /** Non-affiliation notice shown wherever the product presents itself. */
  readonly disclaimer: string;
  /** Earlier slugs that `update` migrates from; empty until a rename happens after publish. */
  readonly legacySlugs: readonly string[];
}

/** The product's brand: the only place the slug is written (ADR-0012); `check-brand` enforces it. */
export const BRAND: Brand = Object.freeze({
  npmName: SLUG,
  binName: SLUG,
  displayName: SLUG,
  pluginName: SLUG,
  marketplaceName: SLUG,
  markerPrefix: SLUG,
  stateDir: `.${SLUG}`,
  hookDir: `.claude/hooks/${SLUG}`,
  rulesDir: `.claude/rules/${SLUG}`,
  sidecarSuffix: `.${SLUG}-new`,
  disclaimer:
    'Independent community project; not affiliated with, endorsed by, or sponsored by Anthropic. ' +
    'Claude and Claude Code are trademarks of Anthropic, PBC.',
  legacySlugs: Object.freeze([]),
});
