/**
 * observeElement's prune-then-add (QuerySystem.js) walks the ENTIRE
 * controller.elements set on every single observation to evict disconnected
 * nodes. That is the only reclamation for a rungless query (no poll/focus/
 * etc rung ever runs _queryLifecycleCheck to sweep it instead), so it can't
 * simply be removed — but sweeping unconditionally on every add makes
 * binding N simultaneous views of the same query O(n^2): each of the N
 * additions re-checks every element added so far, even though nothing
 * disconnected in between.
 *
 * This pins the fix's shape (v1.5.3 candidate #1): the small/common case (a
 * handful of views, well below any threshold) sweeps on every add exactly as
 * before — see data-query-leak.test.js for those pinned correctness cases,
 * unchanged here — but once the set grows past a watermark, sweeps become
 * periodic rather than per-add, so the total isConnected work across N adds
 * stays roughly linear instead of quadratic.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-obs-${++seq}`

suite('data-query: observeElement sweep cost at scale', () => {
    let wildflower
    let mounts

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        mounts = []
    })

    afterEach(() => {
        for (const el of mounts) if (el.parentNode) el.parentNode.removeChild(el)
        mounts = []
    })

    // Each mount is its own component instance with its own record-shape
    // [data-query] element (no <template>, so it binds as a "record" view
    // rather than a list) — the "many views of one query" shape the original
    // finding names. None are removed during the loop, so every isConnected
    // read the sweep performs on a PRIOR element comes back true: nothing
    // here needs pruning, so a correct amortized sweep should do very little
    // of this work, where the naive full-sweep-per-add does O(n) work n times.
    function mountView(qname, cname) {
        const el = document.createElement('div')
        el.innerHTML = `<div data-component="${cname}"><span data-query="${qname}"></span></div>`
        document.body.appendChild(el)
        wildflower.component(cname, { state: {} })
        wildflower.scan(el)
        mounts.push(el)
    }

    it('adding N simultaneous query views costs sub-quadratic isConnected reads', () => {
        const q = uname('q')
        wildflower.query(q, { from: async () => ({ id: 1, name: 'x' }) })

        const N = 200
        const desc = Object.getOwnPropertyDescriptor(Node.prototype, 'isConnected')
        let reads = 0
        Object.defineProperty(Node.prototype, 'isConnected', {
            configurable: true,
            get() { reads++; return desc.get.call(this) }
        })
        try {
            for (let i = 0; i < N; i++) {
                mountView(q, uname('c'))
            }
        } finally {
            Object.defineProperty(Node.prototype, 'isConnected', desc)
        }

        const controller = wildflower._queryControllers.get(q)
        expect(controller.elements.size).toBe(N)
        // Naive full-sweep-per-add costs sum_{i=0}^{N-1} i = N(N-1)/2 reads
        // (19,900 for N=200). A watermark/amortized sweep keeps this within
        // a small constant multiple of N; 10x is generous headroom while
        // still failing hard against the quadratic implementation.
        expect(reads).toBeLessThan(N * 10)
    })
})
