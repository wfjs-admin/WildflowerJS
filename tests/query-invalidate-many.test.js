/**
 * wildflower.invalidateQueries(...names) — the blessed multi-query form of
 * the sibling pattern.
 *
 * Pins:
 * 1. Both named ACTIVE queries refetch conditionally; the returned promise
 *    resolves after every triggered fetch settles into state.
 * 2. An unknown name is skipped (dev warning) without breaking the others.
 * 3. An INACTIVE query is skipped entirely — no fetch fires. Activation
 *    always runs its own catch-up fetch, so invalidating an unobserved
 *    query would fetch data nothing renders; the lifecycle owns it.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-qim-${++seq}`

function jsonResponse(data, headers) {
    return new Response(JSON.stringify(data), { status: 200, headers: headers || {} })
}

async function settle(ms = 40) {
    await new Promise(r => setTimeout(r, ms))
}

suite('invalidateQueries(...names)', () => {
    let wildflower
    let realFetch

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        realFetch = window.fetch
    })

    afterEach(() => {
        window.fetch = realFetch
    })

    it('refetches every named active query and resolves after all settle', async () => {
        const qa = uname('a'); const qb = uname('b')
        const calls = []
        let serve = { [`/${qa}`]: [{ id: 1, v: 'a1' }], [`/${qb}`]: [{ id: 1, v: 'b1' }] }
        window.fetch = (url) => {
            const path = '/' + url.split('/').pop().split('?')[0]
            calls.push(path)
            return Promise.resolve(jsonResponse(serve[path]))
        }
        wildflower.query(qa, { from: `/api/${qa}`, key: 'id' })
        wildflower.query(qb, { from: `/api/${qb}`, key: 'id' })

        // Activate both through the observer edge; let activation fetches land.
        const ha = wildflower.getQuery(qa)
        const hb = wildflower.getQuery(qb)
        await settle()
        expect(calls.length, 'one activation fetch each').toBe(2)
        expect(ha.rows[0].v).toBe('a1')

        serve = { [`/${qa}`]: [{ id: 1, v: 'a2' }], [`/${qb}`]: [{ id: 1, v: 'b2' }] }
        await wildflower.invalidateQueries(qa, qb)
        await settle()
        expect(calls.length, 'one invalidation fetch each').toBe(4)
        expect(ha.rows[0].v, 'fresh data landed through the await').toBe('a2')
        expect(hb.rows[0].v).toBe('b2')
    })

    it('skips an unknown name without breaking the rest', async () => {
        const qa = uname('a')
        let count = 0
        let payload = [{ id: 1, v: 'first' }]
        window.fetch = () => { count++; return Promise.resolve(jsonResponse(payload)) }
        wildflower.query(qa, { from: '/api/x', key: 'id' })
        const ha = wildflower.getQuery(qa)
        await settle()
        expect(count).toBe(1)

        payload = [{ id: 1, v: 'second' }]
        await wildflower.invalidateQueries('no-such-query-registered', qa)
        await settle()
        expect(count, 'the valid sibling still refetched').toBe(2)
        expect(ha.rows[0].v).toBe('second')
    })

    // Coverage:fetch failures settle into store state
    // and never reject, so one failed sibling cannot crash an awaited
    // flow — the aggregate promise resolves, the failure lands in the
    // failing query's syncError, and its rows are preserved.
    it('resolves on partial failure: the failing sibling settles into syncError', async () => {
        const qa = uname('a'); const qb = uname('b')
        let bMode = 'ok'
        window.fetch = (url) => {
            if (url.includes(qb) && bMode === 'fail') return Promise.reject(new TypeError('network down'))
            const v = url.includes(qa) ? 'a' : 'b'
            return Promise.resolve(jsonResponse([{ id: 1, v }]))
        }
        wildflower.query(qa, { from: `/api/${qa}`, key: 'id' })
        wildflower.query(qb, { from: `/api/${qb}`, key: 'id' })
        const ha = wildflower.getQuery(qa)
        const hb = wildflower.getQuery(qb)
        await settle()
        expect(hb.rows.length).toBe(1)

        bMode = 'fail'
        await wildflower.invalidateQueries(qa, qb)   // must not throw
        await settle()
        expect(ha.syncError, 'the healthy sibling is clean').toBe(null)
        expect(hb.syncError, 'the failure landed as state').toBeTruthy()
        expect(hb.rows.length, 'failed sibling keeps its rows').toBe(1)
    })

    // Coverage:invalidation is conditional — a 304
    // against a held ETag resolves cleanly, keeps the rows, and stamps
    // the sync as confirmed.
    it('a 304 answer confirms the rows without wiping them', async () => {
        const qa = uname('a')
        let calls = 0
        window.fetch = (url, opts) => {
            calls++
            const conditional = opts && opts.headers && opts.headers['If-None-Match'] === 'W/"e1"'
            if (conditional) return Promise.resolve(new Response(null, { status: 304 }))
            return Promise.resolve(jsonResponse([{ id: 1, v: 'data' }], { ETag: 'W/"e1"' }))
        }
        wildflower.query(qa, { from: `/api/${qa}`, key: 'id' })
        const ha = wildflower.getQuery(qa)
        await settle()
        const syncedAt = ha.lastSync
        expect(ha.rows.length).toBe(1)

        await new Promise(r => setTimeout(r, 5)) // ensure a later timestamp
        await wildflower.invalidateQueries(qa)
        await settle()
        expect(calls, 'the invalidation went to the network').toBe(2)
        expect(ha.rows[0].v, 'rows stand through the 304').toBe('data')
        expect(ha.isStale).toBe(false)
        expect(ha.lastSync, 'the 304 counts as a confirming sync').toBeGreaterThan(syncedAt)
    })

    it('skips an inactive query entirely — activation owns its catch-up', async () => {
        const qa = uname('a')
        let count = 0
        window.fetch = () => { count++; return Promise.resolve(jsonResponse([{ id: 1 }])) }
        // Registered, never observed: no binding, no getQuery read.
        wildflower.query(qa, { from: '/api/x', key: 'id' })
        await settle()
        expect(count, 'registration alone never fetches').toBe(0)

        await wildflower.invalidateQueries(qa)
        await settle()
        expect(count, 'inactive query skipped: no fetch').toBe(0)

        // The lifecycle keeps its promise: first observation fetches.
        wildflower.getQuery(qa)
        await settle()
        expect(count, 'activation catch-up covers it').toBe(1)
    })
})
