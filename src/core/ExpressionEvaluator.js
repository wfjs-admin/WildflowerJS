/**
 * ExpressionEvaluator - Expression parsing and evaluation
 *
 * @module
 */

// Import CSP-safe evaluation functions
import { getCSPSafeEvaluatorWithArgs } from './CSPExpressionEvaluator.js';

/**
 * Regex patterns for store shorthand syntax ($store.path)
 * - STORE_SHORTHAND_REGEX: Matches simple standalone expressions like "$user.name"
 *   Only matches when the entire expression is just $store.path with no operators
 * - STORE_SHORTHAND_INLINE_REGEX: Matches inline usages like "$expr.count > 3"
 *   Used for complex expressions with operators
 */
const STORE_SHORTHAND_REGEX = /^\$([a-zA-Z_][a-zA-Z0-9_-]*)\.([a-zA-Z0-9_.]+)$/;
const STORE_SHORTHAND_INLINE_REGEX = /\$([a-zA-Z_][a-zA-Z0-9_-]*)\.([a-zA-Z0-9_.]+)/g;

// Block indirect eval/Function access that bypasses variable shadowing in new Function()
// Catches: eval(), Function(), import(), ['constructor'], ['__proto__'], __defineGetter/Setter__,
// and global object access (globalThis, window, self, frames) that could reach eval/fetch/etc.
// Exported for use by TemplateSystem, ListExpressionEval, ListRenderer
export const _UNSAFE_EXPR_RE = /\beval\s*\(|\bFunction\s*\(|\bimport\s*\(|\[\s*['"]constructor['"]\s*\]|\[\s*['"]__proto__['"]\s*\]|__defineGetter__|__defineSetter__|\bglobalThis\b|\bwindow\b|\bself\b|\bframes\b|\bdocument\b/;

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const ExpressionEvaluatorMethods = {
    /**
     * Normalize $store.path shorthand syntax to external('store', 'path')
     *
     * Examples:
     *   "$user.name"           → "external('user', 'name')"
     *   "$kanban.columns"      → "external('kanban', 'columns')"
     *   "$app.user.profile"    → "external('app', 'user.profile')"
     *   "$expr.count > 3"      → "external('expr', 'count') > 3"
     *
     * @param {string} expression - The expression that may contain $store.path syntax
     * @returns {string} The normalized expression with external() calls
     * @public
     */
    _normalizeStoreShorthands(expression) {
        if (!expression || typeof expression !== 'string') {
            return expression;
        }

        // Quick check: if no $ prefix, return as-is
        if (!expression.includes('$')) {
            return expression;
        }

        // Check for standalone store shorthand (entire expression is $store.path)
        const standaloneMatch = expression.match(STORE_SHORTHAND_REGEX);
        if (standaloneMatch) {
            const storeName = standaloneMatch[1];
            const path = standaloneMatch[2];
            return `external('${storeName}', '${path}')`;
        }

        // Replace inline store shorthands within complex expressions
        // e.g., "$expr.count > 3" → "external('expr', 'count') > 3"
        return expression.replace(STORE_SHORTHAND_INLINE_REGEX, (match, storeName, path) => {
            return `external('${storeName}', '${path}')`;
        });
    },

/**
     * Extract unique variable names from a JavaScript expression.
     * Strips string literals, matches identifiers, filters reserved words.
     * @param {string} expression - The expression to extract variables from
     * @returns {string[]} Deduplicated array of variable names
     * @private
     */
    // Cache for extracted expression variables — expressions are static template strings
    _expressionVarsCache: new Map(),

    _extractExpressionVars(expression) {
        const cached = this._expressionVarsCache.get(expression);
        if (cached) return cached;

        const stripped = expression.replace(/'[^']*'|"[^"]*"/g, '');
        const varNames = Array.from(stripped.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g))
            .map(m => m[0])
            .filter(name => !this._expressionReservedWords.has(name));
        const result = [...new Set(varNames)];
        this._expressionVarsCache.set(expression, result);
        return result;
    },

    /**
     * Get or create a compiled expression function from cache
     * This is the low-level caching mechanism used by both evaluateExpression and _getOrCreateEvaluator
     *
     * When CSP mode is enabled (_useCSPSafeEvaluation), uses JSEP parser and AST evaluator
     * instead of `new Function()` to comply with strict Content Security Policy.
     *
     * @param {string} expression - The JavaScript expression to compile
     * @param {string[]} contextKeys - The variable names the function will accept as parameters
     * @param {string} cachePrefix - Cache key prefix (default: 'compiled')
     * @returns {Function|null} The compiled function, or null if compilation failed
     * @private
     */
    _getCompiledExpression(expression, contextKeys, cachePrefix = 'compiled') {
        // CSP-safe path: use AST-based evaluation
        if (this._useCSPSafeEvaluation) {
            return getCSPSafeEvaluatorWithArgs(
                expression,
                contextKeys,
                this._astCache,
                cachePrefix
            );
        }

        // Standard path: use new Function() for best performance
        const cacheKey = `${cachePrefix}::${expression}::${contextKeys.join(',')}`;

        // Return cached function if available
        if (this._expressionEvaluator.has(cacheKey)) {
            return this._expressionEvaluator.get(cacheKey);
        }

        // Block expressions that could reach eval or construct functions
        // via indirect patterns that bypass variable shadowing
        if (_UNSAFE_EXPR_RE.test(expression)) {
            this._expressionEvaluator.set(cacheKey, null);
            return null;
        }

        // Compile and cache new function
        try {
            const fn = new Function(...contextKeys, `"use strict"; return ${expression}`);
            this._expressionEvaluator.set(cacheKey, fn);
            return fn;
        } catch (e) {
            // Cache null to avoid repeated compilation attempts
            this._expressionEvaluator.set(cacheKey, null);
            return null;
        }
    },
    /**
     * Shared expression evaluation utility - extracts variables, compiles, caches, and evaluates expressions
     * @param {string} expression - The JavaScript expression to evaluate
     * @param {Object} state - The state object containing variable values
     * @param {Object} options - Optional configuration
     * @param {string} options.cacheKey - Custom cache key prefix (default: 'expr')
     * @param {Object} options.additionalContext - Extra context variables to include (e.g., external function)
     * @returns {*} The evaluated result, or undefined on error
     * @public
     */
    evaluateExpression(expression, state, options = {}) {
        const uniqueVars = this._extractExpressionVars(expression);

        // Build context values directly into array (avoids Object.entries/map/join allocations)
        const sm = options.stateManager;
        const computed = sm?.computed;
        const hasAdditional = options.additionalContext;

        const contextValues = new Array(uniqueVars.length);
        for (let i = 0; i < uniqueVars.length; i++) {
            const varName = uniqueVars[i];
            if (state && varName in state) {
                contextValues[i] = state[varName];
            } else if (computed && varName in computed) {
                try {
                    contextValues[i] = sm.evaluateComputed(varName);
                } catch (e) {
                    contextValues[i] = undefined;
                }
            } else if (hasAdditional && varName in options.additionalContext) {
                contextValues[i] = options.additionalContext[varName];
            } else {
                contextValues[i] = undefined;
            }
        }

        // Get or create cached compiled function
        // Use uniqueVars directly as stable context keys (from cache, always same order)
        const cachePrefix = options.cacheKey || 'expr';
        const fn = this._getCompiledExpression(expression, uniqueVars, cachePrefix);

        if (!fn) {
            return undefined; // Compilation failed
        }

        // Execute the function
        try {
            return fn(...contextValues);
        } catch (e) {
            // Runtime error during evaluation
            return undefined;
        }
    },
    /**
     * Check if a string contains expression operators (for detection purposes)
     * @param {string} str - The string to check
     * @returns {boolean} True if the string contains expression operators
     * @public
     */
    isExpression(str) {
        if (!str || typeof str !== 'string') return false;

        // Exclude computed property paths (computed:propName or !computed:propName)
        if (str.startsWith('computed:') || str.startsWith('!computed:')) return false;

        // Exclude props paths (props:propName)
        if (str.startsWith('props:')) return false;

        // Exclude simple negation at start (e.g., "!isVisible" is not a complex expression)
        const simpleNegation = /^![\w.]+$/.test(str);
        if (simpleNegation) return false;

        // Check for comparison, logical, arithmetic operators
        // Note: We check for ternary (?:) separately to avoid matching single colons
        const hasOperators = /[><=!&|+\-*/%]/.test(str);
        const hasTernary = /\?.*:/.test(str); // Ternary operator pattern
        const hasExternalCall = str.includes('external(');
        const hasObjectLiteral = str.includes('{');

        return hasOperators || hasTernary || hasExternalCall || hasObjectLiteral;
    }
};
