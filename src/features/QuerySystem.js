/**
 * QuerySystem: the data-query primitive ("SSR for post-load").
 *
 * A query is a named declaration binding markup to an external data source,
 * kept current per a declared freshness policy. Design + decisions:
 * docs/future/data-query/DESIGN.md. Ships only in tiers with SSR
 * (__FEATURE_QUERY__), constant-folded out elsewhere.
 *
 * Architecture (deliberate delegation, the probe thesis):
 * - Every query is backed by an INTERNAL STORE named after it. That single
 *   choice provides: `$name.*` bindings (entity accessor), getStore-grade
 *   auto-tracking of `getQuery(name).rows` inside computeds, single-flush
 *   application of result writes (store batching), and DevTools visibility.
 * - List delivery is a markup transform: a [data-query] element with a
 *   <template> child becomes data-list="$name.rows" before list discovery,
 *   so the keyed reconciler and every list fast path apply unchanged.
 * - `from` is a URL or a function; there are NO source types or adapters.
 *   The controller here owns only: the freshness ladder, the fetch race
 *   discipline (last-call-wins + abort + keep-previous-rows), and the
 *   hard/transient error split.
 */

import { QUERY_ENGINE_WRITE, WF_ERRORS, wfError } from '../core/wfUtils.js';

const QUERY_STATE = () => ({
    rows: [],
    isLoading: false,
    error: null,      // HARD: no usable data (initial load failed)
    syncError: null,  // TRANSIENT: refresh failed, existing rows preserved
    isStale: false,
    lastSync: null,
});

// Wrap a synchronous block of engine writes to a query store. The
// ContextProxy set trap reads the shared depth cell: depth 0 means an
// application write and draws the WF-950 dev diagnostic.
function engineWrite(fn) {
    QUERY_ENGINE_WRITE.depth++;
    try { fn(); } finally { QUERY_ENGINE_WRITE.depth--; }
}

// rung parse: refresh config -> normalized {once, pollSecs, etagSecs, focus, reconnect, sse}
function parseRungs(refresh) {
    const rungs = { pollSecs: 0, etagSecs: 0, focus: false, reconnect: false, sse: false };
    const list = refresh == null ? ['once'] : (Array.isArray(refresh) ? refresh : [refresh]);
    for (const r of list) {
        if (typeof r === 'number' && r > 0) rungs.pollSecs = r;
        else if (r === 'focus') rungs.focus = true;
        else if (r === 'reconnect') rungs.reconnect = true;
        else if (r === 'sse') rungs.sse = true;
        else if (typeof r === 'string' && r.startsWith('etag:')) rungs.etagSecs = parseInt(r.slice(5), 10) || 0;
        // 'once' adds nothing beyond the activation fetch every query gets.
    }
    return rungs;
}

// Prune-then-add: controller.elements holds strong references; sweeping
// disconnected nodes at each new observation keeps the set bounded even for
// rungless queries whose lifecycle check never fires.
function observeElement(controller, el) {
    for (const e of controller.elements) {
        if (!e.isConnected) controller.elements.delete(e);
    }
    controller.elements.add(el);
}

export const QuerySystemMethods = {

    /**
     * Register a named query. Global, like stores. See DESIGN.md for the
     * frozen surface: { from: url|fn, key, refresh, params, initial,
     * stream }. `stream` is the optional explicit SSE endpoint for the
     * 'sse' rung (defaults to a string `from`).
     */
    query(name, config = {}) {
        if (!this._queryControllers) this._queryControllers = new Map();
        if (this._queryControllers.has(name)) {
            if (__DEV__) wfError(WF_ERRORS.QUERY_DUPLICATE, {
                warn: true,
                context: `Query "${name}" is already registered; the second registration is ignored`
            });
            return this.getQuery(name);
        }
        if (this.getStoreComponentByName && this.getStoreComponentByName(name)) {
            if (__DEV__) wfError(WF_ERRORS.QUERY_NAME_COLLISION, {
                warn: true,
                context: `Query "${name}" collides with an existing store of the same name; registration ignored`,
                suggestion: 'Queries and stores share the entity namespace; pick a name no store uses'
            });
            return null;
        }
        if (typeof config.from !== 'string' && typeof config.from !== 'function') {
            if (__DEV__) wfError(WF_ERRORS.QUERY_FROM_INVALID, {
                warn: true,
                context: `Query "${name}": \`from\` must be a URL string or a function`
            });
            return null;
        }

        const rungs = parseRungs(config.refresh);
        if (__DEV__ && rungs.pollSecs > 0 && rungs.pollSecs < 1) {
            wfError(WF_ERRORS.QUERY_POLL_SUBSECOND, {
                warn: true,
                context: `Query "${name}": poll rung of ${rungs.pollSecs}s is sub-second, which is ${Math.round(1000 / (rungs.pollSecs * 1000) * 1000)} requests/minute against the source`,
                suggestion: 'Poll values are SECONDS; a typo like 0.5 for "every 30s" is the common cause'
            });
        }
        const controller = {
            name,
            config,
            key: config.key || 'id',
            deletedField: typeof config.deleted === 'string' ? config.deleted : null,
            rungs,
            active: false,
            accumulated: false,       // two-state apply model: plain until the first append
            runId: 0,
            abort: null,
            etag: null,
            timerId: null,
            lifecycleTimerId: null,   // SSE-only: low-frequency observer check
            es: null,                 // EventSource when the sse rung is active
            _listeners: [],
            elements: new Set(),      // bound [data-query] elements (observers)
            unobservedSince: null,    // timestamp when observers last hit zero
            lastRead: null,           // last getQuery() read (also an observer edge)
            _activationQueued: false,
        };
        this._queryControllers.set(name, controller);

        const wf = this;
        const initial = QUERY_STATE();
        if (Array.isArray(config.initial)) initial.rows = config.initial;
        this.store(name, {
            state: initial,
            computed: {
                count() { return this.rows ? this.rows.length : 0; }
            },
            // refresh() takes an OPTIONS object: { params, append }. Request
            // parameters always live inside `params`, so no request parameter
            // name can ever collide with an option name. Passing parameters
            // directly is not supported; dev builds catch it (WF-961) because
            // the fetch would otherwise silently run without them.
            refresh(options) {
                if (__DEV__ && options && typeof options === 'object') {
                    const stray = Object.keys(options).filter((k) => k !== 'params' && k !== 'append');
                    if (stray.length > 0) {
                        wfError(WF_ERRORS.QUERY_REFRESH_SHAPE, {
                            warn: true,
                            context: `Query "${name}": refresh() received unexpected option(s): ${stray.join(', ')}`,
                            suggestion: 'refresh() takes an options object; request parameters belong inside params: refresh({ params: { page: 2 } })'
                        });
                    }
                }
                return wf._queryFetch(controller, {
                    params: options && options.params,
                    append: !!(options && options.append),
                    conditional: false
                });
            },
            invalidate() { return wf._queryFetch(controller, { conditional: true }); },
        });

        // Return the handle WITHOUT getQuery's observer side effects:
        // registration is a declaration, not an observation. Activation
        // waits for a real observer edge (a bound element, a subscribe:
        // declaration, or a getQuery read).
        const handle = this.getStore(name);
        // Stamp for the WF-950 external-write diagnostic. Underscore
        // prefix routes the write past state onto the raw context, where
        // the ContextProxy set trap can read it cheaply.
        if (handle) handle._wfQueryOwned = name;
        return handle;
    },

    /**
     * Query handle = the backing store's context (rows/isLoading/error/
     * syncError/isStale/lastSync/count + refresh()/invalidate()). Reads
     * auto-track inside computeds exactly like getStore().
     *
     * A read is also an observer edge (design ruling: markup bindings and
     * tracked JS reads alike signal lifecycle interest). The first read
     * activates the query (deferred to a microtask so activation's store
     * writes never land inside a computed evaluation that is reading it),
     * and every read stamps lastRead, which the lifecycle check counts as
     * observation alongside bound elements.
     */
    getQuery(name) {
        if (!this._queryControllers || !this._queryControllers.has(name)) {
            if (__DEV__) wfError(WF_ERRORS.QUERY_UNKNOWN, {
                warn: true,
                context: `getQuery("${name}"): no such query is registered`
            });
            return undefined;
        }
        const controller = this._queryControllers.get(name);
        controller.lastRead = Date.now();
        if (!controller.active && !controller._activationQueued) {
            controller._activationQueued = true;
            Promise.resolve().then(() => {
                controller._activationQueued = false;
                this._queryActivate(controller);
            });
        }
        return this.getStore(name);
    },

    /**
     * Markup transform, run per component instance BEFORE binding
     * compilation (hooked from RenderingCore._processComponentBindings,
     * the one site every init path funnels through, so the compiled
     * binding snapshot that feeds list mounting always sees the rewritten
     * attributes; ListRenderer._setupListContexts keeps an idempotent
     * backstop). Shape inference: a <template> child turns the element
     * into data-list="$name.rows" (list); no template = record, where bare
     * data-bind paths in the subtree rewrite to $name.rows.0.<path>.
     */
    _transformQueryElements(rootEl) {
        if (!rootEl || !rootEl.querySelectorAll) return;
        // Perf guard: apps with no registered queries skip the subtree scan
        // entirely in production. Dev keeps scanning so the unknown-name
        // diagnostic still fires for data-query markup without declarations.
        if (!__DEV__ && (!this._queryControllers || this._queryControllers.size === 0)) return;
        const els = [];
        if (rootEl.matches && rootEl.matches('[data-query],[data-wf-query]')) els.push(rootEl);
        rootEl.querySelectorAll('[data-query],[data-wf-query]').forEach((el) => els.push(el));
        for (const el of els) {
            const name = el.getAttribute('data-query') || el.getAttribute('data-wf-query');
            if (!name) continue;
            if (el._wfQueryBound) {
                // Already transformed. If its query was lifecycle-torn-down
                // and this element is back in a scan (re-observation, e.g.
                // list churn re-attaching the same node), resume the rungs.
                const bound = this._queryControllers && this._queryControllers.get(name);
                if (bound && !bound.active) {
                    observeElement(bound, el);
                    this._queryActivate(bound);
                }
                continue;
            }
            const controller = this._queryControllers && this._queryControllers.get(name);
            if (!controller) {
                if (__DEV__) wfError(WF_ERRORS.QUERY_UNKNOWN, {
                    warn: true,
                    context: `data-query="${name}": no such query is registered`,
                    suggestion: `Register it with wildflower.query('${name}', { from: ... })`
                });
                continue;
            }
            const hasTemplate = !!el.querySelector(':scope > template');
            // SSR adoption: inside data-ssr="true", the server-rendered DOM
            // IS the seed; parse it back into the store before anything
            // renders. An explicit initial: wins over the parse.
            if (el.closest('[data-ssr="true"]')) {
                this._queryAdoptSSRContent(controller, el, hasTemplate);
            }
            if (!hasTemplate) {
                // RECORD shape: the subtree binds to the single result record
                // ("a row without a list"). Delegation again: bare-path
                // data-bind attributes are rewritten to $name.rows.0.<path>,
                // so the existing binding engine owns resolution, tracking,
                // and flush. A null/empty record resolves to undefined →
                // bindings render empty, never throw (design ruling); rows
                // are never wiped by a transient error, so last-good values
                // persist through background failures. Seed values come from
                // `initial:`. Only simple dotted paths are rewritten;
                // expressions and $-prefixed paths pass through untouched.
                el._wfQueryBound = true;
                controller.hasRecord = true;
                observeElement(controller, el);
                const prefix = '$' + name + '.rows.0.';
                const BARE_PATH = /^[a-zA-Z_][\w.]*$/;
                const rewrite = (node) => {
                    for (const attr of ['data-bind', 'data-wf-bind']) {
                        const v = node.getAttribute(attr);
                        if (v && BARE_PATH.test(v) && !v.startsWith('computed:')) {
                            node.setAttribute(attr, prefix + v);
                        }
                    }
                };
                rewrite(el);
                el.querySelectorAll('[data-bind],[data-wf-bind]').forEach(rewrite);
                this._queryActivate(controller);
                continue;
            }
            el._wfQueryBound = true;
            observeElement(controller, el);
            // Prefix parity: a data-wf-query element gets data-wf-* transform
            // attributes, so wf-prefixed markup stays uniformly prefixed.
            const wfPrefixed = !el.getAttribute('data-query') && !!el.getAttribute('data-wf-query');
            const listAttr = wfPrefixed ? 'data-wf-list' : 'data-list';
            const keyAttr = wfPrefixed ? 'data-wf-key' : 'data-key';
            if (!el.hasAttribute('data-list') && !el.hasAttribute('data-wf-list')) {
                el.setAttribute(listAttr, '$' + name + '.rows');
            }
            if (!el.hasAttribute('data-key') && !el.hasAttribute('data-wf-key')) {
                el.setAttribute(keyAttr, controller.key);
            }
            this._queryActivate(controller);
        }
    },

    /**
     * Parse server-rendered content back into the query store (SSR
     * adoption, mirroring the DOM-as-seed convention data-list SSR uses).
     * List shape: each non-template child row contributes an object built
     * from its bare-path data-bind fields; record shape: the subtree's
     * bare-path fields become rows[0]. data-type="number"/"boolean" coerce.
     * Fields not rendered in the DOM (often the row key) ride a data-seed
     * attribute, a JSON object on the row root (list) or the query
     * element (record) that merges into the parsed row, winning overlaps
     * (the machine truth beats the display text). Without a rendered or
     * seeded key, the first CHANGED result rebuilds the list once instead
     * of patching. An explicit initial: always wins over the whole parse.
     */
    _queryAdoptSSRContent(controller, el, isList) {
        const store = this.getStore(controller.name);
        if (!store) return;
        if (store.lastSync !== null || (store.rows && store.rows.length > 0)) return;

        const SIMPLE = /^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/;
        const CONTAINERS = '[data-list],[data-wf-list],[data-query],[data-wf-query]';
        const setPath = (obj, path, value) => {
            const parts = path.split('.');
            let cur = obj;
            for (let i = 0; i < parts.length - 1; i++) {
                if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
                cur = cur[parts[i]];
            }
            cur[parts[parts.length - 1]] = value;
        };
        const readSeed = (node) => {
            const raw = node.getAttribute('data-seed') || node.getAttribute('data-wf-seed');
            if (!raw) return null;
            try {
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
            } catch (e) {
                if (__DEV__) wfError(WF_ERRORS.QUERY_SEED_INVALID, {
                    warn: true,
                    context: `data-query="${controller.name}": data-seed is not valid JSON; ignored. Value: ${raw}`
                });
                return null;
            }
        };
        const readFields = (root, into) => {
            const nodes = [];
            if (root.hasAttribute && (root.hasAttribute('data-bind') || root.hasAttribute('data-wf-bind'))) nodes.push(root);
            root.querySelectorAll('[data-bind],[data-wf-bind]').forEach((n) => nodes.push(n));
            for (const n of nodes) {
                // Boundary guard (mirrors SSRManager's list-parse discipline):
                // a binding whose nearest list/query container is NOT this
                // query element belongs to a nested container, not to this
                // row/record.
                if (n !== root) {
                    const container = n.closest(CONTAINERS);
                    if (container !== el && container !== root) continue;
                }
                const field = n.getAttribute('data-bind') || n.getAttribute('data-wf-bind');
                if (!field || !SIMPLE.test(field)) continue;
                const type = n.getAttribute('data-type');
                const text = n.textContent.trim();
                setPath(into, field, type === 'number' ? Number(text)
                    : type === 'boolean' ? text === 'true'
                    : text);
            }
            const seed = readSeed(root);
            if (seed) Object.assign(into, seed);
            return into;
        };

        if (isList) {
            const rows = [];
            for (const child of el.children) {
                if (child.tagName === 'TEMPLATE') continue;
                const row = readFields(child, {});
                if (Object.keys(row).length > 0) rows.push(row);
            }
            if (rows.length > 0) this._queryIngest(controller, rows, { seed: true });
        } else {
            const record = readFields(el, {});
            if (Object.keys(record).length > 0) this._queryIngest(controller, [record], { seed: true });
        }
    },

    /**
     * THE ingestion choke point (PAGINATION_DESIGN.md ruling: one function
     * owns tombstone filtering and merge/replace dispatch; a future
     * patch() plugs in here). Every path that puts rows into a query
     * store routes through it: fetch results, appended pages, SSE data
     * messages, and SSR adoption.
     *
     * Modes (two-state apply model): 'replace' until the first append;
     * after it, GENTLE arrivals (conditional fetches: invalidate, rungs,
     * SSE) MERGE — fresh window in its own order, then accumulated rows
     * absent from it, in theirs — while an explicit refresh() replaces
     * and resets to plain. Merge never sorts; it splices sequences.
     *
     * Tombstones: a row whose declared `deleted` field is truthy is a
     * removal instruction, honored in every mode. seed (SSR adoption)
     * writes rows only, leaving flags untouched so seeded rows keep
     * their stale-refresh semantics.
     */
    _queryIngest(controller, data, { append = false, gentle = false, seed = false } = {}) {
        const store = this.getStore(controller.name);
        if (!store) return;
        const incoming = Array.isArray(data) ? data : (data == null ? [] : [data]);
        const key = controller.key;
        const df = controller.deletedField;
        const keyOf = (r) => (r == null ? undefined : r[key]);

        const dead = new Set();
        const live = [];
        for (const r of incoming) {
            if (df && r && r[df]) {
                const k = keyOf(r);
                if (k !== undefined) dead.add(k);
            } else {
                live.push(r);
            }
        }

        let mode = append ? 'append' : (controller.accumulated && gentle ? 'merge' : 'replace');
        if (append && live.length > 0 && keyOf(live[0]) === undefined) {
            if (__DEV__) wfError(WF_ERRORS.QUERY_APPEND_UNKEYED, {
                warn: true,
                context: `Query "${controller.name}": append received rows without the declared key field ("${key}"), so accumulation would duplicate; applied as a replace instead`,
                suggestion: 'Give appended rows the declared key, or declare the right key: on the query'
            });
            mode = 'replace';
        }

        const current = store.rows || [];
        let nextRows;
        if (mode === 'append') {
            const fresh = new Map();
            for (const r of live) fresh.set(keyOf(r), r);
            nextRows = [];
            for (const r of current) {
                const k = keyOf(r);
                if (dead.has(k)) continue;
                nextRows.push(fresh.has(k) ? fresh.get(k) : r); // keyed dedup: update in place
            }
            const seen = new Set(nextRows.map(keyOf));
            for (const r of live) {
                if (!seen.has(keyOf(r))) nextRows.push(r);
            }
            controller.accumulated = true;
        } else if (mode === 'merge') {
            const freshKeys = new Set(live.map(keyOf));
            const tail = [];
            for (const r of current) {
                const k = keyOf(r);
                if (!freshKeys.has(k) && !dead.has(k)) tail.push(r);
            }
            nextRows = live.concat(tail);
        } else {
            nextRows = live;
            if (!seed) controller.accumulated = false;
        }

        // Flags first, rows LAST (standing subscriber-ordering contract).
        engineWrite(() => {
            if (!seed) {
                store.isLoading = false;
                store.isStale = false;
                store.error = null;
                store.syncError = null;
                store.lastSync = Date.now();
            }
            store.rows = nextRows;
        });
    },

    /**
     * First observation activates the query: initial fetch + rung setup.
     * Re-activation after a lifecycle teardown resumes the rungs and issues
     * a conditional catch-up fetch (existing rows show instantly; the
     * network round-trip is a 304 when nothing changed).
     */
    _queryActivate(controller) {
        if (controller.active) return;
        const resumed = controller._wasActive === true;
        controller.active = true;
        controller.unobservedSince = null;
        controller._wasActive = true;
        this._queryFetch(controller, { conditional: resumed });
        const r = controller.rungs;
        const guarded = () => {
            if (this._queryLifecycleCheck(controller)) {
                this._queryFetch(controller, { conditional: true });
            }
        };
        if (r.focus) {
            window.addEventListener('focus', guarded);
            controller._listeners.push(['focus', guarded]);
        }
        if (r.reconnect) {
            window.addEventListener('online', guarded);
            controller._listeners.push(['online', guarded]);
        }
        const pollSecs = r.pollSecs || r.etagSecs;
        if (pollSecs > 0) {
            controller.timerId = setInterval(guarded, pollSecs * 1000);
        }
        if (r.sse) {
            this._queryOpenStream(controller);
            // A silent stream never fires the lazy lifecycle check, but it
            // holds a connection, exactly the resource the teardown grace
            // exists to release. Without a poll interval to piggyback on,
            // run a low-frequency observer check of our own.
            if (pollSecs <= 0) {
                controller.lifecycleTimerId = setInterval(
                    () => { this._queryLifecycleCheck(controller); },
                    this._queryTeardownGraceMs || 5000
                );
            }
        }
    },

    /**
     * The sse rung. Stream endpoint = config.stream, falling back to a
     * string `from` (the design ruling keeps the shorthand but allows an
     * explicit stream URL; same-URL overloading is fragile through real
     * proxies). Event contract: a message with a JSON body IS the new
     * payload and applies directly (server pushes results); an empty
     * message is an invalidation signal → conditional refetch. Stream
     * errors with data present are transient (syncError + isStale, rows
     * preserved; EventSource auto-reconnects); a reopen after error
     * clears them and catches up conditionally.
     */
    _queryOpenStream(controller) {
        const cfg = controller.config;
        const streamUrl = typeof cfg.stream === 'string'
            ? cfg.stream
            : (typeof cfg.from === 'string' ? cfg.from : null);
        if (!streamUrl) {
            if (__DEV__) wfError(WF_ERRORS.QUERY_SSE_NO_URL, {
                warn: true,
                context: `Query "${controller.name}": the 'sse' rung needs a stream URL; rung skipped`,
                suggestion: 'Add a `stream:` option when `from` is a function'
            });
            return;
        }
        if (typeof EventSource !== 'function') return;
        const es = new EventSource(streamUrl);
        controller.es = es;
        const store = () => this.getStore(controller.name);
        let hadError = false;
        es.onmessage = (ev) => {
            if (!this._queryLifecycleCheck(controller)) return;
            const body = ev && ev.data;
            if (body) {
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch (e) {
                    if (__DEV__) wfError(WF_ERRORS.QUERY_SSE_NON_JSON, {
                        warn: true,
                        context: `Query "${controller.name}": SSE message was not valid JSON; treating it as an invalidation signal`
                    });
                    this._queryFetch(controller, { conditional: true });
                    return;
                }
                // Stream data is the newest truth: supersede any in-flight
                // fetch, then apply through the store (single flush).
                controller.runId++;
                if (controller.abort) { controller.abort.abort(); controller.abort = null; }
                const s = store();
                if (!s) return;
                if (__DEV__ && controller.hasRecord && parsed == null) {
                    wfError(WF_ERRORS.QUERY_NULL_RECORD, {
                    warn: true,
                    context: `Query "${controller.name}": record query resolved null/undefined; bound fields will render empty (valid empty context)`
                });
                }
                // Stream data is a GENTLE arrival: through the choke point,
                // so it merges over an accumulated store (live feeds keep
                // the user's place) and honors tombstones. Same flags-first
                // rows-last ordering, owned by the choke point.
                this._queryIngest(controller, parsed, { gentle: true });
            } else {
                this._queryFetch(controller, { conditional: true });
            }
        };
        es.onerror = () => {
            hadError = true;
            const s = store();
            if (s && s.lastSync !== null) {
                engineWrite(() => {
                    s.syncError = 'stream interrupted';
                    s.isStale = true;
                });
            }
        };
        es.onopen = () => {
            if (!hadError) return; // initial open: activation fetch covers it
            hadError = false;
            const s = store();
            if (s) { engineWrite(() => { s.syncError = null; }); }
            this._queryFetch(controller, { conditional: true }); // catch up on missed events
        };
    },

    /**
     * Active-while-observed with a teardown grace (design ruling: fixed ~5s
     * default, no public knob). Observation = a bound [data-query] element
     * still connected to the document; the check runs lazily at each rung
     * firing, so there is no standing watcher. Returns true when the rung
     * should proceed with its fetch. Queries with no rungs have nothing to
     * tear down. Grace exists so data-show toggling, tab switches, and list
     * churn (brief zero-observer windows) never thrash the rungs.
     */
    _queryLifecycleCheck(controller) {
        for (const el of controller.elements) {
            if (!el.isConnected) controller.elements.delete(el);
        }
        const grace = this._queryTeardownGraceMs || 5000;
        const now = Date.now();
        const recentlyRead = controller.lastRead && (now - controller.lastRead) < grace;
        if (controller.elements.size > 0 || recentlyRead) {
            controller.unobservedSince = null;
            return true;
        }
        if (controller.unobservedSince === null) {
            controller.unobservedSince = now;
            return false; // grace window open: keep rungs, skip the fetch
        }
        if (now - controller.unobservedSince >= grace) {
            this._queryTeardown(controller);
        }
        return false;
    },

    /** Tear down rungs and in-flight work; data and ETag persist so a later
     *  re-observation shows last-good instantly and can catch up via 304. */
    _queryTeardown(controller) {
        if (controller.timerId !== null) {
            clearInterval(controller.timerId);
            controller.timerId = null;
        }
        if (controller.lifecycleTimerId !== null) {
            clearInterval(controller.lifecycleTimerId);
            controller.lifecycleTimerId = null;
        }
        if (controller.es) {
            controller.es.close();
            controller.es = null;
        }
        for (const [type, fn] of controller._listeners) {
            window.removeEventListener(type, fn);
        }
        controller._listeners.length = 0;
        if (controller.abort) {
            controller.abort.abort();
            controller.abort = null;
        }
        controller.active = false;
        controller.unobservedSince = null;
    },

    /**
     * The fetch discipline: engine-owned race correctness (DESIGN.md Q5) via
     * last-call-wins, AbortController on supersede, previous rows preserved
     * with isStale during transitions, hard/transient error split.
     */
    _queryFetch(controller, { params, conditional, append } = {}) {
        const wf = this;
        const store = this.getStore(controller.name);
        if (!store) return Promise.resolve();
        const cfg = controller.config;
        const id = ++controller.runId;
        if (controller.abort) controller.abort.abort();

        // Seeded rows (initial: config, SSR adoption) count as usable data:
        // the catch-up fetch is a stale refresh, never a "loading" state
        // that would flash skeletons over content the user can see.
        const hadData = store.lastSync !== null || (store.rows && store.rows.length > 0);
        engineWrite(() => {
            if (!hadData) store.isLoading = true;
            else store.isStale = true;
        });

        const applyRows = (data) => {
            if (id !== controller.runId) return; // superseded: last call wins
            if (__DEV__ && controller.hasRecord && data == null) {
                wfError(WF_ERRORS.QUERY_NULL_RECORD, {
                    warn: true,
                    context: `Query "${controller.name}": record query resolved null/undefined; bound fields will render empty (valid empty context)`
                });
            }
            // WRITE ORDER MATTERS: flags first, rows LAST. DOM bindings
            // coalesce on the effect flush regardless, but onStoreUpdate
            // subscribers fire synchronously per write; writing rows last
            // guarantees a rows subscriber (the documented dependent-query
            // trigger) observes every other field already final. The
            // choke point owns the ordering along with mode dispatch.
            wf._queryIngest(controller, data, { append: !!append, gentle: !!conditional });
        };
        const applyError = (err) => {
            if (id !== controller.runId) return;
            if (err && err.name === 'AbortError') return;
            const msg = err && err.message ? err.message : String(err);
            engineWrite(() => {
                if (hadData) {
                    store.syncError = msg;      // transient: rows preserved
                } else {
                    store.error = msg;          // hard: no usable data
                    store.isLoading = false;
                }
            });
        };

        if (typeof cfg.from === 'function') {
            try {
                return Promise.resolve(cfg.from()).then(applyRows, applyError);
            } catch (e) {
                applyError(e);
                return Promise.resolve();
            }
        }

        const ac = new AbortController();
        controller.abort = ac;
        const merged = Object.assign({}, cfg.params, params);
        for (const k of Object.keys(merged)) {
            if (merged[k] == null) delete merged[k]; // never serialize "undefined"/"null"
        }
        const qs = new URLSearchParams(merged).toString();
        const url = qs ? cfg.from + (cfg.from.indexOf('?') >= 0 ? '&' : '?') + qs : cfg.from;
        const headers = {};
        if (conditional && controller.etag) headers['If-None-Match'] = controller.etag;

        return fetch(url, { signal: ac.signal, headers })
            .then((resp) => {
                if (id !== controller.runId) return;
                if (resp.status === 304) {
                    engineWrite(() => {
                        store.isStale = false;
                        store.syncError = null;
                        store.lastSync = Date.now();
                    });
                    return;
                }
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const et = resp.headers && resp.headers.get && resp.headers.get('ETag');
                if (et) controller.etag = et;
                return resp.json().then(applyRows);
            })
            .catch(applyError);
    },
};
