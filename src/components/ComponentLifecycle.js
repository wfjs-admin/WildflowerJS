/**
 * ComponentLifecycle - Initialization, lifecycle hooks, destruction
 *
 * @module
 */

import { createStateManager } from '../state/createStateManager.js';
import { RAW_TARGET } from '../state/ContextProxy.js';
import { objectUtils, pathResolver, wfError, WF_ERRORS } from '../core/wfUtils.js';

// Named constants (replaces magic numbers)
const LARGE_ARRAY_THRESHOLD = 500;     // Arrays above this size use synchronous render
const READY_POLL_INTERVAL_MS = 10;     // Polling interval for waitForReady()
const READY_TIMEOUT_MS = 10000;        // Wall-clock timeout for waitForReady() (NOT poll count)
const STALE_DEPENDENCY_MS = 30000;     // Deferred dependencies older than this are dropped (cross-component/store dep resolution)

// Methods the framework drives directly via instance.context.X(). These bypass
// the action-before-init queue in _wrapMethod; queueing init() itself would
// deadlock _initReady, and other lifecycle hooks must fire at framework-known
// points regardless of init state.
const LIFECYCLE_HOOK_NAMES = new Set([
    'init', 'beforeInit',
    'destroy', 'beforeDestroy',
    'onUpdate', 'beforeUpdate',
    'onError',
    'tick'
]);

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const ComponentLifecycleMethods = {
    /**
     * Return a heuristic fallback value based on property name patterns.
     * Boolean-ish names → false, plural names → [], else null.
     * @private
     */
    _getStoreFallbackValue(propertyName) {
        if (/^(is|has|should|can|will|did)/i.test(propertyName) ||
            /(enabled|active|ready|visible|selected|checked|valid|loading)$/i.test(propertyName)) {
            return false;
        }
        if (/s$/.test(propertyName) && !/(ss|us|is|os)$/i.test(propertyName)) {
            return [];
        }
        return null;
    },

    /**
     * Queue a store update for later application when the store becomes ready.
     * @private
     */
    _queueStoreUpdate(storeName, path, value) {
        if (!this._pendingStoreUpdates) this._pendingStoreUpdates = [];
        this._pendingStoreUpdates.push({ store: storeName, path, value });
    },

/**
     * Initialize all DOM elements for a given component type
     * @param {string} componentName - The component name
     * @private
     */
    _initializeComponentElements(componentName)
    {
        // Find all elements with matching data-component attribute
        const elements = this.root.querySelectorAll(`[data-component="${componentName}"]:not([data-component-id])`);

        elements.forEach(element =>
        {
            this._initializeComponentElement(element, componentName);
        });
    },
    /**
     * Initialize a single component element.
     * Creates instance via _createComponentCore, then runs post-init lifecycle
     * (deferred reactive updates, initial render, ready hook).
     *
     * @param {HTMLElement} element - The DOM element with data-component attribute
     * @param {string} componentName - The registered component definition name
     * @param {HTMLElement} [parentElement=null] - Optional parent element for hierarchy
     * @returns {Object|null} The initialized component instance, or null if definition not found
     * @private
     */
    _initializeComponentElement(element, componentName, parentElement = null)
    {
        // SSR: Prepare element if it has data-ssr="true" (late-registered components
        // miss the page-load SSR preparation pass, so we handle it here)
        const isSSR = __FEATURE_SSR__ && this.ssrManager && element.hasAttribute('data-ssr') && element.getAttribute('data-ssr') === 'true';
        if (isSSR) {
            this._prepareSSRElement(element);
        }

        // Use core to create the component instance
        const instance = this._createComponentCore(element, componentName, {
            parentElement,
            ssrEnhance: isSSR
        });
        if (!instance) return null;

        const { definition, context, stateManager, id: instanceId } = instance;

        // Track that this component is initializing (for deferred updates)
        this._initializingComponentIds.add(instanceId);

        // Add modal close method if applicable
        // Only if modal system is included (not in lite build)
        if (this._addModalCloseMethod) {
            this._addModalCloseMethod(element, context, instanceId);
        }

        // Inject store references early so they're available in computed properties and beforeInit
        this._injectStoreReferences(instance);

        // Declarative store subscriptions MUST run before computed setup.
        // addComputed enqueues initial evals via microtask; if subscribePath
        // ran after that, store mutations between the two could miss the
        // component as a cascade target. The async scanner has the same
        // ordering invariant (see ComponentScanning.js pre-pass). The
        // idempotency guard inside _setupStoreSubscriptions makes any
        // later call from the same init flow a no-op.
        this._setupStoreSubscriptions(instance);

        // Setup computed properties with error handling
        this._setupComputedProperties(definition, context, stateManager, componentName, instanceId);

        // Call beforeInit hook (after methods bound, before bindings processed)
        this._callBeforeInitHook(instance, componentName);

        // Setup watchers, slots, bindings, actions
        this._setupWatchers(instance);
        this._processSlots(instance);
        // Register item templates if configurable templates feature is included
        if (this._registerItemTemplates) {
            this._registerItemTemplates(instance, element);
        }
        // Process slot templates (data-use-template with data-with outside of lists)
        if (this._processSlotTemplates) {
            this._processSlotTemplates(instance);
        }
        // Process polymorphic templates (data-template-key) BEFORE bindings
        // because template insertion adds the DOM that bindings need to find
        if (this._processPolymorphicTemplates) {
            this._processPolymorphicTemplates(instance);
        }
        this._processComponentBindings(instance);
        this._bindComponentActions(instance);
        // Set up entity pools (data-pool): handles declarative pools block + population
        if (this._setupPools) {
            this._setupPools(instance);
        }

        // Process custom directives (only when plugin system is available)
        if (this._processCustomDirectivesInSubtree) {
            this._processCustomDirectivesInSubtree(element, instance);
        }

        // Defer init hook to separate macrotask for TBT optimization
        // This allows browser to paint/handle input between framework work and user code
        // Plugin hooks are also deferred to maintain correct semantics (beforeInit fires right before init)
        // If component subscribes to stores, wait for them before calling init
        setTimeout(() => {
            this._initWithStoreWait(instance, componentName, definition);
        }, 0);

        // Dispatch component init event
        document.dispatchEvent(new CustomEvent('wildflower:componentInit', {
            detail: { instance, context: instance.context }
        }));

        // Process portals (teleport content to target locations)
        // Only if portal system is included (not in lite build)
        if (this._processPortals) {
            this._processPortals(instance);
        }

        // Setup list contexts and schedule render
        this._setupListContexts(instance);
        this._scheduleInitialRender(instanceId);

        // SSR: Complete integration and schedule activation for late-registered SSR components
        if (__FEATURE_SSR__ && isSSR) {
            this._completeSingleSSRIntegration(instance);
            setTimeout(() => {
                this.ssrManager.activateComponent(element);
            }, 0);
        }

        // Finalize initialization
        this._finishComponentInitialization(instanceId);

        // Strip data-cloak from the just-initialized subtree. By this point the
        // render effect's first synchronous run has written display:none for any
        // false data-show binding, so removing the cloak attribute is safe. This
        // is the late-registration counterpart to the framework-init and SPA-scan
        // cloak-strip rAFs: when a defer-loaded script registers a component
        // after framework init, those passes saw the element with no
        // data-component-id and deferred. We pick up the deferred work here, plus
        // the element itself in case it was registered as the cloak host.
        if (this._stripCloakWithVerdict) {
            if (element.hasAttribute('data-cloak')) {
                this._stripCloakWithVerdict(element);
            }
            element.querySelectorAll('[data-cloak]').forEach(el => {
                this._stripCloakWithVerdict(el);
            });
        }

        return instance;
    },
    /**
     * Find parent component for hierarchy tracking
     * @private
     */
    _findParentComponent(element, parentElement) {
        let parentInstance = null;
        let parentId = null;

        if (!parentElement) {
            parentElement = this._getComponentElement(element.parentElement);
        }

        if (parentElement && parentElement.dataset.componentId) {
            parentId = parentElement.dataset.componentId;
            parentInstance = this.componentInstances.get(parentId);
        }

        return { parentInstance, parentId };
    },
    /**
     * Create reactive state manager for component
     * @private
     */
    _createComponentStateManager(instanceId, componentName, element) {
        return createStateManager({
            onStateChange: (path, newValue, oldValue) => {
                this._handleEntityStateChange(instanceId, path, newValue, oldValue);
            },
            wf: this,
            storageKey: element.dataset.storageKey || null,
            autoSave: element.hasAttribute('data-auto-save'),
            component: { id: instanceId, name: componentName }
        });
    },
    /**
     * Setup computed properties with enhanced context
     * @private
     */
    _setupComputedProperties(definition, context, stateManager, componentName, instanceId) {
        if (!definition.computed) return;

        // Store reference to framework for error handling in closures
        const framework = this;

        // Helper to handle computed errors, with direct context/definition access for early errors
        // Note: _bindMethods hasn't run yet, so context.onError won't exist
        // We check definition.onError directly for errors during initial computed evaluation
        const handleComputedError = (propName, error) => {
            // First try to get instance (may not exist during initial computation)
            const instance = framework.componentInstances.get(instanceId);

            // Check if context.onError exists (it won't if _bindMethods hasn't run yet)
            const contextOnErrorBound = instance && typeof instance.context.onError === 'function';

            if (instance && contextOnErrorBound) {
                // Instance exists and onError is bound - use normal error handling
                framework._handleError(
                    `Error in computed property '${propName}'`,
                    error,
                    instance,
                    { lifecycle: 'computed', computedName: propName }
                );
            } else if (typeof definition.onError === 'function') {
                // Either no instance yet, or onError not yet bound
                // Call definition.onError directly, bound to context
                try {
                    const handled = definition.onError.call(context, error, {
                        lifecycle: 'computed',
                        computedName: propName
                    });
                    if (handled !== true && handled !== undefined) {
                        if (__DEV__) console.warn(`Error in computed property ${propName}:`, error);
                    }
                } catch (handlerError) {
                    if (__DEV__) console.error('Error in onError handler:', handlerError);
                }
            } else {
                // No instance/onError - just log
                if (__DEV__) console.warn(`Error in computed property ${propName}:`, error);
            }
        };

        try {
            const enhancedComputedProps = {};

            // Store original functions for use in list item context (computed:propName in lists)
            if (!stateManager._originalComputedFunctions) {
                stateManager._originalComputedFunctions = new Map();
            }

            Object.entries(definition.computed).forEach(([name, fn]) => {
                // Store the original function for list context use
                stateManager._originalComputedFunctions.set(name, fn);

                // Item-level computeds (fn.length > 0) need list item context
                // They can't be evaluated at component level - only via _evaluateComputedInListContext
                const isItemLevel = fn.length > 0;

                enhancedComputedProps[name] = function() {
                    try {
                        if (isItemLevel) {
                            // Item-level computed: can't evaluate without item context
                            // Return undefined - actual evaluation happens in list context
                            return undefined;
                        }
                        return fn.call(context);
                    } catch (error) {
                        if (error.isCircularDependency || error.name === 'CircularDependencyError') {
                            throw error;
                        }
                        handleComputedError(name, error);
                        // Re-throw to let evaluateComputed cache ERRORED state
                        // This enables the TC39 Signals pattern of error caching
                        throw error;
                    }
                };
            });

            stateManager.addComputed(enhancedComputedProps);

            // Force initial computation to establish dependencies
            // Skip item-level computeds (those with fn.length > 0) - they need item context
            Object.keys(stateManager.computed).forEach(propName => {
                try {
                    // Skip item-level computeds - they can't be evaluated at component level
                    const originalFn = stateManager._originalComputedFunctions?.get(propName);
                    if (originalFn && originalFn.length > 0) {
                        return; // Item-level computed, skip initial evaluation
                    }
                    stateManager.evaluateComputed(propName);
                } catch (error) {
                    handleComputedError(propName, error);
                }
            });
        } catch (error) {
            this._handleError(`Error initializing computed properties for ${componentName}`, error, null);
        }
    },
    /**
     * Find list item data for a component element.
     * Traverses up the DOM to find _itemData, stopping at component boundaries.
     *
     * This enables the `this.listItem` API for components rendered inside lists.
     * The component's listItem property will be set to the data object for the
     * list item it's rendered in, or null if not in a list.
     *
     * @param {HTMLElement} element - The component's root element
     * @returns {Object|null} The list item data, or null if not in a list
     * @private
     */
    _findListItemForComponent(element) {
        // First check if the element itself has _itemData (component IS the list item root)
        if (element._itemData !== undefined) {
            return element._itemData;
        }

        // Otherwise traverse up to find the nearest list item ancestor
        // This handles the case where component is nested inside the list item template
        let current = element.parentElement;
        while (current && current !== document.body) {
            // Stop at component boundaries - if we hit another component,
            // we've left our context and shouldn't inherit its list item data.
            // Check both data-component-id (initialized components) and
            // data-component (not yet initialized, but still a boundary)
            if (current.dataset && (current.dataset.componentId || current.dataset.component)) {
                return null;
            }

            // Found a list item with data
            if (current._itemData !== undefined) {
                return current._itemData;
            }

            current = current.parentElement;
        }

        return null;
    },
    /**
     * Create the component instance object
     * @private
     */
    _createComponentInstance(params) {
        const { instanceId, componentName, element, state, stateManager,
                definition, parentInstance, context } = params;

        // Infer types from initial state values and merge with explicit types
        // (dev-only: inferred types feed _checkTypeMatch, which is stripped from prod)
        const inferredTypes = __DEV__ ? this._inferTypesFromState(state) : {};
        const explicitTypes = definition.types || {};
        const types = { ...inferredTypes, ...explicitTypes }; // Explicit types override inferred

        // Get list item data if this component is rendered inside a list
        // This enables the `this.listItem` API - available in beforeInit() and all lifecycle methods
        const listItem = this._findListItemForComponent(element);

        return {
            id: instanceId,
            name: componentName,
            element,
            state,
            stateManager,
            definition,
            parent: parentInstance,
            children: [],
            context,
            listItem,  // List item data for components rendered inside lists (null if not in a list)
            _isInitialSetup: true,
            _htmlContextsReady: new Set(),
            _hasRendered: false,
            _itemTemplates: new Map(),  // Configurable Component Templates - stores parent-defined templates
            _inferredTypes: inferredTypes,  // Types inferred from initial state values
            _types: types                   // Combined types (explicit overrides inferred)
        };
    },
    /**
     * Register component in the context registry system
     * @private
     */
    _registerComponentInContextSystem(instance, parentInstance, parentId, element, componentName) {
        this._componentsToUpdate.add(instance.id);

        if (!this._contextSystemInitialized) return;

        // Component contexts are no longer created; emit() bubbles via the DOM
        // ancestry (not a maintained context tree), and the public `this.context`
        // API is independent of the CM Context object. Only the deferred-dependency
        // drain remains here.

        // Process deferred dependencies
        if (this._deferredDependencies && this._deferredDependencies.length > 0) {
            this._processDeferredDependencies();
        }
    },
    /**
     * Setup parent/child hierarchy tracking
     * @private
     */
    _setupHierarchyTracking(instanceId, parentId, parentInstance, instance) {
        if (!parentId) return;

        this.componentParents.set(instanceId, parentId);

        if (!this.componentChildren.has(parentId)) {
            this.componentChildren.set(parentId, []);
        }
        this.componentChildren.get(parentId).push(instanceId);

        if (parentInstance) {
            parentInstance.children.push(instance);
        }
    },
    /**
     * Call the beforeInit lifecycle hook (before bindings are processed)
     * @private
     */
    _callBeforeInitHook(instance, componentName) {
        if (typeof instance.context.beforeInit !== 'function') return;

        try {
            instance.context.beforeInit();
        } catch (error) {
            this._handleError(
                `Error in ${componentName}.beforeInit`,
                error,
                instance,
                { lifecycle: 'beforeInit' }
            );
        }
    },
    /**
     * Call the init lifecycle hook
     * @private
     */
    _callInitHook(instance, componentName) {
        if (typeof instance.context.init !== 'function') return;

        try {
            instance.context.init();
        } catch (error) {
            this._handleError(
                `Error in ${componentName}.init`,
                error,
                instance,
                { lifecycle: 'init' }
            );
        }
    },
    /**
     * Initialize component with store waiting support.
     * If the component subscribes to stores, waits for them to be ready before calling init().
     *
     * @param {Object} instance - Component instance
     * @param {string} componentName - Component name
     * @param {Object} definition - Component definition
     * @private
     */
    async _initWithStoreWait(instance, componentName, definition) {
        // Check if component was destroyed while waiting
        if (!this.componentInstances.has(instance.id)) {
            return;
        }

        // Get subscribed store names
        const storeNames = instance._subscribedStores || [];

        if (storeNames.length > 0) {
            // Get timeout from component definition or global config
            const timeout = definition.subscribeTimeout !== undefined
                ? definition.subscribeTimeout
                : (this.options.subscribeTimeout || 5000);

            // Wait for all stores
            const results = await Promise.all(
                storeNames.map(storeName =>
                    this.storeManager.waitForStoreReady(storeName, timeout)
                        .then(result => ({ storeName, ...result }))
                )
            );

            // Check if component was destroyed while waiting
            if (!this.componentInstances.has(instance.id)) {
                return;
            }

            // Handle results
            for (const result of results) {
                if (result.error === 'not_found') {
                    // Store doesn't exist - this is an error
                    const error = new Error(`Store '${result.storeName}' not found`);
                    error.storeName = result.storeName;
                    error.type = 'subscribe_store_not_found';

                    if (__DEV__) console.error(`[WF] Component '${componentName}' subscribes to store '${result.storeName}' which does not exist`);

                    // Call onError if defined
                    if (typeof instance.context.onError === 'function') {
                        try {
                            instance.context.onError(error, { lifecycle: 'subscribe-wait' });
                        } catch (e) {
                            if (__DEV__) console.error('[WF] Error in onError handler:', e);
                        }
                    }

                    // Continue with init anyway (best effort)
                    continue;
                }

                if (result.timedOut) {
                    // Store exists but didn't become ready in time
                    if (__DEV__) console.warn(`[WF] Component '${componentName}' timed out waiting for store '${result.storeName}' (${timeout}ms)`);

                    const error = new Error(`Timeout waiting for store '${result.storeName}'`);
                    error.storeName = result.storeName;
                    error.type = 'subscribe_timeout';
                    error.timeout = timeout;

                    // Call onError if defined
                    if (typeof instance.context.onError === 'function') {
                        try {
                            instance.context.onError(error, { lifecycle: 'subscribe-wait' });
                        } catch (e) {
                            if (__DEV__) console.error('[WF] Error in onError handler:', e);
                        }
                    }

                    // Continue with init anyway (timeout means "proceed anyway")
                }
            }
        }

        // Check one more time if component was destroyed
        if (!this.componentInstances.has(instance.id)) {
            return;
        }

        // Now call the actual init sequence
        // Trigger plugin beforeInit hook (right before init runs)
        if (this._triggerHook) {
            this._triggerHook('component:beforeInit', instance);
        }
        this._callInitHook(instance, componentName);

        // Mark init complete and replay any queued action calls. Actions
        // bound at the synchronous mount step (ComponentLifecycle.js:127)
        // can fire before the deferred init() runs, for example, a click
        // dispatched in the same task as mount, or while waiting for a
        // subscribed store. _wrapMethod queues those calls; we replay them
        // here so they observe the post-init state the user expected.
        instance._initReady = true;
        if (instance._pendingActions && instance._pendingActions.length > 0) {
            const queued = instance._pendingActions;
            instance._pendingActions = null;
            for (let i = 0; i < queued.length; i++) {
                // init() (or an earlier replayed action) may have destroyed this
                // component. Don't replay queued actions against a torn-down
                // instance; its effects are disposed and handlers removed. The
                // pre-init guard above only covers destruction BEFORE init runs.
                if (!this.componentInstances.has(instance.id)) break;
                try {
                    queued[i]();
                } catch (e) {
                    // Route through _handleError so the component's onError
                    // hook can intercept (matching the contract for any other
                    // method invocation). Without this, replayed actions that
                    // throw would be silently swallowed in production.
                    this._handleError(
                        `Error replaying queued action for component ${instance.name}`,
                        e,
                        instance,
                        { lifecycle: 'replay-pending-action' }
                    );
                }
            }
        }

        // Register tick lifecycle hook if defined
        if (typeof instance.definition.tick === 'function') {
            instance._tickFn = instance.definition.tick.bind(instance.context);
            if (!this._tickableInstances) this._tickableInstances = [];
            this._tickableInstances.push(instance);
            this._startPoolLoop();
        }

        // Process portals created dynamically in init()
        if (this._processPortals) {
            this._processPortals(instance);
        }

        // Refresh render effect to include deferred bindings from init/portals.
        // Portal content is teleported outside the component tree, so the init-time
        // effect scan misses it. Non-portal DOM created in init() is also missed
        // because _processBindingElements runs before the deferred init().
        const portalMeta = instance._deferredEffectMeta;
        instance._deferredEffectMeta = null;
        if (portalMeta?.length) {
            if (this._createComponentRenderEffect && this._collectComponentBindingMeta) {
                // Re-scan component DOM (catches original + any non-portal init bindings)
                const domMeta = this._collectComponentBindingMeta(instance);
                const allMeta = [...domMeta, ...portalMeta];
                if (allMeta.length > 0) {
                    if (this._disposeComponentRenderEffect) {
                        this._disposeComponentRenderEffect(instance);
                    }
                    instance._effectMeta = allMeta;
                    this._createComponentRenderEffect(instance);
                }
            }
        }

        // Trigger plugin afterInit hook
        if (this._triggerHook) {
            this._triggerHook('component:afterInit', instance);
        }
    },
    /**
     * Call the beforeUpdate lifecycle hook (before DOM updates)
     * Like Vue, no parameters - use watchers for specific property changes
     * @private
     */
    _callBeforeUpdateHook(instance) {
        if (typeof instance.context.beforeUpdate !== 'function') return;

        try {
            instance.context.beforeUpdate();
        } catch (error) {
            this._handleError(
                `Error in ${instance.name}.beforeUpdate`,
                error,
                instance,
                { lifecycle: 'beforeUpdate' }
            );
        }
    },
    /**
     * Call the onUpdate lifecycle hook (after DOM updates)
     * Like Vue, no parameters - use watchers for specific property changes
     * @private
     */
    _callOnUpdateHook(instance, changeInfo = null) {
        // Trigger component's onUpdate callback
        if (typeof instance.context.onUpdate === 'function') {
            try {
                if (changeInfo) {
                    instance.context.onUpdate(changeInfo.path, changeInfo.newValue, changeInfo.oldValue);
                } else {
                    instance.context.onUpdate();
                }
            } catch (error) {
                this._handleError(
                    `Error in ${instance.name}.onUpdate`,
                    error,
                    instance,
                    { lifecycle: 'onUpdate' }
                );
            }
        }

        // Trigger plugin afterUpdate hook (only if plugin system is loaded)
        if (this._triggerHook) {
            if (changeInfo) {
                this._triggerHook('component:afterUpdate', instance, changeInfo);
            } else if (instance._lastChangeInfo) {
                this._triggerHook('component:afterUpdate', instance, instance._lastChangeInfo);
                instance._lastChangeInfo = null;  // Use null instead of delete to preserve V8 hidden class
            }
        }
    },
    /**
     * Schedule onUpdate hook to be called after async render completes
     * @private
     */
    _scheduleOnUpdateHook(instance) {
        const hasOnUpdate = typeof instance.context.onUpdate === 'function';
        // Check for lifecycle hooks (the hook system ships in every build)
        const hasPluginHooks = this._hooks &&
            this._hooks.has('component:afterUpdate') &&
            this._hooks.get('component:afterUpdate').length > 0;

        // Skip if no callbacks needed. Release _lastChangeInfo first: with no
        // consumer it would otherwise retain its `oldValue` (e.g. a cleared
        // list's entire old array, and through each item's graph nodes its
        // directWriter closures + detached row elements) until the next change.
        if (!hasOnUpdate && !hasPluginHooks) { instance._lastChangeInfo = null; return; }

        // Use requestAnimationFrame to ensure DOM has been updated
        requestAnimationFrame(() => {
            this._callOnUpdateHook(instance, instance._lastChangeInfo);
            instance._lastChangeInfo = null; // consumed, release oldValue
        });
    },
    /**
     * Call the beforeDestroy lifecycle hook (before cleanup starts)
     * @private
     */
    _callBeforeDestroyHook(instance) {
        if (typeof instance.context.beforeDestroy !== 'function') return;

        try {
            instance.context.beforeDestroy();
        } catch (error) {
            this._handleError(
                `Error in ${instance.name}.beforeDestroy`,
                error,
                instance,
                { lifecycle: 'beforeDestroy' }
            );
        }
    },
    /**
     * Schedule initial render for component
     * @private
     */
    _scheduleInitialRender(instanceId) {
        this._initialRenderQueue.add(instanceId);

        this._componentsToUpdate.add(instanceId);

        if (!this._initialRenderScheduled) {
            this._initialRenderScheduled = true;
            setTimeout(() => {
                this._initialRenderScheduled = false;
                this._performInitialRender();
                // If new components were added during render, schedule another pass
                if (this._initialRenderQueue && this._initialRenderQueue.size > 0 && !this._initialRenderScheduled) {
                    this._initialRenderScheduled = true;
                    setTimeout(() => {
                        this._initialRenderScheduled = false;
                        if (this._initialRenderQueue.size > 0) {
                            this._performInitialRender();
                        }
                    }, 0);
                }
            }, 0);
        }
    },
    /**
     * Complete component initialization and process deferred reactive updates
     * @param {string} instanceId - The component instance ID
     * @private
     */
    _finishComponentInitialization(instanceId) {
        // Remove from initializing set
        this._initializingComponentIds.delete(instanceId);

        // Clear initial setup flag for HTML flash fix
        const instance = this.componentInstances.get(instanceId);
        if (instance) {
            instance._isInitialSetup = false;
        }

        // Process any deferred reactive updates
        if (this._deferredReactiveUpdates.has(instanceId)) {
            const deferredUpdates = this._deferredReactiveUpdates.get(instanceId);

            // Process each deferred update
            deferredUpdates.forEach(({path, newValue, oldValue}) => {
                // Call the unified entity state change handler now that initialization is complete
                this._handleEntityStateChange(instanceId, path, newValue, oldValue);
            });

            // Clear the deferred updates for this component
            this._deferredReactiveUpdates.delete(instanceId);
        }
    },
    _performInitialRender()
    {
        this._initialRenderScheduled = false;

        if (!this._initialRenderQueue || this._initialRenderQueue.size === 0) {
            return;
        }

        // CRITICAL: Snapshot the queue before processing
        // New components may be added during render (e.g., components inside list items)
        // We must not lose those - they need their own render pass
        const queueSnapshot = new Set(this._initialRenderQueue);

        // Mount lists discovered since the last pass (dynamically scanned
        // components' lists mount here, not in _render's sweep)
        this._mountLists(this.domElements.lists);

        // Render all queued components
        this._render();

        // Process any deferred dependencies after initial component setup
        if (this._contextSystemInitialized && this._deferredDependencies && this._deferredDependencies.length > 0)
        {
            this._processDeferredDependencies();
        }

        // Remove only the components we processed from the queue
        // New components added during render remain in the queue
        queueSnapshot.forEach(id => this._initialRenderQueue.delete(id));

        // If new components were added during render, schedule another pass
        if (this._initialRenderQueue.size > 0) {
            this._initialRenderScheduled = true;
            setTimeout(() => {
                this._performInitialRender();
            }, 0);
        }
    },
// BASE ENTITY CONTEXT CREATION
    /**
     * Create a base context shared by all reactive entities (components, stores, plugins).
     * This provides the common functionality that all entity types need.
     * @param {string} entityId - Unique identifier for the entity
     * @param {Object} state - The reactive state proxy
     * @param {ReactiveStateManager} stateManager - The state manager instance
     * @param {Object} options - { type: 'component'|'store'|'plugin' }
     * @returns {Object} Base context object
     * @private
     */
    _createBaseEntityContext(entityId, state, stateManager, options = {}) {
        const framework = this;
        const entityType = options.type || 'entity';

        const baseContext = {
            // Direct references
            id: entityId,
            state,
            stateManager,  // Expose stateManager for cross-component reactivity tracking

            // Computed property access via proxy
            // Tracks computed-to-computed dependencies for nested computed chains
            computed: new Proxy({}, {
                get: (target, prop) => {
                    // Guard: skip Symbols to prevent "can't convert symbol to string" errors
                    if (typeof prop !== 'string') {
                        return undefined;
                    }
                    return stateManager.evaluateComputed(prop);
                }
            }),

            // State modification
            update: function(pathOrObj, value) {
                if (typeof pathOrObj === 'object') {
                    Object.entries(pathOrObj).forEach(([key, val]) => {
                        stateManager.setValue(key, val);
                    });
                } else {
                    stateManager.setValue(pathOrObj, value);
                }
                return baseContext;
            },

            // Subscription API for watching state changes
            subscribe: function(path, callback, subscribeOptions = {}) {
                return framework._createEntitySubscription(stateManager, state, path, callback, subscribeOptions);
            },

            // Readiness helpers (for stores)
            isReady: function() {
                return !state._internal || state._internal.ready !== false;
            },

            // TODO(v2): Replace polling with event-driven notification from state manager.
            // Requires threading a "ready" event through the state manager subscription
            // system. Polling is correct but inelegant for a reactive framework.
            waitForReady: function() {
                return new Promise((resolve, reject) => {
                    if (!state._internal || state._internal.ready !== false) {
                        resolve();
                    } else {
                        // Bound the timeout by WALL-CLOCK elapsed, not poll count. Under load the
                        // chained 10ms timers are throttled, so a count-based limit lets the "10s"
                        // deadline stretch to tens of seconds (the more churn, the later it fires).
                        // A wall-clock deadline keeps the contract honest regardless of timer drift.
                        const deadline = performance.now() + READY_TIMEOUT_MS;
                        const checkReady = () => {
                            if (state._internal.ready) {
                                resolve();
                            } else if (performance.now() >= deadline) {
                                reject(new Error('waitForReady timed out after 10s'));
                            } else {
                                setTimeout(checkReady, READY_POLL_INTERVAL_MS);
                            }
                        };
                        checkReady();
                    }
                });
            },

            /**
             * Access state from another entity (component, store, or plugin)
             * @param {string} entityNameOrId - Name or ID of the target entity
             * @param {string} path - State property path to access
             * @param {any} [value] - Optional value to set
             * @returns {any} The value from the target entity's state
             */
            external: function(entityNameOrId, path, value) {
                // Find the target entity (shared lookup chain)
                const targetEntity = framework._externalFindTarget(entityNameOrId);

                // Try to resolve as a plugin if not found yet (only when plugin feature is enabled)
                if (__FEATURE_PLUGINS__) {
                    if (!targetEntity) {
                        const pluginHit = framework._externalPluginGet(entityNameOrId, path, arguments.length, this.id);
                        if (pluginHit) return pluginHit.value;
                    }
                }

                if (!targetEntity) {
                    // PENDING STORE DEPENDENCY: if we're in a computed evaluation
                    // and the store doesn't exist yet, register so the computed
                    // re-evaluates when the store is created.
                    framework._externalRegisterPending(entityNameOrId, this.id, this.stateManager);

                    framework._log('debug', `Entity not found: ${entityNameOrId}, returning fallback value`);
                    // For 1-arg calls, return null; for 2-arg calls check if it's a computed path
                    return (path && path.startsWith('computed:')) ? 0 : null;
                }

                // Register entity dependency for stores (virtual components)
                if (targetEntity.isVirtual) {
                    framework._registerEntityDependent(targetEntity.id, this.id);
                }

                // Register external dependency for list item reactivity.
                // NOTE: registered for EVERY arity here; the component-context
                // override registers only on the 2-arg GET. Preserved as-is.
                if (framework._registerExternalDependency) {
                    framework._registerExternalDependency(this.id, targetEntity.id, path);
                }

                // GET ENTITY case - return the entity's context when only name is provided
                // This allows: const store = this.external('storeName');
                if (arguments.length === 1) {
                    return targetEntity.context || targetEntity;
                }

                // GET VALUE case
                if (arguments.length === 2) {
                    try {
                        const resolvedValue = framework._externalResolveTargetValue(targetEntity, path);

                        // Late-binding re-eval: defer so _processDeferredDependencies
                        // re-evaluates this component once the external target appears.
                        // (Ongoing external reactivity is graph-edge driven; the
                        // dependents graph is gone.)
                        if (framework._contextSystemInitialized) {
                            framework._addDeferredDependency(this.id, targetEntity.id, path, 'external');
                        }

                        return resolvedValue;

                    } catch (error) {
                        return path.startsWith('computed:') ? 0 : null;
                    }
                }

                // SET VALUE case
                if (arguments.length === 3) {
                    return framework._externalSetTargetValue(targetEntity, path, value);
                }
            }
        };

        return baseContext;
    },
// COMPONENT CONTEXT CREATION
    /**
     * Create a component context with enhanced API.
     * Builds on _createBaseEntityContext and adds component-specific functionality.
     * @private
     */
    _createComponentContext(element, state, stateManager, instanceId, parentInstance)
    {

        const self = this;
        const wf = this;

        // Get the base context (shared with stores/plugins)
        const baseContext = this._createBaseEntityContext(instanceId, state, stateManager, {
            type: 'component'
        });

        // Create component-specific context by extending base
        const context = Object.assign(baseContext, {
            // DOM element reference (component-specific)
            element,

            // Auto-injected stores container (populated by _setupStoreSubscriptions)
            // Stores declared in `subscribe: { storeName: [...] }` are available via this.stores.storeName
            stores: {},

            // Entity pool access: this.pool('enemies') or this.pool('enemies', { onAdd, onRemove, onClear })
            // Uses instanceId + framework lookup since `instance` doesn't exist yet at context creation time
            pool: (name, options) => {
                if (!self._getPool) return null;
                const inst = self.componentInstances.get(instanceId);
                if (!inst) return null;
                const handle = self._getPool(inst, name);
                // Apply imperative hooks if provided
                if (handle && options) {
                    const ctx = inst.context;
                    if (options.onAdd) handle._onAdd = typeof options.onAdd === 'function' ? options.onAdd.bind(ctx) : null;
                    if (options.onRemove) handle._onRemove = typeof options.onRemove === 'function' ? options.onRemove.bind(ctx) : null;
                    if (options.onClear) handle._onClear = typeof options.onClear === 'function' ? options.onClear.bind(ctx) : null;
                }
                return handle;
            },

            // Enhanced DOM helpers (component-specific - require DOM element)
            find: selector => element.querySelector(selector),
            findAll: selector => element.querySelectorAll(selector),
            closest: selector => element.closest(selector),

            // NOTE: computed, update, subscribe are inherited from baseContext

            /**
             * Access state from another component (component-specific version with extra edge cases)
             * @param {string} componentNameOrId - Name or ID of the target component
             * @param {string} path - State property path to access (dot notation)
             * @param {any} [value] - Optional value to set (if provided, sets instead of gets)
             * @return {any} - The value from the target component's state
             */

            external: function (componentNameOrId, path, value)
            {
                // Find the target component (shared lookup chain)
                const targetComponent = self._externalFindTarget(componentNameOrId);

                // Try to resolve as a plugin if not found yet (only when plugin feature is enabled)
                if (__FEATURE_PLUGINS__) {
                    if (!targetComponent) {
                        const pluginHit = self._externalPluginGet(componentNameOrId, path, arguments.length, this.id);
                        if (pluginHit) return pluginHit.value;
                    }
                }

                if (!targetComponent)
                {
                    // PENDING STORE DEPENDENCY: if we're in a computed evaluation
                    // and the store doesn't exist yet, register so the computed
                    // re-evaluates when the store is created.
                    self._externalRegisterPending(componentNameOrId, instanceId, stateManager);

                    self._log('debug', `Component not found: ${componentNameOrId}, returning fallback value`);
                    // For 1-arg calls, return null; for 2-arg calls check if it's a computed path
                    return (path && path.startsWith('computed:')) ? 0 : null;
                }

                // Register entity dependency for stores (virtual components)
                if (targetComponent.isVirtual) {
                    self._registerEntityDependent(targetComponent.id, this.id);
                }

                // GET ENTITY case - return the entity's context when only name is provided
                // This allows: const store = this.external('storeName');
                if (arguments.length === 1) {
                    return targetComponent.context || targetComponent;
                }

                // GET VALUE case
                if (arguments.length === 2)
                {
                    try
                    {
                        const resolved = self._externalResolveTargetValue(targetComponent, path);

                        // Register external dependency for list item reactivity.
                        // NOTE: registered only on the 2-arg GET here; the
                        // base-entity external() registers for every arity.
                        // Preserved as-is.
                        if (self._registerExternalDependency) {
                            self._registerExternalDependency(this.id, targetComponent.id, path);
                        }

                        // Late-binding re-eval: defer so the component re-evaluates
                        // once the external target appears (the dependents graph was
                        // removed; ongoing reactivity is graph-edge driven).
                        self._addDeferredDependency(this.id, targetComponent.id, path, 'external');

                        return resolved;

                    } catch (error)
                    {
                        return path.startsWith('computed:') ? 0 : null;
                    }
                }

                // SET VALUE case
                if (arguments.length === 3)
                {
                    return self._externalSetTargetValue(targetComponent, path, value);
                }
            },

            /**
             * Rebind action handlers for dynamically added content.
             * Call this after updating innerHTML with new data-action elements.
             * Already-bound elements are skipped, so this is safe to call multiple times.
             * @example
             * this.element.innerHTML = '<button data-action="handleClick">Click</button>';
             * this.rebindActions();
             */
            rebindActions: function ()
            {
                const inst = wf.componentInstances.get(instanceId);
                if (inst) {
                    wf._bindComponentActions(inst);
                }
            },

            getStore: function (name = 'app-store')
            {
                return wf.storeManager.getStore(name);
            },

            store: function(storeNameOrPath, pathOrValue, value) {

                // Case 1: Single argument - get from default store
                if (arguments.length === 1) {

                    const appStore = wf.storeManager.getStoreComponentByName('app-store');
                    if (!appStore) {
                        if (wf._initPhase !== 'ready') {
                            // Still try to defer dependency even if store not found
                            wf._addDeferredDependency(this.id, 'app-store', storeNameOrPath, 'store-L4046');
                            return wf._getStoreFallbackValue(storeNameOrPath.split('.').pop());
                        }
                        wf._log('error', "Default app-store not found");
                        return undefined;
                    } else {


                        // Check readiness...
                        if (appStore.state._internal && !appStore.state._internal.ready) {
                            wf._log('warn', `App store accessed before ready: ${storeNameOrPath}`);

                            // STILL REGISTER DEPENDENCY even if store not ready
                            try {
                                // Try normal external call first
                                return this.external(appStore.id, storeNameOrPath);
                            } catch (e) {
                                // If external() fails, manually defer the dependency
                                wf._addDeferredDependency(this.id, appStore.id, storeNameOrPath, 'store-L4082');
                            }

                            return wf._getStoreFallbackValue(storeNameOrPath.split('.').pop());
                        } else {
                            return this.external(appStore.context?.id || appStore.id, storeNameOrPath);
                        }

                    }
                }

                // Case 2: Two arguments - could be property access, method call, or set operation
                if (arguments.length === 2) {
                    // Check if first arg is a known store name before falling back to dot-path heuristic
                    const knownStore = (wf._namedStores && wf._namedStores.has(storeNameOrPath)) ||
                        wf.storeManager.getStoreComponentByName(`store-${storeNameOrPath}`) ||
                        wf.storeManager.getStoreComponentByName(storeNameOrPath);

                    // Setting value in default store: store('path.prop', value)
                    if (storeNameOrPath.includes('.') && !knownStore) {
                        const appStore = wf.storeManager.getStoreComponentByName('app-store');
                        if (!appStore) {
                            if (wf._initPhase !== 'ready') {
                                wf._queueStoreUpdate('app-store', storeNameOrPath, pathOrValue);
                                return this;
                            }
                            wf._log('error', "Default app-store not found");
                            return this;
                        }

                        if (appStore.state._internal && !appStore.state._internal.ready) {
                            wf._log('warn', `Cannot set app-store property before ready: ${storeNameOrPath}`);
                            wf._queueStoreUpdate('app-store', storeNameOrPath, pathOrValue);
                            return this;
                        }

                        appStore.stateManager.setValue(storeNameOrPath, pathOrValue);
                        return this;
                    }

                    // Find the requested store
                    let storeComponent = null;
                    if (wf._namedStores && wf._namedStores.has(storeNameOrPath)) {
                        storeComponent = wf._namedStores.get(storeNameOrPath);
                    } else {
                        storeComponent = wf.storeManager.getStoreComponentByName(`store-${storeNameOrPath}`) ||
                            wf.storeManager.getStoreComponentByName(storeNameOrPath);
                    }

                    if (!storeComponent) {
                        if (wf._initPhase !== 'ready') {
                            // Defer dependency registration
                            wf._addDeferredDependency(this.id, `store-${storeNameOrPath}`, pathOrValue, 'store');

                            // Return appropriate fallback
                            if (typeof pathOrValue === 'string' && !pathOrValue.includes('.')) {
                                return async function() {
                                    wf._log('warn', `Dummy method called during initialization: ${pathOrValue}`);
                                    return Promise.resolve([]);
                                };
                            }
                            if (typeof pathOrValue === 'string') {
                                const propertyName = pathOrValue.split('.').pop();
                                if (/s$/.test(propertyName) && !/(ss|us|is|os)$/i.test(propertyName)) {
                                    return [];
                                }
                            }
                            return null;
                        }
                        wf._log('error', `Store "${storeNameOrPath}" not found`);
                        return undefined;
                    }

                    // ENHANCED: Always try to register dependency even if store not ready
                    if (storeComponent.state._internal && !storeComponent.state._internal.ready) {
                        // Try to register dependency anyway
                        try {
                            if (typeof pathOrValue === 'string' && pathOrValue.startsWith('computed:')) {
                                const computedName = pathOrValue.slice(9);
                                if (storeComponent.stateManager &&
                                    storeComponent.stateManager.computed &&
                                    storeComponent.stateManager.computed[computedName]) {
                                    const result = storeComponent.stateManager.evaluateComputed(computedName);
                                    // Try to register dependency
                                    this.external(storeComponent.id, pathOrValue);
                                    return result;
                                }
                                return null;
                            }

                            // Try normal external call
                            return this.external(storeComponent.id, pathOrValue);
                        } catch (e) {
                            // Defer dependency registration
                            wf._addDeferredDependency(this.id, storeComponent.id, pathOrValue, 'store');
                        }

                        // Return fallback values
                        if (typeof pathOrValue === 'string' && !pathOrValue.includes('.')) {
                            return async function() {
                                wf._log('warn', `Method called before store ready: ${pathOrValue}`);
                                return Promise.resolve([]);
                            };
                        }
                        if (typeof pathOrValue === 'string') {
                            const propertyName = pathOrValue.split('.').pop();
                            if (/s$/.test(propertyName) && !/(ss|us|is|os)$/i.test(propertyName)) {
                                return [];
                            }
                        }
                        return null;
                    }

                    // Handle computed properties
                    if (typeof pathOrValue === 'string' && pathOrValue.startsWith('computed:')) {
                        const computedName = pathOrValue.slice(9);
                        if (storeComponent.stateManager &&
                            storeComponent.stateManager.computed &&
                            storeComponent.stateManager.computed[computedName]) {
                            try {
                                return storeComponent.stateManager.evaluateComputed(computedName);
                            } catch (error) {
                                return null;
                            }
                        } else {
                            return null;
                        }
                    }

                    // Property access with dots: store('products', 'items.0.name')
                    if (pathOrValue.includes('.')) {
                        return this.external(storeComponent.id, pathOrValue);
                    }

                    // Method access: store('products', 'fetchProducts')
                    if (typeof storeComponent.context[pathOrValue] === 'function') {
                        return storeComponent.context[pathOrValue].bind(storeComponent.context);
                    }

                    // Simple property access: store('products', 'items')
                    return this.external(storeComponent.id, pathOrValue);
                }

                // Case 3: Three arguments - set value in named store
                if (arguments.length === 3) {
                    let storeComponent = null;
                    if (wf._namedStores && wf._namedStores.has(storeNameOrPath)) {
                        storeComponent = wf._namedStores.get(storeNameOrPath);
                    } else {
                        storeComponent = wf.storeManager.getStoreComponentByName(`store-${storeNameOrPath}`) ||
                            wf.storeManager.getStoreComponentByName(storeNameOrPath);
                    }

                    if (!storeComponent) {
                        if (wf._initPhase !== 'ready') {
                            wf._queueStoreUpdate(storeNameOrPath, pathOrValue, value);
                            return this;
                        }
                        wf._log('error', `Store "${storeNameOrPath}" not found for setting ${pathOrValue}`);
                        return this;
                    }

                    if (storeComponent.state._internal && !storeComponent.state._internal.ready) {
                        wf._log('warn', `Cannot set store property before ready: ${storeNameOrPath}.${pathOrValue}`);
                        wf._queueStoreUpdate(storeNameOrPath, pathOrValue, value);
                        return this;
                    }

                    storeComponent.stateManager.setValue(pathOrValue, value);
                    return this;
                }

                wf._log('error', 'Invalid arguments to store() method');
                return undefined;
            },


            emit: function (eventName, detail = {})
            {

                const componentInstance = self.componentInstances.get(this.id);

                if (!componentInstance)
                {
                    self._error(WF_ERRORS.EMIT_NO_INSTANCE, {
                        context: this.id,
                        suggestion: 'Ensure the component is initialized before calling emit()'
                    });
                    return false;
                }

                // Bubble the event up the DOM component ancestry: from the emitting
                // component's element, walk up [data-component] ancestors and invoke
                // each one's on<Event> handler. DOM-native, reflects the live
                // structure with no maintained context tree / scan-time hierarchy
                // rebuild, and works during init (the element is already in the DOM).
                const handlerName = `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`;
                let ancestorEl = componentInstance.element?.parentElement?.closest('[data-component]') || null;
                while (ancestorEl)
                {
                    const ancestor = self.componentInstances.get(ancestorEl.dataset.componentId);
                    if (ancestor && ancestor.context && typeof ancestor.context[handlerName] === 'function')
                    {
                        try
                        {
                            ancestor.context[handlerName](detail);
                        } catch (error)
                        {
                            if (__DEV__) console.error(`Error in parent event handler ${handlerName}:`, error);
                        }
                    }
                    ancestorEl = ancestorEl.parentElement?.closest('[data-component]') || null;
                }

                return true;
            },

            // Component relationships
            parent: parentInstance ? parentInstance.context : null,

            // Data management
            update: (path, value) =>
            {
                if (typeof path === 'object')
                {
                    // Handle update({prop: value}) syntax
                    Object.entries(path).forEach(([key, val]) =>
                    {
                        stateManager.setValue(key, val);
                    });
                } else
                {
                    // Handle update('prop', value) syntax
                    stateManager.setValue(path, value);
                }
                return context; // For chaining
            },

            // Storage helpers
            saveToStorage: () =>
            {
                if (stateManager.storageKey)
                {
                    stateManager._saveToStorage();
                }
                return context;
            },

            loadFromStorage: () =>
            {
                if (stateManager.storageKey)
                {
                    stateManager._loadFromStorage();
                }
                return context;
            },

            // Event target helpers
            getItemFromEvent: (event) =>
            {
                // Walk up DOM to find list item (element with _listIndex property)
                let current = event.target;
                while (current && current !== document.body) {
                    if (current._listIndex !== undefined) {
                        return {
                            element: current,
                            index: current._listIndex,
                            id: current._itemData?.id
                        };
                    }
                    current = current.parentElement;
                }
                return null;
            },

        });

        context.store = context.store.bind(context);

        context.getStore = context.getStore.bind(context);

        // Add automatic child component access

        context.components = new Proxy({}, {
            get(target, prop) {
                // Skip symbols (e.g. Symbol.iterator, Symbol.toPrimitive from serializers)
                if (typeof prop === 'symbol') return undefined;

                // First check if we've already cached this component

                if (prop in target) return target[prop];

                // Look for a child element with matching component name
                const selector = `[data-component="${prop}"]`;
                const childElement = element.querySelector(selector);

                if (!childElement) return undefined;

                // Get the component instance
                const childComponentId = childElement.dataset.componentId;
                if (childComponentId) {
                    const childInstance = self.componentInstances.get(childComponentId);
                    // Cache it for future access
                    target[prop] = childInstance?.context || null;
                    return target[prop];
                }

                return undefined;
            }
        });

        // Define props getter using Object.defineProperty to ensure lazy evaluation
        // This must be done after Object.assign because Object.assign would evaluate
        // a getter and copy the value, not the getter itself
        Object.defineProperty(context, 'props', {
            get() {
                const instance = self.componentInstances.get(instanceId);
                return instance ? instance.props : {};
            },
            enumerable: true,
            configurable: true
        });

        // Define listItem getter for components rendered inside lists
        // Returns the list item data object, or null if not in a list
        // Available in beforeInit(), init(), and all lifecycle methods
        Object.defineProperty(context, 'listItem', {
            get() {
                const instance = self.componentInstances.get(instanceId);
                return instance ? instance.listItem : null;
            },
            enumerable: true,
            configurable: true
        });

        // Add WildQuery ($el) helper for jQuery-like DOM manipulation
        // Scoped to component, auto-cleaned event handlers, boundary-enforced traversal
        if (self._createDollarHelper) {
            const tempInstance = { id: instanceId, element, context };
            context.$el = self._createDollarHelper(tempInstance);
        }

        return context;
    },
    /**
     * Bind all methods from the component definition to the context with error handling
     * @private
     */
    _bindMethods(instance) {
        const {definition, context} = instance;
        // Get the raw context to bypass the context proxy's SET trap,
        // which would route writes to state when property names collide.
        const rawContext = context[RAW_TARGET] || context;

        // Bind all functions in the definition to the context
        Object.entries(definition).forEach(([key, value]) => {
            if (typeof value === 'function' &&
                key !== 'state' &&
                key !== 'computed' &&
                key !== 'watch') {

                // Create wrapper that always uses the instance.context
                const wrappedMethod = this._wrapMethod(instance, key, value);
                rawContext[key] = wrappedMethod;

                // Also expose method directly on instance for intuitive cross-component calls
                // e.g., instance.toggleTheme() instead of instance.context.toggleTheme()
                instance[key] = wrappedMethod;
            } else if (key !== 'state' &&
                key !== 'computed' &&
                key !== 'watch' &&
                key !== 'events' &&
                key !== 'props' &&  // Don't overwrite context.props getter
                !key.startsWith('_internal')) {
                // Copy arrays and other data properties
                rawContext[key] = value;
            }
        });

        // Add core method binding (write to raw context to bypass proxy SET trap)
        ['store', 'getStore', 'external', 'emit', 'update'].forEach(methodName => {
            if (typeof context[methodName] === 'function') {
                const originalMethod = context[methodName];
                // Replace with guaranteed context method
                rawContext[methodName] = function(...args) {
                    return originalMethod.apply(context, args);
                };
            }
        });

        // Add resetError method to allow recovery from error state
        const framework = this;
        rawContext.resetError = function(options = {}) {
            return framework._resetComponentError(instance, options);
        };
        instance.resetError = rawContext.resetError;
    },
    /**
     * Parse subscribe declaration and return normalized format.
     * Supports both array syntax and object syntax:
     *   - Array: ['store1', 'store2'] - wait only, no path subscriptions
     *   - Object: { store1: ['path1'], store2: [] } - wait and optionally subscribe to paths
     *
     * @param {Array|Object} subscribe - The subscribe declaration
     * @returns {Object} Normalized format: { storeName: [paths] }
     * @private
     */
    _parseSubscribeDeclaration(subscribe) {
        if (!subscribe) return {};

        // Array syntax: ['store1', 'store2'] -> { store1: [], store2: [] }
        if (Array.isArray(subscribe)) {
            const result = {};
            for (const storeName of subscribe) {
                if (typeof storeName === 'string') {
                    result[storeName] = [];  // Empty array = wait only, no path subscriptions
                }
            }
            return result;
        }

        // Object syntax - already in correct format
        if (typeof subscribe === 'object') {
            return subscribe;
        }

        return {};
    },

    /**
     * Set up declarative store subscriptions from subscribe: {} in component definition.
     * This registers the component for onStoreUpdate() callbacks when watched store paths change.
     * Also handles the subscribe-wait feature: components wait for subscribed stores before init().
     *
     * Supports two syntaxes:
     * - Array: subscribe: ['store1', 'store2'] - wait for stores, no onStoreUpdate calls
     * - Object: subscribe: { store1: ['path1', 'path2'] } - wait AND subscribe to path changes
     *
     * @example
     * // Array syntax - wait only
     * wildflower.component('my-component', {
     *     subscribe: ['config'],  // Wait for config store, no updates
     *     init() {
     *         // config store is guaranteed ready here
     *     }
     * });
     *
     * @example
     * // Object syntax - wait and subscribe
     * wildflower.component('my-component', {
     *     subscribe: {
     *         kanban: ['columns', 'searchQuery'],
     *         user: ['profile']
     *     },
     *     onStoreUpdate(storeName, path, newValue, oldValue) {
     *         // Called when subscribed paths change
     *     }
     * });
     *
     * @param {Object} instance - The component instance
     * @private
     */
    /**
     * Inject store references into this.stores before beforeInit.
     * This is called early in the lifecycle so stores are available in beforeInit and computed.
     * @param {Object} instance - The component instance
     * @private
     */
    _injectStoreReferences(instance) {
        const { definition, context } = instance;

        // Early exit if no subscribe declaration
        if (!definition.subscribe) {
            return;
        }

        // Parse the subscribe declaration (supports array and object syntax)
        const parsed = this._parseSubscribeDeclaration(definition.subscribe);

        // Auto-inject store references into this.stores
        // This allows components to access stores via this.stores.storeName
        // instead of calling wildflower.getStore('storeName') repeatedly
        const self = this;
        for (const storeName of Object.keys(parsed)) {
            // Use a getter to support late-binding (store created after component)
            Object.defineProperty(context.stores, storeName, {
                get() {
                    return self.getStore(storeName);
                },
                enumerable: true,
                configurable: true
            });
        }

        // Mark that injection has happened (so _setupStoreSubscriptions can skip)
        instance._storesInjected = true;
    },
    _setupStoreSubscriptions(instance) {
        const { definition, context } = instance;

        // Early exit if no subscribe declaration
        if (!definition.subscribe) {
            return;
        }

        // Idempotency guard. The async scanner hoists this call to a
        // pre-pass that runs before computed setup (so subscribePath
        // registers entity-deps before the first computed-eval microtask
        // flush, avoiding a race where store mutations between scanner
        // batches miss the component as a cascade target). The original
        // post-features call site still runs in some lifecycle paths, so
        // skip it here when the pre-pass already ran.
        if (instance._subscriptionsSetup) return;
        instance._subscriptionsSetup = true;

        // Parse the subscribe declaration (supports array and object syntax)
        const parsed = this._parseSubscribeDeclaration(definition.subscribe);

        // Initialize tracking array for cleanup on destroy
        instance._storeSubscriptions = instance._storeSubscriptions || [];

        // Track which stores need waiting (all declared stores)
        instance._subscribedStores = Object.keys(parsed);

        // Inject stores if not already done (for backwards compatibility with async path)
        if (!instance._storesInjected) {
            this._injectStoreReferences(instance);
        }

        // Process each store subscription
        for (const [storeName, paths] of Object.entries(parsed)) {
            // Ensure paths is an array
            const pathsArray = Array.isArray(paths) ? paths : [paths];

            // Only subscribe to paths if there are any (empty array = wait only)
            for (const path of pathsArray) {
                if (path) {  // Skip empty strings
                    // Subscribe via StoreManager
                    const success = this.storeManager.subscribePath(storeName, path, instance);

                    if (success) {
                        // Track subscription for cleanup
                        instance._storeSubscriptions.push({ storeName, path });
                    } else if (instance.id) {
                        // Store doesn't exist yet; register pending dependency
                        // so the component re-renders when the store is created.
                        // Uses '_subscribe_' as a synthetic computed name to trigger
                        // general re-render + subscribePath retry.
                        this.storeManager.registerPendingStoreDependency(
                            storeName, instance.id, '_subscribe_', null
                        );
                        break; // All paths for this store will be set up on resolution
                    }
                }
            }
        }
    },
    /**
     * Set up watchers with immediate execution if requested
     * Supports:
     *   - Local state paths: 'propertyName' or 'nested.path'
     *   - Store paths: 'store:path' (default app-store) or 'store:storeName.path'
     *   - Immediate execution: append ':immediate' to any path
     * @private
     */
    _setupWatchers(instance)
    {
        const {definition, context, stateManager} = instance;

        if (!definition.watch) return;

        // Initialize store watcher cleanup array
        instance._storeWatcherCleanups = instance._storeWatcherCleanups || [];

        // Process watch handlers
        Object.entries(definition.watch).forEach(([key, value]) =>
        {
            // Check for immediate flag
            const isImmediate = key.endsWith(':immediate');
            let path = isImmediate ? key.slice(0, -10) : key;

            // Get handler function (could be direct function or object with handler property)
            const handler = typeof value === 'function' ? value : value.handler;
            if (typeof handler !== 'function') return;

            // Bind handler to context
            const boundHandler = handler.bind(context);

            // Check if this is a store watcher
            if (path.startsWith('store:')) {
                this._setupStoreWatcher(instance, path, boundHandler, isImmediate);
                return;
            }

            // RG-5 (review 2026-07-02, Chris decision): watching a list item by
            // numeric index is an anti-pattern. Reactivity is identity-based, so
            // the index in an onStateChange path reflects the item's position
            // when FIRST observed; after a splice/reorder the watcher misfires
            // or goes silent. WF-213, dev-only, warn-severity (recoverable
            // diagnostic; must not trip error-tracking pipelines).
            if (__DEV__ && /(^|\.)\d+(\.|$)|\[\d+\]/.test(path)) {
                wfError(WF_ERRORS.INDEXED_PATH_OBSERVER, {
                    warn: true,
                    context: `watch path "${path}"`,
                    suggestion: 'Watch the array (or a computed over it) and track items by id instead of position'
                });
            }

            // Register local state watcher
            instance._watcherHandlers = instance._watcherHandlers || new Map();
            instance._watcherHandlers.set(path, boundHandler);

            // A computed change reaches this watcher as a `computed:NAME` pulse
            // (matched by _executeWatchers via exact `computed:NAME` key or the
            // bare-name fallback). Tell the state manager to install that
            // computed's notifier (lazy by default). The watched key may be bare
            // (`derived`) or prefixed (`computed:derived`); record the bare
            // computed name either way. A non-computed name is harmless; the
            // notifier only materializes if a computed by that name exists. A `*`
            // wildcard watcher matches every pulse, so it must observe all.
            if (stateManager._ensureComputedNotifier) {
                if (path === '*') stateManager._observeAllComputedNotifiers();
                else stateManager._ensureComputedNotifier(path.startsWith('computed:') ? path.slice(9) : path);
            }

            // Execute immediately if requested; uses _resolveComponentValue for computed-first resolution
            if (isImmediate)
            {
                try
                {
                    const currentValue = this._resolveComponentValue(path, instance);
                    boundHandler(currentValue, undefined, path);
                } catch (error)
                {
                    this._handleError(`Error in immediate watcher for ${path}`, error, instance);
                }
            }
        });
    },
    /**
     * Set up a watcher for a store path
     * Supports 'store:path' (default app-store) or 'store:storeName.path'
     * @private
     */
    _setupStoreWatcher(instance, fullPath, boundHandler, isImmediate) {
        // Parse the store path: 'store:path' or 'store:storeName.path'
        const pathWithoutPrefix = fullPath.slice(6); // Remove 'store:'

        // Determine store name and path
        // If path contains a dot, first segment could be store name or path part
        // Convention: if storeManager has a store with that name, use it; otherwise treat as path in app-store
        let storeName = 'app-store';
        let storePath = pathWithoutPrefix;

        const firstDot = pathWithoutPrefix.indexOf('.');
        if (firstDot > 0) {
            const possibleStoreName = pathWithoutPrefix.slice(0, firstDot);
            // Check if this is a named store
            if (this.storeManager?.getStoreComponentByName(possibleStoreName)) {
                storeName = possibleStoreName;
                storePath = pathWithoutPrefix.slice(firstDot + 1);
            }
        }

        // Get the store
        const storeComponent = this.storeManager?.getStoreComponentByName(storeName);
        if (!storeComponent) {
            if (__DEV__) console.warn(`[WildflowerJS] Store watcher: Store '${storeName}' not found for path '${fullPath}'`);
            return;
        }

        // Subscribe to store changes
        const unsubscribe = storeComponent.context.subscribe(storePath, (newValue, oldValue) => {
            try {
                boundHandler(newValue, oldValue, fullPath);
            } catch (error) {
                this._handleError(`Error in store watcher for ${fullPath}`, error, instance);
            }
        }, { immediate: isImmediate });

        // Store cleanup function for when component is destroyed
        instance._storeWatcherCleanups.push(unsubscribe);
    },
// ERROR HANDLING
    /**
     * Wrap a method with error handling
     * @private
     */


    _wrapMethod(instance, methodName, fn) {
        const self = this;

        // Store the original function and context together in a closure
        // This ensures they stay paired regardless of how the function is called
        const originalContext = instance.context;
        const originalFn = fn;

        // Lifecycle hooks bypass the init-ready queue: the framework drives
        // them at known points and queueing them would deadlock (init() being
        // queued before _initReady is set creates infinite wait).
        const isLifecycle = LIFECYCLE_HOOK_NAMES.has(methodName);

        // Create a non-arrow function to allow 'this' manipulation
        function wrappedMethod(...args) {
            // Action-before-init guard. If the user's init() hook hasn't run
            // yet (instance._initReady !== true), queue external calls and
            // replay them after init completes. Re-entrant calls (a method
            // invoking another method during execution) bypass the queue;
            // we're already inside a known execution frame.
            if (!isLifecycle && !instance._initReady && !instance._inMethodExecution) {
                if (!instance._pendingActions) instance._pendingActions = [];
                // Capture a replay closure that re-enters this wrapper. Once
                // _initReady is true, replay loops and each call falls through
                // to the immediate-execution branch below.
                instance._pendingActions.push(() => wrappedMethod.apply(originalContext, args));
                return undefined;
            }

            const wasExecuting = instance._inMethodExecution;
            instance._inMethodExecution = true;
            try {
                // Force context to always be the original context
                // This is the key line that ensures context consistency
                return originalFn.apply(originalContext, args);
            } catch (error) {
                return self._handleError(
                    `Error in ${instance.name}.${methodName}`,
                    error,
                    instance,
                    {methodName, arguments: args}
                );
            } finally {
                instance._inMethodExecution = wasExecuting;
            }
        }

        return wrappedMethod;
    },

    // ========================================================================
    // STATE CHANGE HANDLER HELPERS
    // These helper methods extract component-specific logic from state change
    // handling to enable unified entity state change processing.
    // ========================================================================

    /**
     * Defer a state change update for a component that is still initializing.
     * Updates are queued and processed after initialization completes.
     * @param {string} instanceId - Component instance ID
     * @param {string} path - State path that changed
     * @param {any} newValue - New value
     * @param {any} oldValue - Previous value
     * @returns {boolean} true if update was deferred, false otherwise
     * @private
     */
    _deferComponentUpdate(instanceId, path, newValue, oldValue) {
        if (!this._initializingComponentIds.has(instanceId)) {
            return false;
        }

        // Initialize the deferred updates queue for this component if needed
        if (!this._deferredReactiveUpdates.has(instanceId)) {
            this._deferredReactiveUpdates.set(instanceId, []);
        }

        // Queue this update for later processing
        this._deferredReactiveUpdates.get(instanceId).push({
            path,
            newValue,
            oldValue
        });

        return true;
    },

    /**
     * Handle list-specific state changes and return whether list handling took over.
     * @param {Object} instance - Component instance
     * @param {string} path - State path that changed
     * @param {any} newValue - New value
     * @param {any} oldValue - Previous value
     * @returns {boolean} true if list system is handling the update
     * @private
     */
    _handleComponentListStateChange(instance, path, newValue, oldValue) {
        const instanceId = instance.id;

        // Check if this change affects lists
        const listAffected = this._handleListStateChange(instanceId, path, newValue, oldValue);

        return listAffected;
    },

    /**
     * Schedule rendering for a component state change.
     * Uses synchronous render for large arrays, async for small updates.
     * @param {Object} instance - Component instance
     * @param {any} newValue - New value (used to determine render mode)
     * @param {boolean} listAffected - Whether the change affected a list
     * @returns {boolean} true if rendering was handled, false to skip
     * @private
     */
    _scheduleComponentRender(instance, newValue, listAffected) {
        // Skip rendering if this is handled by list system
        if (listAffected && this._batchMode) {
            return false;
        }

        // Skip if this is an array operation with directly nested changes
        const path = instance._lastChangeInfo?.path;
        if (this._currentArrayOperation && this._currentArrayOperation.path === path) {
            return false;
        }

        if (this._batchMode) {
            return false; // Exit early, rendering will occur when batch completes
        }

        // Update portal visibility if conditionally rendered.
        // Only if portal system is included (not in lite build) AND this
        // instance actually has portals. _hasPortals is set by _processPortals
        // (and _processPortalsInListItems for late-discovered list-item
        // portals). Without this gate, _updatePortalVisibility runs a
        // descendant querySelectorAll for every component on every entity
        // state change, dominating the main thread on portal-free apps
        // (PM demo: 38% of total scripting time before this gate).
        if (this._updatePortalVisibility && instance._hasPortals) {
            this._updatePortalVisibility(instance);
        }

        // OPTIMIZATION: For large array operations, render synchronously to avoid RAF delay
        const isLargeArrayUpdate = Array.isArray(newValue) && newValue.length > LARGE_ARRAY_THRESHOLD;

        if (isLargeArrayUpdate) {
            // Synchronous render for large arrays to minimize perceived latency
            this._render();
            // Call onUpdate after synchronous render
            this._callOnUpdateHook(instance, instance._lastChangeInfo);
            instance._lastChangeInfo = null; // consumed, release oldValue
        } else {
            // Standard async render for small updates
            this._scheduleRender();
            // Schedule onUpdate to be called after async render completes
            this._scheduleOnUpdateHook(instance);
        }

        return true;
    },

    /**
     * Add a deferred dependency if not already present (deduplication)
     * @private
     */
    _addDeferredDependency(sourceId, targetId, path, source) {
        if (!this._deferredDependencies) {
            this._deferredDependencies = [];
        }
        // Check for duplicate
        const isDuplicate = this._deferredDependencies.some(d =>
            d.sourceId === sourceId &&
            d.targetId === targetId &&
            d.path === path
        );
        if (!isDuplicate) {
            this._deferredDependencies.push({
                sourceId,
                targetId,
                path,
                timestamp: Date.now(),
                _source: source
            });
        }
    },
    /**
     * Process any deferred dependencies that couldn't be registered earlier
     * @private
     */
    _processDeferredDependencies() {
        if (!this._deferredDependencies || this._deferredDependencies.length === 0) return;

        // Prevent recursive processing
        if (this._processingDeferredDependencies) return;
        this._processingDeferredDependencies = true;

        const now = Date.now();
        const stillDeferred = [];
        const forceReEvaluation = new Set(); // Components that need computed re-evaluation

        this._deferredDependencies.forEach(dep => {
            // Skip very old dependencies - drop silently
            if (now - dep.timestamp > STALE_DEPENDENCY_MS) {
                return;
            }

            const sourceComponent = this.componentInstances.get(dep.sourceId);
            let targetComponent = this.componentInstances.get(dep.targetId);

            // Try to find target by name if not found by ID
            if (!targetComponent && typeof dep.targetId === 'string') {
                if (dep.targetId === 'app-store') {
                    targetComponent = this.storeManager.getStoreComponentByName('app-store');
                } else if (dep.targetId.startsWith('store-')) {
                    targetComponent = this.storeManager.getStoreComponentByName(dep.targetId);
                }
            }

            // Check if both components still exist
            if (!sourceComponent || !targetComponent) {
                // For store-not-found, keep trying but not forever (30 second limit already applied above)
                if (dep.reason === 'store-not-found' && targetComponent === undefined) {
                    // Store might get created later, keep in queue (timeout still applies)
                    stillDeferred.push(dep);
                }
                // For all other cases, drop the dependency
                return;
            }

            // For store-not-ready dependencies, check if store is now ready
            if (dep.reason === 'store-not-ready' && targetComponent.state._internal) {
                if (!targetComponent.state._internal.ready) {
                    stillDeferred.push(dep); // Store still not ready
                    return;
                }
                // Store is now ready, force re-evaluation
                forceReEvaluation.add(dep.sourceId);
            }

            // Both components exist (resolved above). Component contexts are no
            // longer registered and there is no dependents graph to register into,
            // so keep the dependency queued; ongoing reactivity is graph-edge driven
            // (the store-ready path above already forced re-evaluation when needed).
            stillDeferred.push(dep);
        });

        // Update the deferred dependencies list
        this._deferredDependencies = stillDeferred;

        // Force re-evaluation of computed properties for components that got new dependencies
        forceReEvaluation.forEach(componentId => {
            const component = this.componentInstances.get(componentId);
            if (component && component.stateManager) {
                // Clear computed cache
                component.stateManager.computedCache.clear();

                // Re-evaluate all computed properties
                Object.keys(component.stateManager.computed || {}).forEach(propName => {
                    try {
                        const oldValue = component.stateManager._cachedComputedValue
                            ? component.stateManager._cachedComputedValue(propName)
                            : component.stateManager._lastEvalResult?.get(propName);
                        const newValue = component.stateManager.evaluateComputed(propName);

                        // Trigger state change notification if value changed
                        if (!objectUtils.isEqual(oldValue, newValue)) {
                            component.stateManager.onStateChange(`computed:${propName}`, newValue, oldValue);
                        }
                    } catch (error) {
                        if (__DEV__) console.error(`Error re-evaluating ${propName}:`, error);
                    }
                });
            }
        });

        // Clear recursive guard
        this._processingDeferredDependencies = false;
    },

    // COMPONENT DESTRUCTION

    /**
     * Destroy a component instance and clean up all its resources.
     *
     * This method performs comprehensive cleanup including:
     * - Calling beforeDestroy and destroy lifecycle hooks
     * - Destroying child components (unless marked data-external)
     * - Cleaning up store watcher subscriptions
     * - Removing all context registrations (bindings, actions, conditionals, lists)
     * - Cleaning up event handlers and portals
     * - Removing from component hierarchy tracking
     *
     * @param {string} componentId - The unique identifier of the component to destroy
     * @returns {boolean} True if the component was found and destroyed, false otherwise
     *
     * @example
     * // Destroy a specific component
     * const wasDestroyed = wildflower.destroyComponent('counter-1');
     *
     * @example
     * // Destroy component and let framework clean up children
     * wildflower.destroyComponent(instance.id);
     */
    destroyComponent(componentId)
    {
        const instance = this.componentInstances.get(componentId);
        if (!instance) return false;

        // Trigger plugin beforeDestroy hook (only if plugin system is loaded)
        if (this._triggerHook) {
            this._triggerHook('component:beforeDestroy', instance);
        }

        // Call beforeDestroy lifecycle hook (before any cleanup starts)
        this._callBeforeDestroyHook(instance);

        // Clean up portaled content before removing context
        // Only if portal system is included (not in lite build)
        if (this._cleanupComponentPortals) {
            this._cleanupComponentPortals(componentId);
        }


        // Handle child components - but skip those marked as external
        const childIds = [...(this.componentChildren.get(componentId) || [])];
        childIds.forEach(childId => {
            const childInstance = this.componentInstances.get(childId);
            if (childInstance && childInstance.element && childInstance.element.hasAttribute('data-external')) {
                return;
            }
            this.destroyComponent(childId);
        });

        // Clean up entity pools (data-pool)
        if (this._cleanupPools) {
            this._cleanupPools(instance);
        }

        // Call user destroy hook if available.
        //
        // Ordering: the destroy hook fires BEFORE binding/render effects
        // are disposed (the per-effect
        // disposers run later in this function, and the catch-all sweep at
        // the bottom runs last). State mutations inside destroy() therefore
        // queue effects that fire against a partially torn-down component.
        //
        // For BINDING effects, this is benign: the component's contexts are
        // removed during this destroy pass. When a queued binding effect runs
        // in the microtask drain after this function returns, its context-lookup
        // misses and it silently no-ops. The effect itself is also marked disposed by the
        // fallback sweep at the bottom of this function before the drain.
        //
        // For CUSTOM effects (createEffect with scope: instance / context),
        // the same fallback sweep disposes them before the microtask drain,
        // so .disposed is true when they're scheduled to run and _runEffect
        // returns early.
        //
        // The accidental safety hinges on (a) context-removal-before-destroy
        // at line 440 and (b) the fallback sweep at the end of this function.
        // If either changes, revisit this ordering.
        if (typeof instance.context.destroy === 'function')
        {
            try
            {
                instance.context.destroy();
            } catch (error)
            {
                this._handleError('Error in destroy hook', error, instance, { lifecycle: 'destroy' });
            }
        }

        // Clean up store watcher subscriptions
        if (instance._storeWatcherCleanups && instance._storeWatcherCleanups.length > 0) {
            instance._storeWatcherCleanups.forEach(unsubscribe => {
                try {
                    if (typeof unsubscribe === 'function') {
                        unsubscribe();
                    }
                } catch (error) {
                    // Silently ignore cleanup errors
                }
            });
            instance._storeWatcherCleanups = [];
        }

        // Clean up declarative store path subscriptions (subscribe: {} feature)
        if (this.storeManager && instance._storeSubscriptions && instance._storeSubscriptions.length > 0) {
            this.storeManager.unsubscribeAllPaths(instance);
        }

        // Clean up slot templates (subscriptions and rendered elements)
        if (instance._slotContexts || instance._slotCleanups) {
            this._cleanupSlotTemplates(instance);
        }

        // Dispose render effect if component uses effect-based rendering
        if (instance._renderEffect) {
            this._disposeComponentRenderEffect(instance);
        }

        // No context registry to sweep: binding/conditional contexts no longer
        // exist, action records are element-local (listeners cleaned by
        // _cleanupComponentEventHandlers below), list contexts are plain objects
        // that GC with the element / instance, and render/portal records GC with
        // the render effect + instance arrays.

        // Clean up any remaining event handlers
        this._cleanupComponentEventHandlers(componentId);

        // Dispatch component destroy event for optional module cleanup (e.g., RouteManager)
        document.dispatchEvent(new CustomEvent('wildflower:componentDestroy', {
            detail: { instance, context: instance.context }
        }));

        // Remove from component hierarchy
        this._removeFromComponentHierarchy(componentId);

        // Clean up from update tracking to prevent stale update warnings
        if (this._componentsToUpdate) {
            this._componentsToUpdate.delete(componentId);
        }

        // Clean up from unified entity dependents (stores, plugins, etc.)
        if (this._entityDependents) {
            this._entityDependents.forEach((dependents) => {
                dependents.delete(componentId);
            });
        }

        // Purge cross-store tracking-proxy cache entries involving this entity
        // (as reader: outer key; as read store: inner key of other readers)
        if (this._trackingProxyCache) {
            this._trackingProxyCache.delete(componentId);
            this._trackingProxyCache.forEach((perStore) => {
                perStore.delete(componentId);
            });
        }

        // Clean up deferred dependencies referencing this component
        if (this._deferredDependencies && this._deferredDependencies.length > 0) {
            this._deferredDependencies = this._deferredDependencies.filter(dep =>
                dep.sourceId !== componentId && dep.targetId !== componentId
            );
        }

        // Clean up Configurable Component Templates
        if (instance._itemTemplates) {
            instance._itemTemplates.clear();
        }

        // Clean up custom directives (only if plugin system is loaded)
        if (instance.element && this._cleanupCustomDirectivesInSubtree) {
            this._cleanupCustomDirectivesInSubtree(instance.element);
        }

        // Trigger plugin afterDestroy hook (only if plugin system is loaded)
        if (this._triggerHook) {
            this._triggerHook('component:afterDestroy', componentId);
        }

        // Clean up any pending store dependencies for this component
        if (this.storeManager) {
            this.storeManager.removePendingDependencies(componentId);
        }

        // Run the data-list mapArray cleanups registered at list init (RG-2).
        // The reconciler's structural effect is a raw core effect held only on
        // element._disposeMapArray and these closures. It is NOT created via
        // createEffect, so it is NOT in stateManager._effects and the destroy()
        // sweep below cannot reach it. Without this, a list fed (via a computed)
        // from a long-lived store keeps its structural effect alive through the
        // store's node observers, and every post-destroy store mutation re-runs
        // the reconcile against the destroyed component, growing detached rows
        // and registering fresh per-item effects forever. Each cleanup is
        // idempotent (disposeNode short-circuits on F_DISPOSED), so stale
        // entries from a list re-init are safe to re-run.
        if (instance._mapArrayCleanups) {
            for (let i = 0; i < instance._mapArrayCleanups.length; i++) {
                try { instance._mapArrayCleanups[i](); } catch (e) { /* already gone */ }
            }
            instance._mapArrayCleanups = null;
        }

        // Dispose every effect on this component's reactive surface. createEffect
        // adds UNCONDITIONALLY to stateManager._effects (and additionally to a
        // scope set when scoped to instance/context), so stateManager._effects is
        // the superset of every effect created THROUGH IT: the framework
        // _renderEffect, per-item list effects, computed notifiers. (The mapArray
        // structural effect is the exception, a raw core effect handled by the
        // _mapArrayCleanups pass above.) destroy() walks that superset and
        // _disposeEffect removes each from every set it lives in (_effects,
        // scope._effects, _listItemEffects), so a single destroy() covers what
        // the old multi-set fallback sweep did. It also sets _destroyed so a
        // still-pending deferred computed-notifier install (queued before
        // destroy) skips instead of orphaning an effect.
        if (instance.stateManager && instance.stateManager.destroy) {
            instance.stateManager.destroy();
        }

        this.componentInstances.delete(componentId);

        return true;
    },
    _removeFromComponentHierarchy(componentId)
    {
        // Remove from parent's children array
        const parentId = this.componentParents.get(componentId);
        if (parentId)
        {
            const siblings = this.componentChildren.get(parentId) || [];
            this.componentChildren.set(
                parentId,
                siblings.filter(id => id !== componentId)
            );

            // Update parent instance references if needed
            const parentInstance = this.componentInstances.get(parentId);
            if (parentInstance && Array.isArray(parentInstance.children))
            {
                parentInstance.children = parentInstance.children.filter(
                    child => child.id !== componentId
                );
            }
        }

        // Remove component's own entries
        this.componentParents.delete(componentId);
        this.componentChildren.delete(componentId);

    },
    /**
     * Clean up event handlers for a component when it's destroyed
     * @param {string} componentId - The ID of the component being destroyed
     * @private
     */
    _cleanupComponentEventHandlers(componentId)
    {
        if (!componentId) return;

        // Find all event handlers associated with this component
        const handlersToRemove = [];

        // Check for handlers with this component ID in their key (using precise matching)
        this.eventHandlers.forEach((handler, key) =>
        {
            // Use precise matching instead of substring to avoid false positives
            const isComponentHandler = (
                key.startsWith(`action-${componentId}-`) ||
                key.startsWith(`listener-${componentId}-`) ||
                key.startsWith(`outside-${componentId}-`) ||
                key.startsWith(`model-${componentId}-`) ||
                key.startsWith(`manual_${componentId}_`) ||  // WildQuery $el().on() handlers
                key.startsWith(`${componentId}-`) ||
                key === componentId
            );

            if (isComponentHandler)
            {
                // Remove structured event listener if present
                if (typeof handler === 'object' && handler.target && handler.event && handler.handler)
                {
                    handler.target.removeEventListener(
                        handler.event,
                        handler.handler,
                        handler.options
                    );
                }
                handlersToRemove.push(key);
            }
        });

        // Remove all identified handlers
        handlersToRemove.forEach(key =>
        {
            this.eventHandlers.delete(key);
        });

        // Drop this component's outside-click registrations. Otherwise the
        // registry retains the destroyed instance (and its element) until the
        // next document click happens to run the lazy isConnected sweep.
        if (this._outsideClickRegistry)
        {
            for (const [el, methodMap] of this._outsideClickRegistry)
            {
                for (const [name, entry] of methodMap)
                {
                    if (entry && entry.instance && entry.instance.id === componentId)
                    {
                        methodMap.delete(name);
                    }
                }
                if (methodMap.size === 0) this._outsideClickRegistry.delete(el);
            }
        }




        // Also clean up from DOM elements collections

        ['bindings', 'conditionals', 'lists', 'models'].forEach(collectionName =>
        {
            const collection = this.domElements[collectionName];
            if (Array.isArray(collection))
            {
                this.domElements[collectionName] = collection.filter(item => item.componentId !== componentId);
            }
        });

        // Recursively clean up child components' event handlers
        const childIds = this.componentChildren.get(componentId) || [];

        childIds.forEach(childId =>
        {
            this._cleanupComponentEventHandlers(childId);
        });
    },
    // GARBAGE COLLECTION
    /**
     * Perform garbage collection to clean up orphaned components and resources.
     *
     * This method identifies and removes:
     * - Components whose DOM elements are no longer in the document
     * - DOM elements with component IDs that don't match active components
     * - Event handlers for non-existent components
     * - Binding references for destroyed components
     * - Orphaned contexts in the context registry
     * - Stale deferred dependencies
     *
     * Note: Virtual/persistent components and components marked with data-external
     * are preserved and not garbage collected.
     *
     * @returns {Object} Statistics about what was cleaned up:
     *   - orphanedComponentsRemoved: Number of orphaned components destroyed
     *   - orphanedElementsRemoved: Number of orphaned DOM elements removed
     *   - eventHandlersCleared: Number of event handlers cleaned up
     *   - bindingsRemoved: Number of binding references removed
     *   - orphanedContextsRemoved: Number of orphaned contexts cleaned (if context system active)
     *   - deferredDependenciesCleared: Number of stale deferred dependencies removed
     *
     * @example
     * // Manual garbage collection
     * const stats = wildflower.garbageCollect();
     * console.log(`Cleaned up ${stats.orphanedComponentsRemoved} orphaned components`);
     *
     * @example
     * // Periodic cleanup in long-running apps
     * setInterval(() => wildflower.garbageCollect(), 60000);
     */
    garbageCollect(scopeElement)
    {
        // Track stats
        const stats = {
            orphanedComponentsRemoved: 0,
            orphanedElementsRemoved: 0,
            eventHandlersCleared: 0,
            bindingsRemoved: 0
        };

        // Scope: search within scopeElement if provided, otherwise the whole document
        const root = scopeElement || document;

        // Find elements with component-id that aren't associated with active components.
        // Only remove elements that are detached from the document; live DOM elements
        // may be awaiting re-initialization and must not be destroyed.
        const elementsWithComponentId = root.querySelectorAll('[data-component-id]');
        Array.from(elementsWithComponentId).forEach(el =>
        {
            const componentId = el.dataset.componentId;
            if (!this.componentInstances.has(componentId))
            {
                if (!document.body.contains(el)) {
                    // Truly orphaned (detached from DOM) - safe to remove
                    el.remove();
                    stats.orphanedElementsRemoved++;
                } else {
                    // Still in live DOM but no instance; strip stale component-id
                    // so it can be re-scanned as a fresh component
                    delete el.dataset.componentId;
                }
            }
        });

        // Find components with no DOM presence
        const orphanedIds = [];
        this.componentInstances.forEach((instance, id) =>
        {
            // Skip virtual/store components that don't have DOM elements
            if (instance.name === 'app-store' || id.includes('app-store') ||
                instance.isVirtual || instance.isPersistent) {
                // Don't garbage collect virtual/persistent components
                return;
            }

            // Skip components marked as external (preserved components)
            if (instance.element && instance.element.hasAttribute('data-external')) return;

            // When scoped, only collect components within the scope element
            if (scopeElement && instance.element && !scopeElement.contains(instance.element)) return;

            if (!instance.element || !document.body.contains(instance.element))
            {
                orphanedIds.push(id);
            }
        });

        // Clean up each orphaned component
        orphanedIds.forEach(id =>
        {
            const result = this.destroyComponent(id);
            if (result) stats.orphanedComponentsRemoved++;
        });

        // Clean up orphaned event handlers
        this.eventHandlers.forEach((handler, key) =>
        {
            // Determine the component ID - prefer explicit componentId property if available
            // Fall back to parsing the key for older-style handlers
            let componentId;
            if (handler && handler.componentId) {
                // New format: componentId stored explicitly on handler object
                componentId = handler.componentId;
            } else {
                // Fallback format: parse from key (type-componentId-...)
                // Note: This doesn't work for manual_ keys where component IDs contain hyphens
                const [_type, parsedId] = key.split('-');
                componentId = parsedId;
            }

            // If this handler belongs to a component that no longer exists
            if (componentId && !this.componentInstances.has(componentId))
            {
                if (typeof handler === 'object' && handler.target && handler.event)
                {
                    handler.target.removeEventListener(handler.event, handler.handler, handler.options);
                }
                this.eventHandlers.delete(key);
                stats.eventHandlersCleared++;
            }
        });

        // Clean up binding references for non-existent components
        const activeComponentIds = new Set(this.componentInstances.keys());

        ['bindings', 'conditionals', 'lists', 'models'].forEach(collection =>
        {
            const initialLength = this.domElements[collection].length;
            this.domElements[collection] = this.domElements[collection].filter(
                item => activeComponentIds.has(item.componentId)
            );
            stats.bindingsRemoved += (initialLength - this.domElements[collection].length);
        });

        // No context registry to garbage-collect: binding/conditional/component
        // contexts are gone, and the surviving records (render/portal/list/action)
        // GC with their owning element / instance / effect.
        stats.orphanedContextsRemoved = 0;

        // Clean up deferred dependencies for components that no longer exist
        // Keep only if: source is active AND (target is active OR target is a store reference)
        if (this._deferredDependencies && this._deferredDependencies.length > 0) {
            const initialDeferredCount = this._deferredDependencies.length;
            this._deferredDependencies = this._deferredDependencies.filter(dep => {
                // Source must be an active component
                if (!activeComponentIds.has(dep.sourceId)) {
                    return false;
                }
                // Target can be active component OR a store reference (starts with 'store-' or is 'app-store')
                const isStoreTarget = typeof dep.targetId === 'string' &&
                    (dep.targetId.startsWith('store-') || dep.targetId === 'app-store');
                return activeComponentIds.has(dep.targetId) || isStoreTarget;
            });
            stats.deferredDependenciesCleared = initialDeferredCount - this._deferredDependencies.length;
        }

        return stats;
    },
    // COMPLETE FRAMEWORK DESTRUCTION

    /**
     * Completely destroy the framework instance and release all resources.
     *
     * This is a comprehensive teardown that:
     * - Clears auto-optimization and leak detection intervals
     * - Destroys all component instances
     * - Clears all component definitions and instances
     * - Clears all template caches
     * - Removes all event handlers
     * - Clears plugin system state
     * - Resets the context registry
     *
     * Use this when completely removing WildflowerJS from a page, such as
     * during hot module replacement or when transitioning to a different
     * framework/application.
     *
     * @returns {void}
     *
     * @example
     * // Complete framework teardown
     * wildflower.destroy();
     *
     * @example
     * // HMR cleanup
     * if (module.hot) {
     *   module.hot.dispose(() => wildflower.destroy());
     * }
     */
    destroy()
    {
        // Destroy all components
        const componentIds = [...this.componentInstances.keys()];
        componentIds.forEach(id => this.destroyComponent(id));

        // Clear all collections
        this.componentInstances.clear();
        this.componentDefinitions.clear();
        this.componentParents.clear();
        this.componentChildren.clear();
        this._templateCache.general.clear();
        this._templateCache.lists.clear();
        this._templateCache.compiled.clear();
        this._templateCache.extracted.clear();
        this._templateCache.fragmentPools.clear();
        this._templateCache.stats.clear();
        this._listRelationships.clear();

        // Clear DOM elements collections
        this.domElements = {
            bindings: [],
            conditionals: [],
            lists: [],
            models: [],
            slots: []
        };

        // Clear event handlers
        this.eventHandlers.forEach((handler, _key) =>
        {
            if (typeof handler === 'object' && handler.target && handler.event)
            {
                handler.target.removeEventListener(handler.event, handler.handler, handler.options);
            }
        });
        this.eventHandlers.clear();

        // Clear directive + hook state (these ship in every build).
        this._customDirectives.clear();
        this._directiveContexts = new WeakMap();
        this._hooks.clear();

        // Clear plugin + DI state (only when the plugin feature is enabled).
        if (__FEATURE_PLUGINS__) {
            this._plugins = [];
            this._pluginsByName.clear();
            this._pluginStates.clear();
            this._providers.clear();

            // Remove dynamic $pluginName accessors
            for (const key of Object.keys(this)) {
                if (key.startsWith('$') && key !== '$') {
                    delete this[key];
                }
            }
        }

        // Clear deferred dependencies
        this._deferredDependencies = [];

        // Clear external dependencies
        if (this._externalDependencies) {
            this._externalDependencies.clear();
        }

        // Clear entity dependents
        if (this._entityDependents) {
            this._entityDependents.clear();
        }

        // Clear cross-store tracking-proxy cache
        if (this._trackingProxyCache) {
            this._trackingProxyCache.clear();
        }

        return true;
    }
};
