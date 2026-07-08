/**
 * SSR list support: everything the list pipeline needs ONLY when a list was
 * server-rendered and adopted/hydrated: data-fingerprint change detection,
 * the legacy sparse/replace-all reconcile, mapArray hydration adoption, the
 * one-shot SSR item binders, and the render-cycle context sweep for
 * non-mapArray (adopted) lists.
 *
 * Mixed into ListRendererMethods behind the __FEATURE_SSR__ flag, so this
 * whole module tree-shakes out of the 12 non-SSR build variants, including
 * the method shells that a runtime flag check could never remove.
 *
 * Boundary rule: SSR code calls back into the SHARED row-binding machinery
 * (_bindWithCompiledMetadata, the fallback executors, class/style/attr
 * processors). Those serve the non-SSR hot path and must stay in
 * ListItemBinding/ListRenderer; do not move shared symbols across this
 * import fence.
 */

import { ssrAdoptedElements, ssrStateChangedElements } from '../core/DomMetadata.js';

export const SSRListMethods = {
    /**
     * Collect list contexts that need DOM updates at the top of _render
     * (binding contexts are handled by effects). Consumed by
     * _ssrSweepListContexts after deferred dependencies are processed.
     * @private
     */
    _ssrCollectListContexts() {
        const listContexts = new Set();

        if (this._contextsToUpdate && this._contextsToUpdate.size > 0) {
            this._contextsToUpdate.forEach(context => {
                if (context.type === 'list') {
                    listContexts.add(context);
                }
            });
        }

        return listContexts;
    },

    /**
     * Process list contexts collected by _ssrCollectListContexts. For
     * mapArray-backed lists each context early-exits (_mapArrayInitialized),
     * and every non-SSR list is mapArray-backed after first render, so this
     * context-driven sweep only does real work for SSR-hydrated lists.
     * @private
     */
    _ssrSweepListContexts(listContexts) {
        if (!this._contextSystemInitialized || listContexts.size === 0) return;

        listContexts.forEach(context =>
        {
            // Skip if context has no element reference
            if (!context.element) return;

            // mapArray handles all structural updates via effects; skip context-based processing
            if (context.element._mapArrayInitialized) return;

            // Skip if element is no longer in DOM
            if (!document.body.contains(context.element))
            {
                return;
            }

            // Get component instance
            const instance = context.componentInstance;
            if (!instance) return;

            // Process list using the context
            this._processList(
                {
                    element: context.element,
                    path: context.path,
                    componentId: instance.id
                },
                instance,
                false // Don't force update - let detection work
            );
        });
    },

    /**
     * The SSR diff/arbitration tail of _processList: replace-all detection,
     * sparse property-update reconcile, and fingerprint change detection for
     * adopted/hydrated lists (which are not mapArray-backed, so the
     * fingerprint is how a data change is detected for re-render).
     * @returns {boolean} true when the update was handled here (or no render
     *   is needed); the caller must skip _renderList; false to render.
     * @private
     */
    _ssrListDiff(element, path, instance, context, data, forceUpdate) {
        // Store the data for future comparisons
        const previousData = element._previousData;
        const hasPreviousData = previousData && Array.isArray(previousData) && Array.isArray(data);

        // _previousData is updated by _renderList at the end, NOT here.
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
                        // Circular reference; assume changed (safe: just less optimal)
                        itemHasChanges = prevItem !== newItem;
                    }
                }

                if (itemHasChanges) {
                    changedIndices.push(i);

                    // Count changed properties for threshold check.
                    // Defer building propChanges Sets to the fallback render path;
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
                            console.warn('[WildflowerJS] List item missing compiled metadata; using querySelectorAll fallback (slower). This may happen with configurable templates or SSR-adopted lists.');
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

                // Update fingerprint (SSR change-detection only) and store current data.
                element._lastDataFingerprint = this._getDataFingerprint(data);
                element._previousData = data;

                // Clear the metadata so it doesn't affect future updates
                if (pendingOperation) {
                    instance.stateManager._arrayOperations.delete(arrayPath);
                }

                return true;
            }
        }

        // Determine if rendering is needed
        let needsRender = hasPendingOptimization;

        // Operation hints (swap/append/etc.) drive a render even when data identity is unchanged.
        // Checked before the change-detection branch below.
        const hasOperationHint = instance?.stateManager?._arrayOperations?.has(arrayPath);

        // Data-fingerprint change detection. Adopted/hydrated lists are not
        // mapArray-backed, so the fingerprint is how a data change is detected for re-render.
        const fingerprint = this._getDataFingerprint(data);
        if (!element._lastDataFingerprint) {
            element._lastDataFingerprint = fingerprint;
            needsRender = true;
        } else if (element._lastDataFingerprint !== fingerprint) {
            element._lastDataFingerprint = fingerprint;
            needsRender = true;
            // Mark SSR lists as having state changes to allow re-rendering
            if (element._ssrPhase || ssrAdoptedElements.has(element)) {
                ssrStateChangedElements.add(element);
            }
        } else if (hasOperationHint) {
            needsRender = true;
        } else if (element._forceTemplateRerender) {
            needsRender = true;
        } else if (forceUpdate) {
            // Data unchanged; skip re-render even under forceUpdate.
            return true;
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

        return !needsRender;
    },

    _getDataFingerprint(data) {
        if (!Array.isArray(data)) return 'not-array';

        // Lightweight identity fingerprint; avoids JSON.stringify GC pressure.
        // Uses id/key primitives when available, falls back to typeof+first-key.
        const len = data.length;
        if (len === 0) return 'length:0';

        const _id = (item) => {
            if (item == null) return 'null';
            if (typeof item !== 'object') return String(item);
            // Value-inclusive token. SSR-hydrated lists are not mapArray-backed:
            // this fingerprint is the ONLY change signal that re-renders them, so
            // it must reflect item VALUES, not just identity. An identity-only
            // token (id/key, or first-key-only) misses an in-place property
            // mutation such as `item.quantity++`, leaving the hydrated row stale
            // while component-level computeds (which track the value directly)
            // still update. Identity (id/key) is kept as a prefix so structural
            // add/remove/reorder is still detected; scalar property values are
            // appended so a value change moves the fingerprint. Nested
            // objects/arrays contribute a cheap type+length marker (deep nested
            // mutations remain out of scope for this lightweight hash).
            let t = item.id !== undefined ? 'i:' + item.id + '|'
                  : item.key !== undefined ? 'k:' + item.key + '|' : '';
            const keys = Object.keys(item);
            for (let j = 0; j < keys.length; j++) {
                const v = item[keys[j]];
                t += keys[j] + ':' + (v !== null && typeof v === 'object'
                    ? (Array.isArray(v) ? 'a' + v.length : 'o')
                    : v) + ';';
            }
            return t;
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

            // Set up reactive bindings on existing element (same as _trySSRHydration)
            this._bindItemData(itemEl, itemProxy, i, context);

            // === CRITICAL: Create contexts for action binding ===
            // This ensures action records exist for event handling
            if (this._contextSystemInitialized) {
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
        // NOTE: Do NOT set _mapArrayInitialized; SSR hydration doesn't create mapArray effects

        // Set up event delegation on the container element
        this._ensureListEventDelegation(element, instance, listPath);

        return true; // SSR handled
    },

    /**
     * One-shot item binding for SSR-adopted rows (non-SSR rows are painted by
     * per-item effects; this path binds existing server DOM once at adoption).
     * @private
     */
    _bindItemData(itemEl, item, itemIndex, context, skipNestedCheck = false, precomputedMetadata = null) {
        // Early validation
        if (!item || typeof item !== 'object') return;

        // _itemData/_listIndex (the canonical row metadata) are set by the SSR
        // hydration caller before this runs; the _bindItemData/_bindItemIndex
        // mirrors were redundant and have been retired.

        // Per-item binding contexts no longer exist (list-item bindings are painted
        // by per-item effects from the row item proxy), so there is no registry
        // _parentIndex to refresh on rebind here.

        // Process root element bindings
        const ds = itemEl.dataset;
        this._bindRootElementData(itemEl, item, ds, itemIndex, context);

        // OPTIMIZATION: Use pre-computed metadata if provided (avoids per-item string concat + Map lookup)
        const listContext = itemEl._listContext;
        const compiledMetadata = precomputedMetadata !== null ? precomputedMetadata : this._getCompiledMetadata(listContext);

        let allElements;

        if (compiledMetadata) {
            // FAST PATH: Use compiled metadata
            allElements = this._bindWithCompiledMetadata(itemEl, item, compiledMetadata, listContext, itemIndex, context);
        } else {
            // FALLBACK: Use querySelectorAll
            allElements = this._bindWithFallback(itemEl, item, listContext, itemIndex, context, skipNestedCheck);
        }

        // Process root element model/show
        this._bindRootElementModelShow(itemEl, item, ds, itemIndex, context);

        // Mark for deferred context creation (only if not already created)
        // If contexts already exist (_needsContexts === false), keep using them
        // This preserves contexts during element reuse while avoiding orphaned contexts
        if (itemEl._needsContexts !== false) {
            itemEl._needsContexts = true;
        }
        if (allElements) {
            itemEl._bindingElements = allElements;
        }

        // Store compiled metadata for post-render updates so the
        // cloneNode path can use metadata-based updates too.
        if (compiledMetadata && !itemEl._compiledMetadata) {
            itemEl._compiledMetadata = compiledMetadata;
        }

        // NOTE: Attribute stripping for cloneNode path is deferred
        // Currently only innerHTML path strips attributes (in _compileTemplate)
        // Stripping here requires refactoring all querySelectorAll calls first
    },

    /**
     * Bind data-bind and data-bind-class on root element
     * @private
     */
    _bindRootElementData(itemEl, item, ds, itemIndex, context) {
        if (ds.bind) {
            const scope = this._buildItemScope(context, itemIndex);

            const value = this._resolveRawBinding(ds.bind, item, scope);
            const strValue = value == null ? '' : String(value);
            // Only use textContent on leaf elements; for elements with children,
            // use a dedicated text node to avoid destroying child DOM
            if (itemEl.children.length === 0) {
                itemEl.textContent = strValue;
            } else {
                if (!itemEl._boundTextNode) {
                    itemEl._boundTextNode = document.createTextNode(strValue);
                    itemEl.insertBefore(itemEl._boundTextNode, itemEl.firstChild);
                } else {
                    itemEl._boundTextNode.textContent = strValue;
                }
            }
        }

        if (ds.bindClass) {
            this._processOptimizedClassBinding(itemEl, item, ds.bindClass, itemIndex, context);
        }

        if (ds.bindStyle) {
            this._processStyleBinding(itemEl, item, ds.bindStyle, itemIndex, context);
        }

        if (ds.bindAttr) {
            this._processAttrBinding(itemEl, item, ds.bindAttr, itemIndex, context);
        }
    },

    /**
     * Get compiled metadata for list context
     * @private
     */
    _getCompiledMetadata(listContext) {
        const listPath = listContext?.path;
        if (!listPath) return null;

        const componentName = listContext?.componentInstance?.name;
        const compilationKey = componentName ? `${componentName}:${listPath}` : listPath;

        return this._templateCache.compiled.get(compilationKey) ||
               this._templateCache.compiled.get(listPath);
    },

    /**
     * Fallback binding using querySelectorAll (slow path)
     * @private
     */
    _bindWithFallback(itemEl, item, listContext, itemIndex, context, skipNestedCheck) {
        if (__DEV__) console.info(`[WF] Using fallback binding for list: "${listContext?.path}" (no compiled metadata)`);

        // Build combined selector respecting useWfPrefixOnly mode
        const combinedSelector = [
            this._attrSelector('bind'),
            this._attrSelector('bind-html'),
            this._attrSelector('model'),
            this._attrSelector('show'),
            this._attrSelector('action'),
            this._attrSelector('bind-class'),
            this._attrSelector('bind-style'),
            this._attrSelector('bind-attr')
        ].join(',');
        const allElementsRaw = itemEl.querySelectorAll(combinedSelector);

        let allElements;
        if (skipNestedCheck) {
            allElements = Array.from(allElementsRaw);
        } else {
            // Check if itemEl itself is a component - if so, ALL children belong to the component
            const itemElIsComponent = this._hasAttr(itemEl, 'component');
            if (itemElIsComponent) {
                // All children belong to the component, not the list
                // List only processes root element attributes
                allElements = [];
            } else {
                // Check for nested boundaries (lists or components)
                const hasNestedLists = itemEl.querySelector(this._attrSelector('list')) !== null;
                const hasNestedComponents = itemEl.querySelector(this._attrSelector('component')) !== null;

                if (hasNestedLists || hasNestedComponents) {
                    // Filter out elements inside nested boundaries
                    allElements = Array.from(allElementsRaw).filter(el => {
                        // Check if element is inside a nested list
                        if (hasNestedLists) {
                            const elList = el.closest(this._attrSelector('list'));
                            const itemList = itemEl.closest(this._attrSelector('list'));
                            if (elList !== itemList) return false;
                        }
                        // Check if element is inside a nested component
                        if (hasNestedComponents) {
                            const elComponent = el.closest(this._attrSelector('component'));
                            // If element's closest component is not itemEl itself, it's inside a nested component
                            if (elComponent && elComponent !== itemEl) {
                                // Smart boundary detection: only skip if component owns the binding property
                                const bindingProp = el.dataset.bind || el.dataset.bindHtml;
                                if (bindingProp) {
                                    // Check if it's a simple property (not an expression)
                                    const isSimpleProp = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(bindingProp);
                                    if (isSimpleProp) {
                                        // Look up component instance to check if it owns this property
                                        const componentId = elComponent.dataset.componentId;
                                        if (componentId) {
                                            const componentInstance = this.componentInstances.get(componentId);
                                            if (componentInstance && componentInstance.state) {
                                                // If component has this property, skip (component handles it)
                                                if (bindingProp in componentInstance.state) {
                                                    return false;
                                                }
                                                // Component doesn't have this property, include for list binding
                                                return true;
                                            }
                                        }
                                        // No component instance yet, include the binding for list
                                        return true;
                                    }
                                }
                                // Expression or other binding types - let component handle it
                                return false;
                            }
                        }
                        return true;
                    });
                } else {
                    allElements = Array.from(allElementsRaw);
                }
            }
        }

        // Process all elements
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const dataset = el.dataset;
            const tagName = el.tagName;
            const isInput = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';

            if (dataset.bindClass) {
                this._processOptimizedClassBinding(el, item, dataset.bindClass, itemIndex, context);
            }

            if (dataset.bindStyle) {
                this._processStyleBinding(el, item, dataset.bindStyle, itemIndex, context);
            }

            if (dataset.bindAttr) {
                this._processAttrBinding(el, item, dataset.bindAttr, itemIndex, context);
            }

            if (dataset.bind) {
                this._executeFallbackBind(el, item, dataset.bind, isInput, listContext, itemIndex);
            }

            if (dataset.bindHtml) {
                this._executeFallbackBindHtml(el, item, dataset.bindHtml, listContext, itemIndex);
            }

            if (dataset.model) {
                this._executeFallbackModel(el, item, dataset.model);
            }

            if (dataset.show) {
                this._executeFallbackShow(el, item, dataset.show, listContext, itemIndex);
            }
        }

        return allElements;
    },
};
