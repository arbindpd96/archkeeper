import { describe, expect, it } from 'vitest';
import { bashDecision } from './hook-helpers.js';

// Each payload is only judged as text: base64 of `rm -rf ~` and of `print(1)`, never decoded or run.
const DELETE_HOME_B64 = 'cm0gLXJmIH4=';
const PRINT_B64 = 'cHJpbnQoMSk=';

describe('guard-bash: decoded or transformed text read as a program', () => {
  it.each([
    `echo ${DELETE_HOME_B64} | base64 -d | sh`,
    `echo ${DELETE_HOME_B64} | base64 --decode | bash`,
    `base64 -d <<< ${DELETE_HOME_B64} | sh`,
    `base64 -d <<< ${DELETE_HOME_B64} | zsh -s`,
    `base64 -d <<EOF | sh\n${DELETE_HOME_B64}\nEOF`,
    `base64 -d <<'EOF' | bash\n${DELETE_HOME_B64}\nEOF`,
    'xxd -r -p <<< 726d202d7266207e | sh',
    "tr a-z n-za-m <<< 'ez -es ~' | zsh",
    "rev <<< '~ fr- mr' | sh",
    `openssl enc -d -base64 <<< ${DELETE_HOME_B64} | sh`,
    `openssl base64 -d -in x.b64 | bash`,
    'gunzip -c x.gz | sh',
    `base64 -d <<< ${DELETE_HOME_B64} | cat | sh`,
    'tee <<< "ls" | sh',
    `base64 -d <<< ${DELETE_HOME_B64} | xargs -0 sh -c`,
    `base64 -d <<< ${DELETE_HOME_B64} | env sh`,
    `base64 -d <<< ${DELETE_HOME_B64} | busybox sh`,
    `base64 -d <<< ${DELETE_HOME_B64} | "$SHELL"`,
    `{ base64 -d <<< ${DELETE_HOME_B64}; } | sh`,
  ])('asks before a transforming program feeds a shell: %s', (command) => {
    expect(bashDecision(command)).toBe('ask');
  });

  it.each([
    `sh < <(base64 -d <<< ${DELETE_HOME_B64})`,
    `sh 0< <(echo ${DELETE_HOME_B64} | base64 -d)`,
    `bash <(base64 -d <<< ${DELETE_HOME_B64})`,
    `source <(base64 -d <<< ${DELETE_HOME_B64})`,
    `. <(base64 -d <<< ${DELETE_HOME_B64})`,
    'sh <(echo ls)',
    `python3 <(base64 -d <<< ${PRINT_B64})`,
  ])('asks before a shell runs what a process substitution prints: %s', (command) => {
    expect(bashDecision(command)).toBe('ask');
  });

  it.each([
    `bash <<< "$(base64 -d <<< ${DELETE_HOME_B64})"`,
    `bash <<EOF\n$(base64 -d <<< ${DELETE_HOME_B64})\nEOF`,
    `sh -c "$(base64 -d <<< ${DELETE_HOME_B64})"`,
    `eval "$(base64 -d <<< ${DELETE_HOME_B64})"`,
    `python3 <<< "$(base64 -d <<< ${PRINT_B64})"`,
    `echo ${PRINT_B64} | base64 -d | python3`,
    `base64 -d <<< ${PRINT_B64} | node -`,
    `base64 -d <<< ${PRINT_B64} | perl`,
  ])('asks before decoded text becomes the code a shell or interpreter runs: %s', (command) => {
    expect(bashDecision(command)).toBe('ask');
  });

  it.each([
    'sh /dev/stdin <<< "rm -rf ~"',
    'bash -s -- -x <<< "rm -rf ~"',
    'sh - <<EOF\nrm -rf ~\nEOF',
    "echo 'rm -rf ~' <<< ls | sh",
    "printf 'rm -rf ~' <<< ls | sh",
    'cat <<EOF | sh\nrm -rf ~\nEOF',
    'cat - <<EOF | bash\nrm -rf ~\nEOF',
  ])('judges the shell code a here-document, echo or printf feeds a shell: %s', (command) => {
    expect(bashDecision(command)).toBe('deny');
  });

  it.each([
    'cat <<EOF | sh\nls\nEOF',
    'echo ls | sh',
    "echo 'print(1)' | python3",
    "python3 <<'EOF'\nprint(1)\nEOF",
    'diff <(ls a) <(ls b)',
    `echo ${DELETE_HOME_B64} | base64 -d`,
    `base64 -d <<< ${DELETE_HOME_B64} > decoded.txt`,
    'bash -c "cat" <<< "rm -rf /"',
  ])('allows %s, which runs no hidden text', (command) => {
    expect(bashDecision(command)).toBe('allow');
  });
});
