/**
 * RenderingCore - Core render scheduling and binding processing
 *
 * @module
 */

import { listBoundElements, ssrAdoptedElements } from '../core/DomMetadata.js';
import { WF_ERRORS, wfError } from '../core/wfUtils.js';

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const RenderingCoreMethods = {
/**
     * Schedule a render to update the UI
     * @private
     */

    _scheduleRender()
    {
        // Skip scheduling if renders are suppressed during batching
        if (this._suppressRender && !this._ensureRender) {
            return;
        }

        this._ensureRender = false;

        const now = Date.now();
        if (this._lastRenderScheduled && (now - this._lastRenderScheduled < 20)) {
            // Only throttle if there's actually a pending render that will pick up changes.
            // If no pending render, we MUST schedule one even within the throttle window
            if (this._renderScheduled) {
                return;
            }
            // No pending render - fall through to schedule one
        }

        this._lastRenderScheduled = now;

        // Cancel any existing render
        if (this._renderScheduled)
        {
            cancelAnimationFrame(this._renderScheduled);
        }

        if (this._batchChangedPaths && this._batchChangedPaths.size > 0)
        {
            this._batchChangedPaths.forEach(path => this._pendingStateChanges.add(path));
        }

        if (!this._batchChangedComponents)
        {
            this._batchChangedComponents = new Set();
        }

        // At this point, if no pending changes exist, add any updated paths
        // If we have pending state changes but no changed components tracked,
        // find all potentially affected components

        if (this._pendingStateChanges.size > 0 && this._batchChangedComponents.size === 0)
        {

            this.componentInstances.forEach((instance, id) =>
            {
                // Check if any of the pending changes might affect this component
                if (this._componentMightBeAffected(instance, this._pendingStateChanges))
                {
                    this._batchChangedComponents.add(id);
                }
            });

        }

        // Clear pending state changes AFTER using them to prevent unbounded growth
        // New changes that arrive during render will be added to a fresh set
        // and processed in the next render cycle
        this._pendingStateChanges.clear();

        // Schedule a new render
        this._renderScheduled = requestAnimationFrame(() =>
        {
            // Call the render
            this._render();

            // Clear scheduled flag
            this._renderScheduled = null;
        });

    },
    /**
     * Render all components
     * @private
     */


    _render()
    {
        // Collect list contexts that need DOM updates (binding contexts handled by effects)
        const listContexts = new Set();

        if (this._contextsToUpdate && this._contextsToUpdate.size > 0) {
            this._contextsToUpdate.forEach(context => {
                if (context.type === 'list') {
                    listContexts.add(context);
                }
            });
        }

        if (this._contextSystemInitialized && this._deferredDependencies && this._deferredDependencies.length > 0)
        {
            this._processDeferredDependencies();
        }

        // Process list contexts
        if (this._contextSystemInitialized && listContexts.size > 0)
        {
            // Process each list context that needs updating
            listContexts.forEach(context =>
            {
                // Skip if context has no element reference
                if (!context.element) return;

                // mapArray handles all structural updates via effects — skip context-based processing
                if (context.element._mapArrayInitialized) return;

                // Skip if element is no longer in DOM
                if (!document.body.contains(context.element))
                {
                    return;
                }

                // Get component instance
                const instance = context.componentInstance;
                if (!instance) return;

                // Process list using the context
                this._processList(
                    {
                        element: context.element,
                        path: context.path,
                        componentId: instance.id
                    },
                    instance,
                    false // Don't force update - let detection work
                );
            });
        }

        // Clear update tracking after processing both types
        if (this._contextsToUpdate) {
            this._contextsToUpdate.clear();
        }

        //FOCUS PRESERVATION - Capture active element state before rendering
        const activeElement = document.activeElement;
        let activeInfo = null;

        // Check if the active element is an input in a list item
        if (activeElement &&
            (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT') &&
            activeElement.dataset.model)
        {

            const listItemElement = this._findListItemAncestor(activeElement);
            if (listItemElement)
            {
                const listElement = this._findDirectParentList(listItemElement);
                if (listElement)
                {
                    activeInfo = {
                        modelPath: activeElement.dataset.model,
                        itemIndex: listItemElement._listIndex,
                        listElement: listElement,
                        componentId: this._getComponentId(listElement),
                        value: activeElement.value,
                        selectionStart: activeElement.selectionStart !== undefined ? activeElement.selectionStart : null,
                        selectionEnd: activeElement.selectionEnd !== undefined ? activeElement.selectionEnd : null
                    };
                }
            }
        }


        const componentsToProcess = new Set();

        // Add all pending component updates to the processing set
        if (this._componentsToUpdate)
        {
            this._componentsToUpdate.forEach(id => componentsToProcess.add(id));
        }

        // Add any batch components to the processing set
        if (this._batchChangedComponents)
        {
            this._batchChangedComponents.forEach(id => componentsToProcess.add(id));
        }

        // Add any dependent components to the processing set
        if (this._pendingDependentUpdates)
        {
            this._pendingDependentUpdates.forEach(id => componentsToProcess.add(id));
        }


        // Make _componentsToUpdate accessible for benchmark instrumentation
        this._componentsToUpdate = componentsToProcess;

        if (!this._renderCounter) this._renderCounter = 0;
        ++this._renderCounter;

        if (this._pendingDependentUpdates && this._pendingDependentUpdates.size > 0)
        {
            this._pendingDependentUpdates.forEach(componentId =>
            {
                const instance = this.componentInstances.get(componentId);
                if (instance && instance.stateManager &&
                    instance.stateManager.computed && Object.keys(instance.stateManager.computed).length > 0)
                {
                    // Re-evaluate computed properties
                    Object.keys(instance.stateManager.computed).forEach(propName =>
                    {
                        // Clear cache for this property
                        instance.stateManager.computedCache.delete(propName);
                        // Force re-evaluation
                        try
                        {
                            instance.stateManager.evaluateComputed(propName);
                        } catch (error)
                        {
                            if (__DEV__) console.error(`Error re-evaluating ${propName}:`, error);
                        }
                    });
                }
            });
        }

        // Run update methods (bindings/HTML/class/models handled by effects)
        // _updateLists still needed for initial mapArray setup; _processList early-exits
        // for already-initialized lists via _mapArrayInitialized check
        this._updateLists(this.domElements.lists);
        this._updateConditionals();

        // Mark components that were actually rendered in this cycle as having been rendered
        // CRITICAL: Only mark components whose lists were actually processed, not just queued for update
        // This happens after ALL update methods (bindings, lists, conditionals, models) have completed
        if (this._actuallyRenderedComponents && this._actuallyRenderedComponents.size > 0)
        {
            this._actuallyRenderedComponents.forEach(componentId =>
            {
                const instance = this.componentInstances.get(componentId);
                if (instance && instance._hasRendered === false)
                {
                    instance._hasRendered = true;
                }
            });

            // Clear the tracking set for the next render cycle
            this._actuallyRenderedComponents.clear();
        }


        // Use new Set() to reset completely
        this._componentsToUpdate = new Set();

        if (activeInfo && activeInfo.componentId)
        {
            // Cancel any previous focus restoration timer to prevent cursor jumps on rapid re-renders
            if (this._focusRestorationTimer) {
                clearTimeout(this._focusRestorationTimer);
            }
            // Use setTimeout to ensure DOM is fully updated
            this._focusRestorationTimer = setTimeout(() =>
            {
                this._focusRestorationTimer = null;
                const componentElement = document.querySelector(`[data-component-id="${activeInfo.componentId}"]`);
                if (componentElement)
                {
                    // Find the specific list element and only search its direct children
                    const listElement = activeInfo.listElement.isConnected
                        ? activeInfo.listElement
                        : componentElement.querySelector(`[data-list="${activeInfo.listElement.dataset.list}"]`);

                    if (!listElement) return;

                    // Only get direct children that are list items
                    const listItems = this._getListItems(listElement);

                    // Find the list item with matching index
                    for (const item of listItems)
                    {
                        if (item._listIndex === activeInfo.itemIndex)
                        {
                            // Find the input with matching model path
                            const input = item.querySelector(`[data-model="${activeInfo.modelPath}"]`);
                            if (input)
                            {
                                // Restore focus
                                input.focus();

                                // Restore cursor position if applicable
                                if (activeInfo.selectionStart !== null &&
                                    input.setSelectionRange)
                                {
                                    try
                                    {
                                        input.setSelectionRange(
                                            activeInfo.selectionStart,
                                            activeInfo.selectionEnd
                                        );
                                    } catch (e)
                                    {
                                        // Ignore selection errors (can happen on non-text inputs)
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }, 0);
        }


        // Clean up batch tracking after render completes
        if (this._batchChangedComponents)
        {
            this._batchChangedComponents = null;
            this._batchChangedPaths = null;
        }

        //Clean up the pendingDependentUpdates too
        if (this._pendingDependentUpdates)
        {
            this._pendingDependentUpdates.clear();
        }

        // _componentsToUpdate is pre-initialized in the constructor for V8 hidden class stability



        if (this._contextSystemInitialized && this._contextHierarchyDirty && componentsToProcess.size > 0)
        {
            this._contextHierarchyDirty = false;
            // Use a tick delay to ensure DOM is fully updated before rebuilding
            setTimeout(() =>
            {

                this._buildComponentContextHierarchy();

            }, 0);
        }
    },
    /**
     * Update all data bindings
     * @private
     */

    _updateConditionals() {
        if (!this._contextSystemInitialized || !this._contextRegistry) return;

        const conditionalContexts = this._contextRegistry.getContextsByType('conditional');
        if (!conditionalContexts || conditionalContexts.length === 0) return;

        for (const context of conditionalContexts) {
            if (!context.componentInstance) continue;

            const isRenderMode = context.mode === 'render';

            // Effects handle data-show for effect-backed components
            if (!isRenderMode && context.componentInstance._renderEffect) continue;

            if (!context.element && !isRenderMode) continue;

            const componentId = context.componentInstance.id;
            if (this._componentsToUpdate && !this._componentsToUpdate.has(componentId)) continue;

            try {
                const isVisible = context.resolveData();

                if (__FEATURE_TRANSITIONS__) {
                    const element = context.element || (isRenderMode ? context.templateClone : null);
                    if (this._handleTransitionedVisibilityChange && element?.dataset?.transition) {
                        this._handleTransitionedVisibilityChange(element, context, isVisible, context.componentInstance);
                    } else {
                        context._updateConditionalElement(isVisible);
                    }
                } else {
                    context._updateConditionalElement(isVisible);
                }
            } catch (error) {
                if (__DEV__) console.error(`Error updating conditional context: ${context.path}`, error);
            }
        }
    },
    /**
     * Process binding elements and create binding contexts
     * @param {Object} instance - Component instance
     * @private
     */
    _processBindingElements(instance)
    {
        if (!this._contextSystemInitialized) return;

        const {element, id: instanceId} = instance;

        // Find all binding elements directly in this component (including component root)
        const bindingElements = this._querySelfAndDescendants(element, this._attrSelector('bind'))
            .filter(el =>
            {
                // Skip elements that have been bound by a list (prevent component from overwriting)
                if (listBoundElements.has(el)) {
                    return false;
                }
                // Skip elements inside list containers (they're list item bindings, not component bindings)
                if (el.closest('[data-list], [data-wf-list]') && el.closest('[data-list], [data-wf-list]').closest('[data-component]') === element) {
                    return false;
                }
                // Skip slot template bindings (handled by slot template system)
                if (el.closest('[data-use-template-rendered]')) {
                    return false;
                }
                const closestComponent = this._getComponentElement(el);
                return closestComponent === element;
            });


        bindingElements.forEach(bindingElement =>
        {
            const bindPath = this._getAttr(bindingElement, 'bind');
            if (!bindPath) return;

            this._contextRegistry._createItemLevelContext({
                element: bindingElement,
                contextType: 'binding',
                path: bindPath,
                instance,
                createMethod: this._contextRegistry.createBindingContext.bind(this._contextRegistry)
            });

            if (instance._effectMeta) {
                const needsExprEval = this.isExpression(bindPath) || bindPath.includes('$');
                const entry = {
                    element: bindingElement,
                    type: 'bind',
                    path: bindPath,
                    isInput: bindingElement.tagName === 'INPUT' || bindingElement.tagName === 'TEXTAREA' || bindingElement.tagName === 'SELECT',
                    isExpression: needsExprEval
                };
                if (bindingElement.tagName.includes('-')) entry.isWebComponent = true;
                instance._effectMeta.push(entry);
            }
        });
    },
    /**
     * Create a binding context for an element, handling list vs non-list branching.
     * Returns { context, inList, itemIndex, listItem, listElement } or null if in list but no valid context.
     * @private
     */
    _createListAwareBindingContext(bindingElement, bindPath, instance) {
        const listItem = this._findListItemAncestor(bindingElement);

        if (listItem) {
            const listElement = this._findDirectParentList(listItem);
            if (listElement && listElement._listContext) {
                const itemIndex = listItem._listIndex;
                const context = this._contextRegistry.createBindingContext(
                    bindPath, instance, bindingElement,
                    listElement._listContext, itemIndex
                );
                if (context) {
                    context._parentIndex = itemIndex;
                }
                return { context, inList: true, itemIndex, listItem, listElement };
            }
            return null;
        }

        const context = this._contextRegistry.createBindingContext(
            bindPath, instance, bindingElement
        );
        return { context, inList: false, itemIndex: 0, listItem: null, listElement: null };
    },
    /**
     * Process HTML binding elements
     * @private
     */
    _processHTMLBindingElements(instance)
    {
        if (!this._contextSystemInitialized) return;

        const {element} = instance;
        const htmlBindingElements = this._querySelfAndDescendants(element, this._attrSelector('bind-html'))
            .filter(el => this._isOwnedBindingElement(el, element));

        const markHtmlReady = (bindPath) => {
            if (instance._htmlContextsReady) {
                const propertyName = bindPath.startsWith('computed:') ? bindPath.slice(9) : bindPath;
                instance._htmlContextsReady.add(propertyName);
                if (instance.stateManager && typeof instance.stateManager._processHtmlInitialQueue === 'function') {
                    instance.stateManager._processHtmlInitialQueue();
                }
            }
        };

        htmlBindingElements.forEach(bindingElement => {
            const bindPath = this._getAttr(bindingElement, 'bind-html');
            if (!bindPath) return;

            const result = this._createListAwareBindingContext(bindingElement, bindPath, instance);
            if (!result) return;

            const { context: bindingContext } = result;
            if (bindingContext) {
                bindingContext._isHTMLBinding = true;
                markHtmlReady(bindPath);
            } else if (!result.inList) {
                if (__DEV__) console.error('CONTEXT SYSTEM: Failed to create HTML binding context for path:', bindPath);
            }

            if (instance._effectMeta) {
                instance._effectMeta.push({
                    element: bindingElement,
                    type: 'html',
                    path: bindPath,
                    isExpression: this.isExpression(bindPath) || bindPath.includes('$')
                });
            }
        });
    },
    /**
     * Process class binding elements
     * @private
     */
    _processClassBindingElements(instance)
    {
        if (!this._contextSystemInitialized) return;

        const {element} = instance;
        const classBindingElements = this._querySelfAndDescendants(element, this._attrSelector('bind-class'))
            .filter(el => this._isOwnedBindingElement(el, element));

        classBindingElements.forEach(bindingElement => {
            const bindPath = this._getAttr(bindingElement, 'bind-class');
            if (!bindPath) return;

            const result = this._createListAwareBindingContext(bindingElement, bindPath, instance);
            if (!result) return;

            const bindingContext = result.context ||
                (result.inList ? this._contextRegistry.getContextForElement(bindingElement) : null);
            if (bindingContext) {
                bindingContext._isClassBinding = true;
                const value = bindingContext.resolveData();
                bindingContext._updateClassBindingElement(value);
            }

            // See the matching guard in _processObjectBindingElements for the
            // rationale: don't register a component-level effect for in-list
            // elements, or the list-row machinery and the component effect
            // race to write competing values to the same chip.
            if (instance._effectMeta && !result.inList) {
                instance._effectMeta.push({
                    element: bindingElement,
                    type: 'class',
                    path: bindPath,
                    prevClasses: null,
                    isExpression: this.isExpression(bindPath) || bindPath.includes('$')
                });
            }
        });
    },
    /**
     * Unified processor for object binding elements (data-bind-style, data-bind-attr)
     * @private
     */
    _processObjectBindingElements(type, instance)
    {
        if (!this._contextSystemInitialized) return;

        const config = {
            style: { attrName: 'bind-style', flag: '_isStyleBinding', processMethod: '_processStyleBinding' },
            attr: { attrName: 'bind-attr', flag: '_isAttrBinding', processMethod: '_processAttrBinding' }
        };

        const cfg = config[type];
        if (!cfg) return;

        const {element} = instance;
        const bindingElements = this._querySelfAndDescendants(element, this._attrSelector(cfg.attrName))
            .filter(el => this._isOwnedBindingElement(el, element));

        bindingElements.forEach(bindingElement => {
            const expr = this._getAttr(bindingElement, cfg.attrName);
            if (!expr) return;

            const result = this._createListAwareBindingContext(bindingElement, expr, instance);
            if (!result) return;

            const { context: bindingContext, inList, itemIndex, listItem, listElement } = result;
            if (bindingContext) {
                bindingContext[cfg.flag] = true;
                if (inList) {
                    const item = listItem._itemData || {};
                    this[cfg.processMethod](bindingElement, item, expr, itemIndex, listElement._listContext);
                } else {
                    this[cfg.processMethod](bindingElement, null, expr, 0, null);
                }
            }

            // Only register a component-level effect for elements that are NOT
            // inside a data-list. List-row elements are updated by the list-row
            // machinery (PropsSystem._refreshListItemBindings + the binding
            // path through ListExpressionEval._processObjectBinding, which
            // resolves item[expr] first per the documented contract). Pushing
            // a component-effect meta for an in-list element causes a second
            // writer (the component-level computed of the same name) to race
            // the list-row writer — initial render usually shows the
            // component-computed value (race winner) and the list-row's per-row
            // field is silently shadowed. Surfaced 2026-05-17 (amber-otter-23)
            // via PM-demo team page: project chips bound to data-bind-style="iconStyle"
            // rendered the parent team's color most of the time, alternating
            // with the project's own color on reload (3/10 in Chrome, 2/10 in
            // Firefox). Sibling guard: see the listBoundElements check on
            // data-bind text in _processComponentBindingsFromCompiled — text
            // binds already had this guard; style/attr did not.
            if (instance._effectMeta && !inList) {
                instance._effectMeta.push({
                    element: bindingElement,
                    type: type,
                    path: expr,
                    isExpression: this.isExpression(expr) || expr.includes('$')
                });
            }
        });
    },
    /**
     * Process style binding elements (data-bind-style)
     * @param {Object} instance - Component instance
     * @private
     */
    _processStyleBindingElements(instance)
    {
        this._processObjectBindingElements('style', instance);
    },
    /**
     * Process attr binding elements (data-bind-attr)
     * @param {Object} instance - Component instance
     * @private
     */
    _processAttrBindingElements(instance)
    {
        this._processObjectBindingElements('attr', instance);
    },
    /**
     * Process model binding elements
     * @param {Object} instance - Component instance
     * @private
     */
    _processModelElements(instance)
    {
        if (!this._contextSystemInitialized) return;

        const {element, id: instanceId} = instance;

        // Find all model elements (including component root)
        const modelElements = this._querySelfAndDescendants(element, this._attrSelector('model'))
            .filter(el => this._isOwnedBindingElement(el, element));

        // Process each model element
        modelElements.forEach(modelElement =>
        {
            const modelPath = this._getAttr(modelElement, 'model');
            if (!modelPath) return;

            // WF-501: Warn if using $store.path in data-model (store paths are read-only)
            if (modelPath.includes('$')) {
                if (__DEV__) wfError(WF_ERRORS.MODEL_STORE_SHORTHAND, {
                    context: `data-model="${modelPath}"`,
                    suggestion: 'Use component state and an action that mediates writes back to the store.',
                    warn: true
                });
                return; // Skip this element - it's an invalid binding
            }

            // Collect effect metadata for ALL model elements (including web components)
            // The effect's _executeModelBindForEffect handles adapter-based property pushing
            if (instance._effectMeta) {
                const inputType = (modelElement.type || '').toLowerCase();
                instance._effectMeta.push({
                    element: modelElement,
                    type: 'model',
                    path: modelPath,
                    isExpression: false,
                    isCheckbox: inputType === 'checkbox',
                    isRadio: inputType === 'radio',
                    isSelectMultiple: modelElement.tagName === 'SELECT' && modelElement.multiple,
                    _webComponentAdapter: this._webComponentAdapters?.get(modelElement.tagName.toLowerCase()) || null
                });
            }

            // Skip context creation for custom elements — they are handled by
            // _bindWebComponentModel in FormHandling.js for DOM→state event wiring.
            // The effect handles state→DOM sync via the meta entry above.
            if (modelElement.tagName.toLowerCase().includes('-')) return;

            const result = this._createListAwareBindingContext(modelElement, modelPath, instance);
            if (!result) return;

            const { context: bindingContext } = result;
            if (bindingContext) {
                bindingContext._isModelBinding = true;
                this._cacheModelModifiers(modelElement, bindingContext);
            }
        });
    },
    /**
     * Set up event handling for model elements
     * @param {HTMLElement} element - The input element
     * @param {Context} context - The binding context
     * @private
     */
    _cacheModelModifiers(element, context)
    {
        // Cache model modifiers once at bind time so the document-level
        // _handleInputChange handler can read them from context without DOM access
        if (!context.modelModifiers) {
            const inputType = context.elementMeta?.inputType ?? element.type;
            context.modelModifiers = {
                trim: element.hasAttribute('data-model-trim'),
                number: element.hasAttribute('data-model-number'),
                lazy: element.hasAttribute('data-model-lazy'),
                event: (inputType === 'checkbox' || inputType === 'radio') ? 'change' : 'input'
            };
        }
        if (!context.elementMeta) {
            context.elementMeta = {
                inputType: element.type,
                tagName: element.tagName
            };
        }
        // No element-level event listeners — document-level _handleInputChange
        // handles all standard model events via capture phase delegation
    },
    /**
     * Process slots for component composition
     * @private
     */
    _processSlots(instance)
    {
        const {element} = instance;

        // Find all slot containers
        element.querySelectorAll('[data-slot-container]').forEach(container =>
        {
            const slotName = container.dataset.slotContainer;

            // Find matching slot content
            const slotContent = element.querySelector(`[data-slot="${slotName}"]`);
            if (slotContent)
            {
                // Clear container and append slot content
                container.innerHTML = '';
                container.appendChild(slotContent);


            }
        });
    },
    /**
     * Lazy initialization helpers - ensure data structures exist before use
     * @private
     */
    _ensureSet(propertyName) {
        if (!this[propertyName]) {
            this[propertyName] = new Set();
        }
        return this[propertyName];
    },
    /**
     * DOM traversal helpers - centralize common DOM queries
     * @private
     */
    /**
     * querySelectorAll that also includes the element itself if it matches.
     * Fixes bindings on component root elements (querySelectorAll only searches descendants).
     * Only includes the root element when no parent scope (list or component) owns it.
     */
    _querySelfAndDescendants(element, selector) {
        const results = Array.from(element.querySelectorAll(selector));
        if (element.matches(selector)) {
            // Only include root if no parent component/list owns this element's bindings
            const parent = element.parentElement;
            const parentOwner = parent ? parent.closest('[data-component], [data-component-id], [data-list], [data-wf-list]') : null;
            if (!parentOwner) {
                results.unshift(element);
            }
        }
        return results;
    },
    _getComponentElement(element) {
        return element ? element.closest(this._attrSelector('component')) : null;
    },
    /**
     * Check whether a binding element belongs to this component's direct scope.
     * Returns false for elements inside rendered templates, nested data-list
     * containers (handled by list rendering), or child components.
     * @param {HTMLElement} el - The binding element to check
     * @param {HTMLElement} componentElement - The component's root element
     * @returns {boolean}
     * @private
     */
    _isOwnedBindingElement(el, componentElement) {
        if (el.closest('[data-use-template-rendered]')) return false;
        // Only exclude elements INSIDE a list — the list root itself owns its own bindings
        // (bind-style, bind-class, bind-attr on the container are authored by the component,
        // not by the list renderer, which only manages children).
        const ancestorList = el.parentElement?.closest('[data-list]');
        if (ancestorList && ancestorList !== componentElement && componentElement.contains(ancestorList)) return false;
        const closestComponent = this._getComponentElement(el);
        if (closestComponent === componentElement) return true;
        // Parent claims bindings on direct child component root elements
        // (bindings on a component element are authored in the parent's template)
        if (closestComponent && closestComponent === el && componentElement.contains(el)) {
            const parentComp = el.parentElement?.closest('[data-component-id]');
            return parentComp === componentElement;
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
     * Get a value from an object using dot notation
     * @private
     */
    _getValueFromItem(item, path)
    {
        return pathResolver.get(item, path);
    },
    /**
     * Navigate to a DOM element using a pre-computed child index path
     * Used by compiled metadata to avoid querySelectorAll
     * @param {HTMLElement} root - The root element to start from
     * @param {number[]} path - Array of child indices to follow
     * @returns {HTMLElement|null} The target element or null if not found
     * @private
     */
    _getElementByPath(root, path) {
        if (!path || path.length === 0) return root;
        let current = root;
        for (let i = 0; i < path.length; i++) {
            if (!current.children || !current.children[path[i]]) return null;
            current = current.children[path[i]];
        }
        return current;
    },
    /**
     * Configuration for binding type collection
     * Centralizes the repetitive binding collection patterns
     * Supports both data-* and data-wf-* prefixes
     * @private
     */
    get _bindingTypeConfigs() {
        // classBindings/styleBindings removed — effects handle class and style binding updates
        return [
            { attribute: 'data-bind', altAttribute: 'data-wf-bind', collectionName: 'bindings' },
            { attribute: 'data-bind-html', altAttribute: 'data-wf-bind-html', collectionName: 'htmlBindings', datasetKey: 'bindHtml', altDatasetKey: 'wfBindHtml' },
            { attribute: 'data-show', altAttribute: 'data-wf-show', collectionName: 'conditionals' },
            { attribute: 'data-list', altAttribute: 'data-wf-list', collectionName: 'lists' },
            { attribute: 'data-model', altAttribute: 'data-wf-model', collectionName: 'models' },
            { attribute: 'data-pool', altAttribute: 'data-wf-pool', collectionName: 'pools' }
        ];
    },
//COMPONENT RELATIONSHIPS

    /**
     * Get all component instances of a specific type.
     *
     * @param {string} componentName - The component name to search for
     * @returns {Array<Object>} Array of matching component instances
     *
     * @example
     * // Get all counter components
     * const counters = wildflower.getComponentsByType('counter');
     * counters.forEach(c => console.log(c.state.count));
     *
     * @example
     * // Reset all forms
     * wildflower.getComponentsByType('form').forEach(form => {
     *   form.context.reset();
     * });
     */
    getComponentsByType(componentName)
    {
        return Array.from(this.componentInstances.values())
            .filter(instance => instance.name === componentName);
    },

    // ========================================================================
    // CONTEXT CLEANUP
    // ========================================================================

    /**
     * Clean up all contexts for elements in a subtree
     * Called before removing list items to prevent context accumulation (memory leak)
     * Context cleanup is deferred to requestIdleCallback
     * @param {HTMLElement} rootElement - The root element of the subtree
     * @private
     */
    _cleanupContextsInSubtree(rootElement) {
        if (!this._contextRegistry || !this._contextSystemInitialized) return;

        // Skip cleanup for SSR-adopted lists - they have special lifecycle management
        if (__FEATURE_SSR__) {
            const listParent = rootElement.closest('[data-list]');
            if (listParent && ssrAdoptedElements.has(listParent)) return;
        }

        // Quick check: if element has no context markers, skip expensive cleanup
        // This is a fast path for list items that never had interactions
        if (!rootElement._needsContexts && !rootElement._listContext && !rootElement._bindingContextId) {
            // Still need to clean up _listContext on descendants, but skip expensive context search
            const descendants = rootElement.querySelectorAll('[data-list]');
            for (const el of descendants) {
                if (el._listContext) delete el._listContext;
            }
            return;
        }

        // Collect all elements that might have contexts into a Set for O(1) lookup
        const elementsToClean = new Set([rootElement, ...rootElement.querySelectorAll('*')]);

        // Clean up _listContext references synchronously (cheap operation)
        for (const element of elementsToClean) {
            if (element._listContext) {
                delete element._listContext;
            }
        }

        // Defer context registry cleanup to requestIdleCallback
        // This is expensive (O(contexts) scan) but not user-visible
        this._scheduleDeferredCleanup(elementsToClean);
    },

    // ========================================================================
    // COMPONENT BINDING PIPELINE
    // ========================================================================

    /**
     * Process all data bindings for a component
     * @private
     */
    _processComponentBindings(instance)
    {
        const { element, id: instanceId, name: componentName } = instance;

        // ═══════════════════════════════════════════════════════════════════
        // JIT COMPILATION FAST PATH (Flyweight Pattern)
        // Try to use pre-compiled binding metadata for this component type
        // ═══════════════════════════════════════════════════════════════════
        const compiled = this._getCompiledComponentBindings(element, componentName);

        if (compiled) {
            // FAST PATH: Use pre-compiled element paths instead of querySelectorAll
            this._processComponentBindingsFromCompiled(instance, compiled);
        } else {
            // SLOW PATH: Fall back to DOM scanning (first instance or structure mismatch)
            this._processComponentBindingsFallback(instance);
        }

        if (this._contextSystemInitialized)
        {
            // Validate bindings BEFORE conditional processing (data-render removes elements)
            this._validateComponentBindings(instance);

            // Collect effect metadata during context creation (eliminates duplicate DOM scan)
            instance._effectMeta = [];

            // Process each binding type to create appropriate contexts
            this._processBindingElements(instance);
            this._processHTMLBindingElements(instance);
            this._processClassBindingElements(instance);
            this._processStyleBindingElements(instance);
            this._processAttrBindingElements(instance);
            this._processConditionalElements(instance);

            this._processModelElements(instance);
        }

        // Register all bindings with the state manager for dependency tracking
        this.domElements.bindings.forEach(binding =>
        {
            if (binding.componentId === instance.id)
            {
                const path = binding.path;

                // Handle expressions with property references
                if (path.includes(' '))
                {
                    // This is an expression that needs to be parsed
                    this._registerExpressionDependencies(instance, path);
                } else
                {
                    // Direct property reference
                    instance.stateManager.registerBindingDependency(path);
                }
            }
        });

        // Create Render Effect for component bindings
        // During scan batches, defer effect creation so all components in the batch
        // are initialized before effects run (avoids redundant re-execution)
        if (instance.stateManager?.createEffect) {
            if (this._pendingEffectInstances) {
                this._pendingEffectInstances.push(instance);
            } else {
                this._createComponentRenderEffect(instance);
            }
        }
    },

    /**
     * FAST PATH: Process bindings using pre-compiled element paths
     * Skips querySelectorAll entirely - uses O(depth) path traversal instead
     * @private
     */
    _processComponentBindingsFromCompiled(instance, compiled) {
        const { element, id: instanceId } = instance;

        // Ensure collections exist
        if (!this.domElements.bindings) this.domElements.bindings = [];
        if (!this.domElements.htmlBindings) this.domElements.htmlBindings = [];
        if (!this.domElements.conditionals) this.domElements.conditionals = [];
        if (!this.domElements.models) this.domElements.models = [];  // needed by dev-mode binding validation

        // Process data-bind elements
        for (const binding of compiled.bindings) {
            const el = this._getElementByPath(element, binding.elementPath);
            // Skip elements that have been bound by a list (prevent component from overwriting)
            // Also skip SSR list items (real DOM elements inside data-list within data-ssr components)
            const inSSRList = el && el.closest('[data-list],[data-wf-list]')?.closest('[data-ssr="true"]');
            if (el && !listBoundElements.has(el) && !inSSRList) {
                this.domElements.bindings.push({
                    element: el,
                    componentId: instanceId,
                    path: binding.path
                });
            }
        }

        // Process data-bind-html elements
        for (const binding of compiled.htmlBindings) {
            const el = this._getElementByPath(element, binding.elementPath);
            if (el) {
                this.domElements.htmlBindings.push({
                    element: el,
                    componentId: instanceId,
                    path: binding.path
                });
            }
        }

        // data-bind-class and data-bind-style — effects handle these, no domElements tracking needed

        // Process data-show elements (conditionals)
        for (const binding of compiled.shows) {
            const el = this._getElementByPath(element, binding.elementPath);
            if (el) {
                this.domElements.conditionals.push({
                    element: el,
                    componentId: instanceId,
                    path: binding.negate ? '!' + binding.path : binding.path
                });
            }
        }

        // Process data-model elements (event listeners + validation tracking — state→DOM sync handled by effects)
        for (const binding of compiled.models) {
            const el = this._getElementByPath(element, binding.elementPath);
            if (el) {
                this.domElements.models.push({
                    element: el,
                    componentId: instanceId,
                    path: binding.path
                });
                this._bindModelElement(el, instance);
            }
        }

        // Process data-list elements
        if (!this.domElements.lists) this.domElements.lists = [];
        for (const list of compiled.lists) {
            const el = this._getElementByPath(element, list.elementPath);
            if (el) {
                this.domElements.lists.push({
                    element: el,
                    componentId: instanceId,
                    path: list.path
                });
            }
        }

        // Process data-pool elements (entity pools)
        if (!this.domElements.pools) this.domElements.pools = [];
        if (compiled.pools) {
            for (const pool of compiled.pools) {
                const el = this._getElementByPath(element, pool.elementPath);
                if (el) {
                    this.domElements.pools.push({
                        element: el,
                        componentId: instanceId,
                        path: pool.path
                    });
                }
            }
        }

        // Note: data-render and data-action are handled separately by other systems
        // data-render: handled by _processConditionalElements
        // data-action: handled by _bindComponentActions
    },

    /**
     * SLOW PATH: Original DOM scanning approach
     * Used for first component instance or when DOM structure differs
     * @private
     */
    _processComponentBindingsFallback(instance) {
        // Collect elements with various binding attributes using config-driven approach
        // Supports both data-* and data-wf-* prefixes
        this._bindingTypeConfigs.forEach(config => {
            // Ensure collection exists
            if (!this.domElements[config.collectionName]) {
                this.domElements[config.collectionName] = [];
            }

            // Collect elements for this binding type (with alternate prefix support)
            this._collectElementsWithAttribute(
                instance,
                config.attribute,
                this.domElements[config.collectionName],
                config.datasetKey,
                config.altAttribute,
                config.altDatasetKey
            );
        });
    },
    // #region FEATURE_BINDING_VALIDATION
    // ==========================================
    // RUNTIME BINDING VALIDATION (Debug Mode Only)
    // ==========================================

    /**
     * Validate all bindings for a component against its state properties
     * Warns in debug mode when bindings reference undefined state properties
     * @param {Object} instance - The component instance
     * @private
     */
    _validateComponentBindings(instance) {
        if (!this.debug) return;

        const { state, name: componentName, id: componentId, element: componentElement } = instance;
        const stateKeys = Object.keys(state);

        // Include computed property names — they're valid binding targets
        if (instance.stateManager && instance.stateManager.computed) {
            const computedKeys = Object.keys(instance.stateManager.computed);
            for (const key of computedKeys) {
                if (!stateKeys.includes(key)) stateKeys.push(key);
            }
        }

        // Collect all binding paths from domElements (registered bindings)
        const bindingCollections = [
            { collection: this.domElements.bindings, pathKey: 'path', type: 'data-bind' },
            { collection: this.domElements.models, pathKey: 'path', type: 'data-model' },
            { collection: this.domElements.conditionals, pathKey: 'path', type: 'data-show' },
            { collection: this.domElements.htmlBindings, pathKey: 'path', type: 'data-bind-html' },
            { collection: this.domElements.lists, pathKey: 'path', type: 'data-list' }
        ];

        for (const { collection, pathKey, type } of bindingCollections) {
            if (!collection) continue;

            for (const binding of collection) {
                if (binding.componentId !== componentId) continue;

                const path = binding[pathKey];
                if (!path) continue;

                this._validateBindingPath(path, stateKeys, componentName, type, state);
            }
        }

        // Scan component DOM for data-render and data-bind-class attributes
        // These are not stored in global domElements, so we scan directly
        // IMPORTANT: Skip elements inside nested data-component scopes — those
        // belong to child components and will be validated when those initialize
        if (componentElement) {
            const isOwnedByThisComponent = (el) => {
                let parent = el.parentElement;
                while (parent && parent !== componentElement) {
                    if (parent.hasAttribute('data-component') || parent.hasAttribute('data-wf-component')) return false;
                    parent = parent.parentElement;
                }
                return true;
            };

            // Validate data-render bindings
            const renderElements = componentElement.querySelectorAll('[data-render],[data-wf-render]');
            renderElements.forEach(el => {
                if (!isOwnedByThisComponent(el)) return;
                const path = this._getAttr(el, 'render');
                if (path) {
                    this._validateBindingPath(path, stateKeys, componentName, 'data-render', state);
                }
            });

            // Validate data-bind-class expressions
            const classBindingElements = componentElement.querySelectorAll('[data-bind-class],[data-wf-bind-class]');
            classBindingElements.forEach(el => {
                if (!isOwnedByThisComponent(el)) return;
                const expression = this._getAttr(el, 'bind-class');
                if (expression) {
                    this._validateExpressionVariables(expression, stateKeys, componentName, 'data-bind-class', state);
                }
            });

            // Validate data-bind-style expressions
            const styleBindingElements = componentElement.querySelectorAll('[data-bind-style],[data-wf-bind-style]');
            styleBindingElements.forEach(el => {
                if (!isOwnedByThisComponent(el)) return;
                const expression = this._getAttr(el, 'bind-style');
                if (expression) {
                    this._validateStyleExpression(expression, stateKeys, componentName, state);
                }
            });

            // Validate data-action method references
            const actionElements = componentElement.querySelectorAll('[data-action],[data-wf-action]');
            actionElements.forEach(el => {
                if (!isOwnedByThisComponent(el)) return;
                const actionAttr = this._getAttr(el, 'action');
                if (actionAttr) {
                    this._validateActionMethods(actionAttr, instance, componentName);
                }
            });
        }
    },
    /**
     * Validate a single binding path against available state properties
     * @param {string} path - The binding path (e.g., "user.name", "count", "!isActive")
     * @param {Array<string>} stateKeys - Available state property names
     * @param {string} componentName - Name of the component for error messages
     * @param {string} bindingType - Type of binding (data-bind, data-model, etc.)
     * @private
     */
    _validateBindingPath(path, stateKeys, componentName, bindingType, state) {
        // Skip validation for special paths
        if (!path || typeof path !== 'string') return;

        // Skip computed: prefixed paths (these are computed properties)
        if (path.startsWith('computed:')) return;

        // Skip props. prefixed paths (these resolve via component props, not state)
        if (path.startsWith('props.') || path.startsWith('props:')) return;

        // Skip external() expressions (cross-component references)
        if (path.includes('external(')) return;

        // Skip $entity.path shorthand (normalized to external() at bind time)
        if (path.includes('$')) return;

        // Parse type hint from path (e.g., "price:number" -> path="price", typeHint="number")
        let typeHint = null;
        let actualPath = path;
        const typeHintMatch = path.match(/^([^:]+):(\w+)$/);
        if (typeHintMatch) {
            actualPath = typeHintMatch[1];
            typeHint = typeHintMatch[2];
        }

        // If the path contains expression operators, it's not a simple property
        // reference — delegate to the expression-variable validator so each
        // identifier in the expression is checked individually. Without this,
        // `data-show="activePattern === 'intro'"` would be treated as a single
        // property name `"activePattern === 'intro'"` and always report
        // "undefined state property".
        // Valid simple-path characters: word chars, dots (nested), and leading `!`.
        // Anything else (spaces, `=`, `&`, `|`, `?`, `>`, `<`, `+`, `*`, `(`, etc.)
        // means the attribute holds an expression.
        if (!/^!?[\w.]+$/.test(actualPath)) {
            this._validateExpressionVariables(actualPath, stateKeys, componentName, bindingType);
            return;
        }

        // Skip list context variables
        const listContextVars = ['_index', '_length', '_first', '_last', '_item'];
        const cleanPath = actualPath.replace(/^!/, ''); // Remove negation prefix
        const pathParts = cleanPath.split('.');
        const rootVar = pathParts[0];

        if (listContextVars.includes(rootVar)) return;

        // Check if root property exists in state
        if (!stateKeys.includes(rootVar)) {
            // Find similar property names for typo suggestions
            const suggestions = this._findSimilarPropertyNames(rootVar, stateKeys);
            let message = `[WF] Binding validation: ${bindingType}="${actualPath}" references undefined state property "${rootVar}" in component "${componentName}"`;

            if (suggestions.length > 0) {
                message += `. Did you mean: ${suggestions.join(', ')}?`;
            }

            message += ` Available properties: ${stateKeys.join(', ')}`;
            if (__DEV__) console.warn(message);
            return;
        }

        // Check nested path if state object is provided and path has multiple parts
        let finalValue = state ? state[rootVar] : undefined;
        if (state && pathParts.length > 1) {
            let currentObj = state[rootVar];
            for (let i = 1; i < pathParts.length; i++) {
                const part = pathParts[i];
                if (currentObj === null || currentObj === undefined) {
                    // Parent is null/undefined, can't validate further
                    finalValue = undefined;
                    break;
                }
                if (typeof currentObj !== 'object') {
                    // Parent is not an object, can't have nested properties
                    finalValue = undefined;
                    break;
                }
                if (!(part in currentObj)) {
                    // Nested property doesn't exist - find similar property names
                    const availableProps = Object.keys(currentObj);
                    const suggestions = this._findSimilarPropertyNames(part, availableProps);
                    const parentPath = pathParts.slice(0, i).join('.');
                    let message = `[WF] Binding validation: ${bindingType}="${actualPath}" references undefined property "${part}" on "${parentPath}" in component "${componentName}"`;

                    if (suggestions.length > 0) {
                        message += `. Did you mean: ${suggestions.join(', ')}?`;
                    }

                    message += ` Available properties: ${availableProps.join(', ')}`;
                    if (__DEV__) console.warn(message);
                    return;
                }
                currentObj = currentObj[part];
                finalValue = currentObj;
            }
        }

        // Validate type hint against actual value
        if (typeHint && finalValue !== undefined) {
            const actualType = this._inferTypeFromValue(finalValue);
            if (actualType !== typeHint && actualType !== 'any') {
                if (__DEV__) console.warn(
                    `[WF] Type hint mismatch in component "${componentName}": ` +
                    `${bindingType}="${path}" expects ${typeHint} but property "${actualPath}" has type ${actualType}. ` +
                    `Value: ${JSON.stringify(finalValue)}`
                );
            }
        }
    },
    /**
     * Validate variables in an expression (like data-bind-class expressions)
     * @param {string} expression - The expression to validate
     * @param {Array<string>} stateKeys - Available state property names
     * @param {string} componentName - Name of the component for error messages
     * @param {string} bindingType - Type of binding
     * @private
     */
    _validateExpressionVariables(expression, stateKeys, componentName, bindingType) {
        // Skip $entity.path shorthand (normalized to external() at bind time)
        if (expression && expression.includes('$')) return;

        // Strip computed: prefix before validation — it's a runtime hint, not a variable
        const cleanExpression = expression.replace(/\bcomputed:/g, '');

        // Remove string literals before extracting identifiers — words inside
        // quotes ('priority-option high') are not variable references
        const noStrings = cleanExpression.replace(/'[^']*'|"[^"]*"/g, '');

        // Extract variable names — only ROOT identifiers, not property accesses.
        // `(?<!\.)` lookbehind excludes identifiers preceded by a dot so that
        // `events.length` produces `['events']` not `['events', 'length']`.
        // Without this, built-in props like .length/.includes/.toLowerCase()
        // appear as "undefined state property" — noisy false positives.
        const propertyRegex = /(?<!\.)\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
        const matches = noStrings.match(propertyRegex);

        if (!matches) return;

        // Reserved words and keywords to skip
        const reserved = new Set([
            'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
            'if', 'else', 'return', 'typeof', 'instanceof', 'new', 'this',
            'external', 'Math', 'Date', 'String', 'Number', 'Boolean', 'Array', 'Object',
            'function', 'var', 'let', 'const', 'for', 'while',
            // List context variables
            '_index', '_length', '_first', '_last', '_item'
        ]);

        const checkedVars = new Set();

        for (const varName of matches) {
            // Skip reserved words, already checked vars, and string literals
            if (reserved.has(varName) || checkedVars.has(varName)) continue;
            checkedVars.add(varName);

            // Check if this variable exists in state
            if (!stateKeys.includes(varName)) {
                const suggestions = this._findSimilarPropertyNames(varName, stateKeys);
                let message = `[WF] Binding validation: ${bindingType} expression "${expression}" references undefined state property "${varName}" in component "${componentName}"`;

                if (suggestions.length > 0) {
                    message += `. Did you mean: ${suggestions.join(', ')}?`;
                }

                message += ` Available properties: ${stateKeys.join(', ')}`;
                if (__DEV__) console.warn(message);
            }
        }
    },
    /**
     * Validate variables in a data-bind-style expression
     * Style bindings use { cssProperty: stateVar } format — only validate VALUE-side identifiers
     * @param {string} expression - The style expression (e.g., "{ color: textColor }")
     * @param {Array<string>} stateKeys - Available state property names
     * @param {string} componentName - Name of the component for error messages
     * @param {Object} state - The component state object
     * @private
     */
    _validateStyleExpression(expression, stateKeys, componentName, state) {
        const trimmed = expression.trim();

        // Object syntax: { cssProperty: stateVar, ... }
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const inner = trimmed.slice(1, -1).trim();
            if (!inner) return;

            // Split on commas (respecting nested structures)
            const pairs = inner.split(',');
            for (const pair of pairs) {
                const colonIdx = pair.indexOf(':');
                if (colonIdx === -1) continue;

                // Only validate the VALUE side (after the colon) — the KEY side is a CSS property name
                const valuePart = pair.substring(colonIdx + 1).trim();
                if (!valuePart) continue;

                // The value might be a simple identifier or an expression
                this._validateExpressionVariables(valuePart, stateKeys, componentName, 'data-bind-style', state);
            }
            return;
        }

        // Non-object syntax: treat as expression (bare property name or expression)
        this._validateExpressionVariables(expression, stateKeys, componentName, 'data-bind-style', state);
    },
    /**
     * Validate action method references against available component methods
     * @param {string} actionAttr - The data-action attribute value (e.g., "click:save", "increment", "save('draft')")
     * @param {Object} instance - The component instance
     * @param {string} componentName - Name of the component for error messages
     * @private
     */
    _validateActionMethods(actionAttr, instance, componentName) {
        // Parse action definitions using the framework's parser if available
        const actionDefs = typeof this._parseActions === 'function'
            ? this._parseActions(actionAttr)
            : this._parseActionDefsSimple(actionAttr);

        const context = instance.context;
        if (!context) return;

        // Collect available method names for suggestions
        const methodNames = Object.keys(context).filter(k => typeof context[k] === 'function');

        for (const { methodName } of actionDefs) {
            if (!methodName) continue;

            if (typeof context[methodName] !== 'function') {
                const suggestions = this._findSimilarPropertyNames(methodName, methodNames);
                let message = `[WF] Binding validation: data-action references undefined method "${methodName}" in component "${componentName}"`;

                if (suggestions.length > 0) {
                    message += `. Did you mean: ${suggestions.join(', ')}?`;
                }

                message += ` Available methods: ${methodNames.join(', ')}`;
                if (__DEV__) console.warn(message);
            }
        }
    },
    /**
     * Simple fallback parser for action definitions when _parseActions is not available
     * @param {string} actionAttr - The data-action attribute value
     * @returns {Array<{eventType: string, methodName: string}>}
     * @private
     */
    _parseActionDefsSimple(actionAttr) {
        const results = [];
        const parts = actionAttr.trim().split(/\s+/);

        for (const part of parts) {
            let methodPart = part;
            const parenStart = part.indexOf('(');
            const colonIdx = part.indexOf(':');

            // Handle event:method format (colon before any parenthesis)
            if (colonIdx !== -1 && (parenStart === -1 || colonIdx < parenStart)) {
                methodPart = part.substring(colonIdx + 1);
            }

            // Strip argument list: method(args) -> method
            const parenIdx = methodPart.indexOf('(');
            if (parenIdx !== -1) {
                methodPart = methodPart.substring(0, parenIdx);
            }

            results.push({ eventType: 'click', methodName: methodPart });
        }

        return results;
    },
    /**
     * Find property names similar to the given name (for typo suggestions)
     * Uses Levenshtein distance for fuzzy matching
     * @param {string} name - The property name to find matches for
     * @param {Array<string>} candidates - Available property names
     * @returns {Array<string>} - Similar property names
     * @private
     */
    _findSimilarPropertyNames(name, candidates) {
        const maxDistance = Math.max(2, Math.floor(name.length / 3));
        const similar = [];

        for (const candidate of candidates) {
            const distance = this._levenshteinDistance(name.toLowerCase(), candidate.toLowerCase());
            if (distance <= maxDistance && distance > 0) {
                similar.push(candidate);
            }
        }

        return similar.slice(0, 3); // Return top 3 suggestions
    },
    /**
     * Calculate Levenshtein distance between two strings
     * @param {string} a - First string
     * @param {string} b - Second string
     * @returns {number} - Edit distance
     * @private
     */
    _levenshteinDistance(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = [];

        // Initialize matrix
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        // Fill matrix
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    },
    // ==========================================
    // Type inference
    // ==========================================

    /**
     * Infer types from initial state values
     * Creates a type map for all top-level state properties
     * @param {Object} state - The component's initial state object
     * @returns {Object} - Map of property names to inferred type strings
     * @private
     */
    _inferTypesFromState(state) {
        if (!state || typeof state !== 'object') {
            return {};
        }

        const types = {};

        for (const key of Object.keys(state)) {
            types[key] = this._inferTypeFromValue(state[key]);
        }

        return types;
    },
    /**
     * Infer the type of a single value
     * @param {*} value - The value to infer the type of
     * @returns {string} - The inferred type ('string', 'number', 'boolean', 'array', 'object', 'function', 'any')
     * @private
     */
    _inferTypeFromValue(value) {
        if (value === null || value === undefined) {
            return 'any'; // Can't infer type from null/undefined
        }

        if (Array.isArray(value)) {
            return 'array';
        }

        const jsType = typeof value;

        switch (jsType) {
            case 'string':
                return 'string';
            case 'number':
                return 'number';
            case 'boolean':
                return 'boolean';
            case 'object':
                return 'object';
            case 'function':
                return 'function';
            default:
                return 'any';
        }
    },
    // ==========================================
    // Runtime type checking
    // ==========================================

    /**
     * Check if a value matches the expected type for a property
     * Emits a console warning if there's a type mismatch
     * @param {Object} component - The component instance
     * @param {string} prop - The property name being set
     * @param {*} value - The new value being assigned
     * @returns {boolean} - True if types match or no type defined, false if mismatch
     * @private
     */
    _checkTypeMatch(component, prop, value) {
        // Only check in debug mode
        if (!this.debug && !this.options?.debug) {
            return true;
        }

        // Get expected type from component's type map
        const expectedType = component?._types?.[prop];

        // No type defined or 'any' type - skip checking
        if (!expectedType || expectedType === 'any') {
            return true;
        }

        // Get actual type of the new value
        const actualType = this._inferTypeFromValue(value);

        // Check if types match
        if (actualType !== expectedType) {
            // Allow null/undefined for any type (they become 'any')
            if (actualType === 'any') {
                return true;
            }

            if (__DEV__) console.warn(
                `[WF] Type mismatch in component "${component.name}": ` +
                `Property "${prop}" expects ${expectedType} but received ${actualType}. ` +
                `Value: ${JSON.stringify(value)}`
            );
            return false;
        }

        return true;
    },
    // #endregion FEATURE_BINDING_VALIDATION

    // Add a new method to handle expression dependencies
    _registerExpressionDependencies(instance, expression)
    {
        // Simple expression parser to find property references
        const propertyRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\b/g;
        const matches = expression.match(propertyRegex);

        if (matches)
        {
            // Register each property found in the expression
            matches.forEach(prop =>
            {
                // Skip JavaScript keywords and operators
                const keywords = ['true', 'false', 'null', 'undefined', 'this', 'function',
                    'return', 'if', 'else', 'for', 'while', 'var', 'let', 'const'];
                if (!keywords.includes(prop))
                {
                    instance.stateManager.registerBindingDependency(prop);
                }
            });
        }
    },

    // =========================================================================
    // Effect-Based Component Binding Rendering
    // =========================================================================

    /**
     * Create a Render Effect for a component that updates all bindings.
     * Instead of individual Context updates, one Effect handles all bindings.
     *
     * @param {Object} instance - Component instance
     * @returns {Function|null} Stop function to dispose the Effect, or null if not created
     * @private
     */
    _createComponentRenderEffect(instance) {
        const stateManager = instance?.stateManager;
        if (!stateManager?.createEffect) {
            return null;
        }

        // Use pre-collected metadata (populated during context creation or data-render re-insertion)
        const bindingMeta = instance._effectMeta;
        instance._effectMeta = null;
        if (!bindingMeta || bindingMeta.length === 0) {
            return null;
        }

        const self = this;

        // Create the Render Effect
        const stopEffect = stateManager.createEffect(() => {
            self._executeComponentBindingsForEffect(instance, bindingMeta);
        }, {
            scope: instance,
            name: __DEV__ ? `component:${instance.name}` : undefined
        });

        instance._renderEffect = stopEffect;
        return stopEffect;
    },

    /**
     * Dispose a component's Render Effect.
     * @param {Object} instance - Component instance
     * @private
     */
    _disposeComponentRenderEffect(instance) {
        if (instance._renderEffect) {
            instance._renderEffect();
            instance._renderEffect = null;
        }
    },

    /**
     * Collect binding metadata by scanning the component's DOM.
     * Called by data-render re-insertion (ContextManager._reinsertContent)
     * where the full component needs a fresh scan — init-time _effectMeta
     * can't be reused because only a subtree was re-inserted.
     *
     * During normal init, _process*Elements populate _effectMeta instead,
     * avoiding this DOM scan entirely.
     *
     * @param {Object} instance - Component instance
     * @returns {Array} Array of binding metadata objects
     * @private
     */
    _collectComponentBindingMeta(instance) {
        const meta = [];
        const element = instance.element;

        // Helper to check if element belongs to this component (not nested)
        const belongsToComponent = (el) => {
            if (listBoundElements.has(el)) return false; // Skip list-bound elements
            if (el.closest('[data-use-template-rendered]')) return false; // Skip slot template bindings
            // SSR lists: Skip elements inside data-list containers within SSR components
            // (SSR list items exist as real DOM elements before the list renderer runs,
            // so listBoundElements won't catch them yet — use DOM check instead)
            const listAncestor = el.closest('[data-list], [data-wf-list]');
            if (listAncestor && listAncestor.closest('[data-ssr="true"]')) return false;
            // Use data-component (not data-component-id) to detect component boundaries.
            // Nested components may not have data-component-id yet during init batches.
            const closestComp = el.closest('[data-component], [data-wf-component]');
            if (closestComp === element) return true;
            // Parent claims bindings on direct child component root elements
            if (closestComp && closestComp === el && element.contains(el)) {
                const parentComp = el.parentElement?.closest('[data-component], [data-wf-component]');
                return parentComp === element;
            }
            return false;
        };

        // Helper: detect expression paths that need evaluateExpression()
        // rather than simple getValue(). Covers operators, ternary, external(),
        // object literals, and $store.path references.
        const needsExprEval = (path) => this.isExpression(path) || path.includes('$');

        // Collect data-bind elements
        const bindSelector = this._attrSelector('bind');
        this._querySelfAndDescendants(element, bindSelector).forEach(el => {
            if (!belongsToComponent(el)) return;
            const path = this._getAttr(el, 'bind');
            if (path) {
                const entry = {
                    element: el,
                    type: 'bind',
                    path: path,
                    isInput: el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT',
                    isExpression: needsExprEval(path)
                };
                if (el.tagName.includes('-')) entry.isWebComponent = true;
                meta.push(entry);
            }
        });

        // Collect data-bind-html elements
        const htmlSelector = this._attrSelector('bind-html');
        this._querySelfAndDescendants(element, htmlSelector).forEach(el => {
            if (!belongsToComponent(el)) return;
            const path = this._getAttr(el, 'bind-html');
            if (path) {
                meta.push({
                    element: el,
                    type: 'html',
                    path: path,
                    isExpression: needsExprEval(path)
                });
            }
        });

        // Collect data-show elements
        const showSelector = this._attrSelector('show');
        this._querySelfAndDescendants(element, showSelector).forEach(el => {
            if (!belongsToComponent(el)) return;
            const path = this._getAttr(el, 'show');
            if (path) {
                const negate = path.startsWith('!');
                const cleanPath = negate ? path.slice(1) : path;
                meta.push({
                    element: el,
                    type: 'show',
                    path: cleanPath,
                    negate: negate,
                    isExpression: needsExprEval(cleanPath)
                });
            }
        });

        // Collect data-bind-class elements
        const classSelector = this._attrSelector('bind-class');
        this._querySelfAndDescendants(element, classSelector).forEach(el => {
            if (!belongsToComponent(el)) return;
            const expression = this._getAttr(el, 'bind-class');
            if (expression) {
                meta.push({
                    element: el,
                    type: 'class',
                    path: expression,
                    prevClasses: null, // Track previous classes for removal
                    isExpression: needsExprEval(expression)
                });
            }
        });

        // Collect data-bind-style elements
        const styleSelector = this._attrSelector('bind-style');
        this._querySelfAndDescendants(element, styleSelector).forEach(el => {
            if (!belongsToComponent(el)) return;
            const expression = this._getAttr(el, 'bind-style');
            if (expression) {
                meta.push({
                    element: el,
                    type: 'style',
                    path: expression,
                    isExpression: needsExprEval(expression)
                });
            }
        });

        // Collect data-bind-attr elements
        const attrSelector = this._attrSelector('bind-attr');
        this._querySelfAndDescendants(element, attrSelector).forEach(el => {
            if (!belongsToComponent(el)) return;
            const expression = this._getAttr(el, 'bind-attr');
            if (expression) {
                meta.push({
                    element: el,
                    type: 'attr',
                    path: expression,
                    isExpression: needsExprEval(expression)
                });
            }
        });

        // Collect data-model elements (state→DOM sync only; DOM→state is event-driven)
        const modelSelector = this._attrSelector('model');
        this._querySelfAndDescendants(element, modelSelector).forEach(el => {
            if (!belongsToComponent(el)) return;
            const path = this._getAttr(el, 'model');
            if (path) {
                const inputType = (el.type || '').toLowerCase();
                const tagName = element.tagName;
                meta.push({
                    element: el,
                    type: 'model',
                    path: path,
                    isExpression: false,
                    isCheckbox: inputType === 'checkbox',
                    isRadio: inputType === 'radio',
                    isSelectMultiple: el.tagName === 'SELECT' && el.multiple,
                    _webComponentAdapter: this._webComponentAdapters?.get(el.tagName.toLowerCase()) || null
                });
            }
        });

        return meta;
    },

    /**
     * Execute all component bindings within Effect context.
     * This is called by the Render Effect when dependencies change.
     *
     * @param {Object} instance - Component instance
     * @param {Array} bindingMeta - Array of binding metadata
     * @private
     */
    _executeComponentBindingsForEffect(instance, bindingMeta) {
        const stateManager = instance.stateManager;

        for (const meta of bindingMeta) {
            // Read value via reactive proxy (establishes dependency tracking)
            let value;
            try {
                value = meta.isExpression
                    ? this._resolveEffectExpression(meta.path, instance)
                    : stateManager.getValue(meta.path);
            } catch (e) {
                if (__DEV__) wfError(WF_ERRORS.EFFECT_PATH, {
                    context: `"${meta.path}"`,
                    cause: e,
                    warn: true
                });
                continue;
            }

            // Update the DOM based on binding type
            switch (meta.type) {
                case 'bind':
                    this._executeBindForEffect(meta, value);
                    break;
                case 'html':
                    this._executeHtmlBindForEffect(meta, value, instance);
                    break;
                case 'show':
                    this._executeShowForEffect(meta, value, instance);
                    break;
                case 'class':
                    this._executeClassBindForEffect(meta, value);
                    break;
                case 'style':
                    this._executeStyleBindForEffect(meta, value, instance);
                    break;
                case 'attr':
                    this._executeAttrBindForEffect(meta, value, instance);
                    break;
                case 'model':
                    this._executeModelBindForEffect(meta, value);
                    break;
            }
        }
    },

    /**
     * Resolve an expression binding value within Effect context.
     * Reads from the reactive proxy (establishing dependencies) and evaluates
     * expressions, $store references, external() calls via the expression evaluator.
     *
     * @param {string} path - The binding expression
     * @param {Object} instance - Component instance
     * @returns {*} The resolved value
     * @private
     */
    _resolveEffectExpression(path, instance) {
        const stateManager = instance.stateManager;

        // Normalize $store.path → external('store', 'path')
        let normalized = path.includes('$')
            ? this._normalizeStoreShorthands(path)
            : path;

        // Quote unquoted kebab-case keys in object literals (e.g., { data-status: x } → { 'data-status': x })
        // These are valid in WildflowerJS attribute syntax but not valid JavaScript
        if (normalized.includes('-') && normalized.includes('{')) {
            normalized = normalized.replace(/(\{|,)\s*([a-zA-Z][\w]*(?:-[\w]+)+)\s*:/g, "$1 '$2':");
        }

        // Provide the external() function for cross-component references
        const additionalContext = normalized.includes('external(')
            ? { external: this._getExternalFn(instance) }
            : undefined;

        return this.evaluateExpression(normalized, instance.state || {}, {
            stateManager: stateManager,
            cacheKey: 'effect',
            additionalContext
        });
    },

    /**
     * Execute data-bind for Effect.
     * @private
     */
    _executeBindForEffect(meta, value) {
        const el = meta.element;

        // Web component adapter: set property, never textContent (destroys light DOM)
        if (meta.isWebComponent) {
            const adapter = this.getAdapter(el.tagName.toLowerCase(), el);
            if (adapter) {
                if (el[adapter.prop] !== value) {
                    el[adapter.prop] = value;
                }
            }
            return;
        }

        const strValue = value == null ? '' : String(value);

        if (meta.isInput) {
            if (el.value !== strValue) {
                el.value = strValue;
            }
        } else {
            if (el.textContent !== strValue) {
                el.textContent = strValue;
            }
        }
    },

    /**
     * Execute data-bind-html for Effect.
     * @private
     */
    _executeHtmlBindForEffect(meta, value, instance) {
        const el = meta.element;
        const htmlValue = value == null ? '' : String(value);
        const sanitized = this._sanitizeOrPassHTML(htmlValue);

        if (el.innerHTML !== sanitized) {
            this._updateHTMLWithPreservation(el, sanitized);

            // Rebind actions/models in the new DOM (deferred for re-entrancy safety)
            setTimeout(() => {
                this._bindComponentActions(instance);

                const modelElements = el.querySelectorAll(this._attrSelector('model'));
                modelElements.forEach(modelEl => {
                    if (this._getComponentElement(modelEl) === instance.element) {
                        this._bindModelElement(modelEl, instance);
                    }
                });

                this._scanForDynamicComponents();
            }, 0);
        }
    },

    /**
     * Execute data-show for Effect.
     * @private
     */
    _executeShowForEffect(meta, value, instance) {
        const el = meta.element;
        const shouldShow = meta.negate ? !value : Boolean(value);

        if (__FEATURE_TRANSITIONS__ && el.dataset && el.dataset.transition) {
            // Delegate to existing TransitionSystem with a minimal show-mode context
            if (this._handleTransitionedVisibilityChange) {
                const showContext = {
                    mode: 'show',
                    element: el,
                    _updateConditionalElement(isVisible) {
                        el.style.display = isVisible ? '' : 'none';
                    }
                };
                this._handleTransitionedVisibilityChange(el, showContext, shouldShow, instance);
            }
            return;
        }

        const newDisplay = shouldShow ? '' : 'none';
        if (el.style.display !== newDisplay) {
            el.style.display = newDisplay;
        }
    },

    /**
     * Evaluate the visibility verdict for a cloaked element about to have its
     * data-cloak attribute stripped. Returns false when data-show resolves
     * falsy (element should be hidden), true otherwise (no data-show, truthy
     * verdict, or evaluation gave up — fail-open so we never accidentally hide
     * something the user expects to see).
     *
     * Used by the cloak-strip rAF in FrameworkInit and ComponentScanning to
     * commit the same display verdict the render effect would have written,
     * synchronously with attribute removal. Closes the race where a cloak
     * strip lands before the data-show binding effect has run (or has finished
     * re-running after init-time state mutations).
     *
     * Uses the SAME expression evaluator (`_resolveEffectExpression`) that the
     * render effect uses, so the verdict is identical to what a subsequent
     * effect run would produce — making the eventual effect re-run idempotent.
     * Outside an active effect context, reads do not register dependencies, so
     * this introduces no spurious tracking.
     *
     * @param {HTMLElement} el - Element with [data-cloak] about to be stripped
     * @returns {boolean} False if data-show is falsy (should hide), true otherwise
     * @private
     */
    _evaluateCloakShowVerdict(el) {
        const showAttr = this._getAttr ? this._getAttr(el, 'show') : el.getAttribute('data-show');
        if (!showAttr) return true;
        const componentEl = this._getComponentElement(el);
        if (!componentEl) return true;
        const componentId = componentEl.dataset && componentEl.dataset.componentId;
        if (!componentId) return true;
        const instance = this.componentInstances.get(componentId);
        if (!instance || !this._resolveEffectExpression) return true;
        try {
            const negate = showAttr.charAt(0) === '!';
            const path = negate ? showAttr.slice(1) : showAttr;
            const value = this._resolveEffectExpression(path, instance);
            return negate ? !value : Boolean(value);
        } catch (e) {
            // Fail open: don't hide if evaluation throws (preserves prior behavior
            // where show effect's `continue` left display unchanged on error).
            return true;
        }
    },

    /**
     * Strip data-cloak from an element, deferring if its nearest [data-component]
     * ancestor is registered but not yet initialized (no data-component-id).
     *
     * Late-registered components — defer-loaded scripts whose wildflower.component
     * call runs after the framework's initial scan — only initialize their DOM
     * elements when their definition is registered. If the cloak-strip rAF runs
     * before that registration, stripping cloak makes the element visible before
     * the render effect has had a chance to write display:none, causing the
     * "appear then hide" flash the user reported in Chrome.
     *
     * The deferred strip is picked up by the per-component pass in
     * _initializeComponentElement, which runs after the render effect's first
     * synchronous run has already set display correctly.
     *
     * When not deferred, commits the data-show visibility verdict (if present)
     * before removing the attribute. See _evaluateCloakShowVerdict for verdict
     * semantics.
     *
     * @param {HTMLElement} el - Element carrying [data-cloak]
     * @returns {boolean} True if the strip ran, false if it was deferred
     * @private
     */
    _stripCloakWithVerdict(el) {
        const componentEl = this._getComponentElement(el);
        if (componentEl && !(componentEl.dataset && componentEl.dataset.componentId)) {
            // Ancestor component is registered (has data-component) but not yet
            // initialized (no data-component-id). Skip — the per-component strip
            // pass after init will handle it.
            return false;
        }
        if (!this._evaluateCloakShowVerdict(el)) {
            if (el.style.display !== 'none') el.style.display = 'none';
        }
        el.removeAttribute('data-cloak');
        return true;
    },

    /**
     * Execute data-bind-class for Effect.
     * @private
     */
    _executeClassBindForEffect(meta, value) {
        const el = meta.element;

        // Remove previous classes added by this binding
        if (meta.prevClasses) {
            meta.prevClasses.forEach(cls => {
                if (cls) el.classList.remove(cls);
            });
        }

        // Apply new classes
        const newClasses = new Set();

        if (typeof value === 'string') {
            // String value - space-separated class names
            value.split(/\s+/).forEach(cls => {
                if (cls) {
                    el.classList.add(cls);
                    newClasses.add(cls);
                }
            });
        } else if (typeof value === 'object' && value !== null) {
            // Object value - keys are class names, values are booleans
            Object.keys(value).forEach(cls => {
                if (value[cls]) {
                    el.classList.add(cls);
                    newClasses.add(cls);
                } else {
                    el.classList.remove(cls);
                }
            });
        }

        meta.prevClasses = newClasses;
    },

    /**
     * Execute data-bind-style for Effect.
     * @private
     */
    _executeStyleBindForEffect(meta, value, instance) {
        const el = meta.element;

        if (typeof value === 'object' && value !== null) {
            // Object value - keys are style properties, values are style values
            Object.keys(value).forEach(prop => {
                const styleValue = value[prop];
                if (prop.startsWith('--')) {
                    // CSS custom properties require setProperty/removeProperty
                    if (styleValue == null) {
                        el.style.removeProperty(prop);
                    } else {
                        el.style.setProperty(prop, styleValue);
                    }
                } else {
                    // Regular properties: use direct assignment (handles camelCase and kebab-case)
                    // setProperty only accepts kebab-case, but users write camelCase in JS objects
                    el.style[prop] = styleValue == null ? '' : styleValue;
                }
            });
        } else if (typeof value === 'string') {
            // String value - treat as cssText
            el.style.cssText = value;
        }
    },

    /**
     * Execute data-bind-attr for Effect.
     * @private
     */
    _executeAttrBindForEffect(meta, value, instance) {
        const el = meta.element;

        if (typeof value === 'object' && value !== null) {
            // Object value - keys are attribute names, values are attribute values
            // Apply the same blocklist and sanitization as the list rendering path
            Object.keys(value).forEach(attr => {
                if (this._isBlocklistedAttr && this._isBlocklistedAttr(attr)) return;
                const attrValue = value[attr];
                const sanitized = this._sanitizeAttrValue
                    ? this._sanitizeAttrValue(attr, attrValue)
                    : attrValue;
                if (sanitized == null || sanitized === false) {
                    if (el.hasAttribute(attr)) el.removeAttribute(attr);
                } else if (sanitized === true) {
                    if (el.getAttribute(attr) !== '') el.setAttribute(attr, '');
                } else {
                    // Skip the write if the attribute already holds the same value —
                    // some elements (notably <video>) reload their resource when `src`
                    // is set even to an identical string.
                    const strValue = String(sanitized);
                    if (el.getAttribute(attr) !== strValue) {
                        el.setAttribute(attr, strValue);
                    }
                }
            });
        }
    },

    /**
     * Execute data-model state→DOM sync for Effect.
     * Only handles the state→DOM direction; DOM→state is event-driven
     * (handled by _bindModelElement's addEventListener setup).
     * @private
     */
    _executeModelBindForEffect(meta, value) {
        const el = meta.element;

        // Skip if element is focused AND the value matches what's already in the DOM.
        // This prevents cursor jumping during typing (where state→DOM sync would
        // move the cursor to the end on each keystroke). But when state is set to a
        // DIFFERENT value programmatically (e.g., clearing the input after form submit),
        // we must push the new value even while focused.
        if (document.activeElement === el) {
            const domValue = el.value;
            const stateStr = value == null ? '' : String(value);
            if (domValue === stateStr) return;
        }

        // Skip list items — handled by list rendering system
        if (listBoundElements.has(el)) return;

        // Web Component adapter
        if (meta._webComponentAdapter) {
            const tagName = el.tagName.toLowerCase();
            // Defer property push if custom element hasn't upgraded yet —
            // properties set before upgrade are shadowed by the class constructor.
            // After whenDefined, allow a frame for internal rendering (Lit-based etc).
            if (tagName.includes('-') && typeof customElements !== 'undefined' && !customElements.get(tagName)) {
                const adapter = meta._webComponentAdapter;
                customElements.whenDefined(tagName).then(() => {
                    const ready = adapter.ready ? adapter.ready(el) : new Promise(r => requestAnimationFrame(r));
                    ready.then(() => {
                        el[adapter.prop] = value;
                    });
                });
                return;
            }
            const currentVal = el[meta._webComponentAdapter.prop];
            if (currentVal !== value) {
                el[meta._webComponentAdapter.prop] = value;
            }
            return;
        }

        if (meta.isCheckbox) {
            const isChecked = !!value;
            if (el.checked !== isChecked) {
                el.checked = isChecked;
            }
        } else if (meta.isRadio) {
            const shouldBeChecked = el.value === String(value);
            if (el.checked !== shouldBeChecked) {
                el.checked = shouldBeChecked;
            }
        } else if (meta.isSelectMultiple) {
            const values = Array.isArray(value) ? value.map(String) : [];
            Array.from(el.options).forEach(opt => {
                opt.selected = values.includes(opt.value);
            });
        } else {
            const strValue = value == null ? '' : String(value);
            if (el.value !== strValue) {
                el.value = strValue;
            }
        }
    }
};
