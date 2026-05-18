import { WF_ERRORS, wfError, wfWarn } from '../core/wfUtils.js';
import { ReactiveStateManager } from './ReactiveStateManager.js';
import { boundActionsCache } from '../core/DomMetadata.js';

// Attribute prefix helpers
const _isStrict = () => window.wildflower?.options?.useWfPrefixOnly;

function _cmGetAttr(el, name) {
    const val = el.getAttribute(`data-wf-${name}`);
    // If found, or if we are in strict mode, return the wf- value (even if null)
    return (val !== null || _isStrict()) ? val : el.getAttribute(`data-${name}`);
}

function _cmHasAttr(el, name) {
    const has = el.hasAttribute(`data-wf-${name}`);
    // If found, or if we are in strict mode, return the wf- result
    return (has || _isStrict()) ? has : el.hasAttribute(`data-${name}`);
}

function _buildElementMeta(element) {
    const tagName = element.tagName;
    return {
        tagName,
        tagNameLower: tagName.toLowerCase(),
        inputType: element.type,
        isInput: tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
    };
}

function _cmAttrSelector(name, val) {
    // Build array of attributes to query based on mode
    const attrs = _isStrict() ? [`data-wf-${name}`] : [`data-${name}`, `data-wf-${name}`];
    // Map to selector strings and join
    return attrs.map(attr => val !== undefined ? `[${attr}="${val}"]` : `[${attr}]`).join(',');
}

/** Resolve a value from a stateManager, handling computed: and external() prefixes */
function _resolveFromStateManager(stateManager, path, instance = null, wf = null) {
    if (!stateManager || !path) {
        return undefined;
    }

    if (path.startsWith('computed:')) {
        const computedPath = path.slice(9);
        if (computedPath.includes('.')) {
            // Nested computed path (e.g., "computed:menuItems.gettingStarted")
            return stateManager.resolveComputedPath(computedPath);
        } else {
            return stateManager.evaluateComputed(computedPath);
        }
    } else if (path.includes('external(')) {
        // Handle external() expressions for store data
        wf = wf || window.wildflower;
        if (!wf) return [];

        // Build the external function
        const externalFn = wf._getExternalFn(instance);

        // Evaluate the expression with the external function
        try {
            const result = wf.evaluateExpression(path, stateManager.state || {}, {
                cacheKey: 'resolveFromStateManager',
                additionalContext: { external: externalFn }
            });
            return result;
        } catch (error) {
            if (__DEV__) console.warn(`Error evaluating external path "${path}":`, error);
            return [];
        }
    } else {
        // First try to get from state
        const stateValue = stateManager.getValue(path);

        // If not found in state (undefined), check computed as fallback
        // This allows data-bind="myComputed" without requiring the computed: prefix
        // Note: If both state and computed have the same name, state wins (existing behavior)
        if (stateValue === undefined && !path.includes('.')) {
            // Only check for simple paths (not nested like "obj.prop")
            // Nested paths would need resolveComputedPath which is more complex
            if (stateManager.computed && typeof stateManager.computed[path] === 'function') {
                return stateManager.evaluateComputed(path);
            }
        }

        return stateValue;
    }
}

/**
 * Context — represents a single DOM-data binding relationship.
 * Types: binding, action, list, conditional, component, item.
 * Contexts form hierarchies (component → list → item → binding) mirroring the DOM.
 */
export class Context
{
    constructor(id, path, options = {}) {
        // Nested context IDs incorporate parent + index + uid to prevent collisions
        this.id = (options.parent?.id && options.parentIndex !== undefined)
            ? `${options.parent.id}[${options.parentIndex}]:${path}:${id}`
            : id;

        this._cache = new Map();
        this.path = path;
        this.parent = options.parent || null;
        this.children = new Map();
        this.data = options.data || null;
        this.element = options.element || null;
        this.componentInstance = options.componentInstance;
        this._wf = options.wf || null;
        this.type = options.type || 'generic';
        this.dependents = new Map();
        this._hasExplicitData = options.data !== undefined;
        this._resolveDepth = 0;
        if (options.parentIndex !== undefined) this._parentIndex = options.parentIndex;

        // Type-specific properties
        if (this.type === 'binding') {
            this.elementMeta = options.element ? _buildElementMeta(options.element) : null;
            this.modelModifiers = null;
        } else if (this.type === 'conditional') {
            this._placeholder = null;
            this._isRenderConditional = options.isRender || false;
        }
    }

    /**
     * Get the component ID this context belongs to
     * @returns {string|null} The component ID or null
     */
    get componentId() {
        return this.componentInstance ? this.componentInstance.id : null;
    }

    /** Resolve a value from component state, handling computed: prefix. @private */
    _resolveStateValue(path) {
        if (!this.componentInstance || !this.componentInstance.stateManager) {
            return undefined;
        }
        return _resolveFromStateManager(this.componentInstance.stateManager, path, this.componentInstance, this._wf);
    }

    /** Resolve the current data for this context, traversing hierarchy if needed. */
    resolveData() {
        // Action contexts have fixed structure — no caching or hierarchy traversal needed
        if (this.type === 'action') {
            return {
                method: this.data?.method || null,
                event: this.data?.event || 'click',
                options: this.data?.options || {}
            };
        }

        // Depth guard — prevents infinite recursion if context hierarchy is unexpectedly circular
        if (this._resolveDepth > 10) return this.data;
        this._resolveDepth = (this._resolveDepth || 0) + 1;

        try {
            // 1. Cache check (early return)
            const cached = this._checkResolveCache();
            if (cached !== undefined) return cached;

            // 2. Reactive list special path - update local data if length changed
            if (this._isReactiveListContext()) {
                this._handleReactiveListData();
            }

            // 3. Dependent array copy — prevents cross-component mutation of shared arrays
            if (this.dependents?.size > 0 && Array.isArray(this.data)) {
                return [...this.data];
            }

            // 4. Detached element path (early return)
            if (!this.isElementAttached() && this.element) {
                const detachedResult = this._handleDetachedElementData();
                if (detachedResult !== undefined) return detachedResult;
            }

            // 5. Type-based resolution
            const result = this._resolveByContextType();
            return this._cacheResult(result);

        } catch (error) {
            wfError(WF_ERRORS.CONTEXT_RESOLVE_ERROR, {
                context: this.path,
                suggestion: 'Check the data path and ensure the component state is properly initialized',
                cause: error
            });
            return [];
        } finally {
            this._resolveDepth--;
        }
    }

    /** @private */
    _cacheResult(result) {
        if (this._cache) {
            this._cache.set('resolvedData', { data: result, timestamp: Date.now() });
        }
        return result;
    }

    /** @private */
    _checkResolveCache(ttl = 50) {
        if (this._cache && this._cache.has('resolvedData')) {
            const cached = this._cache.get('resolvedData');
            if (Date.now() - cached.timestamp < ttl) return cached.data;
        }
        return undefined;
    }

    /** @private */
    _isReactiveListContext() {
        return this.type === 'list' &&
            this.componentInstance?.stateManager instanceof ReactiveStateManager;
    }

    /** @private */
    _handleReactiveListData() {
        try {
            const freshData = this._resolveStateValue(this.path);

            if (Array.isArray(freshData)) {
                this.data = [...freshData];
                this._hasExplicitData = true;
            }
        } catch (e) {
            // Ignore errors - fall back to normal resolution
        }
    }


    /** @private */
    _handleDetachedElementData() {
        if (this.data == null) return undefined;
        const cached = this._checkResolveCache(20);
        if (cached !== undefined) return cached;
        return this._cacheResult(Array.isArray(this.data) ? [...this.data] : this.data);
    }

    /** @private */
    _resolveByContextType() {
        switch (this.type) {
            case 'binding':
                return this._resolveBindingData();
            case 'conditional':
                return this._resolveConditionalData();
            case 'list':
                return this._resolveListData();
            case 'component':
                return this.componentInstance ? this.componentInstance.state : null;
            default:
                return this._resolveGenericData();
        }
    }

    /** @private */
    _resolveBindingData() {
        const path = this.path;

        // Try to resolve as item-level binding
        const itemLevelResult = this._resolveItemLevelData({ transformValue: (value) => value });
        if (itemLevelResult !== null) return itemLevelResult;

        // Standard binding
        if (this.componentInstance) {
            const wf = this._wf;
            if (wf && wf._classifyBinding) {
                // Cache classification — path never changes for a context
                if (!this._bindingDesc) {
                    this._bindingDesc = wf._classifyBinding(path);
                    // Register dependency once (only for non-expression paths)
                    if (this._bindingDesc.type !== 'expression' && this._registry) {
                        const componentContext = this._registry.getContextsByType('component')
                            .find(ctx => ctx.componentInstance && ctx.componentInstance.id === this.componentInstance.id);
                        if (componentContext) {
                            this._registry.registerDependency(this, componentContext, path);
                        }
                    }
                }
                const desc = this._bindingDesc;
                const result = wf._lookupFromComponent(desc, this.componentInstance);

                if (this._isClassBinding && desc.type === 'expression' && result !== undefined && result !== null) {
                    return String(result);
                }

                return result;
            }
        }

        return this.data;
    }

    /** @private */
    _resolveConditionalData() {
        const path = this.path;

        // Try item-level resolution for conditionals in list items
        if (this.parent && this.parent.type === 'list' && this._parentIndex !== undefined) {
            const itemLevelResult = this._resolveItemLevelData({
                transformValue: (value) => value,
                defaultValue: null
            });
            if (itemLevelResult !== null) return !!itemLevelResult;
        }

        if (!this.componentInstance) {
            wfError(WF_ERRORS.CONTEXT_MISSING_INSTANCE, {
                context: `${this.id}, path: ${path}`,
                suggestion: 'Ensure the component is properly initialized before evaluating conditionals'
            });
            return false;
        }

        const wf = this._wf;
        if (wf && wf._classifyBinding) {
            // Cache classification — path never changes for a context
            if (!this._bindingDesc) this._bindingDesc = wf._classifyBinding(path);
            const value = wf._lookupFromComponent(this._bindingDesc, this.componentInstance);
            return !!value;
        }

        // Fallback negation handling
        let actualPath = path;
        let negate = false;
        if (path.startsWith('!')) {
            negate = true;
            actualPath = path.slice(1);
        } else if (path.startsWith('computed:!')) {
            negate = true;
            actualPath = 'computed:' + path.slice(10);
        }
        const value = this._resolveStateValue(actualPath);
        return negate ? !value : !!value;
    }

    /** @private */
    _resolveListData() {
        const path = this.path;

        // Explicit data takes top priority
        if (this._hasExplicitData && Array.isArray(this.data)) {
            return [...this.data];
        }

        let result;

        if (!this.parent || this.parent.type === 'root') {
            if (this.componentInstance && this.componentInstance.stateManager) {
                try {
                    const wf = this._wf;
                    const hasStoreShorthand = path.includes('$');
                    const normalizedPath = hasStoreShorthand && wf && wf._normalizeStoreShorthands
                        ? wf._normalizeStoreShorthands(path) : path;

                    if (normalizedPath.includes('external(')) {
                        result = this._resolveExternalListData(normalizedPath);
                    } else {
                        result = this._resolveStateValue(normalizedPath);
                    }

                    if (Array.isArray(result)) {
                        this.data = [...result];
                        this._hasExplicitData = true;
                    }

                    return Array.isArray(result) ? result : [];
                } catch (error) {
                    if (__DEV__) wfWarn(`Error resolving from component state: ${error.message}`);
                }
            }
        } else {
            try {
                const parentData = this.parent.resolveData();
                if (Array.isArray(parentData) && this._parentIndex !== undefined) {
                    const parentItem = parentData[this._parentIndex];
                    if (parentItem && typeof parentItem === 'object') {
                        const nestedData = parentItem[path];
                        if (Array.isArray(nestedData)) return nestedData;

                        // Otherwise evaluate the path as an item-level computed
                        // on the parent item's shape, so nested lists whose
                        // source is a computed (not a stored field) resolve
                        // here the same way rendering does.
                        if (nestedData === undefined) {
                            const wf = this._wf;
                            if (wf && wf._resolveRawBinding) {
                                const scope = {
                                    componentState: this.componentInstance?.state || {},
                                    componentInstance: this.componentInstance,
                                    itemIndex: this._parentIndex,
                                    listLength: parentData.length,
                                    listContext: this.parent,
                                    propsData: this.componentInstance?._propsData
                                };
                                const computed = wf._resolveRawBinding(path, parentItem, scope);
                                if (Array.isArray(computed)) return computed;
                            }
                        }
                    }
                }
            } catch (error) {
                if (__DEV__) wfWarn(`Error resolving through parent: ${error.message}`);
            }
        }

        return Array.isArray(this.data) ? [...this.data] : [];
    }

    /** @private */
    _resolveExternalListData(path) {
        const wf = this._wf;
        if (!wf || !this.componentInstance) return [];

        try {
            const externalFn = wf._getExternalFn(this.componentInstance);
            const result = wf.evaluateExpression(path, this.componentInstance.state, {
                cacheKey: 'externalList',
                additionalContext: { external: externalFn }
            });
            return Array.isArray(result) ? result : [];
        } catch (error) {
            if (__DEV__) wfWarn(`Error resolving external list data "${path}": ${error.message}`);
            return [];
        }
    }

    /**
     * Default data resolution for generic contexts
     * @private
     */
    _resolveGenericData() {
        if (this.componentInstance && this.path) {
            return this._resolveStateValue(this.path);
        }
        return this.data;
    }

    _resolveItemLevelData(options) {
        const {
            transformValue = (v) => v,  // Default: return value as-is
            defaultValue = null         // Default value if resolution fails
        } = options;

        // If not in a list item context, return default
        if (!this.parent || this.parent.type !== 'list' || this._parentIndex === undefined) {
            return defaultValue;
        }

        // Get parent data
        const parentData = this.parent.resolveData();

        if (!Array.isArray(parentData) || this._parentIndex >= parentData.length) {
            return defaultValue;
        }

        // Get the specific item from the parent list
        const item = parentData[this._parentIndex];
        if (!item || typeof item !== 'object') {
            return defaultValue;
        }

        // Delegate to centralized resolver
        const wf = this._wf;
        if (!wf || !wf._resolveRawBinding) {
            return defaultValue;
        }

        const scope = {
            componentState: this.componentInstance?.state || {},
            componentInstance: this.componentInstance,
            itemIndex: this._parentIndex,
            listLength: parentData.length,
            listContext: this.parent,
            propsData: this.componentInstance?._propsData
        };

        const value = wf._resolveRawBinding(this.path, item, scope);
        return transformValue(value, item, this.path);
    }


    /**
     * Check if context element is still attached to DOM
     * @returns {boolean} - Whether the element is still in the document
     */
    isElementAttached()
    {
        return this.element && document.body.contains(this.element);
    }



    /** Update the data for this context. Returns whether data changed. */
    updateData(newData) {
        if (this.type === 'action') return;

        const isListContext = this.type === 'list' && Array.isArray(newData);

        if (isListContext) {
            this.data = [...newData];
            this._clearCache();

            // Propagate to parent list if this is a nested list context
            if (this.parent && this.parent.type === 'list' && this._parentIndex !== undefined && this.path) {
                try {
                    const parentData = this.parent.data;
                    if (Array.isArray(parentData) && this._parentIndex < parentData.length) {
                        const updatedParentData = [...parentData];
                        updatedParentData[this._parentIndex] = { ...updatedParentData[this._parentIndex] };
                        updatedParentData[this._parentIndex][this.path] = newData;
                        this.parent.updateData(updatedParentData);
                    }
                } catch (e) { /* continue even if propagation fails */ }
            }

            // List contexts: data + cache update is sufficient.
            // _handlePostUpdate is a no-op (no list branch).
            // Dependent notification is handled by EntitySystem pipeline.
            return true;
        }


        // Skip if data hasn't changed
        if (this.data === newData) return false;

        // Shallow array comparison
        if (Array.isArray(this.data) && Array.isArray(newData)) {
            if (this.data.length === newData.length) {
                let same = true;
                for (let i = 0; i < this.data.length; i++) {
                    if (this.data[i] !== newData[i]) { same = false; break; }
                }
                if (same) return false;
            }
        }

        this.data = Array.isArray(newData) ? [...newData] : newData;
        this._clearCache();
        this._handlePostUpdate(this.data);

        if (this._registry && this.dependents?.size > 0) {
            this._registry._notifyDependentContexts(this.id, this.path);
        }

        return true;
    }


    /** @private */
    _clearCache() {
        if (this._cache) this._cache.clear();
        else this._cache = new Map();
    }

    /** Type-specific DOM update after data change. @private */
    _handlePostUpdate(newData) {
        if (this._isModelBinding || this._isHTMLBinding) return; // handled by effects
        if (this._isClassBinding) this._updateClassBindingElement(newData);
        else if (this._isStyleBinding || this._isAttrBinding) return; // handled by _processStyleBinding/_processAttrBinding
        else if (this.type === 'binding') this._updateBindingElement(newData);
        else if (this.type === 'conditional') this._updateConditionalElement(newData);
    }

    /**
     * Update DOM element for binding context
     * @private
     */
    _updateBindingElement(newValue)
    {
        if (!this.element || !this.isElementAttached()) return;

        // Skip HTML binding contexts - they should use innerHTML, not textContent
        if (this._isHTMLBinding || _cmGetAttr(this.element, 'bind-html')) {
            return;
        }

        const stringValue = newValue !== undefined && newValue !== null ? String(newValue) : '';

        // Check for web component adapter (custom elements with hyphens in tag name)
        const meta = this.elementMeta;
        const tagName = meta?.tagNameLower ?? this.element.tagName.toLowerCase();
        if (tagName.includes('-')) {
            const adapter = wildflower?.getAdapter(tagName, this.element);
            if (adapter) {
                // Use raw newValue, not stringValue — boolean props like 'checked'
                // would break: element.checked = "false" is truthy
                if (this.element[adapter.prop] !== newValue) {
                    this.element[adapter.prop] = newValue;
                }
            }
            // Never set textContent on custom elements — it destroys light DOM children
            return;
        }

        const elTagName = meta?.tagName ?? this.element.tagName;
        if (elTagName === 'INPUT' ||
            elTagName === 'TEXTAREA' ||
            elTagName === 'SELECT')
        {
            // Skip radio and checkbox inputs - they use checked property, not value
            // Setting .value on radio buttons corrupts their HTML value attribute
            const elType = meta?.inputType ?? this.element.type;
            if (elType !== 'radio' && elType !== 'checkbox') {
                if (this.element.value !== stringValue) {
                    this.element.value = stringValue;
                }
            }
        } else
        {
            if (this.element.textContent !== stringValue) {
                this.element.textContent = stringValue;
            }
        }
    }

    /**
     * Update DOM element for conditional context
     * @private
     */
    _updateConditionalElement(isVisible)
    {
        // Handle render mode (data-render) - add/remove from DOM
        if (this.mode === 'render') {
            this._updateRenderConditional(isVisible);
            return;
        }

        // Handle show mode (data-show) - toggle display CSS
        if (!this.element || !this.isElementAttached()) return;

        // Use class-based visibility for anti-FOUC compatibility
        // CSS can use [data-show]:not(.wf-show) { display: none; } for FOUC prevention
        // Framework adds .wf-show class when visible, which overrides the CSS rule
        if (isVisible) {
            this.element.classList.add('wf-show');
            this.element.style.display = '';
        } else {
            this.element.classList.remove('wf-show');
            this.element.style.display = 'none';
        }
    }

    /**
     * Update DOM for render mode conditional (data-render)
     * Inserts/removes element from DOM rather than toggling visibility
     * @private
     */
    _updateRenderConditional(shouldRender)
    {
        const wasRendered = this.isRendered;

        // No change needed
        if (shouldRender === wasRendered) return;

        if (shouldRender && !wasRendered) {
            // Insert element into DOM
            this._insertRenderElement();
        } else if (!shouldRender && wasRendered) {
            // Remove element from DOM
            this._removeRenderElement();
        }

        this.isRendered = shouldRender;
    }

    /**
     * Insert the render element at the placeholder position
     * Note: this.templateClone is assigned externally by wildflowerJS._processDataRenderElement()
     * for data-render contexts (mode='render')
     * @private
     */
    _insertRenderElement()
    {
        if (!this.placeholder || !this.templateClone) return;

        // Clone the template (templateClone set by _processDataRenderElement in wildflowerJS.js)
        const newElement = this.templateClone.cloneNode(true);

        // Insert the element at the placeholder position
        this.placeholder.parentNode.insertBefore(newElement, this.placeholder);

        // Remove the placeholder
        this.placeholder.parentNode.removeChild(this.placeholder);
        this.placeholder = null;

        // Update context element reference
        this.element = newElement;

        const wildflower = this._wf;
        if (wildflower) {
            // Scan for nested components first (uses correct initialization path)
            wildflower.scan(newElement);

            // Recreate the component's render effect BEFORE processing inserted
            // bindings. _processInsertedElement strips data-bind-class (and similar)
            // attributes after one-time setup, so the effect must collect its
            // metadata while attributes are still on the DOM.
            const instance = this.componentInstance;
            if (instance && this._parentIndex === undefined && wildflower._disposeComponentRenderEffect && wildflower._createComponentRenderEffect) {
                // Re-scan DOM for effect metadata (can't reuse init-time _effectMeta
                // because only the data-render subtree was re-inserted — the full
                // component needs a fresh scan)
                instance._effectMeta = wildflower._collectComponentBindingMeta(instance);
                wildflower._disposeComponentRenderEffect(instance);
                wildflower._createComponentRenderEffect(instance);
            }

            // Process bindings and actions within the new element
            this._processInsertedElement(wildflower);

            // Process custom directives on the entire re-inserted subtree (only if plugin system is loaded)
            if (wildflower._processCustomDirectivesInSubtree && wildflower._customDirectives && wildflower._customDirectives.size > 0) {
                wildflower._processCustomDirectivesInSubtree(newElement, this.componentInstance);
            }
        }
    }

    /**
     * Remove the render element from DOM and insert placeholder
     * @private
     */
    _removeRenderElement()
    {
        if (!this.element) return;

        // Create placeholder comment (include index if in list context for proper identification)
        const indexSuffix = typeof this._parentIndex !== 'undefined' ? ` [${this._parentIndex}]` : '';
        const placeholder = document.createComment(` data-render: ${this.path}${indexSuffix} `);
        this.placeholder = placeholder;

        // Clean up nested components and directives before removing
        const wildflower = this._wf;
        if (wildflower) {
            this._cleanupNestedContent(wildflower);
            // Clean up custom directives on this element and its children
            if (wildflower._cleanupCustomDirectivesInSubtree) {
                wildflower._cleanupCustomDirectivesInSubtree(this.element);
            }
        }

        // Insert placeholder and remove element
        this.element.parentNode.insertBefore(placeholder, this.element);
        this.element.parentNode.removeChild(this.element);
        this.element = null;
    }

    /** Process bindings/actions/conditionals in newly inserted render element. @private */
    _processInsertedElement(wildflower) {
        if (!this.element || !this.componentInstance) return;
        const instance = this.componentInstance;

        // Only process bindings the render effect does NOT handle.
        // The effect (recreated before this method) owns: bind, bind-html,
        // show, class, style, attr, model. We only need to set up render
        // (conditional DOM insertion), list, and action (event handlers).
        const selector = [
            _cmAttrSelector('render'), _cmAttrSelector('list'), _cmAttrSelector('action')
        ].join(', ');
        const queried = this.element.querySelectorAll(selector);

        const processEl = (el) => {
            // Skip elements belonging to nested components
            const closest = wildflower._getComponentElement(el);
            if (closest && closest !== instance.element && this.element.contains(closest)) return;

            if (_cmHasAttr(el, 'render')) this._processRenderElement(el, wildflower);
            if (_cmHasAttr(el, 'list')) this._processListElement(el, wildflower);
            if (_cmHasAttr(el, 'action')) this._processActionElement(el, wildflower);
        };

        processEl(this.element);
        queried.forEach(processEl);

        if (wildflower._processSlotTemplates) wildflower._processSlotTemplates(instance);
    }

    /**
     * Process a data-list element inside a re-inserted data-render block.
     * @param {HTMLElement} el - Element with data-list attribute
     * @param {Object} wildflower - Framework instance
     * @private
     */
    _processListElement(el, wildflower) {
        const listPath = _cmGetAttr(el, 'list');
        if (!listPath) return;

        const instance = this.componentInstance;
        const listEntry = {
            element: el,
            path: listPath,
            componentId: instance.id
        };

        // Register in domElements so the list system can find it
        if (!wildflower.domElements.lists) wildflower.domElements.lists = [];
        wildflower.domElements.lists.push(listEntry);

        // Trigger list processing
        wildflower._updateLists([listEntry], instance);
    }

    /**
     * Process a data-action element
     * @param {HTMLElement} el - Element to process
     * @param {Object} wildflower - Framework instance
     * @private
     */
    _processActionElement(el, wildflower) {
        const instance = this.componentInstance;
        const actionAttr = _cmGetAttr(el, 'action');
        const actionDefs = wildflower._parseActions(actionAttr);

        for (const {methodName, eventType} of actionDefs) {
            if (methodName && typeof instance.context[methodName] === 'function') {
                // GUARD: Prevent duplicate event binding (same guard used by EventSystem._bindComponentActions)
                let elBoundActions = boundActionsCache.get(el);
                if (!elBoundActions) {
                    elBoundActions = new Set();
                    boundActionsCache.set(el, elBoundActions);
                }
                const bindingKey = `${eventType}-${methodName}`;
                if (elBoundActions.has(bindingKey)) {
                    continue; // Already bound this action/event combination
                }
                elBoundActions.add(bindingKey);

                const actionContext = this._registry.createActionContext(
                    methodName,
                    instance,
                    el,
                    methodName,
                    eventType
                );

                if (actionContext) {
                    const handler = (event) => {
                        wildflower._handleActionWithContext(actionContext, event);
                    };
                    el.addEventListener(eventType, handler);
                    el._wfActionBound = true;

                    // Store handler reference for cleanup
                    const handlerKey = `action-${instance.id}-${methodName}-${eventType}-render-${Date.now()}`;
                    wildflower.eventHandlers.set(handlerKey, {
                        target: el,
                        event: eventType,
                        handler: handler,
                        componentId: instance.id
                    });
                }
            }
        }
    }

    /**
     * Process a nested data-render element
     * @param {HTMLElement} el - Element to process
     * @param {Object} wildflower - Framework instance
     * @private
     */
    _processRenderElement(el, wildflower) {
        if (el === this.element) return; // Skip self

        const renderPath = _cmGetAttr(el, 'render');
        wildflower._processDataRenderElement(el, renderPath, this.componentInstance);
    }

    /**
     * Clean up nested components and contexts before removing element
     * @private
     */
    _cleanupNestedContent(wildflower)
    {
        if (!this.element) return;

        // Find and destroy nested components
        const nestedComponents = this.element.querySelectorAll('[data-component-id]');
        nestedComponents.forEach(compEl => {
            const compId = compEl.dataset.componentId;
            if (compId && wildflower.hasComponentInstance(compId)) {
                wildflower.destroyComponent(compId);
            }
        });

        // Clean up contexts for elements within this render element - respects useWfPrefixOnly mode
        const cleanupSelector = [
            _cmAttrSelector('bind'),
            _cmAttrSelector('action'),
            _cmAttrSelector('show'),
            _cmAttrSelector('render'),
            _cmAttrSelector('model')
        ].join(', ');
        const allContextElements = this.element.querySelectorAll(cleanupSelector);

        allContextElements.forEach(el => {
            const context = this._registry.getContextForElement(el);
            if (context) {
                // For action contexts, also clean up event handlers
                if (context.type === 'action' && wildflower.eventHandlers) {
                    // Find and remove event handlers for this element
                    wildflower.eventHandlers.forEach((handler, key) => {
                        if (handler && handler.target === el) {
                            el.removeEventListener(handler.event, handler.handler);
                            wildflower.eventHandlers.delete(key);
                        }
                    });
                }
                this._registry.removeContext(context.id);
            }
        });
    }


    /**
     * Update DOM element for class binding context
     * @private
     */
    _updateClassBindingElement(newValue)
    {
        if (!this.element || !this.isElementAttached()) return;

        // Friendly dev-mode shape check — historically, returning an object
        // from a data-bind-class computed threw `TypeError: t.split is not a
        // function` deep in the framework, with no actionable hint. The
        // Effect-based class path (RenderingCore._executeClassBindForEffect)
        // accepts both strings and `{className: bool}` objects, but this
        // path only handles strings. Coerce objects rather than throw so
        // the page keeps rendering, and warn once per binding context.
        if (newValue && typeof newValue === 'object') {
            if (typeof __DEV__ !== 'undefined' && __DEV__ && !this._classBindingShapeWarned) {
                this._classBindingShapeWarned = true;
                wfError(WF_ERRORS.CLASS_BINDING_SHAPE, {
                    context: 'computed returned an object; coercing truthy keys to a class string',
                    suggestion: 'A computed should return a string. For inline expressions, write `data-bind-class="{\'is-active\': cond}"`.',
                    warn: true
                });
            }
            // Coerce {className: truthy} → "className" space-separated
            newValue = Object.keys(newValue)
                .filter(k => newValue[k])
                .join(' ');
        } else if (newValue != null && typeof newValue !== 'string') {
            // Numbers, booleans, etc — coerce to string and warn once.
            if (typeof __DEV__ !== 'undefined' && __DEV__ && !this._classBindingShapeWarned) {
                this._classBindingShapeWarned = true;
                wfError(WF_ERRORS.CLASS_BINDING_SHAPE, {
                    context: `expected string, got ${typeof newValue}; coercing`,
                    warn: true
                });
            }
            newValue = String(newValue);
        }

        // On first call, capture static classes and clean up any stale dynamic classes
        if (this._staticClasses === undefined)
        {
            // Get static classes from data attribute (set by WfBuilder) or current classes
            const staticClassAttr = this.element.dataset.staticClass;
            if (staticClassAttr !== undefined)
            {
                // WfBuilder-generated element: use explicit static classes
                this._staticClasses = new Set(staticClassAttr.split(/\s+/).filter(Boolean));
            }
            else
            {
                // Regular HTML: current classes minus new dynamic classes are static
                const newClasses = newValue ? new Set(newValue.split(/\s+/).filter(Boolean)) : new Set();
                this._staticClasses = new Set(
                    Array.from(this.element.classList).filter(c => !newClasses.has(c))
                );
            }

            // Clean up any stale dynamic classes (classes that aren't static and aren't the new value)
            const newClassSet = newValue ? new Set(newValue.split(/\s+/).filter(Boolean)) : new Set();
            const toRemove = Array.from(this.element.classList).filter(
                c => !this._staticClasses.has(c) && !newClassSet.has(c)
            );
            toRemove.forEach(className => {
                this.element.classList.remove(className);
            });
        }

        // Remove any previous classes we added
        if (this._previousClass)
        {
            const previousClasses = this._previousClass.split(/\s+/).filter(Boolean);
            previousClasses.forEach(className => {
                this.element.classList.remove(className);
            });
        }

        // Add new classes
        if (newValue)
        {
            const classes = newValue.split(/\s+/).filter(Boolean);
            classes.forEach(className => {
                this.element.classList.add(className);
            });
        }

        // Track what we added (even empty string to indicate we've processed this)
        this._previousClass = newValue || '';
    }

    /**
     * Get the full path to this context, including parent relationships
     * @returns {string} - The full path
     */
    getFullPath()
    {
        if (!this.parent)
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
            return parentPath ? `${parentPath}[${this._parentIndex}]` : `[${this._parentIndex}]`;
        } else
        {
            return parentPath ? `${parentPath}.${this.path}` : this.path;
        }
    }

    getItemData(index) {
        if (this.type !== 'list') return null;
        const data = this.resolveData();
        return (Array.isArray(data) && index < data.length) ? data[index] : null;
    }

    dispose() {
        // Save last known value for binding contexts (skip computed — dependencies may be cleared)
        if (this.componentInstance && this.type === 'binding' && this.path && !this.path.startsWith('computed:')) {
            try {
                const val = this.componentInstance.stateManager?.getValue(this.path);
                if (val !== undefined) this.data = val;
            } catch (e) { /* okay */ }
        }

        this.parent = null;
        this.element = null;
        this.componentInstance = null;
        if (this._cache) this._cache.clear();

        if (this.children) {
            this.children.forEach(child => child?.dispose?.());
            this.children.clear();
        }
        if (this.dependents) this.dependents.clear();
    }
}


/**
 * ContextRegistry — central registry managing all Context instances.
 * Provides indexed lookup (by ID, type, element, component), dependency tracking,
 * garbage collection, and batch registration for list rendering performance.
 */
export class ContextRegistry
{
    constructor(wf) {
        // Framework instance reference — avoids window.wildflower global lookups
        this._wf = wf || null;

        this.contexts = new Map();
        this.contextsByType = new Map();
        this.contextsByElement = new WeakMap();
        this.contextsByComponent = new Map();
        this._contextTypeCache = new Map();
        this._contextModificationCounter = 0;
        this._batchMode = false;
        this._batchedContexts = [];
        this._clearedCacheComponents = new Set();
        this._clearedCacheResetPending = false;
        this._uid = 0;

        this.rootContext = new Context('root', '', {type: 'root', wf: this._wf});
        this.registerContext(this.rootContext);

        // Automatic garbage collection
        this._setupGarbageCollection();
    }

    /**
     * Dispose the registry and clean up resources (GC interval, etc.)
     */
    dispose() {
        if (this._gcIntervalId) {
            clearInterval(this._gcIntervalId);
            this._gcIntervalId = null;
        }
    }

    /**
     * Start batch mode for context registration optimization
     */
    startBatch() {
        this._batchMode = true;
        this._batchedContexts = [];
    }

    /**
     * Commit all batched contexts and exit batch mode
     */
    commitBatch() {
        if (!this._batchMode || this._batchedContexts.length === 0) {
            this._batchMode = false;
            return;
        }

        // Process all batched contexts at once
        this._batchedContexts.forEach(context => {
            this._registerContextInternal(context);
        });

        // Single cache invalidation for the entire batch
        this._invalidateContextCache();

        // Clear batch state
        this._batchMode = false;
        this._batchedContexts = [];
    }

    /**
     * Create a context using the factory pattern
     * @param {string} path - Data path
     * @param {Object} options - Context configuration options
     * @returns {Context} The created context
     */
    createContext(path, options = {})
    {
        // SSR: Check if this should create an SSR context instead
        // Only create protection contexts during PROTECTED phase (before activation)
        if (__FEATURE_SSR__ && options.element?.hasAttribute('data-ssr') &&
            options.element?._ssrPhase === 'protected' &&
            typeof wildflower !== 'undefined' && wildflower.ssrManager) {
            return wildflower.ssrManager.createSSRContext(options.type || 'binding', path, options, this);
        }

        // Generate a unique ID based on options
        const id = this._generateContextId(path, options);

        // All context types are handled by the unified Context class
        // Inject framework reference for contexts that need WF methods
        if (!options.wf) options.wf = this._wf;
        const context = new Context(id, path, options);

        // Add registry reference to enable dependency registration
        context._registry = this;

        // Register the context
        this.registerContext(context);

        // Handle parent-child relationships (only if parent has children Map)
        if (options.parent && options.parent.children)
        {
            options.parent.children.set(id, context);
        }

        // Handle element association
        if (options.element)
        {
            this.contextsByElement.set(options.element, context);
        }

        return context;
    }

    /**
     * Generate a context ID
     * Component contexts preserve their instance ID for easy lookup.
     * All other contexts get a simple incremental ID (base 36 for compactness).
     * @private
     */
    _generateContextId(path, options = {}) {
        // Preserve component IDs for easy lookup
        if (options.type === 'component' && options.componentInstance) {
            return options.componentInstance.id;
        }

        // Everything else gets a simple unique ID
        return 'c' + (this._uid++).toString(36);
    }


    /**
     * Register a context in the registry
     * @param {Context} context - The context to register
     */
    registerContext(context)
    {
        if (!context || !context.id)
        {
            return;
        }

        // If in batch mode, queue for later processing
        if (this._batchMode) {
            this._batchedContexts.push(context);
            return;
        }

        // Normal registration
        this._registerContextInternal(context);
        this._invalidateContextCache();
    }

    /**
     * Internal context registration logic
     * @param {Context} context - The context to register
     * @private
     */
    _registerContextInternal(context)
    {
        // Store in main index
        this.contexts.set(context.id, context);

        // Store in type index
        if (!this.contextsByType.has(context.type))
        {
            this.contextsByType.set(context.type, new Map());
        }
        this.contextsByType.get(context.type).set(context.id, context);

        // Store in component index
        if (context.componentInstance)
        {
            const componentId = context.componentInstance.id;

            if (!this.contextsByComponent.has(componentId))
            {
                this.contextsByComponent.set(componentId, new Map());
            }
            this.contextsByComponent.get(componentId).set(context.id, context);
        }

        // Store in element index
        if (context.element)
        {
            this.contextsByElement.set(context.element, context);
        }
    }

    /**
     * Create specialized binding context
     * @param {string} path - Data binding path or expression
     * @param {Object} componentInstance - Component instance
     * @param {HTMLElement} element - DOM element
     * @param {Context} parent - Parent context (optional)
     * @returns {Context} The created binding context
     */
    createBindingContext(path, componentInstance, element, parent = null, parentIndex = undefined)
    {
        // Skip elements rendered by data-use-template (they have their own binding system)
        if (element && element.closest && element.closest('[data-use-template-rendered]')) {
            return null;
        }

        // Use the generic context factory with specialized options
        const context = this.createContext(path, {
            type: 'binding',
            componentInstance,
            element,
            parent: parent || this.rootContext,
            parentIndex,
            // Mark as list item context if it has a parent list context
            isListItem: parent && parent.type === 'list'
        });


        // Add registry reference to the context
        if (context)
        {
            context._registry = this;
        }

        return context;
    }

    /**
     * Create specialized conditional context
     * @param {string} path - Conditional path (may include negation)
     * @param {Object} componentInstance - Component instance
     * @param {HTMLElement} element - DOM element
     * @param {Context} parent - Parent context (optional)
     * @returns {Context} The created conditional context
     */
    createConditionalContext(path, componentInstance, element, parent = null, parentIndex = undefined)
    {
        const context = this.createContext(path, {
            type: 'conditional',
            componentInstance,
            element,
            parent: parent || this.rootContext,
            parentIndex,
            // Mark as list item context if it has a parent list context
            isListItem: parent && parent.type === 'list'
        });

        // Add registry reference to the context
        if (context)
        {
            context._registry = this;
        }

        return context;
    }

    /**
     * Create specialized action context
     * @param {string} path - Action path or method name
     * @param {Object} componentInstance - Component instance
     * @param {HTMLElement} element - DOM element
     * @param {string} method - Method name to call
     * @param {string} eventType - Event type (default: 'click')
     * @param {Context} parent - Parent context (optional)
     * @returns {Context} The created action context
     */

    createActionContext(path, componentInstance, element, method, eventType = 'click', parent = null, parentIndex = null) {
        // 1. Find parent list context if not provided
        if (!parent && element) {
            parent = this._findDeepestParentListContext(element);
        }

        // 2. Create the base action context
        const context = this.createContext(path, {
            type: 'action',
            componentInstance,
            element,
            parent,
            data: {
                method,
                event: eventType || 'click',
                options: {}
            },
            isListItem: parent && parent.type === 'list'
        });

        // 3. Add getFullPath method for hierarchical path reconstruction
        this._addFullPathMethod(context);

        // 4. Setup element-to-context references
        this._setupActionElementRefs(context, element);

        // 5. Extract and set parent index (unified - no duplication)
        // PERF: Skip DOM query if parentIndex was provided (avoids .closest() call)
        if (parentIndex !== null) {
            context._parentIndex = parentIndex;
        } else {
            this._extractParentIndex(context, element);
        }

        return context;
    }

    /**
     * Find the deepest parent list context for an element
     * Uses the strategy of finding the DIRECT parent list (closest data-list ancestor)
     * @param {HTMLElement} element - Element to find parent for
     * @returns {Context|null} Parent list context or null
     * @private
     */
    _findDeepestParentListContext(element) {
        if (!element) return null;

        // Use JS property-based lookup instead of DOM attribute selector
        const listItem = this._wf?._findListItemAncestor(element);
        if (!listItem) return null;

        // Find the DIRECT parent list using framework helper
        const listElement = this._wf._findDirectParentList(listItem);
        if (listElement && listElement._listContext) {
            return listElement._listContext;
        }

        return null;
    }

    /**
     * Add getFullPath method to an action context
     * Enables hierarchical path reconstruction for nested lists
     * @param {Context} context - Action context to enhance
     * @private
     */
    _addFullPathMethod(context) {
        if (!context) return;

        context.getFullPath = function() {
            if (this._parentInfo && this._parentInfo.type === 'list-item') {
                const parentIndex = this._parentIndex;
                if (parentIndex !== undefined && this._parentInfo.parentListElement) {
                    const parentPath = _cmGetAttr(this._parentInfo.parentListElement, 'list');

                    // Check if parent list also has a hierarchical path
                    const parentListContext = this._parentInfo.parentListElement._listContext;
                    if (parentListContext && parentListContext.getFullPath && parentListContext.getFullPath() !== parentPath) {
                        return `${parentListContext.getFullPath()}[${parentIndex}].${this.path}`;
                    } else {
                        return `${parentPath}[${parentIndex}].${this.path}`;
                    }
                }
            }
            return this.path;
        };
    }

    /**
     * Setup bidirectional element-to-context references
     * @param {Context} context - Action context
     * @param {HTMLElement} element - DOM element
     * @private
     */
    _setupActionElementRefs(context, element) {
        if (!element || !context) return;

        // Ensure reference is in the registry's WeakMap for reliable lookup
        this.contextsByElement.set(element, context);
    }

    /**
     * Extract and set parent index from nearest list item
     * @param {Context} context - Action context
     * @param {HTMLElement} element - DOM element
     * @private
     */
    _extractParentIndex(context, element) {
        if (!element || !context) return;

        // Use JS property-based lookup instead of DOM attribute selector
        const listItem = this._wf?._findListItemAncestor(element);
        if (listItem) {
            // Use JavaScript property for index
            // _bindItemIndex is updated synchronously by onMove during list operations
            if (listItem._bindItemIndex !== undefined) {
                context._parentIndex = listItem._bindItemIndex;
            } else if (listItem._listIndex !== undefined) {
                context._parentIndex = listItem._listIndex;
            }
        }
    }

    /**
     * Create a list context
     * @param {string} listPath - Path to list data
     * @param {Array} data - List data
     * @param {Object} componentInstance - Component instance
     * @param {Context} parentContext - Optional parent context
     * @param {number} parentIndex - Optional parent index for unique ID generation
     * @returns {Context} - The list context
     */
    createListContext(listPath, data, componentInstance, parentContext = null, element = null, parentIndex = undefined)
    {

        // Use the generic context factory
        // CRITICAL: Pass parentIndex to ensure unique IDs for nested lists
        return this.createContext(listPath, {
            type: 'list',
            data: Array.isArray(data) ? data : [],
            componentInstance,
            parent: parentContext || this.rootContext,
            element,
            parentIndex  // Ensures nested lists get unique IDs: parentId[index]:path
        });
    }


    _createItemLevelContext(options) {
        const {
            element,        // DOM element
            contextType,    // 'binding', 'conditional', etc.
            path,           // Property path or expression
            instance,       // Component instance
            createMethod    // Specific creation method to use
        } = options;

        // First find the nearest list element
        const listElement = element.closest(_cmAttrSelector('list'));

        // CRITICAL FIX: Check if the list is OUTSIDE the component boundary
        // If the list contains the component element, the element belongs to the component, not the list
        // (The component is inside a list item, so its internal elements should use component state)
        const componentElement = instance.element;
        const listIsOutsideComponent = listElement && !componentElement.contains(listElement);

        if (listElement && !listIsOutsideComponent) {

            // If the list doesn't have a context yet, we need to create one
            let listContext = listElement._listContext;

            if (!listContext && _cmGetAttr(listElement, 'list')) {
                // Create a list context on-the-fly if needed
                const listPath = _cmGetAttr(listElement, 'list');
                let listData;

                // Get data from component state using shared helper
                listData = _resolveFromStateManager(instance.stateManager, listPath, instance, this._wf);

                // Create the list context
                listContext = this.createListContext(
                    listPath,
                    Array.isArray(listData) ? listData : [],
                    instance,
                    null, // parent context
                    listElement
                );

                // Store reference on element
                listElement._listContext = listContext;
            }

            if (listContext) {
                // Now determine the index of the item containing this element
                // Since we can't rely on data-index, use DOM structure

                // Get all direct children excluding the template
                const listItems = Array.from(listElement.children).filter(child =>
                    child.tagName !== 'TEMPLATE'
                );

                // Find which list item contains our element
                let listItem = element;
                while (listItem.parentElement !== listElement) {
                    listItem = listItem.parentElement;
                    if (!listItem) break; // Safety check
                }

                if (listItem && listItem.parentElement === listElement) {
                    const itemIndex = listItems.indexOf(listItem);

                    if (itemIndex !== -1)
                    {
                        // Create context with list context as parent
                        const context = createMethod(
                            path,
                            instance,
                            element,
                            listContext
                        );

                        // Store parent index for proper resolution
                        if (context) {
                            context._parentIndex = itemIndex;

                            // Optional - pre-resolve data to ensure visibility is correct
                            if (contextType === 'conditional') {
                                const isVisible = context.resolveData();
                                context._updateConditionalElement(isVisible);
                            }
                            // NOTE: We do NOT populate initial values for binding contexts
                            // inside list items here. List item bindings are handled by
                            // _bindItemData/_executeBindings which set values directly.
                        }

                        return context;
                    }
                }
            }
        }

        // Not in a list item or couldn't determine index, create a regular context
        const result = createMethod(path, instance, element);

        // Set initial visibility for conditional contexts (same as list items do)
        if (result && contextType === 'conditional') {
            const isVisible = result.resolveData();
            result._updateConditionalElement(isVisible);
        } else if (result && contextType === 'binding') {
            // Populate initial value for binding contexts
            const value = result.resolveData();
            result._updateBindingElement(value);
        }

        return result;
    }


    /**
     * Create a specialized context for components
     * @param {string} componentId - Component ID
     * @param {string} componentName - Component name
     * @param {Object} options - Configuration options
     * @returns {Context} The created component context
     */
    createComponentContext(componentId, componentName, options = {}) {
        // Use the generic context factory with specialized options
        const context = this.createContext(componentName, {
            ...options,
            id: componentId,
            type: 'component',
            parent: options.parent || this.rootContext
        });

        // Register in component-specific index for fast lookup
        if (!this.contextsByComponent.has(componentId)) {
            this.contextsByComponent.set(componentId, new Map());
        }
        this.contextsByComponent.get(componentId).set(context.id, context);

        return context;
    }

    /**
     * Get a context by ID
     * @param {string} id - Context ID
     * @returns {Context|null} - The context or null
     */
    getContextById(id)
    {
        return this.contexts.get(id);
    }

    /**
     * Get contexts by type
     * @param {string} type - Context type
     * @returns {Array} - Array of contexts
     */

    getContextsByType(type) {
        // Early return for non-existent types
        if (!this.contextsByType.has(type)) return [];

        // Check if we have a valid cached result
        const cacheKey = `${type}-${this._contextModificationCounter}`;
        if (this._contextTypeCache.has(cacheKey)) {
            // Return the cached array directly - we'll use immutable patterns elsewhere
            return this._contextTypeCache.get(cacheKey);
        }

        // Create the array only when needed
        const contexts = Array.from(this.contextsByType.get(type).values());

        // Cache the result (store the actual array)
        this._contextTypeCache.set(cacheKey, contexts);

        // Limit cache size to prevent memory leaks
        if (this._contextTypeCache.size > 50) {
            const keys = Array.from(this._contextTypeCache.keys());
            for (let i = 0; i < keys.length - 50; i++) {
                this._contextTypeCache.delete(keys[i]);
            }
        }

        return contexts;
    }


    _invalidateContextCache() {
        // Increment counter instead of timestamp - more reliable and lighter
        this._contextModificationCounter = (this._contextModificationCounter || 0) + 1;
    }


    /**
     * Get context for an element
     * @param {HTMLElement} element - DOM element
     * @returns {Context|null} - The context or null
     */
    getContextForElement(element) {
        if (!element) return null;

        // Fast paths: direct list context reference or WeakMap lookup (handles 99%+ of cases)
        if (element._listContext) return element._listContext;
        const context = this.contextsByElement.get(element);
        if (context) return context;

        // Deferred init: ensure list item contexts are created, then retry
        const wf = this._wf;
        const listItem = wf?._findListItemAncestor(element);
        if (listItem && listItem._needsContexts && wf) {
            wf._ensureItemContexts(listItem);
            return this.contextsByElement.get(element) || null;
        }

        return null;
    }

    /**
     * Remove a context from the registry
     * @param {string} id - Context ID
     */

    removeContext(id) {
        const context = this.contexts.get(id);
        if (!context) return false;

        if (this.contextsByType.has(context.type)) {
            this.contextsByType.get(context.type).delete(id);

        }

        // Clean up dependents — stale reverse refs are handled lazily by _notifyDependentContexts
        if (context.dependents) context.dependents.clear();

        // Remove from parent's children
        if (context.parent && context.parent.children) {
            context.parent.children.delete(id);
        }

        // Remove from component index
        if (context.componentInstance) {
            const compId = context.componentInstance.id;
            const compContexts = this.contextsByComponent.get(compId);
            if (compContexts) {
                compContexts.delete(id);
                if (compContexts.size === 0) this.contextsByComponent.delete(compId);
            }
        }

        // Remove from main contexts map
        this.contexts.delete(id);

        // Dispose context if it has the method
        if (context && typeof context.dispose === 'function') {
            context.dispose();
        }

        this._invalidateContextCache();
        return true;
    }

    /** Register a dependency: sourceContext depends on targetContext at path. */
    registerDependency(sourceContext, targetContext, path) {
        if (!sourceContext || !targetContext) return;

        if (!targetContext.dependents) targetContext.dependents = new Map();
        const key = `${sourceContext.id}:${path}`;
        targetContext.dependents.set(key, { sourceContext, path });
    }


    /** Notify dependent contexts of changes. @private */
    _notifyDependentContexts(sourceId, _path) {
        const sourceContext = this.getContextById(sourceId);
        if (!sourceContext?.dependents?.size) return;

        // Schedule reset of cleared-cache tracking after microtask batch
        if (!this._clearedCacheResetPending) {
            this._clearedCacheResetPending = true;
            queueMicrotask(() => {
                this._clearedCacheComponents.clear();
                this._clearedCacheResetPending = false;
            });
        }

        const staleKeys = [];
        sourceContext.dependents.forEach((depInfo, key) => {
            const dependentContext = depInfo.sourceContext;
            if (!dependentContext?.componentInstance) {
                staleKeys.push(key); // Lazy cleanup of stale entries
                return;
            }

            const componentId = dependentContext.componentInstance.id;
            if (this._clearedCacheComponents.has(componentId)) return;
            this._clearedCacheComponents.add(componentId);

            const inst = this._wf?.getComponentInstance(componentId);
            if (inst?.stateManager) {
                inst.stateManager.clearComputedCache();
                inst.stateManager.getComputedPropertyNames().forEach(p =>
                    inst.stateManager.scheduleComputedEvaluation(p));

                if (this._wf) {
                    this._wf._componentsToUpdate.add(componentId);
                    this._wf._scheduleRender();
                }
            }
        });

        // Remove stale entries found during iteration
        for (const key of staleKeys) sourceContext.dependents.delete(key);
    }

    detectTemplateRelationships(element)
    {
        const relationships = [];

        // Helper to process a single list element
        const processListElement = (listEl, depth = 0) => {
            const listPath = _cmGetAttr(listEl, 'list');

            // Find template inside this list
            const template = listEl.querySelector('template');
            if (template && template.content) {
                // Find nested lists inside the template content (support both prefixes)
                const nestedLists = template.content.querySelectorAll(_cmAttrSelector('list'));

                nestedLists.forEach((nestedListEl) => {
                    const childPath = _cmGetAttr(nestedListEl, 'list');

                    // Skip lists inside nested components — those lists belong
                    // to the child component and will be processed during its
                    // own initialization, not as part of the parent list.
                    const closestComponent = nestedListEl.closest(_cmAttrSelector('component'));
                    if (closestComponent && template.content.contains(closestComponent)) {
                        return;
                    }

                    if (listPath && childPath) {
                        relationships.push({
                            parentPath: listPath,
                            childPath: childPath,
                            parentElement: listEl,
                            childElement: nestedListEl,
                            template: template
                        });
                    }

                    // RECURSIVELY process each nested list for deeper nesting
                    processListElement(nestedListEl, depth + 1);
                });
            }
        };

        // If the input element itself is a list container, process it directly
        if (_cmGetAttr(element, 'list')) {
            processListElement(element, 0);
        }

        // Also search for list containers within descendants (support both prefixes)
        const listContainers = element.querySelectorAll(_cmAttrSelector('list'));
        listContainers.forEach((listEl) => {
            processListElement(listEl, 0);
        });

        return relationships;
    }

    /**
     * Set up garbage collection for orphaned contexts
     * @private
     */
    _setupGarbageCollection()
    {
        // Run garbage collection periodically (store handle for cleanup)
        this._gcIntervalId = setInterval(() =>
        {
            this.garbageCollect();
        }, 60000); // Once per minute
    }

    /** Garbage-collect orphaned contexts. */
    garbageCollect() {
        let removed = 0;

        this.contexts.forEach((context, id) => {
            if (id === 'root') return;

            // Common orphan condition: component instance gone
            if (!context.componentInstance) {
                this.removeContext(id);
                removed++;
                return;
            }

            // List-specific: parent context no longer exists
            if (context.type === 'list' && context.parent && context.parent !== this.rootContext) {
                if (!this.contexts.has(context.parent.id)) {
                    this.removeContext(id);
                    removed++;
                    return;
                }
            }

            // Disconnected element handling
            if (context.element && !context.element.isConnected) {
                if (!context.dependents || context.dependents.size === 0) {
                    this.removeContext(id);
                    removed++;
                } else {
                    context.element = null; // keep context but release DOM reference
                }
            }
        });

        if (removed > 0) this._invalidateContextCache();
        return removed;
    }
}

// Browser global exports for introspection tests (context-registry-internals.test.js)
if (typeof window !== 'undefined') {
    window.Context = Context;
    window.ContextRegistry = ContextRegistry;
}

