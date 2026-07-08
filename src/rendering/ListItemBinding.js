/**
 * ListItemBinding - Item-level binding for list rendering
 *
 * Extracted from ListRenderer.js for code organization.
 * These methods handle binding data to individual list items,
 * including compiled and fallback binding paths, context creation,
 * and effect-based reactive item rendering.
 *
 * @module
 */

import { listBoundElements } from '../core/DomMetadata.js';
import { pathResolver, __wf_str, __wf_txt } from '../core/wfUtils.js';
import { applyShow, applyClass, applyModel } from '../core/BindingWriters.js';

/**
 * V8 OPT: Reusable context object for _bindWithCompiledMetadata.
 * Avoids allocating a new 6-property object per item in tight loops.
 * Safe because ctx is only used synchronously within the function call.
 */
const _reusableBindCtx = {
    componentState: null,
    componentInstance: null,
    itemIndex: 0,
    listLength: 0,
    listContext: null,
    propsData: null
};

/**
 * Methods to be mixed into ListRendererMethods (and ultimately WildflowerJS.prototype)
 */
export const ListItemBindingMethods = {
    /**
     * Bind using compiled metadata (fast path)
     * @private
     */
    _bindWithCompiledMetadata(itemEl, item, compiledMetadata, listContext, itemIndex, context, _skipStyleAttr) {
        // Get or build cached elements array
        let allElementsArray = itemEl._cachedElementsArray;

        if (!allElementsArray) {
            allElementsArray = this._buildElementsArrayFromMetadata(itemEl, compiledMetadata);
            itemEl._cachedElementsArray = allElementsArray;
        }

        // PERF: Reuse context object; avoids per-item allocation in tight loops
        const componentInstance = listContext?.componentInstance;
        const ctx = _reusableBindCtx;
        ctx.componentState = componentInstance?.state || {};
        ctx.componentInstance = componentInstance;
        ctx.itemIndex = itemIndex;
        ctx.listLength = listContext?.data?.length || 0;
        ctx.listContext = listContext;
        ctx.propsData = componentInstance?._propsData;

        // PERF: Only call execute functions if they have bindings to process
        if (compiledMetadata.bindings.length > 0) {
            this._executeBindings(allElementsArray, compiledMetadata.bindings, item, ctx);
        }
        if (compiledMetadata.htmlBindings && compiledMetadata.htmlBindings.length > 0) {
            this._executeHtmlBindings(allElementsArray, compiledMetadata.htmlBindings, item, ctx);
        }
        if (compiledMetadata.models.length > 0) {
            this._executeModels(allElementsArray, compiledMetadata.models, item);
        }
        if (compiledMetadata.shows.length > 0) {
            this._executeShows(allElementsArray, compiledMetadata.shows, item, ctx);
        }
        if (compiledMetadata.classBindings.length > 0) {
            this._executeClassBindings(allElementsArray, compiledMetadata.classBindings, item, ctx);
        }
        // List callers pass _skipStyleAttr: their style/attr apply runs through
        // _applyRowDecor's evaluator fast paths, which cover every style/attr
        // binding (_compileTemplate emits an evaluator entry for each binding,
        // null-evaluator entries included). Slot/SSR callers omit the flag and
        // use these generic executors.
        if (!_skipStyleAttr &&
            compiledMetadata.styleBindings && compiledMetadata.styleBindings.length > 0) {
            this._executeStyleBindings(allElementsArray, compiledMetadata.styleBindings, item, itemIndex, context);
        }
        if (!_skipStyleAttr &&
            compiledMetadata.attrBindings && compiledMetadata.attrBindings.length > 0) {
            this._executeAttrBindings(allElementsArray, compiledMetadata.attrBindings, item, itemIndex, context);
        }

        return allElementsArray;
    },
    /**
     * Build elements array from compiled DOM paths
     * PERF: Uses pre-computed elementPaths array for single-loop resolution
     * instead of iterating through 7 separate binding type arrays
     * @private
     */
    _buildElementsArrayFromMetadata(itemEl, compiledMetadata) {
        const paths = compiledMetadata.elementPaths;

        // FAST PATH: Use pre-computed elementPaths (7x fewer loop iterations)
        // Instead of looping through bindings, htmlBindings, models, shows, actions,
        // classBindings, styleBindings separately with undefined checks,
        // we just resolve each unique element once
        if (paths && paths.length > 0) {
            const allElementsArray = new Array(paths.length);
            // PERF OPTIMIZATION 2.1: Inline element path resolution to eliminate function call overhead
            // For 1000 items × 5 bindings = 5000 function calls saved
            for (let i = 0; i < paths.length; i++) {
                const path = paths[i];
                const plen = path ? path.length : 0;
                if (plen === 0) {
                    allElementsArray[i] = itemEl;
                    continue;
                }
                // Resolve each child index by element node-pointers
                // (firstElementChild + nextElementSibling) rather than fetching the live
                // HTMLCollection (current.children) and indexing it per hop. elementPaths
                // are element-child indices, and *ElementSibling traverse element-only
                // nodes, so this is semantically identical to children[idx] (text/comment
                // nodes excluded the same way) while avoiding the collection wrapper +
                // index walk on each step (~58% faster per row at create10k).
                let current = itemEl;
                for (let p = 0; p < plen; p++) {
                    let next = current.firstElementChild;
                    for (let k = path[p]; k > 0 && next; k--) next = next.nextElementSibling;
                    if (!next) { current = null; break; }
                    current = next;
                }
                allElementsArray[i] = current;
            }
            return allElementsArray;
        }

        return [];
    },
    /**
     * Check if element is a custom element and apply its adapter.
     * Returns true if handled (caller should skip normal binding).
     * @private
     */
    _applyCustomElementAdapter(el, value) {
        let isCustomEl = el._isCustomEl;
        if (isCustomEl === undefined) {
            // Guard against non-Element nodes: a data-render placeholder is a
            // Comment, which has no tagName, so tagName.includes('-') TypeErrors
            // (it gets caught by the effect boundary and just logs noise, but it
            // still aborts the binding loop early).
            if (!el.tagName) return false;
            isCustomEl = el._isCustomEl = el.tagName.includes('-');
        }
        if (!isCustomEl) return false;

        customElements.upgrade(el);
        const adapter = this.getAdapter(el.tagName.toLowerCase(), el);
        if (adapter && el[adapter.prop] !== value) {
            el[adapter.prop] = value;
        }
        return true;
    },
    /**
     * Nested-change path-overlap test for the targeted-rebind filter. Used ONLY
     * when the changed prop `tp` is itself a dotted nested path (the rare case):
     * callers handle the common flat case inline with a plain `path === tp` so
     * the hot flat update path stays call-free.
     *
     * Returns true when a path binding must be re-evaluated because the changed
     * nested path and the binding `path` overlap:
     *  - ANCESTOR: `path` is a strict prefix of `tp` at a '.' boundary; the
     *    binding reads a parent object that now contains the changed leaf.
     *  - DESCENDANT: `tp` is a strict prefix of `path` at a '.' boundary; the
     *    changed value is an object the binding reads further into.
     * Exact equality (`path === tp`) is the caller's fast path. Allocation-free
     * (charCodeAt(46) === '.' tests the boundary before a prefix compare).
     *
     * @param {string|null} path - the binding's data path
     * @param {string} tp - the changed nested path (contains at least one '.')
     * @returns {boolean} true to re-evaluate, false to skip
     * @private
     */
    _pathTouchedByNestedChange(path, tp) {
        if (!path) return false;
        if (tp.length > path.length && tp.charCodeAt(path.length) === 46 && tp.startsWith(path)) return true;
        if (path.length > tp.length && path.charCodeAt(tp.length) === 46 && path.startsWith(tp)) return true;
        return false;
    },
    /**
     * Execute data-bind bindings from compiled metadata
     * @private
     */
    _executeBindings(elementsArray, bindings, item, ctx) {
        for (let i = 0; i < bindings.length; i++) {
            const binding = bindings[i];

            const el = elementsArray[binding.index];
            if (!el) continue;

            let value;

            // PERF: Fast path for simple property bindings (e.g., data-bind="label")
            // Bypasses _resolveCompiledBinding entirely: no destructuring, no branch checks,
            // just a direct property read. Covers the majority of list bindings.
            //
            // Fall back to full resolution when item[path] is undefined: the path may
            // refer to an implicit computed property defined on the component (e.g.,
            // data-bind="fullName" where fullName is a computed). Compile-time
            // isSimplePath cannot detect this because computed names live on the
            // component definition, not the template.
            if (binding.isSimplePath) {
                value = item[binding.path];
                if (value === undefined) {
                    value = this._resolveCompiledBinding(binding, item, ctx);
                    if (value === undefined) continue;
                }
            } else {
                value = this._resolveCompiledBinding(binding, item, ctx);

                // Skip undefined values for simple paths (backwards compatibility)
                if (value === undefined && !binding.isExpression && !binding.isComputed &&
                    !binding.isListContextVar && !binding.isPropsPath && !binding.isLengthProperty &&
                    binding.path && item && typeof item === 'object') {
                    continue;
                }
            }

            if (this._applyCustomElementAdapter(el, value)) {
                listBoundElements.add(el);
                continue;
            }

            // PERF: Skip DOM write if value unchanged
            const strValue = __wf_str(value);
            if (binding.isInput) {
                if (el.value !== strValue) {
                    el.value = strValue;
                }
            } else {
                __wf_txt(el, strValue);
            }
            listBoundElements.add(el);
        }
    },
    /**
     * Execute data-bind-html bindings from compiled metadata
     * @private
     */
    _executeHtmlBindings(elementsArray, htmlBindings, item, ctx) {
        const targetedProp = this._targetedProp;
        const targetedPropRoot = this._targetedPropRoot;
        const componentInstance = ctx?.componentInstance;
        const hasComputeds = this._instanceHasComputeds(componentInstance);
        const computeds = hasComputeds ? componentInstance.stateManager.computed : null;
        for (let i = 0; i < htmlBindings.length; i++) {
            const binding = htmlBindings[i];
            const el = elementsArray[binding.index];
            if (!el) continue;

            const value = this._resolveCompiledBinding(binding, item, ctx);

            // Targeted rebind: skip DOM write for bindings not matching the changed
            // prop. Expressions match the changed ROOT in expressionVars (vars are
            // roots, not dotted paths); flat path bindings use a call-free exact
            // match, nested consults the helper. Computed references bypass (the body
            // may read the changed prop transitively). Mirrors _executeBindings.
            if (targetedProp) {
                let m = binding.isExpression
                    ? (binding.expressionVars && binding.expressionVars.indexOf(targetedPropRoot) !== -1)
                    : (binding.path === targetedProp
                        || (targetedProp !== targetedPropRoot && this._pathTouchedByNestedChange(binding.path, targetedProp)));
                if (!m && hasComputeds) {
                    if (binding.isExpression && binding.expressionVars) {
                        for (let v = 0; v < binding.expressionVars.length; v++) {
                            if (computeds[binding.expressionVars[v]]) { m = true; break; }
                        }
                    } else if (binding.path && computeds[binding.path]) {
                        m = true;
                    }
                }
                if (!m) continue;
            }

            const htmlStr = value == null ? '' : value;
            el.innerHTML = this._sanitizeOrPassHTML(htmlStr);
        }
    },
    /**
     * Execute data-model bindings from compiled metadata
     * @private
     */
    _executeModels(elementsArray, models, item) {
        const targetedProp = this._targetedProp;
        const targetedPropRoot = this._targetedPropRoot;
        for (let i = 0; i < models.length; i++) {
            const modelBinding = models[i];
            const el = elementsArray[modelBinding.index];
            if (!el) continue;

            const value = this._getValueFromItem(item, modelBinding.path);

            // Targeted rebind: skip DOM write for non-matching bindings. Flat
            // change uses a call-free exact match; nested consults the helper.
            // Models have no computed-name bypass.
            if (targetedProp) {
                const m = modelBinding.path === targetedProp
                    || (targetedProp !== targetedPropRoot && this._pathTouchedByNestedChange(modelBinding.path, targetedProp));
                if (!m) continue;
            }

            if (this._applyCustomElementAdapter(el, value)) {
                continue;
            }

            applyModel(el, value, modelBinding.type);
        }
    },
    /**
     * Execute data-show bindings from compiled metadata
     * @private
     */
    _executeShows(elementsArray, shows, item, ctx) {
        const targetedProp = this._targetedProp;
        const targetedPropRoot = this._targetedPropRoot;
        // Fast-path: skip computed-name bypass when component declares no computeds
        const componentInstance = ctx?.componentInstance;
        const hasComputeds = this._instanceHasComputeds(componentInstance);
        const computeds = hasComputeds ? componentInstance.stateManager.computed : null;
        for (let i = 0; i < shows.length; i++) {
            const binding = shows[i];
            const el = elementsArray[binding.index];
            if (!el) continue;

            // Resolve value using consolidated helper
            const rawValue = this._resolveCompiledBinding(binding, item, ctx);

            // Targeted rebind: skip DOM write for non-matching bindings. Flat
            // change uses a call-free exact match; nested consults the helper.
            // Expressions match the changed ROOT. The computed bypass matters
            // here; omitting it once caused per-row data-show on item-level
            // computeds to freeze when component-own state mutated (the popover
            // open/close case in the PM tracker).
            if (targetedProp) {
                let m = binding.isExpression
                    ? (binding.expressionVars && binding.expressionVars.indexOf(targetedPropRoot) !== -1)
                    : (binding.path === targetedProp
                        || (targetedProp !== targetedPropRoot && this._pathTouchedByNestedChange(binding.path, targetedProp)));
                if (!m && hasComputeds) {
                    if (binding.isExpression && binding.expressionVars) {
                        for (let v = 0; v < binding.expressionVars.length; v++) {
                            if (computeds[binding.expressionVars[v]]) { m = true; break; }
                        }
                    } else if (binding.path && computeds[binding.path]) {
                        m = true;
                    }
                }
                if (!m) continue;
            }

            // Apply negate flag and convert to display style
            const value = binding.negate ? !rawValue : Boolean(rawValue);
            applyShow(el, value);
        }
    },
    /**
     * Execute data-render bindings via stored conditional contexts
     * Unlike other execute* methods, this uses conditional contexts (not elementsArray)
     * because data-render elements may be removed from DOM (replaced by placeholders).
     * @param {Array} renderContexts - Array of {context, binding} pairs from itemEl._renderContexts
     * @param {Object} item - Current item proxy data
     * @param {Object} ctx - Resolution context (componentState, componentInstance, itemIndex, etc.)
     * @returns {boolean} True if any render condition changed (DOM was modified)
     * @private
     */
    _executeRenders(renderContexts, item, ctx) {
        let changed = false;
        for (let i = 0; i < renderContexts.length; i++) {
            const rc = renderContexts[i];
            if (!rc || !rc.context || !rc.binding) continue;

            // Resolve value using consolidated helper (same as shows/bindings)
            const rawValue = this._resolveCompiledBinding(rc.binding, item, ctx);

            // Apply negate flag and convert to boolean
            const shouldRender = rc.binding.negate ? !rawValue : Boolean(rawValue);

            // Only update if condition actually changed
            if (shouldRender !== rc.context.isRendered) {
                rc.context._updateConditionalElement(shouldRender);
                changed = true;
            }
        }
        return changed;
    },
    /**
     * Execute data-bind-class bindings from compiled metadata
     * PERF: Uses pre-computed binding type flags to skip runtime checks
     * @private
     */
    _executeClassBindings(elementsArray, classBindings, item, ctx) {
        // PERF: Hoist componentInstance lookup out of loop
        const componentInstance = ctx.componentInstance;
        const itemIndex = ctx.itemIndex;
        const listContext = ctx.listContext;
        // Fast-path: skip computed-name bypass when component has no computeds
        const hasComputeds = this._instanceHasComputeds(componentInstance);

        for (let i = 0; i < classBindings.length; i++) {
            const classBinding = classBindings[i];
            const el = elementsArray[classBinding.index];
            if (!el) continue;

            // PERF: Use pre-computed flags from compile time
            if (classBinding.isSimpleProperty !== undefined) {
                // Fast path: use pre-computed metadata
                if (classBinding.isSimpleProperty) {
                    // Simple property binding - check for implicit computed first.
                    // Skip the computed lookup entirely when the component declares
                    // no computeds (fast path for templates with only data props).
                    const expression = classBinding.expression;
                    const isComputedName = hasComputeds
                        ? !!(expression && componentInstance.stateManager.computed[expression])
                        : false;

                    let value;
                    if (isComputedName) {
                        value = this._evaluateComputedInListContext(
                            componentInstance, expression, item, itemIndex, listContext
                        );
                    } else {
                        value = this._getValueFromItem(item, expression);
                    }
                    this._toggleBoundClass(el, value ? String(value) : '');
                } else if (classBinding.isComputed) {
                    // Computed property with list item context
                    if (componentInstance) {
                        const value = this._evaluateComputedInListContext(
                            componentInstance,
                            classBinding.computedName,
                            item,
                            itemIndex,
                            listContext
                        );
                        // Computed deps can't be checked cheaply; always write
                        this._toggleBoundClass(el, value ? String(value) : '');
                    }
                } else if (classBinding.compiledFn && classBinding.expressionVars) {
                    // PERF: Reuse args array; cached on the binding to avoid allocation per call
                    const vars = classBinding.expressionVars;
                    const args = classBinding._args || (classBinding._args = new Array(vars.length));
                    this._resolveListExprArgs(args, vars, item, componentInstance);
                    try {
                        const result = classBinding.compiledFn(...args);
                        this._toggleBoundClass(el, this._classResultToString(result));
                    } catch (e) {
                        this._toggleBoundClass(el, '');
                    }
                } else {
                    // Expression needing component state or list context - use full path
                    this._processOptimizedClassBinding(el, item, classBinding.expression, itemIndex, listContext);
                }
            } else {
                // Fallback path for bindings without pre-computed metadata
                this._processOptimizedClassBinding(el, item, classBinding.expression, itemIndex, listContext);
            }
        }
    },
    /**
     * Execute data-bind-style bindings from compiled metadata
     * @private
     */
    _executeStyleBindings(elementsArray, styleBindings, item, itemIndex, context) {
        for (let i = 0; i < styleBindings.length; i++) {
            const styleBinding = styleBindings[i];
            const el = elementsArray[styleBinding.index];
            if (!el) continue;

            this._processStyleBinding(el, item, styleBinding.expression, itemIndex, context);
        }
    },
    /**
     * Execute data-bind-attr bindings from compiled metadata
     * @private
     */
    _executeAttrBindings(elementsArray, attrBindings, item, itemIndex, context) {
        for (let i = 0; i < attrBindings.length; i++) {
            const attrBinding = attrBindings[i];
            const el = elementsArray[attrBinding.index];
            if (!el) continue;

            this._processAttrBinding(el, item, attrBinding.expression, itemIndex, context);
        }
    },
    /**
     * Build the per-item resolution scope shared by the fallback / root-element
     * binding executors. `ctx` is the list context (componentInstance, data, …).
     * @private
     */
    _buildItemScope(ctx, itemIndex) {
        const componentInstance = ctx?.componentInstance;
        return {
            componentState: componentInstance?.state || {},
            componentInstance,
            itemIndex,
            listLength: ctx?.data?.length || 0,
            listContext: ctx,
            propsData: componentInstance?._propsData
        };
    },
    /**
     * Execute single data-bind in fallback mode
     * @private
     */
    _executeFallbackBind(el, item, bindPath, isInput, listContext, itemIndex) {
        const scope = this._buildItemScope(listContext, itemIndex);

        const value = this._resolveRawBinding(bindPath, item, scope);

        if (this._applyCustomElementAdapter(el, value)) {
            return;
        }

        if (isInput) {
            el.value = value == null ? '' : value;
        } else {
            el.textContent = value == null ? '' : value;
        }
    },
    /**
     * Execute single data-bind-html in fallback mode
     * @private
     */
    _executeFallbackBindHtml(el, item, htmlPath, listContext, itemIndex) {
        const scope = this._buildItemScope(listContext, itemIndex);

        const value = this._resolveRawBinding(htmlPath, item, scope);
        const htmlStr = value == null ? '' : value;
        el.innerHTML = this._sanitizeOrPassHTML(htmlStr);
    },
    /**
     * Execute single data-model in fallback mode
     * @private
     */
    _executeFallbackModel(el, item, modelPath) {
        const value = this._getValueFromItem(item, modelPath);

        if (this._applyCustomElementAdapter(el, value)) {
            return;
        }

        applyModel(el, value, el.type);
    },
    /**
     * Execute single data-show in fallback mode
     * @private
     */
    _executeFallbackShow(el, item, showPath, listContext, itemIndex) {
        const scope = this._buildItemScope(listContext, itemIndex);

        // _resolveRawBinding handles negation and all path types (computed:, $store.path, expressions, etc.)
        const value = this._resolveRawBinding(showPath, item, scope);
        applyShow(el, value);
    },
    /**
     * Bind model and show on root element itself
     * @private
     */
    _bindRootElementModelShow(itemEl, item, ds, itemIndex, context) {
        if (ds.model) {
            const value = this._getValueFromItem(item, ds.model);
            if (itemEl.tagName === 'INPUT' || itemEl.tagName === 'TEXTAREA' || itemEl.tagName === 'SELECT') {
                applyModel(itemEl, value, itemEl.type);
            }
        }

        if (ds.show) {
            const scope = this._buildItemScope(context, itemIndex);

            const value = this._resolveRawBinding(ds.show, item, scope);
            applyShow(itemEl, value);
        }
    },
    /**
     * Toggle bound classes on an element while preserving other classes
     * Tracks previous bound classes to properly remove them when value changes
     * Supports multi-class strings like 'card active highlighted'
     * @param {HTMLElement} element - The element to update
     * @param {string} newClasses - The new class name(s) to add (empty string to remove all bound classes)
     * @private
     */
    _toggleBoundClass(element, newClasses) {
        // Canonical diff-tracking lives in the BindingWriters kernel. This path
        // always receives a string (callers stringify via _classResultToString),
        // but applyClass also accepts object/array forms used by other callers.
        applyClass(element, newClasses);
    },

    /**
     * Ensure contexts are created for a list item element
     * Called on-demand when contexts are needed (e.g., before event handling)
     * @param {HTMLElement} itemEl - The list item element
     */
    _ensureItemContexts(itemEl) {

        // Skip if contexts already created or no data available
        if (!itemEl._needsContexts || !itemEl._itemData) {
            return;
        }

        // Get stored metadata (_listIndex is the canonical row index, kept current
        // by onMove; _bindItemIndex was a redundant mirror, now retired).
        const itemIndex = itemEl._listIndex;
        const allElements = itemEl._bindingElements;

        // Get the list context
        const listContext = itemEl._listContext;
        const componentInstance = listContext?.componentInstance;

        if (!this._contextSystemInitialized || !this._contextRecords || !componentInstance) {
            // Can't create contexts without the registry or component instance
            return;
        }

        // PERF: Use listContext directly - it's already verified when stored on itemEl._listContext
        // in mapArray's onCreate callback
        let verifiedListContext = listContext;

        // Metadata-based context creation for stripped templates.
        // If compiled metadata is available, use it instead of reading
        // attributes; this enables attribute stripping on the
        // innerHTML-path templates.
        const compiledMetadata = itemEl._compiledMetadata;
        if (compiledMetadata && allElements) {
            this._ensureItemContextsFromMetadata(itemEl, allElements, compiledMetadata, verifiedListContext, componentInstance, itemIndex);
            return;
        }

        // ============================================================
        // FALLBACK: Attribute-based context creation (for cloneNode path)
        // ============================================================

        // IMPORTANT: Sort elements to ensure parent contexts are created before children
        // This helps with establishing proper hierarchical relationships
        const sortedElements = this._sortElementsForContextCreation(allElements);

        // First pass: create all non-action contexts.
        const createdContexts = new Map(); // Track contexts by element

        for (let i = 0; i < sortedElements.length; i++) {
            const el = sortedElements[i];

            // Skip action elements for now (handled separately)
            if (this._hasAttr(el, 'action')) continue;

            // Per-row data-bind binding contexts are not created; the per-item
            // effect (_executeBindings) paints list-item text/value from the row
            // item proxy; the binding context was created and never read.

            // Per-row data-model contexts are not created here; the metadata path
            // (_ensureItemContextsFromMetadata via _executeModels) handles list-item
            // models functionally without a context, and write-back routes through
            // the document-level _handleInputChange off the row item proxy. The
            // fallback's model-context block was vestigial: never reached (0 hits
            // across the full suite) and its only consumer (_setupModelEventHandling)
            // no longer exists in the modular source.

            // Per-row data-show conditional contexts are not created here. The
            // per-item effect (_executeShows) paints initial + data-driven
            // visibility, and the reconcile re-eval sweeps handle position-frame
            // changes. The fallback show Context was write-only (never read) once
            // RC:400's _updateConditionals sweep was removed.
        }

        // Second pass: create action contexts after the others.
        // PERF: Filter out undefined/null elements that may exist in sparse arrays
        const actionElements = Array.from(allElements).filter(el =>
            el != null && this._hasAttr(el, 'action')
        );

        for (let j = 0; j < actionElements.length; j++) {
            const actionEl = actionElements[j];
            const actionAttr = this._getAttr(actionEl, 'action');
            if (!actionAttr) continue;

            // Check if this action element is in a nested list
            const nestedListParent = actionEl.closest('[data-list],[data-wf-list]');
            if (nestedListParent && nestedListParent !== itemEl.closest('[data-list],[data-wf-list]')) {
                // Skip actions that belong to a nested list
                continue;
            }

            // Check if this action element is inside a nested component
            // If so, let that component handle its own actions
            const closestComponent = actionEl.closest('[data-component]');
            if (closestComponent && closestComponent !== componentInstance.element) {
                // Skip actions that belong to a nested component
                continue;
            }

            // data-event-outside on row-template action elements: register
            // the document-level outside-click handler and skip the regular
            // per-event action context. See _ensureItemContextsFromMetadata
            // for the rationale; same path, different template-compilation
            // mode (this one runs for templates that don't get the innerHTML
            // fast path).
            if (this._hasAttr(actionEl, 'event-outside')) {
                const outsideDefs = this._parseActions(actionAttr);
                const rowCtx = {
                    item: itemEl._itemData,
                    index: itemIndex,
                    listContext: verifiedListContext
                };
                for (const def of outsideDefs) {
                    if (!def.methodName) continue;
                    if (typeof componentInstance.context[def.methodName] !== 'function') continue;
                    this._setupOutsideClickHandler(actionEl, componentInstance, def.methodName, rowCtx);
                }
                continue;
            }

            // Parse actions
            const actionDefs = this._parseActions(actionAttr);

            // Create context for each action
            for (let k = 0; k < actionDefs.length; k++) {
                const {methodName, eventType, args: actionArgs} = actionDefs[k];

                // Skip invalid methods
                if (!methodName || typeof componentInstance.context[methodName] !== 'function') {
                    continue;
                }

                // Check if element already has an action record - if so, don't overwrite it
                if (actionEl._actionContext) {
                    continue;
                }

                // Create action context
                const actionContext = this._contextRecords.createActionContext(
                    methodName,
                    componentInstance,
                    actionEl,
                    methodName,
                    eventType,
                    verifiedListContext  // CRITICAL: parent relationship
                );

                if (actionContext) {
                    // Note: _parentIndex must be set here - createActionContext doesn't take parentIndex param
                    actionContext._parentIndex = itemIndex;
                    // Store parsed action args on the context
                    if (actionArgs && actionArgs.length > 0) {
                        actionContext.data.actionArgs = actionArgs;
                    }
                    createdContexts.set(actionEl, actionContext);
                }
            }
        }

        // PERF: Verification loop removed - parent and _parentIndex are already
        // set correctly during context creation. Parent is passed to createContext() and
        // set at construction time. _parentIndex is set immediately after each creation.
        // This loop was doing redundant verification on fresh items.

        // Mark as initialized
        itemEl._needsContexts = false;


        // Return the created contexts (helpful for testing)
        return createdContexts;
    },
    /**
     * Create contexts using compiled metadata (optimized path)
     * This enables attribute stripping from innerHTML-path templates
     * @param {HTMLElement} itemEl - The list item element
     * @param {Array} allElements - Array of binding elements
     * @param {Object} compiledMetadata - Pre-compiled template metadata
     * @param {Object} verifiedListContext - Verified list context from registry
     * @param {Object} componentInstance - Component instance
     * @param {number} itemIndex - Item index in list
     * @private
     */
    _ensureItemContextsFromMetadata(itemEl, allElements, compiledMetadata, verifiedListContext, componentInstance, itemIndex) {
        const createdContexts = new Map();

        // Per-row data-bind binding contexts are not created: the per-item effect
        // (_executeBindings) paints list-item text/value straight from the row
        // item proxy, so the binding context was created and never read.

        // --- Create action contexts from metadata ---
        if (compiledMetadata.actions) {
            for (const action of compiledMetadata.actions) {
                const actionEl = allElements[action.index];
                if (!actionEl) continue;

                // PERF: Use pre-computed flags instead of costly .closest() DOM traversal
                // These flags are computed once at template compile time, not per item
                if (action.isInNestedList) {
                    continue; // Skip - belongs to nested list
                }
                if (action.isInNestedComponent) {
                    continue; // Skip - belongs to nested component
                }

                // data-event-outside: register the document-level outside-click
                // handler instead of a per-event action context. Mirrors the
                // non-list path in EventSystem._bindComponentActions, which
                // calls _setupOutsideClickHandler and returns early without
                // adding a regular event listener. Direct clicks on the
                // element must NOT fire the handler (popovers stay open when
                // their own trigger is clicked), so we deliberately skip
                // action-context creation. EventSystem._setupOutsideClickHandler's
                // registry is idempotent; repeat registrations of the same
                // (element, methodName) pair collapse onto a single entry.
                if (action.hasEventOutside) {
                    const outsideDefs = this._parseActions(action.actionName);
                    const rowCtx = {
                        item: itemEl._itemData,
                        index: itemIndex,
                        listContext: verifiedListContext
                    };
                    for (const def of outsideDefs) {
                        if (!def.methodName) continue;
                        if (typeof componentInstance.context[def.methodName] !== 'function') continue;
                        this._setupOutsideClickHandler(actionEl, componentInstance, def.methodName, rowCtx);
                    }
                    continue;
                }

                // Parse actions (handle multiple actions like "click:save blur:validate")
                const actionDefs = this._parseActions(action.actionName);

                for (const { methodName, eventType, args: actionArgs } of actionDefs) {
                    if (!methodName || typeof componentInstance.context[methodName] !== 'function') {
                        continue;
                    }

                    // contextsByElement is single-valued per element; if an
                    // action context already exists for this element, an
                    // additional createActionContext call would overwrite
                    // it. Instead, store the extra (eventType → handler)
                    // pair on the existing context's data.eventHandlers
                    // map so the dispatcher can route by event type at
                    // fire time. Without this, a list-row element with
                    // multiple actions (e.g. `data-action="click:open
                    // mouseenter:hover"`) would only wire up the first one.
                    const existing = actionEl._actionContext;
                    if (existing) {
                        if (!existing.data.eventHandlers) {
                            existing.data.eventHandlers = new Map();
                            // Seed the map with the primary handler so
                            // dispatcher lookups for ANY declared event
                            // type land in one place.
                            existing.data.eventHandlers.set(existing.data.event, {
                                methodName: existing.path,
                                args: existing.data.actionArgs || []
                            });
                        }
                        existing.data.eventHandlers.set(eventType, {
                            methodName: methodName,
                            args: actionArgs || []
                        });
                        continue;
                    }

                    // PERF: Pass itemIndex to skip .closest() DOM query inside createActionContext
                    const actionContext = this._contextRecords.createActionContext(
                        methodName,
                        componentInstance,
                        actionEl,
                        methodName,
                        eventType,
                        verifiedListContext,
                        itemIndex
                    );

                    if (actionContext) {
                        // Store parsed action args on the context
                        if (actionArgs && actionArgs.length > 0) {
                            actionContext.data.actionArgs = actionArgs;
                        }
                        createdContexts.set(actionEl, actionContext);
                    }
                }
            }
        }

        // Note: innerHTML path excludes templates with models, shows, renders, etc.
        // So we don't need to handle those here - they use the attribute-based fallback

        // Mark as initialized
        itemEl._needsContexts = false;

        return createdContexts;
    },
    /**
     * Sort elements for context creation to ensure proper parent-child relationships
     * @param {NodeList|Array} elements - Elements to sort
     * @returns {Array} - Sorted elements
     */
    _sortElementsForContextCreation(elements) {
        // PERF: Filter out undefined/null elements that may exist in sparse arrays
        const elementsArray = Array.from(elements).filter(el => el != null);

        // Sort by hierarchy level (parent elements before children)
        return elementsArray.sort((a, b) => {
            // Get nesting depth
            const depthA = this._getElementDepth(a);
            const depthB = this._getElementDepth(b);

            // Sort by depth (ascending)
            return depthA - depthB;
        });
    },
    /**
     * Get the nesting depth of an element within its container
     * @param {HTMLElement} element - The element to check
     * @returns {number} - Depth level
     */
    _getElementDepth(element) {
        let depth = 0;
        let current = element;

        // Traverse up until we hit the list item
        while (current && current._listIndex === undefined) {
            depth++;
            current = current.parentElement;
        }

        return depth;
    },

    _updateModelValue(context, newValue)
    {
        if (!context || !context.element) {
            return false;
        }

        // Defensive fallback: if no value was passed, read from the element.
        // Callers pass the input value captured at event-dispatch time so a
        // mid-tick list re-render that swaps context.element doesn't cause a
        // stale/empty read here.
        if (newValue === undefined) {
            newValue = this._getInputValue(context.element);
        }
        if (newValue === undefined) return false; // Skip unchecked radio

        // Determine where to update based on context hierarchy
        if (context.parent && context.parent.type === 'list' && context._parentIndex !== undefined)
        {
            // List-item model: write straight through the row's reactive
            // item-proxy (the SAME proxy the render effect tracks), so the set
            // propagates through the graph for top-level, computed-source, and
            // nested lists alike; no immutable copy/replace/writeback or manual
            // binding refresh required. Converges on the mapArray mutation path.
            const rowEl = this._findListItemAncestor(context.element);
            const item = (rowEl && rowEl._itemData) || context._itemData;
            if (item) {
                this._applyMapArrayMutation(item, context.path, newValue);
                return true;
            }
            return false;
        } else if (context.componentInstance)
        {
            // Check if this is a store path (e.g., "checkout.firstName")
            const modelPath = context.path;
            const firstDot = modelPath.indexOf('.');
            if (firstDot > 0) {
                const possibleStoreName = modelPath.slice(0, firstDot);
                const storeComponent = this.storeManager?.getStoreComponentByName(possibleStoreName);
                if (storeComponent) {
                    // Route to store state
                    const storePath = modelPath.slice(firstDot + 1);
                    // Use pathResolver for nested paths within store
                    pathResolver.set(storeComponent.state, storePath, newValue);
                    return true;
                }
            }

            // Regular model - update component state directly
            // Handle nested paths using pathResolver
            if (modelPath.includes('.')) {
                pathResolver.set(context.componentInstance.state, modelPath, newValue);
            } else {
                context.componentInstance.state[modelPath] = newValue;
            }
            return true;
        }

        return false;
    },
    /**
     * Refresh bindings containing external() in a list item when external state changes
     * This is called when a component that provides external() data has its state updated
     * @param {HTMLElement} itemEl - The list item element
     * @param {Object} item - The item data
     * @param {number} itemIndex - Index of the item in the list
     * @param {Object} listContext - The list context
     * @private
     */
    _refreshListItemExternalBindings(itemEl, item, itemIndex, listContext) {
        if (!itemEl) return;

        // Helper to detect external dependencies: both external() and $store.path shorthand
        const hasExternalRef = (expr) => expr.includes('external(') || /\$[a-zA-Z]/.test(expr);

        // Check for nested lists and filter them out to prevent cross-contamination
        const hasNestedLists = itemEl.querySelector('[data-list],[data-wf-list]') !== null;

        // Find all text bindings that might contain external refs (excluding nested list elements)
        const textBindingsRaw = itemEl.querySelectorAll('[data-bind],[data-wf-bind]');
        const textBindings = this._filterOutNestedListElements(textBindingsRaw, itemEl, hasNestedLists);
        textBindings.forEach(el => {
            const bindPath = this._getAttr(el, 'bind');
            if (bindPath && hasExternalRef(bindPath)) {
                const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
                this._executeFallbackBind(el, item, bindPath, isInput, listContext, itemIndex);
            }
        });

        // Also check the item element itself
        const itemBindPath = this._getAttr(itemEl, 'bind');
        if (itemBindPath && hasExternalRef(itemBindPath)) {
            const isInput = itemEl.tagName === 'INPUT' || itemEl.tagName === 'TEXTAREA' || itemEl.tagName === 'SELECT';
            this._executeFallbackBind(itemEl, item, itemBindPath, isInput, listContext, itemIndex);
        }

        // Find all class bindings that might contain external refs (excluding nested list elements)
        const classBindingsRaw = itemEl.querySelectorAll('[data-bind-class],[data-wf-bind-class]');
        const classBindings = this._filterOutNestedListElements(classBindingsRaw, itemEl, hasNestedLists);
        classBindings.forEach(el => {
            const expr = this._getAttr(el, 'bind-class');
            if (expr && hasExternalRef(expr)) {
                this._processOptimizedClassBinding(el, item, expr, itemIndex, listContext);
            }
        });

        // Also check the item element itself for class binding
        const itemClassExpr = this._getAttr(itemEl, 'bind-class');
        if (itemClassExpr && hasExternalRef(itemClassExpr)) {
            this._processOptimizedClassBinding(itemEl, item, itemClassExpr, itemIndex, listContext);
        }

        // Find all style bindings that might contain external refs (excluding nested list elements)
        const styleBindingsRaw = itemEl.querySelectorAll('[data-bind-style],[data-wf-bind-style]');
        const styleBindings = this._filterOutNestedListElements(styleBindingsRaw, itemEl, hasNestedLists);
        styleBindings.forEach(el => {
            const styleExpr = this._getAttr(el, 'bind-style');
            if (styleExpr && hasExternalRef(styleExpr)) {
                this._processStyleBinding(el, item, styleExpr, itemIndex, listContext);
            }
        });

        // Also check the item element itself for style binding
        const itemStyleExpr = this._getAttr(itemEl, 'bind-style');
        if (itemStyleExpr && hasExternalRef(itemStyleExpr)) {
            this._processStyleBinding(itemEl, item, itemStyleExpr, itemIndex, listContext);
        }

        // Find all HTML bindings that might contain external refs (excluding nested list elements)
        const htmlBindingsRaw = itemEl.querySelectorAll('[data-bind-html],[data-wf-bind-html]');
        const htmlBindings = this._filterOutNestedListElements(htmlBindingsRaw, itemEl, hasNestedLists);
        htmlBindings.forEach(el => {
            const htmlPath = this._getAttr(el, 'bind-html');
            if (htmlPath && hasExternalRef(htmlPath)) {
                this._executeFallbackBindHtml(el, item, htmlPath, listContext, itemIndex);
            }
        });

        // Also check the item element itself for HTML binding
        const itemHtmlPath = this._getAttr(itemEl, 'bind-html');
        if (itemHtmlPath && hasExternalRef(itemHtmlPath)) {
            this._executeFallbackBindHtml(itemEl, item, itemHtmlPath, listContext, itemIndex);
        }

        // Find all attr bindings that might contain external refs (excluding nested list elements)
        const attrBindingsRaw = itemEl.querySelectorAll('[data-bind-attr],[data-wf-bind-attr]');
        const attrBindings = this._filterOutNestedListElements(attrBindingsRaw, itemEl, hasNestedLists);
        attrBindings.forEach(el => {
            const attrExpr = this._getAttr(el, 'bind-attr');
            if (attrExpr && hasExternalRef(attrExpr)) {
                this._processAttrBinding(el, item, attrExpr, itemIndex, listContext);
            }
        });

        // Also check the item element itself for attr binding
        const itemAttrExpr = this._getAttr(itemEl, 'bind-attr');
        if (itemAttrExpr && hasExternalRef(itemAttrExpr)) {
            this._processAttrBinding(itemEl, item, itemAttrExpr, itemIndex, listContext);
        }
    },
    /**
     * Refresh list item bindings that use item-level computed properties.
     * Called when a store that the component depends on changes.
     * This re-evaluates all computed bindings in list items that have parameterized computeds.
     *
     * @param {Element} itemEl - The list item element
     * @param {Object} item - The item data
     * @param {number} itemIndex - Index of the item in the list
     * @param {Object} listContext - The list context
     * @param {Object} instance - The component instance
     * @private
     */
    _refreshListItemComputedBindings(itemEl, item, itemIndex, listContext, instance) {
        if (!itemEl || !instance || !item) return;

        // Ensure stateManager and original computed functions exist
        if (!instance.stateManager || !instance.stateManager._originalComputedFunctions) return;

        // Check for nested lists and filter them out to prevent cross-contamination
        const hasNestedLists = itemEl.querySelector('[data-list],[data-wf-list]') !== null;

        // Helper to check if a computed is item-level (has parameters)
        const isItemLevelComputed = (computedName) => {
            const originalFn = instance?.stateManager?._originalComputedFunctions?.get(computedName);
            return originalFn && originalFn.length > 0;
        };

        // Find all text bindings that use computed: prefix (excluding nested list elements)
        const textBindingsRaw = itemEl.querySelectorAll('[data-bind],[data-wf-bind]');
        const textBindings = this._filterOutNestedListElements(textBindingsRaw, itemEl, hasNestedLists);
        textBindings.forEach(el => {
            const bindPath = this._getAttr(el, 'bind');
            if (bindPath && bindPath.startsWith('computed:')) {
                const computedName = bindPath.substring(9); // Remove 'computed:' prefix
                if (isItemLevelComputed(computedName)) {
                    // Re-evaluate using _evaluateComputedInListContext
                    const value = this._evaluateComputedInListContext(instance, computedName, item, itemIndex, listContext);
                    el.textContent = value != null ? String(value) : '';
                }
            }
        });

        // Also check the item element itself
        const itemBindPath = this._getAttr(itemEl, 'bind');
        if (itemBindPath && itemBindPath.startsWith('computed:')) {
            const computedName = itemBindPath.substring(9);
            if (isItemLevelComputed(computedName)) {
                const value = this._evaluateComputedInListContext(instance, computedName, item, itemIndex, listContext);
                itemEl.textContent = value != null ? String(value) : '';
            }
        }

        // Find all conditional bindings (data-show) that use computed: prefix
        const showBindingsRaw = itemEl.querySelectorAll('[data-show],[data-wf-show]');
        const showBindings = this._filterOutNestedListElements(showBindingsRaw, itemEl, hasNestedLists);
        showBindings.forEach(el => {
            const showExpr = this._getAttr(el, 'show');
            if (showExpr && showExpr.startsWith('computed:')) {
                const computedName = showExpr.substring(9);
                if (isItemLevelComputed(computedName)) {
                    const value = this._evaluateComputedInListContext(instance, computedName, item, itemIndex, listContext);
                    applyShow(el, value);
                }
            }
        });

        // Also check the item element itself for data-show
        const itemShowExpr = this._getAttr(itemEl, 'show');
        if (itemShowExpr && itemShowExpr.startsWith('computed:')) {
            const computedName = itemShowExpr.substring(9);
            if (isItemLevelComputed(computedName)) {
                const value = this._evaluateComputedInListContext(instance, computedName, item, itemIndex, listContext);
                applyShow(itemEl, value);
            }
        }

        // Find all class bindings that use computed: prefix
        const classBindingsRaw = itemEl.querySelectorAll('[data-bind-class],[data-wf-bind-class]');
        const classBindings = this._filterOutNestedListElements(classBindingsRaw, itemEl, hasNestedLists);
        classBindings.forEach(el => {
            const classExpr = this._getAttr(el, 'bind-class');
            if (classExpr && classExpr.startsWith('computed:')) {
                const computedName = classExpr.substring(9);
                if (isItemLevelComputed(computedName)) {
                    const value = this._evaluateComputedInListContext(instance, computedName, item, itemIndex, listContext);
                    // Diff-track via the kernel: preserves static/non-bound classes
                    // (el.className = value previously wiped them) and removes object
                    // keys that drop out (classList.toggle previously left them).
                    applyClass(el, value);
                }
            }
        });

        // Also check the item element itself for class binding
        const itemClassExpr = this._getAttr(itemEl, 'bind-class');
        if (itemClassExpr && itemClassExpr.startsWith('computed:')) {
            const computedName = itemClassExpr.substring(9);
            if (isItemLevelComputed(computedName)) {
                const value = this._evaluateComputedInListContext(instance, computedName, item, itemIndex, listContext);
                applyClass(itemEl, value);
            }
        }
    },
    /**
     * Refresh standalone (non-list) elements that have external() in their bindings.
     * Called when external store state changes to update dependent component elements.
     * @param {Object} instance - The component instance
     * @private
     */
    _refreshStandaloneExternalBindings(instance) {
        if (!instance || !instance.element) return;

        // GATE: Effect system handles all bindings including external store refs
        if (instance._renderEffect) return;

        const el = instance.element;

        // Helper to detect external dependencies: both external() and $store.path shorthand
        const hasExternalRef = (expr) => expr.includes('external(') || /\$[a-zA-Z]/.test(expr);

        // Helper to check if an element is inside a list
        const isInsideList = (element) => {
            let parent = element.parentElement;
            while (parent && parent !== el) {
                if (this._getAttr(parent, 'list')) {
                    return true;
                }
                parent = parent.parentElement;
            }
            return false;
        };

        // Find all attr bindings with external refs that are NOT inside lists
        const attrBindings = el.querySelectorAll('[data-bind-attr],[data-wf-bind-attr]');
        attrBindings.forEach(bindEl => {
            const attrExpr = this._getAttr(bindEl, 'bind-attr');
            if (attrExpr && hasExternalRef(attrExpr) && !isInsideList(bindEl)) {
                // Standalone element - pass null for list-specific context
                this._processAttrBinding(bindEl, instance.state, attrExpr, 0, null);
            }
        });

        // Also check the component root element itself
        const rootAttrExpr = this._getAttr(el, 'bind-attr');
        if (rootAttrExpr && hasExternalRef(rootAttrExpr)) {
            this._processAttrBinding(el, instance.state, rootAttrExpr, 0, null);
        }

        // Handle other binding types that might have external refs - text bindings
        const textBindings = el.querySelectorAll('[data-bind],[data-wf-bind]');
        textBindings.forEach(bindEl => {
            const bindPath = this._getAttr(bindEl, 'bind');
            if (bindPath && hasExternalRef(bindPath) && !isInsideList(bindEl)) {
                const isInput = bindEl.tagName === 'INPUT' || bindEl.tagName === 'TEXTAREA' || bindEl.tagName === 'SELECT';
                this._executeFallbackBind(bindEl, instance.state, bindPath, isInput, null, 0);
            }
        });

        // Class bindings
        const classBindings = el.querySelectorAll('[data-bind-class],[data-wf-bind-class]');
        classBindings.forEach(bindEl => {
            const expr = this._getAttr(bindEl, 'bind-class');
            if (expr && hasExternalRef(expr) && !isInsideList(bindEl)) {
                this._processOptimizedClassBinding(bindEl, instance.state, expr, 0, null);
            }
        });

        // Style bindings
        const styleBindings = el.querySelectorAll('[data-bind-style],[data-wf-bind-style]');
        styleBindings.forEach(bindEl => {
            const styleExpr = this._getAttr(bindEl, 'bind-style');
            if (styleExpr && hasExternalRef(styleExpr) && !isInsideList(bindEl)) {
                this._processStyleBinding(bindEl, instance.state, styleExpr, 0, null);
            }
        });

        // HTML bindings
        const htmlBindings = el.querySelectorAll('[data-bind-html],[data-wf-bind-html]');
        htmlBindings.forEach(bindEl => {
            const htmlPath = this._getAttr(bindEl, 'bind-html');
            if (htmlPath && hasExternalRef(htmlPath) && !isInsideList(bindEl)) {
                this._executeFallbackBindHtml(bindEl, instance.state, htmlPath, null, 0);
            }
        });
    },
};
