// ESLint configuration for the framework source. The same rules run on every
// change before it is integrated. eslint is deliberately NOT a devDependency
// of this package (see PROVENANCE.md: the dev tree is kept small); with
// eslint 9 available, `npm run lint` uses this file as-is.
export default [
    // Only lint framework source
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                // Browser globals
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                performance: 'readonly',
                MutationObserver: 'readonly',
                HTMLElement: 'readonly',
                Element: 'readonly',
                Node: 'readonly',
                NodeList: 'readonly',
                Text: 'readonly',
                Comment: 'readonly',
                DocumentFragment: 'readonly',
                HTMLTemplateElement: 'readonly',
                Event: 'readonly',
                CustomEvent: 'readonly',
                KeyboardEvent: 'readonly',
                MouseEvent: 'readonly',
                InputEvent: 'readonly',
                FocusEvent: 'readonly',
                getComputedStyle: 'readonly',
                queueMicrotask: 'readonly',
                WeakMap: 'readonly',
                WeakSet: 'readonly',
                WeakRef: 'readonly',
                Map: 'readonly',
                Set: 'readonly',
                Proxy: 'readonly',
                Reflect: 'readonly',
                Symbol: 'readonly',
                Promise: 'readonly',
                URL: 'readonly',
                fetch: 'readonly',
                localStorage: 'readonly',
                location: 'readonly',
                history: 'readonly',
                navigator: 'readonly',
                customElements: 'readonly',
                WebAssembly: 'readonly',
                globalThis: 'readonly',
                // Build-time constants (substituted by the build script)
                __DEV__: 'readonly',
                __VERSION__: 'readonly',
                __FEATURE_TRANSITIONS__: 'readonly',
                __FEATURE_ERROR_BOUNDARIES__: 'readonly',
                __FEATURE_PORTALS__: 'readonly',
                __FEATURE_SSR__: 'readonly',
                __FEATURE_LISTS__: 'readonly',
                __FEATURE_PLUGINS__: 'readonly',
                __FEATURE_ROUTING__: 'readonly',
                __FEATURE_PROPS__: 'readonly',
                __FEATURE_DOM_HELPERS__: 'readonly',
                __FEATURE_QUERY__: 'readonly',
                // Framework global
                wildflower: 'readonly',
                // Framework-internal globals (mixed in at runtime, not imported)
                wfWarn: 'readonly',
                wfError: 'readonly',
                WF_ERRORS: 'readonly',
                objectUtils: 'readonly',
                pathResolver: 'readonly',
                // Browser APIs not in ESLint's default set
                requestIdleCallback: 'readonly',
                cancelIdleCallback: 'readonly',
                scheduler: 'readonly',
                CSS: 'readonly',
                NodeFilter: 'readonly',
                HTMLInputElement: 'readonly',
                HTMLTextAreaElement: 'readonly',
                HTMLSelectElement: 'readonly',
                HTMLFormElement: 'readonly',
                DOMParser: 'readonly',
                XMLSerializer: 'readonly',
            }
        },
        rules: {
            // ── Real bugs (errors) ──
            'no-undef': 'error',                    // Undeclared variables
            'no-unused-vars': ['warn', {
                args: 'none',                        // Don't flag unused function params
                varsIgnorePattern: '^_',             // Allow _unused convention
                caughtErrors: 'none'                 // Don't flag unused catch params
            }],
            'no-unreachable': 'error',               // Code after return/throw
            'no-constant-condition': ['error', {
                checkLoops: false                    // Allow while(true)
            }],
            'no-dupe-keys': 'error',                 // Duplicate object keys
            'no-dupe-args': 'error',                 // Duplicate function params
            'no-duplicate-case': 'error',            // Duplicate switch cases
            'no-empty-pattern': 'error',             // Empty destructuring patterns
            'no-func-assign': 'error',               // Reassigning function declarations
            'no-import-assign': 'error',             // Reassigning imports
            'no-self-assign': 'error',               // x = x
            'no-self-compare': 'error',              // x === x
            'no-template-curly-in-string': 'warn',   // "${x}" in regular strings
            'no-unused-expressions': ['warn', {
                allowShortCircuit: true,             // Allow a && b()
                allowTernary: true,                  // Allow a ? b() : c()
                allowTaggedTemplates: true
            }],
            'no-loss-of-precision': 'error',         // Number precision loss
            'use-isnan': 'error',                    // Must use isNaN(), not === NaN
            'valid-typeof': 'error',                 // typeof x === 'strng' (typo)

            // ── Code smells (warnings) ──
            'no-fallthrough': 'warn',                // Switch case fallthrough without comment
            'no-shadow-restricted-names': 'error',   // Shadowing undefined, NaN, etc.
            'no-var': 'warn',                        // Prefer let/const
            'no-empty': ['warn', {
                allowEmptyCatch: true                // Empty catch is sometimes intentional
            }],
            'no-extra-boolean-cast': 'warn',         // Unnecessary !!x in boolean context
            'eqeqeq': ['warn', 'smart'],             // Prefer === except for null checks
            'no-useless-escape': 'warn',             // Unnecessary escape characters in strings/regex

            // ── Intentionally OFF (style, not bugs) ──
            'semi': 'off',
            'indent': 'off',
            'quotes': 'off',
            'comma-dangle': 'off',
            'no-console': 'off',
            'no-debugger': 'off',
            'no-mixed-spaces-and-tabs': 'off',
            'no-prototype-builtins': 'off',          // We use hasOwnProperty intentionally
            'no-cond-assign': 'off',                 // We use if (x = y) intentionally
            'no-constant-binary-expression': 'off',  // False positives with bitwise flags
        }
    }
];
