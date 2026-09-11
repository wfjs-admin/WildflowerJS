/**
 * The freshness window (v1.5 launch addition):
 * a `fresh:N` token in the refresh rung list makes EVENT rungs
 * (focus/reconnect) skip their refetch while the last confirming sync is
 * younger than N seconds and the store is not stale.
 *
 * Scope pins (the boundaries are the feature):
 * - poll keeps its own explicitly chosen cadence (fresh does not gate it)
 * - explicit refresh()/invalidate() always fetch (user demand bypasses)
 * - a stale store refetches regardless of the window (doubt wins)
 * - no token = freshSecs 0 = today's always-check behavior (the expected
 *   default; pinned separately by the plain focus-rung test)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-qfr-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

suite('data-query freshness window (fresh:N rung token)', () => {
    let container
    let wildflower
    let realFetch

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
    })

    afterEach(() => {
        window.fetch = realFetch
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

    it('a focus fire inside the window skips the refetch', async () => {
        const q = uname('q'); const c = uname('c')
        let fetchCount = 0
        let payload = [{ id: 1, name: 'v1' }]
        window.fetch = async () => { fetchCount++; return jsonResponse(payload) }
        wildflower.query(q, { from: '/api/x.json', refresh: ['focus', 'fresh:300'] })
        mountList(q, c)
        await settle()
        expect(container.querySelector('.row').textContent).toBe('v1')
        const before = fetchCount

        payload = [{ id: 1, name: 'v2' }]
        window.dispatchEvent(new Event('focus'))
        await settle()
        expect(fetchCount, 'fresh data: the focus fire is skipped').toBe(before)
        expect(container.querySelector('.row').textContent, 'rows untouched').toBe('v1')
    })

    it('a focus fire after the window expires refetches', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'v1' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', refresh: ['focus', 'fresh:1'] })
        mountList(q, c)
        await settle()
        expect(container.querySelector('.row').textContent).toBe('v1')

        await settle(1100) // the 1-second window lapses
        payload = [{ id: 1, name: 'v2' }]
        window.dispatchEvent(new Event('focus'))
        await settle()
        expect(container.querySelector('.row').textContent, 'expired window refetches').toBe('v2')
    })

    it('a reconnect fire inside the window skips the refetch', async () => {
        const q = uname('q'); const c = uname('c')
        let fetchCount = 0
        let payload = [{ id: 1, name: 'v1' }]
        window.fetch = async () => { fetchCount++; return jsonResponse(payload) }
        wildflower.query(q, { from: '/api/x.json', refresh: ['reconnect', 'fresh:300'] })
        mountList(q, c)
        await settle()
        const before = fetchCount

        payload = [{ id: 1, name: 'v2' }]
        window.dispatchEvent(new Event('online'))
        await settle()
        expect(fetchCount, 'fresh data: the reconnect fire is skipped').toBe(before)
        expect(container.querySelector('.row').textContent).toBe('v1')
    })

    it('a stale store refetches on focus despite the window', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, name: 'v1' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/x.json', key: 'id', refresh: ['focus', 'fresh:300'] })
        mountList(q, c)
        await settle()

        // patch() is an optimistic client write: the store goes stale.
        wildflower.getQuery(q).patch({ id: 1, name: 'local-guess' })
        await settle(20)
        expect(wildflower.getQuery(q).isStale).toBe(true)

        payload = [{ id: 1, name: 'server-truth' }]
        window.dispatchEvent(new Event('focus'))
        await settle()
        expect(container.querySelector('.row').textContent,
            'doubt wins over the window: the stale store refetched').toBe('server-truth')
        expect(wildflower.getQuery(q).isStale).toBe(false)
    })

    it('explicit refresh() and invalidate() bypass the window', async () => {
        const q = uname('q'); const c = uname('c')
        let fetchCount = 0
        let payload = [{ id: 1, name: 'v1' }]
        window.fetch = async () => { fetchCount++; return jsonResponse(payload) }
        wildflower.query(q, { from: '/api/x.json', refresh: ['focus', 'fresh:300'] })
        mountList(q, c)
        await settle()
        const before = fetchCount

        payload = [{ id: 1, name: 'v2' }]
        await wildflower.getQuery(q).refresh()
        await settle(20)
        expect(fetchCount, 'refresh() is user demand').toBe(before + 1)
        expect(container.querySelector('.row').textContent).toBe('v2')

        payload = [{ id: 1, name: 'v3' }]
        await wildflower.getQuery(q).invalidate()
        await settle(20)
        expect(fetchCount, 'invalidate() is user demand').toBe(before + 2)
        expect(container.querySelector('.row').textContent).toBe('v3')
    })

    it('the missed-arrival drain catch-up is never suppressed by the window', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/x.json', key: 'id', refresh: ['focus', 'fresh:300'],
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle(20)
        releases[0]([{ id: 1, name: 'v1' }])
        await settle(20)
        const h = wildflower.getQuery(q)

        const p1 = h.invalidate()
        await settle(20)
        const p = h.write({ id: 1, name: 'mine' })
        await settle(20)
        releases[1]([{ id: 1, name: 'THEIRS' }])
        await p1.catch(() => {})
        await settle(20)

        pending[0].resolve({ id: 1, name: 'mine' })
        await p
        await settle(20)
        expect(releases.length, 'the catch-up is demand, not an event rung: it fires').toBe(3)
        releases[2]([{ id: 1, name: 'mine' }])
        await settle(20)
        expect(h.isStale).toBe(false)
    })

    it('poll keeps its own cadence; fresh does not gate it', async () => {
        const q = uname('q'); const c = uname('c')
        let fetchCount = 0
        let payload = [{ id: 1, name: 'v1' }]
        window.fetch = async () => { fetchCount++; return jsonResponse(payload) }
        wildflower.query(q, { from: '/api/x.json', refresh: [1, 'fresh:300'] })
        mountList(q, c)
        await settle()
        const before = fetchCount

        payload = [{ id: 1, name: 'v2' }]
        await settle(1300) // one poll tick inside the "fresh" window
        expect(fetchCount, 'the poll cadence was chosen explicitly; it fires').toBeGreaterThan(before)
        expect(container.querySelector('.row').textContent).toBe('v2')
    })

    // Coverage:the window starts at a CONFIRMING sync,
    // never at an attempt. A focus-triggered fetch that FAILS leaves the
    // store stale with no new lastSync, so a focus seconds later must
    // refetch — a window reset by the mere attempt would trap the user
    // with a failure for the whole fresh:N span.
    it('a failed sync does not reset the freshness window; the next focus retries', async () => {
        const q = uname('q'); const c = uname('c')
        let fetchCount = 0
        let mode = 'ok'
        window.fetch = async () => {
            fetchCount++
            if (mode === 'fail') throw new TypeError('network down')
            return jsonResponse([{ id: 1, name: 'v' + fetchCount }])
        }
        wildflower.query(q, { from: '/api/x.json', refresh: ['focus', 'fresh:1'] })
        mountList(q, c)
        await settle()
        expect(fetchCount, 'initial load').toBe(1)

        await settle(1100) // step outside the 1s window
        mode = 'fail'
        window.dispatchEvent(new Event('focus'))
        await settle(20)
        expect(fetchCount, 'outside the window: the focus fetched, and failed').toBe(2)

        mode = 'ok'
        window.dispatchEvent(new Event('focus'))
        await settle(20)
        expect(fetchCount, 'no confirming sync happened, so the retry is not gated').toBe(3)
        expect(container.querySelector('.row').textContent).toBe('v3')
    })

    // Coverage:staleness from a pending WRITE bypasses
    // the window (doubt wins), and the resulting arrival defers to the
    // write machinery — the claimed field keeps its optimistic value
    // until the write settles.
    it('a mid-write focus bypasses the window; the arrival honors the claim', async () => {
        const q = uname('q'); const c = uname('c')
        let fetchCount = 0
        window.fetch = async () => { fetchCount++; return jsonResponse([{ id: 1, name: 'server' }]) }
        const pending = []
        wildflower.query(q, {
            from: '/api/x.json', key: 'id', refresh: ['focus', 'fresh:300'],
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        expect(fetchCount).toBe(1)

        const h = wildflower.getQuery(q)
        const p = h.write({ id: 1, name: 'optimistic' })
        await settle(10)
        window.dispatchEvent(new Event('focus'))
        await settle(20)
        expect(fetchCount, 'stale store: focus bypassed the 300s window').toBe(2)
        expect(h.rows[0].name, 'the arrival honored the pending claim').toBe('optimistic')
        expect(h.isStale, 'freshness deferred while the write pends').toBe(true)

        pending[0].resolve({ id: 1, name: 'optimistic' })
        await p
        await settle(10)
        expect(h.rows[0].name).toBe('optimistic')
        expect(h.isStale, 'the settle drains the deferral').toBe(false)
    })

    // WF-967: a refresh token matching no rung warns instead of vanishing.
    // The motivating case is the plausible-but-wrong 'poll:15' (poll is the
    // bare number), which used to register a query with no poll and no
    // hint. Valid tokens — including 'once' — must stay silent.
    it('WF-967: an unrecognized rung token warns in dev; valid tokens stay silent', async () => {
        if (isMinifiedBuild()) return // dev-only diagnostic; stripped from min builds
        const warnings = []
        const realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
        try {
            window.fetch = async () => jsonResponse([])
            wildflower.query(uname('q'), { from: '/api/x.json', refresh: ['poll:15', 'fresh:10'] })
            // wfError emits two console.warn lines (message + docs link, both
            // carrying the code string); match the bracketed prefix so one
            // diagnostic counts once.
            const bogus = warnings.filter(w => w.includes('[WF WF-967]'))
            expect(bogus.length, "'poll:15' matches no rung; it warns").toBe(1)
            expect(bogus[0]).toContain('poll:15')

            warnings.length = 0
            wildflower.query(uname('q'), { from: '/api/x.json', refresh: ['once', 15, 'focus', 'reconnect', 'etag:30', 'fresh:10'] })
            expect(warnings.filter(w => w.includes('[WF WF-967]')).length, 'every valid token is silent').toBe(0)
        } finally {
            console.warn = realWarn
        }
    })

    // ── The stream-reopen catch-up honors the window (survey ruling #6, ─
    // ruled 2026-08-29: the fresh:N gate, reused). A flapping stream — a
    // proxy recycling idle connections, a fleet reconnecting after an
    // outage — otherwise fires one conditional catch-up per reopen per
    // client, synchronized, with no backoff. One deliberate difference
    // from the focus rung's gate: the stream ERROR itself stamps isStale,
    // and honoring that self-inflicted doubt would make the window
    // unreachable on exactly this path — so the gate reads the
    // PRE-outage staleness instead. Doubt that predates the outage (a
    // pending patch) still overrides, which the calibration pins.

    class FakeEventSource {
        constructor(url) {
            this.url = url
            this.closed = false
            FakeEventSource.instances.push(this)
        }
        close() { this.closed = true }
    }

    async function withFakeES(fn) {
        const real = window.EventSource
        FakeEventSource.instances = []
        window.EventSource = FakeEventSource
        try { await fn() } finally { window.EventSource = real }
    }

    it('a stream reopen inside the window skips the catch-up fetch', async () => {
        await withFakeES(async () => {
            const q = uname('q'); const c = uname('c')
            let fetchCount = 0
            window.fetch = async () => { fetchCount++; return jsonResponse([{ id: 1, name: 'v1' }]) }
            wildflower.query(q, { from: '/api/x.json', key: 'id', refresh: ['sse', 'fresh:300'] })
            mountList(q, c)
            await settle()
            expect(FakeEventSource.instances.length).toBe(1)
            const h = wildflower.getQuery(q)
            const before = fetchCount

            const es = FakeEventSource.instances[0]
            es.onerror()               // transient drop; the browser reconnects
            await settle(20)
            expect(h.syncError, 'the outage is recorded').toBe('stream interrupted')

            es.onopen()
            await settle()
            expect(fetchCount, 'fresh data: the reopen catch-up is skipped').toBe(before)
            expect(h.syncError, 'the reopen still clears the outage').toBe(null)
        })
    })

    it('a stream reopen after the window expires catches up', async () => {
        await withFakeES(async () => {
            const q = uname('q'); const c = uname('c')
            let fetchCount = 0
            window.fetch = async () => { fetchCount++; return jsonResponse([{ id: 1, name: 'v1' }]) }
            wildflower.query(q, { from: '/api/x.json', key: 'id', refresh: ['sse', 'fresh:1'] })
            mountList(q, c)
            await settle()
            const before = fetchCount

            await settle(1100) // the 1-second window lapses
            const es = FakeEventSource.instances[0]
            es.onerror()
            await settle(20)
            es.onopen()
            await settle()
            expect(fetchCount, 'an expired window catches up').toBe(before + 1)
        })
    })

    it('a stream reopen with no fresh token always catches up', async () => {
        await withFakeES(async () => {
            const q = uname('q'); const c = uname('c')
            let fetchCount = 0
            window.fetch = async () => { fetchCount++; return jsonResponse([{ id: 1, name: 'v1' }]) }
            wildflower.query(q, { from: '/api/x.json', key: 'id', refresh: 'sse' })
            mountList(q, c)
            await settle()
            const before = fetchCount

            const es = FakeEventSource.instances[0]
            es.onerror()
            await settle(20)
            es.onopen()
            await settle()
            expect(fetchCount, 'no token = 0 = the standing always-catch-up').toBe(before + 1)
        })
    })

    // ── Backward clock (survey batch 8, Lane A #11) ────────────────────
    // The window compares Date.now() - lastSync against N seconds. If the
    // device clock moves BACKWARD after a sync (NTP correction, manual
    // change, a VM resuming from a snapshot), that difference goes negative,
    // which is less than any window, so every event rung is suppressed until
    // real time catches back up — hours or days. The persist restore gate
    // already refuses a negative age for exactly this reason; the freshness
    // gate did not. A negative age means the clock moved, not that the data
    // is fresh, so the window stops applying and the rung fires.

    it('a backward clock does not suppress focus refetches', async () => {
        const q = uname('q'); const c = uname('c')
        let fetchCount = 0
        window.fetch = async () => { fetchCount++; return jsonResponse([{ id: 1, name: 'v1' }]) }
        wildflower.query(q, { from: '/api/x.json', key: 'id', refresh: ['focus', 'fresh:300'] })
        mountList(q, c)
        await settle()
        const before = fetchCount

        // The clock jumps back an hour: lastSync is now in the future.
        const store = wildflower.getStore(q)
        store.lastSync = Date.now() + 3600000
        window.dispatchEvent(new Event('focus'))
        await settle()

        expect(fetchCount, 'a future lastSync is a moved clock, not fresh data').toBe(before + 1)
    })

    it('a backward clock does not suppress the stream-reopen catch-up', async () => {
        await withFakeES(async () => {
            const q = uname('q'); const c = uname('c')
            let fetchCount = 0
            window.fetch = async () => { fetchCount++; return jsonResponse([{ id: 1, name: 'v1' }]) }
            wildflower.query(q, { from: '/api/x.json', key: 'id', refresh: ['sse', 'fresh:300'] })
            mountList(q, c)
            await settle()
            const before = fetchCount

            wildflower.getStore(q).lastSync = Date.now() + 3600000
            const es = FakeEventSource.instances[0]
            es.onerror()
            await settle(20)
            es.onopen()
            await settle()

            expect(fetchCount, 'the reopen gate honors the same clock guard').toBe(before + 1)
        })
    })

    it('pre-outage staleness overrides the window on reopen (doubt wins)', async () => {
        await withFakeES(async () => {
            const q = uname('q'); const c = uname('c')
            let fetchCount = 0
            window.fetch = async () => { fetchCount++; return jsonResponse([{ id: 1, name: 'v1' }]) }
            wildflower.query(q, { from: '/api/x.json', key: 'id', refresh: ['sse', 'fresh:300'] })
            mountList(q, c)
            await settle()
            const h = wildflower.getQuery(q)

            h.patch({ id: 1, name: 'local-guess' })   // doubt that PREDATES the outage
            await settle(20)
            expect(h.isStale, 'the patch marked the store stale').toBe(true)
            const before = fetchCount

            const es = FakeEventSource.instances[0]
            es.onerror()
            await settle(20)
            es.onopen()
            await settle()
            expect(fetchCount, 'pre-outage doubt is not the window\'s to tolerate').toBe(before + 1)
        })
    })
})
