/**
 * TemplateSystem - Template discovery, compilation, pooling
 *
 * @module
 */

// Import CSP-safe evaluation functions
import { getCSPSafeMergedContextEvaluator, getCSPSafeEvaluatorWithArgs } from '../core/CSPExpressionEvaluator.js';
import { _UNSAFE_EXPR_RE } from '../core/ExpressionEvaluator.js';
import { slotDataCache } from '../core/DomMetadata.js';

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const TemplateSystemMethods = {
/**
     * Find template element in a container (HTML5 template only)
     * @private
     */
    _findTemplate(container, instance = null) {
        // Check for data-use-template first (Configurable Component Templates)
        const useTemplate = container.querySelector(this._attrSelector('use-template'));
        if (useTemplate && instance) {
            // Check WeakMap cache first - avoids repeated hierarchy traversal
            if (this._resolvedTemplateCache.has(container)) {
                const cached = this._resolvedTemplateCache.get(container);
                container._usedTemplateName = cached.templateName;
                return cached.template.cloneNode(true);
            }

            const rawTemplateName = this._getAttr(useTemplate, 'use-template');

            // Parse @componentName syntax for explicit ancestor targeting
            let templateName = rawTemplateName;
            let targetComponentName = null;
            const atIndex = rawTemplateName.indexOf('@');
            if (atIndex !== -1) {
                templateName = rawTemplateName.substring(0, atIndex);
                targetComponentName = rawTemplateName.substring(atIndex + 1);
            }

            // Try to find template in component hierarchy
            const parentTemplate = this._findItemTemplateInHierarchy(instance, templateName, targetComponentName);
            if (parentTemplate) {
                // Store template name for SSR marker emission (use raw name to preserve @target)
                container._usedTemplateName = rawTemplateName;
                // Cache the resolved template - WeakMap auto-cleans when container is GC'd
                this._resolvedTemplateCache.set(container, {
                    template: parentTemplate,
                    templateName: rawTemplateName
                });
                return parentTemplate.cloneNode(true);
            }

            // Fallback 1: inline content inside data-use-template
            if (useTemplate.content && useTemplate.content.childElementCount > 0) {
                // Fallback used - store with :fallback suffix for SSR
                const fallbackName = `${templateName}:fallback`;
                container._usedTemplateName = fallbackName;
                const fallbackContent = useTemplate.content.cloneNode(true);
                // Cache the fallback template
                this._resolvedTemplateCache.set(container, {
                    template: useTemplate.content,
                    templateName: fallbackName
                });
                return fallbackContent;
            }
            if (useTemplate.children && useTemplate.children.length > 0) {
                const fallbackName = `${templateName}:fallback`;
                container._usedTemplateName = fallbackName;
                const extracted = this._extractTemplateContent(useTemplate);
                // Cache extracted template
                this._resolvedTemplateCache.set(container, {
                    template: extracted,
                    templateName: fallbackName
                });
                return extracted.cloneNode(true);
            }

            // Fallback 2: sibling data-template-fallback element
            const fallbackTemplate = container.querySelector(
                this._attrSelector('template-fallback', templateName)
            );
            if (fallbackTemplate) {
                const fallbackName = `${templateName}:fallback`;
                container._usedTemplateName = fallbackName;
                const content = fallbackTemplate.content
                    ? fallbackTemplate.content
                    : this._extractTemplateContent(fallbackTemplate);
                // Cache the fallback
                this._resolvedTemplateCache.set(container, {
                    template: content,
                    templateName: fallbackName
                });
                return content.cloneNode(true);
            }

            // No template found - warn and return null
            if (__DEV__) console.warn(`Configurable template '${templateName}' not found and no fallback provided`);
            return null;
        }

        // Standard template discovery (existing behavior)
        return container.querySelector('template');
    },
    /**
     * Extract usable content from a template
     * @private
     */
    _extractTemplateContent(template) {
        const content = template.content ? template.content.cloneNode(true) : template.cloneNode(true);
        // PERF: Strip whitespace-only text nodes to reduce DOM size
        // For 10k rows, this eliminates ~100k+ whitespace nodes and speeds up reflow
        this._stripWhitespaceNodes(content);
        return content;
    },

    /**
     * Remove whitespace-only text nodes from a DOM tree
     * This reduces DOM node count significantly for list rendering
     * @param {Node} node - Root node to process
     * @private
     */
    _stripWhitespaceNodes(node) {
        const walker = document.createTreeWalker(
            node,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        const toRemove = [];
        let textNode;
        while ((textNode = walker.nextNode())) {
            // Only remove text nodes that are pure whitespace
            if (textNode.nodeValue && /^\s+$/.test(textNode.nodeValue)) {
                toRemove.push(textNode);
            }
        }
        for (let i = 0; i < toRemove.length; i++) {
            toRemove[i].remove();
        }
    },
    // #region FEATURE_CONFIGURABLE_TEMPLATES
    /**
     * Register item templates defined in a component with data-item-template attribute.
     * These templates can be used by child components via data-use-template.
     * @param {Object} instance - Component instance
     * @param {Element} element - Component's root element
     * @private
     */
    _registerItemTemplates(instance, element) {
        if (!instance._itemTemplates) {
            instance._itemTemplates = new Map();
        }

        const templates = element.querySelectorAll(this._attrSelector('item-template'));

        templates.forEach(template => {
            // Skip templates inside nested components
            const closestComponent = template.closest(this._attrSelector('component'));
            if (closestComponent !== element) return;

            const name = this._getAttr(template, 'item-template');
            if (name) {
                // Warn on duplicate names at same level
                if (instance._itemTemplates.has(name)) {
                    if (__DEV__) console.warn(`Duplicate item-template name '${name}' in component - first one used`);
                    return;
                }
                // Store the ORIGINAL template element reference (never mutate this!)
                // We'll clone from this when needed
                instance._itemTemplates.set(name, template);
            }
        });
    },
    /**
     * Find an item template by name, traversing up the component hierarchy.
     * Returns a cloned DocumentFragment ready for use.
     * @param {Object} instance - Component instance to start search from
     * @param {string} templateName - Name of the template to find
     * @param {string|null} targetComponentName - If provided, only look in this specific named component
     * @returns {DocumentFragment|null} Cloned template content or null
     * @private
     */
    _findItemTemplateInHierarchy(instance, templateName, targetComponentName = null) {
        let current = instance;
        let foundTarget = false;

        // Traverse up component hierarchy (closest ancestor wins, unless explicit target specified)
        while (current) {
            // If explicit target specified, only check that component
            if (targetComponentName) {
                if (current.name === targetComponentName) {
                    foundTarget = true;
                    if (current._itemTemplates && current._itemTemplates.has(templateName)) {
                        const originalTemplate = current._itemTemplates.get(templateName);
                        if (originalTemplate.content) {
                            const cloned = originalTemplate.content.cloneNode(true);
                            // Diagnostic: warn if template content is empty
                            if (cloned.childElementCount === 0) {
                                if (__DEV__) console.warn(`[WF] Configurable template '${templateName}' has empty content (no element children). Check if template was properly parsed.`);
                            }
                            return cloned;
                        }
                        return originalTemplate.cloneNode(true);
                    }
                    // Target found but template not present
                    if (__DEV__) console.warn(`Configurable template '${templateName}' not found in target component '${targetComponentName}'`);
                    return null;
                }
            } else {
                // No explicit target - use closest ancestor that has the template
                if (current._itemTemplates && current._itemTemplates.has(templateName)) {
                    const originalTemplate = current._itemTemplates.get(templateName);
                    // ALWAYS clone - never return the original!
                    // HTML5 <template> has .content, older browsers don't
                    if (originalTemplate.content) {
                        const cloned = originalTemplate.content.cloneNode(true);
                        // Diagnostic: warn if template content is empty
                        if (cloned.childElementCount === 0) {
                            if (__DEV__) console.warn(`[WF] Configurable template '${templateName}' has empty content (no element children). Check if template was properly parsed.`);
                        }
                        return cloned;
                    }
                    return originalTemplate.cloneNode(true);
                }
            }

            // Move to parent component
            const parentId = this.componentParents.get(current.id);
            current = parentId ? this.componentInstances.get(parentId) : null;
        }

        // If explicit target was specified but not found in hierarchy
        if (targetComponentName && !foundTarget) {
            if (__DEV__) console.warn(`Target component '${targetComponentName}' not found in component hierarchy`);
        }

        return null;
    },
    /**
     * Re-scan a component element for item templates after async content load.
     * Use this when templates are added dynamically after component initialization.
     * @param {Element|string} elementOrId - Component element or component ID
     * @returns {string[]} Array of newly registered template names
     */
    rescanItemTemplates(elementOrId) {
        let instance = null;
        let element = null;

        if (typeof elementOrId === 'string') {
            instance = this.componentInstances.get(elementOrId);
            element = instance?.element;
        } else if (elementOrId instanceof Element) {
            element = elementOrId;
            const componentId = element.dataset.componentId || element.dataset.wfComponentId;
            instance = componentId ? this.componentInstances.get(componentId) : null;
        }

        if (!instance || !element) {
            if (__DEV__) console.warn('rescanItemTemplates: Component instance not found');
            return [];
        }

        // Get existing template names before rescan
        const existingNames = instance._itemTemplates ? new Set(instance._itemTemplates.keys()) : new Set();

        // Clear the existing templates map to allow re-registration
        // This enables both adding NEW templates AND detecting REMOVED templates
        if (instance._itemTemplates) {
            instance._itemTemplates.clear();
        }

        // Re-register templates from current DOM state
        this._registerItemTemplates(instance, element);

        // Invalidate ALL template caches for lists within this component that use configurable templates.
        // This includes:
        // 1. _resolvedTemplateCache (WeakMap) - per-container resolved template cache
        // 2. _templateCache.lists (Map) - compiled template cache keyed by componentName:listPath
        // 3. _templateCache.compiled (Map) - compiled binding metadata
        // NOTE: We must also search descendant components since templates can be referenced
        // from child components via @syntax or ancestor traversal.
        const listsWithConfigurableTemplates = element.querySelectorAll('[data-list]');
        for (const listContainer of listsWithConfigurableTemplates) {
            // Check if this list uses configurable templates
            // Method 1: Template element still exists in DOM
            const useTemplateEl = listContainer.querySelector(':scope > template[data-use-template]');

            // Method 2: Template was consumed (mapArray mode) but rendered items have the marker
            // Check for data-wf-used-template on any child element (indicates configurable template usage)
            const renderedWithTemplate = !useTemplateEl &&
                listContainer.querySelector(':scope > [data-wf-used-template]');

            const usesConfigurableTemplates = useTemplateEl || renderedWithTemplate;

            if (usesConfigurableTemplates) {
                // Clear WeakMap cache
                if (this._resolvedTemplateCache.has(listContainer)) {
                    this._resolvedTemplateCache.delete(listContainer);
                }

                // Clear _templateCache.lists and .compiled
                // Find the component that owns this list to determine the cache key
                const listComponentEl = listContainer.closest('[data-component]');
                const listComponentId = listComponentEl?.dataset.componentId;
                const listComponentInstance = listComponentId ? this.componentInstances.get(listComponentId) : null;
                const listPath = this._getAttr(listContainer, 'list');

                if (listComponentInstance && listPath) {
                    const cacheKey = `${listComponentInstance.name}:${listPath}`;
                    this._templateCache.lists.delete(cacheKey);
                    this._templateCache.compiled.delete(cacheKey);
                    this._templateCache.extracted.delete(cacheKey);
                }

                // Mark this list to force full re-render on next state update
                // This bypasses element reuse optimization so new template is applied
                listContainer._forceTemplateRerender = true;
            }
        }

        // Find newly added template names (compared to original set)
        const newNames = [];
        if (instance._itemTemplates) {
            for (const name of instance._itemTemplates.keys()) {
                if (!existingNames.has(name)) {
                    newNames.push(name);
                    // Dispatch event for each new template
                    element.dispatchEvent(new CustomEvent('itemTemplateReady', {
                        bubbles: true,
                        detail: { templateName: name, component: instance }
                    }));
                }
            }
        }

        return newNames;
    },
    // #endregion FEATURE_CONFIGURABLE_TEMPLATES

    // #region FEATURE_SLOT_TEMPLATES
    /**
     * Process slot templates (data-use-template with data-with) outside of lists.
     * These act like Vue's scoped slots - injecting parent-defined templates with child data.
     * @param {Object} instance - Component instance
     * @private
     */
    _processSlotTemplates(instance) {
        const element = instance.element;

        // Find all data-use-template elements with data-with attribute
        // Support both standard and wf-prefixed attributes
        const slotTemplates = element.querySelectorAll(
            `${this._attrSelector('use-template')}[data-with], ${this._attrSelector('use-template')}[data-wf-with]`
        );

        if (slotTemplates.length === 0) return;

        // Initialize slot contexts map for this instance
        if (!instance._slotContexts) {
            instance._slotContexts = new Map();
            instance._slotCounter = 0;
        }

        for (const templateEl of slotTemplates) {
            // Skip if inside a data-list (lists handle their own template binding)
            const parentList = templateEl.closest(this._attrSelector('list'));
            if (parentList && element.contains(parentList)) {
                const withValue = templateEl.dataset.with || templateEl.dataset.wfWith;
                if (__DEV__) console.warn(
                    `[WildflowerJS] data-with="${withValue}" is ignored inside data-list. ` +
                    `List templates automatically bind to each item.`
                );
                continue;
            }

            // Skip if inside a different component (belongs to child component)
            const closestComponent = templateEl.closest(this._attrSelector('component'));
            if (closestComponent !== element) continue;

            // Skip if inside a data-render block with false condition
            // These will be processed when the data-render becomes true
            if (this._isInsideFalseDataRender && this._isInsideFalseDataRender(templateEl)) {
                continue;
            }

            this._initializeSlotTemplate(instance, templateEl);
        }
    },

    /**
     * Initialize a single slot template with data-with binding
     * @param {Object} instance - Component instance
     * @param {Element} templateEl - The template element with data-use-template and data-with
     * @private
     */
    _initializeSlotTemplate(instance, templateEl) {
        const templateName = this._getAttr(templateEl, 'use-template');
        // Get data-with attribute (supporting both data-with and data-wf-with)
        const dataWithPath = templateEl.dataset.with || templateEl.dataset.wfWith;

        if (!templateName || !dataWithPath) return;

        // Parse @componentName syntax for explicit ancestor targeting
        let actualTemplateName = templateName;
        let targetComponentName = null;
        const atIndex = templateName.indexOf('@');
        if (atIndex !== -1) {
            actualTemplateName = templateName.substring(0, atIndex);
            targetComponentName = templateName.substring(atIndex + 1);
        }

        // Create a placeholder comment to mark the slot position
        const placeholder = document.createComment(`slot:${templateName}:${dataWithPath}`);
        templateEl.parentNode.insertBefore(placeholder, templateEl);

        // Store inline fallback content before removing the template element
        let inlineFallback = null;
        if (templateEl.content && templateEl.content.childElementCount > 0) {
            inlineFallback = templateEl.content.cloneNode(true);
        } else if (templateEl.children && templateEl.children.length > 0) {
            inlineFallback = this._extractTemplateContent(templateEl);
        }

        // Remove the original template element (it's just a declaration)
        templateEl.remove();

        // Create slot context object to track this slot
        const slotContext = {
            templateName: actualTemplateName,
            targetComponentName,
            dataWithPath,
            placeholder,
            inlineFallback,
            renderedElement: null,
            bindings: []
        };

        // Store slot context by a unique key (counter ensures uniqueness for same template/data at different DOM positions)
        const slotKey = `${templateName}:${dataWithPath}:${instance._slotCounter++}`;
        instance._slotContexts.set(slotKey, slotContext);

        // Initial render
        this._updateSlotTemplate(instance, slotContext);

        // Set up reactivity by subscribing to the data-with path
        const unsubscribe = instance.context.subscribe(dataWithPath, () => {
            this._updateSlotTemplate(instance, slotContext);
        });

        // Store unsubscribe for cleanup
        if (!instance._slotCleanups) {
            instance._slotCleanups = [];
        }
        instance._slotCleanups.push(unsubscribe);
    },

    /**
     * Update a slot template based on current data-with value
     * @param {Object} instance - Component instance
     * @param {Object} slotContext - Slot context object
     * @private
     */
    _updateSlotTemplate(instance, slotContext) {
        const { templateName, targetComponentName, dataWithPath, placeholder } = slotContext;

        // Get the data value from the path
        const dataValue = instance.stateManager.getValue(dataWithPath);

        // If falsy (null, undefined, false, 0, ''), remove any rendered content
        if (!dataValue) {
            if (slotContext.renderedElement || slotContext.renderedElements) {
                // Clean up bindings before removing
                this._cleanupSlotBindings(slotContext);
                // Handle multiple rendered elements
                if (slotContext.renderedElements) {
                    for (const el of slotContext.renderedElements) {
                        if (el && el.parentNode) el.remove();
                    }
                    slotContext.renderedElements = null;
                }
                if (slotContext.renderedElement) {
                    if (slotContext.renderedElement.parentNode) {
                        slotContext.renderedElement.remove();
                    }
                    slotContext.renderedElement = null;
                }
            }
            return;
        }

        // Find the template in component hierarchy
        let templateContent = this._findItemTemplateInHierarchy(
            instance,
            templateName,
            targetComponentName
        );

        // Check for inline fallback if template not found in hierarchy
        if (!templateContent && slotContext.inlineFallback) {
            templateContent = slotContext.inlineFallback;
        }

        if (!templateContent) {
            if (__DEV__) console.warn(`[WildflowerJS] Template '${templateName}' not found and no fallback provided`);
            return;
        }

        // If already rendered, update bindings instead of re-rendering
        if (slotContext.renderedElement || slotContext.renderedElements) {
            this._updateSlotBindings(instance, slotContext, dataValue);
            return;
        }

        // Clone and render the template
        const fragment = templateContent.cloneNode(true);

        // Handle templates with multiple root elements
        const rootElements = Array.from(fragment.children);
        if (rootElements.length === 0 && fragment.firstElementChild) {
            rootElements.push(fragment.firstElementChild);
        }

        // Mark all root elements as rendered by data-use-template
        // This prevents the normal binding system from processing them
        for (const el of rootElements) {
            el._isTemplateRendered = true;
            el.setAttribute('data-use-template-rendered', '');
        }

        // Insert after placeholder
        placeholder.parentNode.insertBefore(fragment, placeholder.nextSibling);

        // Store reference to rendered elements (first one for simple cases, all for updates)
        slotContext.renderedElement = rootElements[0];
        slotContext.renderedElements = rootElements;

        // Set up bindings for all rendered content
        for (const rootElement of rootElements) {
            this._setupSlotBindings(instance, slotContext, dataValue, rootElement);
        }
    },

    /**
     * Set up bindings for slot template content
     * @param {Object} instance - Component instance owning the slot
     * @param {Object} slotContext - Slot context object
     * @param {Object} dataValue - The data object to bind to
     * @param {Element} rootElement - Optional root element to process (for multi-root templates)
     * @private
     */
    _setupSlotBindings(instance, slotContext, dataValue, rootElement = null) {
        const element = rootElement || slotContext.renderedElement;
        if (!element) return;

        // Store data on element for action context
        slotDataCache.set(element, { data: dataValue, path: slotContext.dataWithPath });
        element._slotContext = slotContext;

        // Process all binding types within the slot content
        this._processSlotDataBindings(instance, element, dataValue, slotContext);
        this._processSlotActions(instance, element, dataValue, slotContext);
        this._processSlotModels(instance, element, dataValue, slotContext);
        this._processSlotConditionals(instance, element, dataValue, slotContext);
        this._processSlotClassBindings(instance, element, dataValue, slotContext);
    },

    /**
     * Process data-bind elements within a slot
     * @private
     */
    _processSlotDataBindings(instance, rootElement, dataValue, slotContext) {
        // Find all data-bind elements (including root if it has binding)
        const bindElements = this._collectSlotElements(rootElement, 'bind');

        for (const el of bindElements) {
            const bindPath = this._getAttr(el, 'bind');
            if (!bindPath) continue;

            // Resolve value from the data object
            const value = this._resolveSlotValue(bindPath, dataValue, instance);

            // Update element content
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
                el.value = value ?? '';
            } else {
                el.textContent = value ?? '';
            }

            // Track binding for updates
            slotContext.bindings.push({
                type: 'bind',
                element: el,
                path: bindPath
            });
        }
    },

    /**
     * Process data-action elements within a slot
     * Actions bind to the component where the template is USED (instance), not where defined
     * @private
     */
    _processSlotActions(instance, rootElement, dataValue, slotContext) {
        const actionElements = this._collectSlotElements(rootElement, 'action');

        for (const el of actionElements) {
            const actionName = this._getAttr(el, 'action');
            if (!actionName) continue;

            // Check if action exists on the using component
            const actionMethod = instance.context[actionName];
            if (typeof actionMethod !== 'function') {
                if (__DEV__) console.warn(`[WildflowerJS] Action '${actionName}' not found on component '${instance.name}'`);
                continue;
            }

            // Determine event type
            const eventType = this._getActionEventType(el);

            // Create action handler with slot context
            const handler = (event) => {
                // Provide details similar to list item actions
                const details = {
                    item: dataValue,
                    path: slotContext.dataWithPath,
                    slotContext: true
                };

                actionMethod.call(instance.context, event, el, details);
            };

            // Add event listener
            el.addEventListener(eventType, handler);

            // Track for cleanup
            slotContext.bindings.push({
                type: 'action',
                element: el,
                eventType,
                handler
            });
        }
    },

    /**
     * Process data-model elements within a slot
     * @private
     */
    _processSlotModels(instance, rootElement, dataValue, slotContext) {
        const modelElements = this._collectSlotElements(rootElement, 'model');

        for (const el of modelElements) {
            const modelPath = this._getAttr(el, 'model');
            if (!modelPath) continue;

            // Get initial value
            const value = this._resolveSlotValue(modelPath, dataValue, instance);

            // Set input value
            if (el.type === 'checkbox') {
                el.checked = !!value;
            } else if (el.type === 'radio') {
                el.checked = el.value === String(value);
            } else {
                el.value = value ?? '';
            }

            // Create two-way binding handler
            const handler = (event) => {
                let newValue;
                if (el.type === 'checkbox') {
                    newValue = el.checked;
                } else if (el.type === 'number' || el.type === 'range') {
                    newValue = el.valueAsNumber;
                } else {
                    newValue = el.value;
                }

                // Update the nested property in the data object
                this._setSlotValue(modelPath, newValue, dataValue, instance, slotContext);
            };

            // Determine event type for model binding
            const eventType = el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'input';
            el.addEventListener(eventType, handler);

            // Track for cleanup and updates
            slotContext.bindings.push({
                type: 'model',
                element: el,
                path: modelPath,
                eventType,
                handler
            });
        }
    },

    /**
     * Process data-show elements within a slot
     * @private
     */
    _processSlotConditionals(instance, rootElement, dataValue, slotContext) {
        const showElements = this._collectSlotElements(rootElement, 'show');

        for (const el of showElements) {
            const showPath = this._getAttr(el, 'show');
            if (!showPath) continue;

            // Handle negation
            const negate = showPath.startsWith('!');
            const actualPath = negate ? showPath.slice(1) : showPath;

            // Resolve value
            const value = this._resolveSlotValue(actualPath, dataValue, instance);
            const shouldShow = negate ? !value : !!value;

            // Apply visibility
            el.style.display = shouldShow ? '' : 'none';

            // Track for updates
            slotContext.bindings.push({
                type: 'show',
                element: el,
                path: actualPath,
                negate
            });
        }
    },

    /**
     * Process data-bind-class elements within a slot
     * @private
     */
    _processSlotClassBindings(instance, rootElement, dataValue, slotContext) {
        const classElements = this._collectSlotElements(rootElement, 'bind-class');

        for (const el of classElements) {
            const classExpr = this._getAttr(el, 'bind-class');
            if (!classExpr) continue;

            // Evaluate class expression
            const classValue = this._evaluateSlotExpression(classExpr, dataValue, instance);

            // Apply class (handle string result from ternary expressions)
            if (typeof classValue === 'string' && classValue) {
                el.classList.add(...classValue.split(' ').filter(c => c));
            } else if (classValue === true) {
                // For simple boolean bindings
                el.classList.add(classExpr);
            }

            // Track for updates
            slotContext.bindings.push({
                type: 'bind-class',
                element: el,
                expression: classExpr,
                appliedClasses: typeof classValue === 'string' ? classValue : ''
            });
        }
    },

    /**
     * Collect elements with a specific data attribute within a slot
     * Includes the root element if it has the attribute
     * @private
     */
    _collectSlotElements(rootElement, attrType) {
        const elements = [];

        // Check root element
        if (this._hasAttr(rootElement, attrType)) {
            elements.push(rootElement);
        }

        // Find all descendants
        const selector = this._attrSelector(attrType);
        elements.push(...rootElement.querySelectorAll(selector));

        return elements;
    },

    /**
     * Resolve a value from the slot data object or component state
     * @private
     */
    _resolveSlotValue(path, dataValue, instance) {
        // Handle computed properties
        if (path.startsWith('computed:')) {
            const computedName = path.slice(9);
            return instance.stateManager.evaluateComputed(computedName);
        }

        // Handle nested paths in data object
        const parts = path.split('.');
        let value = dataValue;

        for (const part of parts) {
            if (value == null) return undefined;
            value = value[part];
        }

        return value;
    },

    /**
     * Set a value in the slot data object
     * Uses the component's reactive proxy to trigger updates
     * @private
     */
    _setSlotValue(path, newValue, dataValue, instance, slotContext) {
        const parts = path.split('.');

        if (parts.length === 1) {
            // Simple property - update directly on data object
            // This triggers reactivity through the proxy
            dataValue[path] = newValue;
        } else {
            // Nested path - traverse to parent and set
            let target = dataValue;
            for (let i = 0; i < parts.length - 1; i++) {
                if (target == null) return;
                target = target[parts[i]];
            }
            if (target != null) {
                target[parts[parts.length - 1]] = newValue;
            }
        }

        // Reactivity is triggered automatically through the proxy
        // The dataValue object is part of the reactive state
    },

    /**
     * Evaluate an expression in slot context
     * @private
     */
    _evaluateSlotExpression(expr, dataValue, instance) {
        try {
            // Simple ternary expression evaluation
            if (expr.includes('?')) {
                const varNames = this._extractExpressionVars(expr);

                // Build context object with data values
                const context = {};
                for (const varName of varNames) {
                    context[varName] = dataValue[varName];
                }

                // Evaluate expression - use CSP-safe path if enabled
                const contextKeys = Object.keys(context);
                const contextValues = Object.values(context);

                if (this._useCSPSafeEvaluation) {
                    const fn = getCSPSafeEvaluatorWithArgs(
                        expr,
                        contextKeys,
                        this._astCache,
                        'slot'
                    );
                    return fn ? fn(...contextValues) : '';
                } else {
                    if (_UNSAFE_EXPR_RE.test(expr)) return '';
                    const fn = new Function(...contextKeys, `"use strict"; return ${expr};`);
                    return fn(...contextValues);
                }
            }

            // Simple property access
            return dataValue[expr];
        } catch (e) {
            if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn(`[WildflowerJS] Error evaluating slot expression '${expr}':`, e);
            return '';
        }
    },

    /**
     * Update bindings when slot data changes
     * @private
     */
    _updateSlotBindings(instance, slotContext, dataValue) {
        // Update data reference on all rendered elements
        if (slotContext.renderedElements) {
            for (const el of slotContext.renderedElements) {
                const existing = slotDataCache.get(el);
                if (existing) { existing.data = dataValue; } else { slotDataCache.set(el, { data: dataValue, path: null }); }
            }
        } else if (slotContext.renderedElement) {
            const existing = slotDataCache.get(slotContext.renderedElement);
            if (existing) { existing.data = dataValue; } else { slotDataCache.set(slotContext.renderedElement, { data: dataValue, path: null }); }
        }

        for (const binding of slotContext.bindings) {
            switch (binding.type) {
                case 'bind': {
                    const value = this._resolveSlotValue(binding.path, dataValue, instance);
                    if (binding.element.tagName === 'INPUT' ||
                        binding.element.tagName === 'TEXTAREA' ||
                        binding.element.tagName === 'SELECT') {
                        binding.element.value = value ?? '';
                    } else {
                        binding.element.textContent = value ?? '';
                    }
                    break;
                }

                case 'model': {
                    const value = this._resolveSlotValue(binding.path, dataValue, instance);
                    if (binding.element.type === 'checkbox') {
                        binding.element.checked = !!value;
                    } else if (binding.element.type === 'radio') {
                        binding.element.checked = binding.element.value === String(value);
                    } else {
                        binding.element.value = value ?? '';
                    }
                    break;
                }

                case 'show': {
                    const value = this._resolveSlotValue(binding.path, dataValue, instance);
                    const shouldShow = binding.negate ? !value : !!value;
                    binding.element.style.display = shouldShow ? '' : 'none';
                    break;
                }

                case 'bind-class': {
                    // Remove previously applied classes
                    if (binding.appliedClasses) {
                        binding.element.classList.remove(
                            ...binding.appliedClasses.split(' ').filter(c => c)
                        );
                    }

                    // Evaluate and apply new classes
                    const classValue = this._evaluateSlotExpression(
                        binding.expression, dataValue, instance
                    );

                    if (typeof classValue === 'string' && classValue) {
                        binding.element.classList.add(...classValue.split(' ').filter(c => c));
                        binding.appliedClasses = classValue;
                    } else {
                        binding.appliedClasses = '';
                    }
                    break;
                }

                // Actions don't need updating - they reference the data object directly
            }
        }
    },

    /**
     * Clean up slot bindings before removing rendered content
     * @private
     */
    _cleanupSlotBindings(slotContext) {
        for (const binding of slotContext.bindings) {
            if (binding.type === 'action' || binding.type === 'model') {
                binding.element.removeEventListener(binding.eventType, binding.handler);
            }
        }
        slotContext.bindings = [];
    },

    /**
     * Get the event type for an action element
     * @private
     */
    _getActionEventType(element) {
        const tagName = element.tagName;
        const type = element.type;

        if (tagName === 'FORM') return 'submit';
        if (tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) return 'change';
        if (tagName === 'SELECT') return 'change';
        return 'click';
    },

    /**
     * Clean up all slot templates for a component
     * Called during component destruction
     * @param {Object} instance - Component instance
     * @private
     */
    _cleanupSlotTemplates(instance) {
        // Clean up subscriptions
        if (instance._slotCleanups) {
            for (const unsubscribe of instance._slotCleanups) {
                if (typeof unsubscribe === 'function') {
                    unsubscribe();
                }
            }
            instance._slotCleanups = [];
        }

        // Clean up slot contexts
        if (instance._slotContexts) {
            for (const slotContext of instance._slotContexts.values()) {
                this._cleanupSlotBindings(slotContext);
                // Handle multiple rendered elements
                if (slotContext.renderedElements) {
                    for (const el of slotContext.renderedElements) {
                        if (el && el.parentNode) el.remove();
                    }
                } else if (slotContext.renderedElement) {
                    slotContext.renderedElement.remove();
                }
                if (slotContext.placeholder && slotContext.placeholder.parentNode) {
                    slotContext.placeholder.remove();
                }
            }
            instance._slotContexts.clear();
        }
    },
    // #endregion FEATURE_SLOT_TEMPLATES

    /**
     * Compile template at initialization to extract binding metadata
     * This eliminates repeated querySelectorAll calls during rendering (30-70ms savings per 1000 items)
     * @param {Element|DocumentFragment} template - Template element or content
     * @param {string} listPath - Path to the list in state
     * @param {Object} options - Optional flags
     * @param {boolean} options.isConfigurableTemplate - If true, disables innerHTML optimization (configurable templates need DOM preservation)
     * @private
     */
    _compileTemplate(template, listPath, options = {}) {
        // Extract template content
        const templateContent = this._extractTemplateContent(template);

        // Get the root element to query
        let queryRoot;
        if (templateContent.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            queryRoot = templateContent.firstElementChild;
        } else {
            queryRoot = templateContent;
        }

        if (!queryRoot) {
            return null; // No element to compile
        }

        // Query ONCE for all binding elements (children only, not root)
        // Build selector respecting useWfPrefixOnly mode
        const allBindingSelector = [
            this._attrSelector('bind'),
            this._attrSelector('bind-html'),
            this._attrSelector('model'),
            this._attrSelector('show'),
            this._attrSelector('render'),
            this._attrSelector('action'),
            this._attrSelector('bind-class'),
            this._attrSelector('bind-style'),
            this._attrSelector('bind-attr')
        ].join(',');
        const childElementsRaw = queryRoot.querySelectorAll(allBindingSelector);

        // CRITICAL FIX: Filter out elements that are inside nested [data-list] or [data-component] boundaries
        // This prevents parent list bindings from affecting:
        // - nested list items (e.g., project.name being bound to task name elements)
        // - nested component internals (component owns its own bindings)

        // Check if queryRoot itself is a component - if so, ALL children belong to the component
        const queryRootIsComponent = this._hasAttr(queryRoot, 'component');

        const childElements = Array.from(childElementsRaw).filter(el => {
            // If queryRoot itself is a component, exclude ALL child elements
            // (they belong to the component, not the list - list only processes root attributes)
            if (queryRootIsComponent) {
                return false;  // All children belong to the component
            }

            // Walk up from element's parent looking for boundaries within queryRoot
            let parent = el.parentElement;
            while (parent && parent !== queryRoot && queryRoot.contains(parent)) {
                // Always exclude elements inside nested lists
                if (this._hasAttr(parent, 'list')) {
                    return false;
                }
                // Smart boundary detection for nested components
                if (this._hasAttr(parent, 'component')) {
                    // Get the binding property from this element
                    const bindProp = this._getAttr(el, 'bind') || this._getAttr(el, 'bind-html');
                    if (bindProp) {
                        // Check if it's a simple property (not an expression)
                        const isSimpleProp = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(bindProp);
                        if (isSimpleProp) {
                            // Look up component definition to check if it owns this property
                            const componentName = this._getAttr(parent, 'component');
                            const componentDef = this.componentDefinitions?.get(componentName);
                            if (componentDef) {
                                const defState = componentDef.state || {};
                                // If component's state definition has this property, exclude (component owns it)
                                if (bindProp in defState) {
                                    return false;
                                }
                                // Component doesn't have this property - include for list binding
                                return true;
                            }
                            // No component definition found - include for list binding
                            return true;
                        }
                    }
                    // Expression or non-data-bind elements - exclude (component boundary)
                    return false;
                }
                parent = parent.parentElement;
            }
            return true;  // Not inside a nested boundary - include it
        });

        // Check if root element itself has bindings (support both prefixes)
        const rootHasBind = this._hasAttr(queryRoot, 'bind');
        const rootHasBindHtml = this._hasAttr(queryRoot, 'bind-html');
        const rootHasModel = this._hasAttr(queryRoot, 'model');
        const rootHasShow = this._hasAttr(queryRoot, 'show');
        const rootHasRender = this._hasAttr(queryRoot, 'render');
        const rootHasAction = this._hasAttr(queryRoot, 'action');
        const rootHasBindClass = this._hasAttr(queryRoot, 'bind-class');
        const rootHasBindStyle = this._hasAttr(queryRoot, 'bind-style');
        const rootHasBindAttr = this._hasAttr(queryRoot, 'bind-attr');
        const rootHasAnyBinding = rootHasBind || rootHasBindHtml || rootHasModel || rootHasShow || rootHasRender || rootHasAction || rootHasBindClass || rootHasBindStyle || rootHasBindAttr;

        // CRITICAL: Include root element in allElements if it has bindings
        // querySelectorAll only finds descendants, not the element itself
        let allElements;
        if (rootHasAnyBinding) {
            allElements = [queryRoot, ...Array.from(childElements)];
        } else {
            allElements = Array.from(childElements);
        }


        // Check for nested lists - respects useWfPrefixOnly mode
        const hasNestedLists = queryRoot.querySelector(this._attrSelector('list')) !== null;

        // Check for nested components - used to determine if _initializeNestedComponentsInItem needs to run
        // CRITICAL: Also check if queryRoot itself is a component (querySelector only searches descendants)
        const hasNestedComponents =
            this._hasAttr(queryRoot, 'component') ||
            queryRoot.querySelector(this._attrSelector('component')) !== null;

        // Check for portals - used to skip portal processing if template has none
        const hasPortals = queryRoot.querySelector('[data-portal]') !== null;

        // Check for custom elements (web components) - disables innerHTML fast path
        // Custom elements need property assignment (el.value = x), not innerHTML text content
        const hasCustomElements = allElements.some(el => el.tagName.includes('-'));

        // Build metadata structure
        const metadata = {
            listPath,
            bindings: [],      // { index, path, isInput, isLengthProperty }
            htmlBindings: [],  // { index, path } - data-bind-html elements
            models: [],        // { index, path, type }
            shows: [],         // { index, path, negate, isComputed }
            renders: [],       // { index, path, negate } - data-render elements (add/remove from DOM)
            actions: [],       // { index, actionName }
            classBindings: [], // { index, expression }
            styleBindings: [], // { index, expression } - data-bind-style elements
            attrBindings: [],  // { index, expression } - data-bind-attr elements
            elementPaths: [],  // PERF: Pre-computed paths for all elements (index → path)
            elementCount: allElements.length,
            hasNestedLists,
            hasNestedComponents,
            hasPortals,
            hasCustomElements,
            // Root element bindings (stored separately since not in children array)
            rootBindings: {
                hasBind: rootHasBind,
                hasBindHtml: rootHasBindHtml,
                hasModel: rootHasModel,
                hasShow: rootHasShow,
                hasRender: rootHasRender,
                hasBindClass: rootHasBindClass,
                hasBindStyle: rootHasBindStyle,
                hasBindAttr: rootHasBindAttr,
                bindPath: rootHasBind ? this._getAttr(queryRoot, 'bind') : null,
                bindHtmlPath: rootHasBindHtml ? this._getAttr(queryRoot, 'bind-html') : null,
                modelPath: rootHasModel ? this._getAttr(queryRoot, 'model') : null,
                showPath: rootHasShow ? this._getAttr(queryRoot, 'show') : null,
                renderPath: rootHasRender ? this._getAttr(queryRoot, 'render') : null,
                bindClassExpr: rootHasBindClass ? this._getAttr(queryRoot, 'bind-class') : null,
                bindStyleExpr: rootHasBindStyle ? this._getAttr(queryRoot, 'bind-style') : null,
                bindAttrExpr: rootHasBindAttr ? this._getAttr(queryRoot, 'bind-attr') : null
            }
        };

        // Process each binding element and extract metadata
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];

            // Compute path from root to this element (for direct access later)
            const elementPath = this._getElementPath(el, queryRoot);

            // PERF: Store path in indexed array for fast element resolution
            // This enables single-loop element building in _buildElementsArrayFromMetadata
            metadata.elementPaths[i] = elementPath;

            // Extract data-bind metadata (support both prefixes)
            let bindPath = this._getAttr(el, 'bind');
            if (bindPath) {
                // Normalize $store.path shorthand to external() calls at compile time
                if (bindPath.includes('$') && this._normalizeStoreShorthands) {
                    bindPath = this._normalizeStoreShorthands(bindPath);
                }

                const tagName = el.tagName;
                const isInput = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';

                // PERF: Pre-compute binding type at compile time (not per-item)
                const isExpression = this.isExpression(bindPath);
                const isListContextVar = this._listContextVars.has(bindPath);
                const isPropsPath = bindPath.startsWith('props:');
                const isComputed = bindPath.startsWith('computed:');

                const binding = {
                    index: i,
                    path: bindPath,
                    isInput,
                    isLengthProperty: bindPath.endsWith('.length'),
                    elementPath,
                    // Pre-computed binding type flags
                    isExpression,
                    isListContextVar,
                    listContextVarType: isListContextVar ? bindPath : null,
                    isPropsPath,
                    propName: isPropsPath ? bindPath.slice(6) : null,
                    isComputed,
                    computedName: isComputed ? bindPath.slice(9) : null,
                    // PERF: Mark simple property paths for fast inline access in _executeBindings
                    isSimplePath: !isExpression && !isListContextVar && !isPropsPath && !isComputed && !bindPath.endsWith('.length') && !bindPath.includes('.')
                };

                // PERF: For expressions, pre-extract variables and pre-compile
                if (isExpression) {
                    binding.expressionVars = this._extractExpressionVars(bindPath);
                    binding.compiledFn = this._getCompiledExpression(bindPath, binding.expressionVars, 'listBinding');
                }

                metadata.bindings.push(binding);
            }

            // Extract data-bind-html metadata (support both prefixes)
            let bindHtmlPath = this._getAttr(el, 'bind-html');
            if (bindHtmlPath) {
                // Normalize $store.path shorthand to external() calls at compile time
                if (bindHtmlPath.includes('$') && this._normalizeStoreShorthands) {
                    bindHtmlPath = this._normalizeStoreShorthands(bindHtmlPath);
                }

                const isComputed = bindHtmlPath.startsWith('computed:');
                const isExpression = this.isExpression(bindHtmlPath);

                const htmlBinding = {
                    index: i,
                    path: bindHtmlPath,
                    elementPath,
                    isComputed,
                    computedName: isComputed ? bindHtmlPath.slice(9) : null,
                    isExpression
                };

                // PERF: For expressions, pre-extract variables and pre-compile
                if (isExpression) {
                    htmlBinding.expressionVars = this._extractExpressionVars(bindHtmlPath);
                    htmlBinding.compiledFn = this._getCompiledExpression(bindHtmlPath, htmlBinding.expressionVars, 'listHtmlBinding');
                }

                metadata.htmlBindings.push(htmlBinding);
            }

            // Extract data-model metadata (support both prefixes)
            const modelPath = this._getAttr(el, 'model');
            if (modelPath) {
                metadata.models.push({
                    index: i,
                    path: modelPath,
                    type: el.type || null,
                    tagName: el.tagName,
                    elementPath
                });
            }

            // Extract data-show metadata (support both prefixes)
            let showPath = this._getAttr(el, 'show');
            if (showPath) {
                const negate = showPath.startsWith('!');
                let actualPath = negate ? showPath.slice(1) : showPath;

                // Normalize $store.path shorthand to external() calls at compile time
                if (actualPath.includes('$') && this._normalizeStoreShorthands) {
                    actualPath = this._normalizeStoreShorthands(actualPath);
                }

                const isComputed = actualPath.includes('computed:');
                const isExpression = this.isExpression(actualPath);

                const showBinding = {
                    index: i,
                    path: actualPath,
                    negate,
                    isComputed,
                    computedName: isComputed ? actualPath.slice(9) : null,
                    elementPath,
                    isExpression
                };

                // PERF: For expressions, pre-extract variables and pre-compile
                if (isExpression) {
                    showBinding.expressionVars = this._extractExpressionVars(actualPath);
                    showBinding.compiledFn = this._getCompiledExpression(actualPath, showBinding.expressionVars, 'listShowBinding');
                }

                metadata.shows.push(showBinding);
            }

            // Extract data-render metadata (support both prefixes)
            // Enhanced to match show binding structure for _resolveCompiledBinding compatibility
            const renderPath = this._getAttr(el, 'render');
            if (renderPath) {
                const negate = renderPath.startsWith('!');
                const actualRenderPath = negate ? renderPath.slice(1) : renderPath;
                const isRenderComputed = actualRenderPath.includes('computed:');
                const isRenderExpression = this.isExpression(actualRenderPath);

                const renderBinding = {
                    index: i,
                    path: actualRenderPath,
                    negate,
                    isComputed: isRenderComputed,
                    computedName: isRenderComputed ? actualRenderPath.slice(9) : null,
                    elementPath,
                    isExpression: isRenderExpression
                };

                if (isRenderExpression) {
                    renderBinding.expressionVars = this._extractExpressionVars(actualRenderPath);
                    renderBinding.compiledFn = this._getCompiledExpression(actualRenderPath, renderBinding.expressionVars, 'listRenderBinding');
                }

                metadata.renders.push(renderBinding);
            }

            // Extract data-action metadata (support both prefixes)
            const actionName = this._getAttr(el, 'action');
            if (actionName) {
                // PERF: Pre-compute nested boundary flags at compile time
                // This eliminates costly .closest() DOM traversal during context creation
                let isInNestedList = false;
                let isInNestedComponent = false;

                // Walk up from element's parent looking for boundaries within queryRoot
                let parent = el.parentElement;
                while (parent && parent !== queryRoot && queryRoot.contains(parent)) {
                    if (!isInNestedList && this._hasAttr(parent, 'list')) {
                        isInNestedList = true;
                    }
                    if (!isInNestedComponent && this._hasAttr(parent, 'component')) {
                        isInNestedComponent = true;
                    }
                    // Early exit if both flags are set
                    if (isInNestedList && isInNestedComponent) break;
                    parent = parent.parentElement;
                }

                metadata.actions.push({
                    index: i,
                    actionName: actionName,
                    elementPath,
                    isInNestedList,
                    isInNestedComponent
                });
            }

            // Extract data-bind-class metadata (support both prefixes)
            let bindClassExpr = this._getAttr(el, 'bind-class');
            if (bindClassExpr) {
                // Normalize $store.path shorthand to external() calls at compile time
                if (bindClassExpr.includes('$') && this._normalizeStoreShorthands) {
                    bindClassExpr = this._normalizeStoreShorthands(bindClassExpr);
                }

                // PERF: Pre-compute class binding type at compile time
                const isComputed = bindClassExpr.startsWith('computed:');
                const isSimpleProperty = !isComputed && !bindClassExpr.includes(' ') && !bindClassExpr.includes('?');

                const classBinding = {
                    index: i,
                    expression: bindClassExpr,
                    elementPath,
                    // Pre-computed flags
                    isSimpleProperty,
                    isComputed,
                    computedName: isComputed ? bindClassExpr.slice(9) : null
                };

                // PERF: For non-simple, non-computed expressions, pre-extract variables and compile
                if (!isSimpleProperty && !isComputed) {
                    const uniqueVars = this._extractExpressionVars(bindClassExpr);
                    classBinding.expressionVars = uniqueVars;
                    classBinding.usesListContext = uniqueVars.some(v => this._listContextVars.has(v));
                    classBinding.needsComponentState = uniqueVars.some(v => !this._listContextVars.has(v));
                    // Pre-compile if it's a pure item expression (no component state needed, no list context)
                    if (!classBinding.usesListContext && classBinding.needsComponentState === false) {
                        classBinding.compiledFn = this._getCompiledExpression(bindClassExpr, uniqueVars, 'classBinding');
                    }
                }

                metadata.classBindings.push(classBinding);
            }

            // Extract data-bind-style metadata (support both prefixes)
            let bindStyleExpr = this._getAttr(el, 'bind-style');
            if (bindStyleExpr) {
                // Normalize $store.path shorthand to external() calls at compile time
                if (bindStyleExpr.includes('$') && this._normalizeStoreShorthands) {
                    bindStyleExpr = this._normalizeStoreShorthands(bindStyleExpr);
                }

                // PERF: Pre-compute style binding type at compile time
                const isComputed = bindStyleExpr.startsWith('computed:');

                const styleBinding = {
                    index: i,
                    expression: bindStyleExpr,
                    elementPath,
                    isComputed,
                    computedName: isComputed ? bindStyleExpr.slice(9) : null
                };

                // Pre-extract variables for non-computed expressions and pre-compile
                if (!isComputed) {
                    const uniqueVars = this._extractExpressionVars(bindStyleExpr);
                    styleBinding.expressionVars = uniqueVars;
                    styleBinding.usesListContext = uniqueVars.some(v => this._listContextVars.has(v));
                    // Pre-compile if no list context variables (those need special handling at runtime)
                    if (uniqueVars.length > 0 && !styleBinding.usesListContext) {
                        styleBinding.compiledFn = this._getCompiledExpression(bindStyleExpr, uniqueVars, 'styleBinding');
                    }
                }

                metadata.styleBindings.push(styleBinding);
            }

            // Extract data-bind-attr metadata (support both prefixes)
            let bindAttrExpr = this._getAttr(el, 'bind-attr');
            if (bindAttrExpr) {
                // Normalize $store.path shorthand to external() calls at compile time
                if (bindAttrExpr.includes('$') && this._normalizeStoreShorthands) {
                    bindAttrExpr = this._normalizeStoreShorthands(bindAttrExpr);
                }

                // PERF: Pre-compute attr binding type at compile time
                const isComputed = bindAttrExpr.startsWith('computed:');

                const attrBinding = {
                    index: i,
                    expression: bindAttrExpr,
                    elementPath,
                    isComputed,
                    computedName: isComputed ? bindAttrExpr.slice(9) : null
                };

                // Pre-extract variables for non-computed expressions and pre-compile
                if (!isComputed) {
                    const uniqueVars = this._extractExpressionVars(bindAttrExpr);
                    attrBinding.expressionVars = uniqueVars;
                    attrBinding.usesListContext = uniqueVars.some(v => this._listContextVars.has(v));
                    // Pre-compile if no list context variables (those need special handling at runtime)
                    if (uniqueVars.length > 0 && !attrBinding.usesListContext) {
                        attrBinding.compiledFn = this._getCompiledExpression(bindAttrExpr, uniqueVars, 'attrBinding');
                    }
                }

                metadata.attrBindings.push(attrBinding);
            }
        }

        // PERF: Check if any expressions use list context variables
        // This allows us to skip expensive re-evaluation for lists that don't use them
        const listContextVars = ['_index', '_length', '_first', '_last'];
        const usesListContextVariables =
            metadata.classBindings.some(b => listContextVars.some(v => b.expression.includes(v))) ||
            metadata.styleBindings.some(b => listContextVars.some(v => b.expression.includes(v))) ||
            metadata.attrBindings.some(b => listContextVars.some(v => b.expression.includes(v))) ||
            metadata.bindings.some(b => listContextVars.some(v => b.path.includes(v))) ||
            metadata.shows.some(b => listContextVars.some(v => b.path.includes(v))) ||
            metadata.renders.some(b => listContextVars.some(v => b.path.includes(v)));

        metadata.usesListContextVariables = usesListContextVariables;

        // =======================================================================
        // TWO-PASS innerHTML OPTIMIZATION
        // =======================================================================
        // Check if template qualifies for fast innerHTML initial render:
        // - No model bindings (form inputs require event listeners)
        // - No nested lists (complex structure)
        // - No portals (require special handling)
        // - No nested components (lifecycle hooks won't fire)
        // - No data-show/data-render (conditional DOM manipulation)
        // - No style bindings (object evaluation complexity)
        // - No html bindings (security concerns with innerHTML)
        // - No expression bindings that use list context vars in text bindings
        // - No props: bindings (require component lookup)
        // - No computed: bindings (require component method calls)
        //
        // Qualifying templates get:
        // 1. Pre-tokenized HTML template with placeholders for text bindings
        // 2. Array of accessor functions for value extraction
        // 3. Pre-compiled class evaluator functions
        // =======================================================================

        // CRITICAL: If custom directives are registered, they require lifecycle hooks
        // (init/update/destroy) that the innerHTML path doesn't call
        const hasCustomDirectives = this._customDirectives && this._customDirectives.size > 0;

        // Check for computed class bindings (computed:propName requires component method calls)
        const hasComputedClassBindings = metadata.classBindings.some(cb => cb.isComputed);

        // Check for external() class bindings (require cross-component lookup)
        // Also detect $store.path shorthand which normalizes to external() at runtime
        const hasExternalRef = (expr) => expr?.includes('external(') || /\$[a-zA-Z]/.test(expr);
        const hasExternalClassBindings = metadata.classBindings.some(cb => hasExternalRef(cb.expression));
        const hasRootExternalClassBinding = hasExternalRef(metadata.rootBindings?.bindClassExpr);

        const canUseInnerHTML =
            !hasCustomDirectives &&  // Custom directives need lifecycle hooks
            metadata.models.length === 0 &&
            !metadata.hasNestedLists &&
            metadata.shows.length === 0 &&
            metadata.renders.length === 0 &&
            metadata.styleBindings.length === 0 &&
            metadata.attrBindings.length === 0 &&  // attr bindings need Pass 2 DOM processing
            metadata.htmlBindings.length === 0 &&
            !hasComputedClassBindings &&  // computed:propName needs component method calls
            !hasExternalClassBindings &&  // external() needs cross-component lookup
            !hasRootExternalClassBinding &&  // external() on root needs cross-component lookup
            // Complex class bindings are OK - Pass 2 handles them with evalFn(item, state)
            // List context vars (_index, etc.) are OK - we know the index during Pass 2
            // Root class bindings need the root element which we have in Pass 2
            // Check that text bindings don't use complex features
            metadata.bindings.every(b =>
                !b.isPropsPath &&
                !b.isComputed &&
                !b.isListContextVar &&
                !b.isExpression
            ) &&
            // Check root bindings don't have complex features
            !metadata.rootBindings.hasModel &&
            !metadata.rootBindings.hasShow &&
            !metadata.rootBindings.hasRender &&
            !metadata.rootBindings.hasBindStyle &&
            !metadata.rootBindings.hasBindAttr &&  // attr bindings need Pass 2 DOM processing
            !metadata.rootBindings.hasBindHtml;

        // Check for portals, nested components, and configurable templates (requires DOM query)
        let hasExcludedFeatures = false;
        if (canUseInnerHTML && queryRoot) {
            // CRITICAL FIX: Also check if queryRoot ITSELF is a component
            // querySelector only searches descendants, not the element itself
            // If the template root IS a component, we must not use innerHTML optimization
            // because the component needs to manage its own internal bindings
            hasExcludedFeatures =
                queryRoot.querySelector('[data-portal]') !== null ||
                queryRoot.querySelector(this._attrSelector('component')) !== null ||
                this._hasAttr(queryRoot, 'component');  // Check queryRoot itself
        }
        // Configurable templates need special SSR marker handling
        // Check the template element itself (not its content)
        if (canUseInnerHTML && template && template.hasAttribute) {
            hasExcludedFeatures = hasExcludedFeatures ||
                template.hasAttribute('data-use-template') ||
                template.hasAttribute('data-item-template');
        }

        // CRITICAL: Configurable templates MUST NOT use innerHTML optimization
        // because innerHTML replaces the original <template data-use-template> element,
        // which breaks rescanItemTemplates() functionality
        metadata.canUseInnerHTML = canUseInnerHTML && !hasExcludedFeatures && !options.isConfigurableTemplate;

        // Generate innerHTML template if eligible
        if (metadata.canUseInnerHTML) {
            // Clone template for modification (don't mutate original)
            const templateClone = queryRoot.cloneNode(true);

            // Build accessor functions and replace bindings with tokens
            const textAccessors = [];
            let tokenIndex = 0;

            // Process root text binding if present
            if (metadata.rootBindings.hasBind && metadata.rootBindings.bindPath) {
                const path = metadata.rootBindings.bindPath;
                // Create accessor function for this path
                textAccessors.push({
                    tokenId: tokenIndex,
                    path: path,
                    accessor: this._createPropertyAccessor(path),
                    isRoot: true
                });
                // Replace root content with token (unique marker that won't be HTML-escaped)
                templateClone.textContent = `__WF_BIND_${tokenIndex}__`;
                tokenIndex++;
            }

            // Process child text bindings
            // Re-query the clone to get elements
            const cloneBindingElements = Array.from(templateClone.querySelectorAll(this._attrSelector('bind')))
                .filter(el => {
                    // Filter out nested list elements (same logic as above)
                    let parent = el.parentElement;
                    while (parent && parent !== templateClone && templateClone.contains(parent)) {
                        if (this._hasAttr(parent, 'list')) return false;
                        parent = parent.parentElement;
                    }
                    return true;
                });

            for (const el of cloneBindingElements) {
                const bindPath = this._getAttr(el, 'bind');
                if (!bindPath) continue;

                // Create accessor for this binding
                textAccessors.push({
                    tokenId: tokenIndex,
                    path: bindPath,
                    accessor: this._createPropertyAccessor(bindPath)
                });

                // Replace element's content with token (unique marker that won't be HTML-escaped)
                el.textContent = `__WF_BIND_${tokenIndex}__`;
                tokenIndex++;
            }

            // ================================================================
            // PHASE 3.5: Strip framework attributes from compiled template
            // ================================================================
            // These attributes are no longer needed once bindings are compiled
            // into metadata. Stripping reduces DOM bloat and browser style/layout time.
            // STRIP: All framework binding attributes (tests use context registry helpers)
            // NOTE: List items are identified by _listIndex JS property, not DOM attributes
            const attrsToStrip = [
                // Text binding attributes
                'data-bind', 'data-wf-bind',
                // Action attributes - contexts looked up via compiled metadata
                'data-action', 'data-wf-action',
                // Verbose attributes with expressions
                'data-bind-class', 'data-wf-bind-class',
                'data-bind-html', 'data-wf-bind-html',
                'data-bind-style', 'data-wf-bind-style',
                'data-model', 'data-wf-model',
                'data-show', 'data-wf-show',
                'data-render', 'data-wf-render',
                'data-if', 'data-wf-if',
                'data-key', 'data-wf-key'
            ];

            // Strip from templateClone root element
            for (const attr of attrsToStrip) {
                templateClone.removeAttribute(attr);
            }
            // Strip from all descendant elements
            for (const attr of attrsToStrip) {
                const elementsWithAttr = templateClone.querySelectorAll(`[${attr}]`);
                for (const el of elementsWithAttr) {
                    el.removeAttribute(attr);
                }
            }

            // Get the modified HTML as template string
            let templateHTML = templateClone.outerHTML;

            // PERF: Strip whitespace between tags to reduce DOM text nodes
            // For 10k rows, this eliminates ~100k+ whitespace text nodes
            // which significantly reduces layout/reflow time
            templateHTML = templateHTML.replace(/>\s+</g, '><');

            // Split by tokens to create template parts array
            // This enables: parts[0] + value + parts[1] + value + parts[2] (no regex at runtime)
            // Token format: __WF_BIND_<index>__ (underscores don't get HTML-escaped)
            const tokenRegex = /__WF_BIND_(\d+)__/g;
            const parts = [];
            let lastIndex = 0;
            let match;

            while ((match = tokenRegex.exec(templateHTML)) !== null) {
                parts.push(templateHTML.slice(lastIndex, match.index));
                lastIndex = match.index + match[0].length;
            }
            parts.push(templateHTML.slice(lastIndex));

            metadata.innerHTMLParts = parts;
            metadata.textAccessors = textAccessors;
        }

        // Pre-compile class evaluators unconditionally — they're needed by both
        // the innerHTML fast path AND the mapFn DOM-cloning path.
        // Previously inside canUseInnerHTML block, which meant class bindings
        // silently failed when style/attr/model/show bindings disabled innerHTML.
        const classEvaluators = [];
        for (const classBinding of metadata.classBindings) {
            const expr = classBinding.expression;
            let evalFn;

            // Handle simple property bindings (e.g., data-bind-class="type")
            if (classBinding.isSimpleProperty) {
                // For simple properties, create an accessor that reads the property directly
                evalFn = this._createPropertyAccessor(expr);
                evalFn._isPropertyAccessor = true; // Mark so _fastInitialRender uses it correctly
            } else {
                // Extract all unique variables from the expression
                const vars = classBinding.expressionVars || [];
                const allVars = [...new Set(vars)];

                // Create evaluator function that takes a merged context object
                // This handles item properties, component state, and list context variables
                // without needing to know which is which at compile time
                try {
                    if (this._useCSPSafeEvaluation) {
                        // CSP-safe path: use AST evaluator
                        evalFn = getCSPSafeMergedContextEvaluator(
                            expr,
                            allVars,
                            this._astCache,
                            'class-eval'
                        );
                        if (evalFn) evalFn._usesMergedContext = true;
                    } else if (!_UNSAFE_EXPR_RE.test(expr)) {
                        // Standard path: use new Function()
                        const destructure = allVars.length > 0 ? `const {${allVars.join(',')}} = ctx;` : '';
                        evalFn = new Function('ctx', `"use strict"; ${destructure} return ${expr};`);
                        evalFn._usesMergedContext = true;
                    }
                } catch (e) {
                    // Fallback: null means use standard evaluation
                    evalFn = null;
                }
            }

            classEvaluators.push({
                index: classBinding.index,
                elementPath: classBinding.elementPath,
                evaluator: evalFn,
                expression: expr, // Fallback for null evaluator
                isSimpleProperty: classBinding.isSimpleProperty
            });
        }

        // Also handle root class binding
        if (metadata.rootBindings.hasBindClass && metadata.rootBindings.bindClassExpr) {
            const expr = metadata.rootBindings.bindClassExpr;
            const allVars = this._extractExpressionVars(expr);

            let evalFn;
            try {
                if (this._useCSPSafeEvaluation) {
                    // CSP-safe path: use AST evaluator
                    evalFn = getCSPSafeMergedContextEvaluator(
                        expr,
                        allVars,
                        this._astCache,
                        'root-class-eval'
                    );
                    if (evalFn) evalFn._usesMergedContext = true;
                } else if (!_UNSAFE_EXPR_RE.test(expr)) {
                    // Standard path: use new Function()
                    const destructure = allVars.length > 0 ? `const {${allVars.join(',')}} = ctx;` : '';
                    evalFn = new Function('ctx', `"use strict"; ${destructure} return ${expr};`);
                    evalFn._usesMergedContext = true;
                }
            } catch (e) {
                evalFn = null;
            }

            classEvaluators.unshift({
                elementPath: [], // Root element
                evaluator: evalFn,
                expression: expr,
                isRoot: true
            });
        }

        metadata.classEvaluators = classEvaluators;

        // Pre-compile style evaluators for fast-path rendering
        const styleEvaluators = [];
        for (const styleBinding of metadata.styleBindings) {
            const expr = styleBinding.expression;
            if (styleBinding.isComputed) {
                styleEvaluators.push({ index: styleBinding.index, elementPath: styleBinding.elementPath, evaluator: null, expression: expr, isComputed: true, computedName: styleBinding.computedName });
                continue;
            }
            // Always compile a context-object evaluator for the fast-path.
            // styleBinding.compiledFn uses positional args (from _getCompiledExpression)
            // which is incompatible with the fast-path's merged context pattern.
            let evalFn = null;
            const vars = styleBinding.expressionVars || [];
            const allVars = [...new Set(vars)];
            if (allVars.length > 0) {
                try {
                    if (this._useCSPSafeEvaluation) {
                        evalFn = getCSPSafeMergedContextEvaluator(expr, allVars, this._astCache, 'style-eval');
                        if (evalFn) evalFn._usesMergedContext = true;
                    } else if (!_UNSAFE_EXPR_RE.test(expr)) {
                        const destructure = `const {${allVars.join(',')}} = ctx;`;
                        evalFn = new Function('ctx', `"use strict"; ${destructure} return ${expr};`);
                        evalFn._usesMergedContext = true;
                    }
                } catch (e) { evalFn = null; }
            }
            styleEvaluators.push({ index: styleBinding.index, elementPath: styleBinding.elementPath, evaluator: evalFn, expression: expr, isComputed: false });
        }
        if (metadata.rootBindings.hasBindStyle && metadata.rootBindings.bindStyleExpr) {
            const expr = metadata.rootBindings.bindStyleExpr;
            const allVars = this._extractExpressionVars(expr);
            let evalFn;
            try {
                if (this._useCSPSafeEvaluation) {
                    evalFn = getCSPSafeMergedContextEvaluator(expr, allVars, this._astCache, 'root-style-eval');
                    if (evalFn) evalFn._usesMergedContext = true;
                } else if (!_UNSAFE_EXPR_RE.test(expr)) {
                    const destructure = allVars.length > 0 ? `const {${allVars.join(',')}} = ctx;` : '';
                    evalFn = new Function('ctx', `"use strict"; ${destructure} return ${expr};`);
                    evalFn._usesMergedContext = true;
                }
            } catch (e) { evalFn = null; }
            styleEvaluators.unshift({ elementPath: [], evaluator: evalFn, expression: expr, isRoot: true, isComputed: false });
        }
        metadata.styleEvaluators = styleEvaluators;

        // Pre-compile attr evaluators for fast-path rendering
        const attrEvaluators = [];
        for (const attrBinding of metadata.attrBindings) {
            const expr = attrBinding.expression;
            if (attrBinding.isComputed) {
                attrEvaluators.push({ index: attrBinding.index, elementPath: attrBinding.elementPath, evaluator: null, expression: expr, isComputed: true, computedName: attrBinding.computedName });
                continue;
            }
            // Always compile context-object evaluator (same reason as style evaluators)
            let evalFn = null;
            const vars = attrBinding.expressionVars || [];
            const allVars = [...new Set(vars)];
            if (allVars.length > 0) {
                try {
                    let safeExpr = expr.replace(/(\{|,)\s*([a-zA-Z_$][a-zA-Z0-9_$]*(?:-[a-zA-Z0-9_$]+)+)\s*:/g,
                        (match, prefix, key) => `${prefix} '${key}':`);
                    if (this._useCSPSafeEvaluation) {
                        evalFn = getCSPSafeMergedContextEvaluator(safeExpr, allVars, this._astCache, 'attr-eval');
                        if (evalFn) evalFn._usesMergedContext = true;
                    } else if (!_UNSAFE_EXPR_RE.test(safeExpr)) {
                        const destructure = `const {${allVars.join(',')}} = ctx;`;
                        evalFn = new Function('ctx', `"use strict"; ${destructure} return ${safeExpr};`);
                        evalFn._usesMergedContext = true;
                    }
                } catch (e) { evalFn = null; }
            }
            attrEvaluators.push({ index: attrBinding.index, elementPath: attrBinding.elementPath, evaluator: evalFn, expression: expr, isComputed: false });
        }
        if (metadata.rootBindings.hasBindAttr && metadata.rootBindings.bindAttrExpr) {
            const expr = metadata.rootBindings.bindAttrExpr;
            let safeExpr = expr.replace(/(\{|,)\s*([a-zA-Z_$][a-zA-Z0-9_$]*(?:-[a-zA-Z0-9_$]+)+)\s*:/g,
                (match, prefix, key) => `${prefix} '${key}':`);
            const allVars = this._extractExpressionVars(safeExpr);
            let evalFn;
            try {
                if (this._useCSPSafeEvaluation) {
                    evalFn = getCSPSafeMergedContextEvaluator(safeExpr, allVars, this._astCache, 'root-attr-eval');
                    if (evalFn) evalFn._usesMergedContext = true;
                } else if (!_UNSAFE_EXPR_RE.test(safeExpr)) {
                    const destructure = allVars.length > 0 ? `const {${allVars.join(',')}} = ctx;` : '';
                    evalFn = new Function('ctx', `"use strict"; ${destructure} return ${safeExpr};`);
                    evalFn._usesMergedContext = true;
                }
            } catch (e) { evalFn = null; }
            attrEvaluators.unshift({ elementPath: [], evaluator: evalFn, expression: expr, isRoot: true, isComputed: false });
        }
        metadata.attrEvaluators = attrEvaluators;

        return metadata;
    },
    /**
     * Create a property accessor function for a dot-notation path
     * Compiles "user.profile.name" into a fast accessor function
     * @private
     */
    _createPropertyAccessor(path) {
        // Handle simple single-level paths
        if (!path.includes('.')) {
            return (item) => item[path];
        }

        // Handle nested paths - compile to function
        const parts = path.split('.');
        return (item) => {
            let value = item;
            for (let i = 0; i < parts.length && value != null; i++) {
                value = value[parts[i]];
            }
            return value;
        };
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // JIT COMPONENT COMPILATION (Flyweight Pattern for TBT Optimization)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Compile a component's DOM structure into reusable binding metadata.
     * This is the "compile once, instantiate many" pattern (Flyweight).
     *
     * @param {HTMLElement} element - The component's root element
     * @param {string} componentName - The component type name
     * @returns {Object} Compiled binding metadata with element paths
     * @private
     */
    _compileComponentBindings(element, componentName) {
        // Build selector for all binding types (respects useWfPrefixOnly mode)
        const allBindingSelector = [
            this._attrSelector('bind'),
            this._attrSelector('bind-html'),
            this._attrSelector('bind-class'),
            this._attrSelector('bind-style'),
            this._attrSelector('bind-attr'),
            this._attrSelector('model'),
            this._attrSelector('show'),
            this._attrSelector('render'),
            this._attrSelector('action')
        ].join(',');

        // Query ALL binding elements once
        const allElementsRaw = element.querySelectorAll(allBindingSelector);

        // Filter out elements that should not be processed:
        // - Inside nested data-list containers (list items compiled separately)
        // - Inside nested components (bindings processed by that component)
        // - Inside data-use-template-rendered (slot bindings handled by slot system)
        const allElements = Array.from(allElementsRaw).filter(el => {
            // Check if inside slot template content (handled by _setupSlotBindings)
            if (el.closest('[data-use-template-rendered]')) {
                return false;
            }
            let parent = el.parentElement;
            while (parent && parent !== element) {
                if (this._hasAttr(parent, 'list') || this._hasAttr(parent, 'component') || this._hasAttr(parent, 'pool')) {
                    return false; // Inside a nested list, component, or pool - skip
                }
                parent = parent.parentElement;
            }
            return true;
        });

        // Build metadata structure (similar to _compileTemplate but for components)
        const metadata = {
            componentName,
            fingerprint: this._generateDOMFingerprint(element),
            elementCount: allElements.length,
            bindings: [],      // data-bind elements
            htmlBindings: [],  // data-bind-html elements
            classBindings: [], // data-bind-class elements
            styleBindings: [], // data-bind-style elements
            attrBindings: [],  // data-bind-attr elements
            models: [],        // data-model elements
            shows: [],         // data-show elements
            renders: [],       // data-render elements
            actions: [],       // data-action elements
            lists: [],         // data-list elements
            pools: [],         // data-pool elements
            elementPaths: []   // Pre-computed paths for all elements
        };

        // Also find data-list elements (handled specially - not in allElements)
        // List elements need to be collected but their children are NOT processed
        const listElements = element.querySelectorAll(this._attrSelector('list'));
        for (const listEl of listElements) {
            // Skip lists inside nested components
            let parent = listEl.parentElement;
            let insideNestedComponent = false;
            while (parent && parent !== element) {
                if (this._hasAttr(parent, 'component')) {
                    insideNestedComponent = true;
                    break;
                }
                parent = parent.parentElement;
            }
            if (!insideNestedComponent) {
                const listPath = this._getAttr(listEl, 'list');
                const keyProp = this._getAttr(listEl, 'key'); // data-key="id" or data-wf-key="id"
                metadata.lists.push({
                    path: listPath,
                    elementPath: this._getElementPath(listEl, element),
                    key: keyProp || 'id' // Default to 'id' property
                });
            }
        }

        // Also find data-pool elements (entity pools — high-performance rendering)
        const poolElements = element.querySelectorAll(this._attrSelector('pool'));
        for (const poolEl of poolElements) {
            let parent = poolEl.parentElement;
            let insideNestedComponent = false;
            while (parent && parent !== element) {
                if (this._hasAttr(parent, 'component')) {
                    insideNestedComponent = true;
                    break;
                }
                parent = parent.parentElement;
            }
            if (!insideNestedComponent) {
                metadata.pools.push({
                    path: this._getAttr(poolEl, 'pool'),
                    elementPath: this._getElementPath(poolEl, element)
                });
            }
        }

        // Process each element and extract binding metadata
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const elementPath = this._getElementPath(el, element);
            metadata.elementPaths[i] = elementPath;

            // Extract data-bind
            const bindPath = this._getAttr(el, 'bind');
            if (bindPath) {
                const tagName = el.tagName;
                const isInput = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
                const isExpression = this.isExpression(bindPath);

                const binding = {
                    index: i,
                    path: bindPath,
                    elementPath,
                    isInput,
                    isExpression,
                    isLengthProperty: bindPath.endsWith('.length')
                };

                // Pre-compile expression if needed
                if (isExpression) {
                    binding.expressionVars = this._extractExpressionVars(bindPath);
                    binding.compiledFn = this._getCompiledExpression(bindPath, binding.expressionVars, 'componentBinding');
                }

                metadata.bindings.push(binding);
            }

            // Extract data-bind-html
            const bindHtmlPath = this._getAttr(el, 'bind-html');
            if (bindHtmlPath) {
                metadata.htmlBindings.push({
                    index: i,
                    path: bindHtmlPath,
                    elementPath
                });
            }

            // Extract data-bind-class
            const bindClassExpr = this._getAttr(el, 'bind-class');
            if (bindClassExpr) {
                metadata.classBindings.push({
                    index: i,
                    expression: bindClassExpr,
                    elementPath
                });
            }

            // Extract data-bind-style
            const bindStyleExpr = this._getAttr(el, 'bind-style');
            if (bindStyleExpr) {
                metadata.styleBindings.push({
                    index: i,
                    expression: bindStyleExpr,
                    elementPath
                });
            }

            // Extract data-bind-attr
            const bindAttrExpr = this._getAttr(el, 'bind-attr');
            if (bindAttrExpr) {
                metadata.attrBindings.push({
                    index: i,
                    expression: bindAttrExpr,
                    elementPath
                });
            }

            // Extract data-model
            const modelPath = this._getAttr(el, 'model');
            if (modelPath) {
                metadata.models.push({
                    index: i,
                    path: modelPath,
                    type: el.type || null,
                    tagName: el.tagName,
                    elementPath
                });
            }

            // Extract data-show
            const showPath = this._getAttr(el, 'show');
            if (showPath) {
                const negate = showPath.startsWith('!');
                metadata.shows.push({
                    index: i,
                    path: negate ? showPath.slice(1) : showPath,
                    negate,
                    elementPath
                });
            }

            // Extract data-render (enhanced for _resolveCompiledBinding compatibility)
            const renderPath = this._getAttr(el, 'render');
            if (renderPath) {
                const negate = renderPath.startsWith('!');
                const actualRenderPath = negate ? renderPath.slice(1) : renderPath;
                const isRenderComputed = actualRenderPath.includes('computed:');
                const isRenderExpression = this.isExpression(actualRenderPath);

                const renderBinding = {
                    index: i,
                    path: actualRenderPath,
                    negate,
                    isComputed: isRenderComputed,
                    computedName: isRenderComputed ? actualRenderPath.slice(9) : null,
                    elementPath,
                    isExpression: isRenderExpression
                };

                if (isRenderExpression) {
                    renderBinding.expressionVars = this._extractExpressionVars(actualRenderPath);
                    renderBinding.compiledFn = this._getCompiledExpression(actualRenderPath, renderBinding.expressionVars, 'listRenderBinding');
                }

                metadata.renders.push(renderBinding);
            }

            // Extract data-action
            const actionValue = this._getAttr(el, 'action');
            if (actionValue) {
                metadata.actions.push({
                    index: i,
                    actionValue,
                    elementPath
                });
            }
        }

        return metadata;
    },

    /**
     * Compute DOM path (array of child indices) from root to element.
     * @param {HTMLElement} element - Target element
     * @param {HTMLElement} root - Root ancestor element
     * @returns {number[]} Array of child indices from root to element
     * @private
     */
    _getElementPath(element, root) {
        if (element === root) return [];
        const path = [];
        let current = element;
        while (current && current !== root) {
            const parent = current.parentNode;
            if (!parent) break;
            const children = Array.from(parent.children);
            const index = children.indexOf(current);
            path.unshift(index);
            current = parent;
        }
        return path;
    },

    /**
     * Generate a fingerprint hash of a component's DOM structure.
     * Used to detect when two instances have identical structure AND binding paths.
     *
     * @param {HTMLElement} element - The component's root element
     * @returns {string} A fingerprint string representing the DOM structure
     * @private
     */
    _generateDOMFingerprint(element) {
        // Build a string representing the DOM structure (tag names, binding attributes AND values)
        // Including values is critical for inherited templates where paths may differ
        const parts = [];

        const walk = (el, depth) => {
            if (depth > 10) return; // Prevent infinite recursion

            // Include tag name
            let sig = el.tagName;

            // Add binding attribute signatures WITH their values
            // This ensures different binding paths result in different fingerprints
            const bindVal = this._getAttr(el, 'bind');
            if (bindVal) sig += ':b=' + bindVal;

            const htmlVal = this._getAttr(el, 'bind-html');
            if (htmlVal) sig += ':h=' + htmlVal;

            const classVal = this._getAttr(el, 'bind-class');
            if (classVal) sig += ':c=' + classVal;

            const styleVal = this._getAttr(el, 'bind-style');
            if (styleVal) sig += ':s=' + styleVal;

            const modelVal = this._getAttr(el, 'model');
            if (modelVal) sig += ':m=' + modelVal;

            const showVal = this._getAttr(el, 'show');
            if (showVal) sig += ':w=' + showVal;

            const renderVal = this._getAttr(el, 'render');
            if (renderVal) sig += ':r=' + renderVal;

            const actionVal = this._getAttr(el, 'action');
            if (actionVal) sig += ':a=' + actionVal;

            const listVal = this._getAttr(el, 'list');
            if (listVal) sig += ':l=' + listVal;

            parts.push(sig);

            // Skip children of data-list (they're templates, not actual structure)
            if (!listVal) {
                for (const child of el.children) {
                    walk(child, depth + 1);
                }
            }
        };

        walk(element, 0);

        // Simple hash - just join the signatures
        // For a more robust hash, we could use a real hashing algorithm
        return parts.join('|');
    },

    /**
     * Get or create compiled bindings for a component type.
     * Implements the Flyweight pattern - compile once, reuse for all instances.
     *
     * @param {HTMLElement} element - The component's root element
     * @param {string} componentName - The component type name
     * @returns {Object|null} Compiled binding metadata, or null if structure differs
     * @private
     */
    _getCompiledComponentBindings(element, componentName) {
        const definition = this.componentDefinitions.get(componentName);
        if (!definition) return null;

        // Skip JIT for components using inherited templates (data-use-template)
        // These templates change DOM structure AFTER initialization, so we can't
        // reliably cache bindings from the initial DOM state
        if (element.querySelector(this._attrSelector('use-template'))) {
            return null;
        }

        // Check if we already have compiled bindings
        if (definition._compiledBindings) {
            // Verify fingerprint matches (optional safety check)
            const currentFingerprint = this._generateDOMFingerprint(element);
            if (definition._compiledBindings.fingerprint === currentFingerprint) {
                return definition._compiledBindings;
            }
            // Structure differs - fall back to regular processing
            // This shouldn't happen in well-designed apps
            return null;
        }

        // First instance - compile and cache
        const compiled = this._compileComponentBindings(element, componentName);
        definition._compiledBindings = compiled;

        return compiled;
    }
};
