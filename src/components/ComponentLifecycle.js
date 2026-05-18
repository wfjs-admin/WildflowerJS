/**
 * ComponentLifecycle - Initialization, lifecycle hooks, destruction
 *
 * @module
 */

import { ReactiveStateManager } from '../state/ReactiveStateManager.js';
import { RAW_TARGET } from '../state/ContextProxy.js';
import { pathResolver } from '../core/wfUtils.js';

// Named constants (replaces magic numbers)
const LARGE_ARRAY_THRESHOLD = 500;     // Arrays above this size use synchronous render
const READY_POLL_INTERVAL_MS = 10;     // Polling interval for waitForReady()
const READY_POLL_MAX_ATTEMPTS = 1000;  // Max polls before timeout (10s at 10ms)

// Methods the framework drives directly via instance.context.X(). These bypass
// the action-before-init queue in _wrapMethod — queueing init() itself would
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
        // Set up entity pools (data-pool) — handles declarative pools block + population
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
        return new ReactiveStateManager({
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
        const inferredTypes = this._inferTypesFromState(state);
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

        // Find parent context
        let parentContext = null;
        if (parentInstance && parentInstance._componentContext) {
            parentContext = parentInstance._componentContext;
        } else if (parentId) {
            parentContext = this._contextRegistry.getContextById(parentId);
        }
        if (!parentContext) {
            parentContext = this._contextRegistry.rootContext;
        }

        // Create component context
        const componentContext = this._contextRegistry.createComponentContext(
            instance.id,
            componentName,
            {
                parent: parentContext,
                element: element,
                componentInstance: instance
            }
        );

        instance._componentContext = componentContext;
        componentContext.componentInstance = instance;

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
        // can fire before the deferred init() runs — for example, a click
        // dispatched in the same task as mount, or while waiting for a
        // subscribed store. _wrapMethod queues those calls; we replay them
        // here so they observe the post-init state the user expected.
        instance._initReady = true;
        if (instance._pendingActions && instance._pendingActions.length > 0) {
            const queued = instance._pendingActions;
            instance._pendingActions = null;
            for (let i = 0; i < queued.length; i++) {
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
        // Check for plugin hooks only when plugin feature is enabled
        const hasPluginHooks = __FEATURE_PLUGINS__ && this._hooks &&
            this._hooks.has('component:afterUpdate') &&
            this._hooks.get('component:afterUpdate').length > 0;

        // Skip if no callbacks needed
        if (!hasOnUpdate && !hasPluginHooks) return;

        // Use requestAnimationFrame to ensure DOM has been updated
        requestAnimationFrame(() => {
            this._callOnUpdateHook(instance, instance._lastChangeInfo);
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

        // Render all queued components
        this._render();

        // Process any deferred dependencies after initial component setup
        if (this._contextSystemInitialized && this._deferredDependencies && this._deferredDependencies.length > 0)
        {
            this._processDeferredDependencies();
        }

        //Rebuild component hierarchy after all components are rendered
        if (this._contextSystemInitialized)
        {
            this._buildComponentContextHierarchy();
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
                    // Track computed-to-computed dependency
                    // When formalGreeting accesses this.computed.greeting,
                    // we need to record that formalGreeting depends on computed:greeting
                    // PERF: Lightweight tracking for _updateNode dep comparison.
                    if (stateManager._nodeTrackingSet) {
                        stateManager._nodeTrackingSet.add(`computed:${prop}`);
                    } else if (stateManager.activeComputation) {
                        stateManager._trackDependency(`computed:${prop}`);
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

            // TODO(v2): Replace polling with event-driven notification from RSM.
            // Requires threading a "ready" event through the state manager subscription
            // system. Polling is correct but inelegant for a reactive framework.
            waitForReady: function() {
                return new Promise((resolve, reject) => {
                    if (!state._internal || state._internal.ready !== false) {
                        resolve();
                    } else {
                        let attempts = 0;
                        const checkReady = () => {
                            if (state._internal.ready) {
                                resolve();
                            } else if (++attempts >= READY_POLL_MAX_ATTEMPTS) {
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
                // Find the target entity
                let targetEntity = framework.componentInstances.get(entityNameOrId);

                // If not found by ID, try to find by name
                if (!targetEntity) {
                    const components = framework.getComponentsByType(entityNameOrId);
                    if (components.length > 0) {
                        targetEntity = components[0];
                    } else if (framework.storeManager) {
                        // Try to find as a store component
                        targetEntity = framework.storeManager.getStoreComponentByName(entityNameOrId);
                    }
                }

                // Try to resolve as a plugin if not found yet (only when plugin feature is enabled)
                if (__FEATURE_PLUGINS__) {
                    if (!targetEntity && framework._pluginStates) {
                        let pluginName = entityNameOrId;
                        if (pluginName.startsWith('plugin:')) {
                            pluginName = pluginName.slice(7);
                        }

                        const pluginContext = framework._pluginStates.get(pluginName);
                        if (pluginContext && pluginContext.state) {
                            // Register dependency for plugins
                            framework._registerPluginDependent(pluginName, this.id);

                            if (arguments.length === 2) {
                                try {
                                    if (path.startsWith('computed:')) {
                                        const computedName = path.slice(9);
                                        return pluginContext._stateManager?.evaluateComputed(computedName) ??
                                               pluginContext[computedName];
                                    } else {
                                        return pathResolver.get(pluginContext.state, path);
                                    }
                                } catch (error) {
                                    return path.startsWith('computed:') ? 0 : null;
                                }
                            }
                            return undefined;
                        }
                    }
                }

                if (!targetEntity) {
                    // PENDING STORE DEPENDENCY: If we're in a computed evaluation and
                    // the store doesn't exist yet, register a pending dependency so
                    // the computed property will be re-evaluated when the store is created.
                    // Check both tracking context (set during list eval) and activeComputation (always set during computed eval)
                    const trackingContext = framework._computedTrackingContext;
                    const activeComputed = this.stateManager?.activeComputation;

                    if (framework.storeManager && (trackingContext || activeComputed)) {
                        const componentId = trackingContext?.componentId || this.id;
                        const computedName = trackingContext?.computedName || activeComputed;

                        if (componentId && computedName) {
                            framework.storeManager.registerPendingStoreDependency(
                                entityNameOrId,
                                componentId,
                                computedName,
                                null // listElement will be associated during list binding
                            );
                        }
                    }

                    framework._log('debug', `Entity not found: ${entityNameOrId}, returning fallback value`);
                    // For 1-arg calls, return null; for 2-arg calls check if it's a computed path
                    return (path && path.startsWith('computed:')) ? 0 : null;
                }

                // Register entity dependency for stores (virtual components)
                if (targetEntity.isVirtual) {
                    framework._registerEntityDependent(targetEntity.id, this.id);
                }

                // Register external dependency for list item reactivity
                // This tracks which components depend on external() values so we can refresh them
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
                    let resolvedValue;

                    try {
                        if (path.startsWith('computed:')) {
                            const computedPath = path.slice(9);
                            if (computedPath.includes('.')) {
                                resolvedValue = targetEntity.stateManager._resolveComputedPath(computedPath);
                            } else {
                                resolvedValue = targetEntity.stateManager.evaluateComputed(computedPath);
                            }
                        } else {
                            resolvedValue = targetEntity.stateManager.getValue(path);
                        }

                        // Try to register dependency in context system
                        if (framework._contextSystemInitialized && framework._contextRegistry) {
                            const sourceContext = framework._contextRegistry.getContextById(this.id);
                            const targetContext = framework._contextRegistry.getContextById(targetEntity.id);

                            if (sourceContext && targetContext) {
                                framework._contextRegistry.registerDependency(sourceContext, targetContext, path);
                            } else {
                                framework._addDeferredDependency(this.id, targetEntity.id, path, 'external');
                            }
                        }

                        return resolvedValue;

                    } catch (error) {
                        return path.startsWith('computed:') ? 0 : null;
                    }
                }

                // SET VALUE case
                if (arguments.length === 3) {
                    targetEntity.stateManager.setValue(path, value);
                    if (framework._componentsToUpdate) {
                        framework._componentsToUpdate.add(targetEntity.id);
                    }
                    framework._scheduleRender();
                    return value;
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

            // Entity pool access — this.pool('enemies') or this.pool('enemies', { onAdd, onRemove, onClear })
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
                // CROSS-COMPONENT REACTIVITY: If we're inside a computed evaluation,
                // mark that computed as having external dependencies. This ensures
                // it will always re-evaluate (skip stale check optimization) since
                // the dirty flag mechanism only works within a single stateManager.
                if (stateManager && stateManager.activeComputation) {
                    if (!stateManager._computedsWithExternalDeps) {
                        stateManager._computedsWithExternalDeps = new Set();
                    }
                    stateManager._computedsWithExternalDeps.add(stateManager.activeComputation);
                }

                // Find the target component
                let targetComponent = self.componentInstances.get(componentNameOrId);

                // If not found by ID, try to find by name
                if (!targetComponent)
                {
                    const components = self.getComponentsByType(componentNameOrId);
                    if (components.length > 0)
                    {
                        targetComponent = components[0];
                    } else if (self.storeManager)
                    {
                        // Try to find as a store component
                        targetComponent = self.storeManager.getStoreComponentByName(componentNameOrId);
                    }
                }

                // Try to resolve as a plugin if not found yet (only when plugin feature is enabled)
                if (__FEATURE_PLUGINS__) {
                    if (!targetComponent && self._pluginStates) {
                        let pluginName = componentNameOrId;

                        // Handle both "plugin:name" and direct "name" format
                        if (pluginName.startsWith('plugin:')) {
                            pluginName = pluginName.slice(7);
                        }

                        const pluginContext = self._pluginStates.get(pluginName);
                        if (pluginContext && pluginContext.state) {
                            // Register this component as depending on this plugin
                            self._registerPluginDependent(pluginName, this.id);

                            // Return plugin value directly (GET case)
                            if (arguments.length === 2) {
                                try {
                                    if (path.startsWith('computed:')) {
                                        const computedName = path.slice(9);
                                        return pluginContext._stateManager?.evaluateComputed(computedName) ??
                                               pluginContext[computedName];
                                    } else {
                                        return pathResolver.get(pluginContext.state, path);
                                    }
                                } catch (error) {
                                    return path.startsWith('computed:') ? 0 : null;
                                }
                            }
                            // For SET case, plugins don't support external writes
                            return undefined;
                        }
                    }
                }

                if (!targetComponent)
                {
                    // PENDING STORE DEPENDENCY: If we're in a computed evaluation and
                    // the store doesn't exist yet, register a pending dependency so
                    // the computed property will be re-evaluated when the store is created.
                    // Check both tracking context (set during list eval) and activeComputation (always set during computed eval)
                    const trackingContext = self._computedTrackingContext;
                    const activeComputed = stateManager ? stateManager.activeComputation : null;

                    if (self.storeManager && (trackingContext || activeComputed)) {
                        const componentId = trackingContext?.componentId || instanceId;
                        const computedName = trackingContext?.computedName || activeComputed;

                        if (componentId && computedName) {
                            self.storeManager.registerPendingStoreDependency(
                                componentNameOrId,
                                componentId,
                                computedName,
                                null // listElement will be associated during list binding
                            );
                        }
                    }

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
                    let value;

                    try
                    {

                        if (path.startsWith('computed:')) {
                            const computedPath = path.slice(9);

                            // Handle dot notation in computed paths
                            if (computedPath.includes('.')) {
                                value = targetComponent.stateManager._resolveComputedPath(computedPath);
                            } else {
                                value = targetComponent.stateManager.evaluateComputed(computedPath);
                            }
                        } else {
                            // Handle dot notation in regular state paths
                            value = targetComponent.stateManager.getValue(path);
                        }

                        // Note: Entity dependency registration moved before argument count checks
                        // to handle all cases (1-arg, 2-arg, 3-arg)

                        // Register external dependency for list item reactivity
                        // This tracks which components depend on external() values so we can refresh them
                        if (self._registerExternalDependency) {
                            self._registerExternalDependency(this.id, targetComponent.id, path);
                        }

                        // Try to register dependency
                        const sourceContext = self._contextRegistry.getContextById(this.id);
                        const targetContext = self._contextRegistry.getContextById(targetComponent.id);

                        // If both contexts exist, register the dependency
                        if (sourceContext && targetContext)
                        {
                            self._contextRegistry.registerDependency(sourceContext, targetContext, path);
                        }
                        else
                        {
                            self._addDeferredDependency(this.id, targetComponent.id, path, 'external');
                        }

                        return value;

                    } catch (error)
                    {
                        return path.startsWith('computed:') ? 0 : null;
                    }
                }

                // SET VALUE case
                if (arguments.length === 3)
                {
                    targetComponent.stateManager.setValue(path, value);

                    // Trigger a render for the target component
                    if (self._componentsToUpdate)
                    {
                        self._componentsToUpdate.add(targetComponent.id);
                    }
                    self._scheduleRender();

                    return value;
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

                const componentContext = componentInstance._componentContext;

                if (!componentContext)
                {
                    self._error(WF_ERRORS.EMIT_NO_CONTEXT, {
                        context: this.id,
                        suggestion: 'Component context may not be ready - ensure emit() is called after init()'
                    });
                    return false;
                }

                let currentContext = componentContext.parent;

                // Walk up the context hierarchy
                while (currentContext && currentContext.type === 'component')
                {
                    // Only proceed if this context has a component instance
                    if (currentContext.componentInstance)
                    {
                        const parentComponent = currentContext.componentInstance;

                        // Create handler name using convention (e.g., "onClick" from "click")
                        const handlerName = `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`;

                        // Call handler if it exists in the parent component
                        if (typeof parentComponent.context[handlerName] === 'function')
                        {
                            try
                            {
                                parentComponent.context[handlerName](detail);
                            } catch (error)
                            {
                                if (__DEV__) console.error(`Error in parent event handler ${handlerName}:`, error);
                            }
                        }
                    }

                    // Move to the next parent in context hierarchy
                    currentContext = currentContext.parent;
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
     * Get list of store names that component needs to wait for.
     * @param {Object} definition - Component definition
     * @returns {string[]} Array of store names
     * @private
     */
    _getSubscribedStoreNames(definition) {
        const parsed = this._parseSubscribeDeclaration(definition.subscribe);
        return Object.keys(parsed);
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
                        // Store doesn't exist yet — register pending dependency
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

            // Register local state watcher
            instance._watcherHandlers = instance._watcherHandlers || new Map();
            instance._watcherHandlers.set(path, boundHandler);

            // Execute immediately if requested — uses _resolveComponentValue for computed-first resolution
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
            // invoking another method during execution) bypass the queue —
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
        } else {
            // Standard async render for small updates
            this._scheduleRender();
            // Schedule onUpdate to be called after async render completes
            this._scheduleOnUpdateHook(instance);
        }

        return true;
    }
};
