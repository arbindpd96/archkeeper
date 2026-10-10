type GlobToken = '*' | '?' | ((char: string) => boolean);

function classMatcher(body: string): (char: string) => boolean {
  const negated = body.startsWith('!') || body.startsWith('^');
  const members = negated ? body.slice(1) : body;
  return (char) => {
    let hit = false;
    for (let index = 0; index < members.length; index += 1) {
      const isRange = members[index + 1] === '-' && index + 2 < members.length;
      const low = members[index] ?? '';
      hit ||= isRange ? char >= low && char <= (members[index + 2] ?? '') : char === low;
      if (isRange) index += 2;
    }
    return hit !== negated;
  };
}

function closingBrackets(pattern: string): number[] {
  const closes = new Array<number>(pattern.length + 2).fill(-1);
  for (let index = pattern.length - 1; index >= 0; index -= 1) {
    closes[index] = pattern[index] === ']' ? index : (closes[index + 1] ?? -1);
  }
  return closes;
}

// A backslash makes the next character literal; a trailing one matches itself.
function literalToken(pattern: string, index: number): { token: GlobToken; next: number } {
  const char = pattern.charAt(index);
  const escaped = char === '\\';
  const literal = escaped ? pattern.charAt(index + 1) || '\\' : char;
  return { token: (candidate) => candidate === literal, next: index + (escaped ? 2 : 1) };
}

function globTokens(pattern: string): GlobToken[] {
  const closes = closingBrackets(pattern);
  const tokens: GlobToken[] = [];
  let index = 0;
  while (index < pattern.length) {
    const char = pattern.charAt(index);
    const close = char === '[' ? (closes[index + 2] ?? -1) : -1;
    if (close !== -1) {
      tokens.push(classMatcher(pattern.slice(index + 1, close)));
      index = close + 1;
    } else if (char === '*' || char === '?') {
      tokens.push(char);
      index += 1;
    } else {
      const { token, next } = literalToken(pattern, index);
      tokens.push(token);
      index = next;
    }
  }
  return tokens;
}

function advance(reachable: ReadonlySet<number>, token: GlobToken, name: string): Set<number> {
  const next = new Set<number>();
  if (token === '*') {
    for (let at = Math.min(...reachable); at <= name.length; at += 1) next.add(at);
    return next;
  }
  for (const at of reachable) {
    if (at < name.length && (token === '?' || token(name[at] ?? ''))) next.add(at + 1);
  }
  return next;
}

/** Tells whether a shell glob (`*`, `?`, `[...]`) matches a name, in O(pattern × name) time for any input. */
export function globMatches(pattern: string, name: string): boolean {
  let reachable = new Set([0]);
  for (const token of globTokens(pattern)) {
    reachable = advance(reachable, token, name);
    if (reachable.size === 0) return false;
  }
  return reachable.has(name.length);
}
