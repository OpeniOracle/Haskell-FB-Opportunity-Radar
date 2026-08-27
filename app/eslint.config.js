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
      // The network boundary is NARROWED here, not removed. Before the
      // production foundation, `fetch` was banned outright because the app was
      // fixture-backed. It is now permitted in exactly two modules — the API
      // client and the Supabase client — and still an error everywhere else.
      // "The app may talk to the network" and "any component may talk to
      // anywhere" are different postures, and the second is how a surface ends
      // up quietly calling a third party.
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Network access belongs in src/lib/apiClient.ts. Surfaces and components must not fetch.',
        },
        {
          name: 'XMLHttpRequest',
          message: 'Network access belongs in src/lib/apiClient.ts.',
        },
        {
          name: 'WebSocket',
          message: 'Realtime access belongs in src/lib/supabaseClient.ts.',
        },
        {
          name: 'EventSource',
          message: 'Network access belongs in src/lib/apiClient.ts.',
        },
      ],
    },
  },
  {
    // The fixture adapter is the one place allowed to read fixture modules.
    files: ['src/data/fixtureDataSource.ts', 'src/data/fixtures/**', 'src/test/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // The two approved network modules, and nothing else in src/.
    files: ['src/lib/apiClient.ts', 'src/lib/supabaseClient.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // Server-side code. It is not in the browser bundle, it holds the
    // service-role key, and it is the side of the boundary that is SUPPOSED to
    // reach the internet — but only through the egress gateway, which is where
    // its own allowlist lives.
    files: ['netlify/functions/**'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['scripts/**'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-globals': 'off' },
  },
)
