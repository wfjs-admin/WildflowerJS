/**
 * PortalSystem - Portal teleportation
 *
 * @module
 */

import { pathResolver } from '../core/wfUtils.js';
import {
    actionBoundElements, modelBoundElements,
    portalMetaCache, listItemContextCache, portalListItemContextCache,
    bindingContextCache, classBindingContextCache, styleBindingContextCache,
    portalHandlersCache, boundActionsCache
} from '../core/DomMetadata.js';

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const PortalSystemMethods = {
    /**
     * Resolve list item context from an element's position in the DOM
     * Consolidates the common pattern of finding list context for portaled elements
     * @param {HTMLElement} element - The element to resolve context for
     * @param {Object} instance - The component instance
     * @param {Object} existingListContext - Optional pre-existing list context
     * @returns {Object|null} List item context with listContext, index, and optionally itemData
     * @private
     */
    _resolveListItemContext(element, instance, existingListContext = null)
    {
        // Check for cached context on element first
        if (listItemContextCache.has(element)) {
            return listItemContextCache.get(element);
        }

        // Find list item ancestor
        const listItem = this._findListItemAncestor(element);
        if (!listItem) return null;

        const index = listItem._listIndex;
        if (isNaN(index) || index < 0) return null;

        // Determine the list context to use
        let listContext = existingListContext;

        if (!listContext) {
            // Try to get from list item element
            listContext = listItem._listContext;

            // Fall back to instance's _listContexts map
            if (!listContext && instance._listContexts) {
                const listElement = element.closest('[data-list]');
                if (listElement) {
                    const listPath = listElement.dataset.list;
                    listContext = instance._listContexts.get(listPath);
                }
            }
        }

        if (!listContext) return null;

        // The row's reactive item-proxy is the live item; read it straight off
        // the row element instead of resolving the list context by index. Being
        // the reactive proxy, it stays fresh for downstream reads (no snapshot).
        const itemData = listItem._itemData || null;

        const listItemContext = {
            listContext: listContext,
            index: index,
            itemData: itemData
        };

        // Cache on element for future use
        listItemContextCache.set(element, listItemContext);

        return listItemContext;
    },

    /**
     * Process portal elements within a component
     * Portals teleport their content to a different location in the DOM
     * @param {Object} instance - The component instance
     * @private
     */
    _processPortals(instance)
    {
        const { element, id: componentId } = instance;

        // Find all portal elements within this component
        const portalElements = element.querySelectorAll('[data-portal]');
        // Cache the discovery result so _scheduleComponentRender can skip the
        // per-state-change querySelectorAll inside _updatePortalVisibility for
        // components that have no portals. PM-demo profile (2026-05-16) showed
        // 38% of main-thread time in that querySelectorAll across components
        // that had zero portals. Flag is true only when portals exist; absent
        // / false means the per-state-change call is a no-op and can be
        // elided entirely.
        instance._hasPortals = portalElements.length > 0;
        if (portalElements.length === 0) return;

        // Initialize portal tracking for this component
        if (!this._activePortals.has(componentId)) {
            this._activePortals.set(componentId, []);
        }

        portalElements.forEach(portalElement => {
            // Skip if this portal belongs to a nested component
            const owningComponent = this._getComponentElement(portalElement);
            if (owningComponent !== element) return;

            // Skip portals inside templates - they'll be processed when list items render
            if (portalElement.closest('template')) return;

            this._processPortalElement(portalElement, instance);
        });
    },
    /**
     * Process portals inside list items after list render
     * Called from _renderList after items are in the DOM
     * @param {Object} ctx - Render context with element and instance
     * @private
     */
    _processPortalsInListItems(ctx)
    {
        const { element, instance, context: listContext } = ctx;
        if (!instance) return;

        // Find all portal elements within list items (not the list container itself)
        const portalElements = element.querySelectorAll('[data-portal]');
        if (portalElements.length === 0) return;

        // Promote the cached flag: list items can introduce portals after the
        // component-level _processPortals pass ran, so the instance may have
        // been marked _hasPortals=false at init. Flip it now so the state-
        // change path stops eliding _updatePortalVisibility.
        instance._hasPortals = true;

        // Initialize portal tracking for this component
        const componentId = instance.id;
        if (!this._activePortals.has(componentId)) {
            this._activePortals.set(componentId, []);
        }

        portalElements.forEach(portalElement => {
            // Skip if already processed
            if (portalElement.dataset.portalActive === 'true') return;

            // Skip portals inside templates - they'll be processed when list items render
            if (portalElement.closest('template')) return;

            // Resolve list item context using consolidated helper
            const listItemContext = this._resolveListItemContext(portalElement, instance, listContext);

            // Process the portal (this handles conditions and teleportation)
            this._processPortalElement(portalElement, instance, listItemContext);
        });
    },
    /**
     * Process a single portal element
     * @param {HTMLElement} portalElement - The element with data-portal attribute
     * @param {Object} instance - The owning component instance
     * @param {Object} listItemContext - Optional list item context for portals in lists
     * @private
     */
    _processPortalElement(portalElement, instance, listItemContext = null)
    {
        // Cache static portal metadata on the element (read once from DOM)
        let pm = portalMetaCache.get(portalElement);
        if (!pm) {
            pm = {
                target: portalElement.dataset.portal || 'body',
                show: portalElement.dataset.show || null,
                render: portalElement.dataset.render || null
            };
            portalMetaCache.set(portalElement, pm);
        }

        // Restore list item context from element if not passed (for re-processing)
        if (!listItemContext) {
            const cached = listItemContextCache.get(portalElement);
            if (cached) listItemContext = cached;
        }

        // Find target element - default to body if selector is empty
        let targetElement;
        if (!pm.target || pm.target === 'body') {
            targetElement = document.body;
        } else {
            targetElement = document.querySelector(pm.target);
        }

        if (!targetElement) {
            this._log('warn', `Portal target not found: ${pm.target}`);
            return;
        }

        // Check for data-show condition
        if (pm.show) {
            const shouldShow = this._evaluateConditionWithListContext(pm.show, instance, listItemContext);
            if (!shouldShow) {
                // Don't teleport content if condition is false
                // Set up a watcher for when it becomes true
                this._setupPortalConditionWatcher(portalElement, instance, 'show');
                return;
            }
        }

        // Check for data-render condition
        if (pm.render) {
            const shouldRender = this._evaluateConditionWithListContext(pm.render, instance, listItemContext);
            if (!shouldRender) {
                // Don't teleport content if condition is false
                this._setupPortalConditionWatcher(portalElement, instance, 'render');
                return;
            }
        }

        // Teleport the content
        this._teleportPortalContent(portalElement, targetElement, instance, listItemContext);
    },
    /**
     * Evaluate a condition, optionally using list item context
     * @param {string} condition - The condition path to evaluate
     * @param {Object} instance - The component instance
     * @param {Object} listItemContext - Optional list item context
     * @returns {boolean} Whether the condition is truthy
     * @private
     */
    _evaluateConditionWithListContext(condition, instance, listItemContext)
    {
        // itemData is the reactive item-proxy (set in _getListItemContextForPortal),
        // so it is always live; read it directly, no list-context re-resolve.
        if (listItemContext && listItemContext.index !== undefined) {
            const freshItemData = listItemContext.itemData;

            if (freshItemData) {
                // Check if the condition path exists in item data
                if (condition in freshItemData) {
                    return !!freshItemData[condition];
                }
                // Also check nested paths
                const value = this._getNestedValue(freshItemData, condition);
                if (value !== undefined) {
                    return !!value;
                }
            }
        }

        // Fall back to component-level evaluation
        return this._evaluateCondition(condition, instance);
    },
    /**
     * Teleport portal content to target location
     * @param {HTMLElement} portalElement - The portal source element
     * @param {HTMLElement} targetElement - The target container
     * @param {Object} instance - The component instance
     * @param {Object} listItemContext - Optional list item context for portals in lists
     * @private
     */
    _teleportPortalContent(portalElement, targetElement, instance, listItemContext = null)
    {
        const componentId = instance.id;

        // Restore list item context from element if not passed
        if (!listItemContext) {
            const cached = listItemContextCache.get(portalElement);
            if (cached) listItemContext = cached;
        }

        // Get all children to teleport
        const children = Array.from(portalElement.children);
        if (children.length === 0) return;

        // CRITICAL: Process bindings BEFORE moving content
        // init() may have added binding elements that weren't processed earlier
        children.forEach(child => {
            this._processPortalContentBindingsBeforeMove(child, instance, listItemContext);
            // Clear any display:none from previous hide operation
            // Use class-based visibility for anti-FOUC compatibility
            child.classList.add('wf-show');
            if (child.style.display === 'none') {
                child.style.display = '';
            }
        });

        // Track the portal for cleanup
        const portalRecord = {
            source: portalElement,
            target: targetElement,
            content: [],
            targetSelector: portalMetaCache.get(portalElement)?.target || portalElement.dataset.portal || 'body',
            listItemContext: listItemContext  // Store list context for later use
        };

        // Move each child to target
        children.forEach(child => {
            // Mark as portaled for cleanup identification
            child.setAttribute('data-portaled-from', componentId);

            // Move to target
            targetElement.appendChild(child);

            // Track content
            portalRecord.content.push(child);

            // Process actions/models after move (event handlers need correct DOM context)
            this._processPortaledContentBindings(child, instance);

            // Process nested portals within the teleported content
            this._processNestedPortals(child, instance);
        });

        // Store portal record (ensure array exists for late-activated portals)
        if (!this._activePortals.has(componentId)) {
            this._activePortals.set(componentId, []);
        }
        this._activePortals.get(componentId).push(portalRecord);

        // Mark source element as processed
        portalElement.setAttribute('data-portal-active', 'true');

        // Force initial render of portal bindings
        this._renderPortalBindings(instance);
    },
    /**
     * Process nested portals within teleported content
     * Called after content is moved to target location
     * @param {HTMLElement} contentElement - The teleported content
     * @param {Object} instance - The owning component instance
     * @private
     */
    _processNestedPortals(contentElement, instance)
    {
        // Find any nested portal elements within the teleported content
        const nestedPortals = contentElement.querySelectorAll('[data-portal]');
        if (nestedPortals.length === 0) return;

        nestedPortals.forEach(portalElement => {
            // Skip if already processed
            if (portalElement.dataset.portalActive === 'true') return;

            // Process the nested portal
            this._processPortalElement(portalElement, instance);
        });
    },
    /**
     * Process bindings within portal content BEFORE moving to target
     * This is needed because init() may have added binding elements after _processComponentBindings
     * @param {HTMLElement} contentElement - The content to process
     * @param {Object} instance - The source component instance
     * @param {Object} listItemContext - Optional list item context for portals in lists
     * @private
     */
    _processPortalContentBindingsBeforeMove(contentElement, instance, listItemContext = null)
    {
        if (!this._contextSystemInitialized) return;

        // Store list item context on content element for later use in rendering
        if (listItemContext) {
            portalListItemContextCache.set(contentElement, listItemContext);
        }

        // Process data-bind elements (text bindings)
        const bindingElements = contentElement.querySelectorAll(this._attrSelector('bind'));
        bindingElements.forEach(bindingElement => {
            const bindPath = this._getAttr(bindingElement, 'bind');
            if (!bindPath) return;

            // Skip if already processed (has a context)
            if (bindingContextCache.has(bindingElement)) return;

            // Store list item context on element for binding resolution
            if (listItemContext) {
                portalListItemContextCache.set(bindingElement, listItemContext);
            }

            // List-item portal bindings get a plain record with the row's list
            // context as parent (the component render effect can't reach teleported
            // list rows). Component-level bindings are driven by the deferred effect
            // meta below; they create no record (the old item-level call always
            // returned null for them).
            // CRITICAL: Pass index for row-scoped resolution.
            let bindingContext = null;
            if (listItemContext && listItemContext.listContext) {
                bindingContext = this._contextRecords.createPortalBindingRecord(
                    bindPath,
                    instance,
                    bindingElement,
                    listItemContext.listContext,  // Use list context as parent
                    listItemContext.index  // parent + index for row-scoped resolution
                );
                if (bindingContext) {
                    bindingContext._parentIndex = listItemContext.index;
                    bindingContext._portalListItemContext = listItemContext;
                    (instance._portalBindingRecords || (instance._portalBindingRecords = [])).push(bindingContext);
                }
            }

            // Mark as processed (cache stores the record when present, else a truthy
            // marker; it's a dedup set, never read back as a context).
            bindingContextCache.set(bindingElement, bindingContext || true);

            // Build deferred effect metadata (component-level portals only). This drives
            // ongoing reactivity through the render effect, INDEPENDENT of whether a binding
            // context exists, so the portal stays reactive as context creation is retired.
            if (!listItemContext) {
                if (!instance._deferredEffectMeta) instance._deferredEffectMeta = [];
                const entry = {
                    element: bindingElement,
                    type: 'bind',
                    path: bindPath,
                    isInput: bindingElement.tagName === 'INPUT' || bindingElement.tagName === 'TEXTAREA' || bindingElement.tagName === 'SELECT',
                    isExpression: this.isExpression(bindPath) || bindPath.includes('$')
                };
                if (bindingElement.tagName.includes('-')) entry.isWebComponent = true;
                instance._deferredEffectMeta.push(entry);
            }
        });

        // Also check the content element itself if it has data-bind
        if (contentElement.dataset && contentElement.dataset.bind) {
            const bindPath = contentElement.dataset.bind;
            if (!bindingContextCache.has(contentElement)) {
                // List-item: plain record with the row's list context as parent.
                // Component-level: no record (deferred effect meta drives it).
                // CRITICAL: Pass index for row-scoped resolution.
                let bindingContext = null;
                if (listItemContext && listItemContext.listContext) {
                    bindingContext = this._contextRecords.createPortalBindingRecord(
                        bindPath,
                        instance,
                        contentElement,
                        listItemContext.listContext,
                        listItemContext.index  // parent + index for row-scoped resolution
                    );
                    if (bindingContext) {
                        bindingContext._parentIndex = listItemContext.index;
                        bindingContext._portalListItemContext = listItemContext;
                        (instance._portalBindingRecords || (instance._portalBindingRecords = [])).push(bindingContext);
                    }
                }
                bindingContextCache.set(contentElement, bindingContext || true);
                // Build deferred effect metadata (component-level portals only),
                // independent of the binding context (the effect drives reactivity).
                if (!listItemContext) {
                    if (!instance._deferredEffectMeta) instance._deferredEffectMeta = [];
                    const entry = {
                        element: contentElement,
                        type: 'bind',
                        path: bindPath,
                        isInput: contentElement.tagName === 'INPUT' || contentElement.tagName === 'TEXTAREA' || contentElement.tagName === 'SELECT',
                        isExpression: this.isExpression(bindPath) || bindPath.includes('$')
                    };
                    if (contentElement.tagName.includes('-')) entry.isWebComponent = true;
                    instance._deferredEffectMeta.push(entry);
                }
            }
        }

        // Only build deferred effect metadata for component-level portals (not list-item portals)
        const metaFlag = !listItemContext;

        // Process data-bind-html elements (children + self)
        this._processPortalBindingType(contentElement, instance, '[data-bind-html]', 'bindHtml', bindingContextCache, (el, ctx, path) => {
            ctx._isHTMLBinding = true;
            if (instance._htmlContextsReady) {
                const propertyName = path.startsWith('computed:') ? path.slice(9) : path;
                instance._htmlContextsReady.add(propertyName);
            }
        }, metaFlag ? 'html' : null);

        // Process data-bind-class elements (children + self)
        this._processPortalBindingType(contentElement, instance, '[data-bind-class]', 'bindClass', classBindingContextCache, (el, ctx) => {
            ctx._isClassBinding = true;
            ctx._updateClassBindingElement(this._resolvePortalBindingValue(ctx));
        }, metaFlag ? 'class' : null);

        // Process data-bind-style elements (children + self)
        this._processPortalBindingType(contentElement, instance, '[data-bind-style]', 'bindStyle', styleBindingContextCache, (el, ctx, path) => {
            ctx._isStyleBinding = true;
            this._processStyleBinding(el, null, path, 0, null);
        }, metaFlag ? 'style' : null);
    },

    /**
     * Process a single portal binding type for all matching elements (children + self).
     * Shared logic for data-bind-html, data-bind-class, data-bind-style.
     * @param {HTMLElement} contentElement - Portal content root
     * @param {Object} instance - Component instance
     * @param {string} selector - CSS selector (e.g. '[data-bind-html]')
     * @param {string} datasetKey - Dataset property name (e.g. 'bindHtml')
     * @param {WeakMap} contextCache - WeakMap to cache binding context per element
     * @param {Function} postProcess - Called with (element, bindingContext, path) after context creation
     * @private
     */
    _processPortalBindingType(contentElement, instance, selector, datasetKey, contextCache, postProcess, metaType) {
        const elements = contentElement.querySelectorAll(selector);
        // Process children, then the content element itself if it matches
        const candidates = contentElement.dataset?.[datasetKey] ? [...elements, contentElement] : elements;
        for (const el of candidates) {
            const path = el.dataset[datasetKey];
            if (!path || contextCache.has(el)) continue;

            const ctx = this._contextRecords.createPortalBindingRecord(path, instance, el);
            if (ctx) {
                contextCache.set(el, ctx);
                (instance._portalBindingRecords || (instance._portalBindingRecords = [])).push(ctx);
                postProcess(el, ctx, path);
                // Build deferred effect metadata (component-level portals only)
                if (metaType) {
                    if (!instance._deferredEffectMeta) instance._deferredEffectMeta = [];
                    const entry = {
                        element: el, type: metaType, path,
                        isExpression: this.isExpression(path) || path.includes('$')
                    };
                    if (metaType === 'class') entry.prevClasses = null;
                    instance._deferredEffectMeta.push(entry);
                }
            }
        }
    },

    /**
     * Force render of portal bindings after teleportation
     * @param {Object} instance - The component instance
     * @private
     */
    _renderPortalBindings(instance)
    {
        // Paint the instance's portal binding records (list-item bindings + the
        // class/style/html writers). Component-level text bindings are NOT here;
        // they're driven by the component render effect via the deferred effect
        // meta. Records live on the instance, so this is O(portal-bindings).
        const records = instance._portalBindingRecords;
        if (!records) return;

        // Compact in place: drop records whose element has been detached (its
        // list row was removed / the portal torn down). List-item portal records
        // are never otherwise pruned and would pin detached DOM + a parent item
        // proxy for the component's lifetime (with a frozen _parentIndex that, on
        // re-teleport, would paint the wrong row's data into a detached node).
        let write = 0;
        for (let i = 0; i < records.length; i++) {
            const ctx = records[i];
            const el = ctx && ctx.element;
            if (!el || !el.isConnected) continue;
            records[write++] = ctx;
            this._updateBindingContext(ctx);
        }
        records.length = write;
    },
    /**
     * Resolve a portal binding's current value through the single graph.
     * Component-level bindings (parentIndex undefined) use the SAME resolution the
     * render effect uses (getValue for simple paths, _resolveEffectExpression for
     * expressions / $store refs), so the portal's one-shot teleport paint can't
     * diverge from the effect's ongoing updates. List-item portal contexts
     * (parentIndex set) resolve the path against the row item via the shared
     * binding resolver (the same resolution resolveData performs internally),
     * sourcing the item from the parent list context's data + index (a portal
     * teleports its element out of the row, so the DOM ancestor is gone).
     * @param {Object} bindingContext
     * @returns {*} resolved value
     * @private
     */
    _resolvePortalBindingValue(bindingContext)
    {
        const inst = bindingContext.componentInstance;
        const path = bindingContext.path;
        if (bindingContext._parentIndex === undefined && inst && inst.stateManager) {
            return (this.isExpression(path) || path.includes('$'))
                ? this._resolveEffectExpression(path, inst)
                : inst.stateManager.getValue(path);
        }
        const parent = bindingContext.parent;
        const idx = bindingContext._parentIndex;
        const parentData = parent && Array.isArray(parent.data) ? parent.data : null;
        const item = (parentData && idx !== undefined && idx < parentData.length)
            ? parentData[idx] : undefined;
        const scope = {
            componentState: inst?.state || {},
            componentInstance: inst,
            itemIndex: idx,
            listLength: parentData ? parentData.length : 0,
            listContext: parent,
            propsData: inst?._propsData
        };
        return this._resolveRawBinding(path, item, scope);
    },
    /**
     * Update a single binding context with current value
     * @param {Object} bindingContext - The binding context to update
     * @private
     */
    _updateBindingContext(bindingContext)
    {
        const element = bindingContext.element;
        const path = bindingContext.path;

        if (!element || !path) return;
        // Don't write to a detached element. The class path guards via
        // isElementAttached inside _updateClassBindingElement; the text/value
        // path below had no such guard and would paint a removed/teleported-away
        // node.
        if (!element.isConnected) return;

        // Class bindings: resolve via the single graph, write through the class writer.
        if (bindingContext._isClassBinding) {
            bindingContext._updateClassBindingElement(this._resolvePortalBindingValue(bindingContext));
            return;
        }

        // Skip style bindings - they don't update textContent
        if (bindingContext._isStyleBinding) {
            return;
        }

        try {
            const value = this._resolvePortalBindingValue(bindingContext);

            // Update the element
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
                element.value = value ?? '';
            } else {
                element.textContent = value ?? '';
            }
        } catch (error) {
            this._log('warn', `Error updating binding: ${path}`, error);
        }
    },
    /**
     * Process bindings within portaled content
     * Ensures data-bind, data-action, data-model continue to work after move
     * @param {HTMLElement} contentElement - The teleported content
     * @param {Object} instance - The source component instance
     * @private
     */
    _processPortaledContentBindings(contentElement, instance)
    {
        // Bind actions in portaled content
        const actionElements = contentElement.querySelectorAll(this._attrSelector('action'));
        actionElements.forEach(actionEl => {
            if (!actionBoundElements.has(actionEl)) {
                this._bindPortaledAction(actionEl, instance);
            }
        });

        // Also check if the content element itself has an action
        if (this._hasAttr(contentElement, 'action') && !actionBoundElements.has(contentElement)) {
            this._bindPortaledAction(contentElement, instance);
        }

        // Bind models in portaled content
        const modelElements = contentElement.querySelectorAll(this._attrSelector('model'));
        modelElements.forEach(modelEl => {
            if (!modelBoundElements.has(modelEl)) {
                this._bindPortaledModel(modelEl, instance);
            }
        });

        // Also check if the content element itself has a model
        if (this._hasAttr(contentElement, 'model') && !modelBoundElements.has(contentElement)) {
            this._bindPortaledModel(contentElement, instance);
        }
    },
    /**
     * Bind an action element within portaled content
     * @param {HTMLElement} actionEl - The action element
     * @param {Object} instance - The source component instance
     * @private
     */
    _bindPortaledAction(actionEl, instance)
    {
        const actionAttr = actionEl.dataset.action;
        if (!actionAttr) return;

        // Skip if already bound by main action system (has bound actions)
        const existingActions = boundActionsCache.get(actionEl);
        if (existingActions && existingActions.size > 0) {
            return;
        }

        // Parse actions (can have multiple space-separated actions)
        const actionDefs = this._parseActions(actionAttr);

        actionDefs.forEach(({ eventType, methodName, args: actionArgs }) => {
            // Skip if the action method doesn't exist
            if (!methodName || typeof instance.context[methodName] !== 'function') {
                return;
            }

            // Create action context if context system is available
            let actionContext;
            if (this._contextSystemInitialized) {
                actionContext = this._contextRecords.createActionContext(
                    methodName,
                    instance,
                    actionEl,
                    methodName,
                    eventType
                );
                // Store parsed action args on the context
                if (actionContext && actionArgs && actionArgs.length > 0) {
                    actionContext.data.actionArgs = actionArgs;
                }
            }

            // Create handler function
            const handler = (event) => {
                // Use context-based handling if available
                if (this._contextSystemInitialized && actionContext) {
                    this._handleActionWithContext(actionContext, event);
                    return;
                }

                // Direct call fallback
                try {
                    instance.context[methodName].call(instance.context, event, actionEl);
                } catch (error) {
                    this._handleError(`Error in portaled action ${methodName}`, error, instance, {
                        lifecycle: 'action',
                        action: methodName
                    });
                }
            };

            // Add event listener
            actionEl.addEventListener(eventType, handler);

            // Track that this element has been bound
            let handlers = portalHandlersCache.get(actionEl);
            if (!handlers) {
                handlers = [];
                portalHandlersCache.set(actionEl, handlers);
            }
            handlers.push({ eventType, handler });
        });

        // Mark as bound
        actionBoundElements.add(actionEl);
    },
    /**
     * Bind a model element within portaled content
     * @param {HTMLElement} modelEl - The model element
     * @param {Object} instance - The source component instance
     * @private
     */
    _bindPortaledModel(modelEl, instance)
    {
        const modelPath = modelEl.dataset.model;
        if (!modelPath) return;

        // Determine the appropriate event type
        let eventType = 'input';
        if (modelEl.type === 'checkbox' || modelEl.type === 'radio') {
            eventType = 'change';
        } else if (modelEl.tagName === 'SELECT') {
            eventType = 'change';
        }

        // Get initial value from state
        const initialValue = this._getNestedValue(instance.state, modelPath);
        if (initialValue !== undefined) {
            if (modelEl.type === 'checkbox') {
                modelEl.checked = !!initialValue;
            } else if (modelEl.type === 'radio') {
                modelEl.checked = modelEl.value === initialValue;
            } else {
                modelEl.value = initialValue ?? '';
            }
        }

        // Create handler
        const handler = (_event) => {
            let newValue;

            if (modelEl.type === 'checkbox') {
                newValue = modelEl.checked;
            } else if (modelEl.type === 'radio') {
                if (modelEl.checked) {
                    newValue = modelEl.value;
                } else {
                    return; // Don't update if radio not checked
                }
            } else {
                newValue = modelEl.value;
            }

            // Set the value in state using shared pathResolver utility
            pathResolver.set(instance.state, modelPath, newValue);
        };

        // Add event listener
        modelEl.addEventListener(eventType, handler);

        // Track handler for cleanup
        let handlers = portalHandlersCache.get(modelEl);
        if (!handlers) {
            handlers = [];
            portalHandlersCache.set(modelEl, handlers);
        }
        handlers.push({ eventType, handler });

        // Mark as bound
        modelBoundElements.add(modelEl);
    },
    /**
     * Set up watcher for conditional portal rendering
     * @param {HTMLElement} portalElement - The portal element
     * @param {Object} instance - The component instance
     * @param {string} conditionType - 'show' or 'render'
     * @private
     */
    _setupPortalConditionWatcher(_portalElement, _instance, _conditionType)
    {
        // No-op: condition is re-evaluated when state changes
        // and _updatePortalVisibility is called
    },
    /**
     * Update portal visibility when conditions change
     * Called during state change handling
     * @param {Object} instance - The component instance
     * @private
     */
    _updatePortalVisibility(instance)
    {
        const { element, id: componentId } = instance;

        // Guard: Skip if no element (component destroyed or doesn't have DOM)
        if (!element) {
            return;
        }

        // Find portals with pending conditions
        const pendingPortals = element.querySelectorAll('[data-portal][data-show], [data-portal][data-render]');
        if (pendingPortals.length === 0) return;

        pendingPortals.forEach(portalElement => {
            // Resolve list item context using consolidated helper (handles caching internally)
            const listItemContext = this._resolveListItemContext(portalElement, instance);
            const shouldBeVisible = this._evaluatePortalConditions(portalElement, instance, listItemContext);

            if (portalElement.getAttribute('data-portal-active') === 'true') {
                if (!shouldBeVisible) {
                    this._hidePortalContent(portalElement, instance);
                }
            } else if (shouldBeVisible) {
                this._processPortalElement(portalElement, instance, listItemContext);
            }
        });
    },
    /**
     * Evaluate show/render conditions for a portal element.
     * @param {HTMLElement} portalElement - The portal element
     * @param {Object} instance - The component instance
     * @param {Object|null} listItemContext - List item context if in a list
     * @returns {boolean} Whether the portal should be visible
     * @private
     */
    _evaluatePortalConditions(portalElement, instance, listItemContext) {
        const pm = portalMetaCache.get(portalElement);
        const showCondition = pm?.show ?? portalElement.dataset.show;
        const renderCondition = pm?.render ?? portalElement.dataset.render;

        let visible = true;
        if (showCondition) {
            visible = this._evaluateConditionWithListContext(showCondition, instance, listItemContext);
        }
        if (visible && renderCondition) {
            visible = this._evaluateConditionWithListContext(renderCondition, instance, listItemContext);
        }
        return visible;
    },
    /**
     * Hide/remove portaled content when condition becomes false
     * @param {HTMLElement} portalElement - The portal source element
     * @param {Object} instance - The component instance
     * @private
     */
    _hidePortalContent(portalElement, instance)
    {
        const componentId = instance.id;
        const portals = this._activePortals.get(componentId) || [];

        // Find the portal record for this element
        const portalIndex = portals.findIndex(p => p.source === portalElement);
        if (portalIndex === -1) return;

        const portalRecord = portals[portalIndex];

        // Move content back to source (or remove for data-render)
        const isRenderCondition = portalElement.hasAttribute('data-render');

        portalRecord.content.forEach(child => {
            child.removeAttribute('data-portaled-from');

            if (isRenderCondition) {
                // For data-render, remove from DOM entirely
                child.remove();
            } else {
                // For data-show, move back to source and hide
                portalElement.appendChild(child);
                child.classList.remove('wf-show');
                child.style.display = 'none';
            }
        });

        // Update portal state
        portalElement.removeAttribute('data-portal-active');
        portals.splice(portalIndex, 1);
    },
    /**
     * Clean up all portals for a component
     * Called during component destruction
     * @param {string} componentId - The component ID
     * @private
     */
    _cleanupComponentPortals(componentId)
    {
        const portals = this._activePortals.get(componentId);
        if (!portals || portals.length === 0) return;

        portals.forEach(portalRecord => {
            // Remove all portaled content from the DOM.
            // Before detaching, strip event listeners we added in
            // _bindPortaledAction / _bindPortaledModel so the handler
            // closures (which capture `instance`) are eligible for GC
            // immediately, not on a subsequent WeakMap cleanup cycle.
            portalRecord.content.forEach(child => {
                // child is a root; action/model elements may be inside it
                const allEls = child.querySelectorAll
                    ? [child, ...child.querySelectorAll('*')]
                    : [child];
                for (const el of allEls) {
                    const handlers = portalHandlersCache.get(el);
                    if (handlers && handlers.length > 0) {
                        for (const { eventType, handler } of handlers) {
                            el.removeEventListener(eventType, handler);
                        }
                        portalHandlersCache.delete(el);
                    }
                }
                if (child.parentNode) {
                    child.remove();
                }
            });
        });

        // Clear the portal records
        this._activePortals.delete(componentId);
    }
};
