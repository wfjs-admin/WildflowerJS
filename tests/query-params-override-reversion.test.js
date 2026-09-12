/**
 * @vitest-environment browser
 *
 * Review finding: WF-979 fires at
 * REVERSION time, not request time.
 *
 * The hazard it names: refresh({ params }) wins for exactly one fetch, and
 * the next engine-initiated refetch (a rung tick, an invalidation, a
 * catch-up) resolves the declaration again — the list visibly snaps back to
 * values nobody on screen asked for. The old check fired at the refresh()
 * call, only for function-form params, and only when the key existed on
 * both sides with differing values: silent for the three likelier shapes
 * (static object, absent key, no declaration — the shapes the docs teach)
 * and noisy on legitimate one-offs. The reversion-time check is precise by
 * construction: it fires only when an engine refetch (conditional: true —
 * refresh() passes conditional: false) actually drops or contradicts the
 * stored override, once per override; any explicit refresh() replaces or
 * clears the stored intent, and append-mode overrides never arm it (in
 * accumulate mode a base-page tick is the design, not a reversion).
 *
 * The engine-refetch trigger used here is the SSE invalidation signal (an
 * empty stream message → conditional fetch): deterministic and immediate,
 * unlike a poll tick.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const itDev = isMinifiedBuild() ? it.skip : it

let seq = 0
const uname = (p) => `${p}-qpor-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query: params override reversion warning (WF-979)', () => {
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

    function invalidateViaStream() {
        FakeEventSource.instances[0].onmessage({ data: '' })
    }

    const wf979 = () => warnings.filter(w => w.includes('WF-979'))

    // The docs-composed shape: sources.html's static-params declaration plus
    // pagination.html's per-call page, plus a rung. The old check was
    // double-silent here (static object, absent key).
    itDev('static params + one-shot page: the engine refetch that drops it warns', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/orders', key: 'id',
            params: { status: 'open' },
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()
        expect(FakeEventSource.instances.length).toBe(1)

        wildflower.getQuery(q).refresh({ params: { page: 3 } })
        await settle()
        expect(wf979().length, 'no warn at the refresh() call itself').toBe(0)

        invalidateViaStream()
        await settle()

        const hits = wf979()
        expect(hits.length, 'the reverting refetch warns').toBeGreaterThan(0)
        expect(hits.some(w => w.includes(q) && w.includes('page')), 'the dropped key is named').toBe(true)
    })

    itDev('function params without the key: the reverting refetch still warns', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/orders', key: 'id',
            params: () => ({ status: 'open' }),
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()

        wildflower.getQuery(q).refresh({ params: { page: 2 } })
        await settle()
        invalidateViaStream()
        await settle()

        expect(wf979().some(w => w.includes(q) && w.includes('page'))).toBe(true)
    })

    itDev('function params carrying a DIFFERENT value: silent at the call, warns at the reversion', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/orders', key: 'id',
            params: () => ({ page: 1 }),
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()

        wildflower.getQuery(q).refresh({ params: { page: 3 } })
        await settle()
        expect(wf979().length, 'the old request-time warn is gone').toBe(0)

        invalidateViaStream()
        await settle()
        expect(wf979().some(w => w.includes(q) && w.includes('page')), 'the reversion warns instead').toBe(true)
    })

    itDev('calibration: a one-off against a query with no internal refetches never warns', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/orders', key: 'id' })
        mountList(q, c)
        await settle()

        wildflower.getQuery(q).refresh({ params: { format: 'detailed' } })
        await settle(120)

        expect(wf979().length).toBe(0)
    })

    itDev('calibration: a declaration that derives the value stays silent (the documented fix)', async () => {
        const q = uname('q'); const c = uname('c'); const s = uname('pager')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.store(s, { state: { page: 1 } })
        wildflower.query(q, {
            from: '/api/orders', key: 'id',
            params: () => ({ page: wildflower.getStore(s).page }),
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()

        // Belt-and-suspenders author: writes the store AND passes the
        // override. The declaration now derives the same value, so the next
        // engine refetch preserves it and there is nothing to warn about.
        wildflower.getStore(s).page = 3
        wildflower.getQuery(q).refresh({ params: { page: 3 } })
        await settle()
        invalidateViaStream()
        await settle()

        expect(wf979().length).toBe(0)
    })

    itDev('one warn per override: a second engine refetch stays quiet', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/orders', key: 'id',
            params: { status: 'open' },
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()

        wildflower.getQuery(q).refresh({ params: { page: 3 } })
        await settle()
        invalidateViaStream()
        await settle()
        const afterFirst = wf979().length
        expect(afterFirst).toBeGreaterThan(0)

        invalidateViaStream()
        await settle()
        expect(wf979().length, 'no repeat for the same override').toBe(afterFirst)
    })

    itDev('a plain refresh() is a deliberate reset: it clears the stored override silently', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/orders', key: 'id',
            params: { status: 'open' },
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()

        wildflower.getQuery(q).refresh({ params: { page: 3 } })
        await settle()
        wildflower.getQuery(q).refresh()
        await settle()
        invalidateViaStream()
        await settle()

        expect(wf979().length).toBe(0)
    })

    itDev('append-mode overrides never arm the watch (accumulation is not reversion)', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/feed', key: 'id',
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()

        wildflower.getQuery(q).refresh({ params: { page: 2 }, append: true })
        await settle()
        invalidateViaStream()
        await settle()

        expect(wf979().length).toBe(0)
    })
})
