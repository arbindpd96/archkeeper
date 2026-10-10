const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;

/** Text Claude Code reads `@` imports in: inline Markdown, or what an HTML comment block leaves, which it reads raw. */
export interface ImportText {
  readonly text: string;
  readonly raw: boolean;
}

/** Splits a Markdown memory file into the text Claude Code reads `@` imports in: what lies outside code fences. */
export function importTexts(text: string): ImportText[] {
  const kept: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) kept.push(line);
  }
  return [{ text: kept.join('\n'), raw: false }];
}
