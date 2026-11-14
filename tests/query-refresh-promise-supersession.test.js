/**
 * The promise a read returns resolves once the query's rows are current,
 * even when a later read superseded the one it started.
 *
 * invalidateQueries() is documented to resolve "once every triggered
 * refetch has settled, so a write flow can await the whole convergence".
 * A read that a later call superseded used to settle the moment it was
 * aborted, so `await invalidateQueries('orders')` returned with the old
 * rows still in the store whenever a poll tick, a focus refetch or a second
 * invalidate landed in the window; the new rows arrived afterwards.
 *
 * Pinned: an awaited invalidateQueries(), invalidate() or refresh() whose
 * request is superseded resolves after the superseding request has landed.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-prsup-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('a superseded read resolves with current rows', () => {
    let wildflower
    let realFetch
    let realWarn

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        realFetch = window.fetch
        realWarn = console.warn
        console.warn = () => {}
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
    })

    // Answers with the server's current version after `ms`; honours abort.
    function versionedServer(ms) {
        const s = { version: 'v1' }
        window.fetch = (url, init) => new Promise((resolve, reject) => {
            const v = s.version
            const t = setTimeout(() => resolve(new Response(JSON.stringify([{ id: 1, v }]), { status: 200 })), ms)
            init.signal.addEventListener('abort', () => {
                clearTimeout(t)
                reject(new DOMException('aborted', 'AbortError'))
            })
        })
        return s
    }

    it('await invalidateQueries() sees the new rows when a second invalidate lands mid-flight', async () => {
        const q = uname('orders')
        const server = versionedServer(150)
        wildflower.query(q, { from: `/api/${q}` })
        const orders = wildflower.getQuery(q)
        await settle(250)
        expect(orders.rows[0].v).toBe('v1')

        server.version = 'v2'
        const awaited = wildflower.invalidateQueries(q).then(() => orders.rows[0].v)
        await settle(30)
        orders.invalidate()

        expect(await awaited).toBe('v2')
    })

    it('await refresh() sees the rows of the request that superseded it', async () => {
        const q = uname('orders')
        const server = versionedServer(100)
        wildflower.query(q, { from: `/api/${q}` })
        const orders = wildflower.getQuery(q)
        await settle(200)

        server.version = 'v2'
        const first = orders.refresh().then(() => orders.rows[0].v)
        await settle(20)
        server.version = 'v3'
        orders.refresh()

        expect(await first).toBe('v3')
    })
})
