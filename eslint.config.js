const eslint = require('@eslint/js');
const { fixupPluginRules } = require('@eslint/compat');
const headers = require('eslint-plugin-headers');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');
const rxjs = require('eslint-plugin-rxjs');
const tseslint = require('typescript-eslint');

let eslintPluginSvelte;

module.exports = (async () => {
  eslintPluginSvelte = await import('eslint-plugin-svelte');

  return tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    eslintPluginPrettierRecommended,
    {
      ignores: [
        '**/build/*',
        '**/test-results/**',
        '**/.svelte-kit/*',
        '**/service-worker.ts',
        '**/postcss.config.cjs',
        '**/.prettierrc.cjs',
        '**/material-elevation.cjs',
        '**/vite.config.js',
        '**/eslint.config.js',
        '**/tailwind.config.cjs',
        // Pinned third-party sources keep upstream formatting and license text.
        'apps/web/src/lib/foliate-epub/epub.js',
        'apps/web/src/lib/foliate-epub/epubcfi.js',
        'apps/web/src/lib/foliate-epub/paginator.js'
      ]
    },
    {
      languageOptions: {
        parserOptions: {
          parser: '@typescript-eslint/parser',
          ecmaVersion: 2020,
          extraFileExtensions: ['.svelte'],
          project: './tsconfig.eslint.json',
          sourceType: 'module',
          tsconfigRootDir: './apps/web/'
        }
      },
      name: 'root',
      plugins: {
        headers,
        rxjs: fixupPluginRules(rxjs)
      },
      rules: {
        'no-return-assign': ['error', 'except-parens'],
        'no-underscore-dangle': 'off',
        '@typescript-eslint/no-use-before-define': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        'prettier/prettier': [
          'error',
          {
            endOfLine: 'auto'
          }
        ]
      }
    },
    {
      files: ['**/!(*.d).ts'],
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
        ],
        'headers/header-format': [
          'error',
          {
            content: `@license BSD-3-Clause\nCopyright (c) {year}, ッツ Reader Authors\nAll rights reserved.`,
            source: 'string',
            style: 'jsdoc',
            trailingNewlines: 2,
            preservePragmas: false,
            variables: {
              year: `${new Date().getFullYear()}`
            }
          }
        ]
      }
    },
    {
      files: ['test/reader/**/*.{mjs,ts}'],
      languageOptions: {
        globals: {
          caches: 'readonly',
          chrome: 'readonly',
          clearTimeout: 'readonly',
          console: 'readonly',
          crossOriginIsolated: 'readonly',
          document: 'readonly',
          getComputedStyle: 'readonly',
          indexedDB: 'readonly',
          innerHeight: 'readonly',
          innerWidth: 'readonly',
          localStorage: 'readonly',
          navigator: 'readonly',
          performance: 'readonly',
          process: 'readonly',
          requestAnimationFrame: 'readonly',
          setTimeout: 'readonly'
        }
      }
    },
    {
      files: ['test/whispersync/**/*.{cjs,js,mjs}'],
      languageOptions: {
        globals: {
          CSS: 'readonly',
          AbortController: 'readonly',
          Audio: 'readonly',
          Blob: 'readonly',
          CustomEvent: 'readonly',
          DOMException: 'readonly',
          DOMParser: 'readonly',
          Event: 'readonly',
          EventTarget: 'readonly',
          File: 'readonly',
          HTMLElement: 'readonly',
          MutationObserver: 'readonly',
          URL: 'readonly',
          __dirname: 'readonly',
          cancelAnimationFrame: 'readonly',
          clearTimeout: 'readonly',
          console: 'readonly',
          document: 'readonly',
          indexedDB: 'readonly',
          module: 'readonly',
          performance: 'readonly',
          process: 'readonly',
          queueMicrotask: 'readonly',
          require: 'readonly',
          requestAnimationFrame: 'readonly',
          setTimeout: 'readonly',
          structuredClone: 'readonly',
          window: 'readonly'
        },
        parserOptions: {
          project: false
        }
      },
      rules: {
        '@typescript-eslint/no-require-imports': 'off'
      }
    },
    {
      ...eslintPluginSvelte.configs['flat/recommended'],
      files: ['*.svelte'],
      languageOptions: {
        parserOptions: { parser: '@typescript-eslint/parser' }
      },
      rules: {
        'except-parens': 'off',
        quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }]
      }
    },
    {
      files: [
        'apps/web/src/lib/components/ui/**/*.ts',
        'apps/web/src/lib/hooks/**/*.ts',
        'apps/web/src/lib/utils.ts'
      ],
      rules: { 'headers/header-format': 'off' }
    },
    {
      // Preserve the copied/adapted MIT notices; never rewrite them as TTU BSD.
      files: ['apps/web/src/lib/features/whispersync/**/*.ts'],
      rules: { 'headers/header-format': 'off' }
    },
    {
      files: ['service-worker.ts'],
      rules: {
        'headers/header-format': 'off'
      }
    }
  );
})();
