/**
 * PluginSystem - Plugins and dependency injection (provide / uses).
 * Directives and hooks were split into DirectiveSystem.js / HookSystem.js so they
 * can ship in every build; this module stays gated to full / spa / standard.
 *
 * @module
 */

import { createStateManager } from '../state/createStateManager.js';
import { createContextProxy, patchSelfReferences, warnCollisions, RAW_TARGET } from '../state/ContextProxy.js';
import { pathResolver } from '../core/wfUtils.js';

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const PluginSystemMethods = {
/**
     * Register a plugin with the framework
     * @param {Function|Object} plugin - Plugin function or object with install method
     * @param {Object} options - Configuration options passed to plugin
     * @returns {WildflowerJS} - Returns this for chaining
     */
    plugin(plugin, options = {})
    {
        // Normalize options
        if (options === undefined || options === null) {
            options = {};
        }

        if (typeof plugin === 'function') {
            this._installPlugin(plugin, null, options);
        } else if (plugin && typeof plugin === 'object') {
            if (typeof plugin.install !== 'function') {
                throw new Error('Object plugin must have an install() method');
            }
            // Don't bind here - let _installPlugin handle context for inject
            this._installPlugin(plugin.install, plugin, options);
        } else {
            throw new Error('Plugin must be a function or object with install method');
        }

        return this;
    },
    /**
     * Install a plugin
     * @private
     */
    _installPlugin(installFn, metadata, options)
    {
        try {
            // Check for duplicate plugin name
            if (metadata?.name && this._pluginsByName.has(metadata.name)) {
                if (__DEV__) console.warn(`[WF] Plugin "${metadata.name}" is being overwritten`);
            }

            // If plugin has uses, create a context object with services
            let installContext = metadata || {};
            if (metadata?.uses) {
                // Create a new context object with services
                installContext = { ...metadata };
                this._useServices(installContext, metadata.uses);
            }

            // Run the install function with the context bound
            installFn.call(installContext, this, options);

            const pluginInfo = {
                install: installFn,
                name: metadata?.name || `anonymous-${this._plugins.length}`,
                version: metadata?.version || '0.0.0',
                options
            };

            this._plugins.push(pluginInfo);

            if (metadata?.name !== undefined && metadata?.name !== null) {
                this._pluginsByName.set(metadata.name, pluginInfo);

                // Handle reactive plugin state
                if (metadata.state || metadata.methods || metadata.computed) {
                    this._setupPluginState(metadata.name, metadata);
                }
            }
        } catch (error) {
            console.error(`[WF] Plugin installation failed:`, error);
        }
    },
    /**
     * Set up reactive state for a plugin
     * @private
     */
    _setupPluginState(name, metadata)
    {
        const framework = this;
        const initialState = metadata.state ? { ...metadata.state } : null;

        // If plugin has state, use ReactiveStateManager for full reactivity
        if (initialState) {
            this._setupReactivePluginState(name, metadata, initialState);
        } else {
            // Lightweight path: methods-only plugin (no state manager overhead)
            this._setupLightweightPluginState(name, metadata);
        }
    },
    // NOTE: _bindPluginMethods() has been removed.
    // Both reactive and lightweight plugin paths now use the unified
    // _bindEntityMethods() with a filtered definition.
    /**
     * Create a $pluginName accessor on the framework instance with computed tracking support.
     * @private
     */
    _createPluginAccessor(name) {
        const framework = this;
        Object.defineProperty(this, `$${name}`, {
            get() {
                const ctx = framework._pluginStates.get(name);
                if (framework._computedTrackingContext && ctx) {
                    return framework._createEntityTrackingProxy(ctx, `plugin:${name}`, name, 'plugin');
                }
                return ctx;
            },
            configurable: true,
            enumerable: false
        });
    },
    /**
     * Set up a reactive plugin with state manager backing.
     * Uses shared entity patterns: _handleEntityStateChange for notification,
     * _createEntitySubscription for subscribe API, _registerEntityDependent
     * for dependency tracking.
     * @private
     */
    _setupReactivePluginState(name, metadata, initialState)
    {
        const framework = this;
        const pluginId = `plugin-${name}-${Date.now()}`;
        const entityKey = `plugin:${name}`;

        // Forward declaration for context proxy (needed in onStateChange)
        let context;

        // Create ReactiveStateManager for this plugin
        // Note: We disable microtask batching for plugins to ensure synchronous
        // watch/subscribe callbacks, which is the expected behavior for plugin APIs
        const stateManager = createStateManager({
            onStateChange: (path, newValue, oldValue) => {
                // Plugin-specific: Call watch handlers if defined
                const raw = context ? context[RAW_TARGET] : null;
                if (raw && raw._watchHandlers) {
                    this._notifyPluginWatchers(raw, path, newValue, oldValue);
                }

                // Use unified entity state change handler
                // This handles marking dependent components and scheduling render
                framework._handleEntityStateChange(entityKey, path, newValue, oldValue);
            },
            wf: framework,
            component: { id: pluginId, name: `plugin:${name}`, disableMicrotaskBatching: true }
        });

        // Create reactive state
        const state = stateManager.createState(initialState);

        // Create base entity context (shared with components and stores)
        const rawContext = this._createBaseEntityContext(
            pluginId,
            state,
            stateManager,
            { type: 'plugin' }
        );

        // Add plugin-specific properties onto the raw context
        rawContext._initialState = initialState;
        rawContext._watchHandlers = null;

        // Use unified subscription API
        rawContext.subscribe = (path, callback, options = {}) => {
            return framework._createEntitySubscription(stateManager, state, path, callback, options);
        };

        // Reset state to initial values
        rawContext.reset = () => {
            // Clear current state (except internal properties)
            Object.keys(state).forEach(key => {
                if (!key.startsWith('_')) {
                    delete state[key];
                }
            });

            // Restore initial state (use objectUtils.deepClone, same as stores)
            Object.entries(initialState).forEach(([key, value]) => {
                state[key] = typeof value === 'object' && value !== null
                    ? objectUtils.deepClone(value)
                    : value;
            });

            return context;
        };

        // NOTE: external() is inherited from _createBaseEntityContext; no override needed.
        // The base version handles dependency registration, pending store resolution,
        // plugin-to-plugin lookups, and write support.

        // Wrap with ContextProxy for shorthand access (this.count → this.state.count)
        context = createContextProxy(rawContext, stateManager);
        patchSelfReferences(rawContext, context, stateManager);
        if (__DEV__) warnCollisions(stateManager, `plugin:${name}`);

        // Bind methods using the unified entity method binder
        // Filter out plugin metadata keys that shouldn't become methods
        const pluginMetadataKeys = new Set(['name', 'version', 'install', 'setup', 'uses', 'methods']);
        const filteredDef = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (!pluginMetadataKeys.has(key)) {
                filteredDef[key] = value;
            }
        }
        // Also merge in methods block
        if (metadata.methods) {
            Object.assign(filteredDef, metadata.methods);
        }
        this._bindEntityMethods(filteredDef, context);

        // Add computed properties; bind to context proxy so this.X shorthand works
        if (metadata.computed) {
            const boundComputedProps = {};
            Object.entries(metadata.computed).forEach(([propName, fn]) => {
                boundComputedProps[propName] = function() {
                    return fn.call(context);
                };
            });
            stateManager.addComputed(boundComputedProps);
        }

        // Set up declarative watch handlers
        if (metadata.watch) {
            rawContext._watchHandlers = new Map();
            Object.entries(metadata.watch).forEach(([path, handler]) => {
                rawContext._watchHandlers.set(path, handler.bind(context));
            });
        }

        // UNIFIED ENTITY SYSTEM: Register plugin as a virtual instance
        const pluginInstance = {
            id: entityKey,      // plugin:name
            name: `plugin:${name}`,
            state,
            stateManager,
            context,
            isVirtual: true     // Mark as virtual (no DOM)
        };

        // Register in componentInstances for unified entity handling
        this.componentInstances.set(entityKey, pluginInstance);


        // Register tick lifecycle hook if defined (shared rAF loop with components)
        if (typeof metadata.tick === 'function') {
            pluginInstance._tickFn = metadata.tick.bind(context);
            if (!this._tickableInstances) this._tickableInstances = [];
            this._tickableInstances.push(pluginInstance);
            this._startPoolLoop();
        }

        // Store in the plugin states map
        this._pluginStates.set(name, context);
        this._createPluginAccessor(name);
    },
    /**
     * Set up a lightweight plugin (methods only, no state manager)
     * @private
     */
    _setupLightweightPluginState(name, metadata)
    {
        const pluginContext = {};

        // Filter out plugin metadata keys, then use unified entity method binder
        const pluginMetadataKeys = new Set(['name', 'version', 'install', 'setup', 'uses', 'methods']);
        const filteredDef = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (!pluginMetadataKeys.has(key)) {
                filteredDef[key] = value;
            }
        }
        if (metadata.methods) {
            Object.assign(filteredDef, metadata.methods);
        }
        this._bindEntityMethods(filteredDef, pluginContext);

        // Store in the plugin states map
        this._pluginStates.set(name, pluginContext);
        this._createPluginAccessor(name);
    },
    // NOTE: _createPluginSubscription() has been removed
    // Plugins now use the unified _createEntitySubscription() method

    /**
     * Notify plugin watchers of state changes
     * @private
     */
    _notifyPluginWatchers(pluginContext, changedPath, newValue, oldValue)
    {
        if (!pluginContext._watchHandlers) return;

        pluginContext._watchHandlers.forEach((handler, watchPath) => {
            // Check if the changed path matches the watch path
            if (changedPath === watchPath ||
                changedPath.startsWith(`${watchPath}.`) ||
                watchPath.startsWith(`${changedPath}.`)) {

                // For nested paths, get the actual value at the watch path
                let actualNewValue = newValue;
                let actualOldValue = oldValue;

                if (changedPath !== watchPath) {
                    // Get the value at the exact watch path
                    actualNewValue = pathResolver.get(pluginContext.state, watchPath);
                }

                handler(actualNewValue, actualOldValue);
            }
        });
    },
    /**
     * Get a registered plugin by name
     * @param {string} name - Plugin name
     * @returns {Object|undefined} - Plugin info or undefined
     */
    getPlugin(name)
    {
        return this._pluginsByName.get(name);
    },
    /**
     * Check if a plugin is registered
     * @param {string} name - Plugin name
     * @returns {boolean}
     */
    hasPlugin(name)
    {
        return this._pluginsByName.has(name);
    },
    /**
     * List all registered plugins
     * @returns {Array<{name: string, version: string}>}
     */
    listPlugins()
    {
        return this._plugins
            .filter(p => p.name && !p.name.startsWith('anonymous-'))
            .map(p => ({ name: p.name, version: p.version }));
    },
// DEPENDENCY INJECTION SYSTEM

    /**
     * Register a service provider for dependency injection
     * @param {string} key - Provider key
     * @param {*} value - Provider value (service instance, factory, etc.)
     * @returns {WildflowerJS} - Returns this for chaining
     */
    provide(key, value)
    {
        if (!key || typeof key !== 'string') {
            throw new Error('Provider key must be a non-empty string');
        }

        this._providers.set(key, value);

        return this;
    },
    /**
     * Get a provided service
     * @param {string} key - Provider key
     * @returns {*} - The provided value or undefined
     */
    getService(key)
    {
        return this._providers.get(key);
    },
    /**
     * Check if a provider exists
     * @param {string} key - Provider key
     * @returns {boolean}
     */
    hasProvider(key)
    {
        return this._providers.has(key);
    },
    /**
     * Apply services to a target object based on uses config.
     * When applyToContext is true, also assigns to target.context (for component instances).
     * @private
     */
    _useServices(target, usesConfig, applyToContext)
    {
        // Normalize to array - support both string and array
        const usesArray = Array.isArray(usesConfig) ? usesConfig :
                           (typeof usesConfig === 'string' ? [usesConfig] : []);

        if (usesArray.length === 0) return;

        for (const key of usesArray) {
            if (this._providers.has(key)) {
                const accessorName = `$${key}`;
                target[accessorName] = this._providers.get(key);
                if (applyToContext && target.context) {
                    target.context[accessorName] = target[accessorName];
                }
            } else {
                if (__DEV__) console.warn(`[WF] Missing provider: "${key}"`);
            }
        }
    },
};
