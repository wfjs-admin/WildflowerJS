/**
 * @vitest-environment browser
 *
 * Review finding: stream URLs
 * resolve :tokens exactly as reads do, and the stream FOLLOWS THE READS.
 *
 * Before the fix, the sse rung handed the literal URL to EventSource —
 * ':pid' in the path — while the read side correctly held its fetches on
 * the readiness gate. The platform then retried the garbage URL forever
 * (EventSource auto-reconnects) and recorded nothing, since onerror only
 * writes syncError after a first sync. And even with the token resolvable
 * at activation, the stream never followed a params change: reads
 * re-interpolate per fetch, so after navigation the ladder's two halves
 * addressed different resources.
 *
 * Now: an unresolved token means the rung waits (same not-ready contract
 * and once-per-token WF-972 as reads); every fetch re-compares the
 * resolved stream URL and opens or swaps the connection to match, with
 * the fetch that carried the new params serving as the catch-up. WF-984
 * names the platform constraint when a query with declared headers opens
 * a stream (EventSource cannot carry them).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const itDev = isMinifiedBuild() ? it.skip : it

let seq = 0
const uname = (p) => `${p}-qstl-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query: stream URL token lifecycle', () => {
    let container
    let wildflower
    let realFetch
    let realEventSource
    let warnings
    let realWarn

    class FakeEventSource {
        constructor(url) {
            this.url = url
            this.closed = false
            FakeEventSource.instances.push(this)
        }
        close() { this.closed = true }
    }

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        realEventSource = window.EventSource
        FakeEventSource.instances = []
        window.EventSource = FakeEventSource
        warnings = []
        realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
    })

    afterEach(() => {
        console.warn = realWarn
        window.fetch = realFetch
        window.EventSource = realEventSource
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mountList(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row" data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    it('an unresolved token means the rung waits; the literal URL is never connected', async () => {
        const q = uname('q'); const c = uname('c'); const s = uname('route')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.store(s, { state: { pid: null } })
        wildflower.query(q, {
            from: '/api/projects/:pid/tasks', key: 'id',
            params: () => ({ pid: wildflower.getStore(s).pid }),
            refresh: 'sse'
        })
        mountList(q, c)
        await settle()

        expect(FakeEventSource.instances.length, 'no connection while the token is unresolved').toBe(0)

        // The token lands; the next fetch carries it and the stream follows.
        wildflower.getStore(s).pid = 7
        wildflower.getQuery(q).refresh()
        await settle()

        expect(FakeEventSource.instances.length).toBe(1)
        expect(FakeEventSource.instances[0].url).toBe('/api/projects/7/tasks')
        expect(FakeEventSource.instances.every(i => !i.url.includes(':pid')),
            'the literal URL is never used').toBe(true)
    })

    it('a token resolvable from static params connects interpolated at activation', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/projects/:pid/tasks', key: 'id',
            params: { pid: 7 },
            refresh: 'sse'
        })
        mountList(q, c)
        await settle()

        expect(FakeEventSource.instances.length).toBe(1)
        expect(FakeEventSource.instances[0].url).toBe('/api/projects/7/tasks')
    })

    it('the stream follows the reads when params move the resolved URL', async () => {
        const q = uname('q'); const c = uname('c'); const s = uname('route')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.store(s, { state: { pid: 7 } })
        wildflower.query(q, {
            from: '/api/projects/:pid/tasks', key: 'id',
            params: () => ({ pid: wildflower.getStore(s).pid }),
            refresh: 'sse'
        })
        mountList(q, c)
        await settle()
        expect(FakeEventSource.instances.length).toBe(1)
        expect(FakeEventSource.instances[0].url).toBe('/api/projects/7/tasks')

        wildflower.getStore(s).pid = 12
        wildflower.getQuery(q).refresh()
        await settle()

        expect(FakeEventSource.instances[0].closed, 'the old connection is closed').toBe(true)
        expect(FakeEventSource.instances.length).toBe(2)
        expect(FakeEventSource.instances[1].url).toBe('/api/projects/12/tasks')
        expect(FakeEventSource.instances[1].closed).toBe(false)
    })

    it('an unchanged resolved URL never churns the connection', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/projects/:pid/tasks', key: 'id',
            params: { pid: 7 },
            refresh: 'sse'
        })
        mountList(q, c)
        await settle()

        wildflower.getQuery(q).refresh()
        await settle()
        wildflower.getQuery(q).refresh()
        await settle()

        expect(FakeEventSource.instances.length, 'one connection across repeated fetches').toBe(1)
        expect(FakeEventSource.instances[0].closed).toBe(false)
    })

    it('an explicit stream: URL interpolates its own tokens', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/projects/:pid/tasks', key: 'id',
            params: { pid: 7 },
            refresh: 'sse', stream: '/api/projects/:pid/stream'
        })
        mountList(q, c)
        await settle()

        expect(FakeEventSource.instances.length).toBe(1)
        expect(FakeEventSource.instances[0].url).toBe('/api/projects/7/stream')
    })

    it('a token-less stream connects at activation exactly as before', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()

        expect(FakeEventSource.instances.length).toBe(1)
        expect(FakeEventSource.instances[0].url).toBe('/api/stream')
    })

    it('a dead-by-status stream (readyState CLOSED) reopens beside the next fetch', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()
        expect(FakeEventSource.instances.length).toBe(1)

        // The platform's PERMANENT failure shape: an HTTP error status
        // (401/404/wrong content-type) FAILS the connection — the HTML
        // spec's "fail the connection", readyState CLOSED, no
        // auto-reconnect — after firing onerror. Only network errors
        // auto-reconnect. (Bug-history survey, Lane C #13.)
        const es = FakeEventSource.instances[0]
        es.readyState = 2
        es.onerror()
        await settle(20)

        wildflower.getQuery(q).refresh()
        await settle()

        expect(FakeEventSource.instances.length,
            'the fetch beside a CLOSED stream reopens it').toBe(2)
        expect(FakeEventSource.instances[1].url).toBe('/api/stream')
        expect(FakeEventSource.instances[1].closed).toBe(false)
    })

    it('calibration: a transiently-errored stream (auto-reconnecting) is never churned', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()
        expect(FakeEventSource.instances.length).toBe(1)

        // A network drop: onerror fires but the browser keeps the object
        // alive and reconnects on its own (readyState stays CONNECTING —
        // the fake leaves it undefined, which must read as healthy).
        FakeEventSource.instances[0].onerror()
        await settle(20)

        wildflower.getQuery(q).refresh()
        await settle()

        expect(FakeEventSource.instances.length,
            'the auto-reconnecting connection is left alone').toBe(1)
        expect(FakeEventSource.instances[0].closed).toBe(false)
    })

    itDev('a stream-only unresolved token warns WF-972 once, then connects when supplied', async () => {
        const q = uname('q'); const c = uname('c'); const s = uname('route')
        wildflower.store(s, { state: { rid: null } })
        wildflower.query(q, {
            from: async () => [{ id: 1, name: 'a' }], key: 'id',
            params: () => ({ rid: wildflower.getStore(s).rid }),
            refresh: 'sse', stream: '/api/rooms/:rid/stream'
        })
        mountList(q, c)
        await settle()

        expect(FakeEventSource.instances.length).toBe(0)
        expect(warnings.filter(w => w.includes('WF-972') && w.includes('rid')).length,
            'the waiting token is named once').toBeGreaterThan(0)

        wildflower.getStore(s).rid = 4
        wildflower.getQuery(q).refresh()
        await settle()

        expect(FakeEventSource.instances.length).toBe(1)
        expect(FakeEventSource.instances[0].url).toBe('/api/rooms/4/stream')
    })

    itDev('declared headers beside an sse rung warn WF-984 at stream open', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            headers: () => ({ Authorization: 'Token abc' }),
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()

        expect(warnings.some(w => w.includes('WF-984')), 'the platform constraint is named').toBe(true)
    })

    itDev('calibration: declared headers with no sse rung never warn WF-984', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            headers: () => ({ Authorization: 'Token abc' })
        })
        mountList(q, c)
        await settle()

        expect(warnings.some(w => w.includes('WF-984'))).toBe(false)
    })

    // ── WF-989: the sse rung on a JSON endpoint (bug-history survey, ────
    // diagnostics pass). `stream:` absent defaults the stream URL to a
    // string `from`; an ordinary JSON API then FAILS every connection
    // permanently ("MIME type is not text/event-stream" — the HTML spec's
    // "fail the connection": readyState CLOSED, no auto-reconnect). The
    // engine cannot read the MIME type, but the pattern is readable:
    // repeated permanent closes, zero messages ever, stream URL identical
    // to from. Composes with the readyState-2 revival fix above — each
    // fetch reopens the dead stream, so the count must survive cycles.

    const count989 = (warnings) => warnings.filter(w => w.includes('[WF WF-989]')).length

    itDev('WF-989: two dead cycles with zero messages on the from URL name the mistake once', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/items', key: 'id', refresh: 'sse' })
        mountList(q, c)
        await settle()
        expect(FakeEventSource.instances.length).toBe(1)

        // First permanent close: could still be anything (a flaky proxy).
        let es = FakeEventSource.instances[0]
        es.readyState = 2
        es.onerror()
        await settle(20)
        expect(count989(warnings), 'one close alone is not the pattern').toBe(0)

        // The next fetch revives the stream; the endpoint kills it again.
        wildflower.getQuery(q).refresh()
        await settle()
        expect(FakeEventSource.instances.length, 'the revival cycle reopened').toBe(2)
        es = FakeEventSource.instances[1]
        es.readyState = 2
        es.onerror()
        await settle(20)
        expect(count989(warnings), 'the second dead cycle names the mistake').toBe(1)

        // A third cycle restates nothing (standing condition, R15 gate).
        wildflower.getQuery(q).refresh()
        await settle()
        es = FakeEventSource.instances[2]
        es.readyState = 2
        es.onerror()
        await settle(20)
        expect(count989(warnings), 'named once, not per cycle').toBe(1)
    })

    itDev('WF-989 calibration: a stream that ever delivered a message never warns', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/items', key: 'id', refresh: 'sse' })
        mountList(q, c)
        await settle()

        // The endpoint IS an event stream: one real message proves it.
        FakeEventSource.instances[0].onmessage({ data: '[{"id":1,"name":"a"}]' })
        await settle(20)

        for (let cycle = 0; cycle < 3; cycle++) {
            const es = FakeEventSource.instances[FakeEventSource.instances.length - 1]
            es.readyState = 2
            es.onerror()
            await settle(20)
            wildflower.getQuery(q).refresh()
            await settle()
        }
        expect(count989(warnings), 'a proven stream dying later is an outage, not this mistake').toBe(0)
    })

    itDev('WF-989 calibration: a distinct stream: URL never warns — a dead SSE endpoint is a different problem', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()

        for (let cycle = 0; cycle < 3; cycle++) {
            const es = FakeEventSource.instances[FakeEventSource.instances.length - 1]
            es.readyState = 2
            es.onerror()
            await settle(20)
            wildflower.getQuery(q).refresh()
            await settle()
        }
        expect(count989(warnings), 'an explicit stream URL is not the defaulted-from mistake').toBe(0)
    })

    itDev('WF-989 calibration: transient reconnect errors (readyState CONNECTING) never count', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/items', key: 'id', refresh: 'sse' })
        mountList(q, c)
        await settle()

        // Network drops: onerror fires but the browser keeps reconnecting
        // (the fake's readyState stays undefined, which reads as alive).
        const es = FakeEventSource.instances[0]
        es.onerror()
        es.onerror()
        es.onerror()
        await settle(20)
        expect(count989(warnings), 'reconnecting errors are an outage, not the pattern').toBe(0)
    })
})
