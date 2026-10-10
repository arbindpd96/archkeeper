import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { bashContext, bashDecision, bashVerdict } from './hook-helpers.js';

const policies = bashContext({ blockNoVerify: true, blockAiAttribution: true });

describe('guard-bash repo policies, off by default (ADR-0015)', () => {
  it.each([
    'git commit --no-verify -m "x"',
    'git commit -n -m x',
    'git commit --no-verif -m x',
    'git merge --no-verify feat',
    'HUSKY=0 git commit -m x',
    'declare -x HUSKY=0',
    'git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\n)" --no-verify',
    'git commit -m "feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"',
    'gh pr create --body "Generated with [Claude Code](https://claude.com)"',
  ])('allows %s by default and denies it under the policy options', (command) => {
    expect(bashDecision(command)).toBe('allow');
    expect(bashDecision(command, policies)).toBe('deny');
  });

  it.each([
    'git -c core.hooksPath=/dev/null commit -m x',
    'git config core.hooksPath /dev/null',
    'export GIT_CONFIG_KEY_0=core.hooksPath',
  ])('asks before %s by default, as git may run a program, and denies it with blockNoVerify', (command) => {
    expect(bashDecision(command)).toBe('ask');
    expect(bashDecision(command, policies)).toBe('deny');
  });

  it('asks before HUSKY set from a command under blockNoVerify', () => {
    expect(bashDecision('export HUSKY=$(echo 0)', policies)).toBe('ask');
  });

  it('names the option and the config when it denies AI attribution', () => {
    const { reason } = bashVerdict(
      'git commit -m "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"',
      policies,
    );
    expect(reason).toContain('blockAiAttribution');
  });
});

describe('guard-bash denyCommands option', () => {
  const denying = bashContext({ denyCommands: ['terraform destroy', ' kubectl  delete '] });

  it.each([
    'terraform destroy',
    'terraform -chdir=infra destroy -auto-approve',
    'sudo terraform destroy',
    'make x && kubectl -n prod delete pod a',
    'bash -c "terraform destroy"',
  ])('denies %s', (command) => {
    expect(bashDecision(command, denying)).toBe('deny');
  });

  it.each(['terraform plan', 'kubectl get pods', 'echo terraform destroy'])('allows %s', (command) => {
    expect(bashDecision(command, denying)).toBe('allow');
  });

  it('names the denied command and the config it comes from', () => {
    expect(bashVerdict('terraform destroy', denying).reason).toBe(
      `"terraform destroy" is denied by options.safety.denyCommands in ${BRAND.stateDir}/config.json.`,
    );
  });
});
