import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'screenshots', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Phase 1 PR 1 boundary rules. These are the CI-enforced half of the
      // vendor-neutrality and no-live-data constraints in
      // docs/design/15_PHASE_1_IMPLEMENTATION_PLAN.md §4 and §1.3.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/data/fixtures/*', '@/data/fixtures/*'],
              message:
                'Surfaces must read through the DataSource interface, never import fixtures directly.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'PR 1 is fixture-backed. No network access is permitted.' },
      ],
    },
  },
  {
    // The fixture adapter is the one place allowed to read fixture modules.
    files: ['src/data/fixtureDataSource.ts', 'src/data/fixtures/**', 'src/test/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['scripts/**'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-globals': 'off' },
  },
)
