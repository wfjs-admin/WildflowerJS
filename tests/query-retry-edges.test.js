/**
 * Retry ladder edges query-retry.test.js does not reach.
 *
 * - 408 (request timeout) is transient by meaning, like 401 and 429, so it
 *   climbs the ladder; the documented exceptions to "4xx is final" are all
 *   three.
 * - A retry pending when the query tears down is cancelled with it. The
 *   retry timer calls the fetch directly, past the observer check, so
 *   without the cancel a query nothing shows would keep requesting.
 *
 * Timing: the internal base delay and teardown grace are tuned
 * (wildflower._queryRetryBaseMs, _queryTeardownGraceMs), as in
 * query-retry.test.js.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// data-query ships in the full tier only.
const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-rte-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

suite('query retry edges', () => {
    let wildflower
    let realFetch
    let container

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        realFetch = window.fetch
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        delete wildflower._queryRetryBaseMs
        delete wildflower._queryTeardownGraceMs
        window.fetch = realFetch
        container.remove()
    })

    function mountList(q) {
        const c = uname('c')
        container.innerHTML = `<div data-component="${c}"><ul data-query="${q}"><template><li class="row" data-bind="name"></li></template></ul></div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    it('408 is transient: it climbs the full ladder', async () => {
        wildflower._queryRetryBaseMs = 20
        const q = uname('q')
        let calls = 0
        window.fetch = async () => { calls++; return new Response(null, { status: 408 }) }
        wildflower.query(q, { from: '/api/x', key: 'id', retry: 2 })
        mountList(q)
        await settle(300)
        expect(calls).toBe(3)
        expect(wildflower.getQuery(q).error).toBe('HTTP 408')
    })

    it('a retry pending when the query tears down never fires', async () => {
        wildflower._queryRetryBaseMs = 200
        wildflower._queryTeardownGraceMs = 30
        const q = uname('q')
        let calls = 0
        window.fetch = async () => { calls++; throw new Error('down') }
        // A fast poll so the lifecycle check runs (and tears down) before the
        // first retry is due.
        wildflower.query(q, { from: '/api/x', key: 'id', retry: 3, refresh: [0.05] })
        mountList(q)
        await settle(20)
        container.innerHTML = ''
        await settle(150)
        const atTeardown = calls
        await settle(700)
        expect(calls).toBe(atTeardown)
    })
})
