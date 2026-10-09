/** Matches AI co-author trailers and "Generated with Claude Code" lines; shared by the bash guard and commitlint. */
export const AI_ATTRIBUTION =
  /co-authored-by:[^\n]*(?:claude|noreply@anthropic\.com)|generated\s+(?:with|by)\s+\[?claude\s+code/i;
