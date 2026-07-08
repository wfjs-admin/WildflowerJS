/**
 * EventSystem - Action binding and event delegation
 *
 * @module
 */

import { actionBoundElements, handlingSubmitSet, keyModifiersCache, boundActionsCache } from '../core/DomMetadata.js';
import { pathResolver } from '../core/wfUtils.js';

// Modifier names usable in data-event-key-* attributes (bare or in combos).
const _KEY_MODIFIER_NAMES = new Set(['ctrl', 'alt', 'shift', 'meta']);

// Maps declared key tokens to the lowercased event.key values they accept.
// Tokens not listed here match event.key exactly (lowercased).
const _KEY_TOKEN_ALIASES = {
    enter: ['enter', 'return'],
    esc: ['escape'],
    escape: ['escape'],
    space: [' '],
    up: ['arrowup'],
    down: ['arrowdown'],
    left: ['arrowleft'],
    right: ['arrowright'],
    delete: ['delete', 'backspace'],
    backspace: ['delete', 'backspace'],
    tab: ['tab']
};

function _keyTokenMatches(token, eventKeyLower)
{
    const aliases = _KEY_TOKEN_ALIASES[token];
    if (aliases) return aliases.indexOf(eventKeyLower) !== -1;
    return token === eventKeyLower;
}

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const EventSystemMethods = {
/**
     * Bind component actions to DOM elements
     * @private
     */
    _bindComponentActions(instance)
    {
        const {element, context, definition} = instance;

        // Get event configuration with defaults if not provided
        const eventsConfig = definition.events
            ? this._normalizeEventsConfig(definition.events)
            : this._getDefaultEventsConfig();

        // Find all direct action elements (support both prefixes).
        // querySelectorAll only matches descendants, so include the component
        // root itself if it carries data-action; otherwise `<div
        // data-component="x" data-action="keydown:foo">` is silently skipped.
        // Mirrors PortalSystem._processPortaledContentBindings.
        const descendantActionElements = element.querySelectorAll(this._attrSelector('action'));
        const allActionElements = this._hasAttr(element, 'action')
            ? [element, ...descendantActionElements]
            : descendantActionElements;

        const actionElements = Array.from(allActionElements)
            .filter(actionEl =>
            {
                // Skip elements rendered by data-use-template (they have their own action binding system)
                if (actionEl.closest('[data-use-template-rendered]')) {
                    return false;
                }

                // Check if this action element is part of a nested list (support both prefixes)
                const nestedListParent = actionEl.closest(this._attrSelector('list'));

                const closestComponent = this._getComponentElement(actionEl);

                if (closestComponent && closestComponent !== element) {
                    // This action belongs to a child component, skip it
                    return false;
                }

                // If the action's closest component IS this component, keep it.
                // Handles components inside lists (an inner component sitting
                // inside an outer component's list); the action belongs to
                // this component regardless of list ancestry.
                if (closestComponent === element) {
                    return true;
                }


                // Keep only actions where:
                // 1. They don't have a list parent (direct children)
                // 2. OR their closest list parent is the current list element
                if (!nestedListParent) {
                    return true; // Direct component actions
                }

                if (nestedListParent === element) {
                    return true; // List element is the component itself
                }

                // CRITICAL: Skip SSR list actions during initial binding phase
                // They should only be bound during the SSR re-binding phase when list items exist
                const ssrComponent = actionEl.closest('[data-ssr="true"]');
                if (ssrComponent && nestedListParent) {
                    const listItem = this._findListItemAncestor(actionEl);
                    if (!listItem || listItem._listIndex === undefined) {
                        // This is an SSR list action without list item marker - skip during initial binding
                        // It will be processed during SSR re-binding phase
                        return false;
                    }
                }

                // Check if the list is a child of this component
                const listParentComponent = this._getComponentElement(nestedListParent);
                return listParentComponent === element;
            });


        actionElements.forEach(el =>
        {
            // Skip elements already bound by portal system to prevent double-handling
            if (actionBoundElements.has(el)) {
                return;
            }

            if (el.tagName === 'FORM')
            {
                // For forms, we'll use the form handling system instead (support both prefixes)
                const actionAttr = this._getAttr(el, 'action');
                if (!actionAttr) return;

                const actions = this._parseActions(actionAttr);
                const methodName = actions[0]?.methodName;

                if (!methodName || typeof instance.context[methodName] !== 'function')
                {
                    return;
                }

                // Check if form is inside a list item (for passing details.index)
                const listItem = this._findListItemAncestor(el);
                let formActionContext;

                if (listItem && this._contextSystemInitialized)
                {
                    const listElement = this._findDirectParentList(listItem);

                    if (listElement && listElement._listContext)
                    {
                        // Create action context with list context as parent
                        formActionContext = this._contextRecords.createActionContext(
                            methodName,
                            instance,
                            el,
                            methodName,
                            'submit',
                            listElement._listContext
                        );

                        if (formActionContext)
                        {
                            formActionContext._parentIndex = listItem._listIndex;
                        }
                    }
                }

                // Add submit event listener with form handling logic
                el.addEventListener('submit', (event) =>
                {

                    if (handlingSubmitSet.has(el))
                    {
                        return;
                    }
                    // Prevent default
                    event.preventDefault();

                    // Sync form data to state before calling action
                    this._syncFormToState(el, instance);

                    // If validation is enabled, validate the form
                    if (el.hasAttribute('data-validate'))
                    {
                        const isValid = this._validateForm(el, instance);
                        if (!isValid)
                        {
                            return; // Don't proceed if validation fails
                        }
                    }

                    // Call the action method with details if in list context
                    try
                    {
                        if (formActionContext && formActionContext.parent && formActionContext.parent.type === 'list')
                        {
                            // Use the same detail-building logic as regular actions
                            this._handleActionWithContext(formActionContext, event);
                        }
                        else
                        {
                            instance.context[methodName](event, el);
                        }
                    } catch (error)
                    {
                        this._handleError(`Error executing form action ${methodName}`, error, instance);
                    }
                });

                return; // Skip the regular action binding for forms
            }

            // Parse attribute-based configuration
            const attrConfig = this._parseEventModifiers(el);
            // Parse actions (can have multiple space-separated actions) - support both prefixes
            const actionDefs = this._parseActions(this._getAttr(el, 'action'));

            actionDefs.forEach(({eventType, methodName, args: actionArgs}) =>
            {
                // Skip if the action method doesn't exist in the context
                if (!methodName || typeof context[methodName] !== 'function')
                {
                    return;
                }


                // Determine if this is in a list item
                const listItem = this._findListItemAncestor(el);
                let actionContext;

                if (listItem && this._contextSystemInitialized)
                {

                    // Find the list context
                    const listElement = this._findDirectParentList(listItem);


                    if (listElement && listElement._listContext)
                    {

                        // Create action context with list context as parent
                        actionContext = this._contextRecords.createActionContext(
                            methodName,
                            instance,
                            el,
                            methodName,
                            eventType,
                            listElement._listContext
                        );

                        // Store parent index for proper resolution
                        if (actionContext)
                        {
                            actionContext._parentIndex = listItem._listIndex;
                        }
                    }
                } else if (this._contextSystemInitialized)
                {

                    // Create standard action context
                    actionContext = this._contextRecords.createActionContext(
                        methodName,
                        instance,
                        el,
                        methodName,
                        eventType
                    );

                }

                // Store parsed action args on the context for use at invocation time
                if (actionContext && actionArgs && actionArgs.length > 0)
                {
                    actionContext.data.actionArgs = actionArgs;
                }

                // Get action-specific config first, then fall back to event type config
                let baseConfig;

                // Check for method-specific config first
                if (eventsConfig.actionMethods && eventsConfig.actionMethods[methodName])
                {
                    baseConfig = eventsConfig.actionMethods[methodName];
                }
                // Then check for event type config
                else if (eventsConfig.actions[eventType])
                {
                    baseConfig = eventsConfig.actions[eventType];
                }
                // Fall back to default
                else
                {
                    baseConfig = eventsConfig.actions.default;
                }

                // Merge with attribute configuration
                const actionConfig = this._mergeEventConfigs(baseConfig, attrConfig);

                // If we have a context, store options
                if (actionContext)
                {
                    actionContext.data.options = actionConfig;
                }

                // Create a unique key for this action
                const actionKey = `action-${instance.id}-${methodName}-${eventType}-${Date.now()}`;

                // Cache key modifiers at bind time (static attributes, no need to re-parse per event)
                let cachedKeyModifiers = keyModifiersCache.get(el);
                if (!cachedKeyModifiers) { cachedKeyModifiers = this._parseKeyModifiers(el); keyModifiersCache.set(el, cachedKeyModifiers); }

                // Create a handler function
                const baseHandler = (event) =>
                {
                    if (this._contextSystemInitialized && actionContext)
                    {
                        this._handleActionWithContext(actionContext, event);
                        return;
                    }

                    if (this._getComponentElement(event.target) !== element)
                    {
                        return; // Ignore events from child/nested components
                    }

                    if (actionConfig.condition)
                    {
                        try
                        {
                            const conditionMet = !!this.evaluateExpression(actionConfig.condition, instance.state, {
                                stateManager: instance.stateManager,
                                cacheKey: 'event-if'
                            });
                            if (!conditionMet)
                            {
                                return; // Skip execution if condition not met
                            }
                        } catch (error)
                        {
                            this._handleError(`Error evaluating condition: ${actionConfig.condition}`, error, instance);
                            return;
                        }

                    }

                    if (event instanceof KeyboardEvent)
                    {
                        if (!this._matchesKeyModifiers(event, cachedKeyModifiers))
                        {
                            return; // Skip if not matching required keys
                        }
                    }

                    if (actionConfig.self && event.target !== el)
                    {
                        return;
                    }

                    if (actionConfig.stopPropagation)
                    {
                        event.stopPropagation();
                    }

                    // Apply preventDefault for links, forms, and buttons
                    if (actionConfig.preventDefault &&
                        (el.tagName === 'A' || el.tagName === 'FORM' ||
                            (el.tagName === 'BUTTON' && el.type !== 'button')))
                    {
                        event.preventDefault();
                    }

                    try
                    {
                        // Call the action method
                        if (actionConfig.delay && actionConfig.delay > 0)
                        {
                            setTimeout(() =>
                            {
                                // Skip if component was destroyed during delay
                                if (!this.componentInstances.has(instance.id)) return;
                                // Create enhanced context
                                const enhancedContext = this._createEventContext(event, el, instance);
                                if (actionArgs && actionArgs.length > 0) {
                                    enhancedContext.args = actionArgs;
                                    context[methodName](event, el, enhancedContext, ...actionArgs);
                                } else {
                                    context[methodName](event, el, enhancedContext);
                                }
                            }, actionConfig.delay);
                        } else
                        {
                            // Call the action method
                            const enhancedContext = this._createEventContext(event, el, instance);
                            if (actionArgs && actionArgs.length > 0) {
                                enhancedContext.args = actionArgs;
                                context[methodName](event, el, enhancedContext, ...actionArgs);
                            } else {
                                context[methodName](event, el, enhancedContext);
                            }
                        }
                    } catch (error)
                    {
                        this._handleError(`Error executing action ${methodName}`, error, instance);
                    }
                };

                // Check if this should use outside click detection

                if (actionConfig.outside)
                {
                    this._setupOutsideClickHandler(el, instance, methodName);
                    return; // Skip regular event binding for outside handlers
                }
                // Check if we need to apply debounce or throttle
                const handlerKey = `${instance.id}-${methodName}-${eventType}`;

                // Get handler with possible debounce/throttle
                const handler = this._getHandlerWithLimits(baseHandler, actionConfig, handlerKey);

                // GUARD: Prevent duplicate event binding
                // Track bound actions per element to avoid adding duplicate listeners
                let elBoundActions = boundActionsCache.get(el);
                if (!elBoundActions) {
                    elBoundActions = new Set();
                    boundActionsCache.set(el, elBoundActions);
                }
                const bindingKey = `${eventType}-${methodName}`;
                if (elBoundActions.has(bindingKey)) {
                    // Already bound this action/event combination, skip
                    return;
                }
                elBoundActions.add(bindingKey);

                // Add the event listener with options
                const listenerOptions = {
                    once: actionConfig.once,
                    capture: actionConfig.capture,
                    passive: actionConfig.passive
                };
                el.addEventListener(eventType, handler, listenerOptions);

                // Store handler for cleanup in the {target,event,handler,options}
                // shape every teardown path matches on (ComponentLifecycle's
                // destroy sweep, ContextRecords cleanup, SSRManager). A bare
                // function would be found by key and deleted from the map, but its
                // DOM listener would never be removed, leaking the closure when
                // the destroyed component's element stays attached/reparented.
                this.eventHandlers.set(actionKey, {
                    target: el,
                    event: eventType,
                    handler,
                    options: listenerOptions,
                    componentId: instance.id
                });

            });
        });

        // Set up component listeners if configured

        this._setupComponentListeners(instance);
    },
    _handleActionWithContext(actionContext, event) {

        if (!actionContext || !actionContext.componentInstance) {
            return;
        }

        const { element, componentInstance } = actionContext;
        // Action records live on the element and outlive their component (the
        // direct-bound listener isn't removed on destroy; it was the disposed
        // CM context that used to gate it). No-op once the owning component is
        // gone so a post-destroy event can't fire a stale handler.
        if (!this.componentInstances.has(componentInstance.id)) {
            return;
        }
        let methodName = actionContext.path;

        // Skip if a more-specific action (descendant component) already fired
        // for this event. Replaces the implicit stopPropagation that used to
        // mask nested-component double-firing; events still bubble to legacy
        // delegation systems (jQuery, etc.), but WF only fires the action once.
        if (event._wfHandled === true) {
            return;
        }

        // Resolve which handler (methodName + args) matches the incoming
        // event. List-row elements with multiple actions on one tag (e.g.
        // `data-action="click:open mouseenter:hover"`) accumulate all
        // declared (eventType → handler) pairs on data.eventHandlers.
        // When that map exists, route by event.type through it. Otherwise
        // fall back to the single primary event on data.event.
        let actionArgs = actionContext.data?.actionArgs;
        const eventHandlers = actionContext.data?.eventHandlers;
        if (eventHandlers) {
            const eventType = event.type;
            let handler = eventHandlers.get(eventType)
                || (eventType === 'focusin'  && eventHandlers.get('focus'))
                || (eventType === 'focusout' && eventHandlers.get('blur'))
                || null;
            if (!handler && eventType === 'mouseover' && eventHandlers.has('mouseenter')) {
                const rel = event.relatedTarget;
                if (!(rel && element.contains(rel))) handler = eventHandlers.get('mouseenter');
            }
            if (!handler && eventType === 'mouseout' && eventHandlers.has('mouseleave')) {
                const rel = event.relatedTarget;
                if (!(rel && element.contains(rel))) handler = eventHandlers.get('mouseleave');
            }
            if (!handler) return;
            methodName = handler.methodName;
            actionArgs = (handler.args && handler.args.length) ? handler.args : actionArgs;
        } else {
            // Event type guard: the context stores the event type it was registered for
            // (e.g., "keydown"). Multiple delegation handlers (click, keydown, etc.) all
            // call this method, so verify the incoming event matches the registered type.
            // This prevents click delegation from invoking keydown handlers, and vice versa.
            // Note: focus/blur delegation uses focusin/focusout (which bubble), so map them.
            // Same idea for mouseenter/mouseleave: delegated via the bubbling
            // mouseover/mouseout, then gated here by a relatedTarget check so the
            // handler only fires when the cursor actually crosses the element.
            const contextEventType = actionContext.data?.event;
            if (contextEventType) {
                const eventType = event.type;
                let matches = eventType === contextEventType
                    || (eventType === 'focusin' && contextEventType === 'focus')
                    || (eventType === 'focusout' && contextEventType === 'blur');
                if (!matches && eventType === 'mouseover' && contextEventType === 'mouseenter') {
                    const rel = event.relatedTarget;
                    if (!(rel && element.contains(rel))) matches = true;
                }
                if (!matches && eventType === 'mouseout' && contextEventType === 'mouseleave') {
                    const rel = event.relatedTarget;
                    if (!(rel && element.contains(rel))) matches = true;
                }
                if (!matches) return;
            }
        }

        // Check key modifiers for keyboard events BEFORE executing handler
        // Use cached modifiers from bind time if available
        if (event instanceof KeyboardEvent) {
            let keyModifiers = keyModifiersCache.get(element);
            if (!keyModifiers) { keyModifiers = this._parseKeyModifiers(element); keyModifiersCache.set(element, keyModifiers); }
            if (!this._matchesKeyModifiers(event, keyModifiers)) {
                return; // Skip if key modifiers don't match
            }
        }

        // Action options are static metadata stored on the context (resolveData
        // for an action context just repackages this.data); read them directly.
        const options = actionContext.data?.options || {};

        // Check data-event-self - only fire if event.target is the element itself
        if (options.self && event.target !== element) {
            return; // Skip if event bubbled from a child element
        }

        // Check data-event-if condition
        if (options.condition) {
            try {
                const conditionMet = !!this.evaluateExpression(options.condition, componentInstance.state, {
                    stateManager: componentInstance.stateManager,
                    cacheKey: 'event-if'
                });
                if (!conditionMet) {
                    return; // Skip execution if condition not met
                }
            } catch (error) {
                this._handleError(`Error evaluating condition: ${options.condition}`, error, componentInstance);
                return;
            }
        }

        if (options.stopPropagation) {
            event.stopPropagation();
        }

        if (options.preventDefault) {
            event.preventDefault();
        }

        // Prepare detail object for list items
        let detail = {};

        // Build the list-item detail straight off the row element: index/item
        // from _listIndex/_itemData (the reactive item-proxy the render effect
        // tracks), the array via getValue (top-level) or the parent row's
        // item-proxy (nested). Identity-rooted, so it survives parent
        // reorder/splice. Replaces the former list-context resolveData() read
        // (one-graph absorption). Falls through to the DOM-hierarchy fallback
        // below when the row's list does not resolve cleanly.
        const rowEl = this._findListItemAncestor(element);
        if (rowEl && rowEl._listIndex !== undefined && rowEl._itemData !== undefined) {
            const built = this._buildListActionDetail(rowEl, componentInstance);
            if (built) {
                detail = built;
                if (actionArgs && actionArgs.length > 0) { detail.args = actionArgs; }
                this._invokeActionHandler(componentInstance, methodName, event, element, detail, actionArgs, options);
                return;
            }
        }

        const listHierarchy = [];
        let currentEl = element;

        while (currentEl) {
            // Find containing LI
            const listItem = currentEl.closest('li');
            if (!listItem) break;

            // Find containing UL/OL
            const listEl = listItem.closest('ul, ol');
            if (!listEl) break;

            // Get the path from data-list
            const listPath = listEl.dataset.list;
            if (!listPath) break;  // Only process lists with data-list attribute

            // Determine index by finding LI's position among siblings
            const allItems = this._getListItems(listEl, {
                requireDataIndex: false,
                excludeTemplates: false,
                filter: el => el.tagName === 'LI'
            });
            const index = allItems.indexOf(listItem);

            // Only add valid entries
            if (index !== -1) {
                listHierarchy.unshift({
                    path: listPath,
                    index: index,
                    item: listItem,
                    list: listEl
                });
            }

            // Move up to parent of the list
            currentEl = listEl.parentElement;
        }

        // If we found a valid hierarchy, use it to navigate state
        if (listHierarchy.length > 0) {
            let currentData = componentInstance.state;
            let fullPath = '';

            // Navigate through all but the last level
            for (let i = 0; i < listHierarchy.length - 1; i++) {
                const { path, index } = listHierarchy[i];

                // Build path string
                if (i === 0) {
                    fullPath = path;
                } else {
                    fullPath += `.${path}`;
                }

                // Navigate state
                const list = currentData[path];
                if (!Array.isArray(list) || index >= list.length) {
                    currentData = null;
                    break;
                }

                // Move to next level
                currentData = list[index];
                fullPath += `[${index}]`;
            }

            // Process final level
            if (currentData) {
                const finalLevel = listHierarchy[listHierarchy.length - 1];
                const { path, index } = finalLevel;

                // Complete path
                if (fullPath) {
                    fullPath += `.${path}`;
                } else {
                    fullPath = path;
                }

                // Get final list data
                const finalList = currentData[path];

                // If valid
                if (Array.isArray(finalList) && index < finalList.length) {
                    // Create detail object
                    const detail = {
                        index: index,
                        item: finalList[index],
                        list: finalList,
                        length: finalList.length,
                        first: index === 0,
                        last: index === finalList.length - 1,
                        context: {
                            path: path,
                            getFullPath: () => fullPath
                        }
                    };

                    if (actionArgs && actionArgs.length > 0) { detail.args = actionArgs; }
                    this._invokeActionHandler(componentInstance, methodName, event, element, detail, actionArgs, options);
                    return;
                }
            }
        }




        if (actionArgs && actionArgs.length > 0) { detail.args = actionArgs; }
        this._invokeActionHandler(componentInstance, methodName, event, element, detail, actionArgs, options);
    },
    /**
     * Invoke an action handler with error handling and optional delay.
     * @private
     */
    _invokeActionHandler(componentInstance, methodName, event, element, detail, actionArgs, options) {
        // Mark this event as having been handled by a WF action so any
        // ancestor component delegations skip it (prevents nested-component
        // double-fire). Events still bubble to non-WF listeners (jQuery,
        // native delegation); we only short-circuit other WF delegations.
        if (event && typeof event === 'object') {
            event._wfHandled = true;
        }
        const invoke = () => {
            try {
                if (actionArgs && actionArgs.length > 0) {
                    componentInstance.context[methodName](event, element, detail, ...actionArgs);
                } else {
                    componentInstance.context[methodName](event, element, detail);
                }
            } catch (error) {
                this._handleError(
                    `Error in action handler '${methodName}'`,
                    error,
                    componentInstance,
                    { actionName: methodName, lifecycle: 'action' }
                );
            }
        };
        if (options.delay && options.delay > 0) {
            setTimeout(() => {
                // Skip if component was destroyed during delay
                if (!this.componentInstances.has(componentInstance.id)) return;
                invoke();
            }, options.delay);
        } else {
            invoke();
        }
    },
    /**
     * Resolve the live array a list element renders, identity-rooted through the
     * item-proxy chain: a top-level list reads via getValue(path); a nested list
     * reads the child path off its owning row's item-proxy. Returns null when the
     * path does not resolve to an array (caller then falls back).
     * @private
     */
    _resolveRowListArray(listEl, listPath, componentInstance) {
        if (!listEl || !listPath) return null;
        const ownerRow = this._findListItemAncestor(listEl);
        if (ownerRow && ownerRow._listIndex !== undefined && ownerRow._itemData) {
            const parentItem = ownerRow._itemData;
            const nested = parentItem[listPath];
            if (Array.isArray(nested)) return nested;
            // Nested-list source that is an item-level computed (not a stored
            // field): evaluate the path against the parent item, matching the
            // implicit-computed fallback list rendering uses.
            if (nested === undefined && this._resolveRawBinding) {
                const parentListEl = this._findDirectParentList(ownerRow);
                const parentListPath = parentListEl ? this._getAttr(parentListEl, 'list') : null;
                const parentArray = this._resolveRowListArray(parentListEl, parentListPath, componentInstance);
                const scope = {
                    componentState: (componentInstance && componentInstance.state) || {},
                    componentInstance,
                    itemIndex: ownerRow._listIndex,
                    listLength: Array.isArray(parentArray) ? parentArray.length : 0,
                    listContext: parentListEl ? parentListEl._listContext : null,
                    propsData: componentInstance && componentInstance._propsData
                };
                const computed = this._resolveRawBinding(listPath, parentItem, scope);
                return Array.isArray(computed) ? computed : null;
            }
            return null;
        }
        // Top-level list: mirror the former list-context resolution: external(…)
        // through the external fn, store shorthand normalized, then getValue
        // (which already covers computed:/bare-computed/state paths).
        const sm = componentInstance && componentInstance.stateManager;
        if (!sm) return null;
        let value;
        if (listPath.includes('external(')) {
            try {
                value = this.evaluateExpression(listPath, sm.state || {}, {
                    cacheKey: 'externalList',
                    additionalContext: { external: this._getExternalFn(componentInstance) }
                });
            } catch (e) {
                value = null;
            }
        } else {
            const normalizedPath = (listPath.includes('$') && this._normalizeStoreShorthands)
                ? this._normalizeStoreShorthands(listPath) : listPath;
            value = sm.getValue(normalizedPath);
        }
        return Array.isArray(value) ? value : null;
    },
    /**
     * Build the action `detail` for a list-row element without a CM list context.
     * index/item come straight off the row (_listIndex / _itemData), the array
     * from _resolveRowListArray, and the parent chain is walked through the DOM
     * row ancestry. Returns null when the row's immediate list does not resolve to
     * an array containing the row index (caller falls back to the DOM-hierarchy
     * walk). Public event.detail contract:
     * { index, item, list, length, first, last, context?, parent? }.
     * @private
     */
    _buildListActionDetail(rowEl, componentInstance) {
        const listEl = this._findDirectParentList(rowEl);
        const listPath = listEl ? this._getAttr(listEl, 'list') : null;
        const index = rowEl._listIndex;

        // Cheap structural validity gate (no array resolution). A row missing its
        // list element, path, item data, or index falls back to the caller's
        // DOM-hierarchy walk, the cases that fallback exists for. The former
        // index-in-bounds check is dropped: a live, freshly-rendered row's index
        // is always within its source array.
        if (!listEl || !listPath || rowEl._itemData === undefined || index == null || index < 0) {
            return null;
        }

        // Resolve the row's list array LAZILY. Most handlers read only `item`
        // (krausest select/remove), but resolving the array eagerly walks
        // getValue -> getPath -> the reactive proxy on every dispatch; the
        // dominant select-dispatch cost. list/length/last become getters that
        // resolve (and cache) the array only when a handler actually reads them.
        const self = this;
        let _list, _resolved = false;
        const getList = () => {
            if (!_resolved) { _list = self._resolveRowListArray(listEl, listPath, componentInstance); _resolved = true; }
            return _list;
        };

        const detail = {
            index,
            item: rowEl._itemData,
            first: index === 0,
            context: listEl ? listEl._listContext : undefined,
            get list() { return getList(); },
            get length() { const l = getList(); return Array.isArray(l) ? l.length : 0; },
            get last() { const l = getList(); return Array.isArray(l) ? index === l.length - 1 : false; }
        };

        // Walk the DOM row ancestry to assemble detail.parent / .parent.parent…
        let childDetail = detail;
        let currentListEl = listEl;
        while (currentListEl) {
            const parentRow = this._findListItemAncestor(currentListEl);
            if (!parentRow || parentRow._listIndex === undefined || parentRow._itemData === undefined) break;
            const parentListEl = this._findDirectParentList(parentRow);
            const parentListPath = parentListEl ? this._getAttr(parentListEl, 'list') : null;
            const parentList = this._resolveRowListArray(parentListEl, parentListPath, componentInstance);
            childDetail.parent = {
                index: parentRow._listIndex,
                item: parentRow._itemData,
                list: Array.isArray(parentList) ? parentList : undefined,
                context: parentListEl ? parentListEl._listContext : undefined
            };
            childDetail = childDetail.parent;
            currentListEl = parentListEl;
        }

        return detail;
    },
    /**
     * Create enhanced context object for event handlers
     * @param {Event} event - The DOM event object
     * @param {HTMLElement} element - The element the event occurred on
     * @param {Object} instance - The component instance
     * @returns {Object} - Enhanced context object
     * @private
     */

    _createEventContext(event, element, instance)
    {
        // Basic context with element info
        const context = {
            element: element,
            tagName: element.tagName.toLowerCase(),
            componentId: instance.id,
            componentName: instance.name,

            // Element data
            dataset: {...element.dataset},

            // Related elements
            form: element.form,
            closest: (selector) => element.closest(selector),
            find: (selector) => element.querySelector(selector),
            findAll: (selector) => element.querySelectorAll(selector),

            // Event details
            type: event.type,
            timestamp: Date.now(),
            bubbles: event.bubbles,
            cancelable: event.cancelable
        };

        // Event type specific enhancements
        if (event instanceof MouseEvent)
        {
            context.position = {
                clientX: event.clientX,
                clientY: event.clientY,
                offsetX: event.offsetX,
                offsetY: event.offsetY,
                pageX: event.pageX,
                pageY: event.pageY
            };
            context.button = event.button;
            context.buttons = event.buttons;
            context.altKey = event.altKey;
            context.ctrlKey = event.ctrlKey;
            context.shiftKey = event.shiftKey;
            context.metaKey = event.metaKey;
        } else if (event instanceof KeyboardEvent)
        {
            context.key = event.key;
            context.code = event.code;
            context.altKey = event.altKey;
            context.ctrlKey = event.ctrlKey;
            context.shiftKey = event.shiftKey;
            context.metaKey = event.metaKey;
            context.repeat = event.repeat;
        } else if (event instanceof FocusEvent)
        {
            context.relatedTarget = event.relatedTarget;
        } else if (event instanceof InputEvent || event.type === 'input' || event.type === 'change')
        {
            if (element.type === 'checkbox' || element.type === 'radio')
            {
                context.checked = element.checked;
                context.value = element.value;
            } else
            {
                context.value = element.value;
                context.oldValue = element.defaultValue;
            }
        }

        return context;
    },
    /**
     * Find an action element by walking up from target and checking the context registry
     * Used for attribute-stripped templates where data-action has been removed
     * @param {HTMLElement} target - The event target element
     * @param {HTMLElement} boundary - Stop walking at this element (usually the list container)
     * @returns {HTMLElement|null} The action element or null
     * @private
     */
    _findActionElementViaRegistry(target, boundary) {
        let current = target;
        while (current && current !== boundary) {
            if (current._actionContext) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    },
    /**
     * Find action element via compiled metadata (for stripped templates)
     * This enables data-action attribute stripping while keeping lazy context creation.
     * @param {HTMLElement} target - The event target element
     * @param {HTMLElement} boundary - The boundary element (list container)
     * @returns {HTMLElement|null} The action element or null
     * @private
     */
    _findActionElementViaMetadata(target, boundary) {
        // Find the list item ancestor
        const listItem = this._findListItemAncestor(target);
        if (!listItem) return null;

        // Check for compiled metadata and cached elements
        const metadata = listItem._compiledMetadata;
        const elements = listItem._cachedElementsArray || listItem._bindingElements;

        if (!metadata?.actions || !elements) return null;

        // Walk up from target checking if any action element contains it
        let current = target;
        while (current && current !== boundary && current !== listItem.parentElement) {
            // Check if current element matches any action element in metadata
            for (const action of metadata.actions) {
                const actionEl = elements[action.index];
                if (actionEl === current) {
                    // Found action element! Ensure contexts are created
                    this._ensureItemContexts(listItem);
                    return actionEl;
                }
            }
            current = current.parentElement;
        }
        return null;
    },
    /**
     * Ensures proper event delegation is set up for lists
     * This is a universal solution that works for any list, not just specific components
     * @private
     */

    // Ensure event delegation is set up for a list
    _ensureListEventDelegation(listElement, instance, path)
    {
        // Skip if delegation is already set up
        if (this._hasElementDelegation(listElement))
        {
            return;
        }

        // Mark as having delegation set up
        this._markElementDelegation(listElement, path);

        // Get or ensure list context if context system is initialized
        let listContext = null;

        if (this._contextSystemInitialized)
        {
            // List contexts are plain objects stored on the element.
            listContext = listElement._listContext;

            // If not found, create a new one
            if (!listContext && path)
            {
                // Get data directly from component state
                let data = path.startsWith('computed:') ?
                    instance.stateManager.evaluateComputed(path.slice(9)) :
                    instance.stateManager.getValue(path);

                // Create list context
                listContext = this._createListContext(
                    path,
                    data,
                    instance
                );

                // Store bidirectional references
                listElement._listContext = listContext;
                listContext.element = listElement;

                // Register with instance's contexts
                if (!instance._listContexts)
                {
                    instance._listContexts = new Map();
                }
                if (!instance._listContexts.has(path))
                {
                    instance._listContexts.set(path, listContext);
                }
            }
        }


        // Add click delegation for all action elements. Resolution, boundary
        // checks, nested-component routing, and the handler cascade live in
        // the shared _dispatchDelegatedListEvent; the resolver encodes the
        // click-family rule (forms are submit-handled, everything else is a
        // plain click).
        listElement.addEventListener('click', (event) =>
        {
            this._dispatchDelegatedListEvent(event, listElement, instance, listContext, path,
                (actionEl) => actionEl.tagName === 'FORM' ? null : 'click');
        });

        // Add submit delegation for forms inside list items
        this._addListSubmitDelegation(listElement, instance, listContext, path);

        // Add focus/blur delegation using focusin/focusout (which bubble, unlike focus/blur)
        // This enables data-action="focus:handler" and data-action="blur:handler" in list items
        this._addListFocusBlurDelegation(listElement, instance, listContext, path);

        // Add delegation for keyboard and input events (keydown, keyup, input, change, etc.)
        // Click, submit, and focus/blur are already handled above. This covers remaining event types
        // found in data-action attributes within the list template.
        this._addListGenericEventDelegation(listElement, instance, listContext, path);

    },
    /**
     * Shared dispatch core for all delegated list events (click, focus/blur,
     * and the generic keyboard/input/mouse family). One implementation of:
     *
     * 1. Action-element resolution: closest [data-action] attribute, then
     *    context registry, then compiled metadata (templates may strip the
     *    attribute on the innerHTML fast path).
     * 2. List-boundary rejection: closest() can walk past a stripped row to
     *    an unrelated outer ancestor (e.g. a wrapping <form data-action>);
     *    reject it so the registry/metadata fallbacks can find the real row.
     * 3. Stripped-row retry: when the resolved actionEl belongs to another
     *    list, retry compiled metadata and accept only rows whose parent is
     *    THIS list (nested lists must not steal each other's events).
     * 4. Nested-component routing: actions inside a child component dispatch
     *    against that component's instance.
     * 5. Handler cascade: list-item context → stored/registry context →
     *    context-based fallback.
     *
     * Fixes 2 and 3 originally existed only in the click pipeline; the other
     * event families silently dropped the same cases until unification.
     *
     * @param {Event} event - The DOM event
     * @param {HTMLElement} listElement - The owning list container
     * @param {Object} instance - The list-owning component instance
     * @param {Object} listContext - The list context
     * @param {string} path - The list data path
     * @param {Function} resolveDispatchType - (actionEl, event) → event-type
     *   string to dispatch under, or null to ignore this event for this
     *   element. Per-family matching rules live in this closure.
     * @private
     */
    _dispatchDelegatedListEvent(event, listElement, instance, listContext, path, resolveDispatchType)
    {
        let actionEl = event.target.closest('[data-action],[data-wf-action]');
        if (actionEl && !listElement.contains(actionEl)) {
            actionEl = null;
        }
        if (!actionEl) {
            actionEl = this._findActionElementViaRegistry(event.target, listElement);
        }
        if (!actionEl) {
            actionEl = this._findActionElementViaMetadata(event.target, listElement);
        }
        if (!actionEl) return;

        const dispatchEventType = resolveDispatchType(actionEl, event);
        if (!dispatchEventType) return;

        let closestList = actionEl.closest('[data-list],[data-wf-list]');
        if (closestList !== listElement) {
            const stripped = this._findActionElementViaMetadata(event.target, listElement);
            if (!stripped) return;
            const row = this._findListItemAncestor(stripped);
            if (!row || row.parentElement !== listElement) return;
            actionEl = stripped;
            closestList = listElement;
        }

        // Route to a nested component's instance when the action element
        // lives inside one.
        const closestComponent = actionEl.closest('[data-component-id]');
        let targetInstance = instance;
        if (closestComponent && closestComponent !== instance.element) {
            const componentId = closestComponent.dataset.componentId;
            if (componentId) {
                const nestedInstance = this.componentInstances.get(componentId);
                if (nestedInstance) targetInstance = nestedInstance;
            }
        }

        // Handler cascade: list-item context first.
        if (closestList && closestList._listContext) {
            const currentListContext = closestList._listContext;
            const listItem = this._findListItemForAction(actionEl, closestList);
            const allDataIndexElements = this._collectDataIndexHierarchy(actionEl);

            if (listItem) {
                const handled = this._handleDelegatedActionWithListItem(
                    actionEl, listItem, currentListContext, closestList,
                    allDataIndexElements, event, targetInstance, dispatchEventType
                );
                if (handled) return;
            }
        }

        // Then stored/registry context.
        if (this._handleDelegatedActionFromContext(actionEl, event, dispatchEventType)) return;

        // Finally the context-based fallback.
        this._handleDelegatedActionFallback(actionEl, event, targetInstance, listContext, path, dispatchEventType);
    },
    /**
     * Per-family matcher for focus/blur delegation: does this action element
     * declare the given focus-family action (focus/blur, or the raw
     * focusin/focusout)? Checks the DOM attribute first, then the action
     * context, then compiled metadata for stripped templates.
     * @private
     */
    _focusActionMatches(actionEl, bubblingEvent, actionEvent)
    {
        const actionAttr = this._getAttr(actionEl, 'action');
        if (actionAttr) {
            return actionAttr.split(/\s+/).some(action => {
                const [eventType] = action.split(':');
                return eventType === actionEvent || eventType === bubblingEvent;
            });
        }
        // For stripped templates, check the action record for event type
        const actionContext = actionEl._actionContext;
        if (actionContext) {
            // Event type is stored in record.data.event (see createActionContext)
            const contextEventType = actionContext.data?.event || 'click';
            return (contextEventType === actionEvent || contextEventType === bubblingEvent);
        }
        // Fallback: check compiled metadata for event type
        const listItem = this._findListItemAncestor(actionEl);
        if (listItem?._compiledMetadata?.actions) {
            const elements = listItem._cachedElementsArray || listItem._bindingElements;
            if (elements) {
                for (const action of listItem._compiledMetadata.actions) {
                    if (elements[action.index] === actionEl) {
                        // Parse the action name to get event type
                        const actionDefs = this._parseActions(action.actionName);
                        return actionDefs.some(def =>
                            def.eventType === actionEvent || def.eventType === bubblingEvent
                        );
                    }
                }
            }
        }
        return false;
    },
    /**
     * Per-family resolver for generic event delegation (keyboard, input,
     * change, mouseover/mouseout): verify the action element declares this
     * event type, and synthesize mouseenter/mouseleave from mouseover/mouseout
     * via the standard relatedTarget containment check. Returns the event-type
     * name to dispatch under, or null to ignore. A stripped attribute (no
     * actionAttr) dispatches under the raw event type, matching the
     * pre-unification behavior.
     * @private
     */
    _resolveGenericDispatchType(actionEl, event, eventType)
    {
        const actionAttr = this._getAttr(actionEl, 'action');
        if (!actionAttr) return eventType;

        const declared = actionAttr.split(/\s+/).map(part => {
            const ci = part.indexOf(':');
            return ci > 0 ? part.substring(0, ci) : '';
        });
        if (declared.indexOf(eventType) !== -1) {
            // Direct match: dispatch as-is.
            return eventType;
        }
        if (eventType === 'mouseover' && declared.indexOf('mouseenter') !== -1) {
            // Synthesize mouseenter: only fire when the cursor crosses INTO
            // this action element from outside.
            const rel = event.relatedTarget;
            if (rel && actionEl.contains(rel)) return null;
            return 'mouseenter';
        }
        if (eventType === 'mouseout' && declared.indexOf('mouseleave') !== -1) {
            // Synthesize mouseleave: only fire when the cursor crosses OUT of
            // this action element.
            const rel = event.relatedTarget;
            if (rel && actionEl.contains(rel)) return null;
            return 'mouseleave';
        }
        return null;
    },
    /**
     * Add focus/blur event delegation for list items
     * Focus and blur events don't bubble, so we use focusin/focusout (which do bubble)
     * and map them to focus/blur action handlers
     * @param {HTMLElement} listElement - The list container element
     * @param {Object} instance - The component instance
     * @param {Object} listContext - The list context
     * @param {string} path - The list data path
     * @private
     */
    _addListFocusBlurDelegation(listElement, instance, listContext, path)
    {
        // Map of bubbling events to their non-bubbling counterparts for action lookup
        const eventMap = {
            'focusin': 'focus',
            'focusout': 'blur'
        };

        // Handler factory for focus-related events. The shared dispatcher does
        // resolution/boundary/routing/cascade; the resolver answers "does this
        // element declare this focus-family action" via _focusActionMatches.
        const createFocusHandler = (bubblingEvent, actionEvent) => {
            return (event) => {
                this._dispatchDelegatedListEvent(event, listElement, instance, listContext, path,
                    (actionEl) => this._focusActionMatches(actionEl, bubblingEvent, actionEvent) ? actionEvent : null);
            };
        };

        // Add listeners for focusin and focusout
        listElement.addEventListener('focusin', createFocusHandler('focusin', 'focus'));
        listElement.addEventListener('focusout', createFocusHandler('focusout', 'blur'));
    },

    /**
     * Add delegated event listeners for non-click, non-submit, non-focus events
     * found in data-action attributes within a list template.
     * Handles keydown, keyup, input, change, etc. Any event type that bubbles.
     *
     * Scans the list's template for data-action attributes, extracts unique event types,
     * and registers a delegated listener on the list container for each one.
     *
     * @param {HTMLElement} listElement - The list container element
     * @param {Object} instance - The component instance
     * @param {Object} listContext - The list context
     * @param {string} path - The list data path
     * @private
     */
    _addListGenericEventDelegation(listElement, instance, listContext, path)
    {
        // Scan template for data-action attributes to determine which event types
        // are actually needed. Avoids binding 5 listeners to every list container
        // when most templates only use click (handled separately).
        //
        // mouseover/mouseout bubble and delegate cleanly. mouseenter/mouseleave
        // do not bubble; they're synthesized here from mouseover/mouseout by
        // checking event.relatedTarget against the action element's containment.
        // Standard browser semantics: a mouseover whose relatedTarget is
        // outside the element counts as "entering" it; same idea for mouseout.
        const ALL_GENERIC_EVENTS = ['keydown', 'keyup', 'keypress', 'input', 'change', 'mouseover', 'mouseout'];
        const SYNTHESIZED_FROM = { mouseenter: 'mouseover', mouseleave: 'mouseout' };
        let eventTypes;

        const template = listElement.querySelector('template');
        if (template?.content) {
            const actionEls = template.content.querySelectorAll('[data-action],[data-wf-action]');
            if (actionEls.length === 0) return; // No actions in template, skip entirely

            const needed = new Set();
            for (const el of actionEls) {
                const attr = el.getAttribute('data-action') || el.getAttribute('data-wf-action');
                if (!attr) continue;
                for (const part of attr.split(/\s+/)) {
                    const ci = part.indexOf(':');
                    if (ci > 0) {
                        const type = part.substring(0, ci);
                        if (ALL_GENERIC_EVENTS.indexOf(type) !== -1) needed.add(type);
                        // Synthesized enter/leave: register the underlying
                        // bubbling event so per-row mouseenter/mouseleave
                        // handlers reach the same delegation path.
                        if (SYNTHESIZED_FROM[type]) needed.add(SYNTHESIZED_FROM[type]);
                    }
                }
            }
            if (needed.size === 0) return; // Only click/submit/focus actions, skip
            eventTypes = needed;
        } else {
            // No template available (SSR or consumed); fall back to all
            eventTypes = ALL_GENERIC_EVENTS;
        }

        // Register a delegated listener for each event type. The shared
        // dispatcher does resolution/boundary/routing/cascade; the resolver
        // verifies the declared event type and synthesizes mouseenter/leave.
        for (const eventType of eventTypes) {
            listElement.addEventListener(eventType, (event) => {
                this._dispatchDelegatedListEvent(event, listElement, instance, listContext, path,
                    (actionEl, evt) => this._resolveGenericDispatchType(actionEl, evt, eventType));
            });
        }
    },

    /**
     * Find the list item element that contains an action element
     * Handles both direct children and nested structures (excluding nested lists)
     * @param {HTMLElement} actionEl - The action element that was clicked
     * @param {HTMLElement} closestList - The closest list element
     * @returns {HTMLElement|null} The list item element or null
     * @private
     */
    _findListItemForAction(actionEl, closestList)
    {
        let currentElement = actionEl;

        while (currentElement && currentElement !== document.body)
        {
            if (currentElement._listIndex !== undefined)
            {
                // Check if this element is a direct child of our specific list
                if (currentElement.parentElement === closestList && currentElement.contains(actionEl))
                {
                    return currentElement;
                }

                // For nested structures, check if it's within the list but not in a nested list
                let parent = currentElement.parentElement;
                let foundNestedList = false;

                while (parent && parent !== closestList)
                {
                    if (parent.hasAttribute('data-list'))
                    {
                        foundNestedList = true;
                        break;
                    }
                    parent = parent.parentElement;
                }

                if (parent === closestList && !foundNestedList)
                {
                    return currentElement;
                }
            }
            currentElement = currentElement.parentElement;
        }

        return null;
    },
    /**
     * Collect all list item elements in the hierarchy from action element up
     * Used for nested list parent detection
     * @param {HTMLElement} actionEl - The action element that was clicked
     * @returns {Array} Array of objects with listIndex and parentList
     * @private
     */
    _collectDataIndexHierarchy(actionEl)
    {
        const allDataIndexElements = [];
        let element = actionEl;

        while (element && element !== document.body)
        {
            if (element._listIndex !== undefined)
            {
                allDataIndexElements.push({
                    listIndex: element._listIndex,
                    parentList: element.closest('[data-list]')?.dataset?.list
                });
            }
            element = element.parentElement;
        }

        return allDataIndexElements;
    },
    /**
     * Ensure action context has parent info for nested lists
     * @param {Object} context - The action context
     * @param {HTMLElement} closestList - The closest list element
     * @param {number} index - The current item index
     * @param {Array} allListItemElements - Hierarchy of list item elements
     * @private
     */
    _ensureContextParentInfo(context, closestList, index, allListItemElements)
    {
        if (context._parentInfo) return;

        let parentListPath = this._getAttr(closestList, 'list');
        let parentIndex = index;

        // Check if this list is nested by looking for a parent list element (support both prefixes)
        const parentListElement = closestList.parentElement?.closest('[data-list],[data-wf-list]');

        if (parentListElement && allListItemElements.length > 1)
        {
            // We're in a nested list - find the parent list item
            const parentListElementPath = this._getAttr(parentListElement, 'list');
            const parentListItem = allListItemElements.find(elem =>
                elem.parentList === parentListElementPath
            );

            if (parentListItem)
            {
                parentListPath = parentListElementPath;
                parentIndex = parentListItem.listIndex;
            }
        }

        context._parentInfo = {
            parentListPath: parentListPath,
            parentIndex: parentIndex
        };
        context._parentIndex = parentIndex;
        context._fullPath = `${parentListPath}[${parentIndex}].${context.path}`;
    },
    /**
     * Handle delegated action when list context exists and list item is found
     * @param {HTMLElement} actionEl - The action element
     * @param {HTMLElement} listItem - The list item element
     * @param {Object} listContext - The list context
     * @param {HTMLElement} closestList - The closest list element
     * @param {Array} allListItemElements - Hierarchy of list item elements
     * @param {Event} event - The click event
     * @param {Object} instance - The component instance
     * @returns {boolean} True if action was handled, false otherwise
     * @private
     */
    _handleDelegatedActionWithListItem(actionEl, listItem, listContext, closestList, allListItemElements, event, instance, actionEventType = null)
    {
        this._ensureItemContexts(listItem);

        const index = listItem._listIndex;
        if (isNaN(index)) return false;

        // Check if element already has an action record
        const existingContext = actionEl._actionContext;

        if (existingContext)
        {
            this._ensureContextParentInfo(existingContext, closestList, index, allListItemElements);

            // Always update _parentIndex from the list item's _listIndex.
            // Without this, nested lists where _parentInfo points to the parent list
            // would cause the index to always be 0.
            existingContext._parentIndex = index;

            // Update parent to point to the correct list context.
            // For nested lists, the original parent might be the outer list, but
            // correct data resolution requires the current (closest) list.
            if (listContext && listContext.type === 'list') {
                existingContext.parent = listContext;
            }

            this._handleActionWithContext(existingContext, event);
            return true;
        }

        // Create context with closest list as parent (support both prefixes)
        let actionAttr = this._getAttr(actionEl, 'action');

        // FALLBACK: TemplateSystem strips data-action from compiled list-row
        // templates (DOM-bloat / krausest perf reasons). When the attribute
        // is missing, recover the action string from compiled metadata:
        // metadata.actions[i].actionName carries the original "click:method"
        // / "method" / "event:method" string. Without this fallback, every
        // row whose canUseInnerHTML fast path fired (any list-row template
        // with no data-bind-style / data-bind-attr / etc.) would silently
        // fail to dispatch. See test-new/list-row-action-attribute-preserved.test.js.
        if (!actionAttr) {
            const elements = listItem._bindingElements || listItem._cachedElementsArray;
            const meta = listItem._compiledMetadata;
            if (elements && meta?.actions) {
                const elIndex = elements.indexOf(actionEl);
                if (elIndex !== -1) {
                    const metaAction = meta.actions.find(a => a.index === elIndex);
                    if (metaAction) actionAttr = metaAction.actionName || metaAction.actionValue;
                }
            }
        }

        // Parse the action attribute to get method name and event type
        const actions = this._parseActions(actionAttr);
        // Use provided actionEventType (for focus/blur mapping) or fall back to actual event type
        const eventType = actionEventType || event.type;
        const matchingAction = actions.find(a => a.eventType === eventType);

        // No action matches this event type; don't fall back to actions[0]
        // (e.g., click delegation should not invoke a keydown-only action)
        if (!matchingAction || !matchingAction.methodName) {
            return false;
        }

        const { methodName, args: actionArgs } = matchingAction;

        // Verify the method exists on the component
        if (typeof instance.context[methodName] !== 'function') {
            if (__DEV__) console.warn(`[WildflowerJS] Method "${methodName}" not found on component "${instance.name}"`);
            return false;
        }

        const context = this._contextRecords.createActionContext(
            methodName,
            instance,
            actionEl,
            methodName,
            eventType,
            listContext
        );

        if (context)
        {
            context._parentIndex = index;
            // Store parsed action args on the context
            if (actionArgs && actionArgs.length > 0) {
                context.data.actionArgs = actionArgs;
            }
            this._handleActionWithContext(context, event);
            return true;
        }

        return false;
    },
    /**
     * Handle delegated action using stored or registry context
     * @param {HTMLElement} actionEl - The action element
     * @param {Event} event - The event
     * @param {string} actionEventType - Optional event type override (for focus/blur mapping)
     * @returns {boolean} True if action was handled, false otherwise
     * @private
     */
    _handleDelegatedActionFromContext(actionEl, event, actionEventType = null)
    {
        // Action records live on the element (set by createActionContext). The
        // dispatcher reads list-item detail from the row element, not from any
        // _parentIndex on the record, so no index refresh is needed here.
        if (actionEl._actionContext)
        {
            this._handleActionWithContext(actionEl._actionContext, event);
            return true;
        }

        return false;
    },
    /**
     * Handle delegated action using fallback approach
     * @param {HTMLElement} actionEl - The action element
     * @param {Event} event - The event
     * @param {Object} instance - The component instance
     * @param {Object} listContext - The list context (may be null)
     * @param {string} path - The list path
     * @param {string} actionEventType - Optional event type override (for focus/blur mapping)
     * @returns {boolean} True if action was handled, false otherwise
     * @private
     */
    _handleDelegatedActionFallback(actionEl, event, instance, listContext, path, actionEventType = null)
    {
        const rowEl = this._findListItemAncestor(actionEl);
        if (!rowEl) return false;

        const index = rowEl._listIndex;
        if (isNaN(index)) return false;

        const actionAttr = actionEl.dataset.action;
        if (!actionAttr) return false;

        const actions = this._parseActions(actionAttr);
        // Use provided actionEventType or fall back to event.type or 'click'
        const eventType = actionEventType || event.type || 'click';
        const matchingAction = actions.find(a => a.eventType === eventType) || actions[0];
        if (!matchingAction) return false;

        const { methodName, args: actionArgs } = matchingAction;
        if (!methodName || typeof instance.context[methodName] !== 'function') return false;

        // Try to create context with direct parent list
        const directParentList = this._findDirectParentList(actionEl);

        if (directParentList && directParentList._listContext)
        {
            const newContext = this._contextRecords.createActionContext(
                methodName,
                instance,
                actionEl,
                methodName,
                eventType,
                directParentList._listContext
            );

            if (newContext)
            {
                newContext._parentIndex = index;
                // Store parsed action args on the context
                if (actionArgs && actionArgs.length > 0) {
                    newContext.data.actionArgs = actionArgs;
                }
                this._handleActionWithContext(newContext, event);
                return true;
            }
        }

        // Final fallback - direct method invocation
        const actionConfig = (instance.definition?.events?.actions?.click ||
            instance.definition?.events?.actions?.default ||
            this._getDefaultEventsConfig().actions.default);

        this._applyEventConfiguration(event, actionConfig);

        // The row's reactive item-proxy IS the item; read it straight off the
        // row element instead of resolving the list context by index.
        const item = rowEl._itemData || null;

        if (!item) return false;

        try
        {
            instance.context[methodName](event, actionEl, {
                item,
                index,
                element: rowEl,
                context: listContext,
                path: listContext ? listContext.path : path
            });
            return true;
        }
        catch (error)
        {
            this._handleError(`Error in delegated action: ${methodName}`, error, instance);
            return false;
        }
    },
    _findDirectParentList(el) {
        if (!el) return null;

        // Check cache first
        if (this._listParentCache.has(el)) {
            return this._listParentCache.get(el);
        }

        // Find parent (use _attrSelector to respect useWfPrefixOnly mode)
        const result = el.closest(this._attrSelector('list'));

        // Cache result (even null results to avoid repeated searches)
        this._listParentCache.set(el, result);

        return result;
    },
    /**
     * Filter out elements that are inside nested lists to prevent cross-contamination.
     * Elements inside nested lists have their own data context and should not be updated
     * with the parent item's data.
     *
     * @param {NodeList|Array} elements - Elements to filter
     * @param {Element} row - The parent row element (list item boundary)
     * @param {boolean} hasNestedLists - Whether this list has nested lists (optimization)
     * @returns {Array} Filtered elements array
     */
    _filterOutNestedListElements(elements, row, hasNestedLists) {
        if (!hasNestedLists) {
            return elements;
        }
        return Array.from(elements).filter(el => {
            let parent = el.parentElement;
            while (parent && parent !== row) {
                if (this._hasAttr(parent, 'list')) {
                    return false;
                }
                parent = parent.parentElement;
            }
            return true;
        });
    },
    /**
     * Process conditional elements (data-show and data-render) within a list item
     * @param {HTMLElement} itemElement - The list item element
     * @param {Object} instance - Component instance
     * @param {string} listPath - Path of the list
     * @param {number} index - Index of the item in the list
     * @param {Object} item - The item data
     * @private
     */
    _bindListItemConditionals(itemElement, instance, listPath, index, item, listContainer = null, parentListContext = null) {
        if (!this._contextSystemInitialized || !this._contextRecords) return;

        // OPTIMIZATION: Check compiled metadata first - if no conditionals exist, exit early
        const componentName = instance?.name;
        const compilationKey = componentName ? `${componentName}:${listPath}` : listPath;
        const compiledMetadata = this._templateCache.compiled.get(compilationKey) ||
                                  this._templateCache.compiled.get(listPath);

        // EARLY EXIT: If we have compiled metadata and no conditionals (shows or renders), skip entirely
        const hasShows = compiledMetadata?.shows?.length > 0;
        const hasRenders = compiledMetadata?.renders?.length > 0;
        if (compiledMetadata && !hasShows && !hasRenders) {
            return; // No conditionals to process
        }

        // OPTIMIZATION: Use passed list container/context if available, avoiding DOM traversal
        if (!listContainer) {
            listContainer = this._findDirectParentList(itemElement);
        }
        if (!parentListContext) {
            parentListContext = listContainer ? (listContainer._listContext || null) : null;
        }

        let conditionalElements;
        if (compiledMetadata && (hasShows || hasRenders)) {
            // FAST PATH: Use pre-computed element paths from compiled metadata
            const showElements = hasShows
                ? compiledMetadata.shows.map(show => this._getElementByPath(itemElement, show.elementPath))
                : [];
            const renderElements = hasRenders
                ? compiledMetadata.renders.map(render => this._getElementByPath(itemElement, render.elementPath))
                : [];
            conditionalElements = [...showElements, ...renderElements].filter(el => el !== null);
        } else {
            // FALLBACK: Use querySelectorAll (only when no compiled metadata)
            conditionalElements = Array.from(itemElement.querySelectorAll(`${this._attrSelector('show')}, ${this._attrSelector('render')}`));
        }

        conditionalElements.forEach(conditionalElement => {
            // Skip if this element is inside a nested list (will be handled by that list's binding)
            // Check for nested data-list between conditionalElement and itemElement
            // (Can't use _findDirectParentList because element may not be in document DOM yet)
            let isInsideNestedList = false;
            let parent = conditionalElement.parentElement;
            while (parent && parent !== itemElement) {
                if (parent.hasAttribute('data-list') || parent.hasAttribute('data-wf-list')) {
                    isInsideNestedList = true;
                    break;
                }
                parent = parent.parentElement;
            }
            if (isInsideNestedList) return;

            // Check for render mode using framework's attribute helper (supports data-wf-* prefix)
            const isRenderMode = this._hasAttr(conditionalElement, 'render');
            const condPath = isRenderMode
                ? this._getAttr(conditionalElement, 'render')
                : this._getAttr(conditionalElement, 'show');

            if (!condPath) return;

            // Evaluate condition against item data. Pass the real list index so
            // expressions referencing _index/_first/_last/_length resolve correctly
            // (the resolver's expression case threads these through into scope).
            // Source the length from the list context's array, not the DOM child
            // count: at bind time the rows are not yet appended, so children.length
            // reads 0 and any info.last/info.length frame would resolve wrong.
            const listLength = parentListContext?.data?.length ?? (listContainer?.children?.length || 0);
            const conditionValue = this._evaluateListItemCondition(condPath, item, instance, index, listLength);

            if (isRenderMode) {
                // Handle data-render for list items
                const renderCtx = this._processListItemDataRender(conditionalElement, condPath, conditionValue, instance, listPath, index, item, parentListContext);
                // Store render context on item element for per-item effect updates
                if (renderCtx) {
                    // Back-reference to the owning list row so a structural toggle
                    // driven by the reconcile's position-frame re-eval
                    // (_reEvalListItemComputedConditionals) can invalidate the row's
                    // cached element arrays; otherwise the per-item effect's
                    // subsequent re-bind lands on the pre-toggle (detached/stale) nodes.
                    renderCtx._ownerItemEl = itemElement;
                    if (!itemElement._renderContexts) itemElement._renderContexts = [];
                    // Find matching compiled binding for this render path
                    const renderBinding = compiledMetadata?.renders?.find(r => r.path === condPath || r.path === condPath.replace(/^!/, ''));
                    // Fallback binding shape needs `elementPath` so root-level render
                    // detection in _mapFn (placeholder substitution) works even when
                    // compiled metadata didn't have a matching entry. The conditional
                    // element being itemElement is the structural definition of root.
                    const isRootConditional = conditionalElement === itemElement;
                    itemElement._renderContexts.push({
                        context: renderCtx,
                        binding: renderBinding || {
                            path: condPath.replace(/^!/, ''),
                            negate: condPath.startsWith('!'),
                            elementPath: isRootConditional ? [] : undefined
                        }
                    });
                }
            } else {
                // Handle data-show for list items - toggle visibility and wf-show class
                // For expression/store paths, _executeShows already set display correctly
                // via compiled metadata; only override for simple paths
                const isExpressionPath = this.isExpression(condPath) || condPath.includes('$');

                if (!isExpressionPath) {
                    if (conditionValue) {
                        conditionalElement.classList.add('wf-show');
                        conditionalElement.style.display = '';
                    } else {
                        conditionalElement.classList.remove('wf-show');
                        conditionalElement.style.display = 'none';
                    }
                }

                // List-item data-show no longer gets a conditional Context. The
                // initial visibility is set directly above; subsequent updates run
                // through the per-item effect (_executeShows, data-driven) and the
                // reconcile re-eval sweeps (_reEvalItemContextShow for literal `_last`
                // tokens, _reEvalListItemComputedConditionals for position-frame
                // computeds). Nothing read the show Context; it was write-only after
                // RC:400's _updateConditionals sweep was removed.
            }
        });
    },
    /**
     * Evaluate a condition path against list item data
     * @param {string} path - The condition path
     * @param {Object} item - The list item data
     * @param {Object} instance - Component instance (for computed properties)
     * @returns {boolean} The evaluated condition
     * @private
     */
    _evaluateListItemCondition(path, item, instance, itemIndex = 0, listLength = 0) {
        let negate = false;
        let actualPath = path;

        // Handle negation
        if (path.startsWith('!')) {
            negate = true;
            actualPath = path.slice(1);
        }

        // Carry the position frame (info.first/last/length) into item-level
        // computed evaluation. Passing null here would drop the frame to length
        // 0, producing a wrong info.last/info.length on initial render.
        const frame = { listLength };

        // Handle explicit computed: prefix
        if (actualPath.startsWith('computed:')) {
            const computedName = actualPath.slice(9);
            if (instance?.stateManager?.computed?.[computedName]) {
                const value = this._evaluateComputedInListContext(instance, computedName, item, itemIndex, frame);
                return negate ? !value : !!value;
            }
        }

        // Check for implicit computed property (simple name, no dots)
        if (!actualPath.includes('.') && instance?.stateManager?.computed?.[actualPath]) {
            const value = this._evaluateComputedInListContext(instance, actualPath, item, itemIndex, frame);
            return negate ? !value : !!value;
        }

        // Expression paths (e.g. "shouldRender && true") need full evaluation.
        // pathResolver.get only does dot-path lookups, so it returns undefined
        // for any compound expression. Route through the binding resolver's
        // expression case which evaluates against item, componentState, and
        // item-level computeds, with proper list-context vars (_index/_first/etc).
        if (this.isExpression && this.isExpression(actualPath)) {
            try {
                const value = this._lookupFromItem(
                    { type: 'expression', path: actualPath, negate: false },
                    item,
                    {
                        componentState: instance?.state || {},
                        componentInstance: instance,
                        itemIndex,
                        listLength,
                        listContext: null,
                        propsData: instance?._propsData
                    }
                );
                return negate ? !value : !!value;
            } catch (e) {
                return false;
            }
        }

        // Bare list-position token (data-show / data-render = "_first" / "_last" /
        // "_index" / "_length"): resolve against the row's position FRAME, not the
        // item (the item has no _index/_first/_last/_length). Mirrors the resolver's
        // list-context-var case; without this a bare token reads undefined off the
        // item and the condition is false on every row.
        if (this._listContextVars && this._listContextVars.has(actualPath)) {
            let frameVal;
            switch (actualPath) {
                case '_index': frameVal = itemIndex; break;
                case '_length': frameVal = listLength; break;
                case '_first': frameVal = itemIndex === 0; break;
                case '_last': frameVal = itemIndex === listLength - 1; break;
            }
            return negate ? !frameVal : !!frameVal;
        }

        // Get value from item data (cached path resolution, zero allocation)
        let value;
        try {
            value = pathResolver.get(item, actualPath);
        } catch (error) {
            value = false;
        }

        // Component-state fallback (outer scope): a bare name the item doesn't provide
        // resolves against component state, so data-show / data-render="showAll" works in
        // a list row. Mirrors the resolver's item-first→component fallback; the per-item
        // effect re-evaluates (and reacts) via _resolveCompiledBinding's matching fallback.
        if (value === undefined && instance?.state && typeof instance.state === 'object' && actualPath in instance.state) {
            value = instance.state[actualPath];
        }

        return negate ? !value : !!value;
    },
    /**
     * Process data-render for a list item element
     * @param {HTMLElement} element - The element with data-render
     * @param {string} path - The condition path
     * @param {boolean} conditionValue - The evaluated condition
     * @param {Object} instance - Component instance
     * @param {string} listPath - Path of the list
     * @param {number} index - Index of the item
     * @param {Object} item - The item data
     * @param {Object} parentListContext - Parent list context
     * @private
     */
    _processListItemDataRender(element, path, conditionValue, instance, listPath, index, item, parentListContext) {
        // Clone the element as template before any DOM manipulation
        const templateClone = element.cloneNode(true);
        // Strip data-cloak from template so re-insertions don't inherit it
        templateClone.removeAttribute('data-cloak');

        // Create the render record (plain object, not registered). The list-item
        // index is the parentIndex used for placeholder labelling / data resolution.
        const context = this._contextRecords.createRenderRecord(
            path,
            instance,
            element,
            index
        );

        if (context) {
            // Add render-specific properties
            context.templateClone = templateClone;
            context.isRendered = conditionValue;
            context.itemData = item;

            // If condition is initially false, remove element and insert placeholder
            if (!conditionValue) {
                const placeholder = document.createComment(` data-render: ${path} [${index}] `);
                context.placeholder = placeholder;
                // The element may not yet be in its final list parent (e.g. during
                // bulk-create _processListItemDataRender runs while the item is still
                // sitting in a DocumentFragment). DOM-fragment removal here would not
                // stop mapFn from re-appending the element to the list. The result
                // element substitution happens in _mapFn (see _renderList) which
                // checks render contexts and uses placeholder when isRendered=false.
                const parent = element.parentNode;
                if (parent && parent.nodeType === 1 /* ELEMENT_NODE */) {
                    parent.insertBefore(placeholder, element);
                    parent.removeChild(element);
                }
                context.element = null; // Element is not in DOM
            } else {
                context.placeholder = null; // No placeholder needed when rendered
            }
        }

        return context;
    },
    _normalizeEventsConfig(eventsConfig)
    {
        const defaultConfig = this._getDefaultEventsConfig();
        const normalized = {...defaultConfig};

        // Process actions configuration
        if (eventsConfig.actions)
        {
            normalized.actions = {...defaultConfig.actions};

            // First process the default configuration if provided
            if (eventsConfig.actions.default)
            {
                normalized.actions.default = {
                    ...defaultConfig.actions.default,
                    ...eventsConfig.actions.default
                };
            }

            // Process event type configurations (like 'click', 'change', etc.)
            Object.keys(eventsConfig.actions).forEach(key =>
            {
                if (key === 'default') return; // Already processed

                // Check if this is a method name (like 'saveForm') or an event type (like 'click')
                // Classify as event type if it matches a known DOM event name
                const isEventType = /^(click|dblclick|change|input|submit|focus|blur|focusin|focusout|keydown|keyup|keypress|mouseover|mouseout|mouseenter|mouseleave|mousedown|mouseup|mousemove|pointerdown|pointerup|pointermove|pointerenter|pointerleave|pointerover|pointerout|pointercancel|touchstart|touchend|touchmove|touchcancel|contextmenu|wheel|drag|dragstart|dragend|dragenter|dragleave|dragover|drop|resize|scroll|select|copy|cut|paste|compositionstart|compositionend|compositionupdate|animationstart|animationend|animationiteration|transitionstart|transitionend|transitionrun|transitioncancel|toggle|reset|invalid)$/i.test(key);

                if (isEventType)
                {
                    // It's an event type configuration
                    normalized.actions[key] = {
                        ...defaultConfig.actions.default,
                        ...eventsConfig.actions[key]
                    };
                } else
                {
                    // It's a method name configuration, store by method name
                    // store action-specific configurations
                    if (!normalized.actionMethods)
                    {
                        normalized.actionMethods = {};
                    }

                    normalized.actionMethods[key] = {
                        ...defaultConfig.actions.default,
                        ...eventsConfig.actions[key]
                    };
                }
            });
        }

        // Process listeners configuration
        if (eventsConfig.listeners)
        {
            normalized.listeners = Array.isArray(eventsConfig.listeners)
                ? eventsConfig.listeners
                : Object.values(eventsConfig.listeners);

            // Ensure each listener has the required properties
            normalized.listeners = normalized.listeners.map(listener => ({
                ...defaultConfig.listeners.default,
                ...listener
            }));
        }

        return normalized;
    },
    _getDefaultEventsConfig()
    {
        return {
            actions: {
                default: {
                    // stopPropagation defaults to false so action handlers don't
                    // greedily consume bubbling events. This lets WF coexist with
                    // legacy delegation systems (jQuery $(document).on(...),
                    // native delegation, parent component listeners). Opt in to
                    // the old behavior per-element with `data-event-stop`.
                    stopPropagation: false,
                    preventDefault: true,
                    debounce: 0,
                    throttle: 0
                }
            },
            listeners: {
                default: {
                    target: null,
                    event: 'click',
                    handler: '',
                    capture: false,
                    passive: false,
                    once: false,
                    throttle: 0,
                    debounce: 0
                }
            }
        };
    },
    /**
     * Set up component-level listeners from definition.events.listeners config
     * @private
     */
    _setupComponentListeners(instance)
    {
        const {context, definition} = instance;

        // Skip if no events or listeners configuration
        if (!definition.events || !definition.events.listeners) return;

        const listeners = definition.events.listeners;
        if (!Array.isArray(listeners) || listeners.length === 0) return;

        listeners.forEach(listener =>
        {
            // Skip if missing required properties
            if (!listener.event || !listener.handler || !listener.target)
            {
                this._log('warn', `Listener missing required properties in component ${instance.name}`);
                return;
            }

            // Skip if handler doesn't exist
            if (typeof context[listener.handler] !== 'function')
            {
                this._log('warn', `Listener handler not defined: ${listener.handler} for component ${instance.name}`);
                return;
            }

            // Determine the target element
            let target;
            if (listener.target === 'window')
            {
                target = window;
            } else if (listener.target === 'document')
            {
                target = document;
            } else if (listener.target === 'self')
            {
                target = instance.element;
            } else if (typeof listener.target === 'string')
            {
                // Treat as a selector
                target = listener.target.startsWith('document:')
                    ? document.querySelector(listener.target.slice(9))
                    : instance.element.querySelector(listener.target);

                if (!target)
                {
                    this._log('warn', `Listener target not found: ${listener.target} for component ${instance.name}`);
                    return;
                }
            } else
            {
                // Default to the component element
                target = instance.element;
            }

            // Create a unique key for this listener
            const listenerKey = `listener-${instance.id}-${listener.handler}-${listener.event}-${Date.now()}`;

            // Create base handler
            const baseHandler = (event) =>
            {
                // Boundary check for non-window/document events
                if (target !== window && target !== document)
                {
                    const eventSourceComponent = this._getComponentElement(event.target);
                    if (eventSourceComponent !== instance.element)
                    {
                        return; // Ignore events from other components
                    }
                }

                // Call the listener handler
                context[listener.handler].call(context, event);
            };

            // Apply debounce or throttle if configured
            const handler = this._getHandlerWithLimits(
                baseHandler,
                {
                    debounce: listener.debounce || 0,
                    throttle: listener.throttle || 0
                },
                `${instance.id}-${listener.handler}-${listener.event}`
            );

            // Add event listener with options
            target.addEventListener(listener.event, handler, {
                capture: listener.capture || false,
                passive: listener.passive || false,
                once: listener.once || false
            });

            // Log the binding for debugging
            if (this.debug)
            {
                const limitInfo = listener.debounce > 0
                    ? `debounce: ${listener.debounce}ms`
                    : listener.throttle > 0
                        ? `throttle: ${listener.throttle}ms`
                        : 'no timing limits';

                this._log('debug', `Bound ${listener.event} listener for ${listener.handler} on ${listener.target} with ${limitInfo}`);
            }

            // Store for cleanup
            this.eventHandlers.set(listenerKey, {
                target,
                event: listener.event,
                handler,
                options: {
                    capture: listener.capture || false
                }
            });
        });
    },

    /**
     * Set up outside click detection for an element
     * @param {HTMLElement} element - The element to detect clicks outside of
     * @param {Object} instance - The component instance
     * @param {string} methodName - The method name to call when click is outside
     * @returns {Function} - The created event listener for cleanup
     * @private
     */

    _setupOutsideClickHandler(element, instance, methodName, rowContext)
    {
        // Single document-level listener for the entire framework
        // (lazy-initialized on first call). A per-element registry
        // keyed by methodName collects every active subscription;
        // iteration at click time drops entries whose element has
        // detached (element.isConnected === false), so the registry
        // self-cleans without needing element-destroy hooks.
        //
        // Why this shape: the original implementation added a fresh
        // document.addEventListener per call, with the element
        // captured in closure. When the element was re-bound (list
        // reconciliation re-running per-row context creation), old
        // listeners stayed alive and fired on every click, clobbering
        // state with stale element refs. A single listener + a
        // registry keyed by element eliminates the leak: re-binds
        // are idempotent (existing entry returned), and detached
        // elements drop themselves on the next click.
        if (!this._outsideClickRegistry) {
            // Map<HTMLElement, Map<methodName, { instance, rowContext }>>.
            // Strong refs are fine; the lazy isConnected sweep drops
            // entries for detached elements within one click. rowContext is
            // null for non-list handlers, or { item, index, listContext }
            // for a data-list row child so the handler gets a details arg.
            this._outsideClickRegistry = new Map();
            const self = this;
            document.addEventListener('click', (event) =>
            {
                if (self._outsideClickRegistry.size === 0) return;
                const target = event.target;
                for (const [el, methodMap] of self._outsideClickRegistry)
                {
                    if (!el.isConnected)
                    {
                        self._outsideClickRegistry.delete(el);
                        continue;
                    }
                    if (el === target || el.contains(target)) continue;
                    for (const [name, entry] of methodMap)
                    {
                        try
                        {
                            let details;
                            if (entry.rowContext)
                            {
                                const rc = entry.rowContext;
                                // Resolve the list array off component state (top-level
                                // lists) rather than the list context's resolveData; the
                                // row item itself is already carried on rc.item (the same
                                // proxy), so only list/length/first/last need the array.
                                let listData = null;
                                try {
                                    listData = (rc.listContext && (!rc.listContext.parent || rc.listContext.parent.type === 'root'))
                                        ? self._resolveListSourceData(rc.listContext.path, rc.listContext.componentInstance)
                                        : null;
                                }
                                catch (e) { listData = null; }
                                if (Array.isArray(listData) && listData.length && typeof rc.index === 'number')
                                {
                                    const idx = rc.index;
                                    details = {
                                        item: rc.item,
                                        index: idx,
                                        list: listData,
                                        length: listData.length,
                                        first: idx === 0,
                                        last: idx === listData.length - 1,
                                        context: rc.listContext
                                    };
                                }
                                else
                                {
                                    details = { item: rc.item, index: rc.index, list: null, context: rc.listContext };
                                }
                            }
                            entry.instance.context[name](event, el, details);
                        } catch (error)
                        {
                            self._handleError(`Error in outside click handler for ${name}`, error, entry.instance);
                        }
                    }
                }
            });
        }

        let methodMap = this._outsideClickRegistry.get(element);
        if (!methodMap)
        {
            methodMap = new Map();
            this._outsideClickRegistry.set(element, methodMap);
        }
        // Re-registering the same (element, methodName) pair just
        // refreshes the entry; a later registration (e.g. a row re-mount)
        // overwrites with fresh context. No duplicate dispatch on click.
        methodMap.set(methodName, { instance, rowContext: rowContext || null });
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
        // Unknown literal: return as string (graceful fallback)
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
     * Parse data-event-key-* attributes into a key-filter spec.
     *
     * Spec shape (cached per element in keyModifiersCache):
     *   ctrl/alt/shift/meta : bare modifier attrs; global AND-gates
     *   keys   : plain key tokens (e.g. 'enter', 'a'); any-of match
     *   combos : [{ctrl,alt,shift,meta,key|null}] from '+' attrs
     *             (e.g. data-event-key-ctrl+s); any-of match
     *   empty  : no data-event-key-* attrs at all (match every key)
     *
     * @param {HTMLElement} element - Element to check for key modifiers
     * @returns {Object} - Key-filter spec
     * @private
     */
    _parseKeyModifiers(element)
    {
        const spec = { ctrl: false, alt: false, shift: false, meta: false, keys: [], combos: [], empty: true };

        const attrs = element.attributes;
        for (let i = 0; i < attrs.length; i++)
        {
            const name = attrs[i].name;
            if (!name.startsWith('data-event-key-')) continue;
            const rest = name.slice('data-event-key-'.length);
            if (!rest) continue;

            spec.empty = false;

            if (rest.indexOf('+') === -1)
            {
                if (_KEY_MODIFIER_NAMES.has(rest)) spec[rest] = true;
                else spec.keys.push(rest);
            }
            else
            {
                const parts = rest.split('+');
                const combo = { ctrl: false, alt: false, shift: false, meta: false, key: null };
                for (let p = 0; p < parts.length; p++)
                {
                    const part = parts[p];
                    if (_KEY_MODIFIER_NAMES.has(part)) combo[part] = true;
                    else if (part) combo.key = part;
                }
                spec.combos.push(combo);
            }
        }

        return spec;
    },
    /**
     * Checks if a keyboard event matches a key-filter spec from _parseKeyModifiers
     * @param {KeyboardEvent} event - The keyboard event
     * @param {Object} spec - Key-filter spec
     * @returns {boolean} - Whether the event matches
     * @private
     */
    _matchesKeyModifiers(event, spec)
    {
        // No key filter declared: match all keys
        if (spec.empty) return true;

        // Bare modifier attrs gate every match
        if (spec.ctrl && !event.ctrlKey) return false;
        if (spec.alt && !event.altKey) return false;
        if (spec.shift && !event.shiftKey) return false;
        if (spec.meta && !event.metaKey) return false; // Command key on Mac

        const keys = spec.keys;
        const combos = spec.combos;

        // Only modifiers declared: no specific key required
        if (keys.length === 0 && combos.length === 0) return true;

        const eventKey = event.key.toLowerCase();

        for (let i = 0; i < keys.length; i++)
        {
            if (_keyTokenMatches(keys[i], eventKey)) return true;
        }

        for (let i = 0; i < combos.length; i++)
        {
            const combo = combos[i];
            if (combo.ctrl && !event.ctrlKey) continue;
            if (combo.alt && !event.altKey) continue;
            if (combo.shift && !event.shiftKey) continue;
            if (combo.meta && !event.metaKey) continue;
            if (combo.key === null || _keyTokenMatches(combo.key, eventKey)) return true;
        }

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

