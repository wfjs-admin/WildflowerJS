/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * WILDFLOWERJS UTILITIES - Shared Foundation Module
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * This file must be loaded FIRST before all other framework modules.
 * Provides foundational utilities used across the entire framework.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * MODULE CONTENTS
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ERROR SYSTEM:
 * ─────────────
 * - WF_ERRORS    : Structured error code definitions (WF-001 through WF-999)
 * - wfError()    : Error reporting with context and suggestions
 * - wfWarn()     : Runtime warnings (survives production builds)
 *
 * PATH RESOLUTION:
 * ────────────────
 * - PathResolver : Class for dot-notation path operations
 * - pathResolver : Singleton instance for framework-wide use
 *
 * OBJECT UTILITIES:
 * ─────────────────
 * - objectUtils.deepClone() : Deep clone with circular reference handling
 * - objectUtils.isEqual()   : Deep equality comparison
 *
 * ARRAY DETECTION:
 * ────────────────
 * - arrayDetector.detectAppend()      : Detect array append operations
 * - arrayDetector.detectSwap()        : Detect two-element swaps
 * - arrayDetector.detectSparseUpdate(): Detect sparse property updates
 *
 * DATA STRUCTURES:
 * ────────────────
 * - LRUCache          : Least Recently Used cache with eviction
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * DEPENDENCY GRAPH
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 *   wfUtils.js (this file) ─────────────────────────────────────────┐
 *         │                                                         │
 *         │ MUST LOAD FIRST                                         │
 *         ▼                                                         ▼
 *   ┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
 *   │ contextMgr  │    │ reactiveStateMgr │    │  wildflowerJS   │
 *   │             │    │                  │    │                 │
 *   │ Uses:       │    │ Uses:            │    │ Uses:           │
 *   │ • wfError   │    │ • pathResolver   │    │ • all utilities │
 *   │ • wfWarn    │    │ • objectUtils    │    │ • WF_ERRORS     │
 *   └─────────────┘    │ • arrayDetector  │    └─────────────────┘
 *         │            └──────────────────┘             │
 *         │                     │                       │
 *         └─────────────────────┼───────────────────────┘
 *                               ▼
 *                    ┌─────────────────────┐
 *                    │    storeManager     │
 *                    │    SSRManager       │
 *                    │    RouteManager     │
 *                    └─────────────────────┘
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * USAGE EXAMPLES
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * @example Error Reporting:
 * ```javascript
 * wfError(WF_ERRORS.COMPONENT_NOT_FOUND, {
 *     context: 'my-component',
 *     suggestion: 'Check component registration'
 * });
 * // Output: [WF WF-102] Component instance not found: my-component
 * //         ↳ Suggestion: Check component registration
 * ```
 *
 * @example Path Resolution:
 * ```javascript
 * const value = pathResolver.get(state, 'user.profile.name');
 * pathResolver.set(state, 'user.profile.email', 'new@email.com');
 * const parts = pathResolver.split('a.b.c'); // ['a', 'b', 'c'] (cached)
 * ```
 *
 * @example Object Utilities:
 * ```javascript
 * const clone = objectUtils.deepClone(complexObject);
 * const areEqual = objectUtils.isEqual(obj1, obj2);
 * ```
 *
 * @example Array Detection:
 * ```javascript
 * const appendInfo = arrayDetector.detectAppend(oldArray, newArray);
 * if (appendInfo) {
 *     console.log(`${appendInfo.appendedCount} items added at index ${appendInfo.startIndex}`);
 * }
 * ```
 *
 * @module wfUtils
 */

// ============================================================================
// ERROR SYSTEM
// ============================================================================

/**
 * WildflowerJS Error System
 *
 * Provides structured error codes and a global error reporting function
 * that all framework modules can use.
 *
 * Error codes provide a stable reference for debugging production issues.
 * Format: WF-XXX where XXX is a 3-digit number
 *
 * Ranges:
 * - 001-099: Core/initialization errors
 * - 100-199: Component lifecycle errors
 * - 200-299: State/reactivity errors
 * - 300-399: Context system errors
 * - 400-499: List rendering errors
 * - 500-599: Binding errors
 * - 600-699: Action/event errors
 * - 700-799: Router errors
 * - 800-899: SSR errors
 * - 900-999: Store errors
 * - WF-CSP-* / WF-EFFECT: non-numeric category codes (CSP-safe evaluator, render effect)
 *
 * See: https://www.wildflowerjs.com/docs/error-codes
 * Deep-link a specific code: https://www.wildflowerjs.com/docs/error-codes?code=WF-505
 */

export const WF_ERRORS = {
    // Core/initialization (001-099)
    ROOT_NOT_FOUND: { code: 'WF-001', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Root element not found' }) },

    // Component lifecycle (100-199)
    COMPONENT_INIT_FAILED: { code: 'WF-101', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error initializing component' }) },
    COMPONENT_NOT_FOUND: { code: 'WF-102', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Component instance not found' }) },
    COMPONENT_CONTEXT_MISSING: { code: 'WF-103', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Component context not available' }) },
    PARENT_HANDLER_ERROR: { code: 'WF-104', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in parent event handler' }) },

    // State/reactivity (200-299)
    COMPUTED_EVAL_ERROR: { code: 'WF-201', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error evaluating computed property' }) },
    CIRCULAR_DEPENDENCY: { code: 'WF-202', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Circular dependency detected' }) },
    STATE_SET_ERROR: { code: 'WF-203', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error setting state value' }) },
    STATE_DELETE_ERROR: { code: 'WF-204', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error deleting state value' }) },
    STATE_LOAD_ERROR: { code: 'WF-205', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error loading state from storage' }) },
    STATE_SAVE_ERROR: { code: 'WF-206', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error saving state to storage' }) },
    STATE_UPDATE_INVALID: { code: 'WF-207', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Invalid parameter for state update' }) },
    COMPUTED_NOT_FOUND: { code: 'WF-208', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Computed property does not exist' }) },
    COMPUTED_NOT_FUNCTION: { code: 'WF-209', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Computed property must be a function' }) },
    PATH_INVALID: { code: 'WF-210', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Invalid path segment' }) },
    SUBSCRIPTION_ERROR: { code: 'WF-211', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in subscription callback' }) },

    // Context system (300-399)
    CONTEXT_RESOLVE_ERROR: { code: 'WF-301', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error resolving data in context' }) },
    CONTEXT_MISSING_INSTANCE: { code: 'WF-302', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Missing component instance in context' }) },
    CONTEXT_UPDATE_ERROR: { code: 'WF-303', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error updating context' }) },
    CONTEXT_DEPENDENCY_ERROR: { code: 'WF-304', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in context dependency notification' }) },

    // List rendering (400-499)
    TEMPLATE_NOT_FOUND: { code: 'WF-401', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Template not found for list' }) },
    LIST_RENDER_ERROR: { code: 'WF-402', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error rendering list' }) },
    LIST_ITEM_UPDATE_ERROR: { code: 'WF-403', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error updating list item' }) },
    LIST_ITEM_REMOVE_ERROR: { code: 'WF-404', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error removing list item' }) },
    LIST_APPEND_ERROR: { code: 'WF-405', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in append optimization' }) },
    LIST_SWAP_ERROR: { code: 'WF-406', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in swap optimization' }) },
    LIST_SPARSE_ERROR: { code: 'WF-407', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in sparse update optimization' }) },

    // Binding errors (500-599)
    BINDING_EVAL_ERROR: { code: 'WF-501', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error evaluating binding expression' }) },
    // Shares WF-501 with BINDING_EVAL_ERROR (docs entry covers both shapes);
    // distinct here so the dev-mode message matches the specific case.
    MODEL_STORE_SHORTHAND: { code: 'WF-501', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: '$store.path cannot be used in data-model (store paths are read-only)' }) },
    CLASS_BINDING_ERROR: { code: 'WF-502', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error evaluating class binding' }) },
    HTML_BINDING_ERROR: { code: 'WF-503', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Failed to create HTML binding context' }) },
    CONDITIONAL_UPDATE_ERROR: { code: 'WF-504', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error updating conditional context' }) },
    CLASS_BINDING_SHAPE: { code: 'WF-505', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Class binding shape mismatch (coerced)' }) },

    // Action/event errors (600-699)
    ACTION_HANDLER_ERROR: { code: 'WF-601', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in action handler' }) },
    METHOD_ERROR: { code: 'WF-602', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in component method' }) },
    EMIT_NO_INSTANCE: { code: 'WF-603', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Cannot emit - component instance not found' }) },
    EMIT_NO_CONTEXT: { code: 'WF-604', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Cannot emit - component context not available' }) },

    // Router errors (700-799)
    ROUTE_NOT_FOUND: { code: 'WF-701', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Route not found' }) },
    ROUTE_ALIAS_ERROR: { code: 'WF-702', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Target route not found for alias' }) },
    ROUTE_GUARD_ERROR: { code: 'WF-703', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in route guard' }) },
    ROUTE_NAVIGATION_ERROR: { code: 'WF-704', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Navigation queue exceeded retry limit' }) },
    NAMED_ROUTE_NOT_FOUND: { code: 'WF-705', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Named route not found' }) },
    ROUTE_CONFIG_INVALID: { code: 'WF-706', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Invalid route configuration' }) },
    ROUTE_ALREADY_INIT: { code: 'WF-707', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Router already initialized' }) },
    ROUTE_NO_MATCH: { code: 'WF-708', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'No route matched for path' }) },
    ROUTE_HANDLER_ERROR: { code: 'WF-709', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in route handler' }) },
    ROUTE_COMPONENT_ERROR: { code: 'WF-710', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error loading route component' }) },
    ROUTE_SCROLL_ERROR: { code: 'WF-711', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in scroll behavior' }) },
    ROUTE_HOOK_ERROR: { code: 'WF-712', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in route lifecycle hook' }) },

    // SSR errors (800-899)
    SSR_ACTIVATION_ERROR: { code: 'WF-801', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error during SSR activation' }) },
    SSR_HYDRATION_ERROR: { code: 'WF-802', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error during hydration' }) },

    // Store errors (900-999)
    STORE_NAME_INVALID: { code: 'WF-901', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Store component name must be a string' }) },
    STORE_DEF_INVALID: { code: 'WF-902', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Store component definition must be an object' }) },
    STORE_INIT_ERROR: { code: 'WF-903', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in store init hook' }) },
    STORE_CREATE_ERROR: { code: 'WF-904', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error creating store component' }) },
    STORE_EXTERNAL_ERROR: { code: 'WF-905', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in external() accessing store' }) },
    STORE_SUBSCRIPTION_ERROR: { code: 'WF-906', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in store subscription callback' }) },
    STORE_DEFAULT_ERROR: { code: 'WF-907', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Failed to create default app-store' }) },

    // CSP-safe expression evaluator (non-numeric codes — separate category
    // from the 1xx-9xx ranges because they describe parser / security
    // policy outcomes, not framework-internal errors).
    CSP_SYNTAX: { code: 'WF-CSP-SYNTAX', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Cannot parse expression' }) },
    CSP_UNSUPPORTED: { code: 'WF-CSP-UNSUPPORTED', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Expression uses unsupported syntax' }) },
    CSP_SECURITY: { code: 'WF-CSP-SECURITY', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Blocked access to restricted API' }) },

    // Render-effect path resolution failures
    EFFECT_PATH: { code: 'WF-EFFECT', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error resolving path in render effect' }) }
};

/**
 * Build the canonical doc URL for an error code.
 * @param {string} code - Error code (e.g., 'WF-505')
 * @returns {string} Full URL to the error-codes page deep-linked to the code
 */
function errorDocUrl(code) {
    return `https://www.wildflowerjs.com/docs/error-codes?code=${code}`;
}

/**
 * Log an error with structured error code, context, and suggestions.
 *
 * In production builds (__DEV__ = false), outputs compact error with code + doc link.
 * In development builds (__DEV__ = true), outputs full context and suggestions
 * followed by the same doc link so devs can jump to the canonical reference.
 *
 * @param {Object} errorDef - Error definition from WF_ERRORS
 * @param {Object} options - Additional error context
 * @param {string} [options.context] - What was being attempted
 * @param {string} [options.suggestion] - How to fix the issue
 * @param {Error} [options.cause] - Original error object
 * @param {Object} [options.data] - Additional data for debugging
 * @param {boolean} [options.warn=false] - Emit via console.warn instead of
 *   console.error. Use for diagnostic-but-recoverable conditions (coerced
 *   bindings, blocked CSP-mode globals, etc.) that ship with a code but
 *   shouldn't trip error-tracking pipelines.
 */
export function wfError(errorDef, options = {}) {
    const { context, suggestion, cause, data, warn } = options;
    const log = warn ? console.warn.bind(console) : console.error.bind(console);

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // Development: full context output, including the doc URL so the
        // canonical reference is one click away even when the inline
        // message/suggestion already explain the issue.
        log(`[WF ${errorDef.code}] ${errorDef.message}${context ? `: ${context}` : ''}`);

        if (suggestion) {
            console.warn(`  ↳ Suggestion: ${suggestion}`);
        }
        if (data) {
            console.warn(`  ↳ Data:`, data);
        }
        if (cause) {
            console.warn(`  ↳ Caused by:`, cause.message || cause);
        }
        console.warn(`  ↳ Docs: ${errorDocUrl(errorDef.code)}`);
    } else {
        // Production: compact error code + doc link
        log(`[${errorDef.code}] ${errorDocUrl(errorDef.code)}`);
    }
}

/**
 * Log a runtime warning. Survives production builds intentionally —
 * these are user-facing diagnostics (e.g., misconfigured bindings,
 * deprecated usage) that should be visible regardless of build mode.
 *
 * @param {string} message - Warning message
 * @param {Object} [data] - Additional data for debugging
 */
export function wfWarn(message, data) {
    console.warn(`[WF] ${message}`);
    if (data) {
        console.warn(`  ↳ Data:`, data);
    }
}


// ============================================================================
// PATH RESOLVER
// ============================================================================

/**
 * PathResolver - Unified path resolution utility for WildflowerJS
 *
 * Consolidates path splitting and nested property access patterns
 * used across wildflowerJS.js, reactiveStateManager.js, storeManager.js, and SSRManager.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Provides a single, optimized implementation for dot-notation path operations
 * that were previously duplicated across multiple framework files.
 *
 * Features:
 * - LRU-cached path splitting for performance (500 entry limit)
 * - Safe nested property access (get) - returns undefined for invalid paths
 * - Safe nested property setting (set) - creates intermediate objects
 * - Path normalization (handles bracket notation: items[0] → items.0)
 * - Path manipulation (getBase, getNested)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CACHING STRATEGY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Path splitting results are cached using LRU eviction:
 *
 *   split("user.profile.name")
 *         │
 *         ▼ Cache check
 *   ┌─────────────────────┐
 *   │ _pathSplitCache Map │
 *   │ "user.profile.name" │──────▶ ["user", "profile", "name"]
 *   └─────────────────────┘        (cached result returned)
 *
 * When cache exceeds maxCacheSize (default 500), oldest entries are evicted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @example
 * ```javascript
 * // Use singleton instance
 * const value = pathResolver.get(state, 'user.profile.name');
 * pathResolver.set(state, 'user.profile.email', 'test@example.com');
 *
 * // Path manipulation
 * pathResolver.getBase('a.b.c');    // 'a'
 * pathResolver.getNested('a.b.c');  // 'b.c'
 *
 * // Normalize bracket notation
 * pathResolver.normalize('items[0].name'); // 'items.0.name'
 * ```
 *
 * @class PathResolver
 */
export class PathResolver {
    constructor(options = {}) {
        this._maxCacheSize = options.maxCacheSize || 500;
        this._pathSplitCache = new Map();
    }

    /**
     * Split a dot-notation path into parts (cached)
     * @param {string} path - The path to split (e.g., "user.profile.name")
     * @returns {string[]} Array of path parts
     */
    split(path) {
        if (!path || typeof path !== 'string') {
            return [];
        }

        let parts = this._pathSplitCache.get(path);
        if (parts) {
            return parts;
        }

        parts = path.split('.');

        // FIFO eviction (oldest inserted entry removed)
        if (this._pathSplitCache.size >= this._maxCacheSize) {
            const firstKey = this._pathSplitCache.keys().next().value;
            this._pathSplitCache.delete(firstKey);
        }

        this._pathSplitCache.set(path, parts);
        return parts;
    }

    /**
     * Get a value from an object using dot-notation path
     * @param {Object} obj - The source object
     * @param {string} path - The dot-notation path (e.g., "user.profile.name")
     * @returns {*} The value at the path, or undefined if not found
     */
    get(obj, path) {
        if (!obj || !path) {
            return undefined;
        }

        // Fast path for simple properties
        if (!path.includes('.')) {
            return obj[path];
        }

        const parts = this.split(path);
        let value = obj;
        for (let i = 0; i < parts.length; i++) {
            if (value === undefined || value === null) {
                return undefined;
            }
            value = value[parts[i]];
        }
        return value;
    }

    /**
     * Set a value on an object using dot-notation path
     * Creates intermediate objects as needed
     * @param {Object} obj - The target object
     * @param {string} path - The dot-notation path
     * @param {*} value - The value to set
     * @returns {boolean} True if successful
     */
    set(obj, path, value) {
        if (!obj || !path) {
            return false;
        }

        if (!path.includes('.')) {
            obj[path] = value;
            return true;
        }

        const parts = this.split(path);
        const lastIndex = parts.length - 1;
        let current = obj;

        for (let i = 0; i < lastIndex; i++) {
            const part = parts[i];
            if (current[part] === undefined || current[part] === null) {
                const nextPart = parts[i + 1];
                current[part] = /^\d+$/.test(nextPart) ? [] : {};
            }
            current = current[part];
            if (typeof current !== 'object') {
                return false;
            }
        }

        current[parts[lastIndex]] = value;
        return true;
    }

    /**
     * Normalize a path by converting bracket notation to dot notation
     * @param {string} path - The path to normalize (e.g., "items[0].name")
     * @returns {string} Normalized path (e.g., "items.0.name")
     */
    normalize(path) {
        if (!path || typeof path !== 'string') {
            return '';
        }
        return path.replace(/\[(\d+)]/g, '.$1');
    }

    /**
     * Get the base (first segment) of a path
     */
    getBase(path) {
        if (!path || typeof path !== 'string') return '';
        const dotIndex = path.indexOf('.');
        return dotIndex === -1 ? path : path.substring(0, dotIndex);
    }

    /**
     * Get the nested path (everything after the first segment)
     */
    getNested(path) {
        if (!path || typeof path !== 'string') return '';
        const dotIndex = path.indexOf('.');
        return dotIndex === -1 ? '' : path.substring(dotIndex + 1);
    }
}

// Singleton instance for framework-wide use
export const pathResolver = new PathResolver();


// ============================================================================
// OBJECT UTILS
// ============================================================================

/**
 * ObjectUtils - Unified deep clone and equality comparison for WildflowerJS
 *
 * Consolidates _deepClone and _isEqual patterns used across
 * reactiveStateManager.js and storeManager.js.
 *
 * Features:
 * - Deep cloning with circular reference handling
 * - Deep equality comparison with circular reference handling
 * - DOM node preservation (not cloned, passed by reference)
 */
export const objectUtils = {
    /**
     * Deep clone an object or array
     * Handles circular references and preserves DOM nodes by reference
     *
     * @param {*} obj - The value to clone
     * @param {WeakMap} [seen] - Internal: tracks cloned objects for cycle detection
     * @returns {*} A deep clone of the value
     */
    deepClone(obj, seen = new WeakMap()) {
        // Handle primitives, nulls, and DOM nodes (pass by reference)
        if (obj === null || typeof obj !== 'object' || obj instanceof Node) {
            return obj;
        }

        // Check for circular reference
        if (seen.has(obj)) {
            return seen.get(obj);
        }

        // Create empty clone of correct type
        const clone = Array.isArray(obj) ? [] : {};

        // Store reference BEFORE recursing to handle cycles
        seen.set(obj, clone);

        // Recursively clone properties
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                clone[key] = this.deepClone(obj[key], seen);
            }
        }

        return clone;
    },

    /**
     * Check if two values are deeply equal
     * Handles circular references
     *
     * @param {*} a - First value
     * @param {*} b - Second value
     * @param {WeakMap} [seen] - Internal: tracks compared objects for cycle detection
     * @returns {boolean} True if values are deeply equal
     */
    isEqual(a, b, seen = new WeakMap()) {
        // Fast path: identical references
        if (a === b) return true;

        // Handle null/undefined
        if (a === null || b === null || a === undefined || b === undefined) {
            return false;
        }

        // Fast path: non-objects
        if (typeof a !== 'object' || typeof b !== 'object') {
            return false;
        }

        // Handle primitive wrappers
        if (a instanceof Number && b instanceof Number) return a.valueOf() === b.valueOf();
        if (a instanceof String && b instanceof String) return a.valueOf() === b.valueOf();
        if (a instanceof Boolean && b instanceof Boolean) return a.valueOf() === b.valueOf();

        // Check for circular references
        if (seen.has(a)) {
            return seen.get(a) === b;
        }
        seen.set(a, b);

        // Type mismatch: array vs object
        if (Array.isArray(a) !== Array.isArray(b)) {
            return false;
        }

        // Compare arrays
        if (Array.isArray(a)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!this.isEqual(a[i], b[i], seen)) {
                    return false;
                }
            }
            return true;
        }

        // Compare objects
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) {
                return false;
            }
            if (!this.isEqual(a[key], b[key], seen)) {
                return false;
            }
        }

        return true;
    }
};


// ============================================================================
// ARRAY OPERATION DETECTOR
// ============================================================================

/**
 * ArrayOperationDetector - Unified array change detection for WildflowerJS
 *
 * Consolidates array operation detection logic used across:
 * - reactiveStateManager.js (_detectArrayAppend, _detectArraySwap, _detectSparsePropertyUpdate)
 * - wildflowerJS.js (_detectArrayChanges)
 *
 * Provides pure detection algorithms without class-specific dependencies.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Enables efficient DOM updates by detecting what kind of array operation
 * occurred, allowing the framework to use optimized update paths instead
 * of full re-renders.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DETECTION HIERARCHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Array Change
 *        │
 *        ▼
 *   ┌────────────────┐     Yes    ┌─────────────────────────────────────┐
 *   │ Different      │───────────▶│ detectAppend()                      │
 *   │ lengths?       │            │ → Append new items only             │
 *   └────────────────┘            │ → O(n) for n new items              │
 *        │ No                     └─────────────────────────────────────┘
 *        ▼
 *   ┌────────────────┐     Yes    ┌─────────────────────────────────────┐
 *   │ Exactly 2      │───────────▶│ detectSwap()                        │
 *   │ positions      │            │ → Swap two DOM elements             │
 *   │ changed?       │            │ → O(1) DOM operations               │
 *   └────────────────┘            └─────────────────────────────────────┘
 *        │ No
 *        ▼
 *   ┌────────────────┐     Yes    ┌─────────────────────────────────────┐
 *   │ Same IDs,      │───────────▶│ detectSparseUpdate()                │
 *   │ property       │            │ → Update specific bindings only     │
 *   │ changes?       │            │ → O(changed) DOM operations         │
 *   └────────────────┘            └─────────────────────────────────────┘
 *        │ No
 *        ▼
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ Full re-render (worst case)                                     │
 *   │ → Clear and rebuild entire list                                 │
 *   │ → O(n) DOM operations                                           │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERFORMANCE NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * - Large arrays (>1000 items): Uses sampling for append detection
 * - ID-based detection: Uses hash comparison for quick reorder rejection
 * - Early exits: Detection functions exit as soon as conditions fail
 *
 * @namespace arrayDetector
 */
export const arrayDetector = {
    /**
     * Detect if new array is an append of old array
     * @param {Array} oldArray - Previous array state
     * @param {Array} newArray - New array state
     * @returns {Object|null} Append metadata or null if not an append
     */
    detectAppend(oldArray, newArray) {
        // Quick validation
        if (!oldArray || !newArray ||
            newArray.length <= oldArray.length ||
            oldArray.length === 0) {
            return null;
        }

        const oldLength = oldArray.length;
        const newLength = newArray.length;

        // For large arrays, sample check for performance
        if (oldLength > 1000) {
            // Check first 10 items
            for (let i = 0; i < Math.min(10, oldLength); i++) {
                if (oldArray[i] !== newArray[i] && !objectUtils.isEqual(oldArray[i], newArray[i])) {
                    return null;
                }
            }
            // Check last 10 items before the new ones
            for (let i = Math.max(0, oldLength - 10); i < oldLength; i++) {
                if (oldArray[i] !== newArray[i] && !objectUtils.isEqual(oldArray[i], newArray[i])) {
                    return null;
                }
            }
        } else {
            // For smaller arrays, check all items
            for (let i = 0; i < oldLength; i++) {
                if (oldArray[i] !== newArray[i] && !objectUtils.isEqual(oldArray[i], newArray[i])) {
                    return null;
                }
            }
        }

        return {
            type: 'append',
            startIndex: oldLength,
            newItems: newArray.slice(oldLength),
            appendedCount: newLength - oldLength
        };
    },

    /**
     * Detect if arrays differ by a two-element swap
     * @param {Array} oldArray - Previous array state
     * @param {Array} newArray - New array state
     * @returns {Object|null} Swap metadata or null if not a swap
     */
    detectSwap(oldArray, newArray) {
        // Quick validation
        if (!oldArray || !newArray ||
            oldArray.length !== newArray.length ||
            oldArray.length < 2) {
            return null;
        }

        let changedCount = 0;
        const changedIndices = [];

        // Find positions where items changed (using ID or reference comparison)
        for (let i = 0; i < oldArray.length; i++) {
            const oldItem = oldArray[i];
            const newItem = newArray[i];

            const itemsMatch = oldItem?.id !== undefined && newItem?.id !== undefined
                ? oldItem.id === newItem.id
                : oldItem === newItem;

            if (!itemsMatch) {
                changedIndices.push(i);
                changedCount++;
                if (changedCount > 2) return null; // Early exit
            }
        }

        if (changedCount !== 2) return null;

        const [idx1, idx2] = changedIndices;
        const oldItem1 = oldArray[idx1];
        const oldItem2 = oldArray[idx2];
        const newItem1 = newArray[idx1];
        const newItem2 = newArray[idx2];

        // Verify items actually swapped positions
        const isSwap = oldItem1?.id !== undefined && oldItem2?.id !== undefined
            ? (oldItem1.id === newItem2.id && oldItem2.id === newItem1.id)
            : (oldItem1 === newItem2 && oldItem2 === newItem1);

        if (!isSwap) return null;

        return {
            type: 'swap',
            index1: idx1,
            index2: idx2,
            item1: newItem1,
            item2: newItem2
        };
    },

    /**
     * Detect sparse property updates across array items
     * @param {Array} oldArray - Previous array state
     * @param {Array} newArray - New array state
     * @param {Object} options - Detection options
     * @param {number} [options.maxChangeRatio=0.5] - Max ratio of changed items to trigger sparse
     * @returns {Object|null} Sparse update metadata or null
     */
    detectSparseUpdate(oldArray, newArray, options = {}) {
        const maxChangeRatio = options.maxChangeRatio || 0.5;

        // Quick validation
        if (!oldArray || !newArray ||
            oldArray.length !== newArray.length ||
            oldArray.length === 0) {
            return null;
        }

        // Quick sample check - if first few items all different, likely full replacement
        const sampleSize = Math.min(3, oldArray.length);
        let allDifferent = true;
        for (let i = 0; i < sampleSize; i++) {
            if (oldArray[i] === newArray[i]) {
                allDifferent = false;
                break;
            }
        }
        if (allDifferent && oldArray.length > sampleSize) {
            return null;
        }

        // Hash-based ID check for reorder detection
        if (oldArray.length > 0 && oldArray[0]?.id !== undefined) {
            let oldHash = 0, newHash = 0;
            for (let i = 0; i < oldArray.length; i++) {
                const oldId = oldArray[i]?.id;
                const newId = newArray[i]?.id;
                // Hash string IDs by char codes; numeric IDs directly
                const oldVal = typeof oldId === 'string'
                    ? (oldId.length > 0 ? (oldId.charCodeAt(0) * 131 + oldId.charCodeAt(oldId.length - 1) + oldId.length) : 0)
                    : (oldId || 0);
                const newVal = typeof newId === 'string'
                    ? (newId.length > 0 ? (newId.charCodeAt(0) * 131 + newId.charCodeAt(newId.length - 1) + newId.length) : 0)
                    : (newId || 0);
                oldHash = (oldHash * 31 + oldVal) | 0;
                newHash = (newHash * 31 + newVal) | 0;
            }
            if (oldHash !== newHash) {
                return null; // ID order changed, not sparse update
            }
        }

        const changes = new Map();
        let totalChanges = 0;
        let commonProperties = null;
        let hasNestedArrayChanges = false;

        for (let i = 0; i < oldArray.length; i++) {
            const oldItem = oldArray[i];
            const newItem = newArray[i];

            if (oldItem === newItem) continue;

            if (oldItem && newItem &&
                typeof oldItem === 'object' &&
                typeof newItem === 'object' &&
                oldItem.id === newItem.id) {

                const changedProps = new Set();
                for (const key in newItem) {
                    if (key !== 'id' && oldItem[key] !== newItem[key]) {
                        changedProps.add(key);
                        if (Array.isArray(newItem[key]) || Array.isArray(oldItem[key])) {
                            hasNestedArrayChanges = true;
                        }
                    }
                }

                if (changedProps.size > 0) {
                    changes.set(i, changedProps);
                    totalChanges++;

                    if (commonProperties === null) {
                        commonProperties = new Set(changedProps);
                    } else {
                        for (const prop of commonProperties) {
                            if (!changedProps.has(prop)) {
                                commonProperties.delete(prop);
                            }
                        }
                    }
                }
            }
        }

        // Don't optimize nested arrays or too many changes
        if (hasNestedArrayChanges || totalChanges === 0 ||
            totalChanges > oldArray.length * maxChangeRatio) {
            return null;
        }

        // Detect regular interval pattern
        const indices = Array.from(changes.keys()).sort((a, b) => a - b);
        let interval = null;
        if (indices.length >= 2) {
            interval = indices[1] - indices[0];
            for (let i = 2; i < indices.length; i++) {
                if (indices[i] - indices[i-1] !== interval) {
                    interval = null;
                    break;
                }
            }
        }

        return {
            type: 'sparse-update',
            changes,
            totalChanges,
            commonProperties: commonProperties ? Array.from(commonProperties) : [],
            interval
        };
    },

    /**
     * Find changed indices between arrays (helper for sparse updates)
     * @param {Array} oldArray - Previous array state
     * @param {Array} newArray - New array state
     * @param {number} maxChanges - Maximum changes to track
     * @returns {Array} Array of changed indices
     */
    findChangedIndices(oldArray, newArray, maxChanges = 100) {
        const changedIndices = [];
        const minLength = Math.min(oldArray.length, newArray.length);

        for (let i = 0; i < minLength && changedIndices.length < maxChanges; i++) {
            if (!objectUtils.isEqual(oldArray[i], newArray[i])) {
                changedIndices.push(i);
            }
        }

        return changedIndices;
    }
};


// ============================================================================
// LRU CACHE
// ============================================================================

/**
 * LRUCache - Simple Least Recently Used cache with max size eviction
 *
 * Used for caching expensive computations with bounded memory:
 * - Path splitting results
 * - Pattern matching results
 * - Expression compilation results
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW LRU WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Uses JavaScript Map's insertion order to track access recency:
 *
 *   get("key") - Access existing key
 *        │
 *        ▼
 *   ┌─────────────────────────────────────────────────┐
 *   │ 1. Delete key from Map                          │
 *   │ 2. Re-insert key (now at end = most recent)     │
 *   │ 3. Return value                                 │
 *   └─────────────────────────────────────────────────┘
 *
 *   set("newKey", value) - Insert new key
 *        │
 *        ▼
 *   ┌─────────────────────────────────────────────────┐
 *   │ if (size >= maxSize)                            │
 *   │     Delete FIRST key (oldest = least recent)    │
 *   │ Insert new key at END (most recent)             │
 *   └─────────────────────────────────────────────────┘
 *
 * Map iteration order: [oldest] → [newest]
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @example
 * ```javascript
 * const cache = new LRUCache(100);  // Max 100 entries
 *
 * cache.set('key1', expensiveComputation());
 * const value = cache.get('key1');  // Returns cached value, marks as recently used
 *
 * // After 100 entries, least recently used entries are evicted
 * ```
 *
 * @class LRUCache
 */
export class LRUCache {
    /**
     * @param {number} maxSize - Maximum number of entries before eviction
     */
    constructor(maxSize = 500) {
        this._maxSize = maxSize;
        this._cache = new Map();
    }

    /**
     * Get a cached value
     * @param {string} key - Cache key
     * @returns {*} Cached value or undefined
     */
    get(key) {
        if (!this._cache.has(key)) {
            return undefined;
        }
        // Move to end (most recently used)
        const value = this._cache.get(key);
        this._cache.delete(key);
        this._cache.set(key, value);
        return value;
    }

    /**
     * Set a cached value with LRU eviction
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     */
    set(key, value) {
        // Delete first to ensure it moves to end if exists
        if (this._cache.has(key)) {
            this._cache.delete(key);
        } else if (this._cache.size >= this._maxSize) {
            // Evict oldest (first) entry
            const firstKey = this._cache.keys().next().value;
            this._cache.delete(firstKey);
        }
        this._cache.set(key, value);
    }

    /**
     * Check if key exists
     * @param {string} key - Cache key
     * @returns {boolean}
     */
    has(key) {
        return this._cache.has(key);
    }

    /**
     * Delete a cached value
     * @param {string} key - Cache key
     */
    delete(key) {
        this._cache.delete(key);
    }

    /**
     * Clear all cached values
     */
    clear() {
        this._cache.clear();
    }

    /**
     * Get current cache size
     * @returns {number}
     */
    get size() {
        return this._cache.size;
    }
}


// ============================================================================
// BROWSER GLOBALS (for script tag usage)
// ============================================================================

// Assign to window for backward compatibility with script tag usage
if (typeof window !== 'undefined') {
    window.WF_ERRORS = WF_ERRORS;
    window.wfError = wfError;
    window.wfWarn = wfWarn;
    window.PathResolver = PathResolver;
    window.pathResolver = pathResolver;
    window.objectUtils = objectUtils;
    window.arrayDetector = arrayDetector;
    window.LRUCache = LRUCache;
}
