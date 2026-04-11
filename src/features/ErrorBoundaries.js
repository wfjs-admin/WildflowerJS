/**
 * ErrorBoundaries - Error handling and propagation
 *
 * @module
 */

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const ErrorBoundariesMethods = {
/**
     * Handle an error with error boundary propagation
     * @param {string} message - Error message
     * @param {Error} error - The error object
     * @param {Object} instance - The component instance where the error occurred
     * @param {Object} details - Additional context (e.g., action name, lifecycle hook name)
     * @private
     */
    _handleError(message, error, instance, details = {})
    {
        // Build error context for handlers
        const errorContext = {
            message,
            component: instance,
            action: details.actionName || details.methodName,
            methodName: details.actionName || details.methodName,
            lifecycle: details.lifecycle,
            ...details
        };

        // Try to propagate error through component boundary chain
        const handled = this._propagateErrorToBoundary(error, instance, errorContext);

        // If error was handled by a boundary, we're done
        if (handled)
        {
            return undefined;
        }

        // Error was not handled by any boundary - try to show fallback UI on the origin component
        // This handles cases where component has data-error-fallback but no onError handler
        if (instance)
        {
            this._showErrorFallback(instance, error);
        }

        // Call global handlers if registered
        if (this._globalErrorHandlers.length > 0)
        {
            this._globalErrorHandlers.forEach(handler =>
            {
                try
                {
                    handler(error, instance);
                }
                catch (handlerError)
                {
                    if (__DEV__) console.error('Error in global error handler:', handlerError);
                }
            });
            return undefined;
        }

        // No global handlers - fall back to original error handling behavior
        switch (this.options.errorHandling)
        {
            case 'silent':
                // Do nothing
                break;
            case 'throw':
                throw new Error(`${message}: ${error.message}`);
            case 'log':
            default:
                if (__DEV__) console.error(`[WildflowerJS] ${message}:`, error);
                // Display error in component if available
                if (instance?.element && this.debug)
                {
                    const errorEl = document.createElement('div');
                    errorEl.className = 'wf-component-error';
                    errorEl.style.color = 'red';
                    errorEl.style.padding = '10px';
                    errorEl.style.margin = '10px 0';
                    errorEl.style.border = '1px solid red';
                    errorEl.style.borderRadius = '4px';
                    errorEl.style.backgroundColor = 'rgba(255,0,0,0.1)';
                    errorEl.textContent = `${message}: ${error.message}`;

                    // Remove any existing error elements
                    instance.element.querySelectorAll('.wf-component-error').forEach(el => el.remove());

                    instance.element.appendChild(errorEl);
                }
        }

        return undefined;
    },
    /**
     * Propagate error up through component hierarchy to find an error boundary
     * @param {Error} error - The error object
     * @param {Object} originInstance - The component where the error originated
     * @param {Object} context - Error context (action name, lifecycle hook, etc.)
     * @returns {boolean} - True if error was handled by a boundary
     * @private
     */
    _propagateErrorToBoundary(error, originInstance, context)
    {
        let currentInstance = originInstance;
        let currentElement = originInstance?.element;
        const visited = new Set();

        while (currentInstance || currentElement)
        {
            // Guard against circular parent references
            if (currentInstance && visited.has(currentInstance.id)) break;
            if (currentInstance) visited.add(currentInstance.id);
            // Check if this component has an onError handler
            if (currentInstance && currentInstance.context && typeof currentInstance.context.onError === 'function')
            {
                try
                {
                    // Call the onError handler with error and context
                    // Handler returns true to stop propagation, false to continue
                    const handled = currentInstance.context.onError.call(
                        currentInstance.context,
                        error,
                        context
                    );

                    if (handled === true || handled === undefined)
                    {
                        // Error was handled - show fallback UI if configured
                        this._showErrorFallback(currentInstance, error);
                        return true;
                    }
                    // handled === false means continue propagation
                }
                catch (handlerError)
                {
                    if (__DEV__) console.error('Error in onError handler:', handlerError);
                    // Continue propagation if handler itself fails
                }
            }

            // Try to move up via componentParents map first
            let parentId = currentInstance ? this.componentParents.get(currentInstance.id) : null;
            let parentInstance = parentId ? this.componentInstances.get(parentId) : null;

            // If no parent found via map, try DOM traversal
            // This handles cases where parent component was registered after child
            if (!parentInstance && currentElement)
            {
                let parentElement = currentElement.parentElement;
                while (parentElement && parentElement !== this.root)
                {
                    if (parentElement.dataset.componentId)
                    {
                        parentInstance = this.componentInstances.get(parentElement.dataset.componentId);
                        if (parentInstance) break;
                    }
                    // Also check for data-component without ID (not yet initialized)
                    // In this case, we can't call the handler yet
                    parentElement = parentElement.parentElement;
                }
                currentElement = parentElement;
            }
            else
            {
                currentElement = parentInstance?.element;
            }

            if (!parentInstance)
            {
                // No parent found via either method
                break;
            }
            currentInstance = parentInstance;
        }

        // No boundary handled the error
        return false;
    },
    /**
     * Show fallback UI for a component that caught an error
     * @param {Object} instance - The component instance with the error
     * @param {Error} error - The error that occurred (optional)
     * @private
     */
    _showErrorFallback(instance, error = null)
    {
        if (!instance?.element)
        {
            return;
        }

        // Track error state on instance for reset functionality
        instance._hasError = true;
        if (instance.context) instance.context._hasError = true;
        if (error)
        {
            instance._lastError = error;
            if (instance.context) instance.context._lastError = error;
        }

        // Check for data-error-fallback attribute (cached on first access)
        if (instance._errorFallbackSelector === undefined) {
            instance._errorFallbackSelector = instance.element.dataset.errorFallback || null;
        }
        const fallbackSelector = instance._errorFallbackSelector;
        if (!fallbackSelector)
        {
            return;
        }

        // Try to find the fallback element
        let fallbackElement = null;

        if (fallbackSelector.startsWith('#'))
        {
            // Template reference - look for template by ID
            const template = document.querySelector(fallbackSelector);
            if (template && template.tagName === 'TEMPLATE')
            {
                // Store original content for potential reset
                if (!instance._originalContent)
                {
                    instance._originalContent = instance.element.innerHTML;
                }
                // Clone template content and insert into component
                const content = template.content.cloneNode(true);
                instance.element.innerHTML = '';
                instance.element.appendChild(content);
                return;
            }
        }

        // Selector for element within component
        fallbackElement = instance.element.querySelector(fallbackSelector);
        if (fallbackElement)
        {
            // Store references to hidden elements for reset
            instance._hiddenElements = [];

            // Hide normal content, show fallback
            Array.from(instance.element.children).forEach(child =>
            {
                if (child !== fallbackElement && !child.classList.contains('wf-component-error'))
                {
                    instance._hiddenElements.push({ element: child, originalDisplay: child.style.display });
                    child.style.display = 'none';
                }
            });
            instance._fallbackElement = fallbackElement;
            fallbackElement.style.display = 'block';
        }
    },
    /**
     * Reset a component's error state and restore normal UI
     * @param {Object} instance - The component instance to reset
     * @param {Object} options - Reset options
     * @param {boolean} options.rerunInit - Whether to re-run the init hook (default: false)
     * @returns {boolean} - True if reset was successful
     * @private
     */
    _resetComponentError(instance, options = {})
    {
        if (!instance || !instance._hasError)
        {
            return false;
        }

        // Clear error state
        instance._hasError = false;
        instance._lastError = null;
        if (instance.context) {
            instance.context._hasError = false;
            instance.context._lastError = null;
        }

        // Restore UI
        if (instance._hiddenElements)
        {
            // Restore hidden elements
            instance._hiddenElements.forEach(({ element, originalDisplay }) =>
            {
                element.style.display = originalDisplay || '';
            });
            instance._hiddenElements = null;
        }

        if (instance._fallbackElement)
        {
            instance._fallbackElement.style.display = 'none';
            instance._fallbackElement = null;
        }

        // Remove any debug error elements
        instance.element?.querySelectorAll('.wf-component-error').forEach(el => el.remove());

        // Call onReset callback if defined
        if (instance.context && typeof instance.context.onReset === 'function')
        {
            try
            {
                instance.context.onReset.call(instance.context);
            }
            catch (error)
            {
                if (__DEV__) console.error('Error in onReset callback:', error);
            }
        }

        // Optionally re-run init
        if (options.rerunInit && instance.definition && typeof instance.definition.init === 'function')
        {
            try
            {
                instance.definition.init.call(instance.context);
            }
            catch (error)
            {
                this._handleError('Error re-running init after reset', error, instance, { lifecycle: 'init' });
                return false;
            }
        }

        return true;
    },
// COMPONENT LOOKUP HELPERS

    /**
     * Get a component instance by its type name
     * @param {string} name - Component type name (e.g., 'theme-manager')
     * @returns {Object|null} - Component's ContextProxy or null if not found
     *
     * Returns the ContextProxy so callers can use `getComponent('x').prop`
     * without needing `.state.` or `.computed.` — consistent with how
     * `this.prop` works inside component methods.
     *
     * AUTOMATIC DEPENDENCY TRACKING: When called inside a computed property,
     * the calling component is automatically registered as dependent on the
     * returned component. Changes to the returned component's state will
     * trigger re-evaluation of the calling component's computed properties.
     */
    getComponent(name) {
        for (const [_id, instance] of this.componentInstances) {
            if (instance.name === name) {
                // AUTOMATIC DEPENDENCY TRACKING: If we're inside a computed property evaluation,
                // use the shared tracking proxy to automatically register dependencies
                if (this._computedTrackingContext && instance.id) {
                    return this._createEntityTrackingProxy(instance.context, instance.id, name, 'component');
                }
                return instance.context;
            }
        }
        return null;
    },
    /**
     * Get all component instances of a given type
     * @param {string} name - Component type name
     * @returns {Array} - Array of matching component ContextProxies
     */
    getComponents(name) {
        const results = [];
        for (const [_id, instance] of this.componentInstances) {
            if (instance.name === name) {
                results.push(instance.context);
            }
        }
        return results;
    },
    /**
     * Set the attribute prefix mode
     * @param {boolean} exclusive - When true, only process data-wf-* attributes (ignore data-*)
     *                              When false, process both data-* and data-wf-* (default)
     *
     * Use exclusive mode when integrating with third-party libraries that use
     * data-action, data-bind, or other data-* attributes that conflict with WildflowerJS.
     *
     * @example
     * // Enable exclusive mode to avoid conflicts with Bootstrap, Alpine, etc.
     * wildflower.setWfPrefixMode(true);
     *
     * // Now use data-wf-* for WildflowerJS, data-* for third-party
     * // <button data-action="bootstrapModal">Bootstrap</button>
     * // <button data-wf-action="myMethod">WildflowerJS</button>
     */
    setWfPrefixMode(exclusive) {
        this.options.useWfPrefixOnly = !!exclusive;
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

        // CRITICAL: First notify dependents before removing the context
        // This allows them to be properly identified through context relationships
        this._notifyComponentDestroyed(componentId);

        // Clean up portaled content before removing context
        // Only if portal system is included (not in lite build)
        if (this._cleanupComponentPortals) {
            this._cleanupComponentPortals(componentId);
        }

        // Clean up component context after notification
        if (this._contextSystemInitialized && instance._componentContext)
        {
            this._contextRegistry.removeContext(instance._componentContext.id);
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

        // Call user destroy hook if available
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

        if (this._contextSystemInitialized && this._contextRegistry)
        {
            const allContexts = this._contextRegistry.getContextsByType('list')
                .concat(this._contextRegistry.getContextsByType('binding'))
                .concat(this._contextRegistry.getContextsByType('conditional'))
                .concat(this._contextRegistry.getContextsByType('action'))
                .filter(ctx => ctx.componentInstance && ctx.componentInstance.id === componentId);

            // Remove each context
            allContexts.forEach(context =>
            {
                this._contextRegistry.removeContext(context.id);
            });
        }

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

        this.componentInstances.delete(componentId);
        this._contextHierarchyDirty = true;


        return true;
    },
    _notifyComponentDestroyed(componentId)
    {
        if (!this._contextSystemInitialized || !this._contextRegistry) return;

        // Get the component's context
        const componentContext = this._contextRegistry.getContextById(componentId);
        if (!componentContext) return;

        // Get all contexts that depend on this one
        const dependentContexts = new Set();

        // Process direct dependents from the context
        if (componentContext.dependents)
        {
            componentContext.dependents.forEach((dep) =>
            {
                if (dep.sourceContext)
                {
                    dependentContexts.add(dep.sourceContext);
                }
            });
        }

        // Process each dependent context
        dependentContexts.forEach(dependentContext =>
        {
            if (dependentContext.componentInstance)
            {
                const dependentInstance = dependentContext.componentInstance;

                // Clear computed cache - the data source is being destroyed, so cached values are stale
                // Don't force re-evaluation here - the dependent may also be getting destroyed,
                // or the computed property may throw errors accessing now-null data
                if (dependentInstance.stateManager && dependentInstance.stateManager.computedCache)
                {
                    dependentInstance.stateManager.computedCache.clear();
                }

                // Schedule the component for update (if it still exists in the next render cycle)
                if (!this._componentsToUpdate)
                {
                    this._componentsToUpdate = new Set();
                }
                this._componentsToUpdate.add(dependentContext.componentInstance.id);
            }
        });

        // Schedule a render if any components were affected
        if (this._componentsToUpdate && this._componentsToUpdate.size > 0)
        {
            this._scheduleRender();
        }
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
        // Only remove elements that are detached from the document — live DOM elements
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
                    // Still in live DOM but no instance — strip stale component-id
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

        // Clean up orphaned contexts if context system is initialized
        if (this._contextSystemInitialized)
        {
            // Run context garbage collection
            const contextStats = this._contextRegistry.garbageCollect();

            // Add context stats to overall results
            stats.orphanedContextsRemoved = contextStats.removedContexts;
        }

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
    // ERROR BOUNDARY API
    /**
     * Register a global error handler for errors that propagate past all component boundaries
     * @param {Function} handler - Error handler function (error, component) => void
     */
    onError(handler)
    {
        if (typeof handler === 'function' && !this._globalErrorHandlers.includes(handler))
        {
            this._globalErrorHandlers.push(handler);
        }
    },
    /**
     * Remove a global error handler
     * @param {Function} handler - The handler to remove
     */
    offError(handler)
    {
        const index = this._globalErrorHandlers.indexOf(handler);
        if (index > -1)
        {
            this._globalErrorHandlers.splice(index, 1);
        }
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

        // Clear plugin system state (only when plugin feature is enabled)
        if (__FEATURE_PLUGINS__) {
            this._plugins = [];
            this._pluginsByName.clear();
            this._customDirectives.clear();
            this._directiveContexts = new WeakMap();
            this._hooks.clear();
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

        return true;
    }
};
