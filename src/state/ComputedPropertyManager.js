/**
 * ComputedPropertyManager - Lazy computed properties with dirty-flag invalidation
 *
 * These methods are mixed into ReactiveStateManager.prototype via Object.assign
 * in the entry point modules (index.js, index.full.js, etc.). They are NOT a
 * separate class — `this` always refers to a ReactiveStateManager instance.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A computed property is a derived value — a function of state (and possibly
 * other computeds). For example: `fullName` computes from `state.firstName`
 * and `state.lastName`. The system must:
 *   1. Know WHAT a computed depends on (dependency tracking)
 *   2. Know WHEN those deps change (invalidation)
 *   3. Re-evaluate ONLY when actually read and stale (lazy evaluation)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LIFECYCLE OF A COMPUTED PROPERTY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1. REGISTRATION (addComputed):
 *    - User defines: `computed: { fullName() { return this.state.first + ' ' + this.state.last } }`
 *    - Framework binds the function to a context object with `state` and `computed` accessors
 *    - Creates a ComputedNode (monomorphic object holding all per-computed state)
 *    - Triggers initial evaluation to establish the dependency graph
 *
 * 2. INITIAL EVALUATION (_evaluateComputedFull — "full path"):
 *    - Sets `activeComputation = 'fullName'` so dependency tracking knows who's reading
 *    - Calls the bound function — any `this.state.X` access triggers the proxy get
 *      trap, which calls `_trackDependency('X')`, recording that fullName depends on X
 *    - Caches the result in `computedCache` and saves dep versions in `_computedDepVersions`
 *    - If dep count matches previous evaluation, promotes to "stable" (see below)
 *
 * 3. INVALIDATION (when state changes):
 *    - Proxy set trap detects `state.firstName = 'Jane'`
 *    - Increments `_stateVersions.get('firstName')` and `_globalEpoch`
 *    - Looks up `computedDependencies.get('firstName')` → finds `{fullName}`
 *    - Calls `_markComputedsDirtyTransitively({fullName})` (in ReactiveStateManager.js)
 *    - Sets the DIRTY flag on fullName's ComputedNode
 *    - Does NOT re-evaluate — just marks dirty
 *
 * 4. LAZY RE-EVALUATION (evaluateComputed — on next read):
 *    - DOM binding reads `data-bind="fullName"` during render
 *    - Calls `evaluateComputed('fullName')`
 *    - Node fast path sees DIRTY flag → calls `_updateNode`
 *    - `_updateNode` calls the function, compares result, updates cache
 *    - If value changed: bumps version, notifies effects, cascades to dependents
 *    - Clears DIRTY flag, updates epoch
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * TWO EVALUATION PATHS: NODE FAST PATH vs FULL PATH
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The most important thing to understand about this file is that there are
 * TWO parallel evaluation paths that do similar things with different data
 * structures. This duplication is intentional — the fast path exists purely
 * for performance on the steady-state hot path.
 *
 *   evaluateComputed(name)
 *     │
 *     ├─ IS STABLE? ──yes──► NODE FAST PATH (lines ~297-494)
 *     │                       Uses: ComputedNode object (parallel arrays, bitmask flags)
 *     │                       Stale check: inline loop over node.deps/depVersions/depNodes
 *     │                       Re-eval: _updateNode() — lightweight, no dep re-tracking
 *     │                       ~5 operations for a cache hit (1 Map.get + property accesses)
 *     │
 *     └─ NOT STABLE ──────► FULL PATH (lines ~367-725)
 *                            Uses: Maps (_computedDepVersions, _computedLastEpoch, etc.)
 *                            Stale check: _isComputedStale() with Map lookups
 *                            Re-eval: _evaluateComputedFull() — full dep tracking, circular
 *                                     detection, evaluation stack, stability promotion
 *                            ~12+ operations for a cache hit
 *
 * A computed starts on the FULL PATH (first 1-2 evaluations) and gets PROMOTED
 * to the NODE FAST PATH once it's proven "stable" (same dep count on consecutive
 * evaluations). Nearly all real-world computeds stabilize after 2 evaluations.
 * The full path remains as fallback for: first evaluation, unstable computeds
 * (conditional deps), error recovery, SSR hydration, and circular dependency
 * detection.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE ComputedNode OBJECT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Each computed property gets a ComputedNode (created in addComputed, populated
 * during stability promotion). The node consolidates state that was previously
 * scattered across 5+ separate Maps into a single monomorphic object:
 *
 *   {
 *     name: 'fullName',                    // for cache/version lookups
 *     computedPath: 'computed:fullName',    // pre-allocated (avoids template literal per read)
 *     fn: [bound function],                // the user's computed function
 *     value: 'Jane Doe',                   // cached result (replaces computedCache entry)
 *     lastResult: 'Jane Doe',              // previous result (for change detection)
 *     version: 3,                          // incremented only when VALUE changes
 *     lastEpoch: 42,                       // last global epoch when verified fresh
 *     cacheGen: 1,                         // tracks external cache invalidation
 *     flags: STABLE | HAS_DEPENDENTS,      // bitmask (see below)
 *     deps: ['firstName', 'lastName'],     // dependency paths (parallel array)
 *     depVersions: [5, 3],                 // saved versions (parallel to deps)
 *     depNodes: [null, null],              // direct node refs for computed deps
 *   }
 *
 * The `deps`, `depVersions`, and `depNodes` arrays are parallel — index i in
 * each array refers to the same dependency. For state deps, `depNodes[i]` is
 * null and we check `_stateVersions.get(deps[i])`. For computed deps (e.g.,
 * when fullName depends on computed:greeting), `depNodes[i]` is a direct
 * reference to greeting's ComputedNode, allowing version check via property
 * access (`depNodes[i].version`) instead of Map lookup.
 *
 * Bitmask flags:
 *   STABLE (1)         — Dep set is static; eligible for node fast path
 *   DIRTY (2)          — Marked dirty by _markComputedsDirtyTransitively; needs re-eval
 *   HAS_DEPENDENTS (4) — Other computeds depend on this one; _updateNode must
 *                         cascade dirty flags and check computedDependencies
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * STALENESS DETECTION: EPOCH + VERSION SYSTEM
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Two counters work together to answer "is this computed stale?":
 *
 * - `_globalEpoch` (single number): Incremented on EVERY state or computed change.
 *   If a computed's lastEpoch === _globalEpoch, NOTHING has changed anywhere
 *   since its last check → guaranteed fresh. This is the O(1) short-circuit
 *   that makes repeated reads of the same computed essentially free.
 *
 * - `_stateVersions` (Map: path → number): Per-path counter incremented only
 *   when THAT path changes. After the epoch check fails (something changed
 *   somewhere), we compare each dep's saved version against its current version
 *   to determine if THIS computed's specific deps changed.
 *
 * The epoch check catches ~90% of reads in typical apps (most computeds are
 * read multiple times per render cycle but deps only change once). The version
 * check handles the remaining 10% where the epoch advanced but a different
 * state path changed (not one of our deps).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * STABILITY PROMOTION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * After each evaluation in _evaluateComputedFull, we compare the new dependency
 * count against the previous count. If they match (same number of deps accessed),
 * we assume the dep set is static and promote to "stable". This populates the
 * ComputedNode with deps/depVersions/depNodes arrays and sets the STABLE flag.
 *
 * Why dep COUNT and not dep IDENTITY? Because checking exact identity would
 * require Set comparison on every evaluation. Count matching is a fast heuristic
 * that works for nearly all real computeds (conditional deps are rare). If a
 * computed truly has dynamic deps, it won't stabilize and stays on the full path.
 *
 * Once stable, the computed uses the node fast path until it errors out (which
 * demotes it back to unstable for recovery via the full path).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DEPENDENCY TRACKING DATA STRUCTURES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Three Maps maintain the dependency graph:
 *
 *   computedDependencies (forward): path → Set<computedName>
 *     "Which computeds depend on this path?"
 *     HOT PATH — consulted on every state write for dirty propagation.
 *     Example: 'firstName' → {'fullName', 'displayName'}
 *
 *   _computedDependsOn (reverse): computedName → Set<path>
 *     "Which paths does this computed depend on?"
 *     Used for staleness checking (compare versions for each dep path)
 *     and for dependency cleanup before re-tracking (O(deps) instead of O(all paths)).
 *     Example: 'fullName' → {'firstName', 'lastName'}
 *
 * Additionally, for the node fast path, deps are cached as parallel arrays
 * on the ComputedNode (node.deps, node.depVersions, node.depNodes). These
 * are populated during stability promotion and updated in-place by _updateNode.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * KEY REENTRANCY HAZARD: _staleCheckDepth
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The most subtle bug risk in this file is around reentrancy during stale
 * checks. The scenario (diamond pattern):
 *
 *   source → left  ─┐
 *   source → right ─┴→ sum
 *
 * When _isComputedStale('sum') runs, it holds a LIVE REFERENCE to the
 * savedVersions Map for 'sum'. It then calls evaluateComputed('left') for
 * avoidable propagation. If left's value changes, _updateNode('left') fires
 * onStateChange, which can trigger a sync effect that calls evaluateComputed('sum')
 * → _updateNode('sum'). That _updateNode would normally update the
 * _computedDepVersions Map for 'sum' — the SAME Map object that _isComputedStale
 * is still reading. This causes _isComputedStale to see matching versions and
 * incorrectly return false.
 *
 * The fix: `_staleCheckDepth` counter. When > 0, _updateNode skips writing to
 * _computedDepVersions (it still updates the node's parallel arrays, which are
 * a separate data structure). This breaks the shared-reference mutation.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * CIRCULAR DEPENDENCY DETECTION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * An evaluation stack (_evaluationStack) tracks which computeds are currently
 * mid-evaluation. If a computed appears on the stack during its own evaluation
 * (A → B → A), it is permanently marked circular in _circularDependencies and
 * returns undefined on all future reads. This only happens in _evaluateComputedFull
 * (the full path) — stable computeds can't be circular because their deps are
 * static and were validated during initial evaluation.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ERROR CACHING (TC39 Signals ERRORED Pattern)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * When a computed throws during evaluation, the error is cached as an
 * ERRORED_SYMBOL sentinel in computedCache. Subsequent reads return undefined
 * without re-running the function. When a dependency changes (stale check
 * detects version mismatch), the sentinel is cleared and re-evaluation is
 * attempted. This prevents broken computeds from throwing on every render
 * while allowing recovery when underlying data is fixed.
 *
 * If a stable computed throws, _updateNode demotes it to unstable (clears
 * STABLE flag) and delegates to _evaluateComputedFull for proper error handling.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * FILE ORGANIZATION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Line   Section                    Purpose
 * ────   ───────                    ───────
 * ~100   Constants & ComputedNode   Bitmask flags, createComputedNode factory
 * ~146   addComputed                Registration: bind functions, create nodes, initial eval
 * ~238   Cache invalidation         _invalidateCachedComputed
 * ~285   evaluateComputed           MAIN ENTRY POINT — routes to node or fallback path
 * ~426   _updateNode                Node fast path re-evaluation (stable computeds)
 * ~503   _evaluateComputedFull      Full path: dep tracking, circular detection, promotion
 * ~732   Utility methods            isCircularDependency, setComputedValue (SSR)
 * ~779   _updateComputedProperties  Eager update (mostly no-op with lazy model)
 * ~857   Dependency tracking        _trackDependency, _addDependency, pattern handling
 * ~1092  Dep cleanup                _clearDependenciesForComputation
 * ~1137  Map-based stale checking   _isComputedStale, _saveDepVersions (Map-based)
 * ~1293  Pattern expansion          _expandPathPatterns (array wildcard patterns)
 *
 * @module
 */

import { ERRORED_SYMBOL } from './RSMConstants.js';
import { objectUtils, wfError, wfWarn, WF_ERRORS } from '../core/wfUtils.js';

// ComputedNode bitmask flags
const STABLE = 1;
const DIRTY = 2;
const HAS_DEPENDENTS = 4;
const DYNAMIC = 8;
const STATIC = 16;

// Regex to detect non-deterministic constructs in computed function bodies.
// If a function has none of these, its deps are deterministic (same on every
// call) and we can skip dep tracking entirely, bypassing the proxy for raw
// state access (STATIC mode in _updateNode).
//
// Two categories trigger rejection:
//   1. Conditional control flow: if/else/switch/case/ternary/&&/||/??.
//      A computed with branching may read different state on different runs.
//   2. Function calls (identifier followed by paren).
//      A delegated helper may contain its own conditional that selects which
//      state to read — the regex can't see inside it. STATIC mode would skip
//      tracking those reads, leaving the helper's branch deps unregistered
//      and producing silent stale reads when the unread branch's state later
//      mutates. False positives here (computeds calling pure helpers like
//      Math.max) just drop to STABLE mode, which still tracks correctly —
//      safe direction.
const CONDITIONAL_PATTERN = /\b(if|else|switch|case)\b|\?|&&|\|\||\?\?|\w\(/;

export { DIRTY, HAS_DEPENDENTS };

/**
 * Create a monomorphic ComputedNode object that consolidates all per-computed
 * state into a single object. This replaces 5+ Map lookups per evaluateComputed
 * call with 1 Map lookup + direct property accesses.
 *
 * All properties are initialized to consistent types in consistent order
 * to ensure V8/SpiderMonkey hidden class stability.
 *
 * @param {string} name - The computed property name
 * @param {Function} fn - The bound computed function
 * @returns {Object} A monomorphic ComputedNode
 */
function createComputedNode(name, fn) {
    return {
        name: name,                    // computed property name (for cache/version lookups)
        computedPath: `computed:${name}`, // pre-computed path string (avoids repeated template literal alloc)
        fn: fn,                        // bound computed function
        value: undefined,              // cached result (replaces computedCache entry)
        lastResult: undefined,         // previous result for change detection (replaces _lastEvalResult entry)
        version: 0,                    // incremented ONLY when value changes (value-based versioning)
        lastEpoch: -1,                 // last verified global epoch (replaces _computedLastEpoch entry)
        cacheGen: 0,                   // tracks external computedCache invalidation
        flags: 0,                      // bitmask: STABLE=1, DIRTY=2, HAS_DEPENDENTS=4
        deps: null,                    // Array<string> — dep paths (replaces _computedDepsArray entry)
        depVersions: null,             // Array<number> — parallel to deps (replaces _computedDepVersions Map)
        depNodes: null,                // Array<Node|null> — direct refs for computed deps
        externalSources: null,         // Array<{rsm, epoch}> — cross-RSM source tracking for staleness short-circuit
    };
}

/**
 * Methods to be mixed into ReactiveStateManager.prototype.
 * All methods below become RSM instance methods — `this` is the RSM.
 */
export const ComputedPropertyMethods = {

    // ═════════════════════════════════════════════════════════════════════
    // SECTION 1: REGISTRATION
    // Called once per component to register computed property definitions.
    // Creates bound functions, ComputedNodes, and triggers initial eval.
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Register computed properties for this state manager.
     *
     * For each property: binds the function to a context object (providing
     * `this.state` and `this.computed` access), creates a ComputedNode,
     * and enqueues initial evaluation to build the dependency graph.
     *
     * The `componentContext` parameter is provided by ComponentLifecycle when
     * the computed is part of a component — it includes component methods,
     * stores, etc. in addition to state/computed. When null (standalone RSM),
     * a minimal context with just state + computed proxy is created here.
     *
     * @param {Object} computedProps - { name: function, ... }
     * @param {Object|null} [componentContext=null] - Component context
     * @returns {ReactiveStateManager} For method chaining
     */
    addComputed(computedProps, componentContext = null) {
        if (!computedProps || typeof computedProps !== 'object') {
            if (__DEV__) wfWarn('addComputed requires an object of computed property definitions');
            return this;
        }

        // Create context object - enhance with component context if provided
        const self = this;
        const computedContext = componentContext || {
            state: this._state,
            // Create a single getter-based object for all computed properties
            computed: new Proxy({}, {
                get: (target, prop) => {
                    // Guard: skip Symbols to prevent "can't convert symbol to string" errors
                    if (typeof prop !== 'string') {
                        return undefined;
                    }
                    // Track computed-to-computed dependency
                    // When formalGreeting accesses this.computed.greeting,
                    // we need to record that formalGreeting depends on computed:greeting
                    // PERF: Lightweight tracking for _updateNode dep comparison.
                    if (self._nodeTrackingSet) {
                        self._nodeTrackingSet.add(`computed:${prop}`);
                    } else if (self.activeComputation) {
                        self._trackDependency(`computed:${prop}`);
                    }
                    return self.evaluateComputed(prop);
                }
            })
        };

        Object.entries(computedProps).forEach(([name, fn]) => {
            if (typeof fn !== 'function') {
                if (__DEV__) wfWarn(`Computed property '${name}' must be a function, skipping`);
                return;
            }

            // Bind the function to the context (which now includes component methods)
            this.computed[name] = fn.bind(computedContext);

            // Create a ComputedNode for consolidated fast-path evaluation
            const node = createComputedNode(name, this.computed[name]);

            // Check ORIGINAL (unbound) fn for conditional constructs.
            // Bound functions return "[native code]" from toString(), so we must
            // check before binding. If no conditionals, deps are deterministic.
            try {
                const src = fn.toString();
                const bodyStart = src.indexOf('{');
                if (bodyStart !== -1) {
                    const body = src.slice(bodyStart + 1, src.lastIndexOf('}'));
                    node._hasConditionals = CONDITIONAL_PATTERN.test(body);
                }
            } catch (e) {
                node._hasConditionals = true; // assume worst case
            }

            this._computedNodes.set(name, node);

            // Clear any cached value
            this._invalidateCachedComputed(name);
        });

        // Force initial evaluation of newly added computed properties
        // to establish the dependency graph and initial values
        Object.keys(computedProps).forEach(propName => {
            try {
                this._enqueueComputedEvaluation(propName);
            } catch (error) {
                wfError(WF_ERRORS.COMPUTED_EVAL_ERROR, { context: propName, cause: error });
            }
        });

        return this;
    },

    // ═════════════════════════════════════════════════════════════════════
    // SECTION 2: CACHE INVALIDATION
    // These are invalidation methods predating the dirty-flag model.
    // They clear entries from computedCache, forcing re-evaluation on next
    // read. Still used by some external callers (entity system, list
    // rendering) that need to force-invalidate specific computeds.
    //
    // Note: With the ComputedNode architecture, external cache invalidation
    // is detected via the _cacheGeneration counter — see the cacheGen check
    // in the node fast path. These methods trigger _cacheGeneration++ via
    // the patched computedCache.delete() method.
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Invalidate a single computed property's cached value.
     * Clears both the computed cache and the last evaluation result
     * to ensure consistent change detection on next evaluation.
     * @param {string} propName - The name of the computed property
     * @private
     */
    _invalidateCachedComputed(propName) {
        // Only invalidate if there's actually a cached value to invalidate
        // This prevents redundant delete calls during batch updates
        if (this.computedCache.has(propName)) {
            this.computedCache.delete(propName);
        }
        if (this._lastEvalResult && this._lastEvalResult.has(propName)) {
            this._lastEvalResult.delete(propName);
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // SECTION 3: evaluateComputed — MAIN ENTRY POINT
    //
    // This is the single public API for reading a computed property's value.
    // Called from: proxy get trap, DOM bindings, other computeds, effects,
    // component render cycles, and direct user code.
    //
    // The method routes to one of two paths:
    //
    //   STABLE + has node ──► NODE FAST PATH (inline below + _updateNode)
    //     - 1 Map.get for the node, then pure property accesses
    //     - Handles: epoch short-circuit, dirty check, inline stale check
    //     - Delegates re-evaluation to _updateNode
    //     - This is the HOT PATH — handles ~95% of reads in a running app
    //
    //   Everything else ──► FULL PATH (below + _isComputedStale + _evaluateComputedFull)
    //     - SSR hydration, circular deps, ERRORED cache, Map-based stale check
    //     - Full dep tracking and stability promotion in _evaluateComputedFull
    //     - Handles: first evaluation, unstable computeds, error recovery
    //
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Evaluate a computed property, returning its current value.
     *
     * This is the ONLY public method for reading computed values. It handles
     * caching, staleness detection, and lazy re-evaluation transparently.
     *
     * @param {string} name - The computed property name (e.g., 'fullName')
     * @returns {any} The computed value, or undefined if circular/errored/missing
     */
    evaluateComputed(name) {
        if (typeof name !== 'string') {
            return undefined;
        }
        // Single node lookup — this one Map.get replaces 3+ Map/Set lookups
        // that the fallback path would need (_stableComputeds.has, computedCache.has, etc.)
        const node = this._computedNodes && this._computedNodes.get(name);

        // ─── CROSS-RSM CACHE-HIT FAST PATH ──────────────────────────────
        // For computeds that depend on state in other RSMs (cross-store),
        // the default behaviour forces re-evaluation on every read because
        // the per-RSM _stateVersions staleness check can't see upstream
        // changes. That's correct but expensive — every read re-runs fn()
        // + traverses cross-store getters, ~500ns per read on a 3-prop
        // chain even when the upstream values haven't changed.
        //
        // Short-circuit when each captured source RSM's _globalEpoch is
        // unchanged since our last eval. externalSources is populated
        // during the first full evaluation by EntitySystem's tracking
        // proxy (each cross-RSM access registers its source RSM on the
        // evaluating computed's node). Each successful eval refreshes
        // the captured epoch to the current value.
        //
        // Skip this path when DIRTY is set — DIRTY means an explicit
        // invalidation signal fired (path-subscriber cascade, manual
        // _invalidateCachedComputed, etc.) and should be respected.
        if (node && node.externalSources &&
            node.externalSources.length > 0 &&
            !(node.flags & DIRTY) &&
            this.computedCache && this.computedCache.has(name)) {
            const sources = node.externalSources;
            let sourceMatches = true;
            for (let i = 0; i < sources.length; i++) {
                if (sources[i].rsm._globalEpoch !== sources[i].epoch) {
                    sourceMatches = false;
                    break;
                }
            }
            if (sourceMatches) {
                // Still register the effect dep — a subsequent effect read
                // of this computed needs the dep graph intact.
                this._registerEffectDependency(node.computedPath);
                // Read from authoritative cache; node.value may not be
                // populated yet on first-eval for unstable computeds.
                return this.computedCache.get(name);
            }
        }

        // ─── NODE FAST PATH ─────────────────────────────────────────────
        // Entry conditions: node exists, is STABLE.
        // Cross-entity computeds are now included: EntitySystem._handleEntityStateChange
        // sets dirty flags on dependent store computeds explicitly (node.flags |= DIRTY),
        // so the dirty-flag mechanism is reliable across stateManagers.
        // ─────────────────────────────────────────────────────────────────
        if (node && (node.flags & STABLE)) {
            // Effect registration: _registerEffectDependency checks the module-level
            // activeEffect internally and returns early if null (no allocation cost
            // since node.computedPath is pre-computed). Must always call through to
            // the RSM method because activeEffect is a module-private variable in
            // ReactiveStateManager.js, not accessible as an instance property here.
            this._registerEffectDependency(node.computedPath);

            // EXTERNAL CACHE INVALIDATION: If computedCache was cleared/deleted
            // externally (e.g., by list rendering's onItemUpdate, entity system),
            // the generation counter will have advanced past the node's cacheGen.
            // Integer compare (~1ns) replaces Map.has (~30ns).
            if (node.cacheGen !== this._cacheGeneration) {
                return this._updateNode(node, name);
            }

            // DIRTY CHECK — dirty flag may be set by deferred dirty propagation
            // (microtask batching) AFTER the last evaluation in the same epoch.
            // Must check before epoch short-circuit to avoid stale cached returns.
            if (node.flags & DIRTY) {
                return this._updateNode(node, name);
            }

            // EPOCH SHORT-CIRCUIT — nothing changed globally since last check
            if (node.lastEpoch === this._globalEpoch) {
                return node.value;
            }

            // INLINE STALE CHECK — parallel arrays instead of Map lookups.
            //
            // For each dependency, compare the saved version (from last eval)
            // against the current version. Two cases:
            //
            //   State dep (depNodes[i] === null):
            //     Check _stateVersions.get(deps[i]) vs depVersions[i]
            //
            //   Computed dep (depNodes[i] is a ComputedNode):
            //     First ensure the dep is fresh (recursive evaluateComputed if
            //     its epoch is stale — this is "avoidable propagation": we only
            //     mark ourselves stale if the dep's VALUE actually changed, not
            //     just because it was re-evaluated). Then check depNodes[i].version
            //     vs depVersions[i] — a direct property access instead of Map lookup.
            //
            let stale = false;

            if (node.deps) {
                const deps = node.deps;
                const depVersions = node.depVersions;
                const depNodes = node.depNodes;
                for (let i = 0; i < deps.length; i++) {
                    if (depNodes[i]) {
                        // Computed dep: ensure fresh, then check if value changed
                        if (depNodes[i].lastEpoch !== this._globalEpoch) {
                            this.evaluateComputed(depNodes[i].name);
                        }
                        if (depNodes[i].version !== depVersions[i]) {
                            stale = true;
                            break;
                        }
                    } else {
                        // State dep: version check via _stateVersions Map
                        if ((this._stateVersions.get(deps[i]) || 0) !== depVersions[i]) {
                            stale = true;
                            break;
                        }
                    }
                }
            }

            if (!stale) {
                node.lastEpoch = this._globalEpoch;
                return node.value;
            }

            // RE-ENTRANCY GUARD: During the stale check loop above, we called
            // evaluateComputed on computed deps. That can cascade — if dep A
            // changed and A feeds into a sync effect that reads THIS computed,
            // _updateNode may have already been called for us (diamond pattern).
            // If so, node.lastEpoch will now match _globalEpoch.
            if (node.lastEpoch === this._globalEpoch) {
                return node.value;
            }

            // Confirmed stale — re-evaluate
            return this._updateNode(node, name);
        }

        // ─── FULL PATH ──────────────────────────────────────────────────
        // Reached when: no node, not stable, has external deps, or first eval.
        // Uses Map-based data structures instead of ComputedNode properties.
        // ─────────────────────────────────────────────────────────────────

        // SSR hydration: value was pre-set by server, skip re-evaluation
        if (__FEATURE_SSR__ && this._ssrHydratedComputed && this._ssrHydratedComputed.has(name)) {
            return this.computedCache.get(name);
        }

        // Track circular dependencies permanently to prevent re-evaluation
        if (!this._circularDependencies) {
            this._circularDependencies = new Set();
        }

        if (this._circularDependencies.has(name)) {
            return undefined;
        }

        const isCrossComponentComputation = this.activeComputation &&
            this.activeComputation.startsWith('external:');

        // EFFECT SYSTEM: Register effect dependency on computed path
        this._registerEffectDependency(`computed:${name}`);

        // LAZY PROPAGATION: Check cache with stale detection
        if (!isCrossComponentComputation && this.computedCache.has(name)) {
            const cached = this.computedCache.get(name);
            // Cached circular dependency error
            if (cached && typeof cached === 'object' && cached.__circularDependencyError) {
                return undefined;
            }
            // TC39 SIGNALS PATTERN: ERRORED sentinel for caching computed errors
            if (cached && typeof cached === 'object' && cached[ERRORED_SYMBOL]) {
                const deps = this._computedDependsOn.get(name);
                const hasDeps = deps && deps.size > 0;

                if (!hasDeps) {
                    // No tracked deps means the error happened before any deps
                    // were recorded. Always re-evaluate so the computed can recover
                    // once the underlying issue is resolved.
                    // Fall through to re-evaluate
                } else if (!this._isComputedStale(name)) {
                    return undefined;
                }
                // Dependencies changed, fall through to re-evaluate
            }
            if (!this._isComputedStale(name)) {
                return cached;
            }
            // Cached value is stale - fall through to re-evaluate
        }

        // FULL PATH: delegate to _evaluateComputedFull for first evaluation / unstable computeds
        return this._evaluateComputedFull(name);
    },

    // ═════════════════════════════════════════════════════════════════════
    // SECTION 4: _updateNode — NODE FAST PATH RE-EVALUATION
    //
    // Called from the node fast path when a stable computed is confirmed
    // stale (dirty flag set, or dep version mismatch). This is a
    // lightweight re-evaluation that skips all the overhead of the full
    // path: no dep clearing/re-tracking, no circular detection, no
    // evaluation stack, no SSR check, no _wf tracking context setup.
    //
    // Contract:
    //   - Only called for STABLE computeds (static dep set)
    //   - Function is called, result compared against lastResult
    //   - If value changed: version bumped, effects notified, dependents dirtied
    //   - Dep versions updated in-place (parallel arrays, no allocation)
    //   - On error: demotes to unstable, delegates to _evaluateComputedFull
    //
    // The "if changed" block inlines what _handleStateChange does for
    // computed paths, but skips irrelevant steps (splice fix, autoSave,
    // regex matching, _lastStateChange tracking) for performance.
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Re-evaluate a stable computed property via its ComputedNode.
     * @param {Object} node - The ComputedNode object
     * @param {string} name - The computed property name
     * @returns {any} The new computed value
     * @private
     */
    _updateNode(node, name) {
        try {
            let result;

            if (node.flags & STATIC) {
                // STATIC: deps are deterministic (no conditionals in fn body).
                // Skip ALL tracking and bypass proxy overhead entirely.
                // The proxy get trap checks _skipTracking and returns raw values
                // without string concat, effect registration, or proxy wrapping.
                this._skipTracking = true;
                try {
                    result = node.fn();
                } finally {
                    this._skipTracking = false;
                }
            } else {
                // STABLE but not STATIC: use lightweight tracking to detect
                // conditional dep changes (same count, different identity).
                //
                // PERF: Use lightweight tracking instead of full activeComputation.
                // Sets _nodeTrackingSet — a temporary Set that the proxy get trap
                // populates with just the dep path (no Map/Set writes to
                // computedDependencies or _computedDependsOn). After fn() returns,
                // we compare the collected paths against node.deps.
                //
                // REENTRANCY: Composed STABLE chains (a STABLE computed reading
                // another STABLE computed) recurse here. The nested call would
                // otherwise clobber the singleton _reusableTrackingSet and clear
                // _nodeTrackingSet on its way out, leaving the outer caller with
                // an empty tracking set and triggering spurious demotion to
                // DYNAMIC. Save the prior _nodeTrackingSet, allocate a fresh Set
                // when we're nested (the singleton is already in use by the
                // parent), and restore in the finally block.
                const prevTrackingSet = this._nodeTrackingSet;
                let trackingSet;
                if (prevTrackingSet) {
                    // Nested call — don't touch the parent's singleton.
                    trackingSet = new Set();
                } else {
                    // Top-level call — reuse the singleton.
                    if (!this._reusableTrackingSet) {
                        this._reusableTrackingSet = new Set();
                    } else {
                        this._reusableTrackingSet.clear();
                    }
                    trackingSet = this._reusableTrackingSet;
                }
                this._nodeTrackingSet = trackingSet;
                try {
                    result = node.fn();
                } finally {
                    this._nodeTrackingSet = prevTrackingSet;
                }

                // Check if tracked deps differ from baked deps — if so, demote
                // so next eval goes through full path with proper dep re-tracking.
                // PERF: Use for-loop instead of .some() to avoid closure allocation.
                // Use the local trackingSet, not _reusableTrackingSet directly:
                // when we're nested, _reusableTrackingSet still holds the parent's
                // deps and reading from it here would compare the wrong set.
                const trackedDeps = trackingSet;
                if (node.deps) {
                    let depsChanged = trackedDeps.size !== node.deps.length;
                    if (!depsChanged) {
                        const nodeDeps = node.deps;
                        for (let di = 0; di < nodeDeps.length; di++) {
                            if (!trackedDeps.has(nodeDeps[di])) {
                                depsChanged = true;
                                break;
                            }
                        }
                    }
                    if (depsChanged) {
                        // Demote: clear STABLE, mark DYNAMIC to prevent re-promotion.
                        // This stops the promote/demote thrashing cycle that occurs with
                        // conditional deps (e.g., `cond ? a : b` always has count=2 but
                        // different identity, causing repeated full-path evaluation).
                        node.flags &= ~STABLE;
                        node.flags |= DYNAMIC;
                        node.deps = null;
                        node.depVersions = null;
                        node.depNodes = null;

                    }
                }
            }

            const resultType = typeof result;
            const oldResult = node.lastResult;

            // Value-based change detection: only trigger downstream updates
            // if the result actually differs. For objects, use deep equality;
            // for primitives, use strict identity (===). This is "avoidable
            // propagation" — if a computed re-evaluates but returns the same
            // value, its dependents don't need to re-evaluate.
            const changed = (resultType === 'object' && result !== null)
                ? (oldResult !== result && !objectUtils.isEqual(oldResult, result))
                : oldResult !== result;

            node.value = result;
            // Keep computedCache in sync with node.value. The node fast path
            // returns node.value directly, but if the computed later demotes
            // (STABLE → DYNAMIC, e.g., conditional dep identity change), the
            // FULL PATH at evaluateComputed:641 reads from computedCache.
            // Without this update, that path would return the stale value
            // from the most recent full-path eval, missing every change made
            // through _updateNode.
            this.computedCache.set(name, result);

            if (changed) {
                node.lastResult = result;

                // Inline version of _handleStateChange for computed paths.
                // Bump the per-path version (only incremented when value CHANGES,
                // not on every re-evaluation — this is what makes avoidable
                // propagation work). Also bump global epoch.
                const computedPath = node.computedPath;
                const newVersion = (this._stateVersions.get(computedPath) || 0) + 1;
                this._stateVersions.set(computedPath, newVersion);
                this._globalEpoch++;
                node.version = newVersion;

                // Notify any reactive effects watching this computed
                if (this._hasAnyEffects) this._notifyEffectDependents(computedPath);

                // Cascade to dependent computeds — but only if this computed
                // actually has downstream computed consumers (HAS_DEPENDENTS flag).
                // Leaf computeds (common in broad fan-out) skip this entirely.
                if (node.flags & HAS_DEPENDENTS) {
                    const dependentComputeds = this.computedDependencies.get(computedPath);
                    if (dependentComputeds && dependentComputeds.size > 0) {
                        this._markComputedsDirtyTransitively(dependentComputeds);
                    }
                }

                // Notify the component (triggers DOM update scheduling)
                this.onStateChange(computedPath, result, oldResult);
            }

            // Housekeeping: clear dirty state, record current epoch + cache gen
            if (node.flags & DIRTY) {
                if (this._dirtyComputeds) this._dirtyComputeds.delete(name);
                node.flags &= ~DIRTY;
            }
            node.lastEpoch = this._globalEpoch;
            node.cacheGen = this._cacheGeneration;

            // Update saved dep versions in-place using node's parallel arrays.
            // The node-array fast path in _isComputedStale reads these directly,
            // so no Map sync is needed.
            if (node.deps) {
                const ndeps = node.deps;
                const ndv = node.depVersions;
                const ndn = node.depNodes;
                for (let i = 0; i < ndeps.length; i++) {
                    ndv[i] = ndn[i] ? ndn[i].version : (this._stateVersions.get(ndeps[i]) || 0);
                }
            }

            return result;
        } catch (e) {
            // Error during evaluation — demote to unstable so the full path
            // handles error caching (ERRORED sentinel) and proper cleanup.
            // The full path will attempt re-evaluation with full dep tracking.
            node.flags &= ~STABLE;
            node.deps = null;
            node.depVersions = null;
            node.depNodes = null;
            return this._evaluateComputedFull(name);
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // SECTION 5: _evaluateComputedFull — FULL EVALUATION PATH
    //
    // This is the heavyweight evaluation path, used for:
    //   - First evaluation of a new computed (no deps tracked yet)
    //   - Unstable computeds (dynamic/conditional deps that don't stabilize)
    //   - Error recovery (after _updateNode catches an exception)
    //   - Computeds demoted from stable (dep count changed)
    //
    // Unlike _updateNode, this method:
    //   - Clears and re-tracks dependencies (unless stable)
    //   - Detects circular dependencies via _evaluationStack
    //   - Sets up this._wf._computedTrackingContext for store integration
    //   - Handles CASCADE PREVENTION (deferred state changes during eval stack)
    //   - Performs STABILITY PROMOTION (populates ComputedNode when dep count stabilizes)
    //   - Caches errors as ERRORED sentinels
    //   - Processes deferred state changes in the finally block
    //
    // The method is intentionally long because it handles many edge cases
    // that the fast path doesn't need to worry about.
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Full evaluation path with dependency tracking, circular detection,
     * and stability promotion.
     * @param {string} name - The computed property name
     * @returns {any} The computed value, or undefined if circular/errored
     * @private
     */
    _evaluateComputedFull(name) {

        // Get current dependency count before potential clearing
        const existingDeps = this._computedDependsOn.get(name);
        const hadDeps = existingDeps && existingDeps.size > 0;
        const previousDepCount = hadDeps ? existingDeps.size : 0;

        // Only clear dependencies if:
        // 1. This computed is NOT marked as stable, OR
        // 2. This is the first evaluation (no deps yet)
        const node = this._computedNodes && this._computedNodes.get(name);

        // ── CROSS-ENTITY LEAN EVALUATION ─────────────────────────────────
        // For externally-dependent computeds that have been evaluated before
        // (node._externalEvalCount > 0), use a lean path that skips the 12
        // steps of _evaluateComputedFull overhead: dep clearing, tracking
        // context creation, circular detection, evaluation stack, etc.
        //
        // NOT DIRTY: return cached value immediately (zero-cost cache hit).
        // DIRTY: call fn() directly, compare result, update cache.
        //
        // This is safe because external-dep computeds have stable deps —
        // they always read from the same store properties. After the first
        // full evaluation establishes deps and entity tracking, subsequent
        // evaluations don't need to re-discover deps.
        // ─────────────────────────────────────────────────────────────────
        if (node && this._computedsWithExternalDeps &&
            this._computedsWithExternalDeps.has(name) && node._externalEvalCount > 0)
        {
            if (this._hasAnyEffects) this._registerEffectDependency(node.computedPath);

            // LEAN RE-EVALUATION: Skip the 12 steps of _evaluateComputedFull
            // overhead (dep clearing, circular detection, evaluation stack,
            // etc.) and just call fn() directly. The fn() call naturally
            // cascades through the dependency chain, so correctness is
            // maintained for arbitrary-depth store chains.
            //
            // CROSS-STORE TRACKING: We DO need to set _computedTrackingContext
            // around fn() so that cross-store getStore() calls return the
            // tracking proxy and any new state reads register their deps. The
            // original lean path skipped this on the assumption that "external
            // deps are stable after first eval" — but that assumption breaks
            // when the first eval early-returned BEFORE reaching a cross-store
            // read (e.g. `if (!id) return null;` before reading another store's
            // state). In that case the cross-store dep was never registered,
            // and without setting tracking context here, subsequent lean evals
            // would never register it either. The proxy's per-call dedup makes
            // re-registration cheap for the common case where deps are stable.
            const prevTrackingContext = this._wf ? this._wf._computedTrackingContext : null;
            const prevIsEvaluatingComputed = this._wf ? this._wf._isEvaluatingComputed : false;
            if (this._wf) {
                this._wf._isEvaluatingComputed = true;
                this._wf._computedTrackingContext = {
                    componentId: this.component?.id || null,
                    computedName: name,
                    stateManager: this,
                    listElement: prevTrackingContext?.listElement || null,
                    isItemLevelComputed: false,
                    itemIndex: -1
                };
            }
            let result;
            try {
                try {
                    result = node.fn();
                } catch (error) {
                    // On error, fall through to full path for proper error handling.
                    // Restore tracking context first so _evaluateComputedFull sets up
                    // its own context cleanly.
                    if (this._wf) {
                        this._wf._computedTrackingContext = prevTrackingContext;
                        this._wf._isEvaluatingComputed = prevIsEvaluatingComputed;
                    }
                    node.flags &= ~DIRTY;
                    return this._evaluateComputedFull(name);
                }
            } finally {
                // Restores the tracking context the caller had active before
                // this LEAN eval started. Idempotent in two ways:
                //   - Top-level call: prevTrackingContext is null, so this writes
                //     null over null (or over the value the inner catch + nested
                //     _evaluateComputedFull left, which is also null).
                //   - Nested call (this LEAN eval was triggered from inside
                //     another eval): prevTrackingContext is the outer context;
                //     restoring it here is exactly what we want, even after the
                //     inner catch's _evaluateComputedFull cleared it to null.
                if (this._wf) {
                    this._wf._computedTrackingContext = prevTrackingContext;
                    this._wf._isEvaluatingComputed = prevIsEvaluatingComputed;
                }
            }

            const oldValue = node.value;
            const changed = (typeof result === 'object' && result !== null)
                ? (oldValue !== result && !objectUtils.isEqual(oldValue, result))
                : oldValue !== result;

            node.value = result;
            node.lastResult = result;
            node.lastEpoch = this._globalEpoch;
            node.cacheGen = this._cacheGeneration;
            this.computedCache.set(name, result);

            // Refresh captured cross-RSM source epochs so the cache-hit
            // fast path in evaluateComputed can short-circuit subsequent
            // reads. externalSources was populated during the first full
            // evaluation; this lean path reuses the same source list.
            if (node.externalSources) {
                const srcs = node.externalSources;
                for (let i = 0; i < srcs.length; i++) {
                    srcs[i].epoch = srcs[i].rsm._globalEpoch || 0;
                }
            }

            if (node.flags & DIRTY) {
                if (this._dirtyComputeds) this._dirtyComputeds.delete(name);
                node.flags &= ~DIRTY;
            }

            if (changed) {
                const computedPath = node.computedPath;
                const newVersion = (this._stateVersions.get(computedPath) || 0) + 1;
                this._stateVersions.set(computedPath, newVersion);
                this._globalEpoch++;
                node.version = newVersion;

                if (this._hasAnyEffects) this._notifyEffectDependents(computedPath);

                if (node.flags & 4 /* HAS_DEPENDENTS */) {
                    const dependentComputeds = this.computedDependencies.get(computedPath);
                    if (dependentComputeds && dependentComputeds.size > 0) {
                        this._markComputedsDirtyTransitively(dependentComputeds);
                    }
                }

                // Skip onStateChange for virtual (headless) stores —
                // lean eval path handles downstream propagation lazily.
                // DOM components always need onStateChange for rendering.
                if (!(this.component && this.component.isVirtual)) {
                    this.onStateChange(computedPath, result, oldValue);
                }
            }

            return result;
        }

        if (!(node && (node.flags & STABLE)) || !hadDeps) {
            this._clearDependenciesForComputation(name);
        }

        if (name.includes('.')) {
            return this._resolveComputedPath(name);
        }

        // Check if the computed property exists
        if (!this.computed[name]) {
            // Only warn once per missing computed to prevent log spam
            if (!this._warnedMissingComputed.has(name)) {
                this._warnedMissingComputed.add(name);
                if (__DEV__) wfWarn(`Computed property "${name}" does not exist`);
            }
            return undefined;
        }

        // CASCADE PREVENTION: Check for circular dependencies immediately (0 iterations)
        if (this._evaluationStack.includes(name)) {
            const cycle = [...this._evaluationStack, name];

            // CRITICAL: Mark as circular BEFORE throwing error
            // This ensures it's marked even if user code catches the error
            if (!this._circularDependencies) {
                this._circularDependencies = new Set();
            }
            this._circularDependencies.add(name);

            // Cache the error object to prevent re-evaluation
            this.computedCache.set(name, { __circularDependencyError: true, chain: cycle });

            wfError(WF_ERRORS.CIRCULAR_DEPENDENCY, {
                context: cycle.join(' → '),
                suggestion: 'Refactor computed properties to break the circular chain'
            });

            const error = new Error(`Circular dependency detected: ${cycle.join(' → ')}`);
            error.name = 'CircularDependencyError';
            error.isCircularDependency = true;
            error.dependencyChain = cycle;
            throw error;
        }

        // Add to evaluation stack
        this._evaluationStack.push(name);

        // Set active computation to track dependencies
        const previousComputation = this.activeComputation;
        this.activeComputation = name;

        try {
            // Set flag to prevent external() from triggering renders during computed evaluation
            if (this._wf) {
                this._wf._isEvaluatingComputed = true;
                // Set tracking context for automatic store dependency registration
                // PRESERVE listElement from existing context (set by list rendering code)
                // This allows external() calls to associate list elements with pending store dependencies
                const existingListElement = this._wf._computedTrackingContext?.listElement;
                // V8 OPT: Canonical shape — all fields always present
                this._wf._computedTrackingContext = {
                    componentId: this.component?.id || null,
                    computedName: name,
                    stateManager: this,
                    listElement: existingListElement || null,
                    isItemLevelComputed: false,
                    itemIndex: -1
                };
            }

            // Evaluate the computed property
            const result = this.computed[name]();

            // CRITICAL: Check if circular dependency was detected during evaluation
            // If the property was marked as circular while evaluating (e.g., user's try-catch caught our error),
            // we should NOT call onStateChange or update cache, as that triggers infinite loops
            if (this._circularDependencies && this._circularDependencies.has(name)) {
                // Circular dependency was detected during evaluation, return undefined and skip state change
                return undefined;
            }

            // Refresh captured epochs on the computed's external sources
            // so the cache-hit fast path in evaluateComputed correctly
            // compares against current upstream state. Populated lazily
            // during the first full eval by EntitySystem's tracking proxy.
            const freshNode = this._computedNodes && this._computedNodes.get(name);
            if (freshNode && freshNode.externalSources) {
                const srcs = freshNode.externalSources;
                for (let i = 0; i < srcs.length; i++) {
                    srcs[i].epoch = srcs[i].rsm._globalEpoch || 0;
                }
            }

            const oldResult = this._lastEvalResult ? this._lastEvalResult.get(name) : undefined;
            if (!this._lastEvalResult) {
                this._lastEvalResult = new Map();
            }

            // Change detection + cache update + cascade notification.
            //
            // CASCADE PREVENTION: If we're inside a nested evaluation (the
            // evaluation stack has entries), defer the state change notification
            // to avoid re-entrant evaluation of dependent computeds while we're
            // still mid-evaluation of an outer computed. Deferred changes are
            // processed in the finally block when the stack unwinds to empty.
            // PERF: Fast path for primitives — skip isEqual (which allocates
            // a WeakMap for its `seen` parameter) when both values are non-object.
            // This matches the optimization already present in _updateNode.
            const resultType = typeof result;
            const changed = (resultType === 'object' && result !== null)
                ? (oldResult !== result && !objectUtils.isEqual(oldResult, result))
                : oldResult !== result;
            if (changed) {
                this._lastEvalResult.set(name, result);
                this.computedCache.set(name, result);

                this._saveDepVersions(name);

                if (this._evaluationStack && this._evaluationStack.length > 0) {
                    if (!this._deferredStateChanges) this._deferredStateChanges = [];
                    this._deferredStateChanges.push({ path: `computed:${name}`, newValue: result, oldValue: oldResult });
                } else {
                    // Use _handleStateChange to properly cascade to dependent computed properties
                    // This ensures computed-to-computed chains work (e.g., formalGreeting -> greeting)
                    this._handleStateChange(`computed:${name}`, result, oldResult);
                }
            } else {
                this._lastEvalResult.set(name, result);
                this.computedCache.set(name, result);

                // LAZY PROPAGATION: Save dependency versions after successful evaluation
                this._saveDepVersions(name);
            }

            // ── STABILITY PROMOTION ──────────────────────────────────────
            // If the dependency count matches the previous evaluation, the
            // computed's dep set is likely static. Promote to "stable" and
            // populate the ComputedNode for future fast-path evaluation.
            //
            // This is the TRANSITION POINT between the full path and the
            // node fast path. After this block executes, subsequent reads
            // of this computed will use the node fast path (~5 ops) instead
            // of the full path (~12+ ops).
            //
            // We use dep COUNT as a heuristic rather than full Set equality
            // because it's O(1) vs O(n). False positives (same count but
            // different deps) are rare and self-correcting — the stale check
            // will catch the mismatch and the computed will be re-evaluated.
            // ────────────────────────────────────────────────────────────
            const newDeps = this._computedDependsOn.get(name);
            const newDepCount = newDeps ? newDeps.size : 0;
            if (hadDeps && newDepCount === previousDepCount && !(node && (node.flags & DYNAMIC))) {
                // Populate the ComputedNode with parallel arrays for fast-path use
                // (node already looked up at function entry)
                // Skip if DYNAMIC — node was previously demoted due to dep identity change
                if (node && newDeps) {
                    node.flags |= STABLE;

                    // If function has no conditional constructs (checked at
                    // registration from the unbound fn), deps are deterministic —
                    // mark STATIC to bypass proxy entirely during _updateNode.
                    if (node._hasConditionals === false) {
                        node.flags |= STATIC;
                    }

                    node.deps = Array.from(newDeps);
                    node.depVersions = new Array(node.deps.length);
                    node.depNodes = new Array(node.deps.length);

                    for (let i = 0; i < node.deps.length; i++) {
                        const dep = node.deps[i];
                        if (dep.charCodeAt(0) === 99 && dep.startsWith('computed:')) {
                            node.depNodes[i] = (this._computedNodes && this._computedNodes.get(dep.slice(9))) || null;
                        } else {
                            node.depNodes[i] = null;
                        }
                        node.depVersions[i] = this._stateVersions.get(dep) || 0;
                    }

                    node.value = this.computedCache.get(name);
                    node.lastResult = this._lastEvalResult ? this._lastEvalResult.get(name) : undefined;
                    node.version = this._stateVersions.get(`computed:${name}`) || 0;
                    node.lastEpoch = this._globalEpoch;
                    node.cacheGen = this._cacheGeneration;

                    // Clean up now-redundant Map entries — the node-array fast path
                    // reads node.deps/depVersions directly, so these will never be read again
                    if (this._computedDepVersions) this._computedDepVersions.delete(name);
                    if (this._computedDepsArray) this._computedDepsArray.delete(name);

                    // Signal promotion for stable computeds is handled below
                    // (outside the dep-count check) for external-dep computeds.
                }
            }

            // Track eval count for cross-entity lean evaluation path.
            // After the first full eval (which establishes entity deps and
            // tracking), subsequent evals can use the lean path.
            if (node && this._computedsWithExternalDeps &&
                this._computedsWithExternalDeps.has(name)) {
                node._externalEvalCount = (node._externalEvalCount || 0) + 1;
            }

            // PERF: Clear dirty flag after successful evaluation (Vue-style)
            if (this._dirtyComputeds) {
                this._dirtyComputeds.delete(name);
            }
            // Keep node DIRTY flag in sync with _dirtyComputeds
            {
                const _n = this._computedNodes && this._computedNodes.get(name);
                if (_n) _n.flags &= ~DIRTY;
            }

            return result;
        } catch (error) {
            // Handle circular dependency errors specifically
            // Note: These should already be marked in the detection phase above,
            // but this catch block serves as a safety net
            if (error.isCircularDependency || error.name === 'CircularDependencyError') {
                // Already marked and logged in detection phase, just return undefined
                return undefined;
            }

            // TC39 SIGNALS PATTERN: ERRORED sentinel for caching computed errors
            // Cache the error state so we don't re-evaluate on every read
            // The error will be cleared when dependencies change (stale check passes)
            const previousCached = this.computedCache.get(name);
            this.computedCache.set(name, {
                [ERRORED_SYMBOL]: true,
                error: error,
                epoch: this._globalEpoch,
                timestamp: Date.now()
            });
            // Save dependency versions so we can detect when dependencies change
            this._saveDepVersions(name);

            // Notify the component so DOM updates from the previous value to undefined
            // This prevents stale values from persisting in the DOM after an error
            if (previousCached && previousCached[ERRORED_SYMBOL] !== true) {
                this.onStateChange(`computed:${name}`, undefined, previousCached);
            }

            wfError(WF_ERRORS.COMPUTED_EVAL_ERROR, { context: name, cause: error });
            return undefined;
        } finally {
            // Clear the computed evaluation flag and tracking context
            if (this._wf) {
                this._wf._isEvaluatingComputed = false;
                this._wf._computedTrackingContext = null;
            }

            // Restore previous computation
            this.activeComputation = previousComputation;

            // CASCADE PREVENTION: Remove from evaluation stack
            this._evaluationStack.pop();

            // CASCADE PREVENTION: Process deferred state changes when evaluation stack is empty
            if (this._evaluationStack.length === 0 && this._deferredStateChanges && this._deferredStateChanges.length > 0) {
                const deferred = this._deferredStateChanges;
                this._deferredStateChanges = []; // Clear before processing to prevent re-entrancy

                // Process each deferred state change using _handleStateChange for proper cascade
                for (let i = 0; i < deferred.length; i++) {
                    const change = deferred[i];
                    this._handleStateChange(change.path, change.newValue, change.oldValue);
                }
            }
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // SECTION 6: UTILITY METHODS
    // Public helpers for inspecting computed state (circular deps, SSR).
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Check if a computed property evaluation resulted in a circular dependency error.
     * @param {string} name - Computed property name
     * @returns {boolean} True if circular dependency was detected
     */
    isCircularDependency(name) {
        // Check the _circularDependencies Set (primary)
        if (this._circularDependencies && this._circularDependencies.has(name)) {
            return true;
        }
        // Also check cache for backwards compatibility
        const cached = this.computedCache.get(name);
        return cached && typeof cached === 'object' && cached.__circularDependencyError === true;
    },

    /**
     * Set computed property value directly (for SSR hydration)
     * @param {string} name - Computed property name
     * @param {*} value - Preserved value from SSR
     */
    setComputedValue(name, value) {
        // Set the cached value directly
        this.computedCache.set(name, value);

        // Update the last evaluation result
        if (!this._lastEvalResult) {
            this._lastEvalResult = new Map();
        }
        this._lastEvalResult.set(name, value);

        // Mark as SSR-hydrated to prevent unnecessary re-evaluation
        if (__FEATURE_SSR__) {
            if (!this._ssrHydratedComputed) {
                this._ssrHydratedComputed = new Set();
            }
            this._ssrHydratedComputed.add(name);
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // SECTION 7: _updateComputedProperties — EAGER UPDATE
    //
    // Called by _handleStateChange (in ReactiveStateManager.js) after a
    // state path changes. With the lazy evaluation model, this is mostly
    // a no-op — computed re-evaluation is deferred to read time. The only
    // remaining responsibilities are:
    //   1. External (cross-component) dependencies — need eager notification
    //      because the dirty flag model only works within one stateManager
    //   2. Restoring computed definitions if they were somehow cleared
    //   3. Enqueueing direct dependents for evaluation (for watchers/DOM)
    //
    // This method predates the dirty-flag model and may be a candidate for
    // further simplification in the future.
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Handle state path change — mostly deferred to lazy evaluation.
     * @param {string} path - The state path that changed
     * @private
     */
    _updateComputedProperties(path) {
        if (this._pendingComputedUpdates === undefined) {
            this._pendingComputedUpdates = new Map();
            this._pendingComputedTimer = null;
        }

        // Handle external data changes - these need to notify other components
        if (path.includes('external:')) {
            // External paths require cross-component notification
            // The other component's watchers need to know about the change
            const deps = this.computedDependencies.get(path);
            if (deps) {
                for (const name of deps) {
                    if (this.computed[name]) {
                        this._enqueueComputedEvaluation(name);
                    }
                }
            }

            if (this._patternTrie) {
                const matchingPatterns = this._patternTrie.match(path);
                if (matchingPatterns && matchingPatterns.size > 0) {
                    for (const name of matchingPatterns) {
                        if (this.computed[name]) {
                            this._enqueueComputedEvaluation(name);
                        }
                    }
                }
            }
            return;
        }

        // Handle computed-to-computed dependencies
        // LAZY PROPAGATION: Computed-to-computed chains are handled lazily.
        // When a computed changes, its version is incremented. Dependents will detect
        // staleness via _isComputedStale when they are read.
        if (path.startsWith('computed:')) {
            // Version was already incremented by _handleStateChange
            // Dependents will detect staleness when read via evaluateComputed's stale check
            return;
        }

        // LAZY PROPAGATION: Enqueue ONLY direct dependents for evaluation.
        // This is needed for watchers and DOM bindings on computed properties.
        // Indirect dependents (computed-to-computed) are handled lazily via stale checking.
        //
        // Key optimization: We no longer CASCADE through all transitive dependents.
        // The cascade is handled lazily when computed properties are read.
        const directDeps = this.computedDependencies.get(path);
        if (directDeps) {
            for (const name of directDeps) {
                if (this.computed[name]) {
                    this._enqueueComputedEvaluation(name);
                }
            }
        }

    },


    // ═════════════════════════════════════════════════════════════════════
    // SECTION 8: DEPENDENCY TRACKING
    //
    // When a computed function executes (e.g., `fullName() { return
    // this.state.first + ' ' + this.state.last }`), every `this.state.X`
    // access triggers the proxy get trap, which calls _trackDependency(X).
    // This builds the dependency graph that enables invalidation.
    //
    // Two parallel data structures are maintained:
    //
    //   computedDependencies (forward): 'firstName' → {'fullName'}
    //     Used by dirty propagation to find which computeds to mark dirty
    //     when 'firstName' changes.
    //
    //   _computedDependsOn (reverse): 'fullName' → {'firstName', 'lastName'}
    //     Used by staleness checking, dep version saving, and O(deps) cleanup
    //     when re-tracking deps (removes computed from each path's forward index).
    //
    // Additionally, array access patterns (e.g., items.0.name) generate
    // wildcard patterns (items.*.name) stored in a pattern trie for
    // efficient matching when any array item's property changes.
    //
    // The HAS_DEPENDENTS flag on ComputedNode is also set here: when
    // computed B depends on computed A, _addDependency('computed:A', 'B')
    // sets A.flags |= HAS_DEPENDENTS, allowing _updateNode to skip
    // unnecessary downstream checks for leaf computeds.
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Track a dependency for the currently-executing computed property.
     * Called from proxy get trap and computed-to-computed access.
     * @param {string} path - The state or computed path (e.g., 'firstName', 'computed:greeting')
     * @private
     */
    _trackDependency(path) {
        // Skip if no active computation
        if (!this.activeComputation) return;

        // PERF: Fast path for already-tracked dependencies in this evaluation cycle
        // computedDependencies is cleared before re-evaluation, so if the dependency
        // is already there, we've already tracked it during THIS evaluation.
        const existingDeps = this.computedDependencies.get(path);
        if (existingDeps && existingDeps.has(this.activeComputation)) {
            // Already tracked this cycle - skip all the expensive work
            return;
        }

        // PERF: Fast path for simple property names (no dots, no 'computed:' prefix)
        // This covers the common case: this.state.source, this.state.count, etc.
        if (!path.includes('.') && !path.startsWith('computed:')) {
            this._addDependency(path, this.activeComputation);
            return;
        }

        if (path.startsWith('computed:')) {
            const computedPath = path.slice(9);
            if (computedPath.includes('.')) {
                // Track dependency on the base computed property
                const baseName = computedPath.split('.')[0];
                const basePath = `computed:${baseName}`;

                // Track the base computed property
                this._addDependency(basePath, this.activeComputation);

                // Continue with original tracking for the full path
            }
        }


        // Detect array access pattern early
        const arrayIndexMatch = this._regex.arrayItemFull.exec(path);

        if (arrayIndexMatch) {
            const arrayName = arrayIndexMatch[1];          // e.g. "items"
            const propName = arrayIndexMatch[4] || null;   // e.g. "value" or null for items.0
            const arrayPath = arrayName;                   // e.g. "items"

            // 1. Always record the direct dependency (needed for correctness)
            this._addDependency(path, this.activeComputation);

            // 2. Record pattern dependencies (only if property access)
            if (propName) {
                // Create key for checking if we've already registered this pattern
                const patternKey = `${this.activeComputation}:${arrayName}.*.${propName}`;

                // Initialize pattern tracking set if needed
                if (!this._patternTracking) {
                    this._patternTracking = new Set();
                }

                // Only add pattern if we haven't already for this computation (major optimization)
                if (!this._patternTracking.has(patternKey)) {
                    this._patternTracking.add(patternKey);

                    // Add wildcard patterns
                    const patternPath = `${arrayName}.*.${propName}`;
                    this._patternTrie.add(patternPath, this.activeComputation);

                    // Add to regular dependencies too
                    this._addDependency(patternPath, this.activeComputation);
                }
            }

            // 3. Record array path dependency (once per computation)
            this._addDependency(arrayPath, this.activeComputation);

            // Skip the rest of the method - we've handled array path completely
            return;
        }

        // Check for nested array patterns
        if (path.includes('.') && this._regex.hasNestedArrayIndex.test(path)) {
            // Extract all array paths with a more general approach
            const segments = path.split('.');
            let currentPath = '';

            for (let i = 0; i < segments.length - 1; i++) {
                const segment = segments[i];
                currentPath = currentPath ? `${currentPath}.${segment}` : segment;

                // Check if this is a numeric index followed by more path segments
                if (this._regex.isNumeric.test(segment) && i > 0 && i < segments.length - 1) {
                    // We found a nested array index
                    const arrayPath = segments.slice(0, i).join('.'); // Path to the array
                    const restPath = segments.slice(i + 1).join('.'); // Path after the index

                    // Only create pattern if it contains a property access
                    if (restPath.includes('.')) {
                        // Create pattern key for tracking
                        const patternKey = `${this.activeComputation}:${arrayPath}.*.${restPath}`;

                        // Initialize pattern tracking set if needed
                        if (!this._patternTracking) {
                            this._patternTracking = new Set();
                        }

                        // Only register this pattern once per computation
                        if (!this._patternTracking.has(patternKey)) {
                            this._patternTracking.add(patternKey);

                            // Create and register the pattern
                            const patternPath = `${arrayPath}.*.${restPath}`;
                            this._patternTrie.add(patternPath, this.activeComputation);

                            // Add to regular dependencies too
                            this._addDependency(patternPath, this.activeComputation);
                        }
                    }
                }
            }
        }

        // NORMAL PATH HANDLING (non-array paths continue with original logic)

        // Direct path tracking
        this._addDependency(path, this.activeComputation);

        // Pattern matching for non-array-index paths that might still have patterns
        if (path.includes('.') && this._regex.hasArrayIndex.test(path)) {

            const match = this._regex.nestedArrayProperty.exec(path);

            if (match) {
                // Continue with pattern generation...
                const patterns = this._expandPathPatterns(path);

                patterns.forEach(pattern => {
                    if (pattern !== path) {
                        this._patternTrie.add(pattern, this.activeComputation);
                    }
                });
            }
        }

        // Parent path tracking
        const pathParts = path.split('.');
        if (pathParts.length > 1) {
            // Track parent path
            let parentPath = pathParts[0];
            this._addDependency(parentPath, this.activeComputation);
        }

    },

    /**
     * Clone an object using the configured strategy
     * Shallow clone is much faster for flat state objects
     * @param {*} obj - Object to clone
     * @returns {*} Cloned object
     */
    _clone(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        return objectUtils.deepClone(obj);
    },

    /**
     * Register a dependency edge: computed `compName` depends on `path`.
     *
     * Updates both dependency tracking structures:
     *   1. computedDependencies (forward): path → {compName, ...}
     *   2. _computedDependsOn (reverse): compName → {path, ...}
     *
     * Also sets HAS_DEPENDENTS flag when the path is a computed path,
     * enabling the node fast path to skip downstream checks for leaf computeds.
     *
     * @param {string} path - The dependency path (e.g., 'firstName', 'computed:greeting')
     * @param {string} compName - The dependent computed name (e.g., 'fullName')
     */
    _addDependency(path, compName) {
        // Forward index: path → Set of computations
        // PERF: Get once, reuse
        let fwdSet = this.computedDependencies.get(path);
        if (!fwdSet) {
            fwdSet = new Set();
            this.computedDependencies.set(path, fwdSet);
        }
        // PERF: Set.add is a no-op if already present, but we can skip the call
        if (!fwdSet.has(compName)) {
            fwdSet.add(compName);

            // PERF: Mark the upstream computed as having dependents.
            // This allows _updateNode to skip _notifyEffectDependents and
            // computedDependencies.get lookups for leaf computeds (no deps downstream).
            if (path.charCodeAt(0) === 99 && path.startsWith('computed:')) {
                const depNode = this._computedNodes && this._computedNodes.get(path.slice(9));
                if (depNode) depNode.flags |= HAS_DEPENDENTS;
            }
        }

        // Reverse index: computation → Set of paths
        // Used for both cleanup (_clearDependenciesForComputation) and stale checking
        let depsOn = this._computedDependsOn.get(compName);
        if (!depsOn) {
            depsOn = new Set();
            this._computedDependsOn.set(compName, depsOn);
        }
        if (!depsOn.has(path)) {
            depsOn.add(path);
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // SECTION 9: DEPENDENCY CLEANUP
    // Called before re-tracking deps for unstable computeds.
    // Uses the reverse index (_computedDependsOn) to efficiently remove
    // the computed from every path's forward index entry.
    // ═════════════════════════════════════════════════════════════════════

    _clearDependenciesForComputation(compName) {
        // Use reverse index for O(deps) lookup (not O(all paths))
        const paths = this._computedDependsOn.get(compName);
        if (!paths) return;

        // Clear from computedDependencies (forward index) using known paths
        for (const path of paths) {
            const deps = this.computedDependencies.get(path);
            if (deps) {
                deps.delete(compName);
                if (deps.size === 0) {
                    this.computedDependencies.delete(path);
                }
            }
        }

        // Clear the reverse index entry for fresh tracking
        this._computedDependsOn.delete(compName);
    },

    // ═════════════════════════════════════════════════════════════════════
    // SECTION 10: MAP-BASED STALE CHECKING
    //
    // _isComputedStale is the Map-based staleness check used by the FULL
    // PATH in evaluateComputed (for non-stable computeds). The node fast
    // path has its own INLINE stale check using parallel arrays on the
    // ComputedNode, which is faster but only works for stable computeds.
    //
    // This method is still needed for:
    //   - Computeds not yet promoted to stable (first 1-2 evaluations)
    //   - Unstable computeds (conditional/dynamic deps)
    //   - Direct calls from tests (e.g., rsm._isComputedStale('sum'))
    //   - ERRORED sentinel staleness check (to decide when to retry)
    //
    // _saveDepVersions snapshots dependency versions after evaluation
    // into _computedDepVersions (a Map<name, Map<path, version>>). This
    // is the Map-based equivalent of the node's depVersions parallel array.
    //
    // IMPORTANT: See file header "KEY REENTRANCY HAZARD" for why
    // _staleCheckDepth exists and why _updateNode must respect it.
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Check if a computed property is stale and needs re-evaluation.
     *
     * Check order (early exit at each stage):
     *   1. Dirty flag check — O(1), catches most cases after state change
     *   2. External deps check — always stale (can't track cross-component)
     *   3. Epoch short-circuit — nothing changed globally since last check
     *   4. Stable computed version check — compare dep versions via arrays
     *   5. Full version check — compare dep versions via Map iteration
     *
     * @param {string} name - The computed property name
     * @param {Set} [visited] - Cycle detection set (created lazily if needed)
     * @returns {boolean} True if the computed needs re-evaluation
     * @private
     */
    _isComputedStale(name, visited) {
        // CYCLE DETECTION: If already visited, return false to prevent infinite recursion
        if (visited && visited.has(name)) {
            return false;
        }

        // PERF: Check dirty flag first (Vue-style push model) - O(1)
        // With transitive dirty propagation, this should catch most cases
        if (this._dirtyComputeds && this._dirtyComputeds.has(name)) {
            return true;
        }

        // CROSS-COMPONENT REACTIVITY: Computeds with external dependencies must always
        // re-evaluate because the dirty flag mechanism only works within a single stateManager.
        if (this._computedsWithExternalDeps && this._computedsWithExternalDeps.has(name)) {
            return true;
        }

        // Hoist node lookup — used by epoch short-circuit, stable fast path, and fallback
        const node = this._computedNodes && this._computedNodes.get(name);

        // EPOCH SHORT-CIRCUIT: If nothing changed globally since last check, not stale
        // node.lastEpoch starts at -1 (never verified), so uninitialized nodes skip this correctly
        if (node && node.lastEpoch === this._globalEpoch) {
            return false;  // O(1) fast path
        }

        // PERF: For stable computeds, if not marked dirty and epoch changed,
        // it means a DIFFERENT state path changed. Check if our deps changed.
        if (node && (node.flags & STABLE)) {
            // NODE-ARRAY FAST PATH: Use node's parallel arrays directly.
            // Guard: require lastEpoch >= 0 to confirm node has been through
            // _updateNode at least once (handles artificial test teardown
            // in lazy-propagation.test.js "no tracked dependencies")
            if (node && node.deps && node.lastEpoch >= 0) {
                this._staleCheckDepth++;
                const ndeps = node.deps;
                const ndv = node.depVersions;
                const ndn = node.depNodes;
                for (let i = 0; i < ndeps.length; i++) {
                    const dep = ndeps[i];
                    if (dep.charCodeAt(0) === 99 && dep.startsWith('computed:')) {
                        const depName = dep.slice(9);
                        this.evaluateComputed(depName);
                        const currentV = ndn[i] ? ndn[i].version : (this._stateVersions.get(dep) || 0);
                        if (currentV !== ndv[i]) {
                            this._staleCheckDepth--;
                            return true;
                        }
                    } else {
                        if ((this._stateVersions.get(dep) || 0) !== ndv[i]) {
                            this._staleCheckDepth--;
                            return true;
                        }
                    }
                }
                node.lastEpoch = this._globalEpoch;
                this._staleCheckDepth--;
                return false;
            }

            // FALLBACK: existing _computedDepVersions path for computeds
            // not yet promoted to stable node (first eval, or missing epoch entry)
            this._staleCheckDepth++;
            const savedVersions = this._computedDepVersions.get(name);
            if (savedVersions) {
                // PERF: Use cached array (avoids Set iterator allocation — 8% in Firefox profiling)
                const depsArray = this._computedDepsArray && this._computedDepsArray.get(name);
                if (depsArray) {
                    for (let i = 0; i < depsArray.length; i++) {
                        const dep = depsArray[i];
                        if (dep.charCodeAt(0) === 99 && dep.startsWith('computed:')) {
                            // AVOIDABLE PROPAGATION: Instead of returning stale immediately,
                            // re-evaluate the computed dep and check if its value actually changed.
                            // This avoids re-evaluating dependents when the dep returns the same value.
                            const depName = dep.slice(9);
                            this.evaluateComputed(depName);
                            if ((this._stateVersions.get(dep) || 0) !== (savedVersions.get(dep) || 0)) {
                                this._staleCheckDepth--;
                                return true;
                            }
                        } else {
                            const currentVersion = this._stateVersions.get(dep) || 0;
                            const savedVersion = savedVersions.get(dep);
                            if (savedVersion === undefined || currentVersion !== savedVersion) {
                                this._staleCheckDepth--;
                                return true;
                            }
                        }
                    }
                    if (node) node.lastEpoch = this._globalEpoch;
                    this._staleCheckDepth--;
                    return false;
                }

                // Fallback: Set iteration for computeds not yet cached
                const deps = this._computedDependsOn.get(name);
                if (deps) {
                    for (const dep of deps) {
                        if (dep.charCodeAt(0) === 99 && dep.startsWith('computed:')) {
                            // AVOIDABLE PROPAGATION: Re-evaluate dep, check if value changed
                            const depName = dep.slice(9);
                            this.evaluateComputed(depName);
                            if ((this._stateVersions.get(dep) || 0) !== (savedVersions.get(dep) || 0)) {
                                this._staleCheckDepth--;
                                return true;
                            }
                        } else {
                            const currentVersion = this._stateVersions.get(dep) || 0;
                            const savedVersion = savedVersions.get(dep);
                            if (savedVersion === undefined || currentVersion !== savedVersion) {
                                this._staleCheckDepth--;
                                return true;
                            }
                        }
                    }
                    if (node) node.lastEpoch = this._globalEpoch;
                    this._staleCheckDepth--;
                    return false;
                }
            }
            this._staleCheckDepth--;
        }

        // Get dependencies for this computed
        const deps = this._computedDependsOn.get(name);
        if (!deps || deps.size === 0) {
            // No tracked dependencies - consider stale (will re-evaluate and track fresh)
            return true;
        }

        // Get saved versions from last evaluation
        const savedVersions = this._computedDepVersions.get(name);
        if (!savedVersions) {
            // Never evaluated with version tracking - consider stale
            return true;
        }

        // Check each dependency
        for (const dep of deps) {
            // PERF: Check first char to avoid startsWith overhead
            if (dep.charCodeAt(0) === 99 && dep.startsWith('computed:')) { // 'c' = 99
                // AVOIDABLE PROPAGATION: Re-evaluate the computed dep and check
                // if its value actually changed (version bump).
                const depName = dep.slice(9);  // Remove 'computed:' prefix
                this.evaluateComputed(depName);
                if ((this._stateVersions.get(dep) || 0) !== (savedVersions.get(dep) || 0)) {
                    return true;
                }
            } else {
                // Dependency on state path
                const currentVersion = this._stateVersions.get(dep) || 0;
                const savedVersion = savedVersions.get(dep);

                if (savedVersion === undefined || currentVersion !== savedVersion) {
                    return true;
                }
            }
        }

        // All dependencies unchanged - not stale
        // Update last epoch for future short-circuit
        if (node) node.lastEpoch = this._globalEpoch;
        return false;
    },

    /**
     * Snapshot current dependency versions after a successful evaluation.
     * Creates a new Map<path, version> for use by _isComputedStale.
     *
     * Note: The node fast path (_updateNode) does NOT call this method —
     * it updates dep versions in-place on the parallel arrays instead,
     * avoiding the Map allocation. This method is only for the full path.
     *
     * @param {string} name - The computed property name
     * @private
     */
    _saveDepVersions(name) {
        const deps = this._computedDependsOn.get(name);
        if (!deps || deps.size === 0) {
            return;
        }

        // PERF: Reuse existing Map to avoid allocation on every evaluation.
        // Clear and refill instead of creating new Map() each time.
        let versions = this._computedDepVersions.get(name);
        if (versions) {
            versions.clear();
        } else {
            versions = new Map();
            this._computedDepVersions.set(name, versions);
        }
        for (const dep of deps) {
            versions.set(dep, this._stateVersions.get(dep) || 0);
        }
        const node = this._computedNodes && this._computedNodes.get(name);
        if (node) node.lastEpoch = this._globalEpoch;
    },


    // ═════════════════════════════════════════════════════════════════════
    // SECTION 11: PATTERN EXPANSION
    // Generates wildcard patterns from concrete array paths for dependency
    // matching. E.g., 'items.0.name' → ['items.0.name', 'items.*.name']
    // Results are cached in _patternCache for reuse.
    // ═════════════════════════════════════════════════════════════════════

    _expandPathPatterns(path) {
        if (!path || typeof path !== 'string' || !path.includes('.')) return [path];

        // Fast exit: no numeric segments means no array indices to wildcard
        if (!this._regex.hasNestedArrayIndex.test(path)) return [path];

        const cached = this._patternCache.get(path);
        if (cached !== undefined) {
            return cached;
        }

        const patterns = new Set([path]);
        const parts = path.split('.');

        // Generate patterns by replacing indices with wildcards
        for (let i = 0; i < parts.length; i++) {
            // Skip if this part isn't a number (potential array index)
            if (!this._regex.isNumeric.test(parts[i])) continue;

            // Create a pattern with this index replaced by wildcard
            const patternParts = [...parts];
            patternParts[i] = '*';
            patterns.add(patternParts.join('.'));

            // Create additional patterns for parent paths
            if (i > 0) {
                const parentPattern = patternParts.slice(0, i+1).join('.');
                patterns.add(parentPattern);
            }
        }

        const result = Array.from(patterns);
        // Cache the result with LRU eviction
        this._patternCache.set(path, result);

        return result;
    },


    /**
     * Get RSMs for all stores this entity subscribes to.
     * Used by the cross-entity lean eval path to snapshot source store epochs.
     * Cached on first call — subscribe declarations are static.
     * @returns {Array<ReactiveStateManager>}
     * @private
     */
    _getSubscribedStoreRSMs()
    {
        if (this._subscribedStoreRSMsCache) return this._subscribedStoreRSMsCache;

        const rsms = [];
        const wf = this._wf;
        if (wf && wf.storeManager) {
            const instance = wf.componentInstances.get(this.component?.id);
            const subscribedStores = instance?._subscribedStores;
            if (subscribedStores) {
                for (const storeName of subscribedStores) {
                    const store = wf.storeManager.getStoreComponentByName(storeName) ||
                                  wf.storeManager.getStoreComponentByName(`store-${storeName}`);
                    if (store && store.stateManager) {
                        rsms.push(store.stateManager);
                    }
                }
            }
        }
        // Also include own RSM (for computeds that mix local + external state)
        rsms.push(this);
        this._subscribedStoreRSMsCache = rsms;
        return rsms;
    },

};
