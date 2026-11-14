/**
 * A select: that throws on a pushed event.
 *
 * select: runs on every read delivery, fetched or pushed, so a push must
 * carry the shape the from URL returns. When select throws on a fetch, the
 * failure is recorded: syncError while rows are on screen (error before the
 * first load), and the rows stay. A push is held to the same rule.
 *
 * What used to happen: the message handler superseded and aborted any fetch
 * in flight first, then ran select, which threw out of the handler. Nothing
 * reached syncError, the page looked healthy, and the aborted fetch's answer
 * was gone with nothing to catch it up. A push whose rows cannot be read
 * has no claim to supersede anything.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// data-query ships in the full tier only.
const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-stp-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

const jsonResponse = (data) => new Response(JSON.stringify(data), { status: 200 })

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

suite('select: throwing on a pushed event', () => {
    let wildflower
    let realFetch
    let realES
    let container

    class FakeEventSource {
        constructor(url) { this.url = url; this.readyState = 1; FakeEventSource.instances.push(this) }
        close() { this.readyState = 2 }
    }

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        realFetch = window.fetch
        realES = window.EventSource
        FakeEventSource.instances = []
        window.EventSource = FakeEventSource
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        window.fetch = realFetch
        window.EventSource = realES
        container.remove()
    })

    // select reads { items }; a push without it is the broken shape.
    const select = (d) => { if (!d || !Array.isArray(d.items)) throw new Error('select broke'); return d.items }

    function mount(q) {
        const c = uname('c')
        container.innerHTML = `<div data-component="${c}"><ul data-query="${q}"><template><li class="row" data-bind="name"></li></template></ul></div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    function push(data) {
        // A throw out of the handler is what the platform would report as an
        // uncaught error; the test records it rather than failing on it.
        try { FakeEventSource.instances[0].onmessage({ data: JSON.stringify(data) }) } catch (e) { return e }
        return null
    }

    it('is recorded in syncError, rows kept, exactly as a fetch would record it', async () => {
        window.fetch = async () => jsonResponse({ items: [{ id: 1, name: 'a' }] })
        const q = uname('q')
        wildflower.query(q, { from: '/api/x', stream: '/api/x/stream', key: 'id', refresh: 'sse', select })
        mount(q)
        await settle()
        const h = wildflower.getQuery(q)
        expect(h.rows.map(r => r.name)).toEqual(['a'])

        const escaped = push({ wrong: 'shape' })
        await settle()

        expect(escaped, 'the failure is handled, not thrown out of the message handler').toBe(null)
        expect(h.syncError).toBe('select broke')
        expect(h.error).toBe(null)
        expect(h.rows.map(r => r.name), 'rows on screen stay').toEqual(['a'])
    })

    it('does not abort a fetch already in flight; that fetch still lands', async () => {
        let first = true
        const held = deferred()
        let signal = null
        window.fetch = (u, o) => {
            if (first) { first = false; return Promise.resolve(jsonResponse({ items: [{ id: 1, name: 'a' }] })) }
            signal = o.signal
            return held.promise
        }
        const q = uname('q')
        wildflower.query(q, { from: '/api/x', stream: '/api/x/stream', key: 'id', refresh: 'sse', select })
        mount(q)
        await settle()
        const h = wildflower.getQuery(q)

        h.invalidate()                       // a read in flight
        await settle(10)
        push({ wrong: 'shape' })
        await settle(10)
        expect(signal.aborted, 'an unreadable push supersedes nothing').toBe(false)

        held.resolve(jsonResponse({ items: [{ id: 1, name: 'a2' }, { id: 2, name: 'b' }] }))
        await settle()
        expect(h.rows.map(r => r.name)).toEqual(['a2', 'b'])
    })

    it('control: a readable push still supersedes the fetch in flight and applies', async () => {
        let first = true
        const held = deferred()
        let signal = null
        window.fetch = (u, o) => {
            if (first) { first = false; return Promise.resolve(jsonResponse({ items: [{ id: 1, name: 'a' }] })) }
            signal = o.signal
            return held.promise
        }
        const q = uname('q')
        wildflower.query(q, { from: '/api/x', stream: '/api/x/stream', key: 'id', refresh: 'sse', select })
        mount(q)
        await settle()
        const h = wildflower.getQuery(q)
        h.invalidate()
        await settle(10)
        push({ items: [{ id: 1, name: 'pushed' }] })
        await settle(10)
        expect(signal.aborted).toBe(true)
        expect(h.rows.map(r => r.name)).toEqual(['pushed'])
    })
})
