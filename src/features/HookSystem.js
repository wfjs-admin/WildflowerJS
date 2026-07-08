/**
 * HookSystem - Global lifecycle hooks
 *
 * Split out of PluginSystem so it can ship in every build: it is the
 * cross-cutting lifecycle observation seam, and all core call sites are guarded
 * with `if (this._triggerHook)`. The backing map `_hooks` is created in
 * WildflowerCore's constructor, so these methods work standalone.
 *
 * @module
 */

export const HookSystemMethods = {
    /**
     * Register a global lifecycle hook
     * @param {string} hookName - Hook name (e.g., 'component:afterInit')
     * @param {Function} handler - Handler function
     * @returns {Function} - Unsubscribe function
     */
    hook(hookName, handler)
    {
        if (!hookName || typeof hookName !== 'string') {
            throw new Error('Hook name must be a non-empty string');
        }

        if (typeof handler !== 'function') {
            throw new Error('Hook handler must be a function');
        }

        if (!this._hooks.has(hookName)) {
            this._hooks.set(hookName, []);
        }

        this._hooks.get(hookName).push(handler);

        // Return unsubscribe function
        return () => {
            const handlers = this._hooks.get(hookName);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        };
    },
    /**
     * Trigger a lifecycle hook
     * @private
     */
    _triggerHook(hookName, ...args)
    {
        const handlers = this._hooks.get(hookName);
        if (!handlers) return;

        for (const handler of handlers) {
            try {
                handler(...args);
            } catch (error) {
                if (__DEV__) console.error(`[WF] Hook "${hookName}" error:`, error);
            }
        }
    }
};
