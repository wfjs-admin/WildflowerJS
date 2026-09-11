import { WF_ERRORS, wfError } from '../core/wfUtils.js';
import { boundActionsCache } from '../core/DomMetadata.js';

// Attribute prefix helpers
const _isStrict = () => window.wildflower?.options?.useWfPrefixOnly;

function _cmGetAttr(el, name) {
    const val = el.getAttribute(`data-wf-${name}`);
    // If found, or if we are in strict mode, return the wf- value (even if null)
    return (val !== null || _isStrict()) ? val : el.getAttribute(`data-${name}`);
}

function _cmHasAttr(el, name) {
    const has = el.hasAttribute(`data-wf-${name}`);
    // If found, or if we are in strict mode, return the wf- result
    return (has || _isStrict()) ? has : el.hasAttribute(`data-${name}`);
}

function _cmAttrSelector(name, val) {
    // Build array of attributes to query based on mode
    const attrs = _isStrict() ? [`data-wf-${name}`] : [`data-${name}`, `data-wf-${name}`];
    // Map to selector strings and join
    return attrs.map(attr => val !== undefined ? `[${attr}="${val}"]` : `[${attr}]`).join(',');
}

/**
 * RenderRecord: plain (non-registered) carrier for a data-render conditional.
 *
 * data-render toggles an element's presence in the DOM (insert/remove), unlike
 * data-show which toggles display. The condition read is driven by the component
 * render effect (a `type:'render'` effect-meta whose `context` is this record);
 * the effect calls `_updateConditionalElement` to apply the verdict. The record
 * is held by `instance._renderContexts` / `itemEl._renderContexts` and the effect
 * meta, so it GCs with the element/effect; it is NOT registered anywhere
 * (nothing looks render records up by element or type). The insert/remove
 * machinery below was lifted off the old Context class verbatim.
 */
class RenderRecord
{
    constructor(path, componentInstance, element, parentIndex, wf, factory)
    {
        this.type = 'render';
        this.mode = 'render';
        this.path = path;
        this.componentInstance = componentInstance;
        this.element = element;
        this._parentIndex = parentIndex;
        this._wf = wf;
        this._factory = factory;
        // Set externally by the creation sites (_processDataRenderElement /
        // _processListItemDataRender) and by the insert/remove machinery.
        this.templateClone = null;
        this.isRendered = false;
        this.placeholder = null;
        this.itemData = undefined;
        this._ownerItemEl = undefined;
    }

    /**
     * Apply the condition verdict: insert/remove from DOM.
     * @private
     */
    _updateConditionalElement(isVisible)
    {
        this._updateRenderConditional(isVisible);
    }

    /**
     * Update DOM for render mode conditional (data-render)
     * Inserts/removes element from DOM rather than toggling visibility
     * @private
     */
    _updateRenderConditional(shouldRender)
    {
        const wasRendered = this.isRendered;

        // No change needed
        if (shouldRender === wasRendered) return;

        if (shouldRender && !wasRendered) {
            // Insert element into DOM
            this._insertRenderElement();
        } else if (!shouldRender && wasRendered) {
            // Remove element from DOM
            this._removeRenderElement();
        }

        // List-item data-render: a structural toggle here recreates (or drops)
        // the row's subtree, so the owning per-item effect's cached element
        // arrays now point at stale/detached nodes. Invalidate them so the next
        // per-item re-bind rebuilds against the live DOM. Required when this
        // toggle is driven by the reconcile's position-frame re-eval
        // (_reEvalListItemComputedConditionals) rather than the per-item effect
        // itself, so the effect would otherwise see "no render change" on its
        // next run and write to stale nodes.
        if (this._ownerItemEl) {
            this._ownerItemEl._cachedElementsArray = null;
            this._ownerItemEl._bindingElements = null;
        }

        this.isRendered = shouldRender;
    }

    /**
     * Insert the render element at the placeholder position
     * Note: this.templateClone is assigned externally by wildflowerJS._processDataRenderElement()
     * @private
     */
    _insertRenderElement()
    {
        if (!this.placeholder || !this.templateClone) return;

        // Clone the template (templateClone set by _processDataRenderElement in wildflowerJS.js)
        const newElement = this.templateClone.cloneNode(true);

        // Insert the element at the placeholder position
        this.placeholder.parentNode.insertBefore(newElement, this.placeholder);

        // Remove the placeholder
        this.placeholder.parentNode.removeChild(this.placeholder);
        this.placeholder = null;

        // Update record element reference
        this.element = newElement;

        const wildflower = this._wf;
        if (wildflower) {
            // Scan for nested components first (uses correct initialization path)
            wildflower.scan(newElement);

            const instance = this.componentInstance;
            const componentLevel = !!instance && this._parentIndex === undefined;

            // The init pipeline, in init order, for the clone: the query
            // transform (scope markers, observation, activation), then the
            // nested data-render records, both BEFORE the render effect is
            // recreated so the fresh metadata drives them. A nested section
            // that is false now leaves now, as at init, so its bindings are
            // never collected.
            if (componentLevel) this._prepareInsertedSubtree(wildflower);

            // Recreate the component's render effect BEFORE processing inserted
            // lists and actions, so its metadata is collected against the
            // subtree as inserted.
            if (componentLevel && wildflower._disposeComponentRenderEffect && wildflower._createComponentRenderEffect) {
                // Bump the render token BEFORE recreating: an in-progress render
                // effect that triggered this insert reads the token after its
                // _executeRenderForEffect call and bails the stale meta loop, so
                // the freshly created effect below owns the remaining bindings.
                instance._renderToken = (instance._renderToken | 0) + 1;
                // Records of earlier generations (a nested section of a subtree
                // that has since been removed) point into detached DOM; drop
                // them so the rescan neither drives nor retains them.
                this._pruneRenderContexts(instance);
                // Re-scan DOM for effect metadata (can't reuse init-time _effectMeta
                // because only the data-render subtree was re-inserted; the full
                // component needs a fresh scan)
                instance._effectMeta = wildflower._collectComponentBindingMeta(instance);
                wildflower._disposeComponentRenderEffect(instance);
                wildflower._createComponentRenderEffect(instance);
            }

            // Process lists, actions and pools within the new element
            this._processInsertedElement(wildflower);

            // Process custom directives on the entire re-inserted subtree (only if plugin system is loaded)
            if (wildflower._processCustomDirectivesInSubtree && wildflower._customDirectives && wildflower._customDirectives.size > 0) {
                wildflower._processCustomDirectivesInSubtree(newElement, this.componentInstance);
            }

            // Portals are set up at component init only. A portal inside this
            // subtree teleports now (after the effect collected its content's
            // bindings in place), and its conditions follow the component's
            // state from here on.
            if (componentLevel && wildflower._processPortalsInSubtree) {
                wildflower._processPortalsInSubtree(newElement, instance);
            }
        }
    }

    /**
     * The parts of the init pipeline a re-inserted subtree needs before the
     * render effect is recreated: the data-query transform and the nested
     * data-render records. Mirrors _processComponentBindings (transform) and
     * _processConditionalElements (records pushed to instance._renderContexts
     * so _collectComponentBindingMeta drives them). Without this, a nested
     * section was created by _processRenderElement and then dropped, frozen
     * at its insertion-time verdict, and a record-shape query lost the scope
     * marker its clone does not carry.
     * @private
     */
    _prepareInsertedSubtree(wildflower) {
        const root = this.element;
        const instance = this.componentInstance;
        if (!root || !instance) return;

        if (__FEATURE_QUERY__ && wildflower._transformQueryElements) {
            wildflower._transformQueryElements(root, instance);
        }

        const listSelector = _cmAttrSelector('list');
        const renderEls = root.querySelectorAll(_cmAttrSelector('render'));
        for (const el of renderEls) {
            // Document order puts an outer nested section before the ones
            // inside it; once it evaluated false and left, skip those.
            if (!el.isConnected) continue;
            // Owned by this component (not by a nested component), not slot
            // content, not a row-level conditional (item-scoped, list-owned).
            const closest = wildflower._getComponentElement(el);
            if (closest && closest !== instance.element && root.contains(closest)) continue;
            if (el.closest('[data-use-template-rendered]')) continue;
            const container = el.parentElement ? el.parentElement.closest(listSelector) : null;
            if (container && instance.element.contains(container)) continue;
            const path = _cmGetAttr(el, 'render');
            if (!path) continue;
            const ctx = wildflower._processDataRenderElement(el, path, instance);
            if (ctx) (instance._renderContexts || (instance._renderContexts = [])).push(ctx);
        }
    }

    /**
     * Drop render records that belong to a removed generation: their element
     * or placeholder sits under a subtree data-render took out (marked
     * _wfRenderHidden at removal), so they are outside the component now.
     * A section detached by other code carries no mark and keeps its record.
     * @private
     */
    _pruneRenderContexts(instance) {
        const list = instance._renderContexts;
        if (!list || list.length === 0) return;
        const rootEl = instance.element;
        const stale = (ctx) => {
            const node = ctx && (ctx.element || ctx.placeholder);
            if (!node || node === rootEl || rootEl.contains(node)) return false;
            for (let cur = node; cur; cur = cur.parentNode) {
                if (cur._wfRenderHidden) return true;
            }
            return false;
        };
        let write = 0;
        for (let i = 0; i < list.length; i++) {
            if (!stale(list[i])) list[write++] = list[i];
        }
        list.length = write;
    }

    /**
     * Remove the render element from DOM and insert placeholder
     * @private
     */
    _removeRenderElement()
    {
        if (!this.element) return;

        // Create placeholder comment (include index if in list context for proper identification)
        const indexSuffix = typeof this._parentIndex !== 'undefined' ? ` [${this._parentIndex}]` : '';
        const placeholder = document.createComment(` data-render: ${this.path}${indexSuffix} `);
        this.placeholder = placeholder;

        // Clean up nested components and directives before removing
        const wildflower = this._wf;
        if (wildflower) {
            // The render effect keeps evaluating the bindings of this subtree
            // until insertion re-creates it; mark them so it skips them.
            if (wildflower._markHiddenRenderMetas) wildflower._markHiddenRenderMetas(this.componentInstance, this.element);
            this._cleanupNestedContent(wildflower);
            // Clean up custom directives on this element and its children
            if (wildflower._cleanupCustomDirectivesInSubtree) {
                wildflower._cleanupCustomDirectivesInSubtree(this.element);
            }
        }

        // Insert placeholder and remove element
        this.element.parentNode.insertBefore(placeholder, this.element);
        this.element.parentNode.removeChild(this.element);
        this.element = null;
    }

    /** Process bindings/actions/conditionals in newly inserted render element. @private */
    _processInsertedElement(wildflower) {
        if (!this.element || !this.componentInstance) return;
        const instance = this.componentInstance;

        // Only process bindings the render effect does NOT handle.
        // The effect (recreated before this method) owns: bind, bind-html,
        // show, class, style, attr, model, and (component level) the nested
        // data-render records _prepareInsertedSubtree registered. We only
        // need to set up list, action (event handlers) and pool here; a
        // row-level record still creates its nested render records here.
        const componentLevel = this._parentIndex === undefined;
        const selector = [
            _cmAttrSelector('render'), _cmAttrSelector('list'), _cmAttrSelector('action'), _cmAttrSelector('pool')
        ].join(', ');
        const queried = this.element.querySelectorAll(selector);

        const processEl = (el) => {
            // Skip elements belonging to nested components
            const closest = wildflower._getComponentElement(el);
            if (closest && closest !== instance.element && this.element.contains(closest)) return;

            if (!componentLevel && _cmHasAttr(el, 'render')) this._processRenderElement(el, wildflower);
            if (_cmHasAttr(el, 'list')) this._processListElement(el, wildflower);
            if (_cmHasAttr(el, 'action')) this._processActionElement(el, wildflower);
            if (_cmHasAttr(el, 'pool')) this._processPoolElement(el);
        };

        processEl(this.element);
        queried.forEach(processEl);

        if (wildflower._processSlotTemplates) wildflower._processSlotTemplates(instance);
    }

    /**
     * Re-bind a data-pool container inside a re-inserted data-render block.
     * Pools are set up once at component init (_setupPools) and the handle
     * keeps rendering into the container it was given, so after a toggle the
     * entities lived in the detached first-generation element and the fresh
     * clone stayed empty. The handle already compiled the template, so drop
     * the clone's copy and adopt the live entity elements in order (the pool
     * addresses its children by index).
     * @private
     */
    _processPoolElement(el) {
        const path = _cmGetAttr(el, 'pool');
        const instance = this.componentInstance;
        const handle = path && instance && instance._pools && instance._pools.get(path);
        if (!handle || !handle._container || handle._container === el) return;
        const template = el.querySelector(':scope > template');
        if (template) template.remove();
        const previous = handle._container;
        while (previous.firstChild) el.appendChild(previous.firstChild);
        handle._container = el;
    }

    /**
     * Process a data-list element inside a re-inserted data-render block.
     * @private
     */
    _processListElement(el, wildflower) {
        if (!__FEATURE_LISTS__) return;
        const listPath = _cmGetAttr(el, 'list');
        if (!listPath) return;

        const instance = this.componentInstance;
        const listEntry = {
            element: el,
            path: listPath,
            componentId: instance.id
        };

        // Register in domElements so the list system can find it. Prune this
        // component's entries whose element has left the document first: each
        // reveal registers a fresh entry for the cloned subtree, and every
        // later scan re-walks the whole registry (_mountLists), so without
        // the prune the registry grew by one detached list per toggle.
        if (!wildflower.domElements.lists) wildflower.domElements.lists = [];
        const lists = wildflower.domElements.lists;
        let write = 0;
        for (let i = 0; i < lists.length; i++) {
            const entry = lists[i];
            const stale = entry && entry.componentId === instance.id &&
                entry.element && !entry.element.isConnected;
            if (!stale) lists[write++] = entry;
        }
        lists.length = write;
        lists.push(listEntry);

        // Trigger list mounting
        wildflower._mountLists([listEntry], instance);
    }

    /**
     * Process a data-action element
     * @private
     */
    _processActionElement(el, wildflower) {
        const instance = this.componentInstance;
        const actionAttr = _cmGetAttr(el, 'action');
        const actionDefs = wildflower._parseActions(actionAttr);

        // A form's data-action is its SUBMIT handler, and the form-handling
        // path binds it that way (with validation and state sync attached).
        // Binding it here as well would attach the default click event, so
        // every click inside a form re-inserted by data-render would fire the
        // submit handler.
        if (el.tagName === 'FORM') return;

        for (const {methodName, eventType} of actionDefs) {
            if (methodName && typeof instance.context[methodName] === 'function') {
                // GUARD: Prevent duplicate event binding (same guard used by EventSystem._bindComponentActions)
                let elBoundActions = boundActionsCache.get(el);
                if (!elBoundActions) {
                    elBoundActions = new Set();
                    boundActionsCache.set(el, elBoundActions);
                }
                const bindingKey = `${eventType}-${methodName}`;
                if (elBoundActions.has(bindingKey)) {
                    continue; // Already bound this action/event combination
                }
                elBoundActions.add(bindingKey);

                const actionContext = this._factory.createActionContext(
                    methodName,
                    instance,
                    el,
                    methodName,
                    eventType
                );

                if (actionContext) {
                    const handler = (event) => {
                        wildflower._handleActionWithContext(actionContext, event);
                    };
                    el.addEventListener(eventType, handler);
                    el._wfActionBound = true;

                    // Store handler reference for cleanup
                    const handlerKey = `action-${instance.id}-${methodName}-${eventType}-render-${Date.now()}`;
                    wildflower.eventHandlers.set(handlerKey, {
                        target: el,
                        event: eventType,
                        handler: handler,
                        componentId: instance.id
                    });
                }
            }
        }
    }

    /**
     * Process a nested data-render element
     * @private
     */
    _processRenderElement(el, wildflower) {
        if (el === this.element) return; // Skip self

        const renderPath = _cmGetAttr(el, 'render');
        wildflower._processDataRenderElement(el, renderPath, this.componentInstance);
    }

    /**
     * Clean up nested components and contexts before removing element
     * @private
     */
    _cleanupNestedContent(wildflower)
    {
        if (!this.element) return;

        // Withdraw this component's portals whose source sits in the removed
        // subtree. The teleported content would otherwise stay on the page
        // after the section left, and re-insertion would teleport the
        // clone's copy beside it.
        if (wildflower._withdrawPortalsInSubtree) {
            wildflower._withdrawPortalsInSubtree(this.element, this.componentInstance);
        }

        // Find and destroy nested components
        const nestedComponents = this.element.querySelectorAll('[data-component-id]');
        nestedComponents.forEach(compEl => {
            const compId = compEl.dataset.componentId;
            if (compId && wildflower.hasComponentInstance(compId)) {
                wildflower._destroyComponentQuiet(compId);
            }
        });

        // Dispose the data-list reconcilers in this subtree, the element itself
        // included. Re-insertion clones the template and mounts a fresh list,
        // so a removed list's structural effect would otherwise stay subscribed
        // to its source and reconcile off-DOM for the life of the component
        // (one orphaned effect per toggle; for a data-query list, one that
        // re-stamps the query as observed and keeps it polling). The wrapped
        // dispose cascades into nested lists; the component-destroy cleanups
        // registered at list init are idempotent, so running them later is safe.
        // Lists of the nested components destroyed above are already gone.
        const listSelector = _cmAttrSelector('list');
        const listEls = this.element.querySelectorAll(listSelector);
        const disposeList = (listEl) => {
            if (!listEl._disposeMapArray) return;
            try { listEl._disposeMapArray(); } catch (e) { /* already gone */ }
            listEl._mapArrayInitialized = false;
            listEl._disposeMapArray = null;
        };
        if (this.element.matches && this.element.matches(listSelector)) disposeList(this.element);
        listEls.forEach(disposeList);

        // Clean up action records for elements within this render element - respects useWfPrefixOnly mode
        const cleanupSelector = [
            _cmAttrSelector('bind'),
            _cmAttrSelector('action'),
            _cmAttrSelector('show'),
            _cmAttrSelector('render'),
            _cmAttrSelector('model')
        ].join(', ');
        const allContextElements = this.element.querySelectorAll(cleanupSelector);

        allContextElements.forEach(el => {
            // Action records live on the element; clean up their DOM listeners
            // here, keyed by target element.
            if (el._actionContext && wildflower.eventHandlers) {
                wildflower.eventHandlers.forEach((handler, key) => {
                    if (handler && handler.target === el) {
                        el.removeEventListener(handler.event, handler.handler);
                        wildflower.eventHandlers.delete(key);
                    }
                });
                el._actionContext = null;
            }
            // No registry contexts to remove; bindings/conditionals are
            // effect-driven + element-local and GC with the removed element.
        });
    }
}


/**
 * PortalBindingRecord: a plain, non-registered carrier for a portal's binding.
 * Portaled content is teleported outside the component tree, so its bindings are
 * tracked off the owning instance (`instance._portalBindingRecords`) and painted
 * by PortalSystem. Component-level portal bindings are driven by the component
 * render effect (via deferred effect meta); these records carry the LIST-ITEM
 * bindings the effect can't reach, plus the class/style/html binding writers. The
 * class writer is lifted verbatim off the old `Context` class so a plain record
 * can paint a `data-bind-class` portal binding.
 */
class PortalBindingRecord
{
    constructor(path, componentInstance, element, parent = null, parentIndex = undefined)
    {
        this.type = 'binding';
        this.path = path;
        this.componentInstance = componentInstance;
        this.element = element;
        this.parent = parent;
        this._parentIndex = parentIndex;
        // Set externally by PortalSystem (binding-kind flags + list-item linkage).
        this._isClassBinding = false;
        this._isStyleBinding = false;
        this._isHTMLBinding = false;
        this._portalListItemContext = undefined;
    }

    isElementAttached()
    {
        return this.element && document.body.contains(this.element);
    }

    /**
     * Update DOM element for class binding context. Lifted verbatim off the old
     * Context class so a non-registered portal record can paint `data-bind-class`.
     * @private
     */
    _updateClassBindingElement(newValue)
    {
        if (!this.element || !this.isElementAttached()) return;

        // Friendly dev-mode shape check; historically, returning an object
        // from a data-bind-class computed threw `TypeError: t.split is not a
        // function` deep in the framework, with no actionable hint. The
        // Effect-based class path (RenderingCore._executeClassBindForEffect)
        // accepts both strings and `{className: bool}` objects, but this
        // path only handles strings. Coerce objects rather than throw so
        // the page keeps rendering, and warn once per binding record.
        if (newValue && typeof newValue === 'object') {
            if (typeof __DEV__ !== 'undefined' && __DEV__ && !this._classBindingShapeWarned) {
                this._classBindingShapeWarned = true;
                wfError(WF_ERRORS.CLASS_BINDING_SHAPE, {
                    context: 'computed returned an object; coercing truthy keys to a class string',
                    suggestion: 'A computed should return a string. For inline expressions, write `data-bind-class="{\'is-active\': cond}"`.',
                    warn: true
                });
            }
            // Coerce {className: truthy} → "className" space-separated
            newValue = Object.keys(newValue)
                .filter(k => newValue[k])
                .join(' ');
        } else if (newValue != null && typeof newValue !== 'string') {
            // Numbers, booleans, etc., coerce to string and warn once.
            if (typeof __DEV__ !== 'undefined' && __DEV__ && !this._classBindingShapeWarned) {
                this._classBindingShapeWarned = true;
                wfError(WF_ERRORS.CLASS_BINDING_SHAPE, {
                    context: `expected string, got ${typeof newValue}; coercing`,
                    warn: true
                });
            }
            newValue = String(newValue);
        }

        // On first call, capture static classes and clean up any stale dynamic classes
        if (this._staticClasses === undefined)
        {
            // Get static classes from data attribute (set by WfBuilder) or current classes
            const staticClassAttr = this.element.dataset.staticClass;
            if (staticClassAttr !== undefined)
            {
                // WfBuilder-generated element: use explicit static classes
                this._staticClasses = new Set(staticClassAttr.split(/\s+/).filter(Boolean));
            }
            else
            {
                // Regular HTML: current classes minus new dynamic classes are static
                const newClasses = newValue ? new Set(newValue.split(/\s+/).filter(Boolean)) : new Set();
                this._staticClasses = new Set(
                    Array.from(this.element.classList).filter(c => !newClasses.has(c))
                );
            }

            // Clean up any stale dynamic classes (classes that aren't static and aren't the new value)
            const newClassSet = newValue ? new Set(newValue.split(/\s+/).filter(Boolean)) : new Set();
            const toRemove = Array.from(this.element.classList).filter(
                c => !this._staticClasses.has(c) && !newClassSet.has(c)
            );
            toRemove.forEach(className => {
                this.element.classList.remove(className);
            });
        }

        // Remove any previous classes we added
        if (this._previousClass)
        {
            const previousClasses = this._previousClass.split(/\s+/).filter(Boolean);
            previousClasses.forEach(className => {
                this.element.classList.remove(className);
            });
        }

        // Add new classes
        if (newValue)
        {
            const classes = newValue.split(/\s+/).filter(Boolean);
            classes.forEach(className => {
                this.element.classList.add(className);
            });
        }

        // Track what we added (even empty string to indicate we've processed this)
        this._previousClass = newValue || '';
    }
}


/**
 * ContextRecords: the surviving record factory after the context-registry
 * teardown. It mints the only records the framework still needs:
 *   - action records (plain element-local dispatch records on el._actionContext),
 *   - data-render RenderRecords,
 *   - portal PortalBindingRecords,
 * plus list-template relationship detection and the list-context id generator.
 * There is NO context registry: bindings/conditionals are effect-driven, list
 * contexts are plain objects on the element/instance, and every record GCs with
 * its owning element / instance / effect.
 */
export class ContextRecords
{
    constructor(wf) {
        // Framework instance reference; avoids window.wildflower global lookups
        this._wf = wf || null;
        this._uid = 0;
    }

    /** No registry maps or GC interval to tear down. */
    dispose() {}

    /**
     * Generate an id (used for plain list contexts; base 36 for compactness).
     * @private
     */
    _generateContextId(path, options = {}) {
        // Preserve component IDs for easy lookup
        if (options.type === 'component' && options.componentInstance) {
            return options.componentInstance.id;
        }

        // Everything else gets a simple unique ID
        return 'c' + (this._uid++).toString(36);
    }

    /**
     * Create a non-registered RenderRecord for a data-render conditional.
     * @returns {RenderRecord} The render record
     */
    createRenderRecord(path, componentInstance, element, parentIndex = undefined)
    {
        return new RenderRecord(path, componentInstance, element, parentIndex, this._wf, this);
    }

    /**
     * Create a non-registered portal binding record. Mirrors the old
     * createBindingContext use-template-rendered skip so portal records match the
     * prior behavior, but the record never enters any registry; PortalSystem
     * tracks it on the owning instance and paints it directly.
     */
    createPortalBindingRecord(path, componentInstance, element, parent = null, parentIndex = undefined)
    {
        // Skip elements rendered by data-use-template (they have their own binding system)
        if (element && element.closest && element.closest('[data-use-template-rendered]')) {
            return null;
        }
        return new PortalBindingRecord(path, componentInstance, element, parent, parentIndex);
    }

    /**
     * Create an action record: a plain element-local dispatch record stored on
     * `element._actionContext`. The dispatcher (_handleActionWithContext) reads
     * only .data/.path/.componentInstance/.element; nothing calls a method on it.
     * List-item detail comes from the row element (rowEl._itemData/_listIndex),
     * not the .parent/_parentIndex linkage, so those are kept only for the
     * form-submit routing gate (EventSystem `.parent.type === 'list'`).
     */
    createActionContext(path, componentInstance, element, method, eventType = 'click', parent = null, parentIndex = null) {
        if (!parent && element) {
            parent = this._findDeepestParentListContext(element);
        }

        const record = {
            type: 'action',
            path,
            componentInstance,
            element,
            parent,
            data: {
                method,
                event: eventType || 'click',
                options: {}
            }
        };

        if (element) element._actionContext = record;

        if (parentIndex !== null) {
            record._parentIndex = parentIndex;
        } else {
            this._extractParentIndex(record, element);
        }

        return record;
    }

    /**
     * Find the deepest parent list context for an element
     * Uses the strategy of finding the DIRECT parent list (closest data-list ancestor)
     * @param {HTMLElement} element - Element to find parent for
     * @returns {Object|null} Parent list context or null
     * @private
     */
    _findDeepestParentListContext(element) {
        if (!__FEATURE_LISTS__) return null;
        if (!element) return null;

        // Use JS property-based lookup instead of DOM attribute selector
        const listItem = this._wf?._findListItemAncestor(element);
        if (!listItem) return null;

        // Find the DIRECT parent list using framework helper
        const listElement = this._wf._findDirectParentList(listItem);
        if (listElement && listElement._listContext) {
            return listElement._listContext;
        }

        return null;
    }

    /**
     * Extract and set parent index from nearest list item
     * @param {Object} context - Action record
     * @param {HTMLElement} element - DOM element
     * @private
     */
    _extractParentIndex(context, element) {
        if (!element || !context) return;

        // Use JS property-based lookup instead of DOM attribute selector
        const listItem = this._wf?._findListItemAncestor(element);
        if (listItem) {
            // _listIndex is the canonical row index, kept current by onMove during
            // list operations (_bindItemIndex was a redundant mirror, now retired).
            if (listItem._listIndex !== undefined) {
                context._parentIndex = listItem._listIndex;
            }
        }
    }

    /**
     * Detect parent/child list-template relationships for nested list rendering.
     */
    detectTemplateRelationships(element)
    {
        const relationships = [];

        // Helper to process a single list element
        const processListElement = (listEl, depth = 0) => {
            const listPath = _cmGetAttr(listEl, 'list');

            // Find template inside this list
            const template = listEl.querySelector('template');
            if (template && template.content) {
                // Find nested lists inside the template content (support both prefixes)
                const nestedLists = template.content.querySelectorAll(_cmAttrSelector('list'));

                nestedLists.forEach((nestedListEl) => {
                    const childPath = _cmGetAttr(nestedListEl, 'list');

                    // Skip lists inside nested components; those lists belong
                    // to the child component and will be processed during its
                    // own initialization, not as part of the parent list.
                    const closestComponent = nestedListEl.closest(_cmAttrSelector('component'));
                    if (closestComponent && template.content.contains(closestComponent)) {
                        return;
                    }

                    if (listPath && childPath) {
                        relationships.push({
                            parentPath: listPath,
                            childPath: childPath,
                            parentElement: listEl,
                            childElement: nestedListEl,
                            template: template
                        });
                    }

                    // RECURSIVELY process each nested list for deeper nesting
                    processListElement(nestedListEl, depth + 1);
                });
            }
        };

        // If the input element itself is a list container, process it directly
        if (_cmGetAttr(element, 'list')) {
            processListElement(element, 0);
        }

        // Also search for list containers within descendants (support both prefixes)
        const listContainers = element.querySelectorAll(_cmAttrSelector('list'));
        listContainers.forEach((listEl) => {
            processListElement(listEl, 0);
        });

        return relationships;
    }
}
