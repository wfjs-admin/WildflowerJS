/**
 * ListNestedManager - Nested list and component-in-list handling
 *
 * Extracted from ListRenderer.js for code organization.
 * These methods handle nested list contexts, component initialization/destruction
 * within list items, and nested template processing.
 *
 * @module
 */

import { listTemplateId, wfError, WF_ERRORS } from '../core/wfUtils.js';

// WF-519 (dev-only): a dotted data-list path inside a row whose route and
// first row disagree. The route is the declaration's (_rowListReadsComponent);
// the first row seen shows what the author may have meant. Once per
// (component, path).
const _wf519Seen = __DEV__ ? new Set() : null;
function _warnRowListRoute(fw, instance, path, item, readsComponent) {
    if (path.includes('$') || !instance) return;
    const p = fw._listPathBare(path);
    const dot = p.indexOf('.');
    if (dot < 0) return;
    const key = instance.name + ':' + path;
    if (_wf519Seen.has(key)) return;
    _wf519Seen.add(key);
    const head = p.slice(0, dot);
    // Raw read: a dev check must not add a dependency.
    const raw = item && instance.stateManager.toRaw(item);
    const has = raw != null && typeof raw === 'object' && raw[head] !== undefined;
    if (readsComponent && has) {
        wfError(WF_ERRORS.ROW_LIST_PATH, {
            warn: true,
            context: `component "${instance.name}": data-list="${path}" inside a row reads the component's "${head}"; the row item's "${head}" is not read`,
            suggestion: `To render the row item's field, rename it or the component's "${head}".`
        });
    } else if (!readsComponent && !has && !instance.stateManager.computed?.[head]) {
        wfError(WF_ERRORS.ROW_LIST_PATH, {
            warn: true,
            context: `component "${instance.name}": data-list="${path}" inside a row reads the row item, and the first row has no "${head}", so it renders nothing there`,
            suggestion: `To render the component's ${p} in every row, declare "${head}" in the component's state: block.`
        });
    }
}

/**
 * Methods to be mixed into ListRendererMethods (and ultimately WildflowerJS.prototype)
 */
export const ListNestedMethods = {
    /**
     * Initialize nested components within a list item immediately
     * This ensures actions inside nested components work correctly without
     * waiting for the mutation observer
     * @param {HTMLElement} itemEl - The list item element
     * @private
     */
    _initializeNestedComponentsInItem(itemEl) {
        // Find uninitialized components (those with data-component but no data-component-id)
        const componentSelector = this._attrSelector('component');
        const selectors = componentSelector.split(',').map(s => `${s}:not([data-component-id])`).join(',');

        // CRITICAL: Also check if itemEl itself is a component (querySelectorAll only searches descendants)
        // This handles templates where the root element IS the component
        const nestedComponents = Array.from(itemEl.querySelectorAll(selectors));

        // Check if itemEl itself is an uninitialized component
        if (this._hasAttr(itemEl, 'component') && !itemEl.dataset.componentId) {
            nestedComponents.unshift(itemEl);  // Process root component first
        }

        if (nestedComponents.length === 0) return;

        nestedComponents.forEach(componentEl => {
            const componentName = componentEl.dataset.wfComponent || componentEl.dataset.component;

            if (componentName && this.componentDefinitions.has(componentName)) {
                this._initializeComponentElement(componentEl, componentName);
            }
        });
    },
    /**
     * Destroy nested components within a list item when it's being removed
     * @param {HTMLElement} itemEl - The list item element being removed
     * @private
     */
    _destroyNestedComponentsInItem(itemEl) {
        // Find all initialized components (those with data-component-id)
        const nestedComponents = itemEl.querySelectorAll('[data-component-id]');

        if (nestedComponents.length === 0) return;

        nestedComponents.forEach(componentEl => {
            const componentId = componentEl.dataset.componentId;
            if (componentId) {
                this._destroyComponentQuiet(componentId);
            }
        });
    },
    /**
     * Dispose the mapArray effects of any nested data-list inside a removed list
     * row. Removing the parent row from the DOM does NOT tear these down: a nested
     * list's structural + refresh + per-row item effects are linked into the
     * long-lived component-state node's observers and keep running until component
     * destroy. The whole-list dispose, component destroy, and in-place re-render
     * paths already cascade through element._disposeMapArray (the wrappedDispose
     * walk in _renderList); the row-removal paths (onRemove / onBulkRemove) must
     * do the same. Each nested dispose nulls its own _disposeMapArray, so
     * re-encountering an already-disposed inner list later in the walk is a no-op.
     * Also prunes the row's nested-list contexts from instance._listContexts:
     * those are stored under index-bearing keys and would otherwise be retained
     * for the parent component's whole lifetime, pinning the detached nested list
     * element and parent item proxy (and bloating the EntitySystem list-affected
     * scan that iterates the map).
     * @param {HTMLElement} itemEl - the list row being removed
     * @param {Object} [instance] - owning component instance (for _listContexts prune)
     * @private
     */
    _disposeNestedListsInItem(itemEl, instance) {
        if (!itemEl || !itemEl.querySelectorAll) return;
        const listContexts = instance && instance._listContexts;
        const nestedListEls = itemEl.querySelectorAll('[data-list], [data-wf-list]');
        // The row itself, when its root element is a nested list (i === -1).
        for (let i = this._hasAttr(itemEl, 'list') ? -1 : 0; i < nestedListEls.length; i++) {
            const nested = i === -1 ? itemEl : nestedListEls[i];
            if (nested._mapArrayInitialized && nested._disposeMapArray) {
                try { nested._disposeMapArray(); } catch (e) { /* already gone */ }
                nested._mapArrayInitialized = false;
                nested._disposeMapArray = null;
            }
            const childContext = nested._listContext;
            if (childContext) {
                // Only this context's own entry: two lists over the same path
                // produce the same `path[i].child` key for their rows' nested
                // lists, and the entry may belong to the other list's row.
                if (listContexts && childContext._wfListContextKey
                    && listContexts.get(childContext._wfListContextKey) === childContext) {
                    listContexts.delete(childContext._wfListContextKey);
                }
                // Also unlink from the parent list context's children Map, which
                // is otherwise never pruned (delete by value: _parentIndex is
                // reassigned on reorder, so it isn't a reliable key here).
                const parent = childContext.parent;
                if (parent && parent.children && parent.children.size) {
                    for (const [k, v] of parent.children) {
                        if (v === childContext) { parent.children.delete(k); break; }
                    }
                }
            }
            nested._listContext = null;
        }
    },
    /**
     * Re-resolve the props of the child components inside a row whose item
     * was replaced by another object with the same key (the row element is
     * kept, so the components are too). Without it a `data-prop-x="."` prop
     * went on pointing at the old object until something edited the new one.
     *
     * Each child re-resolves its own props against its own place
     * (_updateComponentProps), so a component in a nested row further in is
     * asked too and finds nothing changed. The full follow-up runs for those
     * that did change: props-dependent computeds, the child's render effect,
     * onPropsChange.
     * @param {HTMLElement} itemEl - The list row (already carrying the new item)
     * @param {Object} newItemData - The row's new item
     * @param {string} listPath - The list's path, for onPropsChange
     * @private
     */
    _updateNestedComponentPropsInItem(itemEl, newItemData, listPath) {
        const nested = itemEl.querySelectorAll('[data-component-id]');
        const self = itemEl.dataset.componentId;
        if (nested.length === 0 && !self) return;

        const propsChangeInfo = { parentPath: listPath, newValue: newItemData, oldValue: undefined };
        if (self) {
            const inst = this.componentInstances.get(self);
            if (inst && inst._propPaths) this._refreshChildProps(inst, propsChangeInfo);
        }
        for (let i = 0; i < nested.length; i++) {
            const inst = this.componentInstances.get(nested[i].dataset.componentId);
            if (inst && inst._propPaths) this._refreshChildProps(inst, propsChangeInfo);
        }
    },
    /**
     * The nested lists of one row for one child path: the matching
     * descendants, and the row itself when its root element is that list. A
     * table forces the second shape: a <tr> may only hold cells, so a row of
     * cells has no wrapper to put the inner list on.
     *
     * A list inside a child component in the row is the child's, not the
     * row's (the rule _processNestedTemplates applies to the template). The
     * search is by attribute, so without the check a child component's own
     * list named like one of the parent's nested lists was mounted by the
     * parent, with the parent's data.
     * @param {HTMLElement} itemEl - the row
     * @param {string} childPath - the nested list's declared path
     * @param {string} selector - the attribute selector for that path
     * @returns {NodeList|HTMLElement[]}
     * @private
     */
    _nestedListsOfRow(itemEl, childPath, selector) {
        const found = itemEl.querySelectorAll(selector);
        const rowIsList = this._getAttr(itemEl, 'list') === childPath;
        let kept = null;
        for (let i = 0; i < found.length; i++) {
            // Anything from the list element up to the row that is a component.
            let inChild = false;
            for (let cur = found[i]; cur; cur = cur.parentElement) {
                if (this._hasAttr(cur, 'component')) { inChild = true; break; }
                if (cur === itemEl) break;
            }
            if (inChild) {
                if (kept === null) { kept = []; for (let k = 0; k < i; k++) kept.push(found[k]); }
            } else if (kept !== null) {
                kept.push(found[i]);
            }
        }
        if (!rowIsList) return kept === null ? found : kept;
        const all = [itemEl];
        const rest = kept === null ? found : kept;
        for (let i = 0; i < rest.length; i++) all.push(rest[i]);
        return all;
    },
    /**
     * Process nested lists within a parent list item
     * @private
     */
    _processNestedListsForItem(itemEl, item, index, context, instance) {
        const childListPaths = this._listRelationships.get(context.path) || new Set();
        if (childListPaths.size === 0) return;

        childListPaths.forEach(childPath => {
            const escapedPath = CSS.escape ? CSS.escape(childPath) : childPath.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
            // Prefix-aware, and the value form matters here: a nested list is
            // found by its declared path, so a bare `[data-list="..."]` literal
            // made every `data-wf-list` inside a row invisible and the nested
            // list simply never rendered. No warning, because nothing was
            // looking for it.
            const nestedListElements = this._nestedListsOfRow(itemEl, childPath, this._attrSelector('list', escapedPath));

            // Decided by the declaration, once for every row of this list.
            const readsComponent = this._rowListReadsComponent(instance, childPath);
            nestedListElements.forEach(nestedListEl => {
                if (__DEV__) _warnRowListRoute(this, instance, childPath, item, readsComponent);
                let nestedData;
                if (childPath.charCodeAt(0) === 36 /* $ */) {
                    // $store.path / $query.rows: a shared source, not a field
                    // of the row. Resolve it the way a top-level list does and
                    // mount even when the source is empty or not yet
                    // registered, so the nested mapArray's live read (arrayFn,
                    // shared-source branch) picks the data up when it lands.
                    nestedData = this._normalizeStoreShorthands
                        ? this._evaluateExternalListPath(this._normalizeStoreShorthands(childPath), instance)
                        : [];
                } else if (readsComponent) {
                    // A dotted path whose head the component declares
                    // (data-list="menu.items", "settings.options") reads the
                    // component. It mounts like a shared source and reads live
                    // like a top-level list (_renderListWithMapArray applies
                    // the same test).
                    nestedData = instance.stateManager.getValue(this._listPathBare(childPath));
                    // Server rows of such a list are not adopted: it mounts
                    // fresh (the mount sweep removes them), so it follows the
                    // component like a client row. An adopted copy was keyed
                    // under the row and never woke on a component write.
                    if (__FEATURE_SSR__ && nestedListEl._ssrPhase) {
                        nestedListEl._ssrPhase = null;
                        // Activation only releases lists still protected.
                        if (this.ssrManager) this.ssrManager.protectedLists.delete(nestedListEl);
                    }
                } else {
                    // A field of the row item, or an item-level computed when
                    // the item has no such field. Mirrors data-bind's
                    // resolution, and the nested arrayFn reads it the same way.
                    nestedData = this._rowListValue(item, childPath, instance, index, context);
                }

                // Mount whatever the source holds. An item with no array yet
                // (a field filled in later, a row replaced by an object
                // without it) gets an empty list: the nested list's own effect
                // reads the field through the item, so the rows appear when
                // the array does. Mounting only when the array was already
                // there left nothing to wake, and the list never rendered.
                if (!Array.isArray(nestedData)) nestedData = [];
                {
                    // CRITICAL: Check if nested list already has a context and update its _parentIndex
                    // This ensures model bindings inside the nested list use the correct parent index
                    // after parent list reordering
                    let childContext = nestedListEl._listContext;

                    if (childContext) {
                        // Update existing context's parent index for reordered parent items
                        childContext._parentIndex = index;
                    } else if (context.createChildContext) {
                        childContext = context.createChildContext(index, childPath);
                        // Parent context.data may be stale if mapArray's reactive effect
                        // updated the array without going through _renderList (which is
                        // the only path that refreshes context.data). When that happens,
                        // getItemData returns null and createChildContext yields null.
                        // Fall back to constructing the context directly from nestedData.
                        if (!childContext) {
                            childContext = this._createListContext(
                                childPath,
                                nestedData,
                                instance,
                                context,
                                index
                            );
                            if (childContext) {
                                childContext._parentIndex = index;
                            }
                        }
                    } else {
                        childContext = this._createListContext(
                            childPath,
                            nestedData,
                            instance,
                            context,
                            index  // Pass item index for unique key generation
                        );

                        if (childContext) {
                            childContext._parentIndex = index;
                        }
                    }

                    if (childContext) {
                        childContext.element = nestedListEl;
                        nestedListEl._listContext = childContext;

                        // === MAPARRAY INTEGRATION: Store parent item proxy for reactive nested data access ===
                        // This allows the nested mapArray's arrayFn to access data through the proxy,
                        // creating a dependency that triggers re-render when nested data changes
                        childContext._parentItemProxy = item;
                        childContext._childPath = childPath;

                        // Use unique key for nested list contexts to prevent collision.
                        // Stamp the key on the context so the row-removal teardown
                        // (_disposeNestedListsInItem) can delete this entry: these
                        // index-bearing entries are never pruned otherwise (the old
                        // ContextManager.garbageCollect() that nulled disconnected
                        // refs is gone), so they accumulate and pin detached nested
                        // list elements + parent item proxies.
                        const contextKey = `${context.path}[${index}].${childPath}`;
                        childContext._wfListContextKey = contextKey;
                        if (instance._listContexts && !instance._listContexts.has(contextKey)) {
                            instance._listContexts.set(contextKey, childContext);
                        }

                        this._renderList(nestedListEl, nestedData, childContext, instance);

                        // CRITICAL: Ensure nested list has its own event delegation
                        // Without this, clicks on nested list items won't be handled correctly
                        this._ensureListEventDelegation(nestedListEl, instance, childPath);
                    }
                }
            });
        });
    },

    /**
     * Process nested templates to capture relationships before removal
     * @param {HTMLElement} parentTemplate - The parent template element
     * @param {string} parentPath - The parent list's data path
     * @param {string|null} [componentName=null] - The component name for context
     * @param {Object|null} [instance=null] - Component instance for external template lookup
     * @param {string|null} [parentKey=null] - The parent list's template cache key
     *   (see _listTemplateKey); child keys are `parentKey>childPath`
     * @private
     */
    _processNestedTemplates(parentTemplate, parentPath, componentName = null, instance = null, parentKey = null)
    {
        // For HTML5 templates, search inside the content, not the template element itself
        const searchContainer = parentTemplate.tagName === 'TEMPLATE' && parentTemplate.content
            ? parentTemplate.content
            : parentTemplate;

        // data-query inside a row template: the per-component transform never
        // sees template content, so rewrite here, before the nested lists are
        // collected, and the cloned rows carry data-list="$name.rows".
        if (__FEATURE_QUERY__ && this._transformQueryElementsInTemplate) {
            this._transformQueryElementsInTemplate(searchContainer);
        }

        // Find all nested list templates within this template
        const nestedLists = searchContainer.querySelectorAll(this._attrSelector('list'));

        nestedLists.forEach(nestedList =>
        {
            const childPath = this._getAttr(nestedList, 'list');
            if (!childPath) return;

            // CRITICAL FIX: Skip lists inside nested components
            // Those lists belong to the component and will be processed when the component initializes
            const closestComponent = nestedList.closest(this._attrSelector('component'));
            if (closestComponent && searchContainer.contains(closestComponent)) {
                // This list is inside a nested component - component will handle it
                return;
            }

            // The nested list's own template id, taken (and written to its
            // data-wftpl attribute) before the template is resolved and
            // removed. The attribute sits on the list element inside the
            // parent template, so every row's copy carries it.
            const nid = listTemplateId(nestedList);

            // Find the template within this nested list
            // Pass instance to enable data-use-template lookups for nested external templates
            const childTemplate = this._findTemplate(nestedList, instance);
            if (!childTemplate) return;

            // Store the child template under its parent's key and its own id
            // (`parentKey>childPath|id`), so two parents over the same child
            // path, two nested lists over one child path in the same row, or a
            // child path named like a top-level list, each keep their own
            // template. Also under `nested:component:childPath|id`, a namespace
            // only a nested list whose parent key is unknown reads (see
            // _listTemplateKey); a top-level list never does.
            const baseKey = componentName ? `${componentName}:${childPath}` : childPath;
            const childKey = parentKey ? `${parentKey}>${childPath}${nid}` : `nested:${baseKey}${nid}`;
            // The copy kept here is what this nested list's rows are cloned
            // from, and it is taken before the recursion below reaches the
            // lists one level further in. Give those their ids first, so the
            // rows carry them and never hash. (The recursion computes the
            // same ids: nothing inside those lists has been touched yet.)
            const inner = (childTemplate.content || childTemplate).querySelectorAll(this._attrSelector('list'));
            for (let i = 0; i < inner.length; i++) listTemplateId(inner[i]);
            const cachedChildTemplate = childTemplate.cloneNode(true);
            this._templateCache.lists.set(childKey, cachedChildTemplate);
            if (parentKey) this._templateCache.lists.set(`nested:${baseKey}${nid}`, cachedChildTemplate);


            // Store parent-child relationship
            this._registerListRelationships([{parentPath, childPath}]);

            // Recursively process deeper nesting
            this._processNestedTemplates(childTemplate, childPath, componentName, instance, childKey);
            // Remove template from DOM if it's an element (not a DocumentFragment)
            if (childTemplate.nodeType !== Node.DOCUMENT_FRAGMENT_NODE && childTemplate.remove) {
                childTemplate.remove();
            }
        });
    }
};
