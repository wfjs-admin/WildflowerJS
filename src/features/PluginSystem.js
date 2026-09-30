/**
 * PluginSystem - Plugins and dependency injection (provide / uses).
 * Directives and hooks were split into DirectiveSystem.js / HookSystem.js so they
 * can ship in every build; this module stays gated to full / spa / standard.
 *
 * @module
 */

import { createStateManager } from '../state/createStateManager.js';
import { createContextProxy, patchSelfReferences, warnCollisions } from '../state/ContextProxy.js';
import { validateEntityDefinition, warnDefinitionCollisions, wfError, WF_ERRORS } from '../core/wfUtils.js';

// Non-function definition keys the plugin factory actually consumes
// (validateEntityDefinition allowlist — note plugins DO have a 'methods'
// block, unlike components/stores).
const PLUGIN_CONTRACT_KEYS = ['name', 'version', 'install', 'uses', 'methods', 'state', 'computed', 'watch', 'pools'];

// Metadata keys that are plugin machinery, never candidate top-level methods.
// Used to detect a plugin whose functions were declared bare (same shape as
// components/stores) rather than nested under `methods:`.
const PLUGIN_NON_METHOD_KEYS = new Set(['name', 'version', 'install', 'setup', 'uses', 'state', 'computed', 'watch', 'tick']);

// Cancel a plugin instance's 'store:' watch subscriptions. A replaced or
// failed instance is never destroyed, so without this its handlers would
// keep firing on every change to the watched store.
function stopStoreWatchers(inst) {
    const cleanups = inst && inst._storeWatcherCleanups;
    if (!cleanups) return;
    for (const unsubscribe of cleanups) {
        try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (e) { /* already gone */ }
    }
    inst._storeWatcherCleanups = [];
}

// Tear down a plugin that is being replaced under the same name, whichever
// path (reactive or lightweight) the new definition takes: stop its tick and
// pools and its store: watchers, dispose its state manager, and drop its
// registry entries. Its own beforeDestroy() and destroy() run first, while
// its state is still there to read.
function retirePlugin(fw, name) {
    const entityKey = `plugin:${name}`;
    const previous = fw.componentInstances.get(entityKey);
    if (previous) {
        fw._callBeforeDestroyHook(previous);
        if (typeof previous.context.destroy === 'function') {
            try { previous.context.destroy(); } catch (error) {
                fw._handleError(`Error in ${previous.name}.destroy`, error, previous, { lifecycle: 'destroy' });
            }
        }
        if (fw._cleanupPools) fw._cleanupPools(previous);
        stopStoreWatchers(previous);
        if (previous.stateManager && previous.stateManager.destroy) previous.stateManager.destroy();
        fw.componentInstances.delete(entityKey);
    }
    fw._pluginStates.delete(name);
    const info = fw._pluginsByName.get(name);
    const idx = info ? fw._plugins.indexOf(info) : -1;
    if (idx !== -1) fw._plugins.splice(idx, 1);
}

/**
 * True if the metadata has at least one function-valued key that isn't
 * plugin machinery (name/version/install/setup/uses/state/computed/watch/tick).
 * Catches the methods-at-top-level shape so it gets the same $name accessor
 * a `methods:` block or `state:` block would.
 * @private
 */
function hasTopLevelPluginMethods(metadata) {
    for (const key in metadata) {
        if (!PLUGIN_NON_METHOD_KEYS.has(key) && typeof metadata[key] === 'function') {
            return true;
        }
    }
    return false;
}

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
            // install() is optional (since 1.5.1): a plugin that is only state,
            // computed, and methods has the same shape as a component or store
            // and needs no installation step. Absent, a no-op stands in so the
            // rest of the registration (name, state, $accessor) runs unchanged.
            const install = typeof plugin.install === 'function' ? plugin.install : function () {};
            // Don't bind here - let _installPlugin handle context for inject
            this._installPlugin(install, plugin, options);
        } else {
            throw new Error('Plugin must be a function or an object');
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
                if (__DEV__) wfError(WF_ERRORS.REGISTRATION_OVERWRITTEN, { warn: true, context: `Plugin "${metadata.name}" is being overwritten` });
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

            if (metadata?.name != null && this._pluginsByName.has(metadata.name)) {
                retirePlugin(this, metadata.name);
            }

            this._plugins.push(pluginInfo);

            if (metadata?.name !== undefined && metadata?.name !== null) {
                this._pluginsByName.set(metadata.name, pluginInfo);

                // Handle reactive plugin state
                // setup is not a plugin hook: nothing calls it, and the
                // validator skips functions, so name it here.
                if (__DEV__ && typeof metadata.setup === 'function') {
                    wfError(WF_ERRORS.DEFINITION_KEY_IGNORED, {
                        warn: true,
                        context: `Plugin '${metadata.name}': setup() is not a plugin lifecycle hook and is never called`,
                        suggestion: 'Move its body into install(wf, options), which runs once when the plugin registers.'
                    });
                }

                if (metadata.state || metadata.methods || metadata.computed || metadata.pools || metadata.watch || typeof metadata.tick === 'function' || hasTopLevelPluginMethods(metadata)) {
                    this._setupPluginState(metadata.name, metadata);
                } else if (__DEV__ && typeof metadata.install !== 'function') {
                    // install() has already run above, so an install-only plugin
                    // (registers a directive, wires services) is legitimate.
                    wfError(WF_ERRORS.PLUGIN_EXPOSES_NOTHING, {
                        warn: true,
                        context: `Plugin "${metadata.name}" declares no state, computed, methods, or top-level functions`,
                        suggestion: `wildflower.$${metadata.name} will be undefined. Add a state/computed/methods block, or declare functions at the top level of the plugin definition.`
                    });
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
        // tick, pools, watch and the destroy hooks are set up only on the
        // reactive path, so a plugin with any of them and no state takes it
        // with empty state rather than the lightweight path.
        const initialState = metadata.state ? { ...metadata.state }
            : ((typeof metadata.tick === 'function' || metadata.pools || metadata.watch ||
                typeof metadata.destroy === 'function' || typeof metadata.beforeDestroy === 'function') ? {} : null);

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
        const key = `$${name}`;
        // Tracked explicitly (not inferred from Object.keys at destroy time):
        // a property's terser-mangled short name is not pinned for every
        // field, so a name like _deferredReactiveUpdates can legitimately
        // land on a `$`-prefixed short name in some builds, and a
        // startsWith('$') scan would delete it as if it were a plugin
        // accessor. See destroy()'s cleanup, which reads this set instead.
        if (!this._pluginAccessorKeys) this._pluginAccessorKeys = new Set();
        this._pluginAccessorKeys.add(key);
        Object.defineProperty(this, key, {
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
        const stateManager = createStateManager({
            onStateChange: (path, newValue, oldValue) => {
                // Use unified entity state change handler (it also runs the
                // plugin's watch: {}, as it does a component's and a store's)
                // This handles marking dependent components and scheduling render
                framework._handleEntityStateChange(entityKey, path, newValue, oldValue);
            },
            wf: framework,
            component: { id: pluginId, name: `plugin:${name}` }
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

            // Pools empty too, as a store's reset() empties its pools.
            const pools = context.pools;
            if (pools) for (const poolName in pools) pools[poolName].clear();

            return context;
        };

        // NOTE: external() is inherited from _createBaseEntityContext; no override needed.
        // The base version handles dependency registration, pending store resolution,
        // plugin-to-plugin lookups, and write support.

        // Wrap with ContextProxy for shorthand access (this.count → this.state.count)
        context = createContextProxy(rawContext, stateManager);
        patchSelfReferences(rawContext, context, stateManager);
        if (__DEV__) warnCollisions(stateManager, `plugin:${name}`, metadata.computed);
        if (__DEV__) validateEntityDefinition('Plugin', name, metadata, PLUGIN_CONTRACT_KEYS);
        if (__DEV__) warnDefinitionCollisions('Plugin', name, metadata);

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
                // Reported (onError handlers, else the console, in every
                // build) and re-thrown, as a store computed is.
                boundComputedProps[propName] = function() {
                    try {
                        return fn.call(context);
                    } catch (error) {
                        framework._handleError(`Error in plugin '${name}' computed '${propName}'`, error,
                            framework.componentInstances.get(`plugin:${name}`) || null, { lifecycle: 'computed', computedName: propName });
                        throw error;
                    }
                };
            });
            stateManager.addComputed(boundComputedProps);
        }

        // UNIFIED ENTITY SYSTEM: Register plugin as a virtual instance
        const pluginInstance = {
            id: entityKey,      // plugin:name
            name: `plugin:${name}`,
            state,
            stateManager,
            context,
            definition: { watch: metadata.watch || null },
            isVirtual: true     // Mark as virtual (no DOM)
        };

        // A plugin registered again under the same name was retired in
        // _installPlugin (retirePlugin) before this runs.

        // beforeDestroy()/destroy() on the context, where replacement
        // (retirePlugin) and framework teardown (destroyComponent) call them.
        for (const hook of ['beforeDestroy', 'destroy']) {
            if (typeof metadata[hook] === 'function') rawContext[hook] = metadata[hook].bind(context);
        }

        // Register in componentInstances for unified entity handling
        this.componentInstances.set(entityKey, pluginInstance);

        // watch: {} through the same code as a component's and a store's.
        if (metadata.watch && this._setupWatchers) this._setupWatchers(pluginInstance);

        // Pools: a plugin has no DOM, so its pools are data only, as a store's
        // are. Guarded: the pool module is absent from tiers without pools.
        if (this._setupDataPools) {
            const fw = this;
            rawContext.getPool = function(poolName, options) {
                const handle = (pluginInstance._pools && pluginInstance._pools.get(poolName)) || null;
                if (handle && options) fw._applyPoolHooks(handle, options, pluginInstance.context);
                return handle;
            };
            if (metadata.pools) {
                try {
                    this._setupDataPools(pluginInstance, metadata.pools);
                } catch (error) {
                    // Leave nothing half-built behind (the install catch reports it).
                    this._cleanupPools(pluginInstance);
                    stopStoreWatchers(pluginInstance);
                    this.componentInstances.delete(entityKey);
                    throw error;
                }
            }
        } else if (__DEV__ && metadata.pools) {
            wfError(WF_ERRORS.FEATURE_NOT_IN_BUILD, {
                warn: true,
                context: `Plugin '${name}': pools are declared, but this build does not include pools (pool module excluded from this tier); this.pools has no handles`
            });
        }

        // Register tick lifecycle hook if defined (shared rAF loop with
        // components). Guarded: the frame loop lives in the pool module,
        // absent from tiers without pools (see ComponentLifecycle twin).
        if (typeof metadata.tick === 'function') {
            if (this._startPoolLoop) {
                pluginInstance._tickFn = metadata.tick.bind(context);
                if (!this._tickableInstances) this._tickableInstances = [];
                this._tickableInstances.push(pluginInstance);
                this._startPoolLoop();
            } else if (__DEV__) {
                wfError(WF_ERRORS.FEATURE_NOT_IN_BUILD, {
                    warn: true,
                    context: `Plugin '${name}': tick() is defined, but this build does not include the frame loop (pool module excluded from this tier); tick will never run`
                });
            }
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
                if (__DEV__) wfError(WF_ERRORS.PROVIDER_MISSING, {
                    warn: true,
                    context: `Missing provider "${key}"`,
                    suggestion: `Register it with wildflower.provide('${key}', value) before components that use it initialize.`
                });
            }
        }
    },
};
