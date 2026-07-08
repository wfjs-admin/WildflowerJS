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
};
