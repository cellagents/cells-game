// ESLint flat config. Targets TS sources only (bin/, node_modules/, dist
// outputs are ignored). Uses typescript-eslint's recommended ruleset -
// strict enough to catch real issues, lenient about `any` since the
// client code deliberately uses it for socket.io payloads (see TODO.md
// "Shared socket.io wire types" for the follow-up).

const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = tseslint.config(
    {
        ignores: ['bin/**', 'node_modules/**', 'dist/**']
    },
    ...tseslint.configs.recommended,
    {
        files: ['src/server/**/*.ts', 'src/config.ts'],
        languageOptions: {
            globals: { ...globals.node }
        }
    },
    {
        files: ['src/client/**/*.ts'],
        languageOptions: {
            globals: { ...globals.browser }
        }
    },
    {
        rules: {
            // Codebase uses `any` deliberately in a few places (socket
            // payloads, DOM lookups). Downgrade from error to warn and
            // let a future protocol-types pass eliminate them.
            '@typescript-eslint/no-explicit-any': 'warn',
            // argsIgnorePattern lets us keep underscore-prefixed params
            // on event handlers that don't use all args.
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }]
        }
    }
);
