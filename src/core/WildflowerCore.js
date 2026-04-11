/**
 * WildflowerJS Core
 *
 * Main class definition with constructor, configuration, and public API.
 * Additional methods are added via prototype mixins from other source files.
 *
 * @module
 */

// Import core dependencies
import { StoreManager } from '../state/StoreManager.js';

const WILDFLOWER_DEBUG = false;

// WF_ERRORS, wfError(), pathResolver, objectUtils, and arrayDetector are defined in wfUtils.js (loaded first in build)


export class WildflowerJS
{

    /**
     * Create a new WildflowerJS instance
     * @param {HTMLElement|Document|string} root - Root element, document, or selector for the app
     * @param {Object} options - Configuration options
     */
    constructor(root, options = {})
    {
        // Store reference to the root element
        this.root = typeof root === 'string' ? document.querySelector(root) : root;

        if (!this.root)
        {
            throw new Error(`Root element not found: ${root}`);
        }

        // Initialize options
        // In minified builds, __DEV__ is defined by Terser (true for dev, false for prod)
        // In unminified source, __DEV__ is undefined so we default to false
        // The ...options spread allows data-debug attribute to override this default
        this.options = {
            debug: typeof __DEV__ !== 'undefined' ? __DEV__ : false,
            autoInit: true,
            errorHandling: 'log', // 'log', 'throw', or 'silent'
            useWfPrefixOnly: false, // When true, only process data-wf-* attributes (ignore data-*)
            strictProps: false, // When true, throw on prop validation failures even in production
            subscribeTimeout: 5000, // Default timeout (ms) for waiting on subscribed stores
            forceCSPMode: false, // When true, always use CSP-safe expression evaluation
            htmlSanitizer: null, // Optional function to sanitize data-bind-html content
            ...options
        };

        // HTML sanitizer hook for data-bind-html (XSS protection)
        this._htmlSanitizer = this.options.htmlSanitizer || null;
        this._htmlSanitizerWarned = false;

        // =============================================================================
        // CSP Detection - MUST happen before ANY expression evaluation
        // This enables WildflowerJS to work in environments with strict Content Security
        // Policy headers that block `unsafe-eval`.
        // =============================================================================
        this._useCSPSafeEvaluation = this.options.forceCSPMode || this._detectCSPRestrictions();

        // Cache for AST-based evaluators when in CSP mode
        if (this._useCSPSafeEvaluation) {
            this._astCache = new Map();
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
                console.info('[WF] CSP-safe expression evaluation enabled');
            }
        }

        // Debug mode
        this.debug = this.options.debug;

        // Strict props mode (throw on validation failure even in production)
        this.strictProps = this.options.strictProps;

        // Track all registered components (definitions and instances)
        this.componentDefinitions = new Map();
        this.componentInstances = new Map();

        // Track active portals for cleanup - componentId -> [{ source, target, content }]
        // Only initialized when portal feature is enabled
        if (__FEATURE_PORTALS__) {
            this._activePortals = new Map();
        }

        // Track component hierarchy
        this.componentParents = new Map(); // child ID -> parent ID
        this.componentChildren = new Map(); // parent ID -> [child IDs]

        // Consolidated template cache - single structure for all template-related caching
        this._templateCache = {
            general: new Map(),       // General templates (was: this.templates)
            lists: new Map(),         // List-specific templates (was: this._listTemplates)
            compiled: new Map(),      // Pre-compiled template metadata (was: this._compiledTemplates)
            extracted: new Map(),     // Pre-extracted template content (was: this._extractedTemplateContent)
            fragmentPools: new Map(), // Pool of pre-cloned fragments (was: this._templateFragmentPools)
            stats: new Map()          // Pool statistics (was: this._templateStats)
        };
        this._listRelationships = new Map();

        // WeakMap for caching resolved configurable templates per list container
        // Using WeakMap allows automatic GC when list containers are removed from DOM
        this._resolvedTemplateCache = new WeakMap();

        this.contextRegistry = null; // Created by _ensureContextSystem()
        this._contextSystemInitialized = false;
        this._contextHierarchyDirty = false;

        // SSR support
        this.ssrManager = null;

        // DOM references for binding
        this.domElements = {
            bindings: [],
            conditionals: [],
            lists: [],
            models: [],
            pools: [],
        };

        // Store wrapped debounced/throttled handlers
        this._wrappedHandlers = new Map();

        // Hook for external code to prevent content updates (e.g., preserve syntax highlighting)
        this._beforeContentUpdateHooks = [];

        // Global error boundary handlers - called when errors bubble past all component boundaries
        this._globalErrorHandlers = [];

        // Event handlers
        this.eventHandlers = new Map();

        this._delegationState = new WeakMap();

        this._listParentCache = new WeakMap();

        // Store reference to RAF for cancellation
        this._renderScheduled = null;

        // Pool rendering loop state
        this._poolLoopRunning = false;
        this._poolLoopId = null;
        this._boundPoolLoopTick = null;

        // Flag to prevent HTML binding updates during component initialization
        this._isInitializingComponents = false;
        
        // Track which specific components are currently initializing (defers reactive updates during init)
        this._initializingComponentIds = new Set();

        // Queue for deferred reactive updates during component initialization
        this._deferredReactiveUpdates = new Map(); // componentId -> Array of {path, newValue, oldValue}

        // Deferred cleanup for better removal/clear performance
        // Context cleanup is deferred to requestIdleCallback so DOM removal appears instant
        this._deferredCleanupQueue = [];
        this._deferredCleanupScheduled = false;


        this.storeManager = new StoreManager(this);

        // Plugin system initialization (only when plugin feature is enabled)
        if (__FEATURE_PLUGINS__) {
            this._plugins = [];
            this._pluginsByName = new Map();
            this._customDirectives = new Map();
            this._directiveContexts = new WeakMap(); // element -> directive contexts
            this._hooks = new Map();
            this._pluginStates = new Map(); // Plugin reactive state storage
            this._providers = new Map(); // Service providers (for uses: [...])
        }
        // Entity dependents tracking is always needed (for stores and components)
        this._entityDependents = new Map(); // Unified entity->dependents tracking (components, stores, plugins)

        // Initialize when DOM is ready
        // IMPORTANT: Use requestAnimationFrame to ensure ALL synchronous scripts
        // (including those that create stores/components) complete before scanning.
        // This mirrors how WfBuilder.load() works: stores first, then components,
        // then DOM, then scan.
        const initAfterScripts = () => {
            requestAnimationFrame(() => {
                this._initialize();
            });
        };

        if (document.readyState === 'loading')
        {
            document.addEventListener('DOMContentLoaded', initAfterScripts);
        } else
        {
            initAfterScripts();
        }

        this._setupDynamicComponentDetection();


        this._expressionEvaluator = new Map(); // Stores pre-bound evaluators

        // Reserved words for expression evaluation (should not be extracted as state variables)
        this._expressionReservedWords = new Set([
            'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
            'if', 'else', 'return', 'typeof', 'instanceof', 'new', 'this',
            'Math', 'Date', 'String', 'Number', 'Boolean', 'Array', 'Object'
            // NOTE: 'external' is NOT reserved - it needs to be passed to compiled expressions
        ]);

        // Pre-initialize all lazily-created properties to stabilize V8 hidden class.
        // These are used across prototype mixins (EntitySystem, RenderingCore,
        // ComponentLifecycle, PropsSystem). Initializing here avoids hidden class
        // transitions when first assigned on hot paths.
        this._renderCounter = 0;
        this._bindingUpdateCount = 0;
        this._deferredComputedClassElements = new Set();
        this._expressionCache = new Map();
        this._componentsToUpdate = new Set();
        this._contextsToUpdate = new Set();
        this._externalDependencies = new Map();
        this._pendingStateChanges = new Set();
        this._updatedPaths = new Set();
        this._notifyingPaths = new Set();
        this._initialRenderQueue = new Set();
        this._batchListUpdates = new Map();
        this._instanceIdCounter = 0;

        // Web Component adapter registry
        // Maps custom element tag names to { prop, event } configurations
        this._webComponentAdapters = new Map();
    }


    /**
     * Get attribute value checking both standard and wf-prefixed versions
     * @param {HTMLElement} el - Element to check
     * @param {string} baseName - Base attribute name (e.g., 'bind', 'action', 'component')
     * @returns {string|null} - Attribute value or null if not present
     * @private
     */
    _getAttr(el, baseName) {
        // In exclusive mode, only check wf-prefixed attributes
        if (this.options.useWfPrefixOnly) {
            return el.getAttribute(`data-wf-${baseName}`);
        }
        // Default: Check wf-prefixed version first (explicit namespace takes precedence)
        return el.getAttribute(`data-wf-${baseName}`) || el.getAttribute(`data-${baseName}`);
    }

    /**
     * Check if element has either standard or wf-prefixed attribute
     * @param {HTMLElement} el - Element to check
     * @param {string} baseName - Base attribute name (e.g., 'bind', 'action', 'component')
     * @returns {boolean} - True if element has either version of the attribute
     * @private
     */
    _hasAttr(el, baseName) {
        // In exclusive mode, only check wf-prefixed attributes
        if (this.options.useWfPrefixOnly) {
            return el.hasAttribute(`data-wf-${baseName}`);
        }
        // Default: Check both
        return el.hasAttribute(`data-wf-${baseName}`) || el.hasAttribute(`data-${baseName}`);
    }

    /**
     * Generate CSS selector matching both standard and wf-prefixed attributes
     * @param {string} baseName - Base attribute name (e.g., 'bind', 'action', 'component')
     * @param {string} [value] - Optional attribute value to match
     * @returns {string} - CSS selector string
     * @private
     */
    _attrSelector(baseName, value) {
        // In exclusive mode, only generate wf-prefixed selector
        if (this.options.useWfPrefixOnly) {
            return value !== undefined
                ? `[data-wf-${baseName}="${value}"]`
                : `[data-wf-${baseName}]`;
        }
        // Default: Generate selector for both prefixes
        if (value !== undefined) {
            return `[data-${baseName}="${value}"],[data-wf-${baseName}="${value}"]`;
        }
        return `[data-${baseName}],[data-wf-${baseName}]`;
    }

    /**
     * Register a Web Component adapter for data-model and data-bind integration.
     * Adapters map custom element tag names to their value property and change event.
     * @param {string} tagName - Custom element tag name (e.g., 'sl-input')
     * @param {Object} config - Adapter configuration
     * @param {string} [config.prop='value'] - JS property name for reading/writing the element's value
     * @param {string} [config.event='input'] - Event name fired when the element's value changes
     */
    registerAdapter(tagName, config) {
        this._webComponentAdapters.set(tagName.toLowerCase(), {
            prop: config.prop || 'value',
            event: config.event || 'input'
        });
    }

    /**
     * Get a Web Component adapter by tag name.
     * Returns a registered adapter if one exists, otherwise auto-detects
     * a smart default for custom elements based on element capabilities.
     * @param {string} tagName - Custom element tag name
     * @param {HTMLElement} [element] - Optional element instance for auto-detection
     * @returns {Object|undefined} Adapter config or undefined
     */
    getAdapter(tagName, element) {
        tagName = tagName.toLowerCase();
        const registered = this._webComponentAdapters.get(tagName);
        if (registered) return registered;

        // Smart default for unregistered custom elements:
        // Auto-detect property based on element capabilities.
        // Most web component libraries use native input/change events
        // and standard value/checked properties.
        if (element && tagName.includes('-')) {
            if (typeof element.checked === 'boolean') {
                return { prop: 'checked', event: null };
            }
            if ('value' in element) {
                return { prop: 'value', event: null };
            }
            // Fallback: check the registered class prototype.
            // Elements cloned from <template> may not be upgraded yet,
            // so instance property checks above fail. Check the class directly.
            const Ctor = customElements.get(tagName);
            if (Ctor) {
                const proto = Ctor.prototype;
                if ('checked' in proto && typeof proto.checked !== 'undefined') {
                    return { prop: 'checked', event: null };
                }
                if ('value' in proto) {
                    return { prop: 'value', event: null };
                }
            }
        }
        return undefined;
    }

    /**
     * Get or set framework configuration options
     * @param {Object} [newOptions] - Options to merge with current config (optional)
     * @returns {Object} Current configuration options
     *
     * @example
     * // Get current config
     * const config = wildflower.config();
     *
     * @example
     * // Set config options
     * wildflower.config({ subscribeTimeout: 10000 });
     */
    config(newOptions) {
        if (newOptions && typeof newOptions === 'object') {
            // Merge new options with existing
            Object.assign(this.options, newOptions);
        }
        // Return a copy of current options
        return { ...this.options };
    }


    /**
     * Set a sanitizer function for data-bind-html content.
     * When configured, all HTML content rendered via data-bind-html will be
     * passed through this function before being set as innerHTML.
     *
     * @param {Function|null} fn - Sanitizer function that accepts an HTML string
     *   and returns a sanitized HTML string, or null to disable sanitization.
     *
     * @example
     * // Using DOMPurify
     * wildflower.setHtmlSanitizer(html => DOMPurify.sanitize(html));
     *
     * @example
     * // Clear sanitizer
     * wildflower.setHtmlSanitizer(null);
     */
    setHtmlSanitizer(fn) {
        this._htmlSanitizer = typeof fn === 'function' ? fn : null;
    }

    /**
     * Sanitize HTML content or pass through unchanged.
     * If a sanitizer is configured, routes content through it.
     * In dev mode, logs a one-time warning when no sanitizer is set.
     *
     * @param {string} htmlValue - The HTML string to sanitize
     * @returns {string} Sanitized (or unchanged) HTML string
     * @private
     */
    _sanitizeOrPassHTML(htmlValue) {
        if (this._htmlSanitizer) {
            return this._htmlSanitizer(htmlValue);
        }
        // Dev-mode one-time warning
        if (!this._htmlSanitizerWarned && typeof __DEV__ !== 'undefined' && __DEV__) {
            this._htmlSanitizerWarned = true;
            console.warn(
                '[WF] data-bind-html is rendering unsanitized HTML. ' +
                'To prevent XSS, configure a sanitizer: wildflower.setHtmlSanitizer(html => DOMPurify.sanitize(html))'
            );
        }
        return htmlValue;
    }

    /**
     * Generate a unique ID for component instances
     * @private
     */
    _generateInstanceId(componentName)
    {
        return `${componentName}-${++this._instanceIdCounter}`;
    }


    /**
     * Log a message with the specified level
     * @private
     */
    _log(level, ...args)
    {
        if (!WILDFLOWER_DEBUG && level === 'debug') return;

        const prefix = `[WF] `;

        switch (level)
        {
            case 'error':
                console.error(prefix, ...args);
                break;
            case 'warn':
                console.warn(prefix, ...args);
                break;
            case 'info':
            case 'debug':
            default:
                if (WILDFLOWER_DEBUG)
                {
                    console.log(prefix, ...args);
                }
        }
    }

    /**
     * Log an error with structured error code, context, and suggestions.
     * Delegates to the global wfError() function defined in wfUtils.js
     *
     * @param {Object} errorDef - Error definition from WF_ERRORS
     * @param {Object} options - Additional error context
     * @private
     */
    _error(errorDef, options = {}) {
        wfError(errorDef, options);
    }

    /**
     * Detect if Content Security Policy restricts dynamic code execution.
     * This must be called before any expression evaluation to enable CSP-safe mode.
     *
     * @returns {boolean} True if CSP blocks `new Function()`, false otherwise
     * @private
     */
    _detectCSPRestrictions() {
        try {
            // Attempt to create a simple function dynamically
            // If CSP blocks unsafe-eval, this will throw
            new Function('return true')();
            return false; // CSP allows new Function
        } catch (e) {
            // CSP is blocking dynamic code execution
            return true;
        }
    }



    // Set up list contexts when a component is initialized
    _setupListContexts(instance)
    {
        if (!instance)
        {
            return;
        }

        // Ensure context system is initialized
        this._ensureContextSystem();

        // Initialize context collection
        if (!instance._listContexts)
        {
            instance._listContexts = new Map();
        }

        let relationships = [];
        try {
            if (this._contextRegistry && this._contextRegistry.detectTemplateRelationships) {
                relationships = this._contextRegistry.detectTemplateRelationships(instance.element);
            }
        } catch (error) {
            if (__DEV__) console.error('ERROR detecting template relationships:', error);
        }

        // Register these relationships in our registry
        relationships.forEach(({parentPath, childPath}) =>
        {
            if (!this._listRelationships.has(parentPath))
            {
                this._listRelationships.set(parentPath, new Set());
            }

            this._listRelationships.get(parentPath).add(childPath);
        });

        // Find ALL list elements including those in templates for proper discovery
        // First find all templates
        const templates = instance.element.querySelectorAll('template');
        const listsInTemplates = [];

        // Search inside template content for nested lists
        templates.forEach(template => {
            const nestedLists = template.content.querySelectorAll(this._attrSelector('list'));
            nestedLists.forEach(list => listsInTemplates.push(list));
        });

        // Find all visible lists
        const visibleListsNodeList = instance.element.querySelectorAll(this._attrSelector('list'));

        const allLists = Array.from(visibleListsNodeList)
            .filter(el =>
            {
                // Only include lists that belong to this component
                // IMPORTANT: Use [data-component] not [data-component-id] because nested
                // components may not have been assigned their ID yet during init
                const closestComponentEl = el.closest('[data-component], [data-wf-component]');
                return closestComponentEl === instance.element;
            });

        // Separate visible lists from template lists for different handling
        const visibleLists = allLists.filter(el => !el.closest('template'));
        // Use the lists we found inside templates
        const templateLists = listsInTemplates;

        // Create contexts for visible lists
        visibleLists.forEach(listElement =>
        {
            const listPath = listElement.dataset.list;
            if (!listPath) return;

            // Skip if context already exists for this list
            if (listElement._listContext || instance._listContexts.has(listPath)) {
                return;
            }

            // Get data for this list
            let data;

            // Normalize $store.path shorthand to external() before processing
            const normalizedPath = listPath.includes('$') && this._normalizeStoreShorthands
                ? this._normalizeStoreShorthands(listPath)
                : listPath;

            if (normalizedPath.startsWith('computed:')) {
                data = instance.stateManager.evaluateComputed(normalizedPath.slice(9));
            } else if (normalizedPath.includes('external(')) {
                // Handle external() expressions for store data
                if (this._getExternalFn) {
                    try {
                        data = this.evaluateExpression(normalizedPath, instance.state, {
                            cacheKey: 'listInit',
                            additionalContext: { external: this._getExternalFn(instance) }
                        });
                    } catch (error) {
                        if (__DEV__) console.warn(`Error evaluating external list path "${normalizedPath}":`, error);
                        data = [];
                    }
                } else {
                    data = [];
                }
            } else {
                data = instance.stateManager.getValue(normalizedPath);
            }

            // Use _createListContext (not registry.createListContext directly)
            // This ensures proper prototype setup and registration
            const context = this._createListContext(
                listPath,
                data,
                instance,
                null  // parent context
            );

            // Store on element for fast lookup
            if (context) {
                listElement._listContext = context;
                context.element = listElement;
            }
        });

        // Pre-create contexts for lists in templates (nested lists)
        // These will be placeholder contexts that get populated during rendering
        templateLists.forEach(listElement =>
        {
            const listPath = listElement.dataset.list;
            if (!listPath) return;

            // For lists in templates, we don't have data yet, but we can prepare the structure
            // The actual data and parent relationships will be set during parent item rendering
            // Mark this as a template list that needs special handling
            listElement._isTemplateList = true;
            listElement._componentInstance = instance;
        });
    }

    // Handle state changes that affect lists
    _handleListStateChange(instanceId, path, newValue, _oldValue)
    {
        const instance = this.componentInstances.get(instanceId);
        if (!instance) {
            return false;
        }

        // Handle computed property changes that directly affect lists
        // When a computed property like 'computed:cartItems' changes, update the corresponding list context
        if (path.startsWith('computed:')) {
            if (instance._listContexts && instance._listContexts.has(path)) {
                const context = instance._listContexts.get(path);
                if (context) {
                    // Update the list with the new computed value
                    context.updateData(Array.isArray(newValue) ? newValue : []);

                    // Queue for render
                    this._contextsToUpdate.add(context);
                    this._scheduleRender();
                    return true;
                }
            }
            // No list bound to this computed property
            return false;
        }

        // Check for context system usage
        if (!this._contextSystemInitialized)
        {
            // Fall back to original implementation if context system not used
            return false;
        }

        // Track affected contexts
        let contextsAffected = false;
        const affectedContexts = new Set();

        // Check if this path change affects any computed property that a list depends on
        // This enables reactive updates for computed lists when their internal dependencies change
        if (instance._listContexts && instance.stateManager) {
            instance._listContexts.forEach((context, contextPath) => {
                // Only check computed lists
                if (contextPath.startsWith('computed:')) {
                    const computedName = contextPath.slice(9); // Remove 'computed:' prefix

                    // Check if this computed property depends on the changed path
                    const deps = instance.stateManager.computedDependencies?.get(path);
                    if (deps && deps.has(computedName)) {
                        // The changed path is a dependency of this computed property
                        // Re-evaluate the computed property and update the list
                        const freshData = instance.stateManager.evaluateComputed(computedName);
                        context.updateData(Array.isArray(freshData) ? freshData : []);
                        contextsAffected = true;
                        affectedContexts.add(context);
                    }
                }
            });
        }

        // Check component's contexts
        if (instance._listContexts && instance._listContexts.size > 0)
        {
            // Check each context for potential impact
            instance._listContexts.forEach((context, contextPath) =>
            {
                // Direct list data update
                if (contextPath === path)
                {
                    if (context._cache)
                    {
                        context._cache.clear();
                    }

                    // Update context data
                    context.updateData(Array.isArray(newValue) ? newValue : []);
                    contextsAffected = true;
                    affectedContexts.add(context);
                }
                // PERFORMANCE FIX: Precise nested list matching (replacing broad path.endsWith())
                else if (this._isNestedListUpdate(path, contextPath)) 
                {
                    // This handles nested lists like categories[0].items
                    // Get fresh data directly from component state instead of stale context resolution
                    const fullContextPath = context.getFullPath();

                    const dotNotationPath = fullContextPath.replace(/\[(\d+)]/g, '.$1');

                    const freshData = instance.stateManager.getValue(dotNotationPath);

                    context.updateData(Array.isArray(freshData) ? freshData : []);
                    contextsAffected = true;
                    affectedContexts.add(context);
                }
                else if (path.startsWith(`${contextPath}.`))
                {
                    // Only update for structural changes, not property changes
                    const subPath = path.substring(contextPath.length + 1);

                    // OPTIMIZATION: Skip length notification for clear operations
                    // When array is cleared (rows = []), we get TWO notifications:
                    // 1. 'rows' with newValue = [] (direct match, handles the clear)
                    // 2. 'rows.length' with newValue = 0 (length notification, redundant!)
                    // Skip #2 since #1 already cleared the list
                    if (subPath === 'length' && context.data && context.data.length === 0) {
                        // List was already cleared by the direct 'rows' notification
                        // Skip this redundant length notification
                        return;
                    }

                    // Process structural changes AND item-level changes:
                    // - length changes (array size modified)
                    // - splice operations
                    // - item-level changes (e.g., "0", "10" - numeric indices)
                    // - ALSO handle property changes within items (e.g., "0.label", "1.name") for direct mutations
                    if (subPath === 'length' || subPath === 'splice' || subPath.startsWith('splice.') ||
                        subPath.match(/^\d+$/) || subPath.match(/^\d+\./))
                    {
                        const fullContextPath = context.getFullPath();
                        const dotNotationPath = fullContextPath.replace(/\[(\d+)]/g, '.$1');

                        // Check if there's a pending optimization (append, swap, or sparse-update)
                        const pendingOp = instance?.stateManager?._arrayOperations?.get(dotNotationPath);
                        const hasOptimization = pendingOp && (
                            pendingOp.type === 'append' ||
                            pendingOp.type === 'swap' ||
                            pendingOp.type === 'sparse-update'
                        );

                        if (!hasOptimization) {
                            // No optimization available, do full update
                            const freshData = instance.stateManager.getValue(dotNotationPath);
                            context.updateData(Array.isArray(freshData) ? freshData : []);
                        }
                        // Either way, mark context as affected so it gets processed
                        contextsAffected = true;
                        affectedContexts.add(context);
                    }
                }
            });
        }

        // Schedule updates for affected contexts
        if (contextsAffected && !this._batchMode)
        {
            affectedContexts.forEach(context =>
            {
                this._contextsToUpdate.add(context);
            });

            // Schedule render
            this._scheduleRender();
        }

        return contextsAffected;
    }

    // Helper method for precise nested list update detection
    // PERF: Uses string operations instead of regex allocation (hot path optimization)
    _isNestedListUpdate(path, contextPath) {
        // Check for patterns like: "categories.0.items" where contextPath is "items"
        // This should match parent[index].contextPath but NOT unrelated paths
        // Pattern: .<digit(s)>.<contextPath> at end of path

        // Fast fail: path must end with contextPath
        if (!path.endsWith(contextPath)) return false;

        // Get the position before contextPath
        const prefixLength = path.length - contextPath.length;
        if (prefixLength < 3) return false; // Need at least ".0."

        // Check for dot before contextPath (charCode 46 = '.')
        if (path.charCodeAt(prefixLength - 1) !== 46) return false;

        // Find where the index digits end and scan backwards for digits
        let indexEnd = prefixLength - 2;
        let indexStart = indexEnd;

        // Scan backwards for digits (charCodes 48-57 = '0'-'9')
        while (indexStart >= 0) {
            const charCode = path.charCodeAt(indexStart);
            if (charCode < 48 || charCode > 57) break;
            indexStart--;
        }

        // Must have at least one digit
        if (indexStart === indexEnd) return false;

        // Must have a dot before the digits
        if (indexStart < 0 || path.charCodeAt(indexStart) !== 46) return false;

        return true;
    }

    // ========================================================================
    // STORE FUNCTIONALITY
    // ========================================================================

    /**
     * Create a new reactive store for global state management.
     *
     * Stores are like components without DOM elements - they provide reactive
     * state that can be accessed from any component via `this.store()` or
     * `this.external()`.
     *
     * Store definitions follow the same pattern as components:
     * - `state`: Initial reactive state object
     * - `computed`: Computed properties derived from state
     * - `watch`: Watchers for state changes
     * - `init()`: Initialization lifecycle hook
     * - Custom methods at the top level (not in an actions block)
     *
     * @param {string} name - Unique name for the store
     * @param {Object} config - Store configuration object
     * @param {Object} [config.state] - Initial reactive state
     * @param {Object} [config.computed] - Computed property functions
     * @param {Object} [config.watch] - Watch handlers for state paths
     * @param {Function} [config.init] - Initialization hook
     * @returns {Object} Store context with state, methods, and utilities
     *
     * @example
     * // Create a cart store
     * const cart = wildflower.store('cart', {
     *   state: {
     *     items: [],
     *     total: 0
     *   },
     *   computed: {
     *     itemCount() { return this.state.items.length; }
     *   },
     *   addItem(item) {
     *     this.state.items.push(item);
     *     this.state.total += item.price;
     *   }
     * });
     *
     * @example
     * // Access store from component
     * wildflower.component('cart-button', {
     *   computed: {
     *     count() { return this.store('cart', 'itemCount'); }
     *   }
     * });
     */
    store(name, config = {})
    {
        return this.storeManager.store(name, config);
    }

    /**
     * Get an existing store by name.
     *
     * @param {string} [name='app-store'] - Name of the store to retrieve
     * @returns {Object|undefined} The store context, or undefined if not found
     *
     * @example
     * const cart = wildflower.getStore('cart');
     * console.log(cart.state.items);
     *
     * @example
     * // Access default app store
     * const appStore = wildflower.getStore();
     */
    getStore(name = 'app-store')
    {
        return this.storeManager.getStore(name);
    }

    // method for tests
    _forceCompleteRender()
    {

        // Cancel any pending render
        if (this._renderScheduled)
        {
            cancelAnimationFrame(this._renderScheduled);
            this._renderScheduled = null;
        }

        // Force render now
        if (typeof this._render === 'function')
        {
            this._render();
        }

        // Return a promise for async usage
        return Promise.resolve();
    }

    /**
     * Returns a promise that resolves when the framework has finished processing
     * all pending work: microtask effect flushes, rAF render cycles, and pool
     * flushes. Use in tests instead of arbitrary setTimeout waits, or in app
     * code when you need to read DOM after a state change.
     *
     * @returns {Promise<void>} Resolves when all pending updates are applied
     * @public
     */
    whenSettled()
    {
        return new Promise(resolve => {
            // The framework has four async layers that must all drain:
            //
            //   1. Microtask queue  — EffectScheduler.flush() is scheduled here
            //   2. setTimeout(0)    — Component init() is deferred here
            //   3. rAF              — _scheduleRender and pool flushes fire here
            //   4. Final microtask  — Effects triggered by render/pool flush
            //
            // We chain through all four layers so the returned promise
            // resolves only after the entire pipeline has quiesced.
            queueMicrotask(() => {
                setTimeout(() => {
                    requestAnimationFrame(() => {
                        queueMicrotask(resolve);
                    });
                }, 0);
            });
        });
    }

    /**
     * Get a component instance by its ID.
     * @param {string} componentId - The component's unique identifier
     * @returns {Object|undefined} The component instance, or undefined if not found
     * @public
     */
    getComponentInstance(componentId) {
        return this.componentInstances.get(componentId);
    }

    /**
     * Check if a component instance exists.
     * @param {string} componentId - The component's unique identifier
     * @returns {boolean} True if the component exists
     * @public
     */
    hasComponentInstance(componentId) {
        return this.componentInstances.has(componentId);
    }

    /**
     * Dispose the framework instance and release all resources.
     * Clears intervals, disposes registries, and removes event listeners.
     * @private
     */
    _dispose() {
        // Stop pool rendering loop
        if (this._poolLoopRunning) {
            this._poolLoopRunning = false;
            if (this._poolLoopId) {
                cancelAnimationFrame(this._poolLoopId);
                this._poolLoopId = null;
            }
        }

        // Dispose context registry (clears its GC interval)
        if (this._contextRegistry && this._contextRegistry.dispose) {
            this._contextRegistry.dispose();
        }
    }

    /**
     * Inspect the application or a specific component type.
     *
     * Called with no arguments, prints a full application summary (components,
     * stores, counts) and returns { components, stores }.
     *
     * Called with a component name string, lists all instances of that component
     * with their DOM elements and state, and returns the instances array.
     *
     * @param {string} [componentName] - Optional component name to inspect
     * @returns {Object|Array} Application summary object, or array of instances
     *
     * @example
     * wildflower.inspect()          // full app summary
     * wildflower.inspect('kpi-widget')  // all instances of kpi-widget
     *
     * @public
     */
    inspect(componentName) {
        // --- Single component inspection ---
        if (componentName) {
            const instances = [];
            this.componentInstances.forEach((instance) => {
                if (instance.isVirtual) return;
                if (instance.name === componentName) {
                    instances.push(instance);
                }
            });

            console.warn(`[Wildflower] Inspecting: ${componentName} (${instances.length} instance${instances.length !== 1 ? 's' : ''})`);

            if (instances.length === 0) {
                console.warn('  No instances found.');
                return [];
            }

            instances.forEach((instance, i) => {
                const el = instance.element || instance.rootElement;
                const ctx = instance.context;
                console.warn(`  #${i + 1}`, el || '(no element)');
                if (ctx && ctx._state) {
                    const { _internal, ...visibleState } = ctx._state;
                    console.warn('     state:', visibleState);
                }
            });

            return instances;
        }

        // --- Full application inspection ---
        const componentCounts = {};
        let totalInstances = 0;

        this.componentInstances.forEach((instance) => {
            if (instance.isVirtual) return;
            const name = instance.name || 'unknown';
            componentCounts[name] = (componentCounts[name] || 0) + 1;
            totalInstances++;
        });

        const componentNames = Object.keys(componentCounts);
        const componentCount = componentNames.length;

        const storeNames = [];
        const storeStates = {};

        if (this.storeManager && this.storeManager._namedStores) {
            this.storeManager._namedStores.forEach((store, name) => {
                storeNames.push(name);
                if (store.state) {
                    const { _internal, ...visibleState } = store.state;
                    storeStates[name] = visibleState;
                }
            });
        }

        const storeCount = storeNames.length;

        // --- Output ---
        console.warn('[Wildflower] Application Inspector');

        console.warn('  Components');
        if (componentCount > 0) {
            const tableData = componentNames.map(name => ({
                Component: name,
                Instances: componentCounts[name]
            }));
            console.table(tableData);
        } else {
            console.warn('    (none)');
        }

        console.warn('  Stores');
        if (storeCount > 0) {
            storeNames.forEach(name => {
                console.warn(`    ${name}:`, storeStates[name]);
            });
        } else {
            console.warn('    (none)');
        }

        const compWord = componentCount === 1 ? 'component' : 'components';
        const instWord = totalInstances === 1 ? 'instance' : 'instances';
        const storeWord = storeCount === 1 ? 'store' : 'stores';
        console.warn(
            `  Summary: ${componentCount} ${compWord} (${totalInstances} ${instWord}), ${storeCount} ${storeWord}`
        );

        return { components: componentCounts, stores: storeStates };
    }


}

// Additional methods are added via Object.assign from mixin files
