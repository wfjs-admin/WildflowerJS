/**
 * ComponentRegistry - Registration and definitions
 *
 * @module
 */

import { wfError, WF_ERRORS, definitionSignature } from '../core/wfUtils.js';

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const ComponentRegistryMethods = {
/**
     * Register a component definition - primary API for creating components.
     *
     * This is the main entry point for defining reactive components in WildflowerJS.
     * Components are automatically discovered and initialized when their corresponding
     * `data-component` attribute is found in the DOM.
     *
     * **Definition Structure:**
     * ```javascript
     * {
     *   state: { ... },           // Reactive state properties
     *   computed: { ... },        // Derived properties (cached, auto-updating)
     *   stores: ['storeName'],    // Store dependencies (optional)
     *   init() { ... },           // Lifecycle: called after initialization
     *   destroy() { ... },        // Lifecycle: called before destruction
     *   onRouteChange() { ... },  // Lifecycle: called on route changes (if router active)
     *   methodName() { ... }      // Action methods (called via data-action)
     * }
     * ```
     *
     * **State Reactivity:**
     * - All state properties are wrapped in Proxy for automatic change detection
     * - Changes trigger DOM updates only for affected bindings
     * - Array mutations (push, splice, etc.) are detected and optimized
     *
     * **Computed Properties:**
     * - Automatically cached until dependencies change
     * - Dependencies tracked via PatternTrie for O(log n) lookups
     * - Access via `data-bind="computed:propertyName"` in templates
     *
     * @param {string} name - Component name (must match data-component attribute value)
     * @param {Object} definition - Component definition object
     * @param {Object} [definition.state] - Initial reactive state
     * @param {Object} [definition.computed] - Computed property functions
     * @param {string[]} [definition.stores] - Store names this component depends on
     * @param {Function} [definition.init] - Initialization lifecycle hook
     * @param {Function} [definition.destroy] - Destruction lifecycle hook
     * @param {Function} [definition.onRouteChange] - Route change lifecycle hook
     * @returns {WildflowerJS} Returns this for method chaining
     *
     * @example
     * // Basic component
     * wildflower.component('counter', {
     *   state: { count: 0 },
     *   computed: {
     *     doubled() { return this.state.count * 2; }
     *   },
     *   increment() { this.state.count++; }
     * });
     *
     * @example
     * // Component with lifecycle hooks
     * wildflower.component('data-loader', {
     *   state: { data: null, loading: false },
     *   async init() {
     *     this.state.loading = true;
     *     this.state.data = await fetch('/api/data').then(r => r.json());
     *     this.state.loading = false;
     *   },
     *   destroy() {
     *     // Cleanup resources
     *   }
     * });
     *
     * @example
     * // HTML usage
     * // <div data-component="counter">
     * //   <span data-bind="count">0</span>
     * //   <button data-action="increment">+1</button>
     * // </div>
     */
    component(name, definition)
    {
        if (!name || typeof name !== 'string')
        {
            this._log('error', 'Component name must be a string');
            return this;
        }

        if (!definition || typeof definition !== 'object')
        {
            this._log('error', 'Component definition must be an object');
            return this;
        }

        // Normalize events configuration
        if (definition.events)
        {
            definition.events = this._normalizeEventsConfig(definition.events);
        }

        // Normalize props definition (convert shorthand to full form)
        if (definition.props)
        {
            definition.props = this._normalizePropsDefinition(definition.props);
        }

        this._log('info', `Registering component: ${name}`);

        // Check if this component is already registered
        if (this.componentDefinitions.has(name))
        {
            // WF-215 (dev): a re-registration under an existing name whose
            // definition DIFFERS from the stored one is almost always an
            // accidental collision (two demos, HMR without teardown, etc.).
            // The original is kept; warn so the conflict is diagnosable.
            // Unregister first (wildflower.unregister) to replace intentionally.
            if (__DEV__ && definitionSignature(this.componentDefinitions.get(name)) !== definitionSignature(definition)) {
                wfError(WF_ERRORS.DUPLICATE_REGISTRATION_CONFLICT, {
                    warn: true,
                    context: `component "${name}"`,
                    suggestion: `Call wildflower.unregister('${name}') before re-registering, or use a distinct name`
                });
            } else {
                this._log('warn', `Component "${name}" is already registered. Skipping duplicate registration.`);
            }

            // Skip re-initialization for duplicate registrations to prevent cascades
            // Components should already be initialized from the first registration
            return this;
        }

        // Store the component definition
        // Note: component name is the Map key, not spread into definition,
        // to avoid shadowing user state properties named 'name'
        this.componentDefinitions.set(name, definition);

        if (this._hasInitialized)
        {
            this._initializeComponentElements(name);
        }


        return this;
    },

    /**
     * Unregister a component definition and destroy its live instances.
     *
     * Removes the definition so the name can be re-registered with a fresh
     * definition, and tears down every mounted instance of that type (disposing
     * their reactive state, effects, contexts, and event handlers via
     * destroyComponent). Virtual store components are not touched here; see
     * unregister() for the unified entry point that also handles stores.
     *
     * @param {string} name - Registered component name
     * @returns {boolean} True if a definition existed and was removed
     */
    unregisterComponent(name)
    {
        if (!name || !this.componentDefinitions.has(name)) return false;
        const ids = [];
        this.componentInstances.forEach((inst, id) => {
            if (inst && inst.name === name && !inst.isVirtual) ids.push(id);
        });
        ids.forEach(id => this.destroyComponent(id));
        this.componentDefinitions.delete(name);
        return true;
    },

    // COMPONENT LOOKUP HELPERS

    /**
     * Get a component instance by its type name
     * @param {string} name - Component type name (e.g., 'theme-manager')
     * @returns {Object|null} - Component's ContextProxy or null if not found
     *
     * Returns the ContextProxy so callers can use `getComponent('x').prop`
     * without needing `.state.` or `.computed.`, consistent with how
     * `this.prop` works inside component methods.
     *
     * AUTOMATIC DEPENDENCY TRACKING: When called inside a computed property,
     * the calling component is automatically registered as dependent on the
     * returned component. Changes to the returned component's state will
     * trigger re-evaluation of the calling component's computed properties.
     */
    getComponent(name) {
        for (const [_id, instance] of this.componentInstances) {
            if (instance.name === name) {
                // AUTOMATIC DEPENDENCY TRACKING: If we're inside a computed property evaluation,
                // use the shared tracking proxy to automatically register dependencies
                if (this._computedTrackingContext && instance.id) {
                    return this._createEntityTrackingProxy(instance.context, instance.id, name, 'component');
                }
                return instance.context;
            }
        }
        return null;
    },
    /**
     * Get all component instances of a given type
     * @param {string} name - Component type name
     * @returns {Array} - Array of matching component ContextProxies
     */
    getComponents(name) {
        const results = [];
        for (const [_id, instance] of this.componentInstances) {
            if (instance.name === name) {
                results.push(instance.context);
            }
        }
        return results;
    }
};
