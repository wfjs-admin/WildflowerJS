/**
 * EventSystem - Action binding and event delegation
 *
 * @module
 */

import { actionBoundElements, keyModifiersCache, boundActionsCache, storedTemplateCache, storedTemplatesCache } from '../core/DomMetadata.js';
import { pathResolver, WF_ERRORS, wfError } from '../core/wfUtils.js';
import { applyShow } from '../core/BindingWriters.js';
import { getContextMethod } from '../state/ContextProxy.js';

// The options handed to the call when an action's delay has already been
// waited out (see _handleActionWithContext / _runAction).
const NO_DELAY = { delay: 0 };

// The options every action starts from; the element's data-event-* modifiers
// are merged over them (_mergeEventConfigs).
const DEFAULT_ACTION_CONFIG = Object.freeze({
    // stopPropagation defaults to false so action handlers don't
    // greedily consume bubbling events. This lets WF coexist with
    // legacy delegation systems (jQuery $(document).on(...),
    // native delegation, parent component listeners). Opt in to
    // the old behavior per-element with `data-event-stop`.
    stopPropagation: false,
    preventDefault: true,
    debounce: 0,
    throttle: 0
});

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
 * Core event methods (action binding, dispatch, config, parsing, public emitter).
 * The list-delegation + list-conditional cluster lives in ListEventDelegationMethods
 * (below) and is spread onto the prototype only by list-capable builds (via
 * ListRenderer), so no-list builds tree-shake it out.
 */
const _eventCore = {
/**
     * Bind component actions to DOM elements
     * @private
     */
    _bindComponentActions(instance)
    {
        const {element, context} = instance;

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

                // Skip elements inside a <template>: they belong to a list or
                // pool template. Only reachable for <template> inside <svg>,
                // which the parser leaves as an inert element with live children.
                if (actionEl.closest('template')) {
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
                const ssrComponent = actionEl.closest(this._attrSelector('ssr', 'true'));
                if (ssrComponent && nestedListParent) {
                    const listItem = __FEATURE_LISTS__ ? this._findListItemAncestor(actionEl) : null;
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
                // A form's submit is dispatched in one place for every form
                // (FormHandling._handleFormSubmit, a capture listener on the
                // document). Nothing is bound here: a listener per form, added
                // again on every re-bind, ran the handler a second time, and
                // the record it made replaced the form's other actions. The
                // return also keeps a bare data-action="save" on a form from
                // being bound as a click.
                //
                // What IS left on the form is which component bound it. Code
                // outside the framework can move a form out of its component
                // afterwards (a dialog library appending to <body>); the
                // dispatcher then has nothing in the DOM to find the owner by.
                el._wfFormOwner = instance.id;
                return;
            }

            // An action in a list row belongs to the list: its listener
            // dispatches it, with the row, for every event type the row
            // template declares. This binder runs before rows exist, and again
            // on every re-bind (rebindActions(), a data-bind-html paint, a
            // template swap), when they do. Binding a rendered row here as
            // well gave it a second listener and replaced its record, so a
            // row's modifiers and its other actions worked or not depending
            // on whether a re-bind had happened and how the row was built.
            // (_findListItemAncestor stops at a component boundary: a child
            // component in a row binds its own actions.)
            if (__FEATURE_LISTS__)
            {
                const row = this._findListItemAncestor(el);
                if (row)
                {
                    // Markup the app put into a rendered row (and re-bound)
                    // may declare an event type the row template does not;
                    // the row's list is asked to listen for it.
                    const rowList = this._findRowList(row);
                    if (rowList && rowList._wfDelegateType)
                    {
                        const defs = this._parseActions(this._getAttr(el, 'action') || '');
                        for (let d = 0; d < defs.length; d++) rowList._wfDelegateType(defs[d].eventType);
                    }
                    return;
                }
            }

            // Parse attribute-based configuration
            const attrConfig = this._parseEventModifiers(el);
            // Parse actions (can have multiple space-separated actions) - support both prefixes
            const actionDefs = this._parseActions(this._getAttr(el, 'action'));

            actionDefs.forEach(({eventType, methodName, args: actionArgs}) =>
            {
                // Skip if the action method doesn't exist in the context
                if (!methodName || !getContextMethod(context, methodName))
                {
                    return;
                }

                let actionContext;
                if (this._contextSystemInitialized)
                {
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

                // The default options, merged with the element's own modifiers.
                const actionConfig = this._mergeEventConfigs(DEFAULT_ACTION_CONFIG, attrConfig);

                // If we have a context, store options. `bound` says this
                // record has a listener of its own, which applies once /
                // debounce / throttle; the dispatcher leaves those to it.
                if (actionContext)
                {
                    actionContext.data.options = actionConfig;
                    actionContext.data.bound = true;
                }

                // Create a unique key for this action
                const actionKey = `action-${instance.id}-${methodName}-${eventType}-${Date.now()}`;

                // Cache key modifiers at bind time (static attributes, no need to re-parse per event)
                if (!keyModifiersCache.get(el)) keyModifiersCache.set(el, this._parseKeyModifiers(el));

                // Create a handler function
                const baseHandler = (event) =>
                {
                    this._handleActionWithContext(actionContext, event);
                };

                // Check if this should use outside click detection

                if (actionConfig.outside)
                {
                    this._setupOutsideClickHandler(el, instance, methodName);
                    return; // Skip regular event binding for outside handlers
                }
                // Apply debounce or throttle. One wrapper per element and
                // action, never shared: a wrapper cached by component, method
                // and event type made a second element with the same action
                // run the FIRST element's handler, with the first element and
                // its arguments. (The duplicate-binding guard below already
                // keeps an element from being wrapped twice.)
                const handler = this._getHandlerWithLimits(baseHandler, actionConfig);

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
    },
    /**
     * Options for an action record that was made without them: every record
     * except the ones the component's binder makes. A list row's record is
     * made when the row is first used; records for re-inserted (data-render)
     * and portaled content are made by their own binders. None of those read
     * the element's data-event-* modifiers, so on a row data-event-self,
     * -prevent, -stop, -if and -delay did nothing.
     *
     * Worked out once per record and action, from the same two functions the
     * binder uses, and kept on the record. data-event-* attributes are never
     * stripped from a row, so this holds for rows built either way.
     * @param {Object} actionContext - The action record
     * @param {string} key - What the options are kept under ('<event type>:<method>')
     * @returns {Object}
     * @private
     */
    _actionOptions(actionContext, key) {
        const data = actionContext.data;
        // A row built from a compiled template: the modifiers are the
        // template's, so every row's record for this action has the same
        // options. They are worked out once and kept on the compiled action;
        // a row's first use reads no attributes.
        const meta = data.meta;
        let options = (meta && meta._options) ? meta._options[key] : undefined;
        if (options === undefined) {
            options = this._mergeEventConfigs(
                DEFAULT_ACTION_CONFIG,
                this._parseEventModifiers(actionContext.element));
            if (meta) (meta._options || (meta._options = {}))[key] = options;
        }
        (data._options || (data._options = {}))[key] = options;
        return options;
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
        // The event type the action was DECLARED for (focus for a focusin,
        // mouseenter for a mouseover that crossed in): what its options and
        // its once / debounce / throttle state are kept under.
        let actionType = actionContext.data?.event || event.type;
        // Only list rows build data.eventHandlers (ListItemBinding and the
        // list delegation), so a tier without lists never routes through it.
        const eventHandlers = __FEATURE_LISTS__ ? actionContext.data?.eventHandlers : null;
        if (eventHandlers) {
            const eventType = event.type;
            actionType = eventType;
            let handler = eventHandlers.get(eventType) || null;
            if (!handler && eventType === 'focusin' && (handler = eventHandlers.get('focus') || null)) actionType = 'focus';
            if (!handler && eventType === 'focusout' && (handler = eventHandlers.get('blur') || null)) actionType = 'blur';
            if (!handler && eventType === 'mouseover' && eventHandlers.has('mouseenter')) {
                const rel = event.relatedTarget;
                if (!(rel && element.contains(rel))) { handler = eventHandlers.get('mouseenter'); actionType = 'mouseenter'; }
            }
            if (!handler && eventType === 'mouseout' && eventHandlers.has('mouseleave')) {
                const rel = event.relatedTarget;
                if (!(rel && element.contains(rel))) { handler = eventHandlers.get('mouseleave'); actionType = 'mouseleave'; }
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

        // Action options: the element's data-event-* modifiers merged over the
        // default options. The component's binder puts them on the
        // records it makes. Every other record (a list row's, one made for
        // re-inserted or portaled content) is made without them and gets them
        // here, on first use.
        const data = actionContext.data;
        let options = data.options;
        let key = null;   // what this action's options and state are kept under
        if (!options) {
            key = actionType + ':' + methodName;
            options = (data._options && data._options[key]) || this._actionOptions(actionContext, key);
        }

        // An outside action is run by the outside-click registry when a
        // click lands elsewhere. A click inside its own element is not one.
        if (options.outside) {
            return;
        }

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

        // A record the component's binder made has its own listener, and that
        // listener applies once / debounce / throttle. (The delay is applied
        // at the call.)
        if (data.bound) {
            this._runAction(actionContext, methodName, actionArgs, event, options);
            return;
        }

        // Every other record is reached through a listener it shares (a
        // list's, or one bound without modifiers), so the same three are
        // applied here, per element and action.
        if (__DEV__ && options.capture && !data._captureWarned) {
            data._captureWarned = true;
            wfError(WF_ERRORS.ROW_ACTION_CAPTURE, { warn: true, context: `data-action="${methodName}" in component '${componentInstance.name}'` });
        }
        if (options.once && data._fired && data._fired[key]) return;

        // The event is this action's from here on, also when the call is
        // deferred: an action further out must not run for it meanwhile.
        event._wfHandled = true;

        if (options.throttle > 0) {
            const now = Date.now();
            const last = data._last || (data._last = {});
            if (last[key] && now - last[key] < options.throttle) return;
            last[key] = now;
        }

        const wait = (options.debounce > 0 ? options.debounce : 0) + (options.delay > 0 ? options.delay : 0);
        if (wait > 0) {
            const timers = data._timers || (data._timers = {});
            if (options.debounce > 0 && timers[key]) clearTimeout(timers[key]);
            const id = setTimeout(() => {
                if (timers[key] === id) timers[key] = 0;
                // The component may be gone by now, or the element (a removed row).
                if (!this.componentInstances.has(componentInstance.id) || !element.isConnected) return;
                if (options.once) {
                    // Two events inside the wait each scheduled a call; the
                    // first one to run is the one.
                    const fired = data._fired || (data._fired = {});
                    if (fired[key]) return;
                    fired[key] = true;
                }
                // The wait is over: run it now, without the delay a second time.
                this._runAction(actionContext, methodName, actionArgs, event, options, true);
            }, wait);
            if (options.debounce > 0) timers[key] = id;
            return;
        }

        if (options.once) (data._fired || (data._fired = {}))[key] = true;
        this._runAction(actionContext, methodName, actionArgs, event, options);
    },
    /**
     * Work out what an action is told about where it is (the row, for an
     * action in a list) and call it. Runs when the call actually happens, so
     * an action deferred by a delay or a debounce is told about its row as it
     * is then.
     * @param {boolean} [waited=false] - the action's delay has already elapsed
     * @private
     */
    _runAction(actionContext, methodName, actionArgs, event, options, waited = false) {
        const { element, componentInstance } = actionContext;
        if (waited) options = NO_DELAY;

        // Prepare detail object for list items
        let detail = {};

        // List-item detail building is a list-tier concern; in the nano build
        // (__FEATURE_LISTS__ = false) this whole block folds away and the core
        // dispatcher falls straight through to the plain invoke below.
        if (__FEATURE_LISTS__) {
        // Build the list-item detail straight off the row element: index/item
        // from _listIndex/_itemData (the reactive item-proxy the render effect
        // tracks), the array via getValue (top-level) or the parent row's
        // item-proxy (nested). Identity-rooted, so it survives parent
        // reorder/splice. Replaces the former list-context resolveData() read
        // (one-graph absorption). An action outside a row, or in a row whose
        // list does not resolve, gets the plain call below with an empty
        // detail.
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
        } // end if (__FEATURE_LISTS__) — list-item detail building

        if (actionArgs && actionArgs.length > 0) { detail.args = actionArgs; }
        this._invokeActionHandler(componentInstance, methodName, event, element, detail, actionArgs, options);
    },
    /**
     * Invoke an action handler with error handling and optional delay.
     * @private
     */
    _invokeActionHandler(componentInstance, methodName, event, element, detail, actionArgs, options) {
        // An item-level computed reads as a function from component code;
        // it is never an action.
        if (!getContextMethod(componentInstance.context, methodName)) return;
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
};

/**
 * List event delegation + list-item conditional cluster. Spread onto the
 * prototype only by list-capable builds (via ListRendererMethods), so no-list
 * builds tree-shake this whole object out. Entry points are list-side (mount
 * sets up delegation; DOM events trigger the handlers); nothing outside the
 * list pipeline calls into these methods.
 */
export const ListEventDelegationMethods = {
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
        if (!__FEATURE_LISTS__) return null;
        // Find the list item ancestor
        const listItem = this._findListItemAncestor(target);
        if (!listItem) return null;

        // Check for compiled metadata and cached elements
        const metadata = listItem._compiledMetadata;
        const elements = this._rowElements(listItem);

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
     * Resolve the live array a list element renders, identity-rooted through the
     * item-proxy chain: a top-level list reads via getValue(path); a nested list
     * reads the child path off its owning row's item-proxy. Returns null when the
     * path does not resolve to an array (caller then falls back).
     * @private
     */
    _resolveRowListArray(listEl, listPath, componentInstance) {
        if (!listEl || !listPath) return null;
        const ownerRow = this._findListItemAncestor(listEl);
        // A nested list reads its row item exactly as it rendered
        // (_rowListValue); a $store path or a dotted path the component
        // declares (data-list="settings.options" in a row) reads like a
        // top-level list. Same test as the list's own (_rowListReadsComponent).
        if (ownerRow && ownerRow._listIndex !== undefined && ownerRow._itemData &&
            !this._rowListReadsComponent(componentInstance, listPath)) {
            const parentListEl = this._findRowList(ownerRow);
            const nested = this._rowListValue(ownerRow._itemData, listPath, componentInstance,
                ownerRow._listIndex, parentListEl ? parentListEl._listContext : null);
            return Array.isArray(nested) ? nested : null;
        }
        // Top-level list: mirror the former list-context resolution: external(…)
        // through the external fn, store shorthand normalized, then getValue
        // (which covers bare-computed/state paths; computed: is stripped).
        const sm = componentInstance && componentInstance.stateManager;
        if (!sm) return null;
        listPath = this._listPathBare(listPath);
        let value;
        // Normalize FIRST: `$store.items` becomes external(...), and has to
        // take the external branch. Tested on the raw path it fell through
        // to getValue, which knows nothing of external(), so a row of a
        // store-sourced list was told length 0 and no list.
        if (listPath.includes('$') && this._normalizeStoreShorthands) {
            listPath = this._normalizeStoreShorthands(listPath);
        }
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
            value = sm.getValue(listPath);
        }
        return Array.isArray(value) ? value : null;
    },
    /**
     * Build the action `detail` for a list-row element without a CM list context.
     * index/item come straight off the row (_listIndex / _itemData), the array
     * from _resolveRowListArray, and the parent chain is walked through the DOM
     * row ancestry. Returns null when the row is missing its list element, path,
     * item data or index (the caller then passes an empty detail). Public
     * event.detail contract:
     * { index, item, list, length, first, last, context?, parent? }.
     * @private
     */
    _buildListActionDetail(rowEl, componentInstance) {
        const listEl = this._findRowList(rowEl);
        const listPath = listEl ? this._getAttr(listEl, 'list') : null;
        const index = rowEl._listIndex;

        // Cheap structural validity gate (no array resolution). The former
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
            // The list create path stores RAW items on _itemData (no per-item
            // proxy allocated at create). A handler that mutates
            // details.item.field needs the reactive proxy so the set trap
            // fires. Resolve through the state facade (the same read the
            // user's own state[listPath][index] performs) so the handler
            // receives THE tree proxy — identity-stable against user state
            // reads (===, indexOf) and carrying the entity onStateChange
            // dispatch on writes — regardless of which proxy kind _itemData
            // happens to hold (a plain-cache proxy minted before the tree
            // wrap exists would otherwise survive wrap-on-demand untouched).
            // Lazy getter so a handler that never reads `item` pays nothing.
            get item() {
                const L = getList();
                if (L) { const v = L[index]; if (v !== undefined) return v; }
                const d = rowEl._itemData;
                const rsm = componentInstance && componentInstance.stateManager;
                if (rsm && rsm.reactive) return rsm.reactive(rsm.toRaw ? rsm.toRaw(d) : d);
                return d;
            },
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
            const parentListEl = this._findRowList(parentRow);
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
                // The computed: prefix is optional (computed:a.b reads a.b).
                let data = instance.stateManager.getValue(this._listPathBare(path));

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
        // click-family rule (forms are submit-handled; any other element
        // answers for a click when it declares a click action).
        listElement.addEventListener('click', (event) =>
        {
            this._dispatchDelegatedListEvent(event, listElement, instance, listContext, path,
                (actionEl, evt, meta) => (actionEl.tagName !== 'FORM' && this._declaresAction(actionEl, 'click', meta)) ? 'click' : null);
        });

        // No submit listener here: a form's submit is dispatched in one place
        // for every form, in or out of a list (FormHandling._handleFormSubmit).

        // Add focus/blur delegation using focusin/focusout (which bubble, unlike focus/blur)
        // This enables data-action="focus:handler" and data-action="blur:handler" in list items
        this._addListFocusBlurDelegation(listElement, instance, listContext, path);

        // Add delegation for keyboard and input events (keydown, keyup, input, change, etc.)
        // Click and focus/blur are already handled above (submit is not a list concern:
        // FormHandling._handleFormSubmit dispatches it). This covers remaining event types
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
        // Common case: the target sits inside one of this list's rows. One
        // walk resolves the row, the action element and any nested component
        // root; the cascade below then runs with everything in hand.
        const r = this._resolveListActionTarget(event.target, listElement);
        if (r !== null) {
            const row = r.row;
            const chain = r.chain;
            // The action element: the nearest one, from the target up to the
            // row, that declares an action FOR THIS EVENT. An element is known
            // to carry actions by its attribute, by a record made on an
            // earlier use, or, on a row built from the stripped template, by
            // the row's compiled metadata. Asking each one in turn (and not
            // stopping at the first that has any action, or preferring one
            // that already has a record) is what lets a click on an input
            // with only a key action reach the row's own click action, and
            // an inner button still win after the row has been clicked.
            const md = row._compiledMetadata;
            const metaActions = (md && md.actions && md.actions.length > 0) ? md.actions : null;
            let els = null;
            let actionEl = null, metaAction = null, dispatchEventType = null;
            for (let i = 0; i < chain.length; i++) {
                const el = chain[i];
                // (A record can be null as well as absent: SSR activation
                // clears them before it re-binds.)
                const record = el._actionContext;
                const hasRecord = record != null;
                // An element bound by a component's own binder has its own
                // listener (an action inside a child component that sits in
                // the row): that listener dispatches it, with the modifiers
                // it was bound with. Dispatching it from here as well ran it
                // again whenever the listener had declined or was gone
                // (data-event-once).
                if (hasRecord && record.data.bound === true) continue;
                const hasAttr = !hasRecord && this._hasAttr(el, 'action');
                let meta = null;
                if (!hasRecord && !hasAttr) {
                    if (metaActions === null) continue;
                    if (els === null) els = this._rowElements(row) || false;
                    if (els === false) continue;
                    for (let a = 0; a < metaActions.length; a++) {
                        if (els[metaActions[a].index] === el) { meta = metaActions[a]; break; }
                    }
                    if (meta === null) continue;
                }
                // An outside action answers for clicks that land elsewhere
                // (the outside-click registry runs it). It takes no part in
                // an event inside its own element, which goes on to whatever
                // is further out. (Such an element never has a record here.)
                if (meta !== null ? meta.hasEventOutside === true : (hasAttr && this._hasAttr(el, 'event-outside'))) continue;
                const type = resolveDispatchType(el, event, meta);
                if (type) { actionEl = el; metaAction = meta; dispatchEventType = type; break; }
            }
            if (actionEl === null) return;

            // Metadata match on an element with no record yet: build that one
            // record; rows that need the whole-row path (data-event-outside)
            // get it from _ensureActionRecord's refusal.
            if (metaAction !== null && actionEl._actionContext == null
                && !this._ensureActionRecord(row, actionEl, metaAction, listElement._listContext)) {
                this._ensureItemContexts(row);
            }

            // Route to a nested component's instance when the action element
            // lives inside one (component roots at or above the action
            // element only; one crossed below it belongs to the target's own
            // subtree, exactly as closest() from the action element saw it).
            let targetInstance = instance;
            if (r.sawComponent) {
                let c = actionEl;
                while (c && c !== listElement) {
                    if (c.hasAttribute('data-component-id')) {
                        if (c !== instance.element) {
                            const nestedInstance = this.componentInstances.get(c.dataset.componentId);
                            if (nestedInstance) targetInstance = nestedInstance;
                        }
                        break;
                    }
                    c = c.parentElement;
                }
            }

            const currentListContext = listElement._listContext;
            if (currentListContext) {
                const handled = this._handleDelegatedActionWithListItem(
                    actionEl, row, currentListContext, listElement,
                    event, targetInstance, dispatchEventType
                );
                if (handled) return;
            }
            if (this._handleDelegatedActionFromContext(actionEl, event, dispatchEventType)) return;
            this._handleDelegatedActionFallback(actionEl, event, targetInstance, listContext, path, dispatchEventType);
            return;
        }

        // The target is not inside a row of this list (a nested list's row,
        // whose own listener handles it, or a non-row child of the container):
        // the original resolution, kept for those shapes.
        //
        // It must honor exclusive mode. A literal both-prefix selector matches a
        // BARE data-action even when the author asked the framework to ignore
        // bare attributes, which is the whole purpose of the mode: it exists so
        // WildflowerJS can sit beside a library that owns data-action. The
        // element then reached the name read, which IS mode-aware and returned
        // null, and the dispatch crashed on null.length.
        // Some events have a text node for a target.
        const target = (event.target && event.target.nodeType !== 1) ? event.target.parentElement : event.target;
        if (!target) return;
        const actionSel = this._attrSelector('action');
        let actionEl = target.closest(actionSel);
        if (actionEl && !listElement.contains(actionEl)) {
            actionEl = null;
        }
        if (!actionEl) {
            actionEl = this._findActionElementViaRegistry(target, listElement);
        }
        if (!actionEl) {
            actionEl = this._findActionElementViaMetadata(target, listElement);
        }

        // As on the common path: the nearest element that declares an action
        // FOR THIS EVENT, passing over the ones that take no part in it. An
        // element with an action for another event type (a nested row's
        // dblclick cell under a row with a click action), an element bound by
        // a component's own binder (the container itself, a non-row child:
        // its own listener runs it, with its modifiers) and an outside
        // action. Stopping at the first element with any action left the
        // outer row's action dead for those clicks, and ran a bound
        // container action a second time without its once/throttle/debounce.
        let dispatchEventType = null;
        for (;;) {
            if (!actionEl) return;
            const record = actionEl._actionContext;
            if (!(record != null && record.data.bound === true) && !this._hasAttr(actionEl, 'event-outside')) {
                dispatchEventType = resolveDispatchType(actionEl, event);
                if (dispatchEventType) break;
            }
            if (actionEl === listElement) return;
            const up = actionEl.parentElement;
            actionEl = up ? up.closest(actionSel) : null;
            if (actionEl && !listElement.contains(actionEl)) return;
        }

        // An action on a row root belongs to the row's list, also when that
        // root is itself a nested list (closest() would return the row). And
        // an action on a nested list's CONTAINER belongs to the list whose
        // row the container sits in, not to the list it renders.
        let closestList = (actionEl._listIndex !== undefined || this._hasAttr(actionEl, 'list'))
            ? this._findRowList(actionEl)
            : actionEl.closest(this._attrSelector('list'));
        if (closestList !== listElement) {
            const stripped = this._findActionElementViaMetadata(target, listElement);
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

            if (listItem) {
                const handled = this._handleDelegatedActionWithListItem(
                    actionEl, listItem, currentListContext, closestList,
                    event, targetInstance, dispatchEventType
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
     * One upward walk from an event target to this list's container. Finds
     * the row (the ancestor carrying _listIndex whose parent is the
     * container), the elements on the way from the target to the row (the
     * caller asks each, nearest first, whether it declares an action for the
     * event), and whether a nested component root was crossed. Returns null
     * when the target is not inside a row of this list: the walk reached the
     * container without a row, or crossed a nested list's row or container
     * (that list's own listener handles the event).
     * @private
     */
    _resolveListActionTarget(target, listElement)
    {
        const chain = [];
        // Some events have a text node for a target (selectstart).
        let el = (target && target.nodeType !== 1) ? target.parentElement : target;
        let row = null, sawComponent = false;
        while (el && el !== listElement) {
            const isRow = el._listIndex !== undefined;
            if (isRow) {
                if (el.parentElement !== listElement) return null;   // a nested list's row
            } else if (el._listContext) {
                return null;                                          // a nested list's container
            }
            if (!sawComponent && el.hasAttribute('data-component-id')) sawComponent = true;
            chain.push(el);
            if (isRow) { row = el; break; }
            el = el.parentElement;
        }
        if (row === null) return null;
        return { row, chain, sawComponent };
    },
    /**
     * Whether an action element declares an action for an event type. The
     * declaration is read from the element's record when it has one that
     * holds the type, else from its data-action attribute, else, for an
     * element of a row built from the stripped template, from the row's
     * compiled metadata (passed in when the caller has already found it).
     * @param {HTMLElement} el - An action element
     * @param {string} type - The declared event type (click, focus, keydown, ...)
     * @param {Object|null} [meta] - The element's compiled-metadata action
     * @returns {boolean}
     * @private
     */
    _declaresAction(el, type, meta)
    {
        const record = el._actionContext;
        if (record) {
            const handlers = record.data.eventHandlers;
            if (handlers ? handlers.has(type) : record.data.event === type) return true;
        }
        const defs = this._actionDefsOf(el, meta);
        if (defs) {
            for (let i = 0; i < defs.length; i++) {
                if (defs[i].eventType === type) return true;
            }
        }
        return false;
    },
    /**
     * Every action an element declares, parsed: from its attribute, or for a
     * stripped row element from the row's compiled metadata (parsed once per
     * template and kept there).
     * @private
     */
    _actionDefsOf(el, meta)
    {
        if (!meta) {
            const attr = this._getAttr(el, 'action');
            if (attr) {
                // Parsed once per element (and again if the attribute is
                // changed): a row that keeps its attributes is asked on every
                // event of every delegated type.
                if (el._wfActionAttr !== attr) {
                    el._wfActionAttr = attr;
                    el._wfActionDefs = this._parseActions(attr);
                }
                return el._wfActionDefs;
            }
            const row = this._findListItemAncestor(el);
            const md = row && row._compiledMetadata;
            const els = (md && md.actions) ? this._rowElements(row) : null;
            if (!els) return null;
            for (let a = 0; a < md.actions.length; a++) {
                if (els[md.actions[a].index] === el) { meta = md.actions[a]; break; }
            }
            if (!meta) return null;
        }
        return meta._parsedDefs || (meta._parsedDefs = this._parseActions(meta.actionName));
    },
    /**
     * Make an element's action record answer for every action the element
     * declares, not only the one it was made for: the others are added to
     * its eventHandlers (the map is only created when there is a second
     * event type to hold).
     * @private
     */
    _completeActionRecord(record, defs, componentInstance)
    {
        const data = record.data;
        for (let d = 0; d < defs.length; d++) {
            const { methodName, eventType, args } = defs[d];
            if (!methodName || !getContextMethod(componentInstance.context, methodName)) continue;
            if (!data.eventHandlers) {
                if (eventType === data.event) continue;
                data.eventHandlers = new Map();
                data.eventHandlers.set(data.event, { methodName: record.path, args: data.actionArgs || [] });
            }
            if (!data.eventHandlers.has(eventType)) {
                data.eventHandlers.set(eventType, { methodName, args: args || [] });
            }
        }
    },
    /**
     * Create the action record for ONE action element of a compiled row on
     * its first interaction, instead of every record the row will ever need
     * (_ensureItemContextsFromMetadata builds them all). Same record, same
     * eventHandlers merge for an element declaring several actions. Returns
     * false when this element must take the whole-row or attribute path: an
     * action inside a nested list or nested component (those are skipped by
     * the whole-row builder too and resolve through the attribute path
     * against the routed instance), or a row with a data-event-outside
     * action, whose document-level registration must exist before any
     * outside click and is made on the row's first interaction.
     * @private
     */
    _ensureActionRecord(row, actionEl, metaAction, listContext)
    {
        if (metaAction.isInNestedList || metaAction.isInNestedComponent || metaAction.hasEventOutside) return false;
        const md = row._compiledMetadata;
        if (md._hasEventOutside === undefined) {
            let has = false;
            const actions = md.actions;
            for (let i = 0; i < actions.length; i++) { if (actions[i].hasEventOutside) { has = true; break; } }
            md._hasEventOutside = has;
        }
        if (md._hasEventOutside) return false;
        const componentInstance = listContext && listContext.componentInstance;
        if (!componentInstance || !this._contextRecords || !this._contextSystemInitialized) return false;

        const defs = metaAction._parsedDefs || (metaAction._parsedDefs = this._parseActions(metaAction.actionName));
        const itemIndex = row._listIndex;
        for (let d = 0; d < defs.length; d++) {
            const { methodName, eventType, args: actionArgs } = defs[d];
            if (!methodName || !getContextMethod(componentInstance.context, methodName)) continue;
            const existing = actionEl._actionContext;
            if (existing) {
                if (!existing.data.eventHandlers) {
                    existing.data.eventHandlers = new Map();
                    existing.data.eventHandlers.set(existing.data.event, {
                        methodName: existing.path,
                        args: existing.data.actionArgs || []
                    });
                }
                existing.data.eventHandlers.set(eventType, { methodName, args: actionArgs || [] });
                continue;
            }
            const record = this._contextRecords.createActionContext(
                methodName, componentInstance, actionEl, methodName, eventType, listContext, itemIndex
            );
            if (record) {
                if (actionArgs && actionArgs.length > 0) record.data.actionArgs = actionArgs;
                // Which compiled action this record is for: its options are
                // the same for every row of the template, and are worked out
                // once there (see _actionOptions).
                record.data.meta = metaAction;
            }
        }
        return actionEl._actionContext != null;
    },
    /**
     * Per-family matcher for focus/blur delegation: does this action element
     * declare the given focus-family action (focus/blur, or the raw
     * focusin/focusout)? (It used to read only the FIRST event of an
     * element's record, so on a stripped row `click:open focus:hilite`
     * stopped answering for focus once the record existed.)
     * @private
     */
    _focusActionMatches(actionEl, bubblingEvent, actionEvent, meta)
    {
        return this._declaresAction(actionEl, actionEvent, meta) || this._declaresAction(actionEl, bubblingEvent, meta);
    },
    /**
     * Per-family resolver for generic event delegation (keyboard, input,
     * change, mouseover/mouseout): verify the action element declares this
     * event type, and synthesize mouseenter/mouseleave from mouseover/mouseout
     * via the standard relatedTarget containment check. Returns the event-type
     * name to dispatch under, or null when this element declares no action
     * for it (the dispatcher then asks the next element out).
     * @private
     */
    _resolveGenericDispatchType(actionEl, event, eventType, meta)
    {
        if (this._declaresAction(actionEl, eventType, meta)) {
            // Direct match: dispatch as-is.
            return eventType;
        }
        if (eventType === 'mouseover' && this._declaresAction(actionEl, 'mouseenter', meta)) {
            // Synthesize mouseenter: only fire when the cursor crosses INTO
            // this action element from outside.
            const rel = event.relatedTarget;
            if (rel && actionEl.contains(rel)) return null;
            return 'mouseenter';
        }
        if (eventType === 'mouseout' && this._declaresAction(actionEl, 'mouseleave', meta)) {
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
                    (actionEl, evt, meta) => this._focusActionMatches(actionEl, bubblingEvent, actionEvent, meta) ? actionEvent : null);
            };
        };

        // Add listeners for focusin and focusout
        listElement.addEventListener('focusin', createFocusHandler('focusin', 'focus'));
        listElement.addEventListener('focusout', createFocusHandler('focusout', 'blur'));
    },

    /**
     * Add delegated event listeners for the non-click, non-focus events
     * declared by data-action attributes within a list template: keydown,
     * input, change, dblclick, a custom event, whatever the template names.
     *
     * Scans the list's template for data-action attributes, extracts unique event types,
     * and registers a delegated listener on the list container for each one.
     * A type not known to bubble also gets a capture listener, which handles
     * the event only on the element it happens on.
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
        // Types the list already has a listener for (click, focus and blur
        // through focusin/focusout).
        const OWN_LISTENER = { click: 1, focus: 1, blur: 1, focusin: 1, focusout: 1 };
        // Types known to bubble: one listener is enough for these. Any other
        // type also gets a capture listener (see register below).
        const KNOWN_BUBBLING = {
            keydown: 1, keyup: 1, keypress: 1, input: 1, change: 1, submit: 1,
            mouseover: 1, mouseout: 1, mousedown: 1, mouseup: 1, mousemove: 1,
            dblclick: 1, contextmenu: 1, auxclick: 1, wheel: 1,
            pointerdown: 1, pointerup: 1, pointermove: 1, pointerover: 1, pointerout: 1, pointercancel: 1,
            touchstart: 1, touchend: 1, touchmove: 1, touchcancel: 1,
            dragstart: 1, drag: 1, dragend: 1, dragenter: 1, dragover: 1, dragleave: 1, drop: 1,
            copy: 1, cut: 1, paste: 1
        };

        // Register a delegated listener for one event type, once. The shared
        // dispatcher does resolution/boundary/routing/cascade; the resolver
        // verifies the declared event type and synthesizes mouseenter/leave.
        //
        // Kept on the list element, because the template is not the only
        // source of row actions: the app can put markup into a rendered row
        // and call rebindActions(), and the binder then asks the row's list
        // to listen for whatever that markup declares (_bindComponentActions).
        const registered = new Set();
        const register = (type) => {
            // Synthesized enter/leave: register the underlying bubbling event
            // so per-row mouseenter/mouseleave handlers reach this path.
            if (SYNTHESIZED_FROM[type]) type = SYNTHESIZED_FROM[type];
            if (OWN_LISTENER[type] || registered.has(type)) return;
            registered.add(type);
            listElement.addEventListener(type, type === 'submit'
                // A form's own submit action is the submit dispatcher's
                // (FormHandling._handleFormSubmit); a submit action on
                // another row element still runs when a form inside it is
                // submitted. That form may have no action of its own, and
                // the submit dispatcher leaves an action-less form in a row
                // alone, so the submit is prevented here: an element that
                // handles the submit does not also send the page away.
                ? (event) => {
                    this._dispatchDelegatedListEvent(event, listElement, instance, listContext, path,
                        (actionEl, evt, meta) => {
                            if (actionEl.tagName === 'FORM') return null;
                            const resolved = this._resolveGenericDispatchType(actionEl, evt, type, meta);
                            if (resolved) evt.preventDefault();
                            return resolved;
                        });
                }
                : (event) => {
                    this._dispatchDelegatedListEvent(event, listElement, instance, listContext, path,
                        (actionEl, evt, meta) => this._resolveGenericDispatchType(actionEl, evt, type, meta));
                });
            // An event that does not bubble never reaches the listener above.
            // For any type not known to bubble, catch it on the way down
            // instead, and only for the element it happens on (media events,
            // scroll, a CustomEvent dispatched without `bubbles`).
            if (!KNOWN_BUBBLING[type]) {
                listElement.addEventListener(type, (event) => {
                    if (event.bubbles) return;
                    this._dispatchDelegatedListEvent(event, listElement, instance, listContext, path,
                        (actionEl, evt, meta) => (evt.target !== actionEl)
                            ? null
                            : this._resolveGenericDispatchType(actionEl, evt, type, meta));
                }, true);
            }
        };
        listElement._wfDelegateType = register;

        // The types declared by an action attribute: "event:method" parts.
        // (Every declared type gets a listener, whatever it is: dblclick,
        // contextmenu, pointerdown, paste, a custom event. The list is the
        // only thing that dispatches a row's actions; a fixed set of types
        // here left the rest dead.)
        const registerDeclared = (root) => {
            const actionEls = root.querySelectorAll(this._attrSelector('action'));
            for (const el of actionEls) {
                const attr = this._getAttr(el, 'action');
                if (!attr) continue;
                const defs = this._parseActions(attr);
                for (let d = 0; d < defs.length; d++) register(defs[d].eventType);
            }
        };

        // The list's own template(s). By the time delegation is set up, mount
        // has already extracted the container's <template>, removed it (left
        // in children it breaks child indexing) and parked the element in the
        // DomMetadata stored-template caches. A nested list's template was
        // lifted out of its parent's template before any row was cloned, so
        // it is in none of those; it is in the list template cache under the
        // list's key. Last, a template still in place; only a DIRECT child,
        // since a row may hold some other list's template. A
        // data-use-template marker resolves through _resolvedTemplateCache to
        // the template it points at.
        let templates = null;
        const stored = storedTemplateCache.get(listElement);
        if (stored) {
            templates = [stored];
        } else {
            const storedAll = storedTemplatesCache.get(listElement);
            if (storedAll && storedAll.length > 0) templates = storedAll;
        }
        if (!templates && listElement._wfTplKey && this._templateCache && this._templateCache.lists) {
            const cached = this._templateCache.lists.get(listElement._wfTplKey);
            if (cached) templates = [cached];
        }
        if (!templates) {
            const kids = listElement.children;
            for (let i = 0; i < kids.length; i++) {
                if (kids[i].localName === 'template') { templates = [kids[i]]; break; }
            }
        }
        if (templates && templates.length === 1 && templates[0].hasAttribute && this._hasAttr(templates[0], 'use-template')) {
            const resolved = this._resolvedTemplateCache && this._resolvedTemplateCache.get(listElement);
            templates = (resolved && resolved.template) ? [resolved.template] : null;
        }

        if (templates) {
            for (const tpl of templates) registerDeclared(tpl.content || tpl);
        } else {
            // No template available (server-rendered rows): what the rows
            // that are there declare, and the common types as before.
            registerDeclared(listElement);
            for (const type of ALL_GENERIC_EVENTS) register(type);
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
                    if (this._hasAttr(parent, 'list'))
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
     * Handle delegated action when list context exists and list item is found
     * @param {HTMLElement} actionEl - The action element
     * @param {HTMLElement} listItem - The list item element
     * @param {Object} listContext - The list context
     * @param {HTMLElement} closestList - The closest list element
     * @param {Event} event - The click event
     * @param {Object} instance - The component instance
     * @returns {boolean} True if action was handled, false otherwise
     * @private
     */
    _handleDelegatedActionWithListItem(actionEl, listItem, listContext, closestList, event, instance, actionEventType = null)
    {
        const index = listItem._listIndex;
        if (isNaN(index)) return false;

        // An element that already carries its record needs no row-wide
        // context creation (records are built per element on first touch);
        // one without goes through the whole-row builder first.
        let existingContext = actionEl._actionContext;
        if (!existingContext) {
            this._ensureItemContexts(listItem);
            existingContext = actionEl._actionContext;
        }

        if (existingContext)
        {
            // Keep _parentIndex current from the row's _listIndex (rows renumber
            // on remove/move); getFullPath and the form/portal paths read it.
            // The former per-dispatch parent-list walk (_collectDataIndexHierarchy
            // + _ensureContextParentInfo) wrote _parentInfo/_fullPath that nothing
            // read and a _parentIndex this line overwrote.
            existingContext._parentIndex = index;

            // Update parent to point to the correct list context.
            // For nested lists, the original parent might be the outer list, but
            // correct data resolution requires the current (closest) list.
            if (listContext && listContext.type === 'list') {
                existingContext.parent = listContext;
            }

            // A record made for one of the element's actions (some routes
            // make it for the action first used) has to answer for the
            // others too, or the second action on the element never runs.
            const type = actionEventType || event.type;
            const handlers = existingContext.data.eventHandlers;
            if (!(handlers ? handlers.has(type) : existingContext.data.event === type)) {
                const defs = this._actionDefsOf(actionEl, null);
                if (defs) this._completeActionRecord(existingContext, defs, existingContext.componentInstance);
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
        // fail to dispatch. See list-row-action-attribute-preserved.test.js.
        if (!actionAttr) {
            const elements = this._rowElements(listItem);
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
        if (!getContextMethod(instance.context, methodName)) {
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
            // The element's other actions, so the record answers for them too
            this._completeActionRecord(context, actions, instance);
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

        const actionAttr = this._getAttr(actionEl, 'action');
        if (!actionAttr) return false;

        const actions = this._parseActions(actionAttr);
        // Use provided actionEventType or fall back to event.type or 'click'
        const eventType = actionEventType || event.type || 'click';
        const matchingAction = actions.find(a => a.eventType === eventType) || actions[0];
        if (!matchingAction) return false;

        const { methodName, args: actionArgs } = matchingAction;
        if (!methodName || !getContextMethod(instance.context, methodName)) return false;

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
        this._applyEventConfiguration(event, DEFAULT_ACTION_CONFIG);

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
     * The list a ROW belongs to. The search starts at the row's parent, not
     * the row: a row whose root element is itself a nested list
     * (<tr data-list="cells"> as a row template) would otherwise find itself.
     * For every other row the two searches give the same element.
     * @param {HTMLElement} row - a list row (an element carrying _listIndex)
     * @returns {HTMLElement|null}
     * @private
     */
    _findRowList(row) {
        return row && row.parentElement ? this._findDirectParentList(row.parentElement) : null;
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
        // A row whose root is itself a nested list owns none of its
        // descendants: every one is inside that list. (The callers' own
        // hasNestedLists check looks only below the row, so it misses this.)
        if (this._hasAttr(row, 'list')) {
            return [];
        }
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
        // The list element carries its template key (see _listTemplateKey);
        // only the plain `component:path` key falls back to the bare path.
        const ownKey = listContainer && listContainer._wfTplKey;
        let compiledMetadata = ownKey ? this._templateCache.compiled.get(ownKey) : undefined;
        if (!compiledMetadata) {
            const baseKey = componentName ? `${componentName}:${listPath}` : listPath;
            if (!ownKey || ownKey === baseKey) {
                compiledMetadata = this._templateCache.compiled.get(baseKey) ||
                                   this._templateCache.compiled.get(listPath);
            }
        }

        // EARLY EXIT: If we have compiled metadata and no conditionals (shows or renders), skip entirely
        const hasShows = compiledMetadata?.shows?.length > 0;
        const hasRenders = compiledMetadata?.renders?.length > 0;
        if (compiledMetadata && !hasShows && !hasRenders) {
            return; // No conditionals to process
        }

        // OPTIMIZATION: Use passed list container/context if available, avoiding DOM traversal
        if (!listContainer) {
            listContainer = this._findRowList(itemElement);
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
                if (this._hasAttr(parent, 'list')) {
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
                    applyShow(conditionalElement, !!conditionValue);
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
        templateClone.removeAttribute('data-wf-cloak');

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
    }
};

const _eventTail = {
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
            // data-event-key-X or data-wf-event-key-X (only the wf form in
            // exclusive mode)
            const base = this._wfBase(attrs[i].name);
            if (base === null || !base.startsWith('event-key-')) continue;
            const rest = base.slice('event-key-'.length);
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
     * @returns {Function} - The handler, possibly wrapped with debounce/throttle
     * @private
     */

    _getHandlerWithLimits(handler, config)
    {
        // No need to wrap if no limits are set
        if (!config || ((!config.debounce || config.debounce <= 0) &&
            (!config.throttle || config.throttle <= 0)))
        {
            return handler;
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

/**
 * Core event methods. The list-delegation cluster (ListEventDelegationMethods)
 * is intentionally NOT included here — list-capable builds add it separately via
 * ListRendererMethods, so no-list builds ship only these core methods.
 */
export const EventSystemMethods = {
    ..._eventCore,
    ..._eventTail
};

