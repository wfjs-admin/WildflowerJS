/**
 * RouteManager — Client-side SPA routing with history/hash mode,
 * route guards, lazy loading, and deep framework integration.
 *
 * Architecture:
 *
 *   Browser URL Change                    navigate() Call
 *         │                                     │
 *         ▼                                     ▼
 *   ┌─────────────┐                     ┌─────────────────┐
 *   │ popstate or │                     │ Named route or  │
 *   │ hashchange  │                     │ path string     │
 *   └──────┬──────┘                     └────────┬────────┘
 *          │                                     │
 *          └──────────────┬──────────────────────┘
 *                         ▼
 *              ┌─────────────────────┐
 *              │    URLParser        │
 *              │  parse(location)    │
 *              └──────────┬──────────┘
 *                         ▼
 *              ┌─────────────────────┐
 *              │  _matchAndExecute() │
 *              │  Pattern matching   │
 *              └──────────┬──────────┘
 *                         ▼
 *          ┌──────────────┼──────────────┐
 *          ▼              ▼              ▼
 *   ┌────────────┐ ┌────────────┐ ┌────────────┐
 *   │ beforeEach │ │ beforeEnter│ │  handler() │
 *   │  guards    │ │   guard    │ │ component  │
 *   └────────────┘ └────────────┘ └────────────┘
 *          │              │              │
 *          └──────────────┼──────────────┘
 *                         ▼
 *              ┌─────────────────────┐
 *              │  Update browser     │
 *              │  history/hash       │
 *              └──────────┬──────────┘
 *                         ▼
 *              ┌─────────────────────┐
 *              │  Dispatch events    │
 *              │  route:afterChange  │
 *              └─────────────────────┘
 *
 * Route patterns:
 * - Static:    /users, /about
 * - Dynamic:   /users/:id, /posts/:slug
 * - Optional:  /users/:id?, /docs/:section?
 * - Wildcard:  /docs/*, * (catch-all)
 * - Nested:    /admin { children: [{ path: '/users' }] }
 *
 * Guard system (return-based):
 * - return undefined/true  → Allow navigation
 * - return false           → Block navigation
 * - return '/path'         → Redirect to path
 * - return { path, query } → Redirect with options
 *
 * Events dispatched:
 * - route:beforeChange  → Cancelable via preventDefault()
 * - route:afterChange   → Navigation complete
 * - route:redirect      → Redirect occurred
 * - route:error         → Navigation failed
 *
 * @example Basic Setup:
 * ```javascript
 * const router = new RouteManager({ mode: 'history', base: '/' });
 *
 * router.onRoute('/', { handler: () => showHome() });
 * router.onRoute('/users/:id', {
 *     name: 'user-detail',
 *     handler: ({ params }) => showUser(params.id)
 * });
 *
 * router.init();
 * ```
 *
 * @example Centralized Config (Symfony-style):
 * ```javascript
 * const router = new RouteManager({
 *     routes: [
 *         { path: '/', name: 'home', handler: showHome },
 *         { path: '/users/:id', name: 'user', handler: showUser },
 *         { path: '/admin', beforeEnter: requireAuth, children: [
 *             { path: '/users', name: 'admin-users', handler: showAdminUsers }
 *         ]}
 *     ]
 * });
 * ```
 *
 * @example Route Guards:
 * ```javascript
 * router.beforeEach(({ to, from }) => {
 *     if (to.meta.requiresAuth && !isLoggedIn()) {
 *         return '/login';  // Redirect
 *     }
 *     // Allow navigation (return nothing)
 * });
 *
 * router.onRoute('/admin', {
 *     beforeEnter: ({ to }) => {
 *         if (!isAdmin()) return false;  // Block
 *     }
 * });
 * ```
 *
 * @example Named Navigation:
 * ```javascript
 * router.navigate({ name: 'user-detail', params: { id: 123 } });
 * router.getRouteUrl('user-detail', { id: 123 }, { tab: 'posts' });
 * // → "/users/123?tab=posts"
 * ```
 *
 * @example Component Integration:
 * ```javascript
 * wildflower.component('my-view', {
 *     onRouteChange(to, from) {
 *         // Called on every navigation
 *         this.state.currentPath = to.path;
 *     }
 * });
 * ```
 *
 * @module RouteManager
 * @requires wfUtils.js - Error codes (WF_ERRORS, wfError, wfWarn)
 */
const NAVIGATION_SETTLE_MS = 50; // Delay for DOM/async operations to settle before navigation
const PUSH_TO_HISTORY = true;
const NO_PUSH_TO_HISTORY = false;

export class RouteManager {
    constructor(options = {}) {
        this.options = {
            mode: 'history',        // 'history' or 'hash'
            base: '/',              // Base path for app
            defaultRoute: '/',      // Fallback route
            scrollBehavior: null,   // Scroll behavior function
            loadingTimeout: 5000,   // Timeout for component loading (ms)
            onLoadingStart: null,   // Callback when component loading starts
            onLoadingEnd: null,     // Callback when component loading ends
            onLoadingError: null,   // Callback when component loading fails
            onLoadingTimeout: null, // Callback when component loading times out
            // View Transitions API options
            viewTransitions: false, // Enable View Transition API integration
            transitionClass: null,  // Custom CSS class for transitions
            transitionDuration: null, // Optional duration hint for transitions
            outlet: null,           // Router outlet selector for content updates
            ...options
        };

        // Route storage
        this._namedRoutes = new Map();  // Named route lookup: name -> route
        this.routeTree = [];            // Priority-ordered routes for matching

        // Public routes Map getter (for API consistency with tests)
        Object.defineProperty(this, 'routes', {
            get: () => this._namedRoutes,
            enumerable: true
        });

        // State
        this.currentRoute = null;       // Current route object
        this.previousRoute = null;      // Previous route for from/to tracking
        this.isInitialized = false;

        // Guards
        this.guards = {
            beforeEach: [],             // Global before guards
            afterEach: []               // Global after hooks
        };

        // Navigation state
        this.isNavigating = false;      // Prevent concurrent navigations
        this._navigationAborted = false; // Abort flag for in-progress navigation

        // View Transitions state
        this.currentTransition = null;  // Current ViewTransition object (null when not transitioning)
        this._eventListeners = new Map(); // Event listeners for view transition events

        // URL parser
        this.urlParser = new URLParser(this.options.base, this.options.mode);

        // Bind methods
        this._handlePopState = this._handlePopState.bind(this);
        this._handleHashChange = this._handleHashChange.bind(this);
        this._handleLinkClick = this._handleLinkClick.bind(this);

        // Process centralized route configuration if provided
        if (options.routes && Array.isArray(options.routes)) {
            this.loadRoutes(options.routes);
        }
    }

    /**
     * Load routes from a configuration array (Symfony-style centralized config)
     * @param {Array} routes - Array of route configuration objects
     * @returns {RouteManager} - Returns this for chaining
     *
     * Route config format:
     * {
     *   path: '/users/:id',      // Required: URL pattern
     *   name: 'user-detail',     // Optional: Named route identifier
     *   handler: Function,       // Optional: Route handler function
     *   component: Function,     // Optional: Lazy-loaded component
     *   meta: Object,            // Optional: Route metadata
     *   beforeEnter: Function,   // Optional: Per-route guard
     *   redirect: String,        // Optional: Redirect target
     *   alias: String|Array,     // Optional: Route aliases
     *   defaults: Object,        // Optional: Default parameter values
     *   children: Array          // Optional: Nested routes
     * }
     */
    loadRoutes(routes) {
        for (const routeConfig of routes) {
            if (!routeConfig.path) {
                wfWarn('Route config missing "path", skipping', routeConfig);
                continue;
            }

            // Convert path to pattern (routes config uses 'path', onRoute uses pattern)
            const pattern = routeConfig.path;

            // Build config object for onRoute
            const config = {
                name: routeConfig.name,
                handler: routeConfig.handler,
                component: routeConfig.component,
                meta: routeConfig.meta || {},
                beforeEnter: routeConfig.beforeEnter,
                beforeLeave: routeConfig.beforeLeave,
                redirect: routeConfig.redirect,
                alias: routeConfig.alias,
                children: routeConfig.children,
                defaults: routeConfig.defaults,
                transition: routeConfig.transition  // Per-route transition config
            };

            // Register the route
            this.onRoute(pattern, config);
        }

        return this;
    }

    // ==================== VIEW TRANSITIONS API ====================

    /**
     * Check if the View Transition API is available in the browser
     * @returns {boolean} - True if browser supports View Transitions
     */
    get viewTransitionsAvailable() {
        return typeof document.startViewTransition === 'function';
    }

    /**
     * Check if view transitions are currently enabled
     * This is true only when the option is enabled AND browser supports it
     * @returns {boolean}
     */
    get viewTransitionsEnabled() {
        return this.options.viewTransitions && this.viewTransitionsAvailable;
    }

    /**
     * Enable or disable view transitions at runtime
     * @param {boolean} enabled - Whether to enable view transitions
     */
    setViewTransitions(enabled) {
        this.options.viewTransitions = !!enabled;
    }

    /**
     * Subscribe to router events (e.g., viewTransitionStart, viewTransitionEnd)
     * @param {string} eventName - Event name to subscribe to
     * @param {function} callback - Callback function to invoke
     * @returns {function} - Unsubscribe function
     */
    on(eventName, callback) {
        if (!this._eventListeners.has(eventName)) {
            this._eventListeners.set(eventName, []);
        }
        this._eventListeners.get(eventName).push(callback);

        // Return unsubscribe function
        return () => {
            const listeners = this._eventListeners.get(eventName);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index !== -1) {
                    listeners.splice(index, 1);
                }
            }
        };
    }

    /**
     * Emit an event to all subscribers
     * @private
     * @param {string} eventName - Event name to emit
     * @param {object} data - Event data to pass to callbacks
     */
    _emit(eventName, data) {
        const listeners = this._eventListeners.get(eventName);
        if (listeners) {
            for (const callback of listeners) {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[WF] Error in ${eventName} event handler:`, error);
                }
            }
        }
    }

    /**
     * Execute a DOM update, optionally wrapping it in a view transition
     * @private
     * @param {function} updateFn - Function that performs the DOM update
     * @param {object} options - Transition options
     * @returns {Promise} - Resolves when update (and transition) completes
     */
    async _executeWithViewTransition(updateFn, options = {}) {
        const { from, to, route, skipTransition } = options;

        // Determine if we should use view transitions
        const routeTransition = route?.transition;
        const shouldUseTransition = this.viewTransitionsEnabled &&
                                    !skipTransition &&
                                    routeTransition !== false;

        if (!shouldUseTransition) {
            // Direct DOM update without transition
            await updateFn();
            return;
        }

        // Use View Transition API
        try {
            const transition = document.startViewTransition(async () => {
                await updateFn();
            });

            // Store current transition
            this.currentTransition = transition;

            // Emit viewTransitionStart event
            this._emit('viewTransitionStart', {
                from: from?.path || null,
                to: to?.path || null,
                transition,
                transitionType: routeTransition || 'default'
            });

            // Wait for transition to finish
            await transition.finished;

            // Emit viewTransitionEnd event
            this._emit('viewTransitionEnd', {
                from: from?.path || null,
                to: to?.path || null
            });

        } catch (error) {
            // Emit viewTransitionError event
            this._emit('viewTransitionError', {
                error,
                from: from?.path || null,
                to: to?.path || null
            });

            // Re-throw so caller knows something went wrong
            throw error;
        } finally {
            // Clear current transition
            this.currentTransition = null;
        }
    }

    /**
     * Update the router outlet with new content
     * @private
     * @param {string} content - HTML content to render
     */
    _updateOutlet(content) {
        if (!this.options.outlet) return;

        const outlet = typeof this.options.outlet === 'string'
            ? document.querySelector(this.options.outlet)
            : this.options.outlet;

        if (outlet && content) {
            // Route through framework sanitizer if available
            const wf = typeof wildflower !== 'undefined' ? wildflower : null;
            if (wf && wf._sanitizeOrPassHTML) {
                outlet.innerHTML = wf._sanitizeOrPassHTML(content);
            } else {
                if (typeof __DEV__ !== 'undefined' && __DEV__) {
                    console.warn('[WF] Router outlet rendering unsanitized HTML. Configure wildflower.setHtmlSanitizer() to prevent XSS.');
                }
                outlet.innerHTML = content;
            }
        }
    }

    /**
     * Register a route
     * @param {string} pattern - Route pattern (e.g., "/users/:id")
     * @param {function|object} handlerOrConfig - Handler function or config object
     * @returns {RouteManager} - Returns this for chaining
     */
    onRoute(pattern, handlerOrConfig) {
        // Support both old and new API
        let config;
        if (typeof handlerOrConfig === 'function') {
            // Old API: onRoute(pattern, handler)
            config = { handler: handlerOrConfig };
        } else {
            // New API: onRoute(pattern, { name, meta, beforeEnter, handler, redirect })
            config = handlerOrConfig;
        }

        // Normalize alias to array
        let aliases = [];
        if (config.alias) {
            aliases = Array.isArray(config.alias) ? config.alias : [config.alias];
        }

        const route = {
            pattern,
            path: pattern,                        // Alias for pattern (for API consistency)
            regex: this._patternToRegex(pattern),
            paramNames: this._extractParamNames(pattern),
            name: config.name || null,
            meta: config.meta || {},
            beforeEnter: config.beforeEnter || null,
            beforeLeave: config.beforeLeave || null,
            handler: config.handler || null,
            component: config.component || null,  // Lazy-loadable component
            redirect: config.redirect || null,
            alias: aliases,
            children: config.children || [],
            defaults: config.defaults || {},      // Default parameter values
            transition: config.transition,        // Per-route transition config (string, false, or undefined)
            parent: null  // Will be set for child routes
        };

        // Check if there's an index child (empty path)
        const hasIndexChild = config.children && config.children.some(child => !child.path || child.path === '');

        // Only add parent route to tree if it doesn't have an index child
        // (index child will handle the parent path)
        if (!hasIndexChild) {
            this.routeTree.push(route);
        }

        // Store in named route map if it has a name
        if (route.name) {
            if (this._namedRoutes.has(route.name)) {
                wfWarn(`Route name "${route.name}" is already registered`);
            }
            this._namedRoutes.set(route.name, route);
        }

        // Handle aliases
        if (Array.isArray(route.alias) && route.alias.length > 0) {
            route.alias.forEach(aliasPattern => {
                this.routeTree.push({
                    ...route,
                    pattern: aliasPattern,
                    regex: this._patternToRegex(aliasPattern),
                    isAlias: true
                });
            });
        }

        // Process children recursively
        if (config.children && config.children.length > 0) {
            this._registerChildren(route, config.children, pattern);
        }

        return this; // Enable chaining
    }

    /**
     * Register child routes recursively
     * @private
     */
    _registerChildren(parentRoute, children, parentPath) {
        children.forEach(childConfig => {
            // Build full path by combining parent and child paths
            const childPath = childConfig.path || '';
            const fullPath = this._combinePaths(parentPath, childPath);

            const childRoute = {
                pattern: fullPath,
                path: fullPath,                           // Alias for pattern (API consistency)
                regex: this._patternToRegex(fullPath),
                paramNames: this._extractParamNames(fullPath),
                name: childConfig.name || null,
                meta: { ...parentRoute.meta, ...(childConfig.meta || {}) },
                beforeEnter: childConfig.beforeEnter || null,
                beforeLeave: childConfig.beforeLeave || null,
                handler: childConfig.handler || null,
                component: childConfig.component || null,  // Lazy-loadable component
                defaults: childConfig.defaults || {},
                redirect: childConfig.redirect || null,
                alias: [],
                children: childConfig.children || [],
                transition: childConfig.transition,        // Per-route transition config
                parent: parentRoute  // Reference to parent route
            };

            // Store in route tree
            this.routeTree.push(childRoute);

            // Store in named route map if it has a name
            if (childRoute.name) {
                if (this._namedRoutes.has(childRoute.name)) {
                    wfWarn(`Route name "${childRoute.name}" is already registered`);
                }
                this._namedRoutes.set(childRoute.name, childRoute);
            }

            // Process grandchildren recursively
            if (childConfig.children && childConfig.children.length > 0) {
                this._registerChildren(childRoute, childConfig.children, fullPath);
            }
        });
    }

    /**
     * Combine parent and child paths
     * @private
     */
    _combinePaths(parent, child) {
        // Remove trailing slash from parent
        const parentPath = parent.endsWith('/') ? parent.slice(0, -1) : parent;

        // Handle empty child path (index route)
        if (!child || child === '') {
            return parentPath;
        }

        // Add leading slash to child if missing
        const childPath = child.startsWith('/') ? child : '/' + child;

        return parentPath + childPath;
    }

    /**
     * Register a global beforeEach guard (return-based)
     * @param {function} guard - Guard function ({ to, from }) => result
     *   Return values:
     *     - undefined/null/true: Allow navigation
     *     - false: Block navigation
     *     - string: Redirect to path
     *     - object: Redirect with options
     * @example
     *   router.beforeEach(({ to, from }) => {
     *     if (!isAuthenticated) return '/login';  // Redirect
     *     if (to.meta.requiresAdmin && !isAdmin) return false;  // Block
     *     // Return nothing = allow
     *   });
     */
    beforeEach(guard) {
        this.guards.beforeEach.push(guard);
    }

    /**
     * Register a global afterEach hook
     * @param {function} hook - Hook function ({ to, from }) => {}
     */
    afterEach(hook) {
        this.guards.afterEach.push(hook);
    }

    /**
     * Register an alias for an existing route
     * @param {string} aliasPath - The alias path
     * @param {string} targetPath - The target route pattern
     * @returns {RouteManager} - Returns this for chaining
     */
    alias(aliasPath, targetPath) {
        // Find the target route
        const targetRoute = this.routeTree.find(route => route.pattern === targetPath);

        if (!targetRoute) {
            wfError(WF_ERRORS.ROUTE_ALIAS_ERROR, {
                context: `${aliasPath} -> ${targetPath}`,
                suggestion: 'Register the target route before creating the alias'
            });
            return this;
        }

        // Create an alias route entry
        this.routeTree.push({
            ...targetRoute,
            pattern: aliasPath,
            regex: this._patternToRegex(aliasPath),
            paramNames: this._extractParamNames(aliasPath),
            isAlias: true
        });

        return this;
    }

    /**
     * Initialize the router
     */
    init() {
        if (this.isInitialized) {
            wfWarn('Router already initialized');
            return;
        }


        // Listen for browser back/forward or hash changes
        if (this.options.mode === 'hash') {
            window.addEventListener('hashchange', this._handleHashChange);
        } else {
            window.addEventListener('popstate', this._handlePopState);
        }

        // Intercept clicks on internal links for SPA navigation
        this._setupLinkInterception();

        // Handle initial route
        const initialLocation = this.urlParser.parse(window.location);

        // Initial route load should not use view transitions (skip for initial render)
        this._matchAndExecute(initialLocation, NO_PUSH_TO_HISTORY, [], { skipTransition: true });

        this.isInitialized = true;
    }

    /**
     * Set up click interception for internal links
     * Enables SPA-style navigation without full page reloads
     */
    _setupLinkInterception() {
        document.addEventListener('click', this._handleLinkClick);
    }

    /**
     * Handle link clicks for SPA navigation
     * @param {Event} event - Click event
     */
    _handleLinkClick(event) {
        // Find the closest anchor element
        const link = event.target.closest('a[href]');
        if (!link) return;

        // Skip if modifier keys are pressed (allow open in new tab, etc.)
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        // Skip if link has target="_blank" or other targets
        if (link.target && link.target !== '_self') return;

        // Skip if link has download attribute
        if (link.hasAttribute('download')) return;

        // Skip if link has data-no-router attribute
        if (link.hasAttribute('data-no-router')) return;

        // Get the href attribute (not the resolved href property)
        const href = link.getAttribute('href');
        if (!href) return;

        // Skip javascript:, mailto:, tel:, hash-only links
        if (/^(javascript:|mailto:|tel:|#)/.test(href)) return;

        // Skip absolute URLs with protocol (external links)
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;

        // Skip protocol-relative URLs (//example.com)
        if (href.startsWith('//')) return;

        // At this point, href is a relative or absolute path (starts with / or is relative)
        // These are internal links - intercept them
        event.preventDefault();

        // Parse the href to extract pathname, search, and hash
        // Use the link's resolved href property which gives us the full URL
        const resolvedUrl = link.href;
        try {
            const url = new URL(resolvedUrl);
            this.navigate(url.pathname + url.search + url.hash);
        } catch (e) {
            // Fallback: just use the href as-is
            this.navigate(href);
        }
    }

    /**
     * Navigate to a location
     * @param {string|object} to - Path string or { name, params, query }
     * @param {object} options - Navigation options { query, replace, _visitedPaths }
     * @returns {Promise} - Resolves when navigation completes
     */
    async navigate(to, options = {}) {
        // Normalize input
        let location;
        let hash = options.hash || '';
        if (typeof to === 'string') {
            // Extract hash fragment first (before query splitting)
            const hashIndex = to.indexOf('#');
            if (hashIndex >= 0) {
                hash = hash || to.slice(hashIndex);
                to = to.slice(0, hashIndex);
            }
            // Split path and query string if present
            const queryIndex = to.indexOf('?');
            const pathname = queryIndex >= 0 ? to.slice(0, queryIndex) : to;
            const search = queryIndex >= 0 ? to.slice(queryIndex) : '';
            location = this.urlParser.parse({ pathname, search });
            if (options.query) {
                location.query = { ...location.query, ...options.query };
            }
        } else if (to.name) {
            // Named route navigation
            location = this._resolveNamedRoute(to.name, to.params, to.query);
        } else {
            location = to;
        }


        // Attach hash to location
        location.hash = hash;

        // Circular redirect detection
        const visitedPaths = options._visitedPaths || [];
        if (visitedPaths.includes(location.pathname)) {
            const chain = [...visitedPaths, location.pathname].join(' → ');
            wfError(WF_ERRORS.CIRCULAR_DEPENDENCY, {
                context: `Route redirect chain: ${chain}`,
                suggestion: 'Check route redirects and beforeEnter guards for circular references'
            });
            throw new Error(`Circular redirect detected: ${chain}`);
        }

        // Check if already at this location
        if (this.currentRoute && this._isSameLocation(this.currentRoute, location)) {
            return;
        }

        // Prevent concurrent navigations - queue with retry limit
        if (this.isNavigating) {
            const retryCount = options._retryCount || 0;
            if (retryCount >= 10) {
                wfError(WF_ERRORS.ROUTE_NAVIGATION_ERROR, {
                    suggestion: 'Check for circular redirects or slow route guards'
                });
                return;
            }
            wfWarn('Navigation already in progress, queuing...');
            await new Promise(resolve => setTimeout(resolve, NAVIGATION_SETTLE_MS));
            return this.navigate(to, { ...options, _retryCount: retryCount + 1 });
        }

        this.isNavigating = true;
        this._navigationAborted = false;

        try {
            // Pass visited paths to track redirect chains and transition options
            await this._matchAndExecute(location, !options.replace, visitedPaths, {
                skipTransition: options.skipTransition,
                _state: options.state
            });
        } finally {
            this.isNavigating = false;
            this._navigationAborted = false;
        }
    }

    /**
     * Abort an in-progress navigation
     * Sets a flag that is checked in _matchAndExecute to cancel navigation
     */
    abortNavigation() {
        if (this.isNavigating) {
            this._navigationAborted = true;
        }
    }

    /**
     * Get URL for a named route
     * @param {string} name - Route name
     * @param {object} params - Route parameters
     * @param {object} query - Query parameters
     * @returns {string} - Generated URL
     */
    getRouteUrl(name, params = {}, query = {}, hash = '') {
        const route = this._namedRoutes.get(name);
        if (!route) {
            wfError(WF_ERRORS.NAMED_ROUTE_NOT_FOUND, {
                context: name,
                suggestion: 'Check route name spelling or register the route'
            });
            return '/';
        }

        let path = route.pattern;

        // Replace parameters (handle optional params with trailing ?)
        route.paramNames.forEach(paramName => {
            const value = params[paramName];
            if (value !== undefined) {
                // Replace :param? or :param
                path = path.replace(`:${paramName}?`, encodeURIComponent(value))
                           .replace(`:${paramName}`, encodeURIComponent(value));
            } else {
                // Remove optional param segment (/:param? or :param?)
                path = path.replace(`/:${paramName}?`, '').replace(`:${paramName}?`, '');
            }
        });

        // Add query string
        if (Object.keys(query).length > 0) {
            const queryString = Object.entries(query)
                .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                .join('&');
            path += '?' + queryString;
        }

        // Add hash fragment
        if (hash) {
            path += hash.startsWith('#') ? hash : '#' + hash;
        }

        return path;
    }

    /**
     * Check if a route is currently active
     * @param {string} pattern - Route pattern or path
     * @param {object} options - { exact: boolean }
     * @returns {boolean}
     */
    isActive(pattern, options = {}) {
        if (!this.currentRoute) {
            return false;
        }

        const currentPath = this.currentRoute.path;

        if (options.exact) {
            return currentPath === pattern;
        }

        // Fuzzy matching: current path starts with pattern
        // /docs matches /docs, /docs/, /docs/api, etc.
        if (currentPath === pattern) {
            return true;
        }
        // Check if current path is under the pattern (parent path matching)
        return currentPath.startsWith(pattern + '/') || currentPath.startsWith(pattern + '?');
    }

    /**
     * Get current route information
     * @returns {object|null}
     */
    getCurrentRoute() {
        return this.currentRoute;
    }

    /**
     * Destroy the router
     */
    destroy() {
        // Remove appropriate event listener based on mode
        if (this.options.mode === 'hash') {
            window.removeEventListener('hashchange', this._handleHashChange);
        } else {
            window.removeEventListener('popstate', this._handlePopState);
        }

        // Remove link click interception listener
        document.removeEventListener('click', this._handleLinkClick);

        this._namedRoutes.clear();
        this.routeTree = [];
        this.guards = { beforeEach: [], afterEach: [] };
        if (this._eventListeners) this._eventListeners.clear();
        if (this._scrollHashTimerId) clearTimeout(this._scrollHashTimerId);
        this.isInitialized = false;
    }

    // ==================== EVENT DISPATCHING ====================

    /**
     * Dispatch a route event on the document
     * @param {string} eventName - Event name (e.g., 'route:beforeChange')
     * @param {object} detail - Event detail object
     * @param {boolean} cancelable - Whether the event can be canceled
     * @returns {boolean} - Returns false if event was cancelled, true otherwise
     */
    _dispatchRouteEvent(eventName, detail, cancelable = false) {
        const event = new CustomEvent(eventName, {
            detail,
            bubbles: true,
            cancelable
        });
        const dispatched = document.dispatchEvent(event);
        // dispatchEvent returns false if preventDefault was called
        return dispatched;
    }

    /**
     * Dispatch route:beforeChange event (cancelable)
     * @param {object} to - Target route
     * @param {object} from - Source route
     * @returns {boolean} - Returns false if navigation should be blocked
     */
    _dispatchBeforeChange(to, from) {
        return this._dispatchRouteEvent('route:beforeChange', { to, from }, true);
    }

    /**
     * Dispatch route:afterChange event
     * @param {object} to - Target route
     * @param {object} from - Source route
     */
    _dispatchAfterChange(to, from) {
        this._dispatchRouteEvent('route:afterChange', { to, from }, false);
    }

    /**
     * Dispatch route:redirect event
     * @param {string} from - Original path
     * @param {string} to - Redirect target path
     */
    _dispatchRedirect(from, to) {
        this._dispatchRouteEvent('route:redirect', { from, to }, false);
    }

    /**
     * Dispatch route:error event
     * @param {Error} error - The error that occurred
     * @param {object} to - Target route (if available)
     * @param {object} from - Source route (if available)
     */
    _dispatchError(error, to = null, from = null) {
        this._dispatchRouteEvent('route:error', { error, to, from }, false);
    }

    // ==================== INTERNAL METHODS ====================

    /**
     * Handle browser back/forward
     */
    _handlePopState(event) {
        // Ignore if we're currently navigating (prevents concurrent _matchAndExecute)
        if (this.isNavigating) {
            return;
        }
        const location = this.urlParser.parse(window.location);

        // Skip if we're already at this location (prevents duplicate navigation)
        if (this.currentRoute && this._isSameLocation(this.currentRoute, location)) {
            return;
        }

        // Extract saved scroll position from history state (for back/forward)
        const savedPosition = event.state && event.state.scrollX !== undefined
            ? { x: event.state.scrollX, y: event.state.scrollY }
            : null;

        this._matchAndExecute(location, NO_PUSH_TO_HISTORY, [], { _savedPosition: savedPosition });
    }

    /**
     * Handle hash changes
     */
    _handleHashChange(event) {
        // Ignore if we're currently navigating (prevents recursive calls)
        if (this.isNavigating) {
            return;
        }
        const location = this.urlParser.parse(window.location);

        // Skip if we're already at this location (prevents duplicate navigation
        // when hashchange fires after programmatic navigation)
        if (this.currentRoute && this._isSameLocation(this.currentRoute, location)) {
            return;
        }

        // Extract saved scroll position from history state (for back/forward in hash mode)
        const state = window.history.state;
        const savedPosition = state && state.scrollX !== undefined
            ? { x: state.scrollX, y: state.scrollY }
            : null;

        this._matchAndExecute(location, NO_PUSH_TO_HISTORY, [], { _savedPosition: savedPosition });
    }

    /**
     * Match location against routes and execute handler
     * @param {object} location - Parsed location object
     * @param {boolean} pushState - Whether to push to browser history
     * @param {array} visitedPaths - Paths visited in redirect chain (for circular detection)
     * @param {object} transitionOptions - View transition options { skipTransition }
     */
    async _matchAndExecute(location, pushState = true, visitedPaths = [], transitionOptions = {}) {
        // Check abort flag
        if (this._navigationAborted) {
            this._navigationAborted = false;
            return;
        }

        // Normalize trailing slash (strip unless root path)
        if (location.pathname !== '/' && location.pathname.endsWith('/')) {
            location.pathname = location.pathname.slice(0, -1);
        }

        // Find matching route
        let matchedRoute = null;
        let params = {};

        for (const route of this.routeTree) {
            const match = location.pathname.match(route.regex);
            if (match) {

                // Extract parameters and apply defaults
                params = this._extractParams(route.paramNames, match, route.defaults);
                matchedRoute = route;
                break;
            }
        }

        if (!matchedRoute) {
            wfWarn(`No route matched for path: ${location.pathname}`);

            // Dispatch route:notFound event
            this._dispatchRouteEvent('route:notFound', {
                path: location.pathname,
                query: location.query
            }, false);

            // Try default route - but only if:
            // 1. Default route is configured
            // 2. We're not already at the default route
            // 3. We haven't already tried the default route (prevent loops)
            // 4. A route is actually registered for the default path
            if (this.options.defaultRoute &&
                location.pathname !== this.options.defaultRoute &&
                !visitedPaths.includes(this.options.defaultRoute)) {

                // Check if default route is actually registered
                const defaultRouteExists = this.routeTree.some(route => {
                    const regex = route.regex;
                    return regex.test(this.options.defaultRoute);
                });

                if (defaultRouteExists) {
                    const newVisitedPaths = [...visitedPaths, location.pathname];
                    return this.navigate(this.options.defaultRoute, {
                        _visitedPaths: newVisitedPaths,
                        skipTransition: transitionOptions.skipTransition
                    });
                } else {
                    wfWarn('Default route not registered, cannot redirect');
                }
            }
            return;
        }

        // Handle redirects
        if (matchedRoute.redirect) {
            // Substitute parameters in redirect path (e.g., /users/:id -> /users/123)
            let redirectPath = matchedRoute.redirect;
            if (params && Object.keys(params).length > 0) {
                Object.keys(params).forEach(key => {
                    redirectPath = redirectPath.replace(`:${key}`, params[key]);
                });
            }


            // Dispatch redirect event
            this._dispatchRedirect(location.pathname, redirectPath);

            // Clear isNavigating flag before redirect to prevent infinite loop
            this.isNavigating = false;
            // Add current path to visited chain and continue redirect
            const newVisitedPaths = [...visitedPaths, location.pathname];
            // Preserve query parameters on redirect, and skipTransition if set
            return this.navigate(redirectPath, {
                query: location.query,
                _visitedPaths: newVisitedPaths,
                skipTransition: transitionOptions.skipTransition
            });
        }

        // Build route object
        const to = {
            path: location.pathname,
            hash: location.hash || '',
            params,
            query: location.query,
            meta: matchedRoute.meta,
            name: matchedRoute.name,
            matched: matchedRoute
        };

        const from = this.currentRoute;

        // Run beforeLeave guard on current route (if any)
        if (from && from.matched && from.matched.beforeLeave) {
            try {
                const leaveResult = await from.matched.beforeLeave({ to, from });
                if (leaveResult === false) {
                    return;
                }
                if (typeof leaveResult === 'string') {
                    this.isNavigating = false;
                    const newVisitedPaths = [...visitedPaths, location.pathname];
                    return this.navigate(leaveResult, {
                        _visitedPaths: newVisitedPaths,
                        skipTransition: transitionOptions.skipTransition
                    });
                }
                if (leaveResult && typeof leaveResult === 'object' && leaveResult.path) {
                    this.isNavigating = false;
                    const newVisitedPaths = [...visitedPaths, location.pathname];
                    return this.navigate(leaveResult.path, {
                        _visitedPaths: newVisitedPaths,
                        skipTransition: transitionOptions.skipTransition,
                        ...(leaveResult.query && { query: leaveResult.query })
                    });
                }
            } catch (error) {
                wfError(WF_ERRORS.ROUTE_GUARD_ERROR, {
                    context: `beforeLeave guard for ${from.path}`,
                    cause: error
                });
                this._dispatchError(error, to, from);
                throw error;
            }
        }

        // Dispatch route:beforeChange event (cancelable via preventDefault)
        const shouldProceed = this._dispatchBeforeChange(to, from);
        if (!shouldProceed) {
            return;
        }

        // Shared guard result processing: false blocks, string redirects.
        // Returns true if navigation should stop (blocked or redirected).
        const processGuardResult = async (guardPromise, errorContext) => {
            try {
                const result = await guardPromise;
                if (result === false) return true;
                if (typeof result === 'string') {
                    this.isNavigating = false;
                    const newVisitedPaths = [...visitedPaths, location.pathname];
                    await this.navigate(result, {
                        _visitedPaths: newVisitedPaths,
                        skipTransition: transitionOptions.skipTransition
                    });
                    return true;
                }
                if (result && typeof result === 'object' && result.path) {
                    this.isNavigating = false;
                    const newVisitedPaths = [...visitedPaths, location.pathname];
                    await this.navigate(result.path, {
                        _visitedPaths: newVisitedPaths,
                        skipTransition: transitionOptions.skipTransition,
                        ...(result.query && { query: result.query })
                    });
                    return true;
                }
            } catch (error) {
                wfError(WF_ERRORS.ROUTE_GUARD_ERROR, {
                    context: errorContext,
                    cause: error
                });
                this._dispatchError(error, to, from);
                throw error;
            }
            return false;
        };

        // Run beforeEach guards
        if (await processGuardResult(
            this._runBeforeGuards(to, from), 'beforeEach guard'
        )) return;

        // Run per-route beforeEnter guard
        if (matchedRoute.beforeEnter) {
            if (await processGuardResult(
                this._runBeforeEnter(matchedRoute.beforeEnter, to, from),
                `beforeEnter guard for ${matchedRoute.pattern}`
            )) return;
        }

        // Update browser history or hash
        if (pushState) {
            // Save scroll position before navigation
            const scrollState = {
                scrollX: window.scrollX,
                scrollY: window.scrollY
            };

            // Build history state: scroll position + custom state from options
            const historyState = {
                path: location.pathname,
                ...scrollState,
                ...(transitionOptions._state || {})
            };

            const url = this.urlParser.buildUrl(location);

            if (this.options.mode === 'hash') {
                // In hash mode, update the hash (strip leading # since it's auto-added)
                const hashValue = url.startsWith('#') ? url.slice(1) : url;
                window.location.hash = hashValue;
                // Use replaceState to store scroll position and custom state
                // (setting hash directly doesn't preserve history.state)
                window.history.replaceState(historyState, '');
            } else {
                // In history mode, use pushState
                window.history.pushState(historyState, '', url);
            }
        }

        // Update current route
        this.previousRoute = this.currentRoute;
        this.currentRoute = to;

        // Check abort flag before executing handlers
        if (this._navigationAborted) {
            this._navigationAborted = false;
            return;
        }

        // Execute handlers with optional view transition
        await this._executeWithViewTransition(
            async () => {
                // Execute parent handlers first, then child handler
                await this._executeHandlerChain(matchedRoute, to, from);
            },
            {
                from,
                to,
                route: matchedRoute,
                skipTransition: transitionOptions.skipTransition
            }
        );

        // Run afterEach hooks
        this._runAfterHooks(to, from);

        // Dispatch route:afterChange event (not cancelable)
        this._dispatchAfterChange(to, from);

        // Handle scroll behavior (pass savedPosition from popstate or hash)
        this._handleScrollBehavior(to, from, transitionOptions._savedPosition || null);
    }

    /**
     * Run beforeEach guards (return-based API)
     * Guards return:
     *   - undefined/null/true = allow navigation
     *   - false = block navigation
     *   - string = redirect to that path
     *   - object = redirect with { path, query, ... }
     */
    async _runBeforeGuards(to, from) {
        for (const guard of this.guards.beforeEach) {
            try {
                // Call guard and get return value
                const result = await guard({ to, from });

                // Handle guard result
                if (result === false) {
                    return false; // Block navigation
                }
                if (typeof result === 'string') {
                    return result; // Redirect to path
                }
                if (result && typeof result === 'object') {
                    return result; // Redirect with options
                }
                // undefined, null, or true = continue to next guard
            } catch (error) {
                wfError(WF_ERRORS.ROUTE_GUARD_ERROR, {
                    context: 'beforeEach guard',
                    cause: error
                });
                throw error;
            }
        }

        return true; // All guards passed, allow navigation
    }

    /**
     * Run beforeEnter guard (return-based API)
     * Guard returns:
     *   - undefined/null/true = allow navigation
     *   - false = block navigation
     *   - string = redirect to that path
     *   - object = redirect with options
     */
    async _runBeforeEnter(guard, to, from) {
        try {
            // Call guard and get return value
            const result = await guard({ to, from, params: to.params, query: to.query });
            return result; // Return whatever the guard returned
        } catch (error) {
            wfError(WF_ERRORS.ROUTE_GUARD_ERROR, {
                context: `beforeEnter guard for ${to.path}`,
                cause: error
            });
            throw error;
        }
    }

    /**
     * Run afterEach hooks
     */
    _runAfterHooks(to, from) {
        this.guards.afterEach.forEach(hook => {
            try {
                hook({ to, from });
            } catch (error) {
                wfError(WF_ERRORS.ROUTE_HOOK_ERROR, {
                    context: 'afterEach hook',
                    cause: error
                });
            }
        });
    }

    /**
     * Handle scroll behavior
     * @param {object} to - Target route
     * @param {object} from - Source route
     * @param {object|null} savedPosition - Saved scroll position from history state ({ x, y })
     */
    _handleScrollBehavior(to, from, savedPosition = null) {
        if (!this.options.scrollBehavior) {
            // Default behavior: hash fragment scrolling, then scroll to top
            if (to.hash) {
                this._scrollToHash(to.hash);
                return;
            }
            window.scrollTo(0, 0);
            return;
        }

        try {
            const position = this.options.scrollBehavior(to, from, savedPosition);
            if (position) {
                if (position.selector || position.el) {
                    const selector = position.selector || position.el;
                    const element = document.querySelector(selector);
                    if (element) {
                        element.scrollIntoView({ behavior: 'smooth' });
                    }
                } else {
                    window.scrollTo(position.x || 0, position.y || 0);
                }
            }
        } catch (error) {
            wfError(WF_ERRORS.ROUTE_SCROLL_ERROR, {
                cause: error
            });
        }
    }

    /**
     * Scroll to a hash fragment element, with deferred retry if element doesn't exist yet
     * (handles async content loading where target element may not be in DOM immediately)
     * @private
     * @param {string} hash - Hash selector (e.g., '#section-id')
     * @param {number} retries - Number of retries remaining
     */
    _scrollToHash(hash, retries = 10) {
        try {
            const el = document.querySelector(hash);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth' });
                return;
            }
        } catch (e) {
            // Invalid selector — don't retry
            return;
        }

        // Element not found yet — retry after content may have loaded
        if (retries > 0) {
            this._scrollHashTimerId = setTimeout(() => this._scrollToHash(hash, retries - 1), 100);
        }
    }

    /**
     * Execute handler chain (parent handlers first, then child)
     * @private
     */
    async _executeHandlerChain(matchedRoute, to, from) {
        // Build chain of routes from root to leaf
        const chain = [];
        let currentRoute = matchedRoute;

        while (currentRoute) {
            chain.unshift(currentRoute); // Add to beginning of array
            currentRoute = currentRoute.parent;
        }

        // Execute handlers in order (parent to child)
        let lastContent = null;
        for (const route of chain) {
            if (route.handler) {
                try {
                    const result = await route.handler({
                        params: to.params,
                        query: to.query,
                        path: to.path,
                        meta: to.meta,
                        from
                    });

                    // If handler returns content (string), store it for outlet update
                    if (typeof result === 'string') {
                        lastContent = result;
                    }
                } catch (error) {
                    wfError(WF_ERRORS.ROUTE_HANDLER_ERROR, {
                        context: `Route handler for "${route.pattern}"`,
                        cause: error
                    });
                }
            }

            // Handle component loading
            if (route.component) {
                await this._loadComponent(route, to, from);
            }
        }

        // Update outlet with the last content returned by handlers
        if (lastContent !== null) {
            this._updateOutlet(lastContent);
        }
    }

    /**
     * Load a lazy component with timeout and error handling
     * @private
     */
    async _loadComponent(route, to, from) {
        // Call onLoadingStart callback
        if (this.options.onLoadingStart) {
            try {
                this.options.onLoadingStart(to, from);
            } catch (error) {
                wfError(WF_ERRORS.ROUTE_HOOK_ERROR, {
                    context: 'onLoadingStart callback',
                    cause: error
                });
            }
        }

        let timeoutId = null;

        try {
            // Set up timeout callback if configured
            if (this.options.loadingTimeout > 0) {
                timeoutId = setTimeout(() => {
                    if (this.options.onLoadingTimeout) {
                        try {
                            this.options.onLoadingTimeout(to, from);
                        } catch (error) {
                            wfError(WF_ERRORS.ROUTE_HOOK_ERROR, {
                                context: 'onLoadingTimeout callback',
                                cause: error
                            });
                        }
                    }
                }, this.options.loadingTimeout);
            }

            // Load the component
            const componentPromise = typeof route.component === 'function'
                ? route.component()
                : Promise.resolve(route.component);

            // Wait for component to load (timeout doesn't reject, just fires callback)
            const componentModule = await componentPromise;

            // Clear timeout if it hasn't fired
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            // Call onLoadingEnd callback
            if (this.options.onLoadingEnd) {
                try {
                    this.options.onLoadingEnd(to, from);
                } catch (error) {
                    wfError(WF_ERRORS.ROUTE_HOOK_ERROR, {
                        context: 'onLoadingEnd callback',
                        cause: error
                    });
                }
            }

            // Initialize the component if it has an init method
            if (componentModule && componentModule.default && componentModule.default.init) {
                try {
                    await componentModule.default.init({
                        params: to.params,
                        query: to.query,
                        path: to.path,
                        meta: to.meta,
                        from
                    });
                } catch (error) {
                    wfError(WF_ERRORS.ROUTE_COMPONENT_ERROR, {
                        context: `Component init for "${route.pattern}"`,
                        cause: error
                    });
                }
            }

        } catch (error) {
            // Clear timeout on error
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            // Call onLoadingError callback
            if (this.options.onLoadingError) {
                try {
                    this.options.onLoadingError(to, error);
                } catch (cbError) {
                    wfError(WF_ERRORS.ROUTE_HOOK_ERROR, {
                        context: 'onLoadingError callback',
                        cause: cbError
                    });
                }
            }

            wfError(WF_ERRORS.ROUTE_COMPONENT_ERROR, {
                context: `Loading component for "${route.pattern}"`,
                cause: error
            });

            // Re-throw to prevent navigation completion if component fails to load
            throw error;
        }
    }

    /**
     * Resolve named route to location
     */
    _resolveNamedRoute(name, params = {}, query = {}) {
        const route = this._namedRoutes.get(name);
        if (!route) {
            // Suggest similar route names
            const suggestions = this._findSimilarRouteNames(name);
            let suggestion = 'Check route name spelling or register the route';

            if (suggestions.length > 0) {
                suggestion = `Did you mean: ${suggestions.join(', ')}?`;
            } else if (this._namedRoutes.size > 0) {
                const allNames = Array.from(this._namedRoutes.keys()).slice(0, 5);
                suggestion = `Available routes: ${allNames.join(', ')}`;
            }

            wfError(WF_ERRORS.NAMED_ROUTE_NOT_FOUND, {
                context: name,
                suggestion
            });
            return { pathname: '/', query: {} };
        }

        let pathname = route.pattern;

        // Replace parameters (handle optional params with trailing ?)
        route.paramNames.forEach(paramName => {
            const value = params[paramName];
            if (value !== undefined) {
                pathname = pathname.replace(`:${paramName}?`, encodeURIComponent(value))
                                   .replace(`:${paramName}`, encodeURIComponent(value));
            } else {
                pathname = pathname.replace(`/:${paramName}?`, '').replace(`:${paramName}?`, '');
            }
        });

        return { pathname, query: query || {} };
    }

    /**
     * Check if two locations are the same
     */
    _isSameLocation(route1, route2) {
        const samePath = route1.path === (route2.pathname || route2.path);
        const sameHash = (route1.hash || '') === (route2.hash || '');
        if (!samePath || !sameHash) return false;

        // Key-order-insensitive query comparison
        const q1 = route1.query || {};
        const q2 = route2.query || {};
        const keys1 = Object.keys(q1);
        const keys2 = Object.keys(q2);
        if (keys1.length !== keys2.length) return false;
        for (const key of keys1) {
            if (q1[key] !== q2[key]) return false;
        }
        return true;
    }

    /**
     * Convert route pattern to regex (reused from Router.js)
     */
    _patternToRegex(pattern) {
        if (pattern === '/') {
            return /^\/$/;
        }

        // Handle wildcards
        if (pattern === '*') {
            return /.+/; // Match any non-empty path (catch-all / 404)
        }

        if (pattern.includes('*')) {
            // Convert /docs/* to regex — capture rest of path
            const regexPattern = pattern
                .replace(/\//g, '\\/')
                .replace(/\*/g, '(.+)');
            return new RegExp(`^${regexPattern}$`);
        }

        // Convert :param and :param? to capture groups
        // Order matters: escape slashes first, then handle parameters
        let regexPattern = pattern
            .replace(/\//g, '\\/')                           // Escape slashes first
            .replace(/\\\/:(\w+)\?/g, '(?:\\/([^/]+))?')     // Optional param with slash: \/:param? -> (?:\/([^/]+))?
            .replace(/:(\w+)\?/g, '([^/]*)')                 // Optional param without slash: :param? -> ([^/]*)
            .replace(/:(\w+)/g, '([^/]+)');                  // Required param :param -> ([^/]+)

        return new RegExp(`^${regexPattern}$`);
    }

    /**
     * Extract parameter names from pattern
     */
    _extractParamNames(pattern) {
        const names = [];
        const regex = /:(\w+)/g;
        let match;
        while ((match = regex.exec(pattern)) !== null) {
            names.push(match[1]);
        }

        // Handle wildcard
        if (pattern.includes('*')) {
            names.push('pathMatch');
        }

        return names;
    }

    /**
     * Extract parameter values from regex match, applying defaults for missing values
     * @param {Array} paramNames - Parameter names from pattern
     * @param {Array} match - Regex match result
     * @param {Object} defaults - Default parameter values
     * @returns {Object} - Extracted parameters with defaults applied
     */
    _extractParams(paramNames, match, defaults = {}) {
        const params = {};

        for (let i = 0; i < paramNames.length; i++) {
            const paramName = paramNames[i];
            const matchedValue = match[i + 1]; // match[0] is full match

            // Use matched value if present, otherwise fall back to default
            if (matchedValue !== undefined && matchedValue !== '') {
                params[paramName] = matchedValue;
            } else if (defaults[paramName] !== undefined) {
                params[paramName] = defaults[paramName];
            }
        }

        return params;
    }

    /**
     * Find similar route names using simple string matching
     * @private
     */
    _findSimilarRouteNames(targetName, maxSuggestions = 3) {
        const allNames = Array.from(this._namedRoutes.keys());
        const suggestions = [];

        for (const name of allNames) {
            // Calculate similarity score (0-1)
            const similarity = this._calculateStringSimilarity(targetName, name);

            // Consider names with >40% similarity
            if (similarity > 0.4) {
                suggestions.push({ name, similarity });
            }
        }

        // Sort by similarity and return top N
        return suggestions
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, maxSuggestions)
            .map(s => s.name);
    }

    /**
     * Calculate string similarity using simple character matching
     * @private
     */
    _calculateStringSimilarity(str1, str2) {
        str1 = str1.toLowerCase();
        str2 = str2.toLowerCase();

        // Exact match
        if (str1 === str2) return 1.0;

        // Check if one contains the other
        if (str1.includes(str2) || str2.includes(str1)) {
            return 0.8;
        }

        // Calculate character overlap
        const chars1 = new Set(str1.split(''));
        const chars2 = new Set(str2.split(''));

        let overlap = 0;
        for (const char of chars1) {
            if (chars2.has(char)) overlap++;
        }

        const maxLength = Math.max(str1.length, str2.length);
        return overlap / maxLength;
    }
}

/**
 * URLParser - URL Parsing and Building Utility
 *
 * Handles both history mode (pathname) and hash mode (#/path) URLs,
 * providing a unified interface for the RouteManager.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * URL MODES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * History Mode (mode: 'history'):
 *   URL: https://example.com/users/123?tab=posts
 *   Parsed: { pathname: '/users/123', query: { tab: 'posts' } }
 *
 * Hash Mode (mode: 'hash'):
 *   URL: https://example.com/#/users/123?tab=posts
 *   Parsed: { pathname: '/users/123', query: { tab: 'posts' } }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BASE PATH HANDLING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When base is set (e.g., '/app'), it's stripped during parsing:
 *   URL: /app/users/123 → pathname: /users/123
 *
 * And prepended during building:
 *   pathname: /users/123 → URL: /app/users/123
 *
 * @class URLParser
 */
class URLParser {
    constructor(base = '/', mode = 'history') {
        this.base = base;
        this.mode = mode;
    }

    /**
     * Parse location object or URL
     */
    parse(location) {
        let pathname, search, fragment = '';

        if (typeof location === 'string') {
            const url = new URL(location, window.location.origin);
            if (this.mode === 'hash') {
                // Extract path from hash
                const hash = url.hash.slice(1); // Remove leading #
                const [hashPath, hashSearch] = hash.split('?');
                pathname = hashPath || '/';
                search = hashSearch ? '?' + hashSearch : '';
            } else {
                pathname = url.pathname;
                search = url.search;
                fragment = url.hash || '';
            }
        } else if (location.pathname !== undefined) {
            // Check if this is window.location (has .hash property) or a plain object
            if (this.mode === 'hash' && location.hash !== undefined) {
                // Parsing from window.location in hash mode - use hash
                const hash = location.hash ? location.hash.slice(1) : '/';
                const [hashPath, hashSearch] = hash.split('?');
                pathname = hashPath || '/';
                search = hashSearch ? '?' + hashSearch : '';
            } else {
                // Parsing from plain object or history mode - use pathname
                pathname = location.pathname;
                search = location.search || '';
                fragment = location.hash || '';
            }
        } else {
            pathname = '/';
            search = '';
        }

        // In hash mode, extract fragment hash from within the pathname (e.g. /page#section)
        if (this.mode === 'hash') {
            const fragIdx = pathname.indexOf('#');
            if (fragIdx >= 0) {
                fragment = pathname.slice(fragIdx);
                pathname = pathname.slice(0, fragIdx);
            }
        }

        // Strip base path if present
        if (this.base !== '/' && pathname.startsWith(this.base)) {
            pathname = pathname.slice(this.base.length) || '/';
        }

        // Parse query parameters
        const query = this._parseQuery(search);

        return {
            pathname,
            query,
            hash: fragment
        };
    }

    /**
     * Build URL from location
     */
    buildUrl(location) {
        let url = this.base !== '/' ? this.base + location.pathname : location.pathname;

        // Add query string
        if (location.query && Object.keys(location.query).length > 0) {
            const queryString = Object.entries(location.query)
                .map(([key, value]) => {
                    if (Array.isArray(value)) {
                        return value.map(v => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`).join('&');
                    }
                    return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
                })
                .join('&');
            url += '?' + queryString;
        }

        // Add hash fragment
        if (location.hash) {
            url += location.hash.startsWith('#') ? location.hash : '#' + location.hash;
        }

        // In hash mode, prefix with #
        if (this.mode === 'hash') {
            return '#' + url;
        }

        return url;
    }

    /**
     * Parse query string into object
     * Supports array params: tags[]=a&tags[]=b and duplicate keys: tag=a&tag=b
     */
    _parseQuery(search) {
        const query = {};

        if (!search || search === '?') {
            return query;
        }

        // Remove leading '?'
        const queryString = search.startsWith('?') ? search.slice(1) : search;

        // Parse parameters (handle duplicates → arrays)
        queryString.split('&').forEach(pair => {
            const eqIndex = pair.indexOf('=');
            const key = eqIndex >= 0 ? pair.slice(0, eqIndex) : pair;
            const value = eqIndex >= 0 ? pair.slice(eqIndex + 1) : '';
            if (key) {
                const decodedKey = decodeURIComponent(key);
                const decodedValue = decodeURIComponent(value);
                if (decodedKey in query) {
                    // Convert to array on second occurrence
                    if (Array.isArray(query[decodedKey])) {
                        query[decodedKey].push(decodedValue);
                    } else {
                        query[decodedKey] = [query[decodedKey], decodedValue];
                    }
                } else {
                    query[decodedKey] = decodedValue;
                }
            }
        });

        return query;
    }
}

// ==================== WILDFLOWERJS INTEGRATION ====================

/**
 * Framework Integration - Automatic onRouteChange Hook Support
 *
 * Provides seamless integration between RouteManager and WildflowerJS components
 * by listening for framework lifecycle events and wiring up route change handlers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW IT WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Component Definition                    RouteManager
 *         │                                      │
 *         ▼                                      │
 *   ┌─────────────────┐                          │
 *   │ onRouteChange() │                          │
 *   │ defined in      │                          │
 *   │ component       │                          │
 *   └────────┬────────┘                          │
 *            │                                   │
 *            ▼ wildflower:componentInit          │
 *   ┌────────────────────────────────────────────┼────────┐
 *   │  setupRouteListener(instance)              │        │
 *   │  • Checks if onRouteChange exists          │        │
 *   │  • Creates bound handler                   │        │
 *   │  • Adds route:afterChange listener         │        │
 *   └────────────────────────────────────────────┼────────┘
 *            │                                   │
 *            │    Navigation occurs              │
 *            │◀──────────────────────────────────┤
 *            │    route:afterChange dispatched   │
 *            ▼                                   │
 *   ┌────────────────────────────────────────────┐
 *   │  Component's onRouteChange(to, from)      │
 *   │  called with route details                │
 *   └────────────────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE IN COMPONENTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @example
 * ```javascript
 * wildflower.component('navigation-manager', {
 *     state: { currentPath: '/' },
 *
 *     // Called automatically on every navigation
 *     onRouteChange(to, from) {
 *         this.state.currentPath = to.path;
 *
 *         // Access route details
 *         console.log('Params:', to.params);
 *         console.log('Query:', to.query);
 *         console.log('Meta:', to.meta);
 *     }
 * });
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTOMATIC CLEANUP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When a component is destroyed (wildflower:componentDestroy), its route
 * change listener is automatically removed to prevent memory leaks.
 *
 * @namespace RouteManager._frameworkIntegration
 */
RouteManager._frameworkIntegration = {
    /**
     * Set up route change listener for a component instance
     * @param {Object} instance - WildflowerJS component instance
     */
    setupRouteListener(instance) {
        const { definition, context } = instance;

        // Check if component has onRouteChange hook
        if (typeof definition.onRouteChange !== 'function') {
            return;
        }

        // Create bound handler - bind to context so 'this' works properly in the hook
        const boundHandler = (event) => {
            try {
                const { to, from } = event.detail;
                // Call the hook from definition but bound to context (so 'this' works)
                definition.onRouteChange.call(context, to, from);
            } catch (error) {
                wfError(WF_ERRORS.ROUTE_HOOK_ERROR, { context: `onRouteChange (${instance.name})`, cause: error });
            }
        };

        // Store reference for cleanup
        instance._routeChangeHandler = boundHandler;

        // Add listener
        document.addEventListener('route:afterChange', boundHandler);
    },

    /**
     * Clean up route change listener for a component instance
     * @param {Object} instance - WildflowerJS component instance
     */
    cleanupRouteListener(instance) {
        if (instance._routeChangeHandler) {
            document.removeEventListener('route:afterChange', instance._routeChangeHandler);
            instance._routeChangeHandler = null;
        }
    },

    /**
     * Initialize framework integration by listening to component lifecycle events
     */
    init() {
        // Listen for component initialization
        document.addEventListener('wildflower:componentInit', (event) => {
            const { instance } = event.detail;
            if (instance) {
                RouteManager._frameworkIntegration.setupRouteListener(instance);
            }
        });

        // Listen for component destruction
        document.addEventListener('wildflower:componentDestroy', (event) => {
            const { instance } = event.detail;
            if (instance) {
                RouteManager._frameworkIntegration.cleanupRouteListener(instance);
            }
        });
    }
};

// Auto-initialize framework integration
RouteManager._frameworkIntegration.init();

// ==================== WILDFLOWER.CREATEROUTER() FACTORY ====================

/**
 * Factory function to create and initialize a router instance
 * @param {object} options - Router configuration options
 * @returns {RouteManager} - Initialized router instance
 *
 * @example
 * const router = wildflower.createRouter({
 *     mode: 'history',
 *     viewTransitions: true,
 *     routes: [
 *         { path: '/', handler: () => '<div>Home</div>' },
 *         { path: '/about', handler: () => '<div>About</div>' }
 *     ],
 *     outlet: '#app'
 * });
 */
RouteManager.create = function(options = {}) {
    const router = new RouteManager(options);
    router.init();
    return router;
};

export default RouteManager;
