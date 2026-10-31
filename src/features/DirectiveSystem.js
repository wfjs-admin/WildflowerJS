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

        // A directive's update() is driven from each component's change dispatch.
        if (__FEATURE_LISTS__ && this._markAllDispatchBusy) this._markAllDispatchBusy();

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

            this._initDirective(element, directiveName, directive, attr.value, component);
        }
    },
    /**
     * The directives a component's root: block names ({ tooltip: 'label' }),
     * on its root element and in its own scope. A directive the tag carries
     * as well is the tag's: whoever wrote the tag keeps it (WF-520).
     * @private
     */
    _processRootDirectives(component)
    {
        const block = component.definition && component.definition.root;
        const names = block && block.directives;
        if (!names || typeof names !== 'object') return;
        const element = component.element;
        for (const directiveName in names) {
            const directive = this._customDirectives.get(directiveName);
            const value = names[directiveName];
            if (!directive || typeof value !== 'string') continue;
            if (this._hasAttr(element, directiveName)) {
                if (__DEV__) this._warnRootConflict(component, 'directive', directiveName);
                continue;
            }
            this._initDirective(element, directiveName, directive, value, component);
        }
    },
    /** One directive on one element: its context, kept for updates and cleanup, then init. @private */
    _initDirective(element, directiveName, directive, value, component)
    {
        const context = this._buildDirectiveContext(element, value, component);

        if (!this._directiveContexts.has(element)) {
            this._directiveContexts.set(element, new Map());
        }
        this._directiveContexts.get(element).set(directiveName, {
            value,
            context,
            lastResolvedValue: context.resolvedValue
        });
        // Every element a component runs a directive on, so its teardown
        // reaches one that has left its subtree (a child root left behind).
        if (component) (component._directiveEls || (component._directiveEls = new Set())).add(element);

        if (directive.init) {
            try {
                directive.init(element, value, context);
            } catch (error) {
                if (__DEV__) console.error(`[WF] Directive "${directiveName}" init error:`, error);
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
        const listItemElement = __FEATURE_LISTS__ ? this._findListItemAncestor(element) : null;
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
            // A root carries the directives of two components: those its tag
            // gave the component around it, and its own root: block's.
            if (data.context.component !== component) continue;

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
    _cleanupCustomDirectives(element, only)
    {
        const elementDirectives = this._directiveContexts.get(element);
        if (!elementDirectives) return;

        for (const [directiveName, data] of elementDirectives) {
            const owner = data.context.component;
            if (only && owner !== only) continue;
            elementDirectives.delete(directiveName);
            if (owner && owner._directiveEls) owner._directiveEls.delete(element);
            const directive = this._customDirectives.get(directiveName);
            if (!directive?.destroy) continue;

            try {
                directive.destroy(element, data.context);
            } catch (error) {
                if (__DEV__) console.error(`[WF] Directive "${directiveName}" destroy error:`, error);
            }
        }

        if (elementDirectives.size === 0) this._directiveContexts.delete(element);
    },
    /**
     * Apply a callback to every element in a subtree (root + all descendants).
     * Shared traversal for process/update/cleanup directive operations. Given
     * the component, only the elements whose directives it reads: its own,
     * and the roots of the components directly inside it, whose tags it wrote
     * (the rule bindings follow, _bindingScopeElement). A nested component's
     * inside is that component's, and its own root is its owner's unless it
     * is top-level; an update still visits it for its root: block. Cleanup
     * passes no component and reaches every element.
     * @private
     */
    _forEachDirectiveElement(rootElement, callback, component, updating) {
        if (this._customDirectives.size === 0) return;
        const own = component && component.element;
        // Document order: a skipped element's descendants follow it.
        let skip;
        for (const element of [rootElement, ...rootElement.querySelectorAll('*')]) {
            if (skip && skip.contains(element)) continue;
            skip = null;
            if (own) {
                // Content another component's portal moved here is that component's.
                const from = element !== rootElement && element.getAttribute('data-portaled-from');
                if (from && from !== own.dataset.componentId) {
                    skip = element;
                    continue;
                }
                if (this._hasAttr(element, 'component')) {
                    if (element !== own) skip = element;
                    if (!(updating && element === own) && this._bindingScopeElement(element) !== own) continue;
                }
            }
            callback(element);
        }
    },
    /** @private */
    _processCustomDirectivesInSubtree(rootElement, component) {
        this._forEachDirectiveElement(rootElement, el => {
            // A child's root another arrival path already gave this component
            // (_claimChildRootBindings, a section's insertion) keeps it.
            if (!this._directiveOwner(el, component)) this._processCustomDirectives(el, component);
        }, component);
        if (component && rootElement === component.element) this._processRootDirectives(component);
    },
    /** Whether `component` already runs a directive on `el`. @private */
    _directiveOwner(el, component) {
        const entries = this._directiveContexts.get(el);
        if (entries) for (const data of entries.values()) if (data.context.component === component) return true;
        return false;
    },
    /** @private */
    _updateCustomDirectivesInSubtree(rootElement, component, changedPath) {
        this._forEachDirectiveElement(rootElement, el => this._updateCustomDirectives(el, component, changedPath), component, true);
    },
    /**
     * A destroyed component's root still in the page keeps the directives
     * its tag gave the component around it, as its bindings do: they are
     * that component's, destroyed when it goes or the element leaves.
     * @private
     */
    _cleanupCustomDirectivesInSubtree(rootElement, component) {
        const only = component && rootElement.isConnected ? component : null;
        this._forEachDirectiveElement(rootElement, el => this._cleanupCustomDirectives(el, el === rootElement ? only : null));
        // A destroyed component's directives wherever they are now.
        if (component && component._directiveEls) {
            for (const el of component._directiveEls) this._cleanupCustomDirectives(el, component);
        }
    }
};
