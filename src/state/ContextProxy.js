/**
 * ContextProxy - Unified property resolution for component/store contexts
 *
 * Makes `this.count` in methods resolve identically to `data-bind="count"` in templates.
 * Resolution order: context own property → computed → state → undefined
 *
 * @module
 */

/**
 * Symbol used to access the raw (unwrapped) context object through the proxy.
 * Internal code that needs to write properties directly on the context
 * (e.g., _bindMethods) uses context[RAW_TARGET] to bypass the proxy's
 * SET trap, which would otherwise route writes to state.
 */
const RAW_TARGET = Symbol('contextProxy.rawTarget');

/**
 * Essential framework properties that ALWAYS win over state — these are
 * core to framework operation and cannot be shadowed by user state.
 * Used by the ContextProxy to decide collision resolution.
 */
const ESSENTIAL_FRAMEWORK_PROPERTIES = new Set([
    'id', 'state', 'stateManager', 'computed', 'element', 'stores', '$el',
    'update', 'subscribe', 'isReady', 'waitForReady', 'external',
    'find', 'findAll', 'closest',
    'saveToStorage', 'loadFromStorage', 'getItemFromEvent', 'debug',
    'store', 'getStore', 'emit', 'components',
    'props', 'resetError', 'framework', 'pool', 'pools'
]);

/**
 * All framework-reserved property names — includes essential properties
 * plus those where state is allowed to win on collision (parent, listItem,
 * name, reset). Used for dev-mode collision warnings so users know their
 * state property shares a name with a framework property.
 */
const FRAMEWORK_PROPERTIES = new Set([
    ...ESSENTIAL_FRAMEWORK_PROPERTIES,
    'parent', 'listItem', 'name', 'reset'
]);

/**
 * Create a Proxy-wrapped context that resolves flat property names
 * against computed and state when not found directly on the context.
 *
 * @param {Object} rawContext - The original context object (plain object)
 * @param {Object} stateManager - The ReactiveStateManager instance
 * @returns {Proxy} Proxy-wrapped context
 */
function createContextProxy(rawContext, stateManager) {
    const state = rawContext.state;

    const handler = {
        get(target, prop, receiver) {
            // RAW_TARGET: return the unwrapped context for internal direct writes
            if (prop === RAW_TARGET) return target;

            // Symbols pass through (iterators, toPrimitive, etc.)
            if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);

            // Own properties on raw context (framework props, methods).
            // For non-essential framework properties (parent, listItem, etc.),
            // state wins when both exist — prevents framework-injected values
            // from shadowing user state with the same key.
            if (prop in target) {
                if (typeof prop === 'string' && !ESSENTIAL_FRAMEWORK_PROPERTIES.has(prop) &&
                    typeof target[prop] !== 'function' &&
                    state && !prop.startsWith('_') && prop in state) {
                    return state[prop];
                }
                return Reflect.get(target, prop, receiver);
            }

            // Computed (precedence over state, matching template resolution)
            if (stateManager.computed && stateManager.computed[prop]) {
                // Track computed-to-computed dependency (same as this.computed proxy)
                // PERF: Lightweight tracking for _updateNode dep comparison.
                if (stateManager._nodeTrackingSet) {
                    stateManager._nodeTrackingSet.add(`computed:${prop}`);
                } else if (stateManager.activeComputation) {
                    stateManager._trackDependency(`computed:${prop}`);
                }
                return stateManager.evaluateComputed(prop);
            }

            // State (skip underscore-prefixed internal properties)
            if (state && typeof prop === 'string' && !prop.startsWith('_') && prop in state) {
                return state[prop];
            }

            return undefined;
        },

        set(target, prop, value, receiver) {
            // Symbols pass through
            if (typeof prop === 'symbol') return Reflect.set(target, prop, value, receiver);

            // Own properties: state wins for non-essential framework properties.
            if (prop in target) {
                if (typeof prop === 'string' && !ESSENTIAL_FRAMEWORK_PROPERTIES.has(prop) &&
                    typeof target[prop] !== 'function' &&
                    state && !prop.startsWith('_') && prop in state) {
                    state[prop] = value;
                    return true;
                }
                return Reflect.set(target, prop, value, receiver);
            }

            // Block computed writes (dev warning, no-op)
            if (stateManager.computed && stateManager.computed[prop]) {
                if (__DEV__) console.warn(`[WF] Cannot set computed property "${prop}" — computed properties are read-only`);
                return true;
            }

            // State write (reactive via proxy)
            if (state && typeof prop === 'string' && !prop.startsWith('_') && prop in state) {
                state[prop] = value;
                return true;
            }

            // Fallthrough: new ad-hoc property on raw context
            return Reflect.set(target, prop, value, receiver);
        },

        has(target, prop) {
            if (prop in target) return true;
            if (typeof prop === 'string') {
                if (stateManager.computed && stateManager.computed[prop]) return true;
                if (state && !prop.startsWith('_') && prop in state) return true;
            }
            return false;
        },

        defineProperty(target, prop, desc) {
            return Reflect.defineProperty(target, prop, desc);
        }
    };

    return new Proxy(rawContext, handler);
}

/**
 * Patch self-referencing helpers (update) to bind to the proxy
 * instead of the raw context.
 *
 * @param {Object} rawContext - The original context object
 * @param {Proxy} proxy - The proxy-wrapped context
 * @param {Object} stateManager - The ReactiveStateManager instance
 */
function patchSelfReferences(rawContext, proxy, stateManager) {
    rawContext.update = function(pathOrObj, value) {
        if (typeof pathOrObj === 'object') {
            Object.entries(pathOrObj).forEach(([key, val]) => {
                stateManager.setValue(key, val);
            });
        } else {
            stateManager.setValue(pathOrObj, value);
        }
        return proxy;
    };
}

/**
 * Emit dev-mode warnings when state or computed names collide with
 * framework-reserved property names.
 *
 * @param {Object} stateManager - The ReactiveStateManager instance
 * @param {string} entityName - Component or store name (for warning message)
 */
function warnCollisions(stateManager, entityName) {
    const state = stateManager._state || {};
    const computed = stateManager.computed || {};

    for (const prop of FRAMEWORK_PROPERTIES) {
        if (prop in state) {
            console.warn(
                `[WF] "${entityName}": state property "${prop}" collides with a framework property. ` +
                `Use this.state.${prop} to access it explicitly.`
            );
        }
        if (prop in computed) {
            console.warn(
                `[WF] "${entityName}": computed property "${prop}" collides with a framework property. ` +
                `Use this.computed.${prop} to access it explicitly.`
            );
        }
    }
}

export { createContextProxy, patchSelfReferences, warnCollisions, FRAMEWORK_PROPERTIES, RAW_TARGET };
