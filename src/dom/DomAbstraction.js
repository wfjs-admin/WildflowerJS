/**
 * DomAbstraction - The "WildQuery" Engine
 *
 * Provides a scoped, safe, and reactive-aware jQuery-like API for component DOM manipulation.
 * Key features:
 * - Scoped to component: this.$() only queries within the component's element
 * - Boundary enforced: Traversal methods can't escape the component boundary
 * - Auto-cleanup: Event handlers are automatically removed when component is destroyed
 * - Reactivity bridge: val() dispatches input events for data-model sync
 * - Debug warnings: Warns when manually manipulating framework-managed nodes
 *
 * @module
 */

import { listBoundElements } from '../core/DomMetadata.js';
import { WF_ERRORS, wfError } from '../core/wfUtils.js';

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const DomAbstractionMethods = {
    /**
     * Create a scoped, safe DOM wrapper for a component
     * @param {Array|NodeList|Element|null} nodes - The target elements
     * @param {Object} instance - The component instance
     * @param {WildflowerJS} framework - The framework instance
     * @returns {Object} Chainable wrapper with jQuery-like API
     * @private
     */
    _createDomWrapper(nodes, instance, framework) {
        // Normalize: handle nulls, single elements, NodeLists, or arrays
        const els = nodes instanceof NodeList || Array.isArray(nodes)
            ? Array.from(nodes)
            : (nodes ? [nodes] : []);

        return {
            // Element array access
            els,
            get length() { return els.length; },

            // --- ACCESS & ITERATION ---
            // .el returns first raw element (null if empty), .el(i) returns i-th element
            get el() { return els[0] || null; },
            get(i) { return els[i]; },
            first() { return framework._createDomWrapper(els[0], instance, framework); },
            last() { return framework._createDomWrapper(els[els.length - 1], instance, framework); },
            each(fn) {
                els.forEach((el, i) => fn.call(instance.context, el, i, el));
                return this;
            },

            // --- PREDICATES ---
            is(selector) { return els[0] ? els[0].matches(selector) : false; },
            hasClass(c) { return els[0]?.classList.contains(c) || false; },

            // --- CLASSES ---
            addClass(c) {
                els.forEach(el => el.classList.add(...c.split(' ')));
                return this;
            },
            removeClass(c) {
                els.forEach(el => el.classList.remove(...c.split(' ')));
                return this;
            },
            toggleClass(c, f) {
                els.forEach(el => el.classList.toggle(c, f));
                return this;
            },

            // --- ATTRIBUTES & DATA ---
            attr(k, v) {
                if (v === undefined) return els[0]?.getAttribute(k);
                els.forEach(el => el.setAttribute(k, v));
                return this;
            },
            data(k, v) {
                if (v === undefined) return els[0]?.dataset[k];
                els.forEach(el => el.dataset[k] = v);
                return this;
            },

            // --- STYLES & DISPLAY ---
            css(k, v) {
                if (typeof k === 'object') {
                    els.forEach(el => Object.assign(el.style, k));
                } else if (v === undefined) {
                    return els[0] ? getComputedStyle(els[0])[k] : undefined;
                } else {
                    els.forEach(el => el.style[k] = v);
                }
                return this;
            },
            show() {
                els.forEach(el => el.style.display = el._wf_orig_disp || '');
                return this;
            },
            hide() {
                els.forEach(el => {
                    if (el.style.display !== 'none') el._wf_orig_disp = el.style.display;
                    el.style.display = 'none';
                });
                return this;
            },

            // --- CONTENT & VALUE (Reactivity Bridge) ---
            html(v) {
                if (v === undefined) return els[0]?.innerHTML;
                const sanitized = framework._sanitizeOrPassHTML ? framework._sanitizeOrPassHTML(v) : v;
                els.forEach(el => {
                    if (framework.debug && (el.hasAttribute('data-bind-html') || el.hasAttribute('data-list'))) {
                        console.warn(`[WF] Warning: Manual .html() overwrite on reactive node:`, el);
                    }
                    el.innerHTML = sanitized;
                    // Rescan for new components in injected HTML
                    if (framework._scanForDynamicComponents) {
                        framework._scanForDynamicComponents(el);
                    }
                });
                return this;
            },
            text(v) {
                if (v === undefined) return els[0]?.textContent;
                els.forEach(el => {
                    if (framework.debug && el.hasAttribute('data-bind')) {
                        console.warn(`[WF] Warning: Manual .text() overwrite on bound node:`, el);
                    }
                    el.textContent = v;
                });
                return this;
            },
            val(v) {
                if (v === undefined) return els[0]?.value;
                els.forEach(el => {
                    el.value = v;
                    // Magic Bridge: Dispatch input event to sync with data-model
                    if (el.hasAttribute('data-model')) {
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                });
                return this;
            },

            // --- EVENTS (Auto-Tracked for GC & Multiple Handler Support) ---
            on(evt, fn) {
                els.forEach(el => {
                    const id = `manual_${instance.id}_${evt}_${Math.random().toString(36).slice(2)}`;
                    const bound = fn.bind(instance.context);
                    el.addEventListener(evt, bound);

                    // Local registry for off() support
                    el._wf_evts = el._wf_evts || {};
                    el._wf_evts[evt] = el._wf_evts[evt] || [];
                    el._wf_evts[evt].push({ original: fn, bound: bound, id: id });

                    // Framework registry for automatic cleanup on component destroy
                    // Include componentId for proper garbage collection of handlers with hyphenated component names
                    framework.eventHandlers.set(id, { target: el, event: evt, handler: bound, componentId: instance.id });
                });
                return this;
            },
            off(evt, fn) {
                els.forEach(el => {
                    const handlers = el._wf_evts?.[evt] || [];
                    const toRemove = fn ? handlers.filter(h => h.original === fn) : handlers;

                    toRemove.forEach(h => {
                        el.removeEventListener(evt, h.bound);
                        // O(1) framework registry cleanup
                        framework.eventHandlers.delete(h.id);
                    });

                    el._wf_evts[evt] = fn ? handlers.filter(h => h.original !== fn) : [];
                });
                return this;
            },
            trigger(evt, detail) {
                els.forEach(el => el.dispatchEvent(new CustomEvent(evt, { bubbles: true, detail })));
                return this;
            },

            // --- TRAVERSAL (Boundary Enforced) ---
            find(sel) {
                const found = [];
                els.forEach(el => found.push(...el.querySelectorAll(sel)));
                return framework._createDomWrapper(found, instance, framework);
            },
            parent() {
                const p = els[0]?.parentElement;
                // Boundary check: can't select outside component
                const safe = (p && instance.element.contains(p)) ? p : null;
                return framework._createDomWrapper(safe, instance, framework);
            },
            children() {
                const kids = Array.from(els[0]?.children || []);
                return framework._createDomWrapper(kids, instance, framework);
            },
            siblings() {
                if (!els[0]) return framework._createDomWrapper([], instance, framework);
                const sibs = Array.from(els[0].parentElement?.children || [])
                    .filter(el => el !== els[0] && instance.element.contains(el));
                return framework._createDomWrapper(sibs, instance, framework);
            },
            closest(sel) {
                const match = els[0]?.closest(sel);
                // Boundary check: can't select outside component
                const safe = (match && instance.element.contains(match)) ? match : null;
                return framework._createDomWrapper(safe, instance, framework);
            },

            // --- UTILS ---
            remove() {
                els.forEach(el => {
                    if (framework.debug && (el.hasAttribute('data-component') || el.hasAttribute('data-list-item'))) {
                        console.warn(`[WF] Manual .remove() on managed node. Consider updating state instead.`);
                    }
                    el.remove();
                });
                return this;
            },
            focus() {
                els[0]?.focus();
                return this;
            }
        };
    },

    /**
     * Create the $ helper function for a component context
     * @param {Object} instance - The component instance
     * @returns {Function} The $ helper function
     * @private
     */
    _createDollarHelper(instance) {
        const framework = this;
        return function $(selector) {
            // No selector: wrap component element itself
            if (!selector) {
                return framework._createDomWrapper(instance.element, instance, framework);
            }
            // Element/NodeList/Array passed directly
            if (typeof selector !== 'string') {
                return framework._createDomWrapper(selector, instance, framework);
            }
            // String selector: scoped query within component
            return framework._createDomWrapper(
                instance.element.querySelectorAll(selector),
                instance,
                framework
            );
        };
    },

    // ========================================================================
    // DOM ELEMENT COLLECTION
    // ========================================================================

    /**
     * Collect elements with specific data attributes
     * Supports both data-* and data-wf-* prefixes
     * @private
     */
    _collectElementsWithAttribute(instance, attribute, collection, datasetKey = null, altAttribute = null, altDatasetKey = null)
    {
        const {element, id: instanceId} = instance;
        const exclusiveMode = this.options.useWfPrefixOnly;

        // If datasetKey isn't provided, derive it from the attribute name
        if (!datasetKey)
        {
            datasetKey = attribute.replace('data-', '');
        }

        // Derive alt dataset key if not provided (convert data-wf-bind → wfBind for dataset access)
        if (altAttribute && !altDatasetKey)
        {
            const parts = altAttribute.replace('data-', '').split('-');
            altDatasetKey = parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
        }

        // Helper to check if element has the attribute (respects exclusive mode)
        const hasAttr = (el) => {
            // In exclusive mode, only check for data-wf-* prefix
            if (exclusiveMode) {
                return altAttribute && el.hasAttribute(altAttribute);
            }
            // Default mode: check both (wf-prefix has priority)
            return el.hasAttribute(attribute) || (altAttribute && el.hasAttribute(altAttribute));
        };

        // Helper to get the attribute value (respects exclusive mode)
        const getPath = (el) => {
            // In exclusive mode, only get from data-wf-* prefix
            if (exclusiveMode) {
                if (altAttribute && el.hasAttribute(altAttribute)) {
                    return altDatasetKey ? el.dataset[altDatasetKey] : el.getAttribute(altAttribute);
                }
                return null;
            }
            // Default mode: prefer data-wf-*, fall back to data-*
            if (altAttribute && el.hasAttribute(altAttribute)) {
                return altDatasetKey ? el.dataset[altDatasetKey] : el.getAttribute(altAttribute);
            }
            if (el.hasAttribute(attribute)) {
                return el.dataset[datasetKey];
            }
            return null;
        };

        // Check if model attribute (either version)
        const isModelAttribute = attribute === 'data-model' || attribute === 'data-wf-model';

        // Create a set to track elements we've already processed
        // Use element references as Set keys for direct object comparison
        const processedElements = new Set();

        // Create a helper function to safely add elements only once
        const safelyAddElement = (el, elPath) => {
            // Skip if we've already processed this exact element
            if (processedElements.has(el)) {
                return false;
            }

            // Skip elements that have been bound by a list (prevent component from overwriting)
            if (listBoundElements.has(el)) {
                return false;
            }

            // Skip elements rendered by data-use-template (they have their own binding system)
            if (el.closest('[data-use-template-rendered]')) {
                return false;
            }

            // Add to collection
            collection.push({
                element: el,
                componentId: instanceId,
                path: elPath
            });

            // Track that we've processed this element
            processedElements.add(el);


            // For data-model elements, set up event listeners
            if (isModelAttribute)
            {
                // WF-501: Warn if using $store.path in data-model (store paths are read-only)
                if (elPath && elPath.includes('$')) {
                    if (__DEV__) wfError(WF_ERRORS.MODEL_STORE_SHORTHAND, {
                        context: `data-model="${elPath}"`,
                        suggestion: 'Use component state and an action that mediates writes back to the store.',
                        warn: true
                    });
                    // Don't set up the model binding - it's invalid
                    return false;
                }
                this._bindModelElement(el, instance);
            }

            return true;
        };


        if (hasAttr(element))
        {
            const path = getPath(element);
            safelyAddElement(element, path);
        }

        // Manual selective traversal to collect elements
        // This avoids querySelectorAll's automatic deep traversal into nested components
        const childElementsToProcess = Array.from(element.children);

        while (childElementsToProcess.length > 0)
        {
            const current = childElementsToProcess.shift();

            // Skip entire subtrees that are nested components (support both prefixes)
            if (this._hasAttr(current, 'component'))
            {
                continue; // Skip this entire subtree
            }

            // Skip children of data-list containers in SSR components; SSR list items
            // exist as real DOM elements before the list renderer runs
            if (this._hasAttr(current, 'list') && current.closest('[data-ssr="true"]'))
            {
                continue; // Skip this entire subtree
            }

            // If this element has the attribute we're looking for, collect it
            if (hasAttr(current))
            {
                const path = getPath(current);
                safelyAddElement(current, path);
            }

            // Add this element's children to the processing queue
            if (current.children.length > 0)
            {
                // Add all children to the processing queue
                Array.from(current.children).forEach(child => childElementsToProcess.push(child));
            }
        }

    }
};
