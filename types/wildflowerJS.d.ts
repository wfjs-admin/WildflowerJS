/**
 * WildflowerJS TypeScript Definitions
 * A lightweight reactive framework with no build step required
 *
 * @version 1.5.1
 * @license MIT
 *
 * The bundles are IIFEs that assign `window.wildflower`; import this file for
 * types only. Surface as of 1.5.1: components, stores, plugins, pools,
 * routing (spa/full), data queries (full).
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

  /** Milliseconds to wait for subscribed stores before init() runs (default: 5000) */
  subscribeTimeout?: number;

  /** Always evaluate binding expressions with the CSP-safe parser, never `new Function` */
  forceCSPMode?: boolean;

  /** Sanitizer applied to data-bind-html content before insertion (default: none) */
  htmlSanitizer?: ((html: string) => string) | null;

  /**
   * Default request headers for data queries, keyed by origin
   * ('https://api.example.com') or 'self' for the document's own origin.
   * A query's own `headers:` declaration wins over these.
   */
  headers?: Record<string, Record<string, string> | (() => Record<string, string>)>;
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
   * The array form declares pool names only.
   */
  pools?: Record<string, PoolConfig> | string[];

  /** Watch handlers keyed by state path; append `:immediate` to run once on init */
  watch?: Record<string, (this: ComponentContext<TState>, newValue: any, oldValue: any) => void>;

  /** Stores to inject on `this.stores`; init() waits for them (see subscribeTimeout) */
  subscribe?: string[] | Record<string, string[] | boolean>;

  /** Per-component override of the store wait, in milliseconds */
  subscribeTimeout?: number;

  /** Cross-field form rules; the key is the user-facing message */
  rules?: Record<string, string | RuleConfig>;

  /** Services from plugins, injected on `this` */
  uses?: string[];

  /** Lifecycle: called before each DOM update pass */
  beforeUpdate?: (this: ComponentContext<TState>) => void;

  /** Lifecycle: receives errors thrown by this component's methods and lifecycle hooks */
  onError?: (this: ComponentContext<TState>, error: Error, info?: any) => void;

  /** Called every animation frame, before pool flush. dt in ms (clamped to 250), now from performance.now() */
  tick?: (this: ComponentContext<TState>, dt: number, now: number) => void;

  /** Called when a subscribed store changes */
  onStoreUpdate?: (this: ComponentContext<TState>, storeName: string, path: string, newValue: any, oldValue: any) => void;

  /** Called when props passed from the parent change */
  onPropsChange?: (this: ComponentContext<TState>, info: { changed: string[]; props: Record<string, any>; previous: Record<string, any> }) => void;

  /** Called after a route change (spa and full builds) */
  onRouteChange?: (this: ComponentContext<TState>, route: Route) => void;

  /** Custom methods - available on this.context */
  [key: string]: any;
}

/**
 * Pool configuration — declared on a component's `pools` field.
 * Pools render collections of plain objects (no reactive proxy overhead)
 * via declarative template binding, with optional culling, FPS throttling,
 * and DOM recycling.
 */
export interface PoolConfig<T extends Record<string, any> = Record<string, any>> {
  /** Initial entities to populate the pool */
  items?: T[];

  /** Shared props object (parent-injected data accessible from pool item templates via `props.`) */
  props?: Record<string, any>;

  /** Called when an entity is added: a component method name, or a function */
  onAdd?: string | ((item: T) => void);

  /** Called before each removal: a component method name, or a function */
  onRemove?: string | ((item: T) => void);

  /** Called once on clear(), skipping onRemove */
  onClear?: string | (() => void);

  /** Shape shared by every entity in the pool: state defaults, per-entity computeds, methods */
  entity?: PoolEntityShape<T>;
}

/**
 * Shared shape for every entity in a pool. Methods and computeds run with
 * `this` bound to the entity. Spawn-provided values win over `state` defaults.
 */
export interface PoolEntityShape<T extends Record<string, any> = Record<string, any>> {
  state?: Partial<T>;
  computed?: Record<string, (this: T & Record<string, any>) => any>;
  [method: string]: any;
}

/**
 * Cross-field form rule, declared under a component's `rules` field.
 * The rule's key is the user-facing message.
 */
export interface RuleConfig {
  /** Expression string, or a predicate, that must hold */
  check: string | (() => boolean);

  /** Expression string; the rule applies only while it is truthy */
  when?: string;

  message?: string;

  /** Fields the message is reported against */
  fields?: string[];
}

/**
 * Runtime pool handle — returned by `this.getPool(name)` or accessed via `this.pools.name`.
 * Entities are plain objects: mutate them and let the frame loop flush, or call markDirty().
 * @template T - Shape of entities stored in this pool
 */
export interface PoolHandle<T extends Record<string, any> = Record<string, any>> {
  /** Add one entity or many (bulk add via array is a single DOM op) */
  add(item: T | T[]): T | T[];

  /** Alias of add() */
  push(item: T | T[]): T | T[];

  /** Entity count; reactive when read inside a computed (`items.length` is not) */
  readonly length: number;

  /** Iterates the entities in storage order */
  [Symbol.iterator](): Iterator<T>;

  filter(fn: (item: T) => boolean): T[];
  map<R>(fn: (item: T) => R): R[];
  find(fn: (item: T) => boolean): T | undefined;
  forEach(fn: (item: T) => void): void;
  some(fn: (item: T) => boolean): boolean;
  every(fn: (item: T) => boolean): boolean;
  reduce<R>(fn: (acc: R, item: T) => R, initial: R): R;

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
 * jQuery-like wrapper returned by `this.$el()`, scoped to the component element.
 * Event handlers registered through it are removed when the component is destroyed.
 */
export interface DollarEl {
  /** First matched element, or null */
  readonly el: HTMLElement | null;
  readonly length: number;
  get(index: number): HTMLElement | undefined;
  each(fn: (el: HTMLElement, index: number) => void): DollarEl;
  addClass(names: string): DollarEl;
  removeClass(names: string): DollarEl;
  toggleClass(name: string): DollarEl;
  css(prop: string, value: string): DollarEl;
  css(props: Record<string, string>): DollarEl;
  attr(name: string, value: string): DollarEl;
  text(value: string): DollarEl;
  /** Sets innerHTML and scans the result for components */
  html(value: string): DollarEl;
  /** Sets the value and dispatches `input`, so `data-model` sees it */
  val(value: string): DollarEl;
  show(): DollarEl;
  hide(): DollarEl;
  on(event: string, handler: (event: Event) => void): DollarEl;
  off(event: string, handler?: (event: Event) => void): DollarEl;
  trigger(event: string): DollarEl;
  find(selector: string): DollarEl;
  parent(): DollarEl;
  closest(selector: string): DollarEl;
  children(): DollarEl;
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

  /** Read-only props from data-prop-* / data-props */
  readonly props: Record<string, any>;

  /**
   * Pool handles for any pools declared in the component definition's `pools` field.
   * Access as `this.pools.poolName` inside component methods.
   */
  pools: Record<string, PoolHandle>;

  /**
   * Get a pool handle by name, including markup-only pools (a `data-pool`
   * element with no entry in the `pools` field). Renamed from `pool()` in 1.3.0.
   */
  getPool<T extends Record<string, any> = Record<string, any>>(name: string): PoolHandle<T> | null;

  /** Stores declared in `subscribe`, keyed by name, available once init() runs */
  stores: Record<string, StoreContext & Record<string, any>>;

  /** A store by name. State fields, computeds, and methods sit directly on the handle */
  getStore<TStore extends Record<string, any> = Record<string, any>>(
    name?: string
  ): (StoreContext<TStore> & TStore & Record<string, any>) | undefined;

  /**
   * Read, or with a value write, another entity's state by name or id
   * @param entityNameOrId - Component, store, or plugin name, or a component id
   * @param path - Property path (e.g., 'count', 'computed:total')
   * @param value - When given, the value to write
   */
  external(entityNameOrId: string, path: string, value?: any): any;

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

  /** Partial state update: a path and value, or an object of paths */
  update(pathOrUpdates: string | Partial<TState>, value?: any): void;

  /** Subscribe to state changes on a path ('*' for all). Returns an unsubscribe function */
  subscribe(
    path: string,
    callback: (newValue: any, oldValue: any, path: string) => void,
    options?: { immediate?: boolean; deep?: boolean }
  ): () => void;

  /** True once init() has completed */
  isReady(): boolean;

  /** Resolves once init() has completed */
  waitForReady(): Promise<void>;

  /** jQuery-like wrapper scoped to the component element */
  $el(selector?: string | Element): DollarEl;

  /** querySelector scoped to the component element */
  find(selector: string): Element | null;

  /** querySelectorAll scoped to the component element */
  findAll(selector: string): NodeListOf<Element>;

  /** closest() from the component element */
  closest(selector: string): Element | null;

  /** The list row (or pool entity) whose element an event came from, or null */
  getItemFromEvent(event: Event): any;

  /** Re-bind data-action handlers after markup inside the component was replaced */
  rebindActions(): void;

  /** Persist state to localStorage under the component's `data-storage-key` */
  saveToStorage(): void;

  /** Restore state from localStorage */
  loadFromStorage(): void;

  /** Clear the component's error-boundary state so it renders normally again */
  resetError(): void;

  /** The list row this component was rendered inside, if any */
  readonly listItem: any;

  /** Set by data-validate-on forms */
  formValid: boolean;

  /** Field validation messages, set by data-validate-on forms */
  validationErrors: Record<string, string>;
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

  /** Other stores this store reads through `this.stores` */
  subscribe?: string[] | Record<string, string[] | boolean>;

  /** localStorage key. With autoSave, state is written on every change and restored on load */
  storageKey?: string;
  autoSave?: boolean;

  /** Lifecycle: called before the store is destroyed */
  beforeDestroy?: (this: StoreContext<TState>) => void;

  /** Lifecycle: called when the store is destroyed */
  destroy?: (this: StoreContext<TState>) => void;

  /** Called every animation frame. dt in ms (clamped to 250), now from performance.now() */
  tick?: (this: StoreContext<TState>, dt: number, now: number) => void;

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
  /** Install function called when plugin is registered. Optional since 1.5.1: a plugin that is only state, computed, and methods needs none */
  install?: PluginInstallFn;

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

  /** Top-level functions become plugin methods, callable as `wildflower.$name.method()` */
  [key: string]: any;
}

/**
 * Plugin type - can be install function or plugin object
 */
export type Plugin = PluginInstallFn | PluginObject;

// =============================================================================
// DATA QUERIES (full build)
// =============================================================================

/**
 * A refresh rung. A number polls every N seconds; 'etag:N' re-checks
 * conditionally at most every N seconds; 'fresh:N' skips event-driven
 * refetches while the last sync is younger than N seconds.
 */
export type RefreshRung =
  | number | 'focus' | 'reconnect' | 'sse' | 'once'
  | `etag:${number}` | `fresh:${number}`;

/**
 * One entry in a query's `to` map, or its `create` entry
 */
export interface WriteOperation<T = any> {
  /** `:token` placeholders are filled from the item and from params */
  url: string;

  /** Defaults: PATCH for update, DELETE for delete, POST for create and any named operation */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | (string & {});

  /** Builds the request body from the item. Nothing is sent without it */
  body?: (item: Partial<T> & Record<string, any>) => any;

  /**
   * Decides what the ok response meant. Receives the parsed body and the
   * item that was written. Return a record to reconcile it, return `item`
   * to keep what was written with no refetch, throw to reject and roll
   * back. Absent, the query refetches instead.
   */
  confirmation?: (responseBody: any, item: Partial<T> & Record<string, any>) => Partial<T> | null | undefined | void;
}

/**
 * Declaration passed to `wildflower.query(name, config)`
 */
export interface QueryConfig<T = any> {
  /** Read source: a URL with `:token` placeholders, or a function returning the rows (or a promise of them) */
  from: string | ((params: Record<string, any>) => any);

  /** Row identity field (default: 'id') */
  key?: string;

  /** Fills URL tokens; anything left over joins the read query string */
  params?: Record<string, any> | (() => Record<string, any>);

  /** Sent with reads and writes, never with the 'sse' stream. A function runs once per attempt */
  headers?: Record<string, string> | (() => Record<string, string>);

  /** Shapes the response, e.g. unwraps an envelope */
  select?: (data: any) => any;

  /** Rows shown before the first fetch resolves */
  initial?: T[];

  refresh?: RefreshRung | RefreshRung[];

  /** Event-stream URL for the 'sse' rung (defaults to `from`) */
  stream?: string;

  /** Retries after a failed read, with backoff (default: 0) */
  retry?: number;

  /** true, or a storage key: the last confirmed rows survive a reload */
  persist?: boolean | string;

  /** Tombstone field: a truthy value on a written item removes the row and sends the delete */
  deleted?: string;

  /** Write destination: a URL string, a map of named operations, or a function doing the request */
  to?: string
    | Record<string, string | WriteOperation<T>>
    | ((item: Partial<T> & Record<string, any>) => any);

  /** Query-level body builder for update and create */
  body?: (item: Partial<T> & Record<string, any>) => any;

  /** Query-level record extractor for update and create. Receives `(body, item)` */
  confirmation?: (responseBody: any, item: Partial<T> & Record<string, any>) => Partial<T> | null | undefined | void;

  /** The operation that creates a row. The URL is the collection; a rejection removes the row */
  create?: string | WriteOperation<T>;
}

export interface RefreshOptions {
  params?: Record<string, any>;

  /** Add a page instead of replacing */
  append?: boolean;

  /** Drop current rows before the request */
  clear?: boolean;
}

/**
 * A query as returned by `getQuery()`, or bound as `$name` in markup
 */
export interface QueryHandle<T = any> {
  readonly rows: T[];
  readonly count: number;

  /** A fetch is in flight with no usable data yet */
  readonly isLoading: boolean;

  /** Data on screen the server has not yet confirmed */
  readonly isStale: boolean;

  /** The initial load failed */
  readonly error: any;

  /** A later refresh failed; existing rows were kept */
  readonly syncError: any;

  readonly lastSync: number | Date | null;

  /** Writes dispatched but not yet settled */
  readonly pendingWrites: number;

  refresh(options?: RefreshOptions): Promise<void>;

  /** Conditional refetch */
  invalidate(): Promise<void>;

  /** Apply local data with no transport */
  patch(data: Partial<T> | Partial<T>[]): void;

  /** Save the key plus the changed fields. Delete when the `deleted` field is truthy, update otherwise */
  write(item: Partial<T> & Record<string, any>): Promise<T | void>;

  /** Run a named operation from the `to` map */
  write(operation: string, item: Partial<T> & Record<string, any>): Promise<T | void>;

  /** Add a row through the `create` entry. The temporary key is minted for you */
  create(item: Partial<T> & Record<string, any>): Promise<T | void>;
}

/**
 * How `data-model` reads and writes a web component: its value property and change event
 */
export interface AdapterConfig {
  prop: string;
  event: string;
  [key: string]: any;
}

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

  /** Framework version string, stamped from the package version at build time */
  readonly version: string;

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
    definition: ComponentDefinition<TState> & ThisType<ComponentContext<TState> & TState & Record<string, any>>
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
   * Get all instances of a component type
   * @param name - Component name
   */
  getComponentsByType(name: string): ComponentInstance[];

  /**
   * Get a component instance by its id
   * @param componentId - Component ID
   */
  getComponentInstance(componentId: string): ComponentInstance | undefined;

  /**
   * Check if a component instance exists
   * @param componentId - Component ID
   */
  hasComponentInstance(componentId: string): boolean;

  /**
   * Destroy a specific component. Remove its element from the DOM as well,
   * or the next scan re-creates it.
   * @param componentId - Component ID to destroy
   */
  destroyComponent(componentId: string): void;

  /**
   * Free a component or store name so it can be registered again
   * @param name - Component or store name
   */
  unregister(name: string): void;

  // =========================================================================
  // ROUTING METHODS (spa and full builds)
  // =========================================================================

  /**
   * Create and configure a router. With a `routes` array the router
   * initializes itself; without one, register routes with onRoute() and
   * call init() yourself.
   * @param options - Router configuration
   */
  createRouter(options?: RouteManagerOptions): RouteManager;

  /** The RouteManager class, for `new wildflower.RouteManager(options)` */
  readonly RouteManager: new (options?: RouteManagerOptions) => RouteManager;

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
    config: StoreConfig<TState> & ThisType<StoreContext<TState> & TState & Record<string, any>>
  ): StoreContext<TState> & TState & Record<string, any>;

  /**
   * Get an existing store by name. State fields, computeds, and methods sit
   * directly on the handle (`store.count`), alongside the StoreContext API.
   * @param name - Store name
   */
  getStore<TState extends Record<string, any> = Record<string, any>>(
    name: string
  ): (StoreContext<TState> & TState & Record<string, any>) | undefined;

  // =========================================================================
  // DATA QUERY METHODS (full build)
  // =========================================================================

  /**
   * Declare a query: where rows come from, how fresh they stay, and where
   * changes go. Markup binds it with `data-query="name"` and reads state as `$name`.
   * @param name - Query name (a noun: the data it delivers)
   * @param config - Query declaration
   */
  query<T = any>(name: string, config: QueryConfig<T>): QueryHandle<T>;

  /**
   * Get a declared query's handle
   * @param name - Query name
   */
  getQuery<T = any>(name: string): QueryHandle<T> | undefined;

  /**
   * Mark several queries out of date and refetch them. Resolves once every
   * triggered refetch has settled; inactive queries are skipped.
   */
  invalidateQueries(...names: string[]): Promise<void>;

  /**
   * Remove persisted query rows from localStorage. No names clears every query's.
   */
  clearPersisted(...names: string[]): void;

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

  /**
   * Run a function as one batch: DOM updates are deferred until it returns
   * @param fn - Function performing the state changes
   */
  batch(fn: () => void): void;

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
   * Manually rescan for item templates in a component
   * @param elementOrId - Component element or ID
   */
  rescanItemTemplates(elementOrId: HTMLElement | string): void;

  /**
   * Change options after initialization (debug, errorHandling, forceCSPMode,
   * htmlSanitizer, per-origin query headers, ...)
   * @param options - Options to merge into the current configuration
   */
  config(options: Partial<WildflowerOptions>): this;

  /**
   * Deep plain-object snapshot of reactive state, for structured clone
   * (IndexedDB, postMessage, JSON)
   * @param value - Reactive value
   */
  toRaw<T>(value: T): T;

  /**
   * Install (or with null, remove) the sanitizer applied to data-bind-html content
   * @param fn - Sanitizer function
   */
  setHtmlSanitizer(fn: ((html: string) => string) | null): this;

  /**
   * Tell data-model how a web component exposes its value
   * @param tagName - Custom element tag name (e.g. 'sl-input')
   * @param config - Its value property and change event
   */
  registerAdapter(tagName: string, config: AdapterConfig): this;

  /**
   * Get the adapter registered for a tag name
   * @param tagName - Custom element tag name
   * @param element - Optional element, for adapters that inspect the instance
   */
  getAdapter(tagName: string, element?: Element): AdapterConfig | undefined;

  /**
   * Inspect the running application, or all instances of one component type.
   * Logs a structured summary and returns the data.
   * @param componentName - Optional component name
   */
  inspect(componentName?: string): any;

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
//
// Every type above is exported inline where it is declared. A trailing
// `export { ... }` block that re-exported them made every strict consumer
// (skipLibCheck off) fail with TS2484 on each name; it was removed after 1.5.0.
