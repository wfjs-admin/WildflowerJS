/**
 * FrameworkInit - Framework initialization procedures
 *
 * @module
 */
import { ContextRegistry } from '../state/ContextManager.js';

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const FrameworkInitMethods = {
/**
     * Initialize the framework
     * @private
     */
    _initialize()
    {
        if (this._hasInitialized)
        {
            // Expected when MutationObserver triggers init before DOMContentLoaded
            // The guard prevents double work - this is not an error
            return;
        }
        this._hasInitialized = true;

        this._log('info', 'Initializing WildflowerJS');

        this._ensureContextSystem();

        // Per-instance mutable state (avoids prototype sharing across instances)
        this._reusableListContext = { _index: 0, _length: 0, _first: false, _last: false };

        // Initialize SSR support (SSRManager attached by entry points that include it)
        if (__FEATURE_SSR__ && this.SSRManager) {
            this.ssrManager = new this.SSRManager(this);
        }

        this._initPhase = 'templates';

        // Store templates first
        this._initializeTemplates();

        // Initialize DOM events
        this._initPhase = 'events';
        this._initializeEventHandling();

        this._initPhase = 'stores';

        // Create default app-store if not disabled
        if (this.options.disableDefaultStore !== true)
        {
            this.storeManager.createDefaultStore();
            this._log('info', 'Default app-store initialized');
        }

        // Apply any pending store updates that were queued
        if (this._pendingStoreUpdates && this._pendingStoreUpdates.length > 0)
        {
            this.storeManager._applyPendingStoreUpdates();
        }

        // Update to component initialization phase
        this._initPhase = 'components';

        // Scan for components with auto-init
        // Use ASYNC batch mode to reduce Total Blocking Time (TBT)
        // This allows the browser to handle input/rendering between component batches
        if (this.options.autoInit)
        {
            this._scanForComponentsAsync().then(() => {
                this._completeInitialization();
            }).catch(error => {
                this._log('error', 'Component scanning failed:', error);
                // Still complete initialization so the framework is usable
                this._completeInitialization();
            });
        }
        else
        {
            this._completeInitialization();
        }
    },

    /**
     * Complete initialization after component scanning
     * Extracted to support both sync and async init paths
     * @private
     */
    _completeInitialization()
    {
        this._updateLists(this.domElements.lists);

        // Build component context hierarchy after lists are rendered
        // (previously called twice - before and after _updateLists - but
        // list rendering doesn't depend on hierarchy, so single call suffices)
        this._buildComponentContextHierarchy();
        this._processDeferredDependencies();

        // Set up event delegation for lists
        this.domElements.lists.forEach(list =>
        {
            const instance = this.componentInstances.get(list.componentId);
            if (instance && list.element)
            {
                this._ensureListEventDelegation(list.element, instance, list.path);
            }
        });

        // Framework is now fully initialized
        this._initPhase = 'ready';

        // Remove data-cloak attributes after first render pass completes
        // Users add [data-cloak] { display: none; } in <head> CSS to prevent FOUC
        // Framework removes the attribute after processing, making elements visible
        // IMPORTANT: Must use RAF because _scheduleRender (which evaluates data-show/
        // data-render conditionals) is itself deferred via requestAnimationFrame.
        // With autoSave restoring state (e.g., localStorage), stripping cloaks
        // synchronously here would expose elements for 1 frame before conditionals
        // hide them — defeating the purpose of data-cloak.
        //
        // Before removing the attribute we commit a visibility verdict for any
        // element that also carries data-show. This closes the Chrome-observed
        // race where the cloak strip lands before the data-show binding effect
        // has run (or has finished re-running after init-time state mutations).
        // The verdict uses the same evaluator the render effect uses, so a
        // subsequent effect re-run writes the same value (idempotent).
        requestAnimationFrame(() => {
            document.querySelectorAll('[data-cloak]').forEach(el => {
                this._stripCloakWithVerdict(el);
            });
        });

        // SSR: Activate all SSR components for exact functional equivalence
        // This must happen AFTER initialization is complete but BEFORE user interactions
        if (__FEATURE_SSR__ && this.ssrManager) {
            // Use setTimeout to ensure activation happens on next tick after all initialization
            setTimeout(() => {
                const activatedCount = this.ssrManager.activateAllComponents();
                this._log('SSR activation complete: ' + activatedCount + ' components now have exact equivalence to dynamic components');
            }, 0);
        }

        // Dispatch ready event
        const readyEvent = new CustomEvent('wildflower:ready', {
            bubbles: true,
            detail: {instance: this}
        });
        document.dispatchEvent(readyEvent);

        // Process any early store accesses for diagnostic purposes
        this.storeManager._processEarlyStoreAccesses();
    },
    _ensureContextSystem()
    {
        if (this._contextSystemInitialized)
        {
            return;
        }

        this._contextRegistry = new ContextRegistry(this);
        // Store reference to wildflower instance on registry for data-render element processing
        this._contextRegistry._wildflower = this;
        // Keep both property names pointing to the same instance
        this.contextRegistry = this._contextRegistry;
        this._contextSystemInitialized = true;
    },
// EVENT SYSTEM INITIALIZATION
    _initializeEventHandling()
    {
        this._setupFormHandling();
    },
// FORM HANDLING INITIALIZATION
    _setupFormHandling()
    {

        // Form submission handling
        document.addEventListener('submit', this._handleFormSubmit.bind(this), true);


        // Input change handling for automatic state sync
        document.addEventListener('input', this._handleInputChange.bind(this), true);
        document.addEventListener('change', this._handleInputChange.bind(this), true);
        // Blur handling for data-model-lazy (capture phase since blur doesn't bubble)
        document.addEventListener('blur', this._handleInputChange.bind(this), true);
        // Blur validation for forms with data-validate-on including "blur"
        const boundValidationBlur = this._handleValidationBlur.bind(this);
        document.addEventListener('focusout', boundValidationBlur, true);
        // Also validate on change — clears errors immediately for selects, checkboxes, radios
        document.addEventListener('change', boundValidationBlur, true);
    },
// GLOBAL EVENT BINDING
    _createListContext(path, data, componentInstance, parentContext = null, itemIndex = undefined)
    {
        // Ensure context system is initialized
        this._ensureContextSystem();

        // Use the registry's context creation method
        // Only pass itemIndex for nested lists (when parentContext exists and itemIndex is a number)
        const parentIndex = (parentContext && typeof itemIndex === 'number') ? itemIndex : undefined;
        const context = this._contextRegistry.createListContext(
            path,
            Array.isArray(data) ? data : [],
            componentInstance,
            parentContext,
            null, // element parameter (not used in this case)
            parentIndex // Only set for nested lists: parentId[index]:path
        );

        // Add our list context methods to the context
        // CRITICAL: Use Object.assign instead of setPrototypeOf to preserve the
        // ListContext → Context prototype chain. setPrototypeOf replaces the chain
        // with a plain object, stripping inherited methods like _updateClassBindingElement.
        Object.assign(context, this._listContextMethods);

        // Store framework instance reference so _listContextMethods can avoid window.wildflower
        context._wf = this;

        // Store reference in component instance for lookup
        if (!componentInstance._listContexts)
        {
            componentInstance._listContexts = new Map();
        }

        // Store context by path for easy lookup
        // UNIFIED APPROACH: Use unique key for nested contexts to prevent collision
        let contextKey = path;
        if (parentContext && itemIndex != null) {
            // For nested lists, create unique key using parent path and item index
            contextKey = `${parentContext.path}[${itemIndex}].${path}`;
        }
        componentInstance._listContexts.set(contextKey, context);

        // Ensure parent-child relationship is correctly established
        if (parentContext && context._parentIndex === undefined)
        {
            context._parentIndex = parentContext.children.size;
            parentContext.children.set(context._parentIndex, context);
        }

        return context;
    },
    _listContextMethods: {
        // Get item at a specific index
        getItemData(index)
        {
            if (!this.data || !Array.isArray(this.data) || index >= this.data.length)
            {
                return null;
            }
            return this.data[index];
        },

        createChildContext(index, childPath)
        {
            // Get the parent item data
            const parentItem = this.getItemData(index);
            if (!parentItem)
            {
                return null;
            }

            // Get child data array from parent item
            const childData = parentItem[childPath];
            if (!Array.isArray(childData))
            {
                return null;
            }

            // Create new context with explicit parent-child relationship
            const childContext = this._wf._createListContext(
                childPath,
                childData,
                this.componentInstance,
                this,  // Pass this context as parent
                index  // Pass item index for unique key generation
            );

            // Store explicit parent-child relationship
            childContext._parentIndex = index;

            // Store in parent's children map
            if (!this.children)
            {
                this.children = new Map();
            }
            this.children.set(index, childContext);
            return childContext;
        },

        _propagateToParent(newData)
        {
            if (!this.parent || this.parent.type !== 'list' || this._parentIndex === undefined)
            {
                return false;
            }

            try
            {
                // Get parent data using resolveData for reliability
                const parentData = this.parent.resolveData();

                if (Array.isArray(parentData) && this._parentIndex < parentData.length)
                {
                    // Create immutable copies
                    const updatedParentData = [...parentData];

                    // Copy the parent item to modify
                    updatedParentData[this._parentIndex] = {
                        ...updatedParentData[this._parentIndex]
                    };

                    // Update the nested property
                    updatedParentData[this._parentIndex][this.path] = newData;

                    // Update parent context recursively
                    this.parent.updateData(updatedParentData);
                    return true;
                }
            } catch (e)
            {
                if (__DEV__) wfWarn(`Failed to propagate nested list update: ${e.message}`);
            }

            return false;
        },

        // Update context with new data
        updateData(newData)
        {
            if (!Array.isArray(newData)) return false;

            // Check if data has actually changed using shallow equality (fast!)
            const oldData = this.data || [];
            let hasChanged = false;

            // CRITICAL OPTIMIZATION: For direct mutations (splice, push, etc.),
            // oldData === newData (same array reference). Skip expensive comparison!
            if (oldData === newData) {
                // Same reference means direct mutation - always consider changed
                hasChanged = true;
            }
            else if (oldData.length !== newData.length)
            {
                hasChanged = true;
            }
            else
            {
                // Shallow equality check - compare item references (immutable case)
                for (let i = 0; i < oldData.length; i++)
                {
                    if (oldData[i] !== newData[i])
                    {
                        hasChanged = true;
                        break;
                    }
                }
            }

            if (hasChanged)
            {
                this.data = newData;

                if (this.parent && this.parent.type === 'list' &&
                    this._parentIndex !== undefined && this.path)
                {
                    this._propagateToParent(newData);
                }

                if (this.componentInstance)
                {
                    if (!this._wf._componentsToUpdate)
                    {
                        this._wf._componentsToUpdate = new Set();
                    }
                    this._wf._componentsToUpdate.add(this.componentInstance.id);

                    // Schedule render
                    this._wf._scheduleRender();
                }
            }

            return hasChanged;
        },

        getFullPath()
        {

            if (!this.parent || this.parent.type === 'root')
            {
                return this.path;
            }

            // For nested contexts, construct the full path
            const parentPath = this.parent.getFullPath();

            if (this.type === 'list' && this._parentIndex !== undefined)
            {
                return parentPath ? `${parentPath}[${this._parentIndex}].${this.path}` : `${this.path}`;
            } else if (this.type === 'item' && this._parentIndex !== undefined)
            {
                return parentPath ? `${parentPath}[${this._parentIndex}]` : `${this.path}`;
            } else if (this.type === 'action' && this._parentIndex !== undefined)
            {
                return parentPath ? `${parentPath}[${this._parentIndex}].${this.path}` : `${this.path}`;
            }

            return parentPath ? `${parentPath}.${this.path}` : this.path;
        },

        resolveData()
        {
            // For top-level lists, get data directly from component state
            if (!this.parent || this.parent.type === 'root')
            {
                if (this.componentInstance)
                {
                    // Normalize $store.path shorthand to external() before processing
                    const wf = this._wf;
                    const normalizedPath = this.path.includes('$') && wf && wf._normalizeStoreShorthands
                        ? wf._normalizeStoreShorthands(this.path)
                        : this.path;

                    if (normalizedPath.startsWith('computed:'))
                    {
                        const computedPath = normalizedPath.slice(9);

                        if (computedPath.includes('.')) {
                            return this.componentInstance.stateManager._resolveComputedPath(computedPath);
                        } else {
                            return this.componentInstance.stateManager.evaluateComputed(computedPath);
                        }
                    } else if (normalizedPath.includes('external('))
                    {
                        // Handle external() expressions for store data
                        if (wf && wf._getExternalFn) {
                            try {
                                const result = wf.evaluateExpression(normalizedPath, this.componentInstance.state, {
                                    cacheKey: 'listResolve',
                                    additionalContext: { external: wf._getExternalFn(this.componentInstance) }
                                });
                                return Array.isArray(result) ? result : [];
                            } catch (error) {
                                if (__DEV__) console.warn(`Error evaluating external list path "${normalizedPath}":`, error);
                                return Array.isArray(this.data) ? this.data : [];
                            }
                        }
                        return Array.isArray(this.data) ? this.data : [];
                    } else
                    {
                        return this.componentInstance.stateManager.getValue(normalizedPath);
                    }
                }
            }
            // For nested lists, resolve through parent context
            else
            {
                // Make sure we get fresh data from parent context
                const parentData = this.parent.resolveData();

                if (Array.isArray(parentData) && this._parentIndex !== undefined)
                {
                    const parentItem = parentData[this._parentIndex];
                    if (parentItem && typeof parentItem === 'object')
                    {
                        // If parent item has an own field of that name, use it
                        const nestedList = parentItem[this.path];
                        if (Array.isArray(nestedList)) return nestedList;

                        // Otherwise evaluate the path as an item-level computed
                        // on the parent item's shape, so nested lists whose
                        // source is a computed (not a stored field) resolve
                        // the same array here as during rendering.
                        const wf = this._wf;
                        if (wf && wf._resolveRawBinding)
                        {
                            try
                            {
                                const scope = {
                                    componentState: this.componentInstance?.state || {},
                                    componentInstance: this.componentInstance,
                                    itemIndex: this._parentIndex,
                                    listLength: parentData.length,
                                    listContext: this.parent,
                                    propsData: this.componentInstance?._propsData
                                };
                                const computed = wf._resolveRawBinding(this.path, parentItem, scope);
                                if (Array.isArray(computed)) return computed;
                            } catch (e)
                            {
                                if (__DEV__) wfWarn(`Failed to evaluate item-level computed for nested list "${this.path}": ${e.message}`);
                            }
                        }

                        return [];
                    }
                }
            }

            // Return the cached data as fallback
            return Array.isArray(this.data) ? this.data : [];
        }
    },


// TEMPLATE DISCOVERY AND PROCESSING
    /**
     * Find all HTML5 templates in the document and cache them
     * @private
     */
    _initializeTemplates()
    {
        // Find all HTML5 template elements
        this.root.querySelectorAll('template').forEach(template =>
        {
            // Use the template ID or generate one (monotonic counter avoids Date.now() collisions)
            if (!this._templateIdCounter) this._templateIdCounter = 0;
            const templateId = template.id || `template-${++this._templateIdCounter}`;

            // Determine component type based on template
            let componentType = template.dataset.component;

            // Check if it's a list template
            const listElement = template.closest(this._attrSelector('list'));
            const isList = !!listElement;

            // Store template with metadata (HTML5 templates stay in DOM - they're natively hidden)
            this._templateCache.general.set(templateId, {
                element: template,
                componentType,
                parent: template.parentElement,
                isList,
                isModal: false,
                id: templateId
            });

            // For list templates, compile and cache for performance
            // SKIP: Configurable template references (data-use-template) - these are resolved dynamically
            // when the component instance exists and should not be cached as empty templates
            const isConfigurableTemplateRef = this._hasAttr(template, 'use-template');
            if (isList && listElement && !isConfigurableTemplateRef)
            {
                const listName = this._getAttr(listElement, 'list');

                // COMPILE TEMPLATE: Extract binding metadata at initialization
                // Use composite key: componentType:listName to avoid collisions between different components
                const componentElement = template.closest(this._attrSelector('component'));
                const actualComponentType = componentElement?.dataset?.component || componentType;

                const compilationKey = actualComponentType ? `${actualComponentType}:${listName}` : listName;

                // Store reference using composite key (no need to clone - HTML5 templates stay in DOM)
                this._templateCache.lists.set(compilationKey, template);
                if (!this._templateCache.compiled.has(compilationKey)) {
                    const compiledMetadata = this._compileTemplate(template, listName);
                    if (compiledMetadata) {
                        this._templateCache.compiled.set(compilationKey, compiledMetadata);
                    }
                }

                // EXTRACT TEMPLATE CONTENT: Store extracted content for fast cloning
                if (!this._templateCache.extracted.has(compilationKey)) {
                    const extractedContent = this._extractTemplateContent(template);
                    this._templateCache.extracted.set(compilationKey, extractedContent);
                }
            }
        });
    }
};
