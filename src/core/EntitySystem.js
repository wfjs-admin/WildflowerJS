/**
 * EntitySystem - Unified entity system and state change handling
 *
 * @module
 */

import { RAW_TARGET } from '../state/ContextProxy.js';
import { pathResolver, wfError, WF_ERRORS, PENDING_BINDING, setOwn } from '../core/wfUtils.js';
import { beginBatchScope, endBatchScope, discardScheduled, toRaw as graphToRaw } from '../state/reactive-graph/core.js';
import { entityMissed } from '../state/StoreManager.js';

/**
 * Path listeners strictly below a path whose value was replaced, each with
 * its own new and old value, for the ones whose value changed.
 *
 * obj = { a: 2 } is reported at 'obj', but a listener on 'obj.a' needs to
 * hear it as surely as it hears obj.a = 2. Only a replacement can move a
 * value below the changed path: the same object reported again (an in-place
 * change announced at its parent) and a primitive (nothing below it) return
 * null before any listener path is looked at.
 *
 * @param {Iterable<string>} paths - Listener paths to check
 * @returns {Array<[string, *, *]>|null} [path, newValue, oldValue] entries
 */
function changedBelow(paths, changedPath, newValue, oldValue) {
    if (newValue === oldValue) return null;
    const newObj = newValue !== null && typeof newValue === 'object';
    const oldObj = oldValue !== null && typeof oldValue === 'object';
    if (!newObj && !oldObj) return null;
    const prefix = changedPath + '.';
    let out = null;
    for (const p of paths) {
        if (typeof p !== 'string' || !p.startsWith(prefix)) continue;
        const rel = p.slice(prefix.length);
        const nv = newObj ? pathResolver.get(newValue, rel) : undefined;
        const ov = oldObj ? pathResolver.get(oldValue, rel) : undefined;
        if (Object.is(nv, ov)) continue;
        (out || (out = [])).push([p, nv, ov]);
    }
    return out;
}

/**
 * Internal worker for wildflower.toRaw().
 *
 * Walks `value` and returns a deep plain-JS copy. Cyclic refs are preserved
 * via the `seen` WeakMap. Reads go through the proxy get-trap, so calling
 * this from inside a reactive effect WILL register dependencies on every
 * walked path. Callers that want true opacity to reactivity should invoke
 * toRaw() outside an effect (the typical use case: snapshot for IDB /
 * postMessage / Web Worker happens in an async callback, not in a tracker).
 *
 * Supported types: primitives, null, undefined, Date, RegExp, Map, Set,
 * Array, plain Object (or proxy-wrapped equivalents). DOM nodes are
 * returned by reference (not cloned). Functions are skipped.
 */
function _toRawWalk(value, seen) {
    if (value === null || typeof value !== 'object') return value;
    // Walk the plain object behind a reactive proxy: element and field reads
    // on the proxy each went through a get trap (slow on a large array, a
    // false WF-216 when repeated, and a dependency per walked path inside a
    // computed). Each level unwraps, since a raw array can hold proxies.
    value = graphToRaw(value);
    if (typeof Node !== 'undefined' && value instanceof Node) return value;
    if (seen.has(value)) return seen.get(value);

    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);

    if (value instanceof Map) {
        const out = new Map();
        seen.set(value, out);
        value.forEach((v, k) => out.set(_toRawWalk(k, seen), _toRawWalk(v, seen)));
        return out;
    }
    if (value instanceof Set) {
        const out = new Set();
        seen.set(value, out);
        value.forEach(v => out.add(_toRawWalk(v, seen)));
        return out;
    }
    if (Array.isArray(value)) {
        const out = new Array(value.length);
        seen.set(value, out);
        for (let i = 0; i < value.length; i++) out[i] = _toRawWalk(value[i], seen);
        return out;
    }

    // Plain object (or proxy that surface-iterates like one). Skip
    // functions: they aren't structured-clone-safe and rarely belong
    // in a state snapshot.
    const out = {};
    seen.set(value, out);
    for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            const v = value[key];
            if (typeof v !== 'function') setOwn(out, key, _toRawWalk(v, seen));
        }
    }
    return out;
}

// Dev-only members, spread into EntitySystemMethods under __DEV__ (absent from
// production files). Nothing in the framework calls these; tests do.
const EntitySystemDevMethods = {
    /**
     * Check if an expression uses a specific path
     * @param {string} expression - The binding expression
     * @param {string} path - The state path to check
     * @returns {boolean} - Whether the expression uses the path
     * @private
     */
    _expressionUsesPath(expression, path)
    {
        // Strip computed: prefix so "computed:storeValue" matches "storeValue" in expressions
        const effectivePath = path.startsWith('computed:') ? path.slice(9) : path;

        // Handle simple case - direct word match
        const wordBoundaryRegex = new RegExp(`\\b${effectivePath}\\b`);
        if (wordBoundaryRegex.test(expression))
        {
            return true;
        }

        // For nested properties, check the parent path
        if (effectivePath.includes('.'))
        {
            const basePath = effectivePath.split('.')[0];
            const basePathRegex = new RegExp(`\\b${basePath}\\b`);
            if (basePathRegex.test(expression))
            {
                return true;
            }
        }

        return false;
    },
};

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const EntitySystemMethods = {
    ...(__DEV__ ? EntitySystemDevMethods : {}),
/**
     * Resolve an external value from another component (used by binding expression evaluation)
     * @param {string} componentNameOrId - Name or ID of the target component
     * @param {string} path - State property path to access
     * @param {string} sourceComponentId - ID of the component requesting the value (for dependency tracking)
     * @returns {*} The value from the target component
     * @private
     */
    _resolveExternalValue(componentNameOrId, path, sourceComponentId) {
        // Find the target component (shared lookup chain)
        const targetComponent = this._externalFindTarget(componentNameOrId);

        // Try to resolve as a plugin (only when plugin feature is enabled)
        if (__FEATURE_PLUGINS__) {
            if (!targetComponent) {
                const pluginHit = this._externalPluginGet(componentNameOrId, path, 2, sourceComponentId);
                if (pluginHit) return pluginHit.value;
            }
        }

        if (!targetComponent) {
            // A list row's dependency walk comes through here: the list's
            // effect then follows the entity's arrival.
            entityMissed(componentNameOrId);
            return path.startsWith('computed:') ? 0 : null;
        }

        try {
            const value = this._externalResolveTargetValue(targetComponent, path);

            // Register external dependency for reactive updates
            // This tracks which components depend on external values from other components
            if (sourceComponentId && targetComponent.id) {
                this._registerExternalDependency(sourceComponentId, targetComponent.id, path);
            }

            return value;
        } catch (error) {
            return path.startsWith('computed:') ? 0 : null;
        }
    },
    /**
     * Shared lookup chain for every external() surface: by instance id →
     * by component name → by store name.
     * @private
     */
    _externalFindTarget(entityNameOrId) {
        let target = this.componentInstances.get(entityNameOrId);
        if (!target) {
            const components = this.getComponentsByType(entityNameOrId);
            if (components.length > 0) {
                target = components[0];
            } else if (this.storeManager) {
                // Try to find as a store component
                target = this.storeManager.getStoreComponentByName(entityNameOrId);
            }
        }
        return target;
    },
    // _externalPluginGet and _registerPluginDependent (plugins only) live in
    // PluginSystemMethods.
    /**
     * Shared value resolution against a target entity. getValue covers state
     * paths and computed ones, plain or dotted; the computed: prefix is
     * optional, so computed:a.b reads exactly what a.b does. No try/catch:
     * each caller keeps its own fallback semantics.
     * @private
     */
    _externalResolveTargetValue(targetEntity, path) {
        return targetEntity.stateManager.getValue(path.startsWith('computed:') ? path.slice(9) : path);
    },
    /**
     * Shared SET path for external(): write, mark for update, schedule.
     * @private
     */
    _externalSetTargetValue(targetEntity, path, value) {
        targetEntity.stateManager.setValue(path, value);
        if (this._componentsToUpdate) {
            this._componentsToUpdate.add(targetEntity.id);
        }
        this._scheduleRender();
        return value;
    },
    /**
     * Shared pending-store-dependency registration for external() misses:
     * the target entity doesn't exist yet, so record who was asking and let
     * StoreManager._resolvePendingStoreDependencies wake them when it is
     * created. Keys off the tracking context set during list/computed eval.
     *
     * A miss inside a computed names that computed, and the drain re-evaluates
     * it. A miss from anywhere else — a data-list path, a data-bind expression,
     * a class or attr expression — has no computed to name, and used to
     * register NOTHING: the entity arrived, the drain found nobody waiting,
     * and the binding stayed inert for the life of the page while the store
     * sat there holding data. PENDING_BINDING is that missing registration,
     * and it is what makes late entity registration work at all.
     *
     * Cheap by construction: this runs only on a MISS, the composite key
     * dedupes repeats, and a resolved entity never reaches here.
     * @private
     */
    _externalRegisterPending(entityNameOrId, fallbackComponentId, stateManager) {
        if (!this.storeManager) return;
        const trackingContext = this._computedTrackingContext;
        const componentId = (trackingContext && trackingContext.componentId) || fallbackComponentId;
        if (!componentId) return;
        this.storeManager.registerPendingStoreDependency(
            entityNameOrId,
            componentId,
            (trackingContext && trackingContext.computedName) || PENDING_BINDING
        );
    },
    /**
     * Register an external dependency between components
     * When targetComponentId's state changes at path, sourceComponentId should be re-rendered
     * @param {string} sourceComponentId - Component that depends on external value
     * @param {string} targetComponentId - Component providing the external value
     * @param {string} path - The state path being depended on
     * @private
     */
    // _markDispatchBusy / _markAllDispatchBusy live in ListSharedMethods: the
    // mark only matters to a list's quiet dispatch, so callers outside the
    // list code are gated on __FEATURE_LISTS__.
    _registerExternalDependency(sourceComponentId, targetComponentId, path) {
        // The target's dispatch is what re-renders the dependent.
        if (__FEATURE_LISTS__) this._markDispatchBusy(this.componentInstances.get(targetComponentId));
        // Key by target entity id: any state change on the target notifies all
        // external dependents. Path-level granularity is deliberately not
        // tracked: a per-path index would always be a subset of this one
        // (every registration implies "any change" semantics for 1-arg
        // external() and the consumer unions anyway), so one index suffices.
        let dependents = this._externalDependencies.get(targetComponentId);
        if (!dependents) {
            dependents = new Set();
            this._externalDependencies.set(targetComponentId, dependents);
        }
        dependents.add(sourceComponentId);
    },
    /**
     * Get all component IDs that depend on a given plugin
     * @param {string} pluginName - Name of the plugin
     * @returns {Set<string>} Set of component IDs
     * @private
     */
    _getPluginDependents(pluginName) {
        const entityKey = `plugin:${pluginName}`;
        return this._getEntityDependents(entityKey);
    },
    /**
     * Register a component as dependent on an entity (store or plugin)
     * When the entity's state changes, all dependents will be notified.
     * @param {string} entityId - ID of the entity being depended on
     * @param {string} componentId - ID of the dependent component
     * @private
     */
    _registerEntityDependent(entityId, componentId) {
        if (!this._entityDependents.has(entityId)) {
            this._entityDependents.set(entityId, new Set());
        }
        this._entityDependents.get(entityId).add(componentId);
        // Invalidate cached "no notify targets" flag on the entity instance
        const instance = this.componentInstances.get(entityId);
        if (instance) instance._hasNotifyTargets = true;
        if (__FEATURE_LISTS__) this._markDispatchBusy(instance);
        // Track whether this entity has any DOM component dependents.
        // Stores without DOM dependents can skip onStateChange in SET traps.
        const depInstance = this.componentInstances.get(componentId);
        if (instance?.stateManager && depInstance && !depInstance.isVirtual) {
            instance.stateManager._hasDOMDependents = true;
        }
    },
    /**
     * Get all component IDs that depend on a given entity
     * @param {string} entityId - ID of the entity
     * @returns {Set<string>} Set of dependent component IDs
     * @private
     */
    _getEntityDependents(entityId) {
        return this._entityDependents.get(entityId) || new Set();
    },
    /**
     * Decide whether a store mutation at `path` can affect a given dependent
     * component. Keeps entity-change invalidation path-scoped: a component
     * that declares `subscribe: { store: [...] }` should not have every
     * computed re-dirtied and every per-item effect force-rerun when an
     * unrelated path on that store mutates (e.g. a hover/cursor field it
     * never reads).
     *
     * Conservative by construction: returns true (must invalidate) whenever
     * irrelevance can't be proven:
     *   - computed-path notifications (a store computed may transitively read
     *     anything; the matching `computed:` notification carries precision),
     *   - components with no `subscribe` declaration for this store (they
     *     became dependents via runtime tracking only),
     *   - components that read a computed off this store (the computed's
     *     transitive state deps aren't recorded on the reader).
     *
     * Returns false (safe to skip) only when the component explicitly
     * subscribed to this store AND `path` prefix-relates to none of its
     * subscribed paths or runtime-tracked state dependencies.
     *
     * @param {Object} dependentInstance - The dependent component instance
     * @param {string} entityId - ID of the mutated entity
     * @param {string} path - The path that changed
     * @returns {boolean} true if the dependent must be invalidated
     * @private
     */
    _entityPathAffectsDependent(dependentInstance, entityId, path) {
        // Computed-name notifications and non-string paths: can't reason.
        if (!path || typeof path !== 'string' || path.startsWith('computed')) {
            return true;
        }

        // Resolve the bare store name (stores may register as 'store-<name>').
        const entityInstance = this.componentInstances.get(entityId);
        let entityName = entityInstance && entityInstance.name;
        if (!entityName) return true;
        if (entityName.startsWith('store-')) entityName = entityName.slice(6);

        // Only narrow for components that declared an explicit subscribe
        // contract for this store. Pure runtime-tracked dependents, and
        // plugin/component dependents, keep the blanket behavior.
        const declared = dependentInstance._subscribedStores;
        if (!declared || declared.indexOf(entityName) === -1) return true;

        // path P relates to dep D when either is a prefix of the other:
        // covers `filters` <-> `filters.text` and `items` <-> `items.2.label`.
        const relates = (d) => d === path
            || path.startsWith(d + '.')
            || d.startsWith(path + '.');

        // 1. Declared subscribe paths.
        const subs = dependentInstance._storeSubscriptions;
        if (subs) {
            for (let i = 0; i < subs.length; i++) {
                if (subs[i].storeName === entityName && relates(subs[i].path)) return true;
            }
        }

        // 2. Runtime-tracked store dependencies: entries are 'state.<path>'
        //    or 'computed.<name>'. A computed dep can't be reasoned about, so
        //    bail to blanket invalidation when one is present.
        const tracked = dependentInstance._storeDependencies &&
            dependentInstance._storeDependencies.get(entityName);
        if (tracked) {
            for (const dep of tracked) {
                if (dep.startsWith('computed')) return true;
                const bare = dep.startsWith('state.') ? dep.slice(6) : dep;
                if (relates(bare)) return true;
            }
        }

        // Explicit subscriber, but `path` matched nothing it reads: skip.
        return false;
    },
    /**
     * AUTOMATIC DEPENDENCY TRACKING PROXY
     *
     * Creates a proxy that tracks property access on entity state/computed
     * during computed property evaluation. When access is detected, the
     * accessing component is automatically registered as a dependent.
     *
     * Used by: getStore(), getComponent(), $pluginName accessor
     *
     * @param {Object} entityContext - The entity context object (has state, computed, methods)
     * @param {string} entityId - ID of the entity for dependency registration
     * @param {string} entityName - Name of the entity for path tracking
     * @param {string} entityType - Type: 'store', 'component', or 'plugin'
     * @returns {Proxy} Wrapped entity context that tracks access
     * @private
     */
    _createEntityTrackingProxy(entityContext, entityId, entityName, entityType) {
        const framework = this;
        const trackingContext = this._computedTrackingContext;

        if (!trackingContext || !trackingContext.componentId) {
            return entityContext;
        }

        const componentId = trackingContext.componentId;

        // Track which paths have been registered to avoid duplicates
        const registeredPaths = new Set();

        const registerDependency = (path) => {
            const fullPath = `${entityName}.${path}`;
            if (registeredPaths.has(fullPath)) return;
            registeredPaths.add(fullPath);

            // Register the component as dependent on this entity
            framework._registerEntityDependent(entityId, componentId);

            // Track which entity paths this component depends on
            const instance = framework.componentInstances.get(componentId);
            if (instance && instance.stateManager) {
                const depKey = `_${entityType}Dependencies`;
                if (!instance[depKey]) {
                    instance[depKey] = new Map();
                }
                if (!instance[depKey].has(entityName)) {
                    instance[depKey].set(entityName, new Set());
                }
                instance[depKey].get(entityName).add(path);
            }
        };

        // Create a proxy for the state object that tracks property access
        const createStateProxy = (state, basePath) => {
            if (!state || typeof state !== 'object') return state;

            return new Proxy(state, {
                get(target, prop) {
                    // Skip symbols to prevent "can't convert symbol to string" errors
                    if (typeof prop === 'symbol') {
                        return target[prop];
                    }
                    const value = target[prop];
                    const path = basePath ? `${basePath}.${prop}` : `state.${prop}`;

                    // Register dependency for this state path
                    if (typeof prop === 'string' && prop !== 'then') {
                        registerDependency(path);
                    }

                    // If the value is an object, wrap it too for nested access
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        return createStateProxy(value, path);
                    }

                    return value;
                }
            });
        };

        // Create proxy for computed object
        const createComputedProxy = (computed) => {
            if (!computed || typeof computed !== 'object') return computed;

            return new Proxy(computed, {
                get(target, prop) {
                    if (typeof prop === 'string' && prop !== 'then') {
                        registerDependency(`computed.${prop}`);
                    }
                    return target[prop];
                }
            });
        };

        // Create the main entity context proxy
        return new Proxy(entityContext, {
            get(target, prop) {
                if (prop === 'state' && target.state) {
                    return createStateProxy(target.state, '');
                }
                if (prop === 'computed' && target.computed) {
                    return createComputedProxy(target.computed);
                }
                // For stateManager access (components), also wrap
                if (prop === 'stateManager' && target.stateManager) {
                    return target.stateManager;
                }
                // Context proxy shorthand: track dependency when prop resolves
                // to a computed or state property via the unified context proxy
                if (typeof prop === 'string' && prop !== 'then') {
                    const sm = target.stateManager;
                    if (sm) {
                        if (sm.computed && sm.computed[prop]) {
                            registerDependency(`computed.${prop}`);
                        } else if (target.state && prop in target.state) {
                            registerDependency(`state.${prop}`);
                        }
                    }
                }
                return target[prop];
            }
        });
    },
    /**
     * UNIFIED STATE CHANGE HANDLER
     *
     * Handle state change for any reactive entity (component, store, or plugin).
     * This is the single entry point for all state change notifications.
     *
     * For components (isVirtual === false):
     *   - Defers updates during initialization
     *   - Triggers lifecycle hooks (beforeUpdate, onUpdate)
     *   - Updates DOM bindings, lists, and contexts
     *   - Executes watchers
     *   - Schedules render with sync/async based on array size
     *
     * For stores/plugins (isVirtual === true):
     *   - Notifies dependent components
     *   - Invalidates dependent computed caches
     *   - Schedules render
     *
     * @param {string} entityId - ID of the entity whose state changed
     * @param {string} path - Path that changed
     * @param {any} newValue - New value
     * @param {any} oldValue - Previous value
     * @private
     */
    /**
     * Re-resolve one child's props and, when a value actually changed, run the
     * full follow-up: invalidate props-dependent computeds, re-run the child's
     * render effect (props are plain objects — effects can't track them, so
     * the trigger is explicit), and fire onPropsChange. Shared by the
     * parent-STATE sweep (isComponent branch) and the entity-dependents sweep:
     * a store change can move a dependent's COMPUTEDS, and children may
     * receive those computeds as props (the passthrough pattern), so both
     * sweeps must cascade to children through the same code.
     * @private
     */
    _refreshChildProps(childInstance, propsChangeInfo) {
        if (!this._updateComponentProps(childInstance)) return;

        // Props changed - invalidate props-dependent computeds so they
        // recalculate (props access is untracked). Core props reactivity,
        // not list-specific — ships in every tier incl. nano.
        this._updatePropsBindingsForComponent(childInstance);

        // If the child lacks an effect (e.g., batch didn't flush), create one now.
        if (!childInstance._renderEffect && this._collectComponentBindingMeta && this._createComponentRenderEffect) {
            childInstance._effectMeta = this._collectComponentBindingMeta(childInstance);
            if (childInstance._effectMeta?.length) {
                this._createComponentRenderEffect(childInstance);
            }
        }
        const childEffect = childInstance._renderEffect?._effect;
        if (childEffect && !childEffect.disposed) {
            childEffect.dirty = true;
            childInstance.stateManager._runEffect(childEffect);
        }

        // A list over a prop reads the plain props object, which no effect
        // tracks: an array replaced by the parent (a new page's props) has no
        // other way to reach it. Re-run the child's own props.* lists; each
        // re-diffs against its rows, so one whose array is unchanged moves
        // nothing.
        if (__FEATURE_LISTS__ && this._processList && childInstance.element) {
            const listEls = childInstance.element.querySelectorAll(this._attrSelector('list'));
            for (let i = 0; i < listEls.length; i++) {
                const listEl = listEls[i];
                const listPath = this._getAttr(listEl, 'list');
                if (!listPath || !listPath.startsWith('props.')) continue;
                if (listEl.closest(this._attrSelector('component')) !== childInstance.element) continue;
                // A mounted list re-reads its source through its own node;
                // one not yet mounted takes the ordinary list path.
                if (listEl._mapArrayInitialized && listEl._refreshMapArray) listEl._refreshMapArray();
                else this._processList({ element: listEl, path: listPath, componentId: childInstance.id }, childInstance, true);
            }
        }

        // Trigger child's onPropsChange lifecycle hook if defined
        if (this._triggerHook) this._triggerHook('component:onPropsChange', childInstance, propsChangeInfo);
        if (childInstance.definition && typeof childInstance.definition.onPropsChange === 'function') {
            try {
                childInstance.definition.onPropsChange.call(childInstance.context, propsChangeInfo);
            } catch (error) {
                if (__DEV__) console.error(`[WF] Error in onPropsChange for ${childInstance.name}:`, error);
            }
        }
    },

    _handleEntityStateChange(entityId, path, newValue, oldValue) {
        const instance = this.componentInstances.get(entityId);
        if (!instance) {
            return;
        }

        const isComponent = !instance.isVirtual;

        // A store's or plugin's own watch: {} (components run theirs below).
        // Ahead of the fast exit: a store nobody depends on can still watch
        // its own state. A store's _internal (its ready flag) is framework
        // bookkeeping, not the author's state, so no watcher hears it.
        if (!isComponent && instance._watcherHandlers && !path.startsWith('_internal')) {
            this._executeWatchers(instance, path, newValue, oldValue);
        }

        // === VIRTUAL STORE FAST EXIT ===
        // For headless stores with no dependents, skip all notification work.
        // This saves ~22% of profile time in cross-store computed benchmarks.
        // Cached flag _hasNotifyTargets is set to true when dependents or
        // path subscribers are registered; defaults to undefined (check needed).
        if (!isComponent) {
            if (instance._hasNotifyTargets === false) {
                return;
            }
            if (instance._hasNotifyTargets === undefined) {
                // First call: check and cache
                const deps = this._getEntityDependents(entityId);
                const hasDeps = deps && deps.size > 0;
                const storeName = instance.name?.startsWith('store-')
                    ? instance.name.slice(6) : instance.name;
                const hasSubs = this.storeManager?.hasPathSubscribers(storeName);
                const hasExtDeps = this._externalDependencies &&
                    this._externalDependencies.has(entityId);
                instance._hasNotifyTargets = !!(hasDeps || hasSubs || hasExtDeps);
                if (!instance._hasNotifyTargets) {
                    return;
                }
            }
        }

        // === COMPONENT-ONLY: Initialization Deferral ===
        if (isComponent && this._deferComponentUpdate(entityId, path, newValue, oldValue)) {
            return;
        }

        // === SHARED: Add to update queue ===
        this._componentsToUpdate.add(entityId);

        // === SHARED: Notify all dependent entities ===
        // This ensures stores/plugins notify their dependent components
        const dependents = this._getEntityDependents(entityId);
        dependents.forEach(componentId => {
            const dependentInstance = this.componentInstances.get(componentId);
            if (!dependentInstance || !dependentInstance.stateManager) {
                this._componentsToUpdate.add(componentId);
                return;
            }

            // Virtual store fast exit: the lean eval path re-evaluates lazily,
            // so a dependent virtual store needs no eager work here.
            if (dependentInstance.isVirtual &&
                !dependentInstance._propPaths)
            {
                return;
            }

            this._componentsToUpdate.add(componentId);

            // Update props first if this component receives props from the
            // changed entity ($store.path props). A component takes the full
            // follow-up, as a child does on a parent change: a new value
            // repaints its bindings, computeds and props lists.
            if (dependentInstance.isVirtual) this._updateComponentProps(dependentInstance);
            else this._refreshChildProps(dependentInstance, { parentPath: path, newValue, oldValue, viaEntity: entityId });

            // A store change can move this dependent's COMPUTEDS, and its
            // children may receive those computeds as props (the passthrough
            // pattern: store -> parent computed -> child prop). The
            // isComponent branch below only sweeps children on parent STATE
            // changes, so without this the child's props snapshot froze at
            // its init-time value while the parent's own bindings moved on.
            // _updateComponentProps returns true only on a real value change,
            // so the cascade is bounded.
            if (dependentInstance.children && dependentInstance.children.length > 0) {
                const propsChangeInfo = { parentPath: path, newValue, oldValue, viaEntity: entityId };
                dependentInstance.children.forEach(child => {
                    this._refreshChildProps(child, propsChangeInfo);
                });
            }

            // Path-scoped invalidation: a component that declares a
            // `subscribe: {}` contract is only re-dirtied / re-run by store
            // mutations to paths it actually reads. Unprovable cases fall
            // back to blanket invalidation (see _entityPathAffectsDependent).
            const pathRelevant = this._entityPathAffectsDependent(dependentInstance, entityId, path);

            // ReactiveGraph wakes exactly the affected computeds via the graph
            // edges a computed's store reads form, so no eager dependent sweep
            // is needed on a store change.

            // Per-item row effects track their reads (itemProxy, component state,
            // and external store reads via this.stores) through the one graph, so
            // ReactiveGraph wakes exactly the rows that depend on a changed value
            // via notifyNode: no blanket per-item wake is needed here.

            // Re-evaluate this dependent's portals on a relevant store change.
            // A portal's data-show / data-render can read a computed that reads
            // the changed store (e.g. a modal gated by
            // `isEditing = stores.x.editingCard !== null`). The own-state render
            // path (_scheduleComponentRender) re-evaluates portals, but a
            // store-driven (subscribe) change reaches a dependent only through
            // this loop, so without this the portal never re-evaluates on a pure
            // store change and a modal won't hide when its condition flips to
            // false (it had no own-state write to trigger a render). Gated on
            // _hasPortals so portal-free components pay nothing.
            if (__FEATURE_PORTALS__ && pathRelevant && this._updatePortalVisibility
                && dependentInstance._hasPortals && dependentInstance.element) {
                this._updatePortalVisibility(dependentInstance);
            }

            // Refresh item-level computed bindings in lists
            // Per-item effects handle this for effect-backed components.
            // Gated on _hasItemComputeds (set beside the computed registry in
            // _setupComputedProperties): this walk visits every row and issues
            // ~5-6 querySelectorAll per row, but every mutation it can make is
            // already conditioned on the same parameterized-computed test, so a
            // component without one repaints nothing and pays O(rows) DOM
            // queries per store write. Same shape as the _hasPortals gate above.
            if (__FEATURE_LISTS__ && dependentInstance.element && this._refreshListItemComputedBindings
                && !dependentInstance._renderEffect
                && dependentInstance.stateManager?._hasItemComputeds) {
                const listElements = dependentInstance.element.querySelectorAll(this._attrSelector('list'));
                listElements.forEach(listEl => {
                    if (listEl._listContext) {
                        const listContext = listEl._listContext;
                        const items = listContext.data || [];
                        const listItems = listEl.querySelectorAll(':scope > *:not(template)');
                        listItems.forEach((itemEl, idx) => {
                            if (idx < items.length) {
                                const item = items[idx];
                                this._refreshListItemComputedBindings(itemEl, item, idx, listContext, dependentInstance);
                            }
                        });
                    }
                });
            }
        });

        // === STORE-ONLY: Notify path subscribers (subscribe: {} feature) ===
        // Call onStoreUpdate() on components that declared subscribe: { storeName: ['path'] }
        if (!isComponent && instance.name && this.storeManager) {
            // Get the user-facing store name (without the 'store-' prefix
            // if present). Store instances are registered with names like
            // 'store-<name>'; users subscribe with the bare name.
            const storeName = instance.name.startsWith('store-')
                ? instance.name.slice(6)
                : instance.name;

            // Fast check using V8-optimized flag
            if (this.storeManager.hasPathSubscribers(storeName)) {
                const subscribers = this.storeManager.getPathSubscribers(storeName, path);

                if (subscribers && subscribers.size > 0) {
                    this._dispatchPathSubscribers(storeName, path, newValue, oldValue, subscribers);
                }

                // A computed's change pulses as "computed:NAME"; subscribers
                // that declared the bare name hear it too (the prefix is optional).
                if (path.startsWith('computed:')) {
                    const bare = path.slice(9);
                    const bareSubs = this.storeManager.getPathSubscribers(storeName, bare);
                    if (bareSubs && bareSubs.size > 0) {
                        this._dispatchPathSubscribers(storeName, bare, newValue, oldValue, bareSubs);
                    }
                }

                // Subscribers below a replaced object: obj = {...} with a
                // subscription on obj.a, each told about its own path.
                const byPath = this.storeManager.getPathSubscriberMap(storeName);
                const below = byPath && changedBelow(byPath.keys(), path, newValue, oldValue);
                if (below) {
                    for (const [childPath, childNew, childOld] of below) {
                        this._dispatchPathSubscribers(storeName, childPath, childNew, childOld, byPath.get(childPath));
                    }
                }
            }
        }

        // === SHARED: Notify external() dependents ===
        // Components using external('entityName', 'path') need updates when that path changes
        // Single entity-keyed index: any path change on this entity
        // notifies all of its external dependents.
        const externalDependents = this._externalDependencies && this._externalDependencies.get(entityId);
        if (externalDependents) {
            externalDependents.forEach(componentId => {
                // Skip if already in update queue from entity dependents
                if (!this._componentsToUpdate.has(componentId)) {
                    this._componentsToUpdate.add(componentId);
                }

                // Force re-render of the component's lists that use external()
                const dependentInstance = this.componentInstances.get(componentId);
                if (dependentInstance && dependentInstance.element) {
                    // Effect-backed components: effects re-run automatically when external() deps change.
                    // Without lists the walk below finds nothing to refresh.
                    if (__FEATURE_LISTS__ && !dependentInstance._renderEffect) {
                        // Find all list contexts in this component
                        const listElements = dependentInstance.element.querySelectorAll(this._attrSelector('list'));
                        listElements.forEach(listEl => {
                            const listPath = this._getAttr(listEl, 'list');

                            // Check if this list uses external() or $store.path syntax
                            const usesExternalStore = listPath && (
                                listPath.includes('external(') ||
                                listPath.includes('$')
                            );

                            if (__FEATURE_LISTS__ && usesExternalStore && this._processList) {
                                // CRITICAL FIX: For external store lists, trigger FULL re-render
                                // not just binding refresh. This handles add/remove operations.
                                this._processList(
                                    {
                                        element: listEl,
                                        path: listPath,
                                        componentId: dependentInstance.id
                                    },
                                    dependentInstance,
                                    true // forceUpdate to ensure re-render
                                );
                            } else if (listEl._listContext) {
                                // For non-external lists, just refresh bindings on existing items
                                const listContext = listEl._listContext;
                                const items = listContext.data || [];

                                const listItems = listEl.querySelectorAll(':scope > *:not(template)');
                                listItems.forEach((itemEl, idx) => {
                                    if (idx < items.length) {
                                        const item = items[idx];
                                        this._refreshListItemExternalBindings(itemEl, item, idx, listContext);
                                    }
                                });
                            }
                        });

                        // Also refresh STANDALONE elements (not in lists) with external() bindings.
                        // Cluster-defined (shares list-item binding executors); on the effect
                        // path external() refresh rides the render effect, so this legacy
                        // !_renderEffect helper is inert in nano.
                        if (__FEATURE_LISTS__) {
                            this._refreshStandaloneExternalBindings(dependentInstance);
                        }
                    } else if (__FEATURE_SSR__) {
                        // Effect-backed component: effects cover mapArray-managed
                        // lists; a server list over this source that mapArray
                        // does not own yet has no other update channel.
                        this._ssrFollowShared(dependentInstance);
                    }
                }
            });
        }

        // === COMPONENT-ONLY: Lifecycle, DOM, Lists, Watchers ===
        if (isComponent) {
            const changeInfo = { path, newValue, oldValue };

            // Update child component props that depend on this parent's state
            if (instance.children && instance.children.length > 0) {
                const propsChangeInfo = { parentPath: path, newValue, oldValue };
                instance.children.forEach(childInstance => {
                    this._refreshChildProps(childInstance, propsChangeInfo);
                });
            }

            // Trigger beforeUpdate lifecycle hook
            instance._lastChangeInfo = changeInfo;
            if (this._triggerHook) this._triggerHook('component:beforeUpdate', instance, changeInfo);
            this._callBeforeUpdateHook(instance);

            // Handle DOM updates (bindings, contexts, path tracking)
            this._handleComponentDOMUpdates(instance, path, newValue, oldValue);

            // Set current updating instance for context in rendering
            this._currentUpdatingInstance = instance;

            try {
                // Handle list state changes: skip when component has no lists
                const listAffected = instance._listContexts?.size > 0
                    ? this._handleComponentListStateChange(instance, path, newValue, oldValue)
                    : false;

                // Execute watchers
                this._executeWatchers(instance, path, newValue, oldValue);

                // Update contexts for state change
                if (this._contextSystemInitialized && this._contextRecords) {
                    this._updateContextsForStateChange(entityId, path);
                }

                // Schedule rendering (handles sync vs async, batch mode, etc.)
                this._scheduleComponentRender(instance, newValue, listAffected);
            } finally {
                // Clear current updating instance
                this._currentUpdatingInstance = null;
            }
        } else {
            // === STORE/PLUGIN: Simple render scheduling ===
            // Schedule render ONLY if DOM-attached components need updating.
            // Headless stores (no subscribing components with DOM elements) skip this entirely.
            // This avoids ~200K RAF scheduling calls in cross-store computed benchmarks.
            let hasDOMUpdates = false;
            for (const compId of this._componentsToUpdate) {
                const comp = this.componentInstances.get(compId);
                if (comp && comp.element) {
                    hasDOMUpdates = true;
                    break;
                }
            }
            if (hasDOMUpdates) {
                this._scheduleRender();
            }
        }
    },
    /**
     * Handle DOM updates for a component when state changes.
     * Updates binding contexts, tracks changed paths, and queues contexts for render.
     * @param {Object} instance - Component instance
     * @param {string} path - The state path that changed
     * @param {*} newValue - New value
     * @param {*} oldValue - Previous value
     * @private
     */
    _handleComponentDOMUpdates(instance, path, newValue, oldValue) {
        const instanceId = instance.id;

        // Track HTML binding components that need updates
        const componentHasHTMLBindings = (this.domElements.htmlBindings || []).some(binding =>
            binding.componentId === instanceId
        );

        if (componentHasHTMLBindings) {
            this._ensureSet('_batchChangedComponents');
            this._batchChangedComponents.add(instanceId);
        }

        // Binding contexts need no update here: the render effect and the
        // per-item effects handle every binding. (The array-operation checks
        // that stood here only decided between returning and reaching the end.)
    },
    /**
     * Bind methods from a definition to a context object.
     * Works for components, stores, and plugins. Methods are bound BEFORE init() is called.
     * @param {Object} definition - Entity definition containing methods
     * @param {Object} context - Context object to bind methods to
     * @param {Object} [instance] - Optional instance for storing original methods
     * @private
     */
    _bindEntityMethods(definition, context, instance = null) {
        const framework = this;
        // Get the raw context to bypass the context proxy's SET trap,
        // which would route writes to state when property names collide.
        const rawContext = context[RAW_TARGET] || context;

        Object.entries(definition).forEach(([key, value]) => {
            if (typeof value === 'function' &&
                key !== 'state' &&
                key !== 'computed' &&
                key !== 'watch' &&
                key !== 'init' &&
                key !== 'beforeInit' &&
                key !== 'beforeUpdate' &&
                key !== 'onUpdate' &&
                key !== 'beforeDestroy' &&
                key !== 'destroy') {

                // Create bound wrapper with error handling
                const boundMethod = function(...args) {
                    try {
                        return value.apply(context, args);
                    } catch (error) {
                        // An entity with onError handles its own method
                        // errors, as a component does; without one the error
                        // belongs to the caller. The owner lookup runs only
                        // on this path.
                        if (key !== 'onError' && typeof context.onError === 'function') {
                            let owner = instance;
                            if (!owner) {
                                for (const inst of framework.componentInstances.values()) {
                                    if (inst.context === context) { owner = inst; break; }
                                }
                            }
                            if (owner) return framework._handleError(`Error in ${owner.name}.${key}`, error, owner, { methodName: key });
                        }
                        if (__DEV__) console.error(`Error in ${key}:`, error);
                        throw error;
                    }
                };

                rawContext[key] = boundMethod;

                // Also expose on instance if provided
                if (instance) {
                    instance[key] = boundMethod;
                }
            }
        });
    },
    /**
     * Create subscription for watching state changes on any entity.
     * Shared implementation for stores, plugins, and components.
     * @param {ReactiveStateManager} stateManager - The state manager
     * @param {Object} state - The state proxy
     * @param {string} path - Path to watch
     * @param {Function} callback - Callback on change
     * @param {Object} options - { immediate: boolean, once: boolean }
     * @returns {Function} Unsubscribe function
     * @private
     */
    _createEntitySubscription(stateManager, state, path, callback, options = {}) {
        const { immediate = false, once = false } = options;

        // A subscription whose path matches a `computed:NAME` pulse needs that
        // computed's notifier installed (lazy by default). The augmented
        // onStateChange below matches exactly, so a subscribe-all ('') observes
        // every computed; otherwise record the bare name (strip an explicit
        // `computed:` prefix). Recording a plain-state name is harmless; the
        // notifier only materializes if a computed by that name exists.
        if (stateManager._ensureComputedNotifier) {
            if (path === '') stateManager._observeAllComputedNotifiers();
            else stateManager._ensureComputedNotifier(path.startsWith('computed:') ? path.slice(9) : path);
        }

        // RG-5: subscribing to a list item
        // by numeric index is an anti-pattern. Reactivity is identity-based, so
        // the index in an onStateChange path reflects the item's position when
        // FIRST observed; after a splice/reorder the subscription misfires or
        // goes silent. WF-213, dev-only, warn-severity (recoverable diagnostic;
        // must not trip error-tracking pipelines).
        // A query store is exempt: every ingest and write replaces rows
        // wholesale, so 'rows.0.x' tracks the current first row (pinned by
        // query-index-path-watch.test.js).
        if (__DEV__ && typeof path === 'string' && !stateManager._wfQueryOwned && (/(^|\.)\d+(\.|$)|\[\d+\]/.test(path))) {
            wfError(WF_ERRORS.INDEXED_PATH_OBSERVER, {
                warn: true,
                context: `subscribe path "${path}"`,
                suggestion: 'Subscribe to the array (or a computed over it) and track items by id instead of position'
            });
        }

        // Create a unique subscription ID
        const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        // Initialize subscription system if needed
        if (!stateManager._subscriptions) {
            stateManager._subscriptions = new Map();

            // Augment onStateChange to call subscribers
            const originalOnStateChange = stateManager.onStateChange;
            stateManager.onStateChange = function(changedPath, newValue, oldValue) {
                // Call original handler first
                if (originalOnStateChange) {
                    originalOnStateChange(changedPath, newValue, oldValue);
                }

                // Check if store is ready (if it has _internal.ready tracking)
                const isReady = !state._internal || state._internal.ready !== false;

                // Only notify subscribers if ready
                if (isReady && stateManager._subscriptions) {
                    stateManager._subscriptions.forEach((subInfo, subId) => {
                        const { subPath, handler, options: subOptions } = subInfo;

                        // Only call if path matches subscription path
                        let fired = false;
                        if (changedPath === subPath ||
                            changedPath.startsWith(`${subPath}.`) ||
                            (subPath === '' && changedPath)) {

                            // Call the handler
                            handler(newValue, oldValue, changedPath);
                            fired = true;
                        } else if (changedPath.startsWith('computed:') && changedPath.slice(9) === subPath) {
                            // A computed's change pulses as "computed:NAME"; a
                            // subscription on the bare name hears it too, as a
                            // watcher does (the prefix is optional).
                            handler(newValue, oldValue, subPath);
                            fired = true;
                        } else if (subPath.length > changedPath.length && subPath.startsWith(`${changedPath}.`)) {
                            // Below a replaced object: obj = {...} with a subscription on obj.a
                            const below = changedBelow([subPath], changedPath, newValue, oldValue);
                            if (below) {
                                handler(below[0][1], below[0][2], subPath);
                                fired = true;
                            }
                        }

                        // Handle once option
                        if (fired && subOptions && subOptions.once) {
                            stateManager._subscriptions.delete(subId);
                        }
                    });
                }
            };
        }

        // A subscriber rides the change dispatch: from here on it runs for
        // every write, direct-writer leaves included (see setDispatchQuiet).
        if (stateManager.setDispatchQuiet) stateManager.setDispatchQuiet(false);

        // Store subscription info
        stateManager._subscriptions.set(subscriptionId, {
            subPath: path,
            handler: callback,
            options: { once }
        });

        // Call immediately if requested and store is ready
        if (immediate && (!state._internal || state._internal.ready !== false)) {
            const currentValue = pathResolver.get(state, path);
            callback(currentValue, undefined, path);
            if (once) {
                stateManager._subscriptions.delete(subscriptionId);
                return () => {}; // Already unsubscribed
            }
        }

        // Return unsubscribe function
        const unsubscribe = () => {
            stateManager._subscriptions?.delete(subscriptionId);
        };

        return unsubscribe;
    },
    /**
     * Notify path subscribers (components with subscribe: {} declaration) about a store path change.
     * Calls each subscriber's onStoreUpdate() method with the change details.
     *
     * @param {string} storeName - Name of the store that changed
     * @param {string} path - Path within the store that changed
     * @param {*} newValue - New value at the path
     * @param {*} oldValue - Previous value at the path
     * @param {Set<Object>} subscribers - Set of subscribed component instances
     * @private
     */
    /**
     * Notify path subscribers.
     * @private
     */
    _dispatchPathSubscribers(storeName, path, newValue, oldValue, subscribers) {
        if (!subscribers || subscribers.size === 0) return;
        this._notifyPathSubscribers(storeName, path, newValue, oldValue, subscribers);
    },

    _notifyPathSubscribers(storeName, path, newValue, oldValue, subscribers) {
        // Re-entrancy guard: prevent infinite loops if onStoreUpdate modifies the store
        const pathKey = `${storeName}:${path}`;
        if (this._notifyingPaths.has(pathKey)) {
            if (__DEV__) wfError(WF_ERRORS.STORE_REENTRANT_WRITE, {
                warn: true,
                context: `Re-entrant store update detected for ${pathKey}; the nested notification was dropped (the write itself landed)`
            });
            return;
        }

        this._notifyingPaths.add(pathKey);

        try {
            subscribers.forEach(componentInstance => {
                // Skip if component was destroyed
                if (!componentInstance || !this.componentInstances.has(componentInstance.id)) {
                    return;
                }

                // Call onStoreUpdate if the component has it defined
                if (typeof componentInstance.definition?.onStoreUpdate === 'function') {
                    try {
                        componentInstance.definition.onStoreUpdate.call(
                            componentInstance.context,
                            storeName,
                            path,
                            newValue,
                            oldValue
                        );
                    } catch (error) {
                        this._handleError(
                            `Error in ${componentInstance.name}.onStoreUpdate`,
                            error,
                            componentInstance,
                            { lifecycle: 'onStoreUpdate', storeName, path }
                        );
                    }
                }
            });
        } finally {
            this._notifyingPaths.delete(pathKey);
        }
    },
    /**
     * Check if a path is managed by a list context (and thus should skip context iteration)
     * List-managed paths are updated by ListRenderer optimizations, not context iteration.
     * @param {string} path - The state path that changed
     * @param {Object} instance - Component instance
     * @returns {boolean} true if ListRenderer handles this path
     * @private
     */
    _isListManagedPath(path, instance) {
        // No list contexts = not list-managed. Only the list renderer makes
        // them (_createListContext), so a tier without lists has none.
        if (!__FEATURE_LISTS__ || !instance._listContexts || instance._listContexts.size === 0) {
            return false;
        }

        // Parse path parts to determine if this is an array-level or property-level change
        const parts = path.split('.');
        const basePath = parts[0];

        // Only skip for array-level changes, NOT property changes inside items
        // - "rows" (1 part) → array replacement → skip
        // - "rows.0" (2 parts, numeric) → item replacement → skip
        // - "rows.0.label" (3+ parts) → property change → DON'T skip (binding needs update)
        if (parts.length > 2) {
            // This is a nested property path - bindings need to update
            return false;
        }

        // Check if second part is numeric (array index)
        if (parts.length === 2 && !/^\d+$/.test(parts[1])) {
            // Second part is not numeric - this is a property, not an index
            return false;
        }

        // Check if this base path is managed by a list context
        if (instance._listContexts.has(basePath)) {
            return true;
        }

        // Also check for external() list patterns - these are handled by ListRenderer too
        for (const [listPath] of instance._listContexts) {
            if (listPath.includes('external(')) {
                // External paths like "external('cart', 'items')" - extract the property name
                const match = listPath.match(/external\([^,]+,\s*['"]([^'"]+)['"]\)/);
                if (match && match[1] === basePath) {
                    return true;
                }
            }
        }

        return false;
    },
    /**
     * Update contexts based on state changes
     * @param {string} instanceId - Component ID
     * @param {string} path - The path that changed
     * @private
     */
    _updateContextsForStateChange(instanceId, path)
    {
        const instance = this.componentInstances.get(instanceId);
        if (!instance) {
            return;
        }

        // PERFORMANCE OPTIMIZATION: Skip context iteration for list-managed paths
        // ListRenderer handles these updates through optimized paths (swap, append, sparse-update)
        // This prevents O(n) context iteration for array operations that should be O(1)
        if (__FEATURE_LISTS__ && this._isListManagedPath(path, instance)) {
            return;
        }

        // Binding context iteration removed; the render effect now handles ALL binding
        // DOM updates including web component adapters and portal bindings.
        //
        // Conditional contexts (data-show, non-list data-render via type:'render'
        // meta, list-item data-render via per-item effects) are likewise fully
        // effect-driven, so the path-string conditional iteration that used to live
        // here is gone; every component carries a render effect.

        // Update custom directives (only when plugin system is available)
        if (this._customDirectives && this._customDirectives.size > 0 && instance.element) {
            this._updateCustomDirectivesInSubtree(instance.element, instance, path);
            // Content the component's portals moved is still its own.
            const portals = __FEATURE_PORTALS__ && this._activePortals && this._activePortals.get(instance.id);
            if (portals) {
                for (const record of portals) {
                    for (const el of record.content) {
                        this._updateCustomDirectivesInSubtree(el, instance, path);
                    }
                }
            }
        }
    },
    /**
     * Execute watchers for a specific path
     * @private
     */
    _executeWatchers(instance, path, newValue, oldValue)
    {

        if (!instance._watcherHandlers)
        {
            return;
        }

        // Check for exact path match
        if (instance._watcherHandlers.has(path))
        {

            try
            {
                instance._watcherHandlers.get(path)(newValue, oldValue, path);
            } catch (error)
            {
                this._handleError(`Error in watcher for ${path}`, error, instance);
            }
        }

        // Computed changes notify as "computed:name"; also check watchers registered under bare name
        if (path.startsWith('computed:'))
        {
            const barePath = path.slice(9);
            if (instance._watcherHandlers.has(barePath))
            {
                try
                {
                    instance._watcherHandlers.get(barePath)(newValue, oldValue, barePath);
                } catch (error)
                {
                    this._handleError(`Error in watcher for ${barePath}`, error, instance);
                }
            }
        }

        // Notify parent path watchers
        // e.g., if path is 'user.name', notify watchers for 'user'
        // NOTE: Parent watchers receive (currentValue, currentValue, changedPath) because the
        // parent object is the same mutable reference; no deep copy of the previous state exists.
        // Use the third argument (changedPath) to identify what changed.
        const pathParts = path.split('.');
        while (pathParts.length > 1)
        {
            pathParts.pop();
            const parentPath = pathParts.join('.');

            if (instance._watcherHandlers.has(parentPath))
            {
                try
                {
                    const parentValue = instance.stateManager.getValue(parentPath);
                    instance._watcherHandlers.get(parentPath)(parentValue, parentValue, path);
                } catch (error)
                {
                    this._handleError(`Error in parent path watcher for ${parentPath}`, error, instance);
                }
            }
        }

        // Check for array index changes
        // e.g., if path is 'tasks.0.completed', notify watchers for 'tasks'
        if (/\.\d+($|\.)/.test(path))
        {
            const arrayPath = path.replace(/\.\d+($|\.).*/, '');

            if (instance._watcherHandlers.has(arrayPath))
            {
                try
                {
                    const arrayValue = instance.stateManager.getValue(arrayPath);
                    instance._watcherHandlers.get(arrayPath)(arrayValue, arrayValue, path);
                } catch (error)
                {
                    this._handleError(`Error in array watcher for ${arrayPath}`, error, instance);
                }
            }
        }

        // Check for wildcard watchers
        if (instance._watcherHandlers.has('*'))
        {
            try
            {
                instance._watcherHandlers.get('*')(newValue, oldValue, path);
            } catch (error)
            {
                this._handleError(`Error in wildcard watcher`, error, instance);
            }
        }

        // Watchers below a replaced object: obj = {...} with a watcher on obj.a
        const below = changedBelow(instance._watcherHandlers.keys(), path, newValue, oldValue);
        if (below)
        {
            for (const [childPath, childNew, childOld] of below)
            {
                try
                {
                    instance._watcherHandlers.get(childPath)(childNew, childOld, childPath);
                } catch (error)
                {
                    this._handleError(`Error in watcher for ${childPath}`, error, instance);
                }
            }
        }
    },
    /**
     * Start a batch of state updates to minimize renders
     * @returns {Object} - Batch context object
     * @public
     */
    startBatch()
    {
        // Set batch mode flag. Change detection happens at applyBatch by
        // walking each state manager's _batchChanges Map, which the proxy set traps
        // populate as a side effect of every batch-mode write. No
        // upfront state snapshot is needed.
        this._batchMode = true;
        this._suppressRender = true;

        // Mark the scheduler boundary so a later cancelBatch() drops only the
        // effects this batch schedules, not unrelated work already queued before
        // the batch opened (the ReactiveGraph queue is global; without the
        // boundary, cancel would clear pending pre-batch renders too).
        beginBatchScope();

        return {
            apply: () => this.applyBatch(),
            cancel: () => this.cancelBatch()
        };
    },
    /**
     * Run a function inside a batch, applying changes on success and
     * cancelling on error. Equivalent to:
     *
     *   const ctx = wildflower.startBatch();
     *   try { fn(); ctx.apply(); }
     *   catch (e) { ctx.cancel(); throw e; }
     *
     * Removes the manual try/catch boilerplate and makes batch usage
     * exception-safe by construction. Sync-only: if `fn` returns a
     * Promise, the batch is applied/cancelled before the Promise
     * resolves. For async work, use the start/apply/cancel API
     * directly and manage the lifetime explicitly.
     *
     * @param {Function} fn - Function to run inside the batch
     * @returns {WildflowerJS} - For method chaining
     * @public
     */
    batch(fn) {
        if (typeof fn !== 'function') {
            if (__DEV__) wfError(WF_ERRORS.BATCH_ARG_INVALID, { warn: true, context: 'wildflower.batch(fn) called without a function' });
            return this;
        }
        const ctx = this.startBatch();
        try {
            fn();
            ctx.apply();
        } catch (e) {
            ctx.cancel();
            throw e;
        }
        return this;
    },
    /**
     * Apply all batched changes at once
     * @returns {WildflowerJS} - For method chaining
     * @public
     */


    applyBatch()
    {
        // Turn off batch mode
        this._batchMode = false;
        this._suppressRender = false;

        // Close the scheduler discard scope opened in startBatch (apply keeps the
        // scheduled renders; only cancelBatch discards them).
        endBatchScope();

        this._batchChangedComponents = this._batchChangedComponents || new Set();
        this._batchChangedPaths = this._batchChangedPaths || new Set();

        this._applyBatchToLists();

        if (this._batchChangedComponents.size > 0)
        {
            this._scheduleRender();
        }

        return this;
    },


    _applyBatchToLists()
    {
        if (!__FEATURE_LISTS__) return;
        if (!this._batchChangedComponents || !this._batchChangedPaths) return;

        // Find affected list components
        const listsToUpdate = this.domElements.lists.filter(list =>
            list && this._batchChangedComponents.has(list.componentId)
        );

        if (listsToUpdate.length === 0)
        {
            return;
        }

        // Group by component
        const listsByComponent = this._groupListsByComponent(listsToUpdate);

        // Process each component
        for (const [componentId, componentLists] of listsByComponent)
        {
            const instance = this.componentInstances.get(componentId);
            if (!instance) continue;

            const listsCount = componentLists.length;
            for (let i = 0; i < listsCount; i++) {
                this._processList(componentLists[i], instance, /* forceUpdate */ true);
            }
        }
    },
    /**
     * Cancel a batch without applying changes
     * @returns {WildflowerJS} - For method chaining
     * @public
     */
    cancelBatch()
    {
        // Turn off batch mode
        this._batchMode = false;
        this._suppressRender = false;

        // Note: cancelBatch does NOT roll back the writes themselves;
        // mutations made during the batch persist in instance.state.
        // It only skips the post-batch render scheduling.

        // The framework's _suppressRender flag doesn't reach ReactiveGraph's
        // scheduler, which already marked + queued this batch's render effects
        // eagerly on write. Drop them so cancel actually skips the render (state
        // still persists). The queue is global and discardScheduled is scoped to
        // the boundary set at startBatch, so this must run EXACTLY ONCE: a
        // per-instance call would reset the boundary on the first pass and then
        // globally clear (dropping unrelated pre-batch renders) on the next.
        discardScheduled();

        return this;
    },
    /**
     * Return a deep plain-JS copy of a reactive value.
     *
     * WildflowerJS wraps store and component state in reactive Proxies for
     * dependency tracking. Some Web Platform APIs use the structured-clone
     * algorithm and reject proxies with DataCloneError: IndexedDB,
     * postMessage, Web Workers, BroadcastChannel, the Cache API, History API
     * state. Use this to snapshot WF state at the boundary before handing
     * it off.
     *
     * Example:
     *   await db.put('issues', wildflower.toRaw(pm.issues));
     *   worker.postMessage(wildflower.toRaw(state));
     *   await caches.open('app').then(c => c.put(req,
     *       new Response(JSON.stringify(wildflower.toRaw(state)))));
     *
     * Supported types: primitives, null, undefined, Date, RegExp, Map, Set,
     * Array, plain Object. Cyclic references are preserved. DOM nodes are
     * returned by reference (not cloned). Functions are skipped.
     *
     * The walk reads the plain data behind each reactive proxy, so it
     * registers no dependencies: a computed that calls toRaw() does not
     * re-run when the copied data changes. Read the reactive value itself
     * where a computed should track it.
     *
     * @param {*} value - Any value: primitive, object, array, proxy.
     * @returns {*} A structured-clone-safe deep copy.
     */
    toRaw(value) {
        return _toRawWalk(value, new WeakMap());
    }
};
