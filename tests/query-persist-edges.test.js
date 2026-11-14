/**
 * Persistence edges query-persist.test.js does not reach.
 *
 * - A 304 confirmation refreshes the snapshot's savedAt. A tab that only
 *   ever revalidates to 304 would otherwise age its snapshot out of the
 *   24-hour window while the server keeps vouching for it.
 * - A restore deferred because a :token had no value yet re-checks the age
 *   when the token lands. The snapshot passed the gate at activation; by the
 *   time the route resolves it may be past the day, and then it must not
 *   paint.
 * - A function from has no request URL, so its snapshot restores with no
 *   URL comparison, as the Freshness page says, and the first answer
 *   replaces it on screen and on disk.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// data-query ships in the full tier only.
const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-ppe-${++seq}`
const keyFor = (name) => 'wf:query:' + name
const DAY = 24 * 60 * 60 * 1000

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

const jsonResponse = (data) => new Response(JSON.stringify(data), { status: 200 })

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

suite('query persistence edges', () => {
    let wildflower
    let realFetch
    const keys = []

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
        while (keys.length) { try { localStorage.removeItem(keys.pop()) } catch {} }
    })

    it('a 304 confirmation refreshes the snapshot savedAt', async () => {
        const q = uname('q'); keys.push(keyFor(q))
        const old = Date.now() - 23 * 60 * 60 * 1000
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1, name: 'disk' }], etag: '"e1"', etagUrl: '/api/x', url: '/api/x', savedAt: old
        }))
        window.fetch = async (u, o) => (o.headers['If-None-Match'] === '"e1"'
            ? new Response(null, { status: 304 })
            : jsonResponse([{ id: 9, name: 'unexpected' }]))
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        wildflower.getQuery(q)
        await settle()

        const env = JSON.parse(localStorage.getItem(keyFor(q)))
        expect(wildflower.getQuery(q).rows.map(r => r.name)).toEqual(['disk'])
        expect(env.savedAt, 'restamped by the 304').toBeGreaterThan(Date.now() - 5000)
        expect(env.etag, 'the validator stays with the rows it vouches for').toBe('"e1"')
    })

    it('a restore deferred by an unresolved token re-checks the age when the token lands', async () => {
        const q = uname('q'); keys.push(keyFor(q))
        const route = { id: null }
        // Inside the day at activation, past it by the time the token resolves.
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1, name: 'aged' }], url: '/api/a/7', savedAt: Date.now() - DAY + 150
        }))
        const held = deferred()
        window.fetch = () => held.promise
        wildflower.query(q, { from: '/api/a/:id', key: 'id', persist: true, params: () => ({ id: route.id }) })
        const h = wildflower.getQuery(q)
        await settle(30)
        expect(h.rows.length, 'nothing paints while the token is unresolved').toBe(0)

        await settle(250)
        route.id = 7
        h.refresh()
        await settle(20)
        expect(h.rows.length, 'a snapshot that aged out while waiting does not paint').toBe(0)

        held.resolve(jsonResponse([{ id: 7, name: 'server' }]))
        await settle()
        expect(h.rows.map(r => r.name)).toEqual(['server'])
    })

    it('a function from restores with no URL comparison; the first answer replaces it', async () => {
        const q = uname('q'); keys.push(keyFor(q))
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1, name: 'disk' }], url: null, savedAt: Date.now() - 1000
        }))
        const held = deferred()
        wildflower.query(q, { from: () => held.promise, key: 'id', persist: true })
        const h = wildflower.getQuery(q)
        await settle()
        expect(h.rows.map(r => r.name)).toEqual(['disk'])
        expect(h.isStale, 'restored rows are stale until confirmed').toBe(true)

        held.resolve([{ id: 1, name: 'fresh' }])
        await settle()
        expect(h.rows.map(r => r.name)).toEqual(['fresh'])
        expect(JSON.parse(localStorage.getItem(keyFor(q))).rows[0].name).toBe('fresh')
    })
})
