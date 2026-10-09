function classMatcher(body) {
  const negated = body.startsWith('!') || body.startsWith('^');
  const members = negated ? body.slice(1) : body;
  return (char) => {
    let hit = false;
    for (let i = 0; i < members.length; i += 1) {
      const isRange = members[i + 1] === '-' && i + 2 < members.length;
      hit ||= isRange ? char >= members[i] && char <= members[i + 2] : char === members[i];
      if (isRange) i += 2;
    }
    return hit !== negated;
  };
}

function closingBrackets(pattern) {
  const closes = new Array(pattern.length + 2).fill(-1);
  for (let i = pattern.length - 1; i >= 0; i -= 1) closes[i] = pattern[i] === ']' ? i : closes[i + 1];
  return closes;
}

function globTokens(pattern) {
  const closes = closingBrackets(pattern);
  const tokens = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const close = char === '[' ? closes[index + 2] : -1;
    if (close !== -1) tokens.push(classMatcher(pattern.slice(index + 1, close)));
    if (close !== -1) index = close;
    else if (char === '*' || char === '?') tokens.push(char);
    else {
      const literal = char === '\\' ? (pattern[(index += 1)] ?? '\\') : char;
      tokens.push((candidate) => candidate === literal);
    }
  }
  return tokens;
}

function advance(reachable, token, name) {
  const next = new Set();
  if (token === '*') {
    for (let at = Math.min(...reachable); at <= name.length; at += 1) next.add(at);
    return next;
  }
  for (const at of reachable) {
    if (at < name.length && (token === '?' || token(name[at]))) next.add(at + 1);
  }
  return next;
}

/** Tells whether a shell glob (`*`, `?`, `[...]`) matches a name, in O(pattern × name) time for any input. */
export function globMatches(pattern, name) {
  let reachable = new Set([0]);
  for (const token of globTokens(pattern)) {
    reachable = advance(reachable, token, name);
    if (reachable.size === 0) return false;
  }
  return reachable.has(name.length);
}
