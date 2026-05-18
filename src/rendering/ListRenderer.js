/**
 * ListRenderer - List rendering with array operations
 *
 * @module
 */

// Import CSP-safe evaluation functions
import { getCSPSafeMergedContextEvaluator } from '../core/CSPExpressionEvaluator.js';
import { _UNSAFE_EXPR_RE } from '../core/ExpressionEvaluator.js';
import { ListNestedMethods } from './ListNestedManager.js';
import { ListItemBindingMethods } from './ListItemBinding.js';
import { ListExpressionMethods } from './ListExpressionEval.js';
import { ssrAdoptedElements, ssrStateChangedElements, needsComponentInitSet, storedTemplateCache, storedTemplatesCache } from '../core/DomMetadata.js';

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const ListRendererMethods = {
    ...ListNestedMethods,
    ...ListItemBindingMethods,
    ...ListExpressionMethods,
_updateLists(listElements, instance = null)
    {
        const prepared = this._prepareLists(listElements);
        if (!prepared) return;

        const { componentEntries, restrictToChangedComponents, hasRecentArrayOperation } = prepared;
        listElements = prepared.listElements;

        for (const entry of componentEntries) {
            this._processComponentLists(entry, instance, hasRecentArrayOperation, restrictToChangedComponents);
        }

        this._setupListEventDelegation(listElements, restrictToChangedComponents, instance);
    },

    /**
     * Async version of _updateLists for initial page load.
     * Uses Sprint/Jog strategy to reduce Total Blocking Time (TBT).
     * Yields to main thread between component list processing during jog phase.
     *
     * @param {Array} listElements - List elements to process
     * @param {Object} instance - Optional component instance
     * @param {number} scanStart - Start time of the scan (for sprint budget calculation)
     * @returns {Promise<void>}
     */
    async _updateListsAsync(listElements, instance = null, scanStart = performance.now()) {
        const prepared = this._prepareLists(listElements);
        if (!prepared) return;

        const SPRINT_BUDGET = 20;
        const inSprintPhase = () => performance.now() - scanStart <= SPRINT_BUDGET;

        const { componentEntries, restrictToChangedComponents, hasRecentArrayOperation } = prepared;
        listElements = prepared.listElements;

        let componentIndex = 0;

        // Sprint phase: process synchronously
        while (componentIndex < componentEntries.length && inSprintPhase()) {
            this._processComponentLists(componentEntries[componentIndex], instance, hasRecentArrayOperation, restrictToChangedComponents);
            componentIndex++;
        }

        // Jog phase: process remaining via requestIdleCallback
        if (componentIndex < componentEntries.length) {
            await new Promise(resolve => {
                const scheduleIdle = window.requestIdleCallback ||
                    ((cb) => setTimeout(() => cb({ timeRemaining: () => 10 }), 1));

                const processQueue = (deadline) => {
                    while (componentIndex < componentEntries.length && deadline.timeRemaining() > 2) {
                        this._processComponentLists(componentEntries[componentIndex], instance, hasRecentArrayOperation, restrictToChangedComponents);
                        componentIndex++;
                    }

                    if (componentIndex < componentEntries.length) {
                        scheduleIdle(processQueue, { timeout: 100 });
                    } else {
                        resolve();
                    }
                };

                scheduleIdle(processQueue, { timeout: 100 });
            });
        }

        this._setupListEventDelegation(listElements, restrictToChangedComponents, instance);
    },

    /**
     * Helper to process all lists for a single component
     * @private
     */
    _processComponentLists([componentId, componentLists], instance, hasRecentArrayOperation, restrictToChangedComponents) {
        const currentInstance = instance || this.componentInstances.get(componentId);
        if (!currentInstance) return;

        // Skip component entirely if ALL lists are already mapArray-initialized
        // (effects handle all subsequent updates — no need for context-based processing)
        // Exception: lists with _forceTemplateRerender need to go through _processList
        let allInitialized = true;
        for (let i = 0; i < componentLists.length; i++) {
            const el = componentLists[i].element;
            if (!el?._mapArrayInitialized || el._forceTemplateRerender) {
                allInitialized = false;
                break;
            }
        }
        if (allInitialized) return;

        const shouldUpdate = this._shouldUpdateComponent(currentInstance, componentId, componentLists, restrictToChangedComponents);
        if (!shouldUpdate) return;

        this._actuallyRenderedComponents.add(componentId);
        if (this._componentsToUpdate) {
            this._componentsToUpdate.add(componentId);
        }

        for (const list of componentLists) {
            try {
                const { path } = list;
                const forceUpdate = hasRecentArrayOperation &&
                    this._currentArrayOperation?.path === path &&
                    this._currentArrayOperation?.componentId === componentId;
                this._processList(list, currentInstance, forceUpdate);
            } catch (error) {
                this._handleError(`Error updating list: ${list.path}`, error, currentInstance);
            }
        }
    },

    /**
     * Shared preamble for _updateLists and _updateListsAsync.
     * Applies batch filtering, groups by component, collects change-detection state.
     * @returns {{ listElements, componentEntries, restrictToChangedComponents, hasRecentArrayOperation }|null}
     * @private
     */
    _prepareLists(listElements) {
        if (!listElements || listElements.length === 0) return null;

        this._actuallyRenderedComponents = this._actuallyRenderedComponents || new Set();

        const isBatchRender = this._batchChangedComponents && this._batchChangedComponents.size > 0;

        if (isBatchRender) {
            const batchLists = listElements.filter(list =>
                list && list.componentId && this._batchChangedComponents.has(list.componentId)
            );

            if (batchLists.length === 0) {
                let hasUnrenderedComponent = false;
                for (let i = 0; i < listElements.length; i++) {
                    const list = listElements[i];
                    if (!list || !list.componentId) continue;
                    const listInstance = this.componentInstances.get(list.componentId);
                    if (listInstance && listInstance._hasRendered === false) {
                        hasUnrenderedComponent = true;
                        break;
                    }
                }

                if (!hasUnrenderedComponent) {
                    let hasOperationHints = false;
                    for (let i = 0; i < listElements.length; i++) {
                        const list = listElements[i];
                        if (!list || !list.componentId) continue;
                        const listInstance = this.componentInstances.get(list.componentId);
                        if (!listInstance?.stateManager?._arrayOperations) continue;
                        const arrayPath = list.dataset?.list;
                        if (arrayPath && listInstance.stateManager._arrayOperations.has(arrayPath)) {
                            hasOperationHints = true;
                            break;
                        }
                    }
                    if (!hasOperationHints) return null;
                }
            } else {
                listElements = batchLists;
            }
        }

        const listsByComponent = this._groupListsByComponent(listElements);
        const componentEntries = Array.from(listsByComponent.entries());

        const bcc = this._batchChangedComponents;
        const restrictToChangedComponents = bcc && bcc.size > 0;
        const updatedPaths = this._updatedPaths || new Set();
        if (this._batchChangedPaths && this._batchChangedPaths.size > 0) {
            this._batchChangedPaths.forEach(path => updatedPaths.add(path));
        }

        const hasRecentArrayOperation = this._currentArrayOperation &&
            (Date.now() - this._currentArrayOperation.timestamp < 50);

        return { listElements, componentEntries, restrictToChangedComponents, hasRecentArrayOperation };
    },

    /**
     * Helper for event delegation setup (shared by sync and async versions)
     * @private
     */
    _setupListEventDelegation(listElements, restrictToChangedComponents, instance) {
        const bcc = this._batchChangedComponents;
        const listsToProcess = (restrictToChangedComponents && bcc) ?
            listElements.filter(list => list && bcc.has(list.componentId)) :
            listElements;

        for (const list of listsToProcess) {
            if (!list) continue;

            const { element, componentId, path } = list;
            const currentInstance = instance || this.componentInstances.get(componentId);
            if (!currentInstance || !element) continue;

            this._ensureListEventDelegation(element, currentInstance, path);

            // PERF: Process nested lists synchronously instead of with setTimeout
            // With effects-based rendering, nested lists are already initialized by _processNestedListsForItem
            // The setTimeout was causing an extra browser rendering cycle (300ms overhead on 10k create)
            const nestedLists = element.querySelectorAll(this._attrSelector('list'));
            for (let i = 0; i < nestedLists.length; i++) {
                const nestedList = nestedLists[i];
                if (nestedList !== element && nestedList._listContext) {
                    this._ensureListEventDelegation(nestedList, currentInstance, this._getAttr(nestedList, 'list'));
                }
            }
        }
    },
    // Helper to determine if component needs updates
    _shouldUpdateComponent(instance, componentId, componentLists, restrictToChangedComponents)
    {
        // CRITICAL: Check if component has never been rendered FIRST (per-component tracking)
        // This ensures dynamically loaded components get their first render regardless of timing
        // This check must happen BEFORE batch restrictions to ensure first renders never get skipped
        if (instance && instance._hasRendered === false)
        {
            return true;
        }

        // Fast-reject if not in batch changed components
        if (restrictToChangedComponents && this._batchChangedComponents && !this._batchChangedComponents.has(componentId))
        {
            return false;
        }

        // Always update on first render (global optimization for initial page load)
        if (this._renderCounter <= 1)
        {
            return true;
        }

        // Check for explicit update flags
        if (this._componentsToUpdate && this._componentsToUpdate.has(componentId))
        {
            return true;
        }

        // Check for batch changes
        if (this._batchChangedComponents && this._batchChangedComponents.has(componentId))
        {
            return true;
        }

        // Check for computed lists that always need evaluation
        if (componentLists.some(list => list.path.startsWith('computed:')))
        {
            return true;
        }

        // Check for direct state updates
        if (this._updatedPaths && this._updatedPaths.size > 0)
        {
            for (const path of this._updatedPaths) {
                for (let i = 0; i < componentLists.length; i++) {
                    if (componentLists[i].path === path) return true;
                }
            }
        }

        return false;
    },
    /**
     * Process a list with enhanced optimizations
     * @param {Object} list - The list configuration object
     * @param {Object} instance - The component instance
     * @param {boolean} forceUpdate - Whether to force a full update
     * @returns {void}
     * @private
     */


    _processList(list, instance, forceUpdate = false) {
        const {element, path} = list;

        // === MAPARRAY EARLY EXIT ===
        // If this list is already initialized with mapArray, skip all processing.
        // mapArray handles all updates internally via its Effects system.
        // This prevents fingerprint changes from triggering redundant _renderList calls.
        // EXCEPTION: If _forceTemplateRerender is set (from rescanItemTemplates), we need to
        // continue to _renderList to handle template changes.
        if (element._mapArrayInitialized && !element._forceTemplateRerender) {
            // mapArray is handling this list - no need to process
            return;
        }

        // Check if this list is a template-defined child list
        let isTemplateChild = false;
        if (this._listRelationships) {
            for (const childPaths of this._listRelationships.values()) {
                if (childPaths && childPaths.has(path)) { isTemplateChild = true; break; }
            }
        }

        // CRITICAL FIX: Lists inside components should NOT be treated as template children
        // that will be "handled during parent rendering". The component owns its lists.
        // Check if this list's owning component is the instance we're processing.
        // If the list element is inside the component's root element, the component owns it.
        const listIsOwnedByComponent = instance.element && instance.element.contains(element);

        // If this is a template-defined child list and not within a list item,
        // skip separate processing since it will be handled during parent rendering
        // BUT: if the list is owned by the current component, the component must render it
        if (isTemplateChild && !this._findListItemAncestor(element) && !listIsOwnedByComponent) {
            return;
        }

        // Get or create context as needed
        let context = null;

        // Check if element has context attached directly
        if (element._listContext) {
            context = element._listContext;

            // Ensure this context is also registered with the component instance
            if (!instance._listContexts) {
                instance._listContexts = new Map();
            }

            // Only register if it's not already registered
            if (!instance._listContexts.has(path)) {
                instance._listContexts.set(path, context);
            }
        }
        // Check if this is a nested list in a rendered item
        else {
            const listItem = this._findListItemAncestor(element);
            if (listItem) {

            // GUARD: Check if there's an uninitialized component between this
            // list element and the list item ancestor. If so, this list belongs
            // to that child component and should NOT be treated as a nested list.
            // The child component will process it during its own initialization.
            // (The component has data-component but not yet data-component-id
            // because _findListItemAncestor only stops at initialized boundaries.)
            let insideChildComponent = false;
            let cur = element.parentElement;
            while (cur) {
                if (cur.dataset.component) {
                    insideChildComponent = true;
                    break;
                }
                if (cur === listItem) break;
                cur = cur.parentElement;
            }

            if (insideChildComponent) {
                // This list belongs to the child component — skip processing
                // entirely. The child component will handle it during its own
                // initialization via _processList with the correct instance.
                return;
            }

            // Find the DIRECT parent list, not just any ancestor list
            // Critical for nested structures
            const parentListElement = listItem.parentElement ?
                this._findDirectParentList(listItem.parentElement) : null;

            if (parentListElement && parentListElement._listContext) {
                const parentContext = parentListElement._listContext;
                const itemIndex = listItem._listIndex;

                if (!isNaN(itemIndex)) {
                    // Create child context using the correct parent index
                    context = parentContext.createChildContext ?
                        parentContext.createChildContext(itemIndex, path) :
                        this._createNestedListContext(parentContext, itemIndex, path);

                    // Store bidirectional references for easier access
                    if (context) {
                        context.element = element;
                        element._listContext = context;

                        // Store explicit parent reference on list item
                        listItem._parentContext = parentContext;
                        listItem._itemIndex = itemIndex;
                    }
                }
            }
            }
        }
        // Otherwise check component's contexts or create a new one
        if (!context) {
            if (instance._listContexts && instance._listContexts.has(path)) {
                context = instance._listContexts.get(path);

                // Update element reference if needed
                if (context.element !== element) {
                    context.element = element;
                    element._listContext = context;
                }
            } else {
                // Get data from component state
                let data;

                // Normalize $store.path shorthand to external() before processing
                const normalizedPath = path.includes('$') && this._normalizeStoreShorthands
                    ? this._normalizeStoreShorthands(path)
                    : path;

                // AUTO-DETECT: check if path is a computed property even without prefix
                const isExplicitComputed = normalizedPath.startsWith('computed:');
                const computedName = isExplicitComputed
                    ? normalizedPath.slice(9)
                    : (instance.stateManager.computed && instance.stateManager.computed[normalizedPath]
                        ? normalizedPath : null);

                if (computedName) {
                    // PENDING STORE DEPENDENCY: Set list element in tracking context
                    // so that external() calls from within the computed can associate
                    // the list element with pending store dependencies
                    const previousTrackingContext = this._computedTrackingContext;
                    // V8 OPT: Canonical shape — all fields always present
                    this._computedTrackingContext = {
                        componentId: instance.id,
                        computedName: computedName,
                        stateManager: instance.stateManager || null,
                        listElement: element,
                        isItemLevelComputed: false,
                        itemIndex: -1
                    };
                    try {
                        data = instance.stateManager.evaluateComputed(computedName);
                    } finally {
                        this._computedTrackingContext = previousTrackingContext;
                    }
                } else if (normalizedPath.includes('external(')) {
                    // Handle external() expressions for store data
                    data = this._evaluateExternalListPath(normalizedPath, instance);
                } else {
                    data = instance.stateManager.getValue(normalizedPath);
                }

                // Create new context
                context = this._createListContext(path, data, instance);

                // Set bidirectional references
                if (context) {
                    context.element = element;
                    element._listContext = context;
                }

                // PENDING STORE DEPENDENCY: If this is a computed list, register the list element
                // with the StoreManager so pending store dependencies can be resolved
                // This must happen AFTER context is created (computed evaluated) but list is now known
                if (computedName && this.storeManager) {
                    const key = `${instance.id}:${computedName}`;
                    if (!this.storeManager._pendingListElements) {
                        this.storeManager._pendingListElements = new Map();
                    }
                    this.storeManager._pendingListElements.set(key, element);
                }
            }
        }

        if (!context) {
            if (__DEV__) console.warn(`Could not determine context for list: ${path}`);
            return;
        }

        // Resolve data from context
        const data = context.resolveData();

        // Store the data for future comparisons
        const previousData = element._previousData;
        const hasPreviousData = previousData && Array.isArray(previousData) && Array.isArray(data);

        // _previousData is updated by _renderList at the end — NOT here.
        // Updating early prevents fast-path removal optimization from detecting changes.
        // Check for pending array operation optimizations
        const arrayPath = context?.path;
        const pendingOperation = instance?.stateManager?._arrayOperations?.get(arrayPath);
        const hasPendingOptimization = pendingOperation &&
            (pendingOperation.type === 'sparse-update' ||
                pendingOperation.type === 'swap' ||
                pendingOperation.type === 'append');

        // ===== REPLACE-ALL FAST PATH =====
        // Detect when all/most items have been replaced with completely different objects
        // This skips the expensive property update optimization path and goes straight to bulk replacement
        let skipPropertyOptimization = false;
        if (!hasPendingOptimization && !forceUpdate && hasPreviousData && previousData.length === data.length && data.length > 0) {
            // PERFORMANCE FIX: Fast path for direct mutations
            // If first few items have same references, likely direct mutation - skip expensive sampling
            const checkSize = Math.min(3, data.length);
            let sameReferenceCount = 0;
            for (let i = 0; i < checkSize; i++) {
                if (previousData[i] === data[i]) {
                    sameReferenceCount++;
                }
            }

            // If all sampled items have same reference, definitely direct mutation
            // Skip replace-all detection entirely
            const isLikelyDirectMutation = sameReferenceCount === checkSize;

            if (!isLikelyDirectMutation) {
                // Only run full sampling for likely immutable patterns
                const sampleSize = Math.min(20, data.length);
                const step = Math.max(1, Math.floor(data.length / sampleSize));
                let differentCount = 0;

                for (let i = 0; i < sampleSize; i++) {
                    const idx = Math.min(i * step, data.length - 1);
                    if (previousData[idx] !== data[idx]) {
                        differentCount++;
                    }
                }

                // If >80% of sampled items are different references, treat as replace-all
                const percentDifferent = differentCount / sampleSize;
                if (percentDifferent > 0.8) {
                    skipPropertyOptimization = true;
                }
            }
        }

        // ===== PROPERTY UPDATE OPTIMIZATION =====
        // Sparse update optimization: detect which items have property changes and only update those
        if (!skipPropertyOptimization && !hasPendingOptimization && !forceUpdate && hasPreviousData && previousData.length === data.length && data.length > 0) {
            // Find which items have property changes
            const changedIndices = [];
            let totalChangedProps = 0;

            // Analyze changes for each item
            for (let i = 0; i < data.length; i++) {
                const prevItem = previousData[i];
                const newItem = data[i];

                // Skip if items have different IDs
                if (prevItem?.id !== undefined && newItem?.id !== undefined &&
                    prevItem.id !== newItem.id) {
                    continue;
                }

                // FAST PATH 1: Reference equality check (for immutable updates)
                // Same reference = no changes (immutable assumption)
                if (prevItem === newItem) {
                    continue;
                }

                // FAST PATH 2: If both have IDs and IDs match, use reference equality on top-level properties
                // instead of JSON.stringify (much faster for nested objects)
                let itemHasChanges = false;

                if (prevItem?.id !== undefined && newItem?.id !== undefined && prevItem.id === newItem.id) {
                    // Check if any top-level property reference changed
                    // Use for...in instead of Object.keys() to avoid array allocation
                    let prevKeyCount = 0;
                    let newKeyCount = 0;
                    for (const key in prevItem) {
                        prevKeyCount++;
                        if (prevItem[key] !== newItem[key]) {
                            itemHasChanges = true;
                            break;
                        }
                    }
                    if (!itemHasChanges) {
                        for (const _k in newItem) newKeyCount++;
                        if (prevKeyCount !== newKeyCount) itemHasChanges = true;
                    }
                } else {
                    // Fallback: Use JSON.stringify (for items without IDs or different IDs)
                    try {
                        itemHasChanges = JSON.stringify(prevItem) !== JSON.stringify(newItem);
                    } catch (e) {
                        // Circular reference — assume changed (safe: just less optimal)
                        itemHasChanges = prevItem !== newItem;
                    }
                }

                if (itemHasChanges) {
                    changedIndices.push(i);

                    // Count changed properties for threshold check.
                    // Defer building propChanges Sets to the fallback render path —
                    // the compiled metadata fast path doesn't need them.
                    if (prevItem) {
                        for (const key in prevItem) {
                            if (prevItem[key] !== newItem?.[key]) {
                                totalChangedProps++;
                            }
                        }
                    }
                    if (newItem) {
                        for (const key in newItem) {
                            if (!(key in prevItem) && newItem[key] !== prevItem?.[key]) {
                                totalChangedProps++;
                            }
                        }
                    }
                }
            }

            // Only use optimization for sparse property updates
            if (changedIndices.length > 0 &&
                changedIndices.length < data.length * 0.3 &&
                totalChangedProps < data.length) {


                // PERF: Check once if this list has nested lists
                const hasNestedLists = this._listRelationships && this._listRelationships.has(context?.path);

                // Get list items once (filtering out template elements)
                const listItems = this._getListItems(element);

                // Update only the specific properties that changed
                changedIndices.forEach(index => {
                        // Access list items by index from filtered array
                        const itemEl = listItems[index];
                        if (!itemEl || itemEl._listIndex === undefined) return;

                        const item = data[index];

                        // PERF: Use compiled metadata path if available (avoids querySelectorAll)
                        const compiledMetadata = itemEl._compiledMetadata;
                        if (compiledMetadata && itemEl._cachedElementsArray) {
                            // FAST PATH: Use cached element references and execute functions
                            const listContext = itemEl._listContext || context;
                            this._bindWithCompiledMetadata(itemEl, item, compiledMetadata, listContext, index, context);
                            return; // Skip fallback path
                        }

                        // FALLBACK PATH: Use querySelectorAll (for items without compiled metadata)
                        if (!itemEl._warnedSlowPath) {
                            itemEl._warnedSlowPath = true;
                            console.warn('[WildflowerJS] List item missing compiled metadata — using querySelectorAll fallback (slower). This may happen with configurable templates or SSR-adopted lists.');
                        }
                        // Build propChanges on-demand (deferred from detection loop to avoid allocations on the fast path)
                        const prevItem = previousData[index];
                        const propsToUpdate = new Set();
                        if (prevItem) {
                            for (const key in prevItem) {
                                if (prevItem[key] !== item?.[key]) propsToUpdate.add(key);
                            }
                        }
                        if (item) {
                            for (const key in item) {
                                if (!propsToUpdate.has(key) && item[key] !== prevItem?.[key]) propsToUpdate.add(key);
                            }
                        }
                        if (propsToUpdate.size === 0) return;

                        propsToUpdate.forEach(prop => {
                            // Find bindings for this property AND nested properties
                            const allBindings = itemEl.querySelectorAll(this._attrSelector('bind'));

                            // Iterate NodeList directly instead of Array.from().filter() to avoid allocations
                            for (let bi = 0; bi < allBindings.length; bi++) {
                                const bindingEl = allBindings[bi];
                                const bindPath = this._getAttr(bindingEl, 'bind');

                                // Filter: skip bindings that don't match this prop (unless wildcard)
                                if (prop !== '*' && bindPath !== prop && !bindPath.startsWith(prop + '.')) continue;

                                // Skip computed bindings - handled separately
                                if (bindPath.startsWith('computed:')) continue;

                                let value;

                                // EXPRESSION FIX: Handle expressions like "price * qty"
                                if (this.isExpression(bindPath)) {
                                    // Build merged state for expression evaluation
                                    const componentInstance = context?.componentInstance;
                                    const componentState = componentInstance?.state || {};
                                    const listLength = data.length;
                                    const mergedState = {
                                        ...componentState,
                                        ...item,
                                        _index: index,
                                        _length: listLength,
                                        _first: index === 0,
                                        _last: index === listLength - 1
                                    };
                                    value = this.evaluateExpression(bindPath, mergedState, { cacheKey: 'directMutationExpr' });
                                } else {
                                    // Simple property path (cached resolver, zero allocation)
                                    value = this._getValueFromItem(item, bindPath);
                                }

                                const strValue = value !== undefined && value !== null ? String(value) : '';

                                if (bindingEl.tagName === 'INPUT' || bindingEl.tagName === 'TEXTAREA' || bindingEl.tagName === 'SELECT') {
                                    if (bindingEl.value !== strValue) {
                                        bindingEl.value = strValue;
                                    }
                                } else {
                                    if (bindingEl.textContent !== strValue && !this._shouldPreventContentUpdate(bindingEl, strValue)) {
                                        bindingEl.textContent = strValue;
                                    }
                                }
                            }
                        });

                        // CRITICAL: Also process class bindings for this item
                        // Class bindings (e.g., data-bind-class="done ? 'done' : ''") need to be re-evaluated
                        // when the relevant property (done) changes
                        const classBindings = itemEl.querySelectorAll(this._attrSelector('bind-class'));
                        classBindings.forEach(classBindingEl => {
                            const classExpr = this._getAttr(classBindingEl, 'bind-class');
                            if (classExpr) {
                                this._processOptimizedClassBinding(classBindingEl, item, classExpr, index, context);
                            }
                        });
                        // Also check root element for class binding
                        if (this._hasAttr(itemEl, 'bind-class')) {
                            const rootClassExpr = this._getAttr(itemEl, 'bind-class');
                            if (rootClassExpr) {
                                this._processOptimizedClassBinding(itemEl, item, rootClassExpr, index, context);
                            }
                        }

                        // CRITICAL: Also process style bindings for this item
                        const styleBindings = itemEl.querySelectorAll(this._attrSelector('bind-style'));
                        styleBindings.forEach(styleBindingEl => {
                            const styleExpr = this._getAttr(styleBindingEl, 'bind-style');
                            if (styleExpr) {
                                this._processObjectBinding('style', styleBindingEl, item, styleExpr, index, context);
                            }
                        });
                        // Also check root element for style binding
                        if (this._hasAttr(itemEl, 'bind-style')) {
                            const rootStyleExpr = this._getAttr(itemEl, 'bind-style');
                            if (rootStyleExpr) {
                                this._processObjectBinding('style', itemEl, item, rootStyleExpr, index, context);
                            }
                        }

                        // CRITICAL: Also process attr bindings for this item
                        const attrBindings = itemEl.querySelectorAll(this._attrSelector('bind-attr'));
                        attrBindings.forEach(attrBindingEl => {
                            const attrExpr = this._getAttr(attrBindingEl, 'bind-attr');
                            if (attrExpr) {
                                this._processObjectBinding('attr', attrBindingEl, item, attrExpr, index, context);
                            }
                        });
                        // Also check root element for attr binding
                        if (this._hasAttr(itemEl, 'bind-attr')) {
                            const rootAttrExpr = this._getAttr(itemEl, 'bind-attr');
                            if (rootAttrExpr) {
                                this._processObjectBinding('attr', itemEl, item, rootAttrExpr, index, context);
                            }
                        }

                        // CRITICAL: Process nested lists for this item (e.g., tasks array changed)
                        // PERF: Only if this list has nested lists
                        if (hasNestedLists && this._contextSystemInitialized) {
                            this._processNestedListsForItem(itemEl, item, index, context, instance);
                        }
                });

                // Update fingerprint and store current data for next comparison
                element._lastDataFingerprint = this._getDataFingerprint(data);
                element._previousData = data;

                // Clear the metadata so it doesn't affect future updates
                if (pendingOperation) {
                    instance.stateManager._arrayOperations.delete(arrayPath);
                }

                return;
            }
        }

        // Determine if rendering is needed
        let needsRender = hasPendingOptimization;

        // Always check fingerprint first, even for forceUpdate
        // CRITICAL: Check for operation hints BEFORE fingerprint check
        // Some operations (like swap) may not change the fingerprint but still need rendering
        const hasOperationHint = instance?.stateManager?._arrayOperations?.has(arrayPath);

        const fingerprint = this._getDataFingerprint(data);

        if (!element._lastDataFingerprint) {
            element._lastDataFingerprint = fingerprint;
            needsRender = true;
        } else if (element._lastDataFingerprint !== fingerprint) {
            element._lastDataFingerprint = fingerprint;
            needsRender = true;
            // Mark SSR lists as having state changes to allow re-rendering
            if (__FEATURE_SSR__ && (element._ssrPhase || ssrAdoptedElements.has(element))) {
                ssrStateChangedElements.add(element);
            }
        } else if (hasOperationHint) {
            // Fingerprint unchanged BUT we have an operation hint (swap, append, etc.)
            // Force render to handle the operation
            needsRender = true;
        } else if (forceUpdate && element._lastDataFingerprint === fingerprint) {
            // Data hasn't changed - skip re-render even if forceUpdate is true
            // Commit batch mode before early return
            if (this._contextRegistry) {
                this._contextRegistry.commitBatch();
            }
            return;
        }

        // Also render if this is the first time (initial render)
        if (!needsRender && !element._initialRenderDone) {
            // Check if this list might have child lists based on relationships
            const childPaths = this._listRelationships && this._listRelationships.get(path);
            const hasChildLists = childPaths && childPaths.size > 0;

            if (hasChildLists) {
                needsRender = true;
                element._initialRenderDone = true;
            }
        }

        // Only render if needed
        if (needsRender) {
            this._renderList(element, data, context, instance);
        }
    },
    _getDataFingerprint(data) {
        if (!Array.isArray(data)) return 'not-array';

        // Lightweight identity fingerprint — avoids JSON.stringify GC pressure.
        // Uses id/key primitives when available, falls back to typeof+first-key.
        const len = data.length;
        if (len === 0) return 'length:0';

        const _id = (item) => {
            if (item == null) return 'null';
            if (typeof item !== 'object') return String(item);
            // Prefer id or key (common list item identifiers)
            if (item.id !== undefined) return String(item.id);
            if (item.key !== undefined) return String(item.key);
            // Fallback: type + first own key's value for differentiation
            const keys = Object.keys(item);
            return keys.length > 0 ? `{${keys[0]}:${item[keys[0]]}}` : '{}';
        };

        let fingerprint;
        if (len > 1000) {
            // For very large arrays, accept sampling with 7 positions
            // (first, q1, q2-1, q2, q2+1, q3, last) to catch interior-only
            // changes far more often than 3 samples. O(1) regardless of size.
            const q1 = len >> 2;
            const q2 = len >> 1;
            const q3 = len - (len >> 2);
            const s1 = _id(data[0]);
            const s2 = _id(data[q1]);
            const s3 = _id(data[q2 - 1]);
            const s4 = _id(data[q2]);
            const s5 = _id(data[q2 + 1]);
            const s6 = _id(data[q3]);
            const s7 = _id(data[len - 1]);
            fingerprint = `length:${len}|s:${s1}-${s2}-${s3}-${s4}-${s5}-${s6}-${s7}`;
        } else {
            // Hash all item identities for arrays up to 1000 items.
            // Catches interior-only mutations that the 3-sample heuristic missed.
            let hash = `length:${len}|`;
            for (let i = 0; i < len; i++) {
                hash += _id(data[i]);
                if (i < len - 1) hash += ',';
            }
            fingerprint = hash;
        }

        let hash = 0;
        for (let i = 0; i < fingerprint.length; i++) {
            const char = fingerprint.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }

        // Convert to a fixed-length hex string
        return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
    },

    /**
     * Evaluate an external() expression for list data
     * Handles expressions like "external('cart', 'items')" to fetch store data
     * @param {string} path - The external() expression
     * @param {Object} instance - Component instance
     * @returns {Array} The resolved array data
     */
    _evaluateExternalListPath(path, instance) {
        try {
            // Build external function for expression evaluation
            const externalFn = this._getExternalFn(instance);

            // Evaluate the expression with the external function available
            const result = this.evaluateExpression(path, instance.state, {
                cacheKey: 'externalList',
                additionalContext: { external: externalFn }
            });

            return Array.isArray(result) ? result : [];
        } catch (error) {
            if (__DEV__) console.warn(`Error evaluating external list path "${path}":`, error);
            return [];
        }
    },

    /**
     * SSR hydration for mapArray mode
     * Adopts existing SSR-rendered items and sets up mapArray tracking without clearing DOM
     *
     * @param {HTMLElement} element - List container element
     * @param {Array} data - Array data to bind
     * @param {Object} context - List context
     * @param {Object} instance - Component instance
     * @param {Object} sm - StateManager reference
     * @returns {boolean} true if SSR hydration handled this render
     * @private
     */
    _trySSRHydrationForMapArray(element, data, context, instance, sm) {
        this._log('debug', 'SSR: Hydrating server-rendered list with mapArray mode');

        // Get existing SSR items from DOM (exclude template elements)
        const ssrItems = this._getListItems(element, { requireDataIndex: false });

        if (ssrItems.length === 0 || !Array.isArray(data)) {
            return false; // No items to hydrate
        }

        // Get list path and key property
        const listPath = context?.path || this._getAttr(element, 'list');
        const keyProp = this._getAttr(element, 'key') || 'id';

        // Track item elements for cleanup
        const itemElements = new Map();

        // Bind data to existing SSR items
        for (let i = 0; i < Math.min(ssrItems.length, data.length); i++) {
            const itemEl = ssrItems[i];
            const item = data[i];

            // Wrap item in proxy if not already (for reactivity tracking)
            const itemProxy = sm.wrapInProxy ? sm.wrapInProxy(item) : item;

            // Set metadata (same as context rendering)
            itemEl._listContext = context;
            itemEl._listIndex = i;
            itemEl._itemData = itemProxy;

            // Store for binding data for context creation
            itemEl._needsContexts = true;
            itemEl._bindItemData = itemProxy;
            itemEl._bindItemIndex = i;

            // Set up reactive bindings on existing element (same as _trySSRHydration)
            this._bindItemData(itemEl, itemProxy, i, context);

            // === CRITICAL: Create contexts for action binding ===
            // This ensures action contexts exist for event handling
            if (this._contextSystemInitialized && this._contextRegistry) {
                this._ensureItemContexts(itemEl);
            }

            // Store element reference
            const itemKey = itemProxy && itemProxy[keyProp] !== undefined ? itemProxy[keyProp] : i;
            itemElements.set(itemKey, itemEl);
        }

        // Mark list as having completed initial render
        element._initialRenderDone = true;
        element._previousData = [...data];
        element._previousDataLength = data.length;

        // Store item element mapping for future updates
        element._mapArrayItemElements = itemElements;
        // NOTE: Do NOT set _mapArrayInitialized — SSR hydration doesn't create mapArray effects

        // Set up event delegation on the container element
        this._ensureListEventDelegation(element, instance, listPath);

        return true; // SSR handled
    },

    /**
     * Batch cleanup for list items including nested component destruction
     * Used by _removeExcessElements for partial list cleanup
     * Context cleanup is deferred to requestIdleCallback
     * Does NOT remove items from DOM - caller handles that
     * @param {HTMLElement[]} items - Array of list item elements to clean up
     * @private
     */
    _batchCleanupListItemsWithNestedComponents(items) {
        if (!items || items.length === 0) return;

        // Skip if no context system
        const hasContextSystem = this._contextRegistry && this._contextSystemInitialized;
        const hasCustomDirectives = this._customDirectives && this._customDirectives.size > 0;

        // PERF: Fast path for simple lists - check if ITEM cleanup is needed
        // For large lists without custom directives or item-level contexts,
        // we can skip the expensive querySelectorAll('*') on every item
        //
        // Key insight: List items with only data-bind and data-bind-class use direct
        // DOM manipulation and don't create contexts in the registry.
        // Only data-model, data-show, data-if, data-render create contexts.
        //
        // Check the first item to see if items have contexts THAT NEED CLEANUP
        // Key insight: Binding contexts (type=binding) don't need explicit cleanup -
        // they're in a WeakMap and will be GC'd when elements are removed from DOM.
        // Only model/show/render/conditional contexts need explicit cleanup.
        let itemsHaveContextsNeedingCleanup = false;
        if (hasContextSystem && this._contextRegistry.contextsByElement && items.length > 0) {
            // Sample check: if first item or any of its children have NON-BINDING contexts
            const sampleItem = items[0];
            const checkContext = (el) => {
                const ctx = this._contextRegistry.contextsByElement.get(el);
                // Only these context types need explicit cleanup
                return ctx && (ctx.type === 'model' || ctx.type === 'show' ||
                              ctx.type === 'render' || ctx.type === 'conditional');
            };

            if (checkContext(sampleItem)) {
                itemsHaveContextsNeedingCleanup = true;
            } else {
                // Quick check first few descendants only (avoid full querySelectorAll)
                const children = sampleItem.children;
                for (let i = 0; i < children.length && i < 5; i++) {
                    if (checkContext(children[i])) {
                        itemsHaveContextsNeedingCleanup = true;
                        break;
                    }
                }
            }
        }

        // Quick check: if no directives and no contexts needing cleanup, skip expensive element collection
        // Binding contexts don't need cleanup - they're in WeakMap and auto-GC when elements are removed
        if (!hasCustomDirectives && !itemsHaveContextsNeedingCleanup) {
            // Dispose ItemEffects for removed items (fast path).
            for (const item of items) {
                if (item._wfDisposeEffect) {
                    this._disposeItemEffect(item);
                }
            }

            // PERF: Skip _listContext cleanup - elements are being removed from DOM anyway
            // The _listContext property will be GC'd when the element is orphaned.
            // The context object itself is stored in instance._listContexts by path, not by element.

            // PERF: Only check for nested components if template actually has them
            // Check cached flag on parent element to avoid querySelectorAll on every cleanup
            const parent = items[0]?.parentElement;
            if (parent && parent._templateHasNestedComponents && this.componentInstances.size > 1) {
                // Single query for all nested components in parent
                const nestedComponents = parent.querySelectorAll('[data-component-id]');
                if (nestedComponents.length > 0) {
                    // Build Set of items for O(1) containment check
                    const itemSet = new Set(items);
                    for (const componentEl of nestedComponents) {
                        // Check if this component is inside one of our items
                        let el = componentEl.parentElement;
                        while (el && el !== parent) {
                            if (itemSet.has(el)) {
                                const componentId = componentEl.dataset.componentId;
                                if (componentId) {
                                    this.destroyComponent(componentId);
                                }
                                break;
                            }
                            el = el.parentElement;
                        }
                    }
                }
            }
            return;
        }

        // Collect ALL elements from all items into one set for efficient lookup
        // PERF: Use cached _bindingElements when available (from innerHTML fast path)
        // This avoids 9000+ querySelectorAll('*') calls during Replace operations
        const allElements = new Set();
        for (const item of items) {
            allElements.add(item);

            // PERF: Check for cached binding elements first (set by _createDeferredContextsForInnerHTML)
            if (item._bindingElements && item._bindingElements.length > 0) {
                for (const el of item._bindingElements) {
                    allElements.add(el);
                }
            } else {
                // Fallback: querySelectorAll (slow path)
                const descendants = item.querySelectorAll('*');
                for (const el of descendants) {
                    allElements.add(el);
                }
            }
        }

        // Clean up custom directives (single pass through all elements)
        // Must be synchronous as directives may have cleanup side effects
        if (hasCustomDirectives) {
            for (const element of allElements) {
                this._cleanupCustomDirectives(element);
            }
        }

        // PERF: Skip _listContext cleanup - elements are being removed from DOM anyway
        // GC will handle orphaned references when elements are collected

        // Dispose ItemEffects for removed items (full path).
        for (const item of items) {
            if (item._wfDisposeEffect) {
                this._disposeItemEffect(item);
            }
        }

        // PERF: Destroy nested components using already-collected allElements (single pass)
        // This avoids N querySelectorAll calls in _destroyNestedComponentsInItem
        for (const el of allElements) {
            if (el.dataset?.componentId) {
                this.destroyComponent(el.dataset.componentId);
            }
        }

        // Defer context cleanup to requestIdleCallback
        // Context cleanup is expensive (O(contexts) registry scan) but not user-visible
        // By deferring, the DOM removal appears instant in benchmarks
        if (hasContextSystem && allElements.size > 0) {
            this._scheduleDeferredCleanup(allElements);
        }
    },
    /**
     * Schedule deferred cleanup for context registry
     * DOM removal happens immediately, context cleanup deferred to idle time
     * This makes removal/clear operations appear instant in benchmarks
     * @param {Set} elements - Set of elements that need context cleanup
     * @private
     */
    _scheduleDeferredCleanup(elements) {
        if (!elements || elements.size === 0) return;

        // Add to queue
        this._deferredCleanupQueue.push(elements);

        // Schedule processing if not already scheduled
        if (!this._deferredCleanupScheduled) {
            this._deferredCleanupScheduled = true;

            // Use requestIdleCallback if available, fallback to setTimeout
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback((deadline) => this._processDeferredCleanup(deadline), { timeout: 50 });
            } else {
                setTimeout(() => this._processDeferredCleanup(null), 0);
            }
        }
    },
    /**
     * Process deferred cleanup queue
     * Runs during idle time to clean up contexts from removed elements
     * @param {IdleDeadline|null} deadline - Idle deadline from requestIdleCallback
     * @private
     */
    _processDeferredCleanup(deadline) {
        this._deferredCleanupScheduled = false;

        if (!this._contextRegistry || !this._contextSystemInitialized) {
            this._deferredCleanupQueue = [];
            this._deferredCleanupContextIds = null;
            return;
        }

        // Resume removing rescheduled context IDs from a previous partial pass
        if (this._deferredCleanupContextIds) {
            const ids = this._deferredCleanupContextIds;
            this._deferredCleanupContextIds = null;
            for (let i = 0; i < ids.length; i++) {
                if (deadline && i > 0 && i % 50 === 0 && deadline.timeRemaining() < 1) {
                    this._deferredCleanupContextIds = ids.slice(i);
                    this._deferredCleanupScheduled = true;
                    if (typeof requestIdleCallback === 'function') {
                        requestIdleCallback((dl) => this._processDeferredCleanup(dl), { timeout: 50 });
                    } else {
                        setTimeout(() => this._processDeferredCleanup(null), 0);
                    }
                    return;
                }
                if (this._contextRegistry.contexts.has(ids[i])) {
                    this._contextRegistry.removeContext(ids[i]);
                }
            }
        }

        // Process all queued element sets
        const allElements = new Set();
        while (this._deferredCleanupQueue.length > 0) {
            const elements = this._deferredCleanupQueue.shift();
            for (const el of elements) {
                allElements.add(el);
            }
        }

        if (allElements.size === 0) return;

        // Collect contexts to remove (single pass through registry)
        const contextsToRemove = [];
        for (const [contextId, context] of this._contextRegistry.contexts) {
            if (context.element && allElements.has(context.element)) {
                contextsToRemove.push(contextId);
            }
        }

        // Remove contexts - check deadline if available for cooperative scheduling
        for (let i = 0; i < contextsToRemove.length; i++) {
            // Check if we're running out of idle time (every 50 contexts)
            if (deadline && i > 0 && i % 50 === 0 && deadline.timeRemaining() < 1) {
                // Reschedule remaining IDs directly — avoids round-tripping
                // through element lookups that can miss already-removed contexts
                this._deferredCleanupContextIds = contextsToRemove.slice(i);
                this._deferredCleanupScheduled = true;
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback((dl) => this._processDeferredCleanup(dl), { timeout: 50 });
                } else {
                    setTimeout(() => this._processDeferredCleanup(null), 0);
                }
                return;
            }

            this._contextRegistry.removeContext(contextsToRemove[i]);
        }
    },
    /**
     * Main list rendering orchestrator - initializes mapArray for reactive list rendering.
     *
     * This function is the core entry point for all list rendering operations.
     * Uses SolidJS-inspired mapArray for efficient keyed reconciliation with Effects.
     *
     * **Features:**
     * - SSR Hydration: Adopts server-rendered content without re-rendering
     * - Keyed diffing: Efficient DOM updates based on item keys
     * - Bulk operations: Optimized onCreate, onRemove, onBulkRemove callbacks
     * - Nested list support: Proper handling of hierarchical list structures
     *
     * @param {HTMLElement} element - Container element with data-list attribute
     * @param {Array} data - Array of items to render
     * @param {Object} context - Binding context with path and component info
     * @param {Object} instance - Component instance owning this list
     *
     * @see _renderListWithMapArray - mapArray initialization and configuration
     */
    _renderList(element, data, context, instance) {
        // CRITICAL: Update context.data to reference the new data array
        // This ensures nested list operations can access the correct parent data
        if (context && Array.isArray(data)) {
            context.data = data;
        }

        // === MAPARRAY RENDERING ===
        // Check for forced template rerender BEFORE mapArray routing
        // This handles dynamic template registration (rescanItemTemplates)
        if (element._forceTemplateRerender && element._mapArrayInitialized) {
            // Need to dispose mapArray and re-create with new template
            if (element._disposeMapArray) {
                element._disposeMapArray();
            }
            element._mapArrayInitialized = false;
            // Clear template cache to pick up new template
            const listPath = context?.path || this._getAttr(element, 'list');
            const componentName = instance?.name;
            const cacheKey = componentName ? `${componentName}:${listPath}` : listPath;
            this._templateCache.extracted.delete(cacheKey);
            this._templateCache.extracted.delete(listPath);
            this._templateCache.compiled.delete(cacheKey);
            this._templateCache.compiled.delete(listPath);
            if (this._templateCache.templateNames) {
                this._templateCache.templateNames.delete(cacheKey);
                this._templateCache.templateNames.delete(listPath);
            }
            // Clear existing items to force full re-render
            // Restore stored template(s) so _renderListWithMapArray can re-extract
            element.innerHTML = '';
            const storedTemplate = storedTemplateCache.get(element);
            if (storedTemplate) {
                element.appendChild(storedTemplate);
                storedTemplateCache.delete(element);
            }
            // Restore polymorphic templates
            const storedTemplates = storedTemplatesCache.get(element);
            if (storedTemplates) {
                for (const t of storedTemplates) element.appendChild(t);
                storedTemplatesCache.delete(element);
            }
            delete element._forceTemplateRerender;
        }

        if (!element._mapArrayInitialized) {
            // Initialize mapArray rendering
            // Once initialized, mapArray handles all updates automatically via Effects
            this._renderListWithMapArray(element, data, context, instance);
            return;
        }

        // mapArray already initialized - it handles updates via Effects
        // Just update _previousData for compatibility with other code paths
        element._previousData = data;
        element._previousDataLength = data.length;
    },
    // NOTE: Context-mode rendering code was removed - mapArray is the only list rendering path.

    /**
     * MAPARRAY RENDERING
     * ==================
     * Primary list rendering using the mapArray primitive from ReactiveStateManager.
     * Uses SolidJS-inspired approach:
     * - ONE structural Effect watches array via PatternTrie
     * - Keyed diffing for minimal DOM operations (add/remove/reorder)
     * - Per-item Effects for property change reactivity
     *
     * @param {HTMLElement} element - List container element
     * @param {Array} data - Array data to render
     * @param {Object} context - List context
     * @param {Object} instance - Component instance
     * @private
     */
    _renderListWithMapArray(element, data, context, instance) {
        const self = this;
        // Get stateManager for mapArray primitive
        const sm = instance?.stateManager;
        if (!sm || !sm.mapArray) {
            console.error('[WildflowerJS] stateManager.mapArray not available - list rendering requires a component with stateManager');
            return;
        }

        // === SSR HYDRATION CHECK ===
        // If element is in SSR protected phase, adopt existing DOM items instead of creating new ones
        if (__FEATURE_SSR__) {
            // NOTE: We only check element._ssrPhase (not ssrComponent._ssrPhase) because the component's
            // phase transitions to 'activated' via setTimeout(0) before scan() runs, but list elements
            // remain protected until explicitly activated
            const ssrComponent = element.closest('[data-ssr="true"]');
            if (ssrComponent && element._ssrPhase === 'protected') {
                // SSR mode: Hydrate existing items without clearing DOM
                if (this._trySSRHydrationForMapArray(element, data, context, instance, sm)) {
                    return; // SSR handled
                }
            }

            // SSR cleanup: If this list was SSR-hydrated (phase is 'complete' or 'activated'),
            // remove the SSR items before mapArray initialization creates framework-rendered ones
            if (ssrComponent && element._ssrPhase) {
                const template = element.querySelector('template');
                const ssrItems = Array.from(element.children).filter(c => c !== template && c.tagName !== 'TEMPLATE');
                ssrItems.forEach(item => item.remove());
                element._ssrPhase = null; // Clear phase — framework fully owns this list now
            }
        }

        // Get template from cache
        const listPath = context?.path || this._getAttr(element, 'list');
        const componentName = instance?.name;
        const cacheKey = componentName ? `${componentName}:${listPath}` : listPath;

        let cachedContent = this._templateCache.extracted.get(cacheKey) ||
                            this._templateCache.extracted.get(listPath);

        // Fallback: Check _templateCache.lists for nested templates cached by _processNestedTemplates
        if (!cachedContent) {
            const listsCache = this._templateCache.lists.get(cacheKey) ||
                               this._templateCache.lists.get(listPath);
            if (listsCache) {
                // Extract and cache the content from the lists cache
                const extractedContent = this._extractTemplateContent(listsCache);
                this._templateCache.extracted.set(cacheKey || listPath, extractedContent);
                cachedContent = extractedContent;

                // Also compile if needed
                if (!this._templateCache.compiled.has(cacheKey || listPath)) {
                    // Pass isConfigurableTemplate: true if this is a configurable template
                    // This disables innerHTML optimization which strips data-action attributes
                    const compileOptions = element._usedTemplateName ? { isConfigurableTemplate: true } : {};
                    const compiledMetadata = this._compileTemplate(listsCache, cacheKey || listPath, compileOptions);
                    if (compiledMetadata) {
                        this._templateCache.compiled.set(cacheKey || listPath, compiledMetadata);
                    }
                }
            }
        }

        if (!cachedContent) {
            // No template cached, need to extract it first
            // CRITICAL: Pass instance to enable configurable template (data-use-template) lookup
            // Without instance, _findTemplate cannot traverse the component hierarchy
            const template = this._findTemplate(element, instance);
            if (template) {
                // === CRITICAL: Process nested templates to register relationships ===
                // This enables _processNestedListsForItem to find and render nested lists
                this._processNestedTemplates(template, listPath, componentName, instance);

                // Extract template content and cache it
                // Use cacheKey (includes componentName) for proper isolation between components
                const extractedContent = this._extractTemplateContent(template);
                this._templateCache.extracted.set(cacheKey, extractedContent);
                cachedContent = extractedContent;

                // Cache the used template name for SSR marker support
                // This ensures the name is available even when using cached templates
                if (element._usedTemplateName) {
                    if (!this._templateCache.templateNames) {
                        this._templateCache.templateNames = new Map();
                    }
                    this._templateCache.templateNames.set(cacheKey, element._usedTemplateName);
                }

                // Also compile template metadata if needed
                if (!this._templateCache.compiled.has(cacheKey)) {
                    // Pass isConfigurableTemplate: true if this is a configurable template
                    // This disables innerHTML optimization which strips data-action attributes
                    const compileOptions = element._usedTemplateName ? { isConfigurableTemplate: true } : {};
                    const compiledMetadata = this._compileTemplate(template, cacheKey, compileOptions);
                    if (compiledMetadata) {
                        this._templateCache.compiled.set(cacheKey, compiledMetadata);
                    }
                }
            }
        }

        // Restore _usedTemplateName from cache if available (for SSR marker support)
        // This ensures the name is set even when using cached templates with new DOM elements
        if (!element._usedTemplateName && this._templateCache.templateNames) {
            const cachedTemplateName = this._templateCache.templateNames.get(cacheKey) ||
                                       this._templateCache.templateNames.get(listPath);
            if (cachedTemplateName) {
                element._usedTemplateName = cachedTemplateName;
            }
        }

        // Use the cached content we already have (or re-fetch if needed)
        let templateContent = cachedContent ||
                                this._templateCache.extracted.get(cacheKey) ||
                                this._templateCache.extracted.get(listPath);

        // Get compiled metadata for class bindings
        let compiledMetadata = this._templateCache.compiled.get(cacheKey) ||
                                 this._templateCache.compiled.get(listPath);

        // === POLYMORPHIC TEMPLATES (data-template-key) ===
        // When data-template-key is present, index all <template data-type="X"> children
        // and select the correct template per item based on item[templateKeyProp].
        const templateKeyProp = this._getAttr(element, 'template-key');
        let templatesByType = null;
        let defaultPolyTemplate = null;
        let compiledMetaByType = null;
        const isPolymorphic = !!templateKeyProp;

        if (isPolymorphic) {
            templatesByType = new Map();
            compiledMetaByType = new Map();

            // Find ALL <template> children in the list element
            const allTemplates = element.querySelectorAll(':scope > template');
            for (const tmpl of allTemplates) {
                const typeValue = this._getAttr(tmpl, 'type');
                const extractedContent = this._extractTemplateContent(tmpl);

                // Process nested templates for each variant
                this._processNestedTemplates(tmpl, listPath, componentName, instance);

                // Compile metadata for this template variant
                const variantMeta = this._compileTemplate(tmpl, `${cacheKey}:poly:${typeValue || '__default__'}`);

                if (typeValue) {
                    templatesByType.set(typeValue, extractedContent);
                    if (variantMeta) compiledMetaByType.set(typeValue, variantMeta);
                } else {
                    // Untyped template = default/fallback
                    defaultPolyTemplate = extractedContent;
                    if (variantMeta) compiledMetaByType.set('__default__', variantMeta);
                }
            }

            // Store on element for force-re-render edge case
            element._templatesByType = templatesByType;
            element._defaultPolyTemplate = defaultPolyTemplate;
            element._compiledMetaByType = compiledMetaByType;
            element._templateKeyProp = templateKeyProp;

            // Use the default template (or the first typed one) as the base templateContent/compiledMetadata
            // This ensures the "no template found" check below passes
            if (defaultPolyTemplate) {
                templateContent = defaultPolyTemplate;
                compiledMetadata = compiledMetaByType.get('__default__') || null;
            } else if (templatesByType.size > 0) {
                const firstEntry = templatesByType.entries().next().value;
                templateContent = firstEntry[1];
                compiledMetadata = compiledMetaByType.get(firstEntry[0]) || null;
            }
        }

        if (!templateContent) {
            if (__DEV__) console.warn('[mapArray] No template found for list:', listPath);
            return;
        }

        // Disable innerHTML fast path when text bindings reference implicit computed properties.
        // The innerHTML path creates simple property accessors (item[path]) that bypass
        // _resolveCompiledBinding's implicit computed detection (step 7).
        let hasImplicitComputedBindings = false;
        if (compiledMetadata?.innerHTMLParts && instance?.stateManager?.computed) {
            const computed = instance.stateManager.computed;
            hasImplicitComputedBindings = compiledMetadata.bindings.some(b =>
                !b.isComputed && b.path && b.path in computed
            );
        }

        const isDocumentFragment = templateContent.nodeType === Node.DOCUMENT_FRAGMENT_NODE;

        // Get SSR template marker if using configurable templates
        const usedTemplateName = element._usedTemplateName;

        // PERF: Pre-compute template characteristics ONCE before the loop
        // This mirrors the optimization pattern from the old context path (lines 2117-2122)
        // Avoids N function calls and DOM queries for N items
        // For polymorphic lists, OR-union across all template types
        let hasNestedComponents = compiledMetadata?.hasNestedComponents ?? false;
        const childListPaths = this._listRelationships?.get(context?.path);
        let hasChildLists = childListPaths && childListPaths.size > 0;
        let hasPortals = compiledMetadata?.hasPortals ?? false;
        let hasConditionals = (compiledMetadata?.shows?.length > 0) || (compiledMetadata?.renders?.length > 0);

        if (isPolymorphic && compiledMetaByType) {
            for (const meta of compiledMetaByType.values()) {
                if (meta.hasNestedComponents) hasNestedComponents = true;
                if (meta.hasPortals) hasPortals = true;
                if ((meta.shows?.length > 0) || (meta.renders?.length > 0)) hasConditionals = true;
            }
        }

        // Get key property
        const keyProp = this._getAttr(element, 'key') || 'id';

        // Track item elements for cleanup
        const itemElements = new Map();

        // Remove <template> from DOM after extraction — it's no longer needed.
        // Template content is already cached; keeping it in children causes off-by-one
        // errors in child indexing (append, moves, element.children.length).
        // Store reference on element for force-re-render edge case.
        if (isPolymorphic) {
            // Remove ALL templates for polymorphic lists
            const allTmpls = element.querySelectorAll(':scope > template');
            storedTemplatesCache.set(element, Array.from(allTmpls));
            allTmpls.forEach(t => t.remove());
        } else {
            const templateEl = element.querySelector('template');
            if (templateEl) {
                storedTemplateCache.set(element, templateEl);
                templateEl.remove();
            }
        }

        // Get array accessor function for mapArray
        // We need to access the array through the state proxy
        // For nested lists, use the data passed directly since the path (e.g., "tasks")
        // doesn't exist at component root level - it's relative to the parent item
        const isNestedList = context && context.parent && context.parent.type === 'list';

        const arrayFn = () => {
            // Nested lists: Access data through parent item proxy for reactive tracking
            if (isNestedList) {
                // Use _parentItemProxy to access nested data reactively
                // This creates a dependency so mapArray re-runs when nested data changes
                if (context._parentItemProxy && context._childPath) {
                    let v = context._parentItemProxy[context._childPath];
                    // Fallback: implicit item-level computed evaluation when the
                    // child path isn't a raw field on the parent item but IS a
                    // defined computed on the component. Mirrors data-bind's
                    // resolution for symmetry across binding types.
                    if (v === undefined &&
                        !context._childPath.includes('.') &&
                        sm?.computed?.[context._childPath]) {
                        const parentIndex = context._parentIndex ?? -1;
                        try {
                            v = self._evaluateComputedInListContext(
                                instance, context._childPath,
                                context._parentItemProxy, parentIndex, context
                            );
                        } catch (e) { /* return undefined below */ }
                    }
                    return v;
                }
                // Fallback to context.data for non-mapArray nested lists
                return context.data || data;
            }

            // Handle different path types for top-level lists
            const normalizedPath = listPath.includes('$') && self._normalizeStoreShorthands
                ? self._normalizeStoreShorthands(listPath)
                : listPath;

            // Determine computed property name:
            // 1. Explicit computed: prefix (e.g., "computed:cards")
            // 2. Auto-detect: path matches a computed property name (e.g., "cards")
            // Both paths are treated identically — computed properties just work
            // regardless of whether the prefix is used.
            const isExplicitComputed = normalizedPath.startsWith('computed:');
            const computedName = isExplicitComputed
                ? normalizedPath.slice(9)
                : (sm.computed && sm.computed[normalizedPath] ? normalizedPath : null);

            if (computedName) {
                // Computed property — use evaluateComputed with tracking context
                // for cross-entity dependency registration (store access via external()).
                const previousTrackingContext = self._computedTrackingContext;
                // V8 OPT: Canonical shape — all fields always present
                self._computedTrackingContext = {
                    componentId: instance?.id || null,
                    computedName: computedName,
                    stateManager: sm || null,
                    listElement: element,
                    isItemLevelComputed: false,
                    itemIndex: -1
                };
                try {
                    return sm.evaluateComputed(computedName);
                } finally {
                    self._computedTrackingContext = previousTrackingContext;
                }
            } else if (normalizedPath.includes('external(')) {
                return self._evaluateExternalListPath(normalizedPath, instance);
            } else {
                return sm.getValue(normalizedPath);
            }
        };

        // Build component state with computed values for class evaluators
        // CRITICAL: Always spread instance.state into a plain object to avoid returning
        // the reactive proxy. If we return the proxy and it's later spread in class bindings
        // (e.g., `...componentState`), that would register dependencies on ALL state
        // properties for each item effect, causing them to re-run on any state change.
        // PERF: Cache component state to avoid rebuilding per-item.
        // Invalidated when component state version changes (tracked by RSM).
        let _cachedComponentState = null;
        let _cachedStateVersion = -1;
        const buildComponentState = () => {
            // Check if state has changed since last build
            const currentVersion = sm?._globalEpoch || 0;
            if (_cachedComponentState && _cachedStateVersion === currentVersion) {
                return _cachedComponentState;
            }
            // Always create a plain object copy, even if no computed properties
            let componentState = { ...(instance?.state || {}) };
            if (sm?.computed) {
                for (const key of Object.keys(sm.computed)) {
                    try {
                        componentState[key] = sm.evaluateComputed(key);
                    } catch (e) {
                        // Skip computed properties that error
                    }
                }
            }
            _cachedComponentState = componentState;
            _cachedStateVersion = currentVersion;
            return componentState;
        };

        // Factory function to create per-item effect
        // Extracted so it can be called immediately or deferred via requestIdleCallback
        const createItemEffect = (itemEl, itemProxy, precomputedItemProps, precomputedComponentDeps) => {
            let isFirstRun = !precomputedItemProps;
            const dispose = sm.createEffect(() => {
                // For polymorphic lists, use per-item compiled metadata
                const effectMeta = isPolymorphic ? (itemEl._compiledMetadata || compiledMetadata) : compiledMetadata;
                if (effectMeta) {
                    const currentIndex = itemEl._listIndex;
                    const listLength = element.children.length;

                    if (isFirstRun) {
                        // PERF OPTIMIZATION: Lightweight first run
                        // Goal: Register dependencies with MINIMAL overhead
                        // Skip: object creation, expression evaluation, merged state
                        // Just read properties directly from itemProxy to trigger proxy get trap
                        isFirstRun = false;

                        // Helper to read a property path from proxy to register dependency
                        // Handles nested paths like "user.name" by traversing the proxy
                        const touchPath = (path) => {
                            if (!path || typeof path !== 'string') return;
                            // Skip special paths that don't come from item data
                            if (path.startsWith('_') || path.startsWith('computed:') || path.startsWith('props:')) return;
                            // Handle negation
                            if (path.startsWith('!')) path = path.slice(1);
                            try {
                                // PERF: Fast path for simple paths (no dots) - avoid split()
                                // Most list item bindings use simple paths like "label", "id"
                                if (path.indexOf('.') === -1) {
                                    // Simple path - direct access, no array allocation
                                    const _ = itemProxy[path];
                                } else {
                                    // Nested path - need to traverse
                                    const parts = path.split('.');
                                    let value = itemProxy;
                                    for (let i = 0; i < parts.length && value != null; i++) {
                                        value = value[parts[i]];
                                    }
                                }
                            } catch (e) { /* ignore - property might not exist */ }
                        };

                        // Register component-level deps on per-item effects.
                        // OPTIMIZATION: Deps used ONLY in class bindings are skipped here —
                        // the component refresh effect handles them with O(2) key lookup.
                        // Deps used in style/attr/show/text still need per-item registration.
                        const touchComponentLevel = (v) => {
                            if (v.indexOf('.') !== -1) return;
                            if (v in itemProxy) return;
                            if (!instance?.state || !(v in instance.state)) return;
                            if (sm?.computed?.[v]) {
                                sm._registerComponentDep('computed:' + v);
                                return;
                            }
                            // Skip if this var is only used in class bindings
                            // (refresh effect handles it)
                            if (element._classOnlyCompDeps?.has(v)) return;
                            // Register for per-item effect (used in style/attr/show/text)
                            try { const _ = instance.state[v]; } catch (e) { /* ignore */ }
                        };

                        // Helper to extract and touch variables from an expression
                        const touchExpressionVars = (expr, preExtractedVars) => {
                            const vars = preExtractedVars || (expr?.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || []);
                            for (const v of vars) {
                                if (v.startsWith('_') || self._expressionReservedWords?.has(v)) continue;
                                touchPath(v);           // Item-level dep (existing)
                                touchComponentLevel(v); // Component-level dep (new)
                            }
                        };

                        // For item-level computeds (fn(item) with fn.length > 0) referenced in
                        // expressions, evaluate the computed so its internal state reads register
                        // dependencies on THIS row's effect. Plain `touchExpressionVars` only reads
                        // the names off the proxy; it never invokes the computed body.
                        const originalComputeds = instance?.stateManager?._originalComputedFunctions;
                        const evalItemLevelComputedsForExprVars = (expressionVars) => {
                            if (!originalComputeds || !expressionVars) return;
                            for (const v of expressionVars) {
                                const fn = originalComputeds.get(v);
                                // Both forms need invocation here so the computed's
                                // internal state reads register as per-row deps.
                                // Bare-form `fn()` reading `this.X` is resolved by
                                // _evaluateComputedInListContext, whose `{...item}`
                                // spread registers item-property reads.
                                if (typeof fn === 'function') {
                                    try {
                                        self._evaluateComputedInListContext(instance, v, itemProxy, currentIndex, context);
                                    } catch (e) { /* ignore */ }
                                }
                            }
                        };
                        const evalItemLevelComputedByName = (name) => {
                            if (!originalComputeds || !name) return;
                            const fn = originalComputeds.get(name);
                            // Both forms need invocation under the active per-item
                            // effect tracker so the computed's internal state reads
                            // register as deps. Bare-form (fn.length === 0) reads
                            // `this.X` which the list-context evaluator resolves to
                            // the current item's fields.
                            if (typeof fn === 'function') {
                                try {
                                    self._evaluateComputedInListContext(instance, name, itemProxy, currentIndex, context);
                                } catch (e) { /* ignore */ }
                            }
                        };

                        // Touch text binding properties
                        for (const binding of (effectMeta.bindings || [])) {
                            if (binding.isExpression && binding.expressionVars) {
                                // Expression with pre-extracted vars - just touch those
                                touchExpressionVars(null, binding.expressionVars);
                                evalItemLevelComputedsForExprVars(binding.expressionVars);
                            } else if (!binding.isExpression && !binding.isListContextVar && !binding.isPropsPath && !binding.isComputed) {
                                // Simple property path - touch it
                                touchPath(binding.path);
                                touchComponentLevel(binding.path);
                                evalItemLevelComputedByName(binding.path);
                            }
                            // Skip computed:, props:, and _index/_first etc - they don't need item deps
                        }

                        // Touch class binding variables
                        // For computed class bindings, we MUST evaluate the computed to discover its deps
                        for (const classBinding of (effectMeta.classBindings || [])) {
                            if (classBinding.isComputed && classBinding.expression && instance) {
                                // Computed class binding - must evaluate to register dependencies
                                try {
                                    const computedName = classBinding.expression.startsWith('computed:')
                                        ? classBinding.expression.slice(9)
                                        : classBinding.expression;
                                    self._evaluateComputedInListContext(instance, computedName, itemProxy, currentIndex, context);
                                } catch (e) { /* ignore */ }
                            } else if (classBinding.isSimpleProperty && classBinding.expression) {
                                touchPath(classBinding.expression);
                                touchComponentLevel(classBinding.expression);
                                // If the simple property name matches an item-level computed,
                                // evaluate it to register the computed's transitive deps.
                                // Both bare-form `fn()` reading `this.X` and parameterised
                                // `fn(item)` need invocation so their internal state reads
                                // register on this row's effect.
                                if (originalComputeds && originalComputeds.has(classBinding.expression)) {
                                    const fn = originalComputeds.get(classBinding.expression);
                                    if (typeof fn === 'function') {
                                        try {
                                            self._evaluateComputedInListContext(instance, classBinding.expression, itemProxy, currentIndex, context);
                                        } catch (e) { /* ignore */ }
                                    }
                                }
                            } else if (classBinding.expression) {
                                // For object/ternary expressions, identifiers may include item-level
                                // computed names. Evaluate any such computeds so their internal state
                                // reads register dependencies for THIS row's class effect.
                                touchExpressionVars(classBinding.expression, classBinding.expressionVars);
                                if (originalComputeds && classBinding.expressionVars) {
                                    for (const v of classBinding.expressionVars) {
                                        const fn = originalComputeds.get(v);
                                        if (typeof fn === 'function') {
                                            try {
                                                self._evaluateComputedInListContext(instance, v, itemProxy, currentIndex, context);
                                            } catch (e) { /* ignore */ }
                                        }
                                    }
                                }
                            }
                        }

                        // Touch style binding variables
                        for (const styleBinding of (effectMeta.styleBindings || [])) {
                            if (styleBinding.expression) {
                                touchExpressionVars(styleBinding.expression, styleBinding.expressionVars);
                                evalItemLevelComputedsForExprVars(
                                    styleBinding.expressionVars
                                    || (styleBinding.expression?.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g))
                                );
                            }
                        }
                        if (effectMeta.rootBindings?.bindStyleExpr) {
                            const rootExpr = effectMeta.rootBindings.bindStyleExpr;
                            touchExpressionVars(rootExpr, null);
                            evalItemLevelComputedsForExprVars(rootExpr.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g));
                        }

                        // Touch attr binding variables
                        for (const attrBinding of (effectMeta.attrBindings || [])) {
                            if (attrBinding.expression) {
                                touchExpressionVars(attrBinding.expression, attrBinding.expressionVars);
                                evalItemLevelComputedsForExprVars(
                                    attrBinding.expressionVars
                                    || (attrBinding.expression?.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g))
                                );
                            }
                        }
                        if (effectMeta.rootBindings?.bindAttrExpr) {
                            const rootExpr = effectMeta.rootBindings.bindAttrExpr;
                            touchExpressionVars(rootExpr, null);
                            evalItemLevelComputedsForExprVars(rootExpr.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g));
                        }

                        // Touch model binding properties
                        for (const modelBinding of (effectMeta.models || [])) {
                            touchPath(modelBinding.path);
                        }

                        // Touch show binding properties
                        for (const showBinding of (effectMeta.shows || [])) {
                            if (showBinding.isExpression && showBinding.expressionVars) {
                                touchExpressionVars(null, showBinding.expressionVars);
                                evalItemLevelComputedsForExprVars(showBinding.expressionVars);
                            } else {
                                touchPath(showBinding.path);
                                touchComponentLevel(showBinding.path);
                                evalItemLevelComputedByName(showBinding.path);
                            }
                        }

                        // Touch HTML binding properties
                        for (const htmlBinding of (effectMeta.htmlBindings || [])) {
                            touchPath(htmlBinding.path);
                            touchComponentLevel(htmlBinding.path);
                            evalItemLevelComputedByName(htmlBinding.path);
                        }

                        // Touch render binding properties
                        for (const renderBinding of (effectMeta.renders || [])) {
                            if (renderBinding.isExpression && renderBinding.expressionVars) {
                                touchExpressionVars(null, renderBinding.expressionVars);
                                evalItemLevelComputedsForExprVars(renderBinding.expressionVars);
                            } else {
                                touchPath(renderBinding.path);
                                touchComponentLevel(renderBinding.path);
                                evalItemLevelComputedByName(renderBinding.path);
                            }
                        }

                        // Touch root bindings
                        if (effectMeta.rootBindings) {
                            if (effectMeta.rootBindings.bindPath) {
                                touchPath(effectMeta.rootBindings.bindPath);
                                touchComponentLevel(effectMeta.rootBindings.bindPath);
                            }
                            if (effectMeta.rootBindings.showPath) {
                                touchPath(effectMeta.rootBindings.showPath);
                                touchComponentLevel(effectMeta.rootBindings.showPath);
                            }
                            if (effectMeta.rootBindings.modelPath) touchPath(effectMeta.rootBindings.modelPath);
                            if (effectMeta.rootBindings.bindClassExpr) {
                                const rootExpr = effectMeta.rootBindings.bindClassExpr;
                                if (rootExpr.startsWith('computed:') && instance) {
                                    // Computed class binding on root - must evaluate
                                    try {
                                        const computedName = rootExpr.slice(9);
                                        self._evaluateComputedInListContext(instance, computedName, itemProxy, currentIndex, context);
                                    } catch (e) { /* ignore */ }
                                } else {
                                    touchExpressionVars(rootExpr, null);
                                }
                            }
                        }

                        return; // Skip DOM updates on first run
                    }

                    // Subsequent runs: full rebinding with DOM updates
                    // CRITICAL: Use itemEl._itemData (current proxy) instead of itemProxy (stale closure)
                    // When array is replaced, onItemUpdate updates itemEl._itemData with the new proxy
                    // The per-item effect should use this updated proxy, not the captured one
                    const currentItemProxy = itemEl._itemData || itemProxy;

                    // TARGETED REBIND: When a single flat item prop changed,
                    // filter DOM writes to only matching bindings.
                    // Normal resolve/evaluate still runs for dependency re-registration.
                    self._targetedProp = null; // Clear stale value from previous effect
                    const _changedProp = sm._activeChangedProp;
                    if (_changedProp && _changedProp.indexOf('.') === -1 && !effectMeta.renders?.length) {
                        self._targetedProp = _changedProp;
                    }

                    const componentState = sm.untrack(() => buildComponentState());

                    // V8 OPT: Reuse pre-allocated context
                    _mapFnEnrichedCtx.listLength = listLength;
                    const enrichedContext = _mapFnEnrichedCtx;

                    // Execute data-render BEFORE other bindings — may insert/remove elements
                    if (effectMeta.renders?.length > 0 && itemEl._renderContexts) {
                        _t0 = performance.now();
                        const renderCtx = {
                            componentState: instance?.state || {},
                            componentInstance: instance,
                            itemIndex: currentIndex,
                            listLength: listLength,
                            listContext: context
                        };
                        const renderChanged = self._executeRenders(itemEl._renderContexts, currentItemProxy, renderCtx);
                        if (renderChanged) {
                            // DOM structure changed — invalidate cached elements array
                            itemEl._cachedElementsArray = null;
                        }
                        self._perfTimers.render += performance.now() - _t0;
                    }

                    // Skip style/attr in generic path when fast-path evaluators handle them
                    const hasFastPath = effectMeta.styleEvaluators?.length > 0 || effectMeta.attrEvaluators?.length > 0;

                    self._bindWithCompiledMetadata(itemEl, currentItemProxy, effectMeta, context, currentIndex, context, hasFastPath);

                    if (effectMeta.classEvaluators) {
                        self._applyClassBindingsToRow(itemEl, currentItemProxy, currentIndex, listLength, effectMeta.classEvaluators, componentState, instance, context);
                    }

                    // Style: fast-path with lazy proxy (avoids eager spread of item + componentState)
                    if (effectMeta.styleEvaluators?.length > 0) {
                        self._applyStyleBindingsToRow(itemEl, currentItemProxy, currentIndex, listLength, effectMeta.styleEvaluators, componentState, instance, context);
                    } else if (effectMeta.styleBindings?.length > 0 || effectMeta.rootBindings?.hasBindStyle) {
                        const rootStyleExpr = effectMeta.rootBindings?.bindStyleExpr;
                        if (rootStyleExpr) {
                            self._processStyleBinding(itemEl, currentItemProxy, rootStyleExpr, currentIndex, enrichedContext);
                        }
                        const elements = itemEl._bindingElements || itemEl._cachedElementsArray;
                        for (const styleBinding of (effectMeta.styleBindings || [])) {
                            const targetEl = (elements && styleBinding.index !== undefined)
                                ? elements[styleBinding.index]
                                : itemEl;
                            if (targetEl && styleBinding.expression) {
                                self._processStyleBinding(targetEl, currentItemProxy, styleBinding.expression, currentIndex, enrichedContext);
                            }
                        }
                    }

                    // Attr: fast-path with fresh component state
                    // Attr: fast-path with lazy proxy
                    if (effectMeta.attrEvaluators?.length > 0) {
                        self._applyAttrBindingsToRow(itemEl, currentItemProxy, currentIndex, listLength, effectMeta.attrEvaluators, componentState, instance, context);
                    }

                    // Clear targeted rebind flag
                    self._targetedProp = null;
                }
            }, precomputedItemProps
                ? { skipFirstRun: true, precomputedItemProps, componentDeps: precomputedComponentDeps }
                : undefined);
            // Tag and register every list item effect (including cross-store
            // lists where _itemEffectContext is null) so EntitySystem can wake
            // them on external entity mutations. Same-RSM list effects are
            // also in _itemEffectsByIndex; this is the union set.
            const eff = dispose._effect;
            if (eff) {
                eff._isListItemEffect = true;
                if (!sm._listItemEffects) sm._listItemEffects = new Set();
                sm._listItemEffects.add(eff);
            }
            return dispose;
        };

        // Compute which component-level vars are used ONLY in class bindings.
        // These can be skipped in per-item effects (refresh effect handles them).
        if (compiledMetadata && instance?.state && !element._classOnlyCompDeps) {
            const reservedWords = self._expressionReservedWords;
            const classVars = new Set();
            const otherVars = new Set();

            const addVarsFrom = (expr, targetSet) => {
                if (!expr) return;
                const vars = expr.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
                for (const v of vars) {
                    if (v.startsWith('_') || reservedWords?.has(v)) continue;
                    targetSet.add(v);
                }
            };

            // Class binding vars
            for (const cb of (compiledMetadata.classBindings || [])) {
                if (cb.expression && !cb.isComputed) addVarsFrom(cb.expression, classVars);
            }
            if (compiledMetadata.rootBindings?.bindClassExpr && !compiledMetadata.rootBindings.bindClassExpr.startsWith('computed:')) {
                addVarsFrom(compiledMetadata.rootBindings.bindClassExpr, classVars);
            }

            // Non-class binding vars (text, style, attr, show, render, model)
            for (const b of (compiledMetadata.bindings || [])) {
                if (b.isExpression && b.expressionVars) { for (const v of b.expressionVars) otherVars.add(v); }
                else if (b.path) otherVars.add(b.path);
            }
            for (const sb of (compiledMetadata.styleBindings || [])) { if (sb.expression) addVarsFrom(sb.expression, otherVars); }
            if (compiledMetadata.rootBindings?.bindStyleExpr) addVarsFrom(compiledMetadata.rootBindings.bindStyleExpr, otherVars);
            for (const ab of (compiledMetadata.attrBindings || [])) { if (ab.expression) addVarsFrom(ab.expression, otherVars); }
            if (compiledMetadata.rootBindings?.bindAttrExpr) addVarsFrom(compiledMetadata.rootBindings.bindAttrExpr, otherVars);
            for (const sh of (compiledMetadata.shows || [])) { if (sh.path) otherVars.add(sh.path); }
            for (const rb of (compiledMetadata.renders || [])) {
                if (rb.isExpression && rb.expressionVars) { for (const v of rb.expressionVars) otherVars.add(v); }
                else if (rb.path) otherVars.add(rb.path);
            }

            // Class-only = in classVars but NOT in otherVars, and IS component state (not item)
            const classOnly = new Set();
            for (const v of classVars) {
                if (!otherVars.has(v) && instance.state && v in instance.state && !sm?.computed?.[v]) {
                    classOnly.add(v);
                }
            }
            element._classOnlyCompDeps = classOnly;
        }

        // V8 OPT: Reusable enrichedContext for mapFn path — avoids per-item spread allocation
        const _mapFnEnrichedCtx = {
            ...context,
            componentInstance: instance,
            listLength: 0
        };

        // Map function - creates DOM element for each item
        // Third parameter isBulkCreation: when true, defer effect creation for better performance
        const mapFn = (itemProxy, index, isBulkCreation) => {
            // === POLYMORPHIC TEMPLATE SELECTION ===
            // Select the correct template and compiled metadata for this item
            let itemTemplateContent = templateContent;
            let itemCompiledMetadata = compiledMetadata;
            let itemIsDocFrag = isDocumentFragment;

            if (isPolymorphic && templatesByType) {
                const typeValue = String(itemProxy[templateKeyProp] ?? '');
                const typed = templatesByType.get(typeValue);
                if (typed) {
                    itemTemplateContent = typed;
                    itemCompiledMetadata = compiledMetaByType?.get(typeValue) || null;
                } else if (defaultPolyTemplate) {
                    itemTemplateContent = defaultPolyTemplate;
                    itemCompiledMetadata = compiledMetaByType?.get('__default__') || null;
                } else if (__DEV__) {
                    console.warn(`[mapArray] No template for type "${typeValue}" in polymorphic list`);
                }
                itemIsDocFrag = itemTemplateContent.nodeType === Node.DOCUMENT_FRAGMENT_NODE;
            }

            // Clone template
            const clonedContent = itemTemplateContent.cloneNode(true);
            const itemEl = itemIsDocFrag ? clonedContent.firstElementChild : clonedContent;

            if (!itemEl) return { element: null };

            // Only clear display:none (from hidden templates), preserve intentional values like flex/grid
            if (itemEl.style.display === 'none') itemEl.style.display = '';
            itemEl.classList.remove('hidden');

            // Strip data-cloak from the freshly cloned item (root + descendants).
            // The cached template (innerHTMLParts in TemplateSystem) already
            // strips data-cloak, but the cloneNode fallback path may use
            // template sources that bypassed that strip. Belt-and-suspenders
            // so no list-item creation path ever leaves data-cloak alive on
            // a row added after the initial scan.
            if (itemEl.hasAttribute && itemEl.hasAttribute('data-cloak')) {
                itemEl.removeAttribute('data-cloak');
            }
            if (itemEl.querySelectorAll) {
                const cloakedDescendants = itemEl.querySelectorAll('[data-cloak]');
                for (let ci = 0; ci < cloakedDescendants.length; ci++) {
                    cloakedDescendants[ci].removeAttribute('data-cloak');
                }
            }

            // Store context references (same as context rendering)
            itemEl._listContext = context;
            itemEl._listIndex = index;
            itemEl._itemData = itemProxy;

            // Store template type for per-item effect updates
            if (isPolymorphic) {
                itemEl._templateType = String(itemProxy[templateKeyProp] ?? '');
            }

            // SSR Support: Mark items rendered with configurable templates
            // This marker helps SSR/hydration identify which template was used
            if (usedTemplateName) {
                itemEl.dataset.wfUsedTemplate = usedTemplateName;
            }

            // Build and cache element references if we have compiled metadata
            if (itemCompiledMetadata) {
                itemEl._bindingElements = self._buildElementsArrayFromMetadata(itemEl, itemCompiledMetadata);
                itemEl._compiledMetadata = itemCompiledMetadata;
            }

            // Apply initial bindings using compiled metadata
            if (itemCompiledMetadata) {
                const componentState = buildComponentState();
                // V8 OPT: Reuse pre-allocated context, just update listLength
                _mapFnEnrichedCtx.listLength = data?.length || 0;
                const enrichedContext = _mapFnEnrichedCtx;

                // Apply text bindings
                self._bindWithCompiledMetadata(itemEl, itemProxy, itemCompiledMetadata, context, index, context);

                // Apply class bindings
                if (itemCompiledMetadata.classEvaluators) {
                    self._applyClassBindingsToRow(itemEl, itemProxy, index, data?.length || 0, itemCompiledMetadata.classEvaluators, componentState, instance, context);
                }

                // Apply style bindings
                const elements = itemEl._bindingElements || itemEl._cachedElementsArray;
                if (itemCompiledMetadata.styleBindings?.length > 0 || itemCompiledMetadata.rootBindings?.hasBindStyle) {
                    const rootStyleExpr = itemCompiledMetadata.rootBindings?.bindStyleExpr;
                    if (rootStyleExpr) {
                        self._processStyleBinding(itemEl, itemProxy, rootStyleExpr, index, enrichedContext);
                    }
                    for (const styleBinding of (itemCompiledMetadata.styleBindings || [])) {
                        const targetEl = (elements && styleBinding.index !== undefined)
                            ? elements[styleBinding.index]
                            : itemEl;
                        if (targetEl && styleBinding.expression) {
                            self._processStyleBinding(targetEl, itemProxy, styleBinding.expression, index, enrichedContext);
                        }
                    }
                }

                // Apply attr bindings
                if (itemCompiledMetadata.attrBindings?.length > 0 || itemCompiledMetadata.rootBindings?.hasBindAttr) {
                    const rootAttrExpr = itemCompiledMetadata.rootBindings?.bindAttrExpr;
                    if (rootAttrExpr) {
                        self._processAttrBinding(itemEl, itemProxy, rootAttrExpr, index, enrichedContext);
                    }
                    for (const attrBinding of (itemCompiledMetadata.attrBindings || [])) {
                        const targetEl = (elements && attrBinding.index !== undefined)
                            ? elements[attrBinding.index]
                            : itemEl;
                        if (targetEl && attrBinding.expression) {
                            self._processAttrBinding(targetEl, itemProxy, attrBinding.expression, index, enrichedContext);
                        }
                    }
                }
            }

            // === INTEGRATION: Handle root element model/show bindings ===
            // This covers data-model and data-show on the item root element itself
            const ds = itemEl.dataset;
            const rootContext = itemCompiledMetadata ? { ...context, componentInstance: instance, listLength: data?.length || 0 } : context;
            self._bindRootElementModelShow(itemEl, itemProxy, ds, index, rootContext);

            // Store binding data for context creation
            itemEl._needsContexts = true;
            itemEl._bindItemData = itemProxy;
            itemEl._bindItemIndex = index;

            // === INTEGRATION: Create contexts eagerly for action binding ===
            // This ensures action contexts exist BEFORE any click events,
            // which is required for proper event delegation and test compatibility
            if (self._contextSystemInitialized && self._contextRegistry) {
                self._ensureItemContexts(itemEl);
            }

            // Process conditionals, nested lists, directives, and portals
            self._applyListItemIntegrations(itemEl, instance, listPath, index, itemProxy, element, context,
                hasConditionals, hasChildLists, hasPortals);

            // Mark element for deferred component initialization (done in onInsert after DOM insertion)
            // This ensures components inside list items have access to _itemData via this.listItem
            // during their beforeInit() lifecycle hook, AND the element is in the DOM when the
            // component's own nested lists/bindings are processed.
            if (hasNestedComponents) {
                needsComponentInitSet.add(itemEl);
            }

            // Store element reference
            const itemKey = itemProxy && itemProxy[keyProp] !== undefined ? itemProxy[keyProp] : index;
            itemElements.set(itemKey, itemEl);

            // For ROOT-level data-render with conditionValue=false, the conditional
            // setup wanted to swap the element for a placeholder, but at that point
            // the element is still detached (in a DocumentFragment) and the swap
            // wouldn't survive bulk insertion. Substitute the placeholder here so
            // the actual list parent receives the placeholder, not the element.
            // Nested data-render handles itself fine because its parent IS attached.
            let insertEl = itemEl;
            if (itemEl._renderContexts) {
                for (const rc of itemEl._renderContexts) {
                    // Only root-level renders need substitution: binding.elementPath
                    // is the empty array for the root element of a list item template.
                    const isRootRender = rc?.binding?.elementPath
                        && Array.isArray(rc.binding.elementPath)
                        && rc.binding.elementPath.length === 0;
                    if (isRootRender && rc.context?.placeholder && rc.context.isRendered === false) {
                        insertEl = rc.context.placeholder;
                        break;
                    }
                }
            }

            // OPTIMIZATION: During bulk creation, defer effect creation to after DOM insertion
            // This moves effect creation outside the critical rendering path
            if (isBulkCreation) {
                // Return element + data for deferred effect creation
                return {
                    element: insertEl,
                    key: itemKey,
                    disposeEffect: null,
                    itemProxy
                };
            }

            // Normal path: create effect immediately
            const disposeEffect = createItemEffect(itemEl, itemProxy);
            // Set on element for API consistency with _createItemEffect
            itemEl._wfDisposeEffect = disposeEffect;
            return { element: insertEl, disposeEffect };
        };

        // Set up mapArray with callbacks
        const disposeMapArray = sm.mapArray(
            arrayFn,
            mapFn,
            {
                key: keyProp,
                // OPTIMIZATION: innerHTML fast path for bulk creation
                // Uses existing _generateRowsHTML instead of 1000 cloneNode calls
                onBulkCreate: (newArray, keyProp, startIndex = 0) => {
                    // Polymorphic lists: different items use different templates,
                    // so innerHTML fast path cannot be used
                    if (isPolymorphic) return null;

                    // Check if template has innerHTML parts for fast path
                    if (!compiledMetadata?.innerHTMLParts || !compiledMetadata?.textAccessors || hasImplicitComputedBindings) {
                        return null; // Fall back to mapFn loop
                    }

                    // Custom elements need property assignment (el.value = x), not innerHTML text content.
                    // The innerHTML fast path generates HTML strings which can't set DOM properties.
                    if (compiledMetadata.hasCustomElements) {
                        return null; // Fall back to mapFn loop
                    }

                    const parts = compiledMetadata.innerHTMLParts;
                    const accessors = compiledMetadata.textAccessors;
                    const classEvaluators = compiledMetadata.classEvaluators || [];

                    // Build component state for class evaluators
                    const componentState = buildComponentState();

                    // Generate HTML for items (supports both full creation and append)
                    const htmlString = self._generateRowsHTML(instance, newArray, parts, accessors, startIndex, newArray.length);

                    if (startIndex === 0) {
                        // FULL CREATION: Replace innerHTML
                        // Template was already removed from DOM during setup,
                        // so innerHTML won't destroy it
                        element.innerHTML = htmlString;
                    } else {
                        // APPEND MODE: Insert new rows at end without destroying existing
                        // Template was removed during setup, so no off-by-one interference
                        element.insertAdjacentHTML('beforeend', htmlString);
                    }

                    // Build results array from created rows
                    const rows = element.children;
                    // For append, we need to process only the NEW rows (skip existing)
                    const rowStartIndex = startIndex;
                    // PERF: Pre-allocate results array to avoid 14+ array resizing cycles
                    const resultCount = rows.length - startIndex;
                    const results = new Array(resultCount);
                    let resultIdx = 0;

                    // Pre-create enriched context once
                    const enrichedContext = {
                        ...context,
                        componentInstance: instance,
                        listLength: newArray.length
                    };

                    // PERF: Pre-allocate reusable merged context for class bindings.
                    // Uses a Proxy that delegates to the current item, avoiding 10K
                    // object allocations + spread operations in the per-row loop.
                    const needsMergedCtx = classEvaluators && classEvaluators.some(e =>
                        (e.evaluator && e.evaluator._usesMergedContext) || (!e.evaluator && e.expression));
                    let reusableMergedCtx = null;
                    if (needsMergedCtx) {
                        reusableMergedCtx = {
                            ...componentState,
                            _index: 0,
                            _length: newArray.length,
                            _first: false,
                            _last: false
                        };
                    }

                    // Cache binding arrays
                    const styleBindings = compiledMetadata.styleBindings || [];
                    const attrBindings = compiledMetadata.attrBindings || [];
                    const rootStyleExpr = compiledMetadata.rootBindings?.hasBindStyle && compiledMetadata.rootBindings?.bindStyleExpr;
                    const rootAttrExpr = compiledMetadata.rootBindings?.hasBindAttr && compiledMetadata.rootBindings?.bindAttrExpr;
                    const hasStyleBindings = rootStyleExpr || styleBindings.length > 0;
                    const hasAttrBindings = rootAttrExpr || attrBindings.length > 0;

                    // PERF: Pre-check whether root model/show exists
                    // Avoids N function calls + metadata lookups when template doesn't use them
                    const hasRootModelOrShow = compiledMetadata.rootBindings?.modelPath || compiledMetadata.rootBindings?.showPath;

                    // Pre-resolve outside-click actions on row-template children.
                    // Lazy context creation in this bulk path means
                    // _ensureItemContextsFromMetadata isn't reached until the
                    // user clicks INSIDE a row. data-event-outside fires on
                    // clicks OUTSIDE the row, so it must be wired now or it
                    // silently no-ops. Each entry is {actionIndex, methodNames[]}
                    // pre-parsed once per template, not per row.
                    let outsideClickActions = compiledMetadata._outsideClickActions;
                    if (outsideClickActions === undefined) {
                        outsideClickActions = null;
                        if (compiledMetadata.actions) {
                            for (const action of compiledMetadata.actions) {
                                if (!action.hasEventOutside) continue;
                                if (action.isInNestedList || action.isInNestedComponent) continue;
                                const defs = self._parseActions(action.actionName);
                                const methodNames = [];
                                for (const def of defs) {
                                    if (def.methodName) methodNames.push(def.methodName);
                                }
                                if (methodNames.length === 0) continue;
                                if (!outsideClickActions) outsideClickActions = [];
                                outsideClickActions.push({ index: action.index, methodNames });
                            }
                        }
                        compiledMetadata._outsideClickActions = outsideClickActions;
                    }

                    // For append, start from rowStartIndex to skip existing rows
                    for (let i = rowStartIndex; i < rows.length; i++) {
                        const row = rows[i];
                        const itemProxy = newArray[i];
                        if (!row || !itemProxy) continue;

                        const itemKey = itemProxy[keyProp] !== undefined ? itemProxy[keyProp] : i;

                        // Attach metadata
                        row._listContext = context;
                        row._listIndex = i;
                        row._itemData = itemProxy;

                        // SSR Support: Mark items rendered with configurable templates
                        if (usedTemplateName) {
                            row.dataset.wfUsedTemplate = usedTemplateName;
                        }

                        // Build and cache elements array for sparse updates
                        row._bindingElements = self._buildElementsArrayFromMetadata(row, compiledMetadata);
                        row._compiledMetadata = compiledMetadata;

                        // Apply class bindings (skip call entirely when no evaluators)
                        if (classEvaluators.length > 0) {
                            if (reusableMergedCtx) {
                                Object.assign(reusableMergedCtx, itemProxy);
                                reusableMergedCtx._index = i;
                                reusableMergedCtx._first = i === 0;
                                reusableMergedCtx._last = i === newArray.length - 1;
                            }
                            self._applyClassBindingsToRow(row, itemProxy, i, newArray.length, classEvaluators, componentState, instance, context, reusableMergedCtx);
                        }

                        // Apply style bindings
                        const elements = row._bindingElements || row._cachedElementsArray;
                        if (hasStyleBindings) {
                            if (rootStyleExpr) {
                                self._processStyleBinding(row, itemProxy, rootStyleExpr, i, enrichedContext);
                            }
                            for (const styleBinding of styleBindings) {
                                const targetEl = (elements && styleBinding.index !== undefined)
                                    ? elements[styleBinding.index]
                                    : row;
                                if (targetEl && styleBinding.expression) {
                                    self._processStyleBinding(targetEl, itemProxy, styleBinding.expression, i, enrichedContext);
                                }
                            }
                        }

                        // Apply attr bindings
                        if (hasAttrBindings) {
                            if (rootAttrExpr) {
                                self._processAttrBinding(row, itemProxy, rootAttrExpr, i, enrichedContext);
                            }
                            for (const attrBinding of attrBindings) {
                                const targetEl = (elements && attrBinding.index !== undefined)
                                    ? elements[attrBinding.index]
                                    : row;
                                if (targetEl && attrBinding.expression) {
                                    self._processAttrBinding(targetEl, itemProxy, attrBinding.expression, i, enrichedContext);
                                }
                            }
                        }

                        // === INTEGRATION: Handle root element model/show bindings ===
                        // PERF: Only call if template actually has root model/show bindings
                        if (hasRootModelOrShow) {
                            const ds = row.dataset;
                            self._bindRootElementModelShow(row, itemProxy, ds, i, enrichedContext);
                        }

                        // Store binding data for context creation
                        row._needsContexts = true;
                        row._bindItemData = itemProxy;
                        row._bindItemIndex = i;

                        // Wire data-event-outside on row-template children.
                        // Must happen eagerly: clicks land outside the row, so
                        // the lazy context-creation path won't trigger. The
                        // PropsSystem registry is idempotent so repeat row
                        // mounts (template re-renders, key reuse) are safe.
                        if (outsideClickActions) {
                            const rowElements = row._bindingElements;
                            for (let oi = 0; oi < outsideClickActions.length; oi++) {
                                const entry = outsideClickActions[oi];
                                const actionEl = rowElements[entry.index];
                                if (!actionEl) continue;
                                const methodNames = entry.methodNames;
                                const rowCtx = {
                                    item: itemProxy,
                                    index: i,
                                    listContext: context
                                };
                                for (let mi = 0; mi < methodNames.length; mi++) {
                                    const methodName = methodNames[mi];
                                    if (typeof instance.context[methodName] !== 'function') continue;
                                    self._setupOutsideClickHandler(actionEl, instance, methodName, rowCtx);
                                }
                            }
                        }

                        // PERF: Skip eager context creation in bulk path - contexts created lazily on interaction
                        // This was the main performance bottleneck (O(n) context creation during initial render)

                        // Process conditionals, nested lists, directives, and portals
                        self._applyListItemIntegrations(row, instance, listPath, i, itemProxy, element, context,
                            hasConditionals, hasChildLists, hasPortals);

                        // Store element reference
                        itemElements.set(itemKey, row);

                        // PERF: Index assignment (no array resizing) + minimal object
                        results[resultIdx++] = {
                            element: row,
                            itemProxy: itemProxy,
                            key: itemKey,
                            disposeEffect: null
                        };
                    }

                    return results;
                },
                // PERF: Batch insert via DocumentFragment for cloneNode fallback path
                // Collapses N individual appendChild calls into one DOM insertion
                onBulkInsert: (elements) => {
                    const fragment = document.createDocumentFragment();
                    for (let i = 0; i < elements.length; i++) {
                        fragment.appendChild(elements[i]);
                    }
                    element.appendChild(fragment);

                    // Initialize nested components after all items are in DOM
                    for (let i = 0; i < elements.length; i++) {
                        const el = elements[i];
                        if (needsComponentInitSet.has(el)) {
                            needsComponentInitSet.delete(el);
                            try {
                                sm.untrack(() => {
                                    self._initializeNestedComponentsInItem(el);
                                });
                            } catch (e) {
                                if (__DEV__) console.warn('[WF] Error initializing component in list item:', e.message);
                            }
                        }
                    }
                },
                onInsert: (el, idx) => {
                    if (!el) return;
                    if (idx >= element.children.length) {
                        element.appendChild(el);
                    } else {
                        element.insertBefore(el, element.children[idx]);
                    }

                    // === INTEGRATION: Initialize nested components after DOM insertion ===
                    if (needsComponentInitSet.has(el)) {
                        needsComponentInitSet.delete(el);
                        try {
                            sm.untrack(() => {
                                self._initializeNestedComponentsInItem(el);
                            });
                        } catch (e) {
                            if (__DEV__) console.warn('[WF] Error initializing component in list item:', e.message);
                        }
                    }
                },
                onRemove: (el, key) => {
                    if (!el) return;
                    // Clean up before removal
                    if (self._cleanupCustomDirectivesInSubtree) {
                        self._cleanupCustomDirectivesInSubtree(el);
                    }
                    self._cleanupContextsInSubtree(el);
                    self._destroyNestedComponentsInItem(el);
                    el.remove();
                    itemElements.delete(key);
                },
                // PERF: Bulk removal for removing many items at once
                // Uses batched cleanup instead of per-item cleanup
                onBulkRemove: (elements, items) => {
                    if (!elements || elements.length === 0) return;

                    // Use optimized batch cleanup (same as context mode)
                    // This does: batched directive cleanup, batched component destruction,
                    // deferred context cleanup - all with minimal querySelectorAll calls
                    self._batchCleanupListItemsWithNestedComponents(elements);

                    // PERF: Check if this is a full clear using itemElements map size
                    // instead of _getListItems DOM query (avoids Array.from on 10K children + 2 filter passes)
                    const isFullClear = elements.length >= itemElements.size;

                    if (isFullClear) {
                        // Full clear: single DOM operation
                        // Template was removed from DOM during setup, so just clear everything
                        element.replaceChildren();
                        // Clear all from map
                        itemElements.clear();
                    } else {
                        // Partial removal: remove specific elements
                        // Batch DOM removals together (browser can optimize)
                        for (let i = 0; i < elements.length; i++) {
                            elements[i].remove();
                        }
                        // Remove specific keys from map
                        for (let i = 0; i < items.length; i++) {
                            itemElements.delete(items[i].key);
                        }
                    }
                },
                onMove: (el, newIdx, oldIdx, refElement, skipDomMove) => {
                    if (!el) return;
                    // Only manipulate DOM if not skipped (element already in correct position)
                    if (!skipDomMove) {
                        // Use refElement for stable positioning
                        if (refElement) {
                            element.insertBefore(el, refElement);
                        } else {
                            element.appendChild(el);
                        }
                    }

                    // Always update index metadata (even if DOM position unchanged)
                    el._listIndex = newIdx;
                    el._bindItemIndex = newIdx; // CRITICAL: Update for context system

                    // CRITICAL: Also update _parentIndex on all contexts within this item
                    // This is needed for data-show, data-bind-class, and other bindings to resolve correctly
                    // Even when onItemUpdate is skipped (proxy unchanged), contexts need updated indices
                    if (self._contextRegistry?.contextsByElement) {
                        const ctx = self._contextRegistry.contextsByElement.get(el);
                        if (ctx && ctx._parentIndex !== undefined) {
                            ctx._parentIndex = newIdx;
                        }
                        // PERF: Use cached _bindingElements instead of querySelectorAll('*')
                        // This changes O(n) DOM query to O(1) property access per item
                        const cachedElements = el._bindingElements || el._cachedElementsArray;
                        if (cachedElements) {
                            for (let i = 0; i < cachedElements.length; i++) {
                                const childEl = cachedElements[i];
                                if (!childEl) continue;
                                const childCtx = self._contextRegistry.contextsByElement.get(childEl);
                                if (childCtx && childCtx._parentIndex !== undefined) {
                                    childCtx._parentIndex = newIdx;
                                }
                            }
                        }
                        // Fallback only for items without cached elements (rare edge case)
                        else if (el._needsContexts !== false) {
                            const descendants = el.querySelectorAll('*');
                            for (let i = 0; i < descendants.length; i++) {
                                const childCtx = self._contextRegistry.contextsByElement.get(descendants[i]);
                                if (childCtx && childCtx._parentIndex !== undefined) {
                                    childCtx._parentIndex = newIdx;
                                }
                            }
                        }
                    }
                },
                // Synchronous effect creation for immediate reactivity
                // Effects must be created before scan() returns so they can respond to mutations
                // that happen immediately after scan() completes
                onDeferredEffects: (deferredItems, currentItems, arrPath) => {
                    if (!deferredItems || deferredItems.length === 0) return;

                    // PERF: Extract and cache static item props once per template
                    // This allows skipping the first-run proxy reads (touchPath) for bulk-created items
                    if (compiledMetadata && compiledMetadata._staticItemProps === undefined) {
                        compiledMetadata._staticItemProps = self._extractStaticItemProps(compiledMetadata, instance);
                    }
                    const precomputedProps = compiledMetadata?._staticItemProps || null;

                    // Component-level deps (selectedId, etc.) are handled by the
                    // component refresh effect — NOT per-item effects. Extract deps
                    // for the refresh effect but don't pass to createItemEffect.
                    if (compiledMetadata && compiledMetadata._componentDeps === undefined) {
                        const sampleItem = deferredItems[0]?.itemProxy;
                        compiledMetadata._componentDeps = self._extractComponentDeps(compiledMetadata, sampleItem, instance, sm);

                        // Seed computedDependencies for computed component deps.
                        if (compiledMetadata._componentDeps && sm) {
                            for (const dep of compiledMetadata._componentDeps) {
                                if (dep.startsWith('computed:')) {
                                    try { sm.evaluateComputed(dep.slice(9)); } catch (e) { /* ignore */ }
                                }
                            }
                        }
                    }
                    // Filter out class-only deps from per-item effects.
                    // Keep computed deps + state vars used in non-class bindings.
                    let componentDeps = null;
                    if (compiledMetadata._componentDeps) {
                        const filtered = new Set();
                        for (const dep of compiledMetadata._componentDeps) {
                            if (dep.startsWith('computed:')) {
                                filtered.add(dep);
                            } else if (!element._classOnlyCompDeps?.has(dep)) {
                                filtered.add(dep);
                            }
                        }
                        componentDeps = filtered.size > 0 ? filtered : null;
                    }

                    // PERF: Build a Map for O(1) lookup instead of O(n) Array.find per item
                    // This changes complexity from O(n²) to O(n) for large lists
                    const itemsByKey = new Map();
                    for (let j = 0; j < currentItems.length; j++) {
                        itemsByKey.set(currentItems[j].key, currentItems[j]);
                    }

                    // Create effects synchronously to ensure they exist before any user code runs
                    for (let i = 0; i < deferredItems.length; i++) {
                        const data = deferredItems[i];
                        if (!data || !data.element || !data.itemProxy) continue;

                        // Skip if element was removed (e.g., component destroyed)
                        if (!data.element.parentNode) continue;

                        // Set _itemEffectContext so createEffect tags this as an item effect
                        const itemEntry = itemsByKey.get(data.key);
                        if (arrPath) {
                            sm._itemEffectContext = { prefix: arrPath + '.', index: itemEntry ? itemEntry.index : i, arrayPath: arrPath };
                        }

                        // Create the effect — pass precomputed props to skip first-run proxy reads
                        // Only when arrPath is truthy (same-RSM list with index-based tracking).
                        // Cross-store lists (arrPath is null) need the first run to register
                        // deps in the store's _effectDependents for notification to work.
                        const disposeEffect = createItemEffect(data.element, data.itemProxy,
                            arrPath ? precomputedProps : null, componentDeps);
                        sm._itemEffectContext = null;

                        // Set on element for API consistency with _createItemEffect
                        data.element._wfDisposeEffect = disposeEffect;

                        // Update the currentItems entry with the dispose function
                        // PERF: O(1) Map lookup instead of O(n) Array.find
                        if (itemEntry) {
                            itemEntry.disposeEffect = disposeEffect;
                        }
                    }
                },
                // === CRITICAL: Handle existing item proxy updates ===
                // Called when mapArray reuses an element but the item proxy has changed
                // This happens when array is replaced (e.g., state.items = [...]) with same keys
                onItemUpdate: (itemEl, newItemProxy, oldItemProxy, index) => {
                    // Update element's item data reference
                    itemEl._itemData = newItemProxy;
                    itemEl._bindItemData = newItemProxy;
                    itemEl._listIndex = index;
                    itemEl._bindItemIndex = index; // CRITICAL: Update for context system

                    // Update _parentIndex on all contexts within this item
                    // This ensures ConditionalContexts (data-show) resolve the correct item data
                    if (self._contextRegistry?.contextsByElement) {
                        // Update context on itemEl itself
                        const rootCtx = self._contextRegistry.contextsByElement.get(itemEl);
                        if (rootCtx && rootCtx._parentIndex !== undefined) {
                            rootCtx._parentIndex = index;
                        }
                        // PERF: Use cached _bindingElements instead of querySelectorAll('*')
                        const cachedElements = itemEl._bindingElements || itemEl._cachedElementsArray;
                        if (cachedElements) {
                            for (let i = 0; i < cachedElements.length; i++) {
                                const el = cachedElements[i];
                                if (!el) continue;
                                const ctx = self._contextRegistry.contextsByElement.get(el);
                                if (ctx && ctx._parentIndex !== undefined) {
                                    ctx._parentIndex = index;
                                }
                            }
                        }
                        // Fallback only for items without cached elements
                        else if (itemEl._needsContexts !== false) {
                            const descendants = itemEl.querySelectorAll('*');
                            for (let i = 0; i < descendants.length; i++) {
                                const ctx = self._contextRegistry.contextsByElement.get(descendants[i]);
                                if (ctx && ctx._parentIndex !== undefined) {
                                    ctx._parentIndex = index;
                                }
                            }
                        }
                    }

                    // Update nested list contexts with the new parent proxy
                    const childListPaths = self._listRelationships.get(context.path) || new Set();
                    childListPaths.forEach(childPath => {
                        const nestedListElements = itemEl.querySelectorAll(`[data-list="${childPath}"]`);
                        nestedListElements.forEach(nestedListEl => {
                            const childContext = nestedListEl._listContext;
                            if (childContext) {
                                // Update the parent item proxy reference
                                childContext._parentItemProxy = newItemProxy;
                                childContext._parentIndex = index;

                                // Get the new nested data from the new proxy
                                const nestedData = newItemProxy[childPath];

                                // Re-render the nested list with the new data
                                if (Array.isArray(nestedData)) {
                                    // CRITICAL: Dispose old mapArray before re-initializing
                                    // The nested mapArray's arrayFn reads from _parentItemProxy
                                    // which is a plain variable - updating it doesn't trigger effects
                                    // We need to dispose and re-initialize with the new data
                                    if (nestedListEl._mapArrayInitialized && nestedListEl._disposeMapArray) {
                                        nestedListEl._disposeMapArray();
                                        nestedListEl._mapArrayInitialized = false;
                                        nestedListEl._disposeMapArray = null;
                                        // Clear existing children before re-render
                                        nestedListEl.innerHTML = '';
                                    }
                                    self._renderList(nestedListEl, nestedData, childContext, instance);
                                }
                            }
                        });
                    });

                    // Rebind the element with the new proxy
                    if (compiledMetadata) {
                        const componentState = buildComponentState();
                        const listLength = element.children.length;
                        // V8 OPT: Reuse pre-allocated context
                        _mapFnEnrichedCtx.listLength = listLength;
                        const enrichedContext = _mapFnEnrichedCtx;

                        // Apply text bindings
                        self._bindWithCompiledMetadata(itemEl, newItemProxy, compiledMetadata, context, index, context);

                        // Apply class bindings
                        if (compiledMetadata.classEvaluators) {
                            self._applyClassBindingsToRow(itemEl, newItemProxy, index, listLength, compiledMetadata.classEvaluators, componentState, instance, context);
                        }

                        // Apply style bindings
                        const elements = itemEl._bindingElements || itemEl._cachedElementsArray;
                        if (compiledMetadata.styleBindings?.length > 0 || compiledMetadata.rootBindings?.hasBindStyle) {
                            const rootStyleExpr = compiledMetadata.rootBindings?.bindStyleExpr;
                            if (rootStyleExpr) {
                                self._processStyleBinding(itemEl, newItemProxy, rootStyleExpr, index, enrichedContext);
                            }
                            for (const styleBinding of (compiledMetadata.styleBindings || [])) {
                                const targetEl = (elements && styleBinding.index !== undefined)
                                    ? elements[styleBinding.index]
                                    : itemEl;
                                if (targetEl && styleBinding.expression) {
                                    self._processStyleBinding(targetEl, newItemProxy, styleBinding.expression, index, enrichedContext);
                                }
                            }
                        }

                        // Apply attr bindings
                        if (compiledMetadata.attrBindings?.length > 0 || compiledMetadata.rootBindings?.hasBindAttr) {
                            const rootAttrExpr = compiledMetadata.rootBindings?.bindAttrExpr;
                            if (rootAttrExpr) {
                                self._processAttrBinding(itemEl, newItemProxy, rootAttrExpr, index, enrichedContext);
                            }
                            for (const attrBinding of (compiledMetadata.attrBindings || [])) {
                                const targetEl = (elements && attrBinding.index !== undefined)
                                    ? elements[attrBinding.index]
                                    : itemEl;
                                if (targetEl && attrBinding.expression) {
                                    self._processAttrBinding(targetEl, newItemProxy, attrBinding.expression, index, enrichedContext);
                                }
                            }
                        }
                    }
                },
                // === CRITICAL: Handle list length changes ===
                // Called after all operations complete to update class bindings that use list context variables
                // (_first, _last, _index, _length) which change when list length changes
                onComplete: (newArray, oldLength, newLength) => {
                    // Only update if list uses list context variables AND length actually changed
                    // (even same length changes can affect _first/_last if items reordered)
                    if (compiledMetadata?.usesListContextVariables) {
                        // Update class bindings for all items
                        self._updateListContextClassBindings(element, newArray, context);
                    }
                }
            }
        );

        // Store dispose function and mark as initialized
        element._mapArrayInitialized = true;
        element._disposeMapArray = disposeMapArray;
        element._mapArrayItemElements = itemElements;

        // === COMPONENT REFRESH EFFECT ===
        // Single effect that watches component-level deps (e.g., selectedId) and
        // refreshes only the affected binding types on existing items.
        // Per-item effects only register COMPUTED deps (via touchComponentLevel above).
        // Simple state vars are handled here — O(2) key lookup for selection patterns,
        // O(n) lightweight fallback for other patterns. Either way, avoids 1000 full
        // per-item effect re-runs that each rebuild componentState + all bindings.
        if (compiledMetadata && compiledMetadata._componentDeps === undefined) {
            const sampleItem = data?.length > 0 ? data[0] : null;
            compiledMetadata._componentDeps = self._extractComponentDeps(compiledMetadata, sampleItem, instance, sm);
        }
        const compDeps = compiledMetadata?._componentDeps;
        // Hoisted so wrappedDispose below can clean it up when the list is
        // disposed mid-life (not just on component destroy). Otherwise each
        // re-render leaks the previous refresh effect.
        let disposeRefreshEffect = null;
        if (compDeps && compDeps.size > 0 && sm && instance) {
            let isFirstRefresh = true;
            disposeRefreshEffect = sm.createEffect(() => {
                // Read component-level deps to register as dependencies of THIS effect
                for (const dep of compDeps) {
                    if (dep.startsWith('computed:')) {
                        sm._registerComponentDep(dep);
                    } else {
                        try { const _ = instance.state[dep]; } catch (e) { /* ignore */ }
                    }
                }

                // Skip DOM work on first run (items are already rendered by mapArray)
                // But DO capture initial dep values for old/new tracking
                if (isFirstRefresh) {
                    isFirstRefresh = false;
                    if (!element._prevCompDepValues) element._prevCompDepValues = {};
                    for (const dep of compDeps) {
                        if (!dep.startsWith('computed:')) {
                            element._prevCompDepValues[dep] = instance.state[dep];
                        }
                    }
                    return;
                }

                // FAST PATH: For simple component state changes (like selectedId),
                // only update the items whose class actually changes — O(2) not O(n).
                // Track previous dep values to find old + new affected items.
                const children = element.children;
                const dataLen = children.length;
                const classEvals = compiledMetadata?.classEvaluators;

                // Build current component state once
                const componentState = sm.untrack(() => {
                    let cs = { ...(instance?.state || {}) };
                    if (sm?.computed) {
                        for (const key of Object.keys(sm.computed)) {
                            try { cs[key] = sm.evaluateComputed(key); } catch (e) {}
                        }
                    }
                    return cs;
                });

                if (classEvals) {
                    // Helper: evaluate class for a single row and apply diff
                    const refreshRowClass = (row, itemProxy, idx) => {
                        for (const evaluator of classEvals) {
                            const targetEl = evaluator.isRoot ? row :
                                ((row._bindingElements || row._cachedElementsArray)?.[evaluator.index]);
                            if (!targetEl) continue;
                            let classValue = '';
                            try {
                                if (evaluator.evaluator) {
                                    if (evaluator.isSimpleProperty || evaluator.evaluator._isPropertyAccessor) {
                                        const prop = evaluator.expression || evaluator.property;
                                        if (prop && instance?.stateManager?.computed?.[prop]) {
                                            classValue = self._evaluateComputedInListContext(instance, prop, itemProxy, idx, context);
                                        } else {
                                            classValue = evaluator.evaluator(itemProxy);
                                        }
                                    } else if (evaluator.evaluator._usesMergedContext) {
                                        // Build minimal merged context for this one item
                                        const merged = { ...componentState, _index: idx, _length: dataLen, _first: idx === 0, _last: idx === dataLen - 1 };
                                        if (itemProxy) {
                                            const keys = Object.keys(itemProxy);
                                            for (let k = 0; k < keys.length; k++) merged[keys[k]] = itemProxy[keys[k]];
                                        }
                                        classValue = evaluator.evaluator(merged);
                                    } else {
                                        classValue = evaluator.evaluator(itemProxy);
                                    }
                                }
                            } catch (e) { /* keep empty */ }
                            let classNames = [];
                            if (classValue) {
                                if (typeof classValue === 'string') classNames = classValue.split(/\s+/).filter(Boolean);
                                else if (Array.isArray(classValue)) classNames = classValue.filter(Boolean);
                                else if (typeof classValue === 'object') {
                                    for (const k in classValue) { if (classValue[k]) classNames.push(k); }
                                }
                            }
                            const newSet = new Set(classNames);
                            if (targetEl._prevBoundClasses) {
                                for (const cls of targetEl._prevBoundClasses) {
                                    if (!newSet.has(cls)) targetEl.classList.remove(cls);
                                }
                            }
                            for (const cls of classNames) targetEl.classList.add(cls);
                            targetEl._prevBoundClasses = newSet;
                        }
                    };

                    // For each changed dep, find the items that reference the old and new values.
                    // Common pattern: id === selectedId — find rows by key lookup.
                    // General fallback: iterate all items (still faster than per-item effects).
                    let handled = false;

                    // Try key-based O(2) path: if a dep value looks like a key, find old + new rows
                    if (element._mapArrayItemElements) {
                        const itemElements = element._mapArrayItemElements;
                        for (const dep of compDeps) {
                            if (dep.startsWith('computed:')) continue;
                            const newVal = componentState[dep];
                            const oldVal = element._prevCompDepValues?.[dep];

                            // Update tracked prev value
                            if (!element._prevCompDepValues) element._prevCompDepValues = {};
                            element._prevCompDepValues[dep] = newVal;

                            // Find and refresh old selection row (by key)
                            if (oldVal != null) {
                                for (let i = 0; i < dataLen; i++) {
                                    const row = children[i];
                                    if (!row || !row._itemData) continue;
                                    if (row._itemData.id === oldVal || row._itemData[element._keyProp || 'id'] === oldVal) {
                                        refreshRowClass(row, row._itemData, row._listIndex ?? i);
                                        handled = true;
                                        break;
                                    }
                                }
                            }

                            // Find and refresh new selection row (by key)
                            if (newVal != null) {
                                for (let i = 0; i < dataLen; i++) {
                                    const row = children[i];
                                    if (!row || !row._itemData) continue;
                                    if (row._itemData.id === newVal || row._itemData[element._keyProp || 'id'] === newVal) {
                                        refreshRowClass(row, row._itemData, row._listIndex ?? i);
                                        handled = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // Fallback: if key-based lookup didn't work, refresh all items
                    if (!handled) {
                        for (let i = 0; i < dataLen; i++) {
                            const row = children[i];
                            if (!row || row.tagName === 'TEMPLATE') continue;
                            const itemProxy = row._itemData;
                            if (!itemProxy) continue;
                            refreshRowClass(row, itemProxy, row._listIndex ?? i);
                        }
                    }
                }
            });

        }

        // Wrap element._disposeMapArray so it ALSO disposes:
        //   - any nested data-list mapArrays inside this list's subtree
        //     (popover lists, sub-lists, etc.), so they don't leak when a
        //     parent row is removed or a parent list is re-rendered;
        //   - this list's refresh effect (the component-level dep watcher
        //     created above), which previously was only cleaned up on
        //     component destroy.
        //
        // Without these, onItemUpdate's nested-list re-render path
        // (`_disposeMapArray()` + `_renderList()`) would dispose only the
        // structural + per-row item effects of the re-rendered list, leaving
        // every nested popover list's structural + refresh + item effects
        // alive. PM-demo measurement showed ~900 leaked effects per priority
        // change, ballooning subsequent select/deselect latency.
        const baseDisposeMapArray = disposeMapArray;
        const wrappedDispose = () => {
            // Walk descendants for nested mapArrays. querySelectorAll returns
            // document order; each nested dispose nulls its own _disposeMapArray
            // when done, so later iterations that re-encounter an already-
            // disposed inner list skip cleanly.
            if (element.querySelectorAll) {
                const nestedListEls = element.querySelectorAll('[data-list], [data-wf-list]');
                for (let i = 0; i < nestedListEls.length; i++) {
                    const nested = nestedListEls[i];
                    if (nested !== element && nested._disposeMapArray) {
                        try { nested._disposeMapArray(); } catch (e) { /* ignore */ }
                        nested._mapArrayInitialized = false;
                        nested._disposeMapArray = null;
                    }
                }
            }
            if (disposeRefreshEffect) {
                try { disposeRefreshEffect(); } catch (e) { /* ignore */ }
            }
            baseDisposeMapArray();
        };
        element._disposeMapArray = wrappedDispose;

        // Set up event delegation on the container element
        // This allows events to bubble from items to the container
        self._ensureListEventDelegation(element, instance, listPath);

        // Store previous data for compatibility
        element._previousData = data;
        element._previousDataLength = data?.length || 0;

        // Register cleanup on component destroy. Use the wrapped dispose so
        // component teardown also tears down nested data-lists + refresh
        // effects, not just the top-level mapArray.
        if (instance && !instance._mapArrayCleanups) {
            instance._mapArrayCleanups = [];
        }
        if (instance) {
            instance._mapArrayCleanups.push(() => {
                wrappedDispose();
                element._mapArrayInitialized = false;
                element._disposeMapArray = null;
                element._mapArrayItemElements = null;
            });
        }
    },

    /**
     * Check if a list is involved in nesting (either as parent or child)
     * @param {string} listPath - The list path to check
     * @returns {boolean} - True if list has children OR is a child of another list
     */
    // Group lists by component ID for efficient processing
    _groupListsByComponent(listElements)
    {
        const listsByComponent = new Map();

        for (const list of listElements)
        {
            const {componentId} = list;
            if (!listsByComponent.has(componentId))
            {
                listsByComponent.set(componentId, []);
            }
            listsByComponent.get(componentId).push(list);
        }

        return listsByComponent;
    },
    /**
     * Process conditional elements (data-show and data-render)
     * @param {Object} instance - Component instance
     * @private
     */
    _processConditionalElements(instance)
    {
        if (!this._contextSystemInitialized) {
            return;
        }

        const {element} = instance;

        // Find all conditional elements (both data-show and data-render) - support both prefixes
        // IMPORTANT: Exclude elements inside <template> elements (they belong to list templates)
        // and elements inside data-list containers (they're handled by _bindListItemConditionals)
        const allConditionalElements = element.querySelectorAll(`${this._attrSelector('show')}, ${this._attrSelector('render')}`);

        const conditionalElements = Array.from(allConditionalElements)
            .filter(el =>
            {
                const closestComponent = this._getComponentElement(el);
                if (closestComponent !== element) {
                    return false;
                }

                // Also exclude elements inside uninitialized child components
                // (components with data-component but no data-component-id yet)
                const uninitializedParent = el.closest(this._attrSelector('component'));
                if (uninitializedParent && uninitializedParent !== element && !uninitializedParent.dataset.componentId) {
                    return false;
                }

                // Exclude elements inside <template> elements (list templates)
                if (el.closest('template')) {
                    return false;
                }

                // Exclude elements rendered by data-use-template (they have their own binding system)
                if (el.closest('[data-use-template-rendered]')) {
                    return false;
                }

                // Exclude elements INSIDE data-list containers (handled by list item binding)
                // But DO process the list container itself if it has data-show
                const closestList = el.closest(this._attrSelector('list'));
                if (closestList && closestList !== el && closestList.closest(this._attrSelector('component')) === element) {
                    return false;
                }

                return true;
            });

        conditionalElements.forEach(conditionalElement =>
        {
            // Determine mode: 'show' or 'render' (support both prefixes)
            const isRenderMode = this._hasAttr(conditionalElement, 'render');
            const condPath = isRenderMode
                ? this._getAttr(conditionalElement, 'render')
                : this._getAttr(conditionalElement, 'show');
            if (!condPath) return;

            // For data-render, we need to handle initial state
            if (isRenderMode) {
                instance._hasNonListDataRender = true;
                this._processDataRenderElement(conditionalElement, condPath, instance);
            } else {
                // Use the existing helper method for data-show
                this._contextRegistry._createItemLevelContext({
                    element: conditionalElement,
                    contextType: 'conditional',
                    path: condPath,
                    instance,
                    createMethod: this._contextRegistry.createConditionalContext.bind(this._contextRegistry)
                });

                if (instance._effectMeta) {
                    const negate = condPath.startsWith('!');
                    const cleanPath = negate ? condPath.slice(1) : condPath;
                    instance._effectMeta.push({
                        element: conditionalElement,
                        type: 'show',
                        path: cleanPath,
                        negate,
                        isExpression: this.isExpression(cleanPath) || cleanPath.includes('$')
                    });
                }
            }
        });
    },
    /**
     * Process a data-render element - handles initial state and context creation
     * @param {HTMLElement} element - The element with data-render
     * @param {string} path - The condition path
     * @param {Object} instance - Component instance
     * @private
     */
    _processDataRenderElement(element, path, instance)
    {
        // Evaluate the initial condition
        let conditionValue = this._evaluateCondition(path, instance);

        // Clone the element as template before any DOM manipulation
        const templateClone = element.cloneNode(true);
        // Strip data-cloak from template so re-insertions don't inherit it
        templateClone.removeAttribute('data-cloak');

        // Create the context with render mode
        const context = this._contextRegistry.createConditionalContext(
            path,
            instance,
            element,
            null // parent
        );

        if (context) {
            // Add render-specific properties
            context.mode = 'render';
            context.templateClone = templateClone;
            context.isRendered = conditionValue;

            // If condition is initially false, remove element and insert placeholder
            if (!conditionValue) {
                const placeholder = document.createComment(` data-render: ${path} `);
                context.placeholder = placeholder;
                element.parentNode.insertBefore(placeholder, element);
                element.parentNode.removeChild(element);
                context.element = null; // Element is not in DOM
            } else {
                context.placeholder = null; // No placeholder needed when rendered
            }
        }
    },
    /**
     * Evaluate a condition path for data-show/data-render
     * @param {string} path - The condition path (may include negation, computed:)
     * @param {Object} instance - Component instance
     * @returns {boolean} The evaluated condition
     * @private
     */
    _evaluateCondition(path, instance)
    {
        // Strip obsolete computed: prefix (e.g., "computed:isVisible" → "isVisible",
        // "computed:!isVisible" → "!isVisible"). evaluateExpression resolves
        // computed properties by name automatically.
        let expr = path;
        if (expr.startsWith('computed:!')) {
            expr = '!' + expr.slice(10);
        } else if (expr.startsWith('computed:')) {
            expr = expr.slice(9);
        }
        try {
            return !!this.evaluateExpression(expr, instance.state, {
                stateManager: instance.stateManager,
                cacheKey: 'condition'
            });
        } catch (error) {
            return false;
        }
    },

    /**
     * Escape HTML special characters to prevent XSS
     * @param {*} val - Value to escape
     * @returns {string} Escaped string safe for HTML insertion
     */
    // PERF: Pre-compiled regex and lookup map for single-pass HTML escaping
    _escapeHTMLReplaceRegex: /[&<>"']/g,  // Global for replace()
    _escapeHTMLMap: { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' },

    _escapeHTML(val) {
        if (val == null) return '';
        // PERF: Numbers can't contain &<>"' — skip String() and regex entirely
        if (typeof val === 'number') return '' + val;
        const str = typeof val === 'string' ? val : String(val);
        // PERF: charCodeAt loop beats regex for short strings (no engine startup cost)
        // &=38, "=34, '=39, <=60, >=62
        for (let i = 0, len = str.length; i < len; i++) {
            const c = str.charCodeAt(i);
            if (c === 38 || c === 34 || c === 39 || c === 60 || c === 62) {
                return str.replace(this._escapeHTMLReplaceRegex, c => this._escapeHTMLMap[c]);
            }
        }
        return str;
    },

    /**
     * Generate HTML string for multiple rows using pre-compiled template
     * Consolidates the HTML building loop used by _fastInitialRender, _fastAppendRender, _fastBulkReplace
     *
     * @param {Object} instance - Component instance for state/computed access
     * @param {Array} data - Full data array
     * @param {Array} parts - Pre-split template parts
     * @param {Array} accessors - Pre-compiled accessor functions
     * @param {number} startIndex - First item index to render
     * @param {number} endIndex - One past last item index to render
     * @returns {string} HTML string for all rows joined together
     */
    _generateRowsHTML(instance, data, parts, accessors, startIndex, endIndex) {
        // PERF: Keep array.push + join for large N - more memory efficient than string concat
        const htmlParts = [];
        const listLength = data.length;
        const accessorCount = accessors.length;
        const state = instance?.state || {};
        const computed = instance?.stateManager?.computed || {};
        const stateManager = instance?.stateManager;

        // PERF: Classify accessors once before the loop.
        // "simple" accessors read a single flat property from the item — the vast majority.
        // By reading directly from item[path] we bypass the Proxy GET trap entirely
        // (~50-100ns per call × 2 accessors × 10K rows = 1-2ms saved + reduced GC).
        // Only fall back to the Proxy for accessors that need list context vars,
        // component state, or computed properties.
        const needsProxy = accessors.some(a =>
            !a.path || a.path.includes('.') || a.path.startsWith('_') || a.path === '$item' ||
            (a.path in state) || (a.path in computed)
        );

        let mergedContext = null;
        let currentItem = null;
        let currentIndex = 0;

        if (needsProxy) {
            mergedContext = new Proxy({}, {
                get(target, prop) {
                    if (prop === '$item') return currentItem;
                    if (prop === '_index') return currentIndex;
                    if (prop === '_length') return listLength;
                    if (prop === '_first') return currentIndex === 0;
                    if (prop === '_last') return currentIndex === listLength - 1;
                    if (currentItem != null && typeof currentItem === 'object' && prop in currentItem) {
                        return currentItem[prop];
                    }
                    if (prop in state) return state[prop];
                    if (prop in computed && stateManager) {
                        try { return stateManager.evaluateComputed(prop); } catch (e) { return undefined; }
                    }
                    return undefined;
                }
            });
        }

        for (let i = startIndex; i < endIndex; i++) {
            const item = data[i];
            if (!item) continue;

            currentItem = item;
            currentIndex = i;

            let rowHTML = parts[0];

            if (needsProxy) {
                for (let j = 0; j < accessorCount; j++) {
                    let value = accessors[j].accessor(mergedContext);
                    value = this._escapeHTML(value);
                    rowHTML += value + parts[j + 1];
                }
            } else {
                // FAST PATH: All accessors are simple item properties — direct read
                for (let j = 0; j < accessorCount; j++) {
                    let value = item[accessors[j].path];
                    value = this._escapeHTML(value);
                    rowHTML += value + parts[j + 1];
                }
            }

            htmlParts.push(rowHTML);
        }

        return htmlParts.join('');
    },

    /**
     * Create a merged state object with lazy computed property evaluation
     * Uses Proxy to avoid evaluating unused computed properties
     *
     * @param {Object} instance - Component instance (optional)
     * @param {Object} item - List item data (optional)
     * @param {number} itemIndex - Index in list (optional)
     * @param {number} listLength - Total list length (optional)
     * @returns {Proxy} Merged state with lazy computed evaluation
     */
    _getMergedState(instance, item, itemIndex, listLength) {
        const state = instance?.state || {};
        const computed = instance?.stateManager?.computed || {};
        const stateManager = instance?.stateManager;
        const originalComputeds = stateManager?._originalComputedFunctions;
        const hasListContext = typeof itemIndex === 'number';
        const self = this;

        return new Proxy({}, {
            get(target, prop) {
                // 0. Special $item reference - returns the item itself (for primitive lists)
                if (prop === '$item') {
                    return item;
                }

                // 1. List context variables (highest priority in list context)
                if (hasListContext) {
                    if (prop === '_index') return itemIndex;
                    if (prop === '_length') return listLength;
                    if (prop === '_first') return itemIndex === 0;
                    if (prop === '_last') return itemIndex === listLength - 1;
                }

                // 2. Item data (list item properties override component state)
                if (item != null && typeof item === 'object' && prop in item) {
                    return item[prop];
                }

                // 3. Component state
                if (prop in state) {
                    return state[prop];
                }

                // 4. Lazy computed evaluation (only evaluate when accessed)
                if (prop in computed && stateManager) {
                    try {
                        // Item-level computeds (fn(item) with fn.length > 0) need
                        // the current item passed in. evaluateComputed without an
                        // item arg returns undefined for these, so route through
                        // _evaluateComputedInListContext when in list scope.
                        if (item != null && typeof item === 'object' && originalComputeds) {
                            const fn = originalComputeds.get(prop);
                            if (fn && typeof fn === 'function' && fn.length > 0) {
                                return self._evaluateComputedInListContext(
                                    instance, prop, item, itemIndex, null
                                );
                            }
                        }
                        return stateManager.evaluateComputed(prop);
                    } catch (e) {
                        return undefined;
                    }
                }

                return undefined;
            },

            has(target, prop) {
                if (prop === '$item') return true;
                if (hasListContext && (prop === '_index' || prop === '_length' || prop === '_first' || prop === '_last')) {
                    return true;
                }
                if (item != null && typeof item === 'object' && prop in item) return true;
                if (prop in state) return true;
                if (prop in computed) return true;
                return false;
            },

            ownKeys(target) {
                const keys = new Set();
                keys.add('$item');
                if (hasListContext) {
                    keys.add('_index');
                    keys.add('_length');
                    keys.add('_first');
                    keys.add('_last');
                }
                if (item != null && typeof item === 'object') {
                    Object.keys(item).forEach(k => keys.add(k));
                }
                Object.keys(state).forEach(k => keys.add(k));
                Object.keys(computed).forEach(k => keys.add(k));
                return Array.from(keys);
            },

            getOwnPropertyDescriptor(target, prop) {
                if (this.has(target, prop)) {
                    return { enumerable: true, configurable: true, value: this.get(target, prop) };
                }
                return undefined;
            }
        });
    },

    /**
     * Apply class bindings to a single row element using pre-compiled evaluators
     * Consolidated from _fastInitialRender, _fastAppendRender, and _fastBulkReplace
     *
     * @param {Element} row - The row element to apply bindings to
     * @param {Object} item - The data item for this row
     * @param {number} index - The item's index in the data array
     * @param {number} dataLen - Total length of the data array
     * @param {Array} classEvaluators - Pre-compiled class evaluator objects
     * @param {Object} componentState - Component state object
     */
    _applyClassBindingsToRow(row, item, index, dataLen, classEvaluators, componentState, instance, listContext, prebuiltMergedCtx) {
        const elements = row._bindingElements || row._cachedElementsArray;
        let mergedCtx = prebuiltMergedCtx || null;

        // Item-level computeds (fn(item) with fn.length > 0) must be evaluated
        // per item, so they can't be in any cached/prebuilt mergedCtx. They go
        // into mergedCtx so expressions like `{ shared: isShared }` and
        // `isShared ? 'on' : ''` resolve correctly.
        //
        // Skip the eager evaluation entirely when no evaluator on this row
        // needs the merged context — every simple-property class binding
        // (`data-bind-class="rowClass"`) resolves the computed directly via
        // _evaluateComputedInListContext inside the per-evaluator loop below.
        // Eagerly evaluating ALL item-level computeds in that case allocates
        // two Proxies per computed per row per update with the result never
        // read, which was 18% / 28% of main-thread time on the PM-demo
        // profile (2026-05-16). Gate the loop on actual need.
        //
        // CRITICAL: use _evaluateComputedInListContext (not a direct fn.call) so
        // dependency tracking sees the state reads inside the computed. Direct
        // calls bypass the tracking context, breaking reactive updates when the
        // accessed state mutates.
        let needsMergedCtx = !!prebuiltMergedCtx;
        if (!needsMergedCtx) {
            for (let i = 0; i < classEvaluators.length; i++) {
                const ev = classEvaluators[i];
                if (ev.evaluator && ev.evaluator._usesMergedContext) {
                    needsMergedCtx = true;
                    break;
                }
                // Fallback path (no .evaluator, has .expression) also builds mergedCtx
                if (!ev.evaluator && ev.expression) {
                    needsMergedCtx = true;
                    break;
                }
            }
        }
        const originalComputeds = needsMergedCtx ? instance?.stateManager?._originalComputedFunctions : null;
        let itemComputedValues = null;
        if (originalComputeds) {
            for (const [key, fn] of originalComputeds) {
                if (typeof fn === 'function' && fn.length > 0) {
                    if (!itemComputedValues) itemComputedValues = {};
                    try {
                        itemComputedValues[key] = this._evaluateComputedInListContext(
                            instance, key, item, index, listContext
                        );
                    } catch (e) {
                        itemComputedValues[key] = undefined;
                    }
                }
            }
        }
        if (itemComputedValues) {
            if (!mergedCtx) {
                // Build mergedCtx from item + componentState + list-context vars,
                // then add the item-level computed values we already computed above.
                mergedCtx = {
                    ...item,
                    ...componentState,
                    _index: index,
                    _length: dataLen,
                    _first: index === 0,
                    _last: index === dataLen - 1
                };
            }
            Object.assign(mergedCtx, itemComputedValues);
        }
        for (const evaluator of classEvaluators) {
            let targetEl;

            if (evaluator.isRoot) {
                targetEl = row;
            } else if (elements && evaluator.index !== undefined) {
                targetEl = elements[evaluator.index];
            } else if (evaluator.elementPath && evaluator.elementPath.length > 0) {
                targetEl = row;
                for (const idx of evaluator.elementPath) {
                    if (!targetEl || !targetEl.children) break;
                    targetEl = targetEl.children[idx];
                }
            }

            if (!targetEl) continue;

            let classValue;
            try {
                if (evaluator.evaluator) {
                    if (evaluator.isSimpleProperty || evaluator.evaluator._isPropertyAccessor) {
                        // Check for implicit computed property
                        const prop = evaluator.expression || evaluator.property;
                        if (prop && instance?.stateManager?.computed?.[prop]) {
                            classValue = this._evaluateComputedInListContext(instance, prop, item, index, listContext);
                        } else {
                            classValue = evaluator.evaluator(item);
                        }
                    } else if (evaluator.evaluator._usesMergedContext) {
                        if (!mergedCtx) {
                            mergedCtx = this._buildClassMergedCtx(item, componentState, instance, index, dataLen);
                        }
                        classValue = evaluator.evaluator(mergedCtx);
                    } else {
                        classValue = evaluator.evaluator(item);
                    }
                } else if (evaluator.expression) {
                    // Fallback: evaluate expression with item context
                    if (!mergedCtx) {
                        mergedCtx = this._buildClassMergedCtx(item, componentState, instance, index, dataLen);
                    }
                    try {
                        if (this._useCSPSafeEvaluation) {
                            // CSP-safe fallback: use AST evaluator
                            const fallbackEval = getCSPSafeMergedContextEvaluator(
                                evaluator.expression,
                                Object.keys(mergedCtx),
                                this._astCache,
                                'class-fallback'
                            );
                            classValue = fallbackEval ? fallbackEval(mergedCtx) : '';
                        } else {
                            // Standard fallback: destructured args (no 'with' statement)
                            // Cache compiled function to avoid repeated new Function() creation
                            const keys = Object.keys(mergedCtx);
                            const cacheKey = `class-fallback::${evaluator.expression}::${keys.join(',')}`;
                            let fn = this._expressionEvaluator && this._expressionEvaluator.get(cacheKey);
                            if (!fn && !_UNSAFE_EXPR_RE.test(evaluator.expression)) {
                                fn = new Function(...keys, `"use strict"; return ${evaluator.expression}`);
                                if (this._expressionEvaluator) this._expressionEvaluator.set(cacheKey, fn);
                            }
                            classValue = fn(...keys.map(k => mergedCtx[k]));
                        }
                    } catch (innerErr) {
                        classValue = '';
                    }
                }
            } catch (e) {
                classValue = '';
            }

            // Targeted rebind: skip DOM class manipulation for non-matching evaluators.
            // Bypass when the evaluator references a registered computed by name —
            // the computed body may read the changed prop transitively.
            if (this._targetedProp) {
                const expr = evaluator.expression || evaluator.property || '';
                if (expr && !expr.includes(this._targetedProp)
                    && !this._evaluatorRefsComputed(evaluator, instance)) continue;
            }

            // Apply class (add to existing static classes, don't replace them).
            // NOTE: this path is intentionally additive — a "diff and remove
            // dropped keys" version was attempted and broke 14 tests because
            // _executeClassBindings also writes to _prevBoundClasses for the
            // same element. Class drop-out semantics are owned by
            // _executeClassBindings, which uses _toggleBoundClass correctly.
            if (classValue) {
                let classNames;
                if (Array.isArray(classValue)) {
                    classNames = classValue.filter(c => c && typeof c === 'string');
                } else if (typeof classValue === 'object' && classValue !== null) {
                    classNames = [];
                    for (const key in classValue) {
                        if (classValue[key]) classNames.push(key);
                    }
                } else {
                    classNames = String(classValue).split(/\s+/).filter(c => c);
                }

                if (classNames.length > 0) {
                    targetEl.classList.add(...classNames);
                }
                // CRITICAL: Initialize _prevBoundClasses for _toggleBoundClass tracking
                targetEl._prevBoundClasses = new Set(classNames);
            }
        }
    },

    /**
     * Build the merged context object for class-binding expression evaluation.
     *
     * Includes: item properties, component state, list-context vars, AND
     * item-level computed VALUES (computeds defined as `fn(item) { ... }` with
     * fn.length > 0 — called once per row with the current item).
     *
     * Without item-level computeds in the merged context, expressions like
     * `{ shared: isShared }` and `isShared ? 'on' : ''` see `isShared` as
     * undefined because component-level state spread doesn't include them
     * (they require an item argument).
     *
     * @private
     */
    _buildClassMergedCtx(item, componentState, instance, index, dataLen) {
        const ctx = {
            ...item,
            ...componentState,
            _index: index,
            _length: dataLen,
            _first: index === 0,
            _last: index === dataLen - 1
        };
        // Item-level computeds (both parameterised fn(item) and bare-form fn()
        // reading `this.X`): use _evaluateComputedInListContext so dependency
        // tracking sees the state reads (direct fn.call bypasses tracking and
        // breaks reactive updates). Override the stale value the componentState
        // spread placed in ctx for bare-form computeds (component-level eval
        // produces wrong value when the body reads item state via `this.X`).
        // Item own-properties win — if item has a key matching a computed name,
        // keep the item value.
        const originals = instance?.stateManager?._originalComputedFunctions;
        if (originals) {
            for (const [key, fn] of originals) {
                if (typeof fn === 'function' && !(key in item)) {
                    try {
                        ctx[key] = this._evaluateComputedInListContext(instance, key, item, index, null);
                    } catch (e) {
                        ctx[key] = undefined;
                    }
                }
            }
        }
        return ctx;
    },

    /**
     * Fast-path style binding using pre-compiled evaluators.
     * Bypasses evaluateExpression → _processObjectBinding → _applyObjectBinding chain.
     */
    _applyStyleBindingsToRow(row, item, index, dataLen, styleEvaluators, componentState, instance, listContext, prebuiltMergedCtx) {
        const elements = row._bindingElements || row._cachedElementsArray;
        // PERF: Reusable lazy proxy — avoids spreading item + componentState per evaluator.
        // Destructuring `const {x, y} = ctx` only calls GET for needed properties (no ownKeys).
        // V8 proxy spread ({...proxy}) triggers ownKeys + ALL property GETs — extremely slow.
        let lazyCtx = prebuiltMergedCtx || null;
        if (!lazyCtx) {
            const _idx = index, _len = dataLen;
            // Item-level computeds (both parameterized fn(item) and bare-form fn()
            // using `this.X`) need per-item evaluation. componentState resolves
            // bare-form at the component level, which produces a stale (often
            // wrong) value because `this.X` reads off the component context.
            // Always route through _evaluateComputedInListContext when the name
            // is a registered computed.
            const origComputeds = instance?.stateManager?._originalComputedFunctions;
            const self = this;
            lazyCtx = new Proxy(item, {
                get(target, prop) {
                    if (prop === '_index') return _idx;
                    if (prop === '_length') return _len;
                    if (prop === '_first') return _idx === 0;
                    if (prop === '_last') return _idx === _len - 1;
                    const val = target[prop];
                    if (val !== undefined) return val;
                    if (origComputeds) {
                        const fn = origComputeds.get(prop);
                        if (fn && typeof fn === 'function') {
                            try {
                                return self._evaluateComputedInListContext(instance, prop, item, _idx, listContext);
                            } catch (e) { return undefined; }
                        }
                    }
                    if (componentState && prop in componentState) return componentState[prop];
                    return undefined;
                }
            });
        }
        for (const evaluator of styleEvaluators) {
            let targetEl;
            if (evaluator.isRoot) { targetEl = row; }
            else if (elements && evaluator.index !== undefined) { targetEl = elements[evaluator.index]; }
            else if (evaluator.elementPath?.length > 0) {
                targetEl = row;
                for (const idx of evaluator.elementPath) {
                    if (!targetEl?.children) break;
                    targetEl = targetEl.children[idx];
                }
            }
            if (!targetEl) continue;
            let resultObject;
            try {
                if (evaluator.isComputed && evaluator.computedName && instance) {
                    resultObject = this._evaluateComputedInListContext(instance, evaluator.computedName, item, index, listContext);
                } else if (evaluator.evaluator) {
                    resultObject = evaluator.evaluator(lazyCtx);
                } else if (evaluator.expression) {
                    this._processStyleBinding(targetEl, item, evaluator.expression, index, listContext);
                    continue;
                }
            } catch (e) { continue; }
            // Targeted rebind: skip DOM style manipulation for non-matching evaluators.
            // Bypass when the evaluator references a registered computed by name —
            // the computed body may read the changed prop transitively.
            if (this._targetedProp && evaluator.expression
                && !evaluator.expression.includes(this._targetedProp)
                && !this._evaluatorRefsComputed(evaluator, instance)) continue;

            if (resultObject && typeof resultObject === 'object') {
                const style = targetEl.style;
                // Clear previously-bound keys that aren't in the new object
                // (otherwise an `assigneeStyle` returning `{}` after unassign
                // leaves the prior background:color on the element).
                const prev = targetEl._boundStyleProps;
                if (prev && prev.size > 0) {
                    for (const prevProp of prev) {
                        if (Object.prototype.hasOwnProperty.call(resultObject, prevProp)) continue;
                        if (prevProp.startsWith('--')) style.removeProperty(prevProp);
                        else style[prevProp] = '';
                        prev.delete(prevProp);
                    }
                }
                for (const prop in resultObject) {
                    const val = resultObject[prop];
                    style[prop] = (val === null || val === undefined) ? '' : val;
                }
                if (!targetEl._boundStyleProps) targetEl._boundStyleProps = new Set();
                for (const k in resultObject) targetEl._boundStyleProps.add(k);
            }
        }
    },

    /**
     * Whether the component instance has ANY registered computed properties.
     * Used to fast-path past the binding-reactivity bypass logic for
     * components that declare no computeds — every per-binding
     * `computeds[name]` lookup would miss, so the bypass can be skipped
     * entirely.
     *
     * Checked live (no cache) because caching breaks if a computed is
     * registered AFTER the first list-binding evaluation queries the
     * cache — the stale `false` would make all subsequent bypass checks
     * silently skip computed-name bindings, producing partial updates
     * (style updates but class/text don't).
     * @private
     */
    _instanceHasComputeds(instance) {
        const c = instance?.stateManager?.computed;
        if (!c) return false;
        for (const _k in c) return true;
        return false;
    },

    /**
     * Decide whether a list-binding evaluator's expression depends on any
     * registered computed by name. Cached per-evaluator. Used to bypass the
     * targeted-rebind path-equality filter for bindings whose value comes
     * from a computed — the computed's body may read the changed prop
     * transitively.
     * @private
     */
    _evaluatorRefsComputed(evaluator, instance) {
        if (evaluator._computedRefsCache !== undefined) return evaluator._computedRefsCache;
        if (!this._instanceHasComputeds(instance)) {
            evaluator._computedRefsCache = false;
            return false;
        }
        const computed = instance.stateManager.computed;
        let found = false;
        if (evaluator.expression) {
            if (evaluator.isComputed && evaluator.computedName && computed[evaluator.computedName]) {
                found = true;
            } else {
                const matches = evaluator.expression.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g);
                if (matches) {
                    for (let i = 0; i < matches.length; i++) {
                        if (computed[matches[i]]) { found = true; break; }
                    }
                }
            }
        }
        evaluator._computedRefsCache = found;
        return found;
    },

    /**
     * Fast-path attr binding using pre-compiled evaluators.
     */
    _applyAttrBindingsToRow(row, item, index, dataLen, attrEvaluators, componentState, instance, listContext, prebuiltMergedCtx) {
        const elements = row._bindingElements || row._cachedElementsArray;
        // PERF: Same lazy proxy pattern as _applyStyleBindingsToRow
        let lazyCtx = prebuiltMergedCtx || null;
        if (!lazyCtx) {
            const _idx = index, _len = dataLen;
            const origComputeds = instance?.stateManager?._originalComputedFunctions;
            const self = this;
            lazyCtx = new Proxy(item, {
                get(target, prop) {
                    if (prop === '_index') return _idx;
                    if (prop === '_length') return _len;
                    if (prop === '_first') return _idx === 0;
                    if (prop === '_last') return _idx === _len - 1;
                    const val = target[prop];
                    if (val !== undefined) return val;
                    if (origComputeds) {
                        const fn = origComputeds.get(prop);
                        // Match _applyStyleBindingsToRow: route both parameterized
                        // and bare-form item-level computeds through list-context
                        // evaluation so `this.X` resolves to item state.
                        if (fn && typeof fn === 'function') {
                            try {
                                return self._evaluateComputedInListContext(instance, prop, item, _idx, listContext);
                            } catch (e) { return undefined; }
                        }
                    }
                    if (componentState && prop in componentState) return componentState[prop];
                    return undefined;
                }
            });
        }
        for (const evaluator of attrEvaluators) {
            let targetEl;
            if (evaluator.isRoot) { targetEl = row; }
            else if (elements && evaluator.index !== undefined) { targetEl = elements[evaluator.index]; }
            else if (evaluator.elementPath?.length > 0) {
                targetEl = row;
                for (const idx of evaluator.elementPath) {
                    if (!targetEl?.children) break;
                    targetEl = targetEl.children[idx];
                }
            }
            if (!targetEl) continue;
            let resultObject;
            try {
                if (evaluator.isComputed && evaluator.computedName && instance) {
                    resultObject = this._evaluateComputedInListContext(instance, evaluator.computedName, item, index, listContext);
                } else if (evaluator.evaluator) {
                    resultObject = evaluator.evaluator(lazyCtx);
                } else if (evaluator.expression) {
                    this._processAttrBinding(targetEl, item, evaluator.expression, index, listContext);
                    continue;
                }
            } catch (e) { continue; }
            // Targeted rebind: skip DOM attr manipulation for non-matching evaluators.
            // Bypass when the evaluator references a registered computed by name —
            // the computed body may read the changed prop transitively.
            if (this._targetedProp && evaluator.expression
                && !evaluator.expression.includes(this._targetedProp)
                && !this._evaluatorRefsComputed(evaluator, instance)) continue;

            if (resultObject && typeof resultObject === 'object') {
                // Clear previously-bound attrs that aren't in the new object
                // (matches the parallel fix in _applyStyleBindingsToRow).
                const prev = targetEl._boundAttrProps;
                if (prev && prev.size > 0) {
                    for (const prevAttr of prev) {
                        if (Object.prototype.hasOwnProperty.call(resultObject, prevAttr)) continue;
                        if (targetEl.hasAttribute(prevAttr)) targetEl.removeAttribute(prevAttr);
                        prev.delete(prevAttr);
                    }
                }
                for (const attr in resultObject) {
                    if (this._isBlocklistedAttr(attr)) continue;
                    const val = resultObject[attr];
                    if (val === null || val === undefined || val === false) {
                        targetEl.removeAttribute(attr);
                    } else {
                        const sanitized = this._sanitizeAttrValue(attr, val);
                        if (sanitized === null) continue;
                        targetEl.setAttribute(attr, String(sanitized));
                    }
                }
                if (!targetEl._boundAttrProps) targetEl._boundAttrProps = new Set();
                for (const k in resultObject) targetEl._boundAttrProps.add(k);
            }
        }
    },

    /**
     * Extract component-level dependency paths from compiled metadata.
     * Called once per template, result cached on compiledMetadata._componentDeps.
     * Identifies variables that are NOT on the item but ARE in component state,
     * so deferred effects (skipFirstRun) can register them for change notification.
     * @param {Object} compiledMetadata - Pre-compiled template binding metadata
     * @param {Object} sampleItem - A sample item proxy to check which vars are item-level
     * @param {Object} instance - Component instance (for state access)
     * @param {Object} sm - ReactiveStateManager instance (for computed property lookup)
     * @returns {Set|null} Set of dependency paths, or null if none found
     * @private
     */
    _extractComponentDeps(compiledMetadata, sampleItem, instance, sm) {
        if (!compiledMetadata || !instance?.state) return null;
        const deps = new Set();
        const reservedWords = this._expressionReservedWords;

        const addVar = (v) => {
            if (!v || typeof v !== 'string') return;
            if (v.indexOf('.') !== -1) return;           // Only simple names
            if (v.startsWith('_') || v.startsWith('computed:') || v.startsWith('props:')) return;
            if (v.startsWith('!')) v = v.slice(1);
            if (!v) return;
            if (reservedWords?.has(v)) return;
            if (sampleItem && typeof sampleItem === 'object' && v in sampleItem) return;   // Item-level, not component
            // Use computed: prefix for computed properties to match notification path
            if (sm?.computed?.[v]) {
                deps.add('computed:' + v);
            } else if (v in instance.state) {
                deps.add(v);
            }
        };

        const addExprVars = (expr, preExtracted) => {
            const vars = preExtracted || (expr?.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || []);
            for (const v of vars) addVar(v);
        };

        // Same iteration as _extractStaticItemProps — all binding types
        for (const b of (compiledMetadata.bindings || [])) {
            if (b.isExpression && b.expressionVars) addExprVars(null, b.expressionVars);
            else if (!b.isExpression && !b.isListContextVar && !b.isPropsPath && !b.isComputed) addVar(b.path);
        }
        for (const cb of (compiledMetadata.classBindings || [])) {
            if (cb.isComputed && cb.expression) {
                const name = cb.expression.startsWith('computed:') ? cb.expression.slice(9) : cb.expression;
                if (sm?.computed?.[name]) deps.add('computed:' + name);
            } else if (cb.expression) addExprVars(cb.expression, null);
        }
        for (const sb of (compiledMetadata.styleBindings || [])) { if (sb.expression) addExprVars(sb.expression, null); }
        if (compiledMetadata.rootBindings?.bindStyleExpr) addExprVars(compiledMetadata.rootBindings.bindStyleExpr, null);
        for (const ab of (compiledMetadata.attrBindings || [])) { if (ab.expression) addExprVars(ab.expression, null); }
        if (compiledMetadata.rootBindings?.bindAttrExpr) addExprVars(compiledMetadata.rootBindings.bindAttrExpr, null);
        for (const sh of (compiledMetadata.shows || [])) addVar(sh.path);
        for (const hb of (compiledMetadata.htmlBindings || [])) addVar(hb.path);
        for (const rb of (compiledMetadata.renders || [])) {
            if (rb.isExpression && rb.expressionVars) addExprVars(null, rb.expressionVars);
            else addVar(rb.path);
        }
        if (compiledMetadata.rootBindings) {
            if (compiledMetadata.rootBindings.bindPath) addVar(compiledMetadata.rootBindings.bindPath);
            if (compiledMetadata.rootBindings.showPath) addVar(compiledMetadata.rootBindings.showPath);
            if (compiledMetadata.rootBindings.bindClassExpr) {
                const expr = compiledMetadata.rootBindings.bindClassExpr;
                if (expr.startsWith('computed:')) {
                    const name = expr.slice(9);
                    if (sm?.computed?.[name]) deps.add('computed:' + name);
                } else addExprVars(expr, null);
            }
        }

        // Also include _computedsWithExternalDeps (store-backed computeds that need per-item refresh)
        if (sm?._computedsWithExternalDeps) {
            for (const extComputed of sm._computedsWithExternalDeps) {
                deps.add('computed:' + extComputed);
            }
        }

        return deps.size > 0 ? deps : null;
    },

    /**
     * Extract item dependency property names from compiled metadata.
     * Called once per template, result cached on compiledMetadata._staticItemProps.
     * Returns null if template has computed class bindings (can't statically resolve deps).
     * @private
     */
    _extractStaticItemProps(compiledMetadata, instance) {
        const props = new Set();
        const reservedWords = this._expressionReservedWords;
        // Item-level computed names whose transitive deps can't be statically resolved.
        // If any binding expression references one, we must bail to the full first-run
        // path so reads inside the computed register against the per-item effect.
        // Only parameterised (fn.length > 0) qualifies — zero-arg computeds are
        // component-level and tracked by the component refresh effect, not per-item.
        const itemLevelComputedNames = new Set();
        const _origComputeds = instance?.stateManager?._originalComputedFunctions;
        if (_origComputeds) {
            for (const [name, fn] of _origComputeds) {
                if (typeof fn === 'function' && fn.length > 0) itemLevelComputedNames.add(name);
            }
        }

        const addPath = (path) => {
            if (!path || typeof path !== 'string') return;
            if (path.startsWith('_') || path.startsWith('computed:') || path.startsWith('props:')) return;
            if (path.startsWith('!')) path = path.slice(1);
            if (!path) return;
            // For nested paths like "user.name", add both "user" and "user.name"
            // to match what proxy traversal would register
            if (path.indexOf('.') !== -1) {
                const parts = path.split('.');
                let prefix = '';
                for (let i = 0; i < parts.length; i++) {
                    prefix = prefix ? prefix + '.' + parts[i] : parts[i];
                    props.add(prefix);
                }
            } else {
                props.add(path);
            }
        };

        const addExpressionVars = (expr, preExtractedVars) => {
            if (preExtractedVars) {
                for (const v of preExtractedVars) {
                    addPath(v);
                }
            } else if (expr && typeof expr === 'string') {
                const stripped = expr.replace(/'[^']*'|"[^"]*"/g, '');
                const vars = stripped.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
                for (const v of vars) {
                    if (!v.startsWith('_') && (!reservedWords || !reservedWords.has(v))) {
                        addPath(v);
                    }
                }
            }
        };

        // Helper: bail when an expression's identifiers reference an item-level
        // computed. Such bindings need the first-run dep-registration path to
        // run the computed body and register its transitive state reads.
        const exprRefsItemLevelComputed = (expression, expressionVars) => {
            if (itemLevelComputedNames.size === 0) return false;
            if (expressionVars) {
                for (const v of expressionVars) {
                    if (itemLevelComputedNames.has(v)) return true;
                }
                return false;
            }
            if (!expression || typeof expression !== 'string') return false;
            const stripped = expression.replace(/'[^']*'|"[^"]*"/g, '');
            const vars = stripped.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
            for (const v of vars) {
                if (itemLevelComputedNames.has(v)) return true;
            }
            return false;
        };

        // Bindings
        for (const binding of (compiledMetadata.bindings || [])) {
            if (binding.isExpression && binding.expressionVars) {
                if (exprRefsItemLevelComputed(null, binding.expressionVars)) return null;
                addExpressionVars(null, binding.expressionVars);
            } else if (!binding.isExpression && !binding.isListContextVar && !binding.isPropsPath && !binding.isComputed) {
                if (itemLevelComputedNames.has(binding.path)) return null;
                addPath(binding.path);
            }
        }

        // Class bindings — bail out if any are computed (can't statically resolve)
        for (const classBinding of (compiledMetadata.classBindings || [])) {
            if (classBinding.isComputed) {
                return null; // Bail — fall back to touchPath first run
            } else if (classBinding.isSimpleProperty && classBinding.expression) {
                addPath(classBinding.expression);
                // Item-level computed referenced as a bare property — transitive deps
                // (state reads inside the computed) need first-run registration.
                if (itemLevelComputedNames.has(classBinding.expression)) return null;
            } else if (classBinding.expression) {
                // If the expression references any item-level computed, the per-item
                // effect's transitive deps can only be discovered by evaluating the
                // computed with the actual item — which only happens on first-run.
                if (classBinding.expressionVars) {
                    for (const v of classBinding.expressionVars) {
                        if (itemLevelComputedNames.has(v)) return null;
                    }
                }
                addExpressionVars(classBinding.expression, null);
            }
        }

        // Style bindings
        for (const styleBinding of (compiledMetadata.styleBindings || [])) {
            if (styleBinding.expression) {
                if (exprRefsItemLevelComputed(styleBinding.expression, styleBinding.expressionVars)) return null;
                addExpressionVars(styleBinding.expression, null);
            }
        }
        if (compiledMetadata.rootBindings?.bindStyleExpr) {
            const rootExpr = compiledMetadata.rootBindings.bindStyleExpr;
            if (exprRefsItemLevelComputed(rootExpr, null)) return null;
            addExpressionVars(rootExpr, null);
        }

        // Attr bindings
        for (const attrBinding of (compiledMetadata.attrBindings || [])) {
            if (attrBinding.expression) {
                if (exprRefsItemLevelComputed(attrBinding.expression, attrBinding.expressionVars)) return null;
                addExpressionVars(attrBinding.expression, null);
            }
        }
        if (compiledMetadata.rootBindings?.bindAttrExpr) {
            const rootExpr = compiledMetadata.rootBindings.bindAttrExpr;
            if (exprRefsItemLevelComputed(rootExpr, null)) return null;
            addExpressionVars(rootExpr, null);
        }

        // Model bindings
        for (const modelBinding of (compiledMetadata.models || [])) {
            addPath(modelBinding.path);
        }

        // Show bindings
        for (const showBinding of (compiledMetadata.shows || [])) {
            if (showBinding.isExpression && showBinding.expressionVars) {
                if (exprRefsItemLevelComputed(null, showBinding.expressionVars)) return null;
                addExpressionVars(null, showBinding.expressionVars);
            } else {
                if (itemLevelComputedNames.has(showBinding.path)) return null;
                addPath(showBinding.path);
            }
        }

        // HTML bindings
        for (const htmlBinding of (compiledMetadata.htmlBindings || [])) {
            if (itemLevelComputedNames.has(htmlBinding.path)) return null;
            addPath(htmlBinding.path);
        }

        // Render bindings — same bail-out as shows/binds: an item-level computed
        // referenced in a render expression needs first-run evaluation so its
        // sibling-state reads register against the per-item effect.
        for (const renderBinding of (compiledMetadata.renders || [])) {
            if (renderBinding.isExpression && renderBinding.expressionVars) {
                if (exprRefsItemLevelComputed(null, renderBinding.expressionVars)) return null;
                addExpressionVars(null, renderBinding.expressionVars);
            } else if (renderBinding.path) {
                if (itemLevelComputedNames.has(renderBinding.path)) return null;
                addPath(renderBinding.path);
            }
        }

        // Root bindings
        if (compiledMetadata.rootBindings) {
            if (compiledMetadata.rootBindings.bindPath) addPath(compiledMetadata.rootBindings.bindPath);
            if (compiledMetadata.rootBindings.showPath) addPath(compiledMetadata.rootBindings.showPath);
            if (compiledMetadata.rootBindings.modelPath) addPath(compiledMetadata.rootBindings.modelPath);
            if (compiledMetadata.rootBindings.bindClassExpr) {
                const rootExpr = compiledMetadata.rootBindings.bindClassExpr;
                if (rootExpr.startsWith('computed:')) {
                    return null; // Bail — computed class on root, can't statically resolve
                }
                addExpressionVars(rootExpr, null);
            }
        }

        return props.size > 0 ? props : null;
    },

    /**
     * Get the external() function bound to a component instance
     * @private
     */
    _getExternalFn(componentInstance) {
        if (componentInstance.context && typeof componentInstance.context.external === 'function') {
            return componentInstance.context.external.bind(componentInstance.context);
        }
        const self = this;
        const instanceId = componentInstance.id;
        return function(componentNameOrId, path) {
            return self._resolveExternalValue(componentNameOrId, path, instanceId);
        };
    },

    /**
     * Apply integration bindings to a list item element.
     * Shared by both per-item mapFn and bulk onBulkCreate paths.
     */
    _applyListItemIntegrations(itemEl, instance, listPath, index, itemProxy, element, context,
        hasConditionals, hasChildLists, hasPortals) {

        // Conditionals (data-show and data-render)
        if (hasConditionals) {
            this._bindListItemConditionals(itemEl, instance, listPath, index, itemProxy, element, context);
        }

        // Nested lists
        if (hasChildLists) {
            this._processNestedListsForItem(itemEl, itemProxy, index, context, instance);
        }

        // Custom directives (e.g. data-directive="highlight")
        if (this._processCustomDirectives && this._customDirectives && this._customDirectives.size > 0) {
            this._processCustomDirectives(itemEl, instance);
            if (!this._customDirectivesSelector) {
                const dirNames = Array.from(this._customDirectives.keys());
                this._customDirectivesSelector = dirNames
                    .map(name => `[data-${name}]`)
                    .join(',');
            }
            if (this._customDirectivesSelector) {
                const descendants = itemEl.querySelectorAll(this._customDirectivesSelector);
                for (const descendant of descendants) {
                    if (!descendant.hasAttribute('data-component') && !descendant.hasAttribute('data-wf-component')) {
                        this._processCustomDirectives(descendant, instance);
                    }
                }
            }
        }

        // Portals
        if (hasPortals && this._processPortalsInListItems) {
            this._processPortalsInListItems({ element: itemEl, instance, context });
        }
    },

    /**
     * Process polymorphic templates for standalone components (data-template-key on component element).
     * Indexes all <template data-type="X"> children, renders the initial match, and sets up
     * a watcher to swap templates when the state property changes.
     *
     * @param {Object} instance - Component instance
     * @private
     */
    _processPolymorphicTemplates(instance) {
        const element = instance.element;
        if (!element) return;

        const templateKeyProp = this._getAttr(element, 'template-key');
        if (!templateKeyProp) return;

        // Index all <template> children by data-type
        const templatesByType = new Map();
        let defaultTemplate = null;
        const allTemplates = element.querySelectorAll(':scope > template');

        if (allTemplates.length === 0) {
            if (__DEV__) console.warn(`[polymorphic] No templates found for data-template-key="${templateKeyProp}"`);
            return;
        }

        for (const tmpl of allTemplates) {
            const typeValue = this._getAttr(tmpl, 'type');
            if (typeValue) {
                templatesByType.set(typeValue, tmpl);
            } else {
                defaultTemplate = tmpl;
            }
        }

        // Before removing templates, capture insertion reference for non-template content preservation
        const insertionRef = allTemplates[allTemplates.length - 1].nextSibling; // null if templates were last children

        // Remove all templates from DOM (they're source material, not rendered content)
        allTemplates.forEach(t => t.remove());

        // Store maps on element
        element._polyTemplatesByType = templatesByType;
        element._polyDefaultTemplate = defaultTemplate;
        element._polyTemplateKeyProp = templateKeyProp;
        element._polyCurrentType = null;
        element._polyInsertBeforeRef = insertionRef;
        element._polyGeneratedNodes = [];

        // Render initial template — uses _resolveComponentValue for computed-first resolution
        const initialValue = this._resolveComponentValue(templateKeyProp, instance);
        const typeStr = String(initialValue ?? '');
        this._swapPolymorphicTemplate(instance, typeStr);

        // Watch for changes via the reactive state proxy's watcher system
        instance._watcherHandlers = instance._watcherHandlers || new Map();
        const self = this;
        const watchHandler = function(newVal) {
            const newType = String(newVal ?? '');
            self._swapPolymorphicTemplate(instance, newType);
        };
        instance._watcherHandlers.set(templateKeyProp, watchHandler);
    },

    /**
     * Swap the rendered polymorphic template in a standalone component.
     *
     * @param {Object} instance - Component instance
     * @param {string} newType - The new type value to match against template data-type attributes
     * @private
     */
    _swapPolymorphicTemplate(instance, newType) {
        const element = instance.element;
        if (!element) return;

        const templatesByType = element._polyTemplatesByType;
        const defaultTemplate = element._polyDefaultTemplate;
        const currentType = element._polyCurrentType;

        // Skip if same type
        if (currentType === newType) return;

        // Find matching template
        let matchedTemplate = templatesByType?.get(newType) || null;
        if (!matchedTemplate && defaultTemplate) {
            matchedTemplate = defaultTemplate;
        }
        if (!matchedTemplate) {
            if (__DEV__) console.warn(`[polymorphic] No template for type "${newType}" and no default`);
            // Clean up current content
            if (currentType !== null) {
                this._cleanPolymorphicContent(instance);
            }
            element._polyCurrentType = newType;
            return;
        }

        // Clean up current content if present
        if (currentType !== null) {
            this._cleanPolymorphicContent(instance);
        }

        // Clone new template content
        const content = matchedTemplate.content
            ? matchedTemplate.content.cloneNode(true)
            : matchedTemplate.cloneNode(true);

        // Capture top-level nodes before insertion disperses the fragment
        const generatedNodes = [...content.childNodes];

        // Insert at the original template position, preserving non-template content
        const ref = element._polyInsertBeforeRef;
        if (ref && ref.parentNode === element) {
            element.insertBefore(content, ref);
        } else {
            element.appendChild(content);
        }

        element._polyGeneratedNodes = generatedNodes;

        // Update tracking
        element._polyCurrentType = newType;

        // Re-process bindings and actions on the new content
        // On swap (currentType !== null): must re-bind since old content was removed
        // On initial render (currentType === null): bindings handled by lifecycle after this call
        if (currentType !== null) {
            this._processComponentBindings(instance);
            this._bindComponentActions(instance);
        }

        // Always scan for nested components — on initial render the async scan phase
        // already completed before this template content was inserted into the DOM
        if (this.scan) {
            this.scan(element);
        }
    },

    /**
     * Clean up polymorphic template content before swapping.
     * Destroys nested components, removes child nodes.
     *
     * @param {Object} instance - Component instance
     * @private
     */
    _cleanPolymorphicContent(instance) {
        const element = instance.element;
        if (!element) return;

        const generatedNodes = element._polyGeneratedNodes;

        if (generatedNodes && generatedNodes.length > 0) {
            // Remove only template-generated nodes, preserving non-template content
            for (const node of generatedNodes) {
                if (node.nodeType === 1) {
                    // Destroy nested components within this node
                    if (node.dataset?.componentId) {
                        this.destroyComponent(node.dataset.componentId);
                    }
                    const nested = node.querySelectorAll('[data-component-id]');
                    for (const compEl of nested) {
                        if (compEl.dataset.componentId) {
                            this.destroyComponent(compEl.dataset.componentId);
                        }
                    }
                }
                if (node.parentNode === element) {
                    element.removeChild(node);
                }
            }
            element._polyGeneratedNodes = [];
        } else {
            // Fallback: no tracked nodes
            const nestedComponents = element.querySelectorAll('[data-component-id]');
            for (const compEl of nestedComponents) {
                const compId = compEl.dataset.componentId;
                if (compId) {
                    this.destroyComponent(compId);
                }
            }
            while (element.firstChild) {
                element.removeChild(element.firstChild);
            }
        }
    },

    // ========================================================================
    // List context lifecycle + state-change routing.
    // `this` is the WildflowerJS instance after mixin assembly.
    // ========================================================================

    // Set up list contexts when a component is initialized
    _setupListContexts(instance)
    {
        if (!instance)
        {
            return;
        }

        // Ensure context system is initialized
        this._ensureContextSystem();

        // Initialize context collection
        if (!instance._listContexts)
        {
            instance._listContexts = new Map();
        }

        let relationships = [];
        try {
            if (this._contextRegistry && this._contextRegistry.detectTemplateRelationships) {
                relationships = this._contextRegistry.detectTemplateRelationships(instance.element);
            }
        } catch (error) {
            if (__DEV__) console.error('ERROR detecting template relationships:', error);
        }

        // Register these relationships in our registry
        relationships.forEach(({parentPath, childPath}) =>
        {
            if (!this._listRelationships.has(parentPath))
            {
                this._listRelationships.set(parentPath, new Set());
            }

            this._listRelationships.get(parentPath).add(childPath);
        });

        // Find ALL list elements including those in templates for proper discovery
        // First find all templates
        const templates = instance.element.querySelectorAll('template');
        const listsInTemplates = [];

        // Search inside template content for nested lists
        templates.forEach(template => {
            const nestedLists = template.content.querySelectorAll(this._attrSelector('list'));
            nestedLists.forEach(list => listsInTemplates.push(list));
        });

        // Find all visible lists
        const visibleListsNodeList = instance.element.querySelectorAll(this._attrSelector('list'));

        const allLists = Array.from(visibleListsNodeList)
            .filter(el =>
            {
                // Only include lists that belong to this component
                // IMPORTANT: Use [data-component] not [data-component-id] because nested
                // components may not have been assigned their ID yet during init
                const closestComponentEl = el.closest('[data-component], [data-wf-component]');
                return closestComponentEl === instance.element;
            });

        // Separate visible lists from template lists for different handling
        const visibleLists = allLists.filter(el => !el.closest('template'));
        // Use the lists we found inside templates
        const templateLists = listsInTemplates;

        // Create contexts for visible lists
        visibleLists.forEach(listElement =>
        {
            const listPath = listElement.dataset.list;
            if (!listPath) return;

            // Skip if context already exists for this list
            if (listElement._listContext || instance._listContexts.has(listPath)) {
                return;
            }

            // Get data for this list
            let data;

            // Normalize $store.path shorthand to external() before processing
            const normalizedPath = listPath.includes('$') && this._normalizeStoreShorthands
                ? this._normalizeStoreShorthands(listPath)
                : listPath;

            if (normalizedPath.startsWith('computed:')) {
                data = instance.stateManager.evaluateComputed(normalizedPath.slice(9));
            } else if (normalizedPath.includes('external(')) {
                // Handle external() expressions for store data
                if (this._getExternalFn) {
                    try {
                        data = this.evaluateExpression(normalizedPath, instance.state, {
                            cacheKey: 'listInit',
                            additionalContext: { external: this._getExternalFn(instance) }
                        });
                    } catch (error) {
                        if (__DEV__) console.warn(`Error evaluating external list path "${normalizedPath}":`, error);
                        data = [];
                    }
                } else {
                    data = [];
                }
            } else {
                data = instance.stateManager.getValue(normalizedPath);
            }

            // Use _createListContext (not registry.createListContext directly)
            // This ensures proper prototype setup and registration
            const context = this._createListContext(
                listPath,
                data,
                instance,
                null  // parent context
            );

            // Store on element for fast lookup
            if (context) {
                listElement._listContext = context;
                context.element = listElement;
            }
        });

        // Pre-create contexts for lists in templates (nested lists)
        // These will be placeholder contexts that get populated during rendering
        templateLists.forEach(listElement =>
        {
            const listPath = listElement.dataset.list;
            if (!listPath) return;

            // For lists in templates, we don't have data yet, but we can prepare the structure
            // The actual data and parent relationships will be set during parent item rendering
            // Mark this as a template list that needs special handling
            listElement._isTemplateList = true;
            listElement._componentInstance = instance;
        });
    },

    // Handle state changes that affect lists
    _handleListStateChange(instanceId, path, newValue, _oldValue)
    {
        const instance = this.componentInstances.get(instanceId);
        if (!instance) {
            return false;
        }

        // Handle computed property changes that directly affect lists
        // When a computed property like 'computed:cartItems' changes, update the corresponding list context
        if (path.startsWith('computed:')) {
            if (instance._listContexts && instance._listContexts.has(path)) {
                const context = instance._listContexts.get(path);
                if (context) {
                    // Update the list with the new computed value
                    context.updateData(Array.isArray(newValue) ? newValue : []);

                    // Queue for render
                    this._contextsToUpdate.add(context);
                    this._scheduleRender();
                    return true;
                }
            }
            // No list bound to this computed property
            return false;
        }

        // Check for context system usage
        if (!this._contextSystemInitialized)
        {
            // Fall back to original implementation if context system not used
            return false;
        }

        // Track affected contexts
        let contextsAffected = false;
        const affectedContexts = new Set();

        // Check if this path change affects any computed property that a list depends on
        // This enables reactive updates for computed lists when their internal dependencies change
        if (instance._listContexts && instance.stateManager) {
            instance._listContexts.forEach((context, contextPath) => {
                // Only check computed lists
                if (contextPath.startsWith('computed:')) {
                    const computedName = contextPath.slice(9); // Remove 'computed:' prefix

                    // Check if this computed property depends on the changed path
                    const deps = instance.stateManager.computedDependencies?.get(path);
                    if (deps && deps.has(computedName)) {
                        // The changed path is a dependency of this computed property
                        // Re-evaluate the computed property and update the list
                        const freshData = instance.stateManager.evaluateComputed(computedName);
                        context.updateData(Array.isArray(freshData) ? freshData : []);
                        contextsAffected = true;
                        affectedContexts.add(context);
                    }
                }
            });
        }

        // Check component's contexts
        if (instance._listContexts && instance._listContexts.size > 0)
        {
            // Check each context for potential impact
            instance._listContexts.forEach((context, contextPath) =>
            {
                // Direct list data update
                if (contextPath === path)
                {
                    if (context._cache)
                    {
                        context._cache.clear();
                    }

                    // Update context data
                    context.updateData(Array.isArray(newValue) ? newValue : []);
                    contextsAffected = true;
                    affectedContexts.add(context);
                }
                // PERFORMANCE FIX: Precise nested list matching (replacing broad path.endsWith())
                else if (this._isNestedListUpdate(path, contextPath))
                {
                    // This handles nested lists like categories[0].items
                    // Get fresh data directly from component state instead of stale context resolution
                    const fullContextPath = context.getFullPath();

                    const dotNotationPath = fullContextPath.replace(/\[(\d+)]/g, '.$1');

                    const freshData = instance.stateManager.getValue(dotNotationPath);

                    context.updateData(Array.isArray(freshData) ? freshData : []);
                    contextsAffected = true;
                    affectedContexts.add(context);
                }
                else if (path.startsWith(`${contextPath}.`))
                {
                    // Only update for structural changes, not property changes
                    const subPath = path.substring(contextPath.length + 1);

                    // OPTIMIZATION: Skip length notification for clear operations
                    // When array is cleared (rows = []), we get TWO notifications:
                    // 1. 'rows' with newValue = [] (direct match, handles the clear)
                    // 2. 'rows.length' with newValue = 0 (length notification, redundant!)
                    // Skip #2 since #1 already cleared the list
                    if (subPath === 'length' && context.data && context.data.length === 0) {
                        // List was already cleared by the direct 'rows' notification
                        // Skip this redundant length notification
                        return;
                    }

                    // Process structural changes AND item-level changes:
                    // - length changes (array size modified)
                    // - splice operations
                    // - item-level changes (e.g., "0", "10" - numeric indices)
                    // - ALSO handle property changes within items (e.g., "0.label", "1.name") for direct mutations
                    if (subPath === 'length' || subPath === 'splice' || subPath.startsWith('splice.') ||
                        subPath.match(/^\d+$/) || subPath.match(/^\d+\./))
                    {
                        const fullContextPath = context.getFullPath();
                        const dotNotationPath = fullContextPath.replace(/\[(\d+)]/g, '.$1');

                        // Check if there's a pending optimization (append, swap, or sparse-update)
                        const pendingOp = instance?.stateManager?._arrayOperations?.get(dotNotationPath);
                        const hasOptimization = pendingOp && (
                            pendingOp.type === 'append' ||
                            pendingOp.type === 'swap' ||
                            pendingOp.type === 'sparse-update'
                        );

                        if (!hasOptimization) {
                            // No optimization available, do full update
                            const freshData = instance.stateManager.getValue(dotNotationPath);
                            context.updateData(Array.isArray(freshData) ? freshData : []);
                        }
                        // Either way, mark context as affected so it gets processed
                        contextsAffected = true;
                        affectedContexts.add(context);
                    }
                }
            });
        }

        // Schedule updates for affected contexts
        if (contextsAffected && !this._batchMode)
        {
            affectedContexts.forEach(context =>
            {
                this._contextsToUpdate.add(context);
            });

            // Schedule render
            this._scheduleRender();
        }

        return contextsAffected;
    },

    // Helper method for precise nested list update detection
    // PERF: Uses string operations instead of regex allocation (hot path optimization)
    _isNestedListUpdate(path, contextPath) {
        // Check for patterns like: "categories.0.items" where contextPath is "items"
        // This should match parent[index].contextPath but NOT unrelated paths
        // Pattern: .<digit(s)>.<contextPath> at end of path

        // Fast fail: path must end with contextPath
        if (!path.endsWith(contextPath)) return false;

        // Get the position before contextPath
        const prefixLength = path.length - contextPath.length;
        if (prefixLength < 3) return false; // Need at least ".0."

        // Check for dot before contextPath (charCode 46 = '.')
        if (path.charCodeAt(prefixLength - 1) !== 46) return false;

        // Find where the index digits end and scan backwards for digits
        let indexEnd = prefixLength - 2;
        let indexStart = indexEnd;

        // Scan backwards for digits (charCodes 48-57 = '0'-'9')
        while (indexStart >= 0) {
            const charCode = path.charCodeAt(indexStart);
            if (charCode < 48 || charCode > 57) break;
            indexStart--;
        }

        // Must have at least one digit
        if (indexStart === indexEnd) return false;

        // Must have a dot before the digits
        if (indexStart < 0 || path.charCodeAt(indexStart) !== 46) return false;

        return true;
    }
};

