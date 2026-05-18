/**
 * ReactiveStateManager
 *
 * Deep reactive proxy system with automatic nested mutation tracking,
 * computed properties, effect scheduling, and batch update support.
 */

// Import dependencies from wfUtils
import { LRUCache, pathResolver, objectUtils, wfError, wfWarn, WF_ERRORS } from '../core/wfUtils.js';
import { RSM_SYMBOL, PATH_SYMBOL, ARRAY_PATH_SYMBOL } from './RSMConstants.js';
import { ProxyHandlerMethods } from './ProxyHandlers.js';
import { ArrayOperationMethods } from './ArrayOperationDetection.js';
import { ComputedPropertyMethods, DIRTY, HAS_DEPENDENTS } from './ComputedPropertyManager.js';

// Shared regex patterns - created once, reused by all RSM instances
const RSM_REGEX = {
    // Matches array item paths like "items.0" or "items.0.name"
    arrayItemPath: /^(.+?)\.(\d+)(?:\.|$)/,
    // Matches full array item pattern with capture groups
    arrayItemFull: /^([^.]+)\.(\d+)(\.([^.]+))?$/,
    // Matches array item pattern for state changes
    arrayItemStateChange: /^([\w.]+)\.\d+\.([\w.]+)$/,
    // Matches nested array pattern with property
    nestedArrayProperty: /^([^.]+)\.(\d+)\.(.+)$/,
    // Tests for array index in path (e.g., ".0." or ".0" at end)
    hasArrayIndex: /\.\d+($|\.)/,
    // Tests for nested array index (e.g., ".0.")
    hasNestedArrayIndex: /\.\d+\./,
    // Tests if string is purely numeric (array index)
    isNumeric: /^\d+$/,
};

// ===================================================================
// EFFECT SCHEDULER
// Global scheduler that batches effect execution into microtasks.
// Effects are queued when dependencies change, then flushed together.
// ===================================================================

// Global active effect - tracks which effect is currently running
// for automatic dependency registration across all RSM instances
let activeEffect = null;

/**
 * EffectScheduler - Manages batched effect execution
 *
 * Effects are queued when their dependencies change, then flushed
 * together in a single microtask. This coalesces multiple state
 * changes into a single effect execution.
 */
class EffectScheduler {
    constructor() {
        this._queue = [];           // Ordered queue of effects to run
        this._queued = new Set();   // O(1) deduplication check
        this._scheduled = false;    // Whether flush is scheduled
        this._flushCount = 0;       // Consecutive flush calls (reset when queue drains naturally)
    }

    /**
     * Queue an effect for execution
     * @param {Object} effect - The effect object to queue
     */
    queue(effect) {
        // Skip if already queued (deduplication)
        if (this._queued.has(effect)) return;

        this._queued.add(effect);
        this._queue.push(effect);

        // Schedule flush if not already scheduled
        if (!this._scheduled) {
            this._scheduled = true;
            queueMicrotask(() => this.flush());
        }
    }

    /**
     * Flush all queued effects
     * Runs each dirty, non-disposed effect
     *
     * IMPORTANT: Drains the queue completely before returning.
     * If effects queued during flush add more effects, they're processed
     * in the same microtask instead of scheduling a new one.
     */
    flush() {
        // Track consecutive flushes to detect cross-microtask infinite loops.
        // Each flush() call is a separate microtask; a self-triggering effect
        // schedules a new microtask per iteration, so the per-call while loop
        // only runs 1 iteration. The persistent counter catches this.
        if (++this._flushCount > 100) {
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
                console.warn('[WF] EffectScheduler: exceeded 100 consecutive flushes — possible infinite loop from an effect writing to its own dependency. Remaining effects discarded.');
            }
            this._queue.length = 0;
            this._queued.clear();
            this._scheduled = false;
            this._flushCount = 0;
            return;
        }

        // Keep draining until queue is empty
        // This prevents multiple microtask flushes when effects trigger other effects
        let loopCount = 0;
        while (this._queue.length > 0) {
            loopCount++;
            if (loopCount > 100) {
                if (typeof __DEV__ !== 'undefined' && __DEV__) {
                    console.warn('[WF] EffectScheduler: flush exceeded 100 iterations — possible infinite loop from an effect writing to its own dependency. Remaining effects discarded.');
                }
                this._queue.length = 0;
                this._queued.clear();
                break;
            }

            // Capture current queue and reset for new additions
            const queue = this._queue;
            this._queue = [];
            this._queued.clear();

            // Run each effect
            for (const effect of queue) {
                if (effect.dirty && !effect.disposed) {
                    // Use direct RSM reference (always set in createEffect)
                    const rsm = effect._rsm;
                    if (rsm) {
                        rsm._runEffect(effect);
                    }
                }
            }
        }

        this._scheduled = false;

        // Reset consecutive flush counter AFTER a microtask gap.
        // If another flush is triggered in the very next microtask (self-triggering effect),
        // the counter keeps accumulating. If nothing triggers, it resets.
        queueMicrotask(() => {
            if (!this._scheduled) {
                this._flushCount = 0;
            }
        });
    }

    /**
     * Remove an effect from the queue (if present)
     * @param {Object} effect - The effect to remove
     */
    remove(effect) {
        this._queued.delete(effect);
        // No need to splice from _queue — flush() skips disposed effects
    }
}

// Global singleton scheduler
const effectScheduler = new EffectScheduler();

export class ReactiveStateManager {


    /**
     * Initialize the reactive state manager
     * @param {Object} options - Configuration options
     */
    constructor(options = {}) {
        // Core state tracking
        this._state = {};
        this._originalState = {};

        // Callback for state changes
        this.onStateChange = options.onStateChange || ((path, newValue, oldValue) => {});

        // Component reference (if applicable)
        this.component = options.component || null;

        // Framework instance reference — avoids window.wildflower global lookups
        this._wf = options.wf || null;

        // Computed properties management
        this.computed = {};
        this.computedDependencies = new Map();
        this.computedCache = new Map();
        this.activeComputation = null;
        this._computedNodes = new Map();
        this._dirtyComputeds = new Set();

        // Cache generation counter: incremented when computedCache is externally
        // cleared or entries deleted. Node fast path compares node.cacheGen against
        // this to detect external invalidation (~1ns integer compare vs ~30ns Map.has).
        this._cacheGeneration = 0;
        {
            const _proto = Map.prototype;
            const _rsm = this;
            this.computedCache.clear = function() {
                _proto.clear.call(this);
                _rsm._cacheGeneration++;
            };
            this.computedCache.delete = function(key) {
                const r = _proto.delete.call(this, key);
                if (r) _rsm._cacheGeneration++;
                return r;
            };
        }

        // Track which missing computed properties we've already warned about
        // to prevent log spam when the same invalid computed is accessed repeatedly
        this._warnedMissingComputed = new Set();

        // Storage configuration
        this.storageKey = options.storageKey || null;
        this.autoSave = options.autoSave || false;

        // Batch update tracking
        this._updatedPaths = new Set();

        // PERF: Cached microtask batching eligibility — avoids 3 optional-chain
        // property accesses per SET trap call. Only checks conditions that don't
        // change during normal operation (syncMode, component opt-out, global disable).
        // batchMode is checked separately since it changes at runtime.
        this._microtaskBatchingEligible = !(
            options.wf?._syncMode ||
            options.component?.disableMicrotaskBatching ||
            options.wf?._enableMicrotaskBatching === false
        );

        // Computed property evaluation batching
        this._computedEvaluationQueue = [];
        this._computedEvaluationScheduled = false;

        // Add tracking for bulk array operations
        this._bulkArrayUpdates = {
            active: false,
            count: 0,
            lastUpdateTime: 0,
            arrayPaths: new Set(),
            pendingChanges: new Map()
        };


        this._lastEvalResult = new Map();  // Use Map to avoid hidden class transitions on delete

        // Initialize property dependency tracking
        this._objectPropertyDependencies = new Map();
        this._boundProperties = new Set();

        this._patternTrie = new PatternTrie();
        this._patternCache = new LRUCache(500);

        // Microtask batching system for automatic state change batching
        this._microtaskQueue = [];           // Array of queued state changes
        this._microtaskScheduled = false;    // Flag to prevent duplicate scheduling

        this._ssrListsInitialized = __FEATURE_SSR__ ? new Set() : null; //Track which SSR lists have had their first update

        // Cascade prevention: Evaluation stack for immediate cycle detection
        this._evaluationStack = [];

        // Reentrancy guard for _isComputedStale (see KEY REENTRANCY HAZARD in CPM header)
        this._staleCheckDepth = 0;

        // Reference shared regex patterns (avoid per-instance regex creation)
        this._regex = RSM_REGEX;

        // ===================================================================
        // V8 HIDDEN CLASS STABILIZATION
        // Pre-initialize ALL lazily-created properties to prevent hidden class
        // transitions that cause megamorphic property access and deoptimization.
        // These properties were previously created on-demand with patterns like:
        //   if (!this._X) { this._X = new Map(); }
        // ===================================================================

        // Array operation tracking (used by swap/append/clear detection)
        this._arrayOperations = new Map();
        this._collisionLockout = new Set();
        this._arrayIndexMutations = {
            mutations: [],
            lastMutationTime: 0,
            initialArrayLength: 0,
            isSpliceInProgress: false,
            spliceStartIndex: null
        };
        // Batch mode tracking
        this._batchChanges = new Map();
        this._batchArrayUpdates = [];

        // Computed property updates
        this._computedEvaluationSet = new Set();  // O(1) dedup for _computedEvaluationQueue
        this._pendingComputedUpdates = new Map();
        this._pendingComputedTimer = null;
        this._deferredStateChanges = [];
        this._circularDependencies = new Set();
        this._ssrHydratedComputed = __FEATURE_SSR__ ? new Set() : null;

        // ===================================================================
        // LAZY DIRTY PROPAGATION (Version-based reactivity)
        // Instead of eager cascade invalidation, we track versions and check
        // staleness lazily when computed properties are read.
        // See: docs/future/REACTIVITY_PERFORMANCE_PLAN.md
        // ===================================================================

        // Version tracking for state paths - incremented on every write
        this._stateVersions = new Map();

        // Global epoch - incremented on ANY state change (for short-circuit optimization)
        this._globalEpoch = 0;

        // Reverse dependency map: what does each computed depend on?
        // Maps computed name → Set of dependency paths (state paths or 'computed:name')
        this._computedDependsOn = new Map();

        // Lightweight dep tracking for _updateNode (avoids full _addDependency overhead)
        // When non-null, proxy get traps add dep paths here instead of calling _trackDependency
        this._nodeTrackingSet = null;
        this._reusableTrackingSet = null;
        // STATIC computed bypass — when true, proxy get traps skip ALL tracking
        // and return raw values (no proxy wrapping for nested objects)
        this._skipTracking = false;

        // Snapshot of dependency versions at last evaluation
        // Maps computed name → Map of (dependency path → version at last eval)
        this._computedDepVersions = new Map();



        // ===================================================================
        // EFFECT SYSTEM: Effect infrastructure
        // Effects are functions that automatically track dependencies and
        // re-run when dependencies change. This is the foundation for
        // Vue-style pull-based reactivity.
        // See: docs/future/EFFECT_ARCHITECTURE_PLAN.md
        // ===================================================================

        // Maps state paths to Sets of dependent effects
        // When a state path changes, these effects are marked dirty
        this._effectDependents = new Map();

        // Maps array paths to their mapArray currentItems arrays.
        // Used by _handleArrayLengthChange for per-item effect dep reindex.
        this._mapArrayItems = new Map();

        // PatternTrie for Effect pattern dependencies (e.g., "items.*" for mapArray)
        // Separate from computed property PatternTrie to avoid mixing namespaces
        this._effectPatternTrie = new PatternTrie();

        // All effects registered with this RSM instance
        this._effects = new Set();
        this._hasAnyEffects = false;

        // Index-aligned array of item effects for each mapped array.
        // Replaces per-item string-based deps in _effectDependents with O(1) lookup by index.
        this._itemEffectsByIndex = new Map();  // arrayPath → effect[]

        // Context set during mapFn/createItemEffect to tag newly created effects as item effects
        this._itemEffectContext = null;

        // HTML binding queue for flash prevention
        this._htmlInitialQueue = new Map();

        // Pattern tracking for dependency optimization
        this._patternTracking = new Set();

        // Proxy instance tracking (WeakMaps don't affect hidden class as much)
        this._proxyInstances = new WeakMap();
        this._proxyTargets = new WeakMap();

        // Subscription queue
        this._subscriptionQueue = [];

        // Swap detection (microtask-based)
        this._swapDetectionPending = false;
        this._bulkArrayUpdateTimeout = null;
        this._recentArrayStatePath = null;

        // Splice notification flag
        this._inSpliceNotification = false;


        // ===================================================================
        // V8 SHARED HANDLER OPTIMIZATION
        // Create shared proxy handlers once per RSM instance.
        // Handlers access RSM and path via symbols on targets, not closures.
        // This eliminates handler allocation overhead during Create operations.
        // ===================================================================
        this._arrayHandler = this._createSharedArrayHandler();
        this._objectHandler = this._createSharedObjectHandler();

        // V8 OPT: Pre-initialize lazily-created properties to stabilize hidden class
        this._effectPatternEffects = new Map();
    }



    /**
     * Create a reactive state object with the given initial state
     * @param {Object} initialState - The initial state object
     * @returns {Proxy} - A reactive state proxy
     */
    createState(initialState = {}) {
        // Clone to prevent mutations of the original
        this._originalState = this._clone(initialState);

        // Create and return the reactive proxy using the already cloned state
        this._state = this._createReactiveProxy(this._originalState);

        // If storage is enabled, try to load from storage
        if (this.storageKey) {
            this._loadFromStorage();
        }

        return this._state;
    }


    /**
     * __DEV__-only warning when a reactive object is reachable via two paths
     * with different roots — i.e., aliased across state subtrees, e.g.:
     *
     *   state.a = state.b = sharedObj;
     *
     * The framework supports this by re-stamping PATH_SYMBOL on each access,
     * but the latest-access-wins semantics mean writes through the "losing"
     * path may notify the wrong subscribers depending on access order, and
     * normalised data store patterns (the same record reachable via id-keyed
     * map and a "selected" pointer) silently enter trap territory.
     *
     * Heuristic: warn only when the path's FIRST segment differs. That filters
     * out the legitimate splice/reindex case (`items.0` → `items.1`, same root
     * "items") while catching cross-subtree aliasing (`a` ↔ `b`, `users.0` ↔
     * `selected`). Conservative: misses within-subtree aliasing like
     * `a.shared` ↔ `a.other`, but those are the less-common pattern and the
     * cost of a false-negative warn is just a missed nudge.
     *
     * @private
     */
    _maybeWarnPathAlias(oldPath, newPath) {
        const oldDot = oldPath.indexOf('.');
        const newDot = newPath.indexOf('.');
        const oldRoot = oldDot === -1 ? oldPath : oldPath.slice(0, oldDot);
        const newRoot = newDot === -1 ? newPath : newPath.slice(0, newDot);
        if (oldRoot !== newRoot) {
            console.warn(
                `[WF] Reactive object aliased across state subtrees: same target reachable via "${oldPath}" and "${newPath}". ` +
                `Writes will route to whichever path was accessed most recently; bindings on the other path may miss updates. ` +
                `Hold the data in one place and use a derived computed for cross-references.`
            );
        }
    }

    /**
     * Create a reactive proxy that detects property access and changes
     * @param {Object|Array} target - The object or array to make reactive
     * @param {string} path - The current property path
     * @returns {Proxy|Object|Array} - A reactive proxy, or the original value if already proxied or non-object
     * @private
     */

    _createReactiveProxy(target, path = '') {
        // Skip non-objects and null values
        if (target === null || typeof target !== 'object' || target instanceof Node) {
            return target;
        }

        // IMMUTABLE OPTIMIZATION: If target is already a proxy, return it as-is
        // Check if this object is already reactive by looking for it in the reverse map
        if (this._proxyTargets && this._proxyTargets.has(target)) {
            // This is already a proxy - don't wrap it again!
            // BUT: Update PATH_SYMBOL on the raw target if the path has changed
            // (e.g., after array replacement, items shift indices but their proxies
            // retain the old PATH_SYMBOL from their original position)
            if (path) {
                const rawTarget = this._proxyTargets.get(target);
                if (rawTarget && rawTarget[PATH_SYMBOL] !== undefined && rawTarget[PATH_SYMBOL] !== path) {
                    if (__DEV__) this._maybeWarnPathAlias(rawTarget[PATH_SYMBOL], path);
                    rawTarget[PATH_SYMBOL] = path;
                    rawTarget[ARRAY_PATH_SYMBOL] = undefined;
                }
            }
            return target;
        }

        //If we already created a proxy for this exact object, return it
        if (this._proxyInstances.has(target)) {
            // Update PATH_SYMBOL if the caller provides a different (more current) path.
            // After array splice/reindex, nested objects (e.g., row.user) retain their
            // old path. The GET trap passes the correct path based on the parent's
            // (already-reindexed) PATH_SYMBOL, so we adopt it here.
            if (path) {
                const currentPath = target[PATH_SYMBOL];
                if (currentPath !== undefined && currentPath !== path) {
                    if (__DEV__) this._maybeWarnPathAlias(currentPath, path);
                    target[PATH_SYMBOL] = path;
                    target[ARRAY_PATH_SYMBOL] = undefined;
                }
            }
            return this._proxyInstances.get(target);
        }

        // V8 OPTIMIZATION: Route to type-specific handler
        // This keeps Reflect.get/set call sites monomorphic
        if (Array.isArray(target)) {
            return this._createArrayProxy(target, path);
        } else {
            return this._createObjectProxy(target, path);
        }
    }

    /**
     * V8 OPTIMIZATION: Creates a reactive proxy specifically for Array targets.
     * Uses shared handler created once per RSM instance to eliminate closure allocation.
     * Path and RSM reference are stored on target via symbols.
     *
     * @param {Array} target - The array to make reactive
     * @param {string} path - The property path
     * @returns {Proxy} Array proxy with array-specific optimizations
     * @private
     */
    _createArrayProxy(target, path) {
        // Store metadata on target using symbols (one-time hidden class transition)
        target[RSM_SYMBOL] = this;
        target[PATH_SYMBOL] = path;
        // Note: ARRAY_PATH_SYMBOL is computed lazily in set trap when needed

        // Use shared handler (no closure allocation!)
        const proxy = new Proxy(target, this._arrayHandler);

        this._proxyInstances.set(target, proxy);
        this._proxyTargets.set(proxy, target);
        return proxy;
    }

    /**
     * V8 OPTIMIZATION: Creates a reactive proxy specifically for Object targets.
     * Uses shared handler created once per RSM instance to eliminate closure allocation.
     * Path and RSM reference are stored on target via symbols.
     *
     * @param {Object} target - The object to make reactive
     * @param {string} path - The property path
     * @returns {Proxy} Object proxy without array overhead
     * @private
     */
    _createObjectProxy(target, path) {
        // Store metadata on target using symbols (one-time hidden class transition)
        target[RSM_SYMBOL] = this;
        target[PATH_SYMBOL] = path;
        // Note: ARRAY_PATH_SYMBOL is computed lazily in set trap when needed

        // Use shared handler (no closure allocation!)
        const proxy = new Proxy(target, this._objectHandler);

        this._proxyInstances.set(target, proxy);
        this._proxyTargets.set(proxy, target);
        return proxy;
    }

    // ===================================================================
    // Pathless proxy infrastructure for mapArray.
    // These methods enable fine-grained list reactivity by creating
    // isolated proxies for list items that don't depend on the parent array.
    // ===================================================================

    /**
     * Create a reactive array mapping for efficient list rendering.
     *
     * mapArray watches an array and efficiently reconciles changes:
     * - ONE Effect watches array structure via pattern dependencies (items.*, items.length)
     * - Each item uses its original proxy with index-based paths (items.0.name, items.1.name)
     * - Uses keyed diff for add/remove/reorder operations
     *
     * Implementation (Index-Based Paths):
     * - ItemEffects depend on specific paths like "items.5.name"
     * - On reorder, ItemEffects re-run and read new data at their path
     * - This is correct behavior (data at that path changed)
     *
     * @param {Function} arrayFn - Function returning the reactive array: () => this.state.rows
     * @param {Function} mapFn - Function to create element for each item: (itemProxy, index) => { element, disposeEffect }
     * @param {Object} [options] - Configuration options
     * @param {Function} [options.onInsert] - Called when new item element is inserted: (element, index) => {}
     * @param {Function} [options.onRemove] - Called when item element is removed: (element, key) => {}
     * @param {Function} [options.onMove] - Called when item element moves: (element, newIndex, oldIndex) => {}
     * @param {Function} [options.onBulkInsert] - Called for batch insertion (e.g., initial render): (elements[]) => {}
     * @param {Function} [options.onBulkRemove] - Called for bulk removal (e.g., replace all): (elements[], items[]) => {} - clears container efficiently
     * @param {Function} [options.onBulkCreate] - Called for innerHTML fast path: (newArray, keyProp) => [{element, itemProxy, key, deferredEffectData}]
     * @param {Function} [options.onDeferredEffects] - Called with deferred effect data for requestIdleCallback creation: (deferredItems[], currentItems[]) => {}
     * @param {string} [options.key='id'] - Property name to use as key for diffing
     * @param {Object} [options.scope] - Owner scope for the MapEffect
     * @returns {Function} Dispose function to clean up the mapping
     */
    mapArray(arrayFn, mapFn, options = {}) {
        const {
            onInsert = () => {},
            onRemove = () => {},
            onMove = () => {},
            onBulkInsert = null,  // Optional: (elements[]) => {} for batch DOM insertion
            onBulkRemove = null,  // Optional: (items[], container) => {} for batch removal (bulk replacement)
            onBulkCreate = null,  // Optional: (newArray, keyProp) => [{element, itemProxy, key, deferredEffectData}] for innerHTML fast path
            onDeferredEffects = null,  // Optional: (deferredItems[], currentItems[]) => {} for deferred effect creation
            onItemUpdate = null,  // Optional: (element, newItemProxy, oldItemProxy, index) => {} called when existing item proxy changes
            onComplete = null,  // Optional: (newArray, oldLength, newLength) => {} called after all operations complete
            key = 'id',
            scope = null
        } = options;

        const self = this;

        // Save and clear _itemEffectContext so that nested mapArray calls
        // (e.g., inner list created inside outer list's mapFn) don't tag
        // their structural effect as an item effect of the outer list.
        const savedItemEffectContext = this._itemEffectContext;
        this._itemEffectContext = null;

        // Track current state
        // Each item: { key, element, itemProxy, disposeEffect, index }
        let currentItems = [];
        let currentKeyMap = new Map();  // key → index in currentItems
        let arrayPath = null;           // Cached array path for pattern registration
        let lastArrayRef = null;        // Track array reference for in-place vs replacement detection

        // The MapEffect - watches the array reference for structural changes
        const disposeMapEffect = this.createEffect(function mapArrayStructuralEffect() {
            // Read array (establishes dependency on array reference)
            const newArray = arrayFn();

            // Get the array path from the proxy for dependency registration
            // This allows us to register dependencies on "arrayPath.*" and "arrayPath.length"
            // NOTE: We only need to get the path once, but must register dependencies EVERY run
            // because effect dependencies are cleaned up before each run
            if (!arrayPath && newArray && typeof newArray === 'object') {
                // Try to get path from proxy's internal symbol (only on first run)
                const proxyTarget = self._proxyTargets.get(newArray);
                if (proxyTarget) {
                    arrayPath = proxyTarget[PATH_SYMBOL];
                    // Register a getter for currentItems for sync per-item effect dep reindex
                    // in _handleArrayLengthChange (replaces O(N) full Map scan).
                    // Must be a closure because currentItems is a let that gets reassigned.
                    if (arrayPath) {
                        self._mapArrayItems.set(arrayPath, () => currentItems);
                    }
                }
            }

            // Register dependencies for structural changes EVERY run
            // Dependencies are cleared before each effect run, so must re-register
            if (arrayPath) {
                // Watch for any direct child changes (add/remove/swap indices)
                self._registerEffectPatternDependency(`${arrayPath}.*`);
                // Also watch length explicitly for push/pop/splice
                self._registerEffectDependency(`${arrayPath}.length`);
            }

            if (!Array.isArray(newArray)) {
                // Clear everything if not an array — use bulk disposal
                self._bulkDisposeItemEffects(currentItems);
                // Use bulk removal when available
                if (onBulkRemove && currentItems.length > 0) {
                    const elements = currentItems.map(item => item.element);
                    onBulkRemove(elements, currentItems);
                } else {
                    for (const item of currentItems) {
                        onRemove(item.element, item.key);
                    }
                }
                currentItems = [];
                currentKeyMap.clear();
                return;
            }

            // === EARLY SINGLE-REMOVE DETECTION ===
            // PERF: Detect single-remove BEFORE building newKeyMap to avoid O(n) proxy accesses
            // For single-remove, we can use currentItems (already in memory) to find removed item
            const oldLength = currentItems.length;
            const newLength = newArray.length;
            // Flag to skip simple remove optimization when data shift is detected
            // With index-based keys, shift() appears as "remove last key" but actually shifts all data
            let dataShiftDetected = false;
            const operationHint = arrayPath ? self._arrayOperations?.get(arrayPath) : null;

            // Get raw array target to avoid proxy overhead in key reads.
            // The structural effect already tracks items.* via pattern —
            // per-item proxy reads during diffing just register redundant deps.
            const rawNewArray = self._proxyTargets.get(newArray) || newArray;

            if (newLength === oldLength - 1 && oldLength > 0) {
                // Potential single-remove - find removed item by scanning currentItems
                // This avoids iterating through newArray via proxy (which triggers dependency registration)
                let removedIdx = -1;
                let removedKey = null;

                // Helper to get raw key from item (bypassing proxy)
                const getRawKey = (item, defaultKey) => {
                    if (!item) return defaultKey;
                    // Get raw target if item is a proxy
                    const rawItem = self._proxyTargets.get(item) || item;
                    return rawItem[key] !== undefined ? rawItem[key] : defaultKey;
                };

                // Scan to find the one item whose key is missing
                for (let i = 0; i < oldLength; i++) {
                    const oldKey = currentItems[i].key;
                    // Check if this key still exists in new array at expected position
                    // After remove at index R: items 0..R-1 are at same index, items R+1..n are at index-1
                    let found = false;

                    if (removedIdx === -1) {
                        // Haven't found removed yet - check if item is at same index
                        if (i < newLength) {
                            const newKey = getRawKey(rawNewArray[i], i);
                            if (newKey === oldKey) {
                                found = true;
                            }
                        }
                    } else {
                        // Already found removed - check at shifted index (i-1)
                        const shiftedIdx = i - 1;
                        if (shiftedIdx >= 0 && shiftedIdx < newLength) {
                            const newKey = getRawKey(rawNewArray[shiftedIdx], shiftedIdx);
                            if (newKey === oldKey) {
                                found = true;
                            }
                        }
                    }

                    if (!found) {
                        if (removedKey !== null) {
                            // More than one removed - fall through to full diff
                            removedKey = null;
                            removedIdx = -1;
                            break;
                        }
                        removedKey = oldKey;
                        removedIdx = i;
                    }
                }

                if (removedKey !== null && removedIdx >= 0) {
                    // DATA SHIFT DETECTION: With index-based keys, operations that change
                    // data at existing positions are mis-detected as simple removes.
                    // Example: [Alice, Bob, Charlie] → [Alice, Charlie] with index keys
                    // Looks like "remove key 2" but actually position 1 data changed.
                    // Verify that ALL positions before removedIdx have matching data.
                    // CRITICAL: Use stored rawTarget (from creation time), NOT current proxy target!
                    // The proxy target changes when array is mutated (shift/splice in-place).
                    let dataShifted = false;
                    for (let i = 0; i < removedIdx && i < newLength; i++) {
                        // Use stored rawTarget if available, else fall back to proxy lookup
                        const oldRaw = currentItems[i].rawTarget || self._proxyTargets.get(currentItems[i].itemProxy) || currentItems[i].itemProxy;
                        const newRaw = self._proxyTargets.get(rawNewArray[i]) || rawNewArray[i];
                        if (oldRaw !== newRaw) {
                            dataShifted = true;
                            break;
                        }
                    }
                    if (dataShifted) {
                        // Data at some position changed - fall through to full reconciliation
                        removedKey = null;
                        removedIdx = -1;
                        // Set flag to skip SECOND simple remove detection block too
                        dataShiftDetected = true;
                    }
                }

                if (removedKey !== null && removedIdx >= 0) {
                    // SINGLE REMOVE FAST PATH - skip full key map build

                    const removedItem = currentItems[removedIdx];

                    // Dispose effect + run user onRemove BEFORE setting the splice flag.
                    // `isSpliceInProgress` gates the index-shifting phase (lines below);
                    // setting it earlier incorrectly suppresses reactive-state writes
                    // that user cleanup callbacks may perform (e.g. a nested component's
                    // onDestroy writing to the same component's non-array state).
                    if (removedItem.disposeEffect) removedItem.disposeEffect();
                    onRemove(removedItem.element, removedItem.key);

                    self._arrayIndexMutations.isSpliceInProgress = true;

                    // Remove from currentItems
                    currentItems.splice(removedIdx, 1);

                    // Splice _itemEffectsByIndex to shift item effect references
                    if (arrayPath) {
                        const effectsArr = self._itemEffectsByIndex.get(arrayPath);
                        if (effectsArr) {
                            effectsArr.splice(removedIdx, 1);
                        }
                    }

                    // Update indices for items after removed one
                    for (let i = removedIdx; i < currentItems.length; i++) {
                        const item = currentItems[i];
                        const oldIndex = item.index;
                        const newItemProxy = newArray[i];

                        item.index = i;
                        item.itemProxy = newItemProxy;

                        // Update DOM element metadata
                        onMove(item.element, i, oldIndex, null, true);
                    }

                    // Rebuild key map
                    currentKeyMap.clear();
                    for (let i = 0; i < currentItems.length; i++) {
                        currentKeyMap.set(currentItems[i].key, i);
                    }
                    if (operationHint) self._arrayOperations.delete(arrayPath);

                    if (onComplete) onComplete(newArray, oldLength, newLength);

                    self._arrayIndexMutations.isSpliceInProgress = false;
                    return; // Skip full reconciliation
                }
            }

            // === EARLY APPEND DETECTION ===
            // PERF: Detect append BEFORE building newKeyMap to avoid O(n) proxy accesses
            // For append of 1,000 onto 10,000: saves ~31% by skipping 11,000 proxy reads + dep registration
            if (newLength > oldLength && oldLength > 0) {
                const rawNewArray = self._proxyTargets.get(newArray) || newArray;
                let isAppend = true;

                // Verify all existing items are at same positions using raw key comparison (no proxy overhead)
                for (let i = 0; i < oldLength && isAppend; i++) {
                    const rawItem = rawNewArray[i];
                    const rawItemTarget = self._proxyTargets.get(rawItem) || rawItem;
                    const itemKey = rawItemTarget && rawItemTarget[key] !== undefined ? rawItemTarget[key] : i;
                    if (itemKey !== currentItems[i].key) {
                        isAppend = false;
                    }
                }

                if (isAppend) {
                    // Suspend dependency tracking
                    const prevActiveEffect = activeEffect;
                    activeEffect = null;

                    // Update existing items if their proxies changed
                    // (e.g., state.items = [...state.items, newItem])
                    // Quick check: for push(), proxy references don't change — skip entire loop
                    if (oldLength > 0 && newArray[0] !== currentItems[0].itemProxy) {
                        for (let i = 0; i < oldLength; i++) {
                            const newItemProxy = newArray[i];
                            const existing = currentItems[i];
                            if (newItemProxy !== existing.itemProxy) {
                                const oldItemProxy = existing.itemProxy;
                                existing.itemProxy = newItemProxy;
                                if (onItemUpdate && existing.element) {
                                    onItemUpdate(existing.element, newItemProxy, oldItemProxy, i);
                                }
                            }
                        }
                    }

                    const appendCount = newLength - oldLength;

                    // PERF: Use bulk creation for appending many items (same fast path as initial create)
                    let usedBulkAppend = false;
                    if (appendCount >= 10 && onBulkCreate) {
                        const bulkResults = onBulkCreate(newArray, key, oldLength);
                        if (bulkResults && bulkResults.length > 0) {
                            usedBulkAppend = true;
                            const pendingDeferredEffects = [];

                            for (let i = 0; i < bulkResults.length; i++) {
                                const result = bulkResults[i];
                                currentItems.push({
                                    key: result.key,
                                    element: result.element,
                                    itemProxy: result.itemProxy,
                                    rawTarget: self._proxyTargets.get(result.itemProxy) || result.itemProxy,
                                    disposeEffect: null,
                                    index: oldLength + i
                                });

                                if (result.itemProxy) {
                                    pendingDeferredEffects.push(result);
                                }
                            }

                            if (onDeferredEffects && pendingDeferredEffects.length > 0) {
                                onDeferredEffects(pendingDeferredEffects, currentItems, arrayPath);
                            }
                        }
                    }

                    // Fall back to per-item creation for small appends or if bulk failed
                    if (!usedBulkAppend) {
                        for (let i = oldLength; i < newLength; i++) {
                            const itemProxy = newArray[i];
                            const itemKey = itemProxy && itemProxy[key] !== undefined ? itemProxy[key] : i;

                            if (arrayPath) self._itemEffectContext = { prefix: arrayPath + '.', index: i, arrayPath };
                            const result = mapFn(itemProxy, i, false);
                            self._itemEffectContext = null;
                            const element = result.element || result;
                            const disposeEffect = result.disposeEffect || null;

                            currentItems.push({
                                key: itemKey,
                                element,
                                itemProxy,
                                rawTarget: self._proxyTargets.get(itemProxy) || itemProxy,
                                disposeEffect,
                                index: i
                            });

                            onInsert(element, i);
                        }
                    }

                    activeEffect = prevActiveEffect;

                    // Update key map for new items only (existing keys unchanged)
                    for (let i = oldLength; i < currentItems.length; i++) {
                        currentKeyMap.set(currentItems[i].key, i);
                    }
                    if (operationHint) self._arrayOperations.delete(arrayPath);

                    if (onComplete) onComplete(newArray, oldLength, newLength);

                    return; // Skip full reconciliation
                }
            }

            // SWAP FAST PATH: O(1) swap using hint indices.
            // Only for in-place mutations (same array reference) — array replacements
            // may have a stale swap hint but need full reconciliation for binding updates.
            if (operationHint?.type === 'swap' && oldLength === newLength && newArray === lastArrayRef) {
                const hIdx1 = operationHint.index1;
                const hIdx2 = operationHint.index2;
                if (hIdx1 >= 0 && hIdx2 >= 0 && hIdx1 < oldLength && hIdx2 < oldLength) {
                    const ci1 = currentItems[hIdx1];
                    const ci2 = currentItems[hIdx2];
                    const raw = self._proxyTargets.get(newArray) || newArray;
                    const k1 = raw[hIdx1]?.[key] ?? hIdx1;
                    const k2 = raw[hIdx2]?.[key] ?? hIdx2;
                    if (k1 === ci2.key && k2 === ci1.key) {
                        ci1.index = hIdx2;
                        ci2.index = hIdx1;
                        const op1 = ci1.itemProxy;
                        const op2 = ci2.itemProxy;
                        ci1.itemProxy = newArray[hIdx2];
                        ci2.itemProxy = newArray[hIdx1];
                        currentItems[hIdx1] = ci2;
                        currentItems[hIdx2] = ci1;
                        const r1 = currentItems[hIdx1 + 1];
                        const r2 = currentItems[hIdx2 + 1];
                        onMove(ci2.element, hIdx1, hIdx2, r1?.element || null);
                        onMove(ci1.element, hIdx2, hIdx1, r2?.element || null);
                        if (onItemUpdate) {
                            onItemUpdate(ci1.element, ci1.itemProxy, op1, hIdx2);
                            onItemUpdate(ci2.element, ci2.itemProxy, op2, hIdx1);
                        }
                        if (arrayPath) {
                            const ea = self._itemEffectsByIndex.get(arrayPath);
                            if (ea) { const tmp = ea[hIdx1]; ea[hIdx1] = ea[hIdx2]; ea[hIdx2] = tmp; }
                        }
                        currentKeyMap.set(ci1.key, hIdx2);
                        currentKeyMap.set(ci2.key, hIdx1);
                        self._arrayOperations.delete(arrayPath);
                        if (onComplete) onComplete(newArray, oldLength, newLength);
                        lastArrayRef = newArray;
                        return;
                    }
                }
                self._arrayOperations.delete(arrayPath);
            }

            // Build new key map for diffing using raw targets (no proxy overhead).
            // Structural effect already tracks items.* — per-item reads are redundant.
            const newKeyMap = new Map();
            const newKeys = [];
            for (let i = 0; i < newLength; i++) {
                const rawItem = rawNewArray[i];
                const itemKey = rawItem && rawItem[key] !== undefined ? rawItem[key] : i;
                newKeyMap.set(itemKey, i);
                newKeys.push(itemKey);
            }

            // SWAP DETECTION: Exactly 2 items exchanged positions
            if (operationHint?.type === 'swap' || (oldLength === newLength && oldLength >= 2)) {
                let swapIdx1 = -1, swapIdx2 = -1;
                let mismatchCount = 0;

                // Quick scan for position changes
                for (let i = 0; i < oldLength && mismatchCount <= 2; i++) {
                    const oldKey = currentItems[i].key;
                    const newIdx = newKeyMap.get(oldKey);
                    if (newIdx !== i) {
                        if (mismatchCount === 0) swapIdx1 = i;
                        else if (mismatchCount === 1) swapIdx2 = i;
                        mismatchCount++;
                    }
                }

                if (mismatchCount === 2) {
                    // Verify it's a true swap (items exchanged positions)
                    const item1 = currentItems[swapIdx1];
                    const item2 = currentItems[swapIdx2];
                    const newIdx1 = newKeyMap.get(item1.key);
                    const newIdx2 = newKeyMap.get(item2.key);

                    if (newIdx1 === swapIdx2 && newIdx2 === swapIdx1) {
                        // TRUE SWAP - O(1) DOM operation
                        // Update indices
                        item1.index = newIdx1;
                        item2.index = newIdx2;

                        // Save old proxies before updating
                        const oldItemProxy1 = item1.itemProxy;
                        const oldItemProxy2 = item2.itemProxy;

                        // Update itemProxy references to new positions
                        item1.itemProxy = newArray[newIdx1];
                        item2.itemProxy = newArray[newIdx2];

                        // Swap in currentItems array
                        currentItems[swapIdx1] = item2;
                        currentItems[swapIdx2] = item1;

                        // Call onMove for both items
                        // Find reference siblings for DOM positioning
                        const nextItem1 = currentItems[swapIdx1 + 1];
                        const nextItem2 = currentItems[swapIdx2 + 1];
                        onMove(item2.element, swapIdx1, swapIdx2, nextItem1?.element || null);
                        onMove(item1.element, swapIdx2, swapIdx1, nextItem2?.element || null);

                        // CRITICAL: Call onItemUpdate to update DOM bindings for swapped items
                        // This handles cases where array is replaced with new values
                        if (onItemUpdate) {
                            onItemUpdate(item1.element, item1.itemProxy, oldItemProxy1, newIdx1);
                            onItemUpdate(item2.element, item2.itemProxy, oldItemProxy2, newIdx2);
                        }

                        // Also check ALL other items for proxy changes
                        // When array is replaced (state.items = [...]), non-swapped items may have new proxies too
                        if (onItemUpdate) {
                            for (let i = 0; i < currentItems.length; i++) {
                                if (i === swapIdx1 || i === swapIdx2) continue; // Already handled above
                                const item = currentItems[i];
                                const newProxy = newArray[i];
                                if (newProxy !== item.itemProxy) {
                                    const oldProxy = item.itemProxy;
                                    item.itemProxy = newProxy;
                                    onItemUpdate(item.element, newProxy, oldProxy, i);
                                }
                            }
                        }

                        // Swap effects in _itemEffectsByIndex to match new positions
                        if (arrayPath) {
                            const effectsArr = self._itemEffectsByIndex.get(arrayPath);
                            if (effectsArr) {
                                const tempEffect = effectsArr[swapIdx1];
                                effectsArr[swapIdx1] = effectsArr[swapIdx2];
                                effectsArr[swapIdx2] = tempEffect;
                            }
                        }

                        // O(1) keymap update - just swap the two entries
                        currentKeyMap.set(item1.key, swapIdx2);
                        currentKeyMap.set(item2.key, swapIdx1);

                        if (operationHint) self._arrayOperations.delete(arrayPath);

                        // Call onComplete for swap (length unchanged)
                        if (onComplete) onComplete(newArray, oldLength, newLength);

                        return; // Skip full reconciliation
                    }
                }
            }

            // SINGLE REMOVE DETECTION: Exactly 1 item removed AND remaining items in same order
            // CRITICAL: Skip if data shift was detected - with index keys, shift() looks like "remove last"
            // but actually all data positions changed, requiring full reconciliation with onItemUpdate
            if (newLength === oldLength - 1 && oldLength > 0 && !dataShiftDetected) {
                let removedKey = null;
                let removedIdx = -1;

                // Find the one key that's missing
                for (let i = 0; i < oldLength; i++) {
                    const oldKey = currentItems[i].key;
                    if (!newKeyMap.has(oldKey)) {
                        if (removedKey !== null) {
                            // More than one removed - use full diff
                            removedKey = null;
                            break;
                        }
                        removedKey = oldKey;
                        removedIdx = i;
                    }
                }

                // Also verify remaining items are in same relative order
                // If any reordering happened, use full keyed diff instead
                if (removedKey !== null) {
                    let sameOrder = true;
                    let newIdx = 0;
                    for (let i = 0; i < oldLength && sameOrder; i++) {
                        if (i === removedIdx) continue; // Skip removed item
                        const oldKey = currentItems[i].key;
                        const expectedNewIdx = newKeyMap.get(oldKey);
                        if (expectedNewIdx !== newIdx) {
                            sameOrder = false;
                        }
                        newIdx++;
                    }
                    if (!sameOrder) {
                        removedKey = null; // Fall through to full keyed diff
                    }
                }

                if (removedKey !== null) {
                    // SINGLE REMOVE - O(n) index updates only (no reordering needed)
                    // PERF: Set flag to skip proxy set trap processing during index shifts
                    // This prevents ~9500 _handleArrayIndexMutation calls from firing
                    const removedItem = currentItems[removedIdx];

                    // Dispose effect + run user onRemove BEFORE setting the splice flag.
                    // `isSpliceInProgress` gates the index-shifting phase (lines below);
                    // setting it earlier would suppress reactive-state writes that user
                    // cleanup callbacks may perform (e.g. nested-component onDestroy hooks).
                    if (removedItem.disposeEffect) removedItem.disposeEffect();
                    onRemove(removedItem.element, removedItem.key);

                    self._arrayIndexMutations.isSpliceInProgress = true;

                    // Remove from currentItems
                    currentItems.splice(removedIdx, 1);

                    // Splice _itemEffectsByIndex to shift item effect references
                    if (arrayPath) {
                        const effectsArr = self._itemEffectsByIndex.get(arrayPath);
                        if (effectsArr) {
                            effectsArr.splice(removedIdx, 1);
                        }
                    }

                    // Update indices for items after removed one
                    // For single remove: items just shift down by 1, same key at each position
                    // onMove handles all index metadata (_listIndex, _bindItemIndex)
                    // onItemUpdate is NOT needed because:
                    //   1. Item keys are unchanged (same data, just new index)
                    //   2. Proxy comparison (newProxy !== oldProxy) is ALWAYS true due to path-keying
                    //      but that's a false positive - the underlying data is identical
                    //   3. onItemUpdate triggers expensive querySelectorAll and binding re-resolution
                    for (let i = removedIdx; i < currentItems.length; i++) {
                        const item = currentItems[i];
                        const oldIndex = item.index;
                        const newItemProxy = newArray[i];

                        item.index = i;
                        item.itemProxy = newItemProxy;

                        // Update DOM element metadata via onMove (skipDomMove=true since elements are already in correct order)
                        onMove(item.element, i, oldIndex, null, true);

                        // PERF: Skip onItemUpdate for single remove
                        // The item's key is unchanged - only its index shifted down by 1
                        // onMove already updated _listIndex and _bindItemIndex
                        // Calling onItemUpdate here would cause ~9499 unnecessary querySelectorAll calls
                    }

                    // Rebuild key map
                    currentKeyMap.clear();
                    for (let i = 0; i < currentItems.length; i++) {
                        currentKeyMap.set(currentItems[i].key, i);
                    }
                    if (operationHint) self._arrayOperations.delete(arrayPath);

                    // Call onComplete for single remove (length changed)
                    if (onComplete) onComplete(newArray, oldLength, newLength);

                    // Clear the splice-in-progress flag before returning
                    self._arrayIndexMutations.isSpliceInProgress = false;

                    return; // Skip full reconciliation
                }
            }

            // APPEND DETECTION: New items only at end
            if (newLength > oldLength && oldLength > 0) {
                let isAppend = true;

                // Verify all existing items are in same positions
                for (let i = 0; i < oldLength && isAppend; i++) {
                    const oldKey = currentItems[i].key;
                    const newIdx = newKeyMap.get(oldKey);
                    if (newIdx !== i) {
                        isAppend = false;
                    }
                }

                if (isAppend) {
                    // APPEND - Process new items at end AND update existing items if proxies changed
                    const prevActiveEffect = activeEffect;
                    activeEffect = null;

                    // CRITICAL: Update existing items if their proxies changed
                    // This happens when array is replaced (state.items = [...]) with same keys
                    // The new array has different proxy references for same-keyed items
                    for (let i = 0; i < oldLength; i++) {
                        const newItemProxy = newArray[i];
                        const existing = currentItems[i];

                        // Check if proxy reference changed (not just content)
                        if (newItemProxy !== existing.itemProxy) {
                            const oldItemProxy = existing.itemProxy;
                            existing.itemProxy = newItemProxy;

                            // Notify ListRenderer to update element bindings
                            if (onItemUpdate && existing.element) {
                                onItemUpdate(existing.element, newItemProxy, oldItemProxy, i);
                            }
                        }
                    }

                    const appendCount = newLength - oldLength;

                    // PERF: Use bulk creation for appending many items (same fast path as initial create)
                    // This uses innerHTML + insertAdjacentHTML instead of per-item cloneNode
                    let usedBulkAppend = false;
                    if (appendCount >= 10 && onBulkCreate) {
                        // Call onBulkCreate with startIndex to trigger append mode
                        const bulkResults = onBulkCreate(newArray, key, oldLength);
                        if (bulkResults && bulkResults.length > 0) {
                            usedBulkAppend = true;
                            const pendingDeferredEffects = [];

                            for (let i = 0; i < bulkResults.length; i++) {
                                const result = bulkResults[i];
                                currentItems.push({
                                    key: result.key,
                                    element: result.element,
                                    itemProxy: result.itemProxy,
                                    rawTarget: self._proxyTargets.get(result.itemProxy) || result.itemProxy,
                                    disposeEffect: null, // Will be set by deferred effects
                                    index: oldLength + i
                                });

                                if (result.itemProxy) {
                                    pendingDeferredEffects.push(result);
                                }

                                // Note: DOM insertion already done by onBulkCreate (insertAdjacentHTML)
                            }

                            // Use deferred effect creation (same as initial bulk create)
                            if (onDeferredEffects && pendingDeferredEffects.length > 0) {
                                onDeferredEffects(pendingDeferredEffects, currentItems, arrayPath);
                            }
                        }
                    }

                    // Fall back to per-item creation for small appends or if bulk failed
                    if (!usedBulkAppend) {
                        for (let i = oldLength; i < newLength; i++) {
                            const itemProxy = newArray[i];
                            const itemKey = itemProxy && itemProxy[key] !== undefined ? itemProxy[key] : i;

                            if (arrayPath) self._itemEffectContext = { prefix: arrayPath + '.', index: i, arrayPath };
                            const result = mapFn(itemProxy, i, false);
                            self._itemEffectContext = null;
                            const element = result.element || result;
                            const disposeEffect = result.disposeEffect || null;

                            currentItems.push({
                                key: itemKey,
                                element,
                                itemProxy,
                                rawTarget: self._proxyTargets.get(itemProxy) || itemProxy,
                                disposeEffect,
                                index: i
                            });

                            onInsert(element, i);
                        }
                    }

                    activeEffect = prevActiveEffect;

                    // Rebuild key map
                    currentKeyMap.clear();
                    for (let i = 0; i < currentItems.length; i++) {
                        currentKeyMap.set(currentItems[i].key, i);
                    }
                    if (operationHint) self._arrayOperations.delete(arrayPath);

                    // Call onComplete for append (length changed)
                    if (onComplete) onComplete(newArray, oldLength, newLength);

                    return; // Skip full reconciliation
                }
            }

            // BULK REPLACEMENT DETECTION: >80% of keys are different
            // When most items are being replaced, it's faster to clear and recreate
            // than to run the keyed diff (which would dispose most effects anyway)
            if (oldLength > 10 && newLength > 0) {
                // Sample up to 20 items to check how many keys are missing
                const sampleSize = Math.min(20, oldLength);
                const step = Math.max(1, Math.floor(oldLength / sampleSize));
                let missingCount = 0;

                for (let i = 0; i < sampleSize; i++) {
                    const idx = Math.min(i * step, oldLength - 1);
                    const oldKey = currentItems[idx].key;
                    if (!newKeyMap.has(oldKey)) {
                        missingCount++;
                    }
                }

                const missingPercent = missingCount / sampleSize;
                if (missingPercent > 0.8) {
                    // BULK REPLACEMENT - clear all and use bulk creation path
                    // PERF: Batch dispose all effects (scope grouping, single-pass marking)
                    self._bulkDisposeItemEffects(currentItems);

                    // Clear _itemEffectsByIndex for this array (will be rebuilt by new items)
                    if (arrayPath) self._itemEffectsByIndex.delete(arrayPath);

                    // Use bulk removal when available (single DOM operation + batched cleanup)
                    if (onBulkRemove && currentItems.length > 0) {
                        const elements = currentItems.map(item => item.element);
                        onBulkRemove(elements, currentItems);
                    } else {
                        // Fallback to per-item removal
                        for (const item of currentItems) {
                            onRemove(item.element, item.key);
                        }
                    }

                    // Clear tracking
                    currentItems = [];
                    currentKeyMap.clear();

                    // Now use bulk creation path (same as initial render)
                    const prevActiveEffect = activeEffect;
                    activeEffect = null;

                    // Try innerHTML fast path first
                    let usedBulkCreate = false;
                    if (onBulkCreate && newLength > 0) {
                        const bulkResults = onBulkCreate(newArray, key);
                        if (bulkResults && bulkResults.length > 0) {
                            usedBulkCreate = true;
                            const pendingDeferredEffects = [];
                            for (let i = 0; i < bulkResults.length; i++) {
                                const result = bulkResults[i];
                                currentItems.push({
                                    key: result.key,
                                    element: result.element,
                                    itemProxy: result.itemProxy,
                                    rawTarget: self._proxyTargets.get(result.itemProxy) || result.itemProxy,
                                    disposeEffect: result.disposeEffect || null,
                                    index: i
                                });
                                if (result.itemProxy) {
                                    pendingDeferredEffects.push(result);
                                }
                            }
                            if (pendingDeferredEffects.length > 0 && onDeferredEffects) {
                                onDeferredEffects(pendingDeferredEffects, currentItems, arrayPath);
                            }
                        }
                    }

                    // Fall back to mapFn loop if bulk create wasn't available
                    if (!usedBulkCreate) {
                        const pendingInserts = [];
                        for (let i = 0; i < newLength; i++) {
                            const itemProxy = newArray[i];
                            const itemKey = itemProxy && itemProxy[key] !== undefined ? itemProxy[key] : i;
                            const result = mapFn(itemProxy, i, true);
                            const element = result.element || result;
                            const disposeEffect = result.disposeEffect || null;

                            currentItems.push({
                                key: itemKey,
                                element,
                                itemProxy,
                                rawTarget: self._proxyTargets.get(itemProxy) || itemProxy,
                                disposeEffect,
                                index: i
                            });
                            pendingInserts.push(element);
                        }

                        if (onBulkInsert) {
                            onBulkInsert(pendingInserts);
                        } else {
                            for (let i = 0; i < pendingInserts.length; i++) {
                                onInsert(pendingInserts[i], i);
                            }
                        }
                    }

                    activeEffect = prevActiveEffect;

                    // Rebuild key map
                    currentKeyMap.clear();
                    for (let i = 0; i < currentItems.length; i++) {
                        currentKeyMap.set(currentItems[i].key, i);
                    }

                    if (operationHint) self._arrayOperations.delete(arrayPath);

                    // Call onComplete for bulk replacement (length changed)
                    if (onComplete) onComplete(newArray, oldLength, newLength);

                    return; // Skip full reconciliation
                }
            }

            // Clear operation hint before full reconciliation
            if (operationHint) self._arrayOperations.delete(arrayPath);

            // === KEYED DIFF ALGORITHM ===

            // 1. Find items to remove (exist in current but not in new)
            const toRemove = [];
            for (const current of currentItems) {
                if (!newKeyMap.has(current.key)) {
                    toRemove.push(current);
                }
            }

            // Remove them - O(n) instead of O(n²)
            if (toRemove.length > 0) {
                // Build set for O(1) lookup
                const toRemoveKeys = new Set(toRemove.map(item => item.key));

                // PERF: Batch dispose effects (scope grouping, single-pass marking)
                self._bulkDisposeItemEffects(toRemove);

                // Use bulk removal when available and removing many items
                if (onBulkRemove && toRemove.length > 10) {
                    const elements = toRemove.map(item => item.element);
                    onBulkRemove(elements, toRemove);
                } else {
                    // Per-item removal for small batches
                    for (const item of toRemove) {
                        onRemove(item.element, item.key);
                    }
                }

                // Filter currentItems in single pass - O(n) instead of indexOf+splice per item
                currentItems = currentItems.filter(item => !toRemoveKeys.has(item.key));
            }

            // Rebuild currentKeyMap after removals
            currentKeyMap.clear();
            for (let i = 0; i < currentItems.length; i++) {
                currentKeyMap.set(currentItems[i].key, i);
            }

            // 2. Process new array - build new items list and collect moves
            const newCurrentItems = [];
            const pendingMoves = [];  // Collect moves to apply stably
            const pendingInserts = []; // Collect new items for bulk insertion
            const pendingDeferredEffects = []; // Collect deferred effect data for requestIdleCallback

            // Detect bulk creation mode (no existing items = initial render)
            const isBulkCreation = currentItems.length === 0 && newArray.length > 0;

            // OPTIMIZATION: Try innerHTML fast path for bulk creation
            // onBulkCreate can use innerHTML instead of 1000 cloneNode calls
            let usedBulkCreate = false;
            if (isBulkCreation && onBulkCreate && newArray.length > 0) {
                // Suspend dependency tracking during bulk creation
                const prevActiveEffect = activeEffect;
                activeEffect = null;

                const bulkResults = onBulkCreate(newArray, key);

                // Restore active effect tracking
                activeEffect = prevActiveEffect;

                if (bulkResults && bulkResults.length > 0) {
                    usedBulkCreate = true;
                    // Process bulk results
                    for (let i = 0; i < bulkResults.length; i++) {
                        const result = bulkResults[i];
                        const rawTarget = self._proxyTargets.get(result.itemProxy) || result.itemProxy;
                        const newItem = {
                            key: result.key,
                            element: result.element,
                            itemProxy: result.itemProxy,
                            rawTarget: rawTarget,
                            disposeEffect: result.disposeEffect || null,
                            index: i
                        };
                        newCurrentItems.push(newItem);

                        if (result.itemProxy) {
                            pendingDeferredEffects.push(result);
                        }
                    }
                    // Note: DOM insertion already done by onBulkCreate (innerHTML)
                }
            }

            // Fall back to mapFn loop if bulk create wasn't used
            if (!usedBulkCreate) {
                for (let newIndex = 0; newIndex < newArray.length; newIndex++) {
                    // Get the item proxy directly from the array (original proxy, not pathless)
                    // This maintains the correct path: "items.0", "items.1", etc.
                    const itemProxy = newArray[newIndex];
                    const itemKey = itemProxy && itemProxy[key] !== undefined ? itemProxy[key] : newIndex;

                    if (currentKeyMap.has(itemKey)) {
                        // Existing item - reuse
                        const oldIdx = currentKeyMap.get(itemKey);
                        const existing = currentItems[oldIdx];

                        // CRITICAL: ALWAYS update the proxy reference to the new proxy
                        // When array is replaced (e.g., state.items = [...]), each item gets a new proxy
                        // Even if key and position are same, the proxy content may have changed
                        const oldItemProxy = existing.itemProxy;
                        existing.itemProxy = itemProxy;

                        // Notify ListRenderer to update element._itemData and nested list contexts
                        // With index-based keys, proxy identity may be same but DATA may differ
                        // (e.g., after shift(), items.0 proxy points to different data)
                        // Compare stored raw target against current raw target to detect data changes
                        const newRaw = self._proxyTargets.get(itemProxy) || itemProxy;
                        const dataChanged = existing.rawTarget !== newRaw;
                        if (dataChanged) {
                            existing.rawTarget = newRaw; // Update stored raw target
                            if (onItemUpdate && existing.element) {
                                onItemUpdate(existing.element, itemProxy, oldItemProxy, newIndex);
                            }
                        }

                        // ALWAYS add to pendingMoves for DOM repositioning
                        // Even items with same index may be displaced by other moves
                        // The move algorithm will skip elements already in correct position
                        const oldIndex = existing.index;
                        existing.index = newIndex;
                        existing._movedFrom = oldIndex !== newIndex ? oldIndex : -1;
                        pendingMoves.push({ element: existing.element, newIndex, oldIndex });

                        newCurrentItems.push(existing);
                    } else {
                        // New item - pass the original proxy to mapFn
                        // The proxy already has the correct path (e.g., "items.5")
                        // ItemEffects created by mapFn will depend on paths like "items.5.name"

                        // CRITICAL: Suspend dependency tracking during mapFn execution.
                        // mapFn does initial bindings that read from itemProxy BEFORE creating
                        // the per-item Effect. Without this suspension, those reads would
                        // register as dependencies of the structural Effect, causing it to
                        // re-run on every property change (not just structural changes).
                        const prevActiveEffect = activeEffect;
                        activeEffect = null;

                        // Call mapFn to create element and optional ItemEffect
                        // Pass isBulkCreation flag so mapFn can skip effect creation during initial render
                        if (arrayPath) self._itemEffectContext = { prefix: arrayPath + '.', index: newIndex, arrayPath };
                        const result = mapFn(itemProxy, newIndex, isBulkCreation);
                        self._itemEffectContext = null;

                        // Restore active effect tracking
                        activeEffect = prevActiveEffect;

                        const element = result.element || result;
                        const disposeEffect = result.disposeEffect || null;

                        const rawTarget = self._proxyTargets.get(itemProxy) || itemProxy;
                        const newItem = {
                            key: itemKey,
                            element,
                            itemProxy,
                            rawTarget: rawTarget,
                            disposeEffect,
                            index: newIndex
                        };

                        newCurrentItems.push(newItem);

                        // Collect deferred effect data if present
                        if (result.itemProxy) {
                            pendingDeferredEffects.push(result);
                        }

                        // OPTIMIZATION: Batch insertions during bulk creation
                        if (isBulkCreation) {
                            pendingInserts.push(element);
                        } else {
                            // Defer insert - will be applied with moves in newIndex order
                            pendingInserts.push({ element, newIndex, type: 'insert' });
                        }
                    }
                }
            }

            // Apply bulk insertions if any (single DOM operation via onBulkInsert or fallback)
            // This is the initial render path where container is empty
            if (isBulkCreation && pendingInserts.length > 0) {
                if (onBulkInsert) {
                    onBulkInsert(pendingInserts);
                } else {
                    // Fallback: insert individually
                    for (let i = 0; i < pendingInserts.length; i++) {
                        onInsert(pendingInserts[i], i);
                    }
                }
            }

            // Schedule deferred effect creation via requestIdleCallback
            if (pendingDeferredEffects.length > 0 && onDeferredEffects) {
                onDeferredEffects(pendingDeferredEffects, newCurrentItems, arrayPath);
            }

            // 3. Apply moves AND inserts together with stable positioning
            // CRITICAL: We must interleave inserts and moves by processing in newIndex order.
            // If we insert first then move, the DOM positions shift incorrectly.
            // By processing ALL operations (inserts + moves) in sorted newIndex order,
            // each element is placed at the correct current DOM position.

            // Combine pending inserts (non-bulk) and pending moves
            const pendingOps = [];
            if (!isBulkCreation) {
                for (const insert of pendingInserts) {
                    pendingOps.push(insert);
                }
            }
            for (const move of pendingMoves) {
                pendingOps.push({ ...move, type: 'move' });
            }

            if (pendingOps.length > 0) {
                // Get the parent container for DOM operations
                const firstEl = pendingMoves[0]?.element || pendingInserts[0]?.element;
                const container = firstEl?.parentNode;
                if (container) {
                    // Sort all operations by newIndex to apply in order (front to back)
                    const sortedOps = pendingOps.sort((a, b) => a.newIndex - b.newIndex);

                    for (const op of sortedOps) {
                        const el = op.element;
                        const currentChildAtTarget = container.children[op.newIndex];

                        if (op.type === 'insert') {
                            // New element - insert at target position
                            if (currentChildAtTarget) {
                                container.insertBefore(el, currentChildAtTarget);
                            } else {
                                container.appendChild(el);
                            }
                        } else {
                            // Existing element - move to target position
                            // If already at correct position, skip DOM manipulation
                            if (currentChildAtTarget === el) {
                                onMove(el, op.newIndex, op.oldIndex, null, true);
                                continue;
                            }
                            // Use insertBefore with the current child at target position
                            onMove(el, op.newIndex, op.oldIndex, currentChildAtTarget || null);
                        }
                    }
                }
            }

            currentItems = newCurrentItems;

            // Rebuild key map
            currentKeyMap.clear();
            for (let i = 0; i < currentItems.length; i++) {
                currentKeyMap.set(currentItems[i].key, i);
            }

            // Rebuild _itemEffectsByIndex from current item positions.
            // With index indirection, no per-item string dep rewriting is needed —
            // just rebuild the effects array to match the new item order.
            if (arrayPath && self._itemEffectsByIndex.has(arrayPath)) {
                const effectsArr = self._itemEffectsByIndex.get(arrayPath);
                effectsArr.length = currentItems.length;
                for (let i = 0; i < currentItems.length; i++) {
                    effectsArr[i] = currentItems[i].disposeEffect?._effect || null;
                }
            }
            // Clean up _movedFrom markers
            for (const item of currentItems) {
                delete item._movedFrom;
            }

            // Call onComplete callback after all operations
            if (onComplete && (oldLength !== newLength || newLength > 0)) {
                onComplete(newArray, oldLength, newLength);
            }

            // PERF: Clear splice-in-progress flag at end of full keyed diff
            // This ensures the flag is cleared even when fast paths are not taken
            // The flag was set early in _handleArrayLengthChange to prevent item effects
            // from being marked dirty during the splice operation
            self._arrayIndexMutations.isSpliceInProgress = false;

            lastArrayRef = newArray;
        }, {
            scope,
            name: __DEV__ ? 'mapArray' : undefined
        });

        // Restore outer _itemEffectContext (for nested mapArray in mapFn)
        this._itemEffectContext = savedItemEffectContext;

        // Return dispose function
        return () => {
            disposeMapEffect();
            for (const item of currentItems) {
                if (item.disposeEffect) item.disposeEffect();
            }
            currentItems = [];
            currentKeyMap.clear();
            // Unregister from per-item reindex registry
            if (arrayPath) {
                self._mapArrayItems.delete(arrayPath);
                self._itemEffectsByIndex.delete(arrayPath);
            }
        };
    }


    _processPendingComputedUpdates() {
        if (!this._pendingComputedUpdates || this._pendingComputedUpdates.size === 0) {
            this._pendingComputedTimer = null;
            return;
        }

        Array.from(this._pendingComputedUpdates.keys()).forEach(comp => {
            if (this.computed && this.computed[comp]) {
                // LAZY PROPAGATION: Skip cache invalidation
                // Let evaluateComputed's stale check determine if re-evaluation is needed.
                // This also preserves _lastEvalResult for proper change detection.
                this._enqueueComputedEvaluation(comp);
            }
        });

        this._pendingComputedUpdates.clear();
        this._pendingComputedTimer = null;
    }

    /**
     * Resolve a computed property path that may include dot notation
     * @param {string} fullPath - The full computed path (e.g., "menuItems.gettingStarted")
     * @returns {any} - The resolved value
     * @private
     */
    _resolveComputedPath(fullPath) {
        // Split path into base computed property and nested path
        const baseName = pathResolver.getBase(fullPath);
        const nestedPath = pathResolver.getNested(fullPath);

        // Check if the base computed property exists
        if (!this.computed[baseName]) {
            // Only warn once per missing computed to prevent log spam
            if (!this._warnedMissingComputed.has(baseName)) {
                this._warnedMissingComputed.add(baseName);
                if (__DEV__) wfWarn(`Computed property "${baseName}" does not exist`);
            }
            return undefined;
        }

        // Evaluate the base computed property through evaluateComputed (uses caching + dependency tracking)
        const baseValue = this.evaluateComputed(baseName);

        // If no nested path, return base value
        if (!nestedPath) {
            return baseValue;
        }

        // Navigate the nested path using pathResolver
        const result = pathResolver.get(baseValue, nestedPath);
        if (result === undefined) {
            // Only log error if base value exists but path traversal failed
            if (baseValue !== undefined) {
                wfError(WF_ERRORS.COMPUTED_EVAL_ERROR, { context: `${baseName}.${nestedPath}` });
            }
        }
        return result;
    }


    /**
     * Get a value from a nested path within an object
     * @param {Object} obj - The source object
     * @param {string} subPath - The dot-notation path within the object
     * @returns {*} - The value at the path or undefined if not found
     * @private
     */
    _getValueFromPath(obj, subPath) {
        return pathResolver.get(obj, subPath);
    }


    /**
     * Handle state changes by updating computed properties and notifying listeners
     * @param {string} path - The property path that changed
     * @param {any} newValue - The new value
     * @param {any} oldValue - The old value
     * @param {boolean} [skipComputed=false] - Whether to skip computed property re-evaluation
     * @private
     */

    _handleStateChange(path, newValue, oldValue, skipComputed = false, skipVersionIncrement = false) {
        // LAZY PROPAGATION: Increment version for this path (O(1))
        // skipVersionIncrement is true when called from _processQueuedChange (already incremented in _enqueueStateChange)
        if (!skipVersionIncrement) {
            this._stateVersions.set(path, (this._stateVersions.get(path) || 0) + 1);
            this._globalEpoch++;
        }

        // EFFECT SYSTEM: Notify effects that depend on this path
        // This marks dependent effects as dirty and schedules them for execution
        this._notifyEffectDependents(path);

        // EFFECT SYSTEM: Also notify effects that depend on computed properties that depend on this path
        // This handles transitive dependencies: items -> computed:allItems -> mapArray effect
        // computedDependencies is a Map: path → Set of computation names that depend on it
        if (!skipComputed && this.computedDependencies) {
            const dependentComputeds = this.computedDependencies.get(path);
            if (dependentComputeds && dependentComputeds.size > 0) {
                // Mark all dependent computeds dirty (transitively via BFS)
                this._markComputedsDirtyTransitively(dependentComputeds);
            }
        }

        // LAZY PROPAGATION: Skip eager cascade invalidation
        // With version-based stale checking, we don't need to eagerly invalidate computed caches.
        // Computed invalidation is lazy: _isComputedStale detects staleness on access
        // via the version counter incremented above. No eager cascade needed.

        // Call listeners/watchers
        this.onStateChange(path, newValue, oldValue);

        // Auto-save to localStorage if enabled
        // This is the central point for ALL reactive changes (including nested properties),
        // so placing autoSave here ensures it triggers for any state mutation
        if (this.autoSave && this.storageKey) {
            this._saveToStorage();
        }

        // SPLICE FIX: When array length changes, also notify about the array itself
        // BUT: Use a flag to prevent the cascade of individual index updates
        if (path.endsWith('.length') && !this._inSpliceNotification) {
            const arrayPath = path.substring(0, path.length - 7); // Remove '.length'
            const arrayValue = this.getValue(arrayPath);
            if (Array.isArray(arrayValue)) {
                // CRITICAL: Clear any swap metadata when length changes
                // Swaps NEVER change length, so if length changed, any "swap" detected during
                // the operation was actually splice index shifts, not a real swap
                if (this._arrayOperations && this._arrayOperations.has(arrayPath)) {
                    const operation = this._arrayOperations.get(arrayPath);
                    if (operation.type === 'swap') {
                        this._arrayOperations.delete(arrayPath);
                    }
                }

                // Set flag to prevent cascade
                this._inSpliceNotification = true;
                this.onStateChange(arrayPath, arrayValue, arrayValue);
                this._inSpliceNotification = false;
            }
        }

        if (skipComputed) return;

        // Auto-notify about all tracked properties of this object
        if (this._objectPropertyDependencies && this._objectPropertyDependencies.has(path)) {
            const trackedProperties = this._objectPropertyDependencies.get(path);

            // Notify about each tracked property
            trackedProperties.forEach(propName => {
                const propPath = `${path}.${propName}`;

                // Skip if this isn't a bound property
                if (!this._boundProperties.has(propPath)) return;

                // Get property values
                const newPropValue = newValue && typeof newValue === 'object' ?
                    newValue[propName] : undefined;
                const oldPropValue = oldValue && typeof oldValue === 'object' ?
                    oldValue[propName] : undefined;

                // Only notify if values differ (basic equality check)
                if (newPropValue !== oldPropValue) {
                    this.onStateChange(propPath, newPropValue, oldPropValue);
                }
            });
        }

        // When an array changes, we need to explicitly notify about its length change
        if (Array.isArray(newValue)) {
            // Create a specialized length notification path
            const lengthPath = `${path}.length`;

            // OPTIMIZATION: Skip length notification for clear operations
            // Clear (newValue.length === 0) is fully handled by the main array notification
            // The length notification is only useful for:
            // - Append (old length < new length) - computed properties using .length
            // - Splice/filter (old length > new length, new length > 0) - computed properties
            // For clear, the main path notification already triggers list clearing
            const isClearOperation = newValue.length === 0 && oldValue && oldValue.length > 0;

            // Only notify if length actually changed AND not a clear operation
            if (!isClearOperation && (!oldValue || newValue.length !== oldValue.length)) {
                // Send specific notification for length change
                this.onStateChange(lengthPath, newValue.length, oldValue ? oldValue.length : undefined);
            }
        }

        // For array operations, ensure we invalidate computed properties
        // that might depend on the array or its ancestors
        if (Array.isArray(newValue) && path.includes('.')) {
            this._updateComputedProperties(path);

            // If this is a nested array, also invalidate parent paths
            const parentPath = path.substring(0, path.lastIndexOf('.'));
            this._updateComputedProperties(parentPath);
        } else {
            // Normal computed property updates
            this._updateComputedProperties(path);
        }

    }

    // Method to register template bindings
    registerBindingDependency(path) {
        // Mark this as a bound property
        this._boundProperties.add(path);

        // If it's a nested property, register parent-child relationship
        if (path.includes('.')) {
            const lastDot = path.lastIndexOf('.');
            const objectPath = path.substring(0, lastDot);
            const propName = path.substring(lastDot + 1);

            // Register that this property depends on its parent object
            if (!this._objectPropertyDependencies.has(objectPath)) {
                this._objectPropertyDependencies.set(objectPath, new Set());
            }
            this._objectPropertyDependencies.get(objectPath).add(propName);
        }
    }


    processBatchChanges() {
        // Early exit check - keep this efficient short circuit
        if (!this._batchChanges || this._batchChanges.size === 0) return;

        // ENHANCEMENT: Detect and handle array mutations specifically
        const arrayChanges = new Set();

        // First pass: identify all array changes (convert forEach to for loop)
        const batchPaths = Array.from(this._batchChanges.keys());
        const batchPathsLength = batchPaths.length;

        for (let i = 0; i < batchPathsLength; i++) {
            const path = batchPaths[i];
            const change = this._batchChanges.get(path);
            const { newValue, oldValue } = change;

            // Check if either old or new value is an array
            if (Array.isArray(newValue) || Array.isArray(oldValue)) {
                arrayChanges.add(path);
            }
        }

        // If we found array changes, take special action
        if (arrayChanges.size > 0) {
            // Register this component instance for updates
            if (this.component && this.component.id && this._wf) {
                // Add this component to the update queue
                this._wf._componentsToUpdate.add(this.component.id);

                // Ensure a render is scheduled
                this._wf._scheduleRender();
            }
        }

        // PREPARE PATTERN MATCHING: Group by property type for optimal computation
        const affectedByProperty = new Map();

        // Process array updates (convert to for loop)
        if (this._batchArrayUpdates && this._batchArrayUpdates.length > 0) {
            const processedIndices = new Set();
            const batchArrayUpdatesLength = this._batchArrayUpdates.length;

            for (let i = 0; i < batchArrayUpdatesLength; i++) {
                const arrayUpdate = this._batchArrayUpdates[i];
                const {path, oldArray, newArray} = arrayUpdate;

                // Find changed indices (up to a reasonable limit)
                const changedIndices = this._findChangedIndices(oldArray, newArray, 30);
                const changedIndicesLength = changedIndices.length;

                // For each changed index, check which properties changed
                for (let j = 0; j < changedIndicesLength; j++) {
                    const index = changedIndices[j];

                    // Skip indices we've already processed (avoid duplicates)
                    const indexKey = `${path}.${index}`;
                    if (processedIndices.has(indexKey)) continue;
                    processedIndices.add(indexKey);

                    const oldItem = index < oldArray.length ? oldArray[index] : undefined;
                    const newItem = index < newArray.length ? newArray[index] : undefined;

                    // Skip if either isn't an object
                    if (!oldItem || !newItem ||
                        typeof oldItem !== 'object' || typeof newItem !== 'object') {
                        continue;
                    }

                    // Get all properties from both objects (optimize set creation)
                    const oldKeys = Object.keys(oldItem);
                    const newKeys = Object.keys(newItem);
                    const allProps = new Set();

                    // Collect all unique property names from both old and new items
                    for (let k = 0; k < oldKeys.length; k++) {
                        allProps.add(oldKeys[k]);
                    }
                    for (let k = 0; k < newKeys.length; k++) {
                        allProps.add(newKeys[k]);
                    }

                    // Check each property (convert to for loop)
                    const allPropsArr = Array.from(allProps);
                    const allPropsArrLength = allPropsArr.length;

                    for (let k = 0; k < allPropsArrLength; k++) {
                        const propName = allPropsArr[k];

                        if (!objectUtils.isEqual(oldItem[propName], newItem[propName])) {
                            // Check if this property is used in any pattern
                            const patternPath = `${path}.*.${propName}`;
                            const matches = this._patternTrie?.match(patternPath);

                            if (matches && matches.size > 0) {
                                // Group by property name for optimal computation
                                if (!affectedByProperty.has(propName)) {
                                    affectedByProperty.set(propName, new Set());
                                }

                                // Add all computations that rely on this property (convert to for loop)
                                const matchesArr = Array.from(matches);
                                const matchesArrLength = matchesArr.length;
                                const propertySet = affectedByProperty.get(propName);

                                for (let l = 0; l < matchesArrLength; l++) {
                                    propertySet.add(matchesArr[l]);
                                }
                            }
                        }
                    }
                }
            }

            // Clear array updates after processing
            this._batchArrayUpdates = [];
        }

        // APPLY REGULAR CHANGES: Process normal batch changes (convert forEach to for loop)
        for (let i = 0; i < batchPathsLength; i++) {
            const path = batchPaths[i];
            const change = this._batchChanges.get(path);

            // Normal change notification, but skip computed recalculation
            this._handleStateChange(path, change.newValue, change.oldValue, true);
        }

        // APPLY PATTERN UPDATES: Update computed properties by property group (convert to for loops)
        const propNames = Array.from(affectedByProperty.keys());
        const propNamesLength = propNames.length;

        for (let i = 0; i < propNamesLength; i++) {
            const propName = propNames[i];
            const computations = Array.from(affectedByProperty.get(propName));
            const computationsLength = computations.length;

            // Update each computation exactly once
            for (let j = 0; j < computationsLength; j++) {
                const comp = computations[j];

                if (this.computed && this.computed[comp]) {
                    // LAZY PROPAGATION: Skip cache invalidation
                    // Let evaluateComputed's stale check determine if re-evaluation is needed.
                    this._enqueueComputedEvaluation(comp);
                }
            }
        }

        // Process array changes and recompute properties if needed
        if (arrayChanges.size > 0 && this.computed) {
            const computedProps = Object.keys(this.computed);
            const computedPropsLength = computedProps.length;

            for (let i = 0; i < computedPropsLength; i++) {
                const propName = computedProps[i];
                try {
                    // LAZY PROPAGATION: Skip cache invalidation
                    // Let evaluateComputed's stale check determine if re-evaluation is needed.
                    this._enqueueComputedEvaluation(propName);
                } catch (error) {
                    wfError(WF_ERRORS.COMPUTED_EVAL_ERROR, { context: propName, cause: error });
                }
            }
        }

        // Clean up batch changes
        this._batchChanges.clear();
    }

// Helper function to efficiently find changed indices
    _findChangedIndices(oldArray, newArray, maxChanges = 30) {
        if (!Array.isArray(oldArray) || !Array.isArray(newArray)) {
            return [];
        }

        const changedIndices = [];
        const minLength = Math.min(oldArray.length, newArray.length);

        for (let i = 0; i < minLength && changedIndices.length < maxChanges; i++) {
            if (!objectUtils.isEqual(oldArray[i], newArray[i])) {
                changedIndices.push(i);
            }
        }

        // Check for additions or removals
        if (changedIndices.length < maxChanges) {
            if (oldArray.length > newArray.length) {
                // Some items were removed
                for (let i = newArray.length; i < oldArray.length && changedIndices.length < maxChanges; i++) {
                    changedIndices.push(i);
                }
            } else if (newArray.length > oldArray.length) {
                // Some items were added
                for (let i = oldArray.length; i < newArray.length && changedIndices.length < maxChanges; i++) {
                    changedIndices.push(i);
                }
            }
        }

        return changedIndices;
    }


    /**
     * Get a value from state by path
     * @param {string} path - The property path (dot notation)
     * @returns {any} - The value at the specified path
     */
    getValue(path) {
        if (!path) {
            return this._clone(this._state);
        }

        // Handle computed properties
        if (path.startsWith('computed:')) {
            return this.evaluateComputed(path.slice(9));
        }

        // Handle props paths - resolve from component's props object
        if (path.startsWith('props.')) {
            const propsPath = path.slice(6); // Remove 'props.' prefix
            // Get the component instance from wildflower using the stateManager's component reference
            const componentId = this.component?.id;
            if (componentId && this._wf) {
                const instance = this._wf.componentInstances.get(componentId);
                if (instance && instance.props) {
                    return pathResolver.get(instance.props, propsPath);
                }
            }
            return undefined;
        }

        // Use pathResolver for efficient cached path resolution
        return pathResolver.get(this._state, path);
    }



    /**
     * Set a value in state by path
     * @param {string} path - The property path (dot notation)
     * @param {any} value - The value to set
     * @returns {boolean} - Whether the operation was successful
     */

    setValue(path, value) {
        try {
            // Convert bracket notation to dot notation
            // This transforms "items[0].property" to "items.0.property"
            const normalizedPath = path.replace(/\[(\d+)]/g, '.$1');

            // Split path into parts
            const parts = normalizedPath.split('.');
            const lastPart = parts.pop();
            let current = this._state;

            // Navigate to the right level, creating objects as needed
            for (const part of parts) {
                if (typeof part !== 'string' || part === '') {
                    if (__DEV__) wfWarn(`Invalid path segment "${part}" in path "${path}"`);
                    return false;
                }

                // Handle array indices
                if (this._regex.isNumeric.test(part)) {
                    // Make sure parent is an array
                    if (!Array.isArray(current)) {
                        current = [];
                    }

                    // Ensure the array is large enough
                    const index = parseInt(part, 10);
                    while (current.length <= index) {
                        current.push({});
                    }
                }
                else if (current[part] === undefined || current[part] === null) {
                    current[part] = {};
                }

                current = current[part];

                if (typeof current !== 'object' || current === null) {
                    if (__DEV__) wfWarn(`Path segment "${part}" in "${path}" resulted in a non-object value`);
                    return false;
                }
            }

            // Handle array index in last part
            if (this._regex.isNumeric.test(lastPart) && Array.isArray(current)) {
                const index = parseInt(lastPart, 10);

                // Only set if the value is actually changing
                if (current[index] !== value) {
                    current[index] = value;
                    return true;
                }

                return false;
            }

            // Only set if the value is actually changing
            if (current[lastPart] !== value) {
                try {
                    current[lastPart] = value;
                    return true;
                } catch (error) {
                    wfError(WF_ERRORS.STATE_SET_ERROR, { context: path, cause: error });
                    return false;
                }
            }

            return false;
        } catch (error) {
            wfError(WF_ERRORS.STATE_SET_ERROR, { context: path, cause: error });
            return false;
        }
    }

    /**
     * Update multiple state values at once
     * @param {Object} newState - Object containing the state updates
     * @returns {boolean} - Whether any values were updated
     */
    updateState(newState) {
        if (!newState || typeof newState !== 'object') {
            if (__DEV__) wfWarn('updateState requires an object parameter');
            return false;
        }

        let updated = false;

        // Apply each update
        Object.entries(newState).forEach(([key, value]) => {
            if (this.setValue(key, value)) {
                updated = true;
            }
        });

        return updated;
    }





    /**
     * Load state from localStorage
     * @private
     */
    _loadFromStorage() {
        if (!this.storageKey || typeof localStorage === 'undefined') return;

        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                this.updateState(parsed);
            }
        } catch (error) {
            wfError(WF_ERRORS.STATE_LOAD_ERROR, { context: this.storageKey, cause: error });
        }
    }



    /**
     * Save state to localStorage
     * @private
     */
    _saveToStorage() {
        if (!this.storageKey || typeof localStorage === 'undefined') return;

        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this._state));
        } catch (error) {
            wfError(WF_ERRORS.STATE_SAVE_ERROR, { context: this.storageKey, cause: error });
        }
    }


    // ====================================
    // MICROTASK BATCHING SYSTEM
    // ====================================

    /**
     * Determine if microtask batching should be used for this state change
     * @returns {boolean} Whether to use microtask batching
     */
    _shouldUseMicrotaskBatching() {
        // Skip microtask batching if:
        if (this._wf?._batchMode) return false;        // Manual batch active
        if (this._wf?._syncMode) return false;         // Test mode
        if (this.component?.disableMicrotaskBatching) return false; // Component opt-out
        if (this._wf?._enableMicrotaskBatching === false) return false; // Global disable

        return true;
    }

    /**
     * Add a state change to the microtask queue
     * @param {string} path - Property path
     * @param {any} newValue - New value
     * @param {any} oldValue - Previous value
     * @param {boolean} skipComputed - Whether to skip computed updates
     * @param {string} fullPath - Complete path including component context
     * @param {Array} changedPaths - Additional paths that changed
     */
    _enqueueStateChange(path, newValue, oldValue, skipComputed, fullPath, changedPaths) {
        // LAZY PROPAGATION: Increment version for this path (O(1))
        this._stateVersions.set(path, (this._stateVersions.get(path) || 0) + 1);
        this._globalEpoch++;

        // PERF: Deduplication with reverse scan (recent entries more likely to match)
        const queue = this._microtaskQueue;
        let existingEntry = null;
        for (let i = queue.length - 1; i >= 0; i--) {
            if (queue[i].fullPath === fullPath) {
                existingEntry = queue[i];
                break;
            }
        }
        if (existingEntry) {
            // PERF: Mutate in-place instead of object spread + new array
            existingEntry.newValue = newValue;
            if (changedPaths && changedPaths.length > 0) {
                const existing = existingEntry.changedPaths;
                for (let i = 0; i < changedPaths.length; i++) {
                    if (existing.indexOf(changedPaths[i]) === -1) {
                        existing.push(changedPaths[i]);
                    }
                }
            }
        } else {
            queue.push({
                path,
                newValue,
                oldValue,
                skipComputed,
                fullPath,
                changedPaths: changedPaths || [],
                timestamp: Date.now(),
                componentId: this.component?.id
            });
        }
        this._scheduleMicrotaskFlush();
    }

    /**
     * Schedule microtask queue processing
     */
    _scheduleMicrotaskFlush() {
        if (this._microtaskScheduled) return;
        this._microtaskScheduled = true;

        Promise.resolve().then(() => {
            this._flushMicrotaskQueue();
            this._microtaskScheduled = false;
        });
    }

    /**
     * Process all queued state changes atomically
     */
    _flushMicrotaskQueue() {
        if (this._microtaskQueue.length === 0 && !(this._subscriptionQueue?.length > 0)) return;

        // Drain state change queue completely (including changes added during processing,
        // e.g., from watchers that modify state during onStateChange callbacks).
        // Matches EffectScheduler.flush() drain pattern.
        while (this._microtaskQueue.length > 0) {
            // PERF: Reference swap instead of spread copy - O(1) vs O(n)
            const queueSnapshot = this._microtaskQueue;
            this._microtaskQueue = [];
            const queueLength = queueSnapshot.length;

            // PERF: Skip sort for single-item queues (common case)
            if (queueLength > 1) {
                queueSnapshot.sort((a, b) => a.timestamp - b.timestamp);
            }

            // PERF: For loop avoids closure overhead
            for (let i = 0; i < queueLength; i++) {
                this._processQueuedChange(queueSnapshot[i]);
            }
        }

        // Process subscription callbacks after all state changes
        const subQueueLength = this._subscriptionQueue?.length || 0;
        if (subQueueLength > 0) {
            // PERF: Reference swap instead of spread copy
            const subscriptionSnapshot = this._subscriptionQueue;
            this._subscriptionQueue = [];

            // PERF: For loop with direct property access avoids destructuring overhead
            for (let i = 0; i < subQueueLength; i++) {
                const sub = subscriptionSnapshot[i];
                try {
                    sub.handler(sub.newValue, sub.oldValue, sub.changedPath);
                } catch (error) {
                    wfError(WF_ERRORS.SUBSCRIPTION_ERROR, { cause: error });
                }
            }
        }
    }

    /**
     * Process a single queued state change
     * @param {Object} entry - Queued change entry
     */
    _processQueuedChange({path, newValue, oldValue, skipComputed, fullPath, changedPaths}) {
        // Use existing _handleStateChange logic unchanged
        // Pass skipVersionIncrement=true because versions were already incremented in _enqueueStateChange
        this._handleStateChange(path, newValue, oldValue, skipComputed, true);

        // NOTE: Nested property updates are handled by the property update optimization
        // in wildflowerJS.js _processList() method, which detects changed properties
        // and updates the specific DOM bindings (including nested paths like "user.profile.name")
    }

    /**
     * Enqueue a computed property evaluation for batching.
     * OPTIMIZED: Uses Set for O(1) deduplication instead of O(N) findIndex.
     * @param {string} propName - Name of the computed property
     */
    _enqueueComputedEvaluation(propName) {
        // O(1) deduplication using Set (pre-allocated in constructor)
        if (this._computedEvaluationSet.has(propName)) {
            return; // Already queued
        }

        this._computedEvaluationSet.add(propName);
        this._computedEvaluationQueue.push(propName);

        // Schedule batch processing
        this._scheduleComputedEvaluationFlush();
    }

    /**
     * Schedule computed property evaluation flush
     */
    _scheduleComputedEvaluationFlush() {
        if (this._computedEvaluationScheduled) {
            return; // Already scheduled
        }

        this._computedEvaluationScheduled = true;

        // Use microtask for batching (same pattern as state changes)
        Promise.resolve().then(() => {
            this._flushComputedEvaluationQueue();
        });
    }

    /**
     * Flush the computed property evaluation queue
     */
    _flushComputedEvaluationQueue() {
        if (this._computedEvaluationQueue.length === 0) {
            this._computedEvaluationScheduled = false;
            return;
        }

        // Get queue and clear for next batch
        const queue = this._computedEvaluationQueue;
        this._computedEvaluationQueue = [];
        this._computedEvaluationSet.clear();
        this._computedEvaluationScheduled = false;

        // Process each evaluation
        const itemLevelComputed = this._itemLevelComputedProperties;
        for (let i = 0; i < queue.length; i++) {
            const propName = queue[i];

            // Skip item-level computed properties
            if (itemLevelComputed && itemLevelComputed.has(propName)) {
                continue;
            }

            try {
                this.evaluateComputed(propName);
            } catch (error) {
                wfError(WF_ERRORS.COMPUTED_EVAL_ERROR, { context: propName, cause: error });
            }
        }
    }

    /**
     * Process queued HTML properties that were deferred during initial setup
     * @private
     */
    _processHtmlInitialQueue() {
        if (!this._htmlInitialQueue || this._htmlInitialQueue.size === 0) {
            return;
        }

        const readyToProcess = [];
        
        // Check which queued properties are now ready
        for (const [fullPath, queuedData] of this._htmlInitialQueue.entries()) {
            const { prop } = queuedData;
            
            if (this.component?._htmlContextsReady?.has(prop)) {
                readyToProcess.push([fullPath, queuedData]);
            }
        }
        
        // Process ready properties
        readyToProcess.forEach(([fullPath, queuedData]) => {
            const { targetObj, prop, value, receiver } = queuedData;
            // Remove from queue first
            this._htmlInitialQueue.delete(fullPath);
            
            // Now set the property normally
            Reflect.set(targetObj, prop, value, receiver);
        });
        
        // If all properties are processed and initial setup is complete, clear the queue
        // Note: Use .clear() instead of = null to maintain stable V8 hidden class
        //
        // INVARIANT: the !_isInitialSetup branch could in principle drop
        // un-ready entries — values queued for
        // a data-bind-html element that hasn't registered yet. The reason this
        // doesn't manifest as silent data loss in practice: drains are triggered
        // by binding-context registration (RenderingCore.js / PortalSystem.js),
        // and a hidden subtree's data-bind-html context registers the moment
        // the subtree becomes visible (data-render flip, portal activation).
        // That registration calls back into _processHtmlInitialQueue, which
        // finds the entry as ready and processes it BEFORE this clear runs.
        // The drop branch only fires when a non-hidden binding registers
        // post-init while a still-hidden one's entry is also queued — a narrow
        // interleaving that requires specific topology to trigger. If you're
        // refactoring init ordering or portal activation, preserve the
        // "drain-before-clear" sequencing: a drain caller must process ready
        // entries before this conditional fires.
        if (this._htmlInitialQueue.size === 0 || !this.component?._isInitialSetup) {
            this._htmlInitialQueue.clear();
        }
    }

    // =========================================================================
    // EFFECT SYSTEM: Effect infrastructure
    // See: docs/future/EFFECT_ARCHITECTURE_PLAN.md
    // =========================================================================

    /**
     * Create a reactive effect that automatically tracks dependencies and
     * re-runs when they change.
     *
     * @param {Function} fn - The effect function to run
     * @param {Object} [options] - Effect options
     * @param {boolean} [options.sync=false] - Run synchronously on change (default: queue for microtask)
     * @param {Object} [options.scope] - Owner for cleanup (default: current component)
     * @param {string} [options.name] - Debug name for this effect
     * @returns {Function} Stop function to dispose the effect
     *
     * @example
     * const stop = stateManager.createEffect(() => {
     *     console.log('Count is:', this.state.count);
     * });
     * // Later: stop() to dispose
     */
    createEffect(fn, options = {}) {
        const effect = {
            fn,
            deps: new Set(),          // State paths this effect depends on
            dirty: true,              // Needs to run (starts dirty to run immediately)
            scope: options.scope || this.component,
            sync: options.sync || false,
            name: options.name || null,
            disposed: false,
            _rsm: this,               // Reference to this RSM for scheduler
            _arrayPrefix: null,        // Set for item effects: "items." (V8 hidden class stability)
            _itemProps: null,           // Set for item effects: Set of property suffixes
            _componentDeps: null        // Set for item effects: component-level deps that persist across re-runs
        };

        // If created inside mapArray's mapFn, mark as item effect
        if (this._itemEffectContext) {
            const ctx = this._itemEffectContext;
            effect._isListItemEffect = true;        // Enables stable-deps optimization in _runEffect
            effect._arrayPrefix = ctx.prefix;       // "items."
            // Use precomputed item props if provided (skips first-run proxy reads)
            effect._itemProps = options?.precomputedItemProps
                ? new Set(options.precomputedItemProps)
                : new Set();
            // Register in index-aligned array
            let arr = this._itemEffectsByIndex.get(ctx.arrayPath);
            if (!arr) {
                arr = [];
                this._itemEffectsByIndex.set(ctx.arrayPath, arr);
            }
            arr[ctx.index] = effect;
        }

        // Register with scope for cleanup
        if (effect.scope) {
            if (!effect.scope._effects) {
                effect.scope._effects = new Set();
            }
            effect.scope._effects.add(effect);
        }

        // Track effect in this RSM
        this._effects.add(effect);
        this._hasAnyEffects = true;

        // Skip first run when item props are pre-computed (bulk creation optimization)
        if (options?.skipFirstRun) {
            effect.dirty = false;  // clean — first notification will queue it
        } else {
            // Run immediately to establish dependencies
            this._runEffect(effect);
        }

        // Register pre-computed component-level dependencies (deferred path).
        // These persist across re-runs (re-registered in _runEffect cleanup).
        // Must be AFTER _runEffect so they don't get cleared by the first run.
        if (options?.componentDeps && options.componentDeps.size > 0) {
            if (!effect._componentDeps) effect._componentDeps = new Set();
            for (const dep of options.componentDeps) {
                effect._componentDeps.add(dep);
                effect.deps.add(dep);
                if (!this._effectDependents.has(dep)) {
                    this._effectDependents.set(dep, new Set());
                }
                this._effectDependents.get(dep).add(effect);
            }
        }

        // Return stop function with effect reference for bulk disposal
        const dispose = () => this._disposeEffect(effect);
        dispose._effect = effect;
        return dispose;
    }

    /**
     * Execute a function without tracking dependencies.
     * Useful for reading reactive values without registering them as dependencies.
     * Similar to SolidJS's `untrack()`.
     *
     * @param {Function} fn - The function to execute without tracking
     * @returns {*} The return value of the function
     *
     * @example
     * // Inside an effect, read a value without creating a dependency:
     * const count = stateManager.untrack(() => this.state.count);
     */
    untrack(fn) {
        const prevEffect = activeEffect;
        activeEffect = null;
        try {
            return fn();
        } finally {
            activeEffect = prevEffect;
        }
    }

    /**
     * Run an effect, tracking its dependencies
     * @param {Object} effect - The effect object to run
     * @private
     */
    _runEffect(effect) {
        if (effect.disposed) return;

        // Guard against re-entrant self-triggering:
        // If this effect is already running, it wrote to its own dependency.
        // Skip re-execution; the current run will complete with the updated value.
        if (effect._running) return;
        effect._running = true;

        // PERF: Skip dep cleanup/re-registration for list item effects with stable deps.
        // List item effects always read the same properties (label, id, etc.) on every run,
        // so tearing down and rebuilding the dep graph is wasted work.
        // On first re-run we set _stableDeps; subsequent re-runs skip cleanup entirely.
        const hasStableDeps = effect._stableDeps;
        if (!hasStableDeps) {
            // Clean up old dependencies
            for (const dep of effect.deps) {
                // Handle pattern dependencies (prefixed with "pattern:")
                if (dep.startsWith('pattern:')) {
                    const pattern = dep.slice(8); // Remove "pattern:" prefix
                    if (this._effectPatternEffects) {
                        const patternEffects = this._effectPatternEffects.get(pattern);
                        if (patternEffects) {
                            patternEffects.delete(effect);
                            if (patternEffects.size === 0) {
                                this._effectPatternEffects.delete(pattern);
                            }
                        }
                    }
                } else {
                    // Regular exact path dependency
                    const dependents = this._effectDependents.get(dep);
                    if (dependents) {
                        dependents.delete(effect);
                        // Clean up empty Sets
                        if (dependents.size === 0) {
                            this._effectDependents.delete(dep);
                        }
                    }
                }
            }
            effect.deps.clear();

            // Re-add persistent component deps (untrack during re-run prevents re-registration)
            // Must also re-register in _effectDependents since cleanup above removed them
            if (effect._componentDeps) {
                for (const dep of effect._componentDeps) {
                    effect.deps.add(dep);
                    // Re-register in this effect's RSM _effectDependents
                    if (!effect._rsm._effectDependents.has(dep)) {
                        effect._rsm._effectDependents.set(dep, new Set());
                    }
                    effect._rsm._effectDependents.get(dep).add(effect);
                }
            }

            // Clear item effect props (no Map cleanup needed — they aren't in _effectDependents)
            // Skip clear during targeted re-runs: only the matching binding will execute,
            // so non-targeted prop reads won't happen and we'd lose tracking for those props.
            // Subsequent mutations of the lost props would then fail to notify the effect.
            if (effect._itemProps && !effect._changedProp) {
                effect._itemProps.clear();
            }
        }

        // Set as active effect for dependency tracking (skip if stable — deps already registered)
        const prevEffect = activeEffect;
        activeEffect = hasStableDeps ? null : effect;

        // Expose changed prop for targeted rebind optimization
        this._activeChangedProp = effect._changedProp;
        effect._changedProp = undefined;

        try {
            effect.fn();
        } catch (error) {
            const scopeInfo = effect.scope ? ` (Scope: ${effect.scope.name || effect.scope.componentName || effect.scope.id || 'unknown'})` : '';
            console.error(`[Effect${effect.name ? ` "${effect.name}"` : ''}${scopeInfo}] Error:`, error);
        } finally {
            effect._running = false;
            activeEffect = prevEffect;
            effect.dirty = false;
            this._activeChangedProp = undefined;

            // After first successful re-run, mark deps as stable for list item effects.
            // This skips dep teardown/rebuild on subsequent re-runs.
            if (!hasStableDeps && effect._isListItemEffect && effect.deps.size > 0) {
                effect._stableDeps = true;
            }
        }
    }

    /**
     * Register a component-level dependency on the currently active effect.
     * Used by ListRenderer's touchComponentLevel to register computed deps
     * that can't be tracked via proxy reads (proxy registers 'name' but
     * notifications use 'computed:name').
     * @param {string} path - The dependency path (e.g., 'computed:selectedId')
     * @private
     */
    /**
     * Force every per-item effect on this RSM to re-run on the next flush.
     * Used when an external entity (cross-store/plugin) this component depends
     * on mutates: per-item effects don't subscribe to external entities, so
     * they would otherwise miss values read through item-level computeds.
     * Binding diff drops no-op DOM writes; cost is one expression eval per row.
     * @private
     */
    _dirtyAllItemEffects() {
        const set = this._listItemEffects;
        if (!set || set.size === 0) return;
        for (const effect of set) {
            if (!effect || effect.disposed || effect.dirty) continue;
            effect.dirty = true;
            effect._changedProp = undefined;
            if (effect.sync) {
                this._runEffect(effect);
            } else {
                effectScheduler.queue(effect);
            }
        }
    }

    _registerComponentDep(path) {
        if (!activeEffect) return;
        if (!activeEffect._componentDeps) activeEffect._componentDeps = new Set();
        activeEffect._componentDeps.add(path);
        activeEffect.deps.add(path);
        if (!this._effectDependents.has(path)) {
            this._effectDependents.set(path, new Set());
        }
        this._effectDependents.get(path).add(activeEffect);
    }

    /**
     * Dispose an effect, removing it from all dependency sets
     * @param {Object} effect - The effect to dispose
     * @private
     */
    _disposeEffect(effect) {
        if (effect.disposed) return;

        effect.disposed = true;

        // Remove from all dependency sets
        for (const dep of effect.deps) {
            // Handle pattern dependencies (prefixed with "pattern:")
            if (dep.startsWith('pattern:')) {
                const pattern = dep.slice(8); // Remove "pattern:" prefix
                if (this._effectPatternEffects) {
                    const patternEffects = this._effectPatternEffects.get(pattern);
                    if (patternEffects) {
                        patternEffects.delete(effect);
                        if (patternEffects.size === 0) {
                            this._effectPatternEffects.delete(pattern);
                        }
                    }
                }
            } else {
                // Regular exact path dependency
                const dependents = this._effectDependents.get(dep);
                if (dependents) {
                    dependents.delete(effect);
                    if (dependents.size === 0) {
                        this._effectDependents.delete(dep);
                    }
                }
            }
        }
        effect.deps.clear();

        // Remove from _itemEffectsByIndex
        if (effect._arrayPrefix) {
            const arrayPath = effect._arrayPrefix.slice(0, -1);  // remove trailing '.'
            const arr = this._itemEffectsByIndex.get(arrayPath);
            if (arr) {
                const idx = arr.indexOf(effect);
                if (idx >= 0) arr[idx] = null;
            }
            effect._itemProps = null;
            effect._componentDeps = null;
        }

        // Remove from RSM tracking
        this._effects.delete(effect);
        if (this._listItemEffects) this._listItemEffects.delete(effect);
        this._hasAnyEffects = this._effects.size > 0;

        // Remove from scope
        if (effect.scope && effect.scope._effects) {
            effect.scope._effects.delete(effect);
        }

        // Remove from scheduler queue if present
        effectScheduler.remove(effect);
    }

    /**
     * Dispose multiple effects in batch, optimized for bulk removal scenarios.
     * Avoids per-effect overhead by:
     * - Marking all as disposed upfront (prevents re-triggering)
     * - Grouping scope cleanup (clear() instead of N deletes when removing all)
     * - Batch scheduler removal
     * @param {Array} effects - Array of effect objects to dispose
     * @private
     */
    _bulkDisposeEffects(effects) {
        if (!effects || effects.length === 0) return;

        // Step 1: Mark all as disposed upfront.
        for (let i = 0; i < effects.length; i++) {
            effects[i].disposed = true;
        }

        // Step 2: Clean deps from _effectDependents and _effectPatternEffects.
        for (let i = 0; i < effects.length; i++) {
            const effect = effects[i];
            for (const dep of effect.deps) {
                if (dep.startsWith('pattern:')) {
                    const pattern = dep.slice(8);
                    if (this._effectPatternEffects) {
                        const patternEffects = this._effectPatternEffects.get(pattern);
                        if (patternEffects) {
                            patternEffects.delete(effect);
                            if (patternEffects.size === 0) {
                                this._effectPatternEffects.delete(pattern);
                            }
                        }
                    }
                } else {
                    const dependents = this._effectDependents.get(dep);
                    if (dependents) {
                        dependents.delete(effect);
                        if (dependents.size === 0) {
                            this._effectDependents.delete(dep);
                        }
                    }
                }
            }
            effect.deps.clear();

            // Clear item effect props (callers manage _itemEffectsByIndex directly)
            if (effect._itemProps) {
                effect._itemProps = null;
            }
        }

        // Step 3: Batch remove from this._effects.
        for (let i = 0; i < effects.length; i++) {
            this._effects.delete(effects[i]);
            if (this._listItemEffects) this._listItemEffects.delete(effects[i]);
        }
        this._hasAnyEffects = this._effects.size > 0;

        // Step 4: Group by scope — use clear() when removing ALL effects from a scope.
        const scopeCounts = new Map();
        for (let i = 0; i < effects.length; i++) {
            const scope = effects[i].scope;
            if (scope && scope._effects) {
                scopeCounts.set(scope, (scopeCounts.get(scope) || 0) + 1);
            }
        }
        for (const [scope, count] of scopeCounts) {
            if (count >= scope._effects.size) {
                // Removing all effects from this scope — O(1) clear
                scope._effects.clear();
            } else {
                // Partial removal — must delete individually
                for (let i = 0; i < effects.length; i++) {
                    if (effects[i].scope === scope) {
                        scope._effects.delete(effects[i]);
                    }
                }
            }
        }

        // Step 5: Batch scheduler cleanup.
        for (let i = 0; i < effects.length; i++) {
            effectScheduler.remove(effects[i]);
        }
    }

    /**
     * Extract effect objects from mapArray items and bulk-dispose them.
     * Each item's disposeEffect closure has an _effect reference attached by createEffect.
     * Falls back to per-item disposal if _effect is not available.
     * @param {Array} items - Array of mapArray items with disposeEffect closures
     * @private
     */
    _bulkDisposeItemEffects(items) {
        const effects = [];
        for (let i = 0; i < items.length; i++) {
            const dispose = items[i].disposeEffect;
            if (dispose && dispose._effect) {
                effects.push(dispose._effect);
            } else if (dispose) {
                dispose(); // Fallback for closures without _effect
            }
        }
        if (effects.length > 0) {
            this._bulkDisposeEffects(effects);
        }
    }

    /**
     * Register a dependency for the currently running effect
     * Called from proxy get traps when a property is read
     * @param {string} path - The state path being read
     * @private
     */
    _registerEffectDependency(path) {
        if (!activeEffect) return;

        // FAST PATH: Item effect deps bypass _effectDependents entirely
        if (activeEffect._arrayPrefix) {
            const prefix = activeEffect._arrayPrefix;
            if (path.startsWith(prefix)) {
                // Extract property suffix: "items.5.label" → "5.label" → "label"
                const afterPrefix = path.substring(prefix.length);
                const dotIdx = afterPrefix.indexOf('.');
                if (dotIdx >= 0) {
                    const prop = afterPrefix.substring(dotIdx + 1);
                    activeEffect._itemProps.add(prop);
                }
                // Root reads like "items.5" (no property) — structural effect handles these
                return;
            }
            // Path doesn't match array prefix (e.g., component state dep) → fall through to normal
            // Track as persistent component dep for proper cleanup on disposal
            if (!activeEffect._componentDeps) activeEffect._componentDeps = new Set();
            activeEffect._componentDeps.add(path);
        }

        // Normal path: exact dep registration
        // PERF: Skip if same RSM and path already registered (common case)
        // Cross-RSM deps with the same path name are distinct dependencies
        // (e.g., computed:count on store1 vs computed:count on store2)
        if (activeEffect._rsm === this && activeEffect.deps.has(path)) return;

        // Add to effect's dependency set (Set dedup handles cross-RSM same-name paths)
        activeEffect.deps.add(path);

        // Add effect to THIS RSM's path dependents
        if (!this._effectDependents.has(path)) {
            this._effectDependents.set(path, new Set());
        }
        this._effectDependents.get(path).add(activeEffect);
    }

    /**
     * Register an Effect's dependency on a pattern (e.g., "items.*")
     * Used by mapArray to watch array structural changes without watching every property.
     *
     * @param {string} pattern - Pattern with wildcards (e.g., "items.*", "users.*.name")
     * @param {Object} effect - The Effect to register (defaults to activeEffect)
     * @private
     */
    _registerEffectPatternDependency(pattern, effect = activeEffect) {
        if (!effect) return;

        // Add to effect's dependency set (for cleanup)
        effect.deps.add(`pattern:${pattern}`);

        // Add effect to pattern trie
        // We store the effect directly, PatternTrie.add normally stores computation names
        // but we'll store effect IDs and look them up
        if (!this._effectPatternEffects) {
            this._effectPatternEffects = new Map(); // pattern → Set<effect>
        }
        if (!this._effectPatternEffects.has(pattern)) {
            this._effectPatternEffects.set(pattern, new Set());
        }
        this._effectPatternEffects.get(pattern).add(effect);

        // Register pattern in trie (pattern → pattern, we use pattern as its own "computation name")
        this._effectPatternTrie.add(pattern, pattern);
    }

    /**
     * Mark computeds as dirty transitively (BFS propagation)
     * When a state changes, mark all dependent computeds dirty,
     * and recursively mark computeds that depend on those computeds.
     * This enables O(1) stale checks instead of O(n) version comparisons.
     * @param {Set|Array} computedNames - Initial set of computed names to mark dirty
     * @private
     */
    _markComputedsDirtyTransitively(computedNames) {
        if (!computedNames || (computedNames.size === 0 && computedNames.length === 0)) return;

        // PERF: Check once whether effects exist (avoids per-item Map lookup + call)
        const hasEffects = this._effectDependents.size > 0 || !!this._effectPatternTrie;
        const nodes = this._computedNodes;

        // PERF: Fast path for single computed (common case)
        if (computedNames.size === 1) {
            const computedName = computedNames.values().next().value;
            const cnode = nodes && nodes.get(computedName);
            if (cnode) {
                cnode.flags |= DIRTY;
                this._dirtyComputeds.add(computedName);
                if (hasEffects) this._notifyEffectDependents(cnode.computedPath);
                // PERF: Skip computedDependencies.get for leaf computeds
                if (!(cnode.flags & HAS_DEPENDENTS)) return;
                // Has transitive deps - fall through to full BFS
            } else {
                // No node (rare) — allocate path string
                const computedPath = `computed:${computedName}`;
                const transitivelyDependent = this.computedDependencies.get(computedPath);
                if (!transitivelyDependent || transitivelyDependent.size === 0) {
                    this._dirtyComputeds.add(computedName);
                    if (hasEffects) this._notifyEffectDependents(computedPath);
                    return;
                }
                // Has transitive deps - fall through to full BFS
            }
        }

        // PERF: Direct Set iteration avoids array spread allocation
        // Only create BFS queue array if transitive deps are found
        const processed = this._dirtyComputeds; // Reuse dirty set for deduplication
        let transitiveQueue = null;

        for (const computedName of computedNames) {
            if (processed.has(computedName)) continue;
            processed.add(computedName);
            // Set DIRTY flag on ComputedNode (if it exists)
            const cnode = nodes && nodes.get(computedName);
            if (cnode) {
                cnode.flags |= DIRTY;
                if (hasEffects) this._notifyEffectDependents(cnode.computedPath);
                // PERF: Skip computedDependencies.get for leaf computeds
                if (!(cnode.flags & HAS_DEPENDENTS)) continue;
            } else if (hasEffects) {
                this._notifyEffectDependents(`computed:${computedName}`);
            }

            // Check for transitive deps (computeds depending on this computed)
            const computedPath = cnode ? cnode.computedPath : `computed:${computedName}`;
            const transitivelyDependent = this.computedDependencies.get(computedPath);
            if (transitivelyDependent && transitivelyDependent.size > 0) {
                if (!transitiveQueue) transitiveQueue = [];
                for (const depComputed of transitivelyDependent) {
                    if (!processed.has(depComputed)) {
                        transitiveQueue.push(depComputed);
                    }
                }
            }
        }

        // Process transitive deps via BFS if any were found
        if (transitiveQueue) {
            let idx = 0;
            while (idx < transitiveQueue.length) {
                const computedName = transitiveQueue[idx++];
                if (processed.has(computedName)) continue;
                processed.add(computedName);
                // Set DIRTY flag on ComputedNode (if it exists)
                const tnode = nodes && nodes.get(computedName);
                if (tnode) {
                    tnode.flags |= DIRTY;
                    if (hasEffects) this._notifyEffectDependents(tnode.computedPath);
                    // PERF: Skip computedDependencies.get for leaf computeds
                    if (!(tnode.flags & HAS_DEPENDENTS)) continue;
                } else if (hasEffects) {
                    this._notifyEffectDependents(`computed:${computedName}`);
                }

                const computedPath = tnode ? tnode.computedPath : `computed:${computedName}`;
                const transitivelyDependent = this.computedDependencies.get(computedPath);
                if (transitivelyDependent) {
                    for (const depComputed of transitivelyDependent) {
                        if (!processed.has(depComputed)) {
                            transitiveQueue.push(depComputed);
                        }
                    }
                }
            }
        }
    }

    /**
     * Notify all effects that depend on a changed path
     * Called from _handleStateChange when state changes
     * @param {string} path - The state path that changed
     * @private
     */
    _notifyEffectDependents(path) {

        // PERF: Fast exit when no effects exist in the system
        if (this._effectDependents.size === 0 && !this._effectPatternTrie && this._itemEffectsByIndex.size === 0) return;

        // PERF: Skip ITEM effect notifications during splice operations.
        // When items shift indices (501→500), their paths change but the data
        // is the same. mapArray handles these updates directly, so per-item
        // effects don't need to re-run during the splice (prevents ~9499
        // item-effect re-runs on a single remove).
        //
        // Two notifications must still get through:
        //   1. .length paths — the structural (mapArray) effect depends on
        //      these to reconcile the row set.
        //   2. computed:* paths — _markComputedsDirtyTransitively notifies
        //      DOM bindings of length-reading computeds (taskCount, etc.)
        //      via these paths. Component-level computeds aren't per-item
        //      effects, so the optimization here was filtering them out as
        //      collateral damage. Without this allow-through, length-reading
        //      computeds stay dirty-but-stale after a splice when bindings
        //      were registered via computed:NAME (which happens whenever an
        //      item-level binding effect on the same row has previously
        //      re-run, rewiring the dep graph).
        // Pattern subscriptions (`pattern:foo.*` via the trie matcher) are
        // also intentionally NOT notified during splice: the trie match
        // happens after this guard, so a non-.length, non-computed path
        // that would otherwise hit a registered pattern returns early
        // before the matcher runs. mapArray (the only internal pattern
        // subscriber) compensates by ALSO subscribing to `arrayPath.length`
        // via subscribePathLength — see `mapArray` registration below. User
        // code that registers a pattern via `_registerEffectPatternDependency`
        // and wants splice-aware behavior must do the same: pair the pattern
        // with an explicit .length read inside the effect body.
        if (this._arrayIndexMutations.isSpliceInProgress) {
            if (!path.endsWith('.length') && !path.startsWith('computed:')) {
                return;
            }
        }

        // FAST PATH: Item effect notification via index lookup
        // Find the LONGEST matching prefix to handle nested lists correctly.
        // e.g., "items.0.children.3.name" matches both "items" and "items.0.children"
        // — we want the most specific match ("items.0.children").
        if (this._itemEffectsByIndex.size > 0) {
            let bestEffects = null;
            let bestPrefixLen = 0;
            let bestRest = null;

            for (const [arrayPath, effects] of this._itemEffectsByIndex) {
                const prefix = arrayPath + '.';
                if (prefix.length > bestPrefixLen && path.startsWith(prefix)) {
                    bestPrefixLen = prefix.length;
                    bestEffects = effects;
                    bestRest = path.substring(prefix.length);
                }
            }

            if (bestRest !== null) {
                const dotIdx = bestRest.indexOf('.');
                if (dotIdx >= 0) {
                    const index = parseInt(bestRest.substring(0, dotIdx), 10);
                    if (!Number.isNaN(index)) {
                        const prop = bestRest.substring(dotIdx + 1);
                        const effect = bestEffects[index];

                        if (effect && !effect.disposed && effect._itemProps && effect._itemProps.has(prop)) {
                            if (!effect.dirty) {
                                effect.dirty = true;
                                effect._changedProp = prop;
                                if (effect.sync) {
                                    this._runEffect(effect);
                                } else {
                                    effectScheduler.queue(effect);
                                }
                            } else {
                                // Multiple props changed before flush — fall back to full rebind
                                effect._changedProp = undefined;
                            }
                        }
                    }
                }
            }
        }

        // Regular path: exact matches and pattern matches
        const exactEffects = this._effectDependents.get(path);
        const hasPatterns = this._effectPatternTrie && this._effectPatternEffects;

        // Fast exit: no exact effects and no pattern matching for this path
        if (!exactEffects && !hasPatterns) return;

        // Collect effects to notify — avoid Set allocation when possible
        let matchedPatterns = null;
        if (hasPatterns) {
            matchedPatterns = this._effectPatternTrie.match(path);
            if (matchedPatterns && matchedPatterns.size === 0) matchedPatterns = null;
        }

        // Fast path: only exact effects, no patterns — skip Set allocation entirely
        if (!matchedPatterns) {
            if (!exactEffects || exactEffects.size === 0) return;
            for (const effect of exactEffects) {
                if (effect.disposed) continue;
                if (!effect.dirty) {
                    effect.dirty = true;
                    if (effect.sync) {
                        this._runEffect(effect);
                    } else {
                        effectScheduler.queue(effect);
                    }
                } else if (effect._changedProp !== undefined) {
                    effect._changedProp = undefined;
                }
            }
            return;
        }

        // Slow path: merge exact + pattern effects via reusable Set
        const effectsToNotify = this._reusableEffectSet || (this._reusableEffectSet = new Set());
        effectsToNotify.clear();
        if (exactEffects) {
            for (const effect of exactEffects) {
                effectsToNotify.add(effect);
            }
        }
        for (const pattern of matchedPatterns) {
            const patternEffects = this._effectPatternEffects.get(pattern);
            if (patternEffects) {
                for (const effect of patternEffects) {
                    effectsToNotify.add(effect);
                }
            }
        }

        if (effectsToNotify.size === 0) return;

        // Snapshot into a local array before iterating. A sync effect in this
        // batch may write to another pattern-matched path, re-entering this
        // function's slow path which would `.clear()` the shared reusable Set
        // mid-iteration — dropping every effect after the current one.
        const snapshot = Array.from(effectsToNotify);
        for (const effect of snapshot) {
            if (effect.disposed) continue;

            if (!effect.dirty) {
                effect.dirty = true;

                if (effect.sync) {
                    this._runEffect(effect);
                } else {
                    effectScheduler.queue(effect);
                }
            } else if (effect._changedProp !== undefined) {
                effect._changedProp = undefined;
            }
        }
    }

}

// ===================================================================
// PROTOTYPE EXTENSIONS (Extracted sub-modules)
// Methods are defined in separate files for organization but operate
// on the ReactiveStateManager instance via prototype assignment.
// ===================================================================
Object.assign(ReactiveStateManager.prototype, ProxyHandlerMethods, ArrayOperationMethods, ComputedPropertyMethods);

/**
 * PatternTrie - Efficient wildcard pattern matching for computed property dependencies.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * DATA STRUCTURE: Prefix Trie with Wildcard Support
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * When a state property changes (e.g., `items.5.name`), we need to find all computed
 * properties that depend on patterns matching that path. A computed might depend on:
 * - Exact path: `items.5.name`
 * - Wildcard: `items.*.name` (any index)
 * - Partial: `items` (any nested change)
 *
 * WHY A TRIE?
 * - O(m) lookup where m = path depth (typically 2-5), vs O(n) for linear pattern scan
 * - Naturally handles prefix matching and wildcards
 * - Memory efficient: shared prefixes stored once
 *
 * STRUCTURE EXAMPLE:
 * For patterns: ["items.*.name", "items.*.email", "count"]
 *
 *           root
 *          /    \
 *       items   count → {computations: ["countComputed"]}
 *         |
 *         * (wildcard)
 *        / \
 *     name  email
 *       ↓     ↓
 *   {comps}  {comps}
 *
 * WILDCARD SEMANTICS:
 * - `*` matches any single path segment (typically array index)
 * - Pattern `items.*.name` matches: items.0.name, items.99.name, items.foo.name
 * - Pattern `items.*` matches any direct child: items.0, items.length
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */
export class PatternTrie {
    constructor() {
        // Root node with children Map and computations Set
        // Each node: { children: Map<segment, node>, computations: Set<computedName> }
        this.root = { children: new Map(), computations: new Set() };

        // LRU cache for match results - avoids repeated trie traversal
        // Key: path string, Value: Set of matching computation names
        this._matchCache = new LRUCache(1000);
    }

    /**
     * Register a pattern-computation association.
     *
     * @param {string} pattern - Dependency pattern (e.g., "items.*.name")
     * @param {string} computation - Name of computed property depending on this pattern
     *
     * ALGORITHM:
     * 1. Split pattern into segments by '.'
     * 2. Walk/create trie nodes for each segment
     * 3. At final node, add computation to the Set
     */
    add(pattern, computation) {
        // Clear match cache when adding new patterns (cached results may be incomplete)
        this._matchCache.clear();

        const parts = pattern.split('.');
        let node = this.root;

        // Build trie structure: create nodes as needed
        for (const part of parts) {
            if (!node.children.has(part)) {
                node.children.set(part, {
                    children: new Map(),
                    computations: new Set()
                });
            }
            node = node.children.get(part);
        }

        // Associate computation with this pattern's terminal node
        node.computations.add(computation);
    }

    /**
     * Find all computations that match a concrete path.
     *
     * @param {string} path - Concrete path (e.g., "items.5.name")
     * @returns {Set<string>} Set of computation names that depend on this path
     *
     * ALGORITHM:
     * 1. Check LRU cache for previous result
     * 2. If miss: recursively traverse trie, following both exact and wildcard matches
     * 3. Collect all computations from matching terminal nodes
     * 4. Cache and return result
     */
    match(path) {
        // OPTIMIZATION: Check cache first (O(1) lookup)
        const cached = this._matchCache.get(path);
        if (cached !== undefined) {
            return cached;
        }

        const parts = path.split('.');
        const matches = new Set();

        // Recursively collect matching patterns
        this._collectMatches(this.root, parts, 0, matches);

        // Cache result with LRU eviction (bounded memory)
        this._matchCache.set(path, matches);

        return matches;
    }

    /**
     * Recursive trie traversal with wildcard support.
     *
     * ALGORITHM:
     * At each level, try TWO branches:
     * 1. Exact match: node.children.get(parts[index])
     * 2. Wildcard match: node.children.get('*')
     *
     * This explores all possible pattern matches in single traversal.
     *
     * TIME COMPLEXITY: O(2^m) worst case where m = path depth
     * PRACTICAL: Usually O(m) because most patterns don't have consecutive wildcards
     */
    _collectMatches(node, parts, index, matches) {
        // Base case: consumed all path segments
        if (index === parts.length) {
            // Add all computations registered at this terminal node
            node.computations.forEach(comp => matches.add(comp));
            return;
        }

        const part = parts[index];

        // Branch 1: Try exact segment match
        // Pattern "items.5" matches path "items.5"
        if (node.children.has(part)) {
            this._collectMatches(node.children.get(part), parts, index + 1, matches);
        }

        // Branch 2: Try wildcard match
        // Pattern "items.*" matches path "items.5", "items.99", etc.
        // NOTE: Both branches may match, collecting from multiple patterns
        if (node.children.has('*')) {
            this._collectMatches(node.children.get('*'), parts, index + 1, matches);
        }
    }

    /**
     * Clear the match cache (call when patterns significantly change).
     */
    clearMatchCache() {
        this._matchCache.clear();
    }
}


// ============================================================================
// PUBLIC API METHODS
// These methods provide a stable interface for cross-module access,
// replacing direct property access to internal structures.
// ============================================================================

/**
 * Clear the computed property cache entirely.
 * Note: Does NOT clear _lastEvalResult to preserve change detection
 * history and prevent cascading re-evaluations.
 * @public
 */
ReactiveStateManager.prototype.clearComputedCache = function() {
    this.computedCache.clear();
    // Invalidate all ComputedNodes so fast path re-checks
    if (this._computedNodes) {
        for (const node of this._computedNodes.values()) {
            node.lastEpoch = -1;
        }
    }
};

/**
 * Schedule a computed property for re-evaluation.
 * @param {string} propName - The name of the computed property
 * @param {any} [oldValue] - Optional previous value for change detection
 * @public
 */
ReactiveStateManager.prototype.scheduleComputedEvaluation = function(propName, oldValue) {
    if (this._enqueueComputedEvaluation) {
        this._enqueueComputedEvaluation(propName, oldValue);
    }
};

/**
 * Get the names of all registered computed properties.
 * @returns {string[]} Array of computed property names
 * @public
 */
ReactiveStateManager.prototype.getComputedPropertyNames = function() {
    return this.computed ? Object.keys(this.computed) : [];
};

/**
 * Resolve a computed property path, including nested access.
 * Handles paths like "computed:menuItems.gettingStarted"
 * @param {string} fullPath - The full path to resolve
 * @returns {any} The resolved value
 * @public
 */
ReactiveStateManager.prototype.resolveComputedPath = function(fullPath) {
    return this._resolveComputedPath(fullPath);
};


// Browser globals for backward compatibility
if (typeof window !== 'undefined') {
    window.ReactiveStateManager = ReactiveStateManager;
    window.PatternTrie = PatternTrie;
}