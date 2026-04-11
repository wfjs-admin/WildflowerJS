/**
 * BindingResolver - Centralized binding value resolution
 *
 * Eliminates the Shotgun Surgery anti-pattern where rendering paths each
 * independently implement "resolve a value given a path and an item".
 *
 * Architecture (two-phase resolution):
 * - _classifyBinding: Pure string classification — determines binding type, strips negation,
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
     * No string parsing, no normalization — all work done at compile time by TemplateSystem.
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
            for (let v = 0; v < vars.length; v++) {
                const varName = vars[v];
                if (varName in item) {
                    args[v] = item[varName];
                } else if (varName in componentState) {
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

        // 8. Simple item property
        return this._getValueFromItem(item, path);
    },

    /**
     * Classify a raw binding path into a typed descriptor.
     * Pure string work — no value lookup, no side effects.
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

        // 2. computed: prefix (with negation variants) — before expression check
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
        const { componentState, componentInstance, itemIndex, listLength, listContext, propsData } = scope;

        switch (desc.type) {
            case 'empty': return undefined;

            case 'length': {
                const arrayValue = this._getValueFromItem(item, desc.arrayPath);
                return Array.isArray(arrayValue) ? arrayValue.length : 0;
            }

            case 'expression': {
                const cs = componentState || {};
                const mergedState = { ...cs };

                if (item && typeof item === 'object') {
                    Object.assign(mergedState, item);
                }

                if (itemIndex !== undefined && listLength !== undefined) {
                    Object.assign(mergedState, this._buildListContextVars(itemIndex, listLength));
                }

                const options = { cacheKey: 'listBindingResolved' };

                if (desc.path.includes('external(') && componentInstance) {
                    options.additionalContext = { external: this._getExternalFn(componentInstance) };
                }

                const value = this.evaluateExpression(desc.path, mergedState, options);
                return desc.negate ? !value : value;
            }

            case 'listContextVar': {
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
                const pd = propsData || componentInstance?._propsData;
                const value = pd ? pd[desc.propName] : undefined;
                return desc.negate ? !value : value;
            }

            case 'computed': {
                let value;
                if (componentInstance) {
                    value = this._evaluateComputedInListContext(
                        componentInstance, desc.computedName, item, itemIndex, listContext
                    );
                }
                return desc.negate ? !value : value;
            }

            case 'simple': {
                if (componentInstance?.stateManager?.computed?.[desc.path]) {
                    const value = this._evaluateComputedInListContext(
                        componentInstance, desc.path, item, itemIndex, listContext
                    );
                    return desc.negate ? !value : value;
                }
                const value = item[desc.path];
                return desc.negate ? !value : value;
            }

            case 'dotNotation': {
                const value = this._getValueFromItem(item, desc.path);
                return desc.negate ? !value : value;
            }
        }
    },

    /**
     * Look up a value from a component's StateManager given a classified binding descriptor.
     *
     * @param {Object} desc - Binding descriptor from _classifyBinding
     * @param {Object} instance - Component instance (with .stateManager, .state, ._propsData)
     * @returns {*} Resolved value
     */
    _lookupFromComponent(desc, instance) {
        const sm = instance?.stateManager;
        if (!sm) return undefined;

        switch (desc.type) {
            case 'empty': return undefined;

            case 'length': {
                const arr = sm.getValue(desc.arrayPath);
                return Array.isArray(arr) ? arr.length : 0;
            }

            case 'expression': {
                // Merge computed values into state for expression evaluation
                let mergedState = instance.state;
                if (sm.computed) {
                    mergedState = { ...instance.state };
                    for (const key of Object.keys(sm.computed)) {
                        try { mergedState[key] = sm.evaluateComputed(key); }
                        catch (e) { /* skip errored computeds */ }
                    }
                }

                const options = { cacheKey: 'componentBinding' };
                if (desc.path.includes('external(')) {
                    options.additionalContext = { external: this._getExternalFn(instance) };
                }

                const value = this.evaluateExpression(desc.path, mergedState, options);
                return desc.negate ? !value : value;
            }

            case 'listContextVar':
                return undefined; // Not applicable in component context

            case 'props': {
                const value = instance._propsData ? instance._propsData[desc.propName] : undefined;
                return desc.negate ? !value : value;
            }

            case 'computed': {
                const value = sm.evaluateComputed(desc.computedName);
                return desc.negate ? !value : value;
            }

            case 'simple': {
                // Computed takes precedence over state (CLAUDE.md: "Computed properties take precedence")
                if (sm.computed && sm.computed[desc.path]) {
                    const value = sm.evaluateComputed(desc.path);
                    return desc.negate ? !value : value;
                }
                const value = sm.getValue(desc.path);
                return desc.negate ? !value : value;
            }

            case 'dotNotation': {
                const value = sm.getValue(desc.path);
                return desc.negate ? !value : value;
            }
        }
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
