/**
 * RenderingCore - Core render scheduling and binding processing
 *
 * @module
 */

import { listBoundElements } from '../core/DomMetadata.js';
import { WF_ERRORS, wfError, mergeData } from '../core/wfUtils.js';
import { getContextMethod } from '../state/ContextProxy.js';
import { recording as __tlOn, timelineNoteFrame as __tlFrame } from '../state/TimelineRecorder.js';
import { applyShow, applyAttrObj, applyAttrValue, applyStyleObj, applyStyleProp, applyText, applyModel, applyClass } from '../core/BindingWriters.js';

/** Blocklisted attributes for data-bind-attr security (O(1) lookup, no per-call allocation).
 *  Relocated from ListExpressionEval so data-bind-attr sanitization ships in the nano
 *  tier — data-bind-attr is a core binding, and without these the object-attr writer
 *  would apply on-handler and javascript-protocol values unsanitized. */
const _LIST_BLOCKED_ATTRS = new Set([
    'class', 'style', 'srcdoc',
    'data-bind', 'data-action', 'data-list', 'data-if', 'data-show',
    'data-render', 'data-component', 'data-template', 'data-slot',
    'data-portal', 'data-bind-html', 'data-bind-class', 'data-bind-style',
    'data-bind-attr', 'data-model', 'data-key',
    'data-wf-bind', 'data-wf-action', 'data-wf-list', 'data-wf-if', 'data-wf-show',
    'data-wf-render', 'data-wf-component', 'data-wf-template', 'data-wf-slot',
    'data-wf-portal', 'data-wf-bind-html', 'data-wf-bind-class', 'data-wf-bind-style',
    'data-wf-bind-attr', 'data-wf-model', 'data-wf-key'
]);

/** The value bindings a component's root can carry for its owner (_rootOwnerElement),
 *  under either prefix. A precheck: in wf-prefix-only mode a bare attribute matches
 *  too, and the mode-aware reads after it find nothing to do. */
const _ROOT_BINDINGS_SELECTOR = ['show', 'render', 'bind', 'bind-html', 'bind-class', 'bind-style', 'bind-attr', 'model']
    .map(name => `[data-${name}],[data-wf-${name}]`).join(',');

/** A root: block compiled to effect entries, once per definition (_createRootEffect). */
const _rootSpecs = new WeakMap();

/** Whether an effect entry or a section record is the one for `root`. */
const _entryIsFor = (entry, root) => entry.element === root || (!!entry.context && entry.context.element === root);

// Dev-only members, spread into RenderingCoreMethods under __DEV__ (absent
// from production files). Every caller outside this object is inside an
// `if (__DEV__ ...)` block or a `__DEV__ ?` expression.
const RenderingCoreDevMethods = {
    // #region FEATURE_BINDING_VALIDATION
    // ==========================================
    // RUNTIME BINDING VALIDATION (Debug Mode Only)
    // ==========================================

    /**
     * Validate all bindings for a component against its state properties
     * Warns in debug mode when bindings reference undefined state properties
     * @param {Object} instance - The component instance
     * @private
     */
    _validateComponentBindings(instance) {
        if (!__DEV__) return; // compile-time: bodies in this region are stripped from prod builds
        if (!this.debug) return;

        const { state, name: componentName, id: componentId, element: componentElement } = instance;
        const stateKeys = Object.keys(state);

        // Include computed property names; they're valid binding targets
        if (instance.stateManager && instance.stateManager.computed) {
            const computedKeys = Object.keys(instance.stateManager.computed);
            for (const key of computedKeys) {
                if (!stateKeys.includes(key)) stateKeys.push(key);
            }
        }

        // Collect all binding paths from domElements (registered bindings)
        const bindingCollections = [
            { collection: this.domElements.bindings, pathKey: 'path', type: 'data-bind' },
            { collection: this.domElements.models, pathKey: 'path', type: 'data-model' },
            { collection: this.domElements.conditionals, pathKey: 'path', type: 'data-show' },
            { collection: this.domElements.htmlBindings, pathKey: 'path', type: 'data-bind-html' },
            { collection: this.domElements.lists, pathKey: 'path', type: 'data-list' }
        ];

        for (const { collection, pathKey, type } of bindingCollections) {
            if (!collection) continue;

            for (const binding of collection) {
                if (binding.componentId !== componentId) continue;
                // Inside a record-shape query subtree a bare path reads the
                // row (data-model excepted), so component state cannot judge
                // it. WF-997 names a field neither scope carries, once the row
                // has arrived.
                if (__FEATURE_QUERY__ && type !== 'data-model' && binding.element && binding.element._wfRecordQuery) continue;

                const path = binding[pathKey];
                if (!path) continue;

                this._validateBindingPath(path, stateKeys, componentName, type, state);
            }
        }

        // The root: block reads the component's own scope. Directive values
        // are not checked, here as on a tag (a directive may take a literal).
        const block = instance.definition && instance.definition.root;
        if (block && typeof block === 'object') {
            if (typeof block.show === 'string') this._validateBindingPath(block.show, stateKeys, componentName, 'root: show', state);
            for (const key of ['class', 'attr', 'style']) {
                const group = block[key];
                if (group && typeof group === 'object') for (const name in group) {
                    if (typeof group[name] === 'string') this._validateBindingPath(group[name], stateKeys, componentName, `root: ${key}.${name}`, state);
                }
            }
        }

        // Scan component DOM for data-render and data-bind-class attributes
        // These are not stored in global domElements, so we scan directly
        // IMPORTANT: Skip elements inside nested data-component scopes; those
        // belong to child components and will be validated when those initialize
        if (componentElement) {
            const isOwnedByThisComponent = (el) => {
                // Slot templates (data-use-template + data-with) are expanded
                // against the object named by data-with, so their bindings
                // resolve in THAT scope, not this component's state. Validating
                // them here reported valid bindings as undefined (WF-509 false
                // positive). Every runtime binding processor already skips these
                // via the same closest() guard — see the call sites around
                // _processBindingElements / _processClassBindingElements.
                if (el.closest('[data-use-template-rendered]')) return false;
                // Same for children of a <template>: only reachable when the
                // template sits inside <svg> (parsed as an inert element with
                // live children); they belong to the pool, not to state.
                if (el.closest('template')) return false;

                let parent = el.parentElement;
                while (parent && parent !== componentElement) {
                    if (this._hasAttr(parent, 'component')) return false;
                    parent = parent.parentElement;
                }
                return true;
            };

            // Validate data-render bindings
            const renderElements = componentElement.querySelectorAll(this._attrSelector('render'));
            renderElements.forEach(el => {
                if (!isOwnedByThisComponent(el)) return;
                const path = this._getAttr(el, 'render');
                if (path) {
                    this._validateBindingPath(path, stateKeys, componentName, 'data-render', state);
                }
            });

            // Validate data-bind-class expressions
            const classBindingElements = componentElement.querySelectorAll(this._attrSelector('bind-class'));
            classBindingElements.forEach(el => {
                if (!isOwnedByThisComponent(el)) return;
                if (__FEATURE_QUERY__ && el._wfRecordQuery) return;   // reads the row; see the collection loop
                const expression = this._getAttr(el, 'bind-class');
                if (expression) {
                    this._validateObjectFormExpression(expression, stateKeys, componentName, state, 'data-bind-class');
                }
            });

            // Validate data-bind-style expressions
            const styleBindingElements = componentElement.querySelectorAll(this._attrSelector('bind-style'));
            styleBindingElements.forEach(el => {
                if (!isOwnedByThisComponent(el)) return;
                if (__FEATURE_QUERY__ && el._wfRecordQuery) return;   // reads the row; see the collection loop
                const expression = this._getAttr(el, 'bind-style');
                if (expression) {
                    this._validateObjectFormExpression(expression, stateKeys, componentName, state, 'data-bind-style');
                }
            });

            // Validate data-action method references. Unlike the value
            // bindings above, an action on a component's root is that
            // component's own handler (_bindComponentActions binds it there),
            // so the root's action is checked here and a child root's is left
            // to the child.
            const actionElements = componentElement.querySelectorAll(this._attrSelector('action'));
            const checkAction = (el) => {
                const actionAttr = this._getAttr(el, 'action');
                if (actionAttr) {
                    this._validateActionMethods(actionAttr, instance, componentName);
                }
            };
            if (this._hasAttr(componentElement, 'action')) checkAction(componentElement);
            actionElements.forEach(el => {
                if (!isOwnedByThisComponent(el)) return;
                if (this._hasAttr(el, 'component')) return;
                checkAction(el);
            });
        }
    },
    /**
     * Validate a single binding path against available state properties
     * @param {string} path - The binding path (e.g., "user.name", "count", "!isActive")
     * @param {Array<string>} stateKeys - Available state property names
     * @param {string} componentName - Name of the component for error messages
     * @param {string} bindingType - Type of binding (data-bind, data-model, etc.)
     * @private
     */
    _validateBindingPath(path, stateKeys, componentName, bindingType, state) {
        if (!__DEV__) return;
        // Skip validation for special paths
        if (!path || typeof path !== 'string') return;

        // Skip computed: prefixed paths (these are computed properties)
        if (path.startsWith('computed:')) return;

        // Skip props. prefixed paths (these resolve via component props, not state)
        if (path.startsWith('props.') || path.startsWith('props:')) return;

        // Skip external() expressions (cross-component references)
        if (path.includes('external(')) return;

        // Skip $entity.path shorthand (normalized to external() at bind time)
        if (path.includes('$')) return;

        // Parse type hint from path (e.g., "price:number" -> path="price", typeHint="number")
        let typeHint = null;
        let actualPath = path;
        const typeHintMatch = path.match(/^([^:]+):(\w+)$/);
        if (typeHintMatch) {
            actualPath = typeHintMatch[1];
            typeHint = typeHintMatch[2];
        }

        // If the path contains expression operators, it's not a simple property
        // reference: delegate to the expression-variable validator so each
        // identifier in the expression is checked individually. Without this,
        // `data-show="activePattern === 'intro'"` would be treated as a single
        // property name `"activePattern === 'intro'"` and always report
        // "undefined state property".
        // Valid simple-path characters: word chars, dots (nested), and leading `!`.
        // Anything else (spaces, `=`, `&`, `|`, `?`, `>`, `<`, `+`, `*`, `(`, etc.)
        // means the attribute holds an expression.
        if (!/^!?[\w.]+$/.test(actualPath)) {
            this._validateExpressionVariables(actualPath, stateKeys, componentName, bindingType);
            return;
        }

        // Skip list context variables
        const listContextVars = ['_index', '_length', '_first', '_last', '_item'];
        const cleanPath = actualPath.replace(/^!/, ''); // Remove negation prefix
        const pathParts = cleanPath.split('.');
        const rootVar = pathParts[0];

        if (listContextVars.includes(rootVar)) return;

        // Skip store-alias data-model paths ("storeName.field"): FormHandling
        // routes these writes to the named store's state, not this component's
        // (mirrored on the read side in _executeComponentBindingsForEffect),
        // so the root legitimately has no matching component state key. Scoped
        // to REGISTERED stores only — an unregistered root still warns, which
        // is what actually catches typos and genuine component-state mistakes.
        if (bindingType === 'data-model' && pathParts.length > 1
            && this.storeManager?.getStoreComponentByName(rootVar)) {
            return;
        }

        // Check if root property exists in state
        if (!stateKeys.includes(rootVar)) {
            // Find similar property names for typo suggestions
            const suggestions = this._findSimilarPropertyNames(rootVar, stateKeys);
            let message = `${bindingType}="${actualPath}" references undefined state property "${rootVar}" in component "${componentName}"`;

            if (suggestions.length > 0) {
                message += `. Did you mean: ${suggestions.join(', ')}?`;
            }

            message += ` Available properties: ${stateKeys.join(', ')}`;
            if (__DEV__) wfError(WF_ERRORS.BINDING_VALIDATION, { warn: true, context: message });
            return;
        }

        // Check nested path if state object is provided and path has multiple parts
        let finalValue = state ? state[rootVar] : undefined;
        if (state && pathParts.length > 1) {
            let currentObj = state[rootVar];
            for (let i = 1; i < pathParts.length; i++) {
                const part = pathParts[i];
                if (currentObj === null || currentObj === undefined) {
                    // Parent is null/undefined, can't validate further
                    finalValue = undefined;
                    break;
                }
                if (typeof currentObj !== 'object') {
                    // Parent is not an object, can't have nested properties
                    finalValue = undefined;
                    break;
                }
                if (!(part in currentObj)) {
                    // Nested property doesn't exist - find similar property names
                    const availableProps = Object.keys(currentObj);
                    const suggestions = this._findSimilarPropertyNames(part, availableProps);
                    const parentPath = pathParts.slice(0, i).join('.');
                    let message = `${bindingType}="${actualPath}" references undefined property "${part}" on "${parentPath}" in component "${componentName}"`;

                    if (suggestions.length > 0) {
                        message += `. Did you mean: ${suggestions.join(', ')}?`;
                    }

                    message += ` Available properties: ${availableProps.join(', ')}`;
                    if (__DEV__) wfError(WF_ERRORS.BINDING_VALIDATION, { warn: true, context: message });
                    return;
                }
                currentObj = currentObj[part];
                finalValue = currentObj;
            }
        }

        // Validate type hint against actual value
        if (typeHint && finalValue !== undefined) {
            const actualType = this._inferTypeFromValue(finalValue);
            if (actualType !== typeHint && actualType !== 'any') {
                if (__DEV__) wfError(WF_ERRORS.BINDING_VALIDATION, {
                    warn: true,
                    context: `Type hint mismatch in component "${componentName}": ` +
                        `${bindingType}="${path}" expects ${typeHint} but property "${actualPath}" has type ${actualType}. ` +
                        `Value: ${JSON.stringify(finalValue)}`
                });
            }
        }
    },
    /**
     * Validate variables in an expression (like data-bind-class expressions)
     * @param {string} expression - The expression to validate
     * @param {Array<string>} stateKeys - Available state property names
     * @param {string} componentName - Name of the component for error messages
     * @param {string} bindingType - Type of binding
     * @private
     */
    _validateExpressionVariables(expression, stateKeys, componentName, bindingType) {
        if (!__DEV__) return;
        // Skip $entity.path shorthand (normalized to external() at bind time)
        if (expression && expression.includes('$')) return;

        // Strip computed: prefix before validation; it's a runtime hint, not a variable
        const cleanExpression = expression.replace(/\bcomputed:/g, '');

        // Remove string literals before extracting identifiers; words inside
        // quotes ('priority-option high') are not variable references
        const noStrings = cleanExpression.replace(/'[^']*'|"[^"]*"/g, '');

        // Extract variable names: only ROOT identifiers, not property accesses.
        // `(?<!\.)` lookbehind excludes identifiers preceded by a dot so that
        // `events.length` produces `['events']` not `['events', 'length']`.
        // Without this, built-in props like .length/.includes/.toLowerCase()
        // appear as "undefined state property": noisy false positives.
        const propertyRegex = /(?<!\.)\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
        const matches = noStrings.match(propertyRegex);

        if (!matches) return;

        // Reserved words and keywords to skip
        const reserved = new Set([
            'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
            'if', 'else', 'return', 'typeof', 'instanceof', 'new', 'this',
            'external', 'Math', 'Date', 'String', 'Number', 'Boolean', 'Array', 'Object',
            'function', 'var', 'let', 'const', 'for', 'while',
            // List context variables
            '_index', '_length', '_first', '_last', '_item'
        ]);

        const checkedVars = new Set();

        for (const varName of matches) {
            // Skip reserved words, already checked vars, and string literals
            if (reserved.has(varName) || checkedVars.has(varName)) continue;
            checkedVars.add(varName);

            // Check if this variable exists in state
            if (!stateKeys.includes(varName)) {
                const suggestions = this._findSimilarPropertyNames(varName, stateKeys);
                let message = `${bindingType} expression "${expression}" references undefined state property "${varName}" in component "${componentName}"`;

                if (suggestions.length > 0) {
                    message += `. Did you mean: ${suggestions.join(', ')}?`;
                }

                message += ` Available properties: ${stateKeys.join(', ')}`;
                if (__DEV__) wfError(WF_ERRORS.BINDING_VALIDATION, { warn: true, context: message });
            }
        }
    },
    /**
     * Validate variables in an object-form-capable binding expression
     * (data-bind-style and data-bind-class). Object form is
     * { key: stateVar, ... } where the KEY is a CSS property or class NAME,
     * not a variable — only VALUE-side identifiers are validated. Unquoted
     * class keys ({ active: isTab1 }) previously hit the generic expression
     * validator and were flagged as undefined state properties (AI-surface
     * eval finding F3, 2026-07-16); quoted keys never tripped it because
     * string-stripping removes them first.
     * @param {string} expression - The expression (e.g., "{ color: textColor }")
     * @param {Array<string>} stateKeys - Available state property names
     * @param {string} componentName - Name of the component for error messages
     * @param {Object} state - The component state object
     * @param {string} bindingType - 'data-bind-style' or 'data-bind-class'
     * @private
     */
    _validateObjectFormExpression(expression, stateKeys, componentName, state, bindingType) {
        if (!__DEV__) return;
        const trimmed = expression.trim();

        // Object syntax: { key: stateVar, ... }
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const inner = trimmed.slice(1, -1).trim();
            if (!inner) return;

            // Split on commas (respecting nested structures)
            const pairs = inner.split(',');
            for (const pair of pairs) {
                const colonIdx = pair.indexOf(':');
                if (colonIdx === -1) continue;

                // Only validate the VALUE side (after the colon); the KEY side is a name
                const valuePart = pair.substring(colonIdx + 1).trim();
                if (!valuePart) continue;

                // The value might be a simple identifier or an expression
                this._validateExpressionVariables(valuePart, stateKeys, componentName, bindingType, state);
            }
            return;
        }

        // Non-object syntax: treat as expression (bare property name or expression)
        this._validateExpressionVariables(expression, stateKeys, componentName, bindingType, state);
    },
    /**
     * Validate action method references against available component methods
     * @param {string} actionAttr - The data-action attribute value (e.g., "click:save", "increment", "save('draft')")
     * @param {Object} instance - The component instance
     * @param {string} componentName - Name of the component for error messages
     * @private
     */
    _validateActionMethods(actionAttr, instance, componentName) {
        if (!__DEV__) return;
        // Parse action definitions using the framework's parser if available
        const actionDefs = typeof this._parseActions === 'function'
            ? this._parseActions(actionAttr)
            : this._parseActionDefsSimple(actionAttr);

        const context = instance.context;
        if (!context) return;

        // Collect available method names for suggestions
        const methodNames = Object.keys(context).filter(k => typeof context[k] === 'function');

        for (const { methodName } of actionDefs) {
            if (!methodName) continue;

            if (!getContextMethod(context, methodName)) {
                // $entity.path in data-action: the generic "undefined method"
                // message below sends the author hunting for a typo among their
                // own methods, when the real issue is that $ is a read accessor
                // for external state and doesn't name action handlers. Same
                // anchored shape as ExpressionEvaluator's STORE_SHORTHAND_REGEX.
                const dollar = /^\$([a-zA-Z_][a-zA-Z0-9_-]*)\.([a-zA-Z0-9_.]+)$/.exec(methodName);
                if (dollar) {
                    wfError(WF_ERRORS.ACTION_STORE_SHORTHAND, {
                        warn: true,
                        context: `data-action="${methodName}" in component "${componentName}". ` +
                            `$entity.path is a read accessor for external state and cannot name an action handler; ` +
                            `actions are methods on this component. To delegate to another entity's method, define one: ` +
                            // Wrapper named for the method being invoked (LAST path
                            // segment): $foo.util.bump -> bump() { ...util.bump(); }
                            `${dollar[2].split('.').pop()}() { this.getStore('${dollar[1]}').${dollar[2]}(); }`
                    });
                    continue;
                }
                const suggestions = this._findSimilarPropertyNames(methodName, methodNames);
                let message = `data-action references undefined method "${methodName}" in component "${componentName}"`;

                if (suggestions.length > 0) {
                    message += `. Did you mean: ${suggestions.join(', ')}?`;
                }

                message += ` Available methods: ${methodNames.join(', ')}`;
                if (__DEV__) wfError(WF_ERRORS.BINDING_VALIDATION, { warn: true, context: message });
            }
        }
    },
    /**
     * Simple fallback parser for action definitions when _parseActions is not available
     * @param {string} actionAttr - The data-action attribute value
     * @returns {Array<{eventType: string, methodName: string}>}
     * @private
     */
    _parseActionDefsSimple(actionAttr) {
        if (!__DEV__) return [];
        const results = [];
        const parts = actionAttr.trim().split(/\s+/);

        for (const part of parts) {
            let methodPart = part;
            const parenStart = part.indexOf('(');
            const colonIdx = part.indexOf(':');

            // Handle event:method format (colon before any parenthesis)
            if (colonIdx !== -1 && (parenStart === -1 || colonIdx < parenStart)) {
                methodPart = part.substring(colonIdx + 1);
            }

            // Strip argument list: method(args) -> method
            const parenIdx = methodPart.indexOf('(');
            if (parenIdx !== -1) {
                methodPart = methodPart.substring(0, parenIdx);
            }

            results.push({ eventType: 'click', methodName: methodPart });
        }

        return results;
    },
    /**
     * Find property names similar to the given name (for typo suggestions)
     * Uses Levenshtein distance for fuzzy matching
     * @param {string} name - The property name to find matches for
     * @param {Array<string>} candidates - Available property names
     * @returns {Array<string>} - Similar property names
     * @private
     */
    _findSimilarPropertyNames(name, candidates) {
        if (!__DEV__) return [];
        const maxDistance = Math.max(2, Math.floor(name.length / 3));
        const lowerName = name.toLowerCase();
        const similar = [];

        for (const candidate of candidates) {
            // Guard on the raw strings, NOT on distance > 0. Comparison is
            // case-insensitive, so a pure case slip ("selectedid" written for
            // "selectedId") scores 0 — excluding zero-distance matches dropped
            // the single most common typo class, leaving the WF-509 warning with
            // no suggestion at all on exactly the case the author can fix fastest.
            if (candidate === name) continue;
            const distance = this._levenshteinDistance(lowerName, candidate.toLowerCase());
            if (distance <= maxDistance) {
                similar.push({ candidate, distance });
            }
        }

        // Nearest first. Unsorted, candidates arrive in declaration order and the
        // 3-item cut can discard a distance-1 match in favour of a distance-3 one
        // that happened to be declared earlier. Sort is stable, so equal-distance
        // candidates keep declaration order.
        similar.sort((a, b) => a.distance - b.distance);
        return similar.slice(0, 3).map(entry => entry.candidate); // Top 3 suggestions
    },
    /**
     * Calculate Levenshtein distance between two strings
     * @param {string} a - First string
     * @param {string} b - Second string
     * @returns {number} - Edit distance
     * @private
     */
    _levenshteinDistance(a, b) {
        if (!__DEV__) return 0;
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = [];

        // Initialize matrix
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        // Fill matrix
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    },
    // ==========================================
    // Type inference
    // ==========================================

    /**
     * Infer types from initial state values
     * Creates a type map for all top-level state properties
     * @param {Object} state - The component's initial state object
     * @returns {Object} - Map of property names to inferred type strings
     * @private
     */
    _inferTypesFromState(state) {
        if (!__DEV__) return {};
        if (!state || typeof state !== 'object') {
            return {};
        }

        const types = {};

        for (const key of Object.keys(state)) {
            // A property that starts as '' is an empty field rather than a
            // declared string: a number input bound to it writes a Number.
            types[key] = state[key] === '' ? 'empty-field' : this._inferTypeFromValue(state[key]);
        }

        return types;
    },
    /**
     * Infer the type of a single value
     * @param {*} value - The value to infer the type of
     * @returns {string} - The inferred type ('string', 'number', 'boolean', 'array', 'object', 'function', 'any')
     * @private
     */
    _inferTypeFromValue(value) {
        if (!__DEV__) return 'any';
        if (value === null || value === undefined) {
            return 'any'; // Can't infer type from null/undefined
        }

        if (Array.isArray(value)) {
            return 'array';
        }

        const jsType = typeof value;

        switch (jsType) {
            case 'string':
                return 'string';
            case 'number':
                return 'number';
            case 'boolean':
                return 'boolean';
            case 'object':
                return 'object';
            case 'function':
                return 'function';
            default:
                return 'any';
        }
    },
    // ==========================================
    // Runtime type checking
    // ==========================================

    /**
     * Check if a value matches the expected type for a property
     * Emits a console warning if there's a type mismatch
     * @param {Object} component - The component instance
     * @param {string} prop - The property name being set
     * @param {*} value - The new value being assigned
     * @returns {boolean} - True if types match or no type defined, false if mismatch
     * @private
     */
    _checkTypeMatch(component, prop, value) {
        if (!__DEV__) return true;
        // Only check in debug mode
        if (!this.debug && !this.options?.debug) {
            return true;
        }

        // Get expected type from component's type map
        const expectedType = component?._types?.[prop];

        // No type defined or 'any' type - skip checking
        if (!expectedType || expectedType === 'any') {
            return true;
        }

        // An emptied number field: a type="number" input bound with data-model
        // writes '' (kept so validation can see the field is empty), which is
        // a legitimate value for a number property, not a mismatch.
        if (expectedType === 'number' && value === '') {
            return true;
        }
        // The mirror case: a field that started as '' (an empty field) takes
        // text or a number, whichever its input writes.
        if (expectedType === 'empty-field' && (typeof value === 'string' || typeof value === 'number')) {
            return true;
        }

        // Get actual type of the new value
        const actualType = this._inferTypeFromValue(value);

        // Check if types match
        if (actualType !== expectedType) {
            // Allow null/undefined for any type (they become 'any')
            if (actualType === 'any') {
                return true;
            }

            if (__DEV__) console.warn(
                `[WF] Type mismatch in component "${component.name}": ` +
                `Property "${prop}" expects ${expectedType === 'empty-field' ? 'string or number' : expectedType} but received ${actualType}. ` +
                `Value: ${JSON.stringify(value)}`
            );
            return false;
        }

        return true;
    },
    // #endregion FEATURE_BINDING_VALIDATION

    /**
     * WF-997: a binding inside a record-shape query subtree naming something
     * neither the row nor the component provides. Scope-merge makes almost
     * everything resolve, so what is left is a genuine authoring miss (a typo,
     * or a field the endpoint does not return) that renders empty in silence.
     *
     * Only runs once per element, only in dev, and only once a row exists, so
     * "still loading" is never mistaken for "misspelled". Precision matters
     * more than coverage here: firing on correct code is the WF-975/976 shape
     * this project ruled against. Identifiers preceded by a dot (member access
     * like .toLocaleDateString) and followed by a colon (object-literal keys
     * like {href: ...}) are skipped, string literals are stripped first, and
     * known globals are excluded. Anything ambiguous is left alone.
     * @private
     */
    _warnRecordFieldMisses(element, path, scopeState) {
        if (!path || typeof path !== 'string') return;
        // Strip string literals, then $name.path store shorthands. A shorthand
        // resolves through external() and names an entity, not a scope field,
        // so scanning it reports the query's own name as a missing field. Entity
        // names may contain hyphens, which would also split into fragments.
        const stripped = path
            .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')
            .replace(/\$[A-Za-z_][\w-]*(?:\.[\w.]+)*/g, '');
        const GLOBALS = this._recordDiagGlobals || (this._recordDiagGlobals = new Set([
            'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'typeof',
            'instanceof', 'new', 'this', 'in', 'void', 'delete',
            'Math', 'Date', 'String', 'Number', 'Boolean', 'Array', 'Object',
            'JSON', 'RegExp', 'Map', 'Set', 'Intl', 'parseInt', 'parseFloat',
            'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
            'external', 'computed'
        ]));
        const missing = [];
        const re = /(^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*(:?)/g;
        let m;
        while ((m = re.exec(stripped)) !== null) {
            const name = m[2];
            if (m[3] === ':') continue;            // object-literal key
            if (GLOBALS.has(name)) continue;
            if (name in scopeState) continue;
            if (missing.indexOf(name) === -1) missing.push(name);
        }
        if (missing.length === 0) return;
        wfError(WF_ERRORS.QUERY_RECORD_FIELD_MISSING, {
            warn: true,
            context: `Query "${element._wfRecordQuery}": the binding "${path}" names ${missing.map((n) => `"${n}"`).join(', ')}, which the row and the component both lack; it renders empty`,
            suggestion: 'Check the spelling against the row the endpoint returns. A field the server only sometimes sends needs a fallback in the expression'
        });
    },

    /**
     * WF-520, once per component and name: the tag and the component's root:
     * block both set an attribute, a style property or a directive. The tag's
     * is the one used.
     * @private
     */
    _warnRootConflict(instance, kind, name) {
        const seen = this._rootConflictWarned || (this._rootConflictWarned = new Set());
        const key = instance.name + '|' + kind + '|' + name;
        if (seen.has(key)) return;
        seen.add(key);
        wfError(WF_ERRORS.ROOT_BLOCK_CONFLICT, {
            warn: true,
            context: `Component '${instance.name}': the ${kind} "${name}" is set both on its tag and in its root: block; the tag's value is used`,
            suggestion: 'Set it in one place: on the tag for the markup around the component to control it, or in root: for the component itself'
        });
    },

    /**
     * WF-521: the bindings on a nested component's root are read by its owner
     * (_rootOwnerElement), so a name there that only the nested component has
     * reads nothing. Warns once per (component, attribute) when a name the
     * tag reads is the child's (state, computed, prop or method) and not the
     * owner's. A top-level root, an owner not registered yet (its bindings
     * are inert; _adoptPendingChildren checks again), and a root that a row,
     * pool or slot reads are skipped. Called as the child initializes, on
     * every init path, and when an owner adopts children that came first.
     * @private
     */
    _checkChildRootScope(instance) {
        const el = instance.element;
        if (!el || !this._carriesRootBindings(el)) return;
        const ownerEl = this._rootOwnerElement(el);
        const ownerId = ownerEl && ownerEl.dataset.componentId;
        const owner = ownerId && this.componentInstances.get(ownerId);
        if (!owner || !this._isOwnedBindingElement(el, ownerEl)) return;
        const pool = el.parentElement.closest(this._attrSelector('pool'));
        if (pool && ownerEl.contains(pool)) return;
        const warned = this._childRootScopeWarned || (this._childRootScopeWarned = new Set());
        let mine = null, theirs = null;
        for (const attr of _ROOT_BINDING_ATTRS) {
            const expr = this._getAttr(el, attr);
            if (!expr) continue;
            const key = instance.name + '|' + attr;
            if (warned.has(key)) continue;
            if (!mine) { mine = _scopeNameSet(instance); theirs = _scopeNameSet(owner); }
            const hit = _rootReadNames(expr).find(id => mine.has(id) && !theirs.has(id));
            if (!hit) continue;
            warned.add(key);
            const written = (el.hasAttribute('data-wf-' + attr) ? 'data-wf-' : 'data-') + attr;
            wfError(WF_ERRORS.ROOT_BINDING_CHILD_SCOPE, {
                warn: true,
                context: `${written}="${expr}" on the root of '${instance.name}' is read by '${owner.name}', the component around it, which has no '${hit}'; '${hit}' belongs to '${instance.name}'`,
                suggestion: `Move the binding onto an element inside '${instance.name}', or declare its side of its root in its definition: root: { style: { background: '${hit}' } } (class, attr, show and directives likewise)`
            });
        }
    },
};

/** The value bindings a nested component's root carries for its owner (WF-521). */
const _ROOT_BINDING_ATTRS = ['show', 'render', 'bind', 'bind-html', 'bind-class', 'bind-style', 'bind-attr', 'model'];

/** Every name a component's own scope answers to: state, computed, props, methods (WF-521). */
function _scopeNameSet(instance) {
    const names = new Set(Object.keys(instance.state || {}));
    const computed = instance.stateManager && instance.stateManager.computed;
    if (computed) for (const k of Object.keys(computed)) names.add(k);
    const def = instance.definition || {};
    const props = def.props;
    if (Array.isArray(props)) for (const k of props) names.add(k);
    else if (props && typeof props === 'object') for (const k of Object.keys(props)) names.add(k);
    for (const k of Object.keys(def)) if (typeof def[k] === 'function') names.add(k);
    return names;
}

/**
 * The names an expression reads from its scope (WF-521): not the words in a
 * string literal, not a member after a dot (cfg.bg), not a $store path, and
 * not an object-literal key ({ background: bg } reads bg only).
 */
const _ID_RE = /[A-Za-z_$][\w$]*/g;
const _STRING_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
function _rootReadNames(expr) {
    const src = expr.replace(_STRING_RE, "''");
    const out = [];
    for (const m of src.matchAll(_ID_RE)) {
        const id = m[0];
        if (id[0] === '$' || /\d/.test(src[m.index - 1] || '')) continue;   // a store path, or a number's tail (1e5)
        let i = m.index - 1;
        while (i >= 0 && /\s/.test(src[i])) i--;
        const before = i >= 0 ? src[i] : '';
        if (before === '.') continue;   // a member: cfg.bg
        let j = m.index + id.length;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] === ':' && (before === '{' || before === ',' || before === '')) continue;   // an object key
        out.push(id);
    }
    return out;
}

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const RenderingCoreMethods = {
    ...(__DEV__ ? RenderingCoreDevMethods : {}),
    // -------------------------------------------------------------------------
    // Conditional subsystem (data-show / data-render) + external() resolver.
    // Relocated here from ListRenderer so they ship in the nano tier: data-show
    // and data-render are core widget features, and external() is a general
    // cross-store binding — none are list-bound. The runtime executors
    // (_executeShowForEffect / _executeRenderForEffect / _buildRenderMeta) and
    // the render record (_updateConditionalElement) already live in nano-shipped
    // modules, so this makes the whole conditional path list-independent.
    // -------------------------------------------------------------------------
    // _insideHiddenRender (lists, and QuerySystem in full) lives in ListSharedMethods.

    /**
     * Mark the render-effect metadata of every binding inside `root`, a
     * subtree a data-render just removed, so the effect skips them until
     * insertion re-creates it with fresh metadata. Covers the init-time
     * removal (metadata still in instance._effectMeta) and a mid-life one
     * (the live array the effect iterates, instance._renderMeta). Render
     * metadata is left alone: its placeholder must keep evaluating.
     * @param {Object} instance - Component instance
     * @param {HTMLElement} root - The removed subtree's root
     * @private
     */
    _markHiddenRenderMetas(instance, root) {
        if (!instance || !root) return;
        // The root itself is marked too, for list mounting: a list entry
        // collected before this removal must not mount into the removed
        // subtree (ListRenderer.mountList), while a list detached by hand
        // carries no mark and mounts as it always did.
        root._wfRenderHidden = true;
        this._hideMetas(instance, (meta) => {
            if (meta.type === 'render') {
                // The removed section's OWN record stays live: its
                // placeholder is what brings the section back. A nested
                // section's record (element or placeholder inside the
                // removed subtree) is re-created at insertion; until then
                // evaluating it would only move nodes nobody sees and touch
                // any query its condition names.
                const ctx = meta.context;
                const node = ctx && (ctx.element || ctx.placeholder);
                return !!node && node !== root && root.contains(node);
            }
            return !!meta.element && (root === meta.element || root.contains(meta.element));
        });
    },

    /**
     * Mark the render-effect entries `test` picks, in both the pending list
     * (instance._effectMeta) and the live one the effect iterates
     * (instance._renderMeta), so the effect skips them. Nothing is removed
     * here, since an effect run may be iterating the list.
     * @returns {boolean} Whether any entry was marked
     * @private
     */
    _hideMetas(instance, test) {
        let found = false;
        for (const metas of [instance._effectMeta, instance._renderMeta]) {
            if (metas) for (const meta of metas) if (!meta._hidden && test(meta)) found = meta._hidden = true;
        }
        return found;
    },

    /**
     * Process conditional elements (data-show and data-render)
     * @param {Object} instance - Component instance
     * @private
     */
    _processConditionalElements(instance)
    {
        if (!this._contextSystemInitialized) {
            return;
        }

        const {element} = instance;

        // Find all conditional elements (both data-show and data-render) - support both prefixes
        // IMPORTANT: Exclude elements inside <template> elements (they belong to list templates)
        // and elements inside data-list containers (they're handled by _bindListItemConditionals)
        const allConditionalElements = Array.from(element.querySelectorAll(`${this._attrSelector('show')}, ${this._attrSelector('render')}`));
        // A top-level root's own data-show reads this component: nothing
        // around it wrote the tag. (Its data-render is not a section, since a
        // component cannot take its own root out of the page; see the mode
        // choice below.)
        if (this._hasAttr(element, 'show') && this._isUnownedRoot(element)) {
            allConditionalElements.unshift(element);
        }

        const conditionalElements = allConditionalElements
            .filter(el =>
            {
                // This component's own elements, and the roots of the
                // components directly inside it, whose tags it wrote. Also
                // excludes elements inside a nested component (registered or
                // not), a <template>, or data-use-template content.
                if (!this._isOwnedBindingElement(el, element)) {
                    return false;
                }

                // Exclude elements INSIDE data-list containers (handled by list item binding)
                // But DO process the list container itself if it has data-show.
                // A list element is its own closest list, so for one the
                // question is asked of its parent: a top-level container has
                // no list above it and is processed here; a row whose root is
                // itself a nested list (<tr data-list="cells">), or a nested
                // container inside a row, belongs to the row. This runs again
                // with rendered rows present on a template-key swap.
                const closestList = el.closest(this._attrSelector('list'));
                const owningList = closestList === el
                    ? (el.parentElement ? el.parentElement.closest(this._attrSelector('list')) : null)
                    : closestList;
                if (owningList && owningList.closest(this._attrSelector('component')) === element) {
                    return false;
                }

                return true;
            });

        conditionalElements.forEach(conditionalElement =>
        {
            // Document order puts an outer data-render before the conditionals
            // inside it. Once that outer section evaluated false and was
            // removed, its inner conditionals are detached: registering them
            // would have the render effect evaluate them on every run (and
            // touch any query they name) for a section nobody sees, and
            // insertion re-creates them from the section's clone anyway.
            if (!conditionalElement.isConnected) return;
            // Determine mode: 'show' or 'render' (support both prefixes). The
            // component's own root is only ever here for its data-show.
            const isRenderMode = conditionalElement !== element && this._hasAttr(conditionalElement, 'render');
            const condPath = isRenderMode
                ? this._getAttr(conditionalElement, 'render')
                : this._getAttr(conditionalElement, 'show');
            if (!condPath) return;

            // For data-render, we need to handle initial state
            if (isRenderMode) {
                const renderCtx = this._processDataRenderElement(conditionalElement, condPath, instance);
                // Drive non-list data-render through the component render effect:
                // track the context so a post-insert effect rescan can re-add it,
                // and push its render meta so the effect observes the condition's
                // computed/state directly (establishing the graph edge).
                if (renderCtx && instance._effectMeta) {
                    (instance._renderContexts || (instance._renderContexts = [])).push(renderCtx);
                    instance._effectMeta.push(this._buildRenderMeta(renderCtx, instance));
                }
            } else {
                // data-show: no registry-tracked conditional context. The component
                // render effect owns initial paint and every update via this 'show'
                // meta (_executeShowForEffect → applyShow, transitions included); the
                // setup-time context paint was a redundant parallel build.
                if (instance._effectMeta) {
                    const parsed = this._parseConditionPath(condPath);
                    instance._effectMeta.push({
                        element: conditionalElement,
                        type: 'show',
                        path: parsed.path,
                        negate: parsed.negate,
                        isExpression: parsed.isExpression
                    });
                }
            }
        });
    },
    /**
     * Process a data-render element - handles initial state and context creation
     * @param {HTMLElement} element - The element with data-render
     * @param {string} path - The condition path
     * @param {Object} instance - Component instance
     * @private
     */
    _processDataRenderElement(element, path, instance)
    {
        // Evaluate the initial condition
        let conditionValue = this._evaluateCondition(path, instance);

        // Clone the element as template before any DOM manipulation
        const templateClone = element.cloneNode(true);
        // Strip data-cloak from template so re-insertions don't inherit it
        templateClone.removeAttribute('data-cloak');
        templateClone.removeAttribute('data-wf-cloak');
        // And the ids of components already initialized in the section (a
        // component registered before the one that owns the section): an
        // insertion is a new generation, and an id whose instance has not
        // been collected yet would make the scan skip the copy for good.
        templateClone.removeAttribute('data-component-id');
        templateClone.querySelectorAll('[data-component-id]').forEach(el => el.removeAttribute('data-component-id'));

        // Create the render record (plain object, not registered; the render
        // effect holds it directly via its type:'render' meta).
        const context = this._contextRecords.createRenderRecord(
            path,
            instance,
            element
        );

        if (context) {
            // Add render-specific properties
            context.templateClone = templateClone;
            context.isRendered = conditionValue;

            // If condition is initially false, remove element and insert placeholder
            if (!conditionValue) {
                const placeholder = document.createComment(` data-render: ${path} `);
                context.placeholder = placeholder;
                element.parentNode.insertBefore(placeholder, element);
                element.parentNode.removeChild(element);
                context.element = null; // Element is not in DOM
                this._markHiddenRenderMetas(instance, element);
            } else {
                context.placeholder = null; // No placeholder needed when rendered
            }
        }

        return context;
    },
    /**
     * Parse a data-show / data-render condition into the shape every
     * evaluator shares: the obsolete `computed:` prefix stripped, a leading
     * `!` lifted into a negate flag for a single simple term only, and the
     * expression / simple-path split. For a compound expression the `!`
     * stays in the text: stripping it would negate the WHOLE expression
     * ("!a && b" is not "!(a && b)").
     * @param {string} condition
     * @returns {{path: string, negate: boolean, isExpression: boolean}}
     * @private
     */
    _parseConditionPath(condition) {
        let expr = condition;
        if (expr.startsWith('computed:!')) expr = '!' + expr.slice(10);
        else if (expr.startsWith('computed:')) expr = expr.slice(9);
        const negate = expr.startsWith('!') && /^[\w.$:]+$/.test(expr.slice(1));
        const path = negate ? expr.slice(1) : expr;
        return { path, negate, isExpression: this.isExpression(path) || path.includes('$') };
    },

    /**
     * The one verdict for a data-show / data-render condition read outside
     * the effect: the same read the component render effect performs
     * (_buildRenderMeta + _resolveEffectExpression, or getValue for a simple
     * path), so an initial verdict, a hidden-section check, a scanner skip,
     * a cloak strip and a portal condition all agree with the effect that
     * drives the element afterwards. There used to be a second evaluator
     * here with no external(); it answered false to every $store expression,
     * so a $route-gated section that was true at init was removed and then
     * re-inserted as a clone by the effect, and a slot template inside it was
     * skipped for good.
     * @param {string} condition
     * @param {Object} instance - Component instance
     * @param {HTMLElement} [element] - The conditional element (record-query scope)
     * @returns {boolean}
     * @private
     */
    _conditionVerdict(condition, instance, element) {
        const { path, negate, isExpression } = this._parseConditionPath(condition);
        // A bare path on a record-marked element reads the row, as in the effect.
        const rowScoped = !!(__FEATURE_QUERY__ && element && element._wfRecordQuery);
        let value;
        try {
            value = (isExpression || rowScoped)
                ? this._resolveEffectExpression(path, instance, element)
                : instance.stateManager.getValue(path);
        } catch (error) {
            value = undefined;
        }
        return negate ? !value : !!value;
    },

    /**
     * Evaluate a condition path for data-show/data-render
     * @param {string} path - The condition path (may include negation, computed:)
     * @param {Object} instance - Component instance
     * @returns {boolean} The evaluated condition
     * @private
     */
    _evaluateCondition(path, instance)
    {
        return this._conditionVerdict(path, instance);
    },
    /**
     * Get the external() function bound to a component instance
     * @private
     */
    _getExternalFn(componentInstance) {
        if (componentInstance.context && typeof componentInstance.context.external === 'function') {
            return componentInstance.context.external.bind(componentInstance.context);
        }
        const self = this;
        const instanceId = componentInstance.id;
        return function(componentNameOrId, path) {
            return self._resolveExternalValue(componentNameOrId, path, instanceId);
        };
    },
    /**
     * Dev-mode once-per-(type, element) warning when data-bind-style/-attr gets a
     * non-object value (e.g. a CSS string). Shared by the setup-write path
     * (_applyObjectBinding) and the component render effect
     * (_executeStyleBindForEffect/_executeAttrBindForEffect) so the warning fires
     * exactly once regardless of which writer paints, without a per-binding
     * context. No-op in production (__DEV__ folds). Relocated from ListExpressionEval
     * so the core style/attr effect path stays list-independent (nano tier).
     * @private
     */
    _warnObjectBindingShape(type, element, value) {
        if (!__DEV__) return;
        // The shape mismatch is almost always a CSS-string passed to
        // data-bind-style ('background:red' instead of {background:'red'});
        // silently skipping it leaves the user wondering why colors never apply.
        this._warnedBindingShape = this._warnedBindingShape || new WeakMap();
        let perEl = this._warnedBindingShape.get(element);
        if (!perEl) { perEl = new Set(); this._warnedBindingShape.set(element, perEl); }
        if (perEl.has(type)) return;
        perEl.add(type);
        const example = type === 'style'
            ? "{ background: '#5b8def' } or { backgroundColor: '#5b8def' }"
            : "{ 'data-id': item.id, title: item.label }";
        const sample = String(value).slice(0, 60);
        const tag = element.tagName ? element.tagName.toLowerCase() : 'element';
        const cls = element.className && typeof element.className === 'string'
            ? '.' + element.className.split(/\s+/)[0] : '';
        console.warn(
            `[WildflowerJS] data-bind-${type} expected an object, got ${typeof value} ("${sample}").\n` +
            `  Element: <${tag}${cls}>\n` +
            `  Use object form: ${example}\n` +
            `  CSS strings like "background:red" silently no-op.`
        );
    },
    /**
     * Check if an attribute name is blocklisted for security or framework integrity.
     * Relocated from ListExpressionEval so data-bind-attr sanitization ships in nano.
     * @param {string} attrName - Attribute name to check
     * @returns {boolean} True if blocklisted
     * @private
     */
    _isBlocklistedAttr(attrName) {
        const lower = attrName.toLowerCase();

        // Block event handlers (XSS prevention)
        if (lower.startsWith('on')) return true;

        // Block framework directives, class/style, srcdoc (O(1) Set lookup)
        return _LIST_BLOCKED_ATTRS.has(lower);
    },
    /**
     * Sanitize attribute value for security (dangerous protocols / data: URIs in
     * URL-bearing attributes). Relocated from ListExpressionEval for the nano tier.
     * @param {string} attrName - Attribute name
     * @param {*} value - Value to sanitize
     * @returns {*} Sanitized value or null if blocked
     * @private
     */
    _sanitizeAttrValue(attrName, value) {
        if (value === null || value === undefined) return value;

        const lower = attrName.toLowerCase();

        // For URL-bearing attributes, normalize and check dangerous protocols
        if (['href', 'src', 'formaction', 'action', 'poster', 'xlink:href'].includes(lower)) {
            // Strip all whitespace and control characters before protocol check
            // to prevent bypasses like "java\tscript:" or "java\nscript:"
            const normalized = String(value).replace(/[\s\x00-\x1F\x7F]/g, '').toLowerCase();

            if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) {
                if (__DEV__) wfError(WF_ERRORS.SEC_BLOCKED, { warn: true, context: `Blocked dangerous protocol in ${attrName}` });
                return null;
            }

            // Block all data: URIs in URL attributes EXCEPT raster image formats.
            // data:image/svg+xml and data:image/xml can execute inline scripts
            // when loaded via <object>/<iframe>/<embed>, so they are NOT allowed.
            if (/^data:(?!image\/(png|jpe?g|gif|webp|avif|bmp|ico|tiff?|x-icon)[,;])/i.test(normalized)) {
                if (__DEV__) wfError(WF_ERRORS.SEC_BLOCKED, { warn: true, context: `Blocked dangerous data: URI in ${attrName}` });
                return null;
            }
        }

        return value;
    },
/**
     * Schedule a render to update the UI
     * @private
     */

    _scheduleRender()
    {
        // Skip scheduling if renders are suppressed during batching
        if (this._suppressRender && !this._ensureRender) {
            return;
        }

        this._ensureRender = false;

        const now = Date.now();
        if (this._lastRenderScheduled && (now - this._lastRenderScheduled < 20)) {
            // Only throttle if there's actually a pending render that will pick up changes.
            // If no pending render, we MUST schedule one even within the throttle window
            if (this._renderScheduled) {
                return;
            }
            // No pending render - fall through to schedule one
        }

        this._lastRenderScheduled = now;

        // Render dedup is handled by the `_renderScheduled` boolean flag: the
        // queued microtask below early-returns when it has been cleared, and a
        // repeat schedule within the same turn just re-folds pending changes. No
        // rAF handle is involved (the old cancelAnimationFrame(this._renderScheduled)
        // here was dead: the flag is a boolean, and cancelAnimationFrame coerces
        // it to handle 1, risking cancellation of an unrelated frame).

        // No per-change component sweep here. The former
        // _componentMightBeAffected walk (every component's state keys through
        // the facade's ownKeys/has traps, on every state change) only fed
        // _batchChangedComponents, which _render merged into a set nothing
        // consumed once effects took over DOM updates. Batch mode still fills
        // _batchChangedComponents itself (applyBatch) for _applyBatchToLists.

        // Schedule a new render. EXPERIMENT: microtask instead of rAF so the
        // commit isn't gated behind a fireAnimationFrame (j-f-b penalty). Under
        // ReactiveGraph the DOM is mutated by graph effects (also microtasks);
        // _render is bookkeeping that just needs to run after them.
        this._renderScheduled = true;
        queueMicrotask(() =>
        {
            if (!this._renderScheduled) return;
            const __tlT0 = (__DEV__ && __tlOn) ? performance.now() : 0;

            // Call the render
            this._render();

            // Clear scheduled flag
            this._renderScheduled = null;

            if (__DEV__ && __tlOn) __tlFrame(performance.now() - __tlT0);
        });

    },
    /**
     * Render all components
     * @private
     */


    _render()
    {
        // SSR-hydrated lists are not mapArray-backed; their context-driven
        // re-renders run through this collect/sweep pair, which lives in
        // ssr-list.js and drops out of the 12 non-SSR variants. Collection
        // happens BEFORE deferred dependencies (matching the historical
        // ordering); the sweep runs after.
        const ssrListContexts = (__FEATURE_SSR__ && __FEATURE_LISTS__) ? this._ssrCollectListContexts() : null;

        if (this._contextSystemInitialized && this._deferredDependencies && this._deferredDependencies.length > 0)
        {
            this._processDeferredDependencies();
        }

        if (__FEATURE_SSR__ && ssrListContexts)
        {
            this._ssrSweepListContexts(ssrListContexts);
        }

        // Clear update tracking after processing both types
        if (this._contextsToUpdate) {
            this._contextsToUpdate.clear();
        }

        //FOCUS PRESERVATION - Capture active element state before rendering
        const activeElement = document.activeElement;
        let activeInfo = null;
        const activeModelPath = __FEATURE_LISTS__ && activeElement &&
            (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')
            ? this._getAttr(activeElement, 'model') : null;

        // Check if the active element is an input in a list item
        if (activeModelPath)
        {

            const listItemElement = this._findListItemAncestor(activeElement);
            if (listItemElement)
            {
                const listElement = this._findRowList(listItemElement);
                if (listElement)
                {
                    activeInfo = {
                        modelPath: activeModelPath,
                        listPath: this._getAttr(listElement, 'list'),
                        itemIndex: listItemElement._listIndex,
                        listElement: listElement,
                        componentId: this._getComponentId(listElement),
                        value: activeElement.value,
                        selectionStart: activeElement.selectionStart !== undefined ? activeElement.selectionStart : null,
                        selectionEnd: activeElement.selectionEnd !== undefined ? activeElement.selectionEnd : null
                    };
                }
            }
        }


        // The component queues (_componentsToUpdate, _batchChangedComponents,
        // _pendingDependentUpdates) are no longer merged into a processing set
        // here: bindings, lists and conditionals are effect-driven, so the
        // merged set had no consumer. _componentsToUpdate is reset below and
        // _pendingDependentUpdates is drained for computed re-evaluation.

        if (!this._renderCounter) this._renderCounter = 0;
        ++this._renderCounter;

        if (this._pendingDependentUpdates && this._pendingDependentUpdates.size > 0)
        {
            this._pendingDependentUpdates.forEach(componentId =>
            {
                const instance = this.componentInstances.get(componentId);
                if (instance && instance.stateManager &&
                    instance.stateManager.computed && Object.keys(instance.stateManager.computed).length > 0)
                {
                    // Re-evaluate computed properties
                    Object.keys(instance.stateManager.computed).forEach(propName =>
                    {
                        // Clear cache for this property
                        instance.stateManager.computedCache.delete(propName);
                        // Force re-evaluation
                        try
                        {
                            instance.stateManager.evaluateComputed(propName);
                        } catch (error)
                        {
                            if (__DEV__) console.error(`Error re-evaluating ${propName}:`, error);
                        }
                    });
                }
            });
        }

        // Bindings/HTML/class/models are handled by effects. List bootstrap is
        // handled at discovery time (_mountLists at every scan/reveal path), so
        // the render cycle no longer sweeps domElements.lists.
        // List-item data-show/data-render conditionals are resolved natively: the
        // per-item effect handles data-driven changes, and the list reconcile's
        // onComplete re-evaluates position-frame conditionals (literal _last via
        // _updateListContextClassBindings, item-level computeds via
        // _reEvalListItemComputedConditionals). No component-level sweep needed.

        // Mark components that were actually rendered in this cycle as having been rendered
        // CRITICAL: Only mark components whose lists were actually processed, not just queued for update
        // This happens after ALL update methods (bindings, lists, conditionals, models) have completed
        if (this._actuallyRenderedComponents && this._actuallyRenderedComponents.size > 0)
        {
            this._actuallyRenderedComponents.forEach(componentId =>
            {
                const instance = this.componentInstances.get(componentId);
                if (instance && instance._hasRendered === false)
                {
                    instance._hasRendered = true;
                }
            });

            // Clear the tracking set for the next render cycle
            this._actuallyRenderedComponents.clear();
        }


        // Use new Set() to reset completely
        this._componentsToUpdate = new Set();

        if (activeInfo && activeInfo.componentId)
        {
            // Cancel any previous focus restoration timer to prevent cursor jumps on rapid re-renders
            if (this._focusRestorationTimer) {
                clearTimeout(this._focusRestorationTimer);
            }
            // Use setTimeout to ensure DOM is fully updated
            this._focusRestorationTimer = setTimeout(() =>
            {
                this._focusRestorationTimer = null;
                const componentElement = document.querySelector(`[data-component-id="${activeInfo.componentId}"]`);
                if (componentElement)
                {
                    // Find the specific list element and only search its direct children
                    const listElement = activeInfo.listElement.isConnected
                        ? activeInfo.listElement
                        : componentElement.querySelector(this._attrSelector('list', activeInfo.listPath));

                    if (!listElement) return;

                    // Only get direct children that are list items
                    const listItems = this._getListItems(listElement);

                    // Find the list item with matching index
                    for (const item of listItems)
                    {
                        if (item._listIndex === activeInfo.itemIndex)
                        {
                            // Find the input with matching model path
                            const input = item.querySelector(this._attrSelector('model', activeInfo.modelPath));
                            if (input)
                            {
                                // Restore focus
                                input.focus();

                                // Restore cursor position if applicable
                                if (activeInfo.selectionStart !== null &&
                                    input.setSelectionRange)
                                {
                                    try
                                    {
                                        input.setSelectionRange(
                                            activeInfo.selectionStart,
                                            activeInfo.selectionEnd
                                        );
                                    } catch (e)
                                    {
                                        // Ignore selection errors (can happen on non-text inputs)
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }, 0);
        }


        // Clean up batch tracking after render completes
        if (this._batchChangedComponents)
        {
            this._batchChangedComponents = null;
            this._batchChangedPaths = null;
        }

        //Clean up the pendingDependentUpdates too
        if (this._pendingDependentUpdates)
        {
            this._pendingDependentUpdates.clear();
        }

        // _componentsToUpdate is pre-initialized in the constructor for V8 hidden class stability



    },
    /**
     * Process binding elements and create binding contexts
     * @param {Object} instance - Component instance
     * @private
     */
    _processBindingElements(instance)
    {
        if (!this._contextSystemInitialized) return;

        const {element, id: instanceId} = instance;

        // Find all binding elements directly in this component (including component root)
        const bindingElements = this._querySelfAndDescendants(element, this._attrSelector('bind'))
            .filter(el =>
            {
                // Skip elements that have been bound by a list (prevent component from overwriting)
                if (listBoundElements.has(el)) {
                    return false;
                }
                // Skip elements inside list containers (they're list item bindings, not component bindings).
                // BOTH halves must be prefix-aware. The list half always was; the component half read
                // bare `[data-component]` only, so on a data-wf-* page it resolved to null, the row was
                // never skipped, and the component effect claimed the row's own binding. It then wrote
                // the row's path in COMPONENT scope, where the field does not exist, and __wf_txt set
                // the existing text node's .data to '' in place. Invisible on a list rendered from
                // state (the renderer repaints the correct value straight after) and fatal on rows that
                // arrived pre-rendered, where the emptied text IS the content: the server's own markup.
                let listAncestor = el.closest(this._attrSelector('list'));
                // A select whose options are a list is its own nearest list,
                // but its data-bind is its value, not a row's binding: it
                // belongs to whatever the select itself sits in. (Skipped as
                // "inside a list", it was never bound at all.)
                if (listAncestor === el && el.tagName === 'SELECT') {
                    listAncestor = el.parentElement ? el.parentElement.closest(this._attrSelector('list')) : null;
                }
                if (listAncestor && listAncestor.closest(this._attrSelector('component')) === element) {
                    return false;
                }
                // Skip slot template bindings (handled by slot template system)
                if (el.closest('[data-use-template-rendered]')) {
                    return false;
                }
                // This component's own elements, and the roots of the
                // components directly inside it (_isOwnedBindingElement).
                return this._isOwnedBindingElement(el, element);
            });


        bindingElements.forEach(bindingElement =>
        {
            const bindPath = this._getAttr(bindingElement, 'bind');
            if (!bindPath) return;

            // Non-list text data-bind no longer creates a per-binding context:
            // the render effect owns paint + updates via the meta below.
            // These elements are pre-filtered to non-list, so there is nothing else
            // for a context to do here.

            if (instance._effectMeta) {
                const needsExprEval = this.isExpression(bindPath) || bindPath.includes('$');
                const entry = {
                    element: bindingElement,
                    type: 'bind',
                    path: bindPath,
                    isInput: bindingElement.tagName === 'INPUT' || bindingElement.tagName === 'TEXTAREA' || bindingElement.tagName === 'SELECT',
                    isExpression: needsExprEval
                };
                if (bindingElement.tagName.includes('-')) entry.isWebComponent = true;
                instance._effectMeta.push(entry);
            }
        });
    },
    /**
     * Create a binding context for an element, handling list vs non-list branching.
     * Returns { context, inList, itemIndex, listItem, listElement } or null if in list but no valid context.
     * @private
     */
    _createListAwareBindingContext(bindingElement, bindPath, instance) {
        const listItem = __FEATURE_LISTS__ ? this._findListItemAncestor(bindingElement) : null;

        if (listItem) {
            const listElement = this._findRowList(listItem);
            if (listElement && listElement._listContext) {
                const itemIndex = listItem._listIndex;
                // In-list per-binding CM context removed (probe: 0 hits; in-list
                // binding elements are filtered by _isOwnedBindingElement before
                // reaching here, so this branch never created a context). Callers
                // guard on a null context and push effect-meta off the inList shape.
                return { context: null, inList: true, itemIndex, listItem, listElement };
            }
            return null;
        }

        // Non-list binding types ride the component render effect; no per-binding
        // CM context is created (it would only carry a redundant one-shot setup
        // write). Callers push effect-meta on the inList=false shape.
        return { context: null, inList: false, itemIndex: 0, listItem: null, listElement: null };
    },
    /**
     * Process HTML binding elements
     * @private
     */
    _processHTMLBindingElements(instance)
    {
        if (!this._contextSystemInitialized) return;

        const {element} = instance;
        const htmlBindingElements = this._querySelfAndDescendants(element, this._attrSelector('bind-html'))
            .filter(el => this._isOwnedBindingElement(el, element));

        const markHtmlReady = (bindPath) => {
            if (instance._htmlContextsReady) {
                const propertyName = bindPath.startsWith('computed:') ? bindPath.slice(9) : bindPath;
                instance._htmlContextsReady.add(propertyName);
                if (instance.stateManager && typeof instance.stateManager._processHtmlInitialQueue === 'function') {
                    instance.stateManager._processHtmlInitialQueue();
                }
            }
        };

        htmlBindingElements.forEach(bindingElement => {
            const bindPath = this._getAttr(bindingElement, 'bind-html');
            if (!bindPath) return;

            const result = this._createListAwareBindingContext(bindingElement, bindPath, instance);
            if (!result) return;

            // The render effect owns the HTML write; mark readiness so any queued
            // initial HTML flushes. Called regardless of whether a per-binding
            // context exists; non-list bind-html no longer creates one.
            markHtmlReady(bindPath);

            if (instance._effectMeta) {
                instance._effectMeta.push({
                    element: bindingElement,
                    type: 'html',
                    path: bindPath,
                    isExpression: this.isExpression(bindPath) || bindPath.includes('$')
                });
            }
        });
    },
    /**
     * Process class binding elements
     * @private
     */
    _processClassBindingElements(instance)
    {
        if (!this._contextSystemInitialized) return;

        const {element} = instance;
        const classBindingElements = this._querySelfAndDescendants(element, this._attrSelector('bind-class'))
            .filter(el => this._isOwnedBindingElement(el, element));

        classBindingElements.forEach(bindingElement => {
            const bindPath = this._getAttr(bindingElement, 'bind-class');
            if (!bindPath) return;

            const result = this._createListAwareBindingContext(bindingElement, bindPath, instance);
            if (!result) return;

            // Initial class paint is owned by the render effect (non-list) and the
            // list-row machinery (in-list); no per-binding context paint here.

            // See the matching guard in _processObjectBindingElements for the
            // rationale: don't register a component-level effect for in-list
            // elements, or the list-row machinery and the component effect
            // race to write competing values to the same chip.
            if (instance._effectMeta && !result.inList) {
                instance._effectMeta.push({
                    element: bindingElement,
                    type: 'class',
                    path: bindPath,
                    prevClasses: null,
                    isExpression: this.isExpression(bindPath) || bindPath.includes('$')
                });
            }
        });
    },
    /**
     * Unified processor for object binding elements (data-bind-style, data-bind-attr)
     * @private
     */
    _processObjectBindingElements(type, instance)
    {
        if (!this._contextSystemInitialized) return;

        const config = {
            style: { attrName: 'bind-style' },
            attr: { attrName: 'bind-attr' }
        };

        const cfg = config[type];
        if (!cfg) return;

        const {element} = instance;
        const bindingElements = this._querySelfAndDescendants(element, this._attrSelector(cfg.attrName))
            .filter(el => this._isOwnedBindingElement(el, element));

        bindingElements.forEach(bindingElement => {
            const expr = this._getAttr(bindingElement, cfg.attrName);
            if (!expr) return;

            const result = this._createListAwareBindingContext(bindingElement, expr, instance);
            if (!result) return;

            const { inList } = result;

            // Only register a component-level effect for elements that are NOT
            // inside a data-list. List-row elements are updated by the list-row
            // machinery (PropsSystem._refreshListItemBindings + the binding
            // path through ListExpressionEval._processObjectBinding, which
            // resolves item[expr] first per the documented contract). Pushing
            // a component-effect meta for an in-list element causes a second
            // writer (the component-level computed of the same name) to race
            // the list-row writer; initial render usually shows the
            // component-computed value (race winner) and the list-row's per-row
            // field is silently shadowed. Surfaced on a team page where
            // project chips bound to data-bind-style="iconStyle"
            // rendered the parent team's color most of the time, alternating
            // with the project's own color on reload (intermittent in both
            // Chrome and Firefox). Sibling guard: see the listBoundElements check on
            // data-bind text in _processComponentBindingsFromCompiled; text
            // binds already had this guard; style/attr did not.
            if (instance._effectMeta && !inList) {
                instance._effectMeta.push({
                    element: bindingElement,
                    type: type,
                    path: expr,
                    isExpression: this.isExpression(expr) || expr.includes('$')
                });
            }
        });
    },
    /**
     * Process style binding elements (data-bind-style)
     * @param {Object} instance - Component instance
     * @private
     */
    _processStyleBindingElements(instance)
    {
        this._processObjectBindingElements('style', instance);
    },
    /**
     * Process attr binding elements (data-bind-attr)
     * @param {Object} instance - Component instance
     * @private
     */
    _processAttrBindingElements(instance)
    {
        this._processObjectBindingElements('attr', instance);
    },
    /**
     * Process model binding elements
     * @param {Object} instance - Component instance
     * @private
     */
    _processModelElements(instance)
    {
        if (!this._contextSystemInitialized) return;

        const {element, id: instanceId} = instance;

        // Find all model elements (including component root)
        const modelElements = this._querySelfAndDescendants(element, this._attrSelector('model'))
            .filter(el => this._isOwnedBindingElement(el, element));

        // Process each model element
        modelElements.forEach(modelElement =>
        {
            const modelPath = this._getAttr(modelElement, 'model');
            if (!modelPath) return;

            // WF-501: Warn if using $store.path in data-model (store paths are read-only)
            if (modelPath.includes('$')) {
                if (__DEV__) wfError(WF_ERRORS.MODEL_STORE_SHORTHAND, {
                    context: `data-model="${modelPath}"`,
                    suggestion: 'Use component state and an action that mediates writes back to the store.',
                    warn: true
                });
                return; // Skip this element - it's an invalid binding
            }

            // Collect effect metadata for ALL model elements (including web components)
            // The effect's _executeModelBindForEffect handles adapter-based property pushing
            if (instance._effectMeta) {
                const inputType = (modelElement.type || '').toLowerCase();
                instance._effectMeta.push({
                    element: modelElement,
                    type: 'model',
                    path: modelPath,
                    isExpression: false,
                    isCheckbox: inputType === 'checkbox',
                    isRadio: inputType === 'radio',
                    isSelectMultiple: modelElement.tagName === 'SELECT' && modelElement.multiple,
                    _webComponentAdapter: this._webComponentAdapters?.get(modelElement.tagName.toLowerCase()) || null
                });
            }

            // Skip context creation for custom elements: they are handled by
            // _bindWebComponentModel in FormHandling.js for DOM→state event wiring.
            // The effect handles state→DOM sync via the meta entry above.
            if (modelElement.tagName.toLowerCase().includes('-')) return;

            const result = this._createListAwareBindingContext(modelElement, modelPath, instance);
            if (!result) return;

            const { inList } = result;
            if (!inList) {
                // Non-list data-model no longer creates a per-binding CM context.
                // Stash a slim element-local record carrying everything the live
                // input path needs (owning instance, model path, modifiers, element
                // meta). _handleInputChange / _updateModelValue accept any object of
                // this shape, so the existing write-back logic is reused verbatim.
                modelElement._wfModel = this._buildModelRecord(modelElement, modelPath, instance);
            }
        });
    },
    /**
     * Build the element-local model record for a non-list data-model binding.
     * Shaped to match what _handleInputChange / _updateModelValue read off a CM
     * context (path, componentInstance, modelModifiers, elementMeta), so neither
     * needs a per-binding context.
     * @private
     */
    _buildModelRecord(element, path, instance) {
        const inputType = element.type;
        return {
            element,
            path,
            componentInstance: instance,
            _isModelBinding: true,
            modelModifiers: {
                trim: this._hasAttr(element, 'model-trim'),
                number: this._hasAttr(element, 'model-number'),
                lazy: this._hasAttr(element, 'model-lazy'),
                event: (inputType === 'checkbox' || inputType === 'radio') ? 'change' : 'input'
            },
            elementMeta: {
                inputType: element.type,
                tagName: element.tagName
            }
        };
    },
    /**
     * Process slots for component composition
     * @private
     */
    _processSlots(instance)
    {
        const {element} = instance;

        // Find all slot containers
        element.querySelectorAll(this._attrSelector('slot-container')).forEach(container =>
        {
            const slotName = this._getAttr(container, 'slot-container');

            // Find matching slot content
            const slotContent = element.querySelector(this._attrSelector('slot', slotName));
            if (slotContent)
            {
                // Clear container and append slot content
                container.innerHTML = '';
                container.appendChild(slotContent);


            }
        });
    },
    /**
     * Lazy initialization helpers - ensure data structures exist before use
     * @private
     */
    _ensureSet(propertyName) {
        if (!this[propertyName]) {
            this[propertyName] = new Set();
        }
        return this[propertyName];
    },
    /**
     * DOM traversal helpers - centralize common DOM queries
     * @private
     */
    /**
     * querySelectorAll that also includes the element itself if it matches.
     * Fixes bindings on component root elements (querySelectorAll only searches descendants).
     * Only includes the root element when no parent scope (list or component) owns it.
     */
    _querySelfAndDescendants(element, selector) {
        const results = Array.from(element.querySelectorAll(selector));
        // Only include root if no parent component/list owns this element's bindings.
        if (element.matches(selector) && this._isUnownedRoot(element)) {
            results.unshift(element);
        }
        return results;
    },
    /**
     * True when nothing around a component's root reads the bindings written
     * on it: no component and no list above it. A nested root's bindings are
     * read by the component (or row) around it, since that is where its tag
     * was written. Both attribute halves are prefix-aware: a parent declared
     * after this child has no data-component-id yet, so its data-wf-component
     * attribute is the only thing that identifies it as the owner (plain-page
     * canary "a binding on a child root belongs to the parent").
     * @private
     */
    _isUnownedRoot(element) {
        // Content a portal moved (data-portaled-from on it or on a wrapper
        // above it) is still read by the component that teleported it.
        const parent = element.parentElement;
        return !element.hasAttribute('data-portaled-from') && (!parent ||
            !parent.closest(`${this._attrSelector('component')}, [data-component-id], ${this._attrSelector('list')}, [data-portaled-from]`));
    },
    _getComponentElement(element) {
        return element ? element.closest(this._attrSelector('component')) : null;
    },
    /**
     * The owner of the bindings on a component's root: the nearest ancestor
     * element carrying data-component (data-wf-component), registered or not,
     * because that is whose markup the tag was written in. Null for a
     * top-level root. The one rule every claim of a root asks
     * (_isOwnedBindingElement, _bindingScopeElement, the effect rescan, the
     * scan-time claim and the fallback collector). While the owner is not
     * registered, the root's bindings stay inert; it claims them when it
     * initializes. A root a portal moved (data-portaled-from on it, or on a
     * wrapper between it and the component around the target) keeps the
     * owner whose markup it was written in: the component that teleported
     * it, never the one around the portal target.
     * @private
     */
    _rootOwnerElement(el) {
        const owner = this._getComponentElement(el.parentElement);
        const moved = el.closest('[data-portaled-from]');
        if (moved && moved !== owner && (!owner || owner.contains(moved))) {
            const source = this.componentInstances.get(moved.getAttribute('data-portaled-from'));
            return source ? source.element : null;
        }
        return owner;
    },
    /**
     * The component element whose scope a binding on `el` reads: the nearest
     * component, except that a binding on a component's own root is read by
     * its owner (_rootOwnerElement). A top-level root has no owner and keeps
     * its own.
     * @private
     */
    _bindingScopeElement(el) {
        const own = this._getComponentElement(el);
        return (own === el && this._rootOwnerElement(el)) || own;
    },
    /**
     * Check whether a binding element belongs to this component's direct scope.
     * Returns false for elements inside rendered templates, nested data-list
     * containers (handled by list rendering), or child components.
     * @param {HTMLElement} el - The binding element to check
     * @param {HTMLElement} componentElement - The component's root element
     * @returns {boolean}
     * @private
     */
    _isOwnedBindingElement(el, componentElement) {
        if (el.closest('[data-use-template-rendered]')) return false;
        // Elements inside a <template> belong to a list or pool template, not
        // to the component. An HTML <template> keeps its content in an inert
        // fragment that querySelectorAll never sees, so this only bites for the
        // foreign-content case: <template> inside <svg> parses as an inert SVG
        // element whose children are live DOM until the pool lifts them out.
        if (el.closest('template')) return false;
        // Only exclude elements INSIDE a list: the list root itself owns its own bindings
        // (bind-style, bind-class, bind-attr on the container are authored by the component,
        // not by the list renderer, which only manages children).
        const ancestorList = el.parentElement?.closest(this._attrSelector('list'));
        if (ancestorList && ancestorList !== componentElement && componentElement.contains(ancestorList)) return false;
        const closestComponent = this._getComponentElement(el);
        if (closestComponent === componentElement) return true;
        // Bindings on a child component's root are claimed by the root's
        // owner (bindings on a component element are authored in the
        // template around it). Elements below a nested component, registered
        // or not, are not this component's.
        return closestComponent === el && this._rootOwnerElement(el) === componentElement;
    },
    // _findListItemAncestor, _getComponentId and _getListItems (lists only)
    // live in ListSharedMethods; shared callers are gated on __FEATURE_LISTS__.
    /**
     * Get a value from an object using dot notation
     * @private
     */
    _getValueFromItem(item, path)
    {
        return pathResolver.get(item, path);
    },
    /**
     * Navigate to a DOM element using a pre-computed child index path
     * Used by compiled metadata to avoid querySelectorAll
     * @param {HTMLElement} root - The root element to start from
     * @param {number[]} path - Array of child indices to follow
     * @returns {HTMLElement|null} The target element or null if not found
     * @private
     */
    _getElementByPath(root, path) {
        if (!path || path.length === 0) return root;
        let current = root;
        for (let i = 0; i < path.length; i++) {
            if (!current.children || !current.children[path[i]]) return null;
            current = current.children[path[i]];
        }
        return current;
    },
    /**
     * Configuration for binding type collection
     * Centralizes the repetitive binding collection patterns
     * Supports both data-* and data-wf-* prefixes
     * @private
     */
    get _bindingTypeConfigs() {
        // classBindings/styleBindings removed; effects handle class and style binding updates
        return [
            { attribute: 'data-bind', altAttribute: 'data-wf-bind', collectionName: 'bindings' },
            { attribute: 'data-bind-html', altAttribute: 'data-wf-bind-html', collectionName: 'htmlBindings', datasetKey: 'bindHtml', altDatasetKey: 'wfBindHtml' },
            { attribute: 'data-show', altAttribute: 'data-wf-show', collectionName: 'conditionals' },
            { attribute: 'data-list', altAttribute: 'data-wf-list', collectionName: 'lists' },
            { attribute: 'data-model', altAttribute: 'data-wf-model', collectionName: 'models' },
            { attribute: 'data-pool', altAttribute: 'data-wf-pool', collectionName: 'pools' }
        ];
    },
//COMPONENT RELATIONSHIPS

    /**
     * Get all component instances of a specific type.
     *
     * @param {string} componentName - The component name to search for
     * @returns {Array<Object>} Array of matching component instances
     *
     * @example
     * // Get all counter components
     * const counters = wildflower.getComponentsByType('counter');
     * counters.forEach(c => console.log(c.state.count));
     *
     * @example
     * // Reset all forms
     * wildflower.getComponentsByType('form').forEach(form => {
     *   form.context.reset();
     * });
     */
    getComponentsByType(componentName)
    {
        return Array.from(this.componentInstances.values())
            .filter(instance => instance.name === componentName);
    },

    // _cleanupContextsInSubtree (list rows) lives in ListSharedMethods.

    // ========================================================================
    // COMPONENT BINDING PIPELINE
    // ========================================================================

    /**
     * Process all data bindings for a component
     * @private
     */
    _processComponentBindings(instance)
    {
        const { element, id: instanceId, name: componentName } = instance;

        // data-query pre-pass (full tier): rewrite [data-query]+<template>
        // to data-list BEFORE bindings are compiled. This is the one site
        // every init path funnels through (registration-triggered init,
        // incremental scan, batched orchestrators), so the compiled binding
        // snapshot (which feeds domElements.lists and therefore list
        // mounting) always sees the transformed attribute. Idempotent.
        if (__FEATURE_QUERY__ && this._transformQueryElements) {
            this._transformQueryElements(element, instance);
        }

        // ═══════════════════════════════════════════════════════════════════
        // JIT COMPILATION FAST PATH (Flyweight Pattern)
        // Try to use pre-compiled binding metadata for this component type
        // ═══════════════════════════════════════════════════════════════════
        const compiled = this._getCompiledComponentBindings(element, componentName);

        if (compiled) {
            // FAST PATH: Use pre-compiled element paths instead of querySelectorAll
            this._processComponentBindingsFromCompiled(instance, compiled);
        } else {
            // SLOW PATH: Fall back to DOM scanning (first instance or structure mismatch)
            this._processComponentBindingsFallback(instance);
        }

        if (this._contextSystemInitialized)
        {
            // Validate bindings BEFORE conditional processing (data-render removes elements)
            if (__DEV__) this._validateComponentBindings(instance);

            // Collect effect metadata during context creation (eliminates duplicate DOM scan)
            instance._effectMeta = [];

            // Process each binding type to create appropriate contexts
            this._processBindingElements(instance);
            this._processHTMLBindingElements(instance);
            this._processClassBindingElements(instance);
            this._processStyleBindingElements(instance);
            this._processAttrBindingElements(instance);
            this._processConditionalElements(instance);

            this._processModelElements(instance);
        }

        // Create Render Effect for component bindings
        // During scan batches, defer effect creation so all components in the batch
        // are initialized before effects run (avoids redundant re-execution)
        if (instance.stateManager?.createEffect) {
            if (this._pendingEffectInstances) {
                this._pendingEffectInstances.push(instance);
            } else {
                this._createComponentRenderEffect(instance);
            }
        }
    },

    /**
     * FAST PATH: Process bindings using pre-compiled element paths
     * Skips querySelectorAll entirely - uses O(depth) path traversal instead
     * @private
     */
    _processComponentBindingsFromCompiled(instance, compiled) {
        const { element, id: instanceId } = instance;

        // Ensure collections exist
        if (!this.domElements.bindings) this.domElements.bindings = [];
        if (!this.domElements.htmlBindings) this.domElements.htmlBindings = [];
        if (!this.domElements.conditionals) this.domElements.conditionals = [];
        if (!this.domElements.models) this.domElements.models = [];  // needed by dev-mode binding validation

        // Process data-bind elements
        for (const binding of compiled.bindings) {
            const el = this._getElementByPath(element, binding.elementPath);
            // Skip elements that have been bound by a list (prevent component from overwriting)
            // Also skip SSR list items (real DOM elements inside data-list within data-ssr components)
            const inSSRList = el && el.closest(this._attrSelector('list'))?.closest(this._attrSelector('ssr', 'true'));
            if (el && !listBoundElements.has(el) && !inSSRList) {
                this.domElements.bindings.push({
                    element: el,
                    componentId: instanceId,
                    path: binding.path
                });
            }
        }

        // Process data-bind-html elements
        for (const binding of compiled.htmlBindings) {
            const el = this._getElementByPath(element, binding.elementPath);
            if (el) {
                this.domElements.htmlBindings.push({
                    element: el,
                    componentId: instanceId,
                    path: binding.path
                });
            }
        }

        // data-bind-class and data-bind-style: effects handle these, no domElements tracking needed

        // Process data-show elements (conditionals)
        for (const binding of compiled.shows) {
            const el = this._getElementByPath(element, binding.elementPath);
            if (el) {
                this.domElements.conditionals.push({
                    element: el,
                    componentId: instanceId,
                    path: binding.negate ? '!' + binding.path : binding.path
                });
            }
        }

        // Process data-model elements (event listeners + validation tracking; state→DOM sync handled by effects)
        for (const binding of compiled.models) {
            const el = this._getElementByPath(element, binding.elementPath);
            if (el) {
                this.domElements.models.push({
                    element: el,
                    componentId: instanceId,
                    path: binding.path
                });
                this._bindModelElement(el, instance);
            }
        }

        // Process data-list elements
        if (!this.domElements.lists) this.domElements.lists = [];
        for (const list of compiled.lists) {
            const el = this._getElementByPath(element, list.elementPath);
            if (el) {
                this.domElements.lists.push({
                    element: el,
                    componentId: instanceId,
                    path: list.path
                });
            }
        }

        // Process data-pool elements (entity pools)
        if (!this.domElements.pools) this.domElements.pools = [];
        if (compiled.pools) {
            for (const pool of compiled.pools) {
                const el = this._getElementByPath(element, pool.elementPath);
                if (el) {
                    this.domElements.pools.push({
                        element: el,
                        componentId: instanceId,
                        path: pool.path
                    });
                }
            }
        }

        // Note: data-render and data-action are handled separately by other systems
        // data-render: handled by _processConditionalElements
        // data-action: handled by _bindComponentActions
    },

    /**
     * SLOW PATH: Original DOM scanning approach
     * Used for first component instance or when DOM structure differs
     * @private
     */
    _processComponentBindingsFallback(instance) {
        // Collect elements with various binding attributes using config-driven approach
        // Supports both data-* and data-wf-* prefixes
        this._bindingTypeConfigs.forEach(config => {
            // Ensure collection exists
            if (!this.domElements[config.collectionName]) {
                this.domElements[config.collectionName] = [];
            }

            // Collect elements for this binding type (with alternate prefix support)
            this._collectElementsWithAttribute(
                instance,
                config.attribute,
                this.domElements[config.collectionName],
                config.datasetKey,
                config.altAttribute,
                config.altDatasetKey
            );
        });
    },

    // =========================================================================
    // Effect-Based Component Binding Rendering
    // =========================================================================

    /**
     * Create a Render Effect for a component that updates all bindings.
     * Instead of individual Context updates, one Effect handles all bindings.
     *
     * @param {Object} instance - Component instance
     * @returns {Function|null} Stop function to dispose the Effect, or null if not created
     * @private
     */
    _createComponentRenderEffect(instance) {
        const stateManager = instance?.stateManager;
        if (!stateManager?.createEffect) {
            return null;
        }
        if (instance._rootEffect === undefined) this._createRootEffect(instance);

        // Use pre-collected metadata (populated during context creation or data-render re-insertion)
        const bindingMeta = instance._effectMeta;
        instance._effectMeta = null;
        if (!bindingMeta || bindingMeta.length === 0) {
            return null;
        }
        // Kept reachable so a data-render removal can mark the metadata of
        // the subtree it takes out (_markHiddenRenderMetas).
        instance._renderMeta = bindingMeta;

        // data-render writers may insert a cloned subtree and recreate THIS effect
        // (see _executeRenderForEffect → _insertRenderElement). Process render metas
        // last so the recreate-and-bail guard only short-circuits bindings already
        // applied this run; the freshly created effect owns the rest.
        this._sortRenderMetaLast(bindingMeta);

        const self = this;

        // Create the Render Effect
        const stopEffect = stateManager.createEffect(() => {
            self._executeComponentBindingsForEffect(instance, bindingMeta);
        }, {
            scope: instance,
            name: __DEV__ ? `component:${instance.name}` : undefined
        });

        instance._renderEffect = stopEffect;
        return stopEffect;
    },

    /**
     * A component's root: block: its own side of its root element. Every value
     * is an expression in the component's scope, read as the matching
     * attribute reads it (the effect loop's evaluator); `directives` run with
     * the directive system (_processRootDirectives). One effect of its own,
     * made with the component's first render effect and kept through that
     * effect's rebuilds; destroy disposes it. The block is compiled once per
     * definition.
     * @private
     */
    _createRootEffect(instance) {
        instance._rootEffect = null;
        const definition = instance.definition;
        const block = definition && definition.root;
        if (block === undefined || !instance.element) return;
        // Compiled (and its shape warnings given) once per definition.
        let spec = _rootSpecs.get(definition);
        if (!spec) {
            _rootSpecs.set(definition, spec = []);
            const ignored = (key, why) => {
                if (__DEV__) wfError(WF_ERRORS.DEFINITION_KEY_IGNORED, {
                    warn: true,
                    context: `Component '${instance.name}': root:${key ? ' ' + key : ''} ${why}, so it was ignored`,
                    suggestion: key === 'render'
                        ? 'A component cannot remove its own root. Put data-render on its tag in the parent\'s markup.'
                        : 'root: is an object: class, attr and style (name to expression), show (an expression) and directives (registered directive name to value).'
                });
            };
            if (!block || typeof block !== 'object') {
                ignored('', 'is not an object');
                return;
            }
            for (const key in block) {
                const value = block[key];
                if (key === 'show') {
                    if (typeof value !== 'string') ignored(key, 'is not an expression string');
                    else spec.push({ type: 'root-show', key, ...this._parseConditionPath(value) });
                } else if (key === 'class' || key === 'attr' || key === 'style' || key === 'directives') {
                    if (!value || typeof value !== 'object') {
                        ignored(key, 'is not an object');
                        continue;
                    }
                    for (const name in value) {
                        const expr = value[name];
                        if (typeof expr !== 'string') ignored(`${key}.${name}`, 'is not a string');
                        else if (key === 'directives') {
                            // Run by the directive system (_processRootDirectives).
                            if (!this._customDirectives.has(name)) ignored(`${key}.${name}`, 'names no registered directive');
                        } else if (key === 'attr' && this._isBlocklistedAttr(name)) ignored(`${key}.${name}`, 'is an attribute bindings cannot set');
                        else spec.push({ type: 'root-' + key, key: name, ...this._parseConditionPath(expr) });
                    }
                } else ignored(key, key === 'render' ? 'is not supported' : 'is not a root: key');
            }
        }
        if (spec.length === 0) return;
        // The root: block reads the component's own scope only: no `element`
        // for the effect loop, so a record-shape query around the root (which
        // the tag's own bindings do read) never merges its row in.
        const target = instance.element;
        const metas = spec.map(entry => ({ ...entry, element: null, target }));
        instance._rootEffect = instance.stateManager.createEffect(() => {
            this._executeComponentBindingsForEffect(instance, metas);
        }, { scope: instance, name: __DEV__ ? `root:${instance.name}` : undefined });
    },

    /**
     * Write one root: block value. Merged with the bindings on the tag: a
     * class is on while either side holds it; the root shows only while
     * neither side hides it; an attribute or style property the tag binds
     * too is the tag's (WF-520).
     * @private
     */
    _applyRootMeta(meta, value, instance) {
        const el = meta.target;
        const key = meta.key;
        if (meta.negate) value = !value;
        if (meta.type === 'root-show') {
            el._wfRootShow = !!value;
            // The tag's last verdict (every show writer records it), visible
            // when the tag has none or has not run yet.
            applyShow(el, el._wfTagShow !== false);
        } else if (meta.type === 'root-class') {
            const held = el._wfRootOn || (el._wfRootOn = new Set());
            const bound = el._prevBoundClasses;
            // A class the tag carries at mount and does not bind is static
            // (root: never takes it off) unless this entry is true then: a
            // server-rendered root carries root:'s own classes, so those are
            // root:'s.
            if (meta.fixed === undefined) meta.fixed = !value && el.classList.contains(key) && !(bound && bound.has(key));
            if (value) {
                held.add(key);
                if (!el.classList.contains(key)) el.classList.add(key);
            } else {
                held.delete(key);
                if (!meta.fixed && el.classList.contains(key) && !(bound && bound.has(key))) el.classList.remove(key);
            }
        } else {
            const isAttr = meta.type === 'root-attr';
            if (meta.tagSets === undefined) {
                // The tag's object literal names the key (static, so the tag
                // wins from the first paint, whichever side runs first).
                const text = this._getAttr(el, isAttr ? 'bind-attr' : 'bind-style') || '';
                meta.names = isAttr ? [key] : [key, key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), key.replace(/-([a-z])/g, (m, c) => c.toUpperCase())];
                meta.tagSets = meta.names.some(name => text.includes(name) &&
                    new RegExp('(^|[{,(])\\s*[\'"]?' + name.replace(/[^\w-]/g, '\\$&') + '[\'"]?\\s*:').test(text));
            }
            const bound = isAttr ? el._boundAttrProps : el._boundStyleProps;
            if (meta.tagSets || (bound && meta.names.some(name => bound.has(name)))) {
                if (__DEV__) this._warnRootConflict(instance, isAttr ? 'attribute' : 'style property', key);
                return;
            }
            try {
                if (isAttr) applyAttrValue(el, key, this._sanitizeAttrValue(key, value));
                else applyStyleProp(el.style, key, value);
            } catch (e) { /* invalid name or value: skipped, as in the tag's writers */ }
        }
    },

    /**
     * Dispose a component's Render Effect.
     * @param {Object} instance - Component instance
     * @private
     */
    _disposeComponentRenderEffect(instance) {
        if (instance._renderEffect) {
            instance._renderEffect();
            instance._renderEffect = null;
        }
    },

    /**
     * Collect binding metadata by scanning the component's DOM.
     * Called by data-render re-insertion (RenderRecord._insertRenderElement)
     * where the full component needs a fresh scan: init-time _effectMeta
     * can't be reused because only a subtree was re-inserted.
     *
     * During normal init, _process*Elements populate _effectMeta instead,
     * avoiding this DOM scan entirely.
     *
     * @param {Object} instance - Component instance
     * @returns {Array} Array of binding metadata objects
     * @private
     */
    _collectComponentBindingMeta(instance) {
        const meta = [];
        const element = instance.element;

        // Helper to check if element belongs to this component (not nested)
        // Component boundaries honour the prefix mode: in exclusive mode a
        // third party's bare data-component is not a boundary.
        const componentSel = this._attrSelector('component');
        const belongsToComponent = (el) => {
            if (listBoundElements.has(el)) return false; // Skip list-bound elements
            if (el.closest('[data-use-template-rendered]')) return false; // Skip slot template bindings
            // SSR lists: Skip elements inside data-list containers within SSR components
            // (SSR list items exist as real DOM elements before the list renderer runs,
            // so listBoundElements won't catch them yet; use DOM check instead)
            const listAncestor = el.closest(this._attrSelector('list'));
            if (listAncestor && listAncestor.closest(this._attrSelector('ssr', 'true'))) return false;
            // List INTERIORS are row-owned in every mode, not just SSR. This
            // scan runs on data-render re-insertion, when rendered rows exist
            // as real DOM: collecting a row element here makes the component
            // effect re-evaluate its expressions in COMPONENT scope, where
            // item fields are undefined — a fallback ternary then clobbers
            // the row's correct value (the Conduit avatar paint-then-revert).
            // The container itself (listAncestor === el) stays collectible:
            // data-show on a data-list element is a component binding.
            // Ownership-scoped, mirroring the init-time guard in
            // _processConditionalElements: closest() walks past this
            // component's root, so for a component living in ANOTHER
            // component's row, every element finds the ancestor's list.
            // Excluding on mere presence stripped that nested component's
            // whole meta on rescan. Only rows of a list THIS
            // component owns are row-owned from its point of view.
            // A list element is its own closest list, so for one the question
            // is asked of its parent, as _isOwnedBindingElement does at init:
            // a top-level container has no list above it and stays
            // collectible; a row whose root is itself a nested list
            // (<tr data-list="cells">) is row-owned like any other row.
            const owningList = listAncestor === el
                ? (el.parentElement ? el.parentElement.closest(this._attrSelector('list')) : null)
                : listAncestor;
            if (owningList && owningList.closest(componentSel) === element) return false;
            // Pool interiors are row-owned in the same way. At init the pool is
            // empty, so this rescan is the only pass that ever sees rendered
            // rows. Collecting one makes the component effect evaluate the row's
            // expression in COMPONENT scope, where the entity's fields are
            // undefined, and that write clears the attribute the pool had just
            // set. A data-render flipping false -> true stripped every pool
            // row's bound src this way. The container itself stays collectible,
            // since data-show or data-bind-class on a data-pool element is a
            // component binding. Ownership scoping mirrors the list guard above,
            // so a component living inside another component's pool row keeps
            // its own meta.
            const poolAncestor = el.closest(this._attrSelector('pool'));
            if (poolAncestor && poolAncestor !== el
                && poolAncestor.closest(componentSel) === element) return false;
            // Use data-component (not data-component-id) to detect component boundaries.
            // Nested components may not have data-component-id yet during init batches.
            const closestComp = el.closest(componentSel);
            if (closestComp === element) return true;
            // Bindings on a child component's root belong to the root's owner.
            return closestComp === el && this._rootOwnerElement(el) === element;
        };

        for (const [attrKey, build] of this._effectMetaSpecs()) {
            this._querySelfAndDescendants(element, this._attrSelector(attrKey)).forEach(el => {
                if (!belongsToComponent(el)) return;
                const path = this._getAttr(el, attrKey);
                if (path) meta.push(build(el, path));
            });
        }

        // Non-list data-render is effect-driven from the component's tracked render
        // contexts (not a DOM scan: a falsy condition holds a detached element +
        // placeholder, which a selector query can't rediscover). List-item render
        // contexts (parentIndex set) stay on their per-item effects; skip them.
        if (instance._renderContexts) {
            for (const ctx of instance._renderContexts) {
                if (!ctx || ctx._parentIndex !== undefined) continue;
                meta.push(this._buildRenderMeta(ctx, instance));
            }
        }

        return meta;
    },

    /**
     * One spec per non-render binding type: [attr key, meta-entry builder].
     * Entry shapes mirror what the init-time _process*Elements push into
     * _effectMeta: the effect executor reads both interchangeably, so any
     * field change here must be made there too.
     * @private
     */
    _effectMetaSpecs() {
        // Helper: detect expression paths that need evaluateExpression()
        // rather than simple getValue(). Covers operators, ternary, external(),
        // object literals, and $store.path references.
        const needsExprEval = (path) => this.isExpression(path) || path.includes('$');

        return [
            ['bind', (el, path) => {
                const entry = {
                    element: el,
                    type: 'bind',
                    path: path,
                    isInput: el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT',
                    isExpression: needsExprEval(path)
                };
                if (el.tagName.includes('-')) entry.isWebComponent = true;
                return entry;
            }],
            ['bind-html', (el, path) => ({
                element: el,
                type: 'html',
                path: path,
                isExpression: needsExprEval(path)
            })],
            ['show', (el, path) => {
                const parsed = this._parseConditionPath(path);
                return {
                    element: el,
                    type: 'show',
                    path: parsed.path,
                    negate: parsed.negate,
                    isExpression: parsed.isExpression
                };
            }],
            ['bind-class', (el, path) => ({
                element: el,
                type: 'class',
                path: path,
                prevClasses: null, // Track previous classes for removal
                isExpression: needsExprEval(path)
            })],
            ['bind-style', (el, path) => ({
                element: el,
                type: 'style',
                path: path,
                isExpression: needsExprEval(path)
            })],
            ['bind-attr', (el, path) => ({
                element: el,
                type: 'attr',
                path: path,
                isExpression: needsExprEval(path)
            })],
            // data-model: state→DOM sync only; DOM→state is event-driven
            ['model', (el, path) => {
                const inputType = (el.type || '').toLowerCase();
                return {
                    element: el,
                    type: 'model',
                    path: path,
                    isExpression: false,
                    isCheckbox: inputType === 'checkbox',
                    isRadio: inputType === 'radio',
                    isSelectMultiple: el.tagName === 'SELECT' && el.multiple,
                    _webComponentAdapter: this._webComponentAdapters?.get(el.tagName.toLowerCase()) || null
                };
            }]
        ];
    },

    /**
     * A component element arriving inside an already-mounted component
     * (inserted and scanned, or inside a data-render section that just turned
     * on): the bindings on its root are the mounted component's, but that
     * component's render effect was built before the element existed. Add the
     * root's bindings to it, as a data-render insertion does for its subtree.
     * A data-render on the root becomes one of the component's sections, so a
     * false one takes the element out before it initializes. A root the
     * component already reads (it was there at init, or a section put it
     * back) is left alone.
     *
     * Called from the scan loop, where _pendingEffectInstances collects the
     * effects to create once the batch has initialized: the owner's effect is
     * taken down at its first claimed root and created again at the end of
     * the scan over its live entries plus every root claimed in between, so
     * N appended children cost one rebuild, not N.
     * @param {HTMLElement} element - A component element, initialized or not
     * @private
     */
    _claimChildRootBindings(element) {
        const directives = this._customDirectives && this._customDirectives.size > 0;
        if (!directives && !this._carriesRootBindings(element)) return;
        const ownerEl = this._rootOwnerElement(element);
        const ownerId = ownerEl && ownerEl.dataset.componentId;
        const owner = ownerId && this.componentInstances.get(ownerId);
        // An owner whose binding pass has not run yet (or that is not
        // registered) reads the root when it does.
        if (!owner || owner._effectMeta === undefined) return;
        // Rows, pool entities, slot content and template children are read
        // by their own scope.
        if (!this._isOwnedBindingElement(element, ownerEl)) return;
        const pool = element.parentElement.closest(this._attrSelector('pool'));
        if (pool && ownerEl.contains(pool)) return;

        // Custom directives on the tag are the owner's too.
        if (directives && !this._directiveOwner(element, owner)) this._processCustomDirectives(element, owner);
        if (!this._carriesRootBindings(element)) return;

        // Typing into the root writes the scope that reads it.
        const modelPath = this._getAttr(element, 'model');
        if (modelPath && !element._wfModel && !modelPath.includes('$') && !element.tagName.includes('-')) {
            element._wfModel = this._buildModelRecord(element, modelPath, owner);
        }

        const reads = (list) => !!list && list.some(entry => _entryIsFor(entry, element));
        if (reads(owner._effectMeta) || reads(owner._renderMeta) || reads(owner._renderContexts)) return;

        const added = [];
        let renderCtx = null;
        const renderPath = this._getAttr(element, 'render');
        if (renderPath) {
            renderCtx = this._processDataRenderElement(element, renderPath, owner);
            if (renderCtx) (owner._renderContexts || (owner._renderContexts = [])).push(renderCtx);
        }
        // This root's entries only, built as the effect rescan builds them.
        // A false data-render just took the root out; the section's insertion
        // collects the rest from its clone.
        if (element.isConnected) {
            for (const [attrKey, build] of this._effectMetaSpecs()) {
                const path = this._getAttr(element, attrKey);
                if (path) added.push(build(element, path));
            }
        }
        if (renderCtx) added.push(this._buildRenderMeta(renderCtx, owner));
        if (added.length === 0) return;

        // The owner's effect is live: take it down for the rest of this
        // scan, keeping every entry not already hidden (a hidden entry's
        // section left, and insertion collects fresh ones; a destroyed
        // child's were hidden by _releaseChildRoot). A root detached by hand
        // but still alive keeps its entries, as any detached element does.
        // The token bump stops a run in progress from going on with the old
        // entries.
        if (!owner._effectMeta) {
            owner._renderToken = (owner._renderToken | 0) + 1;
            owner._effectMeta = (owner._renderMeta || []).filter(meta => !meta._hidden);
            this._disposeComponentRenderEffect(owner);
            this._pendingEffectInstances.push(owner);
        }
        owner._effectMeta.push(...added);
    },

    /** Whether an element carries any of the value bindings a root gives its owner (either prefix). @private */
    _carriesRootBindings(el) {
        return el.matches(_ROOT_BINDINGS_SELECTOR);
    },

    /**
     * A child component whose root left the page is destroyed: its root's
     * entries leave the component that read them (_rootOwnerElement), with
     * its section record and its model record. Entries are hidden at once
     * (the effect skips them) and removed from the lists after the current
     * run, since an effect may be iterating them.
     * @param {Object} owner - The instance that read the root's bindings
     * @param {HTMLElement} root - The destroyed child's root element
     * @private
     */
    _releaseChildRoot(owner, root) {
        if (root._wfModel && root._wfModel.componentInstance === owner) root._wfModel = null;
        if (owner._renderContexts) owner._renderContexts = owner._renderContexts.filter(ctx => ctx.element !== root);
        if (!this._hideMetas(owner, meta => _entryIsFor(meta, root))) return;
        queueMicrotask(() => {
            for (const list of [owner._effectMeta, owner._renderMeta]) {
                if (!list) continue;
                let w = 0;
                for (const meta of list) if (!meta._hidden || !_entryIsFor(meta, root)) list[w++] = meta;
                list.length = w;
            }
        });
    },

    /**
     * Execute all component bindings within Effect context.
     * This is called by the Render Effect when dependencies change.
     *
     * @param {Object} instance - Component instance
     * @param {Array} bindingMeta - Array of binding metadata
     * @private
     */
    _executeComponentBindingsForEffect(instance, bindingMeta) {
        const stateManager = instance.stateManager;
        // Snapshot the render token: a data-render insert recreates this effect
        // (new clone + fresh meta) and bumps the token. When that happens mid-run
        // we must stop iterating the now-stale meta array.
        const renderToken = instance._renderToken | 0;

        for (const meta of bindingMeta) {
            // A binding inside a data-render section that is hidden (marked at
            // removal by _markHiddenRenderMetas). Insertion re-creates this
            // effect with fresh metadata, so evaluating it here would only
            // write to a detached node and, for a $query path, wake a query
            // nothing on the page shows. An element detached by hand is NOT
            // marked and keeps its writes, so it is current when reattached.
            if (meta._hidden) continue;
            // Read value via reactive proxy (establishes dependency tracking).
            // Inside a record-shape query subtree (element marked by the query
            // transform) a BARE path in data-show / -class / -style / -attr /
            // -html reads the row the same way an expression there does: the
            // rewrite reaches only data-bind, and the merged scope is the one
            // rule for everything else in that subtree. A computed: prefix
            // names a component computed on purpose (the transform leaves it
            // alone for that reason), so it keeps the component read.
            let value;
            try {
                value = (meta.isExpression || (__FEATURE_QUERY__ && meta.element && meta.element._wfRecordQuery
                        && meta.type !== 'model' && !/^!?computed:/.test(meta.path)))
                    ? this._resolveEffectExpression(meta.path, instance, meta.element)
                    : stateManager.getValue(meta.path);
            } catch (e) {
                if (__DEV__) wfError(WF_ERRORS.EFFECT_PATH, {
                    context: `"${meta.path}"`,
                    cause: e,
                    warn: true
                });
                continue;
            }

            // Store-backed data-model ("storeName.field"): the WRITE path
            // (FormHandling) routes these to the named store's state, but
            // getValue above resolves only component state — so the state→DOM
            // direction never repainted on programmatic store writes. Mirror
            // the write-side resolution here. Lazily detected (stores may
            // register after the component scanned), cached by name only so
            // unregister/re-register stays correct; the read goes through the
            // store's reactive state, so the effect tracks it and re-runs on
            // store changes without requiring subscribe:.
            // Detection is independent of the resolved value (a collision
            // resolves component state, so a value gate would never let the
            // WF-512 note fire); the store READ below stays gated on the
            // value.
            if (meta.type === 'model' && meta._storeAlias === undefined) {
                    meta._storeAlias = null;
                    const dot = meta.path.indexOf('.');
                    if (dot > 0) {
                        const root = meta.path.slice(0, dot);
                        if (this.storeManager?.getStoreComponentByName(root)) {
                            // Component-first, the same
                            // discriminator as the write path: a root the
                            // component's own state declares is component
                            // scope, and the same-named store is never read —
                            // without this, a state-owned root whose leaf was
                            // still undefined painted the STORE's value into
                            // a component-state input. The store alias is the
                            // fallback for unowned roots only.
                            const ownState = instance.state;
                            const rootOwned = ownState != null && (root in ownState);
                            if (!rootOwned) {
                                meta._storeAlias = root;
                                meta._storeFieldPath = meta.path.slice(dot + 1).split('.');
                            } else if (__DEV__) {
                                // WF-512: a name serving two masters is
                                // confusing even now that it is coherent —
                                // say once, per component and root, which
                                // one wins.
                                if (!instance._warnedModelShadow) instance._warnedModelShadow = new Set();
                                if (!instance._warnedModelShadow.has(root)) {
                                    instance._warnedModelShadow.add(root);
                                    wfError(WF_ERRORS.MODEL_STORE_SHADOW, {
                                        warn: true,
                                        context: `data-model="${meta.path}": the component's own state declares "${root}", so this binds component state; the store named "${root}" is not involved`,
                                        suggestion: 'Rename the state key or the store if you meant the store-backed form pattern'
                                    });
                                }
                            }
                        }
                    }
            }
            if (meta.type === 'model' && value === undefined && meta._storeAlias) {
                const sc = this.storeManager.getStoreComponentByName(meta._storeAlias);
                if (sc) {
                    let v = sc.state;
                    const segs = meta._storeFieldPath;
                    for (let s = 0; s < segs.length && v != null; s++) v = v[segs[s]];
                    value = v;
                }
            }

            // Update the DOM based on binding type
            switch (meta.type) {
                case 'bind':
                    this._executeBindForEffect(meta, value);
                    break;
                case 'html':
                    this._executeHtmlBindForEffect(meta, value, instance);
                    break;
                case 'show':
                    this._executeShowForEffect(meta, value, instance);
                    break;
                case 'class':
                    this._executeClassBindForEffect(meta, value);
                    break;
                case 'style':
                    this._executeStyleBindForEffect(meta, value, instance);
                    break;
                case 'attr':
                    this._executeAttrBindForEffect(meta, value, instance);
                    break;
                case 'model':
                    this._executeModelBindForEffect(meta, value);
                    break;
                case 'root-show':
                case 'root-class':
                case 'root-attr':
                case 'root-style':
                    this._applyRootMeta(meta, value, instance);
                    break;
                case 'render':
                    this._executeRenderForEffect(meta, value, instance);
                    // An insert may have recreated this effect underneath us. Stop
                    // iterating the stale array; the new effect owns the remaining
                    // (render-last) work. Render metas are sorted to the tail, so
                    // anything left to process here is also render.
                    if ((instance._renderToken | 0) !== renderToken) return;
                    break;
            }
        }
    },

    /**
     * Stable-partition a binding-meta array so all type:'render' entries sit at
     * the tail, preserving relative order within each group. See
     * _createComponentRenderEffect for why render must run last.
     * @private
     */
    _sortRenderMetaLast(metaArr) {
        let w = 0;
        let renders = null;
        for (let r = 0; r < metaArr.length; r++) {
            const m = metaArr[r];
            if (m.type === 'render') {
                (renders || (renders = [])).push(m);
            } else {
                metaArr[w++] = m;
            }
        }
        if (renders) {
            for (let i = 0; i < renders.length; i++) metaArr[w++] = renders[i];
        }
    },

    /**
     * Build a type:'render' effect-meta entry from a render-mode conditional
     * context. Normalizes the condition path the same way _evaluateCondition does
     * (strips computed: / computed:! prefixes) then splits leading '!' negation,
     * so the effect's value read (getValue / _resolveEffectExpression) establishes
     * the graph edge to the computed/state the condition reads. The writer
     * (_executeRenderForEffect) applies the negate flag.
     * @private
     */
    _buildRenderMeta(context, instance) {
        const parsed = this._parseConditionPath(context.path);
        return {
            element: context.element,
            type: 'render',
            path: parsed.path,
            negate: parsed.negate,
            isExpression: parsed.isExpression,
            context
        };
    },

    /**
     * Resolve an expression binding value within Effect context.
     * Reads from the reactive proxy (establishing dependencies) and evaluates
     * expressions, $store references, external() calls via the expression evaluator.
     *
     * @param {string} path - The binding expression
     * @param {Object} instance - Component instance
     * @returns {*} The resolved value
     * @private
     */
    _resolveEffectExpression(path, instance, element) {
        const stateManager = instance.stateManager;

        // Normalize $store.path → external('store', 'path')
        let normalized = path.includes('$')
            ? this._normalizeStoreShorthands(path)
            : path;

        // Quote unquoted kebab-case keys in object literals (e.g., { data-status: x } → { 'data-status': x })
        // These are valid in WildflowerJS attribute syntax but not valid JavaScript
        if (normalized.includes('-') && normalized.includes('{')) {
            normalized = normalized.replace(/(\{|,)\s*([a-zA-Z][\w]*(?:-[\w]+)+)\s*:/g, "$1 '$2':");
        }

        // Provide the external() function for cross-component references
        const additionalContext = normalized.includes('external(')
            ? { external: this._getExternalFn(instance) }
            : undefined;

        // Record-shape query subtree: merge the single row into scope so a bare
        // field name resolves the same way it does inside a data-list template
        // (BindingResolver's item branch does `{...componentState, ...item}`).
        // The row shadows component state, matching that precedent. Reading the
        // row through the store facade inside the effect is what registers the
        // dependency, so a new row re-runs these bindings.
        let scopeState = instance.state || {};
        if (__FEATURE_QUERY__ && element && element._wfRecordQuery && this.getStore) {
            const rowStore = this.getStore(element._wfRecordQuery);
            const rows = rowStore && rowStore.rows;
            if (rows && rows.length > 0 && rows[0] && typeof rows[0] === 'object') {
                scopeState = mergeData({}, scopeState, rows[0]);
                if (__DEV__ && !element._wfRecordChecked) {
                    element._wfRecordChecked = true;
                    this._warnRecordFieldMisses(element, path, scopeState);
                }
            }
        }

        return this.evaluateExpression(normalized, scopeState, {
            stateManager: stateManager,
            cacheKey: 'effect',
            additionalContext
        });
    },

    /**
     * Execute data-bind for Effect.
     * @private
     */
    _executeBindForEffect(meta, value) {
        const el = meta.element;

        // Web component adapter: set property, never textContent (destroys light DOM)
        if (meta.isWebComponent) {
            const adapter = this.getAdapter(el.tagName.toLowerCase(), el);
            if (adapter) {
                if (el[adapter.prop] !== value) {
                    el[adapter.prop] = value;
                }
            }
            return;
        }

        if (meta.isInput) {
            // The one writer for a form control's value (it also keeps what a
            // select was asked to show, for when its options arrive).
            applyModel(el, value);
        } else {
            applyText(el, value);
        }
    },

    /**
     * Execute data-bind-html for Effect.
     * @private
     */
    _executeHtmlBindForEffect(meta, value, instance) {
        const el = meta.element;
        const htmlValue = value == null ? '' : String(value);
        const sanitized = this._sanitizeOrPassHTML(htmlValue);

        if (el.innerHTML !== sanitized) {
            this._updateHTMLWithPreservation(el, sanitized);

            // Rebind actions/models in the new DOM (deferred for re-entrancy safety)
            setTimeout(() => {
                this._bindComponentActions(instance);

                const modelElements = el.querySelectorAll(this._attrSelector('model'));
                modelElements.forEach(modelEl => {
                    if (this._getComponentElement(modelEl) === instance.element) {
                        this._bindModelElement(modelEl, instance);
                    }
                });

                this._scanForDynamicComponents();
            }, 0);
        }
    },

    /**
     * Execute data-show for Effect.
     * @private
     */
    _executeShowForEffect(meta, value, instance) {
        const el = meta.element;
        const shouldShow = meta.negate ? !value : Boolean(value);

        if (__FEATURE_TRANSITIONS__ && el.getAttribute && this._getAttr(el, 'transition')) {
            // Delegate to existing TransitionSystem with a minimal show-mode context
            if (this._handleTransitionedVisibilityChange) {
                const showContext = {
                    mode: 'show',
                    element: el,
                    _updateConditionalElement(isVisible) {
                        applyShow(el, isVisible);
                    }
                };
                this._handleTransitionedVisibilityChange(el, showContext, shouldShow, instance);
            }
            return;
        }

        applyShow(el, shouldShow);
    },

    /**
     * Execute non-list data-render for Effect. Inserts/removes the element from
     * the DOM on the boolean (vs data-show's display toggle), reusing the render
     * context's existing insert/remove machinery (_updateConditionalElement →
     * _updateRenderConditional). The value read happened in the effect loop
     * (establishing the graph edge); this only applies the verdict. An insert
     * re-clones the subtree and recreates this component's render effect, which
     * bumps instance._renderToken; the effect loop's post-render guard then bails.
     * @private
     */
    _executeRenderForEffect(meta, value, instance) {
        const ctx = meta.context;
        if (!ctx) return;
        const shouldRender = meta.negate ? !value : Boolean(value);

        if (__FEATURE_TRANSITIONS__) {
            const el = ctx.element || ctx.templateClone;
            if (this._handleTransitionedVisibilityChange && el && el.getAttribute && this._getAttr(el, 'transition')) {
                this._handleTransitionedVisibilityChange(el, ctx, shouldRender, instance);
                return;
            }
        }

        ctx._updateConditionalElement(shouldRender);
    },

    /**
     * Evaluate the visibility verdict for a cloaked element about to have its
     * data-cloak attribute stripped. Returns false when data-show resolves
     * falsy (element should be hidden), true otherwise (no data-show, truthy
     * verdict, or evaluation gave up: fail-open so we never accidentally hide
     * something the user expects to see).
     *
     * Used by the cloak-strip rAF in FrameworkInit and ComponentScanning to
     * commit the same display verdict the render effect would have written,
     * synchronously with attribute removal. Closes the race where a cloak
     * strip lands before the data-show binding effect has run (or has finished
     * re-running after init-time state mutations).
     *
     * Uses the SAME expression evaluator (`_resolveEffectExpression`) that the
     * render effect uses, so the verdict is identical to what a subsequent
     * effect run would produce, making the eventual effect re-run idempotent.
     * Outside an active effect context, reads do not register dependencies, so
     * this introduces no spurious tracking.
     *
     * @param {HTMLElement} el - Element with [data-cloak] about to be stripped
     * @returns {boolean} False if data-show is falsy (should hide), true otherwise
     * @private
     */
    _evaluateCloakShowVerdict(el) {
        const showAttr = this._getAttr ? this._getAttr(el, 'show') : el.getAttribute('data-show');
        if (!showAttr) return true;
        const componentEl = this._bindingScopeElement(el);
        if (!componentEl) return true;
        const componentId = componentEl.dataset && componentEl.dataset.componentId;
        if (!componentId) return true;
        const instance = this.componentInstances.get(componentId);
        if (!instance || !this._conditionVerdict) return true;
        try {
            return this._conditionVerdict(showAttr, instance, el);
        } catch (e) {
            // Fail open: don't hide if evaluation throws (preserves prior behavior
            // where show effect's `continue` left display unchanged on error).
            return true;
        }
    },

    /**
     * Strip data-cloak from an element, deferring if its nearest [data-component]
     * ancestor is registered but not yet initialized (no data-component-id).
     *
     * Late-registered components: defer-loaded scripts whose wildflower.component
     * call runs after the framework's initial scan; only initialize their DOM
     * elements when their definition is registered. If the cloak-strip rAF runs
     * before that registration, stripping cloak makes the element visible before
     * the render effect has had a chance to write display:none, causing the
     * "appear then hide" flash the user reported in Chrome.
     *
     * The deferred strip is picked up by the per-component pass in
     * _initializeComponentElement, which runs after the render effect's first
     * synchronous run has already set display correctly.
     *
     * When not deferred, commits the data-show visibility verdict (if present)
     * before removing the attribute. See _evaluateCloakShowVerdict for verdict
     * semantics.
     *
     * @param {HTMLElement} el - Element carrying [data-cloak]
     * @returns {boolean} True if the strip ran, false if it was deferred
     * @private
     */
    _stripCloakWithVerdict(el) {
        const componentEl = this._getComponentElement(el);
        if (componentEl && !(componentEl.dataset && componentEl.dataset.componentId)) {
            // Ancestor component is registered (has data-component) but not yet
            // initialized (no data-component-id). Skip; the per-component strip
            // pass after init will handle it.
            return false;
        }
        if (!this._evaluateCloakShowVerdict(el)) {
            if (el.style.display !== 'none') el.style.display = 'none';
        }
        el.removeAttribute('data-cloak');
        el.removeAttribute('data-wf-cloak');
        return true;
    },

    /**
     * Execute data-bind-class for Effect.
     * @private
     */
    _executeClassBindForEffect(meta, value) {
        // Friendly dev-mode shape check (WF-505): a COMPUTED (non-expression)
        // bound to data-bind-class should return a string, not an object. Warn
        // once per binding; applyClass still coerces truthy keys so the page keeps
        // rendering. An INLINE object expression (`{'is-active': cond}`) is the
        // supported form, so skip the warning for expression bindings.
        if (typeof __DEV__ !== 'undefined' && __DEV__ && !meta.isExpression && !meta._classShapeWarned
            && value && typeof value === 'object') {
            meta._classShapeWarned = true;
            wfError(WF_ERRORS.CLASS_BINDING_SHAPE, {
                context: 'computed returned an object; coercing truthy keys to a class string',
                suggestion: 'A computed should return a string. For inline expressions, write `data-bind-class="{\'is-active\': cond}"`.',
                warn: true
            });
        }

        // Canonical diff-tracking writer (preserves static / non-bound classes,
        // removes only keys that drop out): the same writer the per-row class
        // paths use, via the shared _prevBoundClasses tracking key.
        applyClass(meta.element, value);
    },

    /**
     * Execute data-bind-style for Effect.
     * @private
     */
    _executeStyleBindForEffect(meta, value, instance) {
        const el = meta.element;

        if (typeof value === 'object' && value !== null) {
            // Canonical style-object writer: same !important parsing, custom-property
            // handling, and stale-key cleanup as the list path (this path previously had
            // none of those: a !important value was silently dropped and dropped keys
            // left stale inline styles).
            applyStyleObj(el, value);
        } else if (value != null) {
            // Non-object value: emit the shape warning a per-binding setup write
            // used to emit. A bare CSS
            // string is still applied as cssText for back-compat.
            this._warnObjectBindingShape('style', el, value);
            if (typeof value === 'string') el.style.cssText = value;
        }
    },

    /**
     * Execute data-bind-attr for Effect.
     * @private
     */
    _executeAttrBindForEffect(meta, value, instance) {
        const el = meta.element;

        if (typeof value === 'object' && value !== null) {
            // Canonical attr-object writer: same blocklist/sanitize/boolean-attr
            // semantics and stale-key cleanup as the list rendering path.
            applyAttrObj(el, value, this._attrWriterHelpers || (this._attrWriterHelpers = {
                isBlocklisted: (prop) => this._isBlocklistedAttr && this._isBlocklistedAttr(prop),
                sanitize: (prop, v) => this._sanitizeAttrValue ? this._sanitizeAttrValue(prop, v) : v
            }));
        } else if (value != null) {
            // Non-object value: emit the shape warning a per-binding setup write
            // used to emit. data-bind-attr
            // has no string form, so this is warn-and-no-op.
            this._warnObjectBindingShape('attr', el, value);
        }
    },

    /**
     * Execute data-model state→DOM sync for Effect.
     * Only handles the state→DOM direction; DOM→state is event-driven
     * (handled by _bindModelElement's addEventListener setup).
     * @private
     */
    _executeModelBindForEffect(meta, value) {
        const el = meta.element;

        // Skip if element is focused AND the value matches what's already in the DOM.
        // This prevents cursor jumping during typing (where state→DOM sync would
        // move the cursor to the end on each keystroke). But when state is set to a
        // DIFFERENT value programmatically (e.g., clearing the input after form submit),
        // we must push the new value even while focused.
        if (document.activeElement === el) {
            const domValue = el.value;
            const stateStr = value == null ? '' : String(value);
            if (domValue === stateStr) return;
        }

        // Skip list items: handled by list rendering system
        if (listBoundElements.has(el)) return;

        // Web Component adapter
        if (meta._webComponentAdapter) {
            const tagName = el.tagName.toLowerCase();
            // Defer property push if custom element hasn't upgraded yet:
            // properties set before upgrade are shadowed by the class constructor.
            // After whenDefined, allow a frame for internal rendering (Lit-based etc).
            if (tagName.includes('-') && typeof customElements !== 'undefined' && !customElements.get(tagName)) {
                const adapter = meta._webComponentAdapter;
                customElements.whenDefined(tagName).then(() => {
                    const ready = adapter.ready ? adapter.ready(el) : new Promise(r => requestAnimationFrame(r));
                    ready.then(() => {
                        el[adapter.prop] = value;
                    });
                });
                return;
            }
            const currentVal = el[meta._webComponentAdapter.prop];
            if (currentVal !== value) {
                el[meta._webComponentAdapter.prop] = value;
            }
            return;
        }

        const kind = meta.isCheckbox ? 'checkbox'
            : meta.isRadio ? 'radio'
            : meta.isSelectMultiple ? 'select-multiple'
            : 'value';
        applyModel(el, value, kind);
    }
};
