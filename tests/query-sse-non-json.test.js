/**
 * An sse message whose body is not JSON.
 *
 * The stream contract has two messages: a JSON body is the new result, and
 * an empty body is an invalidation signal. A non-empty body that does not
 * parse fits neither, so it is treated as an invalidation: one conditional
 * refetch, rows kept. Development builds name it once (WF-958); that warning
 * has its own test in query-warn-once.test.js, which skips on the minified
 * lane, so this one checks the behavior on every lane.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// data-query ships in the full tier only.
const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-snj-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

suite('sse: a non-JSON message', () => {
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

    it('is an invalidation: one conditional refetch, rows kept', async () => {
        const q = uname('q')
        const c = uname('c')
        const validators = []
        window.fetch = async (u, o) => {
            validators.push(o.headers['If-None-Match'] || null)
            return validators.length === 1
                ? new Response(JSON.stringify([{ id: 1, name: 'a' }]), { status: 200, headers: { ETag: '"v1"' } })
                : new Response(null, { status: 304 })
        }
        wildflower.query(q, { from: '/api/x', stream: '/api/x/stream', key: 'id', refresh: 'sse' })
        container.innerHTML = `<div data-component="${c}"><ul data-query="${q}"><template><li data-bind="name"></li></template></ul></div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()
        expect(FakeEventSource.instances.length).toBe(1)

        FakeEventSource.instances[0].onmessage({ data: 'ping, not json' })
        await settle()

        expect(validators, 'the refetch is conditional').toEqual([null, '"v1"'])
        const h = wildflower.getQuery(q)
        expect(h.rows.map(r => r.name)).toEqual(['a'])
        expect(h.isStale).toBe(false)
        expect(h.syncError).toBe(null)
    })
})
