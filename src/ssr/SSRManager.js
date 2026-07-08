/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * SSR MANAGER - Server-Side Rendering Protection System
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Protects server-rendered HTML from framework interference while enabling seamless
 * hydration to full interactivity. Core philosophy: "Server content is perfect -
 * don't recreate it, just protect and enhance it."
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 *   Server-Rendered HTML                    Framework Initialization
 *         │                                         │
 *         ▼                                         ▼
 *   ┌─────────────┐                         ┌─────────────────┐
 *   │ data-ssr=   │────scan for SSR────────▶│  SSRManager     │
 *   │ "true"      │     elements            │  prepareElement │
 *   └─────────────┘                         └────────┬────────┘
 *         │                                          │
 *         │ DOM preserved                            │ Set PROTECTED phase
 *         ▼                                          ▼
 *   ┌─────────────────────────────────────────────────────────┐
 *   │                    PROTECTED PHASE                       │
 *   │  • Server HTML preserved (no clearing/re-rendering)     │
 *   │  • State parsed from DOM content                         │
 *   │  • Lists protected from framework clearing               │
 *   │  • Empty binding updates blocked                         │
 *   └────────────────────────┬────────────────────────────────┘
 *                            │ Component init complete
 *                            ▼
 *   ┌─────────────────────────────────────────────────────────┐
 *   │                   ACTIVATED PHASE                        │
 *   │  • Event handlers bound (actions work)                   │
 *   │  • State updates now allowed                             │
 *   │  • Framework can manage future changes                   │
 *   └────────────────────────┬────────────────────────────────┘
 *                            │ Full integration
 *                            ▼
 *   ┌─────────────────────────────────────────────────────────┐
 *   │                   COMPLETE PHASE                         │
 *   │  • Exact equivalence to client-rendered components      │
 *   │  • All list operations work normally                     │
 *   │  • Full reactive updates enabled                         │
 *   └─────────────────────────────────────────────────────────┘
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * KEY CONCEPTS
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * PHASE LIFECYCLE:
 * ────────────────
 * 1. UNINITIALIZED - Element not yet processed
 * 2. PROTECTED     - Server HTML preserved, state being parsed
 * 3. ACTIVATED     - Bindings work, awaiting full integration
 * 4. COMPLETE      - Fully equivalent to client-rendered component
 *
 * STATE PARSING:
 * ──────────────
 * SSR content carries state information in the DOM:
 * - data-bind elements: Text content → state values
 * - data-type attributes: "number", "boolean", "json" for type coercion
 * - data-list elements: Child items → array state
 *
 * PROTECTION HOOKS:
 * ────────────────
 * Content protection hook prevents framework from clearing server content:
 * - Blocks empty/undefined values during PROTECTED phase
 * - Protects SSR-adopted list items until framework re-renders
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * USAGE EXAMPLES
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * @example Server-rendered component (PHP/Node/etc):
 * ```html
 * <div data-component="user-profile" data-ssr="true">
 *     <h1 data-bind="name">John Doe</h1>
 *     <span data-bind="email">john@example.com</span>
 *     <span data-bind="age" data-type="number">30</span>
 *     <ul data-list="posts">
 *         <template><li data-bind="title"></li></template>
 *         <!-- Server-rendered items -->
 *         <li data-bind="title">My First Post</li>
 *         <li data-bind="title">Another Post</li>
 *     </ul>
 * </div>
 * ```
 *
 * @example Framework automatically:
 * 1. Detects data-ssr="true" during component scan
 * 2. Protects existing DOM content
 * 3. Parses state: { name: "John Doe", email: "john@example.com", age: 30,
 *                    posts: [{title: "My First Post"}, {title: "Another Post"}] }
 * 4. Binds event handlers for interactivity
 * 5. Enables full reactive updates
 *
 * @module SSRManager
 * @requires wildflowerJS.js - Main framework for component integration
 * @requires wfUtils.js - PathResolver for nested value setting
 */

/**
 * SSRPhase - Lifecycle phases for SSR elements
 *
 * Elements transition through these phases:
 * UNINITIALIZED → PROTECTED → ACTIVATED → COMPLETE
 *
 * @enum {string}
 */
export const SSRPhase = {
    /** Element not yet processed by SSR manager */
    UNINITIALIZED: 'uninitialized',
    /** Element protected from framework operations, content preserved */
    PROTECTED: 'protected',
    /** Element activated for dynamic updates, framework can manage it */
    ACTIVATED: 'activated',
    /** SSR processing complete, element fully managed by framework */
    COMPLETE: 'complete'
};

/**
 * SSRManager - Server-Side Rendering Protection Manager
 *
 * Protects server-rendered HTML from framework interference while providing
 * minimal integration for interactivity. Follows the philosophy:
 * "Server content is perfect - don't recreate it, just protect and enhance it"
 *
 * Uses _ssrPhase property with SSRPhase enum values for lifecycle tracking.
 * Uses _ssrAdopted as a separate marker for "was this element SSR processed".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTERNAL STATE TRACKING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Element Properties (set on DOM elements):
 * - _ssrPhase     : Current SSRPhase value (UNINITIALIZED → COMPLETE)
 * - _ssrAdopted   : Boolean flag indicating element was SSR-processed
 * - _ssrAllowActions : Boolean to enable action binding during protection
 * - _initialRenderDone : Prevents framework from re-clearing SSR lists
 * - _frameworkRendered : Marks when framework has re-rendered an item
 * - _lastDataFingerprint : For detecting state changes in activated lists
 * - _previousData : Enables fast removal optimizations for lists
 *
 * Manager Properties:
 * - protectedElements : Set<Element> - All SSR elements being protected
 * - ssrComponents     : Map<Element, SSRData> - Component-specific SSR data
 * - protectedLists    : Set<Element> - Lists that should skip clearing
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGRATION POINTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Framework calls SSRManager at these points:
 * 1. Component scanning  → prepareElement() - Protect SSR element
 * 2. Definition setup    → enhanceDefinition() - Merge parsed state
 * 3. Init complete       → completeIntegration() - Setup event handlers
 * 4. Framework ready     → activateAllComponents() - Full activation
 *
 * SSRManager checks framework at these points:
 * 1. List clearing       → _initialRenderDone flag prevents re-clearing SSR lists
 * 2. Binding updates     → shouldSkipBindingUpdate() - Protect SSR content
 * 3. Content updates     → Content protection hook - Block empty values
 *
 * @class SSRManager
 */

import { ssrAdoptedElements, ssrAllowActionsElements, boundActionsCache } from '../core/DomMetadata.js';
import { pathResolver } from '../core/wfUtils.js';

export class SSRManager {
    constructor(wildflower) {
        this.wildflower = wildflower;

        // Protection tracking
        this.protectedElements = new Set();     // elements protected from framework ops
        this.ssrComponents = new Map();         // component -> SSR data
        this.protectedLists = new Set();        // list elements to skip clearing

        // Configuration
        this.config = {
            preserveComments: false,
            strictMode: false,
            logLevel: 'warn',
            enabled: true
        };

        // Statistics for debugging
        this.stats = {
            elementsProtected: 0,
            listsProtected: 0,
            componentsProcessed: 0
        };

        // Register hook to protect binding content during SSR initialization
        this._registerContentProtectionHook();

        this._log('SSRManager initialized (protection mode)');
    }

    // =========================================================================
    // Phase Helper Methods
    // =========================================================================

    /**
     * Get the current SSR phase for an element
     * @param {HTMLElement} element - Element to check
     * @returns {string} Current SSRPhase value
     */
    getPhase(element) {
        if (!element) return SSRPhase.UNINITIALIZED;
        return element._ssrPhase || SSRPhase.UNINITIALIZED;
    }

    /**
     * Check if element is in PROTECTED phase
     * @param {HTMLElement} element - Element to check
     * @returns {boolean}
     */
    isProtected(element) {
        return element && element._ssrPhase === SSRPhase.PROTECTED;
    }

    /**
     * Check if element has been activated (ACTIVATED or COMPLETE phase)
     * @param {HTMLElement} element - Element to check
     * @returns {boolean}
     */
    isActivated(element) {
        if (!element) return false;
        return element._ssrPhase === SSRPhase.ACTIVATED || element._ssrPhase === SSRPhase.COMPLETE;
    }

    /**
     * Check if element has completed SSR processing
     * @param {HTMLElement} element - Element to check
     * @returns {boolean}
     */
    isComplete(element) {
        return element && element._ssrPhase === SSRPhase.COMPLETE;
    }

    /**
     * Register a hook to prevent CLEARING binding updates during SSR
     * Blocks empty/undefined values that would clear server-rendered content
     */
    _registerContentProtectionHook() {
        this.wildflower.addBeforeContentUpdateHook((element, newValue) => {
            // Find the closest SSR component ancestor
            const ssrComponent = element.closest('[data-ssr="true"]');

            // Protect during PROTECTED phase (before activation)
            if (ssrComponent && ssrComponent._ssrPhase === SSRPhase.PROTECTED) {
                // Block empty/undefined values that would clear server content
                if (newValue === '' || newValue === undefined || newValue === null) {
                    return true; // Prevent clearing update
                }
            }

            // ALSO protect SSR-adopted list items even after activation
            // Until they've been properly re-rendered by the framework
            let listItem = element.parentElement;
            while (listItem && listItem !== ssrComponent) {
                if (ssrAdoptedElements.has(listItem) && !listItem._frameworkRendered) {
                    // Block empty values that would clear SSR content
                    if (newValue === '' || newValue === undefined || newValue === null) {
                        return true; // Prevent clearing update
                    }
                    break;
                }
                listItem = listItem.parentElement;
            }

            return false; // Allow the update
        });
    }

    /**
     * Check if SSR processing is enabled and element should be processed
     */
    isSSRElement(element) {
        const isSSR = this.config.enabled &&
            element &&
            element.hasAttribute &&
            element.hasAttribute('data-ssr') &&
            element.getAttribute('data-ssr') === 'true';

        return isSSR;
    }

    /**
     * Protect an SSR element from framework operations - called during component scanning
     * Sets element to PROTECTED phase
     */
    prepareElement(element) {
        if (!this.isSSRElement(element)) return false;

        // Idempotent: skip if already prepared (page-load scan may prepare before
        // the component definition is registered, then late-registration calls again)
        if (element._ssrPhase) return true;

        this._log('Protecting SSR element:', element);
        this.stats.elementsProtected++;

        // Set phase to PROTECTED
        element._ssrPhase = SSRPhase.PROTECTED;
        ssrAdoptedElements.add(element);
        this.protectedElements.add(element);

        // Parse state from server-rendered content
        const parsedState = this._parseSSRState(element);

        // Protect all lists within this component
        this._protectListsInComponent(element);

        // Store SSR data including parsed state for framework integration
        this.ssrComponents.set(element, {
            phase: SSRPhase.PROTECTED,
            parsedState: parsedState,
            timestamp: Date.now()
        });

        // Activation is handled by the caller:
        // - Page-load path: activateAllComponents() after all components initialized
        // - Late-registration path: activateComponent() after component setup

        return true;
    }

    /**
     * Protect lists within SSR component from clearing
     * Sets lists to PROTECTED phase
     */
    _protectListsInComponent(element) {
        const listElements = element.querySelectorAll('[data-list], [data-wf-list]');
        listElements.forEach(listEl => {
            listEl._ssrPhase = SSRPhase.PROTECTED;
            ssrAdoptedElements.add(listEl);
            this.protectedLists.add(listEl);
            this.stats.listsProtected++;
            this._log('Protected SSR list:', listEl.dataset.list || listEl.dataset.wfList);
        });
    }

    /**
     * Enhanced definition for SSR components (minimal changes)
     */
    enhanceDefinition(element, originalDefinition) {
        if (!this.isSSRElement(element)) return originalDefinition;

        this._log('Enhancing definition for SSR component (protection mode):', originalDefinition.name || 'unnamed');

        // Get parsed state from SSR data
        const ssrData = this.ssrComponents.get(element);
        const parsedState = ssrData ? ssrData.parsedState : {};

        // Merge parsed state with original definition state
        const enhanced = {
            ...originalDefinition,
            state: {
                ...originalDefinition.state,
                ...parsedState  // SSR state overrides defaults
            },
            _ssrPhase: this.getPhase(element),
            _ssrElement: element
        };

        return enhanced;
    }

    /**
     * Create protection context instead of normal context
     */
    createSSRContext(type, id, data) {
        this._log(`Creating SSR protection context: ${type}/${id}`);

        const protectionContext = new SSRProtectionContext(type, id, data);

        return protectionContext;
    }



    /**
     * Check if binding update should be skipped for element
     * Only protect during PROTECTED phase, then hand off to framework
     */
    shouldSkipBindingUpdate(element) {
        const ssrComponent = element.closest('[data-ssr="true"]');
        if (!ssrComponent) return false;

        // Check if this element is inside an SSR list in PROTECTED phase
        const ssrList = element.closest('[data-list]');
        if (ssrList && ssrList._ssrPhase === SSRPhase.PROTECTED) {
            return true; // Protect during PROTECTED phase only
        }

        // Also check protectedLists Set for backward compatibility
        if (ssrList && this.protectedLists.has(ssrList)) {
            return true;
        }

        // Only skip during PROTECTED phase
        return ssrComponent._ssrPhase === SSRPhase.PROTECTED;
    }

    /**
     * Complete minimal integration for SSR component
     */
    completeIntegration(instance) {
        // Check if this is an SSR component
        if (!instance.definition._ssrPhase || instance.definition._ssrPhase === SSRPhase.UNINITIALIZED) {
            return;
        }

        this._log('Completing minimal SSR integration for:', instance.id);
        this.stats.componentsProcessed++;

        // Minimal integration - just ensure event handlers work
        this._setupEventIntegration(instance);

        this._log('SSR integration completed for:', instance.id);
    }

    /**
     * Activate SSR component for full dynamic functionality - EXACT equivalence to dynamic components
     * Called after initial component setup is complete
     * Transitions element to ACTIVATED phase
     */
    activateComponent(element) {
        if (!this.isSSRElement(element)) return false;

        this._log('Activating SSR component for exact functional equivalence:', element);

        // Transition to ACTIVATED phase
        element._ssrPhase = SSRPhase.ACTIVATED;

        // Activate all lists within this component for full list operations
        this._activateListsInComponent(element);

        // Clean up references; component is now fully activated
        this.protectedElements.delete(element);
        this.ssrComponents.delete(element);

        this._log('SSR component now has exact equivalence to dynamic component:', element);
        return true;
    }

    /**
     * Activate lists within SSR component for full equivalence to dynamic lists
     * This is where SSR hands off to the framework permanently
     * Transitions lists to COMPLETE phase
     */
    _activateListsInComponent(element) {
        const listElements = element.querySelectorAll('[data-list], [data-wf-list]');
        listElements.forEach(listEl => {
            if (listEl._ssrPhase === SSRPhase.PROTECTED) {

                // Mark as already rendered so framework won't re-render
                listEl._initialRenderDone = true;

                // Set initial fingerprint based on current SSR content to detect future changes
                const listName = listEl.dataset.list;
                const componentElement = listEl.closest('[data-component]');
                if (componentElement) {
                    const instance = this.wildflower.componentInstances.get(componentElement.dataset.componentId);
                    if (instance && instance.state && instance.state[listName]) {
                        const data = instance.state[listName];
                        // Calculate initial fingerprint for SSR data
                        listEl._lastDataFingerprint = this.wildflower._getDataFingerprint(data);
                        // Set previous data to enable fast removal optimizations
                        listEl._previousData = [...data];
                    }
                }

                // Transition to COMPLETE phase - framework now manages this list
                listEl._ssrPhase = SSRPhase.COMPLETE;
                this.protectedLists.delete(listEl);

                // The state has already been parsed and injected into the component
                // The _initialRenderDone flag prevents framework from clearing/re-rendering
                // But framework will handle all future operations normally
            }
        });
    }

    /**
     * Activate all SSR components for exact functional equivalence
     * Called after framework initialization is complete
     */
    activateAllComponents() {
        this._log('Activating all SSR components for full functionality...');

        let activatedCount = 0;

        // Snapshot protected elements before activation; activateComponent() removes
        // each element from this.protectedElements as part of its cleanup, so by the
        // time the post-activation steps run, the live set would be empty.
        const elementsToActivate = Array.from(this.protectedElements);

        // Activate all currently protected components
        elementsToActivate.forEach(element => {
            if (this.activateComponent(element)) {
                activatedCount++;
            }
        });

        // CRITICAL: Add data-index attributes to SSR list items AFTER activation
        // This prevents triggering reactivity during framework initialization
        this._addDataIndexToSSRLists(elementsToActivate);

        // CRITICAL: Re-bind action contexts now that data-index attributes exist
        this._rebindSSRActionContexts(elementsToActivate);

        this._log(`Activated ${activatedCount} SSR components - now have exact equivalence to dynamic components`);
        return activatedCount;
    }

    /**
     * Add data-index attributes to SSR list items after activation
     * This is done as a final step to avoid triggering reactivity during init
     */
    _addDataIndexToSSRLists(elements = this.protectedElements) {
        elements.forEach(element => {
            const listElements = element.querySelectorAll('[data-list]');

            listElements.forEach(listEl => {
                // Process lists that have been adopted
                if (ssrAdoptedElements.has(listEl)) {
                    // Find all list items (excluding templates)
                    const template = listEl.querySelector('template');
                    const itemElements = Array.from(listEl.children).filter(child =>
                        child !== template && child.tagName !== 'TEMPLATE'
                    );

                    itemElements.forEach((itemEl, index) => {
                        if (!itemEl.hasAttribute('data-index')) {
                            itemEl.setAttribute('data-index', index.toString());
                        }
                    });
                }
            });
        });
    }

    /**
     * Clear action contexts for component before re-binding
     */
    _clearActionContextsForComponent(instance) {
        const actionElements = instance.element.querySelectorAll('[data-action]');

        actionElements.forEach(el => {
            // Action records are element-local (el._actionContext), not registered.
            if (el._actionContext) {
                // CRITICAL: Remove event handlers before clearing the record
                const actionName = el.dataset.action;
                const eventHandlersToRemove = [];

                // Find matching event handlers in the framework's eventHandlers Map
                // Key format: "action-{instanceId}-{methodName}-{eventType}-{timestamp}"
                this.wildflower.eventHandlers.forEach((handler, key) => {
                    if (key.includes(instance.id) && key.includes(actionName)) {
                        // Extract event type from key (4th segment)
                        const parts = key.split('-');
                        const eventType = parts.length >= 4 ? parts[parts.length - 2] : 'click';
                        eventHandlersToRemove.push({ key, handler, element: el, eventType });
                    }
                });

                // Remove the event listeners and handler references
                eventHandlersToRemove.forEach(({ key, handler, element, eventType }) => {
                    const fn = typeof handler === 'function' ? handler : handler?.handler;
                    if (fn) element.removeEventListener(eventType, fn);
                    this.wildflower.eventHandlers.delete(key);
                });

                // CRITICAL: Clear bound actions so re-binding can add new handlers
                const elBoundActions = boundActionsCache.get(el);
                if (elBoundActions) {
                    elBoundActions.clear();
                }

                // Drop the element-local action record so re-binding recreates it
                el._actionContext = null;
            }
        });
    }

    /**
     * Re-bind action contexts for SSR list items after data-index attributes are added
     * This ensures list action contexts have proper index information
     */
    _rebindSSRActionContexts(elements = this.protectedElements) {
        elements.forEach(element => {
            // Find component instance for this element
            const componentId = element.dataset.componentId;

            if (componentId && this.wildflower.componentInstances) {
                const instance = this.wildflower.componentInstances.get(componentId);
                if (instance) {
                    // CRITICAL: Clear existing action contexts before re-binding
                    this._clearActionContextsForComponent(instance);

                    // Re-bind component actions now that data-index attributes exist
                    this.wildflower._bindComponentActions(instance);
                }
            }
        });
    }

    /**
     * Parse state from SSR DOM content
     */
    _parseSSRState(element) {
        const state = {};

        // First, parse lists (they need special handling)
        this._parseListsIntoState(element, state);

        // Then parse individual bindings that are NOT inside lists
        const bindElements = element.querySelectorAll('[data-bind], [data-model]');

        bindElements.forEach(el => {
            const path = el.dataset.bind || el.dataset.model;

            // Skip computed properties (they're calculated, not stored)
            if (path.startsWith('computed:')) {
                return;
            }

            // Skip if this element is inside a list (already parsed)
            if (el.closest('[data-list]')) {
                return;
            }

            // Parse value based on data-type or content
            const value = this._parseValueFromElement(el);

            // Set nested value in state object using shared pathResolver utility
            pathResolver.set(state, path, value);
        });
        return state;
    }

    /**
     * Parse lists from SSR DOM into state arrays
     */
    _parseListsIntoState(element, state) {
        const listElements = element.querySelectorAll('[data-list]');

        listElements.forEach(listEl => {
            // Only parse TOP-LEVEL lists here. A nested list (one with a [data-list]
            // ancestor inside this component) is parsed recursively into its parent
            // item's state by _parseListElement, NOT flattened into top-level state.
            if (listEl.parentElement && listEl.parentElement.closest('[data-list]')) {
                return;
            }
            pathResolver.set(state, listEl.dataset.list, this._parseListElement(listEl));
        });
    }

    /**
     * Parse one SSR list element into an array of item-state objects, recursing
     * into nested lists so a server-rendered nested structure round-trips into
     * the parent item's state (e.g. categories[i].items). Without this, the parent
     * item loses its nested array and a post-activation re-render of the parent
     * list draws the inner lists empty.
     */
    _parseListElement(listEl) {
        const listItems = [];
        const template = listEl.querySelector('template');
        const itemElements = Array.from(listEl.children).filter(child =>
            child !== template && child.tagName !== 'TEMPLATE'
        );

        itemElements.forEach(itemEl => {
            const itemState = {};

            // Direct bindings only: a binding whose NEAREST [data-list] ancestor is
            // THIS list (not a deeper nested list inside the item). Mirrors the
            // top-level _parseSSRState skip so an inner <li data-bind="title"> does
            // not clobber the parent item's fields. The item element ITSELF may carry
            // the binding (e.g. <li data-bind="title">); querySelectorAll only matches
            // descendants, so include the item element explicitly.
            const itemBindings = [
                ...(itemEl.matches('[data-bind], [data-model]') ? [itemEl] : []),
                ...itemEl.querySelectorAll('[data-bind], [data-model]')
            ];
            itemBindings.forEach(bindEl => {
                const path = bindEl.dataset.bind || bindEl.dataset.model;
                if (path.startsWith('computed:')) return;
                if (bindEl.closest('[data-list]') !== listEl) return;
                pathResolver.set(itemState, path, this._parseValueFromElement(bindEl));
            });

            // First-level nested lists inside this item → recurse into item state.
            const nestedLists = itemEl.querySelectorAll('[data-list]');
            nestedLists.forEach(nl => {
                if (nl.parentElement && nl.parentElement.closest('[data-list]') === listEl) {
                    pathResolver.set(itemState, nl.dataset.list, this._parseListElement(nl));
                }
            });

            listItems.push(itemState);
        });

        return listItems;
    }

    /**
     * Parse value from DOM element based on type and content
     */
    _parseValueFromElement(element) {
        const dataType = element.dataset.type;
        const content = element.textContent.trim();

        // Handle different data types
        if (dataType === 'number') {
            const num = Number(content);
            return isNaN(num) ? 0 : num;
        }

        if (dataType === 'boolean') {
            // Check both content and element state (for checkboxes)
            if (element.type === 'checkbox') {
                return element.checked;
            }
            return content.toLowerCase() === 'true';
        }

        if (dataType === 'json') {
            try {
                return JSON.parse(content);
            } catch (e) {
                console.warn('[SSRManager] Invalid JSON in SSR element:', content);
                return null;
            }
        }

        if (dataType === 'html') {
            return element.innerHTML;
        }

        // For form inputs, textContent is always empty; read .value instead
        // so SSR-rendered <input value="..."> survives hydration rather than
        // clobbering the component's default state with ''.
        const tag = element.tagName;
        if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && 'value' in element) {
            return element.value;
        }

        // Default to text content
        return content;
    }

    /**
     * Set up minimal event integration for SSR components
     */
    _setupEventIntegration(instance) {
        // Find action elements and ensure they have event handlers
        const actionElements = instance.element.querySelectorAll('[data-action]');
        actionElements.forEach(el => {
            // Let normal framework handle action binding
            // We just ensure SSR protection doesn't interfere
            ssrAllowActionsElements.add(el);
        });
    }

    /**
     * Get current statistics for debugging
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Reset SSR manager state
     * @internal Used for testing
     */
    reset() {
        this.protectedElements.clear();
        this.ssrComponents.clear();
        this.protectedLists.clear();
        this.stats = {
            elementsProtected: 0,
            listsProtected: 0,
            componentsProcessed: 0
        };
        this._log('SSRManager reset');
    }

    /**
     * Internal logging with level control
     */
    _log(...args) {
        if (this.config.logLevel === 'debug' || this.wildflower.debug) {
            console.log('[SSRManager]', ...args);
        }
    }

}

/**
 * SSRProtectionContext - Minimal context that protects DOM during SSR
 *
 * Unlike parsing contexts, these just prevent framework operations
 * without trying to recreate or synchronize anything.
 * Uses _ssrPhase for phase tracking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When the framework creates binding/action/list contexts during SSR component
 * initialization, SSRProtectionContext acts as a protective wrapper that:
 *
 * 1. Implements the context interface (update, isProtected, etc.)
 * 2. No-ops update calls during PROTECTED phase
 * 3. Allows activation to transition to normal framework behavior
 *
 * This enables the framework's normal context creation flow while preventing
 * any modifications to server-rendered content.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LIFECYCLE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   new SSRProtectionContext()
 *         │
 *         ▼ _phase = PROTECTED
 *   ┌─────────────────────────┐
 *   │  PROTECTED MODE         │
 *   │  • update() = no-op     │
 *   │  • isProtected() = true │
 *   └───────────┬─────────────┘
 *               │ activate()
 *               ▼ _phase = ACTIVATED
 *   ┌─────────────────────────┐
 *   │  ACTIVATED MODE         │
 *   │  • update() works       │
 *   │  • isProtected() = false│
 *   └─────────────────────────┘
 *
 * @class SSRProtectionContext
 */
export class SSRProtectionContext {
    constructor(type, id, data) {
        this.type = type;
        this.id = id;
        this.data = data;
        this.element = data.element;

        // Protection state using phase
        this._phase = SSRPhase.PROTECTED;
        this._allowActions = false; // Can be enabled for interactivity

        // Set phase on element
        if (this.element) {
            this.element._ssrPhase = SSRPhase.PROTECTED;
        }
    }

    /**
     * Get current phase
     */
    getPhase() {
        return this._phase;
    }

    /**
     * Enable minimal interactivity (actions, events)
     */
    enableInteractivity() {
        this._allowActions = true;
        if (this.element) {
            ssrAllowActionsElements.add(this.element);
        }
    }

    /**
     * Proxy method calls to support context interface during protection
     */
    update() {
        // During PROTECTED phase, updates are no-ops
        if (this._phase === SSRPhase.PROTECTED) {
            return;
        }
    }

    /**
     * Check if context is still in protection mode
     */
    isProtected() {
        return this._phase === SSRPhase.PROTECTED;
    }

    /**
     * Transition to activated state
     */
    activate() {
        this._phase = SSRPhase.ACTIVATED;
        if (this.element) {
            this.element._ssrPhase = SSRPhase.ACTIVATED;
        }
    }
}

export default SSRManager;
