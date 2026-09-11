/**
 * @vitest-environment browser
 *
 * Review finding:
 * `select:` must apply to EVERY read delivery, stream included. It used
 * to run only on the fetch path (_querySelect had one call site), so a
 * shared envelope ingested raw on every SSE push — the whole list
 * silently replaced by one row whose fields were the envelope's — and
 * WF-980, which lives inside _querySelect, could never name it.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-dqss-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query select: on the stream path', () => {
    let container
    let wildflower
    let realFetch
    let realEventSource

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
    })

    afterEach(() => {
        window.fetch = realFetch
        window.EventSource = realEventSource
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mountList(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <ul data-query="${qname}"><template><li class="row" data-bind="title"></li></template></ul>
            </div>
        `
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    function envelopeQuery() {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ items: [{ id: 1, title: 'from-fetch' }], count: 1 })
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            select: d => d.items,
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        return q
    }

    it('calibration: select: unwraps the envelope on a plain fetch', async () => {
        const q = envelopeQuery()
        await settle()

        const h = wildflower.getQuery(q)
        expect(h.rows.length).toBe(1)
        expect(h.rows[0].title).toBe('from-fetch')
        expect(FakeEventSource.instances.length, 'sse rung connected').toBe(1)
    })

    it('select: unwraps the same envelope arriving as an SSE message', async () => {
        const q = envelopeQuery()
        await settle()
        expect(FakeEventSource.instances.length, 'sse rung connected').toBe(1)

        FakeEventSource.instances[0].onmessage({
            data: JSON.stringify({ items: [{ id: 1, title: 'from-stream' }, { id: 2, title: 'second' }], count: 2 })
        })
        await settle()

        const h = wildflower.getQuery(q)
        expect(h.rows.length, 'the pushed envelope becomes two rows').toBe(2)
        expect(h.rows[0].title).toBe('from-stream')
        expect(h.rows[1].title).toBe('second')
        const texts = [...container.querySelectorAll('.row')].map(e => e.textContent)
        expect(texts).toEqual(['from-stream', 'second'])
    })

    it('control: a select:-less stream of a raw array still applies as before', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a' }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()
        expect(FakeEventSource.instances.length).toBe(1)

        FakeEventSource.instances[0].onmessage({
            data: JSON.stringify([{ id: 1, title: 'a2' }, { id: 2, title: 'b' }])
        })
        await settle()

        const h = wildflower.getQuery(q)
        expect(h.rows.length).toBe(2)
        expect(h.rows.map(r => r.title)).toEqual(['a2', 'b'])
    })
})
