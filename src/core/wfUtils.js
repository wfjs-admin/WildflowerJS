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
 * - WF_ERRORS    : Structured error code definitions, WF-001 through WF-999,
 *                  allocated in per-subsystem blocks (see CODE ALLOCATION below)
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

/**
 * Shared text-binding primitives. These are the single source of truth for how
 * a bound value becomes text and how it lands on an element, so the generic
 * render path, the directWriter, and any future compiled row updater all
 * produce byte-identical DOM. Coercion matches the historical inline form
 * (`'' + num` is a faster path than String(num) but produces the same string).
 */
export function __wf_str(v) {
    return v == null ? '' : (typeof v === 'number' ? '' + v : String(v));
}

export function __wf_txt(el, s) {
    // Fast path: a single text-node child (the common bound-element shape after
    // first render) is mutated in place via its .data, preserving node identity.
    // Setting el.textContent instead destroys all children and allocates a fresh
    // text node on every write; measurably more script/DOM churn on updates
    // (vs the in-place set nodeValue that fine-grained frameworks use). Empty,
    // multi-child, or element-child cases fall back to textContent (unchanged).
    const fc = el.firstChild;
    if (fc !== null && fc.nodeType === 3 && fc.nextSibling === null) {
        if (fc.data !== s) fc.data = s;
    } else if (el.textContent !== s) {
        el.textContent = s;
    }
}

/**
 * Element.moveBefore (Chrome 133+, WHATWG atomic move): relocates an
 * already-connected node WITHOUT disconnect/reconnect, preserving focus,
 * selection, iframe documents, playing media, and running CSS animations
 * across the move. Callers must guard on same-parent (which guarantees the
 * same shadow-including root, the spec's throw condition) and fall back to
 * insertBefore/appendChild — moves only, never initial insertion.
 */
export const HAS_MOVE_BEFORE = typeof Element !== 'undefined' && typeof Element.prototype.moveBefore === 'function';

/**
 * Cooperative yield for chunked page-load work: pause so pending input and
 * paint are serviced, then resume PROMPTLY. Prefers scheduler.yield
 * (Chrome 129+, Firefox 142+; continuation priority), then a user-visible
 * scheduler.postTask (Chrome 94+), then setTimeout (Safari — matches the
 * previous shim's cadence). Deliberately NOT requestIdleCallback: idle
 * priority starves under main-thread contention — the 2026-07-15 headroom
 * probe measured 240-component page-load init at 418 ms via rIC vs 90 ms via
 * postTask under animation-grade contention, identical when idle, with
 * worst-case input wait bounded by the caller's chunk budget.
 */
export const wfYield = (() => {
    const sch = typeof scheduler !== 'undefined' ? scheduler : null;
    if (sch && typeof sch.yield === 'function') {
        return () => sch.yield();
    }
    if (sch && typeof sch.postTask === 'function') {
        const noop = () => {};
        return () => sch.postTask(noop, { priority: 'user-visible' });
    }
    return () => new Promise(resolve => setTimeout(resolve, 0));
})();

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CODE ALLOCATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Codes are grouped by subsystem, one hundred per block, and allocated in
 * order within a block. 143 of the 999 are in use, so the range is nowhere
 * near full — but a BLOCK can fill while the range is mostly empty, which is
 * what happened to queries, and the shape is not visible without counting.
 * Hence this map. Update it when a block is claimed or exhausted.
 *
 *   block  owner                       used            free
 *   ─────  ──────────────────────────  ──────────────  ─────────────────────
 *   000s   core, initialization        001-003         004-099
 *   100s   components                  101-108         109-199
 *   200s   state, computed, watch      201-235         236-299
 *   300s   context                     301-304         305-399
 *   400s   templates, lists            401-415         416-499
 *   500s   bindings, forms             501-512         513-599
 *   600s   actions, events             601-606         607-699
 *   700s   routing                     701-712         713-799
 *   800s   SSR                         801-802         803-899
 *   900s   stores    901-910           queries 940,950-999  911-939 (shared), 941-949
 *
 * The 900s hold two owners and are the one block to think about before
 * allocating. Stores grew up from 901 and queries were given 950-999, which
 * filled. Queries then claimed 940-949 and fill it UPWARD from 940; the next
 * exhausted block is claimed the same way, backward in tens (930-939, then
 * 920-929). Stores continue upward from 911. The two therefore approach each
 * other across 911-939, and whichever needs the space first should take it —
 * but the one that does should say so here, because after that the other one
 * needs a home somewhere else and there is no way to tell from the numbers.
 *
 * A retired code is never reused: its number stays commented in place below
 * and keeps its entry on the error-codes page, so a reader who meets the code
 * in an old console log or an old post can still find out what it was.
 * Every code that can fire needs an entry on that page — it is the surface
 * the printed docs URL points at.
 */
export const WF_ERRORS = {
    // Core/initialization (001-099)
    ROOT_NOT_FOUND: { code: 'WF-001', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Root element not found' }) },
    CONFIG_INVALID: { code: 'WF-002', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Invalid configuration value' }) },
    FEATURE_NOT_IN_BUILD: { code: 'WF-003', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A defined capability is excluded from this build tier' }) },

    // Component lifecycle (100-199)
    COMPONENT_INIT_FAILED: { code: 'WF-101', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error initializing component' }) },
    COMPONENT_NOT_FOUND: { code: 'WF-102', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Component instance not found' }) },
    COMPONENT_CONTEXT_MISSING: { code: 'WF-103', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Component context not available' }) },
    PARENT_HANDLER_ERROR: { code: 'WF-104', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in parent event handler' }) },
    DOM_OWNERSHIP: { code: 'WF-105', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Manual DOM write on a node the engine keeps current' }) },
    DESTROY_RESURRECT: { code: 'WF-106', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'destroy() called with the component element still in the document' }) },
    PROVIDER_MISSING: { code: 'WF-107', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A declared provider was never provided' }) },
    REGISTRATION_OVERWRITTEN: { code: 'WF-108', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A directive or plugin registration was overwritten' }) },

    // State/reactivity (200-299)
    COMPUTED_EVAL_ERROR: { code: 'WF-201', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error evaluating computed property' }) },
    CIRCULAR_DEPENDENCY: { code: 'WF-202', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Circular dependency detected' }) },
    STATE_SET_ERROR: { code: 'WF-203', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error setting state value' }) },
    STATE_DELETE_ERROR: { code: 'WF-204', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error deleting state value' }) },
    STATE_LOAD_ERROR: { code: 'WF-205', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error loading state from storage' }) },
    STATE_SAVE_ERROR: { code: 'WF-206', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error saving state to storage' }) },
    STATE_UPDATE_INVALID: { code: 'WF-207', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Invalid parameter for state update' }) },
    // WF-208 (COMPUTED_NOT_FOUND) RETIRED 2026-07-17: defined at launch but
    // never fired from any code path; misspelled computed references are
    // caught by binding validation instead. Do not reuse the code number.
    COMPUTED_NOT_FUNCTION: { code: 'WF-209', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Computed property must be a function' }) },
    PATH_INVALID: { code: 'WF-210', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Invalid path segment' }) },
    SUBSCRIPTION_ERROR: { code: 'WF-211', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in subscription callback' }) },
    // WF-212 (POOL_AGGREGATE_NONREACTIVE) RETIRED 2026-07-12: pool.length/.size
    // are reactive on demand now (B2, DX diagnostics sweep) — the trap the
    // warning guarded no longer exists. Do not reuse the code number.
    INDEXED_PATH_OBSERVER: { code: 'WF-213', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Watch/subscribe path targets a list item by numeric index; index paths reflect the item\'s position when first observed and go stale after splice/reorder' }) },
    ITEM_COMPUTED_THIS_MISS: { code: 'WF-214', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Zero-arg computed referenced in a list row reads a property via `this` that is undefined on the component but present on the list item; item-level computeds receive the item as their first argument' }) },
    DUPLICATE_REGISTRATION_CONFLICT: { code: 'WF-215', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A component or store is being re-registered under a name that already exists with a DIFFERENT definition; the new definition is ignored and the original is kept. Unregister the existing one first (wildflower.unregister(name)) or use a distinct name' }) },
    HOT_LOOP_FACADE_READS: { code: 'WF-216', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A state property is read thousands of times per frame through the reactive facade (sustained hot loop)' }) },
    COMPUTED_WRITE_IN_EVAL: { code: 'WF-217', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Computed wrote to reactive state during its own evaluation' }) },
    NAME_COLLISION: { code: 'WF-218', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'The same name is defined in more than one definition bucket' }) },
    DEFINITION_KEY_IGNORED: { code: 'WF-219', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Definition key is not part of the contract and was ignored' }) },
    COMPUTED_ASSIGNMENT: { code: 'WF-220', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Assignment to a computed property was ignored (computeds are read-only)' }) },
    BATCH_ARG_INVALID: { code: 'WF-221', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'wildflower.batch(fn) requires a function argument' }) },
    RULE_CONFIG: { code: 'WF-228', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Validation rule declaration invalid; rule disabled' }) },
    RULE_EVAL_ERROR: { code: 'WF-229', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Validation rule check threw; rule skipped for this pass' }) },
    RULE_VERDICT_INVALID: { code: 'WF-234', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Validation rule check returned something that is not a verdict; rule skipped' }) },
    ITEM_COMPUTED_ASYNC: { code: 'WF-235', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Item-level list computed returned a Promise; async computeds are component/store/plugin-level only' }) },

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
    POOL_CONTAINER_UNDECLARED: { code: 'WF-408', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'data-pool container references a pool name that is not in the component\'s pools block' }) },
    POOL_NEVER_POPULATED: { code: 'WF-409', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Pool has a data-pool container but was never populated, so it renders nothing' }) },
    POOL_MIXED_ENTITY_SHAPES: { code: 'WF-410', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Entity spawns in this pool produce different shapes (fields or field order), which breaks V8\'s hidden-class optimization for every entity in the pool' }) },
    POOL_COMPUTED_FRAME_BUDGET: { code: 'WF-411', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Pool with entity.computed reached a size where per-flush computed evaluation threatens the frame budget' }) },
    TEMPLATE_LOOKUP_MISS: { code: 'WF-412', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A named or typed template never resolved' }) },
    POOL_ARRAY_MISUSE: { code: 'WF-414', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Index-dependent array method or direct items mutation on pool storage' }) },
    POOL_ENTITY_KEY: { code: 'WF-415', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Pool entity key missing or duplicate' }) },

    // Binding errors (500-599)
    BINDING_EVAL_ERROR: { code: 'WF-501', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error evaluating binding expression' }) },
    // Shares WF-501 with BINDING_EVAL_ERROR (docs entry covers both shapes);
    // distinct here so the dev-mode message matches the specific case.
    MODEL_STORE_SHORTHAND: { code: 'WF-501', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: '$store.path cannot be used in data-model (store paths are read-only)' }) },
    CLASS_BINDING_ERROR: { code: 'WF-502', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error evaluating class binding' }) },
    HTML_BINDING_ERROR: { code: 'WF-503', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Failed to create HTML binding context' }) },
    CONDITIONAL_UPDATE_ERROR: { code: 'WF-504', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error updating conditional context' }) },
    CLASS_BINDING_SHAPE: { code: 'WF-505', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Class binding shape mismatch (coerced)' }) },
    // WF-506 RETIRED 2026-07-16: briefly used for $-in-props before that became
    // a supported feature (c9a0a953) the same day. Do not reuse the number.
    PROP_PATH_UNRESOLVED: { code: 'WF-507', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A data-prop path resolved to undefined and is still unresolvable in the parent after init settled' }) },
    PROP_ATTR_UNDECLARED: { code: 'WF-508', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A data-prop-*/data-props value names a prop the component never declared, so it is ignored' }) },
    BINDING_VALIDATION: { code: 'WF-509', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Binding validation' }) },
    PROPS_PARSE_FAILED: { code: 'WF-510', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Failed to parse the data-props attribute as JSON' }) },
    // WF-511 briefly held the query external-write diagnostic pre-release;
    // renumbered to WF-950 (query block, store century) before shipping.
    MODEL_STORE_SHADOW: { code: 'WF-512', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A data-model root names both a component state key and a store; component state wins' }) },

    // Action/event errors (600-699)
    ACTION_HANDLER_ERROR: { code: 'WF-601', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in action handler' }) },
    METHOD_ERROR: { code: 'WF-602', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error in component method' }) },
    EMIT_NO_INSTANCE: { code: 'WF-603', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Cannot emit - component instance not found' }) },
    LIFECYCLE_NAME_ACTION: { code: 'WF-604', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'data-action targets a reserved lifecycle name' }) },
    REPLAY_STALE_EVENT: { code: 'WF-605', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Stale event API called in an action replayed after init' }) },
    ACTION_STORE_SHORTHAND: { code: 'WF-606', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: '$entity.path cannot name an action handler' }) },

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
    STORE_REENTRANT_WRITE: { code: 'WF-908', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Store path written from inside its own change notification' }) },
    STORE_NEVER_REGISTERED: { code: 'WF-909', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A subscribed or watched store never registered' }) },
    STORE_WAIT_TIMEOUT: { code: 'WF-910', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Timed out waiting for a subscribed store to become ready' }) },

    // Query diagnostics: queries are stores with a source, so their codes
    // live in the store century, in their own block. 950-999 filled, so the
    // block was extended backward to 940-949, which fills upward from here.
    // (966 is not a query code; FACADE_IN_RAW sits inside the run.)
    QUERY_CONFIRM_NOT_INHERITED: { code: 'WF-940', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A query-level `confirmation` reaches update and create only, so this named operation discarded its response body and refetched the whole collection instead' }) },

    QUERY_STORE_EXTERNAL_WRITE: { code: 'WF-950', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'External write to a query-owned store' }) },
    QUERY_DUPLICATE: { code: 'WF-951', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Query name already registered; second registration ignored' }) },
    QUERY_NAME_COLLISION: { code: 'WF-952', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Query name collides with an existing store; registration ignored' }) },
    QUERY_FROM_INVALID: { code: 'WF-953', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Query `from` must be a URL string or a function' }) },
    QUERY_POLL_SUBSECOND: { code: 'WF-954', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Query poll rung is sub-second' }) },
    // Shares one code across getQuery() and data-query markup (docs entry covers both shapes)
    QUERY_UNKNOWN: { code: 'WF-955', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'No such query is registered' }) },
    QUERY_SEED_INVALID: { code: 'WF-956', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'data-seed attribute is not valid JSON; ignored' }) },
    QUERY_SSE_NO_URL: { code: 'WF-957', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'The sse rung needs a URL; rung skipped' }) },
    QUERY_SSE_NON_JSON: { code: 'WF-958', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'SSE message was not valid JSON; treated as an invalidation signal' }) },
    QUERY_NULL_RECORD: { code: 'WF-959', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Record query resolved null/undefined; bound fields render empty' }) },
    QUERY_APPEND_UNKEYED: { code: 'WF-960', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Append received rows without the declared key; applied as a replace' }) },
    QUERY_REFRESH_SHAPE: { code: 'WF-961', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'refresh() received unexpected options; request parameters belong inside params' }) },
    QUERY_EXPECT_DRIFT: { code: 'WF-962', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Incoming rows drifted from the data-expect declaration' }) },
    QUERY_ORPHAN: { code: 'WF-963', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'data-query element has no component ancestor, so nothing will ever process it' }) },
    QUERY_TO_INVALID: { code: 'WF-964', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'write() needs a `to` function declared on the query' }) },
    QUERY_WRITE_KEYLESS_RESULT: { code: 'WF-965', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'write() resolved with an object lacking the query key; treated as resolve-with-nothing (the query invalidates)' }) },
    FACADE_IN_RAW: { code: 'WF-966', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A container written to reactive state holds facade-wrapped elements; unwrap with wildflower.toRaw before writing' }) },
    QUERY_RUNG_UNKNOWN: { code: 'WF-967', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Unrecognized refresh rung token; token ignored' }) },
    QUERY_PERSIST_INVALID: { code: 'WF-968', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Query `persist` must be true or a storage-key string; persistence disabled' }) },
    QUERY_WRITE_KEYLESS: { code: 'WF-969', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'write() was called without the query key field; a keyless item has no row to target' }) },
    QUERY_PARAMS_THREW: { code: 'WF-970', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'The query `params` function threw; the request proceeds with no declared params' }) },
    QUERY_TO_SHAPE: { code: 'WF-971', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A `to` or `create` declaration is not a URL string, an operation entry, or a function' }) },
    QUERY_URL_TOKEN_UNRESOLVED: { code: 'WF-972', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A :token in the request URL had no value on the item or in params; no request was sent' }) },
    QUERY_URL_TOKEN_UNDECLARED: { code: 'WF-973', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A :token in a declared URL names nothing the query can supply' }) },
    QUERY_OP_UNKNOWN: { code: 'WF-974', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'write() or create() named an operation this query does not declare' }) },
    QUERY_DELETE_SHAPE: { code: 'WF-975', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'The delete operation and the declared `deleted` field disagree' }) },
    QUERY_OP_NO_FIELDS: { code: 'WF-976', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'The written item merges no fields onto its row, so nothing can roll back' }) },
    QUERY_BODY_MISSING: { code: 'WF-977', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'An update or create carries fields but declares no `body`, so the request is sent empty' }) },
    QUERY_OPTION_IGNORED: { code: 'WF-978', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A declarative option cannot be honored beside a function `from`' }) },
    QUERY_PARAMS_MIXED: { code: 'WF-979', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'An engine refetch dropped values the last one-shot refresh({ params }) had applied' }) },
    QUERY_SELECT_SHAPE: { code: 'WF-980', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'The read response did not arrive as an array of rows' }) },
    QUERY_HEADERS_INVALID: { code: 'WF-981', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A `headers` declaration is not an object or a function, or it threw' }) },
    QUERY_CREATE_ON_RECORD: { code: 'WF-982', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'create() was called on a record-shaped query, which holds one record and has no second to create' }) },
    QUERY_RETRY_SHAPE: { code: 'WF-983', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Query `retry` must be a number; a non-number coerces silently, usually to 0 (retry disabled)' }) },
    QUERY_STREAM_HEADERS: { code: 'WF-984', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Declared headers cannot apply to the sse stream; EventSource carries no headers' }) },
    QUERY_INITIAL_SHAPE: { code: 'WF-985', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Query `initial` must be an array of rows; a non-array seed is ignored' }) },
    QUERY_REDIRECT_CROSS_ORIGIN: { code: 'WF-986', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A request with declared headers was redirected to another origin; the platform strips only Authorization on the hop' }) },
    QUERY_WRITE_UNDEFINED_FIELD: { code: 'WF-987', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'write() received an undefined-valued field; undefined is not a value (null clears, absent leaves alone), so the field is treated as absent' }) },
    QUERY_SAVE_AFTER_CLEAR: { code: 'WF-988', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A persist save landed inside the clearPersisted() window and was suppressed; a real logout navigates, reloads, or tears the query down' }) },
    QUERY_SSE_JSON_ENDPOINT: { code: 'WF-989', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'The sse stream on the read URL keeps being refused without ever delivering a message; the endpoint likely answers JSON, not text/event-stream' }) },
    QUERY_WRITE_UNHANDLED: { code: 'WF-990', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A write() rejection reached no handler; rollback and syncError already applied, but the rejection is part of the contract' }) },
    QUERY_WRITE_PENDING: { code: 'WF-991', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A write has been pending far longer than a request should take; its claims and the paused refresh machinery hold until it settles' }) },
    QUERY_PERSIST_SHAPE: { code: 'WF-992', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A persisted row carries a value JSON cannot round-trip (Date, Map, or Set); it restores different after a reload' }) },
    QUERY_HEADERS_ORIGIN_MISS: { code: 'WF-993', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A request origin matched no config({ headers }) key, but a declared key differs only in scheme or port; origins compare exactly, so those headers never ship' }) },
    QUERY_PERSIST_SAVE_FAILED: { code: 'WF-994', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A persist save failed and was dropped along with the stored snapshot; nothing persists for this query until a save succeeds' }) },
    QUERY_WRITE_EXTRA_ARG: { code: 'WF-995', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'write(item, ...) received a second argument, which this form does not take; it was ignored' }) },
    QUERY_WRITE_NO_ITEM: { code: 'WF-996', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'write() was called with no item, so the operation carries no fields and nothing can roll back' }) },
    QUERY_RECORD_FIELD_MISSING: { code: 'WF-997', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A binding inside a record-shape query subtree names something the row and the component both lack, so it renders empty' }) },
    QUERY_CONFIRMATION_THREW: { code: 'WF-998', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A confirmation: callback threw, so the write rejected and rolled back even though the server answered ok; confirmation receives the parsed response body, not the Response' }) },
    QUERY_WRITE_BODY_UNPARSED: { code: 'WF-999', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'A write succeeded but its response body is not JSON, so there was nothing to apply and the query refetched; an empty body is normal and says nothing here' }) },
    // 950-999 is full. Queries claimed 940-949 and fill it UPWARD from the
    // top of this block, so the next query code is WF-941 (940 is taken, and
    // is declared up there in numeric order, not down here). See CODE
    // ALLOCATION at the top of this
    // file before claiming another block: 911-939 is shared headroom that
    // stores also grow into.

    // CSP-safe expression evaluator (non-numeric codes: separate category
    // from the 1xx-9xx ranges because they describe parser / security
    // policy outcomes, not framework-internal errors).
    CSP_SYNTAX: { code: 'WF-CSP-SYNTAX', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Cannot parse expression' }) },
    CSP_UNSUPPORTED: { code: 'WF-CSP-UNSUPPORTED', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Expression uses unsupported syntax' }) },
    CSP_SECURITY: { code: 'WF-CSP-SECURITY', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Blocked access to restricted API' }) },

    // Security policy outcomes (non-numeric, like the CSP set): the engine
    // blocked or flagged something by design, not an internal error.
    SEC_BLOCKED: { code: 'WF-SEC-BLOCKED', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Blocked a dangerous attribute or URL value' }) },
    SEC_SANITIZER: { code: 'WF-SEC-SANITIZER', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'HTML is rendered without a configured sanitizer' }) },

    // Render-effect path resolution failures
    EFFECT_PATH: { code: 'WF-EFFECT', ...((typeof __DEV__ !== 'undefined' && __DEV__) && { message: 'Error resolving path in render effect' }) }
};

/**
 * Marker for query-engine writes to query-owned stores. The engine bumps
 * depth around its synchronous write blocks; the ContextProxy set trap
 * treats depth 0 as an external write and emits WF-950 in dev builds.
 * A shared mutable object (not a boolean export) so both modules see the
 * same cell.
 */
export const QUERY_ENGINE_WRITE = { depth: 0 };

/**
 * Synthetic computed name for a pending-entity dependency that has no computed
 * behind it. An external() miss inside a computed registers under that
 * computed's name and the drain re-evaluates it; a miss from a plain binding
 * (data-list, data-bind, class/attr expressions) has no such name, and this
 * stands in so the same drain can wake it. Shared rather than written as a
 * literal at each site: a marker that must match across modules and fails
 * silently when it does not is exactly the kind of string to name once.
 * Sibling of the older '_subscribe_' marker in the same registry.
 */
export const PENDING_BINDING = '_binding_';

/**
 * Depth marker for "a computed is currently evaluating".
 *
 * `_wrapMethod` queues a method call and returns undefined while a component
 * is not init-ready, so an action fired before init() replays afterwards
 * rather than being lost. Everything the framework evaluates to produce the
 * FIRST paint runs before that flag is set, so a computed that delegates to a
 * method received `undefined`, computed a wrong result, and cached it, while
 * the queued call replayed for real afterwards and looked innocent.
 *
 * A computed evaluation is a synchronous read that needs its value now and
 * cannot be meaningfully replayed later, which is the same reason the wrapper
 * already exempts re-entrant calls ("already inside a known execution
 * frame"). This cell is how the two ends of that decision see each other, and
 * a shared mutable object rather than a boolean export so every module reads
 * the same cell. Depth, not a flag, because computeds nest.
 */
// depth: how many computed evaluations are on the stack (any entity).
// owners: the component instance evaluating at each level (null for stores
// and plugins). The pre-init action queue is bypassed only for a method
// call landing on the instance whose OWN computed is evaluating (review
// R16): the global depth alone lifted every component's queue while any
// computed anywhere evaluated, so a computed on A reaching a method on
// not-yet-initialized B ran it early instead of queueing it for replay.
export const COMPUTED_EVAL = { depth: 0, owners: [] };

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
 * Log a runtime warning. Survives production builds intentionally;
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

// Dev-only definition-contract check. Entity definitions (component / store /
// plugin / pool entity block) consume a fixed set of named keys, bind
// function-valued keys as methods, and silently ignore everything else — which
// reads as data loss to the author (state written at the top level instead of
// inside `state: {}` is THE recurring mistake). Warn for each ignored key.
// `_`-prefixed keys are the documented deliberate-stash escape and stay
// silent. Only called inside __DEV__ blocks, so it never runs in production.
const _warnedDefContracts = new Set();
export function validateEntityDefinition(kind, name, definition, allowedKeys) {
    if (!definition || typeof definition !== 'object') return;
    const guard = kind + ':' + name;
    if (_warnedDefContracts.has(guard)) return; // one batch per definition, not per instance
    _warnedDefContracts.add(guard);
    for (const key of Object.keys(definition)) {
        if (key.charCodeAt(0) === 95) continue;              // '_' prefix: deliberate stash
        if (typeof definition[key] === 'function') continue; // functions bind as methods
        if (allowedKeys.indexOf(key) !== -1) continue;
        let hint;
        if (key === 'methods' || key === 'actions') {
            hint = `Methods live at the top level of the definition, not in a '${key}' block.`;
        } else if (kind === 'Component' && (key === 'storageKey' || key === 'autoSave')) {
            hint = 'Components read persistence config from element attributes (data-storage-key), not the definition.';
        } else {
            hint = "State values belong inside 'state: {}'; only methods live at the top level.";
        }
        wfError(WF_ERRORS.DEFINITION_KEY_IGNORED, {
            warn: true,
            context: `${kind} '${name}': top-level key '${key}' is not a function and is not part of the ${kind.toLowerCase()} contract, so it was ignored`,
            suggestion: hint
        });
    }
}

// Dev-only cross-bucket name-collision check (A5). Duplicate keys WITHIN one
// object literal are invisible at runtime (JS collapses them at parse time —
// lint territory), but the same name living in DIFFERENT buckets is visible
// and silently shadows: a method vs a state/computed name means one of them
// is unreachable; state vs computed resolves by documented precedence
// (computed wins) which is a trap when unintentional. Only called inside
// __DEV__ blocks, so it never runs in production.
export function warnDefinitionCollisions(kind, name, definition) {
    if (!definition || typeof definition !== 'object') return;
    const guard = 'collide:' + kind + ':' + name;
    if (_warnedDefContracts.has(guard)) return;
    _warnedDefContracts.add(guard);
    const state = (definition.state && typeof definition.state === 'object') ? definition.state : null;
    const computed = (definition.computed && typeof definition.computed === 'object') ? definition.computed : null;
    for (const key of Object.keys(definition)) {
        if (typeof definition[key] !== 'function') continue;
        if (state && key in state) {
            wfError(WF_ERRORS.NAME_COLLISION, {
                warn: true,
                context: `${kind} '${name}': method '${key}()' collides with state.${key}; one of them is shadowed wherever the bare name resolves`,
                suggestion: 'Rename one.'
            });
        }
        if (computed && key in computed) {
            wfError(WF_ERRORS.NAME_COLLISION, {
                warn: true,
                context: `${kind} '${name}': method '${key}()' collides with computed '${key}'; one of them is shadowed wherever the bare name resolves`,
                suggestion: 'Rename one.'
            });
        }
    }
    if (state && computed) {
        for (const key of Object.keys(computed)) {
            if (key in state) {
                wfError(WF_ERRORS.NAME_COLLISION, {
                    warn: true,
                    context: `${kind} '${name}': '${key}' is defined in both state and computed. The computed wins everywhere except explicit this.state.${key} reads`,
                    suggestion: 'Rename one if this is unintentional.'
                });
            }
        }
    }
}

/**
 * Dev-only structural + source signature of an entity definition, used by
 * WF-215 to decide whether a re-registration under an existing name carries a
 * DIFFERENT definition. Function-valued keys contribute a hash of their source
 * (arity alone is not enough: two demos can share method names and signatures
 * yet differ only in a method body, which is exactly the collision WF-215 must
 * catch). Only called inside __DEV__ blocks, so it never runs in production.
 *
 * @param {Object} def - Component or store definition object
 * @returns {string} A comparable signature string
 */
export function definitionSignature(def) {
    if (!def || typeof def !== 'object') return String(def);
    const parts = [];
    const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; };
    const walk = (obj, prefix, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 4) return;
        for (const k of Object.keys(obj).sort()) {
            const v = obj[k];
            if (typeof v === 'function') parts.push(prefix + k + '=fn:' + v.length + ':' + hash(v.toString()));
            else if (v && typeof v === 'object') { parts.push(prefix + k + '{'); walk(v, prefix + k + '.', depth + 1); }
            else parts.push(prefix + k + '=' + typeof v);
        }
    };
    walk(def, '', 0);
    return parts.join('|');
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
}
