/**
 * ListRenderer - data-list rendering: mounting, row creation, updates, teardown.
 *
 * ARCHITECTURE MAP
 *
 * Mounting (one path, no arbitration):
 *   discovery scan -> _mountLists -> _processList -> mountList -> reconcile()
 *   (the keyed reconciler in state/reactive-graph/list-reconciler.js). The
 *   reconciler calls back into mapFn here to create a row element per item,
 *   and into onItemUpdate / onMove / onBulkRemove / onComplete for churn.
 *
 * Row creation (mapFn):
 *   template metadata comes precompiled from TemplateSystem._compileTemplate.
 *   A row is built either by the bulk-clone path (template cloned once, text
 *   written through precompiled setters; used for large batch creates) or the
 *   normal path (_bindWithCompiledMetadata for text/html/model/show plus
 *   _applyRowDecor for class/style/attr). After binding, the row registers on
 *   the list's update routing via registerRowLeafSinks.
 *
 * Update routing (per written field, decided at registration):
 *   1. Suppressing direct writer: a field read by exactly ONE text, style, or
 *      attr binding on one element, on a component with no computeds, watchers,
 *      subscriptions, or autosave (_computeReactiveGraphRetireSafe), gets a
 *      writer stamped on its graph node. The set trap performs the single DOM
 *      write and stops; no observer wake, no onStateChange dispatch. This is
 *      the per-frame hot path; its economy is load-bearing.
 *   2. Per-list dispatcher sink: every other sink-covered leaf routes a write
 *      to the list's dispatcher, which applies ONLY the arms the changed key
 *      feeds: targeted text (the emitter spec), show/html/model executors,
 *      class/style/attr evaluator appliers, and the render arm (which runs
 *      first when present, because a condition flip restructures the row).
 *      Two dispatcher flavors exist: the general one for fully static
 *      templates (a flat, precomputed fast-touch key list), and the computed
 *      one for templates with computeds, expressions, external reads, or
 *      polymorphic rows. The computed dispatcher discovers dependencies at
 *      runtime by walking each row's reads under the list frame; one stable
 *      per-list effect re-applies all rows when a shared (non-item) dep fires.
 *   3. Component refresh effect: root-of-row binding reads and component-state
 *      reads stay on the component's refresh effect. Root drop-out semantics
 *      and the cross-item selection partition live there and must not be
 *      migrated to per-leaf stamps.
 *
 * Self-heal (dual-stamp): a suppressed leaf keeps its sink stamp alongside the
 * writer. When a row is replaced or detached the stale writer self-clears on
 * its next invocation, the write falls through to the sink, and the sink
 * re-applies and re-stamps a fresh writer on the live element.
 *
 * Application kernels (exactly one writer per binding kind, every channel):
 *   class  -> applyClass (diff-tracked via _prevBoundClasses; owns drop-out)
 *   style  -> applyStyleObj / applyStyleProp
 *   attr   -> applyAttrObj (blocklist + sanitizer inside)
 *   text   -> __wf_txt / __wf_str (in-place text-node write)
 *
 * Invariants (load-bearing; violating any of these has produced real bugs):
 *   - A field may be stamped for targeted updates only if EVERY binding kind
 *     that reads it has an applier arm in the dispatcher.
 *   - Skipping the full-row apply requires the same safety gate as write
 *     suppression: item-level computeds are invisible to static template
 *     classification, and the full-row apply is their only applier.
 *   - Element arrays resolve _cachedElementsArray || _bindingElements at every
 *     consumer; either may have been invalidated independently.
 *   - _compileTemplate emits an evaluator entry for every style/attr binding
 *     (bindings imply evaluators), so the evaluator appliers own all list-path
 *     decor and the generic executors run only for slot/SSR callers.
 *   - Detached rows that carry render contexts are live (a placeholder holds
 *     their slot) and must keep receiving applies.
 *
 * @module
 */

// Import CSP-safe evaluation functions
import { getCSPSafeMergedContextEvaluator } from '../core/CSPExpressionEvaluator.js';
import { _UNSAFE_EXPR_RE } from '../core/ExpressionEvaluator.js';
import { ListNestedMethods } from './ListNestedManager.js';
import { ListItemBindingMethods } from './ListItemBinding.js';
import { ListExpressionMethods } from './ListExpressionEval.js';
import { needsComponentInitSet, storedTemplateCache, storedTemplatesCache } from '../core/DomMetadata.js';
import { SSRListMethods } from './ssr-list.js';
import { DIRECT_WRITERS } from '../state/bindingConstants.js';
import { applyAttrObj, applyStyleProp, applyStyleObj, applyClass } from '../core/BindingWriters.js';
import { __wf_str, __wf_txt } from '../core/wfUtils.js';
import { getRowCompileMode, getTextEmitters, applyRowText, shadowCompareRow,
    createListSinkDispatcher, applyRowTextUpdate, getPureTextSpec } from './RowCompiler.js';

// Shared text directWriter. The target element lives on the graph node
// (node.dwEl, set at stamp time) and the field name is node.key, so this single
// module-level function replaces the per-row closure that _stampDirectText used
// to allocate, eliminating one closure per text binding per row (20k on a
// 10k-row create) and the detached-row reference they pinned on clear. notifyNode
// invokes it as dw(target, node); returning false on a detached el lets
// notifyNode clear the stale writer and fall back to the effect wake.
const SHARED_TEXT_WRITER = (target, node) => {
    const el = node.dwEl;
    if (!el || !el.isConnected) return false;
    __wf_txt(el, __wf_str(target[node.key]));
    return true;
};

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const ListRendererMethods = {
    ...ListNestedMethods,
    ...ListItemBindingMethods,
    ...ListExpressionMethods,
    // SSR list support (fingerprint diff, hydration adoption, one-shot SSR
    // binders). The flag is a compile-time constant, so in the 12 non-SSR
    // variants this spread folds away and rollup drops the whole module.
    ...(__FEATURE_SSR__ ? SSRListMethods : {}),
/**
     * Discovery-time mount driver: mounts every not-yet-initialized list in the
     * given entries via _processList (mountList gate + first render). No batch
     * or update arbitration; a newly discovered list mounts unconditionally, and
     * already-mounted lists no-op via mountList's _mapArrayInitialized exit.
     * @private
     */
    _mountLists(listElements, instance = null) {
        if (!listElements || listElements.length === 0) return;

        for (const entry of this._groupListsByComponent(listElements)) {
            this._mountComponentLists(entry, instance);
        }

        this._setupListEventDelegation(listElements, false, instance);
    },

    /**
     * Async twin of _mountLists for initial page load: Sprint/Jog yielding
     * to keep Total Blocking Time low.
     * @private
     */
    async _mountListsAsync(listElements, scanStart = performance.now()) {
        if (!listElements || listElements.length === 0) return;

        const SPRINT_BUDGET = 20;
        const inSprintPhase = () => performance.now() - scanStart <= SPRINT_BUDGET;

        const componentEntries = Array.from(this._groupListsByComponent(listElements).entries());
        let componentIndex = 0;

        while (componentIndex < componentEntries.length && inSprintPhase()) {
            this._mountComponentLists(componentEntries[componentIndex]);
            componentIndex++;
        }

        if (componentIndex < componentEntries.length) {
            await new Promise(resolve => {
                const scheduleIdle = window.requestIdleCallback ||
                    ((cb) => setTimeout(() => cb({ timeRemaining: () => 10 }), 1));

                const processQueue = (deadline) => {
                    while (componentIndex < componentEntries.length && deadline.timeRemaining() > 2) {
                        this._mountComponentLists(componentEntries[componentIndex]);
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

        this._setupListEventDelegation(listElements, false, null);
    },

    /**
     * Mount one component's lists. The rendered-component bookkeeping feeds
     * _hasRendered in _render; there is no batch or update arbitration. A
     * discovered list mounts unconditionally.
     * @private
     */
    _mountComponentLists([componentId, componentLists], instance = null) {
        const currentInstance = instance || this.componentInstances.get(componentId);
        if (!currentInstance) return;

        let allInitialized = true;
        for (let i = 0; i < componentLists.length; i++) {
            const el = componentLists[i].element;
            if (!el?._mapArrayInitialized || el._forceTemplateRerender) {
                allInitialized = false;
                break;
            }
        }
        if (allInitialized) return;

        this._actuallyRenderedComponents = this._actuallyRenderedComponents || new Set();
        this._actuallyRenderedComponents.add(componentId);
        if (this._componentsToUpdate) {
            this._componentsToUpdate.add(componentId);
        }

        for (const list of componentLists) {
            try {
                this._processList(list, currentInstance, false);
            } catch (error) {
                this._handleError(`Error updating list: ${list.path}`, error, currentInstance);
            }
        }
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

            // PERF: Delegation is attached once per list element and stays valid for
            // its lifetime; nested lists wire their own delegation when created
            // (ListNestedManager._processNestedListsForItem). Once this element's
            // delegation exists there is nothing left to do; skip the body. Without
            // this guard, every update/frame ran element.querySelectorAll('[data-list]')
            // over every row to re-discover nested lists, a full DOM walk that found
            // nothing on flat lists (visible as querySelectorAll [data-list] in profiles).
            if (this._hasElementDelegation(element)) continue;

            this._ensureListEventDelegation(element, currentInstance, path);

            // First-time setup only: discover nested lists present now and wire their
            // delegation. Lists created later are handled by _processNestedListsForItem.
            const nestedLists = element.querySelectorAll(this._attrSelector('list'));
            for (let i = 0; i < nestedLists.length; i++) {
                const nestedList = nestedLists[i];
                if (nestedList !== element && nestedList._listContext) {
                    this._ensureListEventDelegation(nestedList, currentInstance, this._getAttr(nestedList, 'list'));
                }
            }
        }
    },
    /**
     * Process a list with enhanced optimizations
     * @param {Object} list - The list configuration object
     * @param {Object} instance - The component instance
     * @param {boolean} forceUpdate - Whether to force a full update
     * @returns {void}
     * @private
     */


    /**
     * Resolve a top-level list's source array for the render diff without the
     * list context's resolveData cache: external(…) through the external fn,
     * everything else (state path / computed: / bare computed) through getValue.
     * Returns a fresh copy (matching resolveData's snapshot semantics) so
     * element._previousData stays a frozen snapshot for change detection.
     * @private
     */
    _resolveListSourceData(path, instance) {
        const sm = instance && instance.stateManager;
        if (!sm) return [];
        const normalizedPath = (path.includes('$') && this._normalizeStoreShorthands)
            ? this._normalizeStoreShorthands(path) : path;
        const result = normalizedPath.includes('external(')
            ? this._evaluateExternalListPath(normalizedPath, instance)
            : sm.getValue(normalizedPath);
        return Array.isArray(result) ? [...result] : [];
    },
    // Bootstrap gate for a single data-list element: mapArray early-exit,
    // template-child/ownership skip, then resolve-or-create the list context.
    // Extracted from _processList so every list-discovery path can converge on
    // one mount entry. Returns the context, or a falsy value when this caller
    // should not (re)mount the list.
    mountList(element, path, instance) {
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
                // This list belongs to the child component; skip processing
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
                    context = parentContext.createChildContext(itemIndex, path);

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
                    // V8 OPT: Canonical shape; all fields always present
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
            return null;
        }

        return context;
    },

    _processList(list, instance, forceUpdate = false) {
        const {element, path} = list;

        const context = this.mountList(element, path, instance);
        if (!context) {
            return;
        }

        // Resolve the diff source. Top-level lists (the only kind that reaches
        // here; nested lists render via the parent's mapArray) read live through
        // getValue / the external fn, snapshot-copied like resolveData did. A
        // nested context here would need parent-proxy resolution, so fall back to
        // resolveData defensively (not observed in practice).
        const data = (context.parent && context.parent.type === 'list')
            ? context.resolveData()
            : this._resolveListSourceData(path, instance);

        // SSR builds: adopted/hydrated lists are not mapArray-backed, so a
        // fingerprint/sparse diff arbitrates their re-renders. Lives in
        // ssr-list.js (module dropped from the 12 non-SSR variants); returns
        // true when the update was handled or no render is needed.
        if (__FEATURE_SSR__) {
            if (this._ssrListDiff(element, path, instance, context, data, forceUpdate)) {
                return;
            }
        }

        // Non-SSR: this tail is only reached for a first mount (mapArray not
        // yet initialized) or a forced template rerender; mounted lists
        // return at the MAPARRAY EARLY EXIT above and update through their
        // own effects. Both cases must render; nothing to arbitrate.
        this._renderList(element, data, context, instance);
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
        const hasContextSystem = this._contextSystemInitialized;
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
        // Per-item bindings/conditionals are no longer registry-tracked contexts
        // (per-item effects + element-local records paint them, and they GC with
        // the removed element), so list items never carry contexts needing an
        // explicit registry sweep here.
        const itemsHaveContextsNeedingCleanup = false;

        // Quick check: if no directives and no contexts needing cleanup, skip expensive element collection
        // Binding contexts don't need cleanup - they're in WeakMap and auto-GC when elements are removed
        if (!hasCustomDirectives && !itemsHaveContextsNeedingCleanup) {
            // NOTE: per-item effect disposal is NOT done here; the mapArray
            // reconciler already disposed every removed row's effect (via
            // _disposeRow) before calling onBulkRemove (this function's only
            // caller). Nulling the elements' expandos is also unnecessary since
            // they are about to be GC'd with the removed DOM.

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
        // Registry contexts no longer exist (per-item bindings/conditionals are
        // effect-driven + element-local; they GC with the removed elements), so
        // there is nothing to sweep; just drain the bookkeeping queues.
        this._deferredCleanupScheduled = false;
        this._deferredCleanupQueue = [];
        this._deferredCleanupContextIds = null;
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
            if (__DEV__) console.error('[WildflowerJS] stateManager.mapArray not available - list rendering requires a component with stateManager');
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
                element._ssrPhase = null; // Clear SSR phase; framework fully owns this list now
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

        // Remove <template> from DOM after extraction; it's no longer needed.
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
            // Forced template rerender (rescanItemTemplates): the flag is consumed
            // on the list's next data change; re-mount through _processList after
            // this flush so the new template is compiled. Deliberately NOT at rescan
            // time: the documented contract is that the UI only changes when state
            // changes. Nested lists are rebuilt by their parent's re-mount instead.
            if (!isNestedList && element._forceTemplateRerender) {
                queueMicrotask(() => {
                    if (element._forceTemplateRerender && element.isConnected) {
                        self._processList({ element, path: listPath, componentId: instance?.id }, instance, false);
                    }
                });
            }
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
            // Both paths are treated identically; computed properties just work
            // regardless of whether the prefix is used.
            const isExplicitComputed = normalizedPath.startsWith('computed:');
            const computedName = isExplicitComputed
                ? normalizedPath.slice(9)
                : (sm.computed && sm.computed[normalizedPath] ? normalizedPath : null);

            if (computedName) {
                // Computed property: use evaluateComputed with tracking context
                // for cross-entity dependency registration (store access via external()).
                const previousTrackingContext = self._computedTrackingContext;
                // V8 OPT: Canonical shape; all fields always present
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
        // Invalidated when component state version changes (tracked by the state manager).
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

        // Row dependency walk: read every reactive dep of a row template so the
        // ACTIVE OBSERVER acquires them. Under a per-row effect (the first-run
        // path) this forms the row's edges exactly as the historic inline walk
        // did; under a list tracking frame (computed/external templates) the
        // reads PARTITION: item leaves onto the per-list sink, shared deps
        // (component state, stores, computed internals) onto the ONE stable
        // per-list effect. Class-only component vars stay filtered to the
        // component refresh effect (the O(2) selection partition) either way.
        const walkRowDeps = (effectMeta, itemProxy, currentIndex) => {
            // Ensure each binding carries its _deps descriptor (idempotent,
            // cached per metadata) so the unified consumer below can read it.
            self._computeDeps(effectMeta);

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

            // Register component-level deps.
            // OPTIMIZATION: Deps used ONLY in class bindings are skipped here;
            // the component refresh effect handles them with O(2) key lookup.
            // Deps used in style/attr/show/text still need registration.
            const touchComponentLevel = (v) => {
                if (v.indexOf('.') !== -1) return;
                // Guard the `in` against a PRIMITIVE item (a $this/$item scalar
                // list): `'$this' in 'red'` throws. An item prop can only exist
                // on an object item anyway.
                if (itemProxy !== null && typeof itemProxy === 'object' && v in itemProxy) return;
                if (!instance?.state || !(v in instance.state)) return;
                if (sm?.computed?.[v]) {
                    sm._registerComponentDep('computed:' + v);
                    return;
                }
                // Skip if this var is only used in class bindings
                // (refresh effect handles it)
                if (element._classOnlyCompDeps?.has(v)) return;
                // Register (used in style/attr/show/text)
                try { const _ = instance.state[v]; } catch (e) { /* ignore */ }
            };

            // Helper to extract and touch variables from an expression
            const touchExpressionVars = (expr, preExtractedVars, preExtractedPaths) => {
                const vars = preExtractedVars || (expr?.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || []);
                for (const v of vars) {
                    if (v.startsWith('_') || self._expressionReservedWords?.has(v)) continue;
                    touchPath(v);           // Item-level dep (root identifier)
                    touchComponentLevel(v); // Component-level dep
                }
                // Register full dotted member paths (e.g. "user.active") so a
                // nested item prop read ONLY by this expression still wakes when
                // it mutates; the root touch above registers "user", never the
                // nested leaf "user.active".
                if (preExtractedPaths) {
                    for (let i = 0; i < preExtractedPaths.length; i++) touchPath(preExtractedPaths[i]);
                }
            };

            // For item-level computeds (fn(item) with fn.length > 0) referenced in
            // expressions, evaluate the computed so its internal state reads register
            // as deps of the active observer. Plain `touchExpressionVars` only reads
            // the names off the proxy; it never invokes the computed body.
            const originalComputeds = instance?.stateManager?._originalComputedFunctions;
            const evalItemLevelComputedsForExprVars = (expressionVars) => {
                if (!originalComputeds || !expressionVars) return;
                for (const v of expressionVars) {
                    const fn = originalComputeds.get(v);
                    // Both forms need invocation here so the computed's
                    // internal state reads register as deps.
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
                // Both forms need invocation under the active observer so the
                // computed's internal state reads register as deps. Bare-form
                // (fn.length === 0) reads `this.X` which the list-context
                // evaluator resolves to the current item's fields.
                if (typeof fn === 'function') {
                    try {
                        self._evaluateComputedInListContext(instance, name, itemProxy, currentIndex, context);
                    } catch (e) { /* ignore */ }
                }
            };

            // Unified per-binding dependency registration driven by _deps
            // (see _computeDeps). touchPath / touchComponentLevel register the
            // reactive deps; evalItemLevelComputed* invoke item-level computeds
            // so their transitive state reads register too.
            const consumeDep = (d) => {
                switch (d.kind) {
                    case 'skip': return;
                    case 'itemPath':
                        touchPath(d.reads[0]); // model: item field only
                        return;
                    case 'path':
                        touchPath(d.reads[0]);
                        touchComponentLevel(d.reads[0]);
                        evalItemLevelComputedByName(d.reads[0]);
                        return;
                    case 'expr':
                        touchExpressionVars(null, d.reads, d.paths);
                        evalItemLevelComputedsForExprVars(d.reads);
                        return;
                    case 'computedName':
                        evalItemLevelComputedByName(d.reads[0]);
                        return;
                }
            };

            const depArrays = [
                effectMeta.bindings, effectMeta.classBindings,
                effectMeta.styleBindings, effectMeta.attrBindings,
                effectMeta.models, effectMeta.shows,
                effectMeta.htmlBindings, effectMeta.renders
            ];
            for (const arr of depArrays) {
                if (!arr) continue;
                for (const b of arr) consumeDep(b._deps);
            }
            if (effectMeta.rootBindings?._deps) {
                for (const d of effectMeta.rootBindings._deps) consumeDep(d);
            }
        };

        // Computed/external templates (fast-touch classification bails: computed
        // reads, component-state reads in non-class bindings, nested paths):
        // instead of one effect per row, ONE stable per-list effect carries the
        // shared deps and a rows-Map dispatcher carries the item leaves; both
        // discovered at runtime by walking each row's deps under a tracking
        // frame (sm.runInListFrame). DOM application is always UNTRACKED (the
        // walk is the sole dep source); item-leaf writes dispatch the one row
        // through the sink, shared-dep changes re-apply every live row.
        const ensureComputedDispatcher = (sampleProxy) => {
            let d = element._wfListSinkDispatcher;
            if (d) return d.computedRows ? d : null;
            const rows = new Map();          // raw item -> row element
            const rawStamps = new Map();     // raw item -> Set<stamped prop> (cleanup)
            const _rowCtx = {
                componentState: null, componentInstance: null, itemIndex: 0,
                listLength: 0, listContext: null, propsData: null
            };
            // Kind-pure leaves (one style/attr/text binding, no other STATIC
            // reader) get a targeted one-write fast path in the sink; the
            // per-frame style economy the retired lazy loop used to provide.
            // NON-suppressing: notifyNode still wakes observers after the sink,
            // so a computed/watcher reading the leaf (invisible to the static
            // classifier) stays live; only the redundant full-row re-apply is
            // skipped.
            let _pure = null;
            if (!isPolymorphic && compiledMetadata) {
                if (compiledMetadata._reactiveGraphPureLeaves === undefined) {
                    compiledMetadata._reactiveGraphPureLeaves = self._computeReactiveGraphPureLeaves(compiledMetadata, sampleProxy);
                }
                _pure = compiledMetadata._reactiveGraphPureLeaves;
            }
            // Suppressing direct-writer upgrade for kind-pure leaves, under the
            // same retire-safe gate the fast-touch dispatcher uses
            // (no computeds/item-computeds/watchers/subscriptions/autoSave; the
            // dynamic readers the static classifier can't see). Without the
            // upgrade every per-frame write re-pays the full per-write
            // onStateChange dispatch the sink's fall-through triggers.
            let _safe = false;
            if (compiledMetadata) {
                _safe = compiledMetadata._reactiveGraphStyleSafe;
                if (_safe === undefined) {
                    _safe = self._computeReactiveGraphRetireSafe(sm, instance);
                    compiledMetadata._reactiveGraphStyleSafe = _safe;
                }
            }
            // Applies the one targeted DOM write; returns the written element,
            // or null when the leaf can't be handled (unresolvable/custom/multi
            // target) and the caller must fall through to the full-row apply.
            const applyPureLeaf = (rowEl, rowProxy, key, entry) => {
                const els = rowEl._cachedElementsArray || rowEl._bindingElements;
                if (entry.kind === 'text') {
                    const el = els && els[entry.elIdx];
                    if (!el || el._isCustomEl === true) return null;
                    const v = rowProxy[key];
                    el.textContent = v == null ? '' : String(v);
                    return el;
                }
                // style | attr: every target must resolve to ONE non-custom element.
                let el = null;
                const ts = entry.targets;
                for (let t = 0; t < ts.length; t++) {
                    const tg = ts[t];
                    let te;
                    if (tg.isRoot) te = rowEl;
                    else if (els && tg.elIndex !== undefined) te = els[tg.elIndex];
                    else if (tg.elementPath && tg.elementPath.length) {
                        te = rowEl;
                        for (const ix of tg.elementPath) {
                            if (!te || !te.children) { te = null; break; }
                            te = te.children[ix];
                        }
                    }
                    if (!te) return null;
                    if (el === null) el = te;
                    else if (el !== te) return null;
                }
                if (!el || el._isCustomEl === true) return null;
                if (entry.kind === 'style') {
                    applyStyleProp(el.style, entry.cssProp, rowProxy[key]);
                    return el;
                }
                const v = rowProxy[key];
                if (v === null || v === undefined || v === false) {
                    el.removeAttribute(entry.attrName);
                } else {
                    const s = self._sanitizeAttrValue(entry.attrName, v);
                    if (s !== null) el.setAttribute(entry.attrName, String(s));
                }
                return el;
            };
            // Full generic row application: renders first (structure), then the
            // generic executor chain, then the class/style/attr fast paths.
            // Runs untracked.
            const applyRowFull = (rowEl, rowProxy) => {
                // Polymorphic rows carry their own compiled metadata; a row
                // without any metadata has nothing to apply (parity with the
                // effect path's `if (effectMeta)` gate).
                const md = (isPolymorphic && rowEl._compiledMetadata) || compiledMetadata;
                if (!md) return;
                const idx = rowEl._listIndex | 0;
                const dataLen = element.children.length;
                if (md.renders?.length > 0 && rowEl._renderContexts) {
                    _rowCtx.componentState = instance?.state || {};
                    _rowCtx.componentInstance = instance;
                    _rowCtx.itemIndex = idx;
                    _rowCtx.listLength = dataLen;
                    _rowCtx.listContext = context;
                    _rowCtx.propsData = instance?._propsData;
                    const changed = self._executeRenders(rowEl._renderContexts, rowProxy, _rowCtx);
                    if (changed) {
                        rowEl._cachedElementsArray = null;
                        rowEl._bindingElements = null;
                    }
                }
                self._bindWithCompiledMetadata(rowEl, rowProxy, md, context, idx, context, true);
                const cs = sm.untrack(() => buildComponentState());
                self._applyRowDecor(rowEl, rowProxy, md, idx, dataLen, cs, instance, context);
            };
            const dispatcher = {
                rows,
                spec: { emitters: [], rootProp: null },
                stampProps: null,
                computedRows: true,
                rawStamps,
                listEffect: null,
                frame: null,
                sink: null,
                stampLeaf: () => { /* runtime stamps only (frame.stamp) */ },
                // Both slots live on the same node (dual-stamp): the pure-leaf
                // fast path may have upgraded a stamped leaf to a suppressing
                // direct writer.
                clearLeaf: (proxy, prop) => { sm.clearDirectWriter(proxy, prop); sm.clearListSink(proxy, prop); },
                clearRowStamps: (raw) => {
                    const u = dispatcher.uniformStamps;
                    if (u) {
                        for (let i = 0; i < u.length; i++) { sm.clearDirectWriter(raw, u[i]); sm.setListSink(raw, u[i], null); }
                    }
                    const set = rawStamps.get(raw);
                    if (set) {
                        for (const k of set) { sm.clearDirectWriter(raw, k); sm.setListSink(raw, k, null); }
                        rawStamps.delete(raw);
                    }
                },
                registerWalk: (rowEl, rowProxy) => {
                    // FAST-TOUCH template routed here for heavy fields (e.g. a
                    // root-binding read such as a selection class on the row
                    // root): every reactive dep is a flat item prop, so
                    // registration is a direct UNIFORM stamp: no dep walk, no
                    // tracking frame, no per-row stamp Set. Walk-based
                    // registration here measurably regresses bulk create time
                    // and per-row heap (~+8% create, +300 B/row). Class-only
                    // component vars stay with the refresh effect; other
                    // component-state reads bail the fast-touch classification,
                    // so no shared-dep edges are lost.
                    if (!isPolymorphic && compiledMetadata && compiledMetadata._reactiveGraphFastTouch) {
                        const u = compiledMetadata._reactiveGraphFastTouch;
                        const raw = sm.toRaw(rowProxy);
                        for (let i = 0; i < u.length; i++) sm.setListSink(raw, u[i], dispatcher.sink);
                        dispatcher.uniformStamps = u;
                        return;
                    }
                    const md = (isPolymorphic && rowEl._compiledMetadata) || compiledMetadata;
                    if (!md) return;
                    sm.runInListFrame(dispatcher.listEffect, dispatcher.frame, () => {
                        walkRowDeps(md, rowProxy, rowEl._listIndex | 0);
                    });
                },
                dispose: null
            };
            dispatcher.frame = {
                observer: null, // wired by sm.runInListFrame
                owns: (raw) => rows.has(raw),
                stamp: (raw, key) => {
                    sm.setListSink(raw, key, dispatcher.sink);
                    let set = rawStamps.get(raw);
                    if (!set) { set = new Set(); rawStamps.set(raw, set); }
                    set.add(key);
                }
            };
            dispatcher.sink = (rawItem, key) => {
                const rowEl = rows.get(rawItem);
                if (!rowEl) return;
                // A DETACHED row with render contexts is a live row whose
                // root-level data-render currently resolves false (a placeholder
                // holds its slot) and the apply may re-insert it. Only rows with
                // no way back are skipped.
                if (!rowEl.isConnected && !rowEl._renderContexts) return;
                const rowProxy = rowEl._itemData;
                if (!rowProxy) return;
                // Kind-pure leaf: one targeted DOM write, skip the full-row
                // re-apply, and upgrade the leaf to a SUPPRESSING direct writer
                // (dual-stamp: the sink stays for self-heal, so a stale writer
                // self-clears, falls through here, and this re-stamp puts a
                // fresh writer on the live element). BOTH the skip and the
                // suppression require the retire-safe gate: an item computed
                // reading the field is invisible to the static classifier AND
                // is not a graph observer (its reads partition to sink stamps
                // under the frame), so on an unsafe component the full-row
                // apply is the ONLY thing that re-evaluates it, and skipping it
                // leaves the computed's binding permanently stale
                // (list-item-computed-pure-leaf-shared-read tests pin this).
                // Detached (render-placeholder) rows apply targeted but stay on
                // the non-suppressing sink until reattached.
                if (_pure && _safe) {
                    const entry = _pure.get(key);
                    if (entry) {
                        const wEl = applyPureLeaf(rowEl, rowProxy, key, entry);
                        if (wEl !== null) {
                            if (rowEl.isConnected) {
                                if (entry.kind === 'text') self._stampDirectText(sm, rowProxy, key, wEl);
                                else if (entry.kind === 'style') self._stampDirectStyle(sm, rowProxy, key, wEl, entry.cssProp);
                                else self._stampDirectAttr(sm, rowProxy, key, wEl, entry.attrName);
                            }
                            return;
                        }
                    }
                }
                // Uniform (fast-touch) templates: apply UNTRACKED. The dep set
                // is the static flat fastTouch list (no drift, no item
                // computeds), and a tracked apply would re-grow per-row stamp
                // Sets through frame.stamp for nothing.
                if (dispatcher.uniformStamps) {
                    sm.untrack(() => applyRowFull(rowEl, rowProxy));
                    return;
                }
                // Apply UNDER the frame: reads partition as they go (item leaves
                // re-stamp, new shared deps link), which is dep-drift handling
                // with the exact evaluation economy of the old per-row effect's
                // tracked rebind: one evaluation per update, no separate walk.
                sm.runInListFrame(dispatcher.listEffect, dispatcher.frame, () => applyRowFull(rowEl, rowProxy));
            };
            // The ONE stable per-list effect. Its first run is empty (edges
            // accumulate from frame walks, and STABLE effects never retrack, so
            // those edges survive every wake). A wake means a SHARED dep
            // changed: re-apply every live row.
            let firstSharedRun = true;
            dispatcher.listEffect = sm.createEffect(() => {
                if (firstSharedRun) { firstSharedRun = false; return; }
                for (const [raw, rowEl] of rows) {
                    // Detached-with-render-contexts rows stay live (see sink).
                    if (!rowEl.isConnected && !rowEl._renderContexts) continue;
                    const rowProxy = rowEl._itemData;
                    if (!rowProxy) continue;
                    sm.runInListFrame(dispatcher.listEffect, dispatcher.frame, () => applyRowFull(rowEl, rowProxy));
                }
            }, { stable: true, name: 'wf-list-shared-deps' });
            dispatcher.dispose = () => {
                try { dispatcher.listEffect(); } catch (e) { /* already disposed */ }
                for (const raw of rawStamps.keys()) dispatcher.clearRowStamps(raw);
                rows.clear();
            };
            element._wfListSinkDispatcher = dispatcher;
            return dispatcher;
        };

        const registerComputedRow = (itemEl, itemProxy) => {
            if (!sm.runInListFrame) return false;
            const d = ensureComputedDispatcher(itemProxy);
            if (!d) return false;
            const raw = sm.toRaw(itemProxy);
            d.rows.set(raw, itemEl);
            d.registerWalk(itemEl, itemProxy);
            return true;
        };

        // Register a row's sink-covered leaves on the per-list dispatcher at
        // CREATION: pure text/style/attr leaves (exclusive, one element; may
        // take a suppressing direct writer under the retire-safe gate),
        // decorative shared leaves (class/style/attr via the evaluator fast
        // paths), and show/html/model leaves (via the per-kind executors).
        // Reuses the list's existing dispatcher when one is present, so
        // single-added rows join the same routing as bulk-created ones. The
        // onRemove/onBulkRemove/onItemUpdate dispatcher bookkeeping is generic
        // over stampProps.
        const registerRowLeafSinks = (itemEl, itemProxy) => {
            if (!sm.setListSink) return;
            if (!compiledMetadata && !isPolymorphic) return;
            let dispatcher = element._wfListSinkDispatcher;
            if (dispatcher && dispatcher.computedRows) {
                registerComputedRow(itemEl, itemProxy);
                return;
            }
            // Polymorphic lists: per-row metadata through the computed
            // dispatcher (applyRowFull/registerWalk resolve
            // rowEl._compiledMetadata; the kind-pure fast path is skipped, as
            // the list-level classifier caches don't describe any one row).
            if (isPolymorphic) {
                registerComputedRow(itemEl, itemProxy);
                return;
            }
            if (!dispatcher) {
                if (compiledMetadata._reactiveGraphFastTouch === undefined) {
                    compiledMetadata._reactiveGraphFastTouch = self._computeReactiveGraphFastTouch(compiledMetadata, instance, itemProxy);
                }
                if (!compiledMetadata._reactiveGraphFastTouch) {
                    // Computed/external template: runtime-discovered dependency
                    // surface via the tracking frame + ONE stable per-list effect.
                    registerComputedRow(itemEl, itemProxy);
                    return;
                }
                // Retire-ELIGIBLE templates build the same general dispatcher
                // here: a path census showed eligible templates rendered through
                // the normal (non-bulk) path never reached the onDeferredEffects
                // retire branch and fell to full per-row effects. The retire
                // branch reuses this dispatcher when it runs first, and vice
                // versa; whichever path sees the list first constructs it.
                // Kind-pure leaves: text/style/attr fields bound to exactly one
                // element and read by no other binding.
                if (compiledMetadata._reactiveGraphPureLeaves === undefined) {
                    compiledMetadata._reactiveGraphPureLeaves = self._computeReactiveGraphPureLeaves(compiledMetadata, itemProxy);
                }
                if (compiledMetadata._reactiveGraphPureText === undefined) {
                    compiledMetadata._reactiveGraphPureText = self._computeReactiveGraphPureText(compiledMetadata);
                }
                const pureLeaves = compiledMetadata._reactiveGraphPureLeaves;
                const pureText = compiledMetadata._reactiveGraphPureText;
                // Sink-covered shared leaves: flat item props whose every reader
                // is a kind the dispatcher applier owns: class/style/attr
                // (decorative, via the evaluator fast paths) and show/html/model
                // (via the per-kind executors under untrack). A field also read
                // by a render, by ANY text binding, or by any root binding stays
                // HEAVY and routes the template through the computed dispatcher:
                // the sink's text spec covers only PURE text leaves (a text+class
                // shared field stamped here would leave its text node permanently
                // stale; list-text-class-shared-field.test.js pins this), renders
                // can restructure the row, and row-root binding semantics
                // (including root class drop-out) live in the full-rebind
                // executor chain (list-class-binding-reactivity pins that a
                // stamped root class misses drop-out).
                if (compiledMetadata._decoStampProps === undefined) {
                    let deco = null;
                    let smh = null;
                    let smhReads = null;
                    let rndr = null;
                    let renderReads = null;
                    if (compiledMetadata._reactiveGraphFastTouch) {
                        const heavy = new Set();
                        const collectHeavy = (deps) => {
                            if (!deps || deps.kind === 'skip') return;
                            const reads = deps.reads || [];
                            for (let i = 0; i < reads.length; i++) heavy.add(reads[i]);
                            if (deps.paths) for (let i = 0; i < deps.paths.length; i++) heavy.add(deps.paths[i]);
                        };
                        for (const arr of [compiledMetadata.bindings]) {
                            if (!arr) continue; for (const b of arr) collectHeavy(b._deps);
                        }
                        // ALL root-binding reads are heavy, INCLUDING the root
                        // class: row-root class drop-out routes through the
                        // full-rebind executor chain
                        // (_executeClassBindings/_toggleBoundClass), and a
                        // stamped root class would miss removals
                        // (list-class-binding-reactivity pins this).
                        if (compiledMetadata.rootBindings?._deps) {
                            for (const d of compiledMetadata.rootBindings?._deps) collectHeavy(d);
                        }
                        const fastSet = new Set(compiledMetadata._reactiveGraphFastTouch);
                        // Flat root-name read set for a group of binding arrays
                        // (skips positionals/computed:/props:, strips negation,
                        // roots dotted paths; nested reads cannot survive the
                        // fast-touch classification anyway).
                        const collectFlatReads = (arrays) => {
                            let set = null;
                            for (const arr of arrays) {
                                if (!arr || !arr.length) continue;
                                for (const b of arr) {
                                    const d = b._deps;
                                    if (!d || d.kind === 'skip') continue;
                                    const all = d.paths ? (d.reads || []).concat(d.paths) : (d.reads || []);
                                    for (let i = 0; i < all.length; i++) {
                                        let p = all[i];
                                        if (!p || typeof p !== 'string') continue;
                                        if (p.startsWith('_') || p.startsWith('computed:') || p.startsWith('props:')) continue;
                                        if (p.startsWith('!')) p = p.slice(1);
                                        if (!p) continue;
                                        const dot = p.indexOf('.');
                                        if (dot !== -1) p = p.slice(0, dot);
                                        (set || (set = new Set())).add(p);
                                    }
                                }
                            }
                            return set;
                        };
                        // Decorative (class/style/attr) leaves. Class-read
                        // fields are deco-stampable because every class channel
                        // applies through the applyClass kernel (diff-tracked,
                        // drop-out correct), so the deco arm's class re-apply
                        // removes dropped classes; the drop-out matrix in
                        // list-applier-contracts.test.js pins this. Applier
                        // coverage guard: only stamp when the evaluator fast
                        // paths cover every decorative binding present.
                        const decoReadsAll = self._extractDecorativeReadProps(compiledMetadata);
                        if (decoReadsAll) {
                            const covered =
                                (!(compiledMetadata.styleBindings && compiledMetadata.styleBindings.length) || (compiledMetadata.styleEvaluators && compiledMetadata.styleEvaluators.length)) &&
                                (!(compiledMetadata.attrBindings && compiledMetadata.attrBindings.length) || (compiledMetadata.attrEvaluators && compiledMetadata.attrEvaluators.length)) &&
                                (!(compiledMetadata.classBindings && compiledMetadata.classBindings.length) || (compiledMetadata.classEvaluators && compiledMetadata.classEvaluators.length));
                            if (covered) {
                                for (const p of decoReadsAll) {
                                    if (!heavy.has(p) && fastSet.has(p) && !(pureLeaves && pureLeaves.has(p))) {
                                        (deco || (deco = [])).push(p);
                                    }
                                }
                            }
                        }
                        const stampable = (readSet, out) => {
                            if (!readSet) return out;
                            for (const p of readSet) {
                                if (!heavy.has(p) && fastSet.has(p) && !(pureLeaves && pureLeaves.has(p))) {
                                    (out || (out = [])).push(p);
                                }
                            }
                            return out;
                        };
                        // Show/html/model leaves (non-root: root reads are heavy
                        // above). The executors need no compiled evaluators, so
                        // there is no coverage guard.
                        smhReads = collectFlatReads([compiledMetadata.shows, compiledMetadata.htmlBindings, compiledMetadata.models]);
                        smh = stampable(smhReads, smh);
                        // data-render leaves (non-root). On a condition flip the
                        // applier's render arm re-applies the WHOLE row generically
                        // (the revealed subtree needs every binding kind at current
                        // values), so render coverage does not depend on the other
                        // fields being sink-covered.
                        renderReads = collectFlatReads([compiledMetadata.renders]);
                        rndr = stampable(renderReads, rndr);
                    }
                    compiledMetadata._decoStampProps = deco;
                    compiledMetadata._smhStampProps = smh;
                    compiledMetadata._smhReads = smhReads;
                    compiledMetadata._renderStampProps = rndr;
                    compiledMetadata._renderReads = renderReads;
                }
                const decoProps = compiledMetadata._decoStampProps;
                const smhProps = compiledMetadata._smhStampProps;
                const smhReads = compiledMetadata._smhReads;
                const renderProps = compiledMetadata._renderStampProps;
                const renderReads = compiledMetadata._renderReads;
                // Nothing sink-stampable at all (e.g. every text binding is an
                // expression): the whole template is heavy, so route it through
                // the computed dispatcher like any other heavy template (the
                // per-row effect fallback this used to rely on is gone).
                if ((!pureLeaves || pureLeaves.size === 0) && (!decoProps || decoProps.length === 0)
                    && (!smhProps || smhProps.length === 0) && (!renderProps || renderProps.length === 0)) {
                    registerComputedRow(itemEl, itemProxy);
                    return;
                }
                const spec = getPureTextSpec(pureText || new Map()) || { emitters: [], rootProp: null };
                // Kind-armed applier (mirrors the retire branch): targeted text,
                // then show/html/model through the per-kind executors, then
                // decorative re-apply through the evaluator fast paths; each arm
                // skipped when the changed leaf feeds none of its bindings.
                const classEvals = compiledMetadata.classEvaluators;
                const styleEvals = compiledMetadata.styleEvaluators;
                const attrEvals = compiledMetadata.attrEvaluators;
                const hasClass = !!(classEvals && classEvals.length);
                const hasStyle = !!(styleEvals && styleEvals.length);
                const hasAttr = !!(attrEvals && attrEvals.length);
                const hasDeco = hasClass || hasStyle || hasAttr;
                const decoReads = hasDeco
                    ? self._extractDecorativeReadProps(compiledMetadata) : null;
                const smhShows = compiledMetadata.shows;
                const smhHtmls = compiledMetadata.htmlBindings;
                const smhModels = compiledMetadata.models;
                const hasSmh = !!(smhProps && smhProps.length);
                const hasRenders = !!(renderProps && renderProps.length);
                // Reusable executor ctx (per dispatcher; sink applies are
                // synchronous, mirroring ListItemBinding's _reusableBindCtx).
                const _armCtx = (hasSmh || hasRenders) ? {
                    componentState: null, componentInstance: null, itemIndex: 0,
                    listLength: 0, listContext: null, propsData: null
                } : null;
                const applyRow = (hasDeco || hasSmh || hasRenders)
                    ? (rowEl, rawItem, key) => {
                        const applyAll = key == null || key === '__ALL__';
                        // data-render arm FIRST (it can restructure the row).
                        // Skipped when the row carries no render contexts; the
                        // effect path skips those rows the same way. On a flip,
                        // re-apply the WHOLE row through the generic executor
                        // chain (the revealed subtree needs every binding kind
                        // at current values, the exact post-render sequence of
                        // the per-row effect), then return: the arms below would
                        // be redundant.
                        if (hasRenders && (applyAll || renderReads.has(key)) && rowEl._renderContexts) {
                            let structureChanged = false;
                            sm.untrack(() => {
                                const rowProxy = rowEl._itemData || rawItem;
                                _armCtx.componentState = instance?.state || {};
                                _armCtx.componentInstance = instance;
                                _armCtx.itemIndex = rowEl._listIndex | 0;
                                _armCtx.listLength = element.children.length;
                                _armCtx.listContext = context;
                                _armCtx.propsData = instance?._propsData;
                                structureChanged = self._executeRenders(rowEl._renderContexts, rowProxy, _armCtx);
                                if (structureChanged) {
                                    // DOM structure changed: invalidate BOTH cached
                                    // element arrays (consumers read either), then
                                    // rebind generically so every binding applies
                                    // (the full-rebind chain has no targeted filter
                                    // (only the smh executors filter, and only
                                    // inside their own scoped window).
                                    rowEl._cachedElementsArray = null;
                                    rowEl._bindingElements = null;
                                    const idx = rowEl._listIndex | 0;
                                    const dataLen = element.children.length;
                                    self._bindWithCompiledMetadata(rowEl, rowProxy, compiledMetadata, context, idx, context, true);
                                    const cs = buildComponentState();
                                    self._applyRowDecor(rowEl, rowProxy, compiledMetadata, idx, dataLen, cs, instance, context);
                                }
                            });
                            if (structureChanged) return;
                        }
                        applyRowTextUpdate(spec, rowEl._cachedElementsArray || rowEl._bindingElements, rawItem, rowEl, key);
                        if (hasSmh && (applyAll || smhReads.has(key))) {
                            sm.untrack(() => {
                                const els = rowEl._cachedElementsArray || rowEl._bindingElements;
                                if (!els) return;
                                const rowProxy = rowEl._itemData || rawItem;
                                _armCtx.componentState = instance?.state || {};
                                _armCtx.componentInstance = instance;
                                _armCtx.itemIndex = rowEl._listIndex | 0;
                                _armCtx.listLength = element.children.length;
                                _armCtx.listContext = context;
                                _armCtx.propsData = instance?._propsData;
                                // Scope the executors' targeted-rebind filter to the
                                // changed key so non-matching bindings skip their DOM
                                // writes (an unrelated innerHTML rewrite is not
                                // idempotent-cheap). Keys here are flat item props
                                // (fast-touch), so prop === root.
                                const prevTP = self._targetedProp, prevTPR = self._targetedPropRoot;
                                if (!applyAll) { self._targetedProp = key; self._targetedPropRoot = key; }
                                try {
                                    if (smhHtmls && smhHtmls.length) self._executeHtmlBindings(els, smhHtmls, rowProxy, _armCtx);
                                    if (smhModels && smhModels.length) self._executeModels(els, smhModels, rowProxy);
                                    if (smhShows && smhShows.length) self._executeShows(els, smhShows, rowProxy, _armCtx);
                                } finally {
                                    self._targetedProp = prevTP; self._targetedPropRoot = prevTPR;
                                }
                            });
                        }
                        if (hasDeco && (applyAll || !decoReads || decoReads.has(key))) {
                            sm.untrack(() => {
                                const rowProxy = rowEl._itemData || rawItem;
                                const idx = rowEl._listIndex | 0;
                                const dataLen = element.children.length;
                                const cs = buildComponentState();
                                if (hasClass) self._applyClassBindingsToRow(rowEl, rowProxy, idx, dataLen, classEvals, cs, instance, context);
                                if (hasStyle) self._applyStyleBindingsToRow(rowEl, rowProxy, idx, dataLen, styleEvals, cs, instance, context);
                                if (hasAttr) self._applyAttrBindingsToRow(rowEl, rowProxy, idx, dataLen, attrEvals, cs, instance, context);
                            });
                        }
                    }
                    : undefined;
                // Field -> stamp descriptor for kind dispatch. 'deco' marks a
                // plain non-suppressing sink stamp (decorative or smh-covered
                // leaf), never a direct writer.
                const leafKinds = new Map();
                if (pureLeaves) for (const [f, entry] of pureLeaves) leafKinds.set(f, entry);
                if (decoProps) for (const f of decoProps) leafKinds.set(f, { kind: 'deco' });
                if (smhProps) for (const f of smhProps) { if (!leafKinds.has(f)) leafKinds.set(f, { kind: 'deco' }); }
                if (renderProps) for (const f of renderProps) { if (!leafKinds.has(f)) leafKinds.set(f, { kind: 'deco' }); }
                // HEAVY residue: fast-touch fields the general dispatcher does
                // NOT own (expression/shared text, root-binding reads). Such
                // templates route through the COMPUTED dispatcher instead of
                // keeping a per-row effect for the residue: every write to a
                // heavy field takes the tracked full generic row apply (the old
                // effect's rebind economy), kind-pure leaves keep the targeted
                // fast path, and no per-row effect is ever created. The general
                // dispatcher below is therefore only ever built FULLY covering.
                if (compiledMetadata._reactiveGraphHeavyTouch === undefined) {
                    compiledMetadata._reactiveGraphHeavyTouch =
                        compiledMetadata._reactiveGraphFastTouch.filter(f => !leafKinds.has(f));
                }
                if (compiledMetadata._reactiveGraphHeavyTouch.length > 0) {
                    registerComputedRow(itemEl, itemProxy);
                    return;
                }
                dispatcher = createListSinkDispatcher(spec, applyRow, Array.from(leafKinds.keys()));
                dispatcher.leafKinds = leafKinds;
                dispatcher.ownedProps = new Set(leafKinds.keys());
                let _safe = compiledMetadata._reactiveGraphStyleSafe;
                if (_safe === undefined) {
                    _safe = self._computeReactiveGraphRetireSafe(sm, instance);
                    compiledMetadata._reactiveGraphStyleSafe = _safe;
                }
                // A suppressing direct writer is stamped where the
                // retire-safe gate allows. Kind-pure style/attr targets must all
                // resolve to ONE non-custom element or the leaf falls back to
                // the sink.
                const resolveSingleTarget = (rowEl, els, targets) => {
                    let el = null;
                    for (let t = 0; t < targets.length; t++) {
                        const tg = targets[t];
                        let te;
                        if (tg.isRoot) te = rowEl;
                        else if (els && tg.elIndex !== undefined) te = els[tg.elIndex];
                        else if (tg.elementPath && tg.elementPath.length) {
                            te = rowEl;
                            for (const ix of tg.elementPath) {
                                if (!te || !te.children) { te = null; break; }
                                te = te.children[ix];
                            }
                        }
                        if (!te) return null;
                        if (el === null) el = te;
                        else if (el !== te) return null;
                    }
                    return el;
                };
                // Dual-stamp: a suppressed (directWriter) leaf ALSO carries the
                // listSink. notifyNode consults the writer first (suppression
                // intact); when the writer self-clears against a stale element
                // it falls THROUGH to the sink, which applies against the live
                // row from the rows-Map and re-stamps; the dispatcher-native
                // self-heal that replaces the per-row effect's edge wake.
                const baseSink = dispatcher.sink;
                dispatcher.sink = (rawItem, key) => {
                    baseSink(rawItem, key);
                    if (_safe) {
                        const entry = leafKinds.get(key);
                        if (entry && entry.kind !== 'deco') {
                            const rowEl = dispatcher.rows.get(rawItem);
                            if (rowEl && rowEl.isConnected && rowEl._itemData) {
                                dispatcher.stampLeaf(rowEl._itemData, rowEl, key);
                            }
                        }
                    }
                };
                dispatcher.stampLeaf = (proxy, rowEl, prop) => {
                    const entry = leafKinds.get(prop);
                    if (!entry) return;
                    sm.setListSink(proxy, prop, dispatcher.sink);
                    if (_safe && entry.kind !== 'deco') {
                        const _els = rowEl._cachedElementsArray || rowEl._bindingElements;
                        if (entry.kind === 'text') {
                            const tEl = _els && _els[entry.elIdx];
                            if (tEl && tEl._isCustomEl !== true) { self._stampDirectText(sm, proxy, prop, tEl); return; }
                        } else {
                            const el = resolveSingleTarget(rowEl, _els, entry.targets);
                            if (el && el._isCustomEl !== true) {
                                if (entry.kind === 'style') { self._stampDirectStyle(sm, proxy, prop, el, entry.cssProp); return; }
                                self._stampDirectAttr(sm, proxy, prop, el, entry.attrName); return;
                            }
                        }
                    }
                };
                dispatcher.clearLeaf = (proxy, prop) => {
                    // Both slots live on the same node (dual-stamp).
                    sm.clearDirectWriter(proxy, prop);
                    sm.clearListSink(proxy, prop);
                };
                element._wfListSinkDispatcher = dispatcher;
            }
            const raw = sm.toRaw(itemProxy);
            dispatcher.rows.set(raw, itemEl);
            const props = dispatcher.stampProps;
            if (props) for (let p = 0; p < props.length; p++) dispatcher.stampLeaf(itemProxy, itemEl, props[p]);
        };


        // Compute which component-level vars are used ONLY in class bindings.
        // These can be skipped in per-item effects (refresh effect handles them).
        if (compiledMetadata && instance?.state && !element._classOnlyCompDeps) {
            self._computeDeps(compiledMetadata);
            const reservedWords = self._expressionReservedWords;
            const classVars = new Set();
            const otherVars = new Set();

            const addReads = (reads, targetSet) => {
                for (let i = 0; i < reads.length; i++) {
                    const v = reads[i];
                    if (!v || v.startsWith('_') || reservedWords?.has(v)) continue;
                    targetSet.add(v);
                }
            };

            // Class binding vars (exclude whole-binding computed references; those
            // are gated separately below). Root class expression included.
            for (const cb of (compiledMetadata.classBindings || [])) {
                if (cb._deps && cb._deps.kind !== 'computedName') addReads(cb._deps.reads, classVars);
            }

            // Non-class binding vars (text, style, attr, model, show, html, render).
            const otherArrays = [
                compiledMetadata.bindings, compiledMetadata.styleBindings,
                compiledMetadata.attrBindings, compiledMetadata.models,
                compiledMetadata.shows, compiledMetadata.htmlBindings,
                compiledMetadata.renders
            ];
            for (const arr of otherArrays) {
                if (!arr) continue;
                for (const b of arr) { if (b._deps) addReads(b._deps.reads, otherVars); }
            }

            // Root bindings: the class expression feeds classVars; every other root
            // field feeds otherVars.
            if (compiledMetadata.rootBindings?._deps) {
                for (const d of compiledMetadata.rootBindings._deps) {
                    if (d.kind === 'computedName') continue; // gated below
                    if (d.field === 'bindClassExpr') addReads(d.reads, classVars);
                    else addReads(d.reads, otherVars);
                }
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

                // Text + generic bindings; the decor sequence below owns every
                // style/attr binding (evaluator coverage is total; see
                // _applyRowDecor).
                self._bindWithCompiledMetadata(itemEl, itemProxy, itemCompiledMetadata, context, index, context, true);
                self._applyRowDecor(itemEl, itemProxy, itemCompiledMetadata, index, data?.length || 0,
                    componentState, instance, context);
            }

            // === INTEGRATION: Handle root element model/show bindings ===
            // This covers data-model and data-show on the item root element itself
            const ds = itemEl.dataset;
            const rootContext = itemCompiledMetadata ? { ...context, componentInstance: instance, listLength: data?.length || 0 } : context;
            self._bindRootElementModelShow(itemEl, itemProxy, ds, index, rootContext);

            // Store binding data for context creation
            itemEl._needsContexts = true;

            // === INTEGRATION: Create action records eagerly for action binding ===
            // This ensures action records exist BEFORE any click events,
            // which is required for proper event delegation and test compatibility
            if (self._contextSystemInitialized) {
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

            // Normal path: every row registers on a per-list dispatcher,
            // general (fully sink-covered fast-touch) or computed (heavy /
            // computed / external / polymorphic). Per-row effects no longer
            // exist; the dispatcher is the whole update mechanism.
            registerRowLeafSinks(itemEl, itemProxy);
            itemEl._wfDisposeEffect = null;
            return { element: insertEl, disposeEffect: null };
        };

        // Set up mapArray with callbacks
        const disposeMapArray = sm.mapArray(
            arrayFn,
            mapFn,
            {
                key: keyProp,
                // OPTIMIZATION: bulk create fast path; clone a cached row prototype
                // + direct textContent setter writes (see _buildRowsCloneSetter),
                // instead of N cloneNode calls or a serialize+reparse. Non-qualifying
                // templates (polymorphic / custom-element / no innerHTML parts) return
                // null and fall back to the per-item mapFn loop.
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
                    const classEvaluators = compiledMetadata.classEvaluators || [];

                    // Build component state for class evaluators
                    const componentState = buildComponentState();

                    // Build the rows by cloning a cached row prototype and writing
                    // each text binding straight to textContent, batched into one
                    // DocumentFragment (replacing the old serialize-to-HTML-string +
                    // element.innerHTML reparse, which was ~85% of create script).
                    // Returns false only for a degenerate template with no single
                    // root element (unreachable for a normal list item); fall back to
                    // the per-item mapFn path in that case.
                    if (!self._buildRowsCloneSetter(compiledMetadata, instance, newArray, startIndex, element, parts)) {
                        return null;
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

                        // Build and cache elements array for sparse updates.
                        // The clone+setter create path already built and stashed
                        // this array (to run text setters), so reuse it instead of
                        // walking the element paths a second time.
                        row._bindingElements = row._bindingElements || self._buildElementsArrayFromMetadata(row, compiledMetadata);
                        row._compiledMetadata = compiledMetadata;

                        // Apply class bindings (skip call entirely when no evaluators)
                        if (classEvaluators.length > 0) {
                            if (reusableMergedCtx) {
                                // Copy item props into the reused class context from the
                                // RAW target, not the proxy: Object.assign on a reactive
                                // proxy pays ownKeys + per-key descriptor + get traps;
                                // the raw object is a plain copy. Create-time apply isn't
                                // dependency-tracking (the per-item effect wires reactivity
                                // separately), so the copied values are identical.
                                const rawT = sm._proxyTargets?.get(itemProxy) || itemProxy;
                                const copyVars = compiledMetadata._classCopyVars;
                                if (copyVars) {
                                    // Targeted copy: only the props the class expressions
                                    // reference (O(class-expr vars) vs O(item width)). Vars
                                    // absent from the raw item are component-state (or list-
                                    // context) and are skipped, keeping the pre-loaded value.
                                    for (let cvi = 0; cvi < copyVars.length; cvi++) {
                                        const v = copyVars[cvi];
                                        if (v in rawT) reusableMergedCtx[v] = rawT[v];
                                    }
                                } else {
                                    // Full copy: a null class evaluator's fallback reads
                                    // Object.keys(mergedCtx), so it needs every item prop.
                                    Object.assign(reusableMergedCtx, rawT);
                                }
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

                        // Wire data-event-outside on row-template children.
                        // Must happen eagerly: clicks land outside the row, so
                        // the lazy context-creation path won't trigger. The
                        // EventSystem._setupOutsideClickHandler registry is
                        // idempotent so repeat row mounts (template re-renders,
                        // key reuse) are safe.
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
                    // Tear down nested data-list mapArrays in the removed row (their
                    // effects survive DOM removal otherwise) and prune their
                    // _listContexts entries. Gated on this list actually having
                    // child lists so the common (flat-row) remove hot path skips
                    // the subtree walk entirely. MUST run before
                    // _cleanupContextsInSubtree, which deletes el._listContext on
                    // descendants; the prune keys off that reference.
                    if (hasChildLists) {
                        self._disposeNestedListsInItem(el, instance);
                    }
                    self._cleanupContextsInSubtree(el);
                    self._destroyNestedComponentsInItem(el);
                    // Release the removed row's dispatcher entry + stamped
                    // leaves so the detached element + item object are not pinned
                    // by the rows Map. clearLeaf dispatches directWriter vs listSink.
                    const _d = element._wfListSinkDispatcher;
                    if (_d && _d.stampLeaf && el._itemData) {
                        const _proxy = el._itemData;
                        const _raw = sm.toRaw(_proxy);
                        _d.rows.delete(_raw);
                        if (_d.computedRows) {
                            // Runtime-discovered stamps: clear + unpin (rawStamps
                            // holds the raw strongly for cleanup bookkeeping).
                            _d.clearRowStamps(_raw);
                        } else {
                            const _props = _d.stampProps;
                            if (_props) for (let p = 0; p < _props.length; p++) _d.clearLeaf(_proxy, _props[p]);
                        }
                    }
                    el.remove();
                    itemElements.delete(key);
                },
                // PERF: Bulk removal for removing many items at once
                // Uses batched cleanup instead of per-item cleanup
                onBulkRemove: (elements, items) => {
                    if (!elements || elements.length === 0) return;

                    // PERF: Check if this is a full clear using itemElements map size
                    // instead of _getListItems DOM query (avoids Array.from on 10K children + 2 filter passes)
                    const isFullClear = elements.length >= itemElements.size;

                    // Release removed rows' dispatcher entries + stamped
                    // leaves so detached elements + item objects are not pinned
                    // by the rows Map. On a FULL clear the entire item-proxy
                    // subgraph is discarded, so the only thing that must happen is
                    // dropping the rows Map's raw->element pins; a single
                    // rows.clear() replaces the O(n) toRaw + delete + clearLeaf
                    // loop. The per-leaf stamps live on the about-to-be-GC'd item
                    // proxies (and the directWriter self-guards on el.isConnected),
                    // so clearing them is wasted work on full clear. Partial
                    // removals still walk only the removed rows.
                    const _d = element._wfListSinkDispatcher;
                    if (_d && _d.stampLeaf) {
                        if (isFullClear) {
                            _d.rows.clear();
                            // Computed dispatchers must also unpin the raws their
                            // stamp bookkeeping holds strongly (the sinks on the
                            // discarded item subgraph GC with it).
                            if (_d.computedRows) _d.rawStamps.clear();
                        } else {
                            const _props = _d.stampProps;
                            for (let i = 0; i < elements.length; i++) {
                                const _proxy = elements[i] && elements[i]._itemData;
                                if (!_proxy) continue;
                                const _raw = sm.toRaw(_proxy);
                                _d.rows.delete(_raw);
                                if (_d.computedRows) {
                                    _d.clearRowStamps(_raw);
                                } else if (_props) {
                                    for (let p = 0; p < _props.length; p++) _d.clearLeaf(_proxy, _props[p]);
                                }
                            }
                        }
                    }

                    // Use optimized batch cleanup (same as context mode)
                    // This does: batched directive cleanup, batched component destruction,
                    // deferred context cleanup - all with minimal querySelectorAll calls
                    self._batchCleanupListItemsWithNestedComponents(elements);

                    // Tear down nested data-list mapArrays in each removed row (the
                    // batch cleanup destroys nested components + item effects but not
                    // nested-list effects). Gated on this list having child lists so
                    // flat lists skip the per-row subtree walk. Runs before DOM
                    // removal so the wrappedDispose walk still sees the subtree.
                    if (hasChildLists) {
                        for (let i = 0; i < elements.length; i++) {
                            self._disposeNestedListsInItem(elements[i], instance);
                        }
                    }

                    if (isFullClear) {
                        // Full clear: single DOM operation
                        // Template was removed from DOM during setup, so just clear everything
                        element.replaceChildren();
                        // Clear all from map
                        itemElements.clear();
                        // Release scope-captured references to the now-empty list's
                        // PRIOR populated array. These caches live in this list's
                        // mapArray setup closure (shared V8 context with the long-lived
                        // dispose/refresh/effect closures), so a stale reference here
                        // pins the entire prior item-proxy subgraph; each item's graph
                        // node still carries a directWriter that captures its (now
                        // detached) row element, so the rows + their <tr>/<td> DOM never
                        // GC after clear. `_cachedComponentState` spreads the rows proxy
                        // via `{...instance.state}`; `_previousData` is an SSR-only diff
                        // snapshot unused on the mapArray path. Dropping both lets the
                        // emptied array (and its items, nodes, directWriters, DOM) collect.
                        _cachedComponentState = null;
                        _cachedStateVersion = -1;
                        element._previousData = null;
                        element._previousDataLength = 0;
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

                    // Always update the canonical row index (even if DOM position
                    // unchanged). List-item action dispatch + per-item effects read
                    // _listIndex directly. This runs once per shifted row in the
                    // single-remove renumber, so it is the remove hot path; keep it
                    // to one write (_bindItemIndex was a redundant mirror, retired).
                    el._listIndex = newIdx;
                },
                // Synchronous effect creation for immediate reactivity
                // Effects must be created before scan() returns so they can respond to mutations
                // that happen immediately after scan() completes
                onDeferredEffects: (deferredItems, currentItems, arrPath) => {
                    if (!deferredItems || deferredItems.length === 0) return;
                    // Component-level deps are extracted here for the component
                    // refresh effect when the initial bulk render runs before the
                    // refresh-effect setup below (mapArray renders synchronously
                    // inside sm.mapArray). The deferred items provide the sample
                    // item the classifier needs.
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
                    // Every deferred row registers on the per-list dispatcher
                    // (general or computed), the same routing as the normal
                    // path. Per-row effects no longer exist; sink stamps live on
                    // the graph's global node table, so store-item writes reach
                    // them without any _effectDependents registration.
                    for (let i = 0; i < deferredItems.length; i++) {
                        const data = deferredItems[i];
                        if (!data || !data.element || !data.itemProxy) continue;
                        if (!data.element.parentNode) continue;
                        registerRowLeafSinks(data.element, data.itemProxy);
                        data.element._wfDisposeEffect = null;
                    }
                },
                // === CRITICAL: Handle existing item proxy updates ===
                // Called when mapArray reuses an element but the item proxy has changed
                // This happens when array is replaced (e.g., state.items = [...]) with same keys
                onItemUpdate: (itemEl, newItemProxy, oldItemProxy, index) => {
                    // Update element's item data reference
                    itemEl._itemData = newItemProxy;
                    itemEl._listIndex = index;

                    // Same-key replace: when a row keeps its element but its
                    // item object changes, the listSink stamped on the old object's
                    // leaves no longer points reactivity at this row. Move the rows
                    // entry, clear the old leaves, re-stamp the new ones, and refresh
                    // the row text (the per-item effect's mRefresh re-track has no node
                    // for retired rows).
                    const _dispatcher = element._wfListSinkDispatcher;
                    if (_dispatcher && _dispatcher.computedRows) {
                        // Runtime-discovered surface: move the rows entry, drop the
                        // old raw's stamps, and re-walk the NEW proxy's deps under
                        // the frame (stamping its leaves + linking any new shared
                        // deps). DOM application is the !willRefresh apply below.
                        const newRaw = sm.toRaw(newItemProxy);
                        const oldRaw = oldItemProxy != null ? sm.toRaw(oldItemProxy) : null;
                        if (oldRaw && oldRaw !== newRaw) {
                            _dispatcher.rows.delete(oldRaw);
                            _dispatcher.clearRowStamps(oldRaw);
                        }
                        _dispatcher.rows.set(newRaw, itemEl);
                        _dispatcher.registerWalk(itemEl, newItemProxy);
                    } else if (_dispatcher && _dispatcher.stampLeaf) {
                        const spec = _dispatcher.spec;
                        const props = _dispatcher.stampProps || spec.emitters.map(e => e.reads[0]);
                        const newRaw = sm.toRaw(newItemProxy);
                        const oldRaw = oldItemProxy != null ? sm.toRaw(oldItemProxy) : null;
                        if (oldRaw && oldRaw !== newRaw) {
                            _dispatcher.rows.delete(oldRaw);
                            for (let p = 0; p < props.length; p++) {
                                _dispatcher.clearLeaf(oldItemProxy, props[p]);
                            }
                        }
                        _dispatcher.rows.set(newRaw, itemEl);
                        for (let p = 0; p < props.length; p++) {
                            _dispatcher.stampLeaf(newItemProxy, itemEl, props[p]);
                        }
                        // Text refresh; class (if any) is re-applied by the existing
                        // onItemUpdate apply sequence below.
                        applyRowTextUpdate(spec, itemEl._cachedElementsArray || itemEl._bindingElements, newRaw, itemEl, null);
                    }

                    // No registry contexts to reindex here: per-item data-show/data-bind
                    // resolve through the row's item proxy + the per-item effect.

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

                                // Refresh the nested list against the new parent item.
                                if (Array.isArray(nestedData)) {
                                    // The nested mapArray's arrayFn reads its data live
                                    // through childContext._parentItemProxy[childPath],
                                    // which we just repointed to newItemProxy above. So
                                    // refreshing the existing nested reconcile effect
                                    // re-diffs the new array against the preserved prev
                                    // (reusing/moving keyed children) instead of disposing
                                    // and rebuilding the whole nested subtree (which
                                    // re-created every nested row on each parent update).
                                    if (nestedListEl._mapArrayInitialized && nestedListEl._refreshMapArray) {
                                        nestedListEl._refreshMapArray();
                                    } else {
                                        self._renderList(nestedListEl, nestedData, childContext, instance);
                                    }
                                }
                            }
                        });
                    });

                    // Rebind the element with the new proxy. This is the row's
                    // sole binding application on a same-key replace (per-row
                    // effects no longer exist).
                    if (compiledMetadata) {
                        const componentState = buildComponentState();
                        const listLength = element.children.length;

                        // Renders FIRST, through the ROW's own records (mirrors
                        // the per-row effect's rebind order). Without this an
                        // effect-less row's RenderRecords go stale on a same-key
                        // replace (nothing re-evaluates them against the new
                        // item) and a later targeted render write then sees
                        // "no change" against an inverted isRendered.
                        if (compiledMetadata.renders?.length > 0 && itemEl._renderContexts) {
                            const renderCtx = {
                                componentState: instance?.state || {},
                                componentInstance: instance,
                                itemIndex: index,
                                listLength: listLength,
                                listContext: context
                            };
                            const renderChanged = self._executeRenders(itemEl._renderContexts, newItemProxy, renderCtx);
                            if (renderChanged) {
                                itemEl._cachedElementsArray = null;
                                itemEl._bindingElements = null;
                            }
                        }

                        // Text + generic bindings, then the shared decor
                        // sequence (same composition as mapFn initial render and
                        // the computed dispatcher's applyRowFull).
                        self._bindWithCompiledMetadata(itemEl, newItemProxy, compiledMetadata, context, index, context, true);
                        self._applyRowDecor(itemEl, newItemProxy, compiledMetadata, index, listLength,
                            componentState, instance, context);
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
                    // Re-evaluate position-frame conditionals that resolve through an
                    // item-level computed (e.g. data-show="onLast"). These carry no
                    // literal _last token, so the sweep above misses them; without
                    // this the row that becomes last after an add/remove keeps a
                    // stale info.last/info.length frame.
                    if (self._listHasComputedConditional(compiledMetadata, instance)) {
                        self._reEvalListItemComputedConditionals(element, newArray, context, instance);
                    }
                }
            }
        );

        // Store dispose function and mark as initialized
        element._mapArrayInitialized = true;
        element._disposeMapArray = disposeMapArray;
        // In-place refresh handle (set by reconcile): lets a parent list that
        // reuses this element on a parent-item-identity change re-diff this list
        // against its preserved prev instead of tearing it down and rebuilding.
        element._refreshMapArray = disposeMapArray && disposeMapArray.__refresh;
        element._mapArrayItemElements = itemElements;

        // === COMPONENT REFRESH EFFECT ===
        // Single effect that watches component-level deps (e.g., selectedId) and
        // refreshes only the affected binding types on existing items.
        // Per-item effects only register COMPUTED deps (via touchComponentLevel above).
        // Simple state vars are handled here: O(2) key lookup for selection patterns,
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
                // only update the items whose class actually changes: O(2) not O(n).
                // Track previous dep values to find old + new affected items.
                const children = element.children;
                const dataLen = children.length;
                const classEvals = compiledMetadata?.classEvaluators;

                // Build current component state once (same cached builder the
                // per-row effects and the dispatcher applier use).
                const componentState = sm.untrack(() => buildComponentState());

                if (classEvals) {
                    // Refresh one row's classes through the shared row applier in
                    // diff-and-remove mode; this channel owns drop-out for
                    // component-dep-driven changes (deselect removes the class).
                    // Merged-context evaluators get an EAGER per-row ctx
                    // (componentState + positionals + item keys, item wins):
                    // the applier's lazy-proxy ctx routes every read through the
                    // reactive item proxy's traps, which measured +19% script
                    // time on selection-heavy updates vs this plain-object build.
                    let refreshNeedsMerged = false;
                    for (const ev of classEvals) {
                        if ((ev.evaluator && ev.evaluator._usesMergedContext) || (!ev.evaluator && ev.expression)) {
                            refreshNeedsMerged = true;
                            break;
                        }
                    }
                    const refreshRowClass = (row, itemProxy, idx) => {
                        let merged = null;
                        if (refreshNeedsMerged) {
                            merged = { ...componentState, _index: idx, _length: dataLen, _first: idx === 0, _last: idx === dataLen - 1 };
                            if (itemProxy) {
                                const keys = Object.keys(itemProxy);
                                for (let k = 0; k < keys.length; k++) merged[keys[k]] = itemProxy[keys[k]];
                            }
                        }
                        self._applyClassBindingsToRow(row, itemProxy, idx, dataLen, classEvals, componentState, instance, context, merged);
                    };

                    // For each changed dep, find the items that reference the old and new values.
                    // Common pattern: id === selectedId; find rows by key lookup.
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

                            // O(1) key->row lookup for the old + new selection rows
                            // (itemElements is keyed by the row's key value, which is
                            // what selectedId-style deps hold). Replaces an O(n) scan
                            // of every row per selection change. Falls through to the
                            // full refresh below if a key isn't found (handled stays
                            // false), preserving correctness for non-key dep values.
                            if (oldVal != null) {
                                const row = itemElements.get(oldVal);
                                if (row && row._itemData) {
                                    refreshRowClass(row, row._itemData, row._listIndex ?? 0);
                                    handled = true;
                                }
                            }
                            if (newVal != null) {
                                const row = itemElements.get(newVal);
                                if (row && row._itemData) {
                                    refreshRowClass(row, row._itemData, row._listIndex ?? 0);
                                    handled = true;
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
            // Computed-template dispatcher: dispose its stable shared-dep effect
            // and drop the dispatcher so a re-render rebuilds against the fresh
            // closure world (static dispatchers hold no effect and can persist).
            const _cd = element._wfListSinkDispatcher;
            if (_cd && _cd.computedRows) {
                try { _cd.dispose(); } catch (e) { /* ignore */ }
                element._wfListSinkDispatcher = null;
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
                const renderCtx = this._processDataRenderElement(conditionalElement, condPath, instance);
                // Drive non-list data-render through the component render effect:
                // track the context so a post-insert effect rescan can re-add it,
                // and push its render meta so the effect observes the condition's
                // computed/state directly (establishing the graph edge).
                if (renderCtx && instance._effectMeta) {
                    (instance._renderContexts || (instance._renderContexts = [])).push(renderCtx);
                    instance._effectMeta.push(this._buildRenderMeta(renderCtx, instance));
                }
            } else {
                // data-show: no registry-tracked conditional context. The component
                // render effect owns initial paint and every update via this 'show'
                // meta (_executeShowForEffect → applyShow, transitions included); the
                // setup-time context paint was a redundant parallel build.
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

        // Create the render record (plain object, not registered; the render
        // effect holds it directly via its type:'render' meta).
        const context = this._contextRecords.createRenderRecord(
            path,
            instance,
            element
        );

        if (context) {
            // Add render-specific properties
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

        return context;
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
     * Escape HTML special characters to prevent XSS.
     * Retained as a standalone HTML-escape utility (the create path now writes
     * textContent directly and needs no escaping); still covered by tests.
     * @param {*} val - Value to escape
     * @returns {string} Escaped string safe for HTML insertion
     */
    // PERF: Pre-compiled regex and lookup map for single-pass HTML escaping
    _escapeHTMLReplaceRegex: /[&<>"']/g,  // Global for replace()
    _escapeHTMLMap: { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' },

    _escapeHTML(val) {
        if (val == null) return '';
        // PERF: Numbers can't contain &<>"', so skip String() and regex entirely
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
     * Bulk create fast path: build rows by cloning a cached row prototype and
     * writing each text binding straight to el.textContent, batched into one
     * DocumentFragment insert. (Replaced the older serialize-to-HTML-string +
     * element.innerHTML reparse, which was ~85% of create script; cloneNode +
     * direct setter writes is the ~4.4us/row ceiling-test approach.)
     *
     * Output is DOM-identical to the old innerHTML path: every text binding in a
     * qualifying template is a plain (non-expression/computed/props/listvar) path,
     * textContent coercion is null -> '', numbers via '' + n, else String, and
     * textContent is inherently injection-safe so no HTML-escape pass is needed
     * (the old path escaped into an HTML string; this writes text directly). Root
     * text bindings (whole-row textContent) are handled here too.
     *
     * Class bindings, the per-row effect, integrations, and the elements array
     * are applied UNCHANGED by the caller's downstream loop (which reuses the
     * row._bindingElements stashed here).
     *
     * @param {Object} compiledMetadata - Template metadata (bindings, elementPaths, innerHTMLParts)
     * @param {Object} instance - Component instance for state/computed access
     * @param {Array} data - Full data array (item proxies)
     * @param {number} startIndex - First item index to render (0 = full create, >0 = append)
     * @param {HTMLElement} element - List container (also the prototype parse context)
     * @param {Array} parts - Pre-split template parts (token-free row HTML = parts.join(''))
     * @returns {boolean} true if rows were built; false only for a degenerate
     *   template with no single root element (caller falls back to the mapFn path).
     * @private
     */
    _buildRowsCloneSetter(compiledMetadata, instance, data, startIndex, element, parts) {
        // Lazily build + cache the row prototype. parts.join('') is the row HTML
        // with empty bind sites (tokens already removed), whitespace already
        // collapsed, framework attrs already stripped. Parsing it inside a clone
        // of the list element reproduces element.innerHTML's parse context, so
        // table-section rows (<tr>/<td>) survive exactly as the innerHTML path
        // would build them.
        let proto = compiledMetadata._rowPrototype;
        if (proto === undefined) {
            const shell = element.cloneNode(false);
            shell.innerHTML = parts.join('');
            proto = shell.firstElementChild || null;
            compiledMetadata._rowPrototype = proto;
        }
        if (!proto) return false; // no single-element row prototype; caller falls back

        const bindings = compiledMetadata.bindings;
        const bcount = bindings.length;
        const endIndex = data.length;
        const listLength = data.length;
        const state = instance?.state || {};
        const computed = instance?.stateManager?.computed || {};
        const stateManager = instance?.stateManager;

        // Root text binding (data-bind on the row root): its value becomes the whole
        // row's textContent. Such templates have no surviving child bindings (root
        // textContent replaces children), so bcount is 0 in that case.
        const rootBindPath = (compiledMetadata.rootBindings && compiledMetadata.rootBindings.hasBind)
            ? compiledMetadata.rootBindings.bindPath : null;

        // needsProxy: simple flat item props are read directly (bypassing the Proxy
        // GET trap); dotted / context / state / computed paths go through a shared
        // merged-context proxy.
        const _isComplex = p => !p || p.includes('.') || p.startsWith('_') || p === '$item' || (p in state) || (p in computed);
        const needsProxy = bindings.some(b => _isComplex(b.path)) || (rootBindPath != null && _isComplex(rootBindPath));

        let currentItem = null;
        let currentIndex = 0;
        let mergedContext = null;
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
        const rootAccessor = rootBindPath ? this._createPropertyAccessor(rootBindPath) : null;

        // PERF: read items off the RAW array, not the reactive proxy. data[i] would
        // fire the array GET trap (creating/caching a per-row proxy) and each
        // item[path] read would fire an object GET trap (~3 trap dispatches/row over
        // 10k rows is the bulk of the create "(program)" cost. Create-time text/value
        // reads are not dependency-tracking (the per-item effect wires reactivity
        // separately from the proxy), so the raw values are identical. Mirrors the
        // raw-target reads already used by the class-copy path and the remove fast path.
        const rawData = stateManager?._proxyTargets?.get(data) || data;

        // Compiled (composed-emitter) text path: for the flat item-prop shape
        // (the !needsProxy fast path), run a per-template emitter set instead of
        // the inline loop. Output is byte-identical by construction (same raw
        // reads, same shared __wf_str writer); class/style/attr and the per-row
        // update effect are applied later by the caller, untouched. A dev
        // shadow-compare verifies the first row against the generic build and
        // disables the path on any mismatch. Force-generic mode or the proxy
        // path opt out.
        const _compileMode = getRowCompileMode();
        const _textSpec = (_compileMode !== 'generic' && !needsProxy && !compiledMetadata._rowCompileDisabled)
            ? getTextEmitters(compiledMetadata) : null;
        let _shadowChecked = compiledMetadata._rowCompileShadowChecked === true;

        const fragment = document.createDocumentFragment();
        for (let i = startIndex; i < endIndex; i++) {
            const item = rawData[i];
            if (!item) continue;

            const row = proto.cloneNode(true);
            const els = this._buildElementsArrayFromMetadata(row, compiledMetadata);

            if (needsProxy) {
                currentItem = item;
                currentIndex = i;
                for (let j = 0; j < bcount; j++) {
                    const b = bindings[j];
                    const el = els[b.index];
                    if (!el) continue;
                    const acc = b._textAccessor || (b._textAccessor = this._createPropertyAccessor(b.path));
                    const v = acc(mergedContext);
                    el.textContent = __wf_str(v);
                }
                if (rootBindPath) {
                    const rv = rootAccessor(mergedContext);
                    row.textContent = __wf_str(rv);
                }
            } else if (_textSpec) {
                // COMPILED PATH: run the per-template text-emitter set.
                applyRowText(_textSpec, els, item, row);
                if (__DEV__ && !_shadowChecked) {
                    _shadowChecked = true;
                    compiledMetadata._rowCompileShadowChecked = true;
                    shadowCompareRow(compiledMetadata, row, item, proto,
                        (r) => this._buildElementsArrayFromMetadata(r, compiledMetadata));
                }
            } else {
                // FAST PATH: all bindings are simple item properties; direct read,
                // direct textContent write, no calls (the flat text-row shape).
                for (let j = 0; j < bcount; j++) {
                    const b = bindings[j];
                    const el = els[b.index];
                    if (!el) continue;
                    const v = item[b.path];
                    el.textContent = __wf_str(v);
                }
                if (rootBindPath) {
                    const rv = item[rootBindPath];
                    row.textContent = __wf_str(rv);
                }
            }

            // Stash the elements array so the caller's downstream per-row loop
            // reuses it instead of walking the element paths a second time.
            row._bindingElements = els;
            fragment.appendChild(row);
        }

        if (startIndex === 0) {
            // FULL CREATION: clear then insert (the container is normally already
            // empty at full create), mirroring the old element.innerHTML = ...
            element.replaceChildren(fragment);
        } else {
            // APPEND MODE: insert new rows at end without disturbing existing ones.
            element.appendChild(fragment);
        }
        return true;
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
        // Lazy ctx for compiled (_usesMergedContext) evaluators, which consume the
        // context GET-only. Kept separate from the eager `mergedCtx` so it never
        // reaches the fallback path's Object.keys(). Built on first need only.
        let lazyMergedCtx = null;

        // Item-level computeds (fn(item) with fn.length > 0) must be evaluated
        // per item, so they can't be in any cached/prebuilt mergedCtx. They go
        // into mergedCtx so expressions like `{ shared: isShared }` and
        // `isShared ? 'on' : ''` resolve correctly.
        //
        // Skip the eager evaluation entirely when no evaluator on this row
        // needs the merged context; every simple-property class binding
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

            // Runtime-resolved forms (computed:NAME, external(), $store
            // shorthand): the compiled merged-ctx evaluator cannot express
            // these (it compiles to garbage and returns falsy, which the
            // diff-tracking applyClass kernel would honor as a clear).
            // Delegate to the attribute-path resolver: the same strategies the
            // executor path uses, applied through the same kernel. Classified
            // once per evaluator (this loop runs per row).
            let _rtForm = evaluator._rtForm;
            if (_rtForm === undefined) {
                const e = evaluator.expression;
                _rtForm = !!(e && (e.startsWith('computed:')
                    || e.indexOf('external(') !== -1 || /\$[a-zA-Z]/.test(e)));
                evaluator._rtForm = _rtForm;
            }
            if (_rtForm) {
                this._processOptimizedClassBinding(targetEl, item, evaluator.expression, index, listContext);
                continue;
            }
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
                        // Compiled evaluator consumes the ctx GET-only, so use the cheap
                        // lazy proxy instead of the {...item, ...componentState} spread.
                        // The proxy spread triggers ownKeys + a GET for every item
                        // property (V8); on a same-key replace that is ~9% of update
                        // time for a class that never changes. Mirrors the lazy ctx
                        // already used by _applyStyleBindingsToRow/_applyAttrBindingsToRow.
                        // Prefer an eager mergedCtx if one was already built above (it
                        // carries the seeded item-level computed values).
                        let ctx = mergedCtx;
                        if (!ctx) {
                            if (!lazyMergedCtx) {
                                lazyMergedCtx = this._buildClassMergedCtxLazy(item, componentState, instance, index, dataLen);
                            }
                            ctx = lazyMergedCtx;
                        }
                        classValue = evaluator.evaluator(ctx);
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

            // ONE application semantics for every class channel: the
            // BindingWriters applyClass kernel (diff-tracked via
            // _prevBoundClasses, early-exit on unchanged set, string/array/
            // object normalization, falsy clears). _executeClassBindings and
            // every fallback route through the same kernel
            // (_toggleBoundClass -> applyClass), so mixed writers on one
            // element agree byte-for-byte; two writers with different
            // semantics sharing _prevBoundClasses is a known hazard. The
            // refresh channel's diff-and-remove (deselect) is the kernel's
            // native behavior.
            applyClass(targetEl, classValue);
        }
    },

    /**
     * Build the merged context object for class-binding expression evaluation.
     *
     * Includes: item properties, component state, list-context vars, AND
     * item-level computed VALUES (computeds defined as `fn(item) { ... }` with
     * fn.length > 0, called once per row with the current item).
     *
     * Without item-level computeds in the merged context, expressions like
     * `{ shared: isShared }` and `isShared ? 'on' : ''` see `isShared` as
     * undefined because component-level state spread doesn't include them
     * (they require an item argument).
     *
     * @private
     */
    // Lazy equivalent of _buildClassMergedCtx for GET-only (compiled-evaluator)
    // consumption. Resolves the same precedence as the eager builder
    // (item-level computed not shadowed by an item key > componentState > item,
    // plus the _index/_length/_first/_last positionals) but without the
    // {...item, ...componentState} spread and without eagerly evaluating every
    // computed; each is resolved on access. Not Object.keys-safe (no ownKeys
    // trap), so it is used only where the consumer reads named properties.
    _buildClassMergedCtxLazy(item, componentState, instance, index, dataLen) {
        const _idx = index, _len = dataLen;
        const origComputeds = instance?.stateManager?._originalComputedFunctions;
        const self = this;
        return new Proxy(item, {
            get(target, prop) {
                if (prop === '_index') return _idx;
                if (prop === '_length') return _len;
                if (prop === '_first') return _idx === 0;
                if (prop === '_last') return _idx === _len - 1;
                // Item-level computed whose name is NOT an own item key overrides
                // componentState and item (matches the eager loop's `!(key in item)`
                // guard). Use _evaluateComputedInListContext so dependency tracking
                // sees the reads (direct fn.call bypasses tracking).
                if (origComputeds && !(prop in target)) {
                    const fn = origComputeds.get(prop);
                    if (fn && typeof fn === 'function') {
                        try {
                            return self._evaluateComputedInListContext(instance, prop, item, _idx, null);
                        } catch (e) { return undefined; }
                    }
                }
                // componentState wins over item (eager spread order: item then componentState)
                if (componentState && prop in componentState) return componentState[prop];
                return target[prop];
            }
        });
    },

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
        // Item own-properties win: if item has a key matching a computed name,
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
        // PERF: Reusable lazy proxy; avoids spreading item + componentState per evaluator.
        // Destructuring `const {x, y} = ctx` only calls GET for needed properties (no ownKeys).
        // V8 proxy spread ({...proxy}) triggers ownKeys + ALL property GETs; extremely slow.
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
            // Runtime-resolved forms (external()/$store): the compiled
            // evaluator cannot express them; delegate to the generic
            // processor, classified once per evaluator.
            let _rtForm = evaluator._rtForm;
            if (_rtForm === undefined) {
                const e = evaluator.expression;
                _rtForm = !!(e && (e.indexOf('external(') !== -1 || /\$[a-zA-Z]/.test(e)));
                evaluator._rtForm = _rtForm;
            }
            if (_rtForm) {
                this._processStyleBinding(targetEl, item, evaluator.expression, index, listContext);
                continue;
            }
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
            if (resultObject && typeof resultObject === 'object') {
                // The BindingWriters kernel owns object-form style application
                // (stale-key cleanup via _boundStyleProps + applyStyleProp
                // per prop).
                applyStyleObj(targetEl, resultObject);
            }
        }
    },

    /**
     * The ONE decorative (class/style/attr) row-apply sequence, shared by
     * every full-row composition (mapFn initial render, the computed
     * dispatcher's applyRowFull, onItemUpdate's same-key rebind, the render
     * arm's post-flip re-apply). The evaluator fast paths own each kind:
     * they cover indexed AND root targets, and fall back per-evaluator to
     * the generic processors for runtime-resolved expression forms.
     * @private
     */
    _applyRowDecor(rowEl, item, md, index, dataLen, componentState, instance, listContext) {
        // No root fallbacks needed: _compileTemplate unshifts a root evaluator
        // entry whenever rootBindings carry a style/attr expression, so the
        // evaluator arrays cover every decorative binding present.
        if (md.classEvaluators?.length) {
            this._applyClassBindingsToRow(rowEl, item, index, dataLen, md.classEvaluators, componentState, instance, listContext);
        }
        if (md.styleEvaluators?.length) {
            this._applyStyleBindingsToRow(rowEl, item, index, dataLen, md.styleEvaluators, componentState, instance, listContext);
        }
        if (md.attrEvaluators?.length) {
            this._applyAttrBindingsToRow(rowEl, item, index, dataLen, md.attrEvaluators, componentState, instance, listContext);
        }
    },

    /**
     * Whether the component instance has ANY registered computed properties.
     * Used to fast-path past the binding-reactivity bypass logic for
     * components that declare no computeds; every per-binding
     * `computeds[name]` lookup would miss, so the bypass can be skipped
     * entirely.
     *
     * Checked live (no cache) because caching breaks if a computed is
     * registered AFTER the first list-binding evaluation queries the
     * cache; the stale `false` would make all subsequent bypass checks
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
            // Runtime-resolved forms (external()/$store): the compiled
            // evaluator cannot express them; delegate to the generic
            // processor, classified once per evaluator.
            let _rtForm = evaluator._rtForm;
            if (_rtForm === undefined) {
                const e = evaluator.expression;
                _rtForm = !!(e && (e.indexOf('external(') !== -1 || /\$[a-zA-Z]/.test(e)));
                evaluator._rtForm = _rtForm;
            }
            if (_rtForm) {
                this._processAttrBinding(targetEl, item, evaluator.expression, index, listContext);
                continue;
            }
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
            if (resultObject && typeof resultObject === 'object') {
                // Canonical attr-object writer (blocklist / sanitize / boolean-attr
                // semantics + stale-key cleanup), the same path the expression and
                // component bindings use, so the compiled-evaluator fast path can't
                // drift from them.
                applyAttrObj(targetEl, resultObject, this._attrWriterHelpers || (this._attrWriterHelpers = {
                    isBlocklisted: (prop) => this._isBlocklistedAttr && this._isBlocklistedAttr(prop),
                    sanitize: (prop, v) => this._sanitizeAttrValue ? this._sanitizeAttrValue(prop, v) : v
                }));
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

        this._computeDeps(compiledMetadata);

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

        // Unified per-binding consumer driven by _deps. Partitions reads into
        // component-level deps (addVar skips item-level names). A whole-binding
        // computed reference registers the computed if it is a known computed.
        const consume = (d) => {
            switch (d.kind) {
                case 'skip':
                case 'itemPath':
                    return; // model binds an item field; no component dep
                case 'computedName':
                    if (sm?.computed?.[d.reads[0]]) deps.add('computed:' + d.reads[0]);
                    return;
                case 'path':
                case 'expr':
                    for (let i = 0; i < d.reads.length; i++) addVar(d.reads[i]);
                    return;
            }
        };

        const arrays = [
            compiledMetadata.bindings, compiledMetadata.classBindings,
            compiledMetadata.styleBindings, compiledMetadata.attrBindings,
            compiledMetadata.models, compiledMetadata.shows,
            compiledMetadata.htmlBindings, compiledMetadata.renders
        ];
        for (const arr of arrays) {
            if (!arr) continue;
            for (const b of arr) consume(b._deps);
        }
        if (compiledMetadata.rootBindings?._deps) {
            for (const d of compiledMetadata.rootBindings._deps) consume(d);
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
     * Single source of truth for per-binding dependency classification.
     *
     * Attaches `_deps = { kind, reads, paths }` to every binding in the compiled
     * metadata (and a normalized `rootBindings._deps` array). The four dependency
     * consumers (_extractStaticItemProps, _extractComponentDeps, the per-item
     * first-run walk, and the class-only classifier) all read this instead of
     * re-deriving the per-type branching from the raw flags. Idempotent and
     * cached via metadata._depsComputed, so the cost is one-time per template
     * (amortized over every row created from it).
     *
     * kind:
     *   'skip'         - no item/component deps (computed:/props:/list-context var)
     *   'itemPath'     - touch item path only; no component reg, never bails (model)
     *   'path'         - single identifier that may name a computed
     *   'expr'         - expression; reads = identifiers, paths = dotted member paths
     *   'computedName' - the whole binding is a computed reference (always bail/eval)
     *
     * `reads` are raw identifiers; consumers apply their own _/computed:/props:
     * filtering and item-vs-component partitioning. `paths` are full dotted member
     * paths for nested-leaf registration (expr only; null otherwise).
     * @private
     */
    _computeDeps(metadata) {
        if (!metadata || metadata._depsComputed) return;
        metadata._depsComputed = true;

        const skip = { kind: 'skip', reads: [], paths: null };
        const exprDeps = (b) => ({
            kind: 'expr',
            reads: b.expressionVars || (b.expression ? this._extractExpressionVars(b.expression) : []),
            paths: b.expressionPaths || (b.expression ? this._extractExpressionPaths(b.expression) : null)
        });
        // show / html / render: an expression (with vars) is 'expr', else a path.
        // Applying this uniformly to html is the drift fix; the old static
        // extractors treated html as path-only and ignored html expressions.
        const exprOrPath = (b) => (b.isExpression && b.expressionVars)
            ? { kind: 'expr', reads: b.expressionVars, paths: b.expressionPaths || null }
            : { kind: 'path', reads: [b.path], paths: null };

        for (const b of (metadata.bindings || [])) {
            if (b.isExpression) {
                b._deps = b.expressionVars ? exprDeps(b) : skip;
            } else if (b.isComputed || b.isPropsPath || b.isListContextVar) {
                b._deps = skip;
            } else {
                b._deps = { kind: 'path', reads: [b.path], paths: null };
            }
        }

        for (const cb of (metadata.classBindings || [])) {
            if (cb.isComputed && cb.expression) {
                const name = cb.expression.startsWith('computed:') ? cb.expression.slice(9) : cb.expression;
                cb._deps = { kind: 'computedName', reads: [name], paths: null };
            } else if (cb.isSimpleProperty && cb.expression) {
                cb._deps = { kind: 'path', reads: [cb.expression], paths: null };
            } else if (cb.expression) {
                cb._deps = exprDeps(cb);
            } else {
                cb._deps = skip;
            }
        }

        for (const sb of (metadata.styleBindings || [])) {
            sb._deps = sb.expression ? exprDeps(sb) : skip;
        }
        for (const ab of (metadata.attrBindings || [])) {
            ab._deps = ab.expression ? exprDeps(ab) : skip;
        }

        for (const mb of (metadata.models || [])) {
            mb._deps = { kind: 'itemPath', reads: [mb.path], paths: null };
        }

        for (const sh of (metadata.shows || [])) sh._deps = exprOrPath(sh);
        for (const hb of (metadata.htmlBindings || [])) hb._deps = exprOrPath(hb);
        for (const rb of (metadata.renders || [])) rb._deps = exprOrPath(rb);

        const rbm = metadata.rootBindings;
        if (rbm) {
            const rootDeps = [];
            if (rbm.bindPath) rootDeps.push({ field: 'bindPath', kind: 'path', reads: [rbm.bindPath], paths: null });
            if (rbm.showPath) rootDeps.push({ field: 'showPath', kind: 'path', reads: [rbm.showPath], paths: null });
            if (rbm.modelPath) rootDeps.push({ field: 'modelPath', kind: 'itemPath', reads: [rbm.modelPath], paths: null });
            if (rbm.bindClassExpr) {
                const e = rbm.bindClassExpr;
                rootDeps.push(e.startsWith('computed:')
                    ? { field: 'bindClassExpr', kind: 'computedName', reads: [e.slice(9)], paths: null }
                    : { field: 'bindClassExpr', kind: 'expr', reads: this._extractExpressionVars(e), paths: this._extractExpressionPaths(e) });
            }
            if (rbm.bindStyleExpr) {
                rootDeps.push({ field: 'bindStyleExpr', kind: 'expr', reads: this._extractExpressionVars(rbm.bindStyleExpr), paths: this._extractExpressionPaths(rbm.bindStyleExpr) });
            }
            if (rbm.bindAttrExpr) {
                rootDeps.push({ field: 'bindAttrExpr', kind: 'expr', reads: this._extractExpressionVars(rbm.bindAttrExpr), paths: this._extractExpressionPaths(rbm.bindAttrExpr) });
            }
            rbm._deps = rootDeps;
        }
    },

    /**
     * Item props read by the row's class/style/attr bindings (the "decorative"
     * read set), used by the effect-retire dispatcher to decide whether a changed
     * item leaf requires re-applying class/style/attr; a text-only change skips
     * that work (otherwise update-10th-style benchmarks re-run class eval per row
     * for nothing). Class always lives in classBindings (even on the row root), so
     * it is captured here; root STYLE/ATTR (rootBindings.bindStyle/AttrExpr) cannot
     * be separated from root text in rootBindings._deps, so their presence returns
     * null = "always re-apply" (correct, just not update-optimized). Flat props
     * only (eligible templates have no nested reads). Cached on the metadata.
     * @private
     */
    _extractDecorativeReadProps(compiledMetadata) {
        let cached = compiledMetadata._decorativeReadProps;
        if (cached !== undefined) return cached;
        this._computeDeps(compiledMetadata);
        const rb = compiledMetadata.rootBindings;
        if (rb && (rb.hasBindStyle || rb.hasBindAttr)) {
            compiledMetadata._decorativeReadProps = null;
            return null;
        }
        const props = new Set();
        const add = (p) => {
            if (!p || typeof p !== 'string') return;
            if (p.startsWith('_') || p.startsWith('computed:') || p.startsWith('props:')) return;
            if (p.startsWith('!')) p = p.slice(1);
            if (p) props.add(p.indexOf('.') !== -1 ? p.slice(0, p.indexOf('.')) : p);
        };
        const arrays = [compiledMetadata.classBindings, compiledMetadata.styleBindings, compiledMetadata.attrBindings];
        for (const arr of arrays) {
            if (!arr) continue;
            for (const b of arr) {
                const d = b._deps;
                if (!d) continue;
                if (d.reads) for (let i = 0; i < d.reads.length; i++) add(d.reads[i]);
                if (d.paths) for (let i = 0; i < d.paths.length; i++) add(d.paths[i]);
            }
        }
        compiledMetadata._decorativeReadProps = props;
        return props;
    },

    /**
     * Classify a row template for the ReactiveGraph fast first-run (touchItemLeaves).
     * Returns the flat list of item-prop paths to edge-link IF every reactive dep
     * is a flat property present on the row's own item, i.e. _extractStaticItemProps
     * resolved statically (no computeds, returns non-null) AND no read is nested or
     * a component-state field. In that case forming the leaf edges directly is
     * EQUIVALENT to the consumeDep first run (which, for an item prop, only does the
     * one item touchPath; touchComponentLevel returns early on `v in itemProxy`).
     * Returns null to fall back to the full first run for anything richer (nested
     * paths, component-state/computed reads, expressions over component state).
     * Cached by the caller on metadata._reactiveGraphFastTouch.
     * @private
     */
    _computeReactiveGraphFastTouch(metadata, instance, sampleItem) {
        if (!sampleItem || typeof sampleItem !== 'object') return null;
        this._computeDeps(metadata);
        const reserved = this._expressionReservedWords;
        const itemProps = new Set();
        // ANY computed read (item- OR component-level) forces the full first run:
        // the generic path EVALUATES the computed under this row's effect (via
        // evalItemLevelComputed*), which forms the edges to whatever the computed
        // reads: component state, a store (cross-entity), or other item fields.
        // Fast-touch only forms flat item-prop edges, so it would drop those and
        // the binding would stop reacting (e.g. a class reading a store-backed
        // computed). Note the component refresh effect does NOT cover computed
        // class deps under ReactiveGraph (_registerComponentDep is a no-op), so the
        // per-item effect's computed eval is load-bearing -> bail on any computed.
        let computedNames = null;
        const _addC = (name) => { (computedNames || (computedNames = new Set())).add(name); };
        const _oc = instance?.stateManager?._originalComputedFunctions;
        if (_oc) for (const [name, fn] of _oc) { if (typeof fn === 'function') _addC(name); }
        const _cm = instance?.stateManager?.computed;
        if (_cm) for (const name in _cm) _addC(name);
        const refsComputed = (v) => computedNames !== null && computedNames.has(v);
        // A read is usable iff it is a flat property present on the row's own item.
        // In a NON-class binding, any non-item read is a real per-item component
        // dep (or computed) that consumeDep would register but fast-touch can't form
        // -> bail. In a CLASS binding, a non-item read is class-only (the component
        // refresh effect owns it; the per-item effect never registers it), so it is
        // simply skipped. Nested paths and computed-name bindings always bail.
        const collect = (deps, isClass) => {
            if (!deps) return true;
            switch (deps.kind) {
                case 'skip': return true;
                case 'computedName': return false;
                case 'itemPath':
                case 'path': {
                    const r = deps.reads[0];
                    if (!r) return true;
                    if (r.indexOf('.') !== -1 || refsComputed(r)) return false;
                    if (r in sampleItem) { itemProps.add(r); return true; }
                    return isClass; // non-item read: ok (skip) only in a class binding
                }
                case 'expr': {
                    const reads = deps.reads || [];
                    for (let i = 0; i < reads.length; i++) {
                        const v = reads[i];
                        if (!v || (reserved && reserved.has(v)) || v.charAt(0) === '_') continue;
                        if (v.indexOf('.') !== -1 || refsComputed(v)) return false;
                        if (v in sampleItem) itemProps.add(v);
                        else if (!isClass) return false;
                    }
                    if (deps.paths) for (let i = 0; i < deps.paths.length; i++) {
                        if (deps.paths[i].indexOf('.') !== -1) return false;
                    }
                    return true;
                }
            }
            return true;
        };
        const nonClass = [metadata.bindings, metadata.styleBindings, metadata.attrBindings,
                          metadata.models, metadata.shows, metadata.htmlBindings, metadata.renders];
        for (const arr of nonClass) { if (!arr) continue; for (const b of arr) if (!collect(b._deps, false)) return null; }
        for (const cb of (metadata.classBindings || [])) if (!collect(cb._deps, true)) return null;
        if (metadata.rootBindings?._deps) {
            for (const d of metadata.rootBindings._deps) {
                if (!collect(d, d.field === 'bindClassExpr')) return null;
            }
        }
        return itemProps.size ? Array.from(itemProps) : null;
    },

    /**
     * Classify a row template's "pure single-text" fields for the ReactiveGraph targeted
     * text-write fast path. Returns Map<field, elementIndex> for each flat field
     * that is bound to exactly one plain text node (singleTextProp) AND is read by
     * NO other binding (class/style/attr/show/html/render/model/expr-text/root);
     * so a write to that field can update its one text node alone, leaving every
     * other binding untouched (they don't depend on it). Returns null if the
     * template has no such field. Cached by the caller on metadata._reactiveGraphPureText.
     * @private
     */
    // Stamp a direct TEXT writer on a row field's graph node: subsequent writes to
    // that field set the bound text node directly, skipping the per-item effect wake
    // and the onStateChange dispatch (notifyNode returns DIRECT_HANDLED). The closure
    // is built HERE (a DOM concern) and stamped through the generic facade
    // stampDirectWriter; the isConnected guard travels with it so a detached row's
    // stale writer self-clears and falls back to the effect wake. Gated by the
    // caller to _reactiveGraphPureText fields (read by no computed/other binding).
    _stampDirectText(sm, itemProxy, key, el) {
        // Shared writer (module-level) + el stored on the node; no per-row closure.
        sm.stampDirectWriter(itemProxy, key, SHARED_TEXT_WRITER, el);
    },

    /**
     * Retire-safety gate for ALL direct-writer kinds (text/style/attr). A direct
     * writer suppresses BOTH the graph observer wake and the per-write
     * onStateChange dispatch (notifyNode DIRECT_HANDLED), so stamping is only
     * sound when nothing besides the row's own binding can read the leaf:
     *   - no component computeds (an aggregate over item fields forms real graph
     *     edges the writer would starve);
     *   - no watchers and no imperative subscriptions (both ride the suppressed
     *     onStateChange dispatch);
     *   - no autoSave persistence (also rides the dispatch).
     * The template-static gates (_reactiveGraphPureText / _fastTouch) cannot see
     * any of these; they only prove no OTHER TEMPLATE BINDING reads the field.
     * Constant per component; callers cache it on metadata._reactiveGraphStyleSafe.
     * @private
     */
    _computeReactiveGraphRetireSafe(sm, instance) {
        const _oc = instance?.stateManager?._originalComputedFunctions;
        return Object.keys((sm && sm.computed) || {}).length === 0
            && (!_oc || _oc.size === 0)
            && !(instance && instance._watcherHandlers && instance._watcherHandlers.size > 0)
            && !(sm && sm._subscriptions && sm._subscriptions.size > 0)
            && !(sm && sm.autoSave && sm.storageKey);
    },

    // Style analog of _stampDirectText, for one CSS property of a pure
    // data-bind-style object literal (`{ transform: tf }`) whose value is a bare
    // item field. Same suppression + detach-guard contract.
    _stampDirectStyle(sm, itemProxy, key, el, cssProp) {
        sm.stampDirectWriter(itemProxy, key, (target) => {
            if (!el.isConnected) return false;
            applyStyleProp(el.style, cssProp, target[key]);
            return true;
        });
    },

    // Attr analog: one attribute of a pure data-bind-attr object literal whose
    // value is a bare item field. Same suppression + detach-guard contract.
    _stampDirectAttr(sm, itemProxy, key, el, attrName) {
        const self = this;
        sm.stampDirectWriter(itemProxy, key, (target) => {
            if (!el.isConnected) return false;
            const v = target[key];
            if (v === null || v === undefined || v === false) {
                el.removeAttribute(attrName);
            } else {
                const s = self._sanitizeAttrValue(attrName, v);
                if (s !== null) el.setAttribute(attrName, String(s));
            }
            return true;
        });
    },

    _computeReactiveGraphPureText(metadata) {
        const stp = metadata.singleTextProp;
        if (!stp || stp.size === 0) return null;
        this._computeDeps(metadata);
        // Vars referenced by any binding OTHER than a plain single-ref text binding.
        const usedElsewhere = new Set();
        const collect = (deps) => {
            if (!deps || deps.kind === 'skip') return;
            const reads = deps.reads || [];
            for (let i = 0; i < reads.length; i++) usedElsewhere.add(reads[i]);
            if (deps.paths) for (let i = 0; i < deps.paths.length; i++) usedElsewhere.add(deps.paths[i]);
        };
        for (const arr of [metadata.classBindings, metadata.styleBindings, metadata.attrBindings,
                           metadata.shows, metadata.htmlBindings, metadata.renders, metadata.models]) {
            if (!arr) continue; for (const b of arr) collect(b._deps);
        }
        // Expression text bindings count as "other" use too (only single-ref text
        // bindings qualify a field as pure).
        for (const b of (metadata.bindings || [])) { if (b.isExpression) collect(b._deps); }
        if (metadata.rootBindings?._deps) for (const d of metadata.rootBindings._deps) collect(d);
        let pure = null;
        for (const [field, idx] of stp) {
            if (field.indexOf('.') !== -1) continue;   // flat fields only (leaf key == path)
            if (usedElsewhere.has(field)) continue;    // referenced elsewhere -> not pure
            (pure || (pure = new Map())).set(field, idx);
        }
        return pure;
    },

    /**
     * Parse a `data-bind-style` expression as a PURE object literal mapping CSS
     * properties to bare item-field identifiers, e.g. `{ transform: tf, background: bg }`
     * -> [{cssProp:'transform', field:'tf'}, {cssProp:'background', field:'bg'}].
     * Returns null for anything that is not exactly that shape (member access,
     * calls, ternaries, literals, nested objects, spreads, computed keys) so the
     * caller falls back to the general evaluator. Conservative by construction:
     * each value must be a single bare identifier; keys may be identifiers or
     * quoted strings (kebab CSS names).
     * @private
     */
    _parsePureStyleObjectLiteral(expr) {
        if (typeof expr !== 'string') return null;
        const s = expr.trim();
        if (s.length < 2 || s.charCodeAt(0) !== 123 /* { */ || s.charCodeAt(s.length - 1) !== 125 /* } */) return null;
        const inner = s.slice(1, -1).trim();
        if (inner.length === 0) return null;
        // Bare values only -> no nesting/operators. Reject anything that could make
        // a comma-split unsafe or imply a non-trivial value expression.
        if (/[(){}\[\]?]/.test(inner)) return null;
        const parts = inner.split(',');
        const out = [];
        const identRe = /^[A-Za-z_$][\w$]*$/;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();
            if (part.length === 0) return null; // trailing comma / empty entry
            const colon = part.indexOf(':');
            if (colon === -1) return null;      // shorthand / no value
            let key = part.slice(0, colon).trim();
            const val = part.slice(colon + 1).trim();
            if (!identRe.test(val)) return null; // value must be a single bare identifier
            // Key: identifier (camelCase CSS prop) or quoted string (kebab CSS name).
            if (key.length >= 2 && (key.charCodeAt(0) === 39 || key.charCodeAt(0) === 34)
                && key.charCodeAt(key.length - 1) === key.charCodeAt(0)) {
                key = key.slice(1, -1);
                if (key.length === 0) return null;
            } else if (!identRe.test(key)) {
                return null;
            }
            out.push({ cssProp: key, field: val });
        }
        return out.length ? out : null;
    },

    /**
     * Classify a row template's `data-bind-style` bindings for the ReactiveGraph
     * direct-style-writer fast path. Returns an array of per-field specs
     * `{cssProp, field, isRoot, elIndex}` when EVERY style evaluator is a pure
     * object literal of bare item fields, each field is a flat property present on
     * the item, maps to exactly one CSS prop, and is read by NO other binding
     * (text/class/attr/show/html/render/model/other-style). Returns null otherwise.
     * A write to such a field can set its one CSS property directly and suppress
     * the effect wake + onStateChange dispatch (notifyNode DIRECT_HANDLED), leaving
     * every other binding untouched. The caller gates on _reactiveGraphFastTouch
     * (no binding references a computed) before stamping. Cached on
     * metadata._reactiveGraphPureStyle.
     * @private
     */
    _computeReactiveGraphPureStyle(metadata, sampleItem) {
        if (!sampleItem || typeof sampleItem !== 'object') return null;
        const styleEvals = metadata.styleEvaluators;
        if (!styleEvals || styleEvals.length === 0) return null;
        this._computeDeps(metadata);
        // Group per item field -> { cssProp, targets[] }. A field may appear in more
        // than one evaluator (a root `data-bind-style` is registered both as an
        // isRoot evaluator AND an indexed one that resolve to the same element); the
        // caller resolves each target's element and stamps a single writer iff they
        // all land on the same element. A field mapping to two DIFFERENT CSS props
        // can't use one writer -> bail.
        const byField = new Map();
        for (const ev of styleEvals) {
            if (ev.isComputed || !ev.expression) return null;
            const decomp = this._parsePureStyleObjectLiteral(ev.expression);
            if (!decomp) return null;
            for (let d = 0; d < decomp.length; d++) {
                const field = decomp[d].field, cssProp = decomp[d].cssProp;
                if (field.indexOf('.') !== -1) return null;     // flat fields only
                if (field.charCodeAt(0) === 95 /* _ */) return null; // _index/_first etc.
                if (!(field in sampleItem)) return null;        // must be an item prop
                let entry = byField.get(field);
                if (!entry) { entry = { cssProp, targets: [] }; byField.set(field, entry); }
                else if (entry.cssProp !== cssProp) return null; // same field -> 2 css props
                entry.targets.push({ isRoot: !!ev.isRoot, elIndex: ev.index, elementPath: ev.elementPath });
            }
        }
        if (byField.size === 0) return null;
        // Each field must be read by NO binding other than these style evaluators;
        // otherwise suppressing its effect wake would stop that other binding from
        // updating. Mirrors _computeReactiveGraphPureText's usedElsewhere analysis,
        // excluding styleBindings/the root style dep (those ARE our fields).
        const usedElsewhere = new Set();
        const collect = (deps) => {
            if (!deps || deps.kind === 'skip') return;
            const reads = deps.reads || [];
            for (let i = 0; i < reads.length; i++) usedElsewhere.add(reads[i]);
            if (deps.paths) for (let i = 0; i < deps.paths.length; i++) usedElsewhere.add(deps.paths[i]);
        };
        for (const arr of [metadata.bindings, metadata.classBindings, metadata.attrBindings,
                           metadata.shows, metadata.htmlBindings, metadata.renders, metadata.models]) {
            if (!arr) continue; for (const b of arr) collect(b._deps);
        }
        if (metadata.rootBindings?._deps) {
            for (const d of metadata.rootBindings._deps) {
                if (d.field === 'bindStyleExpr') continue; // our root style binding
                collect(d);
            }
        }
        for (const field of byField.keys()) if (usedElsewhere.has(field)) return null;
        return byField;
    },

    /**
     * Classify a row template's `data-bind-attr` bindings for the direct-writer
     * fast path, the structural twin of _computeReactiveGraphPureStyle. Returns
     * Map<field, {attrName, targets[]}> when every attr evaluator is a pure object
     * literal of bare item fields, each a flat item prop mapped 1:1 to one
     * non-blocklisted attribute and read by NO other binding (text/class/style/
     * show/html/render/model). The caller resolves targets to a single element and
     * stamps a writer matching the list attr path's semantics (false/null/undefined
     * -> removeAttribute; else setAttribute(name, String(sanitize(value)))). Returns
     * null otherwise. Cached via _computeReactiveGraphPureLeaves.
     * @private
     */
    _computeReactiveGraphPureAttr(metadata, sampleItem) {
        if (!sampleItem || typeof sampleItem !== 'object') return null;
        const attrEvals = metadata.attrEvaluators;
        if (!attrEvals || attrEvals.length === 0) return null;
        this._computeDeps(metadata);
        const byField = new Map();
        for (const ev of attrEvals) {
            if (ev.isComputed || !ev.expression) return null;
            const decomp = this._parsePureStyleObjectLiteral(ev.expression); // generic {key: bareField} parse
            if (!decomp) return null;
            for (let d = 0; d < decomp.length; d++) {
                const field = decomp[d].field, attrName = decomp[d].cssProp;
                if (field.indexOf('.') !== -1) return null;
                if (field.charCodeAt(0) === 95 /* _ */) return null;
                if (!(field in sampleItem)) return null;
                if (this._isBlocklistedAttr(attrName)) continue; // never direct-write a blocklisted attr
                let entry = byField.get(field);
                if (!entry) { entry = { attrName, targets: [] }; byField.set(field, entry); }
                else if (entry.attrName !== attrName) return null; // same field -> 2 attrs
                entry.targets.push({ isRoot: !!ev.isRoot, elIndex: ev.index, elementPath: ev.elementPath });
            }
        }
        if (byField.size === 0) return null;
        // Each field read by NO binding other than these attr evaluators; exclude
        // attrBindings/the root attr dep (those ARE our fields), include everything else.
        const usedElsewhere = new Set();
        const collect = (deps) => {
            if (!deps || deps.kind === 'skip') return;
            const reads = deps.reads || [];
            for (let i = 0; i < reads.length; i++) usedElsewhere.add(reads[i]);
            if (deps.paths) for (let i = 0; i < deps.paths.length; i++) usedElsewhere.add(deps.paths[i]);
        };
        for (const arr of [metadata.bindings, metadata.classBindings, metadata.styleBindings,
                           metadata.shows, metadata.htmlBindings, metadata.renders, metadata.models]) {
            if (!arr) continue; for (const b of arr) collect(b._deps);
        }
        if (metadata.rootBindings?._deps) {
            for (const d of metadata.rootBindings._deps) {
                if (d.field === 'bindAttrExpr') continue; // our root attr binding
                collect(d);
            }
        }
        for (const field of byField.keys()) if (usedElsewhere.has(field)) return null;
        return byField;
    },

    /**
     * Unified per-row direct-writer classifier: composes the pure-text and
     * pure-style classifiers into ONE Map<field, spec> the per-item effect's
     * single stamp loop consumes. spec = {kind:'text', elIdx} | {kind:'style',
     * cssProp, targets[]}. Each sub-classifier already excludes fields used by
     * the OTHER kind's bindings (pureText's usedElsewhere includes styleBindings;
     * pureStyle's includes text bindings), so a field can be at most one kind;
     * the collision guard is belt-and-suspenders. Returns null when no field
     * qualifies. Cached by the caller on metadata._reactiveGraphPureLeaves.
     * Extension point: add a kind here (attr/show) by composing its classifier.
     * @private
     */
    _computeReactiveGraphPureLeaves(metadata, sampleItem) {
        let leaves = null;
        const text = this._computeReactiveGraphPureText(metadata);
        if (text) {
            for (const [field, elIdx] of text) {
                (leaves || (leaves = new Map())).set(field, { kind: 'text', elIdx });
            }
        }
        const style = this._computeReactiveGraphPureStyle(metadata, sampleItem);
        if (style) {
            for (const [field, entry] of style) {
                if (leaves && leaves.has(field)) { leaves.delete(field); continue; } // ambiguous: drop
                (leaves || (leaves = new Map())).set(field, { kind: 'style', cssProp: entry.cssProp, targets: entry.targets });
            }
        }
        const attr = this._computeReactiveGraphPureAttr(metadata, sampleItem);
        if (attr) {
            for (const [field, entry] of attr) {
                if (leaves && leaves.has(field)) { leaves.delete(field); continue; } // ambiguous: drop
                (leaves || (leaves = new Map())).set(field, { kind: 'attr', attrName: entry.attrName, targets: entry.targets });
            }
        }
        return leaves;
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

        // Render initial template; uses _resolveComponentValue for computed-first resolution
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
        // The template key may be a computed; this watcher rides its
        // `computed:NAME` pulse, so install that computed's notifier (lazy by
        // default; harmless if templateKeyProp is plain state). Record the bare
        // name whether or not the key carries an explicit `computed:` prefix.
        if (instance.stateManager._ensureComputedNotifier) {
            instance.stateManager._ensureComputedNotifier(
                templateKeyProp.startsWith('computed:') ? templateKeyProp.slice(9) : templateKeyProp);
        }
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

        // Always scan for nested components; on initial render the async scan phase
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

    // Single shared writer for the _listRelationships registry. All three
    // discovery paths (scan-time prepopulate, per-component context setup,
    // nested-template caching) funnel through here. Census 2026-07-02: all
    // three paths produce novel writes (dynamic mounts and external
    // data-use-template children are invisible to the scan-time walk), so
    // every call site is load-bearing.
    _registerListRelationships(relationships)
    {
        if (!this._listRelationships)
        {
            this._listRelationships = new Map();
        }
        for (const {parentPath, childPath} of relationships)
        {
            let children = this._listRelationships.get(parentPath);
            if (!children)
            {
                children = new Set();
                this._listRelationships.set(parentPath, children);
            }
            children.add(childPath);
        }
    },

    // Detect template relationships under rootEl and register them.
    _detectAndRegisterListRelationships(rootEl)
    {
        if (!this._contextRecords || !this._contextRecords.detectTemplateRelationships)
        {
            return;
        }
        try {
            this._registerListRelationships(this._contextRecords.detectTemplateRelationships(rootEl));
        } catch (error) {
            if (__DEV__) console.warn('[WF] detectTemplateRelationships failed:', error?.message);
        }
    },

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

        this._detectAndRegisterListRelationships(instance.element);

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

        // computed:-sourced lists are mapArray-backed and react through their
        // own structural effect; a computed: notification has no list context
        // to update on this path.
        if (path.startsWith('computed:')) {
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
    }
};

