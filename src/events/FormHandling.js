/**
 * FormHandling - Form inputs and data-model
 *
 * @module
 */

import { handlingSubmitSet, validationCache } from '../core/DomMetadata.js';
import { pathResolver, WF_ERRORS, wfError } from '../core/wfUtils.js';
import { parseExpression, getCSPSafeEvaluatorWithArgs, extractIdentifiers } from '../core/CSPExpressionEvaluator.js';

// Compiled-evaluator cache for cross-field rule expressions (shared across
// components; keyed by expression + arg names inside the evaluator).
const _ruleAstCache = new Map();
import { reactive as rgReactive, toRaw as rgToRaw } from '../state/reactive-graph/core.js';

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const FormHandlingMethods = {
    /**
     * Apply a direct mutation to a mapArray item property.
     * Handles nested paths (dot notation) via pathResolver.set.
     * @private
     */
    _applyMapArrayMutation(item, propertyPath, value) {
        // The list create path stores RAW items (no per-item proxy at create).
        // This write is the reactivity trigger for data-model in list rows, so
        // it must go through the set trap — and through the TREE proxy when the
        // item lives in an entity-state tree, so the write also fires the
        // entity onStateChange dispatch (hooks/watchers), matching a user's own
        // state[listPath][i].field write. Normalize to raw first: a plain-cache
        // proxy minted before the tree wrap existed would short-circuit
        // wrap-on-demand and silently skip that dispatch.
        item = rgReactive(rgToRaw(item));
        if (propertyPath.includes('.')) {
            pathResolver.set(item, propertyPath, value);
        } else {
            item[propertyPath] = value;
        }
    },

    /**
     * Write a data-model input value back to its source (component state, store,
     * or list-item proxy). Relocated from ListItemBinding so data-model write-back
     * ships in the nano tier; all deps (_getInputValue, _applyMapArrayMutation,
     * pathResolver, _findListItemAncestor) are core/nano-shipped. The list-item
     * branch is runtime-inert without list contexts.
     * @private
     */
    _updateModelValue(context, newValue)
    {
        if (!context || !context.element) {
            return false;
        }

        // Defensive fallback: if no value was passed, read from the element.
        // Callers pass the input value captured at event-dispatch time so a
        // mid-tick list re-render that swaps context.element doesn't cause a
        // stale/empty read here.
        if (newValue === undefined) {
            newValue = this._getInputValue(context.element);
        }
        if (newValue === undefined) return false; // Skip unchecked radio

        // Determine where to update based on context hierarchy
        if (context.parent && context.parent.type === 'list' && context._parentIndex !== undefined)
        {
            // List-item model: write straight through the row's reactive
            // item-proxy (the SAME proxy the render effect tracks), so the set
            // propagates through the graph for top-level, computed-source, and
            // nested lists alike; no immutable copy/replace/writeback or manual
            // binding refresh required. Converges on the mapArray mutation path.
            const rowEl = this._findListItemAncestor(context.element);
            const item = (rowEl && rowEl._itemData) || context._itemData;
            if (item) {
                this._applyMapArrayMutation(item, context.path, newValue);
                return true;
            }
            return false;
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
     * Get value from an input element based on its type
     * Consolidates the common pattern of extracting values from different input types
     * Also applies model modifiers: data-model-trim, data-model-number
     * @param {HTMLElement} element - The input element
     * @param {boolean} skipUncheckedRadio - If true, returns undefined for unchecked radio buttons
     * @returns {*} The element's value (boolean for checkbox, string/number for others, array for multi-select)
     * @private
     */
    _getInputValue(element, skipUncheckedRadio = true, meta = null, modifiers = null) {
        const inputType = meta?.inputType ?? element.type;
        if (inputType === 'checkbox') {
            return element.checked;
        }
        if (inputType === 'radio') {
            if (skipUncheckedRadio && !element.checked) {
                return undefined; // Signal to skip this radio
            }
            return element.value;
        }

        let value = element.value;

        // Apply trim modifier first (if present)
        if (modifiers ? modifiers.trim : element.hasAttribute('data-model-trim')) {
            value = value.trim();
        }

        // Apply number modifier (if present)
        // Follows Vue's .number behavior: parse if valid, else return original
        if (modifiers ? modifiers.number : element.hasAttribute('data-model-number')) {
            if (value === '') return '';  // Preserve empty for validation
            const parsed = parseFloat(value);
            return isNaN(parsed) ? value : parsed;  // Return original if invalid
        }

        // Existing number/range input handling (for type="number" inputs)
        if (inputType === 'number' || inputType === 'range') {
            return value === '' ? '' : Number(value);
        }

        const tagName = meta?.tagName ?? element.tagName;
        if (tagName === 'SELECT' && element.multiple) {
            return Array.from(element.selectedOptions).map(option => option.value);
        }

        return value;
    },

    /**
     * Set value on an input element based on its type
     * Consolidates the common pattern of setting values on different input types
     * @param {HTMLElement} element - The input element
     * @param {*} value - The value to set
     * @private
     */
    _setInputValue(element, value, meta = null) {
        // Web Component adapter: use property assignment
        const tagName = meta?.tagNameLower ?? element.tagName.toLowerCase();
        const adapter = this.getAdapter(tagName, element);
        if (adapter) {
            element[adapter.prop] = value;
            return;
        }

        const inputType = meta?.inputType ?? element.type;
        if (inputType === 'checkbox') {
            element.checked = !!value;
        } else if (inputType === 'radio') {
            element.checked = element.value === String(value);
        } else {
            element.value = value !== undefined && value !== null ? value : '';
        }
    },

/**
     * Resolve a model path to either a store or component state target
     * Detects if the path starts with a registered store name
     * @param {string} modelPath - The model path (e.g., "checkout.firstName" or "form.name")
     * @returns {{ isStore: boolean, target: Object, path: string, storeComponent?: Object }}
     * @private
     */
    _resolveModelTarget(modelPath) {
        if (!modelPath) return null;

        const firstDot = modelPath.indexOf('.');
        if (firstDot > 0) {
            const possibleStoreName = modelPath.slice(0, firstDot);
            // Check if this is a registered store name
            const storeComponent = this.storeManager?.getStoreComponentByName(possibleStoreName);
            if (storeComponent) {
                return {
                    isStore: true,
                    target: storeComponent.state,
                    path: modelPath.slice(firstDot + 1),
                    storeComponent: storeComponent
                };
            }
        }

        // Not a store path - will be resolved against component state
        return {
            isStore: false,
            target: null,  // Will be set by caller to instance.state
            path: modelPath
        };
    },

/**
     * Handle form submission events
     * @param {Event} e - The form submission event
     */
    _handleFormSubmit(e)
    {
        // Check if this form is related to our framework
        const componentElement = this._getComponentElement(e.target);
        if (!componentElement) return;

        if (e.type !== 'submit')
        {
            return;
        }

        const formElement = e.target.closest('form');
        if (!formElement || formElement !== e.target)
        {
            // If the event target isn't the form itself, it might be bubbling from a nested form
            return;
        }

        // Skip forms inside list items - they're handled by delegated submit handler
        // which provides the proper list context (details.index, details.item, etc.)
        // Check by walking up parents for _listIndex property (set during list rendering)
        let el = formElement.parentElement;
        while (el && el !== componentElement)
        {
            if (typeof el._listIndex === 'number')
            {
                // Form is inside a list item - let delegated handler handle it
                return;
            }
            el = el.parentElement;
        }

        // Prevent default submission for all forms in our components
        e.preventDefault();

        // Get the component ID
        const componentId = componentElement.dataset.componentId;
        if (!componentId)
        {
            return;
        }

        // Get the component instance
        const instance = this.componentInstances.get(componentId);
        if (!instance)
        {
            return;
        }

        // Sync all form input values to state before calling the action
        this._syncFormToState(e.target, instance);

        // Check if the form has validation and run it
        if (e.target.hasAttribute('data-validate-on'))
        {
            const triggers = this._getValidationTriggers(e.target);
            if (triggers.has('submit'))
            {
                const isValid = this._validateForm(e.target, instance);
                if (!isValid)
                {
                    // Block the EventSystem's data-action handler from firing
                    e.stopImmediatePropagation();
                    return; // Stop here if validation fails
                }
            }
        }

        // This flag will tell our action binding system to skip this action
        if (!handlingSubmitSet.has(e.target))
        {
            handlingSubmitSet.add(e.target);

            // Clear flag after execution to allow future submissions
            setTimeout(() =>
            {
                handlingSubmitSet.delete(e.target);
            }, 100);
        }

        // Check if the form has a data-action attribute
        const actionAttr = this._getAttr(e.target, 'action') || e.target.dataset.action;
        if (actionAttr)
        {
            // Parse the action to extract method name (handles "submit:methodName" prefix)
            const actions = this._parseActions(actionAttr);
            const methodName = actions[0]?.methodName;

            if (methodName && typeof instance.context[methodName] === 'function')
            {
                try
                {
                    instance.context[methodName](e, e.target);
                } catch (error)
                {
                    this._handleError(`Error executing form action ${methodName}`, error, instance);
                }
            }
        }
    },
    /**
     * Handle input change events for automatic state synchronization
     * @param {Event} e - The input event
     */

    _handleInputChange(e)
    {
        // Only process elements with data-model attribute
        // Guard against non-element targets (text nodes, document, etc.)
        if (!e.target || !e.target.dataset || !(e.target.dataset.model || e.target.dataset.wfModel)) return;

        // Skip all custom elements; they are handled by element-level listeners
        // set up in _bindWebComponentModel (via registered adapter or smart default)
        const tagName = e.target.tagName.toLowerCase();
        if (tagName.includes('-')) {
            return;
        }

        // Checkboxes and radios are driven by 'change' only (matching their
        // model-binding event). A single toggle fires both 'input' and 'change';
        // processing both runs the model update twice, which is benign for a
        // stable list but corrupts a filtered/computed list; the first update
        // mutates the row and the list reconciles, so the duplicate update lands
        // on the now-shifted item. Skip the redundant 'input' pass for these.
        const _inputType = e.target.type;
        if (e.type === 'input' && (_inputType === 'checkbox' || _inputType === 'radio')) {
            return;
        }

        // Resolve the model record for this input (populated at bind time).
        // Non-list data-model bindings carry a slim element-local record (_wfModel);
        // list-item model bindings still resolve through the CM list context. Both
        // expose the same shape (modelModifiers / elementMeta / _isModelBinding /
        // path / componentInstance), so the write-back below is record-agnostic.
        // Falls back to DOM reads for document-level events without a record.
        const _modelRec = e.target._wfModel || null;
        const mods = _modelRec?.modelModifiers;

        // Handle lazy mode: skip 'input' events, only process 'change' and 'blur'
        const isLazy = mods ? mods.lazy : e.target.hasAttribute('data-model-lazy');
        if (isLazy) {
            // Only process change/blur events in lazy mode
            if (e.type === 'input') {
                return;
            }
        } else {
            // For non-lazy mode: blur events are handled by element-level handlers (actions),
            // not by the document-level model update handler
            if (e.type === 'blur') {
                return;
            }
        }

        // Use _getInputValue to correctly handle checkboxes, numbers, etc.
        const currentValue = this._getInputValue(e.target, true, _modelRec?.elementMeta, mods);
        if (currentValue === undefined) return; // Skip unchecked radio buttons

        // Resolve the write-back through the model record (element-local OR CM
        // list context; _updateModelValue accepts either).
        if (_modelRec && _modelRec._isModelBinding)
        {
            this._updateModelValue(_modelRec, currentValue);
            return;
        }


        // LIST ITEM CHECK: Determine if input is in a list item using minimal DOM traversal
        const listItem = __FEATURE_LISTS__ ? this._findListItemAncestor(e.target) : null;

        if (listItem)
        {
            const listElement = this._findDirectParentList(listItem);
            if (listElement)
            {
                const componentElement = this._getComponentElement(listElement);
                if (componentElement)
                {
                    const componentId = componentElement.dataset.componentId;
                    const instance = this.componentInstances.get(componentId);

                    if (instance)
                    {
                        // Get required paths
                        const listPath = listElement.dataset.list;
                        const itemIndex = listItem._listIndex;
                        const propertyPath = e.target.dataset.model || e.target.dataset.wfModel;

                        // Skip direct list update for computed/store-backed lists
                        // (no data in instance.state[listPath])
                        if (listPath.startsWith('computed:') || listPath.startsWith('store:') || !instance.state[listPath])
                        {
                            // Fall through to normal model binding path
                        }
                        // MAPARRAY MODE: Use direct mutation instead of immutable array replacement
                        // When mapArray is active, creating new arrays breaks proxy identity tracking
                        // and causes stale value issues. Instead, directly mutate the item property.
                        else if (listElement._mapArrayInitialized)
                        {
                            // Get value based on input type
                            const value = this._getInputValue(e.target);
                            if (value === undefined) {
                                // Unchecked radio - skip
                                return;
                            }

                            // Direct mutation: update the item property through the reactive proxy
                            // CRITICAL: Use listItem._itemData to get the SAME proxy that the effect is tracking
                            // instance.state[listPath][itemIndex] may return a different proxy or none at all
                            const item = listItem._itemData || instance.state[listPath]?.[itemIndex];
                            if (item) {
                                this._applyMapArrayMutation(item, propertyPath, value);
                            }

                            // Mark event as handled
                            e._handledByDirectUpdate = true;
                            e.preventDefault();
                            return;
                        }
                        else
                        {
                        // CONTEXT MODE: Use immutable array replacement for proper context updates
                        // Start a batch update
                        const batch = this.startBatch();

                        try
                        {
                            // Get value based on input type
                            const value = this._getInputValue(e.target);
                            if (value === undefined) {
                                // Unchecked radio - skip
                                batch.cancel();
                                return;
                            }

                            // Get the current list data - create new array for immutability
                            const listData = [...instance.state[listPath]];

                            // Create a new version of the item with updated property
                            const updatedItem = {
                                ...listData[itemIndex],
                            };

                            // Handle nested properties (like 'address.city')
                            if (propertyPath.includes('.'))
                            {
                                pathResolver.set(updatedItem, propertyPath, value);
                            } else
                            {
                                updatedItem[propertyPath] = value;
                            }

                            // Update the list item
                            listData[itemIndex] = updatedItem;

                            // Update component state
                            instance.state[listPath] = listData;

                            // Also update context if available
                            if (instance._listContexts && instance._listContexts.has(listPath))
                            {
                                const context = instance._listContexts.get(listPath);
                                context.updateData(listData);
                            }

                            batch.apply();

                            // Mark event as handled
                            e._handledByDirectUpdate = true;

                            // Prevent default to avoid double-processing
                            e.preventDefault();
                            return;
                        } catch (error)
                        {
                            if (__DEV__) console.error("Error in direct list item update:", error);
                            batch.cancel();
                        }
                        } // End of else block for context mode direct list update
                    }
                }
            }
        }

        // Find component using minimal DOM traversal
        const componentElement = this._getComponentElement(e.target);
        if (!componentElement) return;

        const componentId = componentElement.dataset.componentId;
        const instance = this.componentInstances.get(componentId);
        if (!instance) return;

        // For regular inputs, proceed with immediate update BUT ONLY if the
        // event wasn't already handled by the direct list-item update path.
        if (!e._handledByDirectUpdate)
        {
            this._syncInputToState(e.target, instance);
        }
    },
    // Form submission handling for list items
    _syncFormToState(formElement, instance)
    {
        if (!formElement || !instance) return;

        // Get all input, select, and textarea elements
        const inputElements = formElement.querySelectorAll('input, select, textarea');

        // Process all inputs and handle list items properly
        inputElements.forEach(input =>
        {
            // Only process elements with data-model attribute
            const modelPath = input.dataset.model;
            if (!modelPath) return;

            // Determine the context of this input using DOM structure
            const listItem = __FEATURE_LISTS__ ? this._findListItemAncestor(input) : null;
            if (listItem)
            {
                // This is an input within a list item
                const listElement = this._findDirectParentList(listItem);
                if (listElement)
                {
                    const listPath = listElement.dataset.list;
                    const itemIndex = listItem._listIndex;

                    // Get value based on input type
                    const value = this._getInputValue(input);
                    if (value === undefined) return; // Skip unchecked radios

                    // List row model write-back: mutate the reactive item proxy
                    // directly (the same proxy the render effect tracks), so the
                    // set propagates through the graph.
                    const item = instance.state[listPath]?.[itemIndex];
                    if (item) {
                        this._applyMapArrayMutation(item, modelPath, value);
                    }
                    return; // Skip standard handling
                }
            }

            // If not in list context, use standard handling
            const value = this._getInputValue(input);
            if (value === undefined) return; // Skip unchecked radios

            // Check if this is a store path (e.g., "checkout.firstName")
            const modelTarget = this._resolveModelTarget(modelPath);
            if (modelTarget && modelTarget.isStore) {
                pathResolver.set(modelTarget.target, modelTarget.path, value);
            } else {
                pathResolver.set(instance.state, modelPath, value);
            }
        });

        return true;
    },
    /**
     * Build the full path for a nested list by traversing up through parent lists
     * For example: teams.1.players when players is nested inside a team
     * Returns normalized dot notation path (not bracket notation) for pathResolver compatibility
     * @param {HTMLElement} listElement - The immediate data-list container
     * @param {HTMLElement} listItem - The list item element
     * @returns {{ fullPath: string, itemIndex: number }} The full path and item index
     * @private
     */
    _buildNestedListPath(listElement, listItem) {
        const listPath = listElement.dataset.list;
        const itemIndex = listItem._listIndex;

        // Check for parent list context
        const parentListElement = listElement.parentElement?.closest('[data-list],[data-wf-list]');
        if (!parentListElement) {
            // Not nested - return simple path
            return { fullPath: listPath, itemIndex };
        }

        // Find the parent list item that contains this nested list
        const parentListItem = this._findListItemAncestor(listElement);
        if (!parentListItem || parentListItem._listIndex === undefined) {
            return { fullPath: listPath, itemIndex };
        }

        // Recursively build the parent path
        const parentResult = this._buildNestedListPath(parentListElement, parentListItem);

        // Combine using dot notation for pathResolver: parentPath.parentIndex.childPath
        const fullPath = `${parentResult.fullPath}.${parentListItem._listIndex}.${listPath}`;

        return { fullPath, itemIndex };
    },

    /**
     * Synchronizes a single input element's value to component state
     * @param {HTMLElement} input - The input element
     * @param {Object} instance - The component instance
     */
    _syncInputToState(input, instance)
    {
        const modelPath = input.dataset.model || input.dataset.wfModel;
        if (!modelPath) return;

        // Get appropriate value based on input type
        const value = this._getInputValue(input);
        if (value === undefined) return; // Skip unchecked radio buttons

        // Check if input is within a list item
        const listItem = __FEATURE_LISTS__ ? this._findListItemAncestor(input) : null;
        if (listItem)
        {
            const listElement = this._findDirectParentList(listItem);
            if (listElement)
            {
                // Build full path for nested lists (e.g., teams.1.players)
                const { fullPath: listPath, itemIndex } = this._buildNestedListPath(listElement, listItem);

                // List row model write-back via direct proxy mutation (the same
                // proxy the render effect tracks; getValue handles nested paths).
                const listData = instance.stateManager?.getValue(listPath);
                if (Array.isArray(listData) && listData[itemIndex]) {
                    this._applyMapArrayMutation(listData[itemIndex], modelPath, value);
                }
                return;
            }
        }

        // Update state with the new value (non-list context)
        // Check if this is a store path (e.g., "checkout.firstName")
        const modelTarget = this._resolveModelTarget(modelPath);
        if (modelTarget && modelTarget.isStore) {
            // Route to store state
            pathResolver.set(modelTarget.target, modelTarget.path, value);
        } else {
            // Route to component state
            pathResolver.set(instance.state, modelPath, value);
        }
    },
    /**
     * Sets a property on an object using a dot-notation path
     * @param {Object} obj - The object to modify
     * @param {string} path - The property path (e.g., 'user.address.city')
     * @param {any} value - The value to set
     * @returns {boolean} - Whether the operation was successful
     */
    // #region FEATURE_VALIDATION
    /**
     * Enhanced form validation support (optional enhancement)
     * This can be added if validation is desired as part of the form handling system
     */
    /**
     * Parse a component's rules: block into evaluable form, once per
     * instance. Rule name is the user-facing message unless message:
     * overrides it. check: and when: accept the same two forms: a string,
     * compiled through the CSP evaluator (every identifier must be a state
     * or computed name; WF-228 refuses unknowns at parse, so a typo cannot
     * silently gate a form), or a function bound to the component. fields:
     * defaults to the state variables a string check reads; a function
     * check with no fields: marks nothing.
     * @returns {Array|null} Parsed rules, or null when none are declared
     * @private
     */
    _parseComponentRules(instance)
    {
        if (instance._parsedRules !== undefined) return instance._parsedRules;
        const def = instance.definition;
        const defRules = def && def.rules;
        if (!defRules || typeof defRules !== 'object') { instance._parsedRules = null; return null; }
        const stateKeys = Object.keys(def.state || {}).filter(k => !k.startsWith('_'));
        const known = new Set([...stateKeys, ...Object.keys(def.computed || {})]);
        const out = [];
        for (const [name, spec] of Object.entries(defRules))
        {
            const isObj = spec && typeof spec === 'object';
            const message = (isObj && spec.message) || name;
            const check = (typeof spec === 'string') ? spec : (isObj ? spec.check : null);
            const refuse = (why) => {
                if (typeof __DEV__ !== 'undefined' && __DEV__) wfError(WF_ERRORS.RULE_CONFIG, { warn: true, context: `rule "${name}" in component "${instance.name}": ${why}` });
            };
            const compile = (expr) => {
                let ast;
                try { ast = parseExpression(expr); } catch (e) { refuse(`parse error (${e.message})`); return null; }
                const ids = [...extractIdentifiers(ast, new Set())];
                const unknown = ids.filter(v => !known.has(v));
                if (unknown.length) { refuse(`unknown variable${unknown.length > 1 ? 's' : ''} "${unknown.join('", "')}"`); return null; }
                const fn = getCSPSafeEvaluatorWithArgs(expr, ids, _ruleAstCache, 'rule');
                if (!fn) { refuse('expression not evaluable'); return null; }
                return { vars: ids, fn };
            };
            let checkC = null, fnCheck = null;
            if (typeof check === 'function') fnCheck = check;
            else if (typeof check === 'string') { checkC = compile(check); if (!checkC) continue; }
            else { refuse('no check expression or function'); continue; }
            // when: accepts the same two forms as check: (string or function),
            // since a gate is a boolean fact about state exactly like a check.
            let whenC = null, fnWhen = null;
            if (isObj && spec.when !== undefined)
            {
                if (typeof spec.when === 'function') fnWhen = spec.when;
                else if (typeof spec.when === 'string') { whenC = compile(spec.when); if (!whenC) continue; }
                else { refuse('when: must be a string or function'); continue; }
            }
            const fields = (isObj && Array.isArray(spec.fields))
                ? spec.fields
                : (checkC ? checkC.vars.filter(v => stateKeys.includes(v)) : []);
            out.push({ name, message, fnCheck, checkC, fnWhen, whenC, fields, evalWarned: false });
        }
        instance._parsedRules = out.length ? out : null;
        return instance._parsedRules;
    },

    /**
     * The return value of a function check: or when: IS the verdict, and
     * three returns are never a real one: a promise (always truthy, so an
     * async function would report success no matter what it resolves to),
     * undefined (always falsy, usually a missing return), and a string
     * (truthy even when it reads like a failure message). Shared by both
     * surfaces since the failure modes are identical regardless of which
     * boolean the function is deciding.
     * @returns {string|null} the bad-verdict reason, or null when valid
     * @private
     */
    _badFnVerdict(verdict)
    {
        return (verdict && typeof verdict.then === 'function') ? 'a promise (async checks are not supported; rules run synchronously)'
            : (verdict === undefined) ? 'undefined (did you forget to return?)'
            : (typeof verdict === 'string') ? `the string ${JSON.stringify(verdict)} (a rule returns true when it HOLDS; put the wording in the rule name or message:)`
            : null;
    },

    /**
     * Evaluate a component's cross-field rules against current state and
     * apply the standard status plumbing: .invalid on the fields' inputs,
     * data-error-for elements (per field and per rule name), entries in
     * validationErrors when a collector is given. A rule whose when: gate
     * is off passes; a throwing function check is skipped for the pass
     * (WF-229, once per rule).
     * @returns {boolean} True when any rule failed
     * @private
     */
    _applyComponentRules(formElement, instance, validationErrors, elementsToUpdate)
    {
        const rules = this._parseComponentRules(instance);
        if (!rules) return false;
        const ctx = instance.context;
        let anyFailed = false;
        for (const rule of rules)
        {
            let inForce = true;
            let holds = true;
            try
            {
                if (rule.fnWhen)
                {
                    const verdict = rule.fnWhen.call(ctx);
                    const badVerdict = this._badFnVerdict(verdict);
                    if (badVerdict)
                    {
                        if (typeof __DEV__ !== 'undefined' && __DEV__ && !rule.verdictWarned)
                        {
                            rule.verdictWarned = true;
                            wfError(WF_ERRORS.RULE_VERDICT_INVALID, { warn: true, context: `rule "${rule.name}" in component "${instance.name}": when: returned ${badVerdict}` });
                        }
                        continue;
                    }
                    inForce = !!verdict;
                }
                else if (rule.whenC) inForce = !!rule.whenC.fn(...rule.whenC.vars.map(v => ctx[v]));
                if (inForce)
                {
                    if (rule.fnCheck)
                    {
                        const verdict = rule.fnCheck.call(ctx);
                        const badVerdict = this._badFnVerdict(verdict);
                        if (badVerdict)
                        {
                            if (typeof __DEV__ !== 'undefined' && __DEV__ && !rule.verdictWarned)
                            {
                                rule.verdictWarned = true;
                                wfError(WF_ERRORS.RULE_VERDICT_INVALID, { warn: true, context: `rule "${rule.name}" in component "${instance.name}" returned ${badVerdict}` });
                            }
                            continue;
                        }
                        holds = !!verdict;
                    } else {
                        holds = !!rule.checkC.fn(...rule.checkC.vars.map(v => ctx[v]));
                    }
                }
            } catch (e)
            {
                if (typeof __DEV__ !== 'undefined' && __DEV__ && !rule.evalWarned)
                {
                    rule.evalWarned = true;
                    wfError(WF_ERRORS.RULE_EVAL_ERROR, { warn: true, context: `rule "${rule.name}" in component "${instance.name}" threw (${e.message}); skipped for this pass` });
                }
                continue;
            }
            const ruleErrorEl = formElement.querySelector(`[data-error-for="${CSS.escape(rule.name)}"]`);
            if (inForce && !holds)
            {
                anyFailed = true;
                if (validationErrors) validationErrors[rule.name] = rule.message;
                if (ruleErrorEl && ruleErrorEl.textContent !== rule.message)
                {
                    ruleErrorEl.textContent = rule.message;
                    ruleErrorEl.style.display = '';
                    if (elementsToUpdate) elementsToUpdate.push(ruleErrorEl);
                }
                for (const field of rule.fields)
                {
                    if (validationErrors) validationErrors[field] = rule.message;
                    const input = formElement.querySelector(`[data-model="${CSS.escape(field)}"], [data-wf-model="${CSS.escape(field)}"]`);
                    if (input && !input.classList.contains('invalid'))
                    {
                        input.classList.add('invalid');
                        if (elementsToUpdate) elementsToUpdate.push(input);
                    }
                    const fieldErrorEl = formElement.querySelector(`[data-error-for="${CSS.escape(field)}"]`);
                    if (fieldErrorEl && fieldErrorEl.textContent !== rule.message)
                    {
                        fieldErrorEl.textContent = rule.message;
                        fieldErrorEl.style.display = '';
                        if (elementsToUpdate) elementsToUpdate.push(fieldErrorEl);
                    }
                }
            } else
            {
                // The per-input pass owns field-level clearing; the rule-name
                // element is this pass's own and clears here.
                if (ruleErrorEl && ruleErrorEl.textContent)
                {
                    ruleErrorEl.textContent = '';
                    ruleErrorEl.style.display = 'none';
                    if (elementsToUpdate) elementsToUpdate.push(ruleErrorEl);
                }
                // A rule that just started passing must also release inputs
                // and field messages the per-input pass did not touch on this
                // run (blur path touches only the blurred input).
                for (const field of rule.fields)
                {
                    const input = formElement.querySelector(`[data-model="${CSS.escape(field)}"], [data-wf-model="${CSS.escape(field)}"]`);
                    if (input && input.classList.contains('invalid') && input.validity && input.validity.valid && !this._validateInput(input))
                    {
                        input.classList.remove('invalid');
                        const fieldErrorEl = formElement.querySelector(`[data-error-for="${CSS.escape(field)}"]`);
                        if (fieldErrorEl && fieldErrorEl.textContent)
                        {
                            fieldErrorEl.textContent = '';
                            fieldErrorEl.style.display = 'none';
                        }
                        if (elementsToUpdate) elementsToUpdate.push(input);
                    }
                }
            }
        }
        return anyFailed;
    },

    _validateForm(formElement, instance)
    {
        if (!formElement || !instance) return true;

        // Check if validation is enabled for this form
        if (!formElement.hasAttribute('data-validate-on')) return true;

        // Track validation errors
        let hasErrors = false;
        const validationErrors = {};

        const elementsToUpdate = [];

        // Process all form inputs with data-model
        const inputElements = formElement.querySelectorAll(this._attrSelector('model'));

        inputElements.forEach(input =>
        {
            const modelPath = this._getAttr(input, 'model');
            const error = this._validateInput(input);

            if (error)
            {
                hasErrors = true;
                validationErrors[modelPath] = error;

                // Add error class to input
                if (!input.classList.contains('invalid'))
                {
                    input.classList.add('invalid');
                    elementsToUpdate.push(input);
                }

                // Update error message element if it exists
                const errorElement = formElement.querySelector(`[data-error-for="${modelPath}"]`);
                if (errorElement)
                {
                    if (errorElement.textContent !== error)
                    {
                        errorElement.textContent = error;
                        errorElement.style.display = '';
                        elementsToUpdate.push(errorElement);
                    }
                }
            } else
            {
                // Remove error class
                if (input.classList.contains('invalid'))
                {
                    input.classList.remove('invalid');
                    elementsToUpdate.push(input);
                }

                // Clear error message
                const errorElement = formElement.querySelector(`[data-error-for="${modelPath}"]`);
                if (errorElement && errorElement.textContent)
                {
                    errorElement.textContent = '';
                    errorElement.style.display = 'none';
                    elementsToUpdate.push(errorElement);
                }
            }
        });

        // Cross-field rules: declared facts about form state, checked on the
        // same pass and folded into the same status plumbing.
        if (this._applyComponentRules(formElement, instance, validationErrors, elementsToUpdate))
        {
            hasErrors = true;
        }

        // Store validation results in component state
        if (instance.state)
        {
            const formValidChanged = instance.state.formValid !== !hasErrors;
            const errorsChanged = JSON.stringify(instance.state.validationErrors || {}) !==
                JSON.stringify(validationErrors);

            if (formValidChanged || errorsChanged)
            {
                instance.state.formValid = !hasErrors;
                instance.state.validationErrors = validationErrors;

                // Schedule a render if state changed (form validity or error messages)
                if (elementsToUpdate.length > 0)
                {
                    this._scheduleRender();
                }
            }
        }

        return !hasErrors;
    },
    /**
     * Validate a single input element
     * @param {HTMLElement} input - The input element to validate
     * @returns {string|null} - Error message or null if valid
     */
    _validateInput(input)
    {
        // Use the browser's native Constraint Validation API
        // This covers required, type (email/url/number), min, max, step,
        // minlength, maxlength, pattern, and any future HTML5 constraints
        if (!input.validity.valid)
        {
            return input.validationMessage || 'This field is invalid';
        }

        // Fallback: minlength check for programmatic values
        // The native API only flags tooShort when the user has typed into the field
        // (the "dirty value flag" spec behavior). Since WF syncs state→DOM
        // programmatically, we check minlength manually as a safety net.
        const minLen = input.getAttribute('minlength');
        if (minLen && input.value && input.value.length < parseInt(minLen, 10))
        {
            return `Please enter at least ${minLen} characters`;
        }

        // Custom validation via data-validate attribute (on top of native)
        let v = validationCache.get(input);
        if (!v) {
            v = {
                customValidate: input.dataset.validate || null,
                customMessage: input.dataset.validateMessage || null
            };
            validationCache.set(input, v);
        }

        if (v.customValidate)
        {
            const value = input.value;

            // Regex pattern: data-validate="/^[A-Z]+$/"
            if (v.customValidate.startsWith('/') &&
                v.customValidate.endsWith('/'))
            {
                const pattern = new RegExp(
                    v.customValidate.substring(1, v.customValidate.length - 1)
                );
                if (!pattern.test(value))
                {
                    return v.customMessage || 'Invalid format';
                }
            }

            // Predefined validation types
            switch (v.customValidate)
            {
                case 'number':
                    if (isNaN(parseFloat(value)))
                    {
                        return 'Please enter a valid number';
                    }
                    break;
                case 'integer':
                    if (!/^-?\d+$/.test(value))
                    {
                        return 'Please enter a valid integer';
                    }
                    break;
            }
        }

        return null; // No validation error
    },
    /**
     * Parse validation triggers from a form element.
     * - `data-validate-on="blur,submit"` → Set{'blur', 'submit'}
     * - `data-validate-on="blur"` → Set{'blur'}
     * - `data-validate-on="submit"` → Set{'submit'}
     * @param {HTMLFormElement} formElement
     * @returns {Set<string>} Set of validation triggers
     * @private
     */
    _getValidationTriggers(formElement) {
        const validateOn = formElement.getAttribute('data-validate-on');
        if (validateOn) {
            return new Set(validateOn.split(',').map(s => s.trim().toLowerCase()));
        }
        return new Set();
    },

    /**
     * Handle blur/change validation for forms with data-validate-on.
     * On focusout: validates only if "blur" is in the trigger list.
     * On change: always validates; selects, checkboxes, and radios are
     * deliberate, complete actions that should clear errors immediately.
     * @param {Event} e - The focusout or change event
     * @private
     */
    _handleValidationBlur(e) {
        const input = e.target;
        if (!input || !input.dataset || !(input.dataset.model || input.dataset.wfModel)) return;

        const form = input.closest('form[data-validate-on]');
        if (!form) return;

        // Change events always validate (selects, checkboxes, radios are complete actions).
        // Focusout events only validate when "blur" is in the trigger list.
        if (e.type !== 'change') {
            const triggers = this._getValidationTriggers(form);
            if (!triggers.has('blur')) return;
        }

        const modelPath = input.dataset.model || input.dataset.wfModel;
        const errorEl = form.querySelector(`[data-error-for="${modelPath}"]`);

        if (errorEl) {
            const error = this._validateInput(input);

            if (error) {
                input.classList.add('invalid');
                errorEl.textContent = error;
                errorEl.style.display = '';
            } else {
                input.classList.remove('invalid');
                errorEl.textContent = '';
                errorEl.style.display = 'none';
            }
        }

        // Cross-field rules: live status on blur/change. data-model has
        // already synced this input to state on the input event, so rules
        // read current values. Visual pass only — formValid and
        // validationErrors are rebuilt by the next full validation.
        const componentElement = this._getComponentElement(form);
        const componentId = componentElement && componentElement.dataset.componentId;
        const instance = componentId ? this.componentInstances.get(componentId) : null;
        if (instance) this._applyComponentRules(form, instance, null, null);
    },

    // #endregion FEATURE_VALIDATION


    /**
     * Bind an input element for two-way data binding
     * @private
     */
    _bindModelElement(element, instance)
    {
        const path = this._getAttr(element, 'model');

        // Verify component boundary
        const componentElement = instance.element;
        const eventSourceComponent = this._getComponentElement(element);

        if (eventSourceComponent !== componentElement)
        {
            return; // Skip binding for elements in nested components
        }

        // Web Component bridge: detect custom elements by hyphen in tag name
        const tagName = element.tagName.toLowerCase();
        const isCustomElement = tagName.includes('-');

        if (isCustomElement) {
            // Deferred binding: if the custom element isn't defined yet, wait for it.
            // After whenDefined, allow a frame for the component's internal rendering
            // (Lit-based components like Web Awesome need this to process property sets).
            if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
                const adapter = this.getAdapter(tagName, element);
                customElements.whenDefined(tagName).then(() => {
                    const ready = adapter?.ready ? adapter.ready(element) : new Promise(r => requestAnimationFrame(r));
                    ready.then(() => {
                        this._bindWebComponentModel(element, instance, path);
                    });
                });
                return;
            }
            this._bindWebComponentModel(element, instance, path);
            return;
        }

        // Standard HTML element binding (unchanged)
        this._bindStandardModel(element, instance, path);
    },

    /**
     * Bind a Web Component element for two-way data binding.
     * Uses the adapter registry and data-model-event for event/property resolution.
     * @private
     */
    _bindWebComponentModel(element, instance, path)
    {
        const tagName = element.tagName.toLowerCase();
        const adapter = this.getAdapter(tagName, element);

        // Property resolution: adapter > default 'value'
        const valueProp = adapter?.prop || 'value';

        // Event resolution: data-model-event > adapter.event > native input+change
        // Smart default (event: null) listens for both input and change,
        // covering text inputs (input event) and selects/booleans (change event).
        const eventOverride = element.getAttribute('data-model-event');
        let events;
        if (eventOverride) {
            events = [eventOverride];
        } else if (adapter?.event) {
            events = [adapter.event];
        } else {
            events = ['input', 'change'];
        }

        const bindingKey = `model-${instance.id}-${path}-${Date.now()}`;

        // Determine expected type from initial state for coercion
        const initialValue = instance.stateManager.getValue(path);
        const expectedType = initialValue === null || initialValue === undefined
            ? null : typeof initialValue;

        const handler = (e) =>
        {
            // Value extraction: for non-value properties (e.g. 'checked'), always
            // read from the element directly; e.detail.value would return the HTML
            // value attribute (e.g. "" or "on") instead of the boolean checked state.
            let value;
            if (valueProp !== 'value') {
                value = element[valueProp];
            } else if (e.detail && e.detail.value !== undefined) {
                value = e.detail.value;
            } else {
                value = element[valueProp];
            }

            // Coerce string to number for numeric state (DOM .value is always string)
            if (expectedType === 'number' && typeof value === 'string' && value !== '') {
                value = Number(value);
            }

            try
            {
                instance.stateManager.setValue(path, value);
            } catch (error)
            {
                this._handleError(`Error updating model at path: ${path}`, error, instance);
            }
        };

        events.forEach(evt => {
            this.eventHandlers.set(`${bindingKey}-${evt}`, handler);
            element.addEventListener(evt, handler);
        });

        // Set initial value from state via property assignment
        const listItemParent = this._findListItemAncestor(element);
        if (listItemParent) {
            return;
        }

        try
        {
            const value = instance.stateManager.getValue(path);
            if (value !== undefined && value !== null) {
                element[valueProp] = value;
            }
        } catch (error)
        {
            this._handleError(`Error setting initial value for model: ${path}`, error, instance);
        }
    },

    /**
     * Bind a standard HTML element for two-way data binding.
     * Extracted from original _bindModelElement for clarity.
     * @private
     */
    _bindStandardModel(element, instance, path)
    {
        // Initial value setting only; event handling is delegated to
        // document-level _handleInputChange (capture phase)

        // Skip for list items; they get values from item data during rendering
        const listItemParent = this._findListItemAncestor(element);
        if (listItemParent) {
            return;
        }

        try
        {
            const value = instance.stateManager.getValue(path);
            this._setInputValue(element, value);
        } catch (error)
        {
            this._handleError(`Error setting initial value for model: ${path}`, error, instance);
        }
    },

    // ========================================================================
    // LIST FORM SUBMISSION DELEGATION
    // (Moved from EventSystem.js: form-specific event handling)
    // ========================================================================

    /**
     * Add submit event delegation for forms inside list items
     * This enables data-action on form elements within list templates to receive details.index
     * @param {HTMLElement} listElement - The list container element
     * @param {Object} instance - The component instance
     * @param {Object} listContext - The list context
     * @param {string} path - The list data path
     * @private
     */
    _addListSubmitDelegation(listElement, instance, listContext, path)
    {
        if (!__FEATURE_LISTS__) return;
        listElement.addEventListener('submit', (event) =>
        {
            // Find if a form with data-action was submitted
            const form = event.target;
            if (form.tagName !== 'FORM') return;

            // Check for data-action attribute on the form
            // Note: attribute may be stripped by innerHTML optimization
            // In that case, fall back to context registry lookup
            let actionAttr = this._getAttr(form, 'action');

            // If no attribute, try the element-local action record (for stripped templates)
            if (!actionAttr && form._actionContext && form._actionContext.path) {
                actionAttr = form._actionContext.path;
            }

            if (!actionAttr) return;

            const closestList = form.closest('[data-list],[data-wf-list]');

            // Only handle submits for THIS list instance
            if (closestList !== listElement) return;

            // Prevent default form submission
            event.preventDefault();

            // Check if the form is inside a nested component
            const closestComponent = form.closest('[data-component-id]');
            let targetInstance = instance;

            if (closestComponent && closestComponent !== instance.element)
            {
                const componentId = closestComponent.dataset.componentId;
                if (componentId)
                {
                    const nestedInstance = this.componentInstances.get(componentId);
                    if (nestedInstance)
                    {
                        targetInstance = nestedInstance;
                    }
                }
            }

            // Sync form data to state before calling action
            this._syncFormToState(form, targetInstance);

            // Parse the action to get method name
            const actions = this._parseActions(actionAttr);
            const methodName = actions[0]?.methodName;

            if (!methodName || typeof targetInstance.context[methodName] !== 'function')
            {
                return;
            }

            // Find the list item and build details
            const listItem = this._findListItemForAction(form, closestList);

            if (listItem && listItem._listIndex !== undefined && listItem._itemData !== undefined)
            {
                // Build the detail off the row's reactive item-proxy + getValue,
                // same as regular list actions (one-graph absorption); falls
                // through to the no-detail fallback when the list does not
                // resolve cleanly.
                const detail = this._buildListActionDetail(listItem, targetInstance);

                if (detail)
                {
                    try
                    {
                        targetInstance.context[methodName](event, form, detail);
                    }
                    catch (error)
                    {
                        this._handleError(
                            `Error in form action handler '${methodName}'`,
                            error,
                            targetInstance,
                            { actionName: methodName, lifecycle: 'action' }
                        );
                    }
                    return;
                }
            }

            // Fallback: call without details if list context not available
            try
            {
                targetInstance.context[methodName](event, form);
            }
            catch (error)
            {
                this._handleError(`Error executing form action ${methodName}`, error, targetInstance);
            }
        });
    }

};
