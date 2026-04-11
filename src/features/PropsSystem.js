/**
 * PropsSystem - Component props validation
 *
 * @module
 */

const STALE_DEPENDENCY_MS = 30000; // Deferred dependencies older than this are dropped

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
            // Count preceding backslashes — odd count means the quote is escaped
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
            // { ( [ — increase depth
            depth++;
            current += str[i];
        } else if (ch === 125 || ch === 41 || ch === 93) {
            // } ) ] — decrease depth
            depth--;
            current += str[i];
        } else if (ch === 44 && depth === 0) {
            // Comma at top level — split
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
                            // Pass through raw — _resolvePropsValue handles
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

            // Register dependency for reactivity
            if (this._contextSystemInitialized && this._contextRegistry)
            {
                const sourceContext = this._contextRegistry.getContextById(childInstanceId);
                const targetContext = this._contextRegistry.getContextById(parentInstance.id);

                if (sourceContext && targetContext)
                {
                    this._contextRegistry.registerDependency(sourceContext, targetContext, valuePath);
                }
                else
                {
                    // Defer dependency registration
                    this._addDeferredDependency(childInstanceId, parentInstance.id, valuePath, 'props');
                }
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
    _bindListItemModel(element, instance, listPath, index, item)
    {
        // Skip if missing model attribute
        const modelPath = element.dataset.model || element.dataset.wfModel;
        if (!modelPath) return;

        // Set initial value from item data
        const value = this._getValueFromItem(item, modelPath);
        this._setInputValue(element, value);

        // Create model binding context with proper parent relationship
        // Event handling is delegated to document-level _handleInputChange (capture phase)
        if (this._contextSystemInitialized && this._contextRegistry)
        {
            const listElement = this._findDirectParentList(element);
            const listContext = listElement?._listContext;

            if (listContext)
            {
                const bindingContext = this._contextRegistry.createBindingContext(
                    modelPath,
                    instance,
                    element,
                    listContext,
                    index
                );

                if (bindingContext)
                {
                    bindingContext._parentIndex = index;
                    bindingContext._isModelBinding = true;
                    bindingContext._itemData = item;

                    // Cache debounce config for document-level handler
                    if (element.hasAttribute('data-model-debounce') || element.hasAttribute('data-wf-model-debounce'))
                    {
                        bindingContext._debounceTime = parseInt(element.dataset.modelDebounce || element.dataset.wfModelDebounce, 10) || 300;
                    }

                    // Cache model modifiers for document-level handler
                    if (!bindingContext.modelModifiers) {
                        const inputType = element.type;
                        bindingContext.modelModifiers = {
                            trim: element.hasAttribute('data-model-trim') || element.hasAttribute('data-wf-model-trim'),
                            number: element.hasAttribute('data-model-number') || element.hasAttribute('data-wf-model-number'),
                            lazy: element.hasAttribute('data-model-lazy') || element.hasAttribute('data-wf-model-lazy'),
                            debounce: bindingContext._debounceTime || null,
                            event: (inputType === 'checkbox' || inputType === 'radio') ? 'change' : 'input'
                        };
                    }
                    if (!bindingContext.elementMeta) {
                        bindingContext.elementMeta = {
                            inputType: element.type,
                            tagName: element.tagName
                        };
                    }
                }
            }
        }
        // No element-level event listeners — document-level _handleInputChange
        // handles all standard model events via capture phase delegation.
        // This also eliminates the handler accumulation bug where each list
        // re-render added ANOTHER event listener to every input.
    },
    _updateModelValue(context, newValue)
    {
        if (!context || !context.element) {
            return false;
        }

        // If no value was passed, capture from the element
        // But if a value WAS passed (e.g., from debounce callback), use it
        // This prevents debounced updates from reading stale values after list re-renders
        if (newValue === undefined) {
            newValue = this._getInputValue(context.element);
        }
        if (newValue === undefined) return false; // Skip unchecked radio

        // Determine where to update based on context hierarchy
        if (context.parent && context.parent.type === 'list' && context._parentIndex !== undefined)
        {
            // List item model - update through list context
            const listContext = context.parent;
            let listData = [...listContext.resolveData()];

            if (Array.isArray(listData) && context._parentIndex < listData.length)
            {
                // Create a new array to maintain immutability
                const updatedItem = {...listData[context._parentIndex]};
                // Use pathResolver.set to handle nested paths like "user.email"
                pathResolver.set(updatedItem, context.path, newValue);

                // Update the list item
                listData[context._parentIndex] = updatedItem;

                // Start a batch update
                const batch = this.startBatch();

                // Update the list context
                listContext.updateData(listData);

                // Critical: Update component state to ensure bindings work
                if (listContext.componentInstance)
                {
                    // Check if this is a computed list
                    if (listContext.path.startsWith('computed:'))
                    {
                        // Computed list - update the original item by reference
                        // The computed array contains refs to original objects
                        const originalItem = listContext.resolveData()[context._parentIndex];
                        if (originalItem) {
                            // Use pathResolver.set to handle nested paths like "user.email"
                            pathResolver.set(originalItem, context.path, newValue);
                        }

                        // Trigger reactivity by clearing computed cache
                        if (listContext.componentInstance.stateManager) {
                            listContext.componentInstance.stateManager._computedCache?.clear();
                        }

                        // Update class/show bindings for the specific list item
                        this._refreshComputedListItemBindings(listContext, context._parentIndex, originalItem);
                    }
                    else if (!listContext.parent || listContext.parent.type === 'root')
                    {
                        // Top-level list - update directly
                        listContext.componentInstance.state[listContext.path] = listData;

                        // Refresh bindings for the specific item that changed
                        // This ensures computed class/style/show bindings are re-evaluated
                        this._refreshComputedListItemBindings(listContext, context._parentIndex, listData[context._parentIndex]);
                    } else {
                        // NESTED list - update through parent chain
                        this._updateNestedListState(listContext, listData);

                        // Refresh bindings for the specific item that changed
                        this._refreshComputedListItemBindings(listContext, context._parentIndex, listData[context._parentIndex]);
                    }
                }

                // Apply batch update
                batch.apply();
                return true;
            }
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
     * Update nested list data through the parent chain to component state
     * @param {Object} listContext - The nested list context
     * @param {Array} newListData - The updated list data
     * @private
     */
    _updateNestedListState(listContext, newListData) {
        const path = listContext.path;  // e.g., "tasks"
        const parentContext = listContext.parent;  // parent list context (e.g., "computed:activeProjects")
        const parentIndex = listContext._parentIndex;  // index in parent list

        if (!parentContext || parentIndex === undefined) {
            return;
        }

        // Get parent list data
        let parentData = parentContext.resolveData();

        if (!Array.isArray(parentData) || parentIndex >= parentData.length) {
            return;
        }

        // Check if parent is a computed list
        if (parentContext.path.startsWith('computed:')) {
            // COMPUTED PARENT: Update the original item by reference
            // The computed array contains refs to original objects from the source array
            const originalItem = parentData[parentIndex];
            if (originalItem) {
                // Directly update the nested property on the original item
                // This modifies the source array item that the computed list references
                originalItem[path] = newListData;

                // Trigger reactivity by clearing computed cache
                if (listContext.componentInstance?.stateManager) {
                    listContext.componentInstance.stateManager._computedCache?.clear();
                }
            }
            return;
        }

        // Regular list: create immutable copy and propagate up
        parentData = [...parentData];

        // Update the nested property in the parent item
        const updatedParentItem = {
            ...parentData[parentIndex],
            [path]: newListData
        };
        parentData[parentIndex] = updatedParentItem;

        // Recursively update through the parent chain
        if (!parentContext.parent || parentContext.parent.type === 'root') {
            // Reached top level - update component state directly
            if (listContext.componentInstance) {
                listContext.componentInstance.state[parentContext.path] = parentData;
            }
        } else {
            // Still nested - continue up the chain
            this._updateNestedListState(parentContext, parentData);
        }
    },
    /**
     * Update an item in any list (top-level or nested) through its context
     * @param {Object} context - The list context
     * @param {number} itemIndex - Index of the item to update
     * @param {Object} updates - Object with properties to update
     * @returns {boolean} - Whether the update was successful
     */
    updateListItem(context, itemIndex, updates)
    {

        // Validate inputs
        if (!context || context.type !== 'list')
        {
            if (__DEV__) console.warn('Invalid context for updateListItem');
            return false;
        }

        const instance = context.componentInstance;
        if (!instance || !this.componentInstances.has(instance.id))
        {
            return false;
        }
        // Get current list data
        const listData = context.resolveData();
        if (!Array.isArray(listData) || itemIndex < 0 || itemIndex >= listData.length)
        {
            if (__DEV__) console.warn(`Invalid item index ${itemIndex} for list with ${listData.length} items`);
            return false;
        }

        // Start a batch update
        const batch = this.startBatch();

        try
        {
            // Create a copy of the list to modify
            const updatedList = [...listData];

            // Create an updated copy of the specific item
            updatedList[itemIndex] = {
                ...updatedList[itemIndex],
                ...updates
            };

            // Check if this is a top-level or nested list
            if (!context.parent || context.parent.type === 'root')
            {
                // Top-level list - update directly in component state
                instance.state[context.path] = updatedList;

                // IMPORTANT: Force cache invalidation and update context data
                if (context._cache)
                {
                    context._cache.clear();
                }

                // Explicitly update internal data
                context.data = [...updatedList];

            } else
            {
                // Nested list - update through parent chain
                const parentContext = context.parent;
                const parentIndex = context._parentIndex;

                if (parentIndex === undefined || parentIndex < 0)
                {
                    if (__DEV__) console.warn('Invalid parent index for nested list update');
                    batch.cancel();
                    return false;
                }

                // Get parent list data
                const parentData = parentContext.resolveData();
                if (!Array.isArray(parentData) || parentIndex >= parentData.length)
                {
                    if (__DEV__) console.warn('Invalid parent data for nested list update');
                    batch.cancel();
                    return false;
                }

                // If parent is also nested, recurse up the chain
                if (parentContext.parent && parentContext.parent.type !== 'root')
                {
                    // Handle deeply nested lists by recursively updating parent
                    const success = this.updateListItem(
                        parentContext,
                        parentIndex,
                        {[context.path]: updatedList}
                    );

                    if (!success)
                    {
                        batch.cancel();
                        return false;
                    }
                } else
                {
                    // Parent is a top-level list, update directly
                    const updatedParentList = [...parentData];
                    updatedParentList[parentIndex] = {
                        ...updatedParentList[parentIndex],
                        [context.path]: updatedList
                    };

                    // Update in component state
                    instance.state[parentContext.path] = updatedParentList;
                }
            }

            // Apply the batch update
            batch.apply();

            // Update the context's data cache
            context.updateData(updatedList);

            // Ensure a render is scheduled
            this._contextsToUpdate.add(context);
            this._scheduleRender();


            return true;
        } catch (error)
        {
            if (__DEV__) console.error('Error updating list item:', error);
            batch.cancel();
            return false;
        }
    },
    /**
     * Refresh bindings (class, show, bind) for a specific item in a computed list
     * Called after modifying a computed list item to ensure UI reflects changes
     * @param {Object} listContext - The list context
     * @param {number} itemIndex - Index of the item in the list
     * @param {Object} item - The updated item data
     * @private
     */
    _refreshComputedListItemBindings(listContext, itemIndex, item) {
        if (!listContext || !listContext.element) {
            return;
        }

        // Get list items (filtering out template elements)
        // Use _getListItems to properly filter children with _listIndex property
        const listItems = this._getListItems(listContext.element);
        const itemEl = listItems[itemIndex];
        if (!itemEl || itemEl._listIndex === undefined) {
            return;
        }

        // PHASE 3.5: Use metadata when available (for stripped templates)
        const metadata = itemEl._compiledMetadata;
        const cachedElements = itemEl._bindingElements || itemEl._cachedElementsArray;

        if (metadata && cachedElements) {
            // FAST PATH: Use compiled metadata with centralized resolver
            const componentInstance = listContext?.componentInstance;
            const scope = {
                componentState: componentInstance?.state || {},
                componentInstance,
                itemIndex,
                listLength: listContext?.data?.length || 0,
                listContext,
                propsData: componentInstance?._propsData
            };

            // Update class bindings (specialized processor — not routed through resolver)
            if (metadata.classBindings && metadata.classBindings.length > 0) {
                for (const cb of metadata.classBindings) {
                    const el = cachedElements[cb.index];
                    if (el) {
                        this._processOptimizedClassBinding(el, item, cb.expression, itemIndex, listContext);
                    }
                }
            }
            // Root class binding
            if (metadata.rootBindings?.hasBindClass && metadata.rootBindings?.bindClassExpr) {
                this._processOptimizedClassBinding(itemEl, item, metadata.rootBindings.bindClassExpr, itemIndex, listContext);
            }

            // Update show bindings
            if (metadata.shows && metadata.shows.length > 0) {
                for (const show of metadata.shows) {
                    const el = cachedElements[show.index];
                    if (el) {
                        const rawValue = this._resolveCompiledBinding(show, item, scope);
                        const value = show.negate ? !rawValue : Boolean(rawValue);
                        el.style.display = value ? '' : 'none';
                    }
                }
            }

            // Update text bindings
            if (metadata.bindings && metadata.bindings.length > 0) {
                for (const binding of metadata.bindings) {
                    const el = cachedElements[binding.index];
                    if (el) {
                        const value = this._resolveCompiledBinding(binding, item, scope);
                        if (!this._applyCustomElementAdapter(el, value)) {
                            if (binding.isInput) {
                                el.value = value == null ? '' : value;
                            } else {
                                el.textContent = value == null ? '' : value;
                            }
                        }
                    }
                }
            }

            // Update HTML bindings
            if (metadata.htmlBindings && metadata.htmlBindings.length > 0) {
                for (const hb of metadata.htmlBindings) {
                    const el = cachedElements[hb.index];
                    if (el) {
                        const value = this._resolveCompiledBinding(hb, item, scope);
                        const htmlStr = value == null ? '' : value;
                        el.innerHTML = this._sanitizeOrPassHTML(htmlStr);
                    }
                }
            }

            // Update style bindings (specialized processor — not routed through resolver)
            if (metadata.styleBindings && metadata.styleBindings.length > 0) {
                for (const sb of metadata.styleBindings) {
                    const el = cachedElements[sb.index];
                    if (el) {
                        this._processStyleBinding(el, item, sb.expression, itemIndex, listContext);
                    }
                }
            }
        } else {
            // FALLBACK: Use querySelectorAll (for templates without metadata)
            // Check for nested lists and filter them out to prevent cross-contamination
            const hasNestedLists = itemEl.querySelector('[data-list],[data-wf-list]') !== null;

            // Update class bindings (excluding nested list elements)
            const classBindingsRaw = itemEl.querySelectorAll('[data-bind-class],[data-wf-bind-class]');
            const classBindings = this._filterOutNestedListElements(classBindingsRaw, itemEl, hasNestedLists);
            classBindings.forEach(el => {
                const expr = this._getAttr(el, 'bind-class');
                if (expr) {
                    this._processOptimizedClassBinding(el, item, expr, itemIndex, listContext);
                }
            });
            // Also check the item element itself
            const itemClassExpr = this._getAttr(itemEl, 'bind-class');
            if (itemClassExpr) {
                this._processOptimizedClassBinding(itemEl, item, itemClassExpr, itemIndex, listContext);
            }

            // Update show bindings (excluding nested list elements)
            const showBindingsRaw = itemEl.querySelectorAll('[data-show],[data-wf-show]');
            const showBindings = this._filterOutNestedListElements(showBindingsRaw, itemEl, hasNestedLists);
            showBindings.forEach(el => {
                const showPath = this._getAttr(el, 'show');
                if (showPath) {
                    this._executeFallbackShow(el, item, showPath, listContext, itemIndex);
                }
            });
            // Also check the item element itself
            const itemShowPath = this._getAttr(itemEl, 'show');
            if (itemShowPath) {
                this._executeFallbackShow(itemEl, item, itemShowPath, listContext, itemIndex);
            }

            // Update text bindings (excluding nested list elements)
            const textBindingsRaw = itemEl.querySelectorAll('[data-bind],[data-wf-bind]');
            const textBindings = this._filterOutNestedListElements(textBindingsRaw, itemEl, hasNestedLists);
            textBindings.forEach(el => {
                const bindPath = this._getAttr(el, 'bind');
                if (bindPath) {
                    const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
                    this._executeFallbackBind(el, item, bindPath, isInput, listContext, itemIndex);
                }
            });

            // Update HTML bindings (excluding nested list elements)
            const htmlBindingsRaw = itemEl.querySelectorAll('[data-bind-html],[data-wf-bind-html]');
            const htmlBindings = this._filterOutNestedListElements(htmlBindingsRaw, itemEl, hasNestedLists);
            htmlBindings.forEach(el => {
                const htmlPath = this._getAttr(el, 'bind-html');
                if (htmlPath) {
                    this._executeFallbackBindHtml(el, item, htmlPath, listContext, itemIndex);
                }
            });
            // Also check the item element itself
            const itemHtmlPath = this._getAttr(itemEl, 'bind-html');
            if (itemHtmlPath) {
                this._executeFallbackBindHtml(itemEl, item, itemHtmlPath, listContext, itemIndex);
            }

            // Update style bindings (excluding nested list elements)
            const styleBindingsRaw = itemEl.querySelectorAll('[data-bind-style],[data-wf-bind-style]');
            const styleBindings = this._filterOutNestedListElements(styleBindingsRaw, itemEl, hasNestedLists);
            styleBindings.forEach(el => {
                const styleExpr = this._getAttr(el, 'bind-style');
                if (styleExpr) {
                    this._processStyleBinding(el, item, styleExpr, itemIndex, listContext);
                }
            });
            // Also check the item element itself
            const itemStyleExpr = this._getAttr(itemEl, 'bind-style');
            if (itemStyleExpr) {
                this._processStyleBinding(itemEl, item, itemStyleExpr, itemIndex, listContext);
            }
        }
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
                    el.style.display = value ? '' : 'none';
                }
            }
        });

        // Also check the item element itself for data-show
        const itemShowExpr = this._getAttr(itemEl, 'show');
        if (itemShowExpr && itemShowExpr.startsWith('computed:')) {
            const computedName = itemShowExpr.substring(9);
            if (isItemLevelComputed(computedName)) {
                const value = this._evaluateComputedInListContext(instance, computedName, item, itemIndex, listContext);
                itemEl.style.display = value ? '' : 'none';
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
                    // Handle class binding (could be string or object)
                    if (typeof value === 'string') {
                        el.className = value;
                    } else if (value && typeof value === 'object') {
                        Object.entries(value).forEach(([cls, active]) => {
                            el.classList.toggle(cls, !!active);
                        });
                    }
                }
            }
        });

        // Also check the item element itself for class binding
        const itemClassExpr = this._getAttr(itemEl, 'bind-class');
        if (itemClassExpr && itemClassExpr.startsWith('computed:')) {
            const computedName = itemClassExpr.substring(9);
            if (isItemLevelComputed(computedName)) {
                const value = this._evaluateComputedInListContext(instance, computedName, item, itemIndex, listContext);
                if (typeof value === 'string') {
                    itemEl.className = value;
                } else if (value && typeof value === 'object') {
                    Object.entries(value).forEach(([cls, active]) => {
                        itemEl.classList.toggle(cls, !!active);
                    });
                }
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
    _updateListItemProperty(input, instance, listPath, index, property, value) {
        // Start batch update
        const batch = this.startBatch();

        // Check if we're already tracking updates for this list
        const listKey = `${instance.id}:${listPath}`;
        if (!this._batchListUpdates.has(listKey)) {
            // Get the list data - handle nested paths (e.g., "projects.0.tasks")
            let listData = null;
            if (instance.stateManager && typeof instance.stateManager.getValue === 'function') {
                listData = instance.stateManager.getValue(listPath);
            }

            // If list data not found via stateManager, fallback to direct state access
            if (!Array.isArray(listData) && instance.state) {
                listData = pathResolver.get(instance.state, listPath);
            }

            // If still not an array, create empty array to prevent errors
            if (!Array.isArray(listData)) {
                if (__DEV__) console.warn(`[WF] _updateListItemProperty: Could not resolve list at path "${listPath}"`);
                listData = [];
            }

            this._batchListUpdates.set(listKey, {
                updates: new Map(),
                originalData: [...listData]
            });
        }

        const batchData = this._batchListUpdates.get(listKey);

        // Track this specific update
        if (!batchData.updates.has(index)) {
            batchData.updates.set(index, {});
        }

        // Store the property update along with original value for staleness detection
        // PERF: Cache original value at record time to avoid pathResolver.get() during apply
        const itemUpdates = batchData.updates.get(index);
        if (!(property in itemUpdates)) {
            // First update to this property - cache the original value
            const originalValue = pathResolver.get(batchData.originalData[index], property);
            itemUpdates[property] = { value, originalValue };
        } else {
            // Subsequent update - just update the value, keep original
            itemUpdates[property].value = value;
        }

        // If we're at the end of the event loop, apply all batched updates
        if (!this._batchUpdateTimeout) {
            this._batchUpdateTimeout = setTimeout(() => {
                this._applyBatchedListUpdates();
                this._batchUpdateTimeout = null;
            }, 0);
        }

        // Cancel the current batch since we'll handle it ourselves
        batch.cancel();
    },
// Method to apply batched list updates efficiently
    _applyBatchedListUpdates() {
        if (!this._batchListUpdates || this._batchListUpdates.size === 0) return;

        // Start a single global batch for all updates
        const batch = this.startBatch();

        // Process each list's batched updates
        this._batchListUpdates.forEach((batchData, listKey) => {
            // Split only on first colon to preserve computed: prefix in listPath
            const colonIndex = listKey.indexOf(':');
            const instanceId = listKey.substring(0, colonIndex);
            const listPath = listKey.substring(colonIndex + 1);

            const instance = this.componentInstances.get(instanceId);
            if (!instance) return;

            // Handle computed lists - update items by reference since computed arrays
            // contain references to original objects in source state
            if (listPath.startsWith('computed:')) {
                batchData.updates.forEach((propUpdates, index) => {
                    const originalItem = batchData.originalData[index];
                    if (!originalItem) return;

                    // Update properties using pathResolver.set to handle nested paths
                    Object.entries(propUpdates).forEach(([propPath, updateInfo]) => {
                        pathResolver.set(originalItem, propPath, updateInfo.value);
                    });
                });

                // Trigger reactivity - invalidate computed cache
                if (instance.stateManager) {
                    instance.stateManager._computedCache?.clear();
                }

                // CRITICAL: Refresh list item bindings (class, style, text) after property updates
                const computedName = listPath.replace('computed:', '');
                const listContext = instance._listContexts?.get(listPath) ||
                                   instance._listContexts?.get(computedName);
                if (listContext) {
                    batchData.updates.forEach((propUpdates, index) => {
                        const item = batchData.originalData[index];
                        if (item) {
                            this._refreshComputedListItemBindings(listContext, index, item);
                        }
                    });
                }
            } else {
                // CRITICAL FIX: Check if array was replaced between batching and now
                // If the current array is different from originalData, skip the batched update
                // to avoid overwriting changes made by action handlers
                const currentArray = instance.stateManager.getValue(listPath);
                if (!Array.isArray(currentArray) || currentArray.length !== batchData.originalData.length) {
                    // Array was modified (length changed) - skip stale update
                    return;
                }

                // Check if any item differs by reference - indicates array was replaced
                let arrayWasReplaced = false;
                for (let i = 0; i < Math.min(currentArray.length, batchData.originalData.length); i++) {
                    if (currentArray[i] !== batchData.originalData[i]) {
                        arrayWasReplaced = true;
                        break;
                    }
                }

                if (arrayWasReplaced) {
                    // Array was replaced - skip stale batched update
                    return;
                }

                // Standard list - create a new array with all updates
                const newList = [...batchData.originalData];

                // Apply all updates to the new array
                let hasAnyUpdates = false;
                batchData.updates.forEach((propUpdates, index) => {
                    if (index >= newList.length) return;

                    // Create new item and apply updates using pathResolver.set for nested paths
                    newList[index] = {...newList[index]};
                    Object.entries(propUpdates).forEach(([propPath, updateInfo]) => {
                        // CRITICAL FIX: Check if property was modified since batch started
                        // If current value differs from ORIGINAL value (at batch time), something
                        // else changed it (e.g., action handler cleared the input) - skip this update
                        // PERF: Use cached originalValue from record time instead of pathResolver.get()
                        const { value, originalValue } = updateInfo;
                        const currentValue = pathResolver.get(currentArray[index], propPath);
                        if (originalValue !== currentValue) {
                            // Property was modified by something else - skip this stale update
                            return;
                        }
                        hasAnyUpdates = true;
                        pathResolver.set(newList[index], propPath, value);
                    });
                });

                // Skip state update if no properties actually needed updating
                if (!hasAnyUpdates) {
                    return;
                }

                // Update state with the new array
                // NOTE: The state assignment triggers reactivity which handles list updates.
                // Do NOT call listContext.updateData() here - that causes double-processing
                // and severe performance degradation on every keystroke.
                // Use pathResolver.set for nested paths like "teams[1].players"
                pathResolver.set(instance.state, listPath, newList);

                // CRITICAL: Refresh list item bindings (class, style, text, show) after property updates
                // This ensures data-show and other bindings update when model properties change
                const listContext = instance._listContexts?.get(listPath);
                if (listContext) {
                    batchData.updates.forEach((propUpdates, index) => {
                        const item = newList[index];
                        if (item) {
                            this._refreshComputedListItemBindings(listContext, index, item);
                        }
                    });
                }
            }
        });

        // Clear batch data
        this._batchListUpdates.clear();

        // Apply all updates at once
        batch.apply();
    },
    /**
     * Set up outside click detection for an element
     * @param {HTMLElement} element - The element to detect clicks outside of
     * @param {Object} instance - The component instance
     * @param {string} methodName - The method name to call when click is outside
     * @returns {Function} - The created event listener for cleanup
     * @private
     */

    _setupOutsideClickHandler(element, instance, methodName)
    {

        // Create a unique ID for this handler
        const handlerId = `outside-${instance.id}-${methodName}-${Date.now()}`;

        // Create the outside click handler
        const outsideHandler = (event) =>
        {
            // Only proceed if the click is outside the element
            if (!element.contains(event.target) && element !== event.target)
            {
                try
                {
                    // Call the method from the component
                    instance.context[methodName](event, element);
                } catch (error)
                {
                    this._handleError(`Error in outside click handler for ${methodName}`, error, instance);
                }
            }
        };

        // Add the handler to document body to catch all clicks
        document.addEventListener('click', outsideHandler);

        // Store the handler for cleanup
        this.eventHandlers.set(handlerId, {
            target: document,
            event: 'click',
            handler: outsideHandler,
            options: {capture: true}
        });

        return outsideHandler;
    },
    _applyEventConfiguration(event, config)
    {
        // Apply stopPropagation if configured
        if (config.stopPropagation)
        {
            event.stopPropagation();
        }

        // Apply preventDefault if configured
        if (config.preventDefault)
        {
            event.preventDefault();
        }
    },
    /**
     * Parse data-action attribute which can contain multiple action definitions
     * Format: "eventType:methodName eventType2:methodName2" or just "methodName"
     * @private
     */
    _parseActions(actionAttr)
    {
        const actions = [];

        // Split on spaces that are outside parentheses and quotes
        const parts = this._splitActionDefs(actionAttr);

        parts.forEach(actionDef =>
        {
            let eventType = 'click';
            let methodPart = actionDef;

            // Only split on colon that's outside parentheses (before any '(')
            const parenStart = actionDef.indexOf('(');
            const colonIdx = actionDef.indexOf(':');
            if (colonIdx !== -1 && (parenStart === -1 || colonIdx < parenStart))
            {
                eventType = actionDef.substring(0, colonIdx);
                methodPart = actionDef.substring(colonIdx + 1);
            }

            // Check for argument syntax: methodName(arg1, arg2, ...)
            const parenIdx = methodPart.indexOf('(');
            if (parenIdx !== -1 && methodPart.endsWith(')'))
            {
                const methodName = methodPart.substring(0, parenIdx);
                const argsString = methodPart.substring(parenIdx + 1, methodPart.length - 1).trim();
                const args = argsString ? this._parseActionArgs(argsString) : [];
                actions.push({eventType, methodName, args});
            } else
            {
                actions.push({eventType, methodName: methodPart});
            }
        });

        return actions;
    },
    /**
     * Split action attribute string into individual action definitions,
     * respecting parentheses and quoted strings so spaces within args are preserved.
     * @param {string} actionAttr - The full data-action attribute value
     * @returns {Array<string>} Individual action definition strings
     * @private
     */
    _splitActionDefs(actionAttr)
    {
        const parts = [];
        let current = '';
        let parenDepth = 0;
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < actionAttr.length; i++)
        {
            const ch = actionAttr[i];
            if (inString)
            {
                current += ch;
                if (ch === stringChar) { inString = false; }
            } else if (ch === "'" || ch === '"')
            {
                inString = true;
                stringChar = ch;
                current += ch;
            } else if (ch === '(')
            {
                parenDepth++;
                current += ch;
            } else if (ch === ')')
            {
                parenDepth--;
                current += ch;
            } else if (ch === ' ' && parenDepth === 0)
            {
                if (current.trim()) { parts.push(current.trim()); }
                current = '';
            } else
            {
                current += ch;
            }
        }
        if (current.trim()) { parts.push(current.trim()); }
        return parts;
    },
    /**
     * Parse comma-separated literal argument values from an action definition.
     * Supports: strings ('x' or "x"), numbers, booleans (true/false), null.
     * @param {string} argsString - The arguments string without outer parentheses
     * @returns {Array} Parsed literal values
     * @private
     */
    _parseActionArgs(argsString)
    {
        const args = [];
        let current = '';
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < argsString.length; i++)
        {
            const ch = argsString[i];
            if (inString)
            {
                if (ch === stringChar)
                {
                    inString = false;
                }
                current += ch;
            } else if (ch === "'" || ch === '"')
            {
                inString = true;
                stringChar = ch;
                current += ch;
            } else if (ch === ',')
            {
                args.push(this._parseLiteralValue(current.trim()));
                current = '';
            } else
            {
                current += ch;
            }
        }
        if (current.trim())
        {
            args.push(this._parseLiteralValue(current.trim()));
        }
        return args;
    },
    /**
     * Parse a single literal value string into its JavaScript type.
     * @param {string} raw - The raw string value
     * @returns {*} The parsed value (string, number, boolean, or null)
     * @private
     */
    _parseLiteralValue(raw)
    {
        // String literals (single or double quoted)
        if ((raw.startsWith("'") && raw.endsWith("'")) ||
            (raw.startsWith('"') && raw.endsWith('"')))
        {
            return raw.slice(1, -1);
        }
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        if (raw === 'null') return null;
        const num = Number(raw);
        if (!isNaN(num) && raw !== '') return num;
        // Unknown literal — return as string (graceful fallback)
        return raw;
    },
    /**
     * Parse attribute event modifiers on an element
     * @param {HTMLElement} element - Element to check for event modifiers
     * @returns {Object} - Configuration object based on attributes
     * @private
     */
    _parseEventModifiers(element)
    {
        // Support both data-event-* and data-wf-event-* prefixes
        const config = {
            stopPropagation: this._hasAttr(element, 'event-stop'),
            preventDefault: this._hasAttr(element, 'event-prevent'),
            once: this._hasAttr(element, 'event-once'),
            capture: this._hasAttr(element, 'event-capture'),
            passive: this._hasAttr(element, 'event-passive'),
            self: this._hasAttr(element, 'event-self'),
            outside: this._hasAttr(element, 'event-outside')
        };

        // Check for debounce attribute (support both prefixes)
        if (this._hasAttr(element, 'event-debounce'))
        {
            const value = parseInt(this._getAttr(element, 'event-debounce'), 10);
            config.debounce = isNaN(value) ? 300 : value; // Default to 300ms if not a number
        }

        // Check for throttle attribute (support both prefixes)
        if (this._hasAttr(element, 'event-throttle'))
        {
            const value = parseInt(this._getAttr(element, 'event-throttle'), 10);
            config.throttle = isNaN(value) ? 300 : value; // Default to 300ms if not a number
        }

        if (this._hasAttr(element, 'event-delay'))
        {
            const value = parseInt(this._getAttr(element, 'event-delay'), 10);
            config.delay = isNaN(value) ? 0 : value;
        }

        if (this._hasAttr(element, 'event-if'))
        {
            config.condition = this._getAttr(element, 'event-if');
        }

        return config;
    },
    /**
     * Parse key modifiers from an element's attributes
     * @param {HTMLElement} element - Element to check for key modifiers
     * @returns {Object} - Map of key modifiers
     * @private
     */
    _parseKeyModifiers(element)
    {
        const keyModifiers = {};

        // Check for modifier keys
        if (element.hasAttribute('data-event-key-ctrl')) keyModifiers.ctrl = true;
        if (element.hasAttribute('data-event-key-alt')) keyModifiers.alt = true;
        if (element.hasAttribute('data-event-key-shift')) keyModifiers.shift = true;
        if (element.hasAttribute('data-event-key-meta')) keyModifiers.meta = true;

        // Check for simple key modifiers
        const commonKeys = ['enter', 'tab', 'delete', 'esc', 'escape', 'space',
            'up', 'down', 'left', 'right', 'backspace'];

        commonKeys.forEach(key =>
        {
            if (element.hasAttribute(`data-event-key-${key}`))
            {
                keyModifiers[key] = true;
            }
        });

        // Check for combination modifiers
        const combos = [
            'ctrl+alt+delete', 'meta+alt+delete',
            'ctrl+c', 'meta+c', 'ctrl+v', 'meta+v',
            'ctrl+z', 'meta+z', 'ctrl+shift+z', 'meta+shift+z',
            'ctrl+s', 'meta+s', 'ctrl+a', 'meta+a',
            'ctrl+x', 'meta+x', 'ctrl+f', 'meta+f'
        ];

        combos.forEach(combo =>
        {
            if (element.hasAttribute(`data-event-key-${combo}`))
            {
                keyModifiers[combo] = true;
            }
        });

        // Check for any other specific keys
        Array.from(element.attributes).forEach(attr =>
        {
            if (attr.name.startsWith('data-event-key-') &&
                !attr.name.includes('+') &&  // Not a combo
                !['ctrl', 'alt', 'shift', 'meta'].includes(attr.name.slice(14)) && // Not a modifier
                !commonKeys.includes(attr.name.slice(14)))
            { // Not already handled

                const key = attr.name.slice('data-event-key-'.length);
                keyModifiers[key] = true;
            }
        });

        return keyModifiers;
    },
    /**
     * Checks if a keyboard event matches specified key modifiers including Ctrl, Alt, etc.
     * @param {KeyboardEvent} event - The keyboard event
     * @param {Object} keyModifiers - Object with key names and modifiers as keys
     * @returns {boolean} - Whether the event matches the specified modifiers
     * @private
     */
    _matchesKeyModifiers(event, keyModifiers)
    {
        // If no modifiers specified, match all keys
        if (Object.keys(keyModifiers).length === 0) return true;

        const key = event.key.toLowerCase();

        // Check for modifier requirements first
        if (keyModifiers.ctrl && !event.ctrlKey) return false;
        if (keyModifiers.alt && !event.altKey) return false;
        if (keyModifiers.shift && !event.shiftKey) return false;
        if (keyModifiers.meta && !event.metaKey) return false; // Command key on Mac

        // If only modifiers were specified (no specific key required)
        const hasOnlyModifiers = Object.keys(keyModifiers).every(mod =>
            ['ctrl', 'alt', 'shift', 'meta'].includes(mod));
        if (hasOnlyModifiers) return true;

        // Check common key mappings
        if (keyModifiers.enter && (key === 'enter' || key === 'return')) return true;
        if (keyModifiers.tab && key === 'tab') return true;
        if ((keyModifiers.esc || keyModifiers.escape) && key === 'escape') return true;
        if (keyModifiers.space && key === ' ') return true;
        if (keyModifiers.up && key === 'arrowup') return true;
        if (keyModifiers.down && key === 'arrowdown') return true;
        if (keyModifiers.left && key === 'arrowleft') return true;
        if (keyModifiers.right && key === 'arrowright') return true;
        if ((keyModifiers.delete || keyModifiers.backspace) &&
            (key === 'delete' || key === 'backspace')) return true;

        // Special combos
        if (keyModifiers['ctrl+alt+delete'] && event.ctrlKey && event.altKey && key === 'delete') return true;
        if (keyModifiers['meta+alt+delete'] && event.metaKey && event.altKey && key === 'delete') return true;

        // Common operations
        if (keyModifiers['ctrl+c'] && event.ctrlKey && key === 'c') return true;
        if (keyModifiers['meta+c'] && event.metaKey && key === 'c') return true;
        if (keyModifiers['ctrl+v'] && event.ctrlKey && key === 'v') return true;
        if (keyModifiers['meta+v'] && event.metaKey && key === 'v') return true;
        if (keyModifiers['ctrl+z'] && event.ctrlKey && key === 'z') return true;
        if (keyModifiers['meta+z'] && event.metaKey && key === 'z') return true;
        if (keyModifiers['ctrl+s'] && event.ctrlKey && key === 's') return true;
        if (keyModifiers['meta+s'] && event.metaKey && key === 's') return true;
        if (keyModifiers['ctrl+a'] && event.ctrlKey && key === 'a') return true;
        if (keyModifiers['meta+a'] && event.metaKey && key === 'a') return true;
        if (keyModifiers['ctrl+x'] && event.ctrlKey && key === 'x') return true;
        if (keyModifiers['meta+x'] && event.metaKey && key === 'x') return true;
        if (keyModifiers['ctrl+f'] && event.ctrlKey && key === 'f') return true;
        if (keyModifiers['meta+f'] && event.metaKey && key === 'f') return true;
        if (keyModifiers['ctrl+shift+z'] && event.ctrlKey && event.shiftKey && key === 'z') return true;
        if (keyModifiers['meta+shift+z'] && event.metaKey && event.shiftKey && key === 'z') return true;

        // Check specific key requirements (if no modifiers specified for the key)
        if (keyModifiers[key]) return true;

        return false;
    },
    /**
     * Merge event configuration objects
     * @param {Object} baseConfig - Base configuration (usually from component)
     * @param {Object} overrideConfig - Configuration from attributes
     * @returns {Object} - Merged configuration
     * @private
     */
    _mergeEventConfigs(baseConfig, overrideConfig)
    {
        const result = {...baseConfig};

        // Copy override properties if they exist
        if (overrideConfig.stopPropagation !== undefined) result.stopPropagation = overrideConfig.stopPropagation;
        if (overrideConfig.preventDefault !== undefined) result.preventDefault = overrideConfig.preventDefault;
        if (overrideConfig.once !== undefined) result.once = overrideConfig.once;
        if (overrideConfig.capture !== undefined) result.capture = overrideConfig.capture;
        if (overrideConfig.passive !== undefined) result.passive = overrideConfig.passive;
        if (overrideConfig.self !== undefined) result.self = overrideConfig.self;
        if (overrideConfig.outside !== undefined) result.outside = overrideConfig.outside;
        if (overrideConfig.delay !== undefined) result.delay = overrideConfig.delay;
        if (overrideConfig.condition !== undefined) result.condition = overrideConfig.condition;

        // For debounce and throttle, prefer attribute config but don't allow both
        if (overrideConfig.debounce)
        {
            result.debounce = overrideConfig.debounce;
            result.throttle = 0; // Debounce takes precedence
        } else if (overrideConfig.throttle)
        {
            result.throttle = overrideConfig.throttle;
            result.debounce = 0; // Only allow one
        }

        return result;
    },
    /**
     * Add a helper method for direct event binding with configuration options
     * @param {string} eventType - Type of event to listen for
     * @param {string|Element} selector - Element or selector to attach event to
     * @param {Function} handler - Handler function
     * @param {Object} options - Configuration options including debounce/throttle
     * @public
     */
    on(eventType, selector, handler, options = {})
    {
        // Find elements to bind to
        const elements = typeof selector === 'string'
            ? this.root.querySelectorAll(selector)
            : [selector];

        if (elements.length === 0)
        {
            this._log('warn', `No elements found for selector: ${selector}`);
            return this;
        }

        // Default options
        const config = {
            stopPropagation: false,
            preventDefault: false,
            once: false,
            capture: false,
            passive: false,
            debounce: 0,
            throttle: 0,
            ...options
        };

        // Apply function limiting if needed
        const wrappedHandler = this._getHandlerWithLimits(handler, config);

        // Add listeners to all matching elements
        elements.forEach(element =>
        {
            const handlerKey = `on-${eventType}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

            // Create event handler with config
            const eventHandler = (event) =>
            {
                if (config.stopPropagation)
                {
                    event.stopPropagation();
                }

                if (config.preventDefault)
                {
                    event.preventDefault();
                }

                return wrappedHandler(event, element);
            };

            // Store handler for cleanup
            this.eventHandlers.set(handlerKey, {
                target: element,
                event: eventType,
                handler: eventHandler,
                options: {
                    capture: config.capture
                }
            });

            // Add event listener with options
            element.addEventListener(eventType, eventHandler, {
                capture: config.capture,
                passive: config.passive,
                once: config.once
            });
        });

        return this;
    },
    /**
     * Get a handler with appropriate function wrapping based on configuration
     * @param {Function} handler - The original handler function
     * @param {Object} config - Configuration with debounce/throttle settings
     * @param {string|null} [cacheKey=null] - Optional key for caching the wrapped function
     * @returns {Function} - The handler, possibly wrapped with debounce/throttle
     * @private
     */

    _getHandlerWithLimits(handler, config, cacheKey = null)
    {
        // No need to wrap if no limits are set
        if (!config || ((!config.debounce || config.debounce <= 0) &&
            (!config.throttle || config.throttle <= 0)))
        {
            return handler;
        }

        // Use cache if a key is provided (avoids creating duplicate wrappers)
        if (cacheKey && this._wrappedHandlers.has(cacheKey))
        {
            return this._wrappedHandlers.get(cacheKey);
        }

        let wrappedHandler = handler;

        // Apply debounce if configured (debounce takes precedence over throttle)
        if (config.debounce && config.debounce > 0)
        {
            this._log('debug', `Applying debounce of ${config.debounce}ms to handler`);
            wrappedHandler = this._debounce(handler, config.debounce);
        }
        // Apply throttle if configured
        else if (config.throttle && config.throttle > 0)
        {
            this._log('debug', `Applying throttle of ${config.throttle}ms to handler`);
            wrappedHandler = this._throttle(handler, config.throttle);
        }

        // Store in cache if key provided
        if (cacheKey)
        {
            this._wrappedHandlers.set(cacheKey, wrappedHandler);
        }

        return wrappedHandler;
    },
    /**
     * Add a deferred dependency if not already present (deduplication)
     * @private
     */
    _addDeferredDependency(sourceId, targetId, path, source) {
        if (!this._deferredDependencies) {
            this._deferredDependencies = [];
        }
        // Check for duplicate
        const isDuplicate = this._deferredDependencies.some(d =>
            d.sourceId === sourceId &&
            d.targetId === targetId &&
            d.path === path
        );
        if (!isDuplicate) {
            this._deferredDependencies.push({
                sourceId,
                targetId,
                path,
                timestamp: Date.now(),
                _source: source
            });
        }
    },
    /**
     * Process any deferred dependencies that couldn't be registered earlier
     * @private
     */


    _processDeferredDependencies() {
        if (!this._deferredDependencies || this._deferredDependencies.length === 0) return;

        // Prevent recursive processing
        if (this._processingDeferredDependencies) return;
        this._processingDeferredDependencies = true;

        const now = Date.now();
        const stillDeferred = [];
        let registeredCount = 0;
        const forceReEvaluation = new Set(); // Components that need computed re-evaluation

        this._deferredDependencies.forEach(dep => {
            // Skip very old dependencies - drop silently
            if (now - dep.timestamp > STALE_DEPENDENCY_MS) {
                return;
            }

            const sourceComponent = this.componentInstances.get(dep.sourceId);
            let targetComponent = this.componentInstances.get(dep.targetId);

            // Try to find target by name if not found by ID
            if (!targetComponent && typeof dep.targetId === 'string') {
                if (dep.targetId === 'app-store') {
                    targetComponent = this.storeManager.getStoreComponentByName('app-store');
                } else if (dep.targetId.startsWith('store-')) {
                    targetComponent = this.storeManager.getStoreComponentByName(dep.targetId);
                }
            }

            // Check if both components still exist
            if (!sourceComponent || !targetComponent) {
                // For store-not-found, keep trying but not forever (30 second limit already applied above)
                if (dep.reason === 'store-not-found' && targetComponent === undefined) {
                    // Store might get created later, keep in queue (timeout still applies)
                    stillDeferred.push(dep);
                }
                // For all other cases, drop the dependency
                return;
            }

            // For store-not-ready dependencies, check if store is now ready
            if (dep.reason === 'store-not-ready' && targetComponent.state._internal) {
                if (!targetComponent.state._internal.ready) {
                    stillDeferred.push(dep); // Store still not ready
                    return;
                }
                // Store is now ready, force re-evaluation
                forceReEvaluation.add(dep.sourceId);
            }

            const sourceContext = this._contextRegistry.getContextById(dep.sourceId);
            const targetContext = this._contextRegistry.getContextById(dep.targetId) ||
                this._contextRegistry.getContextById(targetComponent.id);

            if (sourceContext && targetContext) {
                this._contextRegistry.registerDependency(sourceContext, targetContext, dep.path);
                registeredCount++;
                forceReEvaluation.add(dep.sourceId);

                // Add to pending dependent updates
                this._ensureSet('_pendingDependentUpdates');
                this._pendingDependentUpdates.add(dep.sourceId);
            } else {
                // Still can't register, keep trying
                stillDeferred.push(dep);
            }
        });

        // Update the deferred dependencies list
        this._deferredDependencies = stillDeferred;

        // Force re-evaluation of computed properties for components that got new dependencies
        forceReEvaluation.forEach(componentId => {
            const component = this.componentInstances.get(componentId);
            if (component && component.stateManager) {
                // Clear computed cache
                component.stateManager.computedCache.clear();

                // Re-evaluate all computed properties
                Object.keys(component.stateManager.computed || {}).forEach(propName => {
                    try {
                        const oldValue = component.stateManager._lastEvalResult?.get(propName);
                        const newValue = component.stateManager.evaluateComputed(propName);

                        // Trigger state change notification if value changed
                        if (!objectUtils.isEqual(oldValue, newValue)) {
                            component.stateManager.onStateChange(`computed:${propName}`, newValue, oldValue);
                        }
                    } catch (error) {
                        if (__DEV__) console.error(`Error re-evaluating ${propName}:`, error);
                    }
                });
            }
        });

        // Clear recursive guard
        this._processingDeferredDependencies = false;

        if (registeredCount > 0) {
            // Only log when we actually processed something (not just pending)
            if (stillDeferred.length > 0) {
                // Group by source for debugging
                const bySource = {};
                stillDeferred.forEach(d => {
                    const src = d._source || 'unknown';
                    bySource[src] = (bySource[src] || 0) + 1;
                });
                console.debug(`Processed ${registeredCount} deferred dependencies, ${stillDeferred.length} still pending:`, bySource);
            }
            this._scheduleRender();
        }
    },
    /**
     * Creates a debounced version of a function
     * @param {Function} fn - The function to debounce
     * @param {number} wait - Milliseconds to wait
     * @param {boolean} immediate - Whether to call on leading edge
     * @returns {Function} - Debounced function
     * @private
     */

    _debounce(fn, wait = 300, immediate = false)
    {
        let timeout;

        return function (...args)
        {
            const context = this;
            const callNow = immediate && !timeout;

            clearTimeout(timeout);

            timeout = setTimeout(() =>
            {
                timeout = null;
                if (!immediate) fn.apply(context, args);
            }, wait);

            if (callNow) fn.apply(context, args);
        };
    },
    /**
     * Creates a throttled version of a function
     * @param {Function} fn - The function to throttle
     * @param {number} [limit=300] - Milliseconds between allowed calls
     * @returns {Function} - Throttled function
     * @private
     */

    _throttle(fn, limit = 300)
    {
        let lastCall = 0;

        return function (...args)
        {
            const now = Date.now();
            const context = this;

            if (now - lastCall >= limit)
            {
                lastCall = now;
                fn.apply(context, args);
            }
        };
    }
};
