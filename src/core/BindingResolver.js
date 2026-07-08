/**
 * BindingResolver - Centralized binding value resolution
 *
 * Eliminates the Shotgun Surgery anti-pattern where rendering paths each
 * independently implement "resolve a value given a path and an item".
 *
 * Architecture (two-phase resolution):
 * - _classifyBinding: Pure string classification: determines binding type, strips negation,
 *   normalizes $store shorthands, detects expressions. No value lookup, no side effects.
 * - _lookupFromItem: Value lookup for list items given a classified descriptor.
 * - _resolveRawBinding: Convenience wrapper (classify + lookupFromItem).
 * - _resolveCompiledBinding: Hot path for pre-compiled metadata (skips classification entirely).
 *
 * @module BindingResolver
 */

export const BindingResolverMethods = {

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
     * Classify a raw binding path into a typed descriptor.
     * Pure string work, no value lookup, no side effects.
     *
     * @param {string} rawPath - Raw binding path from DOM attribute
     * @returns {Object} Binding descriptor with `type` and type-specific fields
     */
    _classifyBinding(rawPath) {
        if (!rawPath) return { type: 'empty' };

        let path = rawPath;

        // 1. .length shorthand
        if (path.endsWith('.length')) {
            return { type: 'length', arrayPath: path.slice(0, -7) };
        }

        // 2. computed: prefix (with negation variants), before expression check
        if (path.startsWith('!computed:') || path.startsWith('computed:!')) {
            return { type: 'computed', computedName: path.slice(10), negate: true };
        }
        if (path.startsWith('computed:')) {
            return { type: 'computed', computedName: path.slice(9), negate: false };
        }

        // 3. $store.path normalization (before expression detection)
        if (path.includes('$') && this._normalizeStoreShorthands) {
            path = this._normalizeStoreShorthands(path);
        }

        // 4. Expression detection (BEFORE negation strip)
        //    isExpression() already excludes simple negation (e.g., !isActive)
        //    via its simpleNegation regex, so !expr with operators keeps the ! intact
        if (this.isExpression(path)) {
            return { type: 'expression', path, negate: false };
        }

        // 5. Negation (only for non-expression, non-computed simple paths)
        let negate = false;
        if (path.startsWith('!')) {
            negate = true;
            path = path.slice(1);
        }

        // 6. List context variables
        if (this._listContextVars && this._listContextVars.has(path)) {
            return { type: 'listContextVar', varType: path, negate };
        }

        // 7. props: prefix
        if (path.startsWith('props:')) {
            return { type: 'props', propName: path.slice(6), negate };
        }

        // 8. Simple path vs dot-notation
        const isSimple = !path.includes('.') && !path.includes(' ');
        return {
            type: isSimple ? 'simple' : 'dotNotation',
            path,
            negate
        };
    },

    /**
     * Look up a value from a list item given a classified binding descriptor.
     *
     * @param {Object} desc - Binding descriptor from _classifyBinding
     * @param {Object} item - List item data
     * @param {Object} scope - BindingScope { componentState, componentInstance, itemIndex, listLength, listContext, propsData }
     * @returns {*} Resolved value
     */
    _lookupFromItem(desc, item, scope) {
        // Item context: resolve against the list item, with component-level
        // fallback. Thin wrapper over the unified kernel (see _resolveBinding);
        // the item frame is passed as the third argument, so this path adds no
        // per-call allocation.
        return this._resolveBinding(desc, scope, item);
    },

    /**
     * Look up a value from a component's StateManager given a classified binding descriptor.
     *
     * @param {Object} desc - Binding descriptor from _classifyBinding
     * @param {Object} instance - Component instance (with .stateManager, .state, ._propsData)
     * @returns {*} Resolved value
     */
    _lookupFromComponent(desc, instance) {
        if (!instance?.stateManager) return undefined;
        // Component context: an environment with no item / list-position frame.
        // Thin wrapper over the unified kernel (see _resolveBinding).
        return this._resolveBinding(desc, {
            componentInstance: instance,
            componentState: instance.state,
            propsData: instance._propsData,
            item: undefined,
            itemIndex: undefined,
            listLength: undefined,
            listContext: undefined
        });
    },

    /**
     * Unified value-resolution kernel: resolve a classified binding descriptor
     * against a BindingScope (an environment). This is the single source of truth
     * for how each binding type produces a value; _lookupFromItem and
     * _lookupFromComponent are thin wrappers that build the appropriate scope.
     *
     * The only structural difference between the two former lookup paths was the
     * value SOURCE: an item context reads from the list item (with component
     * fallback), a component context reads from the StateManager. That distinction
     * is the presence or absence of the `item` frame (`hasItem` below), not a
     * different operation. NOTE: this is a cold path; the compiled hot path
     * (_resolveCompiledBinding) is deliberately separate and left untouched.
     *
     * @typedef {Object} BindingScope
     * @property {Object} componentInstance - Owning component (stateManager, state, _propsData)
     * @property {Object} [componentState] - Component state snapshot (defaults to componentInstance.state)
     * @property {Object} [propsData] - Received props (defaults to componentInstance._propsData)
     * @property {number} [itemIndex] - Row index; absent => no position frame
     * @property {number} [listLength] - Row count
     * @property {Object} [listContext] - List context object
     *
     * @param {Object} desc - Binding descriptor from _classifyBinding
     * @param {BindingScope} scope - Resolution environment
     * @param {*} [item] - List item data; absent (undefined) => component-level binding.
     *   Passed separately rather than on the scope so the item path needs no allocation.
     * @returns {*} Resolved value (negation applied)
     */
    _resolveBinding(desc, scope, item) {
        const { componentInstance } = scope;
        const hasItem = item !== undefined;

        switch (desc.type) {
            case 'empty': return undefined;

            case 'length': {
                const arr = hasItem
                    ? this._getValueFromItem(item, desc.arrayPath)
                    : componentInstance.stateManager.getValue(desc.arrayPath);
                return Array.isArray(arr) ? arr.length : 0;
            }

            case 'expression': {
                const value = this._resolveExpressionValue(desc, scope, item, hasItem);
                return desc.negate ? !value : value;
            }

            case 'listContextVar': {
                // List-position vars are only meaningful with an item frame; a
                // component context has no position (former _lookupFromComponent
                // returned undefined here).
                if (!hasItem) return undefined;
                const { itemIndex, listLength, listContext } = scope;
                const ll = listLength || listContext?.data?.length || 0;
                let value;
                switch (desc.varType) {
                    case '_index': value = itemIndex; break;
                    case '_length': value = ll; break;
                    case '_first': value = itemIndex === 0; break;
                    case '_last': value = itemIndex === ll - 1; break;
                }
                return desc.negate ? !value : value;
            }

            case 'props': {
                const pd = scope.propsData || componentInstance?._propsData;
                const value = pd ? pd[desc.propName] : undefined;
                return desc.negate ? !value : value;
            }

            case 'computed': {
                let value;
                if (hasItem) {
                    // Guard mirrors the former _lookupFromItem: no instance => undefined.
                    if (componentInstance) {
                        value = this._evaluateComputedInListContext(
                            componentInstance, desc.computedName, item, scope.itemIndex, scope.listContext
                        );
                    }
                } else {
                    value = componentInstance.stateManager.evaluateComputed(desc.computedName);
                }
                return desc.negate ? !value : value;
            }

            case 'simple': {
                // Computed takes precedence over state (CLAUDE.md: "Computed properties take precedence").
                const sm = componentInstance?.stateManager;
                let value;
                if (sm?.computed?.[desc.path]) {
                    value = hasItem
                        ? this._evaluateComputedInListContext(
                            componentInstance, desc.path, item, scope.itemIndex, scope.listContext
                        )
                        : sm.evaluateComputed(desc.path);
                } else {
                    value = hasItem ? item[desc.path] : sm.getValue(desc.path);
                }
                return desc.negate ? !value : value;
            }

            case 'dotNotation': {
                const value = hasItem
                    ? this._getValueFromItem(item, desc.path)
                    : componentInstance.stateManager.getValue(desc.path);
                return desc.negate ? !value : value;
            }
        }
    },

    /**
     * Expression-binding evaluation for the unified kernel. Item context merges
     * componentState + item + list-context vars + per-item computeds; component
     * context merges component state + component-level computed values. The
     * cacheKey differs between the two so each keeps its own compiled-expression
     * cache bucket (preserves the former two-path caching behavior).
     *
     * @param {Object} desc - Binding descriptor (type 'expression')
     * @param {BindingScope} scope - Resolution environment
     * @param {*} item - List item data (undefined in component context)
     * @param {boolean} hasItem - Whether an item frame is present
     * @returns {*} Evaluated expression value (before negation)
     * @private
     */
    _resolveExpressionValue(desc, scope, item, hasItem) {
        const { componentInstance, componentState, itemIndex, listLength, listContext } = scope;
        let mergedState;

        if (hasItem) {
            mergedState = { ...(componentState || {}) };

            if (item && typeof item === 'object') {
                Object.assign(mergedState, item);
            }

            if (itemIndex !== undefined && listLength !== undefined) {
                Object.assign(mergedState, this._buildListContextVars(itemIndex, listLength));
            }

            // Item-level computeds: both parameterized fn(item) and bare-form
            // fn() reading `this.X`, need per-item evaluation. componentState
            // resolves bare-form at the component level, producing a stale
            // value because `this.X` reads off the component context. Route
            // both forms through _evaluateComputedInListContext.
            const origComputeds = componentInstance?.stateManager?._originalComputedFunctions;
            if (origComputeds && item && typeof item === 'object') {
                for (const [name, fn] of origComputeds) {
                    if (typeof fn === 'function') {
                        try {
                            mergedState[name] = this._evaluateComputedInListContext(
                                componentInstance, name, item, itemIndex, listContext
                            );
                        } catch (e) { mergedState[name] = undefined; }
                    }
                }
            }
        } else {
            // Component context: merge computed values into state.
            const sm = componentInstance.stateManager;
            mergedState = componentInstance.state;
            if (sm.computed) {
                mergedState = { ...componentInstance.state };
                for (const key of Object.keys(sm.computed)) {
                    try { mergedState[key] = sm.evaluateComputed(key); }
                    catch (e) { /* skip errored computeds */ }
                }
            }
        }

        const options = { cacheKey: hasItem ? 'listBindingResolved' : 'componentBinding' };
        if (desc.path.includes('external(') && componentInstance) {
            options.additionalContext = { external: this._getExternalFn(componentInstance) };
        }

        return this.evaluateExpression(desc.path, mergedState, options);
    },

    /**
     * GENERAL PATH: Resolve value from a raw path string.
     * Convenience wrapper: classifies the path, then looks up the value from the item.
     *
     * @param {string} rawPath - Raw binding path
     * @param {Object} item - Data object (list item or component state)
     * @param {Object} scope - BindingScope { componentState, componentInstance, itemIndex, listLength, listContext, propsData }
     * @returns {*} Resolved value
     */
    _resolveRawBinding(rawPath, item, scope) {
        if (!rawPath || !item) return undefined;
        const desc = this._classifyBinding(rawPath);
        return this._lookupFromItem(desc, item, scope);
    },

    /**
     * Resolve a value from a component by path string.
     * Canonical single entry point for computed-first resolution:
     * computed → state → props → expressions.
     *
     * Use this instead of calling sm.getValue() directly, which misses computed properties.
     *
     * @param {string} path - Property path (e.g., "fullName", "user.name", "computed:X")
     * @param {Object} instance - Component instance (with .stateManager)
     * @returns {*} Resolved value
     */
    _resolveComponentValue(path, instance) {
        const desc = this._classifyBinding(path);
        return this._lookupFromComponent(desc, instance);
    }
};
