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
    _bindWithCompiledMetadata(itemEl, item, compiledMetadata, listContext, itemIndex, context) {
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

        // Paint text/html/model/show via the applier program (S3): one engine
        // pass over the compiled record list. This is FILTER_ALL — every
        // text-family record is repainted (initial bind / same-key replace).
        // Decorative bindings (class/style/attr) are applied separately by the
        // _applyRowDecor evaluator pass, which every caller runs after this one;
        // render has its own conditional-context path. Both are skipped here.
        // The applier program is emitted for every list/slot template in a
        // __FEATURE_LISTS__ build, which is the only build where this method
        // runs, so the record is always present; guard defensively rather than
        // paint nothing if a future caller arrives without one.
        const program = compiledMetadata._appProgram;
        if (program) {
            this._runAppliersAll(allElementsArray, item, program, ctx);
        }

        return allElementsArray;
    },
    /**
     * Applier-program execution engine — full (FILTER_ALL) variant (S3). Paints
     * a row by iterating the compiled _appProgram record list over the
     * text-family kinds (TEXT/HTML/MODEL/SHOW): the initial-bind / same-key
     * replace path, where every text-family record is repainted. CLASS/STYLE/
     * ATTR (owned by _applyRowDecor) and RENDER (conditional-context path) are
     * skipped here; the targeted counterpart is _runAppliersKeyed (FILTER_KEY).
     * `spec` is the per-type binding object; each write path is the canonical
     * BindingWriters kernel so the DOM output is byte-identical with the
     * component path.
     * @private
     */
    _runAppliersAll(elements, item, program, ctx) {
        for (let i = 0; i < program.length; i++) {
            const rec = program[i];
            const kind = rec.kind;
            // Text-family only in the full pass; decor + render paint elsewhere.
            if (kind === 'CLASS' || kind === 'STYLE' || kind === 'ATTR' || kind === 'RENDER') continue;
            const el = elements[rec.elementIndex];
            if (!el) continue;
            const spec = rec.spec;

            if (kind === 'TEXT') {
                let value;
                // Fast path for simple property bindings; fall back to full
                // resolution when item[path] is undefined (may be an implicit
                // computed named on the component, not the item).
                if (spec.isSimplePath) {
                    value = item[spec.path];
                    if (value === undefined) {
                        value = this._resolveCompiledBinding(spec, item, ctx);
                        if (value === undefined) continue;
                    }
                } else {
                    value = this._resolveCompiledBinding(spec, item, ctx);
                    if (value === undefined && !spec.isExpression && !spec.isComputed &&
                        !spec.isListContextVar && !spec.isPropsPath && !spec.isLengthProperty &&
                        spec.path && item && typeof item === 'object') {
                        continue;
                    }
                }
                if (this._applyCustomElementAdapter(el, value)) {
                    listBoundElements.add(el);
                    continue;
                }
                const strValue = __wf_str(value);
                if (spec.isInput) {
                    if (el.value !== strValue) el.value = strValue;
                } else {
                    __wf_txt(el, strValue);
                }
                listBoundElements.add(el);
            } else if (kind === 'HTML') {
                const value = this._resolveCompiledBinding(spec, item, ctx);
                const htmlStr = value == null ? '' : value;
                el.innerHTML = this._sanitizeOrPassHTML(htmlStr);
            } else if (kind === 'MODEL') {
                const value = this._getValueFromItem(item, spec.path);
                if (this._applyCustomElementAdapter(el, value)) continue;
                applyModel(el, value, spec.type);
            } else if (kind === 'SHOW') {
                const rawValue = this._resolveCompiledBinding(spec, item, ctx);
                const value = spec.negate ? !rawValue : Boolean(rawValue);
                applyShow(el, value);
            }
        }
    },
    /**
     * Applier-program execution engine — targeted (FILTER_KEY) variant (S3).
     * Repaints the row's HTML/MODEL/SHOW records for a single changed key,
     * the update-path counterpart to _runAppliersAll. TEXT is excluded (row
     * text targeting is owned by RowCompiler's applyRowTextUpdate); CLASS/
     * STYLE/ATTR (decor) and RENDER are painted on their own paths.
     *
     * `key` is the changed item prop (always flat here — the dispatcher's smh
     * arm keys are fast-touch reads, so prop === root); a record matches when
     * its dep set includes the key, OR — for HTML/SHOW only — it references a
     * component computed by name (the bypass MODEL deliberately lacks: a model
     * value is item-only, so a computed-name collision must not repaint it).
     * That single per-kind rule replaces the three divergent _targetedProp
     * filter bodies the typed executors used to carry. `key === null` repaints
     * every HTML/MODEL/SHOW record (the applyAll case). Writes mirror
     * _runAppliersAll verbatim, so the DOM output is byte-identical.
     * @private
     */
    _runAppliersKeyed(elements, item, program, ctx, key) {
        if (!program) return;
        let hasComputeds = false, computeds = null;
        if (key !== null) {
            const componentInstance = ctx?.componentInstance;
            hasComputeds = this._instanceHasComputeds(componentInstance);
            computeds = hasComputeds ? componentInstance.stateManager.computed : null;
        }
        for (let i = 0; i < program.length; i++) {
            const rec = program[i];
            const kind = rec.kind;
            if (kind !== 'HTML' && kind !== 'MODEL' && kind !== 'SHOW') continue;
            const el = elements[rec.elementIndex];
            if (!el) continue;
            const spec = rec.spec;

            if (key !== null) {
                let m = spec.isExpression
                    ? (spec.expressionVars && spec.expressionVars.indexOf(key) !== -1)
                    : (spec.path === key);
                // Computed-name bypass: HTML/SHOW may read the changed prop
                // transitively through a computed; MODEL is item-only and never
                // bypasses (omitting this once froze per-row data-show on an
                // item-level computed when component state mutated — RS-33).
                if (!m && hasComputeds && kind !== 'MODEL') {
                    if (spec.isExpression && spec.expressionVars) {
                        for (let v = 0; v < spec.expressionVars.length; v++) {
                            if (computeds[spec.expressionVars[v]]) { m = true; break; }
                        }
                    } else if (spec.path && computeds[spec.path]) {
                        m = true;
                    }
                }
                if (!m) continue;
            }

            if (kind === 'HTML') {
                const value = this._resolveCompiledBinding(spec, item, ctx);
                const htmlStr = value == null ? '' : value;
                el.innerHTML = this._sanitizeOrPassHTML(htmlStr);
            } else if (kind === 'MODEL') {
                const value = this._getValueFromItem(item, spec.path);
                if (this._applyCustomElementAdapter(el, value)) continue;
                applyModel(el, value, spec.type);
            } else if (kind === 'SHOW') {
                const rawValue = this._resolveCompiledBinding(spec, item, ctx);
                const value = spec.negate ? !rawValue : Boolean(rawValue);
                applyShow(el, value);
            }
        }
    },
    /**
     * Applier-program execution engine — positional (FILTER_INDEX) variant (S3).
     * The structural-change counterpart run per row from the onComplete sweep:
     * repaints TEXT/SHOW records whose value can move when list positions shift.
     * TEXT matches an expression that reads a position token (_index/_first/_last/
     * _length); SHOW matches that OR a conditional that resolves through an
     * item-level computed (which can read the frame internally). The predicate is
     * the SAME _expressionUsesListContext the attribute sweep used (spec.path IS
     * the expression string), so the selected set is unchanged; resolve + write go
     * through the canonical engine path (matching initial bind). RENDER is handled
     * by _runRenderContextsIndexed; CLASS/ATTR stay on the decor sweep.
     * @private
     */
    _runAppliersIndexed(elements, item, program, ctx, computed) {
        if (!program) return;
        for (let i = 0; i < program.length; i++) {
            const rec = program[i];
            const kind = rec.kind;
            if (kind !== 'TEXT' && kind !== 'SHOW') continue;
            const spec = rec.spec;
            const expr = spec.path;
            let match;
            if (kind === 'TEXT') {
                match = this._expressionUsesListContext(expr) && this.isExpression(expr);
            } else {
                match = this._expressionUsesListContext(expr)
                    || (computed && this._conditionalRefsComputed(spec, computed));
            }
            if (!match) continue;
            const el = elements[rec.elementIndex];
            if (!el) continue;

            if (kind === 'TEXT') {
                let value;
                if (spec.isSimplePath) {
                    value = item[spec.path];
                    if (value === undefined) {
                        value = this._resolveCompiledBinding(spec, item, ctx);
                        if (value === undefined) continue;
                    }
                } else {
                    value = this._resolveCompiledBinding(spec, item, ctx);
                    if (value === undefined && !spec.isExpression && !spec.isComputed &&
                        !spec.isListContextVar && !spec.isPropsPath && !spec.isLengthProperty &&
                        spec.path && item && typeof item === 'object') {
                        continue;
                    }
                }
                if (this._applyCustomElementAdapter(el, value)) {
                    listBoundElements.add(el);
                    continue;
                }
                const strValue = __wf_str(value);
                if (spec.isInput) {
                    if (el.value !== strValue) el.value = strValue;
                } else {
                    __wf_txt(el, strValue);
                }
                listBoundElements.add(el);
            } else {
                let rawValue;
                // A bare position token (data-show="_last") is left a non-expression
                // path by the compiler, so the path resolver returns undefined;
                // resolve it straight off the frame like the render pass (the old
                // sweep did this implicitly by evaluating it against a merged-state
                // proxy). Compound expressions (data-show="_index > 2") carry
                // isExpression and resolve through the engine's own frame switch.
                if (!spec.isExpression && spec.path && this._listContextVars.has(spec.path)) {
                    switch (spec.path) {
                        case '_index': rawValue = ctx.itemIndex; break;
                        case '_length': rawValue = ctx.listLength; break;
                        case '_first': rawValue = ctx.itemIndex === 0; break;
                        case '_last': rawValue = ctx.itemIndex === ctx.listLength - 1; break;
                    }
                } else {
                    rawValue = this._resolveCompiledBinding(spec, item, ctx);
                }
                applyShow(el, spec.negate ? !rawValue : Boolean(rawValue));
            }
        }
    },
    /**
     * Positional/computed re-eval of a row's data-render conditionals from the
     * onComplete sweep. A render whose token is a bare position frame value
     * (_index/_first/_last/_length) is resolved from the frame directly; one that
     * resolves through an item-level computed goes through the canonical resolver.
     * Either way the row's stored render context toggles only on a real change,
     * unifying the two former render sweep bodies. Render targets the context
     * (insert/remove), not the elements array, so it stays out of the record loop.
     * @private
     */
    _runRenderContextsIndexed(renderContexts, item, ctx, computed) {
        if (!renderContexts) return;
        const listContextVars = this._listContextVars;
        const index = ctx.itemIndex;
        const listLength = ctx.listLength;
        for (let r = 0; r < renderContexts.length; r++) {
            const rc = renderContexts[r];
            if (!rc || !rc.context || !rc.binding) continue;
            const b = rc.binding;
            let shouldRender;
            if (b.path && listContextVars.has(b.path)) {
                let fv;
                switch (b.path) {
                    case '_index': fv = index; break;
                    case '_length': fv = listLength; break;
                    case '_first': fv = index === 0; break;
                    case '_last': fv = index === listLength - 1; break;
                }
                shouldRender = b.negate ? !fv : !!fv;
            } else if (computed && this._conditionalRefsComputed(b, computed)) {
                const raw = this._resolveCompiledBinding(b, item, ctx);
                shouldRender = b.negate ? !raw : Boolean(raw);
            } else {
                continue;
            }
            if (shouldRender !== rc.context.isRendered) {
                rc.context._updateConditionalElement(shouldRender);
            }
        }
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
