/**
 * DevTools global hook (window.__WF_DEVTOOLS_GLOBAL_HOOK__) — v1.2 surface.
 *
 * Covers Phase 0 (contract: schemaVersion, dev flag, version) and getDefinitions.
 *
 * Gating: the introspection getters are dev-only — they are attached only on
 * development builds and stripped wholesale from minified production builds. Only
 * the contract fields (version / schemaVersion / dev) ship in every build. So the
 * contract test runs everywhere; the functional tests early-return on production
 * builds (where the getters do not exist).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

async function nextTick(ms = 50) {
    await new Promise(r => setTimeout(r, ms))
}

function hook() {
    return window.__WF_DEVTOOLS_GLOBAL_HOOK__
}

describe('DevTools hook v1.2 surface', () => {
    let wildflower
    beforeAll(async () => { await loadFramework() })
    beforeEach(() => { wildflower = window.wildflower; resetFramework() })

    it('Phase 0 contract: version/schemaVersion/dev ship in all builds; getters are dev-only', () => {
        const h = hook()
        expect(h, 'global hook should exist in every build').toBeTruthy()
        expect(h.version).toBe('1.5.2')
        // wildflower.version is the same build-time string (from package.json).
        expect(wildflower.version).toBe(h.version)
        expect(h.schemaVersion).toBe(1)
        expect(typeof h.dev).toBe('boolean')
        // dev builds are the non-minified ones; min builds strip the dev surface.
        expect(h.dev).toBe(!isMinifiedBuild())

        if (h.dev) {
            expect(typeof h.getDefinitions).toBe('function')
        } else {
            // Production: the entire introspection surface is stripped.
            expect(h.getDefinitions).toBeUndefined()
        }
    })

    it('getDefinitions lists registered component definitions and their shape', async () => {
        const h = hook()
        if (!h.dev) return

        const container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
        try {
            wildflower.component('dt-def', {
                state: { count: 0 },
                computed: { doubled() { return this.state.count * 2 } },
                inc() { this.state.count++ },
                reset() { this.state.count = 0 }
            })
            container.innerHTML = `<div data-component="dt-def"><span data-bind="doubled"></span></div>`
            wildflower.scan()
            await nextTick()

            const defs = h.getDefinitions()
            expect(Array.isArray(defs.components)).toBe(true)
            const def = defs.components.find(c => c.name === 'dt-def')
            expect(def, 'dt-def definition should be listed').toBeTruthy()
            expect(def.hasState).toBe(true)
            expect(def.stateKeys).toContain('count')
            expect(def.computed).toContain('doubled')
            expect(def.methods).toEqual(expect.arrayContaining(['inc', 'reset']))
        } finally {
            container.remove()
        }
    })

    // The Queries tab reads everything from one getQueries() poll; this pins
    // the enriched payload contract: sync flags, rung summary, shape, and
    // write machinery.
    it('getQueries reports flags, rungs, shape, and write-machinery pressure', async () => {
        const h = hook()
        if (!h.dev || !hasFeature('query')) return

        const realFetch = window.fetch
        try {
            window.fetch = () => Promise.resolve(new Response(JSON.stringify([{ id: 1, v: 'x' }]), { status: 200 }))
            wildflower.query('dt-q-hookpin', {
                from: '/api/x', key: 'id',
                refresh: ['focus', 'fresh:60'],
                to: () => Promise.resolve()
            })
            wildflower.getQuery('dt-q-hookpin')  // observer edge → activation fetch
            await nextTick()

            const q = h.getQueries().find(x => x.name === 'dt-q-hookpin')
            expect(q, 'registered query should be listed').toBeTruthy()
            expect(q.active).toBe(true)
            expect(q.rows).toBe(1)
            expect(q.record, 'list shape').toBe(false)
            expect(q.key).toBe('id')
            expect(q.hasTo, 'declared write transport').toBe(true)
            expect(q.rungs.focus).toBe(true)
            expect(q.rungs.fresh).toBe(60)
            expect(q.flags.isLoading, 'load settled').toBe(false)
            expect(q.flags.lastSync, 'synced').toBeTruthy()
            expect(q.writes).toEqual({ pending: 0, fieldClaims: 0, rowClaims: 0 })
        } finally {
            window.fetch = realFetch
        }
    })

    // Review finding: hasTo must be true for the DECLARATIVE forms too. The
    // headline v1.5 declaration is a URL string or an operation map, and
    // `typeof to === 'function'` reported "no write transport" for both.
    it('getQueries reports hasTo for the declarative to: forms', async () => {
        const h = hook()
        if (!h.dev || !hasFeature('query')) return

        const realFetch = window.fetch
        try {
            window.fetch = () => Promise.resolve(new Response(JSON.stringify([{ id: 1 }]), { status: 200 }))
            wildflower.query('dt-q-tourl', { from: '/api/a', key: 'id', to: '/api/a/:id' })
            wildflower.query('dt-q-tomap', { from: '/api/b', key: 'id', to: { update: '/api/b/:id' } })
            wildflower.getQuery('dt-q-tourl')
            wildflower.getQuery('dt-q-tomap')
            await nextTick()

            expect(h.getQueries().find(x => x.name === 'dt-q-tourl').hasTo, 'URL-string to:').toBe(true)
            expect(h.getQueries().find(x => x.name === 'dt-q-tomap').hasTo, 'operation-map to:').toBe(true)
        } finally {
            window.fetch = realFetch
        }
    })

    // Coverage:the pressure gauges under actual
    // pressure — a poll during an in-flight write reports the pending
    // count and live claims, and the settle drains them.
    it('getQueries reports live write pressure mid-flight and its drain', async () => {
        const h = hook()
        if (!h.dev || !hasFeature('query')) return

        const realFetch = window.fetch
        let release
        try {
            window.fetch = () => Promise.resolve(new Response(JSON.stringify([{ id: 1, a: 1, b: 2 }]), { status: 200 }))
            wildflower.query('dt-q-pressure', {
                from: '/api/x', key: 'id',
                to: () => new Promise(res => { release = res })
            })
            const store = wildflower.getQuery('dt-q-pressure')
            await nextTick()

            const p = store.write({ id: 1, a: 10, b: 20 })
            await nextTick(10)
            let q = h.getQueries().find(x => x.name === 'dt-q-pressure')
            expect(q.writes.pending, 'one write in flight').toBe(1)
            expect(q.writes.fieldClaims, 'two fields claimed').toBe(2)
            expect(q.flags.isStale, 'optimistic state reads stale').toBe(true)

            release({ id: 1, a: 10, b: 20 })
            await p
            await nextTick(10)
            q = h.getQueries().find(x => x.name === 'dt-q-pressure')
            expect(q.writes, 'the settle drained everything').toEqual({ pending: 0, fieldClaims: 0, rowClaims: 0 })
        } finally {
            window.fetch = realFetch
        }
    })

    // Coverage:a registered-but-never-observed query
    // must appear in the poll as inactive with an intact empty state, not
    // crash the getter.
    it('getQueries reports a never-observed query as inactive with empty state', async () => {
        const h = hook()
        if (!h.dev || !hasFeature('query')) return

        wildflower.query('dt-q-dormant', { from: '/api/never', key: 'id' })
        const q = h.getQueries().find(x => x.name === 'dt-q-dormant')
        expect(q, 'listed despite never being observed').toBeTruthy()
        expect(q.active).toBe(false)
        expect(q.observers).toBe(0)
        expect(q.rows).toBe(0)
        expect(q.flags, 'flags read cleanly off the dormant store').toBeTruthy()
        expect(q.flags.lastSync).toBe(null)
        expect(q.flags.isLoading).toBe(false)
    })
})
