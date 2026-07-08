/**
 * WildflowerJS TypeScript Definitions
 * A lightweight reactive framework with no build step required
 *
 * @version 1.0.0
 * @license MIT
 */

// =============================================================================
// OPTIONS & CONFIGURATION
// =============================================================================

/**
 * Options for initializing WildflowerJS
 */
export interface WildflowerOptions {
  /** Enable debug mode for detailed logging */
  debug?: boolean;

  /** Automatically initialize components on DOM ready (default: true) */
  autoInit?: boolean;

  /** Error handling strategy: 'log' | 'throw' | 'silent' */
  errorHandling?: 'log' | 'throw' | 'silent';

  /** When true, only process data-wf-* attributes (ignore data-*) */
  useWfPrefixOnly?: boolean;

  /** When true, throw on prop validation failures even in production */
  strictProps?: boolean;

  /** Enable automatic performance optimizations (default: true) */
  autoOptimize?: boolean;
}

// =============================================================================
// STATE & COMPONENT TYPES
// =============================================================================

/**
 * Component state - can be any object with string keys
 */
export type ComponentState = Record<string, any>;

/**
 * Component definition structure
 * @template TState - The type of the component's state
 */
export interface ComponentDefinition<TState extends ComponentState = ComponentState> {
  /** Initial state for the component */
  state?: TState;

  /** Computed properties derived from state */
  computed?: Record<string, (this: ComponentContext<TState>) => any>;

  /** Lifecycle: called before bindings are processed */
  beforeInit?: (this: ComponentContext<TState>) => void;

  /** Lifecycle: called when component is initialized */
  init?: (this: ComponentContext<TState>) => void;

  /** Lifecycle: called when component state updates */
  onUpdate?: (this: ComponentContext<TState>, path: string, newValue: any, oldValue: any) => void;

  /** Lifecycle: called before component is destroyed (while bindings still active) */
  beforeDestroy?: (this: ComponentContext<TState>) => void;

  /** Lifecycle: called when component is destroyed */
  destroy?: (this: ComponentContext<TState>) => void;

  /** Optional explicit type declarations for state properties (for runtime validation) */
  types?: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object' | 'function' | 'any'>;

  /** Props configuration for parent-to-child data passing */
  props?: Record<string, PropConfig | string>;

  /** Store dependencies - names of stores this component uses */
  stores?: string[];

  /**
   * Entity pools for high-frequency reactive rendering.
   * Each pool renders plain-object data via template binding without reactive proxy overhead.
   * Access at runtime via `this.pools.poolName` inside component methods.
   */
  pools?: Record<string, PoolConfig>;

  /** Custom methods - available on this.context */
  [key: string]: any;
}

/**
 * Pool configuration — declared on a component's `pools` field.
 * Pools render collections of plain objects (no reactive proxy overhead)
 * via declarative template binding, with optional culling, FPS throttling,
 * and DOM recycling.
 */
export interface PoolConfig {
  /** Initial entities to populate the pool */
  items?: Array<Record<string, any>>;

  /** Shared props object (parent-injected data accessible from pool item templates via `props.`) */
  props?: Record<string, any>;

  /** Called when an entity is added to the pool */
  onAdd?: (item: Record<string, any>) => void;

  /** Called when an entity is removed from the pool */
  onRemove?: (item: Record<string, any>) => void;

  /** Called when the pool is cleared */
  onClear?: () => void;
}

/**
 * Runtime pool handle — returned by `this.pool(name)` or accessed via `this.pools.name`.
 * @template T - Shape of entities stored in this pool
 */
export interface PoolHandle<T extends Record<string, any> = Record<string, any>> {
  /** Add one entity or many (bulk add via array is a single DOM op) */
  add(item: T | T[]): T | T[];

  /** Remove an entity by its key value */
  remove(key: string | number): void;

  /** Get an entity by its key value, or undefined if not found */
  get(key: string | number): T | undefined;

  /** Get an entity by DOM position (visual order) */
  at(index: number): T | undefined;

  /** Patch properties on an entity (sync for static pools) */
  update(key: string | number, patch: Partial<T>): void;

  /** Mark an entity as dirty — its bindings will re-evaluate on next flush */
  markDirty(key: string | number): void;

  /** Swap two entities' DOM positions */
  swap(key1: string | number, key2: string | number): boolean;

  /** Remove all entities */
  clear(): void;

  /** Raw array of entities — mutate properties freely */
  readonly items: T[];

  /** Current entity count */
  readonly size: number;

  /** Shared props object (parent-injected data, accessible in templates via `props.`) */
  props: Record<string, any>;

  /** Get the DOM element for an entity by key */
  getElement(key: string | number): HTMLElement | undefined;

  /** Callback fired when the pool's contents change (add/remove/clear) */
  onChange: ((pool: PoolHandle<T>) => void) | null;
}

/**
 * Prop configuration for component props
 */
export interface PropConfig {
  /** The type of the prop */
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'function' | 'any';

  /** Whether the prop is required */
  required?: boolean;

  /** Default value if not provided */
  default?: any;

  /** Custom validation function */
  validator?: (value: any) => boolean;
}

/**
 * Component context - the 'this' context inside component methods
 * @template TState - The type of the component's state
 */
export interface ComponentContext<TState extends ComponentState = ComponentState> {
  /** Component ID */
  id: string;

  /** Component name */
  name: string;

  /** Reactive state object */
  state: TState;

  /** Reference to the root DOM element */
  element: HTMLElement;

  /** Parent component instance (if nested) */
  parent?: ComponentInstance;

  /** Child component instances */
  children: ComponentInstance[];

  /**
   * Pool handles for any pools declared in the component definition's `pools` field.
   * Access as `this.pools.poolName` inside component methods.
   */
  pools: Record<string, PoolHandle>;

  /**
   * Get a pool handle by name. Equivalent to `this.pools[name]`.
   * @param name - The pool name as declared in the component's `pools` field
   */
  pool(name: string): PoolHandle | undefined;

  /**
   * Get value from another component or store
   * @param componentNameOrId - Name or ID of the target component/store
   * @param path - Property path to retrieve (e.g., 'count', 'computed:total')
   */
  external(componentNameOrId: string, path: string): any;

  /**
   * Emit an event to parent components
   * Parent receives via onEventName handler (e.g., emit('save') -> parent.onSave())
   * @param eventName - Name of the event
   * @param detail - Optional data to pass with the event
   */
  emit(eventName: string, detail?: any): boolean;

  /**
   * Access or update a store's state
   * @param storeName - Name of the store
   * @param path - Property path (for get) or path to set
   * @param value - Value to set (if setting)
   */
  store(storeName: string, path?: string, value?: any): any;

  /**
   * Open a modal dialog from a template
   * @param templateId - ID of the template element
   * @param data - Data to pass to the modal
   * @returns Promise resolving to modal result
   */
  openModal<T = any>(templateId: string, data?: Record<string, any>): Promise<T>;

  /**
   * Close the current modal (call from within modal component)
   * @param result - Result to return to the opener
   */
  closeModal(result?: any): void;

  /** Update component state (partial update) */
  setState(updates: Partial<TState>): void;

  /** Get value from nested path */
  get(path: string): any;

  /** Set value at nested path */
  set(path: string, value: any): void;
}

/**
 * Component instance returned by getComponent methods
 * @template TState - The type of the component's state
 */
export interface ComponentInstance<TState extends ComponentState = ComponentState> {
  /** Component ID */
  id: string;

  /** Component name */
  name: string;

  /** Reactive state object */
  state: TState;

  /** Reference to the root DOM element */
  element: HTMLElement;

  /** Parent component instance (if nested) */
  parent?: ComponentInstance;

  /** Child component instances */
  children: ComponentInstance[];

  /** The component's context object with methods */
  context: ComponentContext<TState>;

  /** The component definition */
  definition: ComponentDefinition<TState>;

  /** The reactive state manager */
  stateManager: ReactiveStateManager;
}

// =============================================================================
// ROUTE MANAGER
// =============================================================================

/**
 * Options for initializing the RouteManager
 */
export interface RouteManagerOptions {
  /** Routing mode: 'history' (pushState) or 'hash' (hash-based) */
  mode?: 'history' | 'hash';

  /** Base path for the application */
  base?: string;

  /** Default route to navigate to if no match */
  defaultRoute?: string;

  /** Custom scroll behavior function */
  scrollBehavior?: (to: Route, from: Route | null) => void;

  /** Timeout for lazy component loading (ms) */
  loadingTimeout?: number;

  /** Callback when component loading starts */
  onLoadingStart?: () => void;

  /** Callback when component loading ends */
  onLoadingEnd?: () => void;

  /** Callback when component loading fails */
  onLoadingError?: (error: Error) => void;

  /** Callback when component loading times out */
  onLoadingTimeout?: () => void;

  /** Centralized route configuration array */
  routes?: RouteConfig[];
}

/**
 * Route configuration object
 */
export interface RouteConfig {
  /** URL pattern (e.g., '/users/:id') */
  path: string;

  /** Optional named route identifier */
  name?: string;

  /** Route handler function */
  handler?: (context: RouteContext) => void;

  /** Lazy-loaded component factory */
  component?: () => Promise<any>;

  /** Route metadata (accessible in guards and handlers) */
  meta?: Record<string, any>;

  /** Per-route navigation guard */
  beforeEnter?: RouteGuard;

  /** Redirect target (path or config) */
  redirect?: string | { path: string; query?: Record<string, string> };

  /** Route aliases */
  alias?: string | string[];

  /** Default parameter values */
  defaults?: Record<string, string>;

  /** Nested child routes */
  children?: RouteConfig[];
}

/**
 * Current route information
 */
export interface Route {
  /** Full path */
  path: string;

  /** Route name (if named) */
  name?: string;

  /** Extracted route parameters */
  params: Record<string, string>;

  /** Query string parameters */
  query: Record<string, string>;

  /** Route metadata */
  meta?: Record<string, any>;

  /** Hash fragment (without #) */
  hash?: string;

  /** Full URL */
  fullPath: string;
}

/**
 * Context passed to route handlers
 */
export interface RouteContext {
  /** Extracted route parameters */
  params: Record<string, string>;

  /** Query string parameters */
  query: Record<string, string>;

  /** Full path */
  path: string;

  /** The matched route configuration */
  route: Route;
}

/**
 * Navigation guard function
 * @returns undefined/true to proceed, false to cancel, string to redirect
 */
export type RouteGuard = (context: {
  to: Route;
  from: Route | null;
}) => undefined | true | false | string | { path: string; query?: Record<string, string> };

/**
 * After-navigation hook
 */
export type AfterHook = (to: Route, from: Route | null) => void;

/**
 * Route Manager class for client-side routing
 */
export interface RouteManager {
  /** Current route */
  readonly currentRoute: Route | null;

  /** Previous route */
  readonly previousRoute: Route | null;

  /** Whether the router has been initialized */
  readonly isInitialized: boolean;

  /**
   * Load routes from configuration array
   * @param routes - Array of route configurations
   */
  loadRoutes(routes: RouteConfig[]): this;

  /**
   * Register a route handler
   * @param pattern - URL pattern (e.g., '/users/:id')
   * @param handlerOrConfig - Handler function or route config
   */
  onRoute(pattern: string, handlerOrConfig: ((context: RouteContext) => void) | RouteConfig): this;

  /**
   * Register a global before-navigation guard
   * @param guard - Guard function
   */
  beforeEach(guard: RouteGuard): this;

  /**
   * Register a global after-navigation hook
   * @param hook - Hook function
   */
  afterEach(hook: AfterHook): this;

  /**
   * Add a route alias
   * @param aliasPath - The alias path
   * @param targetPath - The target path to redirect to
   */
  alias(aliasPath: string, targetPath: string): this;

  /**
   * Initialize the router (attach event listeners)
   */
  init(): this;

  /**
   * Generate URL for a named route
   * @param name - Route name
   * @param params - Route parameters
   * @param query - Query parameters
   */
  getRouteUrl(name: string, params?: Record<string, string>, query?: Record<string, string>): string;

  /**
   * Check if a route pattern matches the current URL
   * @param pattern - Route pattern or name
   * @param options - Match options
   */
  isActive(pattern: string, options?: { exact?: boolean }): boolean;

  /**
   * Get the current route
   */
  getCurrentRoute(): Route | null;

  /**
   * Navigate to a URL
   * @param url - URL to navigate to
   * @param options - Navigation options
   */
  navigate(url: string, options?: { replace?: boolean }): Promise<void>;

  /**
   * Navigate back in history
   */
  back(): void;

  /**
   * Navigate forward in history
   */
  forward(): void;

  /**
   * Destroy the router (remove event listeners)
   */
  destroy(): void;
}

// =============================================================================
// STORE MANAGER
// =============================================================================

/**
 * Store configuration object
 */
export interface StoreConfig<TState extends Record<string, any> = Record<string, any>> {
  /** Initial store state */
  state: TState;

  /** Computed properties derived from state */
  computed?: Record<string, (this: StoreContext<TState>) => any>;

  /** Watch handlers for state changes */
  watch?: Record<string, (this: StoreContext<TState>, newValue: any, oldValue: any) => void>;

  /** Lifecycle: called when store is initialized */
  init?: (this: StoreContext<TState>) => void;

  /** Store methods (actions) - defined at top level, not in separate 'actions' block */
  [key: string]: any;
}

/**
 * Store context - the 'this' context inside store methods
 */
export interface StoreContext<TState extends Record<string, any> = Record<string, any>> {
  /** Reactive state object */
  state: TState;

  /**
   * Get value at path
   * @param path - Dot-notation path
   */
  get(path: string): any;

  /**
   * Set value at path
   * @param path - Dot-notation path
   * @param value - Value to set
   */
  set(path: string, value: any): void;

  /**
   * Bulk update state
   * @param pathOrUpdates - Path string or updates object
   * @param value - Value if path string provided
   */
  update(pathOrUpdates: string | Partial<TState>, value?: any): void;

  /**
   * Reset state to initial values
   */
  reset(): void;

  /**
   * Subscribe to state changes
   * @param path - Path to watch (or '*' for all)
   * @param callback - Callback function
   * @param options - Subscription options
   * @returns Unsubscribe function
   */
  subscribe(
    path: string,
    callback: (newValue: any, oldValue: any, path: string) => void,
    options?: { immediate?: boolean; deep?: boolean }
  ): () => void;

  /**
   * Check if store is ready/initialized
   */
  isReady(): boolean;

  /**
   * Wait for store to be ready
   */
  waitForReady(): Promise<void>;
}

// =============================================================================
// PLUGIN SYSTEM
// =============================================================================

/**
 * Plugin install function
 */
export type PluginInstallFn = (framework: WildflowerJS, options?: any) => void;

/**
 * Plugin object with install method
 */
export interface PluginObject {
  /** Install function called when plugin is registered */
  install: PluginInstallFn;

  /** Plugin name (for identification) */
  name?: string;

  /** Plugin version */
  version?: string;

  /** Dependencies on other plugins */
  uses?: string[];

  /** Initial plugin state */
  state?: Record<string, any>;

  /** Computed properties */
  computed?: Record<string, () => any>;

  /** Plugin methods */
  methods?: Record<string, Function>;

  /** Watch handlers */
  watch?: Record<string, Function>;
}

/**
 * Plugin type - can be install function or plugin object
 */
export type Plugin = PluginInstallFn | PluginObject;

// =============================================================================
// DIRECTIVE SYSTEM
// =============================================================================

/**
 * Directive context passed to directive handlers
 */
export interface DirectiveContext {
  /** The component instance */
  component: ComponentInstance;

  /** The directive's binding path */
  path: string;

  /** The resolved value */
  resolvedValue: any;

  /** Current list item (if in list context) */
  listItem?: any;

  /** Current list index (if in list context) */
  listIndex?: number | null;

  /** Parent contexts */
  parentContexts: any[];
}

/**
 * Custom directive handlers
 */
export interface DirectiveHandlers {
  /**
   * Called when directive is first bound to element
   * @param element - The DOM element
   * @param value - The directive value
   * @param context - Directive context
   */
  init?: (element: HTMLElement, value: string, context: DirectiveContext) => void;

  /**
   * Called when the directive value updates
   * @param element - The DOM element
   * @param value - The new directive value
   * @param context - Directive context
   * @param oldValue - The previous value
   */
  update?: (element: HTMLElement, value: string, context: DirectiveContext, oldValue: string) => void;

  /**
   * Called when element is removed from DOM
   * @param element - The DOM element
   * @param value - The directive value
   * @param context - Directive context
   */
  destroy?: (element: HTMLElement, value: string, context: DirectiveContext) => void;
}

// =============================================================================
// HOOK SYSTEM
// =============================================================================

/**
 * Available hook names
 */
export type HookName =
  | 'component:beforeInit'
  | 'component:afterInit'
  | 'component:beforeUpdate'
  | 'component:afterUpdate'
  | 'component:beforeDestroy'
  | 'component:afterDestroy'
  | 'component:onPropsChange';

/**
 * Hook handler function
 */
export type HookHandler = (...args: any[]) => void;

// =============================================================================
// EVENT DELEGATION
// =============================================================================

/**
 * Options for event delegation
 */
export interface EventDelegationOptions {
  /** Only trigger for exact element matches (not descendants) */
  exact?: boolean;

  /** Debounce delay in milliseconds */
  debounce?: number;

  /** Throttle delay in milliseconds */
  throttle?: number;

  /** Capture phase instead of bubble */
  capture?: boolean;

  /** Passive event listener */
  passive?: boolean;

  /** Remove after first trigger */
  once?: boolean;
}

/**
 * Event handler function for delegation
 */
export type DelegatedEventHandler = (event: Event, element: HTMLElement) => void;

// =============================================================================
// CONTEXT REGISTRY
// =============================================================================

/**
 * Context types in the framework
 */
export type ContextType = 'binding' | 'action' | 'conditional' | 'list' | 'component';

/**
 * Context Registry for managing binding/action/conditional contexts
 */
export interface ContextRegistry {
  /**
   * Register a dependency between contexts
   */
  registerDependency(sourceContext: any, targetContext: any, path: string): void;

  /**
   * Get context by ID
   */
  getContextById(id: string): any;

  /**
   * Get all contexts of a specific type
   */
  getContextsByType(type: ContextType): any[];

  /**
   * Get contexts for a specific component
   */
  getContextsForComponent(componentId: string): any[];

  /**
   * Get context for a specific element
   */
  getContextForElement(element: HTMLElement): any | null;

  /**
   * Remove a context
   */
  removeContext(contextId: string): void;

  /**
   * Garbage collect orphaned contexts
   */
  garbageCollect(): void;
}

// =============================================================================
// REACTIVE STATE MANAGER
// =============================================================================

/**
 * Options for creating reactive state
 */
export interface ReactiveStateOptions {
  /** Callback when state changes */
  onStateChange?: (path: string, newValue: any, oldValue: any) => void;

  /** Local storage key for persistence */
  storageKey?: string | null;

  /** Auto-save to local storage */
  autoSave?: boolean;

  /** Component reference */
  component?: { id: string; name: string };
}

/**
 * Reactive State Manager
 */
export interface ReactiveStateManager {
  /**
   * Create reactive state from initial values
   * @param initialState - Initial state object
   */
  createState<T extends Record<string, any>>(initialState: T): T;

  /**
   * Get value at path
   * @param path - Dot-notation path
   */
  getValue(path: string): any;

  /**
   * Set value at path
   * @param path - Dot-notation path
   * @param value - Value to set
   */
  setValue(path: string, value: any): void;

  /**
   * Reset state to initial values
   */
  reset(): void;
}

// =============================================================================
// SSR MANAGER
// =============================================================================

/**
 * SSR Manager for server-side rendering support
 */
export interface SSRManager {
  /**
   * Activate SSR-rendered content (hydration)
   * @param element - Root element with SSR content
   */
  activate(element: HTMLElement): void;

  /**
   * Check if element has SSR content
   * @param element - Element to check
   */
  hasSSRContent(element: HTMLElement): boolean;

  /**
   * Get SSR state from element
   * @param element - Element with SSR state
   */
  getSSRState(element: HTMLElement): Record<string, any> | null;
}

// =============================================================================
// MAIN WILDFLOWERJS CLASS
// =============================================================================

/**
 * Main WildflowerJS class
 */
export default class WildflowerJS {
  /**
   * Create a new WildflowerJS instance
   * @param root - Root element, document, or selector for the app
   * @param options - Configuration options
   */
  constructor(root: HTMLElement | Document | string, options?: WildflowerOptions);

  /** The root DOM element for this instance */
  readonly root: HTMLElement | Document;

  /** Configuration options */
  readonly options: Required<WildflowerOptions>;

  /** Debug mode flag */
  readonly debug: boolean;

  /** Component definitions registry */
  readonly componentDefinitions: Map<string, ComponentDefinition>;

  /** Component instances registry */
  readonly componentInstances: Map<string, ComponentInstance>;

  /** Context registry */
  readonly contextRegistry: ContextRegistry;

  /** Store manager */
  readonly storeManager: StoreManager;

  /** SSR manager (if enabled) */
  readonly ssrManager: SSRManager | null;

  // =========================================================================
  // COMPONENT METHODS
  // =========================================================================

  /**
   * Register a component definition
   * @param name - Unique name for the component
   * @param definition - Component configuration
   * @returns The WildflowerJS instance for chaining
   */
  component<TState extends ComponentState = ComponentState>(
    name: string,
    definition: ComponentDefinition<TState>
  ): this;

  /**
   * Get a component's context proxy by name (first match).
   * Returns a proxy where state properties are accessible directly (e.g., ctx.count).
   * @param name - Component name
   */
  getComponent(name: string): (Record<string, any> & { element: HTMLElement; id: string; name: string }) | null;

  /**
   * Get all component context proxies by name.
   * @param name - Component name
   */
  getComponents(name: string): Array<Record<string, any> & { element: HTMLElement; id: string; name: string }>;

  /**
   * Get all registered component instances
   */
  getAllComponentInstances(): ComponentInstance[];

  /**
   * Check if a component instance exists
   * @param componentId - Component ID
   */
  hasComponentInstance(componentId: string): boolean;

  /**
   * Get a component definition by name
   * @param componentName - Component name
   */
  getComponentDefinition(componentName: string): ComponentDefinition | undefined;

  /**
   * Check if a component definition exists
   * @param componentName - Component name
   */
  hasComponentDefinition(componentName: string): boolean;

  /**
   * Get all registered component names
   */
  getRegisteredComponentNames(): string[];

  /**
   * Destroy a specific component
   * @param componentId - Component ID to destroy
   */
  destroyComponent(componentId: string): void;

  /**
   * Clear component definitions within a scope
   * @param scope - DOM element scope (null for global)
   * @param preserve - Component names to preserve
   * @returns Array of cleared component names
   */
  clearComponentDefinitions(scope?: HTMLElement | null, preserve?: string[]): string[];

  // =========================================================================
  // ROUTING METHODS
  // =========================================================================

  /**
   * Create and configure a router
   * @param options - Router configuration
   */
  router(options?: RouteManagerOptions): RouteManager;

  // =========================================================================
  // STORE METHODS
  // =========================================================================

  /**
   * Create a new store
   * @param name - Store name
   * @param config - Store configuration
   */
  store<TState extends Record<string, any> = Record<string, any>>(
    name: string,
    config: StoreConfig<TState>
  ): StoreContext<TState>;

  /**
   * Get an existing store by name
   * @param name - Store name
   */
  getStore<TState extends Record<string, any> = Record<string, any>>(
    name: string
  ): StoreContext<TState> | undefined;

  // =========================================================================
  // PLUGIN METHODS
  // =========================================================================

  /**
   * Register a plugin
   * @param plugin - Plugin function or object
   * @param options - Plugin options
   */
  plugin(plugin: Plugin, options?: any): this;

  /**
   * Get a registered plugin by name
   * @param name - Plugin name
   */
  getPlugin(name: string): PluginObject | undefined;

  /**
   * Check if a plugin is registered
   * @param name - Plugin name
   */
  hasPlugin(name: string): boolean;

  /**
   * Get list of registered plugin names
   */
  listPlugins(): string[];

  // =========================================================================
  // DIRECTIVE METHODS
  // =========================================================================

  /**
   * Register a custom directive
   * @param name - Directive name (used as data-{name})
   * @param handlers - Directive lifecycle handlers
   */
  directive(name: string, handlers: DirectiveHandlers): this;

  // =========================================================================
  // HOOK METHODS
  // =========================================================================

  /**
   * Register a lifecycle hook
   * @param hookName - Name of the hook
   * @param handler - Handler function
   */
  hook(hookName: HookName, handler: HookHandler): this;

  // =========================================================================
  // DEPENDENCY INJECTION
  // =========================================================================

  /**
   * Provide a service for dependency injection
   * @param key - Service key
   * @param value - Service value
   */
  provide(key: string, value: any): this;

  /**
   * Get a provided service
   * @param key - Service key
   */
  getService(key: string): any | undefined;

  /**
   * Check if a service is provided
   * @param key - Service key
   */
  hasProvider(key: string): boolean;

  // =========================================================================
  // EVENT DELEGATION
  // =========================================================================

  /**
   * Register a delegated event handler
   * @param eventType - Event type (e.g., 'click')
   * @param selector - CSS selector to match
   * @param handler - Event handler function
   * @param options - Delegation options
   * @returns Cleanup function
   */
  on(
    eventType: string,
    selector: string,
    handler: DelegatedEventHandler,
    options?: EventDelegationOptions
  ): () => void;

  // =========================================================================
  // BATCH UPDATES
  // =========================================================================

  /**
   * Start a batch update (defers DOM updates)
   */
  startBatch(): void;

  /**
   * Apply batched updates
   */
  applyBatch(): void;

  /**
   * Cancel batched updates
   */
  cancelBatch(): void;

  // =========================================================================
  // MODAL METHODS
  // =========================================================================

  /**
   * Open a modal from a template
   * @param templateId - ID of the template element
   * @param data - Data to pass to the modal
   * @returns Promise resolving to modal result
   */
  openModal<T = any>(templateId: string, data?: Record<string, any>): Promise<T>;

  /**
   * Close a modal
   * @param modalOrId - Modal element or template ID
   */
  closeModal(modalOrId: HTMLElement | string): void;

  // =========================================================================
  // ERROR HANDLING
  // =========================================================================

  /**
   * Register a global error handler
   * @param handler - Error handler function
   */
  onError(handler: (error: Error, context?: any) => void): this;

  /**
   * Remove a global error handler
   * @param handler - Handler to remove
   */
  offError(handler: Function): this;

  // =========================================================================
  // UTILITY METHODS
  // =========================================================================

  /**
   * Evaluate an expression in a component context
   * @param expression - Expression string
   * @param state - State object
   * @param options - Evaluation options
   */
  evaluateExpression(expression: string, state: Record<string, any>, options?: {
    additionalContext?: Record<string, any>;
    cachePrefix?: string;
  }): any;

  /**
   * Check if a string is an expression (vs simple path)
   * @param str - String to check
   */
  isExpression(str: string): boolean;

  /**
   * Get context statistics for debugging
   */
  getContextStats(): {
    total: number;
    byType: Record<ContextType, number>;
  };

  /**
   * Manually rescan for item templates in a component
   * @param elementOrId - Component element or ID
   */
  rescanItemTemplates(elementOrId: HTMLElement | string): void;

  /**
   * Update a specific item in a list
   * @param context - List context
   * @param itemIndex - Index of item to update
   * @param updates - Updates to apply
   */
  updateListItem(context: any, itemIndex: number, updates: Record<string, any>): void;

  /**
   * Clean up orphaned components and contexts
   */
  garbageCollect(): void;

  /**
   * Completely destroy the framework instance
   */
  destroy(): void;

  /**
   * Initialize the framework (called automatically if autoInit is true)
   */
  init(): void;

  /**
   * Scan for new components in the DOM. Call after dynamically adding
   * HTML that contains data-component elements (e.g., after a third-party
   * library renders content, or after inserting HTML via innerHTML).
   * @param scope - Optional element or selector to limit the scan area.
   *                If omitted, scans the entire document.
   */
  scan(scope?: HTMLElement | string): void;

  /**
   * Returns a Promise that resolves when all pending reactive updates,
   * effect flushes, and microtasks have settled. Useful in tests and
   * after programmatic state changes that need the DOM to be up to date.
   */
  whenSettled(): Promise<void>;

  /**
   * Set exclusive WildflowerJS prefix mode
   * @param exclusive - When true, only process data-wf-* attributes
   */
  setWfPrefixMode(exclusive: boolean): void;

  /**
   * Reset event delegation state
   */
  resetEventDelegation(): void;

  /**
   * Add a hook to run before content updates (e.g., for syntax highlighting)
   * @param hookFn - Hook function that returns true to prevent update
   */
  addBeforeContentUpdateHook(hookFn: (element: HTMLElement, content: string) => boolean): void;
}

// =============================================================================
// STORE MANAGER CLASS
// =============================================================================

/**
 * Store Manager for global state management
 */
export interface StoreManager {
  /**
   * Create a store component
   * @param name - Store name
   * @param definition - Store definition
   */
  createStoreComponent<TState extends Record<string, any>>(
    name: string,
    definition: StoreConfig<TState>
  ): StoreContext<TState>;

  /**
   * Get a store component by name
   * @param name - Store name
   */
  getStoreComponentByName(name: string): StoreContext | undefined;

  /**
   * Check if a store exists
   * @param name - Store name
   */
  hasStore(name: string): boolean;

  /**
   * Destroy a store
   * @param name - Store name
   */
  destroyStore(name: string): void;
}

// =============================================================================
// GLOBAL AUGMENTATION
// =============================================================================

declare global {
  interface Window {
    /** Global WildflowerJS class */
    WildflowerJS: typeof WildflowerJS;

    /** Global wildflower instance (if using CDN) */
    wildflower: WildflowerJS;
  }
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

export {
  WildflowerJS,
  WildflowerOptions,
  ComponentDefinition,
  ComponentInstance,
  ComponentContext,
  ComponentState,
  PropConfig,
  PoolConfig,
  PoolHandle,
  RouteManager,
  RouteManagerOptions,
  RouteConfig,
  Route,
  RouteContext,
  RouteGuard,
  AfterHook,
  StoreConfig,
  StoreContext,
  StoreManager,
  Plugin,
  PluginObject,
  PluginInstallFn,
  DirectiveHandlers,
  DirectiveContext,
  HookName,
  HookHandler,
  EventDelegationOptions,
  DelegatedEventHandler,
  ContextRegistry,
  ContextType,
  ReactiveStateManager,
  ReactiveStateOptions,
  SSRManager
};
