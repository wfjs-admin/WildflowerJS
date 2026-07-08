/**
 * PropsSystem - Component props validation
 *
 * @module
 */

/**
 * Split a string on commas, respecting single/double quotes and nested braces/parens/brackets.
 * e.g. "label: 'hello, world', color: color" → ["label: 'hello, world'", " color: color"]
 * @param {string} str
 * @returns {string[]}
 */
function _splitRespectingQuotes(str) {
    const parts = [];
    let current = '';
    let depth = 0;
    let quote = 0; // 0 = none, 39 = single, 34 = double
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        if (quote) {
            // Inside quotes: only exit on matching unescaped quote
            // Count preceding backslashes; odd count means the quote is escaped
            if (ch === quote) {
                let bs = 0;
                let j = i - 1;
                while (j >= 0 && str.charCodeAt(j) === 92) { bs++; j--; }
                if (bs % 2 === 0) quote = 0;
            }
            current += str[i];
        } else if (ch === 39 || ch === 34 || ch === 96) {
            // Enter quotes (single, double, or backtick)
            quote = ch;
            current += str[i];
        } else if (ch === 123 || ch === 40 || ch === 91) {
            // { ( [ : increase depth
            depth++;
            current += str[i];
        } else if (ch === 125 || ch === 41 || ch === 93) {
            // } ) ] : decrease depth
            depth--;
            current += str[i];
        } else if (ch === 44 && depth === 0) {
            // Comma at top level; split
            parts.push(current);
            current = '';
        } else {
            current += str[i];
        }
    }
    if (current) parts.push(current);
    return parts;
}

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const PropsSystemMethods = {
/**
     * Normalize props definition - convert shorthand forms to full form
     * Supports: { propName: Type } or { propName: { type, required, default, validator } }
     * @private
     */
    _normalizePropsDefinition(propsConfig)
    {
        const normalized = {};

        for (const [propName, propDef] of Object.entries(propsConfig))
        {
            // Shorthand: props: { name: String }
            if (typeof propDef === 'function')
            {
                normalized[propName] = { type: propDef };
            }
            // Full form: props: { name: { type: String, required: true, ... } }
            else if (typeof propDef === 'object' && propDef !== null)
            {
                normalized[propName] = { ...propDef };

                // Dev mode warning: non-primitive default without factory function
                if (this.debug && propDef.default !== undefined)
                {
                    const defaultVal = propDef.default;
                    if (typeof defaultVal !== 'function' &&
                        typeof defaultVal === 'object' &&
                        defaultVal !== null)
                    {
                        if (__DEV__) console.warn(
                            `[WildflowerJS] Prop "${propName}" has a non-primitive default value. ` +
                            `Use a factory function: default: () => ${JSON.stringify(defaultVal)} ` +
                            `to avoid shared reference bugs between component instances.`
                        );
                    }
                }
            }
            else
            {
                // Invalid definition, skip with warning
                this._log('warn', `Invalid prop definition for "${propName}"`);
            }
        }

        return normalized;
    },
    /**
     * Parse data-prop-* attributes from a component element
     * Also supports data-props attribute as alternative to individual data-prop-* attributes
     * @private
     */
    _parsePropsFromElement(element)
    {
        let props = {};

        // Check for data-props attribute (alternative to individual data-prop-* attributes)
        // data-props="{ message: greeting, color: accentColor }"
        //   → values are state path references (resolved from parent, same as data-prop-*)
        const dataPropsAttr = element.getAttribute('data-props');
        if (dataPropsAttr)
        {
            const trimmed = dataPropsAttr.trim();

            // Object expression: { key: value, key2: value2 }
            // Values can be state path references or quoted string literals.
            // Splitting respects quotes and nesting so commas inside values are safe.
            if (trimmed.startsWith('{') && !trimmed.startsWith('{"'))
            {
                const inner = trimmed.slice(1, -1).trim();
                if (inner) {
                    const pairs = _splitRespectingQuotes(inner);
                    for (const pair of pairs) {
                        const colonIdx = pair.indexOf(':');
                        if (colonIdx > 0) {
                            const key = pair.slice(0, colonIdx).trim();
                            const value = pair.slice(colonIdx + 1).trim();
                            // Pass through raw; _resolvePropsValue handles
                            // both state path references and quoted literals
                            props[key] = value;
                        }
                    }
                }
            }
            else
            {
                // Quoted-key format: values are literals
                try
                {
                    const parsed = JSON.parse(trimmed);
                    for (const [key, value] of Object.entries(parsed))
                    {
                        if (typeof value === 'string')
                        {
                            props[key] = `'${value.replace(/'/g, "\\'")}'`;
                        }
                        else if (typeof value === 'boolean')
                        {
                            props[key] = value ? 'true' : 'false';
                        }
                        else if (typeof value === 'number')
                        {
                            props[key] = String(value);
                        }
                        else if (value === null)
                        {
                            props[key] = 'null';
                        }
                        else
                        {
                            props[key] = JSON.stringify(value);
                        }
                    }
                }
                catch (e)
                {
                    if (__DEV__) console.warn('[WF] Failed to parse data-props attribute:', e);
                }
            }
        }

        // Then, check for individual data-prop-* attributes (these override data-props values)
        const attributes = element.attributes;

        for (let i = 0; i < attributes.length; i++)
        {
            const attr = attributes[i];
            if (attr.name.startsWith('data-prop-'))
            {
                // Convert data-prop-user-name to userName (camelCase)
                const propName = attr.name
                    .slice(10) // Remove 'data-prop-'
                    .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

                props[propName] = attr.value;
            }
        }

        return props;
    },
    /**
     * Parse a literal value from a prop attribute string
     * Returns the parsed value, or undefined if not a literal
     * @private
     */
    _parsePropLiteral(value)
    {
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === 'null') return null;
        if (value === 'undefined') return undefined;
        // Check for quoted strings (single or double quotes)
        if ((value[0] === "'" || value[0] === '"') && value[0] === value.slice(-1))
        {
            return value.slice(1, -1);
        }
        // Check for number literals
        const num = Number(value);
        if (!isNaN(num) && value.trim() !== '')
        {
            return num;
        }
        // Not a literal - return special marker
        return Symbol.for('NOT_LITERAL');
    },
    /**
     * Get data for the current list item from an element's context
     * @private
     */
    _getListItemData(element, parentInstance)
    {
        const listItem = element ? this._findListItemAncestor(element) : null;
        if (!listItem) return undefined;

        // Fast path: mapArray mode stores reactive proxy directly on the element
        if (listItem._itemData) {
            return listItem._itemData;
        }

        const index = listItem._listIndex;
        const listEl = listItem.parentElement?.closest('[data-list]') || listItem.parentElement;

        // Try list context first
        if (listEl?._listContext)
        {
            return listEl._listContext.getItemData(index);
        }

        // Fallback to parent state
        const listPath = listEl?.dataset?.list;
        if (listPath && parentInstance?.stateManager)
        {
            const data = parentInstance.stateManager.getValue(listPath);
            return Array.isArray(data) ? data[index] : undefined;
        }

        return undefined;
    },
    /**
     * Resolve a prop value from parent's state, computed properties, or methods
     * @private
     */
    _resolvePropsValue(valuePath, parentInstance, childInstanceId, childElement = null)
    {
        // Handle literal values FIRST - these don't require a parent instance
        // This allows static HTML with literal props to work without parent components
        const literal = this._parsePropLiteral(valuePath);
        if (literal !== Symbol.for('NOT_LITERAL'))
        {
            return literal;
        }

        // For non-literal values, we need a parent instance to resolve from
        if (!parentInstance)
        {
            return undefined;
        }

        // Handle list item context - "." means the current list item
        if (valuePath === '.' && childElement)
        {
            return this._getListItemData(childElement, parentInstance);
        }

        // Resolve from parent state, computed, or methods
        let resolvedValue;
        try
        {
            if (valuePath.startsWith('state.'))
            {
                const path = valuePath.slice(6); // Remove 'state.'
                resolvedValue = parentInstance.stateManager.getValue(path);
            }
            else if (valuePath.startsWith('computed:'))
            {
                const computedPath = valuePath.slice(9);
                resolvedValue = parentInstance.stateManager.evaluateComputed(computedPath);
            }
            else
            {
                // First try state path
                resolvedValue = parentInstance.stateManager.getValue(valuePath);

                // If not found in state, check if it's a method on the parent context
                if (resolvedValue === undefined)
                {
                    const parentContext = parentInstance.context;
                    if (parentContext && typeof parentContext[valuePath] === 'function')
                    {
                        // Bind the method to the parent context so 'this' works correctly
                        resolvedValue = parentContext[valuePath].bind(parentContext);
                    }
                    // Also check the definition for methods
                    else if (parentInstance.definition && typeof parentInstance.definition[valuePath] === 'function')
                    {
                        resolvedValue = parentInstance.definition[valuePath].bind(parentContext || parentInstance);
                    }
                }
            }

            // Late-binding re-evaluation: if the contexts don't exist yet, defer so
            // _processDeferredDependencies forces this child to re-evaluate once they
            // resolve. (Ongoing props reactivity rides ReactiveGraph's _runEffect prop-nudge;
            // the CM dependents graph was removed.)
            if (this._contextSystemInitialized)
            {
                this._addDeferredDependency(childInstanceId, parentInstance.id, valuePath, 'props');
            }

            // If not resolved from state/computed/methods, and the value
            // isn't a valid JS identifier, treat it as a string literal.
            // This allows: data-prop-title="Custom Title" (literal)
            // While preserving: data-prop-title="cardTitle" (state path)
            if (resolvedValue === undefined && !/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(valuePath)) {
                return valuePath;
            }

            return resolvedValue;
        }
        catch (error)
        {
            this._log('debug', `Failed to resolve prop value "${valuePath}": ${error.message}`);
            return undefined;
        }
    },
    /**
     * Initialize props for a component instance
     * @private
     */
    _initializeProps(instance, element, parentInstance)
    {
        const definition = instance.definition;
        const propsDefinition = definition.props;

        // No props defined - set empty props object
        if (!propsDefinition)
        {
            instance.props = {};
            return;
        }

        // Parse data-prop-* attributes from element
        const propsFromAttributes = this._parsePropsFromElement(element);

        // Build props object with defaults, validation, and reactivity
        const propsData = {};
        const self = this;

        for (const [propName, propDef] of Object.entries(propsDefinition))
        {
            let value;
            let usedDefault = false;

            // Check if prop was provided via attribute
            if (propName in propsFromAttributes)
            {
                const attrValue = propsFromAttributes[propName];
                value = this._resolvePropsValue(attrValue, parentInstance, instance.id, element);

                // If resolved value is undefined, apply default (but NOT for null)
                // This allows: data-prop-user="undefined" to trigger default
                // But: data-prop-user="null" explicitly sets null (no default)
                if (value === undefined && propDef.default !== undefined)
                {
                    value = typeof propDef.default === 'function'
                        ? propDef.default()
                        : propDef.default;
                    usedDefault = true;
                }

                // Only store path for reactive updates if we didn't use default
                if (!usedDefault)
                {
                    if (!instance._propPaths)
                    {
                        instance._propPaths = {};
                    }
                    instance._propPaths[propName] = {
                        path: attrValue,
                        parentId: parentInstance?.id
                    };
                }
            }
            else
            {
                // No attribute provided - use default value
                if (propDef.default !== undefined)
                {
                    // Call factory function for per-instance defaults
                    value = typeof propDef.default === 'function'
                        ? propDef.default()
                        : propDef.default;
                }
                else
                {
                    value = undefined;
                }
            }

            propsData[propName] = value;
        }

        // Validate props
        this._validateProps(propsData, propsDefinition, instance.name);

        // Create read-only props proxy (only set trap needed - get uses default behavior)
        // isDev uses runtime flag: debug=true → throw (fail fast during dev), debug=false → warn
        const isDev = this.debug;
        instance.props = new Proxy(propsData, {
            set(target, prop, value)
            {
                const message = `[WildflowerJS] Cannot modify prop "${String(prop)}" directly. ` +
                    `Props are read-only. Use events to request parent updates.`;

                if (isDev)
                {
                    throw new Error(message);
                }
                else
                {
                    if (__DEV__) console.warn(message);
                    // Return true to prevent TypeError in strict mode,
                    // but we don't actually set the value (assignment is silently ignored)
                    return true;
                }
            }
        });

        // Store raw props data for internal updates
        instance._propsData = propsData;
    },
    /**
     * Validate props against their definitions
     * @private
     */
    _validateProps(props, definitions, componentName)
    {
        const isDev = this.debug;
        const strictMode = this.strictProps || false;

        for (const [propName, propDef] of Object.entries(definitions))
        {
            const value = props[propName];
            const errors = [];

            // Required check
            if (propDef.required && (value === undefined || value === null))
            {
                errors.push(`Missing required prop: "${propName}"`);
            }

            // Type check (only if value is provided)
            if (value !== undefined && value !== null && propDef.type)
            {
                if (!this._isValidPropType(value, propDef.type))
                {
                    errors.push(`Prop "${propName}" expected ${propDef.type.name}, got ${typeof value}`);
                }
            }

            // Custom validator
            if (propDef.validator && value !== undefined)
            {
                try
                {
                    if (!propDef.validator(value))
                    {
                        errors.push(`Prop "${propName}" failed custom validation`);
                    }
                }
                catch (e)
                {
                    errors.push(`Prop "${propName}" validator threw an error: ${e.message}`);
                }
            }

            // Handle errors
            if (errors.length > 0)
            {
                const message = `[WildflowerJS] Component "${componentName}": ${errors.join('. ')}`;

                if (isDev || strictMode)
                {
                    throw new Error(message);
                }
                else
                {
                    if (__DEV__) console.warn(message);
                }
            }
        }
    },
    /**
     * Check if a value matches the expected prop type
     * @private
     */
    _isValidPropType(value, type)
    {
        // Handle constructor functions
        if (type === String) return typeof value === 'string';
        if (type === Number) return typeof value === 'number';
        if (type === Boolean) return typeof value === 'boolean';
        if (type === Function) return typeof value === 'function';
        if (type === Array) return Array.isArray(value);
        if (type === Object) return typeof value === 'object' && !Array.isArray(value) && value !== null;

        // Handle string type names (from WfBuilder schemas)
        if (typeof type === 'string')
        {
            const lowerType = type.toLowerCase();
            if (lowerType === 'string') return typeof value === 'string';
            if (lowerType === 'number') return typeof value === 'number';
            if (lowerType === 'boolean') return typeof value === 'boolean';
            if (lowerType === 'function') return typeof value === 'function';
            if (lowerType === 'array') return Array.isArray(value);
            if (lowerType === 'object') return typeof value === 'object' && !Array.isArray(value) && value !== null;
            // Unknown string type - allow it through
            return true;
        }

        // Custom type/class check (only for actual constructor functions)
        if (typeof type === 'function')
        {
            return value instanceof type;
        }

        // Unknown type - allow it through
        return true;
    },
    /**
     * Update a component's props when parent state changes
     * @private
     */
    _updateComponentProps(instance)
    {
        if (!instance._propPaths || !instance._propsData) return;

        // Skip if component element is no longer in the DOM
        // This can happen when list items are being removed but props update fires first
        if (instance.element && !document.contains(instance.element)) {
            return false;
        }

        const definition = instance.definition;
        const propsDefinition = definition.props;
        if (!propsDefinition) return;

        let hasChanges = false;

        for (const [propName, pathInfo] of Object.entries(instance._propPaths))
        {
            const parentInstance = this.componentInstances.get(pathInfo.parentId);
            if (!parentInstance) continue;

            const newValue = this._resolvePropsValue(pathInfo.path, parentInstance, instance.id, instance.element);

            // Skip if the resolved value is undefined/null for a "." prop path
            // This indicates the list item no longer exists at this index
            if (pathInfo.path === '.' && (newValue === undefined || newValue === null)) {
                return false;
            }

            const oldValue = instance._propsData[propName];

            // Shallow comparison for reactivity
            if (newValue !== oldValue)
            {
                instance._propsData[propName] = newValue;
                hasChanges = true;

                // Validate on update
                this._validateProps(
                    { [propName]: newValue },
                    { [propName]: propsDefinition[propName] },
                    instance.name
                );
            }
        }

        return hasChanges;
    },
};
