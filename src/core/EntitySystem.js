/**
 * EntitySystem - Unified entity system and state change handling
 *
 * @module
 */

import { RAW_TARGET } from '../state/ContextProxy.js';
import { pathResolver } from '../core/wfUtils.js';

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const EntitySystemMethods = {
/**
     * Resolve an external value from another component (used by binding expression evaluation)
     * @param {string} componentNameOrId - Name or ID of the target component
     * @param {string} path - State property path to access
     * @param {string} sourceComponentId - ID of the component requesting the value (for dependency tracking)
     * @returns {*} The value from the target component
     * @private
     */
    _resolveExternalValue(componentNameOrId, path, sourceComponentId) {
        // Find the target component
        let targetComponent = this.componentInstances.get(componentNameOrId);

        // If not found by ID, try to find by name
        if (!targetComponent) {
            const components = this.getComponentsByType(componentNameOrId);
            if (components.length > 0) {
                targetComponent = components[0];
            } else if (this.storeManager) {
                // Try to find as a store component
                targetComponent = this.storeManager.getStoreComponentByName(componentNameOrId);
            }
        }

        // Try to resolve as a plugin (check for $pluginName or plugin:name format)
        // Only when plugin feature is enabled
        if (__FEATURE_PLUGINS__) {
            if (!targetComponent && this._pluginStates) {
                let pluginName = componentNameOrId;

                // Handle both "plugin:name" and direct "name" format
                if (pluginName.startsWith('plugin:')) {
                    pluginName = pluginName.slice(7);
                }

                const pluginContext = this._pluginStates.get(pluginName);
                if (pluginContext && pluginContext.state) {
                    // Register this component as depending on this plugin
                    if (sourceComponentId) {
                        this._registerPluginDependent(pluginName, sourceComponentId);
                    }

                    // Return the value from plugin state
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
            }
        }

        if (!targetComponent) {
            return path.startsWith('computed:') ? 0 : null;
        }

        let value;
        try {
            if (path.startsWith('computed:')) {
                const computedPath = path.slice(9);
                if (computedPath.includes('.')) {
                    value = targetComponent.stateManager._resolveComputedPath(computedPath);
                } else {
                    value = targetComponent.stateManager.evaluateComputed(computedPath);
                }
            } else {
                value = targetComponent.stateManager.getValue(path);
            }

            // Register external dependency for reactive updates
            // This tracks which components depend on external values from other components
            if (sourceComponentId && targetComponent.id) {
                this._registerExternalDependency(sourceComponentId, targetComponent.id, path);
            }

            return value;
        } catch (error) {
            return path.startsWith('computed:') ? 0 : null;
        }
    },
    /**
     * Register an external dependency between components
     * When targetComponentId's state changes at path, sourceComponentId should be re-rendered
     * @param {string} sourceComponentId - Component that depends on external value
     * @param {string} targetComponentId - Component providing the external value
     * @param {string} path - The state path being depended on
     * @private
     */
    _registerExternalDependency(sourceComponentId, targetComponentId, path) {
        // Key by target component - when it changes, we need to update all dependents
        const key = `${targetComponentId}:${path}`;
        if (!this._externalDependencies.has(key)) {
            this._externalDependencies.set(key, new Set());
        }
        this._externalDependencies.get(key).add(sourceComponentId);

        // Also track by target component (for any state change)
        const componentKey = targetComponentId;
        if (!this._externalDependencies.has(componentKey)) {
            this._externalDependencies.set(componentKey, new Set());
        }
        this._externalDependencies.get(componentKey).add(sourceComponentId);
    },
    /**
     * Register a component as depending on a plugin's state
     * When the plugin's state changes, the dependent component should be updated
     * @param {string} pluginName - Name of the plugin
     * @param {string} componentId - ID of the component that depends on this plugin
     * @private
     */
    _registerPluginDependent(pluginName, componentId) {
        // Use unified _entityDependents (formerly _pluginDependents)
        // Plugin names are prefixed with 'plugin:' to distinguish from components/stores
        const entityKey = `plugin:${pluginName}`;
        this._registerEntityDependent(entityKey, componentId);
    },
    /**
     * Get all component IDs that depend on a given plugin
     * @param {string} pluginName - Name of the plugin
     * @returns {Set<string>} Set of component IDs
     * @private
     */
    _getPluginDependents(pluginName) {
        const entityKey = `plugin:${pluginName}`;
        return this._getEntityDependents(entityKey);
    },
    /**
     * Register a component as dependent on an entity (store or plugin)
     * When the entity's state changes, all dependents will be notified.
     * @param {string} entityId - ID of the entity being depended on
     * @param {string} componentId - ID of the dependent component
     * @private
     */
    _registerEntityDependent(entityId, componentId) {
        if (!this._entityDependents.has(entityId)) {
            this._entityDependents.set(entityId, new Set());
        }
        this._entityDependents.get(entityId).add(componentId);
        // Invalidate cached "no notify targets" flag on the entity instance
        const instance = this.componentInstances.get(entityId);
        if (instance) instance._hasNotifyTargets = true;
        // Track whether this entity has any DOM component dependents.
        // Stores without DOM dependents can skip onStateChange in SET traps.
        const depInstance = this.componentInstances.get(componentId);
        if (instance?.stateManager && depInstance && !depInstance.isVirtual) {
            instance.stateManager._hasDOMDependents = true;
        }
    },
    /**
     * Get all component IDs that depend on a given entity
     * @param {string} entityId - ID of the entity
     * @returns {Set<string>} Set of dependent component IDs
     * @private
     */
    _getEntityDependents(entityId) {
        return this._entityDependents.get(entityId) || new Set();
    },
    /**
     * AUTOMATIC DEPENDENCY TRACKING PROXY
     *
     * Creates a proxy that tracks property access on entity state/computed
     * during computed property evaluation. When access is detected, the
     * accessing component is automatically registered as a dependent.
     *
     * Used by: getStore(), getComponent(), $pluginName accessor
     *
     * @param {Object} entityContext - The entity context object (has state, computed, methods)
     * @param {string} entityId - ID of the entity for dependency registration
     * @param {string} entityName - Name of the entity for path tracking
     * @param {string} entityType - Type: 'store', 'component', or 'plugin'
     * @returns {Proxy} Wrapped entity context that tracks access
     * @private
     */
    _createEntityTrackingProxy(entityContext, entityId, entityName, entityType) {
        const framework = this;
        const trackingContext = this._computedTrackingContext;

        if (!trackingContext || !trackingContext.componentId) {
            return entityContext;
        }

        const componentId = trackingContext.componentId;

        // Track which paths have been registered to avoid duplicates
        const registeredPaths = new Set();

        const registerDependency = (path) => {
            const fullPath = `${entityName}.${path}`;
            if (registeredPaths.has(fullPath)) return;
            registeredPaths.add(fullPath);

            // Register the component as dependent on this entity
            framework._registerEntityDependent(entityId, componentId);

            // Track which entity paths this component depends on
            const instance = framework.componentInstances.get(componentId);
            if (instance && instance.stateManager) {
                const depKey = `_${entityType}Dependencies`;
                if (!instance[depKey]) {
                    instance[depKey] = new Map();
                }
                if (!instance[depKey].has(entityName)) {
                    instance[depKey].set(entityName, new Set());
                }
                instance[depKey].get(entityName).add(path);
            }
        };

        // Create a proxy for the state object that tracks property access
        const createStateProxy = (state, basePath) => {
            if (!state || typeof state !== 'object') return state;

            return new Proxy(state, {
                get(target, prop) {
                    // Skip symbols to prevent "can't convert symbol to string" errors
                    if (typeof prop === 'symbol') {
                        return target[prop];
                    }
                    const value = target[prop];
                    const path = basePath ? `${basePath}.${prop}` : `state.${prop}`;

                    // Register dependency for this state path
                    if (typeof prop === 'string' && prop !== 'then') {
                        registerDependency(path);
                    }

                    // If the value is an object, wrap it too for nested access
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        return createStateProxy(value, path);
                    }

                    return value;
                }
            });
        };

        // Create proxy for computed object
        const createComputedProxy = (computed) => {
            if (!computed || typeof computed !== 'object') return computed;

            return new Proxy(computed, {
                get(target, prop) {
                    if (typeof prop === 'string' && prop !== 'then') {
                        registerDependency(`computed.${prop}`);
                    }
                    return target[prop];
                }
            });
        };

        // Create the main entity context proxy
        return new Proxy(entityContext, {
            get(target, prop) {
                if (prop === 'state' && target.state) {
                    return createStateProxy(target.state, '');
                }
                if (prop === 'computed' && target.computed) {
                    return createComputedProxy(target.computed);
                }
                // For stateManager access (components), also wrap
                if (prop === 'stateManager' && target.stateManager) {
                    return target.stateManager;
                }
                // Context proxy shorthand: track dependency when prop resolves
                // to a computed or state property via the unified context proxy
                if (typeof prop === 'string' && prop !== 'then') {
                    const sm = target.stateManager;
                    if (sm) {
                        if (sm.computed && sm.computed[prop]) {
                            registerDependency(`computed.${prop}`);
                        } else if (target.state && prop in target.state) {
                            registerDependency(`state.${prop}`);
                        }
                    }
                }
                return target[prop];
            }
        });
    },
    /**
     * UNIFIED STATE CHANGE HANDLER
     *
     * Handle state change for any reactive entity (component, store, or plugin).
     * This is the single entry point for all state change notifications.
     *
     * For components (isVirtual === false):
     *   - Defers updates during initialization
     *   - Triggers lifecycle hooks (beforeUpdate, onUpdate)
     *   - Updates DOM bindings, lists, and contexts
     *   - Executes watchers
     *   - Schedules render with sync/async based on array size
     *
     * For stores/plugins (isVirtual === true):
     *   - Notifies dependent components
     *   - Invalidates dependent computed caches
     *   - Schedules render
     *
     * @param {string} entityId - ID of the entity whose state changed
     * @param {string} path - Path that changed
     * @param {any} newValue - New value
     * @param {any} oldValue - Previous value
     * @private
     */
    _handleEntityStateChange(entityId, path, newValue, oldValue) {
        const instance = this.componentInstances.get(entityId);
        if (!instance) {
            return;
        }

        const isComponent = !instance.isVirtual;

        // === VIRTUAL STORE FAST EXIT ===
        // For headless stores with no dependents, skip all notification work.
        // This saves ~22% of profile time in cross-store computed benchmarks.
        // Cached flag _hasNotifyTargets is set to true when dependents or
        // path subscribers are registered; defaults to undefined (check needed).
        if (!isComponent) {
            if (instance._hasNotifyTargets === false) {
                return;
            }
            if (instance._hasNotifyTargets === undefined) {
                // First call: check and cache
                const deps = this._getEntityDependents(entityId);
                const hasDeps = deps && deps.size > 0;
                const storeName = instance.name?.startsWith('store-')
                    ? instance.name.slice(6) : instance.name;
                const hasSubs = this.storeManager?.hasPathSubscribers(storeName);
                const hasExtDeps = this._externalDependencies &&
                    (this._externalDependencies.has(entityId) ||
                     this._externalDependencies.has(`${entityId}:`));
                instance._hasNotifyTargets = !!(hasDeps || hasSubs || hasExtDeps);
                if (!instance._hasNotifyTargets) {
                    return;
                }
            }
        }

        // === COMPONENT-ONLY: Initialization Deferral ===
        if (isComponent && this._deferComponentUpdate(entityId, path, newValue, oldValue)) {
            return;
        }

        // === SHARED: Add to update queue ===
        this._componentsToUpdate.add(entityId);

        // === SHARED: Notify all dependent entities ===
        // This ensures stores/plugins notify their dependent components
        const dependents = this._getEntityDependents(entityId);
        dependents.forEach(componentId => {
            const dependentInstance = this.componentInstances.get(componentId);
            if (!dependentInstance || !dependentInstance.stateManager) {
                this._componentsToUpdate.add(componentId);
                return;
            }

            const sm = dependentInstance.stateManager;

            // Virtual store fast exit: lean eval path handles
            // re-evaluation lazily — just bump cache generation.
            if (dependentInstance.isVirtual &&
                !dependentInstance._propPaths)
            {
                sm._cacheGeneration = (sm._cacheGeneration || 0) + 1;
                return;
            }

            this._componentsToUpdate.add(componentId);

            // Update props first if this component receives props from the changed parent
            this._updateComponentProps(dependentInstance);

            // Mark computed nodes as DIRTY and schedule re-evaluation.
            // Virtual stores use lean eval (fn() directly) so dirty flags
            // don't matter — only sweep for DOM components.
            if (!dependentInstance.isVirtual) {
                if (sm._computedNodes) {
                    for (const [compName, node] of sm._computedNodes) {
                        node.flags |= 2; // DIRTY
                    }
                }
                const computedNames = sm.getComputedPropertyNames();
                computedNames.forEach(propName => {
                    sm.scheduleComputedEvaluation(propName);
                });
            }
            sm._cacheGeneration = (sm._cacheGeneration || 0) + 1;

            // Refresh item-level computed bindings in lists
            // Per-item effects handle this for effect-backed components
            if (dependentInstance.element && this._refreshListItemComputedBindings
                && !dependentInstance._renderEffect) {
                const listElements = dependentInstance.element.querySelectorAll('[data-list]');
                listElements.forEach(listEl => {
                    if (listEl._listContext) {
                        const listContext = listEl._listContext;
                        const items = listContext.data || [];
                        const listItems = listEl.querySelectorAll(':scope > *:not(template)');
                        listItems.forEach((itemEl, idx) => {
                            if (idx < items.length) {
                                const item = items[idx];
                                this._refreshListItemComputedBindings(itemEl, item, idx, listContext, dependentInstance);
                            }
                        });
                    }
                });
            }
        });

        // === STORE-ONLY: Notify path subscribers (subscribe: {} feature) ===
        // Call onStoreUpdate() on components that declared subscribe: { storeName: ['path'] }
        if (!isComponent && instance.name && this.storeManager) {
            // Get the user-facing store name (without 'store-' prefix if it exists)
            // Store instances have name like 'store-kanban', but users subscribe as 'kanban'
            const storeName = instance.name.startsWith('store-')
                ? instance.name.slice(6)
                : instance.name;

            // Fast check using V8-optimized flag
            if (this.storeManager.hasPathSubscribers(storeName)) {
                const subscribers = this.storeManager.getPathSubscribers(storeName, path);

                if (subscribers && subscribers.size > 0) {
                    // Check for computed evaluation (defer notifications during computed)
                    const isDeferring = this._isEvaluatingComputed;

                    if (isDeferring) {
                        // Defer notification until computed evaluation is complete
                        this._deferredStoreNotifications = this._deferredStoreNotifications || [];

                        // Limit queue size to prevent memory issues
                        if (this._deferredStoreNotifications.length > 1000) {
                            if (__DEV__) console.warn('[WF] Deferred store notifications exceeded limit, forcing flush');
                            this._flushDeferredStoreNotifications();
                        }

                        this._deferredStoreNotifications.push({
                            storeName,
                            path,
                            newValue,
                            oldValue,
                            subscribers: new Set(subscribers)
                        });
                    } else {
                        // Notify subscribers immediately
                        this._notifyPathSubscribers(storeName, path, newValue, oldValue, subscribers);
                    }
                }
            }
        }

        // === SHARED: Notify external() dependents ===
        // Components using external('entityName', 'path') need updates when that path changes
        if (this._externalDependencies) {
            // Check both specific path and any-path dependents
            const pathKey = `${entityId}:${path}`;
            const externalDependents = new Set();

            // Collect dependents for specific path
            if (this._externalDependencies.has(pathKey)) {
                this._externalDependencies.get(pathKey).forEach(id => externalDependents.add(id));
            }
            // Collect dependents for any change to this entity
            if (this._externalDependencies.has(entityId)) {
                this._externalDependencies.get(entityId).forEach(id => externalDependents.add(id));
            }

            externalDependents.forEach(componentId => {
                // Skip if already in update queue from entity dependents
                if (!this._componentsToUpdate.has(componentId)) {
                    this._componentsToUpdate.add(componentId);
                }

                // Force re-render of the component's lists that use external()
                const dependentInstance = this.componentInstances.get(componentId);
                if (dependentInstance && dependentInstance.element) {
                    // Effect-backed components: effects re-run automatically when external() deps change
                    if (!dependentInstance._renderEffect) {
                        // Find all list contexts in this component
                        const listElements = dependentInstance.element.querySelectorAll('[data-list]');
                        listElements.forEach(listEl => {
                            const listPath = listEl.dataset.list;

                            // Check if this list uses external() or $store.path syntax
                            const usesExternalStore = listPath && (
                                listPath.includes('external(') ||
                                listPath.includes('$')
                            );

                            if (usesExternalStore && this._processList) {
                                // CRITICAL FIX: For external store lists, trigger FULL re-render
                                // not just binding refresh. This handles add/remove operations.
                                this._processList(
                                    {
                                        element: listEl,
                                        path: listPath,
                                        componentId: dependentInstance.id
                                    },
                                    dependentInstance,
                                    true // forceUpdate to ensure re-render
                                );
                            } else if (listEl._listContext) {
                                // For non-external lists, just refresh bindings on existing items
                                const listContext = listEl._listContext;
                                const items = listContext.data || [];

                                const listItems = listEl.querySelectorAll(':scope > *:not(template)');
                                listItems.forEach((itemEl, idx) => {
                                    if (idx < items.length) {
                                        const item = items[idx];
                                        this._refreshListItemExternalBindings(itemEl, item, idx, listContext);
                                    }
                                });
                            }
                        });

                        // Also refresh STANDALONE elements (not in lists) with external() bindings
                        this._refreshStandaloneExternalBindings(dependentInstance);
                    }
                }
            });
        }

        // === COMPONENT-ONLY: Lifecycle, DOM, Lists, Watchers ===
        if (isComponent) {
            const changeInfo = { path, newValue, oldValue };

            // Update child component props that depend on this parent's state
            if (instance.children && instance.children.length > 0) {
                instance.children.forEach(childInstance => {
                    if (this._updateComponentProps(childInstance)) {
                        // Props changed - update child's bindings that use props.* paths
                        this._updatePropsBindingsForComponent(childInstance);

                        // Re-run child's render effect so bindings that read props
                        // (including computed properties that depend on props) update.
                        // Props aren't reactive proxy properties, so the effect doesn't
                        // track them as dependencies — we trigger it explicitly.
                        // If the child lacks an effect (e.g., batch didn't flush), create one now.
                        if (!childInstance._renderEffect && this._collectComponentBindingMeta && this._createComponentRenderEffect) {
                            childInstance._effectMeta = this._collectComponentBindingMeta(childInstance);
                            if (childInstance._effectMeta?.length) {
                                this._createComponentRenderEffect(childInstance);
                            }
                        }
                        const childEffect = childInstance._renderEffect?._effect;
                        if (childEffect && !childEffect.disposed) {
                            childEffect.dirty = true;
                            childInstance.stateManager._runEffect(childEffect);
                        }

                        // Flush computed evaluations before onPropsChange so computed properties
                        // reflect the new props values when the lifecycle hook runs
                        if (childInstance.stateManager && childInstance.stateManager._flushComputedEvaluationQueue) {
                            childInstance.stateManager._flushComputedEvaluationQueue();
                        }

                        // Trigger child's onPropsChange lifecycle hook if defined
                        const propsChangeInfo = { parentPath: path, newValue, oldValue };
                        if (this._triggerHook) this._triggerHook('component:onPropsChange', childInstance, propsChangeInfo);
                        if (childInstance.definition && typeof childInstance.definition.onPropsChange === 'function') {
                            try {
                                childInstance.definition.onPropsChange.call(childInstance.context, propsChangeInfo);
                            } catch (error) {
                                if (__DEV__) console.error(`[WF] Error in onPropsChange for ${childInstance.name}:`, error);
                            }
                        }
                    }
                });
            }

            // Trigger beforeUpdate lifecycle hook
            instance._lastChangeInfo = changeInfo;
            if (this._triggerHook) this._triggerHook('component:beforeUpdate', instance, changeInfo);
            this._callBeforeUpdateHook(instance);

            // Handle DOM updates (bindings, contexts, path tracking)
            this._handleComponentDOMUpdates(instance, path, newValue, oldValue);

            // Set current updating instance for context in rendering
            this._currentUpdatingInstance = instance;

            try {
                // Handle list state changes — skip when component has no lists
                const listAffected = instance._listContexts?.size > 0
                    ? this._handleComponentListStateChange(instance, path, newValue, oldValue)
                    : false;

                // Execute watchers
                this._executeWatchers(instance, path, newValue, oldValue);

                // Update contexts for state change
                if (this._contextSystemInitialized && this._contextRegistry) {
                    this._updateContextsForStateChange(entityId, path);
                    // Notify dependent contexts (e.g., child components with props from this parent).
                    // Required: PropsSystem registers context-level deps that are NOT in _entityDependents.
                    this._contextRegistry._notifyDependentContexts(entityId, path, newValue, oldValue);
                }

                // Schedule rendering (handles sync vs async, batch mode, etc.)
                this._scheduleComponentRender(instance, newValue, listAffected);
            } finally {
                // Clear current updating instance
                this._currentUpdatingInstance = null;
            }
        } else {
            // === STORE/PLUGIN: Simple context notification and render ===
            // Notify through context system if available
            if (this._contextSystemInitialized && this._contextRegistry) {
                this._contextRegistry._notifyDependentContexts(entityId, path, newValue, oldValue);
            }

            // Schedule render ONLY if DOM-attached components need updating.
            // Headless stores (no subscribing components with DOM elements) skip this entirely.
            // This avoids ~200K RAF scheduling calls in cross-store computed benchmarks.
            let hasDOMUpdates = false;
            for (const compId of this._componentsToUpdate) {
                const comp = this.componentInstances.get(compId);
                if (comp && comp.element) {
                    hasDOMUpdates = true;
                    break;
                }
            }
            if (hasDOMUpdates) {
                this._scheduleRender();
            }
        }
    },
    /**
     * Handle DOM updates for a component when state changes.
     * Updates binding contexts, tracks changed paths, and queues contexts for render.
     * @param {Object} instance - Component instance
     * @param {string} path - The state path that changed
     * @param {*} newValue - New value
     * @param {*} oldValue - Previous value
     * @private
     */
    _handleComponentDOMUpdates(instance, path, newValue, oldValue) {
        const instanceId = instance.id;

        // Track HTML binding components that need updates
        const componentHasHTMLBindings = (this.domElements.htmlBindings || []).some(binding =>
            binding.componentId === instanceId
        );

        if (componentHasHTMLBindings) {
            this._ensureSet('_batchChangedComponents');
            this._batchChangedComponents.add(instanceId);
        }

        // Update binding contexts through context system
        if (this._contextSystemInitialized && this._contextRegistry) {
            // Note: _notifyDependentContexts is called by the caller (_handleEntityStateChange)
            // after this function returns, so we don't need to call it here

            // PERFORMANCE OPTIMIZATION: Skip O(n) binding iteration for array operations
            // where ListRenderer handles updates through optimized paths.
            //
            // Case 1: Array REPLACEMENT (newValue !== oldValue) - clear, replace, full reassignment
            // Case 2: Array LENGTH CHANGE notification (path ends with .length)
            // Case 3: Array with recorded operation hint (splice/append/swap detected by RSM)
            //
            // We still need binding updates for:
            // - In-place property mutations (forEach changing item.label) - same ref, same length
            // - Non-array state changes

            // Check for .length path - indicates array structural change
            if (path.endsWith('.length')) {
                const arrayPath = path.slice(0, -7); // Remove '.length'
                if (this._isListManagedPath(arrayPath, instance)) {
                    return;
                }
            }

            // Check for array with operation hint or replacement
            if (Array.isArray(newValue) && this._isListManagedPath(path, instance)) {
                // Replacement: different array reference
                if (newValue !== oldValue) {
                    return;
                }
                // Check for recorded array operation (splice, append, swap, sparse-update)
                // These are handled by ListRenderer through optimized paths
                const stateManager = instance.stateManager;
                if (stateManager?._arrayOperations?.has(path)) {
                    const op = stateManager._arrayOperations.get(path);
                    // Skip for all list operations - ListRenderer handles binding updates
                    // via _renderListSparseUpdate (for sparse-update) or full re-render
                    if (op && (op.type === 'splice' || op.type === 'append' || op.type === 'swap' || op.type === 'sparse-update')) {
                        // Don't consume the hint here - let ListRenderer consume it
                        // so it can use the metadata for optimized rendering
                        return;
                    }
                }
                // Check for splice-in-progress or collision lockout
                if (stateManager?._arrayIndexMutations?.isSpliceInProgress ||
                    stateManager?._collisionLockout?.has(path)) {
                    return;
                }
            }

            // Per-item effects handle all list-item binding updates
            // via _bindWithCompiledMetadata in effect re-runs. No EntitySystem
            // intervention needed for list-item bindings.
        }

        // Track updated paths for rendering
        this._updatedPaths.add(path);

        // For complex structures, also track parent paths
        if (path.includes('.')) {
            const parts = path.split('.');
            let currentPath = '';

            for (let i = 0; i < parts.length - 1; i++) {
                currentPath = currentPath ? `${currentPath}.${parts[i]}` : parts[i];
                this._updatedPaths.add(currentPath);
            }
        }

        // For array length changes, add specific tracking
        if (Array.isArray(newValue)) {
            this._updatedPaths.add(`${path}.length`);
        }

        // Track pending state changes
        this._pendingStateChanges.add(path);
    },
    /**
     * Bind methods from a definition to a context object.
     * Works for components, stores, and plugins. Methods are bound BEFORE init() is called.
     * @param {Object} definition - Entity definition containing methods
     * @param {Object} context - Context object to bind methods to
     * @param {Object} [instance] - Optional instance for storing original methods
     * @private
     */
    _bindEntityMethods(definition, context, instance = null) {
        const framework = this;
        // Get the raw context to bypass the context proxy's SET trap,
        // which would route writes to state when property names collide.
        const rawContext = context[RAW_TARGET] || context;

        Object.entries(definition).forEach(([key, value]) => {
            if (typeof value === 'function' &&
                key !== 'state' &&
                key !== 'computed' &&
                key !== 'watch' &&
                key !== 'init' &&
                key !== 'beforeInit' &&
                key !== 'beforeUpdate' &&
                key !== 'onUpdate' &&
                key !== 'beforeDestroy' &&
                key !== 'destroy') {

                // Create bound wrapper with error handling
                const boundMethod = function(...args) {
                    try {
                        return value.apply(context, args);
                    } catch (error) {
                        if (__DEV__) console.error(`Error in ${key}:`, error);
                        throw error;
                    }
                };

                rawContext[key] = boundMethod;

                // Also expose on instance if provided
                if (instance) {
                    instance[key] = boundMethod;
                }
            }
        });
    },
    /**
     * Create subscription for watching state changes on any entity.
     * Shared implementation for stores, plugins, and components.
     * @param {ReactiveStateManager} stateManager - The state manager
     * @param {Object} state - The state proxy
     * @param {string} path - Path to watch
     * @param {Function} callback - Callback on change
     * @param {Object} options - { immediate: boolean, once: boolean }
     * @returns {Function} Unsubscribe function
     * @private
     */
    _createEntitySubscription(stateManager, state, path, callback, options = {}) {
        const { immediate = false, once = false } = options;

        // Create a unique subscription ID
        const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        // Initialize subscription system if needed
        if (!stateManager._subscriptions) {
            stateManager._subscriptions = new Map();

            // Augment onStateChange to call subscribers
            const originalOnStateChange = stateManager.onStateChange;
            stateManager.onStateChange = function(changedPath, newValue, oldValue) {
                // Call original handler first
                if (originalOnStateChange) {
                    originalOnStateChange(changedPath, newValue, oldValue);
                }

                // Check if store is ready (if it has _internal.ready tracking)
                const isReady = !state._internal || state._internal.ready !== false;

                // Only notify subscribers if ready
                if (isReady && stateManager._subscriptions) {
                    stateManager._subscriptions.forEach((subInfo, subId) => {
                        const { subPath, handler, options: subOptions } = subInfo;

                        // Only call if path matches subscription path
                        if (changedPath === subPath ||
                            changedPath.startsWith(`${subPath}.`) ||
                            (subPath === '' && changedPath)) {

                            // Call the handler
                            handler(newValue, oldValue, changedPath);

                            // Handle once option
                            if (subOptions && subOptions.once) {
                                stateManager._subscriptions.delete(subId);
                            }
                        }
                    });
                }
            };
        }

        // Store subscription info
        stateManager._subscriptions.set(subscriptionId, {
            subPath: path,
            handler: callback,
            options: { once }
        });

        // Call immediately if requested and store is ready
        if (immediate && (!state._internal || state._internal.ready !== false)) {
            const currentValue = pathResolver.get(state, path);
            callback(currentValue, undefined, path);
            if (once) {
                stateManager._subscriptions.delete(subscriptionId);
                return () => {}; // Already unsubscribed
            }
        }

        // Return unsubscribe function
        const unsubscribe = () => {
            stateManager._subscriptions?.delete(subscriptionId);
        };

        return unsubscribe;
    },
    /**
     * Notify path subscribers (components with subscribe: {} declaration) about a store path change.
     * Calls each subscriber's onStoreUpdate() method with the change details.
     *
     * @param {string} storeName - Name of the store that changed
     * @param {string} path - Path within the store that changed
     * @param {*} newValue - New value at the path
     * @param {*} oldValue - Previous value at the path
     * @param {Set<Object>} subscribers - Set of subscribed component instances
     * @private
     */
    _notifyPathSubscribers(storeName, path, newValue, oldValue, subscribers) {
        // Re-entrancy guard: prevent infinite loops if onStoreUpdate modifies the store
        const pathKey = `${storeName}:${path}`;
        if (this._notifyingPaths.has(pathKey)) {
            if (__DEV__) console.warn(`[WF] Re-entrant store update detected for ${pathKey}`);
            return;
        }

        this._notifyingPaths.add(pathKey);

        try {
            subscribers.forEach(componentInstance => {
                // Skip if component was destroyed
                if (!componentInstance || !this.componentInstances.has(componentInstance.id)) {
                    return;
                }

                // Call onStoreUpdate if the component has it defined
                if (typeof componentInstance.definition?.onStoreUpdate === 'function') {
                    try {
                        componentInstance.definition.onStoreUpdate.call(
                            componentInstance.context,
                            storeName,
                            path,
                            newValue,
                            oldValue
                        );
                    } catch (error) {
                        this._handleError(
                            `Error in ${componentInstance.name}.onStoreUpdate`,
                            error,
                            componentInstance,
                            { lifecycle: 'onStoreUpdate', storeName, path }
                        );
                    }
                }
            });
        } finally {
            this._notifyingPaths.delete(pathKey);
        }
    },
    /**
     * Flush deferred store notifications that accumulated during computed evaluation.
     * Called when computed evaluation completes.
     *
     * @private
     */
    _flushDeferredStoreNotifications() {
        if (!this._deferredStoreNotifications || this._deferredStoreNotifications.length === 0) {
            return;
        }

        // Take the queue and clear it to prevent re-entrancy issues
        const queue = this._deferredStoreNotifications;
        this._deferredStoreNotifications = [];

        // Process each deferred notification
        queue.forEach(({ storeName, path, newValue, oldValue, subscribers }) => {
            this._notifyPathSubscribers(storeName, path, newValue, oldValue, subscribers);
        });
    },
    /**
     * Check if a path is managed by a list context (and thus should skip context iteration)
     * List-managed paths are updated by ListRenderer optimizations, not context iteration.
     * @param {string} path - The state path that changed
     * @param {Object} instance - Component instance
     * @returns {boolean} true if ListRenderer handles this path
     * @private
     */
    _isListManagedPath(path, instance) {
        // No list contexts = not list-managed
        if (!instance._listContexts || instance._listContexts.size === 0) {
            return false;
        }

        // Parse path parts to determine if this is an array-level or property-level change
        const parts = path.split('.');
        const basePath = parts[0];

        // Only skip for array-level changes, NOT property changes inside items
        // - "rows" (1 part) → array replacement → skip
        // - "rows.0" (2 parts, numeric) → item replacement → skip
        // - "rows.0.label" (3+ parts) → property change → DON'T skip (binding needs update)
        if (parts.length > 2) {
            // This is a nested property path - bindings need to update
            return false;
        }

        // Check if second part is numeric (array index)
        if (parts.length === 2 && !/^\d+$/.test(parts[1])) {
            // Second part is not numeric - this is a property, not an index
            return false;
        }

        // Check if this base path is managed by a list context
        if (instance._listContexts.has(basePath)) {
            return true;
        }

        // Also check for external() list patterns - these are handled by ListRenderer too
        for (const [listPath] of instance._listContexts) {
            if (listPath.includes('external(')) {
                // External paths like "external('cart', 'items')" - extract the property name
                const match = listPath.match(/external\([^,]+,\s*['"]([^'"]+)['"]\)/);
                if (match && match[1] === basePath) {
                    return true;
                }
            }
        }

        return false;
    },
    /**
     * Update contexts based on state changes
     * @param {string} instanceId - Component ID
     * @param {string} path - The path that changed
     * @private
     */
    _updateContextsForStateChange(instanceId, path)
    {
        const instance = this.componentInstances.get(instanceId);
        if (!instance) {
            return;
        }

        // PERFORMANCE OPTIMIZATION: Skip context iteration for list-managed paths
        // ListRenderer handles these updates through optimized paths (swap, append, sparse-update)
        // This prevents O(n) context iteration for array operations that should be O(1)
        if (this._isListManagedPath(path, instance)) {
            return;
        }

        // Binding context iteration removed — the render effect now handles ALL binding
        // DOM updates including web component adapters and portal bindings.

        // Update conditional contexts.
        // Effects handle data-show; per-item effects handle data-render in lists.
        // Only non-list data-render still needs context iteration.
        if (instance._renderEffect && !instance._hasNonListDataRender) {
            // All conditionals are effect-driven — skip iteration entirely
        } else {
        const conditionalContexts = this._contextRegistry.getContextsByType('conditional')
            .filter(ctx => ctx.componentInstance && ctx.componentInstance.id === instanceId);

        conditionalContexts.forEach(context =>
        {
            // Extract actual path without negation
            let actualPath = context.path;
            if (actualPath.startsWith('!'))
            {
                actualPath = actualPath.slice(1);
            } else if (actualPath.startsWith('computed:!'))
            {
                actualPath = 'computed:' + actualPath.slice(10);
            }

            // Determine if this conditional is affected by the state change
            // For expressions, check if the changed path is used in the expression
            const isSimpleMatch = actualPath === path || path.startsWith(actualPath + '.');
            const isExpressionMatch = this.isExpression(actualPath) && this._expressionUsesPath(actualPath, path);
            const shouldUpdate = isSimpleMatch || isExpressionMatch;

            if (shouldUpdate)
            {
                // Force context to refresh its data
                context._clearCache();

                // For render mode, element may be null when not rendered
                // For show mode, element must exist
                const isRenderMode = context.mode === 'render';
                // Effects handle data-show; per-item effects handle data-render in lists
                if (!isRenderMode && instance._renderEffect) return;
                // Per-item effects handle data-render for list-item conditional contexts
                if (isRenderMode && instance._renderEffect && context.parent?.type === 'list') return;
                if (context.element || isRenderMode)
                {
                    const isVisible = context.resolveData();

                    if (__FEATURE_TRANSITIONS__) {
                        // Check if element has data-transition attribute
                        const element = context.element || (isRenderMode ? context.templateClone : null);
                        // Use transition system if available and element has transition attribute
                        if (this._handleTransitionedVisibilityChange && element && element.dataset && element.dataset.transition) {
                            this._handleTransitionedVisibilityChange(element, context, isVisible, context.componentInstance);
                        } else {
                            context._updateConditionalElement(isVisible);
                        }
                    } else {
                        context._updateConditionalElement(isVisible);
                    }
                }
            }
        });
        } // end conditional iteration gate

        // Update custom directives (only when plugin system is available)
        if (this._customDirectives && this._customDirectives.size > 0 && instance.element) {
            this._updateCustomDirectivesInSubtree(instance.element, instance, path);
        }
    },
    /**
     * Check if an expression uses a specific path
     * @param {string} expression - The binding expression
     * @param {string} path - The state path to check
     * @returns {boolean} - Whether the expression uses the path
     * @private
     */
    _expressionUsesPath(expression, path)
    {
        // Strip computed: prefix so "computed:storeValue" matches "storeValue" in expressions
        const effectivePath = path.startsWith('computed:') ? path.slice(9) : path;

        // Handle simple case - direct word match
        const wordBoundaryRegex = new RegExp(`\\b${effectivePath}\\b`);
        if (wordBoundaryRegex.test(expression))
        {
            return true;
        }

        // For nested properties, check the parent path
        if (effectivePath.includes('.'))
        {
            const basePath = effectivePath.split('.')[0];
            const basePathRegex = new RegExp(`\\b${basePath}\\b`);
            if (basePathRegex.test(expression))
            {
                return true;
            }
        }

        return false;
    },
    /**
     * Execute watchers for a specific path
     * @private
     */
    _executeWatchers(instance, path, newValue, oldValue)
    {

        if (!instance._watcherHandlers)
        {
            return;
        }

        // Check for exact path match
        if (instance._watcherHandlers.has(path))
        {

            try
            {
                instance._watcherHandlers.get(path)(newValue, oldValue, path);
            } catch (error)
            {
                this._handleError(`Error in watcher for ${path}`, error, instance);
            }
        }

        // Computed changes notify as "computed:name" — also check watchers registered under bare name
        if (path.startsWith('computed:'))
        {
            const barePath = path.slice(9);
            if (instance._watcherHandlers.has(barePath))
            {
                try
                {
                    instance._watcherHandlers.get(barePath)(newValue, oldValue, barePath);
                } catch (error)
                {
                    this._handleError(`Error in watcher for ${barePath}`, error, instance);
                }
            }
        }

        // Notify parent path watchers
        // e.g., if path is 'user.name', notify watchers for 'user'
        // NOTE: Parent watchers receive (currentValue, currentValue, changedPath) because the
        // parent object is the same mutable reference — no deep copy of the previous state exists.
        // Use the third argument (changedPath) to identify what changed.
        const pathParts = path.split('.');
        while (pathParts.length > 1)
        {
            pathParts.pop();
            const parentPath = pathParts.join('.');

            if (instance._watcherHandlers.has(parentPath))
            {
                try
                {
                    const parentValue = instance.stateManager.getValue(parentPath);
                    instance._watcherHandlers.get(parentPath)(parentValue, parentValue, path);
                } catch (error)
                {
                    this._handleError(`Error in parent path watcher for ${parentPath}`, error, instance);
                }
            }
        }

        // Check for array index changes
        // e.g., if path is 'tasks.0.completed', notify watchers for 'tasks'
        if (/\.\d+($|\.)/.test(path))
        {
            const arrayPath = path.replace(/\.\d+($|\.).*/, '');

            if (instance._watcherHandlers.has(arrayPath))
            {
                try
                {
                    const arrayValue = instance.stateManager.getValue(arrayPath);
                    instance._watcherHandlers.get(arrayPath)(arrayValue, arrayValue, path);
                } catch (error)
                {
                    this._handleError(`Error in array watcher for ${arrayPath}`, error, instance);
                }
            }
        }

        // Check for wildcard watchers
        if (instance._watcherHandlers.has('*'))
        {
            try
            {
                instance._watcherHandlers.get('*')(newValue, oldValue, path);
            } catch (error)
            {
                this._handleError(`Error in wildcard watcher`, error, instance);
            }
        }
    },
    /**
     * Start a batch of state updates to minimize renders
     * @returns {Object} - Batch context object
     * @public
     */
    startBatch()
    {
        // Set batch mode flag
        this._batchMode = true;
        this._suppressRender = true;

        // Store current state for tracking changes
        this._batchStartState = new Map();
        this.componentInstances.forEach((instance, id) => {
            try {
                this._batchStartState.set(id, this._cycleSafeStringify(instance.state));
            } catch (e) {
                // If even our safe stringify fails, mark this component with a special flag
                if (__DEV__) console.warn(`Unable to capture state for component ${id}, will force update: ${e.message}`);
                this._batchStartState.set(id, '__FORCE_UPDATE__');
            }
        });

        // Return a batch context
        return {
            // End batch and apply all changes at once
            apply: () => this.applyBatch(),
            // Cancel batch without applying changes
            cancel: () => this.cancelBatch()
        };
    },
    /**
     * Apply all batched changes at once
     * @returns {WildflowerJS} - For method chaining
     * @public
     */


    applyBatch()
    {
        // Turn off batch mode
        this._batchMode = false;
        this._suppressRender = false;

        this.componentInstances.forEach(instance => {
            if (instance.stateManager && typeof instance.stateManager.processBatchChanges === 'function') {
                instance.stateManager.processBatchChanges();
            }
        });

        // Check which components actually changed during the batch
        this._batchChangedComponents = this._batchChangedComponents || new Set();
        this._batchChangedPaths = this._batchChangedPaths || new Set();

        let changedCount = 0;

        if (this._batchStartState)
        {
            this._batchStartState.forEach((startState, id) =>
            {
                const instance = this.componentInstances.get(id);
                if (instance)
                {

                    if (startState === '__FORCE_UPDATE__') {
                        this._batchChangedComponents.add(id);
                        changedCount++;
                        return;
                    }

                    try
                    {
                        const currentState = this._cycleSafeStringify(instance.state);

                        if (startState !== currentState)
                        {
                            this._batchChangedComponents.add(id);
                            changedCount++;

                            // Find changed paths
                            try
                            {
                                const startObj = JSON.parse(startState);
                                const currentObj = instance.state;

                                // Track top-level changes
                                Object.keys(currentObj).forEach(key =>
                                {
                                    // Use either cycleSafeEqual or cycleSafeStringify for comparison
                                    const hasChanged = !this._cycleSafeEqual(startObj[key], currentObj[key]);

                                    if (hasChanged) {
                                        this._batchChangedPaths.add(key);

                                        // CRITICAL FIX: For arrays, add paths for nested arrays too
                                        if (Array.isArray(currentObj[key])) {
                                            // Add individual array item paths
                                            for (let i = 0; i < currentObj[key].length; i++) {
                                                // Add path for this array item (e.g., "categories.0")
                                                this._batchChangedPaths.add(`${key}.${i}`);

                                                // Check for nested arrays in this item
                                                const item = currentObj[key][i];
                                                if (item && typeof item === 'object') {
                                                    Object.entries(item).forEach(([propName, propValue]) => {
                                                        if (Array.isArray(propValue)) {
                                                            // Add path for nested array (e.g., "categories.0.items")
                                                            this._batchChangedPaths.add(`${key}.${i}.${propName}`);
                                                        }
                                                    });
                                                }
                                            }
                                        }
                                    }
                                });
                            } catch (error)
                            {
                                if (__DEV__) console.warn(`Error analyzing state changes:`, error);
                            }
                        }
                    } catch (error)
                    {
                        if (__DEV__) console.warn(`Error comparing states for component ${id}:`, error);
                        // If comparison fails, assume the component changed
                        this._batchChangedComponents.add(id);
                        changedCount++;
                    }
                }
            });
        }

        // Include dependent components in the render batch
        if (this._pendingDependentUpdates && this._pendingDependentUpdates.size > 0)
        {
            this._pendingDependentUpdates.forEach(id =>
            {
                this._batchChangedComponents.add(id);
                changedCount++;
            });
        }

        // Apply batch to lists BEFORE general rendering
        // This ensures all list data is correctly processed first
        this._applyBatchToLists();

        // Schedule render if any changes occurred
        if (this._batchChangedComponents.size > 0)
        {
            this._scheduleRender();
        }

        // Clear batch state tracking
        this._batchStartState = null;

        return this;
    },
    _cycleSafeStringify(obj, replacer = null, space = null)
    {
        const seen = new WeakSet();

        // Custom replacer that handles circular references and special objects
        const circularReplacer = (key, value) => {
            // Apply custom replacer if provided
            if (replacer) {
                value = replacer(key, value);
            }

            // Handle non-object values normally
            if (typeof value !== 'object' || value === null) {
                return value;
            }

            // Handle Date objects (including those wrapped in Proxies)
            // Check constructor name to handle both real Dates and Proxied Dates
            try {
                if (value instanceof Date ||
                    (value.constructor && value.constructor.name === 'Date') ||
                    Object.prototype.toString.call(value) === '[object Date]') {
                    return value.toISOString();
                }
            } catch (e) {
                // If we can't check the type, try to get ISO string anyway
                if (typeof value.toISOString === 'function') {
                    try {
                        return value.toISOString();
                    } catch (e2) {
                        return '[Date]';
                    }
                }
            }

            // Handle other built-in objects that don't serialize well
            if (value instanceof RegExp) {
                return value.toString();
            }
            if (value instanceof Map) {
                return { __type: 'Map', entries: Array.from(value.entries()) };
            }
            if (value instanceof Set) {
                return { __type: 'Set', values: Array.from(value.values()) };
            }

            // Check for circular references
            if (seen.has(value)) {
                return '[Circular]';
            }

            // Mark this object as seen
            seen.add(value);

            return value;
        };

        return JSON.stringify(obj, circularReplacer, space);
    },
    _cycleSafeEqual(obj1, obj2)
    {
        return objectUtils.isEqual(obj1, obj2);
    },
    _applyBatchToLists()
    {
        if (!this._batchChangedComponents || !this._batchChangedPaths) return;

        // Find affected list components
        const listsToUpdate = this.domElements.lists.filter(list =>
            list && this._batchChangedComponents.has(list.componentId)
        );

        if (listsToUpdate.length === 0)
        {
            return;
        }

        // Group by component
        const listsByComponent = this._groupListsByComponent(listsToUpdate);

        // Process each component
        for (const [componentId, componentLists] of listsByComponent)
        {
            const instance = this.componentInstances.get(componentId);
            if (!instance) continue;

            const listsCount = componentLists.length;
            for (let i = 0; i < listsCount; i++) {
                this._processList(componentLists[i], instance, /* forceUpdate */ true);
            }
        }
    },
    /**
     * Cancel a batch without applying changes
     * @returns {WildflowerJS} - For method chaining
     * @public
     */
    cancelBatch()
    {
        // Turn off batch mode
        this._batchMode = false;
        this._suppressRender = false;

        // Clear batch state tracking
        this._batchStartState = null;

        return this;
    },
    /**
     * Check if a component might be affected by pending state changes
     * @param {Object} instance - Component instance
     * @param {Set<string>} pendingChanges - Set of changed paths
     * @returns {boolean} - Whether the component might be affected
     * @private
     */
    _componentMightBeAffected(instance, pendingChanges)
    {

        // For components with computed properties, check for dependencies
        
        if (instance.stateManager && instance.stateManager.computedDependencies && 
            instance.stateManager.computedDependencies.size > 0)
        {
            return Array.from(pendingChanges).some(changePath =>
            {
                // Check if any computed property depends on this path
                return Array.from(instance.stateManager.computedDependencies.keys()).some(computedName =>
                {
                    const deps = instance.stateManager.computedDependencies.get(computedName);
                    if (!deps) return false;

                    // Check if any dependency matches or is a parent of the changed path
                    return Array.from(deps).some(depPath =>
                    {
                        return depPath === changePath ||
                            changePath.startsWith(depPath + '.') ||
                            depPath.startsWith(changePath + '.');
                    });
                });
            });


        }

        // For other components, do a simpler check
        
        let result = Array.from(pendingChanges).some(changePath =>
        {
            // If the component has this path directly in its state
            if (instance.state && this._hasNestedProperty(instance.state, changePath))
            {
                return true;
            }

            // If this is a parent path of any state property
            return Object.keys(instance.state || {}).some(key =>
                key === changePath || key.startsWith(changePath + '.'));
        });

        
        // Handle initial render case — only force render if the component hasn't rendered yet
        if (!result && pendingChanges.size > 0 && instance._hasRendered === false) {
            result = true;
        }
        
        
        return result;
    },
    // Helper to check if an object has a nested property path
    _hasNestedProperty(obj, path)
    {
        const parts = path.split('.');
        let current = obj;

        for (let i = 0; i < parts.length; i++)
        {
            if (current === null || current === undefined ||
                typeof current !== 'object' || !(parts[i] in current))
            {
                return false;
            }
            current = current[parts[i]];
        }

        return true;
    }
};
