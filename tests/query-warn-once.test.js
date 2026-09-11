/**
 * @vitest-environment browser
 *
 * Review finding:the five NETWORK-driven
 * diagnostics describe a STANDING condition — the endpoint's shape, a
 * broken params/headers function, a non-JSON stream — and used to re-warn
 * on the refresh cadence, flooding the console and burying every one-shot
 * diagnostic beside them. They now warn once per query per code, per page
 * load, through controller._warnedOnce — the rule _expectWarned's own
 * comment states ("polls and streams must not flood the console with the
 * same fact"). Keyed by CODE alone: all five restate one per-query fact,
 * so a second sighting from another delivery path adds nothing. No reset
 * on heal, matching _expectWarned's documented "forever" (a reload starts
 * fresh). Per-call and registration diagnostics are untouched.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const itDev = isMinifiedBuild() ? it.skip : it

let seq = 0
const uname = (p) => `${p}-qwo-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query: network-driven diagnostics warn once per query', () => {
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

    function mountRecord(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <div data-query="${q}"><span class="who" data-bind="name"></span></div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    const count = (code) => warnings.filter(w => w.includes(code)).length

    itDev('WF-980: an envelope endpoint warns once, not once per delivery', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ items: [{ id: 1, name: 'a' }], count: 1 })
        wildflower.query(q, { from: '/api/orders', key: 'id' })
        mountList(q, c)
        await settle()

        const afterFirst = count('WF-980')
        expect(afterFirst, 'the standing fact is named').toBeGreaterThan(0)

        wildflower.getQuery(q).refresh()
        await settle()
        wildflower.getQuery(q).refresh()
        await settle()

        expect(count('WF-980'), 'later deliveries restate nothing').toBe(afterFirst)
    })

    itDev('WF-959: a null record warns once across BOTH delivery paths (fetch and stream)', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse(null)
        wildflower.query(q, { from: '/api/me', refresh: 'sse', stream: '/api/me/stream' })
        mountRecord(q, c)
        await settle()

        const afterFirst = count('WF-959')
        expect(afterFirst).toBeGreaterThan(0)

        // The same standing fact, restated by the OTHER path.
        FakeEventSource.instances[0].onmessage({ data: 'null' })
        await settle()
        wildflower.getQuery(q).refresh()
        await settle()

        expect(count('WF-959'), 'one fact, one warn, regardless of path').toBe(afterFirst)
    })

    itDev('WF-958: a non-JSON stream warns once, not once per message', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/items', key: 'id', refresh: 'sse', stream: '/api/stream' })
        mountList(q, c)
        await settle()

        FakeEventSource.instances[0].onmessage({ data: 'heartbeat' })
        await settle()
        const afterFirst = count('WF-958')
        expect(afterFirst).toBeGreaterThan(0)

        FakeEventSource.instances[0].onmessage({ data: 'heartbeat' })
        FakeEventSource.instances[0].onmessage({ data: ':ping' })
        await settle()

        expect(count('WF-958')).toBe(afterFirst)
    })

    itDev('WF-970: a throwing params function warns once, not once per fetch', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            params: () => { throw new Error('boom') }
        })
        mountList(q, c)
        await settle()

        const afterFirst = count('WF-970')
        expect(afterFirst).toBeGreaterThan(0)

        wildflower.getQuery(q).refresh()
        await settle()

        expect(count('WF-970')).toBe(afterFirst)
    })

    itDev('WF-981: a broken headers function warns once, not once per request', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            headers: () => { throw new Error('boom') }
        })
        mountList(q, c)
        await settle()

        const afterFirst = count('WF-981')
        expect(afterFirst).toBeGreaterThan(0)

        wildflower.getQuery(q).refresh()
        await settle()

        expect(count('WF-981')).toBe(afterFirst)
    })

    itDev('calibration: two different standing facts each warn — code keys never cross-suppress', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ items: [], count: 0 })   // envelope: WF-980
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            params: () => { throw new Error('boom') }                      // and WF-970
        })
        mountList(q, c)
        await settle()

        expect(count('WF-970'), 'the params fact is named').toBeGreaterThan(0)
        expect(count('WF-980'), 'the shape fact is named beside it').toBeGreaterThan(0)
    })

    // ── WF-986: declared headers rode a cross-origin redirect ──────────
    // Survey ruling #2 (2026-08-28): the platform strips exactly one
    // header on a cross-origin redirect hop — Authorization, nothing
    // else — so a query's declared headers arrive at the redirect
    // target. The engine cannot prevent the hop (the browser owns it);
    // it names the standing condition once. undici shipped three
    // name-list fixes for this class (CVE-2023-45143, CVE-2024-24758);
    // naming beats listing.

    function redirectedResponse(data, finalUrl) {
        const r = new Response(JSON.stringify(data), { status: 200 })
        Object.defineProperty(r, 'redirected', { value: true })
        Object.defineProperty(r, 'url', { value: finalUrl })
        return r
    }

    itDev('WF-986: a cross-origin redirect with declared headers warns once', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () =>
            redirectedResponse([{ id: 1, name: 'a' }], 'https://other.example/api/items')
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            headers: () => ({ 'X-API-Key': 'secret' })
        })
        mountList(q, c)
        await settle()
        const afterFirst = count('WF-986')
        expect(afterFirst, 'the ride-along is named').toBeGreaterThan(0)

        wildflower.getQuery(q).refresh()
        await settle()
        expect(count('WF-986'), 'a standing condition is named once').toBe(afterFirst)
    })

    itDev('calibration: a cross-origin redirect with NO declared headers is silent', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () =>
            redirectedResponse([{ id: 1, name: 'a' }], 'https://other.example/api/items')
        wildflower.query(q, { from: '/api/items', key: 'id' })
        mountList(q, c)
        await settle()
        expect(count('WF-986'), 'nothing rode, nothing to name').toBe(0)
    })

    itDev('calibration: a same-origin redirect never warns', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () =>
            redirectedResponse([{ id: 1, name: 'a' }], location.origin + '/api/items-v2')
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            headers: () => ({ 'X-API-Key': 'secret' })
        })
        mountList(q, c)
        await settle()
        expect(count('WF-986'), 'same-origin hops keep the scope guarantee').toBe(0)
    })

    itDev('WF-986: the write path names the ride-along too', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async (url, init) => {
            const method = (init && init.method) || 'GET'
            if (method !== 'GET') {
                const r = new Response(null, { status: 204 })
                Object.defineProperty(r, 'redirected', { value: true })
                Object.defineProperty(r, 'url', { value: 'https://other.example/api/items/1' })
                return r
            }
            return jsonResponse([{ id: 1, name: 'a' }])
        }
        wildflower.query(q, {
            from: '/api/items', key: 'id', to: '/api/items/:id',
            headers: () => ({ 'X-API-Key': 'secret' })
        })
        mountList(q, c)
        await settle()

        await wildflower.getQuery(q).write({ id: 1, name: 'renamed' })
        await settle(80)
        expect(count('WF-986'), 'the write hop is named').toBeGreaterThan(0)
    })
})
