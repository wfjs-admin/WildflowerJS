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
import { applyShow, applyAttrObj, applyStyleObj, applyText } from '../core/BindingWriters.js';
import { wfError, WF_ERRORS } from '../core/wfUtils.js';

// WF-214 dedupe: one warning per (component name, computed name) per page life.
// Dev-only storage; the emitting block below is __DEV__-gated, so production
// builds strip the reads and this Set holds nothing.
const _wf214Warned = new Set();

// WF-214 (dev-only): a zero-arg computed evaluated for a list-row binding runs
// at component scope, so `this.<prop>` reads of ITEM fields silently resolve
// undefined. Static-scan the function source for `this.<prop>` and flag props
// that are NOT resolvable on the component (state or computed) but ARE present
// on the current item: that miss+hit conjunction is the authoring error, and
// legitimate component-scope computeds referenced in rows never trigger it.
// The scan runs once per (component, computed) and only in dev builds.
function _warnItemComputedThisMiss(instance, computedName, originalFn, item) {
    const key = (instance.name || '?') + ':' + computedName;
    if (_wf214Warned.has(key)) return;
    const src = String(originalFn);
    const re = /\bthis\.([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const prop = m[1];
        const onComponent =
            (instance.state && prop in instance.state) ||
            !!(instance.stateManager && instance.stateManager.computed && instance.stateManager.computed[prop]);
        if (!onComponent && Object.prototype.hasOwnProperty.call(item, prop)) {
            _wf214Warned.add(key);
            wfError(WF_ERRORS.ITEM_COMPUTED_THIS_MISS, {
                warn: true,
                context: `computed "${computedName}" on component "${instance.name}" reads this.${prop}`,
                suggestion: `Declare the item parameter: ${computedName}(item) { ... item.${prop} ... }`
            });
            return;
        }
    }
}

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
                    return;
                } catch (e) {
                    if (__DEV__) console.error(`Error evaluating computed class binding "${computedName}" in list context:`, e);
                    return;
                }
            }

            // Standalone (non-list) computed class is painted by the component
            // render effect (_executeClassBindForEffect), not here.
            return;
        }

        // Normalize $store.path shorthand to external() calls early,
        // so all downstream external() detection and handling works correctly
        if (expression.includes('$') && this._normalizeStoreShorthands) {
            expression = this._normalizeStoreShorthands(expression);
        }

        // Handle external() function calls (standalone only; list items fall through
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
        //
        // Documented contract (llms.txt:776 / ai-assistant.html:1788):
        //   "The framework first reads item[path] and falls back to evaluating
        //    a computed of the same name when the field is undefined."
        //
        // Item field MUST be checked first when in a list context. Previously
        // this checked the computed registry first and the row's field was
        // silently shadowed when a same-name component-level computed existed;
        // sibling bug to the data-bind-style precedence violation fixed
        // alongside this in _processObjectBinding.
        if (!expression.includes(' ') && !expression.includes('?')) {
            let value;
            const componentInstance = context?.componentInstance;

            if (item && Object.prototype.hasOwnProperty.call(item, expression)) {
                // List item context with a matching field: row data wins.
                value = this._getValueFromItem(item, expression);
            } else if (componentInstance?.stateManager?.computed?.[expression]) {
                // Implicit computed property (no computed: prefix)
                value = this._evaluateComputedInListContext(
                    componentInstance,
                    expression,
                    item,
                    itemIndex,
                    context
                );
            } else if (item) {
                // List item context without a same-name computed: get from item
                // (returns undefined if the item also lacks the field, matching
                // the documented "fall back to undefined" behavior).
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
        // e.g., { data-item-id: id } → { 'data-item-id': id } (valid JS).
        // Shared regex lives in TemplateSystem._quoteHyphenKeys.
        if (type === 'attr') {
            expression = this._quoteHyphenKeys(expression);
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
        // Same logic as explicit computed: prefix but without requiring the prefix.
        //
        // Documented contract (llms.txt:776 / ai-assistant.html:1788):
        //   "The framework first reads item[path] and falls back to evaluating
        //    a computed of the same name when the field is undefined."
        //
        // The framework previously checked the computed registry FIRST and
        // returned its value without ever consulting the item, so a row
        // field whose name happened to match a component-level computed would
        // be silently shadowed (initial render AND reactive updates). The
        // PM-demo team page hit this: a project-row chip bound to
        // data-bind-style="iconStyle" rendered the parent team's color
        // because the component had a leftover iconStyle() component computed
        // shadowing the item field.
        if (instance && item && !expression.includes('{') && !expression.includes('.') && !expression.includes(' ')) {
            const itemHasField = Object.prototype.hasOwnProperty.call(item, expression);
            if (itemHasField) {
                // Per the documented contract, item[path] wins. The row's
                // field is an object literal directly applicable as a style
                // / attr binding; no need to walk the computed registry.
                const resultObject = item[expression];
                if (resultObject && typeof resultObject === 'object') {
                    this._applyObjectBinding(type, element, resultObject);
                }
                return;
            }
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
        // Use the original function stored before wrapping, not the wrapper
        const originalFn = instance?.stateManager?._originalComputedFunctions?.get(computedName);
        if (!originalFn || typeof originalFn !== 'function') {
            return null;
        }

        // REACTIVE METHODS: Check if this is a parameterized (item-level) computed
        // If fn.length > 0, call with (item, index) instead of enhanced context
        // This matches JS array method conventions (map, forEach, filter)
        const isItemLevelComputed = originalFn.length > 0;

        // Only truly item-level computeds (fn.length > 0) belong in
        // _itemLevelComputedProperties. Zero-arg computeds referenced
        // inside list templates are still component-level (same value
        // for every row) and must remain in the component-level flush
        // queue so cross-store cascades re-evaluate them. Marking them
        // item-level would cause _flushComputedEvaluationQueue to
        // permanently skip them, stranding stale cached values whenever
        // an upstream store mutates (e.g. ui.currentTeamId nav).
        if (isItemLevelComputed && instance?.stateManager) {
            if (!instance.stateManager._itemLevelComputedProperties) {
                instance.stateManager._itemLevelComputedProperties = new Set();
            }
            instance.stateManager._itemLevelComputedProperties.add(computedName);
        }

        if (isItemLevelComputed) {
            // Item-level computed: call with (item, index) as arguments
            // 'this' is the component instance for access to this.state, this.computed

            // Set tracking context so getStore() calls inside the
            // computed register the component as a store dependent.
            const previousTrackingContext = this._computedTrackingContext;
            // V8 OPT: Canonical shape; all fields always present
            this._computedTrackingContext = {
                componentId: instance.id,
                computedName: computedName,
                stateManager: instance.stateManager,
                listElement: null,
                isItemLevelComputed: true,
                itemIndex: itemIndex
            };

            // Record (on the state manager) every component-state path this item-level
            // computed reads, so a later change to one re-runs the per-item
            // effects. Item-level computeds don't participate in
            // computedDependencies (no activeComputation), and the per-item
            // effect's own subscription is unreliable: a path hidden behind a
            // short-circuit is never registered, and _stableDeps then freezes
            // the dep set. Recording at eval time closes both gaps.
            const _recSm = instance && instance.stateManager;
            const _prevRecItemReads = _recSm ? _recSm._recordItemReads : false;

            try {
                const self = this;
                // Build the explicit-access surface (this.state, this.props, etc.)
                // alongside the legacy this.computed.X pattern. The outer Proxy
                // below adds the bare-name shortcut (this.saved, this.savedCount)
                // so item-level computeds resolve property names the same way
                // component methods and zero-arg computeds do via ContextProxy.
                const baseContext = {
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
                                    return self._evaluateComputedInListContext(
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
                    getStore: (name) => self.getStore(name)
                };

                // Outer proxy: routes bare names (this.X) the same way ContextProxy
                // does for component methods and zero-arg computeds. Resolution
                // order matches ContextProxy: own props (state/props/stores/computed/
                // getStore) → computed (precedence over state) → state.
                const componentContext = new Proxy(baseContext, {
                    get(target, prop, receiver) {
                        if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
                        // 1. Explicit-access escape hatches first
                        if (prop in target) return target[prop];
                        // 2. Computed (precedence over state; matches ContextProxy)
                        //    Item-level computeds return a curried (item) => value fn,
                        //    zero-arg computeds return the evaluated value, both
                        //    via the existing target.computed proxy logic.
                        if (typeof prop === 'string' &&
                            instance.stateManager?.computed?.[prop]) {
                            return target.computed[prop];
                        }
                        // 3. State (skip underscore-prefixed internal properties)
                        if (typeof prop === 'string' && !prop.startsWith('_') &&
                            instance.state && prop in instance.state) {
                            return instance.state[prop];
                        }
                        return undefined;
                    },
                    has(target, prop) {
                        if (prop in target) return true;
                        if (typeof prop === 'string') {
                            if (instance.stateManager?.computed?.[prop]) return true;
                            if (!prop.startsWith('_') && instance.state && prop in instance.state) return true;
                        }
                        return false;
                    }
                });

                // Pass list-context info as third arg. Functions ignore extra
                // args, so existing fn(item) and fn(item, index) signatures
                // keep working. New code can opt in: fn(item, index, info) where
                // info = { first, last, length }.
                const _listLen = context?.listLength ?? context?._length ?? context?.data?.length ?? 0;
                const info = {
                    first: itemIndex === 0,
                    last: _listLen > 0 ? itemIndex === _listLen - 1 : false,
                    length: _listLen
                };
                // Record state reads only across the user computed body (not the
                // framework's listLen/info setup above), keeping the union precise.
                if (_recSm) _recSm._recordItemReads = true;
                return originalFn.call(componentContext, item, itemIndex, info);
            } catch (e) {
                if (__DEV__) console.warn(`[WF] Error evaluating computed "${computedName}" in list context:`, e.message);
                return null;
            } finally {
                // Restore previous tracking context
                this._computedTrackingContext = previousTrackingContext;
                if (_recSm) _recSm._recordItemReads = _prevRecItemReads;
            }
        }

        // Zero-arg computed: evaluate at component scope. Per the docs,
        // fn(item, ...) is item-level; fn() is component-level. A zero-arg
        // computed referenced inside a list-template binding is treated as
        // component-level, the same value for every row. Legitimate
        // component-level computeds get referenced inside list templates all
        // the time (options arrays for dropdowns, modal-form computeds), so a
        // blanket zero-arg warning would be noise; WF-214 below fires only on
        // the miss-on-this + hit-on-item conjunction, which those legitimate
        // uses never produce.
        if (__DEV__ && item !== null && typeof item === 'object') {
            _warnItemComputedThisMiss(instance, computedName, originalFn, item);
        }
        try {
            return instance.stateManager.evaluateComputed(computedName);
        } catch (e) {
            return null;
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
        if (['href', 'src', 'formaction', 'action', 'poster', 'xlink:href'].includes(lower)) {
            // Strip all whitespace and control characters before protocol check
            // to prevent bypasses like "java\tscript:" or "java\nscript:"
            const normalized = String(value).replace(/[\s\x00-\x1F\x7F]/g, '').toLowerCase();

            if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) {
                if (__DEV__) console.warn(`[WildflowerJS] Blocked dangerous protocol in ${attrName}`);
                return null;
            }

            // Block all data: URIs in URL attributes EXCEPT raster image formats.
            // data:image/svg+xml and data:image/xml can execute inline scripts
            // when loaded via <object>/<iframe>/<embed>, so they are NOT allowed.
            if (/^data:(?!image\/(png|jpe?g|gif|webp|avif|bmp|ico|tiff?|x-icon)[,;])/i.test(normalized)) {
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
    /**
     * Dev-mode once-per-(type, element) warning when data-bind-style/-attr gets a
     * non-object value (e.g. a CSS string). Shared by the setup-write path
     * (_applyObjectBinding) and the component render effect
     * (_executeStyleBindForEffect/_executeAttrBindForEffect) so the warning fires
     * exactly once regardless of which writer paints, without a per-binding
     * context. No-op in production (__DEV__ folds).
     * @private
     */
    _warnObjectBindingShape(type, element, value) {
        if (!__DEV__) return;
        // The shape mismatch is almost always a CSS-string passed to
        // data-bind-style ('background:red' instead of {background:'red'});
        // silently skipping it leaves the user wondering why colors never apply.
        this._warnedBindingShape = this._warnedBindingShape || new WeakMap();
        let perEl = this._warnedBindingShape.get(element);
        if (!perEl) { perEl = new Set(); this._warnedBindingShape.set(element, perEl); }
        if (perEl.has(type)) return;
        perEl.add(type);
        const example = type === 'style'
            ? "{ background: '#5b8def' } or { backgroundColor: '#5b8def' }"
            : "{ 'data-id': item.id, title: item.label }";
        const sample = String(value).slice(0, 60);
        const tag = element.tagName ? element.tagName.toLowerCase() : 'element';
        const cls = element.className && typeof element.className === 'string'
            ? '.' + element.className.split(/\s+/)[0] : '';
        console.warn(
            `[WildflowerJS] data-bind-${type} expected an object, got ${typeof value} ("${sample}").\n` +
            `  Element: <${tag}${cls}>\n` +
            `  Use object form: ${example}\n` +
            `  CSS strings like "background:red" silently no-op.`
        );
    },

    _applyObjectBinding(type, element, object) {
        if (object == null) return; // null/undefined is intentional no-op
        if (typeof object !== 'object') {
            this._warnObjectBindingShape(type, element, object);
            return;
        }

        if (type === 'attr') {
            // Canonical attr-object writer (blocklist, sanitize, boolean-attr semantics,
            // stale-key cleanup), shared with the component effect path.
            applyAttrObj(element, object, this._attrWriterHelpers || (this._attrWriterHelpers = {
                isBlocklisted: (prop) => this._isBlocklistedAttr && this._isBlocklistedAttr(prop),
                sanitize: (prop, value) => this._sanitizeAttrValue ? this._sanitizeAttrValue(prop, value) : value
            }));
            return;
        }

        // Canonical style-object writer (prev-clear, !important parsing, custom props,
        // stale-key cleanup), shared with the component effect path.
        applyStyleObj(element, object);
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
    /**
     * Re-evaluate a list-item text data-bind that uses list-context variables
     * (_index/_first/_last/_length) after a structure change, straight off the
     * row's item-proxy; no per-element binding context. Mirrors the item-based
     * eval the sibling class/attr re-evals use (_getMergedState +
     * evaluateExpression), then writes the value like Context._updateBindingElement.
     * @private
     */
    /**
     * Evaluate a list-item expression in item context (item-proxy + component
     * state/computeds + _index/_first/_last/_length) without a per-element
     * binding context. Shared by the data-bind text and data-show re-evals.
     * @private
     */
    _evalItemContextExpr(element, item, expression, itemIndex, enrichedContext) {
        let expr = expression;
        if (expr.includes('$') && this._normalizeStoreShorthands) {
            expr = this._normalizeStoreShorthands(expr);
        }
        const instance = enrichedContext?.componentInstance;
        const listLength = enrichedContext?.listLength ?? enrichedContext?._length ?? 0;
        const mergedState = this._getMergedState(instance, item, itemIndex, listLength);
        const options = { cacheKey: 'bind' };
        if (expr.includes('external(') && instance) {
            options.additionalContext = { external: this._getExternalFn(instance) };
        }
        return this.evaluateExpression(expr, mergedState, options);
    },
    _reEvalItemContextBind(element, item, expression, itemIndex, enrichedContext) {
        if (this._hasAttr(element, 'bind-html')) return;
        let value;
        try {
            value = this._evalItemContextExpr(element, item, expression, itemIndex, enrichedContext);
        } catch (e) {
            if (__DEV__) console.warn(`[WF] data-bind re-eval error:`, e.message);
            return;
        }
        // Apply the value (mirrors Context._updateBindingElement)
        const tagName = element.tagName.toLowerCase();
        if (tagName.includes('-')) {
            const adapter = this.getAdapter?.(tagName, element);
            if (adapter && element[adapter.prop] !== value) element[adapter.prop] = value;
            return;
        }
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
            const elType = element.type;
            if (elType !== 'radio' && elType !== 'checkbox') {
                const stringValue = value !== undefined && value !== null ? String(value) : '';
                if (element.value !== stringValue) element.value = stringValue;
            }
            return;
        }
        applyText(element, value);
    },
    /**
     * Re-evaluate a list-item data-show that uses list-context variables after a
     * structure change, off the row's item-proxy; no per-element conditional
     * context (so it works even for child elements that never got one, which is
     * why a list-row data-show="_last" previously failed to update on removal).
     * data-render in lists is re-evaluated by per-item effects, not here.
     * @private
     */
    _reEvalItemContextShow(element, item, expression, itemIndex, enrichedContext) {
        let value;
        try {
            value = this._evalItemContextExpr(element, item, expression, itemIndex, enrichedContext);
        } catch (e) {
            if (__DEV__) console.warn(`[WF] data-show re-eval error:`, e.message);
            return;
        }
        applyShow(element, value);
    },
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

            // Use compiled metadata for class bindings since the source
            // attributes may have been stripped during compile.
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
                        this._reEvalItemContextBind(itemEl, item, expr, index, enrichedContext);
                    }
                }
                for (let i = 0; i < cachedElements.length; i++) {
                    const el = cachedElements[i];
                    if (!el || !el.hasAttribute('data-bind')) continue;
                    if (isInNestedList(el)) continue;
                    const expr = el.dataset.bind;
                    if (this._expressionUsesListContext(expr) && this.isExpression(expr)) {
                        this._reEvalItemContextBind(el, item, expr, index, enrichedContext);
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
                        this._reEvalItemContextBind(el, item, expr, index, enrichedContext);
                    }
                });
            }

            // Re-evaluate data-show/data-render expressions that use list context vars
            if (cachedElements) {
                // FAST PATH: check item element + iterate cached elements
                if (itemEl.hasAttribute('data-show')) {
                    const expr = itemEl.dataset.show;
                    if (this._expressionUsesListContext(expr)) {
                        this._reEvalItemContextShow(itemEl, item, expr, index, enrichedContext);
                    }
                }
                for (let i = 0; i < cachedElements.length; i++) {
                    const el = cachedElements[i];
                    if (!el || !el.hasAttribute('data-show')) continue;
                    if (isInNestedList(el)) continue;
                    const expr = el.dataset.show;
                    if (this._expressionUsesListContext(expr)) {
                        this._reEvalItemContextShow(el, item, expr, index, enrichedContext);
                    }
                }
            } else {
                // FALLBACK: querySelectorAll (data-show only; data-render in lists
                // is re-evaluated by per-item effects)
                const conditionalElements = [
                    ...(this._hasAttr(itemEl, 'show') ? [itemEl] : []),
                    ...itemEl.querySelectorAll(this._attrSelector('show'))
                ];
                conditionalElements.forEach(el => {
                    if (el !== itemEl && isInNestedList(el)) return;
                    const expr = this._getAttr(el, 'show');
                    if (this._expressionUsesListContext(expr)) {
                        this._reEvalItemContextShow(el, item, expr, index, enrichedContext);
                    }
                });
            }

            // Re-evaluate data-render bindings on a bare list-position token
            // (data-render="_last"): the row that becomes (or ceases to be) last
            // after an add/remove must toggle its rendered element. Mirrors the
            // data-show handling above; renders go through the stored render context
            // (insert/remove), not applyShow. (Expression / item-computed renders are
            // covered by the per-item effect and _reEvalListItemComputedConditionals.)
            const renderContexts = itemEl._renderContexts;
            if (renderContexts) {
                for (let r = 0; r < renderContexts.length; r++) {
                    const rc = renderContexts[r];
                    const rpath = rc && rc.binding && rc.binding.path;
                    if (!rpath || !this._listContextVars.has(rpath)) continue;
                    let fv;
                    switch (rpath) {
                        case '_index': fv = index; break;
                        case '_length': fv = listLength; break;
                        case '_first': fv = index === 0; break;
                        case '_last': fv = index === listLength - 1; break;
                    }
                    const shouldRender = rc.binding.negate ? !fv : !!fv;
                    if (rc.context && shouldRender !== rc.context.isRendered) {
                        rc.context._updateConditionalElement(shouldRender);
                    }
                }
            }
        }
    },
    /**
     * Does a compiled show/render binding resolve through an item-level computed?
     * Such a binding can read the position frame (info.first/last/length) inside
     * the computed body, so it must be re-evaluated on a structural change even
     * though its path carries no literal _index/_last token. Used to gate the
     * structural re-eval below.
     * @private
     */
    _conditionalRefsComputed(binding, computed) {
        if (!binding || !computed) return false;
        if (binding.isComputed) return true;
        const path = binding.path;
        if (path && path.indexOf('.') === -1 && computed[path]) return true;
        if (binding.expressionVars) {
            for (let i = 0; i < binding.expressionVars.length; i++) {
                if (computed[binding.expressionVars[i]]) return true;
            }
        }
        return false;
    },
    /**
     * Lazily determine (and cache on the metadata) whether a list template has
     * any data-show / data-render that resolves through an item-level computed.
     * @private
     */
    _listHasComputedConditional(metadata, instance) {
        if (!metadata) return false;
        if (metadata._hasComputedConditional !== undefined) return metadata._hasComputedConditional;
        const computed = instance?.stateManager?.computed;
        let result = false;
        if (computed) {
            const shows = metadata.shows || [];
            const renders = metadata.renders || [];
            for (let i = 0; i < shows.length && !result; i++) result = this._conditionalRefsComputed(shows[i], computed);
            for (let i = 0; i < renders.length && !result; i++) result = this._conditionalRefsComputed(renders[i], computed);
        }
        metadata._hasComputedConditional = result;
        return result;
    },
    /**
     * Re-evaluate list-item data-show / data-render conditionals that resolve
     * through an item-level computed, off the row proxy + the row's CURRENT
     * index and the list length. The literal-token sweep
     * (_updateListContextClassBindings) only catches expressions containing
     * _index/_last/etc.; a computed NAMED e.g. onLast carries no such token, so
     * a structural change (add/remove/reorder) would otherwise leave its
     * info.last/info.length frame stale. Runs after the reconcile completes.
     * @private
     */
    _reEvalListItemComputedConditionals(listElement, data, context, instance) {
        const computed = instance?.stateManager?.computed;
        if (!computed) return;
        const items = this._getListItems(listElement);
        const listLength = data?.length ?? items.length;
        { // full re-eval of every row's computed conditionals
            for (let index = 0; index < items.length; index++) {
                const itemEl = items[index];
                const item = itemEl._itemData || {};
                const meta = itemEl._compiledMetadata;
                const ctx = {
                    componentState: instance?.state || {},
                    componentInstance: instance,
                    itemIndex: index,
                    listLength,
                    listContext: context
                };
                // data-show computeds: resolve and toggle display.
                const shows = meta?.shows;
                if (shows && shows.length) {
                    const elements = itemEl._cachedElementsArray || itemEl._bindingElements;
                    if (elements) {
                        for (let s = 0; s < shows.length; s++) {
                            const show = shows[s];
                            if (!this._conditionalRefsComputed(show, computed)) continue;
                            const el = elements[show.index];
                            if (!el) continue;
                            const raw = this._resolveCompiledBinding(show, item, ctx);
                            applyShow(el, show.negate ? !raw : Boolean(raw));
                        }
                    }
                }
                // data-render computeds: resolve and insert/remove via the render context.
                const renderContexts = itemEl._renderContexts;
                if (renderContexts && renderContexts.length) {
                    for (let r = 0; r < renderContexts.length; r++) {
                        const rc = renderContexts[r];
                        if (!rc || !rc.context || !rc.binding) continue;
                        if (!this._conditionalRefsComputed(rc.binding, computed)) continue;
                        const raw = this._resolveCompiledBinding(rc.binding, item, ctx);
                        const shouldRender = rc.binding.negate ? !raw : Boolean(raw);
                        if (shouldRender !== rc.context.isRendered) {
                            rc.context._updateConditionalElement(shouldRender);
                        }
                    }
                }
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

            // Compile function that takes all variables as arguments.
            // Object-literal auto-wrap is handled centrally in _getCompiledExpression
            // (used via getCSPSafeEvaluatorWithArgs CSP path or new Function path).
            try {
                let fn;
                if (this._useCSPSafeEvaluation) {
                    fn = getCSPSafeEvaluatorWithArgs(
                        expression,
                        uniqueVars,
                        this._astCache,
                        'list-class-binding'
                    );
                    if (!fn) {
                        evaluator = () => '';
                        this._expressionEvaluator.set(cacheKey, evaluator);
                        return;
                    }
                } else if (!_UNSAFE_EXPR_RE.test(expression)) {
                    // Auto-wrap object-literal expressions in parens to defeat JS ASI
                    // ambiguity (`return {x: y}` parses as `return; {x: y}` → undefined).
                    const trimmed = expression.trim();
                    const exprForFn = (trimmed.startsWith('{') && trimmed.endsWith('}'))
                        ? `(${trimmed})`
                        : expression;
                    fn = new Function(...uniqueVars, `"use strict"; return ${exprForFn}`);
                }

                // OPTIMIZATION: Pre-allocate args array to avoid allocation per item
                const argsLength = uniqueVars.length;
                const args = new Array(argsLength);

                // Create evaluator that resolves vars from: listContext, item,
                // item-level computeds (both parameterised and bare-form),
                // then componentState. The wrapped accessor at
                // `itemComputeds[v]` always has fn.length === 0, so we use
                // `_originalComputedFunctions` to detect computed names and
                // route through _evaluateComputedInListContext (which handles
                // both forms with the right `this` binding).
                const self = this;
                evaluator = (item, componentState, listContext, component) => {
                    const itemComputeds = component?.stateManager?.computed;
                    const origs = component?.stateManager?._originalComputedFunctions;
                    for (let i = 0; i < argsLength; i++) {
                        const v = uniqueVars[i];
                        if (v in listContext) args[i] = listContext[v];
                        else if (v in item) args[i] = item[v];
                        else if (itemComputeds && itemComputeds[v] && origs && typeof origs.get(v) === 'function') {
                            try {
                                args[i] = self._evaluateComputedInListContext(component, v, item, listContext._index, listContext);
                            } catch (e) { args[i] = undefined; }
                        }
                        else args[i] = componentState ? componentState[v] : undefined;
                    }
                    return fn(...args);
                };

                this._expressionEvaluator.set(cacheKey, evaluator);
            } catch (e) {
                evaluator = () => '';
                this._expressionEvaluator.set(cacheKey, evaluator);
            }
        }

        // Evaluate with list context
        let result;
        try {
            result = evaluator(item, componentState, listContext, component);
        } catch (e) {
            result = '';
        }

        // Use shared helper to convert string/array/object results to a class string.
        this._toggleBoundClass(element, this._classResultToString(result));
    },

    /**
     * Convert a class-binding expression result to a class string.
     * Supports:
     *   - String: 'foo bar'                  → 'foo bar'
     *   - Array:  ['foo', 'bar']             → 'foo bar' (falsy entries dropped)
     *   - Object: { foo: true, bar: false }  → 'foo'     (truthy keys joined)
     * Without this, `String(obj)` produced literal "[object Object]" as a class.
     * Used by every code path that evaluates a data-bind-class expression result.
     * @private
     */
    _classResultToString(result) {
        if (!result) return '';
        if (typeof result === 'string') return result;
        if (Array.isArray(result)) return result.filter(Boolean).join(' ');
        if (typeof result === 'object') {
            const parts = [];
            for (const key in result) {
                if (result[key]) parts.push(key);
            }
            return parts.join(' ');
        }
        return String(result);
    },

    /**
     * Resolve identifiers referenced in a list-template expression to runtime
     * values. Writes results into the provided `args` array (pre-allocated by
     * caller for hot-path zero-allocation use).
     *
     * Resolution order: item property → item-level computed (called with the
     * current item) → undefined. Item-level computeds are computed methods
     * declared with at least one parameter (`fn.length > 0`); they are NOT
     * included in `componentState` because they require an item argument.
     * Without this resolution, expressions like `{ shared: isShared }` and
     * `isShared ? 'on' : ''` see `isShared` as undefined.
     *
     * Caller is responsible for component-state fallback if needed (this helper
     * intentionally does not touch component state, leaving callers free to
     * compose with their own state-resolution semantics).
     *
     * @param {Array} args  Pre-allocated array to fill (length === vars.length)
     * @param {string[]} vars  Identifier names referenced in the expression
     * @param {Object} item  The current list item (the iteration's data)
     * @param {Object} componentInstance  The component owning the list
     * @private
     */
    _resolveListExprArgs(args, vars, item, componentInstance) {
        const itemComputeds = componentInstance?.stateManager?.computed;
        const originals = componentInstance?.stateManager?._originalComputedFunctions;
        for (let v = 0; v < vars.length; v++) {
            const name = vars[v];
            if (item && name in item) {
                args[v] = item[name];
            } else if (itemComputeds && itemComputeds[name] && originals && typeof originals.get(name) === 'function') {
                // Item-level computed: both parameterised fn(item) and bare-form
                // fn() reading `this.X`. Route through _evaluateComputedInListContext
                // so each form is invoked with the right shape (the wrapped computed
                // accessor at itemComputeds[name] always has fn.length === 0, so we
                // can't distinguish forms via the wrapper).
                try {
                    args[v] = this._evaluateComputedInListContext(componentInstance, name, item, undefined, null);
                } catch (e) {
                    args[v] = undefined;
                }
            } else {
                args[v] = undefined;
            }
        }
    }
};
