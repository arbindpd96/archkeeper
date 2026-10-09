const AI_ATTRIBUTION = /co-authored-by:\s*claude|generated with \[?claude code/i;

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
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'no-ai-attribution': [2, 'always'],
  },
};
