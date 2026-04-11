/**
 * ComponentScanning - Dynamic detection and scanning
 *
 * @module
 */

import { createContextProxy, patchSelfReferences, warnCollisions } from '../state/ContextProxy.js';

const GC_DELAY_MS = 40; // Delay before GC runs (allows DOM to settle)

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const ComponentScanningMethods = {
_setupDynamicComponentDetection()
    {
        // Only set up once
        if (this._mutationObserver) return;

        this._mutationObserver = new MutationObserver(mutations =>
        {
            // OPTIMIZATION: Skip processing if we're in batch list cleanup mode
            // The cleanup is already handled by _batchCleanupListItems
            if (this._inBatchListCleanup) return;

            let needsScan = false;
            let needsGarbageCollection = false;

            // Check mutations for added/removed components
            // OPTIMIZATION: Use for loop with early exit instead of forEach
            for (let i = 0; i < mutations.length; i++) {
                const mutation = mutations[i];
                if (mutation.type !== 'childList') continue;

                // Check for new components (only if we haven't already found one)
                if (!needsScan) {
                    const addedNodes = mutation.addedNodes;
                    for (let j = 0; j < addedNodes.length; j++) {
                        const node = addedNodes[j];
                        if (node.nodeType === 1) { // ELEMENT_NODE
                            // OPTIMIZATION: Skip pool entities - managed by PoolRenderer
                            if (node._poolEntity) continue;
                            // Fast path: check attribute first (no DOM traversal)
                            if (node.hasAttribute('data-component')) {
                                needsScan = true;
                                break;
                            }
                            // Slow path: only querySelector if needed
                            if (node.querySelector('[data-component]')) {
                                needsScan = true;
                                break;
                            }
                        }
                    }
                }

                // Check for removed components (only if we haven't already found one)
                if (!needsGarbageCollection) {
                    const removedNodes = mutation.removedNodes;
                    for (let j = 0; j < removedNodes.length; j++) {
                        const node = removedNodes[j];
                        if (node.nodeType === 1) { // ELEMENT_NODE
                            // OPTIMIZATION: Skip list items and pool entities - they're already cleaned up
                            if (node._listIndex !== undefined || node._poolEntity) continue;

                            // Fast path: check attribute first (no DOM traversal)
                            if (node.hasAttribute('data-component-id')) {
                                needsGarbageCollection = true;
                                break;
                            }
                            // Slow path: only querySelector if needed
                            if (node.querySelector('[data-component-id]')) {
                                needsGarbageCollection = true;
                                break;
                            }
                        }
                    }
                }

                // Early exit if we've found both
                if (needsScan && needsGarbageCollection) break;
            }

            // Process any new components
            if (needsScan && !this._isInitializingComponents)
            {
                this._scanForDynamicComponents();
            }

            // Clean up any removed components
            if (needsGarbageCollection)
            {
                // Cancel any pending GC
                this._cancelPendingGC();

                // Schedule GC with background priority - allows browser to prioritize
                // user interactions over cleanup work
                this._scheduleBackgroundGC();
            }
        });

        // Start observing - ensure document.body exists
        if (document.body) {
            this._mutationObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        } else {
            // Wait for document.body to be available
            document.addEventListener('DOMContentLoaded', () => {
                if (document.body && this._mutationObserver) {
                    this._mutationObserver.observe(document.body, {
                        childList: true,
                        subtree: true
                    });
                }
            });
        }
    },
// Method to scan for newly added components
    // @param {string|Element} [scope] - Optional scope to limit scanning (selector string or Element)
    // @returns {number} - Count of newly initialized components
    _scanForDynamicComponents(scope)
    {
        // Ensure framework is initialized before scanning
        // This handles MutationObserver triggering before DOMContentLoaded
        // Note: _initialize() has a guard that prevents double initialization
        if (!this._hasInitialized) {
            this._initialize();
        }

        // Determine the search root based on scope parameter
        let searchRoot = this.root;
        if (scope) {
            if (typeof scope === 'string') {
                // Selector string - find the element
                searchRoot = document.querySelector(scope);
                if (!searchRoot) {
                    return 0; // Selector not found, nothing to scan
                }
            } else if (scope instanceof Element) {
                // Direct element reference
                searchRoot = scope;
            }
        }

        // Clear stale component IDs from orphaned elements
        // This handles cases where third-party libraries (like DataTables) cache rendered HTML
        // including data-component-id attributes, but the component instances were destroyed
        // when elements left the DOM. Without this, scan() would skip these elements and
        // GC would later remove them as "orphaned".
        searchRoot.querySelectorAll('[data-component-id]').forEach(el => {
            if (!this.componentInstances.has(el.dataset.componentId)) {
                delete el.dataset.componentId;
            }
        });

        // Find all uninitialized components - respects useWfPrefixOnly mode
        const componentSelector = this._attrSelector('component');
        const selectors = componentSelector.split(',').map(s => `${s}:not([data-component-id])`).join(',');
        const newComponents = searchRoot.querySelectorAll(selectors);

        let initializedCount = 0;

        if (newComponents.length > 0)
        {
            // Defer render effect creation until all components in this batch
            // have data-component-id set, so belongsToComponent correctly
            // identifies nested component boundaries
            const isOuterScan = !this._pendingEffectInstances;
            if (isOuterScan) {
                this._pendingEffectInstances = [];
            }

            newComponents.forEach((element, _index) =>
            {
                const componentName = element.dataset.wfComponent || element.dataset.component;

                if (this.componentDefinitions.has(componentName))
                {
                    // Skip elements no longer in DOM (may have been removed by data-render processing)
                    if (!document.contains(element)) {
                        return;
                    }

                    // Skip components inside data-render elements with false conditions
                    // These will be initialized when the data-render condition becomes true
                    if (this._isInsideFalseDataRender(element)) {
                        return;
                    }

                    this._initializeComponentElement(element, componentName);
                    initializedCount++;
                }
            });

            // Now all components have data-component-id — create deferred effects
            if (isOuterScan) {
                const pending = this._pendingEffectInstances;
                this._pendingEffectInstances = null;
                for (let i = 0; i < pending.length; i++) {
                    this._createComponentRenderEffect(pending[i]);
                }
            }
        }

        // Remove data-cloak from newly scanned scope (SPA navigation, dynamic content)
        // Deferred via RAF so data-show/data-render conditionals evaluate first
        // (see FrameworkInit._completeInitialization for detailed explanation)
        if (initializedCount > 0) {
            requestAnimationFrame(() => {
                searchRoot.querySelectorAll('[data-cloak]').forEach(el => el.removeAttribute('data-cloak'));
            });
        }

        return initializedCount;
    },
    // Public alias for _scanForDynamicComponents with cleaner API
    // @param {string|Element} [scope] - Optional scope to limit scanning (selector string or Element)
    // @returns {number} - Count of newly initialized components
    scan(scope)
    {
        return this._scanForDynamicComponents(scope);
    },
    /**
     * Check if an element is inside a data-render element with a false condition
     * @param {HTMLElement} element - Element to check
     * @returns {boolean} - True if inside a data-render with false condition
     * @private
     */
    _isInsideFalseDataRender(element) {
        let parent = element.parentElement;
        while (parent && parent !== this.root) {
            if (this._hasAttr(parent, 'render')) {
                // Find the component that owns this data-render element
                const componentElement = this._getComponentElement(parent);

                // If the parent component is already initialized, use its instance
                if (componentElement && componentElement.dataset.componentId) {
                    const instance = this.componentInstances.get(componentElement.dataset.componentId);
                    if (instance) {
                        const conditionPath = this._getAttr(parent, 'render');
                        const conditionValue = this._evaluateCondition(conditionPath, instance);
                        if (!conditionValue) {
                            return true; // Inside a data-render with false condition
                        }
                    }
                } else if (componentElement) {
                    // Parent component not yet initialized - check the definition's initial state
                    const componentName = componentElement.dataset.wfComponent || componentElement.dataset.component;
                    const definition = this.componentDefinitions.get(componentName);
                    if (definition && definition.state) {
                        const conditionPath = this._getAttr(parent, 'render');
                        // Handle negation
                        let negate = false;
                        let actualPath = conditionPath;
                        if (conditionPath.startsWith('!')) {
                            negate = true;
                            actualPath = conditionPath.slice(1);
                        }
                        // Get initial value from definition's state
                        const initialValue = this._getNestedValue(definition.state, actualPath);
                        const conditionValue = negate ? !initialValue : !!initialValue;
                        if (!conditionValue) {
                            return true; // Inside a data-render with false initial condition
                        }
                    }
                }
            }
            parent = parent.parentElement;
        }
        return false;
    },
    /**
     * Get a nested value from an object using dot notation path
     * @param {Object} obj - The object to traverse
     * @param {string} path - The dot-notation path
     * @returns {*} - The value at the path, or undefined
     * @private
     */
    _getNestedValue(obj, path) {
        return pathResolver.get(obj, path);
    },
    /**
     * Update HTML content while preserving data-external elements
     * 
     * This method preserves components and elements marked with data-external
     * during innerHTML updates, preventing them from being destroyed and recreated.
     * 
     * Primary use cases:
     * - Interactive code examples (preserves component state in live previews)
     * - Static content protection (prevents code blocks from being overwritten)
     * - Applications where components need to survive content updates
     * 
     * @param {HTMLElement} element - Container element to update
     * @param {string} htmlValue - New HTML content
     * @private
     */
    _updateHTMLWithPreservation(element, htmlValue) {
        // Find all data-external elements before update
        const externalElements = element.querySelectorAll('[data-external]');

        // If no external elements, use normal innerHTML
        if (externalElements.length === 0) {
            element.innerHTML = htmlValue;
            return;
        }

        // Clone external elements before innerHTML destroys them
        const preservedElements = [];
        externalElements.forEach(externalEl => {
            preservedElements.push(externalEl.cloneNode(true));
        });

        // Update innerHTML (destroys external elements)
        element.innerHTML = htmlValue;

        // Re-append preserved elements
        preservedElements.forEach(preservedEl => {
            element.appendChild(preservedEl);
        });
    },
    /**
     * Check if an element has event delegation set up
     * @param {HTMLElement} element - The element to check
     * @returns {boolean} - Whether delegation is set up
     */
    _hasElementDelegation(element)
    {
        return this._delegationState.has(element) &&
            this._delegationState.get(element).hasEventDelegation === true;
    },
    /**
     * Mark an element as having event delegation
     * @param {HTMLElement} element - The element to mark
     */
    _markElementDelegation(element)
    {
        this._delegationState.set(element, {
            hasEventDelegation: true
        });
    },
    /**
     * Register a hook to prevent content updates on specific elements
     * @param {Function} hookFn - Function that receives (element, newValue) and returns boolean
     *                           Return true to prevent the update, false to allow it
     */
    addBeforeContentUpdateHook(hookFn)
    {
        this._beforeContentUpdateHooks.push(hookFn);
    },
    /**
     * Check if content update should be prevented by external hooks
     * @param {HTMLElement} element - The element being updated
     * @param {string} newValue - The new content value
     * @returns {boolean} - True if update should be prevented
     * @private
     */
    _shouldPreventContentUpdate(element, newValue)
    {
        return this._beforeContentUpdateHooks.some(hook => {
            try {
                return hook(element, newValue);
            } catch (error) {
                this._log('warn', 'Error in beforeContentUpdate hook:', error);
                return false;
            }
        });
    },
    // =========================================================================
    // SCAN CONTEXT AND UNIT-OF-WORK METHODS
    // =========================================================================
    // These methods implement the "Unified Phased Execution" pattern:
    // - Single source of truth for component scanning logic
    // - Sync and async orchestrators share the same unit-of-work methods
    // - Async version uses processWithIdleYield for fine-grained TBT optimization
    // =========================================================================

    /**
     * Create a scan context object to hold state across phases.
     * @param {HTMLElement} root - The root element to scan
     * @returns {Object} Scan context
     * @private
     */
    _createScanContext(root) {
        return {
            root,
            scanStart: performance.now(),
            // Discovery outputs
            componentElements: [],
            // Instance creation outputs
            instances: [],
            // Init preparation outputs
            orderedInstances: [],
            pendingInits: []
        };
    },

    /**
     * Unit of work: Prepare a single SSR element
     * @param {HTMLElement} element - Element to prepare
     * @private
     */
    _prepareSSRElement(element) {
        if (__FEATURE_SSR__ && this.ssrManager) {
            this.ssrManager.prepareElement(element);
        }
    },

    /**
     * Unit of work: Create a single component instance
     * Note: Uses return instead of continue for control flow (extracted from loop)
     * @param {HTMLElement} element - Element to initialize
     * @param {Object} ctx - Scan context
     * @private
     */
    _createSingleInstance(element, ctx) {
        const componentName = element.dataset.component;
        if (!this.componentDefinitions.has(componentName)) return;

        // Skip already-initialized components to prevent double init
        if (element.dataset.componentId) return;

        // Skip components inside data-render elements with false conditions
        // These will be initialized when the data-render condition becomes true
        if (this._isInsideFalseDataRender(element)) return;

        // Create component instance - but don't run init yet
        const instance = this._createComponentWithoutInit(element, componentName);
        if (instance) {
            ctx.instances.push(instance);
        }
    },

    /**
     * Unit of work: Setup computed properties for a single instance
     * Injects store references first so they're available in computed properties
     * @param {Object} instance - Component instance
     * @private
     */
    _setupSingleInstanceComputed(instance) {
        // Inject store references before computed setup so they're available in computed properties
        this._injectStoreReferences(instance);

        if (!instance.definition.computed) return;
        this._setupComputedProperties(
            instance.definition,
            instance.context,
            instance.stateManager,
            instance.name,
            instance.id
        );
    },

    /**
     * Unit of work: Call beforeInit hook for a single instance
     * @param {Object} instance - Component instance
     * @private
     */
    _callSingleBeforeInitHook(instance) {
        this._callBeforeInitHook(instance, instance.name);
    },

    /**
     * Unit of work: Setup features for a single instance
     * @param {Object} instance - Component instance
     * @private
     */
    _setupSingleInstanceFeatures(instance) {
        // Setup declarative store subscriptions (subscribe: {} in definition)
        // This must be called before watchers/bindings to ensure onStoreUpdate works
        this._setupStoreSubscriptions(instance);

        // Setup features that don't depend on initialization
        this._setupWatchers(instance);
        this._processSlots(instance);
        this._registerItemTemplates(instance, instance.element);
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

        // Custom directives only if plugin system is loaded
        if (this._processCustomDirectivesInSubtree) {
            this._processCustomDirectivesInSubtree(instance.element, instance);
        }
    },

    /**
     * Unit of work: Prepare a single instance for init
     * @param {Object} instance - Component instance
     * @param {Object} ctx - Scan context
     * @private
     */
    _prepareSingleInstanceForInit(instance, ctx) {
        // Queue init() for deferred execution (will run in separate macrotask)
        if (typeof instance.context.init === 'function') {
            ctx.pendingInits.push(instance);
        }

        // Dispatch component init event for optional module integration (e.g., RouteManager)
        document.dispatchEvent(new CustomEvent('wildflower:componentInit', {
            detail: { instance, context: instance.context }
        }));

        // Set up list contexts for each component (critical for nested lists)
        this._setupListContexts(instance);
    },

    /**
     * Unit of work: Complete SSR integration for a single instance
     * @param {Object} instance - Component instance
     * @private
     */
    _completeSingleSSRIntegration(instance) {
        if (__FEATURE_SSR__ && this.ssrManager && instance.definition._ssrPhase) {
            this.ssrManager.completeIntegration(instance);
        }
    },

    /**
     * Execute deferred init() calls via macrotask.
     * Shared by both sync and async orchestrators.
     * @param {Array} pendingInits - Instances with init() to call
     * @private
     */
    _executeDeferredInits(pendingInits) {
        if (pendingInits.length === 0) return;

        setTimeout(() => {
            for (const instance of pendingInits) {
                if (!this.componentInstances.has(instance.id)) continue;
                try {
                    // Trigger plugin beforeInit hook (right before init runs)
                    if (this._triggerHook) {
                        this._triggerHook('component:beforeInit', instance);
                    }
                    instance.context.init();
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
                    // Trigger plugin afterInit hook
                    if (this._triggerHook) {
                        this._triggerHook('component:afterInit', instance);
                    }
                } catch (error) {
                    this._handleError(`Error in init hook for component ${instance.name}`, error, instance);
                }
            }
        }, 0);
    },

    // =========================================================================
    // SYNC ORCHESTRATOR
    // =========================================================================

    /**
     * Scan the DOM for components to initialize (synchronous)
     * @private
     */
    _scanForComponents() {
        // Set flag to prevent HTML binding updates during component initialization
        this._isInitializingComponents = true;

        try {
            const ctx = this._createScanContext(this.root);

            // Discover all components in DOM
            ctx.componentElements = Array.from(this.root.querySelectorAll(this._attrSelector('component')));

            // SSR preparation
            for (const element of ctx.componentElements) {
                this._prepareSSRElement(element);
            }

            // Create all component instances
            for (const element of ctx.componentElements) {
                this._createSingleInstance(element, ctx);
            }

            // Setup computed properties
            for (const instance of ctx.instances) {
                this._setupSingleInstanceComputed(instance);
            }

            // Build context hierarchy
            this._buildComponentContextHierarchy();

            // Call beforeInit hooks
            for (const instance of ctx.instances) {
                this._callSingleBeforeInitHook(instance);
            }

            // Setup component features
            for (const instance of ctx.instances) {
                this._setupSingleInstanceFeatures(instance);
            }

            // Setup list contexts (parent-first order)
            ctx.orderedInstances = this._orderComponentsByHierarchy(ctx.instances);
            for (const instance of ctx.orderedInstances) {
                this._prepareSingleInstanceForInit(instance, ctx);
            }

            // SSR completion
            for (const instance of ctx.instances) {
                this._completeSingleSSRIntegration(instance);
            }

            // Update tracking
            this._ensureSet('_componentsToUpdate');
            for (const instance of ctx.instances) {
                this._componentsToUpdate.add(instance.id);
            }

            // List processing
            this._updateLists(this.domElements.lists);

            // Deferred init() execution via macrotask
            this._executeDeferredInits(ctx.pendingInits);

        } finally {
            this._isInitializingComponents = false;
        }
    },

    // =========================================================================
    // ASYNC ORCHESTRATOR
    // =========================================================================

    /**
     * Async version of _scanForComponents for page load.
     * Processes components in batches to reduce Total Blocking Time (TBT).
     * Uses "Sprint then Jog" strategy with requestIdleCallback.
     *
     * @private
     * @returns {Promise<void>} Resolves when all components are initialized
     */
    async _scanForComponentsAsync() {
        // Set flag to prevent HTML binding updates during component initialization
        this._isInitializingComponents = true;

        try {
            const ctx = this._createScanContext(this.root);

            // "Sprint then Jog" strategy for TBT optimization:
            // Sprint (0-20ms): Process synchronously for fast initial render
            // Jog (20ms+): Use requestIdleCallback to process remaining work during idle time
            const SPRINT_BUDGET = 20;

            // Check if we're still in sprint phase
            const inSprintPhase = () => performance.now() - ctx.scanStart <= SPRINT_BUDGET;

            // Helper: Process items with fine-grained yielding
            // Maintains TBT optimization while using shared unit-of-work methods
            const processWithIdleYield = async (items, processItem) => {
                let index = 0;

                // Sprint phase: process synchronously
                while (index < items.length && inSprintPhase()) {
                    processItem(items[index]);
                    index++;
                }

                // Jog phase: process remaining items via requestIdleCallback
                if (index < items.length) {
                    await new Promise(resolve => {
                        const scheduleIdle = window.requestIdleCallback ||
                            ((cb) => setTimeout(() => cb({ timeRemaining: () => 10 }), 1));

                        const processQueue = (deadline) => {
                            // Process items while we have idle time (> 1ms remaining)
                            while (index < items.length && deadline.timeRemaining() > 1) {
                                processItem(items[index]);
                                index++;
                            }

                            // If more items remain, schedule next idle callback
                            if (index < items.length) {
                                scheduleIdle(processQueue, { timeout: 100 });
                            } else {
                                resolve();
                            }
                        };

                        scheduleIdle(processQueue, { timeout: 100 });
                    });
                }
            };

            // Discover all components in DOM
            ctx.componentElements = Array.from(this.root.querySelectorAll(this._attrSelector('component')));

            // SSR preparation (uses shared unit-of-work method)
            await processWithIdleYield(ctx.componentElements, (element) => {
                this._prepareSSRElement(element);
            });

            // Create all component instances (uses shared unit-of-work method)
            await processWithIdleYield(ctx.componentElements, (element) => {
                this._createSingleInstance(element, ctx);
            });

            // Setup computed properties (uses shared unit-of-work method)
            await processWithIdleYield(ctx.instances, (instance) => {
                this._setupSingleInstanceComputed(instance);
            });

            // Build context hierarchy
            this._buildComponentContextHierarchy();

            // Call beforeInit hooks (uses shared unit-of-work method)
            await processWithIdleYield(ctx.instances, (instance) => {
                this._callSingleBeforeInitHook(instance);
            });

            // Setup component features (uses shared unit-of-work method)
            await processWithIdleYield(ctx.instances, (instance) => {
                this._setupSingleInstanceFeatures(instance);
            });

            // Setup list contexts (parent-first order)
            ctx.orderedInstances = this._orderComponentsByHierarchy(ctx.instances);
            await processWithIdleYield(ctx.orderedInstances, (instance) => {
                this._prepareSingleInstanceForInit(instance, ctx);
            });

            // SSR completion (uses shared unit-of-work method)
            await processWithIdleYield(ctx.instances, (instance) => {
                this._completeSingleSSRIntegration(instance);
            });

            // Update tracking
            this._ensureSet('_componentsToUpdate');
            for (const instance of ctx.instances) {
                this._componentsToUpdate.add(instance.id);
            }

            // List processing (async with yielding)
            await this._updateListsAsync(this.domElements.lists, null, ctx.scanStart);

            // Deferred init() execution via macrotask (shared method)
            this._executeDeferredInits(ctx.pendingInits);

        } finally {
            this._isInitializingComponents = false;
        }
    },

    /**
     * Core component creation - unified logic for all initialization paths.
     * Creates the component instance with all common setup steps.
     * Callers handle path-specific work (immediate init vs batch).
     *
     * @param {HTMLElement} element - The component's DOM element
     * @param {string} componentName - The registered component name
     * @param {Object} options - Configuration options
     * @param {HTMLElement} [options.parentElement] - Optional parent element for hierarchy
     * @param {boolean} [options.ssrEnhance=false] - Apply SSR definition enhancement
     * @returns {Object|null} The component instance, or null if definition not found
     * @private
     */
    _createComponentCore(element, componentName, options = {}) {
        // Skip already-initialized elements
        if (element.dataset.componentId) {
            return this.componentInstances.get(element.dataset.componentId);
        }

        // Get definition
        let definition = this.componentDefinitions.get(componentName);
        if (!definition) return null;

        // SSR: Enhance definition if this is an SSR component
        if (__FEATURE_SSR__ && options.ssrEnhance && this.ssrManager) {
            definition = this.ssrManager.enhanceDefinition(element, definition);
        }

        // Generate unique ID and set on element immediately for reliable reference
        const instanceId = this._generateInstanceId(componentName);
        element.dataset.componentId = instanceId;

        // Find parent component
        const { parentInstance, parentId } = this._findParentComponent(element, options.parentElement);

        // Create state manager using helper
        const stateManager = this._createComponentStateManager(instanceId, componentName, element);

        // Create reactive state
        const state = stateManager.createState(definition.state || {});

        // Create component context and wrap with unified context proxy
        const rawContext = this._createComponentContext(element, state, stateManager, instanceId, parentInstance);
        const context = createContextProxy(rawContext, stateManager);
        patchSelfReferences(rawContext, context, stateManager);
        if (__DEV__) warnCollisions(stateManager, componentName);

        // Create instance using helper (handles type inference internally)
        const instance = this._createComponentInstance({
            instanceId, componentName, element, state, stateManager,
            definition, parentInstance, context
        });

        // Store instance
        this.componentInstances.set(instanceId, instance);
        this._contextHierarchyDirty = true;

        // Add direct element reference for quick lookup
        Object.defineProperty(element, '_wfComponent', {
            value: instance,
            enumerable: false,
            configurable: true
        });

        // Bind methods from definition to context
        this._bindMethods(instance);

        // Initialize props BEFORE computed properties (computed may depend on props)
        this._initializeProps(instance, element, parentInstance);

        // Setup hierarchy tracking using helper
        this._setupHierarchyTracking(instanceId, parentId, parentInstance, instance);

        // Register in context system using helper
        this._registerComponentInContextSystem(instance, parentInstance, parentId, element, componentName);

        // Apply services from providers (uses: [...]) - only if plugin system is loaded
        if (definition.uses && this._useServices) {
            this._useServices(instance, definition.uses, /* applyToContext */ true);
        }

        return instance;
    },
    /**
     * Create component instance without calling init() - for batch initialization.
     * Used by _scanForComponents for page-load batch processing.
     * @private
     */
    _createComponentWithoutInit(element, componentName) {
        return this._createComponentCore(element, componentName, {
            ssrEnhance: true
        });
    },
    /**
     * Order components by hierarchy for initialization
     * Leverages existing context parent-child relationships
     * @private
     */
    _orderComponentsByHierarchy(components) {
        const result = [];
        const visited = new Set();

        // Find root components (those with no parent)
        const rootComponents = components.filter(comp => !comp.parent);

        // Recursive function to visit components in hierarchy order
        const visitComponent = (component) => {
            if (visited.has(component.id)) return;
            visited.add(component.id);

            // Add this component
            result.push(component);

            // Visit children
            for (const childComponent of component.children) {
                visitComponent(childComponent);
            }
        };

        // Start with root components
        for (const rootComponent of rootComponents) {
            visitComponent(rootComponent);
        }

        // Handle any orphaned components
        for (const component of components) {
            if (!visited.has(component.id)) {
                visitComponent(component);
            }
        }

        return result;
    },
    /**
     * Rebuild component context hierarchy based on DOM structure
     * This ensures proper parent-child relationships for event propagation
     * @private
     */
    _buildComponentContextHierarchy()
    {
        // Get all components with DOM presence
        const componentsWithDOM = Array.from(this.componentInstances.values())
            .filter(instance => instance &&
                instance.element &&
                instance._componentContext);

        // First pass - identify parent-child DOM relationships
        const domHierarchy = new Map();

        componentsWithDOM.forEach(instance =>
        {
            const element = instance.element;
            const id = instance.id;

            // Find parent component in DOM
            const parentId = this._getComponentId(element.parentElement);
            if (!parentId) return;
            if (parentId === id) return; // Skip self-references

            // Store the parent-child relationship
            domHierarchy.set(id, parentId);
        });

        // Second pass - update context relationships to match DOM hierarchy
        domHierarchy.forEach((parentId, childId) =>
        {
            const childInstance = this.componentInstances.get(childId);
            const parentInstance = this.componentInstances.get(parentId);

            if (!childInstance || !parentInstance ||
                !childInstance._componentContext || !parentInstance._componentContext)
            {
                return;
            }

            const childContext = childInstance._componentContext;
            const parentContext = parentInstance._componentContext;

            // Check if the current parent is already correct
            if (childContext.parent === parentContext)
            {
                return; // Already set correctly
            }

            // First remove from old parent's children if needed
            if (childContext.parent && childContext.parent.children)
            {
                childContext.parent.children.delete(childId);
            }

            // Update parent reference
            childContext.parent = parentContext;

            // Add to parent's children
            if (!parentContext.children)
            {
                parentContext.children = new Map();
            }
            parentContext.children.set(childId, childContext);
        });
    },
    /**
     * Manually initialize the framework.
     *
     * Use this method when `data-auto-init="false"` is set on the script tag
     * to control initialization timing. This is useful for:
     * - Waiting for async data before initializing components
     * - Custom loading sequences
     * - Ensuring plugins are registered before component scanning
     *
     * If the framework has already been initialized, this method does nothing.
     *
     * @returns {WildflowerJS} Returns this for method chaining
     *
     * @example
     * // In HTML: <script src="wildflower.js" data-auto-init="false"></script>
     *
     * // Register plugins and components first
     * wildflower.plugin({ name: 'my-plugin', install(wf) { ... } });
     * wildflower.component('my-component', { state: { ... } });
     *
     * // Then manually initialize
     * wildflower.init();
     */
    init()
    {
        this._initialize();
        return this;
    },

    /**
     * Cancel any pending garbage collection task
     * @private
     */
    _cancelPendingGC() {
        // Mark any pending GC as cancelled (checked before execution)
        this._gcCancelled = true;
        // Cancel requestIdleCallback if pending (fallback path)
        if (this._gcIdleId) {
            cancelIdleCallback(this._gcIdleId);
            this._gcIdleId = null;
        }
        // Cancel setTimeout if pending (fallback timer)
        if (this._gcTimeout) {
            clearTimeout(this._gcTimeout);
            this._gcTimeout = null;
        }
    },

    /**
     * Schedule garbage collection with background priority.
     * Uses modern Prioritized Task Scheduling API when available,
     * falling back to requestIdleCallback, then setTimeout.
     *
     * Background priority ensures GC runs only when the browser
     * is idle, avoiding interference with user interactions.
     * @private
     */
    _scheduleBackgroundGC() {
        this._gcCancelled = false;

        const runGC = () => {
            // Check if this GC was cancelled (debounced away)
            if (this._gcCancelled) {
                return;
            }
            this.garbageCollect();
        };

        // Modern: scheduler.postTask with 'background' priority (Chrome 94+, Edge 94+)
        // True background priority - only runs when browser is completely idle
        // No TaskController needed - we use a simple boolean flag for cancellation
        if (typeof scheduler !== 'undefined' && scheduler.postTask) {
            scheduler.postTask(runGC, { priority: 'background' }).catch(() => {}); // AbortError on cancellation is expected
            return;
        }

        // Fallback: requestIdleCallback (Safari 16.4+, Firefox 55+, Chrome 47+)
        if (typeof requestIdleCallback !== 'undefined') {
            this._gcIdleId = requestIdleCallback(runGC);
            return;
        }

        // Fallback: setTimeout
        this._gcTimeout = setTimeout(runGC, GC_DELAY_MS);
    }
};
