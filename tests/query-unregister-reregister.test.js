/**
 * After wildflower.unregister(name), nothing the old query started can
 * reach a new query registered under the same name.
 *
 * unregister() tears the old controller down (timers, stream, listeners,
 * the fetch in flight) and drops it from the registry, but the controller
 * itself kept working: its store lookups go by name, and the name now
 * belongs to the new query. A function `from` still running (it cannot be
 * aborted) resolved and wrote its rows into the new query's store; a write
 * issued against the old query settled, ran the old query's invalidate(),
 * fetched the OLD from: URL and ingested that into the new store too.
 *
 * Pinned: both late arrivals are dropped, and the new query's rows stay
 * the new query's.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-unreg-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('unregister then re-register under the same name', () => {
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

    it('a function source still running when its query was unregistered does not land in the new one', async () => {
        const q = uname('q')
        wildflower.query(q, { from: () => new Promise(r => setTimeout(() => r([{ id: 1, v: 'old' }]), 200)) })
        wildflower.getQuery(q)
        await settle(20)

        wildflower.unregister(q)
        wildflower.query(q, { from: async () => [{ id: 1, v: 'new' }] })
        wildflower.getQuery(q)
        await settle(400)

        expect(wildflower.getStore(q).rows.map(r => r.v)).toEqual(['new'])
    })

    it('a write that settles after its query was unregistered does not refetch into the new one', async () => {
        const q = uname('q')
        const urls = []
        let settleWrite
        window.fetch = async (u) => {
            urls.push(String(u))
            const v = String(u).includes('/old') ? 'old' : 'new'
            return new Response(JSON.stringify([{ id: 1, v }]), { status: 200 })
        }
        wildflower.query(q, { from: `/api/${q}/old`, to: () => new Promise(r => { settleWrite = r }) })
        const oldHandle = wildflower.getQuery(q)
        await settle(100)
        oldHandle.write({ id: 1, v: 'edited' }).catch(() => {})
        await settle(20)

        wildflower.unregister(q)
        wildflower.query(q, { from: `/api/${q}/new` })
        wildflower.getQuery(q)
        await settle(100)
        expect(wildflower.getStore(q).rows.map(r => r.v)).toEqual(['new'])

        const fetchesBefore = urls.length
        settleWrite(undefined) // resolve-with-nothing: the old query wants a refetch
        await settle(200)

        expect(urls.slice(fetchesBefore).filter(u => u.includes('/old'))).toEqual([])
        expect(wildflower.getStore(q).rows.map(r => r.v)).toEqual(['new'])
    })
})
