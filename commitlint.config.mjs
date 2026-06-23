/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'test', 'style', 'chore', 'docs', 'perf', 'ci', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      ['web', 'mobile', 'desktop', 'backend', 'ui', 'core', 'types', 'e2e', 'config'],
    ],
    'scope-empty': [1, 'never'],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100],
  },
}
