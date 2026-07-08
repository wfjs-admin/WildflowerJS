/**
 * PoolRenderer - High-performance entity pool rendering
 *
 * Renders collections of plain objects to DOM without reactive proxy overhead.
 * Uses pre-compiled evaluators from TemplateSystem for native-speed updates.
 * Designed for high-frequency update scenarios: games, dashboards, visualizations.
 *
 * @module
 */

import { WF_ERRORS, wfError, __wf_txt } from '../core/wfUtils.js';

// Static blocklist for pool attr binding security (O(1) lookup, no allocation per flush)
const _POOL_BLOCKED_ATTRS = new Set([
    'class', 'style', 'srcdoc',
    'data-bind', 'data-action', 'data-list', 'data-if', 'data-show', 'data-render',
    'data-component', 'data-template', 'data-slot', 'data-portal', 'data-model',
    'data-bind-html', 'data-bind-class', 'data-bind-style', 'data-bind-attr', 'data-key',
    'data-wf-bind', 'data-wf-action', 'data-wf-list', 'data-wf-if', 'data-wf-show',
    'data-wf-render', 'data-wf-component', 'data-wf-template', 'data-wf-slot',
    'data-wf-portal', 'data-wf-model', 'data-wf-bind-html', 'data-wf-bind-class',
    'data-wf-bind-style', 'data-wf-bind-attr', 'data-wf-key'
]);
const _POOL_URL_ATTRS = new Set(['href', 'src', 'formaction', 'action', 'poster', 'xlink:href']);

// Attributes to strip from pool template content after compilation,
// matching the same set TemplateSystem strips from list templates.
const _POOL_ATTRS_TO_STRIP = [
    'data-bind', 'data-wf-bind',
    'data-action', 'data-wf-action',
    'data-bind-class', 'data-wf-bind-class',
    'data-bind-html', 'data-wf-bind-html',
    'data-bind-style', 'data-wf-bind-style',
    'data-model', 'data-wf-model',
    'data-show', 'data-wf-show',
    'data-render', 'data-wf-render',
    'data-if', 'data-wf-if',
    'data-key', 'data-wf-key',
    // Anti-FOUC marker: must be stripped from the compiled pool template,
    // not just the initial DOM scan. Otherwise entities spawned post-scan
    // inherit data-cloak from the template and stay [data-cloak]{display:none}
    // forever. Mirrors TemplateSystem's list-template strip.
    'data-cloak', 'data-wf-cloak'
];
const _POOL_STRIP_SELECTOR = _POOL_ATTRS_TO_STRIP.map(a => `[${a}]`).join(',');
// data:image/svg+xml / data:image/xml can execute inline scripts via
// <object>/<iframe>/<embed>: narrow the allowlist to raster formats only.
const _POOL_DANGEROUS_PROTO_RE = /^(javascript|vbscript):|^data:(?!image\/(png|jpe?g|gif|webp|avif|bmp|ico|tiff?|x-icon)[,;])/i;

// Boolean DOM properties whose attribute and JS-property desync after user
// interaction. data-bind-attr writes both so toggling them stays correct
// across interaction and DOM-element recycling.
const _POOL_BOOLEAN_PROPS = new Set([
    'checked', 'disabled', 'selected', 'readonly', 'multiple',
    'required', 'open', 'hidden', 'autofocus', 'autoplay',
    'controls', 'loop', 'muted', 'default', 'reversed'
]);
// Attribute name (lowercase) → JS property name (camelCase) mapping for
// the few boolean attributes whose DOM property name differs.
const _POOL_BOOLEAN_PROP_NAMES = { readonly: 'readOnly' };

/**
 * Resolve a dotted path against a context object. Used by data-bind and
 * data-show fallback paths where the compile-time `isExpression` check
 * didn't flag the path as an expression (no operators), but it still
 * contains a dot (e.g. "props.visible"). Walks segments left to right,
 * returning undefined on any null/undefined along the way.
 * @private
 */
function _readPath(ctx, path) {
    if (!path.includes('.')) return ctx[path];
    const parts = path.split('.');
    let v = ctx;
    for (let i = 0; i < parts.length; i++) {
        if (v == null) return undefined;
        v = v[parts[i]];
    }
    return v;
}

/**
 * Pool handle: returned by component.pool(name).
 * Manages a collection of plain objects and their DOM representations.
 */
class PoolHandle {
    /**
     * Best-effort detection of arrow functions. Concise methods (`foo() {}`) and
     * arrows (`() => {}`) both lack `prototype`, so source inspection is the
     * reliable distinguisher: an arrow has `=>` before its body opener.
     * @private
     */
    static _isArrowFunction(fn) {
        if (typeof fn !== 'function') return false;
        if (fn.prototype !== undefined) return false;
        const src = Function.prototype.toString.call(fn);
        const arrowIdx = src.indexOf('=>');
        const braceIdx = src.indexOf('{');
        return arrowIdx !== -1 && (braceIdx === -1 || arrowIdx < braceIdx);
    }

    constructor(name, container, keyProp, templateContent, compiledMetadata, framework, options) {
        this.name = name;
        this._container = container;
        this._keyProp = keyProp;
        this._templateContent = templateContent;
        this._compiledMetadata = compiledMetadata;
        this._framework = framework;

        /** @type {number} Target FPS throttle (0 = every frame) */
        this._targetFps = options.targetFps || 0;
        /** @type {number} Minimum ms between flushes (0 = no throttle) */
        this._frameInterval = this._targetFps > 0 ? (1000 / this._targetFps) : 0;
        /** @type {number} Timestamp of last flush */
        this._lastFlushTime = 0;

        /** @type {number} Cull padding in px (-1 = no culling) */
        this._cullPadding = options.cullPadding ?? -1;

        /** @type {Object|null} Data-based culling property names {x, y, w, h} */
        this._cullProps = options.cullProps || null;
        /** @type {number} Default entity width (measured from template) */
        this._defaultEntityWidth = options.defaultEntityWidth || 0;
        /** @type {number} Default entity height (measured from template) */
        this._defaultEntityHeight = options.defaultEntityHeight || 0;

        /** @type {string|null} Entity property name; if truthy, skip per-frame binding updates */
        this._staticProp = options.staticProp || null;

        /** @type {boolean} Passive pool: skip rAF flush entirely, apply bindings on add()/update() only */
        this._isPassive = options.isPassive || false;

        /** @type {Object} Shared props: parent-injected data available to all items via `props.` prefix */
        this.props = options.props || {};
        /** @type {boolean} Cached flag: true if props has any keys */
        this._hasProps = this.props && Object.keys(this.props).length > 0;
        /** @type {Object|null} Reusable context buffer for props merging (avoids per-entity allocation) */
        this._ctxBuffer = this._hasProps ? { props: this.props } : null;

        /** @type {string|null} Property name for z-index sort (null = no sort) */
        this._sortProp = options.sortProp || null;
        /** @type {boolean} Sort descending (higher value = lower z-index) */
        this._sortDesc = options.sortDesc || false;

        /** @type {Array<Object>} The raw entity array; mutate freely */
        this.items = [];

        /** @type {Map<*, {el: Element, elementsArray: Array}>} entity key → DOM info */
        this._entities = new Map();

        /** @type {Array<{el: Element, item: Object}>} flat array for zero-allocation flush iteration */
        this._entitiesArray = [];

        /** @type {Array} Dynamic entities: flushed every frame */
        this._dynamicArray = [];
        /** @type {Array} Static entities: only re-culled when camera moves */
        this._staticArray = [];

        /** @type {Set} Keys of entities that need re-evaluation on next flush. */
        this._dirtySet = new Set();
        /** @type {boolean} Once markDirty() is called, the pool switches to targeted mode:
         *  empty dirty set means "nothing to do", not "flush everything".
         *  Pools that never call markDirty stay in animation mode (full flush every frame). */
        this._targetedMode = false;

        /** @type {Function|null} Callback on add/remove/clear */
        this.onChange = null;

        /** @type {Function|null} Lifecycle hook: called after item added */
        this._onAdd = options.onAdd || null;
        /** @type {Function|null} Lifecycle hook: called before individual item removed */
        this._onRemove = options.onRemove || null;
        /** @type {Function|null} Lifecycle hook: called once before bulk clear */
        this._onClear = options.onClear || null;

        /**
         * Entity computed property descriptors.
         * Object mapping computed name → property descriptor with getter.
         * Pre-built once at pool registration; applied to each entity at add().
         * When null, no computed work is done per-entity (zero overhead).
         * @type {Object|null}
         */
        this._entityComputedDescriptors = null;
        /** @type {string[]|null} Array of computed property names for fast iteration */
        this._entityComputedNames = null;

        if (options.entityComputed && typeof options.entityComputed === 'object') {
            const descriptors = {};
            const names = [];
            for (const key of Object.keys(options.entityComputed)) {
                const fn = options.entityComputed[key];
                if (typeof fn !== 'function') continue;
                // Arrow functions ignore the `this` the getter rebinds, so the
                // computed either throws on first read or silently resolves
                // against module-scope `this`. Fail loudly at registration.
                if (PoolHandle._isArrowFunction(fn)) {
                    throw new Error('[WildflowerJS Pool] entity.computed "' + key + '" is an arrow function. ' +
                        'Arrow functions do not bind `this` to the entity. Use shorthand method syntax: ' +
                        'computed: { ' + key + '() { /* this === entity */ } }');
                }
                names.push(key);
                descriptors[key] = {
                    configurable: true,
                    // Enumerable so that Object.assign() into the ctx-buffer
                    // (used when a pool has props, see _applyBindings) invokes
                    // the getter and carries its value into the binding context.
                    enumerable: true,
                    // Intentionally uncached: recompute on every access. See
                    // test-new/pool-entity-methods.test.js ("no cache" contract)
                    // before adding memoization; a naive cache introduces
                    // invalidation bugs when entity methods mutate state.
                    get() { return fn.call(this); }
                };
            }
            if (names.length > 0) {
                this._entityComputedDescriptors = descriptors;
                this._entityComputedNames = names;
            }
        }

        /**
         * Entity state template. Plain object whose own keys are
         * shallow-merged into every new entity at add() time. Spawn-provided
         * values win; template only fills in keys the spawn omitted. Brings
         * pool entity state declaration into line with store/component state.
         * @type {Object|null}
         */
        this._entityStateTemplate = null;
        this._entityStateTemplateKeys = null;
        if (options.entityStateTemplate && typeof options.entityStateTemplate === 'object') {
            const keys = Object.keys(options.entityStateTemplate);
            if (keys.length > 0) {
                this._entityStateTemplate = options.entityStateTemplate;
                this._entityStateTemplateKeys = keys;
            }
        }

        /**
         * Entity methods. Functions installed on every entity at add()
         * time, with `this` bound to the entity at call time. Routed by data-action
         * dispatch in preference to component methods.
         * @type {Object|null}
         */
        this._entityMethodDescriptors = null;
        this._entityMethodNames = null;
        if (options.entityMethods && typeof options.entityMethods === 'object') {
            const mDescriptors = {};
            const mNames = [];
            for (const key of Object.keys(options.entityMethods)) {
                const fn = options.entityMethods[key];
                if (typeof fn !== 'function') continue;
                // Arrow functions don't bind `this` to the entity at call time,
                // so the method would silently fail to mutate. Fail loudly at
                // registration: there is no legitimate use case for an arrow
                // as an entity method, so throw rather than warn.
                if (PoolHandle._isArrowFunction(fn)) {
                    throw new Error('[WildflowerJS Pool] entity method "' + key + '" is an arrow function. ' +
                        'Arrow functions do not bind `this` to the entity. Use shorthand method syntax: ' +
                        'entity: { ' + key + '() { /* this === entity */ } }');
                }
                mNames.push(key);
                // Non-enumerable: methods don't need to flow into ctx-buffer
                // (binding evaluators read values, never invoke methods),
                // and keeping them off enumeration matches the intuition that
                // serializing an entity should give plain data.
                mDescriptors[key] = { configurable: true, enumerable: false, writable: false, value: fn };
            }
            if (mNames.length > 0) {
                this._entityMethodDescriptors = mDescriptors;
                this._entityMethodNames = mNames;
            }
        }

        /** @type {Array<{el: Element, elementsArray: Array}>} Recycled DOM nodes for reuse */
        this._freeList = [];
        /** @type {number} Maximum recycled nodes to retain */
        this._maxFreeListSize = 100;

        // Snapshot template's original className/cssText for recycling restoration
        const snapEl = templateContent.cloneNode(true).firstElementChild;
        this._templateSnapshot = null;
        if (snapEl) {
            const snap = [{ className: snapEl.className, cssText: snapEl.style.cssText }];
            const snapChildren = snapEl.querySelectorAll('*');
            for (let i = 0; i < snapChildren.length; i++) {
                snap.push({ className: snapChildren[i].className, cssText: snapChildren[i].style.cssText });
            }
            this._templateSnapshot = snap;
        }
    }

    /**
     * Number of recycled DOM nodes available for reuse.
     * @returns {number}
     */
    get recycleSize() {
        return this._freeList.length;
    }

    /**
     * Add an entity to the pool.
     * Clones the template, applies initial bindings, and appends to the container.
     *
     * @param {Object} obj - Plain object with properties matching template bindings
     * @returns {Object} The same object (for chaining)
     */
    add(objOrArray) {
        // Bulk add: array of objects → DocumentFragment for single DOM operation
        if (Array.isArray(objOrArray)) {
            return this._addBulk(objOrArray);
        }
        return this._addSingle(objOrArray);
    }

    /**
     * Add a single entity to the pool.
     * @private
     */
    _addSingle(obj) {
        const key = obj[this._keyProp];
        if (key === undefined) {
            if (__DEV__) console.warn(`[WF Pool "${this.name}"] Entity missing key property "${this._keyProp}"`);
            return obj;
        }
        if (this._entities.has(key)) {
            if (__DEV__) console.warn(`[WF Pool "${this.name}"] Duplicate key "${key}", ignoring`);
            return obj;
        }

        // Apply defaults before installing computed/methods so that
        // template-provided fields count as own properties (they should).
        this._applyEntityStateTemplate(obj);
        this._installEntityComputed(obj);
        this._installEntityMethods(obj);
        this.items.push(obj);

        let el, elementsArray;

        // Try to reuse a recycled DOM node before cloning
        if (this._freeList.length > 0) {
            const recycled = this._freeList.pop();
            el = recycled.el;
            elementsArray = recycled.elementsArray;
            el._poolItem = obj;
            // Restore to template-original state: strip dynamic classes/styles/attrs
            this._restoreRecycledElement(el, elementsArray);
        } else {
            // Clone template and get root element
            const clone = this._templateContent.cloneNode(true);
            el = clone.firstElementChild;

            // Mark as pool entity so MutationObserver skips it
            el._poolEntity = true;
            el._poolItem = obj;

            // Build cached elements array from compiled metadata paths
            elementsArray = null;
            if (this._compiledMetadata) {
                elementsArray = this._framework._buildElementsArrayFromMetadata(el, this._compiledMetadata);
                el._cachedElementsArray = elementsArray;
            }
        }

        const isStatic = this._staticProp && obj[this._staticProp];
        const subArr = isStatic ? this._staticArray : this._dynamicArray;
        const entry = {
            el, elementsArray, item: obj,
            itemsIdx: this.items.length - 1,
            entitiesIdx: this._entitiesArray.length,
            subIdx: subArr.length,
            _isStatic: isStatic
        };
        this._entities.set(key, entry);
        this._entitiesArray.push(entry);
        subArr.push(entry);

        // Apply initial bindings
        this._applyBindings(el, obj);

        // Append to DOM
        this._container.appendChild(el);

        // Start the rAF loop if not already running. Passive pools never flush
        // on rAF (see _flush's early return), so they skip the loop; mirrors
        // the guard on the bulk-add path.
        if (!this._isPassive) this._framework._startPoolLoop();

        // Lifecycle hook
        if (this._onAdd) this._onAdd(obj);

        if (this.onChange) this.onChange(this);

        return obj;
    }

    /**
     * Bulk add an array of entities via DocumentFragment (single DOM operation).
     * @private
     * @param {Array<Object>} items - Array of plain objects
     * @returns {Array<Object>} The same array
     */
    _addBulk(items) {
        if (items.length === 0) return items;

        const fragment = document.createDocumentFragment();
        const keyProp = this._keyProp;

        for (let i = 0; i < items.length; i++) {
            const obj = items[i];
            const key = obj[keyProp];

            if (key === undefined) {
                if (__DEV__) console.warn(`[WF Pool "${this.name}"] Entity missing key property "${keyProp}"`);
                continue;
            }
            if (this._entities.has(key)) {
                if (__DEV__) console.warn(`[WF Pool "${this.name}"] Duplicate key "${key}", ignoring`);
                continue;
            }

            this._applyEntityStateTemplate(obj);
            this._installEntityComputed(obj);
            this._installEntityMethods(obj);
            this.items.push(obj);

            let el, elementsArray;

            if (this._freeList.length > 0) {
                const recycled = this._freeList.pop();
                el = recycled.el;
                elementsArray = recycled.elementsArray;
                el._poolItem = obj;
                this._restoreRecycledElement(el, elementsArray);
            } else {
                const clone = this._templateContent.cloneNode(true);
                el = clone.firstElementChild;
                el._poolEntity = true;
                el._poolItem = obj;
                elementsArray = null;
                if (this._compiledMetadata) {
                    elementsArray = this._framework._buildElementsArrayFromMetadata(el, this._compiledMetadata);
                    el._cachedElementsArray = elementsArray;
                }
            }

            const isStatic = this._staticProp && obj[this._staticProp];
            const subArr = isStatic ? this._staticArray : this._dynamicArray;
            const entry = {
                el, elementsArray, item: obj,
                itemsIdx: this.items.length - 1,
                entitiesIdx: this._entitiesArray.length,
                subIdx: subArr.length,
                _isStatic: isStatic
            };
            this._entities.set(key, entry);
            this._entitiesArray.push(entry);
            subArr.push(entry);

            this._applyBindings(el, obj);
            fragment.appendChild(el);

            if (this._onAdd) this._onAdd(obj);
        }

        // Single DOM operation for all items
        this._container.appendChild(fragment);

        if (!this._isPassive) {
            this._framework._startPoolLoop();
        }

        if (this.onChange) this.onChange(this);

        return items;
    }

    /**
     * Remove an entity from the pool by key.
     *
     * @param {*} key - The key value identifying the entity
     * @returns {boolean} True if the entity was found and removed
     */
    remove(key) {
        const entry = this._entities.get(key);
        if (!entry) return false;

        // Lifecycle hook: before removal, item still accessible
        if (this._onRemove) this._onRemove(entry.item);

        // Detach from DOM and recycle if free list has capacity
        entry.el.remove();
        if (this._freeList.length < this._maxFreeListSize) {
            this._resetElementCaches(entry.el, entry.elementsArray);
            this._freeList.push({ el: entry.el, elementsArray: entry.elementsArray });
        }

        // O(1) swap-with-last removal from items array
        const itemsIdx = entry.itemsIdx;
        const lastItems = this.items.length - 1;
        if (itemsIdx < lastItems) {
            const swapped = this.items[lastItems];
            this.items[itemsIdx] = swapped;
            const swappedKey = swapped[this._keyProp];
            const swappedEntry = this._entities.get(swappedKey);
            if (swappedEntry) swappedEntry.itemsIdx = itemsIdx;
        }
        this.items.pop();

        // O(1) swap-with-last removal from entitiesArray
        const entIdx = entry.entitiesIdx;
        const lastEnt = this._entitiesArray.length - 1;
        if (entIdx < lastEnt) {
            const swapped = this._entitiesArray[lastEnt];
            this._entitiesArray[entIdx] = swapped;
            swapped.entitiesIdx = entIdx;
        }
        this._entitiesArray.pop();

        // O(1) swap-with-last removal from static/dynamic sub-array via stored subIdx
        const subArr = entry._isStatic ? this._staticArray : this._dynamicArray;
        const subIdx = entry.subIdx;
        const lastSub = subArr.length - 1;
        if (subIdx < lastSub) {
            const swapped = subArr[lastSub];
            subArr[subIdx] = swapped;
            swapped.subIdx = subIdx;
        }
        subArr.pop();

        // Remove from map
        this._entities.delete(key);

        // Stop loop if all pools are empty
        if (this._entities.size === 0) {
            this._framework._checkPoolLoopNeeded();
        }

        if (this.onChange) this.onChange(this);

        return true;
    }

    /**
     * Remove all entities from the pool.
     */
    clear() {
        // Guard against post-destroy calls (e.g., from onDestroy hooks)
        if (!this._freeList || !this._container) return;

        // Lifecycle hooks: onClear gets bulk call, otherwise onRemove per item
        if (this._onClear) {
            this._onClear(this.items);
        } else if (this._onRemove) {
            for (let i = 0; i < this.items.length; i++) {
                this._onRemove(this.items[i]);
            }
        }

        // Populate free list from existing entities before clearing
        const space = this._maxFreeListSize - this._freeList.length;
        if (space > 0) {
            const arr = this._entitiesArray;
            const count = Math.min(space, arr.length);
            for (let i = 0; i < count; i++) {
                const entry = arr[i];
                entry.el.remove();
                this._resetElementCaches(entry.el, entry.elementsArray);
                this._freeList.push({ el: entry.el, elementsArray: entry.elementsArray });
            }
        }
        // Clear remaining DOM (entries not recycled)
        this._container.replaceChildren();
        this.items.length = 0;
        this._entities.clear();
        this._entitiesArray.length = 0;
        this._dynamicArray.length = 0;
        this._staticArray.length = 0;
        if (this.onChange) this.onChange(this);
        this._framework._checkPoolLoopNeeded();
    }

    /**
     * Update an entity's properties by key.
     * Patches via Object.assign; the rAF flush picks up changes automatically.
     *
     * @param {*} key - The key value identifying the entity
     * @param {Object} props - Properties to merge into the entity
     * @returns {Object|null} The updated entity, or null if not found
     */
    update(key, props) {
        const entry = this._entities.get(key);
        if (!entry) return null;
        if (props) Object.assign(entry.item, props);
        if (this._isPassive) {
            // Passive pools: apply bindings synchronously since rAF flush is skipped
            this._applyBindings(entry.el, entry.item);
        } else {
            // Live pools: mark dirty for targeted flush
            this._dirtySet.add(key);
        }
        return entry.item;
    }

    /**
     * Swap the DOM positions of two entities.
     *
     * @param {*} key1 - Key of the first entity
     * @param {*} key2 - Key of the second entity
     * @returns {boolean} true if swap succeeded, false if either key not found
     */
    swap(key1, key2) {
        if (key1 === key2) return true;
        const entry1 = this._entities.get(key1);
        const entry2 = this._entities.get(key2);
        if (!entry1 || !entry2) return false;

        const el1 = entry1.el;
        const el2 = entry2.el;
        const parent = el1.parentNode;
        const next1 = el1.nextSibling;
        if (next1 === el2) {
            // Adjacent siblings (el1 immediately precedes el2): both
            // insertBefore calls in the general path become no-ops
            // (el1 is already before el2; next1 === el2 means we'd
            // insert el2 before itself). Single move handles this.
            parent.insertBefore(el2, el1);
        } else {
            parent.insertBefore(el1, el2);
            parent.insertBefore(el2, next1);
        }

        // Mark both as dirty so targeted flush re-evaluates their bindings
        this._dirtySet.add(key1);
        this._dirtySet.add(key2);
        return true;
    }

    /**
     * Get an entity by key.
     *
     * @param {*} key - The key value identifying the entity
     * @returns {Object|undefined} The entity object, or undefined if not found
     */
    get(key) {
        const entry = this._entities.get(key);
        return entry ? entry.item : undefined;
    }

    /**
     * Get an entity by DOM position (visual order).
     * Mirrors Array.at(): returns the item at the given index in DOM order.
     * Unlike pool.items (which uses swap-with-last), this always reflects
     * the visual order of elements in the container.
     *
     * @param {number} index - Zero-based DOM position
     * @returns {Object|undefined} The entity object, or undefined if out of range
     */
    at(index) {
        const el = this._container.children[index];
        return el ? el._poolItem : undefined;
    }

    /**
     * Mark an entity as dirty; its bindings will be re-evaluated on the next flush.
     * When any entity is marked dirty, the flush switches to targeted mode:
     * only dirty entities are processed, instead of the full O(n) scan.
     * When no entities are dirty, the flush runs in animation mode (all entities).
     *
     * @param {*} key - The key value identifying the entity
     */
    markDirty(key) {
        // Apply bindings immediately: synchronous update like static pools.
        // This avoids rAF latency for data-mode pools where changes are sparse.
        // Also sets targeted mode: rAF flush skips full scan, only processes
        // any remaining dirty-set entries (from swap/update).
        const entry = this._entities.get(key);
        if (entry) {
            this._applyBindings(entry.el, entry.item);
        }
        this._dirtySet.delete(key); // Already processed, don't re-flush
        // One-way latch (intentional, no reset path): once a pool calls
        // markDirty() it is a data-mode pool for its lifetime, so the rAF flush
        // stays targeted rather than re-sweeping every entity. A pool is either
        // an animation pool or a data pool; it does not switch back.
        this._targetedMode = true;
    }

    /**
     * Set custom cull bounds for data-based culling.
     * Use this for pannable/zoomable worlds where entity coordinates
     * don't map directly to viewport position.
     *
     * @param {number} left - Left edge in entity coordinate space
     * @param {number} top - Top edge in entity coordinate space
     * @param {number} right - Right edge in entity coordinate space
     * @param {number} bottom - Bottom edge in entity coordinate space
     */
    setCullBounds(left, top, right, bottom) {
        const b = this._customCullBounds;
        if (!b || b.left !== left || b.top !== top || b.right !== right || b.bottom !== bottom) {
            this._customCullBounds = { left, top, right, bottom };
            this._cullDirty = true;
        }
    }

    /**
     * Get the DOM element for an entity by key.
     *
     * @param {*} key - The key value
     * @returns {Element|undefined}
     */
    getElement(key) {
        return this._entities.get(key)?.el;
    }

    /**
     * Current entity count.
     * @returns {number}
     */
    get size() {
        if (typeof __DEV__ !== 'undefined' && __DEV__ && !this._aggregateReadWarned) {
            const tc = this._framework && this._framework._computedTrackingContext;
            if (tc) {
                this._aggregateReadWarned = true;
                wfError(WF_ERRORS.POOL_AGGREGATE_NONREACTIVE, {
                    context: `computed "${tc.computedName || '?'}" on "${tc.componentId || '?'}"`,
                    suggestion: 'Pool aggregates bypass reactivity. Mirror the count into state inside a tick: if (this.count !== pool.size) this.count = pool.size; then bind that state.',
                    warn: true
                });
            }
        }
        return this._entities.size;
    }

    /**
     * Array-like alias for `size`. Enables pool.length to read naturally
     * alongside JavaScript array idioms (length, push, pop, filter, etc.).
     * @returns {number}
     */
    get length() {
        if (typeof __DEV__ !== 'undefined' && __DEV__ && !this._aggregateReadWarned) {
            const tc = this._framework && this._framework._computedTrackingContext;
            if (tc) {
                this._aggregateReadWarned = true;
                wfError(WF_ERRORS.POOL_AGGREGATE_NONREACTIVE, {
                    context: `computed "${tc.computedName || '?'}" on "${tc.componentId || '?'}"`,
                    suggestion: 'Pool aggregates bypass reactivity. Mirror the count into state inside a tick: if (this.count !== pool.length) this.count = pool.length; then bind that state.',
                    warn: true
                });
            }
        }
        return this._entities.size;
    }

    // ========================================================================
    // Array-like API
    // These methods make PoolHandle feel like a JavaScript array for
    // ergonomic symmetry with developers' existing mental models.
    // All array mutators delegate to add/remove to preserve identity semantics.
    // ========================================================================

    /**
     * Array-native alias for add(). Accepts a single entity or an array.
     * @param {Object|Object[]} objOrArray
     * @returns {number} The new length of the pool (matches Array.prototype.push).
     */
    push(objOrArray) {
        this.add(objOrArray);
        return this._entities.size;
    }

    /**
     * Remove and return the last entity in the pool.
     * Uses swap-with-last semantics from the underlying items array.
     * @returns {Object|undefined} The removed entity, or undefined if empty.
     */
    // ---- Array readers -- pure delegates to the underlying items array ----
    //
    // Index-dependent methods (splice, pop, indexOf, slice) are intentionally
    // omitted. Pools use swap-with-last removal, so an entity's position in
    // items[] is reshuffled by any remove() elsewhere in the pool; any
    // "remove at index i" operation silently refers to a different entity
    // than the caller likely intended. Use remove(key) to delete, and at(i)
    // when you need positional access in DOM order (stable).

    find(fn)    { return this.items.find(fn); }
    filter(fn)  { return this.items.filter(fn); }
    map(fn)     { return this.items.map(fn); }
    forEach(fn) { return this.items.forEach(fn); }
    some(fn)    { return this.items.some(fn); }
    every(fn)   { return this.items.every(fn); }
    reduce(fn, init) {
        return arguments.length > 1
            ? this.items.reduce(fn, init)
            : this.items.reduce(fn);
    }

    [Symbol.iterator]() {
        return this.items[Symbol.iterator]();
    }

    /**
     * Apply the entity state template to a new entity.
     * Shallow merge: template fills in keys the spawn omitted. Spawn values
     * always win. Nested objects are shared by reference; documented behavior.
     * @private
     */
    _applyEntityStateTemplate(obj) {
        if (!this._entityStateTemplate) return;
        const keys = this._entityStateTemplateKeys;
        const template = this._entityStateTemplate;
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!Object.prototype.hasOwnProperty.call(obj, key)) {
                obj[key] = template[key];
            }
        }
    }

    /**
     * Install computed property getters on an entity.
     * Defines each computed as an accessor on the entity object. When the
     * entity already has an own property with the same name, the literal
     * value wins (getter is not installed for that name).
     * No-op when the pool has no entity computed definitions.
     * @private
     */
    _installEntityComputed(obj) {
        if (!this._entityComputedDescriptors) return;
        const names = this._entityComputedNames;
        const descriptors = this._entityComputedDescriptors;
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            // If the entity has its own data property with this name, skip;
            // literal values always win to prevent surprising override.
            if (Object.prototype.hasOwnProperty.call(obj, name)) continue;
            Object.defineProperty(obj, name, descriptors[name]);
        }
    }

    /**
     * Install entity methods on an entity.
     * Methods are non-enumerable function values; calling entity[name](...)
     * invokes the original function with `this === entity`. Same own-property
     * shadow rule as computed: a literal of the same name wins.
     * @private
     */
    _installEntityMethods(obj) {
        if (!this._entityMethodDescriptors) return;
        const names = this._entityMethodNames;
        const descriptors = this._entityMethodDescriptors;
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            if (Object.prototype.hasOwnProperty.call(obj, name)) continue;
            Object.defineProperty(obj, name, descriptors[name]);
        }
    }

    /**
     * Apply all compiled bindings to a single entity's DOM element.
     * Restore a recycled element to its template-original state.
     * Resets className, inline styles, and visibility to match a freshly-cloned template.
     * @private
     */
    _restoreRecycledElement(el, elementsArray) {
        const snap = this._templateSnapshot;
        if (snap) {
            // Restore root element: use removeAttribute for empty values to avoid
            // adding class="" or style="" attributes that weren't on the original template.
            // Bootstrap and other CSS frameworks may style elements differently when
            // the attribute is present-but-empty vs absent.
            if (snap[0].className) { el.className = snap[0].className; }
            else { el.removeAttribute('class'); }
            if (snap[0].cssText) { el.style.cssText = snap[0].cssText; }
            else { el.removeAttribute('style'); }
            // Restore child elements (querySelectorAll order matches snapshot order)
            const children = el.querySelectorAll('*');
            for (let i = 0; i < children.length && i + 1 < snap.length; i++) {
                const s = snap[i + 1];
                if (s.className) { children[i].className = s.className; }
                else { children[i].removeAttribute('class'); }
                if (s.cssText) { children[i].style.cssText = s.cssText; }
                else { children[i].removeAttribute('style'); }
            }
        }
    }

    /**
     * Reset dirty-tracking caches on an element and its cached sub-elements.
     * Called when recycling a DOM node so stale prev-values don't suppress initial binding application.
     * @private
     */
    _resetElementCaches(el, elementsArray) {
        const targets = elementsArray || [];
        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            if (!t) continue;
            t._poolPrevRaw = undefined;
            t._poolPrevClass = undefined;
            t._poolClassList = null;
            t._poolPrevStyle = undefined;
            t._poolPrevAttr = undefined;
        }
        // Also reset root element caches
        el._poolPrevRaw = undefined;
        el._poolPrevClass = undefined;
        el._poolClassList = null;
        el._poolPrevStyle = undefined;
        el._poolPrevAttr = undefined;
        el._poolItem = null;
    }

    /**
     * Called on add() and on every rAF frame.
     *
     * PERF: Zero-overhead path. No Proxy creation, no object spreads, no framework helpers.
     * Calls pre-compiled evaluator functions directly with the plain entity object.
     * @private
     */
    _applyBindings(el, item) {
        const meta = this._compiledMetadata;
        if (!meta) return;

        // If pool has props, merge into a reusable context buffer
        // Props are accessed via `props.` prefix in expressions
        const ctx = this._hasProps ? Object.assign(this._ctxBuffer, item) : item;

        const elements = el._cachedElementsArray;

        // ── data-bind (text content, or input value for form controls) ──
        const bindings = meta.bindings;
        for (let i = 0; i < bindings.length; i++) {
            const binding = bindings[i];
            const target = elements[binding.index];
            if (!target) continue;
            const value = binding.isExpression ? this._evalExpr(binding, ctx) : _readPath(ctx, binding.path);
            // Skip String() conversion + DOM comparison when raw value unchanged
            if (value === target._poolPrevRaw) continue;
            target._poolPrevRaw = value;
            const strValue = value == null ? '' : String(value);
            if (binding.isInput) {
                // INPUT/TEXTAREA/SELECT: write .value, not textContent
                if (target.value !== strValue) target.value = strValue;
            } else {
                // In-place text-node mutation when possible (see __wf_txt); avoids
                // replacing the text node on every flush, cutting update script churn.
                __wf_txt(target, strValue);
            }
        }

        // ── data-show: direct property read ──
        const shows = meta.shows;
        for (let i = 0; i < shows.length; i++) {
            const show = shows[i];
            const target = elements[show.index];
            if (!target) continue;
            const raw = show.isExpression ? this._evalExpr(show, ctx) : _readPath(ctx, show.path);
            const visible = show.negate ? !raw : Boolean(raw);
            const display = visible ? '' : 'none';
            if (target.style.display !== display) target.style.display = display;
        }

        // ── data-bind-class: skip DOM if class string unchanged ──
        const classEvals = meta.classEvaluators;
        if (classEvals) {
            for (let i = 0; i < classEvals.length; i++) {
                const ev = classEvals[i];
                const target = ev.isRoot ? el : (elements[ev.index] || null);
                if (!target) continue;
                let classStr = '';
                try {
                    const classValue = ev.evaluator ? ev.evaluator(ctx) : '';
                    if (classValue) {
                        if (typeof classValue === 'string') {
                            classStr = classValue;
                        } else if (Array.isArray(classValue)) {
                            classStr = classValue.filter(Boolean).join(' ');
                        } else if (typeof classValue === 'object') {
                            let parts = '';
                            for (const k in classValue) {
                                if (classValue[k]) { if (parts) parts += ' '; parts += k; }
                            }
                            classStr = parts;
                        }
                    }
                } catch (e) { this._warnBindingError('data-bind-class', ev, e); /* keep classStr empty */ }

                // PERF: Only touch DOM if class actually changed
                if (target._poolPrevClass === classStr) continue;
                target._poolPrevClass = classStr;

                // Remove old, apply new
                if (target._poolClassList) {
                    const cl = target.classList;
                    const old = target._poolClassList;
                    for (let j = 0; j < old.length; j++) cl.remove(old[j]);
                }
                if (classStr) {
                    const names = classStr.split(' ');
                    target.classList.add(...names);
                    target._poolClassList = names;
                } else {
                    target._poolClassList = null;
                }
            }
        }

        // ── data-bind-style: skip unchanged props, cache prev values on element ──
        const styleEvals = meta.styleEvaluators;
        if (styleEvals) {
            for (let i = 0; i < styleEvals.length; i++) {
                const ev = styleEvals[i];
                const target = ev.isRoot ? el : (elements[ev.index] || null);
                if (!target) continue;
                let result;
                try {
                    result = ev.evaluator ? ev.evaluator(ctx) : null;
                } catch (e) { this._warnBindingError('data-bind-style', ev, e); continue; }
                if (result && typeof result === 'object') {
                    const style = target.style;
                    // Cache previous style values to avoid reading from DOM
                    if (!target._poolPrevStyle) target._poolPrevStyle = {};
                    const prev = target._poolPrevStyle;
                    for (const prop in result) {
                        const val = result[prop];
                        const str = (val === null || val === undefined) ? '' : String(val);
                        if (prev[prop] !== str) {
                            prev[prop] = str;
                            style[prop] = str;
                        }
                    }
                }
            }
        }

        // ── data-bind-attr: cache prev values, skip unchanged ──
        const attrEvals = meta.attrEvaluators;
        if (attrEvals) {
            for (let i = 0; i < attrEvals.length; i++) {
                const ev = attrEvals[i];
                const target = ev.isRoot ? el : (elements[ev.index] || null);
                if (!target) continue;
                let result;
                try {
                    result = ev.evaluator ? ev.evaluator(ctx) : null;
                } catch (e) { this._warnBindingError('data-bind-attr', ev, e); continue; }
                if (result && typeof result === 'object') {
                    // Cache previous attr values to avoid DOM getAttribute calls
                    if (!target._poolPrevAttr) target._poolPrevAttr = {};
                    const prev = target._poolPrevAttr;
                    for (const attr in result) {
                        // Security: block event handlers (on*) and framework directives
                        const lower = attr.length > 2 ? attr.toLowerCase() : attr;
                        if (lower.charCodeAt(0) === 111 && lower.charCodeAt(1) === 110) continue; // on*
                        if (_POOL_BLOCKED_ATTRS.has(lower)) continue;

                        const val = result[attr];
                        // Boolean DOM properties: also write the JS property,
                        // not just the attribute. Once a user interacts with
                        // a checkbox, the attribute and the .checked property
                        // desync; removeAttribute alone won't uncheck it.
                        if (_POOL_BOOLEAN_PROPS.has(lower)) {
                            const boolVal = !!val && val !== 'false';
                            const propName = _POOL_BOOLEAN_PROP_NAMES[lower] || lower;
                            if (target[propName] !== boolVal) target[propName] = boolVal;
                            if (boolVal) {
                                if (prev[attr] !== '') { prev[attr] = ''; target.setAttribute(attr, ''); }
                            } else {
                                if (prev[attr] !== null) { prev[attr] = null; target.removeAttribute(attr); }
                            }
                            continue;
                        }
                        if (val === null || val === undefined || val === false) {
                            if (prev[attr] !== null) {
                                prev[attr] = null;
                                target.removeAttribute(attr);
                            }
                        } else {
                            let str = String(val);
                            // Sanitize URL-bearing attributes
                            if (_POOL_URL_ATTRS.has(lower) && _POOL_DANGEROUS_PROTO_RE.test(str.replace(/[\s\x00-\x1F\x7F]/g, ''))) continue;
                            if (prev[attr] !== str) {
                                prev[attr] = str;
                                target.setAttribute(attr, str);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Evaluate an expression binding for a pool entity.
     * Uses compiledFn (positional args) or falls back to direct property read.
     * @private
     */
    _evalExpr(binding, item) {
        if (binding.compiledFn) {
            try {
                const vars = binding.expressionVars;
                if (!vars || vars.length === 0) return binding.compiledFn();
                // Direct positional calls avoid array allocation + .apply() overhead
                const n = vars.length;
                if (n === 1) return binding.compiledFn(item[vars[0]]);
                if (n === 2) return binding.compiledFn(item[vars[0]], item[vars[1]]);
                if (n === 3) return binding.compiledFn(item[vars[0]], item[vars[1]], item[vars[2]]);
                if (n === 4) return binding.compiledFn(item[vars[0]], item[vars[1]], item[vars[2]], item[vars[3]]);
                // Fallback for 5+ args (rare)
                const args = new Array(n);
                for (let i = 0; i < n; i++) args[i] = item[vars[i]];
                return binding.compiledFn.apply(null, args);
            } catch (e) { this._warnBindingError('expression', binding, e); return ''; }
        }
        return item[binding.path] ?? '';
    }

    /**
     * Dev-only: warn once per binding when its evaluator throws during a flush,
     * so a typo'd pool expression does not fail invisibly every frame. The flag
     * lives on the evaluator/binding object (compiled once, reused), so each
     * distinct binding warns at most once. __DEV__-stripped from production.
     * @private
     */
    _warnBindingError(kind, ref, e) {
        if (typeof __DEV__ === 'undefined' || !__DEV__) return;
        if (!ref || ref._poolBindingWarned) return;
        ref._poolBindingWarned = true;
        console.warn(`[WF Pool "${this.name}"] ${kind} binding threw and was skipped: ${(e && e.message) || e}. Check the expression in this pool's template.`);
    }

    /**
     * Flush all entities: re-apply bindings for every entity in the pool.
     * Called by the rAF loop.
     * @private
     */
    _flush(now) {
        // Passive pools skip the rAF flush entirely; updates via add()/update() only
        if (this._isPassive) return;

        if (this._frameInterval > 0) {
            if (now - this._lastFlushTime < this._frameInterval) return;
            this._lastFlushTime = now;
        }

        // ── Targeted mode: pool uses markDirty() for sparse updates ──
        // Only flush dirty entities. When dirty set is empty, skip entirely (nothing changed).
        // Animation-mode pools (never call markDirty) fall through to full flush below.
        if (this._targetedMode) {
            if (this._dirtySet.size > 0) {
                for (const key of this._dirtySet) {
                    const entry = this._entities.get(key);
                    if (entry) {
                        this._applyBindings(entry.el, entry.item);
                    }
                }
                this._dirtySet.clear();
            }
            return;
        }

        // Cull setup: compute container bounds once per flush (not per entity)
        const cullPad = this._cullPadding;
        const cullProps = this._cullProps;
        let cullRect = null;
        let cullBounds = null;
        if (cullPad >= 0 && this._container) {
            if (cullProps && this._customCullBounds) {
                // Custom cull bounds (pannable/zoomable worlds)
                cullBounds = this._customCullBounds;
            } else if (cullProps) {
                // Data-based culling: derive bounds from container parent dimensions
                const cullEl = this._container.parentElement || this._container;
                const cw = cullEl.offsetWidth || cullEl.clientWidth;
                const ch = cullEl.offsetHeight || cullEl.clientHeight;
                cullBounds = { left: 0, top: 0, right: cw, bottom: ch };
            } else {
                // getBoundingClientRect culling
                const cullEl = this._container.parentElement || this._container;
                const parentRect = cullEl.getBoundingClientRect();
                cullRect = {
                    left: Math.max(0, parentRect.left),
                    top: Math.max(0, parentRect.top),
                    right: Math.min(window.innerWidth, parentRect.right),
                    bottom: Math.min(window.innerHeight, parentRect.bottom)
                };
            }
        }

        // ── Static entities: only re-cull when camera/bounds changed ──
        if (cullBounds && cullProps && this._cullDirty) {
            const statics = this._staticArray;
            for (let i = 0; i < statics.length; i++) {
                const entry = statics[i];
                const ex = entry.item[cullProps.x] ?? 0;
                const ey = entry.item[cullProps.y] ?? 0;
                const ew = cullProps.w ? (entry.item[cullProps.w] ?? 0) : this._defaultEntityWidth;
                const eh = cullProps.h ? (entry.item[cullProps.h] ?? 0) : this._defaultEntityHeight;
                const visible = !(
                    ex + ew < cullBounds.left - cullPad ||
                    ex > cullBounds.right + cullPad ||
                    ey + eh < cullBounds.top - cullPad ||
                    ey > cullBounds.bottom + cullPad
                );
                if (visible !== entry._v) {
                    entry._v = visible;
                    entry.el.style.display = visible ? '' : 'none';
                }
            }
        }

        // ── Dynamic entities: cull + apply bindings every frame ──
        const dynamics = this._staticProp ? this._dynamicArray : this._entitiesArray;
        for (let i = 0; i < dynamics.length; i++) {
            const entry = dynamics[i];

            // Data-based culling
            if (cullBounds && cullProps) {
                const ex = entry.item[cullProps.x] ?? 0;
                const ey = entry.item[cullProps.y] ?? 0;
                const ew = cullProps.w ? (entry.item[cullProps.w] ?? 0) : this._defaultEntityWidth;
                const eh = cullProps.h ? (entry.item[cullProps.h] ?? 0) : this._defaultEntityHeight;
                const visible = !(
                    ex + ew < cullBounds.left - cullPad ||
                    ex > cullBounds.right + cullPad ||
                    ey + eh < cullBounds.top - cullPad ||
                    ey > cullBounds.bottom + cullPad
                );
                if (visible !== entry._v) {
                    entry._v = visible;
                    entry.el.style.display = visible ? '' : 'none';
                }
                if (!visible) continue;
            }

            this._applyBindings(entry.el, entry.item);

            // getBoundingClientRect culling: must run AFTER bindings update position
            if (cullRect) {
                const elRect = entry.el.getBoundingClientRect();
                const visible = !(
                    elRect.right < cullRect.left - cullPad ||
                    elRect.left > cullRect.right + cullPad ||
                    elRect.bottom < cullRect.top - cullPad ||
                    elRect.top > cullRect.bottom + cullPad
                );
                if (visible !== entry._v) {
                    entry._v = visible;
                    entry.el.style.visibility = visible ? '' : 'hidden';
                }
            }

            // Z-index sort: set z-index from entity property
            if (this._sortProp) {
                const val = entry.item[this._sortProp];
                if (val !== undefined) {
                    const zVal = this._sortDesc ? -Math.round(val) : Math.round(val);
                    const zStr = String(zVal);
                    if (entry.el.style.zIndex !== zStr) {
                        entry.el.style.zIndex = zStr;
                    }
                }
            }
        }

        this._cullDirty = false;
        // Clear dirty set after full flush (animation mode) to prevent unbounded growth
        if (this._dirtySet.size > 0) this._dirtySet.clear();
    }

    /**
     * Tear down the pool: remove all DOM, clear references.
     * Called on component destroy.
     * @private
     */
    _destroy() {
        this.clear();
        this._freeList.length = 0;
        this._freeList = null;
        this._container = null;
        this._templateContent = null;
        this._compiledMetadata = null;
        this._framework = null;
    }
}

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const PoolRendererMethods = {

    /**
     * Set up pool containers for a component instance.
     * Called during component feature setup for each data-pool element.
     * @private
     */
    _setupPools(instance) {
        // Process declarative pools block (pools: { name: { onAdd, onRemove, onClear } })
        const definition = instance.definition;
        if (definition.pools) {
            instance._poolDefinitions = new Map();
            const poolsDef = definition.pools;
            if (Array.isArray(poolsDef)) {
                for (let i = 0; i < poolsDef.length; i++) {
                    instance._poolDefinitions.set(poolsDef[i], {});
                }
            } else if (typeof poolsDef === 'object') {
                const names = Object.keys(poolsDef);
                for (let i = 0; i < names.length; i++) {
                    instance._poolDefinitions.set(names[i], poolsDef[names[i]] || {});
                }
            }
        }

        if (!this.domElements.pools || this.domElements.pools.length === 0) return;

        const pools = this.domElements.pools.filter(p => p.componentId === instance.id);
        if (pools.length === 0) return;

        if (!instance._pools) {
            instance._pools = new Map();
        }

        for (const poolEntry of pools) {
            const { element, path } = poolEntry;
            const keyProp = this._getAttr(element, 'key') || 'id';
            const fpsAttr = this._getAttr(element, 'pool-fps');
            const targetFps = fpsAttr ? parseInt(fpsAttr, 10) : 0;

            // Spatial culling: data-pool-cull="100" (padding in px)
            const cullAttr = this._getAttr(element, 'pool-cull');
            const cullPadding = cullAttr !== null ? parseInt(cullAttr, 10) : -1;

            // Data-based culling: data-pool-cull-props="x,y" or "x,y,w,h"
            const cullPropsAttr = element.getAttribute('data-pool-cull-props') || element.getAttribute('data-wf-pool-cull-props');
            let cullProps = null;
            if (cullPropsAttr) {
                const parts = cullPropsAttr.split(',').map(s => s.trim());
                cullProps = { x: parts[0], y: parts[1], w: parts[2] || null, h: parts[3] || null };
            }

            // Static pool / per-entity static:
            // data-pool-static (boolean, no value) = passive pool, skip rAF flush entirely
            // data-pool-static="propName" (with value) = per-entity opt-out from flush
            const staticAttrRaw = element.getAttribute('data-pool-static') ?? element.getAttribute('data-wf-pool-static');
            const isPassive = staticAttrRaw === '';
            const staticProp = (staticAttrRaw && staticAttrRaw !== '') ? staticAttrRaw : null;

            // Z-index sort: data-pool-sort="y" or data-pool-sort="y:desc"
            const sortAttr = this._getAttr(element, 'pool-sort');
            let sortProp = null, sortDesc = false;
            if (sortAttr) {
                const parts = sortAttr.split(':');
                sortProp = parts[0];
                sortDesc = parts[1] === 'desc';
            }

            // Find and extract template
            const template = this._findTemplate(element, instance);
            if (!template) {
                if (__DEV__) console.warn(`[WF Pool] No <template> found in data-pool="${path}"`);
                continue;
            }

            const templateContent = this._extractTemplateContent(template);

            // Compile template metadata (evaluators, element paths, etc.)
            const cacheKey = `pool:${instance.name}:${path}`;
            let compiledMetadata = this._templateCache.compiled.get(cacheKey);
            if (!compiledMetadata) {
                compiledMetadata = this._compileTemplate(template, cacheKey, {});
                if (compiledMetadata) {
                    this._templateCache.compiled.set(cacheKey, compiledMetadata);
                }
            }

            // Strip framework attributes from template content; bindings are
            // already compiled into metadata, so these just add DOM bloat.
            const stripRoot = templateContent.firstElementChild;
            if (stripRoot) {
                for (const attr of _POOL_ATTRS_TO_STRIP) {
                    stripRoot.removeAttribute(attr);
                }
                const stripDescendants = stripRoot.querySelectorAll(_POOL_STRIP_SELECTOR);
                for (const el of stripDescendants) {
                    for (const attr of _POOL_ATTRS_TO_STRIP) {
                        el.removeAttribute(attr);
                    }
                }
            }

            // Remove <template> from DOM (same pattern as data-list)
            const templateEl = element.querySelector('template');
            if (templateEl) templateEl.remove();

            // Measure default entity size for data-based culling (if cull-props without w,h)
            let defaultEntityWidth = 0, defaultEntityHeight = 0;
            if (cullProps && !cullProps.w) {
                const measureClone = templateContent.cloneNode(true);
                const measureEl = measureClone.firstElementChild;
                if (measureEl) {
                    // Force shrink-wrap so block elements don't expand to container width
                    const origDisplay = measureEl.style.display;
                    if (!origDisplay || origDisplay === 'block') {
                        measureEl.style.display = 'inline-block';
                    }
                    element.appendChild(measureEl);
                    const rect = measureEl.getBoundingClientRect();
                    defaultEntityWidth = rect.width;
                    defaultEntityHeight = rect.height;
                    measureEl.remove();
                }
            }

            // Resolve lifecycle hooks and props from declarative pools block
            const poolDef = instance._poolDefinitions?.get(path);
            let onAdd = null, onRemove = null, onClear = null, poolProps = null, entityComputed = null, entityMethods = null, entityStateTemplate = null;
            if (poolDef) {
                const ctx = instance.context;
                const resolve = (hook) => typeof hook === 'string' ? ctx[hook]?.bind(ctx) :
                    typeof hook === 'function' ? hook.bind(ctx) : null;
                onAdd = resolve(poolDef.onAdd);
                onRemove = resolve(poolDef.onRemove);
                onClear = resolve(poolDef.onClear);
                if (poolDef.props && typeof poolDef.props === 'object') {
                    poolProps = poolDef.props;
                }
                // entity.computed: per-entity derived values
                if (poolDef.entity && poolDef.entity.computed && typeof poolDef.entity.computed === 'object') {
                    entityComputed = poolDef.entity.computed;
                }
                // entity.state: default-state template merged into new entities
                if (poolDef.entity && poolDef.entity.state && typeof poolDef.entity.state === 'object') {
                    entityStateTemplate = poolDef.entity.state;
                }
                // Entity methods live at the top level of the entity block
                // (matching component/store shape, where methods are also top-level).
                // Any function property on the entity block that isn't a reserved
                // key (state, computed) becomes an entity method.
                if (poolDef.entity && typeof poolDef.entity === 'object') {
                    const collected = {};
                    let hasAny = false;
                    for (const key of Object.keys(poolDef.entity)) {
                        if (key === 'state' || key === 'computed') continue;
                        const v = poolDef.entity[key];
                        if (typeof v !== 'function') continue;
                        collected[key] = v;
                        hasAny = true;
                    }
                    if (hasAny) entityMethods = collected;
                }
            }

            const handle = new PoolHandle(path, element, keyProp, templateContent, compiledMetadata, this, {
                targetFps, cullPadding, sortProp, sortDesc, cullProps, defaultEntityWidth, defaultEntityHeight, staticProp, isPassive,
                props: poolProps, onAdd, onRemove, onClear, entityComputed, entityMethods, entityStateTemplate
            });
            instance._pools.set(path, handle);

            // Register in flat array for fast iteration in tick loop
            if (!this._activePoolHandles) this._activePoolHandles = [];
            this._activePoolHandles.push(handle);

            // Set up event delegation for data-action in pool templates.
            // Uses element index matching from compiled metadata; faster and more
            // robust than CSS selector matching. First-match-wins: walk from
            // event.target up to entity root, fire the first data-action found.
            if (compiledMetadata && compiledMetadata.actions && compiledMetadata.actions.length > 0) {
                // Group actions by event type, build index → method lookup
                // actionValue format: "method" (default click) or "event:method"
                const byEvent = new Map(); // eventType → Map<elementIndex, methodName>

                for (let i = 0; i < compiledMetadata.actions.length; i++) {
                    const action = compiledMetadata.actions[i];
                    let eventType = 'click';
                    const actionStr = action.actionName || action.actionValue;
                    let method = actionStr;

                    // Parse "event:method" format
                    const colonIdx = actionStr.indexOf(':');
                    if (colonIdx !== -1) {
                        eventType = actionStr.slice(0, colonIdx).trim();
                        method = actionStr.slice(colonIdx + 1).trim();
                    }

                    if (!byEvent.has(eventType)) byEvent.set(eventType, new Map());
                    byEvent.get(eventType).set(action.index, method);
                }

                // One listener per event type on the container
                const ctx = instance.context;
                byEvent.forEach((indexMap, eventType) => {
                    element.addEventListener(eventType, (event) => {
                        // Walk from event target up to a direct child of the container (entity root)
                        let entityRoot = event.target;
                        while (entityRoot && entityRoot.parentElement !== element) entityRoot = entityRoot.parentElement;
                        if (!entityRoot || !entityRoot._poolItem) return;

                        const item = entityRoot._poolItem;
                        const cachedElements = entityRoot._cachedElementsArray;
                        if (!cachedElements) return;

                        // Walk from event.target up to entity root: first match wins
                        let el = event.target;
                        while (el && el !== element) {
                            const idx = cachedElements.indexOf(el);
                            if (idx !== -1 && indexMap.has(idx)) {
                                const method = indexMap.get(idx);
                                // Entity method wins over component method when both exist
                                const entityFn = item[method];
                                if (typeof entityFn === 'function') {
                                    entityFn.call(item, event);
                                } else if (typeof ctx[method] === 'function') {
                                    ctx[method](item, event);
                                }
                                return; // First match wins, don't continue walking
                            }
                            el = el.parentElement;
                        }
                    });
                });
            }
        }

        // Populate this.pools with resolved pool handles (for declarative pools block)
        if (instance._poolDefinitions && instance._pools) {
            const poolsObj = {};
            instance._poolDefinitions.forEach((def, name) => {
                const handle = instance._pools.get(name);
                if (handle) poolsObj[name] = handle;
            });
            instance.pools = poolsObj;
            // Set on raw context (bypass ContextProxy SET trap)
            // RAW_TARGET symbol may not be available here, so use direct assignment
            // which works because context.pools was not initialized (no proxy conflict)
            if (instance.context) instance.context.pools = poolsObj;
        }
    },

    /**
     * Start the shared rAF rendering loop for all active pools.
     * @private
     */
    _startPoolLoop() {
        if (this._poolLoopRunning) return;
        this._poolLoopRunning = true;
        if (!this._boundPoolLoopTick) {
            this._boundPoolLoopTick = this._poolLoopTick.bind(this);
        }
        this._poolLoopId = requestAnimationFrame(this._boundPoolLoopTick);
    },

    /**
     * Single tick of the pool rAF loop.
     * Iterates all component instances with pools and flushes each.
     * @private
     */
    _poolLoopTick() {
        if (!this._poolLoopRunning) return;

        const now = performance.now();

        // Tick components BEFORE pool flush (physics updates entities, flush writes to DOM)
        const tickables = this._tickableInstances;
        if (tickables && tickables.length > 0) {
            if (!this._lastTickTime) {
                this._lastTickTime = now;
            } else {
                let dt = now - this._lastTickTime;
                if (dt > 250) dt = 250; // clamp
                this._lastTickTime = now;
                for (let i = 0; i < tickables.length; i++) {
                    tickables[i]._tickFn(dt, now);
                }
            }
        }

        // Flush all active pools: flat array, zero iterator allocation
        const handles = this._activePoolHandles;
        if (handles) {
            for (let i = 0; i < handles.length; i++) {
                if (handles[i].size > 0) {
                    handles[i]._flush(now);
                }
            }
        }

        this._poolLoopId = requestAnimationFrame(this._boundPoolLoopTick);
    },

    /**
     * Check if any pool still has entities; stop the loop if all are empty.
     * @private
     */
    _checkPoolLoopNeeded() {
        // Keep running if any tickable components exist
        if (this._tickableInstances && this._tickableInstances.length > 0) return;

        for (const instance of this.componentInstances.values()) {
            if (!instance._pools) continue;
            for (const pool of instance._pools.values()) {
                if (pool.size > 0) return; // At least one pool has entities, keep running
            }
        }
        // No entities in any pool and no tickables: stop the loop
        this._poolLoopRunning = false;
        if (this._poolLoopId) {
            cancelAnimationFrame(this._poolLoopId);
            this._poolLoopId = null;
        }
    },

    /**
     * Clean up all pools for a component instance.
     * Called during component destruction.
     * @private
     */
    _cleanupPools(instance) {
        // Clean up pools and remove handles from the active tick array
        if (instance._pools) {
            for (const pool of instance._pools.values()) {
                if (this._activePoolHandles) {
                    const idx = this._activePoolHandles.indexOf(pool);
                    if (idx !== -1) this._activePoolHandles.splice(idx, 1);
                }
                pool._destroy();
            }
            instance._pools.clear();
        }

        // Remove from tickables if present
        if (instance._tickFn && this._tickableInstances) {
            const idx = this._tickableInstances.indexOf(instance);
            if (idx !== -1) this._tickableInstances.splice(idx, 1);
            instance._tickFn = null;
        }

        this._checkPoolLoopNeeded();
    },

    /**
     * Get or create a pool handle for a component instance.
     * Called via this.pool('name') in component methods.
     *
     * @param {Object} instance - Component instance
     * @param {string} name - Pool name (matches data-pool attribute value)
     * @returns {PoolHandle|null}
     */
    _getPool(instance, name) {
        if (!instance._pools) return null;
        return instance._pools.get(name) || null;
    }
};
