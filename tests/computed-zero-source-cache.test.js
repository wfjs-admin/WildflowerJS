/**
 * Zero-source computed cache — the "unwatched computed" seal (engine half).
 *
 * A computed node with NO tracked sources can never be woken by the graph:
 * nothing exists that could mark it dirty. The engine already recognized this
 * for the ERROR case (evaluateComputed's ERRORED-cache recovery re-runs a
 * thrown, source-less computed on every read so it can heal). But a computed
 * that RETURNS a value while tracking nothing was cached forever — succeeding
 * with a wrong value was strictly worse than throwing.
 *
 * Anatomy of the trap (probed 2026-07-17):
 *   1. The framework eagerly evaluates computeds during setup, BEFORE init().
 *   2. A computed reading a plain `_` field (set in init) evaluates to
 *      undefined, successfully, with zero sources.
 *   3. init() sets the field — non-reactively, correctly per the `_` contract.
 *   4. The cache serves undefined forever. One evaluation, ever.
 *
 * The seal generalizes the engine's own rule: a source-less node's cache is
 * untrustworthy however the eval ended — re-run on every read. This gives
 * zero-source computeds METHOD semantics (fresh on pull, no push), which is
 * exactly the `_` mental model. Sourced computeds are untouched: they cache
 * and invalidate through the graph as always (pinned below).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('Zero-source computed cache', () => {
    let container;
    let wf;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wf = window.wildflower;
        resetFramework();
        if (wf._initContextSystem) {
            wf._contextSystemInitialized = false;
            wf._initContextSystem();
        }
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    const waitForInit = () => new Promise(resolve => setTimeout(resolve, 50));

    const ctxOf = (name) => wf.getComponentsByType(name)[0].context;

    it('a computed over an init-set `_` field reads fresh after init (was: frozen undefined)', async () => {
        wf.component('zs-underscore', {
            state: { unused: 1 },
            computed: { fromPlain() { return this._v; } },
            init() { this._v = 'INIT-SET'; }
        });
        container.innerHTML = '<div data-component="zs-underscore"></div>';
        wf.scan();
        await waitForInit();
        expect(String(ctxOf('zs-underscore').fromPlain)).toBe('INIT-SET');
    });

    it('zero-source computeds have method semantics: fresh on every pull read', async () => {
        wf.component('zs-pull', {
            state: { unused: 1 },
            computed: { fromPlain() { return this._v; } },
            init() { this._v = 'A'; }
        });
        container.innerHTML = '<div data-component="zs-pull"></div>';
        wf.scan();
        await waitForInit();
        const ctx = ctxOf('zs-pull');
        expect(String(ctx.fromPlain)).toBe('A');
        ctx._v = 'B';
        expect(String(ctx.fromPlain)).toBe('B');
    });

    it('conditional deps: a computed that tracked nothing on first eval un-freezes once its guard opens', async () => {
        // First eval: _ready falsy -> returns fallback, reads NOTHING reactive
        // -> zero sources. Previously frozen at the fallback forever, even
        // after the guard opened. Now it re-runs per read until it acquires
        // real sources, then caches normally.
        wf.component('zs-conditional', {
            state: { items: [1, 2, 3] },
            computed: {
                count() {
                    if (!this._ready) return -1;
                    return this.items.length;
                }
            },
            init() { this._ready = false; }
        });
        container.innerHTML = '<div data-component="zs-conditional"></div>';
        wf.scan();
        await waitForInit();
        const ctx = ctxOf('zs-conditional');
        expect(ctx.count).toBe(-1);
        ctx._ready = true;
        expect(ctx.count).toBe(3);
    });

    it('B-parity pin: a throwing source-less computed still heals when its input appears', async () => {
        wf.component('zs-thrower', {
            state: { unused: 1 },
            computed: { lateLen() { return this._late.length; } },
            init() { this._late = null; }
        });
        container.innerHTML = '<div data-component="zs-thrower"></div>';
        wf.scan();
        await waitForInit();
        const ctx = ctxOf('zs-thrower');
        expect(ctx.lateLen).toBeUndefined();
        ctx._late = [1, 2, 3];
        expect(ctx.lateLen).toBe(3);
    });

    it('REGRESSION GUARD: sourced computeds still cache (no re-eval without a dep change)', async () => {
        let evals = 0;
        wf.component('zs-cached', {
            state: { x: 2 },
            computed: { doubled() { evals++; return this.x * 2; } }
        });
        container.innerHTML = '<div data-component="zs-cached"></div>';
        wf.scan();
        await waitForInit();
        const ctx = ctxOf('zs-cached');
        expect(ctx.doubled).toBe(4);
        const after = evals;
        // Repeated pull reads must serve the cache — no growth.
        void ctx.doubled; void ctx.doubled; void ctx.doubled;
        expect(evals).toBe(after);
        // A real dep change still invalidates and re-evaluates.
        ctx.x = 5;
        expect(ctx.doubled).toBe(10);
        expect(evals).toBeGreaterThan(after);
    });

    // A read-forced re-run is a pull, so it must not push. Before the fix, each
    // re-run returned a new object, woke the reader's effect, and two lists plus
    // a binding on one list's host kept waking each other until the flush loop
    // breaker tripped (found by a Kinetic showreel, reproduced without Kinetic).
    it('a source-less computed returning a new object does not wake its readers on each read', async () => {
        const errors = [];
        const origError = console.error;
        console.error = (...a) => { errors.push(a.join(' ')); };
        try {
            wf.component('zs-object', {
                state: { t: 0 },
                computed: {
                    offsets() { return { 0: 0, 1: 1, 2: 2 }; },
                    rows() { return [0, 1].map((i) => ({ key: i, text: String(this.t + this.offsets[i]) })); },
                    hostStyle() { return { opacity: String((this.t + this.offsets[2]) / 10) }; },
                    word() { return [{ key: 'w', text: String(this.t - this.offsets[1]) }]; },
                },
            });
            container.innerHTML = '<div data-component="zs-object">'
                + '<div id="zs-rows" data-bind-style="hostStyle" data-list="rows" data-key="key"><template><i data-bind="text"></i></template></div>'
                + '<p id="zs-word" data-list="word" data-key="key"><template><span data-bind="text"></span></template></p>'
                + '</div>';
            wf.scan();
            await waitForInit();
            const ctx = ctxOf('zs-object');
            for (let n = 1; n <= 3; n++) {
                ctx.t = n;
                await new Promise((r) => setTimeout(r, 20));
            }
            expect(errors.filter((e) => /loop breaker|WF-238/.test(e))).toEqual([]);
            expect(container.querySelector('#zs-rows').textContent).toBe('34');
            expect(container.querySelector('#zs-rows').style.opacity).toBe('0.5');
            expect(container.querySelector('#zs-word').textContent).toBe('2');
        } finally {
            console.error = origError;
        }
    });
});
