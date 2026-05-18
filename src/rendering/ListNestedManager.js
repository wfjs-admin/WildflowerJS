/**
 * ListNestedManager - Nested list and component-in-list handling
 *
 * Extracted from ListRenderer.js for code organization.
 * These methods handle nested list contexts, component initialization/destruction
 * within list items, and nested template processing.
 *
 * @module
 */

/**
 * Methods to be mixed into ListRendererMethods (and ultimately WildflowerJS.prototype)
 */
export const ListNestedMethods = {
    /**
     * Create a nested list context from a parent list context.
     * @param {Object} parentContext - Parent list context
     * @param {number} parentIndex - Index in parent list
     * @param {string} childPath - Path to nested array property
     * @returns {Object|null} Nested list context or null if invalid
     * @private
     */
    _createNestedListContext(parentContext, parentIndex, childPath)
    {
        if (!parentContext || parentIndex === undefined || !childPath) return null;

        // Get parent data
        const parentData = parentContext.resolveData();
        if (!Array.isArray(parentData) || parentIndex >= parentData.length) return null;

        // Get nested data
        const parentItem = parentData[parentIndex];
        if (!parentItem || typeof parentItem !== 'object') return null;

        let childData = parentItem[childPath];

        // Fallback: when the child path isn't a raw field on the item but
        // IS a defined item-level computed property on the component, evaluate
        // it in the item's context. This mirrors data-bind's implicit computed
        // resolution and lets nested data-list paths use item-level computeds.
        if (childData === undefined &&
            !childPath.includes('.') &&
            parentContext.componentInstance?.stateManager?.computed?.[childPath]) {
            try {
                childData = this._evaluateComputedInListContext(
                    parentContext.componentInstance,
                    childPath,
                    parentItem,
                    parentIndex,
                    parentContext
                );
            } catch (e) {
                if (typeof __DEV__ !== 'undefined' && __DEV__) {
                    console.error(`Error evaluating nested list computed "${childPath}":`, e);
                }
            }
        }

        if (childData === undefined || childData === null) childData = [];

        // Create child context with proper parent relationship
        const context = this._createListContext(
            childPath,
            Array.isArray(childData) ? childData : [],
            parentContext.componentInstance,
            parentContext,  // Parent relationship
            parentIndex     // Pass item index for unique key generation
        );

        // Set parent index explicitly for proper resolution
        if (context)
        {
            context._parentIndex = parentIndex;
        }

        return context;
    },

    /**
     * Initialize nested components within a list item immediately
     * This ensures actions inside nested components work correctly without
     * waiting for the mutation observer
     * @param {HTMLElement} itemEl - The list item element
     * @private
     */
    _initializeNestedComponentsInItem(itemEl) {
        // Find uninitialized components (those with data-component but no data-component-id)
        const componentSelector = this._attrSelector('component');
        const selectors = componentSelector.split(',').map(s => `${s}:not([data-component-id])`).join(',');

        // CRITICAL: Also check if itemEl itself is a component (querySelectorAll only searches descendants)
        // This handles templates where the root element IS the component
        const nestedComponents = Array.from(itemEl.querySelectorAll(selectors));

        // Check if itemEl itself is an uninitialized component
        if (this._hasAttr(itemEl, 'component') && !itemEl.dataset.componentId) {
            nestedComponents.unshift(itemEl);  // Process root component first
        }

        if (nestedComponents.length === 0) return;

        nestedComponents.forEach(componentEl => {
            const componentName = componentEl.dataset.wfComponent || componentEl.dataset.component;

            if (componentName && this.componentDefinitions.has(componentName)) {
                this._initializeComponentElement(componentEl, componentName);
            }
        });
    },
    /**
     * Destroy nested components within a list item when it's being removed
     * @param {HTMLElement} itemEl - The list item element being removed
     * @private
     */
    _destroyNestedComponentsInItem(itemEl) {
        // Find all initialized components (those with data-component-id)
        const nestedComponents = itemEl.querySelectorAll('[data-component-id]');

        if (nestedComponents.length === 0) return;

        nestedComponents.forEach(componentEl => {
            const componentId = componentEl.dataset.componentId;
            if (componentId) {
                this.destroyComponent(componentId);
            }
        });
    },
    /**
     * Update props for nested components within a list item when the item shifts position
     * This is called during optimized single-removal to update data-prop-X="." bindings
     * @param {HTMLElement} itemEl - The list item element
     * @param {Object} newItemData - The new item data at this position
     * @private
     */
    _updateNestedComponentPropsInItem(itemEl, newItemData) {
        // Collect all component elements - both the item itself (if it's a component)
        // and any nested components within it
        const componentElements = [];

        // Check if the item element itself is a component
        if (itemEl.dataset.componentId) {
            componentElements.push(itemEl);
        }

        // Also find nested components within the item
        const nestedComponents = itemEl.querySelectorAll('[data-component-id]');
        nestedComponents.forEach(el => componentElements.push(el));

        if (componentElements.length === 0) return;

        componentElements.forEach(componentEl => {
            const componentId = componentEl.dataset.componentId;
            if (!componentId) return;

            const instance = this.componentInstances.get(componentId);
            if (!instance || !instance._propPaths || !instance._propsData) return;

            let propsChanged = false;

            // Update any props that use "." path (current list item)
            for (const [propName, pathInfo] of Object.entries(instance._propPaths)) {
                if (pathInfo.path === '.') {
                    const oldValue = instance._propsData[propName];
                    if (oldValue !== newItemData) {
                        instance._propsData[propName] = newItemData;
                        propsChanged = true;
                    }
                }
            }

            // If props changed, update all binding contexts that use props.* paths
            if (propsChanged && this._contextSystemInitialized && this._contextRegistry) {
                this._updatePropsBindingsForComponent(instance);
            }
        });
    },
    /**
     * Update all binding contexts that use props.* paths for a component
     * Called after props have been updated to refresh the DOM
     * @param {Object} instance - Component instance
     * @private
     */
    _updatePropsBindingsForComponent(instance) {
        // NOTE: Caller (e.g., _updateNestedComponentPropsInItem) has already updated
        // instance._propsData with the correct values. We just need to refresh
        // the DOM bindings that use props.* paths.

        // Find all binding contexts for this component that use props.* paths
        const bindingContexts = this._contextRegistry.getContextsByType('binding')
            .filter(ctx =>
                ctx.componentInstance &&
                ctx.componentInstance.id === instance.id &&
                ctx.path.startsWith('props.')
            );

        bindingContexts.forEach(context => {
            // Re-evaluate the binding value from the updated props
            // getValue('props.todo.text') reads from instance.props which proxies _propsData
            const value = instance.stateManager.getValue(context.path);

            // Update the DOM element
            if (context._updateBindingElement) {
                context._updateBindingElement(value);
            } else if (context.element) {
                // Fallback direct update
                this._updateElementValue(context.element, value);
            }
        });

        // Invalidate all computed properties when props change
        // Note: Props access doesn't track dependencies (props proxy has no get trap),
        // so we must invalidate all computed properties to ensure they recalculate
        // with the new props values
        if (instance.stateManager) {
            const sm = instance.stateManager;
            sm.getComputedPropertyNames().forEach(propName => {
                sm._invalidateCachedComputed?.(propName);
                sm.scheduleComputedEvaluation(propName);
            });
        }
    },
    /**
     * Process nested lists within a parent list item
     * @private
     */
    _processNestedListsForItem(itemEl, item, index, context, instance) {
        const childListPaths = this._listRelationships.get(context.path) || new Set();
        if (childListPaths.size === 0) return;

        childListPaths.forEach(childPath => {
            const escapedPath = CSS.escape ? CSS.escape(childPath) : childPath.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
            const nestedListElements = itemEl.querySelectorAll(`[data-list="${escapedPath}"]`);

            nestedListElements.forEach(nestedListEl => {
                let nestedData = item[childPath];

                // Fallback: implicit item-level computed evaluation when the
                // path isn't a raw field on the item. Mirrors data-bind's
                // resolution so item-level computeds work as nested-list
                // sources, not just as data-bind values.
                if (nestedData === undefined &&
                    !childPath.includes('.') &&
                    instance?.stateManager?.computed?.[childPath]) {
                    try {
                        nestedData = this._evaluateComputedInListContext(
                            instance, childPath, item, index, context
                        );
                    } catch (e) {
                        if (typeof __DEV__ !== 'undefined' && __DEV__) {
                            console.error(`Error evaluating nested list computed "${childPath}":`, e);
                        }
                    }
                }

                if (Array.isArray(nestedData)) {
                    // CRITICAL: Check if nested list already has a context and update its _parentIndex
                    // This ensures model bindings inside the nested list use the correct parent index
                    // after parent list reordering
                    let childContext = nestedListEl._listContext;

                    if (childContext) {
                        // Update existing context's parent index for reordered parent items
                        childContext._parentIndex = index;
                    } else if (context.createChildContext) {
                        childContext = context.createChildContext(index, childPath);
                        // Parent context.data may be stale if mapArray's reactive effect
                        // updated the array without going through _renderList (which is
                        // the only path that refreshes context.data). When that happens,
                        // getItemData returns null and createChildContext yields null.
                        // Fall back to constructing the context directly from nestedData.
                        if (!childContext) {
                            childContext = this._createListContext(
                                childPath,
                                nestedData,
                                instance,
                                context,
                                index
                            );
                            if (childContext) {
                                childContext._parentIndex = index;
                            }
                        }
                    } else {
                        childContext = this._createListContext(
                            childPath,
                            nestedData,
                            instance,
                            context,
                            index  // Pass item index for unique key generation
                        );

                        if (childContext) {
                            childContext._parentIndex = index;
                        }
                    }

                    if (childContext) {
                        childContext.element = nestedListEl;
                        nestedListEl._listContext = childContext;

                        // === MAPARRAY INTEGRATION: Store parent item proxy for reactive nested data access ===
                        // This allows the nested mapArray's arrayFn to access data through the proxy,
                        // creating a dependency that triggers re-render when nested data changes
                        childContext._parentItemProxy = item;
                        childContext._childPath = childPath;

                        // Use unique key for nested list contexts to prevent collision
                        const contextKey = `${context.path}[${index}].${childPath}`;
                        if (instance._listContexts && !instance._listContexts.has(contextKey)) {
                            instance._listContexts.set(contextKey, childContext);
                        }

                        this._renderList(nestedListEl, nestedData, childContext, instance);

                        // CRITICAL: Ensure nested list has its own event delegation
                        // Without this, clicks on nested list items won't be handled correctly
                        this._ensureListEventDelegation(nestedListEl, instance, childPath);
                    }
                }
            });
        });
    },

    /**
     * Process nested templates to capture relationships before removal
     * @param {HTMLElement} parentTemplate - The parent template element
     * @param {string} parentPath - The parent list's data path
     * @param {string|null} [componentName=null] - The component name for context
     * @param {Object|null} [instance=null] - Component instance for external template lookup
     * @private
     */
    _processNestedTemplates(parentTemplate, parentPath, componentName = null, instance = null)
    {
        // For HTML5 templates, search inside the content, not the template element itself
        const searchContainer = parentTemplate.tagName === 'TEMPLATE' && parentTemplate.content
            ? parentTemplate.content
            : parentTemplate;

        // Find all nested list templates within this template
        const nestedLists = searchContainer.querySelectorAll(this._attrSelector('list'));

        nestedLists.forEach(nestedList =>
        {
            const childPath = this._getAttr(nestedList, 'list');
            if (!childPath) return;

            // CRITICAL FIX: Skip lists inside nested components
            // Those lists belong to the component and will be processed when the component initializes
            const closestComponent = nestedList.closest(this._attrSelector('component'));
            if (closestComponent && searchContainer.contains(closestComponent)) {
                // This list is inside a nested component - component will handle it
                return;
            }

            // Find the template within this nested list
            // Pass instance to enable data-use-template lookups for nested external templates
            const childTemplate = this._findTemplate(nestedList, instance);
            if (!childTemplate) return;

            // Store the child template using composite key to avoid collisions
            const cacheKey = componentName ? `${componentName}:${childPath}` : childPath;
            const cachedChildTemplate = childTemplate.cloneNode(true);
            this._templateCache.lists.set(cacheKey, cachedChildTemplate);


            // Store parent-child relationship
            if (!this._listRelationships)
            {
                this._listRelationships = new Map();
            }

            if (!this._listRelationships.has(parentPath))
            {
                this._listRelationships.set(parentPath, new Set());
            }

            this._listRelationships.get(parentPath).add(childPath);

            // Recursively process deeper nesting
            this._processNestedTemplates(childTemplate, childPath, componentName, instance);
            // Remove template from DOM if it's an element (not a DocumentFragment)
            if (childTemplate.nodeType !== Node.DOCUMENT_FRAGMENT_NODE && childTemplate.remove) {
                childTemplate.remove();
            }
        });
    }
};
