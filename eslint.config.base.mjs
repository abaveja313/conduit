import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
    {
        ignores: ['**/pkg/**', '**/dist/**', '**/node_modules/**', '**/.next/**', '**/.turbo/**', '**/build/**', '**/out/**', 'target/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node
            },
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
    },
    {
        files: ['**/*.js', '**/*.cjs'],
        languageOptions: {
            sourceType: 'script'
        },
    },
];