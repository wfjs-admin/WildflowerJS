// ═══════════════════════════════════════════════════════════════════════════════════════
// ES6 MODULE IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════════════

import { WF_ERRORS } from '../core/wfUtils.js';
import { ReactiveStateManager } from './ReactiveStateManager.js';
import { createContextProxy, patchSelfReferences, warnCollisions, RAW_TARGET } from './ContextProxy.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * STORE MANAGER - Global State Management System
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * StoreManager provides global, component-independent state management for WildflowerJS.
 * Stores are reactive data containers that can be accessed from any component via
 * the `external()` method or direct store access.
 *
 * ARCHITECTURE:
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────────┐
 * │                              StoreManager                                            │
 * │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────────────┐ │
 * │  │  _namedStores   │  │_virtualComponents│  │      Store Instance                 │ │
 * │  │  Map<name,store>│  │ Map<id,instance> │  │  ┌─────────┐  ┌───────────────┐   │ │
 * │  └─────────────────┘  └─────────────────┘  │  │  state  │  │ stateManager  │   │ │
 * │                                             │  └─────────┘  └───────────────┘   │ │
 * │                                             │  ┌─────────┐  ┌───────────────┐   │ │
 * │                                             │  │ context │  │   actions     │   │ │
 * │                                             │  └─────────┘  └───────────────┘   │ │
 * │                                             └─────────────────────────────────────┘ │
 * └─────────────────────────────────────────────────────────────────────────────────────┘
 *
 * STORE TYPES:
 * 1. **Named Stores** - Created via `wildflower.store(name, config)`, accessed by name
 * 2. **Store Components** - Lower-level store instances with full component lifecycle
 *
 * STORE CONTEXT API:
 * - `state` - Reactive state object (Proxy-wrapped, use state.prop to get/set)
 * - `update(pathOrObj, value?)` - Bulk update
 * - `reset()` - Reset to initial state
 * - `subscribe(path, callback, options)` - Watch for changes
 * - `isReady()` - Check if store is initialized
 * - `waitForReady()` - Promise that resolves when ready
 *
 * USAGE PATTERNS:
 *
 * @example
 * // Create a store
 * wildflower.store('user', {
 *   state: {
 *     profile: null,
 *     isLoggedIn: false
 *   },
 *   computed: {
 *     displayName() {
 *       return this.profile?.name || 'Guest';
 *     }
 *   },
 *   async login(credentials) {
 *     const response = await api.login(credentials);
 *     this.profile = response.user;
 *     this.isLoggedIn = true;
 *   },
 *   logout() {
 *     this.profile = null;
 *     this.isLoggedIn = false;
 *   }
 * });
 *
 * @example
 * // Access from component
 * wildflower.component('user-badge', {
 *   computed: {
 *     userName() {
 *       return this.external('user', 'computed:displayName');
 *     }
 *   }
 * });
 *
 * @example
 * // Subscribe to changes
 * const store = wildflower.getStore('user');
 * const unsubscribe = store.subscribe('isLoggedIn', (newVal, oldVal) => {
 *   console.log('Login state changed:', newVal);
 * }, { immediate: true });
 *
 * DESIGN DECISIONS:
 * - Stores use the same ReactiveStateManager as components (unified reactivity)
 * - `_internal.ready` flag ensures stores are fully initialized before use
 * - Actions are bound to store context, enabling `this.state` access
 * - Subscriptions support path-based filtering and immediate execution
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */
export class StoreManager {
    /**
     * Create a new StoreManager instance.
     *
     * @param {WildflowerJS} framework - The main framework instance
     */
    constructor(framework) {
        /** @type {WildflowerJS} Reference to the main framework */
        this.framework = framework;

        /** @type {Map<string, Object>} Named stores by name */
        this._namedStores = new Map();

        /** @type {Map<string, Object>} Store component instances by ID */
        this._virtualComponents = new Map();

        /** @type {Array} Queue of pending store updates during initialization */
        this._pendingStoreUpdates = [];

        /** @type {Set<string>} Stores accessed before they were ready */
        this._earlyStoreAccesses = new Set();

        /**
         * Pending store dependencies - tracks components waiting for stores to be created.
         * Map<storeName, Set<{ componentId, computedName, listElement }>>
         *
         * When a component's computed property calls external('storeName') before that store
         * exists, we register the dependency here. When store() is called, we
         * re-evaluate those computed properties to trigger reactive updates.
         */
        this._pendingStoreDependencies = new Map();

        // V8 OPT: Pre-initialize to stabilize hidden class
        this._pendingListElements = new Map();
    }

    // =========================================================================
    // PENDING STORE DEPENDENCIES
    // =========================================================================
    // These methods handle the case where a component's computed property
    // references a store via external() before the store exists.

    /**
     * Register a pending dependency on a store that doesn't exist yet.
     * Called from external() when a store lookup fails.
     *
     * @param {string} storeName - Name of the store being waited for
     * @param {string} componentId - ID of the component that needs the store
     * @param {string} computedName - Name of the computed property that needs re-evaluation
     * @param {HTMLElement} [listElement] - Optional list element that needs re-rendering
     */
    registerPendingStoreDependency(storeName, componentId, computedName, listElement = null) {
        if (!this._pendingStoreDependencies.has(storeName)) {
            this._pendingStoreDependencies.set(storeName, new Set());
        }

        // Use composite string key for Set deduplication.
        // listElement (DOM node) is stored separately in _pendingListElements below
        // because DOM nodes are not serializable and would be silently stripped.
        const dedupKey = `${componentId}|${computedName}`;
        this._pendingStoreDependencies.get(storeName).add(dedupKey);

        // PENDING LIST ELEMENT: If there's a list element in the tracking context,
        // store it separately (DOM elements can't be serialized to JSON)
        // This allows _resolvePendingStoreDependencies to re-render the list when the store is created
        const trackingContext = this.framework?._computedTrackingContext;
        const trackedListElement = trackingContext?.listElement;
        if (trackedListElement && componentId && computedName) {
            const key = `${componentId}:${computedName}`;
            this._pendingListElements.set(key, trackedListElement);
        }
    }

    /**
     * Resolve pending dependencies when a store is created.
     * Re-evaluates computed properties and triggers list re-renders.
     *
     * @param {string} storeName - Name of the store that was just created
     */
    _resolvePendingStoreDependencies(storeName) {
        const pendingSet = this._pendingStoreDependencies.get(storeName);
        if (!pendingSet || pendingSet.size === 0) {
            return;
        }

        // Process each pending dependency
        pendingSet.forEach(dedupKey => {
            const sepIdx = dedupKey.indexOf('|');
            const componentId = dedupKey.slice(0, sepIdx);
            const computedName = dedupKey.slice(sepIdx + 1);

            // Get the component instance
            const instance = this.framework.componentInstances.get(componentId);
            if (!instance) {
                return; // Component no longer exists
            }

            // Deferred subscribe: set up path subscriptions that failed at init time
            if (computedName === '_subscribe_' && instance.definition?.subscribe) {
                const parsed = this._parseSubscribeDeclaration(instance.definition.subscribe);
                const paths = parsed[storeName];
                if (paths) {
                    const pathsArray = Array.isArray(paths) ? paths : [paths];
                    for (const path of pathsArray) {
                        if (path) {
                            const success = this.subscribePath(storeName, path, instance);
                            if (success) {
                                instance._storeSubscriptions = instance._storeSubscriptions || [];
                                instance._storeSubscriptions.push({ storeName, path });
                            }
                        }
                    }
                }
                // Invalidate ALL computed caches so they re-evaluate with the now-available store
                if (instance.stateManager.computedCache) {
                    instance.stateManager.computedCache.clear();
                }
                if (instance.stateManager._lastEvalResult) {
                    instance.stateManager._lastEvalResult.clear();
                }
                // Reset the cross-entity LEAN eval path on every computed node.
                // The lean path (see ComputedPropertyManager:_evaluateComputedFull
                // line ~927) skips _computedTrackingContext setup on subsequent
                // re-evals once _externalEvalCount > 0. If a computed's first
                // eval early-returned BEFORE reading the now-resolved store
                // (e.g. `if (!id) return null;` before reading store state),
                // the cross-store dep was never registered through the tracking
                // proxy. The lean path then preserves that gap on every
                // subsequent eval — the store's mutations would never wake the
                // computed even though the entity-dep registration is in place,
                // because computed re-eval reads the raw store context (no
                // tracking proxy → no _storeDependencies entry → no externalSources
                // refresh). Resetting _externalEvalCount forces the next eval
                // through the FULL path, which re-establishes cross-store
                // dependency tracking cleanly.
                if (instance.stateManager._computedNodes) {
                    instance.stateManager._computedNodes.forEach(function(node) {
                        if (node._externalEvalCount) node._externalEvalCount = 0;
                    });
                }

                // Re-render any list elements in this component that may depend on the store
                if (instance.element && this.framework._renderList) {
                    const listEls = instance.element.querySelectorAll('[data-list]');
                    for (const listEl of listEls) {
                        if (listEl._mapArrayInitialized && listEl._disposeMapArray) {
                            listEl._disposeMapArray();
                            listEl._mapArrayInitialized = false;
                            listEl._disposeMapArray = null;
                            listEl.innerHTML = '';
                        }
                        const ctx = listEl._listContext;
                        if (ctx) {
                            this.framework._renderList(listEl, null, ctx, instance);
                        }
                    }
                }
            }

            // Re-evaluate the computed property to get fresh data
            if (computedName && instance.stateManager) {
                try {
                    // Invalidate the cached computed value so it will be re-evaluated
                    if (instance.stateManager.computedCache) {
                        instance.stateManager.computedCache.delete(computedName);
                    }
                    if (instance.stateManager._lastEvalResult) {
                        instance.stateManager._lastEvalResult.delete(computedName);
                    }

                    // Check if there's a list element stored for this pending dependency
                    // (DOM elements can't be serialized to JSON, so we use a separate Map)
                    // Key is just componentId:computedName since we don't know the store when registering
                    const key = `${componentId}:${computedName}`;
                    const listElement = this._pendingListElements?.get(key);

                    // If there's a list element, trigger re-render
                    if (listElement && listElement.isConnected) {
                        // Get the list renderer and trigger update
                        // ListRendererMethods is mixed into the framework, so _renderList is on this.framework
                        if (this.framework._renderList) {
                            // For mapArray lists, we need to dispose and re-initialize
                            // so the arrayFn can re-evaluate with the now-existing store
                            if (listElement._mapArrayInitialized && listElement._disposeMapArray) {
                                listElement._disposeMapArray();
                                listElement._mapArrayInitialized = false;
                                listElement._disposeMapArray = null;
                                listElement.innerHTML = '';
                            }

                            // Get the list context
                            const context = listElement._listContext;

                            // Force the list to re-render with new data
                            if (context) {
                                this.framework._renderList(
                                    listElement,
                                    null, // Let it re-resolve the data
                                    context,
                                    instance
                                );
                            }
                        }

                        // Clean up the list element reference
                        this._pendingListElements?.delete(key);
                    }

                    // Re-run the render effect so it picks up the new store value
                    const effect = instance._renderEffect?._effect;
                    if (effect && !effect.disposed) {
                        effect.dirty = true;
                        instance.stateManager._runEffect(effect);
                    }
                } catch (error) {
                    if (__DEV__) console.warn(`[StoreManager] Error resolving pending dependency for ${computedName}:`, error);
                }
            }
        });

        // Clear the pending dependencies for this store
        this._pendingStoreDependencies.delete(storeName);
    }

    /**
     * Remove all pending dependencies for a component that's being destroyed.
     * Called from component cleanup.
     *
     * @param {string} componentId - ID of the component being destroyed
     */
    removePendingDependencies(componentId) {
        this._pendingStoreDependencies.forEach((pendingSet, storeName) => {
            const toRemove = [];

            pendingSet.forEach(dedupKey => {
                const keyComponentId = dedupKey.split('|')[0];
                if (keyComponentId === componentId) {
                    toRemove.push(dedupKey);
                }
            });

            toRemove.forEach(key => pendingSet.delete(key));

            // Clean up empty sets
            if (pendingSet.size === 0) {
                this._pendingStoreDependencies.delete(storeName);
            }
        });
    }

    /**
     * Creates a store component (previously known as a virtual component)
     *
     * UNIFIED ENTITY SYSTEM:
     * Stores now use the same patterns as components:
     * - Uses _createBaseEntityContext() for shared context creation
     * - Uses _bindEntityMethods() to bind methods BEFORE init()
     * - Uses _handleEntityStateChange() for unified state change notification
     * - Bidirectional context reference for proper dependency tracking
     *
     * @param {string} name - The name of the store component
     * @param {Object} definition - The component definition with state and computed properties
     * @returns {Object} The created store component instance
     */
    createStoreComponent(name, definition) {
        // Validate inputs
        if (!name || typeof name !== 'string') {
            this.framework._error(WF_ERRORS.STORE_NAME_INVALID, {
                suggestion: 'Provide a string name as the first argument to store()'
            });
            return null;
        }

        if (!definition || typeof definition !== 'object') {
            this.framework._error(WF_ERRORS.STORE_DEF_INVALID, {
                context: name,
                suggestion: 'Provide an object with state and optional computed properties'
            });
            return null;
        }

        // Create a unique ID for this component instance
        const instanceId = this._generateInstanceId(name);

        try {
            // Create ReactiveStateManager with UNIFIED state change handler
            // Support storageKey and autoSave for localStorage persistence (like components)
            const stateManager = new ReactiveStateManager({
                onStateChange: (path, newValue, oldValue) => {
                    // Use unified entity state change handler
                    this.framework._handleEntityStateChange(instanceId, path, newValue, oldValue);
                },
                wf: this.framework,
                component: {id: instanceId, name: name, isVirtual: true},
                storageKey: definition.storageKey || null,
                autoSave: definition.autoSave || false
            });

            // Create state from definition
            const state = stateManager.createState(definition.state || {});

            // Create context using unified base entity context factory
            const rawContext = this.framework._createBaseEntityContext(
                instanceId,
                state,
                stateManager,
                { type: 'store' }
            );

            // Add store-specific context properties
            rawContext.framework = this.framework;

            // Add stores container for subscribe: {} support (like components)
            // This enables store-to-store communication via this.stores.otherStore
            rawContext.stores = {};

            // Add reset method (store-specific)
            rawContext.reset = function() {
                const initialState = definition.state || {};

                // Clear current state (except internal properties)
                Object.keys(state).forEach(key => {
                    if (key !== '_internal') {
                        delete state[key];
                    }
                });

                // Add initial state values
                Object.entries(initialState).forEach(([key, value]) => {
                    if (key !== '_internal') {
                        state[key] = objectUtils.deepClone(value);
                    }
                });

                return this;
            };

            // Wrap context with unified context proxy for shorthand access
            const context = createContextProxy(rawContext, stateManager);
            patchSelfReferences(rawContext, context, stateManager);
            if (__DEV__) warnCollisions(stateManager, name);

            // BIND METHODS BEFORE INIT
            // This ensures methods are available in init()
            this.framework._bindEntityMethods(definition, context);

            // Add computed properties — bind to context but let errors propagate
            // so ComputedPropertyManager can set the ERRORED sentinel for caching
            if (definition.computed && Object.keys(definition.computed).length > 0) {
                const boundComputedProps = {};
                Object.entries(definition.computed).forEach(([propName, fn]) => {
                    boundComputedProps[propName] = function() {
                        return fn.call(context);
                    };
                });

                stateManager.addComputed(boundComputedProps);
            }

            // Create the component instance
            const instance = {
                id: instanceId,
                name,
                state,
                stateManager,
                definition,
                context,
                isVirtual: true,
                // Path-based subscription system for declarative subscribe: {} feature
                _pathSubscribers: new Map(),  // Map<path, Set<componentInstance>>
                _hasPathSubscribers: false    // V8 optimization flag for fast skip
            };

            // Store the instance in framework components
            this.framework.componentInstances.set(instanceId, instance);

            // Store in our local map
            this._virtualComponents.set(instanceId, instance);

            // Handle context registry with bidirectional reference
            if (this.framework._contextSystemInitialized && this.framework._contextRegistry) {
                const componentContext = this.framework._contextRegistry.createComponentContext(
                    instanceId,
                    name,
                    {
                        parent: this.framework._contextRegistry.rootContext,
                        componentInstance: instance,
                        data: {
                            virtual: true,
                            type: 'store-component'
                        }
                    }
                );

                // Store reference to context on the instance
                instance._componentContext = componentContext;

                // CRITICAL: Bidirectional reference for proper dependency tracking
                if (componentContext) {
                    componentContext.componentInstance = instance;
                }
            }

            // Setup store-to-store subscriptions (subscribe: {} support)
            // This must happen BEFORE init() so this.stores is available
            this._setupStoreSubscriptions(instance);

            // Initialize - call init hook from definition
            // Methods are NOW AVAILABLE in init() due to _bindEntityMethods above
            if (typeof definition.init === 'function') {
                try {
                    const initResult = definition.init.call(context);
                    // Capture promise if init is async (for subscribe-wait feature)
                    if (initResult && typeof initResult.then === 'function') {
                        instance._initPromise = initResult;
                    }
                } catch (error) {
                    this.framework._error(WF_ERRORS.STORE_INIT_ERROR, {
                        context: name,
                        suggestion: 'Check the init() function in your store definition',
                        cause: error
                    });
                }
            }

            // SIGNAL PROMOTION: Eagerly evaluate computeds to discover external
            // dependencies and trigger signal promotion before any state changes fire.
            //
            // Two-pass approach:
            //   Pass 1: Evaluate ALL computeds once. This discovers which ones have
            //           external deps (reading from other stores via getStore tracking).
            //           _computedsWithExternalDeps is empty before this pass.
            //   Pass 2: Evaluate external-dep computeds a second time to trigger
            //           signal promotion (hadDeps=true on 2nd eval).
            {
                const sm = instance.stateManager;
                const computedNames = sm.getComputedPropertyNames();

                // Pass 1: discover external deps
                for (const compName of computedNames)
                {
                    try { sm.evaluateComputed(compName); } catch (e) {
                        if (__DEV__) console.warn(`[WF] Store '${name}' computed '${compName}' error during init:`, e.message);
                    }
                }

                // Pass 2: promote external-dep computeds (now discovered)
                if (sm._computedsWithExternalDeps && sm._computedsWithExternalDeps.size > 0)
                {
                    for (const compName of sm._computedsWithExternalDeps)
                    {
                        try { sm.evaluateComputed(compName); } catch (e) {
                            if (__DEV__) console.warn(`[WF] Store '${name}' computed '${compName}' error during promotion:`, e.message);
                        }
                    }
                }
            }

            // Register tick lifecycle hook if defined (shared rAF loop with components)
            if (typeof definition.tick === 'function') {
                instance._tickFn = definition.tick.bind(context);
                const fw = this.framework;
                if (!fw._tickableInstances) fw._tickableInstances = [];
                fw._tickableInstances.push(instance);
                fw._startPoolLoop();
            }

            return instance;
        } catch (error) {
            this.framework._error(WF_ERRORS.STORE_CREATE_ERROR, {
                context: name,
                suggestion: 'Check the store definition for errors',
                cause: error
            });
            return null;
        }
    }

    /**
     * Generate a unique ID for a store component
     * @private
     */
    _generateInstanceId(componentName) {
        if (!this._instanceIdCounter) this._instanceIdCounter = 0;
        return `${componentName}-${++this._instanceIdCounter}`;
    }

    // =========================================================================
    // PATH SUBSCRIPTION SYSTEM (for subscribe: {} declarative feature)
    // =========================================================================

    /**
     * Subscribe a component instance to a store path for onStoreUpdate notifications.
     * Called from ComponentLifecycle._setupStoreSubscriptions().
     *
     * @param {string} storeName - Name of the store
     * @param {string} path - Path within the store to watch
     * @param {Object} componentInstance - The subscribing component instance
     * @returns {boolean} True if subscription was successful
     */
    subscribePath(storeName, path, componentInstance) {
        const store = this._namedStores.get(storeName);
        if (!store) {
            if (__DEV__) console.warn(`[WF] Store '${storeName}' not found for path subscription`);
            return false;
        }

        // Initialize path subscribers set if needed
        if (!store._pathSubscribers.has(path)) {
            store._pathSubscribers.set(path, new Set());
        }

        store._pathSubscribers.get(path).add(componentInstance);
        store._hasPathSubscribers = true;
        // Invalidate the EntitySystem fast-exit cache. Without this, a store
        // whose first state-change fired before any subscriber registered
        // (e.g. the synthetic `_internal.ready` write done at end of
        // createStoreComponent) leaves _hasNotifyTargets locked at false,
        // and subsequent mutations short-circuit without dispatching to
        // path subscribers. Mirrors _registerEntityDependent's invalidation.
        store._hasNotifyTargets = true;

        // ENTITY-DEP REGISTRATION: also register the component as an entity
        // dependent of this store. The path-subscriber dispatch only fires
        // the user's onStoreUpdate(); computed dirty-marking + binding-effect
        // wakeup happens in the entity-dependent dispatch loop in
        // _handleEntityStateChange (which iterates _getEntityDependents).
        // Without this registration, mutations to a subscribed path correctly
        // call onStoreUpdate but never invalidate computeds that read that
        // path — DOM bindings stay on their stale cached values.
        //
        // Previously this happened only as a side effect of the tracking
        // proxy when a computed read store state during _evaluateComputedFull.
        // That path is unreliable: in Chrome, microtask ordering can leave
        // _currentIssue's first eval taking the early-return branch (before
        // the cross-store read), and subsequent re-evals can hit the
        // cross-RSM cache-hit fast path which doesn't re-track. Result was
        // the PM-demo blank-detail-pane bug on soft reload (Chrome only;
        // Firefox's timing happened to register pm consistently).
        //
        // The path-scoped invalidation gate (_entityPathAffectsDependent in
        // EntitySystem.js) checks `_storeSubscriptions` first, so this
        // registration doesn't widen the invalidation surface — only
        // mutations to subscribed paths will dirty the component's computeds.
        if (componentInstance && componentInstance.id && this.framework._registerEntityDependent) {
            this.framework._registerEntityDependent(store.id, componentInstance.id);
        }

        return true;
    }

    /**
     * Unsubscribe a component instance from a store path.
     * Called from component cleanup.
     *
     * @param {string} storeName - Name of the store
     * @param {string} path - Path within the store
     * @param {Object} componentInstance - The component to unsubscribe
     */
    unsubscribePath(storeName, path, componentInstance) {
        const store = this._namedStores.get(storeName);
        if (!store || !store._pathSubscribers) {
            return;
        }

        const subscribers = store._pathSubscribers.get(path);
        if (subscribers) {
            subscribers.delete(componentInstance);

            // Clean up empty sets
            if (subscribers.size === 0) {
                store._pathSubscribers.delete(path);
            }
        }

        // Update optimization flag
        store._hasPathSubscribers = store._pathSubscribers.size > 0;
    }

    /**
     * Get all path subscribers for a store and path.
     * Called from EntitySystem._handleEntityStateChange().
     *
     * @param {string} storeName - Name of the store
     * @param {string} path - Changed path
     * @returns {Set<Object>|null} Set of subscribed component instances, or null
     */
    getPathSubscribers(storeName, path) {
        const store = this._namedStores.get(storeName);
        if (!store || !store._hasPathSubscribers) {
            return null;
        }

        return store._pathSubscribers.get(path) || null;
    }

    /**
     * Check if a store has any path subscribers (for V8 optimization).
     *
     * @param {string} storeName - Name of the store
     * @returns {boolean} True if store has any path subscribers
     */
    hasPathSubscribers(storeName) {
        const store = this._namedStores.get(storeName);
        return store ? store._hasPathSubscribers : false;
    }

    /**
     * Unsubscribe a component from all store paths.
     * Called from component destroy cleanup.
     *
     * @param {Object} componentInstance - The component being destroyed
     */
    unsubscribeAllPaths(componentInstance) {
        // Check if component has tracked subscriptions
        if (!componentInstance._storeSubscriptions || componentInstance._storeSubscriptions.length === 0) {
            return;
        }

        // Unsubscribe from each tracked path
        for (const { storeName, path } of componentInstance._storeSubscriptions) {
            this.unsubscribePath(storeName, path, componentInstance);
        }

        // Clear the tracking array
        componentInstance._storeSubscriptions = [];
    }

    // =========================================================================
    // STORE-TO-STORE SUBSCRIPTIONS (subscribe: {} support for stores)
    // =========================================================================

    /**
     * Parse a subscribe declaration into normalized format.
     * Supports both array and object syntax:
     *   - ['store1', 'store2'] -> { store1: [], store2: [] }
     *   - { store1: ['path1'], store2: [] } -> as-is
     *
     * @param {Array|Object} subscribe - The subscribe declaration
     * @returns {Object} Normalized { storeName: [paths] } format
     * @private
     */
    _parseSubscribeDeclaration(subscribe) {
        if (!subscribe) return {};

        // Array syntax: ['store1', 'store2'] - wait only, no paths
        if (Array.isArray(subscribe)) {
            const result = {};
            for (const storeName of subscribe) {
                result[storeName] = [];
            }
            return result;
        }

        // Object syntax: { storeName: ['path1', 'path2'] }
        if (typeof subscribe === 'object') {
            return subscribe;
        }

        return {};
    }

    /**
     * Set up store-to-store subscriptions for a store instance.
     * Enables stores to use subscribe: {} and this.stores like components.
     *
     * @param {Object} instance - The store instance
     * @private
     */
    _setupStoreSubscriptions(instance) {
        const { definition, context } = instance;

        // Early exit if no subscribe declaration
        if (!definition.subscribe) {
            return;
        }

        // Parse the subscribe declaration
        const parsed = this._parseSubscribeDeclaration(definition.subscribe);

        // Initialize tracking array for cleanup on destroy
        instance._storeSubscriptions = instance._storeSubscriptions || [];

        // Track which stores this store subscribes to
        instance._subscribedStores = Object.keys(parsed);

        // Auto-inject store references into this.stores
        // Caching getter with two modes:
        //   1. During _evaluateComputedFull (tracking context set): return tracking
        //      proxy from getStore() for entity dependency registration. Don't cache.
        //   2. Outside tracking context: cache a LEAN store-read proxy that bypasses
        //      the full ContextProxy resolution chain (6 checks → 2 checks).
        //      The lean proxy only needs: computed check → direct state access.
        //      This eliminates one proxy layer from every cross-store property read.
        const self = this;
        for (const storeName of Object.keys(parsed)) {
            Object.defineProperty(context.stores, storeName, {
                get() {
                    const store = self.framework.getStore(storeName);
                    if (store && !self.framework._computedTrackingContext) {
                        // Cache a lean store-read proxy. Check order optimized for
                        // computed function hot path (state/computed reads are common,
                        // method access is rare):
                        //   1. Computed check (precedence over state)
                        //   2. State via reactive proxy (1 proxy trap — hot path)
                        //   3. Methods/framework props via rawContext (cold path)
                        const sm = store.stateManager;
                        if (sm) {
                            const storeState = sm._state;
                            const storeComputed = sm.computed;
                            const rawCtx = store[RAW_TARGET];
                            const leanProxy = new Proxy(storeState, {
                                get(target, prop, receiver) {
                                    if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
                                    // Computed takes precedence
                                    if (storeComputed && storeComputed[prop]) {
                                        return sm.evaluateComputed(prop);
                                    }
                                    // State read (hot path)
                                    return target[prop];
                                },
                                // has trap: support `prop in store` and `for..in`
                                has(target, prop) {
                                    if (storeComputed && storeComputed[prop]) return true;
                                    if (prop in target) return true;
                                    return false;
                                }
                            });
                            // Expose methods via defineProperty on the lean proxy itself
                            // so they're accessible without adding to the hot GET path
                            if (rawCtx) {
                                const methodNames = Object.keys(rawCtx).filter(k =>
                                    typeof rawCtx[k] === 'function' && k !== 'reset'
                                );
                                for (const methodName of methodNames) {
                                    Object.defineProperty(leanProxy, methodName, {
                                        value: rawCtx[methodName],
                                        enumerable: false,
                                        configurable: true
                                    });
                                }
                                // Also expose 'state' and 'stateManager' for explicit access
                                Object.defineProperty(leanProxy, 'state', {
                                    value: storeState,
                                    enumerable: false,
                                    configurable: true
                                });
                                Object.defineProperty(leanProxy, 'stateManager', {
                                    value: sm,
                                    enumerable: false,
                                    configurable: true
                                });
                            }
                            Object.defineProperty(context.stores, storeName, {
                                value: leanProxy,
                                writable: false,
                                enumerable: true,
                                configurable: true
                            });
                            return leanProxy;
                        }
                        // Fallback: cache the ContextProxy directly
                        Object.defineProperty(context.stores, storeName, {
                            value: store,
                            writable: false,
                            enumerable: true,
                            configurable: true
                        });
                    }
                    return store;
                },
                enumerable: true,
                configurable: true
            });
        }

        // Process each store subscription for path notifications
        for (const [storeName, paths] of Object.entries(parsed)) {
            const pathsArray = Array.isArray(paths) ? paths : [paths];

            // Subscribe to specific paths (empty array = no path notifications)
            for (const path of pathsArray) {
                if (path) {  // Skip empty strings
                    const success = this.subscribePath(storeName, path, instance);
                    if (success) {
                        instance._storeSubscriptions.push({ storeName, path });
                    }
                }
            }
        }
    }

    // NOTE: _createStoreComponentContext() has been removed
    // Stores now use the unified _createBaseEntityContext() from wildflowerJS.js
    // This eliminates duplicate code and ensures stores have the same context
    // capabilities as components.

    /**
     * Creates a named store
     *
     * UNIFIED ENTITY SYSTEM:
     * Store definitions now follow component patterns - methods at top level,
     * NOT in separate actions/methods blocks. Methods are bound BEFORE init()
     * so they're available during initialization.
     *
     * @example
     * // NEW (unified) - methods at top level like components:
     * wildflower.store('counter', {
     *   state: { count: 0 },
     *   increment() { this.state.count++; },  // Top level
     *   getCount() { return this.state.count; },  // Top level
     *   init() {
     *     this.increment();  // Works! Methods available in init
     *   }
     * });
     *
     * @param {string} name - Store name
     * @param {Object} config - Store configuration (methods at top level)
     * @returns {Object} - The store context for chaining
     */
    store(name, config = {}) {
        // Prevent overwriting existing stores
        if (this._namedStores && this._namedStores.has(name)) {
            return this._namedStores.get(name).context;
        }

        // Extract special properties from config
        // storageKey and autoSave enable localStorage persistence (like components)
        // subscribe and onStoreUpdate enable store-to-store subscriptions (like components)
        const { state, computed, init, storageKey, autoSave, subscribe, onStoreUpdate, ...methods } = config;

        // Format the store definition with methods at top level
        // Methods are extracted from config and added directly to definition
        const definition = {
            state: {
                ...state || {},
                _internal: {
                    ready: false
                }
            },
            computed: {...computed || {}},
            init: init,  // Pass init hook if provided
            storageKey: storageKey || null,  // localStorage key for persistence
            autoSave: autoSave || false,      // Auto-save on every state change
            subscribe: subscribe || null,     // Store-to-store subscriptions
            onStoreUpdate: onStoreUpdate || null,  // Store-to-store update handler
            ...methods  // All other properties are methods (bound before init)
        };

        const storeName = `store-${name}`;
        const store = this.createStoreComponent(storeName, definition);

        if (!store) {
            return null;
        }

        // NOTE: No longer need to manually bind actions/methods here
        // _bindEntityMethods() in createStoreComponent handles this BEFORE init()

        // Register in named stores
        if (!this._namedStores) {
            this._namedStores = new Map();
        }
        this._namedStores.set(name, store);

        // Helper to finalize store readiness
        const finalizeStore = () => {
            store.stateManager.setValue('_internal.ready', true);
            this._dispatchStoreReadyEvent(name);
            // Resolve any pending dependencies waiting for this store
            this._resolvePendingStoreDependencies(name);
        };

        // Check if init returned a Promise (async init)
        // The init was already called in createStoreComponent, but we need to
        // check if there's a pending async operation
        if (store._initPromise && typeof store._initPromise.then === 'function') {
            // Async init - wait for it to complete before marking ready
            store._initPromise
                .then(() => finalizeStore())
                .catch((error) => {
                    if (__DEV__) console.error(`[WF] Store '${name}' init failed:`, error);
                    // Still mark as ready so waiting components don't hang forever
                    finalizeStore();
                });
        } else {
            // Synchronous init - mark ready immediately
            finalizeStore();
        }

        return store.context;
    }

    /**
     * Get a named store created with store()
     * @param {string} name - Store name (without 'store-' prefix)
     * @returns {Object|null} - The store context or null if not found
     */
    getStoreByName(name) {
        if (!this._namedStores || !this._namedStores.has(name)) {
            return null;
        }
        return this._namedStores.get(name).context;
    }

    /**
     * Get a store component by name
     * @param {string} name - Component name
     * @returns {Object|null} - The first store component with the given name
     */
    getStoreComponentByName(name) {
        if (!this._virtualComponents) return null;

        // Look for exact match first
        const exactMatch = Array.from(this._virtualComponents.values())
            .find(component => component.name === name);

        if (exactMatch) return exactMatch;

        // Try with store- prefix if not found
        if (!name.startsWith('store-')) {
            const prefixedName = `store-${name}`;
            return Array.from(this._virtualComponents.values())
                .find(component => component.name === prefixedName);
        }

        return null;
    }

    /**
     * Get a store by name
     * @param {string} name - Store name, defaults to app-store
     * @returns {Object} - The store context (may be wrapped in tracking proxy during computed evaluation)
     */
    getStore(name = 'app-store') {
        // Check named stores
        let storeContext = null;
        let storeId = null;

        if (this._namedStores && this._namedStores.has(name)) {
            const storeData = this._namedStores.get(name);
            storeContext = storeData.context;
            storeId = storeData.id;
        } else {
            // Check store components
            const store = this.getStoreComponentByName(name) ||
                this.getStoreComponentByName(`store-${name}`);
            if (store) {
                storeContext = store.context;
                storeId = store.id;
            }
        }

        if (!storeContext) return null;

        // AUTOMATIC DEPENDENCY TRACKING: If we're inside a computed property evaluation,
        // use the shared tracking proxy to automatically register dependencies
        if (this.framework._computedTrackingContext && storeId) {
            // CROSS-ENTITY REACTIVITY: Mark this computed as having external dependencies.
            // This ensures it will always re-evaluate (skip stale check optimization) since
            // the dirty flag mechanism only works within a single stateManager.
            const trackingContext = this.framework._computedTrackingContext;
            if (trackingContext.stateManager && trackingContext.computedName) {
                const sm = trackingContext.stateManager;
                if (!sm._computedsWithExternalDeps) {
                    sm._computedsWithExternalDeps = new Set();
                }
                sm._computedsWithExternalDeps.add(trackingContext.computedName);
            }
            return this.framework._createEntityTrackingProxy(storeContext, storeId, name, 'store');
        }

        return storeContext;
    }

    /**
     * Create the default app-store
     */
    createDefaultStore() {
        // Get default store configuration from options
        const customConfig = this.framework.options.defaultStore || {};

        // Merge with default structure
        const defaultState = {
            _internal: {
                ready: false
            }
        };

        // Create merged state
        const state = this._mergeStoreState(defaultState, customConfig.state || {});

        // Create the store
        const store = this.createStoreComponent('app-store', {
            state,
            computed: customConfig.computed || {}
        });

        if (!store) {
            this.framework._error(WF_ERRORS.STORE_DEFAULT_ERROR, {
                suggestion: 'Check the store configuration for errors'
            });
            return null;
        }

        // Register the store
        if (!this._namedStores) {
            this._namedStores = new Map();
        }
        this._namedStores.set('app-store', store);

        // Mark as ready and notify
        store.stateManager.setValue('_internal.ready', true);
        this._dispatchStoreReadyEvent('app-store');

        return store;
    }

    /**
     * Helper to deep merge store states preserving structure
     * @private
     */
    _mergeStoreState(defaultState, customState) {
        const result = {...defaultState};

        Object.entries(customState).forEach(([key, value]) => {
            // If both are objects, merge recursively
            if (
                value !== null &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                result[key] !== null &&
                typeof result[key] === 'object' &&
                !Array.isArray(result[key])
            ) {
                result[key] = this._mergeStoreState(result[key], value);
            } else {
                // Otherwise replace
                result[key] = value;
            }
        });

        return result;
    }

    /**
     * Dispatch a store ready event
     * @private
     */
    _dispatchStoreReadyEvent(storeName) {
        const event = new CustomEvent('wildflower:store-ready', {
            bubbles: true,
            detail: {storeName}
        });
        document.dispatchEvent(event);
    }

    /**
     * Wait for a store to be ready with optional timeout.
     * Used by components with subscribe declarations.
     *
     * @param {string} storeName - Name of the store to wait for
     * @param {number} timeout - Timeout in ms (0 = wait indefinitely)
     * @returns {Promise<{ready: boolean, timedOut: boolean}>}
     */
    waitForStoreReady(storeName, timeout = 5000) {
        return new Promise((resolve) => {
            const store = this._namedStores.get(storeName);

            // Store doesn't exist
            if (!store) {
                resolve({ ready: false, timedOut: false, error: 'not_found' });
                return;
            }

            // Already ready
            if (!store.state._internal || store.state._internal.ready !== false) {
                resolve({ ready: true, timedOut: false });
                return;
            }

            // Need to wait for ready
            let timeoutId = null;
            let resolved = false;

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                document.removeEventListener('wildflower:store-ready', onStoreReady);
            };

            const onStoreReady = (event) => {
                if (event.detail.storeName === storeName && !resolved) {
                    resolved = true;
                    cleanup();
                    resolve({ ready: true, timedOut: false });
                }
            };

            // Listen for store ready event
            document.addEventListener('wildflower:store-ready', onStoreReady);

            // Set timeout (unless timeout is 0, which means wait indefinitely)
            if (timeout > 0) {
                timeoutId = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        cleanup();
                        resolve({ ready: false, timedOut: true });
                    }
                }, timeout);
            }

            // Poll as fallback: the store-ready event can be missed if the store's
            // init() resolves synchronously before the listener is attached
            const pollInterval = setInterval(() => {
                if (resolved) {
                    clearInterval(pollInterval);
                    return;
                }
                if (!store.state._internal || store.state._internal.ready !== false) {
                    resolved = true;
                    cleanup();
                    clearInterval(pollInterval);
                    resolve({ ready: true, timedOut: false });
                }
            }, 50);

            // Cleanup poll on timeout/ready
            if (timeout > 0) {
                setTimeout(() => clearInterval(pollInterval), timeout + 100);
            }
        });
    }

    /**
     * Apply any store updates that were queued during initialization
     * @private
     */
    _applyPendingStoreUpdates() {
        // Use the framework's pending updates or our local ones
        const updates = this.framework._pendingStoreUpdates || this._pendingStoreUpdates;

        if (!updates || updates.length === 0) {
            return;
        }

        // Process each pending update
        updates.forEach(update => {
            const {store, path, value} = update;

            // Find the store - completely generic lookup
            let storeComponent = null;

            if (this._namedStores && this._namedStores.has(store)) {
                storeComponent = this._namedStores.get(store);
            } else {
                storeComponent = this.getStoreComponentByName(`store-${store}`) ||
                    this.getStoreComponentByName(store);
            }

            // If store exists and is ready, apply the update
            if (storeComponent && (!storeComponent.state._internal ||
                storeComponent.state._internal.ready)) {
                storeComponent.stateManager.setValue(path, value);
            } else {
                if (__DEV__) console.warn(`Cannot apply pending update to store "${store}" (not found or not ready)`);
            }
        });

        // Clear the pending updates from both places
        if (this.framework._pendingStoreUpdates) {
            this.framework._pendingStoreUpdates = [];
        }
        this._pendingStoreUpdates = [];
    }

    /**
     * Process early store accesses for diagnostic purposes
     * @private
     */
    _processEarlyStoreAccesses() {
        // Use framework's early accesses or our local ones
        const earlyAccesses = this.framework._earlyStoreAccesses || this._earlyStoreAccesses;

        if (!earlyAccesses || earlyAccesses.size === 0) {
            return;
        }

        if (__DEV__) console.warn(`${earlyAccesses.size} store properties were accessed before stores were ready`);

        // Clear early accesses from both places
        if (this.framework._earlyStoreAccesses) {
            this.framework._earlyStoreAccesses.clear();
        }
        this._earlyStoreAccesses.clear();
    }
}

// Browser global exports for backward compatibility
if (typeof window !== 'undefined') {
    window.StoreManager = StoreManager;
}