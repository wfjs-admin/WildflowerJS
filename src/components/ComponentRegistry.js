/**
 * ComponentRegistry - Registration and definitions
 *
 * @module
 */

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
            this._log('warn', `Component "${name}" is already registered. Skipping duplicate registration.`);
            
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

            //Rebuild hierarchy after new components are initialized
            if (this._contextSystemInitialized)
            {
                this._buildComponentContextHierarchy();
            }
        }


        return this;
    }
};
