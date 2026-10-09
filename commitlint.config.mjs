import { AI_ATTRIBUTION } from './.claude/hooks/attribution.mjs';

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-ai-attribution': ({ raw }) => [
          !AI_ATTRIBUTION.test(raw ?? ''),
          'remove the AI attribution line; commits are authored by the maintainer',
        ],
      },
    },
  ],
  rules: {
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'no-ai-attribution': [2, 'always'],
  },
};
