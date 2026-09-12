// WildflowerJS editor typings for the script-tag global `wildflower`.
//
// This file is a global (non-module) declaration, so any editor that reads
// .d.ts files in the project (PHPStorm/WebStorm, VS Code) completes
// `wildflower.*`, the option keys of component/store/query/plugin
// definitions, and `this.*` inside methods, without any TypeScript in the
// app. Inside a definition, `this` is the component's own state, computed
// values, methods, pools, and stores, inferred from the literal you pass.
//
// Self-contained: routing and directive types are declared below, so the
// file can be copied anywhere. Shipped in the npm package as
// types/wildflower.global.d.ts (opt-in; the module typings in
// types/wildflowerJS.d.ts stay the package's `types` entry).

declare namespace WF {
    type AnyFn = (...args: any[]) => any;

    /** Computed getters read as values on `this`; item-level computeds (fn(item)) stay callable. */
    type Getters<C> = { readonly [K in keyof C]: C[K] extends () => infer R ? R : C[K] };

    // ── Actions ──────────────────────────────────────────────────────────

    /** Third argument of a `data-action` handler. Inside a list or query row, `item` is the row. */
    interface ActionDetails<T = any> {
        item: T;
        index: number;
        list: T[] | null;
        length?: number;
        first?: boolean;
        last?: boolean;
        context?: any;
    }

    type ActionHandler<T = any> = (event: Event, element: HTMLElement, details: ActionDetails<T>) => any;

    /** `data-pool-action` handlers receive the entity first. */
    type PoolActionHandler<T = any> = (item: T, event: Event) => any;

    // ── this.$el ─────────────────────────────────────────────────────────

    /** jQuery-like wrapper scoped to the component element. Events are removed on destroy. */
    interface DollarEl {
        /** First matched element, or null. Typed as HTMLElement, which is what
         *  callers hand to third-party libraries and read layout from. */
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
        /** Sets innerHTML and scans the result for components. */
        html(value: string): DollarEl;
        /** Sets the value and dispatches `input`, so `data-model` sees it. */
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

    // ── Props, watch, rules ──────────────────────────────────────────────

    type PropType =
        | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'function' | 'any'
        | StringConstructor | NumberConstructor | BooleanConstructor
        | ArrayConstructor | ObjectConstructor | FunctionConstructor;

    interface PropConfig {
        type?: PropType;
        required?: boolean;
        default?: any;
        validator?(value: any): boolean;
    }

    /** Keys are state paths; append `:immediate` to run once on init. Never watch a numeric list index. */
    interface WatchHandlers {
        [pathWithModifier: string]: (newValue: any, oldValue: any) => void;
    }

    /** Cross-field form rule. The key is the user-facing message. */
    interface RuleConfig {
        check: string | (() => boolean);
        when?: string;
        message?: string;
        fields?: string[];
    }

    // ── Pools ────────────────────────────────────────────────────────────

    /** Shared shape for every entity in a pool: state defaults, per-entity computeds, and methods. */
    interface EntityShape<T = any> {
        state?: Partial<T>;
        computed?: Record<string, (this: T & Record<string, any>) => any>;
        [method: string]: any;
    }

    interface PoolConfig<T = any> {
        /** Method name on the component, or a function. */
        onAdd?: string | ((item: T) => void);
        /** Fires before each removal. */
        onRemove?: string | ((item: T) => void);
        /** Fires once on clear(), skipping onRemove. */
        onClear?: string | (() => void);
        /** Shared object read in templates as `props.x`. */
        props?: Record<string, any>;
        entity?: EntityShape<T>;
    }

    /** Runtime pool. Entities are plain objects; mutate them and let the frame loop flush, or call markDirty(). */
    interface PoolHandle<T = any> {
        push(item: T | T[]): T | T[];
        /** Alias of push(). */
        add(item: T | T[]): T | T[];
        remove(key: string | number): void;
        get(key: string | number): T | undefined;
        /** Entity by DOM position. Pools use swap-with-last removal, so positions are not stable. */
        at(index: number): T | undefined;
        update(key: string | number, patch: Partial<T>): void;
        /** Re-render one entity. The first call switches the pool to targeted mode for good. */
        markDirty(key: string | number): void;
        swap(key1: string | number, key2: string | number): boolean;
        clear(): void;
        getElement(key: string | number): HTMLElement | undefined;
        /** Raw backing array. Order changes on remove. */
        readonly items: T[];
        /** Reactive in computeds. `items.length` is not. */
        readonly length: number;
        /** Alias of length. */
        readonly size: number;
        props: Record<string, any>;
        onChange: ((pool: PoolHandle<T>) => void) | null;
        [Symbol.iterator](): Iterator<T>;
        filter(fn: (item: T) => boolean): T[];
        map<R>(fn: (item: T) => R): R[];
        find(fn: (item: T) => boolean): T | undefined;
        forEach(fn: (item: T) => void): void;
        some(fn: (item: T) => boolean): boolean;
        every(fn: (item: T) => boolean): boolean;
        reduce<R>(fn: (acc: R, item: T) => R, initial: R): R;
    }

    type PoolHandles<P> = P extends string[]
        ? Record<string, PoolHandle>
        : { [K in keyof P]: PoolHandle<any> };

    // ── Stores ───────────────────────────────────────────────────────────

    interface StoreBase<S = any> {
        state: S;
        isReady(): boolean;
        waitForReady(): Promise<void>;
        subscribe(path: string, callback: (newValue: any, oldValue: any, path: string) => void): () => void;
    }

    /** A store as returned by getStore(): state fields, computeds, and methods sit directly on it. */
    type StoreHandle<S = any> = StoreBase<S> & S & Record<string, any>;

    type StoreHandles<Sub> = Sub extends string[]
        ? Record<string, StoreHandle>
        : { [K in keyof Sub]: StoreHandle };

    type StoreThis<S, C, M> = StoreBase<S> & S & Getters<C> & M;

    interface StoreDefinition<S, C> {
        state?: S;
        computed?: C;
        watch?: WatchHandlers;
        /** Other stores this store reads through `this.stores`. */
        subscribe?: Record<string, string[] | boolean> | string[];
        /** localStorage key. With autoSave, state is written on every change and restored on load. */
        storageKey?: string;
        autoSave?: boolean;
        init?(): void | Promise<void>;
        destroy?(): void;
        beforeDestroy?(): void;
        /** Runs every animation frame. dt in ms (clamped to 250), now from performance.now(). */
        tick?(dt: number, now: number): void;
    }

    // ── Components ───────────────────────────────────────────────────────

    interface ComponentBase<S, P, Sub> {
        readonly id: string;
        readonly name: string;
        readonly element: HTMLElement;
        state: S;
        /** Read-only props from data-prop-* / data-props. */
        readonly props: Record<string, any>;
        pools: PoolHandles<P>;
        /** Present when the definition has a `subscribe` block. */
        stores: StoreHandles<Sub>;
        getStore<T = any>(name?: string): StoreHandle<T>;
        /** Any pool by name, including markup-only pools. */
        getPool<T = any>(name: string): PoolHandle<T> | undefined;
        $el(selector?: string | Element): DollarEl;
        /** Child-to-parent event. The parent handles it as onEventName(detail). */
        emit(eventName: string, detail?: any): boolean;
        external(entityNameOrId: string, path: string, value?: any): any;
        /** The list row this component was rendered inside, if any. */
        readonly listItem: any;
        /** Set by data-validate-on forms. */
        formValid: boolean;
        validationErrors: Record<string, string>;
    }

    type ComponentThis<S, C, P, Sub, M> = ComponentBase<S, P, Sub> & S & Getters<C> & M;

    // ── Deriving `this` from the definition ──────────────────────────────
    //
    // One type parameter instead of five. The editor prints a signature by
    // expanding every type argument, so five of them produced a 300-character
    // popup on every keystroke inside a definition. Pulling the parts out of
    // the definition with conditional types keeps the same inference and
    // leaves one thing to print.

    /** Keys the framework owns, so whatever is left is the author's methods. */
    type ReservedKey =
        | 'state' | 'computed' | 'props' | 'pools' | 'subscribe' | 'watch' | 'rules'
        | 'types' | 'subscribeTimeout' | 'uses' | 'storageKey' | 'autoSave'
        | 'init' | 'beforeInit' | 'destroy' | 'beforeDestroy' | 'onUpdate' | 'beforeUpdate'
        | 'onError' | 'tick' | 'onStoreUpdate' | 'onPropsChange' | 'onRouteChange';

    type StateOf<D> = D extends { state: infer S } ? S : {};
    type ComputedOf<D> = D extends { computed: infer C } ? C : {};
    type PoolsOf<D> = D extends { pools: infer P } ? P : {};
    type SubscribeOf<D> = D extends { subscribe: infer S } ? S : {};
    type MethodsOf<D> = Omit<D, ReservedKey>;

    /** What `this` is inside a component method, derived from the literal. */
    type ComponentSelf<D> =
        ComponentBase<StateOf<D>, PoolsOf<D>, SubscribeOf<D>>
        & StateOf<D>
        & Getters<ComputedOf<D>>
        & MethodsOf<D>;

    /** What `this` is inside a store method. */
    type StoreSelf<D> = StoreBase<StateOf<D>> & StateOf<D> & Getters<ComputedOf<D>> & MethodsOf<D>;

    /** The definition as the call takes it: the literal, bound to its own `this`. */
    type ComponentArg<D> = D & ThisType<ComponentSelf<D>>;
    type StoreArg<D> = D & ThisType<StoreSelf<D>>;

    /** What `store()` hands back: state, computed values, and methods on one object. */
    type StoreOf<D> = StoreHandle<StateOf<D>> & Getters<ComputedOf<D>> & MethodsOf<D>;

    interface PropsChangeInfo {
        changed: string[];
        props: Record<string, any>;
        previous: Record<string, any>;
    }

    interface ComponentDefinition<S, C, P, Sub> {
        state?: S;
        computed?: C;
        /** Object form only. */
        props?: Record<string, PropConfig>;
        /** Dev-build runtime type checks for state fields. */
        types?: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object' | 'function' | 'any'>;
        watch?: WatchHandlers;
        /** Stores to inject on `this.stores`. init() waits for them. */
        subscribe?: Sub;
        subscribeTimeout?: number;
        /** Pools rendered by data-pool elements inside this component. Array shorthand declares names only. */
        pools?: P;
        /** Cross-field form rules; the key is the message. */
        rules?: Record<string, string | RuleConfig>;
        uses?: string[];
        beforeInit?(): void | Promise<void>;
        init?(): void | Promise<void>;
        beforeUpdate?(): void;
        /** After any state change. Use watch for a specific path. */
        onUpdate?(): void;
        beforeDestroy?(): void;
        destroy?(): void;
        onError?(error: Error, info?: any): void;
        /** Runs every animation frame, before pool flush. dt in ms (clamped to 250), now from performance.now(). */
        tick?(dt: number, now: number): void;
        onStoreUpdate?(storeName: string, path: string, newValue: any, oldValue: any): void;
        onPropsChange?(info: PropsChangeInfo): void;
        onRouteChange?(route: any): void;
    }

    interface ComponentInstance {
        readonly id: string;
        readonly name: string;
        readonly element: HTMLElement;
        readonly context: any;
        readonly state: any;
        readonly definition: any;
    }

    // ── Plugins ──────────────────────────────────────────────────────────

    type PluginInstallFn = (framework: Api, options?: any) => void;

    interface PluginDefinition {
        name?: string;
        version?: string;
        /** Services from other plugins, injected on `this` inside install(). */
        uses?: string[];
        /** Optional since 1.5.1: a plugin that is only state, computed, and methods needs none. */
        install?(this: PluginDefinition & Record<string, any>, framework: Api, options?: any): void;
        /** With a name, state and computeds are reactive and readable as `$name.path` in bindings. */
        state?: Record<string, any>;
        computed?: Record<string, AnyFn>;
        methods?: Record<string, AnyFn>;
        [key: string]: any;
    }

    // ── Queries ──────────────────────────────────────────────────────────

    /**
     * A number polls every N seconds. 'etag:N' re-checks conditionally at most
     * every N seconds. 'fresh:N' skips event-driven refetches while the last
     * sync is younger than N seconds.
     */
    type RefreshRung =
        | number | 'focus' | 'reconnect' | 'sse' | 'once'
        | `etag:${number}` | `fresh:${number}`;

    /** One entry in `to`, or the `create` entry. */
    interface WriteOperation<T = any> {
        /** `:token` placeholders are filled from the item and from params. */
        url: string;
        /** Defaults: PATCH for update, DELETE for delete, POST for create and any named operation. */
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | (string & {});
        /** Builds the request body from the item. Nothing is sent without it. */
        body?: (item: Partial<T> & Record<string, any>) => any;
        /**
         * Decides what the ok response meant. Receives the parsed body and the
         * item that was written. Return a record to reconcile it, return `item`
         * to keep what was written with no refetch, throw to reject and roll
         * back. Absent, the query refetches instead.
         */
        confirmation?: (responseBody: any, item: Partial<T> & Record<string, any>) => Partial<T> | null | undefined | void;
    }

    interface QueryConfig<T = any> {
        /** Read source: a URL with `:token` placeholders, or a function returning the data. */
        from: string | ((params: Record<string, any>) => any);
        /** Row identity field. Default 'id'. */
        key?: string;
        /** Fills URL tokens and the read query string. */
        params?: Record<string, any> | (() => Record<string, any>);
        headers?: Record<string, string> | (() => Record<string, string>);
        /** Shapes the response, e.g. unwraps an envelope. */
        select?: (data: any) => any;
        /** Rows held before the first fetch. */
        initial?: T[];
        refresh?: RefreshRung | RefreshRung[];
        /** Event-stream URL for the 'sse' rung. Defaults to `from`. */
        stream?: string;
        /** Retries after a failed sync. Default 0. */
        retry?: number;
        /** true, or a storage key. Last confirmed rows survive a reload. */
        persist?: boolean | string;
        /** Tombstone field. A truthy value on a written item removes the row and sends the delete. */
        deleted?: string;
        /** Write destination: a URL string, a map of named operations, or a function doing the request. */
        to?: string
            | Record<string, string | WriteOperation<T>>
            | ((item: Partial<T> & Record<string, any>) => any);
        /** Query-level body builder for update and create. */
        body?: (item: Partial<T> & Record<string, any>) => any;
        /** Query-level record extractor, for update and create only (WF-940 names an operation that dropped it). Receives `(body, item)`. */
        confirmation?: (responseBody: any, item: Partial<T> & Record<string, any>) => Partial<T> | null | undefined | void;
        /** New rows. The URL is the collection; a rejection removes the row. */
        create?: string | WriteOperation<T>;
    }

    interface RefreshOptions {
        params?: Record<string, any>;
        /** Add a page instead of replacing. */
        append?: boolean;
        /** Drop current rows before the request. */
        clear?: boolean;
    }

    /** A query as returned by getQuery() or bound as `$name` in markup. */
    interface QueryHandle<T = any> {
        readonly rows: T[];
        readonly count: number;
        /** A fetch is in flight with no usable data yet. */
        readonly isLoading: boolean;
        /** Data on screen the server has not yet confirmed. */
        readonly isStale: boolean;
        /** The initial load failed. */
        readonly error: any;
        /** A later refresh failed; existing rows were kept. */
        readonly syncError: any;
        readonly lastSync: number | Date | null;
        /** Writes not yet settled. */
        readonly pendingWrites: number;
        refresh(options?: RefreshOptions): Promise<void>;
        /** Conditional refetch. */
        invalidate(): Promise<void>;
        /** Apply local data optimistically with no transport. */
        patch(data: Partial<T> | Partial<T>[]): void;
        /** Save the key plus the changed fields. Delete when the `deleted` field is truthy, update otherwise. */
        write(item: Partial<T> & Record<string, any>): Promise<T | void>;
        /** Run a named operation from the `to` map. */
        write(operation: string, item: Partial<T> & Record<string, any>): Promise<T | void>;
        /** Add a row through the `create` entry. The temporary key is minted for you. */
        create(item: Partial<T> & Record<string, any>): Promise<T | void>;
    }

    // ── Framework configuration ──────────────────────────────────────────

    interface ConfigOptions {
        debug: boolean;
        autoInit: boolean;
        errorHandling: 'log' | 'throw' | 'silent';
        /** Process only data-wf-* attributes. */
        useWfPrefixOnly: boolean;
        strictProps: boolean;
        /** ms to wait for subscribed stores before init(). Default 5000. */
        subscribeTimeout: number;
        forceCSPMode: boolean;
        htmlSanitizer: ((html: string) => string) | null;
    }

    // Declared here rather than imported from the package typings, so this
    // file is self-contained: it can be copied anywhere, or referenced from a
    // jsconfig, without a second file having to sit next to it.

    interface RouteManagerOptions {
        mode?: 'hash' | 'history';
        base?: string;
        scrollBehavior?: 'top' | 'preserve' | ((to: any, from: any) => any);
        [key: string]: any;
    }

    interface RouteManager {
        loadRoutes(routes: any[]): RouteManager;
        onRoute(pattern: string, handlerOrConfig: any): RouteManager;
        beforeEach(guard: (ctx: any) => any): RouteManager;
        afterEach(hook: (to: any, from: any) => void): RouteManager;
        alias(aliasPath: string, targetPath: string): RouteManager;
        init(): RouteManager;
        navigate(url: string, options?: { replace?: boolean }): Promise<void>;
        getRouteUrl(name: string, params?: Record<string, string>, query?: Record<string, string>): string;
        isActive(pattern: string, options?: { exact?: boolean }): boolean;
        getCurrentRoute(): any;
        back(): void;
        forward(): void;
        destroy(): void;
        [key: string]: any;
    }

    /** Handlers for a custom `data-*` directive. */
    interface DirectiveHandlers {
        bind?(el: HTMLElement, value: any, context: any): void;
        update?(el: HTMLElement, value: any, context: any): void;
        unbind?(el: HTMLElement, context: any): void;
    }

    type HookName =
        | 'beforeInit' | 'afterInit'
        | 'component:beforeCreate' | 'component:created' | 'component:beforeDestroy' | 'component:destroyed'
        | 'component:onPropsChange'
        | 'beforeRender' | 'afterRender'
        | 'beforeScan' | 'afterScan';

    // ── The global ───────────────────────────────────────────────────────

    interface Api {
        /**
         * Register a component. `this` inside every method is the component:
         * state fields, computed values, methods, `pools`, `stores`, `$el`.
         */
        component<D extends ComponentDefinition<any, any, any, any>>(
            name: string,
            definition: ComponentArg<D>
        ): void;

        /** Register a store. Methods go at the top level, and `this` is the store. */
        store<D extends StoreDefinition<any, any>>(
            name: string,
            definition: StoreArg<D>
        ): StoreOf<D>;

        /** Declare a query: where rows come from, when they refresh, and where changes go. */
        query<T = any>(name: string, config: QueryConfig<T>): QueryHandle<T>;

        plugin(plugin: PluginDefinition | PluginInstallFn, options?: any): Api;

        directive(name: string, handlers: DirectiveHandlers): Api;
        hook(hookName: HookName | (string & {}), handler: (...args: any[]) => void): Api;

        getStore<T = any>(name?: string): StoreHandle<T>;
        getQuery<T = any>(name: string): QueryHandle<T>;
        /** First live instance of a named component. Reactive inside a computed. */
        getComponent(name: string): ComponentInstance | undefined;
        getComponents(name: string): ComponentInstance[];
        getComponentsByType(name: string): ComponentInstance[];
        getComponentInstance(componentId: string): ComponentInstance | undefined;
        /** Remove the element from the DOM as well, or the next scan re-creates the component. */
        destroyComponent(componentId: string): void;
        /** Free a component or store name so it can be registered again. */
        unregister(name: string): void;
        /** Initialize components under `scope`. Rarely needed; the mutation observer does this. */
        scan(scope?: Element | Document): void;
        config(options: Partial<ConfigOptions>): Api;
        /** Deep plain-object snapshot of reactive state, for structured clone (IndexedDB, postMessage). */
        toRaw<T>(value: T): T;
        /** Clear persisted query caches. No names clears every query's. */
        clearPersisted(...names: string[]): void;
        /** Conditional refetch on several queries at once. */
        invalidateQueries(...names: string[]): Promise<void>;
        createRouter(options?: RouteManagerOptions): RouteManager;
        RouteManager: new (options?: RouteManagerOptions) => RouteManager;
        registerAdapter(tagName: string, config: Record<string, any>): Api;
        getAdapter(tagName: string, element?: Element): any;
        setHtmlSanitizer(fn: ((html: string) => string) | null): Api;
        setWfPrefixMode(exclusive: boolean): Api;
        /** Resolves after pending scans, effects, and queued actions settle. */
        whenSettled(): Promise<void>;
        inspect(componentName: string): any;
        /** Reactive plugin accessors: `wildflower.$auth`. */
        [pluginAccessor: `$${string}`]: any;
    }
}

/** The framework, as loaded by the script tag. */
declare const wildflower: WF.Api;
