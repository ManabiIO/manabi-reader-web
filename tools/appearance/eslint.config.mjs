import svelte from 'eslint-plugin-svelte';
import ts from 'typescript-eslint';

// The inherited root config only matched root-level *.svelte files. This
// explicitly parses nested components without a repository-wide lint migration.
export default [
  ...svelte.configs.recommended,
  ...svelte.configs.prettier,
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: { parser: ts.parser }
    }
  }
];
