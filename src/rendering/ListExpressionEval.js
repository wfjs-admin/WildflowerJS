/**
 * ListExpressionEval - Expression evaluation in list context
 *
 * Extracted from ListRenderer.js for code organization.
 * These methods handle evaluating expressions (class bindings, style bindings,
 * attribute bindings) within list item contexts, including computed property
 * evaluation, property change propagation, and evaluator caching.
 *
 * @module
 */

import { getCSPSafeEvaluatorWithArgs } from '../core/CSPExpressionEvaluator.js';
import { _UNSAFE_EXPR_RE } from '../core/ExpressionEvaluator.js';

/** Blocklisted attributes for data-bind-attr security (O(1) lookup, no per-call allocation) */
const _LIST_BLOCKED_ATTRS = new Set([
    'class', 'style', 'srcdoc',
    'data-bind', 'data-action', 'data-list', 'data-if', 'data-show',
    'data-render', 'data-component', 'data-template', 'data-slot',
    'data-portal', 'data-bind-html', 'data-bind-class', 'data-bind-style',
    'data-bind-attr', 'data-model', 'data-key',
    'data-wf-bind', 'data-wf-action', 'data-wf-list', 'data-wf-if', 'data-wf-show',
    'data-wf-render', 'data-wf-component', 'data-wf-template', 'data-wf-slot',
    'data-wf-portal', 'data-wf-bind-html', 'data-wf-bind-class', 'data-wf-bind-style',
    'data-wf-bind-attr', 'data-wf-model', 'data-wf-key'
]);

/** Boolean HTML attributes where presence = active (regardless of value) */
const BOOLEAN_HTML_ATTRS = new Set([
    'disabled', 'readonly', 'required', 'checked', 'selected',
    'multiple', 'hidden', 'autofocus', 'autoplay', 'controls',
    'loop', 'muted', 'default', 'defer', 'async', 'novalidate',
    'formnovalidate', 'open', 'reversed', 'allowfullscreen',
    'ismap', 'nomodule', 'playsinline', 'disablepictureinpicture'
]);

/**
 * Methods to be mixed into ListRendererMethods (and ultimately WildflowerJS.prototype)
 */
export const ListExpressionMethods = {
    // List context variable names for expression evaluation
    _listContextVars: new Set(['_index', '_length', '_first', '_last']),

    // _reusableListContext: initialized per-instance in FrameworkInit._initialize()
    // to avoid prototype sharing across multiple WildflowerJS instances.

    _processOptimizedClassBinding(element, item, expression, itemIndex, context = null) {
        // PERF: Determine if list item once, avoiding repeated DOM queries
        // If context is provided, we're in a list item context
        const isListItem = context !== null;

        // Strategy 1: Computed property reference (must check BEFORE static property)
        // computed:xxx doesn't have spaces or ? but needs special handling
        if (expression.startsWith('computed:')) {
            const computedName = expression.slice(9);

            // If we're in a list item context, evaluate immediately with item data
            if (isListItem && context && context.componentInstance) {
                try {
                    const value = this._evaluateComputedInListContext(
                        context.componentInstance,
                        computedName,
                        item,
                        itemIndex,
                        context
                    );
                    if (value !== null && value !== undefined) {
                        this._toggleBoundClass(element, String(value));
                    } else {
                        this._toggleBoundClass(element, '');
                    }
                    // Clear any deferred binding markers from previous renders
                    // to prevent _processDeferredComputedClassBindings from re-evaluating
                    // without list item context
                    delete element._computedClassBinding;
                    if (this._deferredComputedClassElements) {
                        this._deferredComputedClassElements.delete(element);
                    }
                    return;
                } catch (e) {
                    if (__DEV__) console.error(`Error evaluating computed class binding "${computedName}" in list context:`, e);
                    return;
                }
            }

            // Defer to render cycle when component context is available (non-list case)
            element._computedClassBinding = computedName;
            // Track in Set for efficient lookup (avoids document.querySelectorAll('*'))
            this._deferredComputedClassElements.add(element);
            return;
        }

        // Normalize $store.path shorthand to external() calls early,
        // so all downstream external() detection and handling works correctly
        if (expression.includes('$') && this._normalizeStoreShorthands) {
            expression = this._normalizeStoreShorthands(expression);
        }

        // Handle external() function calls (standalone only — list items fall through
        // to _applyCompiledClassBinding which merges item data + external function)
        if (expression.includes('external(') && !isListItem) {
            // Get component instance - try context first, then DOM lookup
            let componentInstance = context?.componentInstance;
            if (!componentInstance) {
                const componentElement = element.closest('[data-component],[data-wf-component]');
                const componentId = componentElement?.dataset.componentId || componentElement?.dataset.wfComponentId;
                componentInstance = componentId ? this.componentInstances.get(componentId) : null;
            }
            if (componentInstance) {
                try {
                    const desc = this._classifyBinding(expression);
                    const value = this._lookupFromComponent(desc, componentInstance);
                    this._toggleBoundClass(element, value ? String(value) : '');
                } catch (e) {
                    if (__DEV__) console.error('Error evaluating external() in class binding:', e);
                    this._toggleBoundClass(element, '');
                }
            }
            return;
        }

        // Strategy 2: Static property binding (fastest)
        // Check for implicit computed property first
        if (!expression.includes(' ') && !expression.includes('?')) {
            let value;
            const componentInstance = context?.componentInstance;

            if (componentInstance?.stateManager?.computed?.[expression]) {
                // Implicit computed property (no computed: prefix)
                value = this._evaluateComputedInListContext(
                    componentInstance,
                    expression,
                    item,
                    itemIndex,
                    context
                );
            } else if (item) {
                // List item context - get from item
                value = this._getValueFromItem(item, expression);
            } else if (componentInstance?.state) {
                // Standalone context (data-render, data-show) - get from component state
                value = componentInstance.state[expression];
            }
            this._toggleBoundClass(element, value ? String(value) : '');
            // Don't remove attribute for list items - needed for re-evaluation on updates
            if (!isListItem) {
                element.removeAttribute('data-bind-class');
                element.removeAttribute('data-wf-bind-class');
            }
            return;
        }

        // Strategy 3 & 4: Use cached expression analysis for performance
        // Cache key based on expression to avoid re-parsing
        const cacheKey = `classBinding:${expression}`;
        let bindingInfo = this._expressionCache?.get(cacheKey);

        if (!bindingInfo) {
            bindingInfo = { vars: this._extractExpressionVars(expression) };
            this._expressionCache.set(cacheKey, bindingInfo);
        }

        const uniqueVars = bindingInfo.vars;

        // Check if expression uses list context variables (_index, _length, _first, _last)
        const usesListContext = uniqueVars.some(v => this._listContextVars.has(v));

        // Check if any variables are NOT in the item and NOT list context vars - these must come from component state
        const needsComponentState = uniqueVars.some(v => !(v in item) && !this._listContextVars.has(v));

        // Strategy 3: Expression with component state dependency or list context (detected dynamically)
        if (needsComponentState || usesListContext || expression.includes('state.')) {
            // These need component state or list context - defer or use evaluator
            // Use pre-compiled evaluator that can access item, component state, and list context
            this._applyCompiledClassBinding(element, item, expression, itemIndex, context);
            return;
        }

        // Strategy 4: Item-only expressions (can evaluate immediately)
        const compiledFn = this._getOrCreateEvaluator(expression, uniqueVars);
        try {
            // Build arguments array from item properties
            const args = uniqueVars.map(v => item[v]);
            const className = compiledFn(...args);
            this._toggleBoundClass(element, className ? String(className) : '');
        } catch (e) {
            // Fallback - remove any previously bound classes
            this._toggleBoundClass(element, '');
        }

        // Don't remove attribute for list items - needed for re-evaluation on updates
        // PERF: Use already-computed isListItem (context !== null) instead of DOM query
        if (!isListItem) {
            element.removeAttribute('data-bind-class');
            element.removeAttribute('data-wf-bind-class');
        }
    },
    /**
     * Process data-bind-style attribute for dynamic inline style binding
     * Evaluates object expression and applies styles to element
     *
     * Syntax: data-bind-style="{ backgroundColor: bgColor, opacity: fadeLevel }"
     *
     * Features:
     * - Object syntax for multiple style properties
     * - Supports camelCase (backgroundColor) and kebab-case ('background-color')
    /**
     * Unified object binding processor for data-bind-style and data-bind-attr
     * @param {string} type - 'style' or 'attr'
     * @param {HTMLElement} element - Target element
     * @param {Object} item - List item data (null for standalone bindings)
     * @param {string} expression - Object expression (e.g., "{ color: textColor }")
     * @param {number} itemIndex - Index in list (0 for standalone)
     * @param {Object} context - List/binding context
     * @private
     */
    _processObjectBinding(type, element, item, expression, itemIndex, context = null) {
        if (!expression) return;

        // Pre-process attr expressions to quote unquoted hyphenated keys
        // e.g., { data-item-id: id } → { 'data-item-id': id }
        // This makes the expression valid JavaScript
        // Pattern: key must start with letter/$/_,  followed by alphanumeric, then one or more -segment groups
        if (type === 'attr') {
            expression = expression.replace(/(\{|,)\s*([a-zA-Z_$][a-zA-Z0-9_$]*(?:-[a-zA-Z0-9_$]+)+)\s*:/g,
                (match, prefix, key) => `${prefix} '${key}':`
            );
        }

        // Normalize $store.path shorthand to external() calls early
        if (expression.includes('$') && this._normalizeStoreShorthands) {
            expression = this._normalizeStoreShorthands(expression);
        }

        const cacheKey = type === 'style' ? 'bindStyle' : 'bindAttr';
        const errorPrefix = type === 'style' ? 'data-bind-style' : 'data-bind-attr';

        // Get component instance for state/computed access
        // First try from context (for list items that may not be in DOM yet)
        // Then fall back to DOM lookup
        let instance = context?.componentInstance;
        if (!instance) {
            const componentElement = element.closest('[data-component],[data-wf-component]');
            const componentId = componentElement?.dataset.componentId || componentElement?.dataset.wfComponentId;
            instance = componentId ? this.componentInstances.get(componentId) : null;
        }

        // Handle computed:propName - for both standalone and list contexts
        if (expression.startsWith('computed:') && instance) {
            const computedName = expression.slice(9);
            let resultObject;

            if (item) {
                // List context - evaluate computed with item context
                resultObject = this._evaluateComputedInListContext(instance, computedName, item, itemIndex, context);
            } else {
                // Standalone context (including inside data-show/data-render) - evaluate computed directly
                resultObject = instance.stateManager?.evaluateComputed(computedName);
            }

            if (resultObject && typeof resultObject === 'object') {
                this._applyObjectBinding(type, element, resultObject);
            }
            return;
        }

        // Handle implicit computed property (simple name, no braces/dots/operators)
        // Same logic as explicit computed: prefix but without requiring the prefix
        if (instance && item && !expression.includes('{') && !expression.includes('.') && !expression.includes(' ')) {
            const computed = instance.stateManager?.computed;
            if (computed && expression in computed) {
                const resultObject = this._evaluateComputedInListContext(instance, expression, item, itemIndex, context);
                if (resultObject && typeof resultObject === 'object') {
                    this._applyObjectBinding(type, element, resultObject);
                }
                return;
            }
        }

        // Build merged state with lazy computed evaluation
        const listLength = context?.listLength ?? context?._length ?? 0;
        const mergedState = this._getMergedState(instance, item, itemIndex, listLength);

        // Evaluate the expression to get the object
        let resultObject;
        try {
            const options = { cacheKey };

            // Handle external() function calls - provide external function in context
            if (expression.includes('external(') && instance) {
                options.additionalContext = { external: this._getExternalFn(instance) };
            }

            resultObject = this.evaluateExpression(expression, mergedState, options);
        } catch (e) {
            // Expression evaluation failed - log and return
            if (__DEV__) console.warn(`[WF] ${errorPrefix} evaluation error:`, e.message);
            return;
        }

        // Apply the object (handles null check and all property types)
        this._applyObjectBinding(type, element, resultObject);
    },

    /**
     * Process style binding for an element
     * Delegates to unified _processObjectBinding for consistency
     * @param {HTMLElement} element - Target element
     * @param {Object} item - List item data (null for standalone)
     * @param {string} expression - Style expression
     * @param {number} itemIndex - Index in list
     * @param {Object} context - List/binding context
     * @private
     */
    _processStyleBinding(element, item, expression, itemIndex, context = null) {
        this._processObjectBinding('style', element, item, expression, itemIndex, context);
    },

    /**
     * Process attribute binding for an element
     * Delegates to unified _processObjectBinding for consistency
     * @param {HTMLElement} element - Target element
     * @param {Object} item - List item data (null for standalone)
     * @param {string} expression - Attr expression
     * @param {number} itemIndex - Index in list
     * @param {Object} context - List/binding context
     * @private
     */
    _processAttrBinding(element, item, expression, itemIndex, context = null) {
        this._processObjectBinding('attr', element, item, expression, itemIndex, context);
    },
    /**
     * Evaluate a computed property in list item context
     * Creates an enhanced context that includes item properties and list context variables
     * @param {Object} instance - Component instance
     * @param {string} computedName - Name of the computed property
     * @param {Object} item - List item data
     * @param {number} itemIndex - Index in the list
     * @param {Object} context - List context
     * @returns {any} - The computed result
     * @private
     */
    _evaluateComputedInListContext(instance, computedName, item, itemIndex, context) {
        // Mark this computed property as item-level (used in list context)
        // This prevents component-level re-evaluation from overwriting list item values
        if (instance?.stateManager) {
            if (!instance.stateManager._itemLevelComputedProperties) {
                instance.stateManager._itemLevelComputedProperties = new Set();
            }
            instance.stateManager._itemLevelComputedProperties.add(computedName);
        }

        // Use the original function stored before wrapping, not the wrapper
        const originalFn = instance?.stateManager?._originalComputedFunctions?.get(computedName);
        if (!originalFn || typeof originalFn !== 'function') {
            return null;
        }

        // REACTIVE METHODS: Check if this is a parameterized (item-level) computed
        // If fn.length > 0, call with (item, index) instead of enhanced context
        // This matches JS array method conventions (map, forEach, filter)
        const isItemLevelComputed = originalFn.length > 0;

        if (isItemLevelComputed) {
            // Item-level computed: call with (item, index) as arguments
            // 'this' is the component instance for access to this.state, this.computed

            // PHASE 2: Set tracking context for automatic store dependency registration
            // This allows getStore() calls to register the component as a store dependent
            const previousTrackingContext = this._computedTrackingContext;
            // V8 OPT: Canonical shape — all fields always present
            this._computedTrackingContext = {
                componentId: instance.id,
                computedName: computedName,
                stateManager: instance.stateManager,
                listElement: null,
                isItemLevelComputed: true,
                itemIndex: itemIndex
            };

            try {
                // Create a context object that provides access to component features
                // while allowing the computed to receive item as first argument
                const componentContext = {
                    state: instance.state,
                    props: instance.props,
                    stores: instance.context?.stores || {},
                    // Proxy for computed that allows calling other item-level computeds
                    computed: new Proxy({}, {
                        get: (target, prop) => {
                            // Ignore Symbol properties (used by Vitest/internal frameworks)
                            if (typeof prop === 'symbol') {
                                return undefined;
                            }
                            // Check if the target computed is also item-level
                            const targetFn = instance?.stateManager?._originalComputedFunctions?.get(prop);
                            if (targetFn && targetFn.length > 0) {
                                // Return a function that can be called with item argument
                                return (itemArg, indexArg) => {
                                    return this._evaluateComputedInListContext(
                                        instance, prop, itemArg,
                                        indexArg !== undefined ? indexArg : itemIndex,
                                        context
                                    );
                                };
                            }
                            // Non-parameterized: evaluate at component level
                            return instance.stateManager.evaluateComputed(prop);
                        }
                    }),
                    // Access to getStore for store dependencies
                    getStore: (name) => this.getStore(name)
                };

                return originalFn.call(componentContext, item, itemIndex);
            } catch (e) {
                if (__DEV__) console.warn(`[WF] Error evaluating computed "${computedName}" in list context:`, e.message);
                return null;
            } finally {
                // Restore previous tracking context
                this._computedTrackingContext = previousTrackingContext;
            }
        }

        // Non-parameterized computed: use enhanced context (standard behavior)
        // Create enhanced context that includes:
        // 1. Component state via this.state
        // 2. Component props via this.props
        // 3. Component computed properties via this.computed
        // 4. Item properties directly on this (e.g., this.id, this.name)
        // 5. List context variables (_index, _length, _first, _last)
        const listLength = context?.listLength ?? context?._length ?? context?.data?.length ?? 0;
        const enhancedContext = {
            // Item properties directly accessible as this.propertyName
            ...item,
            // List context variables
            ...this._buildListContextVars(itemIndex, listLength),
            // Component state accessible as this.state
            state: instance.state,
            // Component props accessible as this.props
            props: instance.props,
            // Component computed properties accessible as this.computed
            computed: new Proxy({}, {
                get: (target, prop) => {
                    // Guard: only handle string property names (skip Symbols)
                    if (typeof prop !== 'string') {
                        return undefined;
                    }
                    return instance.stateManager.evaluateComputed(prop);
                }
            })
        };

        // Set tracking context so getStore() calls register this computed
        // as having external dependencies (same as parameterized path above)
        const previousTrackingContext = this._computedTrackingContext;
        // V8 OPT: Canonical shape — all fields always present
        this._computedTrackingContext = {
            componentId: instance.id,
            computedName: computedName,
            stateManager: instance.stateManager,
            listElement: null,
            isItemLevelComputed: false,
            itemIndex: itemIndex
        };

        try {
            // Call the original computed function with the enhanced context
            return originalFn.call(enhancedContext);
        } catch (e) {
            if (__DEV__) console.warn(`[WF] Error evaluating computed "${computedName}" in list context:`, e.message);
            return null;
        } finally {
            this._computedTrackingContext = previousTrackingContext;
        }
    },
    /**
     * Build list context variables object for use in expression evaluation
     * @param {number} itemIndex - Zero-based index of the item
     * @param {number} listLength - Total number of items in the list
     * @returns {Object} Object with _index, _length, _first, _last properties
     * @private
     */
    _buildListContextVars(itemIndex, listLength) {
        return {
            _index: itemIndex,
            _length: listLength,
            _first: itemIndex === 0,
            _last: itemIndex === listLength - 1
        };
    },
    // =========================================================================
    // UNIFIED OBJECT BINDING SYSTEM
    // Handles both data-bind-style and data-bind-attr with shared logic
    // =========================================================================

    /**
     * Check if an attribute name is blocklisted for security or framework integrity
     * @param {string} attrName - Attribute name to check
     * @returns {boolean} True if blocklisted
     * @private
     */
    _isBlocklistedAttr(attrName) {
        const lower = attrName.toLowerCase();

        // Block event handlers (XSS prevention)
        if (lower.startsWith('on')) return true;

        // Block framework directives, class/style, srcdoc (O(1) Set lookup)
        return _LIST_BLOCKED_ATTRS.has(lower);
    },

    /**
     * Sanitize attribute value for security
     * @param {string} attrName - Attribute name
     * @param {*} value - Value to sanitize
     * @returns {*} Sanitized value or null if blocked
     * @private
     */
    _sanitizeAttrValue(attrName, value) {
        if (value === null || value === undefined) return value;

        const lower = attrName.toLowerCase();

        // For URL-bearing attributes, normalize and check dangerous protocols
        if (['href', 'src', 'formaction', 'action', 'poster'].includes(lower)) {
            // Strip all whitespace and control characters before protocol check
            // to prevent bypasses like "java\tscript:" or "java\nscript:"
            const normalized = String(value).replace(/[\s\x00-\x1F\x7F]/g, '').toLowerCase();

            if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) {
                if (__DEV__) console.warn(`[WildflowerJS] Blocked dangerous protocol in ${attrName}`);
                return null;
            }

            // Block all data: URIs except images (data:image/*) in URL attributes
            if (/^data:(?!image\/)/.test(normalized)) {
                if (__DEV__) console.warn(`[WildflowerJS] Blocked dangerous data: URI in ${attrName}`);
                return null;
            }
        }

        return value;
    },

    /**
     * Unified object binding application
     * Handles both style and attr bindings with type-specific handlers
     * @param {string} type - 'style' or 'attr'
     * @param {HTMLElement} element - Target element
     * @param {Object} object - Object with properties/attributes and values
     * @private
     */
    _applyObjectBinding(type, element, object) {
        if (!object || typeof object !== 'object') {
            return;
        }

        const trackProp = type === 'style' ? '_boundStyleProps' : '_boundAttrProps';

        for (const [prop, value] of Object.entries(object)) {
            try {
                if (type === 'attr') {
                    // Attribute-specific validation
                    if (this._isBlocklistedAttr(prop)) {
                        if (__DEV__) console.warn(`[WildflowerJS] Cannot bind blacklisted attribute: ${prop}`);
                        continue;
                    }

                    // Attribute-specific sanitization
                    const sanitized = this._sanitizeAttrValue(prop, value);

                    const isBooleanAttr = BOOLEAN_HTML_ATTRS.has(prop.toLowerCase());

                    if (sanitized === null || sanitized === undefined) {
                        // Always remove for null/undefined
                        element.removeAttribute(prop);
                    } else if (sanitized === false && isBooleanAttr) {
                        // Remove boolean HTML attributes when false (presence = active)
                        element.removeAttribute(prop);
                    } else {
                        // Convert all values to strings, including booleans
                        element.setAttribute(prop, String(sanitized));
                    }
                } else {
                    // Style-specific handling
                    if (value === null || value === undefined || value === false) {
                        // Clear the style property
                        if (prop.startsWith('--')) {
                            element.style.removeProperty(prop);
                        } else {
                            element.style[prop] = '';
                        }
                    } else {
                        const valueStr = String(value);
                        const hasImportant = valueStr.includes('!important');

                        if (prop.startsWith('--')) {
                            // CSS custom properties must use setProperty
                            if (hasImportant) {
                                const cleanValue = valueStr.replace(/\s*!important\s*/gi, '').trim();
                                element.style.setProperty(prop, cleanValue, 'important');
                            } else {
                                element.style.setProperty(prop, valueStr);
                            }
                        } else if (hasImportant) {
                            // !important requires setProperty with priority parameter
                            const kebabProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
                            const cleanValue = valueStr.replace(/\s*!important\s*/gi, '').trim();
                            element.style.setProperty(kebabProp, cleanValue, 'important');
                        } else {
                            element.style[prop] = valueStr;
                        }
                    }
                }
            } catch (e) {
                // Invalid property/attribute - skip silently
            }
        }

        // Track which properties were set for potential cleanup
        if (!element[trackProp]) {
            element[trackProp] = new Set();
        }
        Object.keys(object).forEach(prop => element[trackProp].add(prop));
    },

    /**
     * Get or create an optimized evaluator function
     * Uses shared _getCompiledExpression for compilation and caching
     */
    _getOrCreateEvaluator(expression, contextKeys) {
        // Use shared compilation with 'eval' prefix to distinguish from other caches
        const fn = this._getCompiledExpression(expression, contextKeys, 'eval');

        if (!fn) {
            // Return noop for invalid expressions
            return () => '';
        }

        // For small argument counts, create specialized wrapper versions for better performance
        if (contextKeys.length <= 3) {
            const wrapperKey = `evalWrapper::${expression}::${contextKeys.join(',')}`;
            if (this._expressionEvaluator.has(wrapperKey)) {
                return this._expressionEvaluator.get(wrapperKey);
            }

            const evaluator = contextKeys.length === 1
                ? (a) => fn(a)
                : contextKeys.length === 2
                    ? (a, b) => fn(a, b)
                    : (a, b, c) => fn(a, b, c);

            this._expressionEvaluator.set(wrapperKey, evaluator);
            return evaluator;
        }

        return fn;
    },
    // REMOVED: _updateListClassBindingsForProperty, _updateObjectBindingsForProperty,
    // _updateStyleBindingsForProperty, _updateAttrBindingsForProperty, _updateHtmlBindingsForProperty
    // Per-item effects now handle ALL list-item binding updates (class, style, attr, HTML)
    // via _bindWithCompiledMetadata in effect re-runs. These methods were only called from
    // EntitySystem gated blocks that have been removed.
    /**
     * Re-evaluate bindings that use list context variables (_index, _length, _first, _last)
     * Called after list structure changes (add, remove, reorder)
     * Handles: data-bind-class, data-bind, data-show, data-render
     * @param {HTMLElement} listElement - The data-list element
     * @param {Array} data - The current list data
     * @param {Object} context - The list context
     */
    _updateListContextClassBindings(listElement, data, context, startIndex = 0) {
        if (!listElement) return;

        const listLength = data?.length ?? 0;
        const items = this._getListItems(listElement);

        // OPTIMIZATION: Hoist helper outside loop (listElement is constant for all items)
        const isInNestedList = (el) => {
            const closestList = el.closest('[data-list],[data-wf-list]');
            return closestList !== listElement;
        };

        // OPTIMIZATION: Pre-create enriched context once (avoids object spread per item)
        const enrichedContext = { ...context, listLength };

        // PERF: Skip items before startIndex - their indices haven't changed
        // For single removal at index 500, this skips processing 500 items
        const itemCount = items.length;
        for (let index = startIndex; index < itemCount; index++) {
            const itemEl = items[index];
            const item = itemEl._itemData || {};

            // OPTIMIZATION: Use cached binding elements instead of querySelectorAll
            // This eliminates 3 querySelectorAll calls per item (30,000 for 10,000 items)
            const cachedElements = itemEl._cachedElementsArray || itemEl._bindingElements;

            // PHASE 3.5: Use compiled metadata for class bindings (attributes may be stripped)
            const itemMetadata = itemEl._compiledMetadata;
            if (itemMetadata && itemMetadata.classBindings && cachedElements) {
                // FAST PATH: Use pre-compiled metadata
                for (let i = 0; i < itemMetadata.classBindings.length; i++) {
                    const cb = itemMetadata.classBindings[i];
                    // Skip bindings that don't use list context variables
                    if (!cb.usesListContext) continue;
                    const el = cachedElements[cb.index];
                    if (!el) continue;
                    if (isInNestedList(el)) continue;
                    this._applyCompiledClassBinding(el, item, cb.expression, index, enrichedContext);
                }
                // Also handle root element class binding if present
                if (itemMetadata.rootBindings?.hasBindClass && itemMetadata.rootBindings?.bindClassExpr) {
                    const rootExpr = itemMetadata.rootBindings.bindClassExpr;
                    if (this._expressionUsesListContext(rootExpr)) {
                        this._applyCompiledClassBinding(itemEl, item, rootExpr, index, enrichedContext);
                    }
                }
                // Also handle root element attr binding if present
                if (itemMetadata.rootBindings?.hasBindAttr && itemMetadata.rootBindings?.bindAttrExpr) {
                    const rootAttrExpr = itemMetadata.rootBindings.bindAttrExpr;
                    if (this._expressionUsesListContext(rootAttrExpr)) {
                        this._processObjectBinding('attr', itemEl, item, rootAttrExpr, index, enrichedContext);
                    }
                }
            } else {
                // FALLBACK: Use attributes (for cloneNode path or missing metadata)
                // Re-evaluate data-bind-class on item element (support both prefixes)
                if (this._hasAttr(itemEl, 'bind-class')) {
                    const expr = this._getAttr(itemEl, 'bind-class');
                    if (this._expressionUsesListContext(expr)) {
                        this._applyCompiledClassBinding(itemEl, item, expr, index, enrichedContext);
                    }
                }
                // Re-evaluate data-bind-attr on item element (support both prefixes)
                if (this._hasAttr(itemEl, 'bind-attr')) {
                    const expr = this._getAttr(itemEl, 'bind-attr');
                    if (this._expressionUsesListContext(expr)) {
                        this._processObjectBinding('attr', itemEl, item, expr, index, enrichedContext);
                    }
                }

                // Re-evaluate data-bind-class on child elements
                if (cachedElements) {
                    // FAST PATH: iterate cached elements
                    for (let i = 0; i < cachedElements.length; i++) {
                        const el = cachedElements[i];
                        if (!el || !this._hasAttr(el, 'bind-class')) continue;
                        if (isInNestedList(el)) continue;
                        const expr = this._getAttr(el, 'bind-class');
                        if (this._expressionUsesListContext(expr)) {
                            this._applyCompiledClassBinding(el, item, expr, index, enrichedContext);
                        }
                    }
                } else {
                    // FALLBACK: querySelectorAll
                    itemEl.querySelectorAll('[data-bind-class],[data-wf-bind-class]').forEach(el => {
                        if (isInNestedList(el)) return;
                        const expr = this._getAttr(el, 'bind-class');
                        if (this._expressionUsesListContext(expr)) {
                            this._applyCompiledClassBinding(el, item, expr, index, enrichedContext);
                        }
                    });
                }

                // Re-evaluate data-bind-attr on child elements
                if (cachedElements) {
                    // FAST PATH: iterate cached elements
                    for (let i = 0; i < cachedElements.length; i++) {
                        const el = cachedElements[i];
                        if (!el || !this._hasAttr(el, 'bind-attr')) continue;
                        if (isInNestedList(el)) continue;
                        const expr = this._getAttr(el, 'bind-attr');
                        if (this._expressionUsesListContext(expr)) {
                            this._processObjectBinding('attr', el, item, expr, index, enrichedContext);
                        }
                    }
                } else {
                    // FALLBACK: querySelectorAll
                    itemEl.querySelectorAll('[data-bind-attr],[data-wf-bind-attr]').forEach(el => {
                        if (isInNestedList(el)) return;
                        const expr = this._getAttr(el, 'bind-attr');
                        if (this._expressionUsesListContext(expr)) {
                            this._processObjectBinding('attr', el, item, expr, index, enrichedContext);
                        }
                    });
                }
            }

            // Re-evaluate data-bind expressions that use list context vars
            if (cachedElements) {
                // FAST PATH: check item element + iterate cached elements
                if (itemEl.hasAttribute('data-bind')) {
                    const expr = itemEl.dataset.bind;
                    if (this._expressionUsesListContext(expr) && this.isExpression(expr)) {
                        const bindingContext = this._contextRegistry?.contextsByElement?.get(itemEl);
                        if (bindingContext) {
                            bindingContext._parentIndex = index;
                            bindingContext._clearCache?.();
                            const value = bindingContext.resolveData();
                            bindingContext._updateBindingElement?.(value);
                        }
                    }
                }
                for (let i = 0; i < cachedElements.length; i++) {
                    const el = cachedElements[i];
                    if (!el || !el.hasAttribute('data-bind')) continue;
                    if (isInNestedList(el)) continue;
                    const expr = el.dataset.bind;
                    if (this._expressionUsesListContext(expr) && this.isExpression(expr)) {
                        const bindingContext = this._contextRegistry?.contextsByElement?.get(el);
                        if (bindingContext) {
                            bindingContext._parentIndex = index;
                            bindingContext._clearCache?.();
                            const value = bindingContext.resolveData();
                            bindingContext._updateBindingElement?.(value);
                        }
                    }
                }
            } else {
                // FALLBACK: querySelectorAll
                const bindElements = [
                    ...(this._hasAttr(itemEl, 'bind') ? [itemEl] : []),
                    ...itemEl.querySelectorAll(this._attrSelector('bind'))
                ];
                bindElements.forEach(el => {
                    if (el !== itemEl && isInNestedList(el)) return;
                    const expr = this._getAttr(el, 'bind');
                    if (this._expressionUsesListContext(expr) && this.isExpression(expr)) {
                        const bindingContext = this._contextRegistry?.contextsByElement?.get(el);
                        if (bindingContext) {
                            bindingContext._parentIndex = index;
                            bindingContext._clearCache?.();
                            const value = bindingContext.resolveData();
                            bindingContext._updateBindingElement?.(value);
                        }
                    }
                });
            }

            // Re-evaluate data-show/data-render expressions that use list context vars
            if (cachedElements) {
                // FAST PATH: check item element + iterate cached elements
                const itemHasShow = itemEl.hasAttribute('data-show');
                const itemHasRender = itemEl.hasAttribute('data-render');
                if (itemHasShow || itemHasRender) {
                    const expr = itemEl.dataset.show || itemEl.dataset.render;
                    if (this._expressionUsesListContext(expr) && this.isExpression(expr)) {
                        const condContext = this._contextRegistry?.contextsByElement?.get(itemEl);
                        if (condContext) {
                            condContext._parentIndex = index;
                            condContext._clearCache?.();
                            const value = condContext.resolveData();
                            if (itemHasShow) {
                                itemEl.style.display = value ? '' : 'none';
                            } else {
                                this._updateConditionalRender(itemEl, value, condContext);
                            }
                        }
                    }
                }
                for (let i = 0; i < cachedElements.length; i++) {
                    const el = cachedElements[i];
                    if (!el) continue;
                    const hasShow = el.hasAttribute('data-show');
                    const hasRender = el.hasAttribute('data-render');
                    if (!hasShow && !hasRender) continue;
                    if (isInNestedList(el)) continue;
                    const expr = el.dataset.show || el.dataset.render;
                    if (this._expressionUsesListContext(expr) && this.isExpression(expr)) {
                        const condContext = this._contextRegistry?.contextsByElement?.get(el);
                        if (condContext) {
                            condContext._parentIndex = index;
                            condContext._clearCache?.();
                            const value = condContext.resolveData();
                            if (hasShow) {
                                el.style.display = value ? '' : 'none';
                            } else {
                                this._updateConditionalRender(el, value, condContext);
                            }
                        }
                    }
                }
            } else {
                // FALLBACK: querySelectorAll
                const conditionalElements = [
                    ...(this._hasAttr(itemEl, 'show') || this._hasAttr(itemEl, 'render') ? [itemEl] : []),
                    ...itemEl.querySelectorAll(`${this._attrSelector('show')}, ${this._attrSelector('render')}`)
                ];
                conditionalElements.forEach(el => {
                    if (el !== itemEl && isInNestedList(el)) return;
                    const expr = this._getAttr(el, 'show') || this._getAttr(el, 'render');
                    if (this._expressionUsesListContext(expr) && this.isExpression(expr)) {
                        const condContext = this._contextRegistry?.contextsByElement?.get(el);
                        if (condContext) {
                            condContext._parentIndex = index;
                            condContext._clearCache?.();
                            const value = condContext.resolveData();
                            if (el.dataset.show !== undefined) {
                                el.style.display = value ? '' : 'none';
                            } else if (el.dataset.render !== undefined) {
                                this._updateConditionalRender(el, value, condContext);
                            }
                        }
                    }
                });
            }
        }
    },
    /**
     * Check if an expression uses list context variables
     * @param {string} expression - The expression to check
     * @returns {boolean} True if expression uses _index, _length, _first, or _last
     */
    _expressionUsesListContext(expression) {
        if (!expression) return false;
        // Check cache first
        const cacheKey = `usesListCtx:${expression}`;
        const cached = this._expressionCache?.get(cacheKey);
        if (cached !== undefined) return cached;

        // Check for list context variables
        const usesListContext = this._listContextVars &&
            Array.from(this._listContextVars).some(v => expression.includes(v));

        // Cache result
        if (this._expressionCache) {
            this._expressionCache.set(cacheKey, usesListContext);
        }
        return usesListContext;
    },
    /**
     * Apply compiled class binding for expressions needing component state
     * OPTIMIZED: Uses cached compiled functions with dual-source lookup (item + state)
     * to avoid expensive object spread merging on every item
     */
    _applyCompiledClassBinding(element, item, expression, itemIndex, context = null) {
        // Normalize $store.path shorthand to external() calls early
        if (expression.includes('$') && this._normalizeStoreShorthands) {
            expression = this._normalizeStoreShorthands(expression);
        }

        // Get component instance from context
        const component = context?.componentInstance;
        let listLength = context?.listLength;

        // CRITICAL: Build componentState as a plain object, NOT the reactive proxy.
        // If we pass the proxy and later access it (e.g., componentState[varName]),
        // that triggers the proxy's get trap which registers dependencies.
        // Since this function is called during item effect execution, those dependencies
        // would be registered for EVERY item effect, causing all items to re-render
        // when any state property changes.
        //
        // We use untrack() to ensure the spread operation doesn't register dependencies
        // for the currently active effect.
        let componentState = null;
        if (component?.state) {
            const sm = component.stateManager;
            if (sm?.untrack) {
                componentState = sm.untrack(() => {
                    // Spread state into plain object
                    const state = { ...component.state };
                    // Add computed property values
                    if (sm.computed) {
                        for (const key of Object.keys(sm.computed)) {
                            try {
                                state[key] = sm.evaluateComputed(key);
                            } catch (e) {
                                // Skip computed properties that error
                            }
                        }
                    }
                    return state;
                });
            } else {
                // Fallback if untrack not available
                componentState = component.state;
            }
        }

        // Inject external() function into componentState if expression uses it
        if (expression.includes('external(') && componentState && component) {
            componentState.external = this._getExternalFn(component);
        }

        // Try to get list length from context's data array if not provided directly
        if (listLength === undefined && Array.isArray(context?.data)) {
            listLength = context.data.length;
        }

        if (!component) {
            // Fallback to DOM traversal for backwards compatibility
            const listEl = element.closest('[data-list],[data-wf-list]');
            const componentEl = listEl?.closest('[data-component],[data-wf-component]');
            if (!componentEl?._wfComponent) {
                // Don't clear existing classes if we can't find the component.
                // The classes were set correctly during initial render and should be preserved.
                // Clearing them here causes cross-contamination in nested lists.
                return;
            }
            // Try to get list length from DOM or list context if not provided
            let length = listLength;
            if (length === undefined) {
                // Check for _listContext on the list element
                const listContext = listEl._listContext;
                if (Array.isArray(listContext?.data)) {
                    length = listContext.data.length;
                } else if (listEl) {
                    length = this._getListItems(listEl).length;
                }
            }
            // Recurse with found component and list length
            return this._applyCompiledClassBinding(element, item, expression, itemIndex, {
                componentInstance: componentEl._wfComponent,
                listLength: length
            });
        }

        // OPTIMIZATION: Reuse single listContext object instead of creating new one per item
        // This avoids 10,000 object allocations for 10,000 items
        const listContext = this._reusableListContext;
        listContext._index = itemIndex;
        listContext._length = listLength ?? 0;
        listContext._first = itemIndex === 0;
        listContext._last = listLength !== undefined ? itemIndex === listLength - 1 : false;

        // Get or create cached evaluator for this expression
        const cacheKey = `classBindingFn::${expression}`;
        let evaluator = this._expressionEvaluator.get(cacheKey);

        if (!evaluator) {
            const uniqueVars = this._extractExpressionVars(expression);

            // Compile function that takes all variables as arguments
            try {
                let fn;
                if (this._useCSPSafeEvaluation) {
                    // CSP-safe path: use AST evaluator
                    fn = getCSPSafeEvaluatorWithArgs(
                        expression,
                        uniqueVars,
                        this._astCache,
                        'list-class-binding'
                    );
                    if (!fn) {
                        // Parse failed - cache a no-op
                        evaluator = () => '';
                        this._expressionEvaluator.set(cacheKey, evaluator);
                        return;
                    }
                } else if (!_UNSAFE_EXPR_RE.test(expression)) {
                    // Standard path: use new Function()
                    fn = new Function(...uniqueVars, `"use strict"; return ${expression}`);
                }

                // OPTIMIZATION: Pre-allocate args array to avoid allocation per item
                const argsLength = uniqueVars.length;
                const args = new Array(argsLength);

                // Create evaluator that resolves vars from: listContext first, then item, then componentState
                // Uses pre-allocated args array and for loop instead of map() to avoid per-call allocation
                evaluator = (item, componentState, listContext) => {
                    for (let i = 0; i < argsLength; i++) {
                        const v = uniqueVars[i];
                        // Check list context first (_index, _length, _first, _last)
                        if (v in listContext) args[i] = listContext[v];
                        // Then item properties
                        else if (v in item) args[i] = item[v];
                        // Finally component state
                        else args[i] = componentState ? componentState[v] : undefined;
                    }
                    return fn(...args);
                };

                this._expressionEvaluator.set(cacheKey, evaluator);
            } catch (e) {
                // Compilation failed - cache a no-op
                evaluator = () => '';
                this._expressionEvaluator.set(cacheKey, evaluator);
            }
        }

        // Evaluate with list context
        let result;
        try {
            result = evaluator(item, componentState, listContext);
        } catch (e) {
            result = '';
        }

        // Use _toggleBoundClass to properly add/remove classes while preserving existing ones
        this._toggleBoundClass(element, result ? String(result) : '');
    }
};
