/**
 * DirectiveSystem - Custom data-* directives
 *
 * Split out of PluginSystem so it can ship in every build: it is the declarative
 * extension point, and all core call sites are guarded
 * (`if (this._processCustomDirectivesInSubtree)` / `_customDirectives.size`).
 * The backing maps `_customDirectives` / `_directiveContexts` are created in
 * WildflowerCore's constructor, so these methods work standalone.
 *
 * @module
 */

import { pathResolver, wfError, WF_ERRORS } from '../core/wfUtils.js';

export const DirectiveSystemMethods = {
    /**
     * Register a custom directive
     * @param {string} name - Directive name (used as data-{name})
     * @param {Object} handlers - Lifecycle handlers { init, update, destroy }
     * @returns {WildflowerJS} - Returns this for chaining
     */
    directive(name, handlers)
    {
        if (!name || typeof name !== 'string') {
            throw new Error('Directive name must be a non-empty string');
        }

        // data-wf-X is the prefixed form of directive X, so a directive named
        // 'wf-X' could never be written: data-wf-X would reach 'X' instead.
        if (name.startsWith('wf-')) {
            throw new Error(`Directive name "${name}" cannot start with "wf-": data-wf-${name.slice(3)} is the prefixed form of directive "${name.slice(3)}"`);
        }

        if (!handlers || typeof handlers !== 'object') {
            throw new Error('Directive handlers must be an object');
        }

        if (this._customDirectives.has(name)) {
            if (__DEV__) wfError(WF_ERRORS.REGISTRATION_OVERWRITTEN, { warn: true, context: `Directive "${name}" is being overwritten` });
        }

        this._customDirectives.set(name, {
            init: handlers.init || null,
            update: handlers.update || null,
            destroy: handlers.destroy || null
        });

        // Invalidate cached selector so it gets rebuilt with the new directive
        this._customDirectivesSelector = null;

        return this;
    },
    /**
     * Process custom directives on an element
     * @private
     */
    _processCustomDirectives(element, component)
    {
        // Get all data-* attributes: data-X, or data-wf-X (only data-wf-X in
        // exclusive mode; the wf form wins when an element carries both)
        const attributes = Array.from(element.attributes);

        for (const attr of attributes) {
            const directiveName = this._wfBase(attr.name);
            if (directiveName === null) continue;

            const directive = this._customDirectives.get(directiveName);

            if (!directive) continue;
            if (this._wfTwinWins(element, attr.name)) continue;

            const value = attr.value;
            const context = this._buildDirectiveContext(element, value, component);

            // Store context for updates and cleanup
            if (!this._directiveContexts.has(element)) {
                this._directiveContexts.set(element, new Map());
            }
            this._directiveContexts.get(element).set(directiveName, {
                value,
                context,
                lastResolvedValue: context.resolvedValue
            });

            // Call init
            if (directive.init) {
                try {
                    directive.init(element, value, context);
                } catch (error) {
                    if (__DEV__) console.error(`[WF] Directive "${directiveName}" init error:`, error);
                }
            }
        }
    },
    /**
     * Build context object for directive
     * @private
     */
    _buildDirectiveContext(element, valuePath, component)
    {
        const context = {
            component,
            path: valuePath,
            resolvedValue: this._resolveDirectiveValue(valuePath, component),
            listItem: null,
            listIndex: null,
            parentContexts: []
        };

        // Check if inside a list
        const listItemElement = this._findListItemAncestor(element);
        if (listItemElement) {
            context.listIndex = listItemElement._listIndex;
            // Try to get the list item data
            context.listItem = this._getListItemData(listItemElement, component);
        }

        return context;
    },
    /**
     * Resolve a value path against component state
     * @private
     */
    _resolveDirectiveValue(path, component)
    {
        if (!path || !component?.state) return undefined;

        // Handle special $item reference (for list contexts)
        if (path === '$item' || path.startsWith('$item.')) {
            // Will be handled by list context
            return undefined;
        }

        return pathResolver.get(component.state, path);
    },
    /**
     * Update custom directives when state changes
     * @private
     */
    _updateCustomDirectives(element, component, changedPath)
    {
        const elementDirectives = this._directiveContexts.get(element);
        if (!elementDirectives) return;

        for (const [directiveName, data] of elementDirectives) {
            const directive = this._customDirectives.get(directiveName);
            if (!directive?.update) continue;

            // Check if this directive's value path is affected
            if (changedPath && !this._isDirectivePathAffected(data.value, changedPath)) continue;

            const newValue = this._resolveDirectiveValue(data.value, component);
            const oldValue = data.lastResolvedValue;

            // Skip if value hasn't changed
            if (newValue === oldValue) continue;

            // Update stored value
            data.lastResolvedValue = newValue;
            data.context.resolvedValue = newValue;

            try {
                directive.update(element, newValue, oldValue, data.context);
            } catch (error) {
                if (__DEV__) console.error(`[WF] Directive "${directiveName}" update error:`, error);
            }
        }
    },
    /**
     * Check if a changed path affects a directive's value path
     * @private
     */
    _isDirectivePathAffected(directivePath, changedPath)
    {
        if (!changedPath) return true; // Full update
        return changedPath.startsWith(directivePath) ||
               directivePath.startsWith(changedPath);
    },
    /**
     * Cleanup custom directives on an element
     * @private
     */
    _cleanupCustomDirectives(element)
    {
        const elementDirectives = this._directiveContexts.get(element);
        if (!elementDirectives) return;

        for (const [directiveName, data] of elementDirectives) {
            const directive = this._customDirectives.get(directiveName);
            if (!directive?.destroy) continue;

            try {
                directive.destroy(element, data.context);
            } catch (error) {
                if (__DEV__) console.error(`[WF] Directive "${directiveName}" destroy error:`, error);
            }
        }

        this._directiveContexts.delete(element);
    },
    /**
     * Apply a callback to every element in a subtree (root + all descendants).
     * Shared traversal for process/update/cleanup directive operations.
     * @private
     */
    _forEachDirectiveElement(rootElement, callback) {
        if (this._customDirectives.size === 0) return;
        callback(rootElement);
        const allElements = rootElement.querySelectorAll('*');
        for (const element of allElements) {
            callback(element);
        }
    },
    /** @private */
    _processCustomDirectivesInSubtree(rootElement, component) {
        this._forEachDirectiveElement(rootElement, el => this._processCustomDirectives(el, component));
    },
    /** @private */
    _updateCustomDirectivesInSubtree(rootElement, component, changedPath) {
        this._forEachDirectiveElement(rootElement, el => this._updateCustomDirectives(el, component, changedPath));
    },
    /** @private */
    _cleanupCustomDirectivesInSubtree(rootElement) {
        this._forEachDirectiveElement(rootElement, el => this._cleanupCustomDirectives(el));
    }
};
