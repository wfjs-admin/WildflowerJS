/**
 * FormHandling - Form inputs and data-model
 *
 * @module
 */

import { handlingSubmitSet, lazyDebounceWarnedSet, validationCache } from '../core/DomMetadata.js';
import { pathResolver } from '../core/wfUtils.js';

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
        if (propertyPath.includes('.')) {
            pathResolver.set(item, propertyPath, value);
        } else {
            item[propertyPath] = value;
        }
    },

    /**
     * Handle debounced model input - consolidates common debounce pattern
     * @param {HTMLElement} element - The input element with data-model-debounce
     * @param {Function} callback - Function to call after debounce delay
     * @param {string} componentId - Component ID for unique debounce ID
     * @param {string} modelPath - Model path for unique debounce ID
     * @private
     */
    _handleDebouncedModelInput(element, callback, componentId, modelPath) {
        const debounceTime = parseInt(element.dataset.modelDebounce, 10) || 300;

        if (!element._debounceId) {
            element._debounceId = `${componentId}-${modelPath.replace(/\./g, '_')}`;
        }

        if (element._debounceTimeout) {
            clearTimeout(element._debounceTimeout);
        }

        element._debounceTimeout = setTimeout(() => {
            callback();
            element._debounceTimeout = null;
        }, debounceTime);
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

        // Skip all custom elements — they are handled by element-level listeners
        // set up in _bindWebComponentModel (via registered adapter or smart default)
        const tagName = e.target.tagName.toLowerCase();
        if (tagName.includes('-')) {
            return;
        }

        // Try to use cached modelModifiers from context (populated at bind time)
        // Falls back to DOM reads for document-level events without a context
        const _ctxForMods = this._contextSystemInitialized && this._contextRegistry
            ? this._contextRegistry.getContextForElement(e.target) : null;
        const mods = _ctxForMods?.modelModifiers;

        // Handle lazy mode: skip 'input' events, only process 'change' and 'blur'
        const isLazy = mods ? mods.lazy : e.target.hasAttribute('data-model-lazy');
        if (isLazy) {
            // Lazy mode takes precedence over debounce - warn if both used
            const hasDebounce = mods ? !!mods.debounce : e.target.hasAttribute('data-model-debounce');
            if (hasDebounce && !lazyDebounceWarnedSet.has(e.target)) {
                if (__DEV__) console.warn('[WildflowerJS] data-model-lazy and data-model-debounce are mutually exclusive. Using lazy.');
                lazyDebounceWarnedSet.add(e.target);
            }
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
        const currentValue = this._getInputValue(e.target, true, _ctxForMods?.elementMeta, mods);
        if (currentValue === undefined) return; // Skip unchecked radio buttons

        // CONTEXT-BASED APPROACH: First try to resolve through context system
        if (this._contextSystemInitialized && this._contextRegistry)
        {
            // Reuse context already looked up above
            const bindingContext = _ctxForMods;

            if (bindingContext && bindingContext._isModelBinding)
            {
                // Handle debouncing if configured (skip for lazy mode - lazy takes precedence)
                const hasDebounce = mods ? !!mods.debounce : e.target.hasAttribute('data-model-debounce');
                if (!isLazy && hasDebounce)
                {
                    // Build unique debounce path including list context if applicable
                    // This ensures each list item has its own independent debounce timer
                    let debouncePath = bindingContext.path;
                    if (bindingContext.parent && bindingContext.parent.type === 'list') {
                        // Include parent list path and item index for uniqueness
                        const parentPath = bindingContext.parent.path || 'list';
                        const parentIndex = bindingContext._parentIndex ?? 0;
                        debouncePath = `${parentPath}.${parentIndex}.${bindingContext.path}`;
                    }

                    this._handleDebouncedModelInput(
                        e.target,
                        () => {
                            this._updateModelValue(bindingContext, currentValue);
                            e._handledByDebounce = true;
                        },
                        bindingContext.componentInstance.id,
                        debouncePath
                    );

                    // Mark event as handled to prevent double-processing
                    e._handledByDebounce = true;
                    e.preventDefault();
                    return;
                }

                // For non-debounced inputs, update immediately
                this._updateModelValue(bindingContext, currentValue);
                return;
            }
        }


        // LIST ITEM CHECK: Determine if input is in a list item using minimal DOM traversal
        const listItem = this._findListItemAncestor(e.target);

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

                        // Skip direct list update for:
                        // - computed/store-backed lists (no data in instance.state[listPath])
                        // - debounced inputs (let them use the debounce handler instead)
                        if (listPath.startsWith('computed:') || listPath.startsWith('store:') || !instance.state[listPath] || e.target.hasAttribute('data-model-debounce'))
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

        // Check if this is a debounced input
        if (e.target.hasAttribute('data-model-debounce') || e.target.hasAttribute('data-wf-model-debounce'))
        {
            const modelPath = e.target.dataset.model || e.target.dataset.wfModel;
            const currentValue = this._getInputValue(e.target);
            const modelTarget = this._resolveModelTarget(modelPath);

            // Check if input is in a list item for list-aware debouncing
            const listItem = this._findListItemAncestor(e.target);
            let listElement = null;
            let listPath = null;
            let itemIndex = null;

            if (listItem) {
                listElement = this._findDirectParentList(listItem);
                if (listElement) {
                    // Build full path for nested lists
                    const pathResult = this._buildNestedListPath(listElement, listItem);
                    listPath = pathResult.fullPath;
                    itemIndex = pathResult.itemIndex;
                }
            }

            // Capture mapArray flag for use in callback
            const isMapArrayMode = listElement?._mapArrayInitialized && instance.state[listPath.split('.')[0]];

            this._handleDebouncedModelInput(
                e.target,
                () => {
                    // Check if this is a list item update
                    if (listPath !== null && itemIndex !== null) {
                        // MAPARRAY MODE: Use direct mutation instead of batched update
                        if (isMapArrayMode) {
                            const listData = instance.stateManager?.getValue(listPath);
                            if (Array.isArray(listData) && listData[itemIndex]) {
                                this._applyMapArrayMutation(listData[itemIndex], modelPath, currentValue);
                                return;
                            }
                        }
                        // Use list-aware update
                        this._updateListItemProperty(e.target, instance, listPath, itemIndex, modelPath, currentValue);
                    } else if (modelTarget && modelTarget.isStore) {
                        // Store update
                        pathResolver.set(modelTarget.target, modelTarget.path, currentValue);
                    } else {
                        // Direct state update
                        instance.stateManager.setValue(modelPath, currentValue);
                    }
                },
                componentId,
                // Use unique ID including list path and index for list items
                listPath !== null ? `${listPath}.${itemIndex}.${modelPath}` : modelPath
            );

            // CRITICAL: Mark the event as handled to prevent other
            // handlers from processing it
            e._handledByDebounce = true;

            // Prevent default
            e.preventDefault();

            // Return immediately to skip regular processing
            return;
        }

        // For regular inputs (not debounced), proceed with immediate update
        // BUT ONLY if the event wasn't already handled by debounce or direct update
        if (!e._handledByDebounce && !e._handledByDirectUpdate)
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
            const listItem = this._findListItemAncestor(input);
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

                    // MAPARRAY MODE: Use direct mutation instead of batched update
                    if (listElement._mapArrayInitialized && instance.state[listPath]) {
                        const item = instance.state[listPath][itemIndex];
                        if (item) {
                            this._applyMapArrayMutation(item, modelPath, value);
                        }
                        return;
                    }

                    // Use our context-aware method for updating
                    this._updateListItemProperty(input, instance, listPath, itemIndex, modelPath, value);
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
        if (input.hasAttribute('data-model-debounce') || input.hasAttribute('data-wf-model-debounce'))
        {
            return;
        }
        const modelPath = input.dataset.model || input.dataset.wfModel;
        if (!modelPath) return;

        // Get appropriate value based on input type
        const value = this._getInputValue(input);
        if (value === undefined) return; // Skip unchecked radio buttons

        // Check if input is within a list item
        const listItem = this._findListItemAncestor(input);
        if (listItem)
        {
            const listElement = this._findDirectParentList(listItem);
            if (listElement)
            {
                // Build full path for nested lists (e.g., teams.1.players)
                const { fullPath: listPath, itemIndex } = this._buildNestedListPath(listElement, listItem);

                // MAPARRAY MODE: Use direct mutation instead of batched update
                if (listElement._mapArrayInitialized) {
                    const listData = instance.stateManager?.getValue(listPath);
                    if (Array.isArray(listData) && listData[itemIndex]) {
                        this._applyMapArrayMutation(listData[itemIndex], modelPath, value);
                        return;
                    }
                }

                this._updateListItemProperty(input, instance, listPath, itemIndex, modelPath, value);
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
        // minlength, maxlength, pattern — and any future HTML5 constraints
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
     * On change: always validates — selects, checkboxes, and radios are
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
        if (!errorEl) return;

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
            // read from the element directly — e.detail.value would return the HTML
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
        // Initial value setting only — event handling is delegated to
        // document-level _handleInputChange (capture phase)

        // Skip for list items — they get values from item data during rendering
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
    // (Moved from EventSystem.js — form-specific event handling)
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
        listElement.addEventListener('submit', (event) =>
        {
            // Find if a form with data-action was submitted
            const form = event.target;
            if (form.tagName !== 'FORM') return;

            // Check for data-action attribute on the form
            // Note: attribute may be stripped by innerHTML optimization
            // In that case, fall back to context registry lookup
            let actionAttr = this._getAttr(form, 'action');

            // If no attribute, try context registry (for stripped templates)
            if (!actionAttr && this._contextRegistry) {
                const actionContext = this._contextRegistry.getContextForElement(form, 'action');
                if (actionContext && actionContext.path) {
                    actionAttr = actionContext.path;
                }
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

            if (listItem && closestList._listContext)
            {
                const currentListContext = closestList._listContext;
                const itemIndex = listItem._listIndex;

                if (typeof itemIndex === 'number')
                {
                    const listData = currentListContext.resolveData();

                    if (Array.isArray(listData) && itemIndex >= 0 && itemIndex < listData.length)
                    {
                        const detail = {
                            index: itemIndex,
                            item: listData[itemIndex],
                            list: listData,
                            length: listData.length,
                            first: itemIndex === 0,
                            last: itemIndex === listData.length - 1,
                            context: currentListContext
                        };

                        // Build parent context chain for nested lists
                        this._buildParentListChain(detail, currentListContext);

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
