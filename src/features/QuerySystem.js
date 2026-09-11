/**
 * QuerySystem: the data-query primitive ("SSR for post-load").
 *
 * A query is a named declaration binding markup to an external data source,
 * kept current per a declared freshness policy. Design + decisions:
 * the design notes. Ships only in tiers with SSR
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
import { toRaw as rgToRaw } from '../state/reactive-graph/core.js';

const QUERY_STATE = () => ({
    rows: [],
    isLoading: false,
    error: null,      // HARD: no usable data (initial load failed)
    syncError: null,  // TRANSIENT: refresh failed, existing rows preserved
    isStale: false,
    lastSync: null,
    pendingWrites: 0, // count of unsettled write()s (saving indicators, unload gating)
});

// Field-claim composite keys join row key and field name with NUL — a
// separator that can appear in neither.
const CLAIM_SEP = String.fromCharCode(0);

// Wrap a synchronous block of engine writes to a query store. The
// ContextProxy set trap reads the shared depth cell: depth 0 means an
// application write and draws the WF-950 dev diagnostic.
function engineWrite(fn) {
    QUERY_ENGINE_WRITE.depth++;
    try { fn(); } finally { QUERY_ENGINE_WRITE.depth--; }
}

// --- URL templates ---------------------------------------------------
//
// `from:` and `to:` URLs interpolate `:token` path segments. `from:` has
// been public since 1.3.0, so the grammar is scoped so tightly that no URL
// which worked before can be misread as carrying a token:
//
//  - a token is an IDENTIFIER, never digits first, which is what keeps
//    `http://localhost:3000/api/tasks` token-free (ports are the single
//    most likely collision);
//  - only the PATH is scanned — never the scheme, never the authority
//    (`https://user:pass@host`), never the query string
//    (`?filter=type:book`), each of which contains grammar-matching text;
//  - an unresolvable token is a runtime error naming the token, the query
//    and the operation. Never a silent literal, never `undefined` in a URL.
const URL_TOKEN = /:([A-Za-z_][A-Za-z0-9_]*)/g;

// Every binding attribute a record-shape subtree can carry. The bare-path
// rewrite only ever reached data-bind, which is why an expression, a
// data-bind-attr, or a data-show over a row field silently resolved against
// component scope instead. These all get the row merged into scope.
const RECORD_BINDING_SELECTOR = [
    'data-bind', 'data-wf-bind',
    'data-bind-attr', 'data-wf-bind-attr',
    'data-bind-class', 'data-wf-bind-class',
    'data-bind-style', 'data-wf-bind-style',
    'data-bind-html', 'data-wf-bind-html',
    'data-show', 'data-wf-show',
    'data-render', 'data-wf-render'
].map((a) => '[' + a + ']').join(',');

// [start, end) of the path component: after scheme+authority, before the
// first `?` or `#`.
function urlPathSpan(url) {
    let start = 0;
    const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(url);
    if (scheme) start = url.indexOf('/', scheme[0].length);
    else if (url.charCodeAt(0) === 47 && url.charCodeAt(1) === 47) start = url.indexOf('/', 2);
    if (start < 0) start = url.length;   // authority with no path at all
    let end = url.length;
    const q = url.indexOf('?', start);
    if (q >= 0) end = q;
    const h = url.indexOf('#', start);
    if (h >= 0 && h < end) end = h;
    return [start, end];
}

// Token names appearing in a URL's path, in order. Declaration-time checks
// and the once-per-query dev log read this; the runtime uses interpolateUrl.
function urlTokenNames(url) {
    const [s, e] = urlPathSpan(url);
    const path = url.slice(s, e);
    const names = [];
    let m;
    URL_TOKEN.lastIndex = 0;
    while ((m = URL_TOKEN.exec(path)) !== null) names.push(m[1]);
    return names;
}

// resolve(name) -> value, or null/undefined for "not available". Returns
// { url, consumed } on success and { missing: <token name> } on the first
// token nothing could supply. Values are encodeURIComponent'd, so a token
// always produces exactly one path segment: interpolating unescaped
// application state is how a value containing `/` or `..` silently becomes
// extra segments.
function interpolateUrl(url, resolve) {
    const [s, e] = urlPathSpan(url);
    const consumed = [];
    let missing = null;
    const path = url.slice(s, e).replace(URL_TOKEN, (whole, name) => {
        const v = resolve(name);
        // '' is not a value one path segment can carry: it encodes to an
        // EMPTY segment, silently retargeting the request — an update or
        // delete against /api/items/:id becomes the COLLECTION URL (the
        // empty-segment class axios shipped CVE-2025-27152 over). An
        // empty string is therefore "no value" here: reads wait, writes
        // reject naming the token, exactly like null/undefined.
        if (v == null || v === '') {
            if (missing === null) missing = name;
            return whole;
        }
        consumed.push(name);
        return encodeURIComponent(v);
    });
    if (missing !== null) return { missing };
    return { url: url.slice(0, s) + path + url.slice(e), consumed };
}

// Once-per-query gate for the NETWORK-driven diagnostics:
// WF-958/959/970/980/981/986/989 describe a STANDING condition — the endpoint's
// shape, a broken params/headers function, a non-JSON stream — and would
// otherwise re-warn on the refresh cadence, flooding the console and
// burying every one-shot diagnostic beside them (the rule _expectWarned's
// own comment states: polls and streams must not restate the same fact).
// Keyed by CODE alone: each of these restates one per-query fact, so a
// second sighting from another delivery path adds nothing. No reset on
// heal, matching _expectWarned's documented "forever" — per page load; a
// reload starts fresh. Registration-time diagnostics are
// once-by-construction and per-call diagnostics correctly repeat; neither
// routes through here.
function warnOnce(controller, def) {
    if (controller._warnedOnce === undefined) controller._warnedOnce = new Set();
    if (controller._warnedOnce.has(def.code)) return false;
    controller._warnedOnce.add(def.code);
    return true;
}

// Unhandled write rejections, WF-990 (bug-history survey pass two: the
// TanStack mutate/mutateAsync split, whose docs still warn every
// mutateAsync caller to catch). Fire-and-forget is the NATURAL WF call —
// rollback and syncError are automatic, so the caller has no reason left
// to attach a handler — and the only trace is the platform's
// uncaught-rejection log with a framework stack. Dev builds return the
// write promise as a subclass whose `then` records that SOMEBODY took
// responsibility: .catch() invokes `then` per spec, and `await` resolves
// a subclass through its public `then` (the constructor check in
// PromiseResolve fails, so the thenable job calls it), so both mark it
// handled. The check runs one microtask after the rejection — handlers
// attach at call time, so one hop suffices — and is purely ADDITIVE: the
// framework attaches no handler of its own, the rejection still
// propagates, and the documented try/catch contract stands. A
// chained-only consumer (write().then(f) with the catch further down)
// also counts as handled: responsibility moved to the chain, and the
// platform's own log still covers a chain nobody terminates.
// Handled-ness is tracked in a WeakSet rather than a property on the promise:
// the promise is handed to application code, so a flag on it would be visible
// API surface, and `_wfHandled` already means something else in EventSystem
// (a DOM event this framework has processed).
const DEV_WRITE_HANDLED = __DEV__ ? new WeakSet() : null;
let DevWritePromise = null;
if (__DEV__) {
    DevWritePromise = class extends Promise {
        then(onFulfilled, onRejected) {
            if (typeof onFulfilled === 'function' || typeof onRejected === 'function') {
                DEV_WRITE_HANDLED.add(this);
            }
            return super.then(onFulfilled, onRejected);
        }
    };
}

function devWatchWriteRejection(controller, opName, promise) {
    const wrapped = new DevWritePromise((resolve, reject) => {
        promise.then(resolve, (err) => {
            reject(err);
            Promise.resolve().then(() => {
                if (DEV_WRITE_HANDLED.has(wrapped) || controller._warnedUnhandledWrite) return;
                controller._warnedUnhandledWrite = true;
                wfError(WF_ERRORS.QUERY_WRITE_UNHANDLED, {
                    warn: true,
                    context: `Query "${controller.name}": a ${opName ? `"${opName}" ` : ''}write() rejection reached no handler — the rollback and syncError already applied, but the rejection itself is part of the contract`,
                    suggestion: 'await it in try/catch or attach .catch(); a deliberate fire-and-forget acknowledges the outcome with .catch(() => {})'
                });
            });
        });
    });
    return wrapped;
}

// Dev-only round-trip scan for a persist save, WF-992 (survey pass two:
// the warning redux-persist #82 asked for and never shipped). JSON
// carries a Date out as an ISO string and a Map/Set out as {}, so rows
// that look right all session come back retyped (or emptied) only after
// a reload — the failure surfaces days later, on another machine. First
// offender wins and the scan stops; depth-capped and cycle-safe because
// rows are application data. Returns { path, kind } or null.
// Does a row set satisfy a data-expect declaration? A silent predicate, for
// deciding whether a restored snapshot is usable. Distinct from
// _queryExpectCheck, which warns and spends a once-per-field slot: this
// answers the question without consuming the diagnostic. Dev-only, since
// `expect` is never parsed in production builds.
function expectConforms(expect, rows) {
    for (const [field, type] of expect) {
        for (const row of rows) {
            if (row == null || typeof row !== 'object') continue;
            if (!(field in row)) return false;
            const v = row[field];
            if (type && v != null && typeof v !== type) return false;
        }
    }
    return true;
}

function findNonRoundTrippable(value, path, depth, seen) {
    if (value === null || typeof value !== 'object') return null;
    if (value instanceof Date) return { path, kind: 'Date' };
    if (value instanceof Map) return { path, kind: 'Map' };
    if (value instanceof Set) return { path, kind: 'Set' };
    if (depth >= 5 || seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const hit = findNonRoundTrippable(value[i], path + '[' + i + ']', depth + 1, seen);
            if (hit) return hit;
        }
        return null;
    }
    for (const f of Object.keys(value)) {
        const hit = findNonRoundTrippable(value[f], path + '.' + f, depth + 1, seen);
        if (hit) return hit;
    }
    return null;
}

// Result-cache bounds, each overridable through wildflower.config(). The
// defaults live here rather than in the core options bag because queries ship
// in the full tier only, and a nano page should not carry query keys it can
// never use.
//
// Three bounds rather than one count, because a count alone says nothing about
// what a query retains. QUERY_CACHE_ENTRIES caps how many URLs are held,
// QUERY_CACHE_ROWS caps how many rows those entries retain in total (a
// ten-thousand-row table and a twenty-row page cost very different amounts per
// entry), and QUERY_CACHE_MIN_DWELL decides which URLs were ever worth holding
// at all: `params:` as a function makes search-as-you-type natural, so a
// debounced keystroke resolves its own URL, and a typed sentence would
// otherwise fill the cache with prefixes nobody navigates back to while
// evicting the pages that are. A URL whose successor arrives inside the window
// was a keystroke; one that stayed current while the page was read was a view.
//
// The dwell filter ships OFF. Its cost falls on deliberate fast navigation
// (clicking through four pages in three seconds caches none of them), its
// benefit is confined to URLs that change at typing speed, and both failure
// modes are only ever "the cache did not help", never a wrong repaint. A
// wall-clock rule as a default would also have to be modelled by the read-side
// property oracle, which is how flaky suites are made. Applications with the
// search shape turn it on.
const QUERY_CACHE_ENTRIES = 15;
const QUERY_CACHE_ROWS = 5000;
const QUERY_CACHE_MIN_DWELL = 0;

// Persisted snapshots expire after a fixed day (ruling A-Q2: no knob).
// Shared by the restore gate and the deferred URL-guard comparison.
const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Fingerprint of the CLIENT-SIDE row shapers (survey ruling #4): which
// `select` source text and key produced a snapshot's rows. Rows persist
// post-`select:` while the ETag validates the server's raw BYTES, so a
// deploy changing only the shaping code would restore old-shaped rows
// that a 304 then wrongly confirms as fresh. Hashed from source text,
// the check can only OVER-discard — any real shape change changes the
// text, while an output-neutral edit (or an app minifying its own
// scripts) costs one cold reload — never under-discard. Server-side
// shape changes need no fingerprint: new shape means new bytes, no 304,
// and the 200 replaces the restore on its own.
function shapeFingerprint(controller) {
    if (controller._shapeFp === undefined) {
        const src = String(controller.config.select || '') + '::' + String(controller.key || '');
        let h = 5381;
        for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
        controller._shapeFp = h;
    }
    return controller._shapeFp;
}

// Origin of a request URL, for the origin-scoped header default. A URL with
// no authority is relative, and therefore same-origin by definition — the
// common case for an application talking to its own server. Userinfo is not
// part of an origin.
function urlOrigin(url) {
    const m = /^([A-Za-z][A-Za-z0-9+.-]*:)?\/\/([^/?#]*)/.exec(url);
    if (!m) return (typeof location !== 'undefined' && location.origin) || '';
    const scheme = m[1] || ((typeof location !== 'undefined' && location.protocol) || '');
    const authority = m[2].indexOf('@') >= 0 ? m[2].slice(m[2].lastIndexOf('@') + 1) : m[2];
    return (scheme + '//' + authority).toLowerCase();
}

// A write's HTTP failure, as a rejection the application can act on
// (survey probe #5b): the message keeps its documented 'HTTP <status>'
// shape, and the response rides along as additive properties — `status`
// (the number) and `body` (the parsed JSON, or undefined when the body
// is not JSON) — so a 422's field errors can reach the UI through a
// declarative `to:`. Returns a rejecting promise, because reading the
// body is asynchronous.
function writeHttpError(resp) {
    return resp.json().catch(() => undefined).then((body) => {
        const e = new Error('HTTP ' + resp.status);
        e.status = resp.status;
        e.body = body;
        throw e;
    });
}

// Shallow copy without one field. Used where the framework must hand an
// application function an item minus bookkeeping it added itself.
function omitKey(item, key) {
    const out = {};
    for (const f of Object.keys(item || {})) {
        if (f !== key) out[f] = item[f];
    }
    return out;
}

// --- Operations -------------------------------------------------------
//
// `to:` names a DESTINATION, in one of three forms:
//
//   to: '/api/items/:id'           the row's address. Expands to update
//                                  (PATCH) and delete (DELETE) at the URL
//                                  as literally written — no URL is
//                                  synthesized, only the verb differs.
//   to: { favorite: {...}, ... }   exactly the operations named, no more.
//   to: item => fetch(...)         the escape hatch, retained forever.
//
// PATCH rather than PUT because write() is defined as a partial field
// merge, and PUT would advertise replacement semantics the client does not
// implement.
//
// `create` is its own top-level key rather than a map entry because it
// alone mints identity, and the difference is visible to the author in
// three places: it is CALLED differently (create(item)), its URL must NOT
// interpolate the key token (no key exists at mint time), and a rejection
// unwinds a row that only ever existed optimistically.
const OP_DEFAULT_METHOD = { update: 'PATCH', delete: 'DELETE', create: 'POST' };

function normalizeOperations(name, config, effectiveKey) {
    const to = config.to;
    const mapped = to != null && typeof to !== 'function';
    if (!mapped && config.create == null) return null;

    const shapeWarn = (context, suggestion) => {
        if (__DEV__) wfError(WF_ERRORS.QUERY_TO_SHAPE, { warn: true, context, suggestion });
    };
    // An operation entry is a URL string or { url, method, body, confirmation }.
    // A DECLARED-but-unusable body/confirmation normalizes to null rather than
    // undefined, so a broken entry never silently inherits the query-level one.
    const entry = (opName, decl) => {
        let url = null;
        let method = null;
        let body;
        let confirmation;
        if (typeof decl === 'string') {
            url = decl;
        } else if (decl && typeof decl === 'object' && !Array.isArray(decl)) {
            if (typeof decl.url === 'string') url = decl.url;
            if (typeof decl.method === 'string') method = decl.method.toUpperCase();
            body = decl.body;
            confirmation = decl.confirmation;
        }
        if (!url) {
            shapeWarn(
                `Query "${name}": the "${opName}" operation declares no URL`,
                'An operation is a URL string, or { url, method } with url required'
            );
            return null;
        }
        if (__DEV__ && body != null && typeof body !== 'function') {
            shapeWarn(`Query "${name}": "${opName}".body is not a function`,
                'body: item => ({ ... }) builds the request body from the item being written');
        }
        if (__DEV__ && confirmation != null && typeof confirmation !== 'function') {
            shapeWarn(`Query "${name}": "${opName}".confirmation is not a function`,
                'confirmation: body => record extracts the row the server confirmed from the parsed response body');
        }
        return {
            name: opName,
            url,
            method: method || OP_DEFAULT_METHOD[opName] || 'POST',
            body: body === undefined ? undefined : (typeof body === 'function' ? body : null),
            confirmation: confirmation === undefined ? undefined
                : (typeof confirmation === 'function' ? confirmation : null)
        };
    };

    const ops = new Map();
    if (typeof to === 'string') {
        const u = entry('update', to);
        const d = entry('delete', to);
        if (u) ops.set('update', u);
        if (d) ops.set('delete', d);
    } else if (mapped) {
        if (Array.isArray(to)) {
            shapeWarn(`Query "${name}": \`to\` is an array`,
                'to is a URL string, a map of named operations, or a function');
        } else {
            for (const k of Object.keys(to)) {
                if (k === 'create') {
                    shapeWarn(`Query "${name}": "create" belongs at the top level, not inside \`to\``,
                        'create: { url, method, body, confirmation } — it is the one operation that mints identity');
                    continue;
                }
                const e = entry(k, to[k]);
                if (e) ops.set(k, e);
            }
        }
    }
    if (config.create != null) {
        const e = entry('create', config.create);
        if (e) {
            // Create is the one operation with no key of its own, so a key
            // token in its URL is only resolvable when the CALLER supplies the
            // key — the client-generated-id pattern (`create({ id: uuid() })`
            // against a PUT endpoint), which is legitimate. What is never
            // resolvable is a key the framework minted: that address names a
            // temp id the server never issued. Recorded here and refused at
            // the call site, where the two cases are actually distinguishable.
            e.keyToken = urlTokenNames(e.url).indexOf(effectiveKey) >= 0;
            if (__DEV__ && e.keyToken) {
                wfError(WF_ERRORS.QUERY_URL_TOKEN_UNDECLARED, {
                    warn: true,
                    context: `Query "${name}": create's URL "${e.url}" interpolates the key token ":${effectiveKey}", which only resolves when create() is passed a key the caller made`,
                    suggestion: 'For a server-issued key, point create: at the collection URL the new row is posted to'
                });
            }
            ops.set('create', e);
        }
    }
    // `deleted:` announces tombstones; a map that names no delete route can
    // still be legitimate (a resource may carry a server-driven deleted field
    // for ingest tombstones while the client never issues deletes), so this
    // is announced at load and loud at the call site, not refused here.
    if (__DEV__ && mapped && typeof to !== 'string' && typeof config.deleted === 'string' && !ops.has('delete')) {
        wfError(WF_ERRORS.QUERY_DELETE_SHAPE, {
            warn: true,
            context: `Query "${name}": \`deleted: "${config.deleted}"\` is declared but \`to\` names no "delete" operation; a delete write will error`,
            suggestion: 'Add delete: { url, method: "DELETE" } to to:, or drop deleted: if the client never removes rows'
        });
    }
    return ops;
}

// rung parse: refresh config -> normalized {once, pollSecs, etagSecs, focus, reconnect, sse}
function parseRungs(refresh, name) {
    const rungs = { pollSecs: 0, etagSecs: 0, freshSecs: 0, focus: false, reconnect: false, sse: false };
    const list = refresh == null ? ['once'] : (Array.isArray(refresh) ? refresh : [refresh]);
    for (const r of list) {
        if (typeof r === 'number' && r > 0) rungs.pollSecs = r;
        else if (r === 'focus') rungs.focus = true;
        else if (r === 'reconnect') rungs.reconnect = true;
        else if (r === 'sse') rungs.sse = true;
        else if (typeof r === 'string' && r.startsWith('etag:')) {
            // Validate the suffix INSIDE the matched prefix: the
            // prefix match consumes the branch, so a malformed suffix used to
            // route around the unknown-token warn below and silently disable
            // the rung — 'etag:abc' parsed to 0 and the query never refreshed
            // again. Same code as the terminal warn: it is the same mistake,
            // one character further in.
            const n = parseInt(r.slice(5), 10);
            if (Number.isFinite(n) && n >= 0) rungs.etagSecs = n;
            else if (__DEV__) {
                wfError(WF_ERRORS.QUERY_RUNG_UNKNOWN, {
                    warn: true,
                    context: `Query "${name}": refresh token ${JSON.stringify(r)} has a malformed suffix; token ignored`,
                    suggestion: "etag:N takes a non-negative number of seconds, e.g. 'etag:30'"
                });
            }
        }
        // fresh:N — event rungs (focus/reconnect) skip their refetch while
        // the last confirming sync is younger than N seconds and nothing
        // is stale. No token = 0 = every fire checks (the expected
        // default). Poll keeps its own explicitly chosen cadence, and
        // refresh()/invalidate() never route through the gate.
        else if (typeof r === 'string' && r.startsWith('fresh:')) rungs.freshSecs = parseInt(r.slice(6), 10) || 0;
        else if (r === 'once') { /* adds nothing beyond the activation fetch every query gets */ }
        else if (__DEV__) {
            // A token matching no rung was, until this warn, silently
            // ignored — the plausible-but-wrong 'poll:15' registered a
            // query with no poll at all and nothing said so.
            wfError(WF_ERRORS.QUERY_RUNG_UNKNOWN, {
                warn: true,
                context: `Query "${name}": refresh token ${JSON.stringify(r)} matches no rung; token ignored`,
                suggestion: "Rungs: a number (poll seconds), 'focus', 'reconnect', 'sse', 'etag:N', 'fresh:N', 'once'. Poll is the bare number — 'poll:15' is not a token; write refresh: [15]"
            });
        }
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
     * stream, deleted, retry, to, persist }. `stream` is the optional
     * explicit SSE endpoint for the 'sse' rung (defaults to a string
     * `from`). `persist` (v1.5) keeps the last confirmed server rows in
     * localStorage across reloads: true derives the key, a string names it.
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
        const effectiveKey = config.key || 'id';
        // Operations are derived ONCE, at declaration time: an operation
        // selects between fixed strings, and nothing about the destination is
        // computed from runtime state. null means "no declarative write side"
        // — either a function `to` or no write side at all.
        const operations = normalizeOperations(name, config, effectiveKey);
        if (__DEV__ && config.to != null && typeof config.to !== 'function'
            && typeof config.to !== 'string'
            && !(typeof config.to === 'object' && !Array.isArray(config.to))) {
            wfError(WF_ERRORS.QUERY_TO_SHAPE, {
                warn: true,
                context: `Query "${name}": \`to\` is ${typeof config.to}; write() will throw until it is a URL, an operation map, or a function`,
                suggestion: "to: '/api/items/:id' addresses the row; to: { favorite: { url, method } } names operations; to: item => fetch(...) stays the escape hatch"
            });
        }
        // A token in `from:` can only ever come from params (a read has no
        // item), so a STATIC params object makes every token statically
        // checkable and catches the ordinary typo at load. Deliberately not
        // extended to `to:` URLs: those interpolate the item's own fields
        // first, and a nested parent id living on the row is exactly the
        // shape §8.6 blesses — checking them here would warn on correct code.
        if (__DEV__ && typeof config.from === 'string'
            && config.params && typeof config.params === 'object') {
            for (const t of urlTokenNames(config.from)) {
                if (t in config.params) continue;
                wfError(WF_ERRORS.QUERY_URL_TOKEN_UNDECLARED, {
                    warn: true,
                    context: `Query "${name}": from: "${config.from}" carries the token ":${t}", which the declared params object does not supply`,
                    suggestion: `Add ${t} to params:, or make params a function if the value is derived per fetch`
                });
            }
        }
        if (__DEV__ && typeof config.from === 'function') {
            // A function `from` is called with zero arguments and derives its
            // own URL, so a read can honor neither of these.
            //
            // params is the narrower case: since write URLs interpolate the
            // item's fields first and params as fallback, a query with a
            // function `from` can still need params for a token its rows do
            // not carry (a parent id that lives on the route). Warning there
            // would fire on correct code — the mixed form a query with two
            // read endpoints has to use — so the warn is suppressed whenever
            // some declared operation URL carries a token at all.
            let tokensInWrites = false;
            if (operations) {
                for (const [, op] of operations) {
                    if (urlTokenNames(op.url).length > 0) { tokensInWrites = true; break; }
                }
            }
            for (const opt of ['params', 'select']) {
                if (config[opt] == null) continue;
                if (opt === 'params' && tokensInWrites) continue;
                wfError(WF_ERRORS.QUERY_OPTION_IGNORED, {
                    warn: true,
                    context: `Query "${name}": \`${opt}\` is declared beside a function \`from\`, which builds and parses its own request; the declaration is ignored on reads`,
                    suggestion: `Use the ${opt === 'params' ? 'values' : 'transform'} inside the from function, or move from: to a URL string to let the engine build the request`
                });
            }
        }

        // persist: true derives wf:query:<name>; a non-empty string IS the
        // storage key (per-user keys and the like). Anything else truthy is
        // a misdeclaration — warn and run without persistence.
        let persistKey = null;
        if (config.persist === true) persistKey = 'wf:query:' + name;
        else if (typeof config.persist === 'string' && config.persist) persistKey = config.persist;
        else if (__DEV__ && config.persist != null && config.persist !== false) {
            wfError(WF_ERRORS.QUERY_PERSIST_INVALID, {
                warn: true,
                context: `Query "${name}": \`persist\` is ${JSON.stringify(config.persist)}; persistence disabled`,
                suggestion: "persist: true stores under wf:query:<name>; persist: 'my-key' chooses the localStorage key"
            });
        }

        // initial: takes an ARRAY of rows and nothing else. The two consumers
        // below are Array.isArray-gated with no else, so any other shape was
        // a silent drop — and the natural record-query seed IS
        // an object, so the likeliest author writes initial: { name: '…' }
        // and gets no seed, no warn, and the loading flash the option exists
        // to remove. Same guard class as persist's WF-968 above.
        if (__DEV__ && config.initial != null && !Array.isArray(config.initial)) {
            wfError(WF_ERRORS.QUERY_INITIAL_SHAPE, {
                warn: true,
                context: `Query "${name}": \`initial\` is ${typeof config.initial}, not an array; the seed is ignored`,
                suggestion: "initial: [{ ...row }] — a record query's seed is a one-element array"
            });
        }

        // retry: is a plain count and nothing else. The `| 0` coercion below
        // swallows every other shape silently — `{ max: 3 }` (the shape every
        // peer library uses) becomes 0, which DISABLES retry, and the
        // misdeclaration only surfaces under a network failure the author
        // can't reproduce on demand. Same guard class as persist's WF-968
        // above.
        if (__DEV__ && config.retry != null && (typeof config.retry !== 'number' || !Number.isFinite(config.retry))) {
            const eff = Math.max(0, Math.min(10, config.retry | 0));
            wfError(WF_ERRORS.QUERY_RETRY_SHAPE, {
                warn: true,
                context: `Query "${name}": \`retry\` is ${typeof config.retry === 'number' ? String(config.retry) : JSON.stringify(config.retry)}, not a usable number; it coerces to ${eff}${eff === 0 ? ' — retry is DISABLED' : ''}`,
                suggestion: 'retry: 3 — a plain attempt count (clamped 0-10, fixed doubling backoff). Policy objects like { max: 3 } are not a shape retry takes'
            });
        }

        const rungs = parseRungs(config.refresh, name);
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
            key: effectiveKey,
            deletedField: typeof config.deleted === 'string' ? config.deleted : null,
            // Declaration-time operation registry (null = function `to` or no
            // write side); toFn is the escape hatch, which a query may keep
            // while declaring `create:` declaratively.
            ops: operations,
            toFn: typeof config.to === 'function' ? config.to : null,
            tmpSeq: 0,                // create's minted temp keys
            // In-memory result cache: resolved URL -> raw rows, insertion
            // ordered so the oldest entry is the first key. lastUrl is the URL
            // whose rows are currently on screen, which is what tells a
            // repaint from a pointless re-render of what is already there.
            snapshots: null,
            lastUrl: null,
            // The dwell filter's own state. It cannot read lastUrl, because
            // the 200 path sets that to the incoming URL before it saves (the
            // persist envelope stamps from it), so by save time the previous
            // URL is already gone. These two are written only where an entry
            // is actually added, so they always describe the last one held.
            snapUrl: null,
            snapAt: 0,
            rungs,
            active: false,
            accumulated: false,       // two-state apply model: plain until the first append
            runId: 0,
            abort: null,
            inflightRun: null,        // run id of the read in flight; null once it settles (activation checks it)
            etag: null,
            timerId: null,
            lifecycleTimerId: null,   // SSE-only: low-frequency observer check
            es: null,                 // EventSource when the sse rung is active
            streamUrl: null,          // the RESOLVED URL es is connected to
            _listeners: [],
            elements: new Set(),      // bound [data-query] elements (observers)
            unobservedSince: null,    // timestamp when observers last hit zero
            lastRead: null,           // last getQuery() read (also an observer edge)
            lastSource: null,         // R1 provenance descriptor: 'fetch'|'stream'|'ssr'|'patch'|'write'|'persist' (dev introspection only)
            // §2 auto-retry: opt-in count, fixed doubling curve, no policy
            // object (a configurable policy is the retry library we ruled
            // out of core). Clamped 0..10; 0 = off.
            retryMax: Math.max(0, Math.min(10, config.retry | 0)),
            retryAttempt: 0,
            retryTimerId: null,
            // A write superseded a fetch whose delivery was then dropped
            // by the runId guard. The invalidation signal that started
            // that fetch is consumed (SSE/notification syncs never
            // re-send it), so the write drain owes one catch-up fetch.
            missedArrival: false,
            _retryOnline: null,       // one-shot 'online' resume while the ladder is suspended offline
            _activationQueued: false,
            // Declarative writes (v1.5): `to` stays on config; the controller
            // carries the rollback bookkeeping. fieldClaims maps rowKey+field
            // (NUL-joined) to the writeId that last set it — later claims
            // overwrite earlier, which IS the rollback tie-break.
            // inflightWrites maps each unsettled writeId to the composite
            // keys it wrote, so a rejecting claimant can hand a claim back
            // to the most recent still-pending earlier writer of the field.
            // deferredConfirm holds a confirm whose flags were skipped while
            // another write was unconfirmed; the last settle applies it.
            // Truthy value = the deferring arrival's source ('fetch',
            // 'stream', 'write'), which the drain-by-rejection save reads:
            // only a fetch-sourced deferral leaves controller.etag
            // vouching for the rows it persists.
            writeSeq: 0,
            pendingWrites: 0,
            fieldClaims: new Map(),
            inflightWrites: new Map(),
            deferredConfirm: false,
            // Temp-id corrections register an alias (old key -> server key)
            // and re-key the registries, so writes that captured the tmp key
            // in their closures resolve lookups and payloads against the
            // corrected row instead of resurrecting ghost tmp rows.
            keyAliases: new Map(),
            // Row-EXISTENCE claims: a pending create claims the row's
            // presence (arrivals that omit it keep it), a pending delete
            // claims its absence (arrivals that contain it keep it out).
            // String(rowKey) -> { w: writeId, kind: 'create'|'delete' }.
            rowClaims: new Map(),
            // Cache persistence (v1.5): the localStorage key, or null when
            // the query doesn't persist. Saves happen at the ingest choke
            // point for server truth only; restore happens at activation.
            persistKey,
            _persistRestored: false,
            // True when declared seed data (initial: rows, SSR adoption)
            // populated the store — the ONLY thing a persist restore yields
            // to. A rows-length check would misread a pre-activation
            // optimistic write as seed data and discard the cache.
            _seeded: Array.isArray(config.initial) && config.initial.length > 0,
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
            // refresh() takes an OPTIONS object: { params, append, clear }.
            // Request parameters always live inside `params`, so no request
            // parameter name can ever collide with an option name. Passing
            // parameters directly is not supported; dev builds catch it
            // (WF-961) because the fetch would otherwise silently run without
            // them. `clear` drops the current rows before the request departs
            // (a different list is loading, not the next page); see _queryClear.
            refresh(options) {
                if (__DEV__ && options && typeof options === 'object') {
                    const stray = Object.keys(options).filter((k) => k !== 'params' && k !== 'append' && k !== 'clear');
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
                    clear: !!(options && options.clear),
                    conditional: false
                });
            },
            invalidate() { return wf._queryFetch(controller, { conditional: true }); },
            // patch() is the engine-sanctioned optimistic write (the WF-950
            // hatch formalized, V1_4_ROADMAP §4): the payload is bare data
            // (a row, rows, or a record — the same shapes every source
            // ships), applied through the choke point with source 'patch'.
            // Keyed rows field-merge in place (a patch is a client partial;
            // unnamed fields survive), unseen keys append, tombstones
            // remove, unkeyed payloads merge into the record. The store
            // goes isStale until the next confirming sync. lastSync, error,
            // syncError, and pagination accumulation are untouched.
            patch(data) { return wf._queryIngest(controller, data, { patch: true, source: 'patch' }); },
            // write() is the declared write path (v1.5). Optimistic apply
            // through the merging patch path, field-claim rollback,
            // reconciliation decided by what the transport resolves with.
            // See _queryWrite for the discipline.
            //
            //   write(item)          the operation is DERIVED: delete when the
            //                        declared `deleted` field is truthy on the
            //                        item, update otherwise.
            //   write(name, item)    the operation is NAMED, which is the only
            //                        way a toggle (favorite/unfavorite: one
            //                        URL, opposite verbs) has a destination
            //                        the framework can see.
            write(a, b) {
                // WF-995: write(item, opts) is not a form (survey pass two
                // — overload-shaped signatures are what TanStack paid a
                // major version to delete, and per-call option bags are the
                // habit imported from its peers). The second argument is
                // consumed only by the named-operation overload; every
                // per-call option a peer would put here is a DECLARATION in
                // WF (to:, body:, confirmation:). Dropping it silently read
                // as "the option applied", so dev builds name the drop.
                if (__DEV__ && typeof a !== 'string' && b !== undefined && !controller._warnedWriteArity) {
                    controller._warnedWriteArity = true;
                    wfError(WF_ERRORS.QUERY_WRITE_EXTRA_ARG, {
                        warn: true,
                        context: `Query "${name}": write(item, …) received a second argument, which this form does not take; it was ignored`,
                        suggestion: 'write(item) derives the operation; write("name", item) names one. Per-call options do not exist — reconciliation is declared on the query (to:, body:, confirmation:)'
                    });
                }
                return typeof a === 'string'
                    ? wf._queryWrite(controller, a, b)
                    : wf._queryWrite(controller, null, a);
            },
            // create() is separate because it alone mints identity: the
            // framework issues the temp key, the row appears optimistically,
            // and a confirmed record renames it in place.
            create(item) { return wf._queryWrite(controller, 'create', item); },
        });

        // Elements that bound to this name before it was declared. Runs AFTER
        // the store exists, since finishing their transform activates the query
        // and activation writes to the store. Their bindings were compiled at
        // bind time and the rows they are waiting for arrive through the normal
        // reactive path once the activation fetch lands.
        this._queryDrainLate(name);

        if (__DEV__ && operations && operations.size > 0) {
            // The expansion, printed once per query: a bare `to:` string
            // becoming update+delete is a claim the author can check and find
            // false, so the framework shows its work rather than asking them
            // to infer it. Only queries with a declarative write side log.
            const lines = [];
            for (const [opName, op] of operations) {
                lines.push('  ' + opName + ' '.repeat(Math.max(1, 12 - opName.length)) + op.method + ' ' + op.url);
            }
            console.log('[WF] query "' + name + '" writes to:\n' + lines.join('\n'));
        }

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
     * A `$queryName.path` markup shorthand is an observer edge exactly like
     * a getQuery() JS read (see getQuery's design note above: "markup
     * bindings and tracked JS reads alike signal lifecycle interest") —
     * this is that principle's markup half, reusing getQuery's own
     * lastRead-stamp + deferred-activate mechanics rather than duplicating
     * them. Called from _normalizeStoreShorthands, the single choke point
     * every $-shorthand binding (bind/list/show/class/style/attr) passes
     * through, so one call site covers every binding type. Silent no-op
     * for a name that isn't a registered query (stores/components/plugins
     * using the same $-shorthand syntax are unaffected) — and cheap on the
     * already-active path (a Map lookup + two field touches, no
     * allocation), since normalization can run on every reactive
     * re-evaluation of a binding, not just once at setup.
     * @private
     */
    _queryTouchByShorthand(name) {
        const controller = this._queryControllers && this._queryControllers.get(name);
        if (!controller) return;
        controller.lastRead = Date.now();
        if (!controller.active && !controller._activationQueued) {
            controller._activationQueued = true;
            Promise.resolve().then(() => {
                controller._activationQueued = false;
                this._queryActivate(controller);
            });
        }
    },

    /**
     * Invalidate several queries in one call — the blessed form of the
     * sibling pattern (write through one query, then converge the views
     * that show the same entity). Names only: no tags, no patterns, no
     * no-args form. WF's grain is few named queries, so the varargs list
     * IS the grouping mechanism; blanket invalidate-everything stays
     * deliberately out of reach.
     *
     * Inactive queries are skipped, not activated: activation always runs
     * its own catch-up fetch, so an unobserved query revalidates the
     * moment anything next observes it — invalidating it now would fetch
     * data nothing renders. Returns Promise.all of the triggered
     * refetches (they settle into state, never reject), so a write flow
     * can await convergence.
     */
    invalidateQueries(...names) {
        const pending = [];
        for (const name of names) {
            if (!this._queryControllers || !this._queryControllers.has(name)) {
                if (__DEV__) wfError(WF_ERRORS.QUERY_UNKNOWN, {
                    warn: true,
                    context: `invalidateQueries("${name}"): no such query is registered; skipped`
                });
                continue;
            }
            const controller = this._queryControllers.get(name);
            if (!controller.active) continue;
            pending.push(this._queryFetch(controller, { conditional: true }));
        }
        return Promise.all(pending);
    },

    /**
     * Remove persisted snapshots — the logout story. Persisted rows are
     * same-origin data at rest, and signing out must not leave one user's
     * rows on disk for the next. Named form clears specific queries;
     * no-args clears every registered query that declared persist:
     * (custom keys included, since the controller knows them). In-memory
     * rows are untouched — a logout flow navigates or reloads, and the
     * cleared disk means nothing restores when it does. Returns the count
     * of snapshots removed.
     *
     * A clear holds through the TRANSITION (survey probe #3, ruled
     * 2026-08-29): saves are suppressed for the same fixed grace the
     * lifecycle teardown uses, then persistence resumes on its own. The
     * save site is the ingest choke point, so without the window the
     * next delivery — an in-flight fetch settling, a focus tick as the
     * logout view swaps in — wrote the snapshot right back (the
     * TanStack #3782 "re-appears one second later" shape). A window
     * rather than a latch: there is no re-arm event to define and no
     * silent persistence-off mode for the next session to trip over;
     * once the grace lapses, whatever the server now delivers is
     * current truth for whoever's session it is. Full soft-logout
     * safety still means navigate, reload, or unobserve.
     */
    clearPersisted(...names) {
        if (typeof localStorage === 'undefined') return 0;
        const qc = this._queryControllers;
        let cleared = 0;
        const grace = this._queryTeardownGraceMs || 5000;
        const wipe = (c) => {
            if (!c.persistKey) return;
            c._persistClearedUntil = Date.now() + grace;
            c._warnedSaveAfterClear = false;
            try {
                if (localStorage.getItem(c.persistKey) !== null) {
                    localStorage.removeItem(c.persistKey);
                    cleared++;
                }
            } catch { /* read-only storage */ }
        };
        if (names.length === 0) {
            if (qc) qc.forEach(wipe);
            return cleared;
        }
        for (const name of names) {
            if (!qc || !qc.has(name)) {
                if (__DEV__) wfError(WF_ERRORS.QUERY_UNKNOWN, {
                    warn: true,
                    context: `clearPersisted("${name}"): no such query is registered; skipped`
                });
                continue;
            }
            wipe(qc.get(name));
        }
        return cleared;
    },

    /**
     * Template-content half of the transform below, run from
     * ListNestedManager._processNestedTemplates on a row template's content
     * before its nested lists are collected. Rows are cloned from that
     * content, so this is the only place a data-query INSIDE a row can be
     * rewritten. Attributes only: no observation or activation, since
     * template content is never connected; the cloned rows' lists keep the
     * query alive through the shorthand read while they are on the page. A
     * query registered later still renders (the shorthand path wakes on
     * registration), but its rows are then unkeyed.
     * @private
     */
    _transformQueryElementsInTemplate(root) {
        if (!root || !root.querySelectorAll) return;
        const els = [];
        if (root.matches && root.matches('[data-query],[data-wf-query]')) els.push(root);
        root.querySelectorAll('[data-query],[data-wf-query]').forEach((el) => els.push(el));
        for (const el of els) {
            const name = el.getAttribute('data-query') || el.getAttribute('data-wf-query');
            if (!name) continue;
            const wfPrefixed = !el.getAttribute('data-query') && !!el.getAttribute('data-wf-query');
            const controller = this._queryControllers && this._queryControllers.get(name);
            if (!el.querySelector(':scope > template')) {
                this._queryRewriteRecordPaths(el, name);
                if (controller) controller.hasRecord = true;
                continue;
            }
            if (!el.hasAttribute('data-list') && !el.hasAttribute('data-wf-list')) {
                el.setAttribute(wfPrefixed ? 'data-wf-list' : 'data-list', '$' + name + '.rows');
            }
            if (controller) {
                if (!el.hasAttribute('data-key') && !el.hasAttribute('data-wf-key')) {
                    el.setAttribute(wfPrefixed ? 'data-wf-key' : 'data-key', controller.key);
                }
                controller.hasList = true;
            }
        }
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
    _transformQueryElements(rootEl, instance) {
        if (!rootEl || !rootEl.querySelectorAll) return;
        // There used to be a production-only guard here skipping the scan when
        // no query was registered YET. That is exactly the late-declaration
        // case, so it made the whole late-binding path inert in production
        // while dev passed: a dev/prod divergence the minified arm caught. It
        // cannot be kept, because a late-declared query's attributes have to be
        // written at bind time or no binding compiles at all, and by
        // registration the component's bindings are long since compiled.
        //
        // Cost of removing it: one matches() + one querySelectorAll per
        // COMPONENT init (this runs from _processComponentBindings and
        // _setupListContexts, both per component instance, never per list row),
        // paid by apps that use no queries at all. Measured in real Chromium on
        // the minified build: 0.30 us per init for a 20-element component, 1.41
        // us at 120 elements, 6.89 us at 600. A thousand-component page pays
        // under 1.5 ms once, at init, and nothing per frame. Apps that use
        // queries always paid this.
        const els = [];
        if (rootEl.matches && rootEl.matches('[data-query],[data-wf-query]')) els.push(rootEl);
        rootEl.querySelectorAll('[data-query],[data-wf-query]').forEach((el) => els.push(el));
        for (const el of els) {
            const name = el.getAttribute('data-query') || el.getAttribute('data-wf-query');
            if (!name) continue;
            // Under a data-render section that starts hidden: the conditional
            // pass runs after this transform, so without the check the element
            // would be observed and the query fetched for a section removed a
            // moment later. Rewrite the attributes (the section's clone carries
            // them) and let insertion observe it.
            const hidden = !!instance && this._insideHiddenRender(el, rootEl, instance);
            if (el._wfQueryBound) {
                // Already transformed. If its query was lifecycle-torn-down
                // and this element is back in a scan (re-observation, e.g.
                // list churn re-attaching the same node), resume the rungs.
                const bound = this._queryControllers && this._queryControllers.get(name);
                if (bound && !bound.active && !hidden) {
                    observeElement(bound, el);
                    this._queryActivate(bound);
                }
                continue;
            }
            const controller = this._queryControllers && this._queryControllers.get(name);
            const hasTemplateEarly = !!el.querySelector(':scope > template');
            if (!controller) {
                // LATE DECLARATION. The module that declares this query may not
                // have run when the component owning this markup bound, and
                // markup cannot state that ordering. Skipping outright left the
                // element with no compiled binding at all, so a later
                // wildflower.query() had nothing to wake and the element stayed
                // inert for the life of the page (the "query never fetches"
                // report). Write what can be written without the controller so a
                // real binding compiles now: the list path needs only the rows
                // path, and the record path needs only the name. The controller
                // half (key, observation, activation) is finished by the drain in
                // query(), and the pending-entity wake renders the rows.
                if (hasTemplateEarly) {
                    const wfPre = !el.getAttribute('data-query') && !!el.getAttribute('data-wf-query');
                    if (!el.hasAttribute('data-list') && !el.hasAttribute('data-wf-list')) {
                        el.setAttribute(wfPre ? 'data-wf-list' : 'data-list', '$' + name + '.rows');
                    }
                } else {
                    this._queryRewriteRecordPaths(el, name);
                }
                this._queryRememberLate(name, el);
                continue;
            }
            if (__DEV__) {
                // data-expect (§4b, WF-962): dev-only shape-drift warn.
                // Parsed once per query, first declaring element wins; the
                // attribute is never read in production builds.
                const expectSpec = el.getAttribute('data-expect') || el.getAttribute('data-wf-expect');
                if (expectSpec && !controller.expect) {
                    controller.expect = this._parseQueryExpect(expectSpec, name);
                }
            }
            const hasTemplate = hasTemplateEarly;
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
                if (hidden) {
                    this._queryRewriteRecordPaths(el, name);
                    continue;
                }
                el._wfQueryBound = true;
                controller.hasRecord = true;
                observeElement(controller, el);
                this._queryRewriteRecordPaths(el, name);
                this._queryActivate(controller);
                continue;
            }
            if (hidden) {
                const wfPre = !el.getAttribute('data-query') && !!el.getAttribute('data-wf-query');
                if (!el.hasAttribute('data-list') && !el.hasAttribute('data-wf-list')) {
                    el.setAttribute(wfPre ? 'data-wf-list' : 'data-list', '$' + name + '.rows');
                }
                if (!el.hasAttribute('data-key') && !el.hasAttribute('data-wf-key')) {
                    el.setAttribute(wfPre ? 'data-wf-key' : 'data-key', controller.key);
                }
                continue;
            }
            el._wfQueryBound = true;
            // Mirror of hasRecord for the list path. One query may be bound by
            // several elements ("many views"), so the two are not exclusive,
            // and a query bound BOTH ways is a keyed list that also renders a
            // record view. Writes take the list reading in that case, since a
            // list binding means the rows carry keys.
            controller.hasList = true;
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
     * Record shape: rewrite bare data-bind paths in the subtree to
     * $name.rows.0.<path> so the existing binding engine owns resolution.
     * Needs the query NAME only, never the controller, which is what lets a
     * late-declared query still compile a real binding.
     *
     * Idempotent: a rewritten value carries a `$` and fails BARE_PATH, so a
     * second pass leaves it alone. Only simple dotted paths are rewritten;
     * expressions and $-prefixed paths pass through untouched.
     * @private
     */
    _queryRewriteRecordPaths(el, name) {
        const prefix = '$' + name + '.rows.0.';
        const BARE_PATH = /^[a-zA-Z_][\w.]*$/;
        const rewrite = (node) => {
            // Whole-attribute bare paths keep the rewrite. It already works and
            // it is reactive by construction, since $name.rows.0.x is an
            // ordinary tracked read.
            for (const attr of ['data-bind', 'data-wf-bind']) {
                const v = node.getAttribute(attr);
                if (v && BARE_PATH.test(v) && !v.startsWith('computed:')) {
                    node.setAttribute(attr, prefix + v);
                }
            }
            // Everything else in the subtree (expressions, and every binding
            // attribute the rewrite cannot reach) gets the row merged into its
            // evaluation scope instead, exactly as a data-list template merges
            // its item. The marker is what _resolveEffectExpression keys off.
            node._wfRecordQuery = name;
        };
        rewrite(el);
        el.querySelectorAll(RECORD_BINDING_SELECTOR).forEach(rewrite);
    },

    /**
     * Remember an element whose query was not declared yet, so query() can
     * finish binding it. Also arms the unregistered-name warning, deferred
     * behind the teardown grace: a query that arrives a moment later is a
     * legal ordering, and warning at bind time would fire on correct code,
     * which is the false-positive shape WF-975/976 was ruled against. A name
     * still absent after the grace is a genuine typo and gets named then.
     * @private
     */
    _queryRememberLate(name, el) {
        if (!this._queryLateEls) this._queryLateEls = new Map();
        let els = this._queryLateEls.get(name);
        if (!els) this._queryLateEls.set(name, (els = new Set()));
        // Prune on the way in. A name that never registers is never drained,
        // so without this an SPA that repeatedly mounts markup carrying a
        // misspelled query name would retain every detached element it ever
        // bound. Bounded work: this set only ever holds elements waiting on one
        // undeclared name.
        for (const prev of els) {
            if (!prev.isConnected) els.delete(prev);
        }
        els.add(el);
        if (__DEV__) {
            if (!this._queryLateWarned) this._queryLateWarned = new Set();
            if (this._queryLateWarned.has(name)) return;
            this._queryLateWarned.add(name);
            setTimeout(() => {
                if (this._queryControllers && this._queryControllers.has(name)) return;
                wfError(WF_ERRORS.QUERY_UNKNOWN, {
                    warn: true,
                    context: `data-query="${name}": no query by that name was ever registered; the element compiled a binding and is waiting for one that has not arrived`,
                    suggestion: `Register it with wildflower.query('${name}', { from: ... }). Declaring it after the markup binds is fine; never declaring it is not`
                });
            }, this._queryTeardownGraceMs || 5000);
        }
    },

    /**
     * Finish binding the elements that were waiting on this query. Called from
     * query() once the controller exists: re-running the transform completes
     * the half the missing controller blocked (key, observation, activation)
     * and leaves the already-written attributes alone.
     * @private
     */
    _queryDrainLate(name) {
        const els = this._queryLateEls && this._queryLateEls.get(name);
        if (!els) return;
        this._queryLateEls.delete(name);
        for (const el of els) {
            if (el.isConnected) this._transformQueryElements(el);
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
        // Rows installed by a persist restore do NOT block adoption: the
        // server-rendered markup is the fresher authority, and when the
        // query was observed before this markup scanned in (a computed
        // above the list, a route-guard getQuery() warm), the activation
        // microtask ran restore first. Adoption still wins retroactively.
        if (store.lastSync !== null) return;
        if (store.rows && store.rows.length > 0 && !controller._persistRestored) return;

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

        // Adopting over restored rows must also undo the restore's
        // artifacts: the disk etag no longer vouches for what the store
        // holds (a 304 against it must never confirm adopted rows, nor
        // re-save the sparser markup parse over a full snapshot), and the
        // conditional fetch activation already sent with that etag is
        // superseded by a fresh catch-up.
        const adopt = (rows) => {
            controller._seeded = true;
            const overrodeRestore = controller._persistRestored;
            if (overrodeRestore) {
                controller._persistRestored = false;
                controller.etag = null;
                controller.etagUrl = null;
                controller.etags = null;
                controller.etagPending = null;
            }
            this._queryIngest(controller, rows, { seed: true, source: 'ssr' });
            if (overrodeRestore && controller.active) {
                this._queryFetch(controller, { conditional: true });
            }
        };

        if (isList) {
            const rows = [];
            // key -> adopted server element, consumed by the list renderer's
            // mapArray takeover so adopted DOM survives the superseding
            // refresh as the same nodes (same contract as plain-SSR
            // hydration's map in _trySSRHydrationForMapArray).
            const adoptedByKey = new Map();
            const keyProp = controller.key;
            for (const child of el.children) {
                if (child.tagName === 'TEMPLATE') continue;
                const row = readFields(child, {});
                if (Object.keys(row).length > 0) {
                    rows.push(row);
                    if (row[keyProp] !== undefined) adoptedByKey.set(row[keyProp], child);
                }
            }
            if (rows.length > 0) {
                if (adoptedByKey.size > 0) el._ssrAdoptedByKey = adoptedByKey;
                adopt(rows);
            }
        } else {
            const record = readFields(el, {});
            if (Object.keys(record).length > 0) adopt([record]);
        }
    },

    /**
     * THE ingestion choke point (pagination design ruling: one function
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
     *
     * Provenance rule (v1.5): client intents MERGE, server truth REPLACES,
     * write() confirmations MERGE-PATCH. Patch mode field-merges partials
     * into matched rows; every genuine server arrival (fetch, SSE, gentle,
     * append) replaces verbatim. write()'s reconcile (the internal
     * `reconcile` flavor riding patch mode) is neither: it follows JSON
     * Merge Patch (RFC 7396) — present-with-value applies, present-as-null
     * deletes, absent is left untouched — since a confirmation is a patch,
     * not an exhaustive read.
     */
    _queryIngest(controller, data, { append = false, gentle = false, seed = false, patch = false, reconcile = false, source = null, restoreAt = null } = {}) {
        // Any full delivery (fetch, stream, append page) is fresher than
        // whatever a superseded fetch was carrying: the miss is subsumed.
        if (!patch && !seed) controller.missedArrival = false;
        // Envelope provenance ruling: every caller declares where the
        // rows came from. Behavior flags keep sole authority over apply
        // mode; the descriptor feeds dev introspection and diagnostics.
        if (source) controller.lastSource = source;
        const store = this.getStore(controller.name);
        if (!store) return;
        const incoming = Array.isArray(data) ? data : (data == null ? [] : [data]);
        const key = controller.key;
        const df = controller.deletedField;
        const keyOf = (r) => (r == null ? undefined : r[key]);

        // INVARIANT: rows stored into the graph are always RAW. Reading
        // store.rows returns facade-wrapped rows; carrying those back into
        // the next rows array would store proxies in the raw graph — the
        // exact nesting the set trap's stance forbids (it corrupts
        // path/NODES lookups, so bindings wake wrong fields, and each
        // cycle deepens the ownKeys chain until reads freeze the page).
        // Incoming payloads are unwrapped too: an app may hand a facade
        // row straight back (q.write(q.rows[0]) with edits).
        // Server arrivals honor row-EXISTENCE claims: a row a pending
        // delete owns stays out of `live` (its absence holds until the
        // delete settles), while `arrived` keeps every non-tombstone row
        // for the pre-image refresh below — a suppressed arrival is still
        // the newest known truth for rollback targets.
        const serverArrival = reconcile || !patch;
        // A pending delete's claim on a row's ABSENCE holds against any
        // ingest that isn't its own eventual settle — a server arrival
        // (the original case) and an UNRELATED write's own reject/resolve
        // ingest alike, since neither carries newer information about
        // whether the delete should be honored. Safe unconditionally: the
        // delete's own restore-on-reject releases its rowClaims entry
        // BEFORE issuing its restore ingest (see onReject), so it can
        // never self-exclude.
        const deleteClaimed = (k2) => {
            if (controller.rowClaims.size === 0) return false;
            const rc = controller.rowClaims.get(String(k2));
            return !!rc && rc.kind === 'delete';
        };
        const dead = new Set();
        const live = [];
        const arrived = [];
        for (const r0 of incoming) {
            const r = rgToRaw(r0);
            if (df && r && r[df]) {
                const k = keyOf(r);
                if (k !== undefined) dead.add(k);
            } else {
                arrived.push(r);
                if (!deleteClaimed(keyOf(r))) live.push(r);
            }
        }

        // An optimistic write applies a PARTIAL carrying only the fields it
        // changes, so every other declared field is absent by design. The
        // warn spends its once-per-field slot forever, so checking that
        // partial burned the slot on a non-arrival and masked the real drift
        // that arrived later from the server. Gated on SOURCE rather than on
        // the patch flag: patch() is the application handing the store data
        // and stays checked (pinned in query-data-expect), as does a write's
        // reconcile, which is server truth. Only write's own optimistic
        // apply and its rollback restores are exempt.
        const clientIntent = source === 'write' && !reconcile;
        if (__DEV__ && controller.expect && live.length > 0 && !clientIntent) {
            this._queryExpectCheck(controller, live, source);
        }

        let mode = patch ? 'patch' : append ? 'append' : (controller.accumulated && gentle ? 'merge' : 'replace');
        // Scan the WHOLE page (review A2): checking only live[0] let a mixed
        // keyed/unkeyed payload slip the guard — its unkeyed rows entered the
        // accumulation once, then vanished from every later page (the seen
        // set held `undefined` from then on).
        if (append && live.length > 0 && live.some((r) => keyOf(r) === undefined)) {
            if (__DEV__) wfError(WF_ERRORS.QUERY_APPEND_UNKEYED, {
                warn: true,
                context: `Query "${controller.name}": append received rows without the declared key field ("${key}"), so accumulation would duplicate; applied as a replace instead`,
                suggestion: 'Give appended rows the declared key, or declare the right key: on the query'
            });
            mode = 'replace';
        }

        const current = rgToRaw(store.rows) || [];
        // Server arrivals and write reconciles honor in-flight claims: an
        // arriving row's copy of a field an in-flight write still owns
        // predates (or races) that write, so the current (optimistic) value
        // stands and the owner's own settle decides the field. A write's
        // own claims are released before its reconcile ingest, so any claim
        // seen here belongs to another writer. Plain client patches skip
        // this: a later client intent overwrites by design.
        let claimedFields = null;
        if (serverArrival && controller.fieldClaims.size > 0) {
            claimedFields = new Map();
            for (const c of controller.fieldClaims.keys()) {
                const i = c.indexOf(CLAIM_SEP);
                const rowK = c.slice(0, i);
                let set = claimedFields.get(rowK);
                if (!set) claimedFields.set(rowK, (set = new Set()));
                set.add(c.slice(i + 1));
            }
        }
        const reconcileRow = (rec, cur, rowK) => {
            if (!claimedFields) return rec;
            const fields = claimedFields.get(String(rowK));
            if (!fields) return rec;
            const out = Object.assign({}, rec);
            for (const f of fields) {
                if (cur != null && f in cur) out[f] = cur[f];
                else delete out[f];
            }
            return out;
        };
        // write()'s confirming resolution follows JSON Merge Patch (RFC
        // 7396): a field present with a value applies, a field present as
        // `null` is removed, and a field ABSENT is left untouched. RECURSIVE
        // per the RFC's MergePatch: when both sides hold a plain object, the
        // same three rules apply inside it, so a nested partial cannot
        // reintroduce absence-drops-fields one level down.
        // Arrays are values — replaced wholesale, never merged. This is
        // deliberately narrower than a genuine server arrival (fetch, SSE,
        // append), which stays verbatim-replace below — those are exhaustive
        // by construction, a write confirmation is a patch. Only called at
        // the two `reconcile` call sites; a non-reconcile call (append's
        // shared code path) skips straight to reconcileRow, unchanged.
        const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
        const mergePatchRow = (resolved, cur) => {
            const out = isPlainObject(cur) ? Object.assign({}, cur) : {};
            for (const f in resolved) {
                if (!Object.prototype.hasOwnProperty.call(resolved, f)) continue;
                const v = resolved[f];
                if (v === null) delete out[f];
                else out[f] = isPlainObject(v) ? mergePatchRow(v, out[f]) : v;
            }
            return out;
        };
        const resolveConfirmation = (resolved, cur, rowK) =>
            reconcileRow(reconcile ? mergePatchRow(resolved, cur) : resolved, cur, rowK);
        // Server truth moved: refresh the BOTTOM-most pending writer's
        // pre-image per carried field. Its stored pre-image represents the
        // server base a full rollback lands on; higher writers' pre-images
        // are predecessor optimistic values (the unwind chain) and must not
        // be touched. Without this, a rollback after an out-of-band arrival
        // would clobber another client's change with pre-arrival state.
        if (serverArrival && controller.inflightWrites.size > 0 && arrived.length > 0) {
            // Positions refresh here for the same reason field pre-images do,
            // and from the same payload. This arrival is a newer row ORDER, so
            // an index captured against the previous one no longer names the
            // same slot. `arrived` still carries the row a pending delete owns
            // (the claim hides it from view, it is not dropped), so the freshest
            // correct slot is simply where the server just put it. Re-reading it
            // from the payload beats both guessing and refetching: a rejected
            // write changed nothing on the server, so it has no business
            // issuing a read.
            if (controller.deletePositions && controller.rowClaims.size > 0) {
                const orderByKey = new Map();
                for (let i = 0; i < arrived.length; i++) orderByKey.set(String(keyOf(arrived[i])), i);
                for (const [sk, rc] of controller.rowClaims) {
                    if (rc.kind !== 'delete') continue;
                    const pos = controller.deletePositions.get(rc.w);
                    const at = orderByKey.get(sk);
                    if (pos && at !== undefined) pos.index = at;
                }
            }
            const liveByKey = new Map();
            for (const r of arrived) liveByKey.set(String(keyOf(r)), r);
            const bottoms = new Map();
            for (const [wid, prevs] of controller.inflightWrites) {
                for (const pk of prevs.keys()) {
                    const held = bottoms.get(pk);
                    if (held === undefined || wid < held) bottoms.set(pk, wid);
                }
            }
            for (const [pk, wid] of bottoms) {
                const i = pk.indexOf(CLAIM_SEP);
                const row = liveByKey.get(pk.slice(0, i));
                if (!row) continue;
                const f = pk.slice(i + 1);
                if (f in row) controller.inflightWrites.get(wid).set(pk, row[f]);
            }
        }
        let nextRows;
        if (mode === 'append' || mode === 'patch') {
            // Provenance decides depth: a client intent (patch, write()'s
            // optimistic apply) is a PARTIAL — it field-merges into the row
            // it names, so unnamed fields survive. Append pages (a genuine
            // server arrival) are COMPLETE — they replace the matched row
            // verbatim, so fields the server dropped are dropped here too.
            // write()'s reconcile (the internal `reconcile` flavor) is
            // neither: it follows JSON Merge Patch (RFC 7396) via
            // resolveConfirmation/mergePatchRow above — present-with-value
            // applies, present-as-null deletes, absent is left alone.
            const fieldMerge = mode === 'patch' && !reconcile;
            if (mode === 'patch' && live.length > 0 && keyOf(live[0]) === undefined) {
                // Unkeyed patch payload: the record-query case. A client
                // partial merges into rows[0]; anything else (reconcile,
                // multi-row payloads, empty store) is a wholesale replace.
                if (fieldMerge && live.length === 1 && current.length > 0) {
                    nextRows = [Object.assign({}, rgToRaw(current[0]), live[0])].concat(current.slice(1).map(rgToRaw));
                } else if (reconcile && live.length === 1 && current.length > 0) {
                    nextRows = [resolveConfirmation(live[0], rgToRaw(current[0]), undefined)];
                } else {
                    nextRows = live;
                }
            } else {
                const fresh = new Map();
                for (const r of live) fresh.set(keyOf(r), r);
                nextRows = [];
                for (const r0 of current) {
                    const r = rgToRaw(r0); // raw carry: never a facade (see invariant above)
                    const k = keyOf(r);
                    if (dead.has(k)) continue;
                    nextRows.push(fresh.has(k)
                        ? (fieldMerge ? Object.assign({}, r, fresh.get(k)) : resolveConfirmation(fresh.get(k), r, k))
                        : r); // keyed dedup: update in place
                }
                const seen = new Set(nextRows.map(keyOf));
                for (const r of live) {
                    const k2 = keyOf(r);
                    if (!seen.has(k2)) {
                        // Grow the set as we append: a snapshot
                        // let two same-key rows in ONE payload both land when
                        // the key was not already present — silent duplication
                        // that every later write resolved against the first
                        // copy of.
                        seen.add(k2);
                        nextRows.push(r);
                    }
                }
                // A rejected delete restoring a row it still has a true index
                // for: move it out of the append slot and back where it was.
                // Clamped, since rows may have left during the window; a stale
                // index never reaches here (restoreAt is only passed when the
                // saved position survived the flight).
                if (restoreAt != null && live.length > 0) {
                    const rk = String(keyOf(live[0]));
                    const at = nextRows.findIndex((r) => String(keyOf(r)) === rk);
                    if (at >= 0) {
                        const [moved] = nextRows.splice(at, 1);
                        nextRows.splice(Math.min(restoreAt, nextRows.length), 0, moved);
                    }
                }
            }
            if (mode === 'append') controller.accumulated = true;
        } else if (mode === 'merge') {
            const freshKeys = new Set(live.map(keyOf));
            const tail = [];
            const curByKey = claimedFields ? new Map(current.map((r) => [keyOf(r), rgToRaw(r)])) : null;
            for (const r0 of current) {
                const r = rgToRaw(r0); // raw carry (see invariant above)
                const k = keyOf(r);
                if (!freshKeys.has(k) && !dead.has(k)) tail.push(r);
            }
            nextRows = (claimedFields
                ? live.map((r) => reconcileRow(r, curByKey.get(keyOf(r)), keyOf(r)))
                : live).concat(tail);
        } else {
            if (claimedFields && current.length > 0) {
                const curByKey = new Map(current.map((r) => [keyOf(r), rgToRaw(r)]));
                nextRows = live.map((r) => {
                    const k2 = keyOf(r);
                    return reconcileRow(r, k2 === undefined ? rgToRaw(current[0]) : curByKey.get(k2), k2);
                });
            } else {
                nextRows = live;
            }
            // Rows whose EXISTENCE a pending create owns survive an
            // arrival that omits them; the create's own settle decides.
            if (serverArrival && controller.rowClaims.size > 0 && current.length > 0) {
                const liveKeys = new Set(nextRows.map(keyOf));
                for (const r0 of current) {
                    const r = rgToRaw(r0);
                    const k2 = keyOf(r);
                    const rc = controller.rowClaims.get(String(k2));
                    if (rc && rc.kind === 'create' && !liveKeys.has(k2)) {
                        if (nextRows === live) nextRows = live.slice();
                        nextRows.push(r);
                    }
                }
            }
            if (!seed) controller.accumulated = false;
        }

        // Flags first, rows LAST (standing subscriber-ordering contract).
        engineWrite(() => {
            if (mode === 'patch') {
                if (reconcile) {
                    // write() reconcile: the server accepted this write, so
                    // it counts as a confirming sync — but only once no
                    // other write remains unconfirmed, so overlapping
                    // optimistic state is never reported fresh. A skipped
                    // confirm is REMEMBERED: if the last pending write later
                    // settles by rejection, its handler applies the deferred
                    // flags so isStale cannot stick forever.
                    if (controller.pendingWrites === 0) {
                        controller.deferredConfirm = false;
                        store.isLoading = false;
                        store.isStale = false;
                        store.error = null;
                        store.syncError = null;
                        store.lastSync = Date.now();
                    } else {
                        controller.deferredConfirm = 'write';
                    }
                } else {
                    // An optimistic write is not a sync: nothing is
                    // confirmed, so isStale goes up and lastSync is left
                    // alone. The next confirming sync clears it.
                    store.isStale = true;
                    // But it IS data on screen, and isLoading means "no
                    // usable data yet" everywhere else in the engine — the
                    // fetch path's own `hadData` counts rows exactly this
                    // way, which is why a seeded or restored query reports
                    // stale rather than loading. Without this the one
                    // remaining path left isLoading true with its own rows
                    // painted, so a bound spinner covered real content.
                    // (TanStack derives status from data presence, RTK Query
                    // gates isLoading on !hasData; SWR latches the flag at
                    // request start and has fielded the resulting reports
                    // for years.) A rejected create removes the row, and the
                    // recovery fetch re-raises the flag on its own.
                    if (nextRows && nextRows.length > 0) store.isLoading = false;
                }
            } else if (!seed) {
                if (controller.pendingWrites > 0) {
                    // A full sync while writes pend cannot report fresh:
                    // claim-honored fields still carry unconfirmed
                    // optimistic values (the reconcile arm's rationale,
                    // applied to arrivals). Hold the confirm. Loading
                    // ends and a hard first-load error is over — data is
                    // present — but freshness waits for the drain.
                    //
                    // The held confirm REMEMBERS ITS SOURCE (truthy either
                    // way): the drain-by-rejection landing persists the
                    // held arrival's rows, and only a FETCH-sourced
                    // deferral leaves controller.etag vouching for them —
                    // a stream push never updates the validator, so pairing
                    // it there is the d6bd925e class by the drain route.
                    controller.deferredConfirm = source || 'stream';
                    store.isLoading = false;
                    store.error = null;
                } else {
                    controller.deferredConfirm = false; // a full sync subsumes any held confirm
                    store.isLoading = false;
                    store.isStale = false;
                    store.error = null;
                    store.syncError = null;
                    store.lastSync = Date.now();
                }
            }
            store.rows = nextRows;
        });

        // Cache persistence: server truth only, and only at rest. fetch,
        // stream, and write()'s reconcile qualify; patch and optimistic
        // write ingests never do, and pending writes defer to the drain
        // (pendingWrites is decremented before the settling reconcile, so
        // the LAST settle saves the converged rows). nextRows is already
        // raw — serialize it directly rather than re-reading the proxy.
        // The validator rides ONLY when the FETCH produced these rows: the
        // held etag describes the last fetch's content, and a stream push
        // (like a reconcile) just changed the rows past it — persisting the
        // pair would let a later restore + 304 wrongly confirm them
        // (bug-history survey, the d6bd925e class by the stream route).
        if (controller.persistKey && controller.pendingWrites === 0 &&
            (source === 'fetch' || source === 'stream' || reconcile)) {
            this._queryPersistSave(controller, nextRows, source === 'fetch');
        }
    },

    /**
     * data-expect declaration parser (dev-only; §4b scope: field presence
     * and primitive type, nothing else). "id:number, name:string, active"
     * → [['id','number'],['name','string'],['active',null]]. A token that
     * is not `field` or `field:string|number|boolean` is ignored with a
     * WF-962 warn — the declaration never grows a vocabulary.
     */
    _parseQueryExpect(spec, name) {
        if (!__DEV__) return null;
        const out = [];
        for (const tok of String(spec).split(',')) {
            const t = tok.trim();
            if (!t) continue;
            const m = t.match(/^([a-zA-Z_$][\w$]*)(?::(string|number|boolean))?$/);
            if (!m) {
                wfError(WF_ERRORS.QUERY_EXPECT_DRIFT, {
                    warn: true,
                    context: `Query "${name}": data-expect token "${t}" is not "field" or "field:string|number|boolean"; token ignored`,
                    suggestion: 'data-expect declares shape only — presence and primitive type. Validation, coercion, and refinement belong in a wrapper around the source'
                });
                continue;
            }
            out.push([m[1], m[2] || null]);
        }
        return out.length > 0 ? out : null;
    },

    /**
     * Shape-drift check at the choke point (dev-only). Missing = the field
     * is absent from a row; drift = present, non-null, wrong primitive
     * typeof. Null is a data condition, not drift. One warn per query per
     * field per kind, forever — polls and streams must not flood the
     * console with the same fact.
     */
    _queryExpectCheck(controller, rows, source) {
        if (!__DEV__) return;
        const warned = controller._expectWarned || (controller._expectWarned = new Set());
        const src = source || 'unknown';
        for (const [field, type] of controller.expect) {
            for (const row of rows) {
                if (row == null || typeof row !== 'object') continue;
                if (!(field in row)) {
                    if (!warned.has(field + ':missing')) {
                        warned.add(field + ':missing');
                        wfError(WF_ERRORS.QUERY_EXPECT_DRIFT, {
                            warn: true,
                            context: `Query "${controller.name}": declared field "${field}" is missing from incoming rows (source: ${src})`,
                            suggestion: `Fix the source's response mapping, or remove "${field}" from data-expect if the source no longer ships it`
                        });
                    }
                    break;
                }
                const v = row[field];
                if (type && v != null && typeof v !== type) {
                    if (!warned.has(field + ':type')) {
                        warned.add(field + ':type');
                        wfError(WF_ERRORS.QUERY_EXPECT_DRIFT, {
                            warn: true,
                            context: `Query "${controller.name}": declared field "${field}" expected ${type}, got ${typeof v} (source: ${src})`,
                            suggestion: src === 'ssr'
                                ? `SSR-adopted cells parse as strings unless the bound element declares data-type="${type}"`
                                : `Align the source field type or update the data-expect declaration`
                        });
                    }
                    break;
                }
            }
        }
    },

    /**
     * WF-963 (§7): a [data-query] element outside any component is a
     * silent no-op — the transform runs during component binding, so
     * nothing ever processes it. Dev-only post-scan sweep, no standing
     * observer. The predicate is structural (presence of a component
     * ATTRIBUTE on an ancestor), so a component whose async init has not
     * finished yet never false-positives.
     */
    _queryOrphanSweep(root) {
        if (!__DEV__) return;
        if (!root || !root.querySelectorAll) return;
        const els = [];
        if (root.matches && root.matches('[data-query],[data-wf-query]')) els.push(root);
        root.querySelectorAll('[data-query],[data-wf-query]').forEach((el) => els.push(el));
        for (const el of els) {
            if (el._wfQueryBound || el._wfQueryOrphanWarned) continue;
            if (el.closest('[data-component],[data-wf-component]')) continue;
            el._wfQueryOrphanWarned = true;
            const name = el.getAttribute('data-query') || el.getAttribute('data-wf-query') || '(unnamed)';
            wfError(WF_ERRORS.QUERY_ORPHAN, {
                warn: true,
                context: `data-query="${name}" has no component ancestor; queries bind during component binding, so this element renders nothing`,
                suggestion: `Wrap it in a component — an empty definition is enough: wildflower.component('shell', {}) + <div data-component="shell">`
            });
        }
    },

    /**
     * First observation activates the query: initial fetch + rung setup.
     * Re-activation after a lifecycle teardown resumes the rungs and issues
     * a conditional catch-up fetch (existing rows show instantly; the
     * network round-trip is a 304 when nothing changed).
     */
    /**
     * Cache persistence, restore half. Runs at ACTIVATION, not registration,
     * so every fresher authority has already had its chance: SSR adoption
     * seeds rows at transform time and `initial:` rows land at store
     * creation — either leaves the store non-empty and restore steps aside.
     * (Registration-time restore would also BLOCK adoption outright, which
     * early-returns when rows exist — disk beating server-rendered HTML.)
     *
     * A valid restore paints the last confirmed server rows, marks the
     * store stale (honest: a cached snapshot pending confirmation), installs
     * the persisted etag, and sets _wasActive so the activation catch-up
     * runs CONDITIONALLY — an unchanged source confirms the restored rows
     * for the price of a 304.
     */
    _queryPersistRestore(controller) {
        if (!controller.persistKey || typeof localStorage === 'undefined') return;
        let env = null;
        try { env = JSON.parse(localStorage.getItem(controller.persistKey)); } catch { return; }
        if (env == null) return;
        // The age gate must hold under a clock that moved backward (negative
        // age) and under crafted numerics (1e999 parses to Infinity; NaN
        // survives typeof checks) — localStorage is same-origin writable, so
        // the envelope is untrusted input. Anything outside [0, MAX] is out.
        const age = typeof env.savedAt === 'number' ? Date.now() - env.savedAt : -1;
        if (env.v !== 1 || !Array.isArray(env.rows) || !(age >= 0 && age <= PERSIST_MAX_AGE_MS)) {
            try { localStorage.removeItem(controller.persistKey); } catch { /* read-only storage */ }
            return;
        }
        const store = this.getStore(controller.name);
        // Yield only to declared seed data (initial: rows, SSR adoption) —
        // an explicit flag, not a rows-length check: an optimistic write()
        // issued before activation also populates rows, and it must not
        // cost the session its cache (the claims machinery carries the
        // optimistic row through the restore's replace).
        if (!store || controller._seeded) return;
        if (env.rows.length === 0) return; // nothing worth painting
        // Shape fingerprint (survey ruling #4): a snapshot whose shaping
        // code has changed can NEVER become valid again — unlike a URL
        // mismatch, where a later visit may still claim the snapshot —
        // so a mismatch removes it outright. An unstamped (pre-upgrade
        // or hand-written) envelope is trusted only when the query
        // declares no `select`: with nothing client-side shaping the
        // rows, there is nothing to have drifted.
        if (env.fp !== undefined
            ? env.fp !== shapeFingerprint(controller)
            : controller.config.select != null) {
            try { localStorage.removeItem(controller.persistKey); } catch { /* read-only storage */ }
            return;
        }
        // URL guard (bug-history survey ruling #1): rows act only for the
        // URL that produced them — the rule the restored VALIDATOR has
        // always followed (etagUrl), extended to the rows themselves.
        // isStale can say "may be out of date"; it cannot say "belongs to
        // a different resource", which is what a params-varying query
        // restoring the previous visit's rows amounts to. A string `from`
        // resolves its read URL now: a match paints, a mismatch withholds
        // (the snapshot stays on disk — a later visit to its URL may
        // still claim it), and an unresolvable token defers the
        // comparison to the first fetch that resolves one (it applies
        // just before that request departs, still ahead of any response).
        // Function sources have no URL identity and restore unguarded.
        if (typeof controller.config.from === 'string') {
            const target = this._queryResolveReadUrl(controller);
            if (target.missing) {
                controller._pendingRestore = env;
                return;
            }
            if (!this._queryRestoreUrlOk(controller, env, target.url)) return;
        }
        this._queryApplyRestore(controller, env);
    },

    /**
     * The read URL the query would fetch right now: declared params
     * resolved and null-stripped, tokens interpolated, consumed params
     * off the query string — the same steps _queryFetch runs, so the
     * persist URL guard compares against the identity a fetch would use.
     * String `from` only. Returns interpolateUrl's shape: { url } or
     * { missing: token }.
     */
    _queryResolveReadUrl(controller) {
        const merged = Object.assign({}, this._queryResolveParams(controller));
        for (const k of Object.keys(merged)) {
            if (merged[k] == null) delete merged[k];
        }
        const built = interpolateUrl(controller.config.from, (t) => merged[t]);
        if (built.missing) return built;
        for (const c of built.consumed) delete merged[c];
        const qs = new URLSearchParams(merged).toString();
        return { url: qs ? built.url + (built.url.indexOf('?') >= 0 ? '&' : '?') + qs : built.url };
    },

    /**
     * May this envelope's rows paint for the URL the query resolves now?
     * A stamped envelope answers by equality. An unstamped one (written
     * before the guard, or by hand) is acceptable only for a query with
     * exactly one possible URL — no path tokens, no params — where every
     * save it ever made necessarily came from that URL.
     */
    _queryRestoreUrlOk(controller, env, resolvedUrl) {
        if (typeof env.url === 'string') return env.url === resolvedUrl;
        const cfg = controller.config;
        return urlTokenNames(cfg.from).length === 0 && cfg.params == null;
    },

    /**
     * The paint half of a restore, once the URL guard has ruled: seed
     * ingest, validator arming, resumed-session flags. Shared by the
     * activation path and the deferred (token-late) path, so the seed
     * yield re-checks here.
     */
    _queryApplyRestore(controller, env) {
        const store = this.getStore(controller.name);
        if (!store || controller._seeded) return;
        // Poison-pill guard: rows that fail the query's own data-expect
        // declaration are rows the application has said it cannot use.
        // Nothing else would remove them, so every load for the rest of the
        // day restored the same unusable snapshot, painted it, and warned
        // again. A rejected shape cannot become valid on its own, so the
        // snapshot is discarded like a fingerprint mismatch and the next
        // load starts clean.
        if (__DEV__ && controller.expect && Array.isArray(env.rows)
            && !expectConforms(controller.expect, env.rows)) {
            try { localStorage.removeItem(controller.persistKey); } catch { /* read-only storage */ }
            return;
        }
        this._queryIngest(controller, env.rows, { seed: true, source: 'persist' });
        // A snapshot stores one validator, for the URL that produced the saved
        // rows. Restore it under that URL when known so the catch-up fetch can
        // still answer 304; a snapshot written before URL keying carries no URL
        // and restores as the last-validator only.
        if (env.etag) {
            controller.etag = env.etag;
            if (env.etagUrl) {
                if (!controller.etags) controller.etags = {};
                controller.etags[env.etagUrl] = env.etag;
                controller.etagUrl = env.etagUrl;
            } else {
                // Snapshot written before URL keying (or by hand): the validator
                // is known to belong to the rows just restored, but not to which
                // URL produced them. Arm the next conditional fetch with it and
                // consume it, so the documented restore-then-304 path still
                // works without letting an unkeyed validator ride later requests.
                controller.etagPending = env.etag;
            }
        }
        controller._persistRestored = true;
        controller._wasActive = true;
        engineWrite(() => { store.isStale = true; });
    },

    /**
     * Cache persistence, save half. Called from the ingest choke point for
     * server-provenance arrivals with no writes pending, and from the 304
     * path (an unchanged confirmation must still refresh savedAt, or a
     * long-lived tab ages its snapshot out of the window while the server
     * keeps vouching for it). Optimistic state NEVER touches disk: patch
     * and un-reconciled write ingests don't call here, and pending writes
     * defer the save to the drain's own reconcile. Quota overflow or an
     * unserializable row drops the save silently (the storage stance
     * everywhere in the framework).
     */
    _queryPersistSave(controller, rawRows, includeEtag) {
        if (!controller.persistKey || typeof localStorage === 'undefined') return;
        // The clearPersisted() suppression window: a clear holds through
        // the transition (see clearPersisted's comment). Suppressed, not
        // deferred — the delivery that lands after the grace saves.
        if (controller._persistClearedUntil && Date.now() < controller._persistClearedUntil) {
            if (__DEV__ && !controller._warnedSaveAfterClear) {
                controller._warnedSaveAfterClear = true;
                wfError(WF_ERRORS.QUERY_SAVE_AFTER_CLEAR, {
                    warn: true,
                    context: `Query "${controller.name}": a delivery landed inside the clearPersisted() window and its save was suppressed; persistence resumes when the transition grace lapses`,
                    suggestion: 'Expected during a logout transition. For full soft-logout safety, navigate, reload, or unbind the query before clearing'
                });
            }
            return;
        }
        // WF-992: name a value JSON cannot round-trip BEFORE it goes to
        // disk quietly wrong (a function `from` over IndexedDB or a local
        // model is the shape that hits this — the rows work all session
        // and come back retyped only after a reload). Once per query, and
        // the save proceeds either way: dropping it would trade a visible
        // warning for invisible data loss.
        // The scan LATCHES on its first look at a non-empty row set, clean or
        // not: row shape comes from one source and does not vary save to save,
        // so re-scanning buys nothing and a streamed query would pay a full
        // traversal per message (measured at ~0.3ms per save at 1k rows, on
        // par with the stringify itself — ruling #7's measurement). Empty rows
        // leave it unlatched, since nothing was examined.
        if (__DEV__ && !controller._warnedPersistShape && rawRows && rawRows.length > 0) {
            const bad = findNonRoundTrippable(rawRows, 'rows', 0, new Set());
            controller._warnedPersistShape = true;
            if (bad) {
                wfError(WF_ERRORS.QUERY_PERSIST_SHAPE, {
                    warn: true,
                    context: `Query "${controller.name}": ${bad.path} is a ${bad.kind}, which JSON cannot round-trip — it restores as ${bad.kind === 'Date' ? 'a plain string' : 'an empty object'} after a reload`,
                    suggestion: 'Shape rows to plain JSON in from: or select: (timestamps as numbers or ISO strings, arrays instead of Maps/Sets), or drop persist: for this query'
                });
            }
        }
        try {
            localStorage.setItem(controller.persistKey, JSON.stringify({
                v: 1,
                rows: rawRows || [],
                // A reconcile-sourced save carries NO etag: the held etag
                // describes the last FETCH's content, and the write just
                // changed the rows past it. Persisting the pair would let a
                // later 304 (server reverted to byte-identical pre-write
                // content) wrongly confirm the post-write rows. Rows the
                // fetch/stream path saved match their etag by construction.
                etag: includeEtag ? (controller.etag || null) : null,
                etagUrl: includeEtag ? (controller.etagUrl || null) : null,
                // The resolved URL these rows answer for (the URL guard on
                // restore). lastUrl is set before the apply on the fetch
                // path, so a URL-changing fetch stamps its own URL, not the
                // previous one. Function sources never set it and restore
                // unguarded; stream and write-drain saves describe rows in
                // the last fetched URL's scope, which lastUrl is.
                url: controller.lastUrl || null,
                fp: shapeFingerprint(controller),
                savedAt: Date.now()
            }));
        } catch (e) {
            // Quota or an unserializable row: the save is dropped, and the
            // OLD snapshot goes with it — the engine can no longer vouch
            // that disk matches the last confirmed truth, and a stale
            // restore tomorrow would misrepresent this session. Cold start
            // revalidates identically.
            //
            // WF-994 names the drop once (survey pass two, TanStack #1701's
            // class): the stance is right, but silent it reads as
            // "persistence works" while nothing persists for the session.
            // The behavior is unchanged — warn, then drop and remove.
            if (__DEV__ && !controller._warnedPersistDrop) {
                controller._warnedPersistDrop = true;
                wfError(WF_ERRORS.QUERY_PERSIST_SAVE_FAILED, {
                    warn: true,
                    context: `Query "${controller.name}": the persist save threw (${e && e.message ? e.message : e}); the save was dropped and the stored snapshot removed — nothing persists for this query until a save succeeds`,
                    suggestion: 'Storage quota: persist fewer or smaller queries (rows serialize in full). Serialization: a row carries a value JSON.stringify cannot encode. Either way the next reload simply starts cold'
                });
            }
            try { localStorage.removeItem(controller.persistKey); } catch { /* read-only storage */ }
        }
    },

    _queryActivate(controller) {
        if (controller.active) return;
        this._queryPersistRestore(controller);
        const resumed = controller._wasActive === true;
        controller.active = true;
        controller.unobservedSince = null;
        controller._wasActive = true;
        // The catch-up fetch, unless a read is already running: an app that
        // sets its route and calls refresh() before the section mounts would
        // otherwise see that request aborted and re-issued here.
        if (controller.inflightRun == null) {
            this._queryFetch(controller, { conditional: resumed });
        }
        const r = controller.rungs;
        const guarded = () => {
            if (this._queryLifecycleCheck(controller)) {
                this._queryFetch(controller, { conditional: true });
            }
        };
        // Event rungs honor the freshness window: a focus flick seconds
        // after a sync should not refetch. Staleness overrides the window
        // (doubt wins), and the gate never sees poll ticks or explicit
        // refresh()/invalidate() calls.
        const eventGuarded = () => {
            if (r.freshSecs > 0) {
                const s = this.getStore(controller.name);
                // The age must be a real elapsed span. A device clock that
                // moved BACKWARD after a sync makes this negative, which is
                // less than any window and would suppress every fire until
                // real time caught up. A negative age says the clock moved,
                // not that the data is fresh, so the window stops applying
                // (the persist restore gate refuses a negative age for the
                // same reason).
                const age = s ? Date.now() - s.lastSync : -1;
                if (s && !s.isStale && s.lastSync !== null &&
                    age >= 0 && age < r.freshSecs * 1000) return;
            }
            guarded();
        };
        if (r.focus) {
            window.addEventListener('focus', eventGuarded);
            controller._listeners.push(['focus', eventGuarded]);
        }
        if (r.reconnect) {
            window.addEventListener('online', eventGuarded);
            controller._listeners.push(['online', eventGuarded]);
        }
        const pollSecs = r.pollSecs || r.etagSecs;
        if (pollSecs > 0) {
            controller.timerId = setInterval(guarded, pollSecs * 1000);
        }
        if (r.sse) {
            this._querySyncStream(controller);
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
     * Resolve the stream endpoint's :tokens exactly as a read resolves
     * from's. Endpoint = config.stream, falling back to a
     * string `from` (the design ruling keeps the shorthand but allows an
     * explicit stream URL; same-URL overloading is fragile through real
     * proxies). Returns null when there is no URL at all, else
     * interpolateUrl's shape: { url } or { missing: token }. Params
     * null-strip before token lookup, matching the read path.
     */
    _queryResolveStreamUrl(controller, params) {
        const cfg = controller.config;
        const raw = typeof cfg.stream === 'string'
            ? cfg.stream
            : (typeof cfg.from === 'string' ? cfg.from : null);
        if (!raw) return null;
        const map = Object.assign({}, params !== undefined && params !== null
            ? params
            : this._queryResolveParams(controller));
        for (const k of Object.keys(map)) {
            if (map[k] == null) delete map[k];
        }
        return interpolateUrl(raw, (t) => map[t]);
    },

    /**
     * Single owner of the stream connection's URL lifecycle:
     * the stream FOLLOWS THE READS. Every fetch re-resolves params, so
     * this runs beside each fetch (and at activation) and compares the
     * freshly resolved stream URL against the connected one — opening
     * when a token lands, swapping when params moved the resolved URL,
     * and never touching a healthy connection. A swap needs no catch-up
     * fetch of its own: the fetch that carried the new params IS the
     * catch-up. While a token is unresolved the rung WAITS, the same
     * not-ready contract reads have (the old behavior handed the LITERAL
     * URL — ':pid' in the path — to EventSource, which then retried it
     * forever and recorded nothing, since onerror only writes syncError
     * after a first sync).
     */
    _querySyncStream(controller, params) {
        if (typeof EventSource !== 'function') return;
        const built = this._queryResolveStreamUrl(controller, params);
        if (built === null) {
            if (__DEV__ && !controller.es) wfError(WF_ERRORS.QUERY_SSE_NO_URL, {
                warn: true,
                context: `Query "${controller.name}": the 'sse' rung needs a stream URL; rung skipped`,
                suggestion: 'Add a `stream:` option when `from` is a function'
            });
            return;
        }
        if (built.missing) {
            // Not ready. Named once per token via the same set the read
            // gate uses — an unresolved token is one fact, however many
            // surfaces wait on it. An open stream stays on its last good
            // URL rather than closing on a transiently unresolvable one.
            if (__DEV__) {
                if (!controller._notReadyNamed) controller._notReadyNamed = new Set();
                if (!controller._notReadyNamed.has(built.missing)) {
                    controller._notReadyNamed.add(built.missing);
                    wfError(WF_ERRORS.QUERY_URL_TOKEN_UNRESOLVED, {
                        warn: true,
                        context: `Query "${controller.name}": waiting for ":${built.missing}" in the stream URL; the sse rung connects when params supply it`,
                        suggestion: 'Normal while a route parameter is still resolving. If the token name is a typo, the stream never connects at all'
                    });
                }
            }
            return;
        }
        if (controller.es) {
            // A CLOSED stream never comes back on its own: the platform
            // FAILS the connection permanently on an HTTP error status
            // (401/404/wrong content-type — readyState 2, no
            // auto-reconnect), while network drops keep reconnecting.
            // Without this check the dead object stayed installed and no
            // later fetch ever reopened the stream (bug-history survey,
            // Lane C #13). The fetch that found it dead IS the catch-up,
            // matching the swap rule above.
            if (controller.streamUrl === built.url && controller.es.readyState !== 2) return;
            controller.es.close();
            controller.es = null;
        }
        this._queryOpenStream(controller, built.url);
    },

    /**
     * Connect the sse rung to an already-RESOLVED URL (only
     * _querySyncStream calls this). Event contract: a message with a JSON
     * body IS the new payload and applies directly (server pushes
     * results); an empty message is an invalidation signal → conditional
     * refetch. Stream errors with data present are transient (syncError +
     * isStale, rows preserved; EventSource auto-reconnects); a reopen
     * after error clears them and catches up conditionally.
     */
    _queryOpenStream(controller, streamUrl) {
        const es = new EventSource(streamUrl);
        controller.es = es;
        controller.streamUrl = streamUrl;
        if (__DEV__ && !controller._warnedStreamHeaders) {
            // Platform constraint, named once (review finding / triage):
            // EventSource carries no headers — its constructor accepts only
            // withCredentials — so a query's declared headers authenticate
            // reads and writes while the stream connects anonymously, and a
            // 401'd stream on a never-synced query is otherwise recorded
            // nowhere.
            const h = this._queryHeaders(controller, streamUrl);
            if (h && Object.keys(h).length > 0) {
                controller._warnedStreamHeaders = true;
                wfError(WF_ERRORS.QUERY_STREAM_HEADERS, {
                    warn: true,
                    context: `Query "${controller.name}": declared headers cannot apply to the sse stream (EventSource carries no headers); the stream connects without them`,
                    suggestion: 'Authenticate the stream another way, e.g. a token in the stream URL query string, or cookie auth'
                });
            }
        }
        const store = () => this.getStore(controller.name);
        let hadError = false;
        let staleBeforeError = false;
        es.onmessage = (ev) => {
            // One real message proves the endpoint speaks SSE: the WF-989
            // dead-endpoint pattern below is permanently disqualified.
            if (__DEV__) controller._streamGotMessage = true;
            if (!this._queryLifecycleCheck(controller)) return;
            const body = ev && ev.data;
            if (body) {
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch (e) {
                    if (__DEV__ && warnOnce(controller, WF_ERRORS.QUERY_SSE_NON_JSON)) wfError(WF_ERRORS.QUERY_SSE_NON_JSON, {
                        warn: true,
                        context: `Query "${controller.name}": SSE message was not valid JSON; treating it as an invalidation signal (warned once; later non-JSON messages invalidate silently)`
                    });
                    this._queryFetch(controller, { conditional: true });
                    return;
                }
                // Stream data is the newest truth: supersede any in-flight
                // fetch, then apply through the store (single flush).
                controller.runId++;
                if (controller.abort) { controller.abort.abort(); controller.abort = null; controller.inflightRun = null; }
                const s = store();
                if (!s) return;
                // select: turns a read response into rows on EVERY read
                // delivery, stream included (review finding / triage). Before
                // this call the fetch path was the only caller, so a shared
                // envelope ingested raw on every push — the list replaced by
                // one row whose fields were the envelope's — and WF-980,
                // which lives inside _querySelect, could not fire here.
                parsed = this._querySelect(controller, parsed);
                if (__DEV__ && controller.hasRecord && parsed == null
                    && warnOnce(controller, WF_ERRORS.QUERY_NULL_RECORD)) {
                    wfError(WF_ERRORS.QUERY_NULL_RECORD, {
                    warn: true,
                    context: `Query "${controller.name}": record query resolved null/undefined; bound fields will render empty (valid empty context)`
                });
                }
                // Stream data is a GENTLE arrival: through the choke point,
                // so it merges over an accumulated store (live feeds keep
                // the user's place) and honors tombstones. Same flags-first
                // rows-last ordering, owned by the choke point.
                this._queryIngest(controller, parsed, { gentle: true, source: 'stream' });
            } else {
                this._queryFetch(controller, { conditional: true });
            }
        };
        es.onerror = () => {
            // First error of an outage: remember whether doubt PREDATED it.
            // The handler below stamps isStale, and the reopen gate must
            // not read that self-inflicted doubt as "stale store, window
            // overridden" — that would make the fresh:N gate unreachable
            // on exactly the path it was extended to cover.
            if (!hadError) {
                const s0 = store();
                staleBeforeError = !!(s0 && s0.isStale);
            }
            hadError = true;
            // WF-989 (survey pass two, Lane F #6 — the #1 SSE first-contact
            // failure): the sse rung on a JSON endpoint. `stream:` absent
            // defaults the stream URL to a string `from`, and an ordinary
            // JSON API then FAILS every connection permanently (wrong
            // Content-Type or an HTTP error status — the HTML spec's "fail
            // the connection": readyState CLOSED, no auto-reconnect;
            // network drops reconnect and never land here). The engine
            // cannot read the MIME type, but the pattern is readable:
            // repeated permanent closes, zero messages ever, stream URL
            // identical to `from`. One dead cycle could be a flaky proxy;
            // the second is the pattern — the count lives on the
            // CONTROLLER because the readyState-2 revival above reopens a
            // dead stream beside each fetch, and the evidence must survive
            // those cycles. R15 warnOnce: a wrong endpoint is a standing
            // condition.
            if (__DEV__ && es.readyState === 2 && !controller._streamGotMessage) {
                controller._streamDeadCount = (controller._streamDeadCount || 0) + 1;
                const scfg = controller.config;
                if (controller._streamDeadCount >= 2
                    && typeof scfg.from === 'string'
                    && (typeof scfg.stream !== 'string' || scfg.stream === scfg.from)
                    && warnOnce(controller, WF_ERRORS.QUERY_SSE_JSON_ENDPOINT)) {
                    wfError(WF_ERRORS.QUERY_SSE_JSON_ENDPOINT, {
                        warn: true,
                        context: `Query "${controller.name}": the sse stream at "${streamUrl}" has been permanently refused ${controller._streamDeadCount} times without ever delivering a message — and it is the URL the reads use, which answers JSON. EventSource requires Content-Type: text/event-stream, so the browser aborts every connection`,
                        suggestion: "Point stream: at a real SSE endpoint (the sse rung defaults its URL to from:), or drop 'sse' from refresh: if the source does not push events"
                    });
                }
            }
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
            // The reopen catch-up honors the declared freshness window
            // (survey ruling #6, ruled 2026-08-29: reuse the fresh:N
            // gate). A flapping stream — a proxy recycling idle
            // connections, a fleet reconnecting after an outage — fires
            // one conditional catch-up per reopen per client,
            // synchronized, with no backoff (contrast the read ladder);
            // the declared window is the author's statement of acceptable
            // doubt, and it damps exactly that shape. Stream messages
            // stamp lastSync, so a healthy recycled stream suppresses
            // redundant catch-ups while a quiet one ages out of the
            // window and fetches. One deliberate difference from the
            // event rungs' gate: staleness here is read from BEFORE the
            // outage (captured at its first error), because the error
            // handler itself stamps isStale and honoring self-inflicted
            // doubt would make the window unreachable on this path.
            // Pre-outage doubt (a pending patch) still overrides — the
            // focus rung's rule. No token = 0 = every reopen catches up.
            const freshSecs = controller.rungs.freshSecs;
            const age = s ? Date.now() - s.lastSync : -1;   // negative = clock moved, not fresh
            if (freshSecs > 0 && !staleBeforeError && s && s.lastSync !== null &&
                age >= 0 && age < freshSecs * 1000) {
                return;
            }
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
            controller.streamUrl = null;
        }
        for (const [type, fn] of controller._listeners) {
            window.removeEventListener(type, fn);
        }
        controller._listeners.length = 0;
        if (controller.abort) {
            controller.abort.abort();
            controller.abort = null;
        }
        // Nothing is in flight after the abort, and the aborted run's own
        // settle clears the marker only after its rejection propagates; a
        // re-observation in between must still get its catch-up fetch.
        controller.inflightRun = null;
        this._queryRetryCancel(controller);
        controller.retryAttempt = 0;
        controller.active = false;
        controller.unobservedSince = null;
    },

    /**
     * §2 retry ladder: a failed fetch re-runs on a fixed doubling curve
     * (base 1s, cap 30s). While the ladder runs neither error nor
     * syncError is written and rows are never wiped; the failure state
     * lands only on exhaustion. Offline SUSPENDS the ladder — the pending
     * attempt is not burned; a one-shot 'online' listener (independent of
     * the opt-in reconnect rung) resumes it.
     */
    _queryRetrySchedule(controller, fetchArgs) {
        const wf = this;
        const fire = () => {
            controller.retryTimerId = null;
            wf._queryFetch(controller, fetchArgs);
        };
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            const resume = () => {
                window.removeEventListener('online', resume);
                controller._retryOnline = null;
                fire();
            };
            controller._retryOnline = resume;
            window.addEventListener('online', resume);
            return;
        }
        controller.retryAttempt++;
        const base = this._queryRetryBaseMs || 1000;
        const delay = Math.min(30000, base * Math.pow(2, controller.retryAttempt - 1));
        controller.retryTimerId = setTimeout(fire, delay);
    },

    _queryRetryCancel(controller) {
        if (controller.retryTimerId !== null) {
            clearTimeout(controller.retryTimerId);
            controller.retryTimerId = null;
        }
        if (controller._retryOnline) {
            window.removeEventListener('online', controller._retryOnline);
            controller._retryOnline = null;
        }
    },

    /**
     * The fetch discipline: engine-owned race correctness (DESIGN.md Q5) via
     * last-call-wins, AbortController on supersede, previous rows preserved
     * with isStale during transitions, hard/transient error split.
     */
    /**
     * refresh({ clear: true }): the rows on screen belong to a different list
     * than the one about to load, so drop them first. The query is back to
     * "no data": the fetch raises isLoading, or the result cache paints the
     * target URL as stale. Validators, the persisted snapshot, and the cache
     * stay; appended pages go. Writes still pending on cleared rows settle
     * without re-appending them (the settle arms check _clearedWrites).
     * @private
     */
    _queryClear(controller, store) {
        engineWrite(() => {
            store.rows = [];
            store.error = null;
            store.syncError = null;
            store.isStale = false;
            store.lastSync = null;
        });
        controller.accumulated = false;
        controller.lastUrl = null;
        controller.snapUrl = null;
        controller.snapAt = 0;
        controller.deferredConfirm = false;
        controller.missedArrival = false;
        // Exactly the writes in flight right now; anything older has settled.
        const cleared = new Set();
        for (const wid of controller.inflightWrites.keys()) cleared.add(wid);
        controller._clearedWrites = cleared.size > 0 ? cleared : null;
    },

    _queryFetch(controller, { params, conditional, append, _retry, clear } = {}) {
        const wf = this;
        const store = this.getStore(controller.name);
        if (!store) return Promise.resolve();
        // A fresh call (refresh, invalidate, rung tick) is a new episode:
        // any pending retry is cancelled and the ladder resets. A ladder-
        // fired call (_retry) continues the current episode.
        if (!_retry) {
            this._queryRetryCancel(controller);
            controller.retryAttempt = 0;
            if (clear) this._queryClear(controller, store);
        }
        const cfg = controller.config;
        // Resolve declared params ONCE per run, before fetchArgs is captured.
        // `params:` may be a function so a query can state what it fetches
        // rather than having the app push values per call: only refresh()
        // carried params, so every internal refetch (invalidate after a write
        // settles, a rung tick, a resume, a missed-arrival catch-up) fell back
        // to the static config and could re-request a different page than the
        // one on screen, then reconcile it as truth. Resolving here means the
        // captured fetchArgs the retry ladder re-issues are the values that
        // failed, not whatever the app's state says at retry time.
        const declared = this._queryResolveParams(controller);
        if (__DEV__) {
            // Reversion watch (review finding. replacing the request-time check).
            // An imperative refresh({ params }) wins for exactly one fetch
            // before the declaration reasserts. Correct under the stated
            // precedence, and it reads as a value spontaneously reverting:
            // the list snaps to a page nobody on screen asked for. The old
            // check fired at the refresh() call, only for function-form
            // params, and only when the key existed on both sides with
            // differing values — silent for the likelier shapes (static
            // object, absent key, no declaration: the shapes the docs
            // teach) and noisy on legitimate one-offs against queries that
            // never refetch on their own. Warning at the REVERSION is
            // precise by construction: it fires only when an
            // ENGINE-initiated refetch (conditional — every rung tick,
            // invalidation, catch-up; refresh() passes conditional: false)
            // actually drops or contradicts the stored override, at the
            // moment the on-screen data reverts, and a query with no
            // internal refetches can never reach it. The override is
            // checked exactly once, at the FIRST engine refetch after it:
            // preserved values clear it silently (the declaration derives
            // them — the documented fix), dropped values warn and clear.
            // Any explicit refresh() replaces or clears the stored intent
            // (a plain refresh() is a deliberate reset), and append-mode
            // overrides never arm the watch — in accumulate mode a
            // base-page refetch is the design, not a reversion.
            if (!conditional) {
                controller._paramsOverride = (params && typeof params === 'object' && !append) ? params : null;
            } else if (controller._paramsOverride != null && !params) {
                const over = controller._paramsOverride;
                controller._paramsOverride = null;
                const dropped = [];
                for (const pk of Object.keys(over)) {
                    if (over[pk] == null) continue;
                    const now = declared ? declared[pk] : undefined;
                    if (now == null || String(now) !== String(over[pk])) dropped.push(pk);
                }
                if (dropped.length > 0) {
                    const pk0 = dropped[0];
                    wfError(WF_ERRORS.QUERY_PARAMS_MIXED, {
                        warn: true,
                        context: `Query "${controller.name}": an engine refetch (a rung tick or invalidation) dropped ${dropped.map((k) => `${k}: ${JSON.stringify(over[k])}`).join(', ')} from the last refresh({ params }) — the override applied to that one fetch only, and this request reverted to the declaration's values`,
                        suggestion: `A value that should persist belongs where params derives it (state a params function reads, e.g. a store field for ${pk0}); keep refresh({ params }) for genuinely one-off requests`
                    });
                }
            }
        }
        const resolvedParams = (declared || params)
            ? Object.assign({}, declared, params)
            : undefined;

        // READINESS GATE, ahead of everything that has an effect.
        //
        // A route-driven query is declared before its route parameter exists,
        // so its first activation fetch can arrive early. A read that cannot
        // resolve its path has not failed; it has not been asked for yet. So
        // it sends nothing, raises nothing, bumps no runId, and aborts no
        // fetch already in flight; it fetches when the value lands.
        //
        // The one flag it moves is isLoading, and only for a query that has
        // never had data. Leaving that false would present rows: [] with no
        // error as a completed empty result, which is a claim about the server
        // that nothing has established. isLoading means "no usable data yet",
        // which is exactly true while waiting, so a bound spinner keeps showing
        // instead of flipping to an empty state and back.
        //
        // Writes are the asymmetric case and keep the hard error: a read fires
        // on the framework's schedule and may simply be early, while a write
        // happens because the application called it, so a missing token there
        // is a bug in the call rather than a matter of timing.
        let merged = null;
        let built = null;
        if (typeof cfg.from === 'string') {
            merged = Object.assign({}, resolvedParams);
            for (const k of Object.keys(merged)) {
                if (merged[k] == null) delete merged[k]; // never serialize "undefined"/"null"
            }
            // Tokens read the merged map AFTER the null-strip, so a token whose
            // param resolved to null behaves exactly like one that was absent,
            // rather than interpolating the string "null" into a path.
            built = interpolateUrl(cfg.from, (t) => merged[t]);
            if (built.missing) {
                if (__DEV__) {
                    // Named once per token, and never again. Waiting is a normal
                    // state, so repeating it on every rung tick would be noise;
                    // saying it once is what separates "the router has not got
                    // there yet" from a token that is simply misspelled and will
                    // therefore never fetch at all.
                    if (!controller._notReadyNamed) controller._notReadyNamed = new Set();
                    if (!controller._notReadyNamed.has(built.missing)) {
                        controller._notReadyNamed.add(built.missing);
                        wfError(WF_ERRORS.QUERY_URL_TOKEN_UNRESOLVED, {
                            warn: true,
                            context: `Query "${controller.name}": waiting for ":${built.missing}" in from: "${cfg.from}"; no request sent, and none will be until params supply it`,
                            suggestion: 'Normal while a route parameter is still resolving. If the token name is a typo, this query never fetches at all'
                        });
                    }
                }
                if (store.lastSync === null && !(store.rows && store.rows.length > 0)) {
                    engineWrite(() => { store.isLoading = true; });
                }
                return Promise.resolve();
            }
            for (const c of built.consumed) delete merged[c];
        }

        // The stream follows the reads: this fetch's resolved
        // params are the freshest URL truth, so the sse rung opens or
        // follows here, before the request departs. Idempotent — an
        // unchanged resolved URL touches nothing.
        if (controller.rungs.sse && controller.active) {
            this._querySyncStream(controller, resolvedParams);
        }

        const fetchArgs = { params: resolvedParams, conditional, append, _retry: true };
        const id = ++controller.runId;
        if (controller.abort) controller.abort.abort();
        // In-flight marker for activation: a superseded run must not clear
        // it, so each run clears only its own id. (controller.abort is not
        // cleared on a normal settle, so it cannot serve as this test.)
        controller.inflightRun = id;
        const settled = () => { if (controller.inflightRun === id) controller.inflightRun = null; };

        // Seeded rows (initial: config, SSR adoption) count as usable data:
        // the catch-up fetch is a stale refresh, never a "loading" state
        // that would flash skeletons over content the user can see.
        const hadData = store.lastSync !== null || (store.rows && store.rows.length > 0);
        engineWrite(() => {
            if (!hadData) store.isLoading = true;
            else store.isStale = true;
        });

        const applyRows = (data) => {
            if (id !== controller.runId) {
                // Superseded: last call wins. The dropped payload held
                // server truth; remember the miss so a write drain can
                // catch up (a newer fetch or stream delivery clears it).
                controller.missedArrival = true;
                return;
            }
            controller.retryAttempt = 0;         // any success resets the ladder
            if (__DEV__ && controller.hasRecord && data == null
                && warnOnce(controller, WF_ERRORS.QUERY_NULL_RECORD)) {
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
            wf._queryIngest(controller, data, { append: !!append, gentle: !!conditional, source: 'fetch' });
        };
        const applyError = (err) => {
            if (id !== controller.runId) return;
            if (err && err.name === 'AbortError') return; // supersession is not failure; no retry
            // The ladder exists for TRANSIENT failures (survey probe #5a):
            // a 4xx is the server answering deterministically, and
            // re-asking on the doubling curve only delays the honest
            // terminal state. Three 4xx codes are transient by meaning
            // and stay retryable: 401 (headers resolve per attempt
            // precisely so a refreshed credential rides the retry — the
            // pinned ladder-with-current-credential design), 408 (request
            // timeout), and 429 (too many requests). Network errors carry
            // no status and keep retrying.
            const s = err && err.status;
            const permanent = s >= 400 && s < 500 && s !== 401 && s !== 408 && s !== 429;
            if (!permanent && controller.retryMax > 0 && controller.retryAttempt < controller.retryMax) {
                // Ladder still has rungs: hold the failure state (isLoading/
                // isStale stay as the fetch left them, rows untouched) and
                // schedule the next attempt.
                wf._queryRetrySchedule(controller, fetchArgs);
                return;
            }
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
                return Promise.resolve(cfg.from()).then(applyRows, applyError).finally(settled);
            } catch (e) {
                applyError(e);
                settled();
                return Promise.resolve();
            }
        }

        // merged and built were resolved by the readiness gate above, before
        // anything took effect. A token the path consumed has already left the
        // query-string merge, so one query's read and write URLs can
        // legitimately consume different subsets of the same params.
        const ac = new AbortController();
        controller.abort = ac;
        const qs = new URLSearchParams(merged).toString();
        const base = built.url;
        const url = qs ? base + (base.indexOf('?') >= 0 ? '&' : '?') + qs : base;
        // A restore deferred by an unresolvable token (URL guard): the
        // first fetch to resolve a URL settles the comparison — a match
        // paints here, before the request departs (ahead of any
        // response), and its armed validator can ride this request's
        // conditional headers below; a mismatch discards the claim. Age
        // re-checked: the token may land long after activation validated
        // the envelope.
        if (controller._pendingRestore) {
            const env = controller._pendingRestore;
            controller._pendingRestore = null;
            if (Date.now() - env.savedAt <= PERSIST_MAX_AGE_MS
                && this._queryRestoreUrlOk(controller, env, url)) {
                this._queryApplyRestore(controller, env);
            }
        }
        // Declared headers first; the engine's own protocol header below wins
        // over an application header of the same name. The count is taken
        // BEFORE the engine adds its own (If-None-Match below): WF-986 is
        // about the author's credentials, and a validator riding a redirect
        // is harmless.
        const headers = this._queryHeaders(controller, url);
        const declaredHeaderCount = Object.keys(headers).length;
        // The validator belongs to the URL it was issued for. A single unkeyed
        // field sent page 1's ETag with page 2's request; a param-varying query
        // makes that the normal case rather than the exception. Keyed by the
        // fully resolved URL, which is the identity of the thing the validator
        // refers to (and stays correct once params can be consumed into a path).
        if (conditional) {
            const keyedEtag = controller.etags && controller.etags[url];
            if (keyedEtag) {
                headers['If-None-Match'] = keyedEtag;
            } else if (controller.etagPending) {
                headers['If-None-Match'] = controller.etagPending;
                controller.etagPending = null;   // consumed
            }
        }

        // Result cache: a URL fetched before repaints from memory while its
        // revalidation is in flight, so returning to a page already seen shows
        // content immediately instead of waiting out a round trip. Invisible by
        // design: no option, no key to manage, and the same $name.rows binding
        // simply repopulates. The rows are marked isStale, exactly as a
        // restored persist snapshot is, because they are a cached answer
        // awaiting confirmation rather than a fresh one.
        //
        // Skipped wherever a repaint could misrepresent state: an accumulating
        // query's rows span several URLs so no single snapshot describes them,
        // an unsettled write owns fields no snapshot knows about, and the URL
        // already on screen would only be a wasted list render.
        if (!append && !controller.accumulated && controller.pendingWrites === 0
            && url !== controller.lastUrl && controller.snapshots) {
            const snap = controller.snapshots.get(url);
            if (snap) {
                wf._queryIngest(controller, snap, { seed: true, source: 'cache' });
                // Rows are on screen now: stale until the response confirms
                // them, and no longer "loading" (a refresh({ clear: true })
                // whose target is cached lands here with isLoading raised).
                engineWrite(() => { store.isStale = true; store.isLoading = false; });
            }
        }

        return fetch(url, { signal: ac.signal, headers })
            .then((resp) => {
                // Before the supersession guard: a dropped response still
                // made the request, and the ride-along already happened.
                if (__DEV__) this._queryWarnRedirect(controller, url, resp, declaredHeaderCount);
                if (id !== controller.runId) {
                    controller.missedArrival = true; // response in hand, dropped
                    return;
                }
                if (resp.status === 304) {
                    controller.retryAttempt = 0; // a 304 is a successful sync
                    controller.missedArrival = false; // server-confirmed current
                    if (controller.pendingWrites > 0) {
                        // Same deferral as a full sync: "nothing changed"
                        // cannot report fresh over pending optimistic state.
                        // And the same flag hygiene as that twin:
                        // the load is answered even though the confirm is
                        // held, so a spinner armed by this fetch must drop.
                        engineWrite(() => {
                            store.isLoading = false;
                            store.error = null;
                        });
                        // A 304 carries no body, so it cannot un-taint rows
                        // an earlier held arrival moved: keep the standing
                        // source, and record 'fetch' only when this is the
                        // first deferral (rows untouched since the last
                        // confirmed state the validator vouches for).
                        controller.deferredConfirm = controller.deferredConfirm || 'fetch';
                        return;
                    }
                    controller.deferredConfirm = false;
                    engineWrite(() => {
                        // isLoading: a 304 is a completed load. Only the
                        // ingest cleared this flag before, so a
                        // 304 landing before any successful sync — a
                        // misbehaving server, or a validator stored while a
                        // write superseded the first load — left isLoading
                        // true forever: lastSync gets stamped below, so no
                        // later fetch would ever re-arm OR clear it.
                        store.isLoading = false;
                        store.isStale = false;
                        store.error = null;
                        store.syncError = null;
                        store.lastSync = Date.now();
                    });
                    // An unchanged answer still moves the rows on screen to
                    // this URL, so the cache has to learn that or the next
                    // visit repaints a snapshot over identical rows. First,
                    // so lastUrl is current when the persist save below
                    // stamps its URL guard.
                    wf._querySnapshotSave(controller, url, id);
                    // An unchanged confirmation still refreshes savedAt, or a
                    // tab that only ever 304s ages its snapshot out of the
                    // 24h window while the server keeps vouching for it.
                    if (controller.persistKey) {
                        wf._queryPersistSave(controller, rgToRaw(store.rows) || [], true);
                    }
                    return;
                }
                if (!resp.ok) {
                    // The status rides the error (no body read — a read
                    // failure lands in error/syncError as a string, and
                    // only the retry gate below consumes the number).
                    const e = new Error('HTTP ' + resp.status);
                    e.status = resp.status;
                    throw e;
                }
                const et = resp.headers && resp.headers.get && resp.headers.get('ETag');
                return resp.json().then((data) => {
                    // Stored once the body PARSED, and before it is applied.
                    //
                    // After the parse, because a validator vouches for content.
                    // Storing it beside the header read left it vouching for a
                    // response nothing applied: a 200 carrying an HTML error
                    // page rejects in resp.json() while rows keep their previous
                    // values, and the validator for that unusable body stayed
                    // behind. The next conditional request sends it, the server
                    // answers 304, the query marks itself fresh over stale rows,
                    // and with persist on it writes them to disk as confirmed
                    // truth, where they survive a reload.
                    //
                    // Before the apply, because the persist save runs inside the
                    // ingest and reads controller.etag as it goes. Moving the
                    // store after applyRows makes every snapshot carry a null
                    // validator and breaks the documented restore-then-304 path;
                    // query-persist.test.js catches exactly that.
                    //
                    // Store against the URL that produced it (see the read
                    // site). controller.etag is kept in step as the "last
                    // validator", which is what persistence saves and restores.
                    if (et) {
                        if (!controller.etags) controller.etags = {};
                        controller.etags[url] = et;
                        controller.etag = et;
                        controller.etagUrl = url;
                    }
                    // The persist save runs INSIDE the ingest below and
                    // stamps the envelope from lastUrl — set it before the
                    // apply, or a URL-changing fetch's save records the
                    // PREVIOUS URL on exactly the rows that left it. (The
                    // superseded-run early return above guarantees this is
                    // the current run.)
                    controller.lastUrl = url;
                    applyRows(wf._querySelect(controller, data));
                    wf._querySnapshotSave(controller, url, id);
                });
            })
            .catch(applyError)
            .finally(settled);
    },

    /**
     * The write discipline (v1.5 declarative writes): `to` supplies the
     * transport exactly as `from` does for reads; the controller owns the
     * lifecycle. Optimistic apply rides the merging patch path and bumps
     * runId — a write supersedes any in-flight refetch (the read's
     * applyRows guard drops the late arrival), so a slow GET can never
     * clobber optimistic state. Reconciliation is decided by what `to`
     * resolves with: a record applies with REPLACE semantics (server
     * truth; the internal reconcile flavor), correcting a changed key
     * (tmp-id -> real id) by removing the optimistic row first; nothing
     * invalidates, so the next sync fetches the truth. Rejection rolls
     * back field-by-field — each write reverts only fields it still owns
     * (a later write's claim wins), sets syncError (transient arm: rows
     * preserved; `error` stays reserved for failed first loads), never
     * touches the read retry ladder (POST is not idempotent; an explicit
     * second write() is the retry), and rejects the returned promise so
     * try/catch works. Every failure path degrades safely: the next
     * confirming sync overwrites whatever local state exists.
     */
    _queryWrite(controller, opName, item) {
        const cfg = controller.config;
        const ops = controller.ops;
        const key = controller.key;
        if (!ops && !controller.toFn) {
            // No write side at all. REJECTS, like every other write()
            // failure: the API is promise-shaped, so "failures
            // reject" is the one contract callers can code against without
            // memorizing which mistake throws and which rejects — a .catch
            // or an awaited try/catch sees every failure mode, this
            // programming error included. The dev diagnostic still lands
            // synchronously at the call site. (An operation the query does
            // not declare is a different, narrower failure — WF-974 below.)
            const def = WF_ERRORS.QUERY_TO_INVALID;
            if (__DEV__) wfError(WF_ERRORS.QUERY_TO_INVALID, {
                context: `Query "${controller.name}": write() was called, but the query declares no \`to\` and no operations`,
                suggestion: "Declare the write side: to: '/api/items/:id' (or an operation map, or a function)"
            });
            return Promise.reject(new Error('[' + def.code + '] ' + (def.message ||
                ('https://www.wildflowerjs.com/docs/error-codes?code=' + def.code))));
        }
        // Resolve the operation BEFORE anything optimistic happens: an
        // undeclared destination must send nothing and touch no rows.
        if (opName == null) {
            opName = (controller.deletedField && item && item[controller.deletedField])
                ? 'delete' : 'update';
        } else if (controller.toFn && opName !== 'create' && !(ops && ops.has(opName))) {
            // A function `to` receives the item and nothing else, so it cannot
            // be told which operation was asked for. Naming one is an error
            // rather than a silent single-transport call — and it is WF-974's
            // error: the error-codes page has attributed this case there all
            // along, while this call site threw a bare Error with no code.
            // Rejects, not throws.
            const err = new Error(
                `write("${opName}") on query "${controller.name}" needs a declarative \`to\`; ` +
                `a function \`to\` carries no operation hint.`
            );
            if (__DEV__) wfError(WF_ERRORS.QUERY_OP_UNKNOWN, {
                context: `Query "${controller.name}": write("${opName}") named an operation, but \`to\` is a function and carries no operation hint`,
                suggestion: 'Declare to: as a URL or an operation map to name operations, or call write(item) and let the transport function handle it'
            });
            return Promise.reject(err);
        }
        let op = null;
        if (controller.toFn && (opName === 'update' || opName === 'delete') && !(ops && ops.has(opName))) {
            op = null;                       // the escape hatch owns this write
        } else if (!ops || !ops.has(opName)) {
            if (__DEV__) wfError(WF_ERRORS.QUERY_OP_UNKNOWN, {
                context: `Query "${controller.name}": no "${opName}" operation is declared`,
                suggestion: opName === 'create'
                    ? "Declare it: create: '/api/items' (or { url, method, body, confirmation })"
                    : `Declared operations: ${ops && ops.size ? Array.from(ops.keys()).join(', ') : '(none)'}`
            });
            const declared = ops && ops.size ? Array.from(ops.keys()).join(', ') : 'none';
            // Rejects, not throws — matching WF-982/WF-969
            // below and the WF-974 docs entry, which promised a rejection
            // all along.
            return Promise.reject(new Error(
                `Query "${controller.name}" declares no "${opName}" operation (declared: ${declared}). ` +
                (opName === 'create'
                    ? 'create() needs a `create:` declaration.'
                    : 'Name it in `to:`, or declare `to:` as a URL for update and delete.')
            ));
        } else {
            op = ops.get(opName);
        }
        // An undefined-valued field is ABSENT, not a value (survey probe
        // #4, the urql dev-error-13 class): JSON.stringify already drops
        // it from any declarative body, so letting it through the client
        // side wrote `undefined` over the row's real value and claimed
        // the field — a third meaning RFC 7396 does not have (null
        // deletes, absent leaves alone). Stripped here, ahead of
        // everything that reads fields, so claims, pre-images, the
        // optimistic merge, and a function `to:` all see the item the
        // wire would carry. Dev builds name the fields once per query.
        if (item != null && typeof item === 'object') {
            let dropped = null;
            for (const f of Object.keys(item)) {
                if (item[f] === undefined) (dropped || (dropped = [])).push(f);
            }
            if (dropped) {
                if (__DEV__ && !controller._warnedUndefinedFields) {
                    controller._warnedUndefinedFields = true;
                    wfError(WF_ERRORS.QUERY_WRITE_UNDEFINED_FIELD, {
                        warn: true,
                        context: `Query "${controller.name}": write() received undefined for ${dropped.map((f) => `"${f}"`).join(', ')}; undefined is not a value, so the field${dropped.length > 1 ? 's are' : ' is'} treated as absent`,
                        suggestion: 'Pass null to clear a field, or omit it to leave it alone (a confirmation follows the same rule: null deletes, absent is untouched)'
                    });
                }
                const cleaned = {};
                for (const f of Object.keys(item)) {
                    if (item[f] !== undefined) cleaned[f] = item[f];
                }
                item = cleaned;
            }
        }
        const wf = this;
        const store = this.getStore(controller.name);
        if (!store) return Promise.resolve();

        // A delete reached BY NAME applies the declared tombstone field
        // itself. Otherwise one map entry would behave differently depending
        // on whether it was reached by derivation or by name, and the named
        // route would tombstone nothing while tripping the field-merge
        // precondition (an operation that merges no fields claims nothing,
        // so its rejection rolls back nothing).
        let warnedDeleteShape = false;
        if (opName === 'delete' && item != null) {
            if (controller.deletedField) {
                if (!item[controller.deletedField]) {
                    item = Object.assign({}, item, { [controller.deletedField]: true });
                }
            } else if (__DEV__) {
                // One mistake, one warning (review A3): the same call would
                // also trip WF-976 below (a tombstone-less delete carries
                // only the key), and WF-976's include-the-fields advice is
                // wrong for a delete. This flag suppresses the second warn.
                warnedDeleteShape = true;
                wfError(WF_ERRORS.QUERY_DELETE_SHAPE, {
                    warn: true,
                    context: `Query "${controller.name}": write("delete", ...) with no \`deleted\` field declared; the row stays on screen until the next sync`,
                    suggestion: "Declare the tombstone field the source uses: deleted: 'removed'"
                });
            }
        }
        // create mints the key the server has not issued yet. The temp-id
        // correction machinery already exists (keyAliases, _queryRenameRowKey),
        // so knowing the operation lets the framework do by declaration what
        // applications currently do by hand. Only for queries that declared a
        // key: a record-shaped query has one row and no key to mint.
        // Shape decides, and shape is markup. It is knowable the moment an
        // element binds: the record path sets hasRecord beside its
        // observeElement call, the list path calls observeElement without it.
        // Before anything binds the question has no answer, and an unbound
        // query has not activated and so has no rows to address, which is why
        // "not yet bound" is treated as no claim either way rather than as a
        // list. Reading `key:` as the shape signal (what this used to do) asks
        // a different question: `key` defaults to 'id' for reads, so a list
        // that omits it is keyed for reading and keyless for writing.
        // A query bound both ways is treated as a list: a list binding proves
        // the rows carry keys, so a keyless write still has no row to name and
        // create() still has somewhere to append.
        const bound = controller.elements.size > 0;
        const boundAsList = controller.hasList || (bound && !controller.hasRecord);
        const boundAsRecord = !!controller.hasRecord && !controller.hasList;

        if (opName === 'create' && boundAsRecord) {
            const err = new Error(
                `create() on query "${controller.name}" is a record query: it holds one record, ` +
                `so there is no second record to create. Write to it with write(item).`
            );
            if (__DEV__) wfError(WF_ERRORS.QUERY_CREATE_ON_RECORD, {
                context: `Query "${controller.name}": create() on a record-shaped query`,
                suggestion: 'A record query binds one record. Use write(item) to change it, or bind the query as a list (a <template> child) if it really holds many rows.'
            });
            return Promise.reject(err);
        }

        let mintedKey = false;
        if (opName === 'create' && !boundAsRecord
            && (item == null || item[key] == null)) {
            item = Object.assign({}, item, {
                [key]: 'tmp-' + controller.name + '-' + (++controller.tmpSeq)
            });
            mintedKey = true;
        }

        const rows = store.rows || [];
        const k = item == null ? undefined : item[key];
        const keyed = k !== undefined;
        // A keyless item on a KEYED query used to target rows[0]: a write missing
        // the key field silently merged into whichever row happened to be first,
        // claimed its fields, and rolled those back on rejection. There is no
        // sane row to infer, so it is an error rather than a guess.
        //
        // A record-shaped query legitimately writes keyless items: rows[0] IS
        // its single record, and merging into it is the documented behavior,
        // not the defect. Everything else is an error, because a keyless write
        // to a list has no legitimate reading. "Update the only row" means the
        // query is a record; "update every row" is not semantics this engine
        // has; "append" is create(). What remains is a forgotten key, or an
        // author who correctly believes the documented 'id' default applies —
        // and that second case is why the declared-key test this used to make
        // was the wrong question.
        if (!keyed && (typeof controller.config.key === 'string' || boundAsList)) {
            const err = new Error(
                `write() on query "${controller.name}" needs the key field "${key}"; ` +
                `the item passed has no "${key}" value, so there is no row to write to.`
            );
            if (__DEV__) wfError(WF_ERRORS.QUERY_WRITE_KEYLESS, {
                context: `Query "${controller.name}": write() item is missing "${key}"`,
                suggestion: `Include the key: write({ ${key}: <value>, ...fields }).`
            });
            return Promise.reject(err);
        }
        // WF-996: a NO-ITEM write that flowed past the keyless guard above
        // (survey pass two, Lane D #3). The guard legitimately passes
        // keyless writes on record-shaped (and unbound keyless) queries, so
        // write("favorite") with no item at all sailed through — claiming
        // nothing, applying nothing, rolling back nothing — while WF-976
        // fired downstream with advice about a key the call never had.
        // Named here as the actual mistake, and WF-976 is suppressed for
        // this call (one mistake, one warning — the A3 rule). Warns, never
        // rejects: an item-less verb on a record query whose URL resolves
        // from params is a legitimate call, and behavior is unchanged.
        let warnedNoItem = false;
        if (__DEV__ && item == null) {
            warnedNoItem = true;
            if (!controller._warnedNoItem) controller._warnedNoItem = new Set();
            if (!controller._warnedNoItem.has(opName)) {
                controller._warnedNoItem.add(opName);
                wfError(WF_ERRORS.QUERY_WRITE_NO_ITEM, {
                    warn: true,
                    context: `Query "${controller.name}": ${opName ? `write("${opName}")` : 'write()'} was called with no item, so the operation carries no fields — nothing applies optimistically and nothing can roll back`,
                    suggestion: `Pass the row being written, or at least its key: write(${opName ? `"${opName}", ` : ''}{ ${key}: … }). An item-less call is only meaningful on a record query whose URL resolves from params:`
                });
            }
        }
        const currentRow = keyed ? rows.find((r) => r != null && r[key] === k) : rows[0];
        const rowExisted = currentRow !== undefined;
        const isDelete = !!(controller.deletedField && item && item[controller.deletedField]);

        const writeId = ++controller.writeSeq;
        const claims = controller.fieldClaims;
        // The row key, resolved through the alias registry at CALL time: a
        // temp-id correction may rename this row while this write is in
        // flight, and every later lookup and payload must follow it.
        const kk = () => {
            let x = k;
            let s = String(x);
            // Cycle guard: the alias chain is built from server-issued key
            // corrections, so a server that renamed A to B and later B back
            // to A would close a loop and hang the page here. Stop at the
            // first key already visited and use it.
            const seen = new Set();
            while (controller.keyAliases.has(s) && !seen.has(s)) {
                seen.add(s);
                x = controller.keyAliases.get(s);
                s = String(x);
            }
            return x;
        };
        const ck = (field) => String(kk()) + CLAIM_SEP + field;
        const fieldOf = (ckf) => ckf.slice(ckf.indexOf(CLAIM_SEP) + 1);
        // Pre-images, keyed by composite key, SHARED with the controller's
        // in-flight registry: when an earlier write's settle invalidates a
        // later write's captured pre-image, the settling write repairs its
        // successor's entry in place (see onReject/onResolve), so a chain
        // of overlapping writes always unwinds to real values, in any
        // settle order.
        const prevByField = new Map();
        for (const f of Object.keys(item || {})) {
            if (f === key) continue; // the key identifies the row; it is not written data
            prevByField.set(ck(f), rowExisted ? currentRow[f] : undefined);
            claims.set(ck(f), writeId); // later claims overwrite earlier — that IS the tie-break
        }
        if (__DEV__ && prevByField.size === 0 && !isDelete && !warnedDeleteShape && !warnedNoItem) {
            // The write machinery is defined over (rowKey, field): an
            // operation that merges no fields claims nothing, so a rejection
            // rolls back nothing and supersession orders nothing. That is
            // correct behavior which reads as a bug, so it is named once.
            // (warnedDeleteShape: a tombstone-less delete already got the
            // warning that names its actual mistake — review A3.)
            if (!controller._warnedNoFields) controller._warnedNoFields = new Set();
            if (!controller._warnedNoFields.has(opName)) {
                controller._warnedNoFields.add(opName);
                wfError(WF_ERRORS.QUERY_OP_NO_FIELDS, {
                    warn: true,
                    context: `Query "${controller.name}": the "${opName}" write carries only the key, so it claims no fields — a rejection will roll nothing back`,
                    suggestion: 'Include the fields the operation changes, e.g. write("favorite", { id, favorited: true }), so the optimistic value can be unwound. A pure side-effect operation whose URL is the verb legitimately carries only the key; this note just records that nothing will roll back'
                });
            }
        }
        if (isDelete && rowExisted) {
            // A rejected delete restores the whole row: capture EVERY field
            // as a pre-image (without claiming the extras) so the restore
            // rides the same registry — including the arrival refresh, so
            // a restore after an out-of-band change carries fresh values.
            for (const f of Object.keys(rgToRaw(currentRow))) {
                if (f === key) continue;
                if (!prevByField.has(ck(f))) prevByField.set(ck(f), currentRow[f]);
            }
            controller.rowClaims.set(String(k), { w: writeId, kind: 'delete' });
            // Position is part of the pre-image too. Without it the restore
            // re-enters through the patch merge, which appends any key it does
            // not already hold, so a rejected delete always put the row last no
            // matter where it came from.
            //
            // Kept current the same way the field pre-images are: a server
            // arrival mid-flight is a newer row order, and the refresh in
            // _queryIngest re-reads this index out of that payload.
            if (!controller.deletePositions) controller.deletePositions = new Map();
            controller.deletePositions.set(writeId, {
                index: keyed ? rows.findIndex((r) => r != null && r[key] === k) : 0
            });
        } else if (!rowExisted && keyed) {
            controller.rowClaims.set(String(k), { w: writeId, kind: 'create' });
            // The server has not acknowledged this row's existence yet. The
            // marker outlives the create's own claim on purpose: if the create
            // is rejected while a later write owns fields on the row, that
            // write inherits responsibility for it, and only a CONFIRM from
            // somebody clears the debt. Without this, a rejected create whose
            // row was claimed handed ownership to a write with no removal
            // semantics, and both rejecting left a row on screen that the
            // server never created and nothing could clean up.
            //
            // Read the gate, not the word "create": this branch is
            // `!rowExisted && keyed`, so it also covers a plain write() naming
            // a row that is not currently in `rows` (filtered out, or on a
            // page that never loaded). The behaviour is the same and is right
            // either way, since the optimistic append is this write's doing
            // and removing it on rejection restores the prior view. What the
            // marker really tracks is "this write introduced the row", which
            // is broader than an unacknowledged create.
            //
            // A Set of key strings, deliberately: at most one entry per key,
            // so a second write on the same key is an idempotent re-add and
            // no second entry can strand when the temp-id rename below
            // re-keys the other registries.
            if (!controller.unackedRows) controller.unackedRows = new Set();
            controller.unackedRows.add(String(k));
        }
        // Immutable record of what this write set: dispossession may strip
        // rollback rights from prevByField, but a dispossessed write that
        // CONFIRMS still moves server truth and must still repair its
        // successors' pre-images.
        const wroteKeys = Array.from(prevByField.keys());
        controller.pendingWrites++;
        // Public mirror, before the optimistic ingest (flags before rows):
        // a binding painting the optimistic row already sees the count up.
        engineWrite(() => { store.pendingWrites = controller.pendingWrites; });
        controller.inflightWrites.set(writeId, prevByField);
        controller.runId++; // supersede any in-flight read

        // WF-991: a write pending past the threshold (survey pass two,
        // urql #159's class — "optimistic updates are not cleared"). A
        // `to` that never settles holds claims, pendingWrites, persistence,
        // ETag caching, and the whole refresh ladder, forever, with nothing
        // on screen but a stale badge. Dev builds name it once per query.
        // Nothing is aborted and no timeout is imposed: the transport is
        // the application's, and only it knows whether the request is
        // still alive. Threshold knob mirrors _queryTeardownGraceMs (tests
        // shorten it); the settle arms clear the timer.
        let pendingWarnTimer = null;
        if (__DEV__) {
            const pendingMs = this._queryWritePendingWarnMs || 10000;
            pendingWarnTimer = setTimeout(() => {
                // Stale-timer guard: a controller no longer registered
                // (test resets, a hard reload of the registry) must not
                // warn through its dead registration.
                if (!this._queryControllers || this._queryControllers.get(controller.name) !== controller) return;
                if (!controller.inflightWrites.has(writeId) || controller._warnedWritePending) return;
                controller._warnedWritePending = true;
                wfError(WF_ERRORS.QUERY_WRITE_PENDING, {
                    warn: true,
                    context: `Query "${controller.name}": the ${opName ? `"${opName}" write` : 'write'} issued ${Math.round(pendingMs / 1000)}s ago has not settled — its field claims, pendingWrites, and the paused refresh and persist machinery all hold until it does`,
                    suggestion: 'Make the transport settle: reject on timeout (e.g. AbortSignal.timeout in a function to:) or fix the endpoint. No timeout is imposed here — an explicit second write() is the only retry'
                });
            }, pendingMs);
        }

        // The most recent still-pending write AFTER this one that wrote the
        // field: the holder of the pre-image this write's settle may need
        // to repair (its captured value came from this write).
        const successorFor = (ckf) => {
            let succ = 0;
            for (const [wid, prevs] of controller.inflightWrites) {
                if (wid > writeId && prevs.has(ckf) && (succ === 0 || wid < succ)) succ = wid;
            }
            return succ > 0 ? controller.inflightWrites.get(succ) : null;
        };

        this._queryIngest(controller, item, { patch: true, source: 'write' });

        const releaseClaims = () => {
            for (const [c, id] of claims) {
                if (id === writeId) claims.delete(c);
            }
        };

        // Aliases exist for closures of pending writes; when the registry
        // drains there is nothing left that can reference an old key, and
        // holding them would leak one entry per temp-id correction forever.
        const maybeClearAliases = () => {
            if (controller.inflightWrites.size === 0) controller.keyAliases.clear();
        };
        const releaseRowClaim = () => {
            const sk = String(kk());
            const rc = controller.rowClaims.get(sk);
            if (rc && rc.w === writeId) controller.rowClaims.delete(sk);
        };

        const onResolve = (result) => {
            if (__DEV__ && pendingWarnTimer !== null) clearTimeout(pendingWarnTimer);
            // Captured before the reconcile can stamp lastSync: "the first
            // load never completed" decides recovery at the end.
            // A confirm held by an arrival that landed mid-write (deferredConfirm)
            // is a sync that has not stamped lastSync yet: after
            // refresh({ clear: true }) reset the stamp, reading null alone
            // would mistake the interrupted-first-load case and refetch,
            // clearing the rejection's syncError on the way.
            const neverSynced = store.lastSync === null && !controller.deferredConfirm;
            controller.pendingWrites--;
            engineWrite(() => { store.pendingWrites = controller.pendingWrites; });
            controller.inflightWrites.delete(writeId);
            releaseRowClaim();
            // A confirmed delete keeps the row gone, so its saved position has
            // nothing left to restore. Dropped here or the map grows one entry
            // per successful delete for the life of the query.
            if (controller.deletePositions) controller.deletePositions.delete(writeId);
            // Any confirm settles the row's EXISTENCE: the server answered for
            // it, so an unacknowledged-create debt is paid and no later
            // rejection should remove the row.
            if (keyed && controller.unackedRows) controller.unackedRows.delete(String(kk()));
            // Confirmed fields release outright: they are server truth now,
            // and an earlier write's later rejection must NOT unwind them.
            releaseClaims();
            // A confirmed settle supersedes in-flight reads, exactly as
            // write ISSUE does (survey ruling #3, the RTK #4271 class).
            // Rungs are suppressed while writes pend, but an app-called
            // refresh() during the window took a higher runId, and its
            // response — pre-write server state by construction — would
            // land AFTER the claims released, replacing the confirmed
            // record with nothing left to protect it. The settle is a
            // call, so the read in flight predates the server-state
            // change and is dropped at apply (missedArrival catches up
            // on the next fetch). Rejections never bump: a rejected
            // write changed nothing on the server, so an in-flight
            // read is still valid truth.
            controller.runId++;
            // Validator hygiene (bug-history survey): a settled write
            // changed server state, so every held validator and cached
            // row set describes PRE-write content. Kept, the follow-up
            // revalidation carries the old etag and a lagging origin's
            // 304 stamps the optimistic rows as confirmed truth (and the
            // 304 arm persists them beside that same stale validator) —
            // the d6bd925e class by the write route. Dropping them makes
            // the next fetch unconditional, which is what "the data just
            // changed" means. Rejections keep theirs: the rollback
            // restores exactly the content the validator vouches for.
            controller.etag = null;
            controller.etagUrl = null;
            controller.etags = null;
            if (controller.snapshots) controller.snapshots.clear();
            if (result == null) {
                // Resolved with nothing: the next sync fetches the truth.
                maybeClearAliases();
                return store.invalidate();
            }
            if (typeof result !== 'object') {
                // Not a record at all. `confirmation` extracts the server's
                // answer FOR THE ROW, so a boolean, number or string is the
                // status-envelope mistake WF-965 already names, one step
                // further along: that guard requires an object, so a primitive
                // slipped past it into the ingest, where a single unkeyed
                // payload under `reconcile` collapses the entire row set to one
                // element holding the primitive. Same remedy as the envelope
                // case, so the same code and the same resolve-with-nothing arm.
                if (__DEV__) wfError(WF_ERRORS.QUERY_WRITE_KEYLESS_RESULT, {
                    warn: true,
                    context: `Query "${controller.name}": write() resolved with a ${typeof result}, not a record; the query invalidates instead of applying it`,
                    suggestion: 'Resolve with nothing (undefined) for this behavior without the warn, or have confirmation return the saved record itself.'
                });
                maybeClearAliases();
                return store.invalidate();
            }
            if (result && typeof result === 'object' && !Array.isArray(result)) {
                // A later in-flight write's captured pre-image for a field
                // this record carries was MY optimistic value; the server's
                // answer replaces it, so that write's eventual rollback
                // lands on truth instead of a superseded guess.
                for (const ckf of wroteKeys) {
                    const f = fieldOf(ckf);
                    if (!(f in result)) continue;
                    const succ = successorFor(ckf);
                    if (succ) succ.set(ckf, result[f]);
                }
                // And EARLIER pending writers are permanently dispossessed
                // of the fields this confirm carried: their claims were
                // already overwritten, and stripping their registry entries
                // keeps them out of the heir hand-back and their own
                // rollbacks — a superseded value must never resurface over
                // confirmed truth.
                for (const [wid, prevs] of controller.inflightWrites) {
                    if (wid >= writeId) continue;
                    for (const ckf of wroteKeys) prevs.delete(ckf);
                }
            }
            if (keyed && result && typeof result === 'object' && !Array.isArray(result)) {
                const rk = result[key];
                if (rk == null) {
                    // A keyed write resolved with an object lacking the query
                    // key — a status envelope ({ success: true }) or a partial
                    // the server did not key. Neither can safely be applied as
                    // the row's record, and both intents are served by the
                    // resolve-with-nothing arm: the next conditional fetch
                    // carries the truth. Record queries are unaffected (their
                    // writes are keyless, so `keyed` is false here).
                    // `== null` on purpose: a key present as
                    // EXPLICIT null is "without the key" for every practical
                    // purpose, and letting it through read as a tmp-id
                    // "correction" to null, after which the merge-patch
                    // null-delete stripped the key field and the dedup set
                    // appended the payload as a duplicate row.
                    if (__DEV__) wfError(WF_ERRORS.QUERY_WRITE_KEYLESS_RESULT, {
                        warn: true,
                        context: `Query "${controller.name}": write() resolved with an object ${rk === null ? `whose "${key}" is null` : `without "${key}"`}; the query invalidates instead of applying it`,
                        suggestion: `Resolve with nothing (undefined) for this behavior without the warn, or echo the key onto the parsed body to apply it as the row's record`
                    });
                    maybeClearAliases();
                    return store.invalidate();
                }
                if (rk !== kk()) {
                    // The server corrected the key (tmp-id -> real id):
                    // rename the optimistic row IN PLACE (position kept, and
                    // the reconcile below matches it, so claim-honor guards
                    // other writes' fields), then alias the old key and
                    // RE-KEY the registries so in-flight writes that
                    // captured the old key follow the row — their rollbacks
                    // target the real row instead of resurrecting a ghost.
                    const oldK = kk();
                    const oldPrefix = String(oldK) + CLAIM_SEP;
                    // Fields on this row that OTHER pending writes still
                    // claim (own claims are already released): if the entity
                    // also arrived under its real key, these optimistic
                    // values ride onto the surviving row.
                    const carry = new Set();
                    for (const [c, id] of claims) {
                        if (id !== writeId && c.indexOf(oldPrefix) === 0) carry.add(c.slice(oldPrefix.length));
                    }
                    wf._queryRenameRowKey(controller, oldK, rk, carry);
                    const newPrefix = String(rk) + CLAIM_SEP;
                    const rekey = (m) => {
                        for (const [mk, mv] of [...m]) {
                            if (mk.indexOf(oldPrefix) === 0) {
                                m.delete(mk);
                                m.set(newPrefix + mk.slice(oldPrefix.length), mv);
                            }
                        }
                    };
                    rekey(claims);
                    for (const [, prevs] of controller.inflightWrites) rekey(prevs);
                    const rcEntry = controller.rowClaims.get(String(oldK));
                    if (rcEntry) {
                        controller.rowClaims.delete(String(oldK));
                        controller.rowClaims.set(String(rk), rcEntry);
                    }
                    controller.keyAliases.set(String(oldK), rk);
                }
            }
            if (controller._clearedWrites && controller._clearedWrites.delete(writeId)) {
                // The row this write confirmed was cleared with its list
                // (refresh({ clear: true })), so the confirmation must not
                // re-append it into the list now on screen. Only the drain
                // bookkeeping the reconcile would have done remains: a
                // confirm held by an arrival that landed mid-write lands
                // its stamp once nothing pends.
                if (controller.pendingWrites === 0) {
                    const held = controller.deferredConfirm;
                    controller.deferredConfirm = false;
                    engineWrite(() => {
                        store.isStale = false;
                        if (held) {
                            store.isLoading = false;
                            store.lastSync = Date.now();
                        }
                    });
                }
            } else {
                wf._queryIngest(controller, result, { patch: true, reconcile: true, source: 'write' });
            }
            maybeClearAliases();
            if (neverSynced && controller.pendingWrites === 0) {
                // This write superseded the initial load (the runId bump)
                // and its record confirms ONE row, not the result set —
                // for an SSR-adopted store the other seeded rows are still
                // unvalidated display text. Recover the interrupted first
                // load exactly as the reject arm does. Fire-and-forget:
                // the record already settled this write, so the caller's
                // promise must not wait on the catch-up fetch.
                store.invalidate();
            } else if (controller.missedArrival && controller.pendingWrites === 0) {
                // A write superseded an arrival whose delivery was
                // dropped; the signal that requested it is consumed.
                // Catch up at the drain.
                controller.missedArrival = false;
                store.invalidate();
            }
        };

        const onReject = (err) => {
            if (__DEV__ && pendingWarnTimer !== null) clearTimeout(pendingWarnTimer);
            // Captured at entry: the deferred-confirm landing below stamps
            // lastSync, and recovery must not be fooled by that stamp.
            // A confirm held by an arrival that landed mid-write (deferredConfirm)
            // is a sync that has not stamped lastSync yet: after
            // refresh({ clear: true }) reset the stamp, reading null alone
            // would mistake the interrupted-first-load case and refetch,
            // clearing the rejection's syncError on the way.
            const neverSynced = store.lastSync === null && !controller.deferredConfirm;
            controller.pendingWrites--;
            controller.inflightWrites.delete(writeId);
            releaseRowClaim();
            // Flags before rows (standing ordering): syncError lands ahead
            // of the rollback's row write.
            engineWrite(() => {
                store.pendingWrites = controller.pendingWrites;
                store.syncError = err && err.message ? err.message : String(err);
            });
            if (isDelete && rowExisted) {
                // A rejected delete restores the row from its registry
                // pre-images (which arrival refresh keeps current, so the
                // restore carries fresh out-of-band values). Unlike a
                // plain field write's rollback, this snapshot is the
                // WHOLE row as of THIS write's issue time, and the row
                // was removed wholesale, not partially hidden — so a
                // field this delete captured is either safe to restore
                // or must be left for another write to supply, never
                // silently dropped (an earlier bug: dropping it left the
                // restored row missing the property entirely, reading
                // as undefined, instead of a real value).
                //
                // The tie-break is WRITE ORDER, not mere presence of a
                // claim. A field an EARLIER-issued write still claims is
                // already reflected in this snapshot (currentRow was
                // read after that write's optimistic apply) — safe, and
                // correct, to restore. A field a LATER-issued write
                // claims postdates this snapshot entirely (that write's
                // own value was never seen by it) — restoring it would
                // clobber that write's own optimistic value with stale
                // data, so it is left out; that write's own eventual
                // settle supplies it instead, exactly as if this row had
                // never been deleted.
                const restore = { [key]: kk() };
                for (const [ckf, prev] of prevByField) {
                    const c = claims.get(ckf);
                    if (c !== undefined && c > writeId) continue;
                    restore[fieldOf(ckf)] = prev;
                }
                // Position rides the same registry as the fields: the index was
                // captured at issue time and re-read from every arrival since,
                // so it names a slot in the order currently on screen.
                const pos = controller.deletePositions && controller.deletePositions.get(writeId);
                if (controller.deletePositions) controller.deletePositions.delete(writeId);
                // A delete is a perfectly ordinary way for a second write to
                // claim an optimistic row, so this branch can inherit an
                // unacknowledged-create debt too. Restoring the row would put
                // back something the server never created, so the debt is
                // settled BEFORE the restore: if nobody is left who could make
                // the server answer for the row, there is nothing to restore.
                let orphaned = false;
                if (keyed && controller.unackedRows && controller.unackedRows.has(String(kk()))) {
                    const rowPrefix = String(kk()) + CLAIM_SEP;
                    let stillClaimed = false;
                    for (const [wid, keys] of controller.inflightWrites) {
                        if (wid === writeId) continue;
                        for (const ck2 of keys.keys()) {
                            if (ck2.indexOf(rowPrefix) === 0) { stillClaimed = true; break; }
                        }
                        if (stillClaimed) break;
                    }
                    if (!stillClaimed) {
                        orphaned = true;
                        controller.unackedRows.delete(String(kk()));
                        wf._queryRemoveRow(controller, kk());
                    }
                }
                // Skipped only when the row was removed as an orphan, or when
                // the list it belonged to was cleared while this delete was
                // in flight (refresh({ clear: true }): there is nothing to
                // restore into); the claim hand-back below still runs either way.
                if (!orphaned && !(controller._clearedWrites && controller._clearedWrites.delete(writeId))) {
                    wf._queryIngest(controller, restore, {
                        patch: true,
                        source: 'write',
                        restoreAt: pos && pos.index >= 0 ? pos.index : null
                    });
                }
            } else if (!rowExisted) {
                // Rejected create: the row's existence was this write's
                // doing. Remove it — unless a later write claimed fields on
                // it, in which case that write's outcome owns the row and
                // only the field claims are released.
                let claimedByOther = false;
                const prefix = String(kk()) + CLAIM_SEP;
                for (const [c, id] of claims) {
                    if (id !== writeId && c.indexOf(prefix) === 0) { claimedByOther = true; break; }
                }
                if (!claimedByOther) {
                    wf._queryRemoveRow(controller, kk());
                    if (controller.unackedRows) controller.unackedRows.delete(String(kk()));
                }
                // When it IS claimed by another write, the row survives and the
                // unacked marker stays set, so that write's own settle decides.
            } else {
                const reverted = {};
                let any = false;
                for (const [ckf, prev] of prevByField) {
                    if (claims.get(ckf) === writeId) {
                        reverted[fieldOf(ckf)] = prev; any = true;
                    } else {
                        // A later write owns this field, and ITS captured
                        // pre-image is MY rejected optimistic value. Repair
                        // the immediate successor's entry with my own
                        // pre-image so the chain unwinds to real values in
                        // every settle order.
                        const succ = successorFor(ckf);
                        if (succ) succ.set(ckf, prev);
                    }
                }
                // A row cleared with its list while this write was in flight
                // (refresh({ clear: true })) has nothing to revert into, and
                // a keyed revert would append it to the list now on screen.
                if (any && !(controller._clearedWrites && controller._clearedWrites.delete(writeId))) {
                    wf._queryIngest(controller,
                        keyed ? Object.assign({ [key]: kk() }, reverted) : reverted,
                        { patch: true, source: 'write' });
                }
                // Inherited create debt: this row was introduced optimistically,
                // the create that introduced it was refused, and this write took
                // ownership by claiming its fields. With this rejection too, no
                // write remains that could make the server acknowledge it, so
                // the row goes. Checked after the revert so the removal is the
                // last word.
                if (keyed && controller.unackedRows && controller.unackedRows.has(String(kk()))) {
                    const rowPrefix = String(kk()) + CLAIM_SEP;
                    let stillClaimed = false;
                    for (const [wid, keys] of controller.inflightWrites) {
                        if (wid === writeId) continue;
                        for (const ck2 of keys.keys()) {
                            if (ck2.indexOf(rowPrefix) === 0) { stillClaimed = true; break; }
                        }
                        if (stillClaimed) break;
                    }
                    if (!stillClaimed) {
                        controller.unackedRows.delete(String(kk()));
                        wf._queryRemoveRow(controller, kk());
                    }
                }
            }
            // Hand each still-owned claim back to the most recent still-
            // pending earlier writer of that field, so ITS rollback can
            // still unwind (both-reject lands on the original value);
            // release outright only when no such write remains. Confirmed
            // fields never re-enter this path — resolve releases outright.
            for (const [c, id] of claims) {
                if (id !== writeId) continue;
                let heir = 0;
                for (const [wid, keys] of controller.inflightWrites) {
                    if (wid > heir && keys.has(c)) heir = wid;
                }
                if (heir > 0) claims.set(c, heir); else claims.delete(c);
            }
            if (controller.pendingWrites === 0) {
                // The drain: nothing pends, so the rollback has left the
                // rows equal to the last known truth — staleness ends even
                // when no confirm was held (a lone rejection must never
                // strand "syncing" forever). A held confirm additionally
                // lands its sync stamp. syncError stays — this rejection
                // is still the latest news.
                const held = controller.deferredConfirm;
                controller.deferredConfirm = false;
                engineWrite(() => {
                    store.isStale = false;
                    if (held) {
                        store.isLoading = false;
                        store.lastSync = Date.now();
                    }
                });
                if (held && controller.persistKey) {
                    // A server arrival landed mid-writes (its save was
                    // deferred with its confirm) and the drain arrived by
                    // REJECTION, so no reconcile will ever save it. The
                    // rows now hold that arrival with the rejected fields
                    // rolled back to their arrival-refreshed pre-images —
                    // the converged truth the held confirm just stamped.
                    // Without this save, disk stays one sync behind and
                    // tomorrow restores it. The validator rides ONLY when
                    // the deferring arrival was fetch-sourced (that
                    // response updated controller.etag, so the pair
                    // matches); a STREAM-deferred confirm moved the rows
                    // past the held validator, and persisting the pair
                    // would let a later restore + lagging 304 confirm rows
                    // it never vouched for (the d6bd925e class by the
                    // drain route — combo-tier oracle find, 2026-08-29).
                    wf._queryPersistSave(controller, rgToRaw(store.rows) || [], held === 'fetch');
                }
            }
            maybeClearAliases();
            if (neverSynced && controller.pendingWrites === 0) {
                // This write superseded the initial load (the runId bump)
                // and then failed; nothing else will ever fetch, so recover
                // the interrupted first load.
                store.invalidate();
            } else if (controller.missedArrival && controller.pendingWrites === 0) {
                // Same catch-up as the confirm arm: a dropped arrival's
                // signal never re-fires on its own.
                controller.missedArrival = false;
                store.invalidate();
            }
            throw err; // the caller's try/catch sees the failure
        };

        // A raw fetch Response is transport, never a record ("return
        // res.json() or do not" — the design ruling). ok normalizes to the
        // resolve-with-nothing arm; not-ok becomes a rejection with the
        // read side's 'HTTP <status>' shape. Parsing the body is how a
        // caller opts into record reconcile.
        const normalize = (res) => {
            if (typeof Response === 'function' && res instanceof Response) {
                if (!res.ok) return writeHttpError(res); // status + parsed body ride the rejection
                return undefined;
            }
            return res;
        };
        let result;
        try {
            result = op ? wf._queryOpRequest(controller, op, item, mintedKey) : cfg.to(item);
        } catch (e) {
            const settled = Promise.resolve().then(() => onReject(e));
            // WF-990: dev builds watch the returned promise for a rejection
            // nobody handles (see devWatchWriteRejection above). Additive
            // only — the rejection still propagates unhandled.
            return __DEV__ ? devWatchWriteRejection(controller, opName, settled) : settled;
        }
        const settled = Promise.resolve(result).then(normalize).then(onResolve, onReject);
        return __DEV__ ? devWatchWriteRejection(controller, opName, settled) : settled;
    },

    /**
     * Issue one declared operation. The framework owns the request; the
     * application owns the payload SHAPE (`body`) and what counts as the
     * server's answer (`confirmation`) — the governing rule, applied.
     *
     * Body: an operation sends NO body unless one is declared, because
     * operations differ in payload within a single query (a body-less
     * DELETE beside an envelope-carrying POST is ordinary). The query-level
     * `body:` covers `update` and `create`; anything else declares its own
     * on its entry, and `confirmation:` follows the same rule.
     *
     * Confirmation: present means parse the response and reconcile it as
     * server truth; absent means treat an ok response as transport and let
     * the resolve-with-nothing arm fire one conditional refetch. That
     * preserves today's contract exactly — a raw Response was always
     * transport, and an app opted into reconcile by parsing the body.
     */
    _queryOpRequest(controller, op, item, mintedKey) {
        const cfg = controller.config;
        const inherits = op.name === 'update' || op.name === 'create';
        const bodyFn = op.body !== undefined ? op.body
            : (inherits && typeof cfg.body === 'function' ? cfg.body : null);
        const confirmFn = op.confirmation !== undefined ? op.confirmation
            : (inherits && typeof cfg.confirmation === 'function' ? cfg.confirmation : null);

        // The twin of the dropped-body arm below, and the same reasoning: the
        // author declared how to read this server's answers, and one route
        // quietly did not inherit it. What differs is the cost. A body-less
        // request sends nothing; a confirmation-less one still WORKS, then
        // pays for it — no confirmation means transport-only, which routes to
        // the resolve-with-nothing arm and invalidates, and that refetch drops
        // the ETag first, so every write of this shape spends a full
        // collection body. The endpoint that answers a named operation with
        // the updated record is the ordinary case (favorite, publish), so the
        // response usually carried exactly what reconciliation needed.
        // `undefined` is what separates undeclared from declared-and-broken:
        // normalizeOperations stores the broken one as null, having warned.
        // delete is exempt for the reason it is exempt below — 204 is the
        // ordinary answer, and there is nothing in it to confirm.
        if (__DEV__ && !controller._warnedConfirmInherit && !inherits
            && op.name !== 'delete' && op.confirmation === undefined
            && typeof cfg.confirmation === 'function') {
            controller._warnedConfirmInherit = true;
            wfError(WF_ERRORS.QUERY_CONFIRM_NOT_INHERITED, {
                warn: true,
                context: `Query "${controller.name}": the query-level \`confirmation\` does not reach the "${op.name}" operation, so its response is discarded and the query refetches the whole collection after every "${op.name}" write`,
                suggestion: `Declare confirmation on the "${op.name}" operation itself if its response carries the row, or leave it as-is if the refetch is what you want`
            });
        }

        if (mintedKey && op.keyToken) {
            // The framework minted this key moments ago; interpolating it would
            // address a resource the server has never heard of. Refused in
            // every build, because the request would otherwise look successful.
            throw new Error(
                `Query "${controller.name}": create's URL ("${op.url}") interpolates the key ` +
                `":${controller.key}", but no key was passed and the one the framework minted ` +
                `names nothing on the server. Pass your own key, or point create: at the collection URL.`
            );
        }
        // Tokens resolve from the ITEM's fields first, then params. Item-first
        // because the item IS the resource being addressed: under params-first,
        // favoriting a row that is not the currently-routed article would
        // address the route's article, return 200, and reconcile another row's
        // truth into this one. Where the item lacks the token (a parent id
        // that lives on the route, not the row), params supply it.
        const params = this._queryResolveParams(controller);
        const built = interpolateUrl(op.url, (t) => {
            const v = item == null ? undefined : item[t];
            return v == null ? (params ? params[t] : undefined) : v;
        });
        if (built.missing) {
            if (__DEV__) wfError(WF_ERRORS.QUERY_URL_TOKEN_UNRESOLVED, {
                warn: true,
                context: `Query "${controller.name}": the "${op.name}" URL "${op.url}" needs a value for ":${built.missing}"`,
                suggestion: `Carry ${built.missing} on the item being written, or supply it from params:`
            });
            throw new Error(
                `Query "${controller.name}": the URL token ":${built.missing}" in the "${op.name}" ` +
                `operation ("${op.url}") has no value on the item or in params, so nothing was sent.`
            );
        }
        const headers = this._queryHeaders(controller, built.url);
        // Taken before the engine adds Content-Type below: WF-986 concerns
        // the author's declared credentials only.
        const declaredHeaderCount = Object.keys(headers).length;
        const init = { method: op.method, headers };
        if (bodyFn) {
            // A key the FRAMEWORK minted is bookkeeping, not the author's data:
            // it exists so the optimistic row has an identity until the server
            // issues one. Sending it would let `body: item => item` — the
            // simplest declaration there is — POST an invented id the server
            // never asked for and might honor. A key the CALLER supplied is
            // their own data and passes through untouched.
            const payload = bodyFn(mintedKey ? omitKey(item, controller.key) : item);
            if (payload !== undefined) {
                headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify(payload);
            }
        } else if (__DEV__ && !controller._warnedBody) {
            // A body-less request is a legal declaration (some APIs take
            // everything in the path), so this names only the cases where
            // "no body" means "no effect".
            //
            // update/create: an item carrying fields with no way to send them
            // is a silent no-op — the exact failure the shape diagnostics
            // exist to name.
            //
            // A named operation is the opposite by default: its URL is
            // usually the verb (publish, favorite) and sending nothing is the
            // point, so warning on those would fire on correct code. The one
            // worth naming is a query that DID declare a query-level body,
            // which reaches update and create only: the author asked for a
            // payload and this operation quietly did not inherit it. delete
            // stays exempt either way, since a body-less DELETE is the norm.
            const droppedQueryBody = !inherits && op.name !== 'delete' &&
                typeof cfg.body === 'function';
            if (inherits || droppedQueryBody) {
                let carries = false;
                for (const f of Object.keys(item || {})) {
                    if (f !== controller.key) { carries = true; break; }
                }
                if (carries) {
                    controller._warnedBody = true;
                    wfError(WF_ERRORS.QUERY_BODY_MISSING, {
                        warn: true,
                        context: `Query "${controller.name}": the "${op.name}" request carries no body, but the item has fields to send`,
                        suggestion: droppedQueryBody
                            ? `A query-level body: reaches "update" and "create" only. Declare body on the "${op.name}" operation itself if it should send a payload`
                            : 'Declare the payload shape: body: item => item, or body: item => ({ article: item }) for an envelope API'
                    });
                }
            }
        }
        return fetch(built.url, init).then((resp) => {
            if (__DEV__) this._queryWarnRedirect(controller, built.url, resp, declaredHeaderCount);
            if (!resp.ok) return writeHttpError(resp); // status + parsed body ride the rejection
            if (!confirmFn) return undefined;   // transport only: the query refetches
            // Read as text first. A successful write often carries no body at
            // all — 204 is the ordinary answer to a DELETE, and plenty of APIs
            // answer a PATCH with 200 and nothing else. Parsing that directly
            // rejects, and a rejection HERE is indistinguishable from the
            // server refusing the write, so the change rolled back: the write
            // succeeded and the screen said it did not. An app cannot design
            // around it, because it does not own the endpoint. No content now
            // means what it says — accepted, nothing to apply — which lands on
            // the same refetch the no-confirmation case already takes.
            return resp.text().then((text) => {
                if (text === '') return undefined;
                let body;
                try {
                    body = JSON.parse(text);
                } catch (e) {
                    // Unparseable but not empty: still not a refusal. The
                    // status said ok, so the write stands and the query
                    // refetches; dev builds name it, since this one is
                    // usually a content-type mistake rather than a design.
                    if (__DEV__) wfError(WF_ERRORS.QUERY_WRITE_BODY_UNPARSED, {
                        warn: true,
                        context: `Query "${controller.name}": the "${op.name}" response was ${resp.status} ok but its body is not JSON; the write stands and the query refetches`,
                        suggestion: 'Have the endpoint answer with JSON or no content at all, or drop confirmation: on this operation if the body is never useful'
                    });
                    return undefined;
                }
                try {
                    // The written item rides along as the second argument. An
                    // ok response means one of three things and only the body
                    // can say which, so the choice belongs here rather than in
                    // the declaration: a 200 carrying { success: false } is a
                    // refusal wearing a success status, and no declared policy
                    // could tell the two apart. Return a record to reconcile
                    // it, throw to reject and roll back, or return the item to
                    // say the row is what was sent — accepted, with nothing to
                    // apply and no reason to go and look.
                    return confirmFn(body, item);
                } catch (e) {
                    // WF-998: the server answered ok, but the app's own
                    // confirmation: threw, so the write rejects and rolls
                    // back — indistinguishable from a server rejection
                    // unless someone says which function raised. Warn
                    // (dev builds), then let the rejection propagate
                    // exactly as before; additive only.
                    if (__DEV__) wfError(WF_ERRORS.QUERY_CONFIRMATION_THREW, {
                        warn: true,
                        context: `Query "${controller.name}": the "${op.name}" confirmation: threw (${e && e.message ? e.message : e}); the server answered ${resp.status} ok`,
                        suggestion: 'confirmation receives the parsed response body and the written item, not the Response; return the record to apply (confirmation: body => body), return the item to keep what was written, or nothing to refetch'
                    });
                    throw e;
                }
            });
        });
    },

    /**
     * WF-986 (bug-history survey ruling #2): declared headers rode a
     * cross-origin redirect. The platform strips exactly one header on
     * the hop — Authorization — and forwards the rest, and no framework
     * code runs between the two requests, so the engine can only notice
     * the leak, never prevent it. Named once per query through the R15
     * warnOnce gate (a redirecting endpoint is a standing condition),
     * for reads and writes alike, superseded responses included — the
     * request was made either way. The scrub-by-header-name alternative
     * is the one undici shipped three times (Authorization, then the
     * Cookie and Proxy-Authorization CVEs) and is wrong by construction:
     * the list is always missing one.
     */
    _queryWarnRedirect(controller, requestUrl, resp, declaredCount) {
        if (declaredCount === 0 || !resp || !resp.redirected) return;
        const from = urlOrigin(requestUrl);
        const to = urlOrigin(resp.url || '');
        if (from === to) return;
        if (!warnOnce(controller, WF_ERRORS.QUERY_REDIRECT_CROSS_ORIGIN)) return;
        wfError(WF_ERRORS.QUERY_REDIRECT_CROSS_ORIGIN, {
            warn: true,
            context: `Query "${controller.name}": the request to ${from} was redirected to ${to}, and the declared headers rode along — the platform strips only Authorization on a cross-origin hop`,
            suggestion: 'If the redirect is expected, point the URL at its final destination so the request starts where it ends; if it is not, credentials are leaving the origin they were declared for'
        });
    },

    /**
     * Record the rows a resolved URL produced, and remember that this URL is
     * what is now on screen. Insertion ordered, so the oldest entry is the
     * first key and re-inserting on a hit refreshes recency.
     *
     * Three bounds apply, all configurable (see the constants above): the URL
     * this one replaces is dropped when it held for less than the dwell
     * window, and the cache is then trimmed from the oldest until it is inside
     * both the entry cap and the row budget. The entry just written always
     * survives, so a single result larger than the whole budget still caches.
     *
     * The same provenance rule persistence follows applies here. Only server
     * truth is stored: a superseded run's rows belong to a different URL, an
     * accumulating query's rows span several, and rows carrying an unsettled
     * write are a local guess rather than an answer.
     */
    _querySnapshotSave(controller, url, id) {
        if (id !== controller.runId) return;
        controller.lastUrl = url;
        if (controller.accumulated || controller.pendingWrites > 0) return;
        const store = this.getStore(controller.name);
        if (!store) return;

        const bound = (v, d) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : d);
        const maxEntries = bound(this.options.queryCacheEntries, QUERY_CACHE_ENTRIES);
        const maxRows = bound(this.options.queryCacheRows, QUERY_CACHE_ROWS);
        const minDwell = bound(this.options.queryCacheMinDwell, QUERY_CACHE_MIN_DWELL);

        // A cap of zero is the off switch, and it releases what was held.
        if (maxEntries === 0) {
            if (controller.snapshots) controller.snapshots.clear();
            return;
        }

        if (!controller.snapshots) controller.snapshots = new Map();
        const m = controller.snapshots;

        // The URL this one replaces was a keystroke, not a view, if its
        // successor landed inside the window. A dwell of zero turns this off.
        const now = Date.now();
        if (controller.snapUrl && controller.snapUrl !== url
            && (now - controller.snapAt) < minDwell) {
            m.delete(controller.snapUrl);
        }

        if (m.has(url)) m.delete(url);
        m.set(url, (rgToRaw(store.rows) || []).map(rgToRaw));
        controller.snapUrl = url;
        controller.snapAt = now;

        let rows = 0;
        for (const v of m.values()) rows += v.length;
        while (m.size > 1 && (m.size > maxEntries || rows > maxRows)) {
            const oldest = m.keys().next().value;
            rows -= m.get(oldest).length;
            m.delete(oldest);
        }
    },

    /**
     * `select:` turns a parsed read response into rows. It exists because the
     * ingest path normalizes a non-array into a single row that IS the
     * envelope, so an API answering { articles: [...], articlesCount: n }
     * would otherwise produce one row with the fields `articles` and
     * `articlesCount`. Absent, the parsed response is used as-is, which is
     * correct for an API that returns a bare array.
     *
     * The two diagnostics here are visibility, NOT validation: a schema layer
     * would need a schema language (a dependency and an authoring surface in
     * a framework whose identity is no build step) and would duplicate what
     * the server's contract already asserts. What was missing was a name for
     * two silent failures, and that is what these give.
     */
    _querySelect(controller, data) {
        const select = controller.config.select;
        if (typeof select === 'function') data = select(data);
        if (__DEV__ && !controller.hasRecord) {
            // Gated on hasRecord: a record-shaped query (bound with no
            // <template>) legitimately answers with a single object, and
            // warning there would fire on correct code.
            const declared = typeof select === 'function';
            if (data == null) {
                if (warnOnce(controller, WF_ERRORS.QUERY_SELECT_SHAPE)) wfError(WF_ERRORS.QUERY_SELECT_SHAPE, {
                    warn: true,
                    context: `Query "${controller.name}": the read resolved ${data === null ? 'null' : 'undefined'}, so the list is now empty`,
                    suggestion: declared
                        ? 'Either the server sent nothing, or select: missed — log its argument to tell the two apart'
                        : 'If the response is an envelope, name the array: select: d => d.items'
                });
            } else if (!Array.isArray(data)) {
                if (warnOnce(controller, WF_ERRORS.QUERY_SELECT_SHAPE)) wfError(WF_ERRORS.QUERY_SELECT_SHAPE, {
                    warn: true,
                    context: `Query "${controller.name}": the read resolved a non-array, which becomes ONE row whose fields are that object's`,
                    suggestion: declared
                        ? 'select: must return the array of rows'
                        : 'If the response is an envelope, name the array: select: d => d.items'
                });
            }
        }
        return data;
    },

    /**
     * Declared params, resolved ONCE per request. A function form states what
     * the query fetches rather than making the application push values per
     * call, and resolving here (not per attempt) means a retry re-issues the
     * values that failed instead of whatever the app's state says later.
     */
    _queryResolveParams(controller) {
        const declared = controller.config.params;
        if (typeof declared !== 'function') return declared || null;
        try {
            return declared() || null;
        } catch (e) {
            if (__DEV__ && warnOnce(controller, WF_ERRORS.QUERY_PARAMS_THREW)) wfError(WF_ERRORS.QUERY_PARAMS_THREW, {
                warn: true,
                context: `Query "${controller.name}": the params function threw`,
                cause: e
            });
            return null;
        }
    },

    /**
     * Request headers for one attempt. Resolved per attempt, synchronously,
     * because a bearer token can be refreshed between a failure and its
     * retry and the retry must carry the current one.
     *
     * The framework-level default is scoped BY ORIGIN: `from`/`to` may name
     * any origin, so an unscoped default credential would be sent to third
     * parties. It also makes "which origins receive credentials" a declared,
     * machine-readable fact, which is the point of this whole surface.
     */
    _queryHeaders(controller, url) {
        const out = {};
        const defaults = this._queryHeaderDefaults();
        const merge = (src) => {
            if (src == null) return;
            let v = src;
            if (typeof v === 'function') {
                try {
                    v = v();
                } catch (e) {
                    if (__DEV__ && warnOnce(controller, WF_ERRORS.QUERY_HEADERS_INVALID)) wfError(WF_ERRORS.QUERY_HEADERS_INVALID, {
                        warn: true,
                        context: `Query "${controller.name}": a headers function threw; the request goes without those headers`,
                        cause: e
                    });
                    return;
                }
            }
            if (v == null) return;
            if (typeof v !== 'object') {
                if (__DEV__ && warnOnce(controller, WF_ERRORS.QUERY_HEADERS_INVALID)) wfError(WF_ERRORS.QUERY_HEADERS_INVALID, {
                    warn: true,
                    context: `Query "${controller.name}": headers resolved to ${typeof v}; ignored`,
                    suggestion: 'headers: { Authorization: ... } or headers: () => ({ Authorization: ... })'
                });
                return;
            }
            for (const h of Object.keys(v)) {
                if (v[h] != null) out[h] = String(v[h]);
            }
        };
        if (defaults) {
            const origin = urlOrigin(url);
            const hit = defaults.get(origin);
            if (__DEV__ && hit === undefined && defaults.size > 0) {
                this._queryHeadersOriginMiss(controller, origin, defaults);
            }
            merge(hit);
        }
        merge(controller.config.headers);   // the query's own declaration wins
        return out;
    },

    /**
     * WF-993 (survey pass two, Lane F #4): a config({ headers }) key no
     * request can ever match — the wrong scheme, an explicit port the
     * request URLs never spell (`:443`), an http key beside https
     * queries — means the credential never ships, with no trace: the
     * request is legal, the server just never sees the header. Origins
     * compare exactly, and the engine must not loosen the match (the
     * scoping IS the security property); what it can do is notice the
     * NEAR-miss — same host, different scheme or port — at the first
     * request that fails it, and name both sides. Once per declared key,
     * reset when the config object changes. The document's own origin is
     * excluded as a candidate: a `self` declaration hit by another local
     * port is a deliberate scope, not a misspelling of the request's
     * origin. A declared origin whose host no request ever touches stays
     * silent — there is nothing to compare it against.
     */
    _queryHeadersOriginMiss(controller, origin, defaults) {
        if (!__DEV__) return;
        const hostOf = (o) => {
            const i = o.indexOf('//');
            const h = i >= 0 ? o.slice(i + 2) : o;
            return h.replace(/:\d+$/, '');
        };
        const oh = hostOf(origin);
        if (!oh) return;
        const selfOrigin = urlOrigin('');
        for (const declared of defaults.keys()) {
            if (declared === selfOrigin || hostOf(declared) !== oh) continue;
            if (!this._queryHeaderMissWarned) this._queryHeaderMissWarned = new Set();
            if (this._queryHeaderMissWarned.has(declared)) return;
            this._queryHeaderMissWarned.add(declared);
            wfError(WF_ERRORS.QUERY_HEADERS_ORIGIN_MISS, {
                warn: true,
                context: `config({ headers }): "${declared}" never matches this request's origin "${origin}" (query "${controller.name}") — same host, but origins compare exactly on scheme, host, and port, so those headers are not sent`,
                suggestion: `Key the entry by the exact origin the requests use ('${origin}'), or 'self' for the document's own origin`
            });
            return;
        }
    },

    /**
     * The framework-level header default, from
     * `wildflower.config({ headers: { <origin>: value } })`, normalized once
     * per config object into an origin-keyed Map.
     *
     * Keyed by ORIGIN because `from`/`to` may name any host: an unscoped
     * default credential would be sent to third parties by an application
     * that merely added one third-party query. Scoping it also makes "which
     * origins receive credentials" a single declared fact a reader can check
     * — the same goal the rest of this surface serves.
     *
     * `'self'` is the document's own origin, spelled the way CSP spells it,
     * and it is what a relative URL matches. It stays a literal in the
     * source, where `[location.origin]` would be a computed key that no
     * static reader could resolve.
     */
    _queryHeaderDefaults() {
        const src = (this.options && this.options.headers) || null;
        if (!src || typeof src !== 'object') return null;
        if (this._queryHeaderSrc === src) return this._queryHeaderMap;
        const map = new Map();
        for (const k of Object.keys(src)) {
            if (k === 'self') {
                map.set(urlOrigin(''), src[k]);
                continue;
            }
            if (__DEV__ && k.indexOf('//') < 0) {
                wfError(WF_ERRORS.QUERY_HEADERS_INVALID, {
                    warn: true,
                    context: `config({ headers }): "${k}" is not an origin, so no request will ever match it`,
                    suggestion: "Keys are origins ('https://api.example.com') or 'self' for this document's own origin"
                });
                continue;
            }
            map.set(urlOrigin(k), src[k]);
        }
        this._queryHeaderSrc = src;
        this._queryHeaderMap = map;
        this._queryHeaderMissWarned = null; // fresh config, fresh WF-993 once-gates
        return map;
    },

    /** Rename a row's key in place (temp-id correction). A raw rows-only
     *  write that preserves position, so the follow-up reconcile MATCHES
     *  the row and claim-honor protects other in-flight writes' fields.
     *  If the entity ALREADY arrived under its real key (an out-of-band
     *  push raced the create's confirm), the tmp twin is dropped instead —
     *  carrying fields still claimed by pending writes onto the survivor,
     *  so no duplicate row survives and no optimistic edit is lost. */
    _queryRenameRowKey(controller, oldK, newK, carryFields) {
        const store = this.getStore(controller.name);
        if (!store) return;
        const key = controller.key;
        const rows = rgToRaw(store.rows) || [];
        let tmpRow = null;
        let hasNew = false;
        for (const r0 of rows) {
            const r = rgToRaw(r0);
            if (r == null) continue;
            if (r[key] === oldK) tmpRow = r;
            else if (r[key] === newK) hasNew = true;
        }
        if (tmpRow === null) return;
        let changed = false;
        const next = [];
        for (const r0 of rows) {
            const r = rgToRaw(r0);
            if (r != null && r[key] === oldK) {
                changed = true;
                if (hasNew) continue; // twin exists under the real key: drop the tmp row
                next.push(Object.assign({}, r, { [key]: newK }));
            } else if (hasNew && r != null && r[key] === newK && carryFields && carryFields.size > 0) {
                const merged = Object.assign({}, r);
                for (const f of carryFields) {
                    if (f in tmpRow) merged[f] = tmpRow[f];
                }
                changed = true;
                next.push(merged);
            } else {
                next.push(r);
            }
        }
        if (changed) engineWrite(() => { store.rows = next; });
    },

    /** Remove one row by key (create rollback). A rows-only write: no
     *  flags move, so the choke point's flags-first ordering holds by
     *  construction. For an unkeyed (record) rollback `k` is undefined
     *  and matches rows that lack the key field. */
    _queryRemoveRow(controller, k) {
        const store = this.getStore(controller.name);
        if (!store) return;
        const key = controller.key;
        const rows = rgToRaw(store.rows) || [];
        // Raw carry, same invariant as the ingest: rows written to the
        // graph are never facade proxies.
        const next = rows.filter((r) => !(r != null && r[key] === k)).map(rgToRaw);
        if (next.length !== rows.length) {
            engineWrite(() => { store.rows = next; });
        }
    },
};
