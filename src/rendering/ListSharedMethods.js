/**
 * ListSharedMethods - list-only members of the shared mixins
 *
 * Members that only the list renderer calls, kept out of the shared mixins so
 * the tiers without lists (nano, mini-pool) do not ship them. Spread into
 * ListRendererMethods, so every tier with lists has them as before.
 *
 * @module
 */

import { ssrAdoptedElements } from '../core/DomMetadata.js';
import { BULK_UNSERVED_ATTR } from '../core/wfUtils.js';

/**
 * Methods to be mixed into ListRendererMethods (and ultimately WildflowerJS.prototype)
 */
export const ListSharedMethods = {
    // From BindingResolver.

    /**
     * FAST PATH: Resolve value from a pre-compiled binding descriptor.
     * Used by compiled metadata path (list initial render) and effects path.
     *
     * No string parsing, no normalization; all work done at compile time by TemplateSystem.
     *
     * @param {Object} binding - Pre-compiled binding from TemplateSystem
     *   { path, isExpression, compiledFn, expressionVars, isComputed,
     *     computedName, isPropsPath, propName, isListContextVar,
     *     listContextVarType, isLengthProperty, negate }
     * @param {Object} item - List item data
     * @param {Object} scope - BindingScope { componentState, componentInstance, itemIndex, listLength, listContext, propsData }
     * @returns {*} Resolved value (before DOM coercion)
     */
    _resolveCompiledBinding(binding, item, scope) {
        const { componentState, componentInstance, itemIndex, listLength, listContext, propsData } = scope;

        // 0. Whole-item reference: data-bind="$this" / "$item" renders the item value
        //    itself: the scalar in a primitive list, or the object. Resolve before any
        //    path/`in`-based lookup, which would treat "$this" as a missing key and throw
        //    on a primitive item (`'$this' in 'red'`).
        if (binding.path === '$this' || binding.path === '$item') {
            return item;
        }

        // 1. Handle .length property
        if (binding.isLengthProperty) {
            const arrayPath = binding.path.slice(0, -7);
            const arrayValue = this._getValueFromItem(item, arrayPath);
            return Array.isArray(arrayValue) ? arrayValue.length : 0;
        }

        // 2. Pre-compiled expression (fastest path)
        if (binding.isExpression && binding.compiledFn && binding.expressionVars) {
            const vars = binding.expressionVars;
            const args = new Array(vars.length);
            // Item-level computeds: both parameterized fn(item) (fn.length > 0)
            // AND bare-form fn() reading `this.X`, need per-item evaluation.
            // componentState resolves bare-form at the component level, which
            // produces a stale value because `this.X` reads off the component
            // context. Route both forms through _evaluateComputedInListContext
            // so `this.X` resolves to item state.
            const origComputeds = componentInstance?.stateManager?._originalComputedFunctions;
            for (let v = 0; v < vars.length; v++) {
                const varName = vars[v];
                if (varName in item) {
                    args[v] = item[varName];
                    continue;
                }
                if (origComputeds) {
                    const fn = origComputeds.get(varName);
                    if (fn && typeof fn === 'function') {
                        try {
                            args[v] = this._evaluateComputedInListContext(
                                componentInstance, varName, item, itemIndex, listContext
                            );
                        } catch (e) { args[v] = undefined; }
                        continue;
                    }
                }
                if (varName in componentState) {
                    args[v] = componentState[varName];
                } else if (varName === 'external' && componentInstance) {
                    args[v] = this._getExternalFn(componentInstance);
                } else {
                    switch (varName) {
                        case '_index': args[v] = itemIndex; break;
                        case '_length': args[v] = listLength; break;
                        case '_first': args[v] = itemIndex === 0; break;
                        case '_last': args[v] = itemIndex === listLength - 1; break;
                        default: args[v] = undefined;
                    }
                }
            }
            try {
                return binding.compiledFn(...args);
            } catch (e) {
                return undefined;
            }
        }

        // 3. Fallback expression evaluation (no compiledFn available)
        if (binding.isExpression) {
            const mergedState = {
                ...componentState,
                ...item,
                _index: itemIndex,
                _length: listLength,
                _first: itemIndex === 0,
                _last: itemIndex === listLength - 1
            };
            const options = { cacheKey: 'listBinding' };
            if (binding.path.includes('external(') && componentInstance) {
                options.additionalContext = { external: this._getExternalFn(componentInstance) };
            }
            return this.evaluateExpression(binding.path, mergedState, options);
        }

        // 4. List context variables
        if (binding.isListContextVar) {
            switch (binding.listContextVarType) {
                case '_index': return itemIndex;
                case '_length': return listLength;
                case '_first': return itemIndex === 0;
                case '_last': return itemIndex === listLength - 1;
            }
        }

        // 5. Props path
        if (binding.isPropsPath && propsData) {
            return propsData[binding.propName];
        }

        // 6. Explicit computed property
        if (binding.isComputed) {
            return this._evaluateComputedInListContext(
                componentInstance,
                binding.computedName,
                item,
                itemIndex,
                listContext
            );
        }

        // 7. Simple path - check for implicit computed first
        const path = binding.path;
        const isSimplePath = path && !path.includes('.') && !path.includes(' ');

        if (isSimplePath && componentInstance?.stateManager?.computed?.[path]) {
            return this._evaluateComputedInListContext(
                componentInstance,
                path,
                item,
                itemIndex,
                listContext
            );
        }

        // 8. Simple item property, item-first, then COMPONENT-STATE fallback (outer
        //    scope), so a list row can reference a component field (data-show="showAll",
        //    data-bind="heading"). The item shadows a same-named component field; the
        //    fallback only fires when the item provides no value. Bare names only;
        //    `path in componentState` is false for dotted/expression paths.
        const itemValue = this._getValueFromItem(item, path);
        if (itemValue === undefined && componentState && typeof componentState === 'object' && path in componentState) {
            return componentState[path];
        }
        return itemValue;
    },

    /**
     * A data-list path without its computed: prefix. The prefix is optional
     * on a list path: computed:menu.items reads exactly what menu.items does.
     * @private
     */
    _listPathBare(path) {
        return path.startsWith('computed:') ? path.slice(9) : path;
    },

    /**
     * Whether a component definition declares the first segment of a dotted
     * list path (bare, no computed: prefix): a key of its `state:` block, a
     * computed that is not item-level (fn(item) is per row; the notion
     * isItemComputed uses), or `props` when it declares props. Takes the
     * AUTHORED definition, so the client and SSRManager.enhanceDefinition
     * decide alike: state first set in init(), or parsed from server markup,
     * does not count.
     * @private
     */
    _declaresListHead(definition, path) {
        const dot = path.indexOf('.');
        if (dot < 0 || !definition) return false;
        const head = path.slice(0, dot);
        if (head === 'props') return !!definition.props && Object.keys(definition.props).length > 0;
        const c = definition.computed && definition.computed[head];
        if (c) return !(typeof c === 'function' && c.length > 0);
        return !!definition.state && Object.prototype.hasOwnProperty.call(definition.state, head);
    },

    /**
     * Whether a list nested in a row reads a source outside its row: a
     * $store / $query path, or a dotted path whose head the component
     * declares (data-list="menu.items" or "settings.options" in a row). Every
     * other path reads the row item. The answer depends on the declaration
     * only, never on row data, so every row, a same-key replace, a click and
     * the server-row parse agree.
     * @private
     */
    _rowListReadsComponent(instance, path) {
        return path.includes('$') || (!!instance && this._declaresListHead(
            this.componentDefinitions.get(instance.name) || instance.definition, this._listPathBare(path)));
    },

    /**
     * Source of a list nested in a row, read off the row item: the path walked
     * through the item (data-list="children", "group.items"), else, when the
     * item lacks it, a component computed named by its first segment,
     * evaluated for the row and walked for the rest (an item-level
     * stats(row) for "stats.items"). Never component state. Matches data-bind.
     * @private
     */
    _rowListValue(item, path, instance, index, context) {
        path = this._listPathBare(path);
        let v = this._getValueFromItem(item, path);
        if (v === undefined) {
            const dot = path.indexOf('.');
            const head = dot < 0 ? path : path.slice(0, dot);
            if (instance?.stateManager?.computed?.[head]) {
                try {
                    v = this._evaluateComputedInListContext(instance, head, item, index, context);
                    if (dot > 0) v = this._getValueFromItem(v, path.slice(dot + 1));
                } catch (e) { /* no list */ }
            }
        }
        return v;
    },

    // From RenderingCore.

    /**
     * True when `el` sits under a component-level data-render element whose
     * condition evaluates false right now. Component init runs the query
     * transform, the binding pass, and early list mounting before the
     * conditional pass removes such a section, so callers use this to avoid
     * observing, mounting, or fetching for a subtree that is about to leave;
     * insertion binds the section's clone when it appears. Row-level
     * data-render (inside a list row) is item-scoped and is not evaluated.
     * @param {HTMLElement} el - The element to test
     * @param {HTMLElement} rootEl - The component element (walk stops here)
     * @param {Object} instance - Component instance
     * @returns {boolean}
     * @private
     */
    _insideHiddenRender(el, rootEl, instance) {
        const listSelector = this._attrSelector('list');
        // Collect the chain, then evaluate it outermost first: once an outer
        // section is false the inner conditions are not evaluated at all (an
        // inner condition naming a $query would otherwise touch and activate
        // it for a section that is about to leave).
        const chain = [];
        for (let cur = el; cur && cur !== rootEl; cur = cur.parentElement) {
            if (this._hasAttr(cur, 'render')) chain.push(cur);
        }
        for (let i = chain.length - 1; i >= 0; i--) {
            const cur = chain[i];
            const container = cur.parentElement ? cur.parentElement.closest(listSelector) : null;
            if (container && rootEl.contains(container)) continue; // row-level: item-scoped
            const path = this._getAttr(cur, 'render');
            if (path && !this._conditionVerdict(path, instance, cur)) return true;
        }
        return false;
    },
    _getComponentId(element) {
        const componentElement = this._getComponentElement(element);
        return componentElement ? componentElement.dataset.componentId : null;
    },
    /**
     * Find the nearest ancestor element that is a list item (has _listIndex property).
     * This replaces closest('[data-index]') - no DOM attribute needed, just JS property check.
     * Only list code sets _listIndex, so callers outside the list code are
     * gated on __FEATURE_LISTS__.
     * @param {HTMLElement} element - Starting element
     * @returns {HTMLElement|null} The nearest list item ancestor, or null if not in a list
     * @private
     */
    _findListItemAncestor(element) {
        let current = element;
        while (current && current !== document.body) {
            // CRITICAL FIX: Stop at component boundaries
            // If we hit a component boundary (that isn't the starting element itself),
            // we have left the scope of the current component.
            // Any list item above this boundary belongs to the PARENT component,
            // not ours - so it's not our list item ancestor in a binding context.
            if (current.dataset.componentId && current !== element) {
                return null;
            }

            if (current._listIndex !== undefined) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    },
    /**
     * Get list item elements with flexible filtering options
     * @param {HTMLElement} listElement - The list container element
     * @param {Object} [options] - Filtering options
     * @param {boolean} [options.requireDataIndex=true] - Only include items with _listIndex property
     * @param {boolean} [options.excludeTemplates=true] - Exclude template elements
     * @param {Function|null} [options.filter=null] - Additional custom filter function
     * @returns {Array<Element>} Filtered list of child elements
     * @private
     */
    _getListItems(listElement, options = {}) {
        if (!listElement) return [];

        const {
            requireDataIndex = true,
            excludeTemplates = true,
            filter = null
        } = options;

        let items = Array.from(listElement.children);

        // Filter by _listIndex JS property (no DOM attribute needed)
        if (requireDataIndex) {
            items = items.filter(child => child._listIndex !== undefined);
        }

        // Exclude template elements
        if (excludeTemplates) {
            items = items.filter(child => child.tagName !== 'TEMPLATE');
        }

        // Apply custom filter if provided
        if (filter) {
            items = items.filter(filter);
        }

        return items;
    },
    /**
     * Clean up all contexts for elements in a subtree
     * Called before removing list items to prevent context accumulation (memory leak)
     * Context cleanup is deferred to requestIdleCallback
     * @param {HTMLElement} rootElement - The root element of the subtree
     * @private
     */
    _cleanupContextsInSubtree(rootElement) {
        if (!this._contextRecords || !this._contextSystemInitialized) return;

        // Skip cleanup for SSR-adopted lists - they have special lifecycle management
        if (__FEATURE_SSR__) {
            const listParent = rootElement.closest(this._attrSelector('list'));
            if (listParent && ssrAdoptedElements.has(listParent)) return;
        }

        // Quick check: if element has no context markers, skip expensive cleanup
        // This is a fast path for list items that never had interactions
        if (!rootElement._needsContexts && !rootElement._rowList && !rootElement._listContext && !rootElement._bindingContextId) {
            // Still need to clean up _listContext on descendants, but skip expensive context search
            // Per removed row: the selector is cached (_attrSelector), not built
            const descendants = rootElement.querySelectorAll(this._attrSelector('list'));
            for (const el of descendants) {
                if (el._listContext) delete el._listContext;
            }
            return;
        }

        // Collect all elements that might have contexts into a Set for O(1) lookup
        const elementsToClean = new Set([rootElement, ...rootElement.querySelectorAll('*')]);

        // Clean up the list references synchronously (cheap operation): the
        // list a row belongs to (_rowList) and the list a container renders
        // (_listContext). A row that is itself a nested list carries both.
        for (const element of elementsToClean) {
            if (element._rowList) {
                delete element._rowList;
            }
            if (element._listContext) {
                delete element._listContext;
            }
        }

    },

    // From ComponentScanning.

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

    // From TemplateSystem.

    /**
     * Whether every framework attribute in a row template is one the bulk row
     * path serves. Runs once per template, at compile time, and only for a
     * template every other check has passed. An attribute the framework gives
     * no meaning to (the author's own data-*) is ignored; _wfBase already
     * returns null for a bare data-* in data-wf-only mode.
     * @param {Element} root - The row template's root element
     * @returns {boolean}
     * @private
     */
    _rowTemplateBulkServed(root) {
        const inner = root.querySelectorAll('*');
        for (let i = -1; i < inner.length; i++) {
            const el = i === -1 ? root : inner[i];
            const attrs = el.attributes;
            for (let a = 0; a < attrs.length; a++) {
                const base = this._wfBase(attrs[a].name);
                if (base === null) continue;
                if (BULK_UNSERVED_ATTR.test(base)) return false;
                // Two served names mean something else on particular elements.
                // A form's submit is dispatched from the action attribute on
                // the form itself (FormHandling._handleFormSubmit); the
                // stripped path removes it, and the form was dead from the
                // tenth row on.
                if (base === 'action' && el.tagName === 'FORM') return false;
                // A text binding is written as text. On a form control the
                // per-row path writes .value; here the input came out blank
                // and a <select> lost its options.
                if (base === 'bind' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return false;
            }
        }
        return true;
    },

    // From EntitySystem. Callers outside the list code are gated on
    // __FEATURE_LISTS__.

    /**
     * Something now rides this entity's change dispatch (a listener, a child
     * that takes props from it, another component that reads it). From here on
     * its dispatch runs for every write, including the leaves a list row's
     * direct writer handles (EntityHandle.setDispatchQuiet). The mark also
     * keeps the list renderer's gate (_retireSafe) from turning quiet on later.
     *
     * Every consumer of _handleEntityStateChange's component branch that can
     * appear after a list mounted calls this; the ones known when the list
     * mounts are tested by _computeReactiveGraphRetireSafe.
     * @private
     */
    _markDispatchBusy(instance) {
        if (!instance) return;
        instance._wfDispatchBusy = true;
        const sm = instance.stateManager;
        if (sm && sm.setDispatchQuiet) sm.setDispatchQuiet(false);
    },

    /** _markDispatchBusy for every entity (a global consumer was added). @private */
    _markAllDispatchBusy() {
        if (!this.componentInstances) return;
        this.componentInstances.forEach(instance => this._markDispatchBusy(instance));
    },
};
