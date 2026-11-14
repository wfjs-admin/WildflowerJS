/**
 * Query behavior that the minified lane used to leave untested.
 *
 * Each case here already has a test elsewhere, but that test also asserts a
 * development warning, so it skips on the minified builds and the behavior
 * underneath went unchecked there. These assert the behavior alone, so they
 * run on every lane. The warnings keep their own tests.
 *
 * Covered (and the dev-gated test each one mirrors):
 * - offline suspends the retry ladder without spending attempts; online
 *   resumes it (query-retry.test.js)
 * - an append whose rows lack the key applies as a replace (data-query.test.js, WF-960)
 * - parameters passed straight to refresh() are never serialized (data-query.test.js, WF-961)
 * - a headers function that throws: the request still goes, without them
 *   (data-query-declarative-transport.test.js)
 * - a confirmation that throws rejects the write and rolls it back
 *   (data-query-declarative-transport.test.js, WF-998)
 * - an application write to a query store still lands (data-query.test.js, WF-950)
 * - an sse rung on a function source with no stream URL is skipped; the
 *   query still loads (data-query.test.js, WF-957)
 * - a token only the stream URL carries: the rung waits, then connects
 *   (query-stream-token-lifecycle.test.js)
 * - a record query that resolves null renders empty, with no error (data-query.test.js, WF-959)
 * - markup naming a query not declared yet binds once it is declared
 *   (data-query.test.js, WF-955)
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// data-query ships in the full tier only.
const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-bel-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

const jsonResponse = (data) => new Response(JSON.stringify(data), { status: 200 })

suite('query behavior on every lane', () => {
    let wildflower
    let realFetch
    let realES
    let container

    class FakeEventSource {
        constructor(url) { this.url = url; this.readyState = 0; FakeEventSource.instances.push(this) }
        close() { this.readyState = 2 }
    }

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        // Internal base delay for the retry curve; the shape is under test,
        // not wall-clock seconds (see query-retry.test.js).
        wildflower._queryRetryBaseMs = 40
        realFetch = window.fetch
        realES = window.EventSource
        FakeEventSource.instances = []
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        delete wildflower._queryRetryBaseMs
        window.fetch = realFetch
        window.EventSource = realES
        container.remove()
    })

    function mountList(q) {
        const c = uname('c')
        container.innerHTML = `<div data-component="${c}"><ul data-query="${q}"><template><li class="row" data-bind="name"></li></template></ul></div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    function mountRecord(q) {
        const c = uname('c')
        container.innerHTML = `<div data-component="${c}"><div data-query="${q}"><span class="f" data-bind="name"></span></div></div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    const rowsText = () => [...container.querySelectorAll('.row')].map(e => e.textContent)

    it('offline suspends the retry ladder without spending attempts; online resumes it', async () => {
        const q = uname('q')
        let calls = 0
        window.fetch = async () => { calls++; throw new Error('down') }
        wildflower.query(q, { from: '/api/x', key: 'id', retry: 2 })
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
        try {
            mountList(q)
            await settle(200)
            expect(calls, 'suspended after the first failure').toBe(1)
            Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
            window.dispatchEvent(new Event('online'))
            await settle(400)
            expect(calls, 'the full ladder runs once online').toBe(1 + 3)
            expect(wildflower.getQuery(q).error).toBe('down')
        } finally {
            delete navigator.onLine
        }
    })

    it('an append whose rows lack the key applies as a replace', async () => {
        const q = uname('q')
        let payload = [{ id: 1, name: 'a' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x', key: 'id' })
        mountList(q)
        await settle()
        payload = [{ name: 'no-key' }]
        await wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle()
        expect(rowsText()).toEqual(['no-key'])
    })

    it('parameters passed straight to refresh() are never serialized', async () => {
        const q = uname('q')
        const urls = []
        window.fetch = async (u) => { urls.push(String(u)); return jsonResponse([{ id: 1, name: 'x' }]) }
        wildflower.query(q, { from: '/api/x', key: 'id' })
        mountList(q)
        await settle()
        await wildflower.getQuery(q).refresh({ status: 'open' })
        await settle()
        expect(urls.length, 'it still refreshes').toBe(2)
        expect(urls.some(u => u.includes('status=open'))).toBe(false)
    })

    it('a headers function that throws: the request still goes', async () => {
        const q = uname('q')
        let calls = 0
        window.fetch = async () => { calls++; return jsonResponse([{ id: 1, name: 'x' }]) }
        wildflower.query(q, { from: '/api/x', key: 'id', headers: () => { throw new Error('no token') } })
        mountList(q)
        await settle()
        expect(calls).toBe(1)
        expect(wildflower.getQuery(q).rows.length).toBe(1)
    })

    it('a confirmation that throws rejects the write and rolls it back', async () => {
        const q = uname('q')
        window.fetch = async (u, o) => (o && o.method) ? jsonResponse({ ok: 1 }) : jsonResponse([{ id: 1, name: 'orig' }])
        wildflower.query(q, {
            from: '/api/x', key: 'id',
            to: { update: { url: '/api/x/:id', method: 'PATCH', body: i => i, confirmation: () => { throw new Error('nope') } } }
        })
        mountList(q)
        await settle()
        const h = wildflower.getQuery(q)
        let rejected = null
        await h.write({ id: 1, name: 'new' }).catch(e => { rejected = e.message })
        await settle()
        expect(rejected).toBe('nope')
        expect(h.rows[0].name).toBe('orig')
        expect(h.syncError).toBe('nope')
    })

    it('an application write to a query store still lands', async () => {
        const q = uname('q')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'x' }])
        wildflower.query(q, { from: '/api/x', key: 'id' })
        mountList(q)
        await settle()
        wildflower.getQuery(q).isStale = true
        expect(wildflower.getQuery(q).isStale).toBe(true)
    })

    it('an sse rung on a function source with no stream URL is skipped; the query still loads', async () => {
        window.EventSource = FakeEventSource
        const q = uname('q')
        wildflower.query(q, { from: async () => [{ id: 1, name: 'x' }], key: 'id', refresh: 'sse' })
        mountList(q)
        await settle()
        expect(FakeEventSource.instances.length).toBe(0)
        expect(wildflower.getQuery(q).rows.length).toBe(1)
    })

    it('a token only the stream URL carries: the rung waits, then connects', async () => {
        window.EventSource = FakeEventSource
        const q = uname('q')
        const route = { room: null }
        window.fetch = async () => jsonResponse([{ id: 1, name: 'x' }])
        wildflower.query(q, {
            from: '/api/msgs', stream: '/api/rooms/:room/stream', key: 'id', refresh: 'sse',
            params: () => ({ room: route.room })
        })
        mountList(q)
        await settle()
        expect(FakeEventSource.instances.length, 'the literal URL is never connected').toBe(0)
        route.room = 'r1'
        await wildflower.getQuery(q).refresh()
        await settle()
        expect(FakeEventSource.instances.map(e => e.url)).toEqual(['/api/rooms/r1/stream'])
    })

    it('a record query that resolves null renders empty, with no error', async () => {
        const q = uname('q')
        window.fetch = async () => jsonResponse(null)
        wildflower.query(q, { from: '/api/me' })
        mountRecord(q)
        await settle()
        expect(container.querySelector('.f').textContent).toBe('')
        expect(wildflower.getQuery(q).error).toBe(null)
    })

    it('markup naming a query not declared yet binds once it is declared', async () => {
        const q = uname('q')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'late' }])
        mountList(q)
        await settle()
        wildflower.query(q, { from: '/api/x', key: 'id' })
        await settle(100)
        expect(rowsText()).toEqual(['late'])
    })
})
