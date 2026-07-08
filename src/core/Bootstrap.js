/**
 * WildflowerJS Bootstrap
 *
 * Reads configuration from script tag and creates the global instance.
 * This file MUST be loaded last after all mixins have been applied.
 *
 * @module Bootstrap
 */

import { startTimelineRecording, stopTimelineRecording, getTimelineSnapshot } from '../state/TimelineRecorder.js';

// Read configuration from script tag before creating instance
// Usage: <script src="wildflower.js" data-debug="true" data-error-handling="throw"></script>
let _scriptConfig = {};
if (typeof document !== 'undefined' && document.currentScript) {
    const script = document.currentScript;

    // Debug mode: data-debug="true"
    if (script.hasAttribute('data-debug')) {
        const debugValue = script.getAttribute('data-debug');
        _scriptConfig.debug = debugValue === 'true' || debugValue === '';
    }

    // Error handling: data-error-handling="log|throw|silent"
    if (script.hasAttribute('data-error-handling')) {
        const errorVal = script.getAttribute('data-error-handling');
        if (errorVal === 'log' || errorVal === 'throw' || errorVal === 'silent') {
            _scriptConfig.errorHandling = errorVal;
        } else if (__DEV__) {
            console.warn(`[WF] Invalid data-error-handling="${errorVal}". Must be 'log', 'throw', or 'silent'.`);
        }
    }

    // Auto-init: data-auto-init="false" to disable
    if (script.hasAttribute('data-auto-init')) {
        _scriptConfig.autoInit = script.getAttribute('data-auto-init') !== 'false';
    }

    // Exclusive prefix mode: data-wf-prefix="true"
    if (script.hasAttribute('data-wf-prefix')) {
        _scriptConfig.useWfPrefixOnly = script.getAttribute('data-wf-prefix') === 'true';
    }

    // CSP-safe mode: data-csp-safe (bare attribute or ="true").
    // Sets forceCSPMode BEFORE construction, so the framework never runs its
    // `new Function` capability probe — a strict-CSP page loads with zero
    // securitypolicyviolation events / CSP reports. Without the attribute the
    // probe still auto-detects and falls back, at the cost of one benign
    // violation report at startup.
    if (script.hasAttribute('data-csp-safe')) {
        const cspVal = script.getAttribute('data-csp-safe');
        _scriptConfig.forceCSPMode = cspVal === 'true' || cspVal === '';
    }
}

/**
 * Create the DevTools global hook for browser extension integration.
 * Provides a serialization-safe API that extensions can call via
 * chrome.devtools.inspectedWindow.eval() to introspect the framework.
 */
function _createDevToolsHook(wf) {
    const L = new Map();
    // Keep refs to the document listeners so _dispose() can remove them; the
    // hook holds `framework: wf`, so an unremoved listener pins the whole
    // framework instance across mount/unmount cycles (multi-instance/test paths).
    wf._devToolsListeners = wf._devToolsListeners || [];
    ['componentInit','componentDestroy','store-ready','routeChange'].forEach(n => {
        const evt = 'wildflower:' + n;
        const fn = e => {
            const s = L.get(n); if (s) s.forEach(f => { try { f(e.detail); } catch {} });
        };
        document.addEventListener(evt, fn);
        wf._devToolsListeners.push({ event: evt, handler: fn });
    });
    // Shared: serialize stateManager._state to plain object
    const ss = sm => {
        const o = {}; if (!sm?._state) return o;
        try { for (const k of Object.keys(sm._state)) if (!k.startsWith('_')) try { o[k] = sm._state[k]; } catch { o[k] = '(error)'; } } catch {}
        return o;
    };
    const hook = {
        // version: framework version reported to DevTools (v1.2 dev line).
        // schemaVersion: the hook *contract* version; the extension feature-
        // detects capabilities off this, NOT the framework version. Start at 1.
        // dev: true on development builds; false on minified production builds
        // (the extension uses it to show which introspection is available).
        version: '1.2.0', schemaVersion: 1, dev: __DEV__, framework: wf,
        getComponents() {
            const r = [];
            wf.componentInstances.forEach((i, id) => {
                if (i.isVirtual) return;
                const c = {}; try { const d = i.definition; if (d?.computed) for (const k of Object.keys(d.computed)) try { c[k] = i.context[k]; } catch { c[k] = '(error)'; } } catch {}
                r.push({ id, name: i.name, tag: i.element?.tagName?.toLowerCase() || null, state: ss(i.stateManager), computed: c, props: i.props || {}, stores: i.definition?.stores || [], poolCount: i._pools?.size || 0, parentId: wf.componentParents?.get(id) || null });
            });
            return r;
        },
        getStores() {
            const r = [], s = wf.storeManager?._namedStores; if (!s) return r;
            s.forEach((st, n) => {
                const m = []; try { for (const k of Object.keys(st)) if (typeof st[k] === 'function' && !k.startsWith('_')) m.push(k); } catch {}
                r.push({ name: n, state: ss(st.stateManager), methods: m });
            });
            return r;
        },
        getPools() {
            const r = [];
            wf.componentInstances.forEach(i => { if (!i._pools) return; i._pools.forEach((p, n) => { r.push({ name: n, owner: i.name, ownerId: i.id, entityCount: p.items?.length ?? 0, recycleSize: p.recycleSize ?? 0, keyProp: p._keyProp || 'id', targetFps: p._targetFps || null }); }); });
            return r;
        },
        getBindings() {
            const d = wf.domElements, r = []; if (!d) return r;
            const c = (a, t) => { if (a) a.forEach(b => r.push({ type: t, path: b.path || '', componentId: b.componentId || null, tag: b.element?.tagName?.toLowerCase() || null })); };
            c(d.bindings,'bind'); c(d.htmlBindings,'html'); c(d.conditionals,'show'); c(d.models,'model'); c(d.lists,'list'); c(d.pools,'pool');
            return r;
        },
        getRoutes() {
            const rt = wf.RouteManager?._activeRouter; if (!rt) return null;
            const sr = r => r ? { path: r.path || r.pattern || null, name: r.name || null, params: r.params || {}, query: r.query || {}, hash: r.hash || null, meta: r.meta || {} } : null;
            const rr = []; try { if (rt.routeTree) for (const r of rt.routeTree) rr.push({ path: r.path || r.pattern || '?', name: r.name || null, meta: r.meta || {}, hasGuard: !!r.beforeEnter, hasChildren: !!(r.children?.length) }); } catch {}
            return { current: sr(rt.currentRoute), previous: sr(rt.previousRoute), routes: rr, mode: rt.options?.mode || 'history', base: rt.options?.base || '/', defaultRoute: rt.options?.defaultRoute || null, guardCount: { beforeEach: rt.guards?.beforeEach?.length || 0, afterEach: rt.guards?.afterEach?.length || 0 }, isNavigating: rt.isNavigating || false };
        },
        setState(id, p, v) { const i = wf.getComponentInstance(id); if (i?.stateManager?._state) { i.stateManager._state[p] = v; return true; } return false; },
        setStoreState(n, p, v) { const s = wf.getStore(n); if (s?.stateManager?._state) { s.stateManager._state[p] = v; return true; } return false; },
        on(e, f) { if (!L.has(e)) L.set(e, new Set()); L.get(e).add(f); },
        off(e, f) { const s = L.get(e); if (s) s.delete(f); }
    };
    if (__DEV__) {
        // Introspection surface: dev builds only, stripped wholesale from
        // production (the schemaVersion/version/dev fields above stay so the
        // extension can detect a prod build and report limited introspection).
        // All getters are pollable (request/response via inspectedWindow.eval),
        // each entry self-describing (ownerKind/ownerId/ownerName) so the panel
        // can group client-side from a single poll.

        // Per-frame microtask/rAF timeline (coarse). Off by default;
        // start/stop toggles the hot-path recorder, getTimelineSnapshot polls
        // while recording. See TimelineRecorder.
        hook.startTimelineRecording = function (opts) { startTimelineRecording(opts || {}); return true; };
        hook.stopTimelineRecording = function () { return stopTimelineRecording(); };
        hook.getTimelineSnapshot = function () { return getTimelineSnapshot(); };

        // Registered component + store definitions (for an anti-pattern validator).
        hook.getDefinitions = function () {
            const components = [];
            if (wf.componentDefinitions) wf.componentDefinitions.forEach((d, name) => {
                const methods = []; try { for (const k of Object.keys(d)) if (typeof d[k] === 'function') methods.push(k); } catch {}
                components.push({ name, hasState: !!d.state, stateKeys: (d.state && typeof d.state !== 'function') ? Object.keys(d.state) : [], computed: d.computed ? Object.keys(d.computed) : [], methods, stores: Array.isArray(d.stores) ? d.stores.slice() : [], props: d.props ? Object.keys(d.props) : [], hasTemplate: !!d.template, hasPools: !!d.pools });
            });
            const stores = [], sm = wf.storeManager?._namedStores;
            if (sm) sm.forEach((st, n) => {
                const methods = []; try { for (const k of Object.keys(st)) if (typeof st[k] === 'function' && !k.startsWith('_')) methods.push(k); } catch {}
                const computed = []; try { const cn = st.stateManager?.getComputedPropertyNames?.(); if (cn) for (const k of cn) computed.push(k); } catch {}
                stores.push({ name: n, methods, computed });
            });
            return { components, stores };
        };
    }
    return hook;
}

// Create a global instance for easy access

/**
 * Create and configure the WildflowerJS instance
 * @param {typeof WildflowerJS} WildflowerClass - The WildflowerJS class (with all mixins applied)
 * @returns {WildflowerJS} Configured instance
 */
export function createInstance(WildflowerClass) {
    const instance = new WildflowerClass(document, _scriptConfig);

    // Expose globals for script tag usage
    if (typeof window !== 'undefined') {
        window.WildflowerJS = WildflowerClass;
        window.wildflower = instance;

        // DevTools global hook: enables browser extensions to introspect the framework
        window.__WF_DEVTOOLS_GLOBAL_HOOK__ = _createDevToolsHook(instance);
    }

    return instance;
}
