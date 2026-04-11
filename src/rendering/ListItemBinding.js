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
    _bindItemData(itemEl, item, itemIndex, context, skipNestedCheck = false, precomputedMetadata = null) {
        // Early validation
        if (!item || typeof item !== 'object') return;

        // Store metadata for deferred context creation
        itemEl._bindItemData = item;
        itemEl._bindItemIndex = itemIndex;

        // PERF FIX: Update _parentIndex on existing binding contexts when rebinding
        // This handles the case where contexts were created lazily before an element
        // was reused for a different index position. Without this, stale _parentIndex
        // values cause model bindings to update the wrong item.
        //
        // OPTIMIZATION: Skip during initial creation - fresh items from template have no contexts
        // Only run for reused elements (indicated by existing _cachedElementsArray or _bindingElements)
        if (this._contextRegistry?.contextsByElement) {
            // Use cached elements if available (much faster than querySelectorAll)
            const cachedElements = itemEl._cachedElementsArray || itemEl._bindingElements;
            if (cachedElements) {
                for (let i = 0; i < cachedElements.length; i++) {
                    const el = cachedElements[i];
                    if (!el) continue;
                    const ctx = this._contextRegistry.contextsByElement.get(el);
                    if (ctx && ctx._parentIndex !== undefined && ctx._parentIndex !== itemIndex) {
                        ctx._parentIndex = itemIndex;
                    }
                }
            }
            // If no cached elements, skip - this is a fresh item with no contexts
        }

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

        // PHASE 3.5: Store compiled metadata for post-render updates
        // This enables metadata-based updates even for cloneNode path
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
            const componentInstance = context?.componentInstance;
            const scope = {
                componentState: componentInstance?.state || {},
                componentInstance,
                itemIndex,
                listLength: context?.data?.length || 0,
                listContext: context,
                propsData: componentInstance?._propsData
            };

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

        // PERF: Reuse context object — avoids per-item allocation in tight loops
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
        if (!(_skipStyleAttr && compiledMetadata.styleEvaluators?.length) &&
            compiledMetadata.styleBindings && compiledMetadata.styleBindings.length > 0) {
            this._executeStyleBindings(allElementsArray, compiledMetadata.styleBindings, item, itemIndex, context);
        }
        if (!(_skipStyleAttr && compiledMetadata.attrEvaluators?.length) &&
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
                if (!path || path.length === 0) {
                    allElementsArray[i] = itemEl;
                } else {
                    let current = itemEl;
                    for (let p = 0; p < path.length; p++) {
                        if (!current.children || !current.children[path[p]]) {
                            current = null;
                            break;
                        }
                        current = current.children[path[p]];
                    }
                    allElementsArray[i] = current;
                }
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
     * Execute data-bind bindings from compiled metadata
     * @private
     */
    _executeBindings(elementsArray, bindings, item, ctx) {
        const targetedProp = this._targetedProp;
        for (let i = 0; i < bindings.length; i++) {
            const binding = bindings[i];

            // Targeted rebind: skip DOM write for bindings not matching changed prop
            if (targetedProp) {
                const matches = binding.isExpression
                    ? (binding.expressionVars && binding.expressionVars.indexOf(targetedProp) !== -1)
                    : (binding.path === targetedProp);
                if (!matches) continue;
            }

            const el = elementsArray[binding.index];
            if (!el) continue;

            let value;

            // PERF: Fast path for simple property bindings (e.g., data-bind="label")
            // Bypasses _resolveCompiledBinding entirely — no destructuring, no branch checks,
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
            const strValue = value == null ? '' : String(value);
            if (binding.isInput) {
                // Skip writeback if a debounce is pending on this input
                if (el._debounceTimeout) continue;
                if (el.value !== strValue) {
                    el.value = strValue;
                }
            } else {
                if (el.textContent !== strValue) {
                    el.textContent = strValue;
                }
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
        for (let i = 0; i < htmlBindings.length; i++) {
            const binding = htmlBindings[i];
            const el = elementsArray[binding.index];
            if (!el) continue;

            const value = this._resolveCompiledBinding(binding, item, ctx);

            // Targeted rebind: skip DOM write for non-matching bindings
            if (targetedProp && binding.path !== targetedProp) continue;

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
        for (let i = 0; i < models.length; i++) {
            const modelBinding = models[i];
            const el = elementsArray[modelBinding.index];
            if (!el) continue;

            // Skip writeback if a debounce is pending — the user is still typing
            // and the state hasn't been synced yet. Writing the stale state value
            // back would overwrite the user's in-progress input.
            if (el._debounceTimeout) continue;

            const value = this._getValueFromItem(item, modelBinding.path);

            // Targeted rebind: skip DOM write for non-matching bindings
            if (targetedProp && modelBinding.path !== targetedProp) continue;

            if (this._applyCustomElementAdapter(el, value)) {
                continue;
            }

            if (modelBinding.type === 'checkbox') {
                el.checked = Boolean(value);
            } else if (modelBinding.type === 'radio') {
                el.checked = el.value === String(value);
            } else {
                el.value = value == null ? '' : value;
            }
        }
    },
    /**
     * Execute data-show bindings from compiled metadata
     * @private
     */
    _executeShows(elementsArray, shows, item, ctx) {
        const targetedProp = this._targetedProp;
        for (let i = 0; i < shows.length; i++) {
            const binding = shows[i];
            const el = elementsArray[binding.index];
            if (!el) continue;

            // Resolve value using consolidated helper
            const rawValue = this._resolveCompiledBinding(binding, item, ctx);

            // Targeted rebind: skip DOM write for non-matching bindings
            if (targetedProp) {
                const matches = binding.isExpression
                    ? (binding.expressionVars && binding.expressionVars.indexOf(targetedProp) !== -1)
                    : (binding.path === targetedProp);
                if (!matches) continue;
            }

            // Apply negate flag and convert to display style
            const value = binding.negate ? !rawValue : Boolean(rawValue);
            el.style.display = value ? '' : 'none';
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
        const targetedProp = this._targetedProp;

        for (let i = 0; i < classBindings.length; i++) {
            const classBinding = classBindings[i];
            const el = elementsArray[classBinding.index];
            if (!el) continue;

            // PERF: Use pre-computed flags from compile time
            if (classBinding.isSimpleProperty !== undefined) {
                // Fast path: use pre-computed metadata
                if (classBinding.isSimpleProperty) {
                    // Simple property binding - check for implicit computed first
                    const expression = classBinding.expression;

                    let value;
                    if (componentInstance?.stateManager?.computed?.[expression]) {
                        value = this._evaluateComputedInListContext(
                            componentInstance, expression, item, itemIndex, listContext
                        );
                    } else {
                        value = this._getValueFromItem(item, expression);
                    }
                    // Targeted rebind: skip DOM write if this prop didn't change
                    if (targetedProp && expression !== targetedProp) continue;
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
                        // Computed deps can't be checked cheaply — always write
                        this._toggleBoundClass(el, value ? String(value) : '');
                    }
                } else if (classBinding.compiledFn && classBinding.expressionVars) {
                    // PERF: Reuse args array — cached on the binding to avoid allocation per call
                    const vars = classBinding.expressionVars;
                    const args = classBinding._args || (classBinding._args = new Array(vars.length));
                    for (let v = 0; v < vars.length; v++) {
                        args[v] = item[vars[v]];
                    }
                    // Targeted rebind: skip DOM write if changed prop not in expression vars
                    if (targetedProp && vars.indexOf(targetedProp) === -1) continue;
                    try {
                        const className = classBinding.compiledFn(...args);
                        this._toggleBoundClass(el, className ? String(className) : '');
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
    /**
     * Execute single data-bind in fallback mode
     * @private
     */
    _executeFallbackBind(el, item, bindPath, isInput, listContext, itemIndex) {
        const componentInstance = listContext?.componentInstance;
        const scope = {
            componentState: componentInstance?.state || {},
            componentInstance,
            itemIndex,
            listLength: listContext?.data?.length || 0,
            listContext,
            propsData: componentInstance?._propsData
        };

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
        const componentInstance = listContext?.componentInstance;
        const scope = {
            componentState: componentInstance?.state || {},
            componentInstance,
            itemIndex,
            listLength: listContext?.data?.length || 0,
            listContext,
            propsData: componentInstance?._propsData
        };

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

        const type = el.type;

        if (type === 'checkbox') {
            el.checked = Boolean(value);
        } else if (type === 'radio') {
            el.checked = el.value === String(value);
        } else {
            el.value = value == null ? '' : value;
        }
    },
    /**
     * Execute single data-show in fallback mode
     * @private
     */
    _executeFallbackShow(el, item, showPath, listContext, itemIndex) {
        const componentInstance = listContext?.componentInstance;
        const scope = {
            componentState: componentInstance?.state || {},
            componentInstance,
            itemIndex,
            listLength: listContext?.data?.length || 0,
            listContext,
            propsData: componentInstance?._propsData
        };

        // _resolveRawBinding handles negation and all path types (computed:, $store.path, expressions, etc.)
        const value = this._resolveRawBinding(showPath, item, scope);
        el.style.display = value ? '' : 'none';
    },
    /**
     * Bind model and show on root element itself
     * @private
     */
    _bindRootElementModelShow(itemEl, item, ds, itemIndex, context) {
        if (ds.model) {
            const value = this._getValueFromItem(item, ds.model);
            const type = itemEl.type;

            if (type === 'checkbox') {
                itemEl.checked = Boolean(value);
            } else if (type === 'radio') {
                itemEl.checked = itemEl.value === String(value);
            } else if (itemEl.tagName === 'INPUT' || itemEl.tagName === 'TEXTAREA' || itemEl.tagName === 'SELECT') {
                itemEl.value = value == null ? '' : value;
            }
        }

        if (ds.show) {
            const componentInstance = context?.componentInstance;
            const scope = {
                componentState: componentInstance?.state || {},
                componentInstance,
                itemIndex,
                listLength: context?.data?.length || 0,
                listContext: context,
                propsData: componentInstance?._propsData
            };

            const value = this._resolveRawBinding(ds.show, item, scope);
            itemEl.style.display = value ? '' : 'none';
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
        // Initialize tracking set if needed
        if (!element._prevBoundClasses) {
            element._prevBoundClasses = new Set();
        }

        // PERF OPTIMIZATION 1.3: Early exit if classes unchanged
        // Compare new classes with previous to skip DOM operations when unchanged
        const prevClasses = element._prevBoundClasses;
        const trimmedNew = newClasses ? newClasses.trim() : '';

        // Fast path: both empty
        if (!trimmedNew && prevClasses.size === 0) {
            return;
        }

        // Parse new classes once (reused for comparison and application)
        let newClassArray = null;
        if (trimmedNew) {
            newClassArray = trimmedNew.split(/\s+/);
            // Filter out empty strings from split
            let validCount = 0;
            for (let i = 0; i < newClassArray.length; i++) {
                if (newClassArray[i]) validCount++;
            }

            // Check if same size and all classes match
            if (validCount === prevClasses.size) {
                let allMatch = true;
                for (let i = 0; i < newClassArray.length; i++) {
                    const cls = newClassArray[i];
                    if (cls && !prevClasses.has(cls)) {
                        allMatch = false;
                        break;
                    }
                }
                if (allMatch) {
                    return; // Classes unchanged, skip DOM operations
                }
            }
        }

        // Remove all previously bound classes
        prevClasses.forEach(cls => {
            if (cls && element.classList.contains(cls)) {
                element.classList.remove(cls);
            }
        });
        prevClasses.clear();

        // Add the new class(es) if they exist
        if (newClassArray) {
            for (let i = 0; i < newClassArray.length; i++) {
                const cls = newClassArray[i];
                if (cls) {
                    element.classList.add(cls);
                    prevClasses.add(cls);
                }
            }
        }
    },

    /**
     * Ensure contexts are created for a list item element
     * Called on-demand when contexts are needed (e.g., before event handling)
     * @param {HTMLElement} itemEl - The list item element
     */
    _ensureItemContexts(itemEl) {

        // Skip if contexts already created or no data available
        if (!itemEl._needsContexts || !itemEl._bindItemData) {
            return;
        }

        // Get stored metadata
        const itemIndex = itemEl._bindItemIndex;
        const allElements = itemEl._bindingElements;

        // Get the list context
        const listContext = itemEl._listContext;
        const componentInstance = listContext?.componentInstance;

        if (!this._contextSystemInitialized || !this._contextRegistry || !componentInstance) {
            // Can't create contexts without the registry or component instance
            return;
        }

        // PERF: Use listContext directly - it's already verified when stored on itemEl._listContext
        // in mapArray's onCreate callback
        let verifiedListContext = listContext;

        // ============================================================
        // PHASE 3.5: Metadata-based context creation (for stripped templates)
        // ============================================================
        // If compiled metadata is available, use it instead of reading attributes.
        // This enables attribute stripping for innerHTML-path templates.
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

        // --- PHASE 1: Create all non-action contexts first ---
        const createdContexts = new Map(); // Track contexts by element

        for (let i = 0; i < sortedElements.length; i++) {
            const el = sortedElements[i];

            // Skip action elements for now (handled separately)
            if (this._hasAttr(el, 'action')) continue;

            // --- DATA-BIND CONTEXTS ---
            if (this._hasAttr(el, 'bind')) {
                const bindPath = this._getAttr(el, 'bind');
                if (!bindPath) continue;

                // Create binding context
                const bindingContext = this._contextRegistry.createBindingContext(
                    bindPath,
                    componentInstance,
                    el,
                    verifiedListContext, // CRITICAL: Direct parent relationship to list context
                    itemIndex
                );

                // Set parent index and store the context
                if (bindingContext) {
                    // PERF: _parentIndex already set during createBindingContext() via options.parentIndex
                    this._contextRegistry.contextsByElement.set(el, bindingContext);
                    createdContexts.set(el, bindingContext);
                }
            }

            // --- DATA-MODEL CONTEXTS ---
            if (this._hasAttr(el, 'model')) {
                const modelPath = this._getAttr(el, 'model');
                if (!modelPath) continue;

                // Create binding context with model flag
                const modelContext = this._contextRegistry.createBindingContext(
                    modelPath,
                    componentInstance,
                    el,
                    verifiedListContext, // CRITICAL: Direct parent relationship
                    itemIndex
                );

                if (modelContext) {
                    // PERF: _parentIndex already set during createBindingContext() via options.parentIndex
                    modelContext._isModelBinding = true;
                    createdContexts.set(el, modelContext);

                    // Set up event handling for this model
                    this._setupModelEventHandling(el, modelContext);
                }
            }

            // --- DATA-SHOW CONTEXTS ---
            if (this._hasAttr(el, 'show')) {
                const showPath = this._getAttr(el, 'show');
                if (!showPath) continue;

                // Create conditional context
                const conditionalContext = this._contextRegistry.createConditionalContext(
                    showPath,
                    componentInstance,
                    el,
                    verifiedListContext, // CRITICAL: Direct parent relationship
                    itemIndex
                );

                if (conditionalContext) {
                    // PERF: _parentIndex already set during createConditionalContext() via options.parentIndex
                    createdContexts.set(el, conditionalContext);
                }
            }
        }

        // --- PHASE 2: Create action contexts (after other contexts) ---
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

            // Parse actions
            const actionDefs = this._parseActions(actionAttr);

            // Create context for each action
            for (let k = 0; k < actionDefs.length; k++) {
                const {methodName, eventType, args: actionArgs} = actionDefs[k];

                // Skip invalid methods
                if (!methodName || typeof componentInstance.context[methodName] !== 'function') {
                    continue;
                }

                // Check if element already has an action context - if so, don't overwrite it
                if (this._contextRegistry.contextsByElement.get(actionEl)?.type === 'action') {
                    continue;
                }

                // Create action context
                const actionContext = this._contextRegistry.createActionContext(
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

        // --- Create binding contexts from metadata ---
        if (compiledMetadata.bindings) {
            for (const binding of compiledMetadata.bindings) {
                const el = allElements[binding.index];
                if (!el) continue;

                const bindingContext = this._contextRegistry.createBindingContext(
                    binding.path,
                    componentInstance,
                    el,
                    verifiedListContext,
                    itemIndex
                );

                if (bindingContext) {
                    // PERF: _parentIndex already set during createBindingContext() via options.parentIndex
                    this._contextRegistry.contextsByElement.set(el, bindingContext);
                    createdContexts.set(el, bindingContext);
                }
            }
        }

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

                // Parse actions (handle multiple actions like "click:save|blur:validate")
                const actionDefs = this._parseActions(action.actionName);

                for (const { methodName, eventType, args: actionArgs } of actionDefs) {
                    if (!methodName || typeof componentInstance.context[methodName] !== 'function') {
                        continue;
                    }

                    // Check if element already has an action context
                    if (this._contextRegistry.contextsByElement.get(actionEl)?.type === 'action') {
                        continue;
                    }

                    // PERF: Pass itemIndex to skip .closest() DOM query inside createActionContext
                    const actionContext = this._contextRegistry.createActionContext(
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
     * Dispose an item's Effect when the item is removed from the list.
     * @param {HTMLElement} itemEl - The list item DOM element
     * @private
     */
    _disposeItemEffect(itemEl) {
        if (itemEl._wfDisposeEffect) {
            itemEl._wfDisposeEffect();
            itemEl._wfDisposeEffect = null;
        }
        // Also clean up cached elements
        itemEl._wfBoundElements = null;
    }
};
