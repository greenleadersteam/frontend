import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const RESTRICTED_GLOBALS = ['localStorage', 'sessionStorage', 'eval'];
const SECURITY_MESSAGE = 'Запрещено правилами безопасности проекта (.claude/rules/security.md).';

export default defineConfig([
  // Скрытые каталоги — локальное состояние редакторов и инструментов, кода проекта в них нет.
  globalIgnores(['dist', 'coverage', 'src/shared/api/generated', '**/.*/']),

  {
    files: ['**/*.{js,cjs,ts,tsx}'],
    extends: [js.configs.recommended],
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'no-console': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },

  {
    files: ['**/*.{js,cjs}'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: SECURITY_MESSAGE,
        },
        {
          selector:
            'AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]',
          message: SECURITY_MESSAGE,
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: SECURITY_MESSAGE,
        },
        {
          selector:
            "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
          message: SECURITY_MESSAGE,
        },
      ],
      'no-restricted-globals': [
        'error',
        ...RESTRICTED_GLOBALS.map((name) => ({ name, message: SECURITY_MESSAGE })),
      ],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) =>
          RESTRICTED_GLOBALS.map((property) => ({ object, property, message: SECURITY_MESSAGE })),
        ),
      ],
    },
  },

  {
    files: ['src/**'],
    rules: {
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
    },
  },

  prettier,
]);
