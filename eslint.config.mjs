// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `.claude/workflows/*.js` runs in Claude Code's workflow runtime, not in
  // this project: its `agent`, `pipeline`, `phase` and `log` are injected
  // globals and it is outside tsconfig, so type-aware linting cannot parse it.
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.claude/**'] },

  js.configs.recommended,

  // Type-aware linting. Slower than the syntactic rules, and worth it: the
  // rules that matter here (floating promises, unsafe any, misused promises)
  // cannot be decided without type information.
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An unawaited promise silently drops both the work and its failure.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      '@typescript-eslint/only-throw-error': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all' },
      ],

      // console is for the bootstrap failure path that runs before a logger
      // exists; everywhere else logging goes through pino.
      'no-console': ['error', { allow: ['error'] }],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'error',
      'prefer-const': 'error',
    },
  },

  // Root config files are outside the src tsconfig, so type-aware rules cannot
  // run on them.
  {
    files: ['*.mjs', '*.mts', '*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Tests reach into internals and assert on loose shapes.
  {
    files: ['**/*.test.ts'],
    rules: {
      // vi.fn() mocks are read as properties constantly, which this rule
      // reports as unbound methods. In production code it is worth keeping.
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },

  // Must stay last: switches off every rule Prettier owns.
  prettier,
);
