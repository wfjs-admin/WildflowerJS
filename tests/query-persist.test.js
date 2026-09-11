/**
 * Query cache persistence (`persist:`, v1.5).
 *
 * The contract under test:
 * - Only CONFIRMED SERVER TRUTH ever touches disk (fetch/stream arrivals and
 *   write()'s reconcile, and only with zero writes pending). Optimistic rows
 *   never persist.
 * - Restore happens at ACTIVATION, only into an empty store (SSR seed and
 *   initial: rows win), paints immediately, marks isStale, and revalidates
 *   through the normal activation fetch — conditionally, with the persisted
 *   etag, so an unchanged source confirms via 304.
 * - Envelope {v:1, rows, etag, etagUrl, url, savedAt}; corrupt, versioned,
 *   or >24h-old snapshots are discarded and removed.
 * - Restored rows act only for the URL that produced them (the url stamp;
 *   survey ruling #1): mismatches withhold, unresolvable tokens defer the
 *   comparison to the first URL-resolving fetch, unstamped envelopes paint
 *   only for single-URL queries. Function sources restore unguarded.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-qps-${++seq}`
const keyFor = (name) => 'wf:query:' + name

function jsonResponse(data, headers) {
    return new Response(JSON.stringify(data), { status: 200, headers: headers || {} })
}

async function settle(ms = 50) {
    await new Promise(r => setTimeout(r, ms))
}

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

function readEnvelope(name) {
    const raw = localStorage.getItem(keyFor(name))
    return raw ? JSON.parse(raw) : null
}

suite('query cache persistence (persist:)', () => {
    let wildflower
    let realFetch
    let container
    const cleanupKeys = []

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
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
        while (cleanupKeys.length) { try { localStorage.removeItem(cleanupKeys.pop()) } catch {} }
    })

    function track(name) { cleanupKeys.push(keyFor(name)); return name }

    it('a confirmed fetch saves the envelope; a fresh registration restores and revalidates', async () => {
        const q = track(uname('q'))
        let fetchCount = 0
        window.fetch = async () => { fetchCount++; return jsonResponse([{ id: 1, v: 'server' }], { ETag: 'W/"e1"' }) }
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        wildflower.getQuery(q)
        await settle()

        const env = readEnvelope(q)
        expect(env, 'confirmed fetch persisted').toBeTruthy()
        expect(env.v).toBe(1)
        expect(env.rows).toEqual([{ id: 1, v: 'server' }])
        expect(env.etag).toBe('W/"e1"')
        expect(typeof env.savedAt).toBe('number')

        // Simulate the next session: fresh registry, same storage.
        resetFramework()
        const held = deferred()
        const headers = []
        window.fetch = (url, opts) => { fetchCount++; headers.push(opts && opts.headers); return held.promise }
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        const h = wildflower.getQuery(q)
        await settle()

        expect(h.rows, 'restored rows paint before the revalidation lands').toEqual([{ id: 1, v: 'server' }])
        expect(h.isStale, 'a restored snapshot is stale until confirmed').toBe(true)
        expect(h.lastSync, 'nothing synced this session yet').toBe(null)
        expect(h.isLoading, 'restored rows are data, not a loading state').toBe(false)
        expect(headers[0] && headers[0]['If-None-Match'], 'revalidation rides the persisted etag').toBe('W/"e1"')

        held.resolve(new Response(null, { status: 304 }))
        await settle()
        expect(h.isStale, 'the 304 confirms the restored rows').toBe(false)
        expect(h.lastSync).toBeTruthy()
        expect(h.rows).toEqual([{ id: 1, v: 'server' }])
    })

    it('changed server data replaces the restored snapshot on revalidation', async () => {
        const q = track(uname('q'))
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1, v: 'old-disk' }], etag: 'W/"stale"', savedAt: Date.now() - 60000
        }))
        const held = deferred()
        window.fetch = () => held.promise
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        const h = wildflower.getQuery(q)
        await settle(20)
        expect(h.rows[0].v, 'disk paints first, revalidation in flight').toBe('old-disk')
        held.resolve(jsonResponse([{ id: 1, v: 'fresh' }, { id: 2, v: 'new' }]))
        await settle(30)
        expect(h.rows.map(r => r.v), 'server truth replaces').toEqual(['fresh', 'new'])
        expect(readEnvelope(q).rows.length, 'the fresh truth was re-persisted').toBe(2)
    })

    it('initial: rows win over a persisted snapshot', async () => {
        const q = track(uname('q'))
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 9, v: 'disk' }], etag: null, savedAt: Date.now()
        }))
        const held = deferred()
        window.fetch = () => held.promise
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true, initial: [{ id: 1, v: 'seeded' }] })
        const h = wildflower.getQuery(q)
        await settle(20)
        expect(h.rows, 'initial rows stand; restore stepped aside').toEqual([{ id: 1, v: 'seeded' }])
    })

    it('optimistic writes never persist: mid-flight arrivals skip the save; the drain reconcile saves converged truth', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse([{ id: 1, v: 'a', n: 1 }])
        const pending = []
        wildflower.query(q, {
            from: '/api/x', key: 'id', persist: true,
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        const h = wildflower.getQuery(q)
        await settle()
        expect(readEnvelope(q).rows[0].n, 'baseline persisted').toBe(1)

        const p = h.write({ id: 1, n: 99 })
        await settle(10)
        expect(h.rows[0].n, 'optimistic on screen').toBe(99)
        expect(readEnvelope(q).rows[0].n, 'optimistic value NOT on disk').toBe(1)

        pending[0].resolve({ id: 1, v: 'a', n: 100 })
        await p
        await settle(10)
        expect(h.rows[0].n).toBe(100)
        expect(readEnvelope(q).rows[0].n, 'the confirming reconcile persisted server truth').toBe(100)
    })

    it('a rejected write leaves the last confirmed truth on disk', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse([{ id: 1, n: 1 }])
        const pending = []
        wildflower.query(q, {
            from: '/api/x', key: 'id', persist: true,
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        const h = wildflower.getQuery(q)
        await settle()

        const p = h.write({ id: 1, n: 50 })
        await settle(10)
        pending[0].reject(new Error('HTTP 500'))
        await p.catch(() => {})
        await settle(10)
        expect(h.rows[0].n, 'rolled back on screen').toBe(1)
        expect(readEnvelope(q).rows[0].n, 'disk never saw the guess').toBe(1)
    })

    it('corrupt, versioned, and expired envelopes are discarded and removed', async () => {
        const cases = [
            ['not json at all', 'corrupt'],
            [JSON.stringify({ v: 2, rows: [{ id: 1 }], savedAt: Date.now() }), 'future version'],
            [JSON.stringify({ v: 1, rows: 'nope', savedAt: Date.now() }), 'non-array rows'],
            [JSON.stringify({ v: 1, rows: [{ id: 1, v: 'ancient' }], savedAt: Date.now() - 25 * 60 * 60 * 1000 }), 'older than 24h']
        ]
        for (const [stored, label] of cases) {
            const q = track(uname('q'))
            localStorage.setItem(keyFor(q), stored)
            const held = deferred()
            window.fetch = () => held.promise
            wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
            const h = wildflower.getQuery(q)
            await settle(20)
            expect(h.rows.length, `${label}: nothing restored`).toBe(0)
            expect(h.isLoading, `${label}: cold start`).toBe(true)
            if (label !== 'corrupt') {
                expect(localStorage.getItem(keyFor(q)), `${label}: removed`).toBe(null)
            }
        }
    })

    it("persist: 'custom-key' uses the given key; records round-trip through the same envelope", async () => {
        const q = uname('q')
        const custom = 'test-custom-' + q
        cleanupKeys.push(custom)
        window.fetch = async () => jsonResponse({ name: 'Ada', role: 'Analyst' })
        wildflower.query(q, { from: '/api/me', persist: custom })
        wildflower.getQuery(q)
        await settle()
        const env = JSON.parse(localStorage.getItem(custom))
        expect(env, 'stored under the custom key').toBeTruthy()
        expect(env.rows, 'a record is its one-row array').toEqual([{ name: 'Ada', role: 'Analyst' }])

        resetFramework()
        const held = deferred()
        window.fetch = () => held.promise
        wildflower.query(q, { from: '/api/me', persist: custom })
        const h = wildflower.getQuery(q)
        await settle(20)
        expect(h.rows[0].name, 'record restored').toBe('Ada')
        expect(h.isStale).toBe(true)
    })

    it('WF-968: a bad persist value warns in dev and runs without persistence', async () => {
        if (isMinifiedBuild()) return // dev-only diagnostic; stripped from min builds
        const warnings = []
        const realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
        try {
            const q = track(uname('q'))
            window.fetch = async () => jsonResponse([{ id: 1 }])
            wildflower.query(q, { from: '/api/x', key: 'id', persist: 5 })
            wildflower.getQuery(q)
            await settle()
            expect(warnings.filter(w => w.includes('[WF WF-968]')).length).toBe(1)
            expect(readEnvelope(q), 'nothing persisted').toBe(null)
        } finally {
            console.warn = realWarn
        }
    })

    it('an unpersisted query touches no storage', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse([{ id: 1 }])
        wildflower.query(q, { from: '/api/x', key: 'id' })
        wildflower.getQuery(q)
        await settle()
        expect(readEnvelope(q)).toBe(null)
    })

    // ── Review-hardening pins (2026-08-20) ──────────────

    // Finding 1: the ETag divergence trap. A reconcile-sourced save pairs
    // post-write rows with the pre-write fetch etag; if the server later
    // reverts to byte-identical pre-write content, a 304 against that etag
    // would confirm rows that differ from server truth. The fix removes the
    // weapon: a post-write envelope carries NO etag, so the next session's
    // revalidation sends no If-None-Match and the server must answer 200
    // with the actual truth, reverted or not.
    it('a write-reconciled envelope carries no etag; the revert scenario cannot 304', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse([{ id: 1, n: 1 }], { ETag: 'W/"pre"' })
        const pending = []
        wildflower.query(q, {
            from: '/api/x', key: 'id', persist: true,
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        const h = wildflower.getQuery(q)
        await settle()
        expect(readEnvelope(q).etag, 'fetch save carries the etag').toBe('W/"pre"')

        const p = h.write({ id: 1, n: 2 })
        await settle(10)
        pending[0].resolve({ id: 1, n: 2 })
        await p
        await settle(10)
        expect(readEnvelope(q).rows[0].n, 'reconcile saved the write').toBe(2)
        expect(readEnvelope(q).etag, 'but no etag rides with it').toBe(null)

        // Session 2: the server reverted to pre-write content. Without a
        // persisted etag the revalidation is unconditional; the revert wins.
        resetFramework()
        const headers = []
        const revert = deferred()
        window.fetch = (url, opts) => { headers.push((opts && opts.headers) || {}); return revert.promise }
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        const h2 = wildflower.getQuery(q)
        await settle(20)
        expect(h2.rows[0].n, 'restored rows paint, revalidation in flight').toBe(2)
        expect(headers[0]['If-None-Match'], 'no conditional header was sent').toBe(undefined)
        revert.resolve(jsonResponse([{ id: 1, n: 1 }], { ETag: 'W/"pre"' }))
        await settle(30)
        expect(h2.rows[0].n, 'the server revert lands as truth').toBe(1)
    })

    // Finding 2: the held-confirm drain gap. A server arrival ingested
    // while a write pends defers both its confirm AND its save; if that
    // write then REJECTS, no reconcile will ever save the arrival. The
    // reject-arm drain now saves the converged rows.
    it('an arrival held during a write reaches disk when the write rejects', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse([{ id: 1, v: 'v1', other: 'a' }])
        const pending = []
        wildflower.query(q, {
            from: '/api/x', key: 'id', persist: true,
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        const h = wildflower.getQuery(q)
        await settle()
        expect(readEnvelope(q).rows[0].v).toBe('v1')

        const p = h.write({ id: 1, v: 'optimistic' })
        await settle(10)
        // Background arrival lands mid-write: ingested (claim-honored),
        // confirm and save both deferred.
        window.fetch = async () => jsonResponse([{ id: 1, v: 'v2-server', other: 'b' }])
        await h.invalidate()
        await settle(10)
        expect(readEnvelope(q).rows[0].other, 'mid-write arrival not yet saved').toBe('a')

        pending[0].reject(new Error('HTTP 500'))
        await p.catch(() => {})
        await settle(10)
        expect(h.rows[0].other, 'arrival data on screen after the drain').toBe('b')
        expect(h.rows[0].v, 'rejected field rolled back to arrival truth').toBe('v2-server')
        expect(readEnvelope(q).rows[0].other, 'the drain saved the held arrival').toBe('b')
        expect(readEnvelope(q).rows[0].v).toBe('v2-server')
    })

    // Finding 3: a pre-activation optimistic write must not cost the
    // session its cache. getQuery().write() in the same tick populates
    // rows before the activation microtask; the _seeded flag (not a
    // rows-length check) decides restore precedence, and the claims
    // machinery carries the optimistic row through the restore's replace.
    it('an optimistic write before activation coexists with the restored cache', async () => {
        const q = track(uname('q'))
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1, v: 'disk' }], etag: null, savedAt: Date.now()
        }))
        const held = deferred()
        window.fetch = () => held.promise
        const pending = []
        wildflower.query(q, {
            from: '/api/x', key: 'id', persist: true,
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        const h = wildflower.getQuery(q)
        h.write({ id: 'tmp-1', v: 'mine' })   // same tick, before activation
        await settle(20)
        const vals = h.rows.map(r => r.v)
        expect(vals, 'cache restored AND the optimistic row survives').toContain('disk')
        expect(vals).toContain('mine')
    })

    // Finding 4: a failed save also removes the old snapshot — the engine
    // can no longer vouch that disk matches the last confirmed truth.
    it('a quota-failed save removes the stale snapshot instead of leaving it', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse([{ id: 1, n: 1 }])
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        const h = wildflower.getQuery(q)
        await settle()
        expect(readEnvelope(q), 'first save landed').toBeTruthy()

        const origSet = Storage.prototype.setItem
        Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError') }
        try {
            window.fetch = async () => jsonResponse([{ id: 1, n: 2 }])
            await h.invalidate()
            await settle(10)
        } finally {
            Storage.prototype.setItem = origSet
        }
        expect(h.rows[0].n, 'the arrival still applied').toBe(2)
        expect(localStorage.getItem(keyFor(q)), 'the unvouchable snapshot is gone').toBe(null)
    })

    // Finding 5: the age gate holds against a clock that moved backward
    // (future savedAt = negative age) — anything outside [0, 24h] is out.
    it('a future savedAt (clock moved back) is discarded and removed', async () => {
        const q = track(uname('q'))
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1, v: 'time-traveler' }], etag: null, savedAt: Date.now() + 3600000
        }))
        const held = deferred()
        window.fetch = () => held.promise
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        const h = wildflower.getQuery(q)
        await settle(20)
        expect(h.rows.length, 'nothing restored').toBe(0)
        expect(localStorage.getItem(keyFor(q)), 'removed').toBe(null)
    })

    // Coverage:a FAILED revalidation must not wipe the
    // restored rows — the transient-error split applies (rows present =
    // syncError, never the hard error), and isStale honestly stays up
    // until a sync actually confirms.
    it('a failed revalidation keeps the restored rows; a later sync confirms them', async () => {
        const q = track(uname('q'))
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1, v: 'disk' }], etag: null, savedAt: Date.now()
        }))
        window.fetch = () => Promise.reject(new TypeError('network down'))
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        const h = wildflower.getQuery(q)
        await settle()
        expect(h.rows[0].v, 'restored rows survive the failure').toBe('disk')
        expect(h.syncError, 'transient error, not hard').toBeTruthy()
        expect(h.error, 'no hard error while data is present').toBe(null)
        expect(h.isStale, 'still awaiting confirmation').toBe(true)

        window.fetch = async () => jsonResponse([{ id: 1, v: 'confirmed' }])
        await h.invalidate()
        await settle(10)
        expect(h.rows[0].v).toBe('confirmed')
        expect(h.syncError, 'the successful sync clears it').toBe(null)
        expect(h.isStale).toBe(false)
    })

    // Coverage:the RESOLVE twin of the held-arrival
    // drain pin — an arrival lands mid-write, the write then CONFIRMS,
    // and the reconcile's save must capture the converged truth of both.
    it('an arrival held during a write reaches disk when the write confirms', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse([{ id: 1, v: 'v1' }, { id: 2, v: 'other-v1' }])
        const pending = []
        wildflower.query(q, {
            from: '/api/x', key: 'id', persist: true,
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        const h = wildflower.getQuery(q)
        await settle()

        const p = h.write({ id: 1, v: 'mine' })
        await settle(10)
        window.fetch = async () => jsonResponse([{ id: 1, v: 'server-v2' }, { id: 2, v: 'other-v2' }])
        await h.invalidate()
        await settle(10)
        expect(readEnvelope(q).rows.find(r => r.id === 2).v, 'mid-write arrival not yet saved').toBe('other-v1')

        pending[0].resolve({ id: 1, v: 'mine' })
        await p
        await settle(10)
        const env = readEnvelope(q)
        expect(env.rows.find(r => r.id === 1).v, 'the confirmed write is on disk').toBe('mine')
        expect(env.rows.find(r => r.id === 2).v, 'and the held arrival came with it').toBe('other-v2')
        expect(env.etag, 'reconcile save: no etag').toBe(null)
    })

    // ── SSR adoption × persisted snapshot (status-page canary, 2026-08-20) ──
    // The scope doc's precedence rule: server-rendered markup is the fresher
    // authority at first paint; a restore never fights it. The plain ordering
    // (markup scans in, THEN the query activates) held; the canary demo
    // exposed the other ordering — anything observing the query BEFORE the
    // markup scans (a component computed above the list, a route-guard
    // getQuery() warm) runs activation's restore first, and adoption's
    // rows-present early-return then handed the paint to the disk snapshot.

    it('a persisted snapshot never overrides SSR-adopted markup (markup scans first)', async () => {
        const q = track(uname('q')); const c = uname('c')
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1, name: 'disk-stale' }], etag: 'W/"disk"', savedAt: Date.now()
        }))
        const held = deferred()
        const headers = []
        window.fetch = (url, opts) => { headers.push((opts && opts.headers) || {}); return held.promise }
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <ul data-query="${q}">
                    <template><li class="row" data-bind="name"></li></template>
                    <li class="row" data-seed='{"id":1}'><span data-bind="name">server-rendered</span></li>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(20)

        const h = wildflower.getQuery(q)
        expect(h.rows.map(r => r.name), 'adopted markup stands; restore stepped aside').toEqual(['server-rendered'])
        expect(headers[0] && headers[0]['If-None-Match'], 'the disk etag never arms the catch-up').toBe(undefined)

        held.resolve(jsonResponse([{ id: 1, name: 'server-now' }]))
        await settle(20)
        expect(h.rows[0].name, 'the catch-up lands server truth').toBe('server-now')
    })

    it('SSR adoption beats a restored snapshot when the query was observed before the markup scanned', async () => {
        const q = track(uname('q')); const c = uname('c')
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1, name: 'disk-stale', hidden: 'unrendered' }], etag: 'W/"disk"', savedAt: Date.now()
        }))
        const calls = []
        window.fetch = (url, opts) => {
            const d = deferred()
            calls.push({ headers: (opts && opts.headers) || {}, d })
            return d.promise
        }
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        wildflower.getQuery(q)          // pre-markup observer: a route-guard warm
        await settle(10)                // activation runs: restore paints, fetch departs

        const h = wildflower.getQuery(q)
        expect(h.rows[0].name, 'sanity: the snapshot restored before markup arrived').toBe('disk-stale')
        expect(calls[0].headers['If-None-Match'], 'sanity: that fetch is conditional on the disk etag').toBe('W/"disk"')

        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <ul data-query="${q}">
                    <template><li class="row" data-bind="name"></li></template>
                    <li class="row" data-seed='{"id":1}'><span data-bind="name">server-rendered</span></li>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(20)

        expect(h.rows.map(r => r.name), 'adopted markup replaced the restored snapshot').toEqual(['server-rendered'])
        expect(h.isStale, 'adopted rows await their catch-up confirmation').toBe(true)

        // The first fetch left carrying the DISK etag; a 304 against it must
        // not confirm the adopted rows (they are not the rows it vouches for),
        // and must not re-save the sparser adopted parse over the snapshot.
        calls[0].d.resolve(new Response(null, { status: 304 }))
        await settle(10)
        expect(h.isStale, 'the superseded conditional confirms nothing').toBe(true)
        expect(h.rows[0].name).toBe('server-rendered')

        expect(calls.length, 'a fresh catch-up fetch was issued').toBeGreaterThan(1)
        const last = calls[calls.length - 1]
        expect(last.headers['If-None-Match'], 'and it runs unconditional').toBe(undefined)
        last.d.resolve(jsonResponse([{ id: 1, name: 'server-now', hidden: 'unrendered' }], { ETag: 'W/"now"' }))
        await settle(20)
        expect(h.rows[0].name, 'server truth confirms').toBe('server-now')
        expect(h.isStale).toBe(false)
        expect(readEnvelope(q).rows[0].hidden, 'the re-persisted truth keeps full rows').toBe('unrendered')
    })

    // Finding 6: clearPersisted — the logout story.
    it('clearPersisted removes named snapshots, all snapshots with no args, and reports the count', async () => {
        const qa = track(uname('a')); const qb = track(uname('b'))
        const custom = 'test-clear-' + qb
        cleanupKeys.push(custom)
        window.fetch = async () => jsonResponse([{ id: 1 }])
        wildflower.query(qa, { from: '/api/a', key: 'id', persist: true })
        wildflower.query(qb, { from: '/api/b', key: 'id', persist: custom })
        wildflower.getQuery(qa); wildflower.getQuery(qb)
        await settle()
        expect(readEnvelope(qa)).toBeTruthy()
        expect(localStorage.getItem(custom)).toBeTruthy()

        expect(wildflower.clearPersisted(qa), 'named clear reports one').toBe(1)
        expect(readEnvelope(qa)).toBe(null)
        expect(localStorage.getItem(custom), 'the other snapshot stands').toBeTruthy()

        expect(wildflower.clearPersisted('no-such-query', ), 'unknown name clears nothing').toBe(0)
        expect(wildflower.clearPersisted(), 'no-args sweeps every persisted query').toBe(1)
        expect(localStorage.getItem(custom)).toBe(null)
    })

    // ── clearPersisted suppression window (survey probe #3, ruled
    // 2026-08-29: window + dev warn + docs line) ──
    // The save site is the ingest choke point, so the next delivery after
    // a clear wrote the snapshot right back — the TanStack #3782
    // "re-appears one second later" shape in soft-logout form. The ruling:
    // a clear holds through the TRANSITION — saves are suppressed for the
    // same fixed grace the lifecycle teardown uses — and then persistence
    // resumes on its own. No latch, no re-arm event, no hidden mode: a
    // later session saves normally. Full soft-logout safety still means
    // navigate, reload, or unobserve; the window closes the race.

    it('a delivery landing right after clearPersisted() does not re-save the snapshot', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse([{ id: 1, v: 'server' }])
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        const h = wildflower.getQuery(q)
        await settle()
        expect(readEnvelope(q), 'first load persisted').toBeTruthy()

        expect(wildflower.clearPersisted(q)).toBe(1)
        expect(readEnvelope(q)).toBe(null)

        await h.invalidate()
        await settle(30)
        expect(readEnvelope(q), 'the in-window delivery is suppressed — cleared means cleared').toBe(null)

        await h.refresh()
        await settle(30)
        expect(readEnvelope(q), 'still suppressed for the whole window').toBe(null)
    })

    it('the window lapses on its own and persistence resumes — no latch', async () => {
        const q = track(uname('q'))
        wildflower._queryTeardownGraceMs = 100
        try {
            window.fetch = async () => jsonResponse([{ id: 1, v: 'server' }])
            wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
            const h = wildflower.getQuery(q)
            await settle()
            expect(readEnvelope(q)).toBeTruthy()

            wildflower.clearPersisted(q)
            await h.invalidate()
            await settle(20)
            expect(readEnvelope(q), 'inside the window: suppressed').toBe(null)

            await settle(150) // the transition grace lapses
            await h.invalidate()
            await settle(30)
            expect(readEnvelope(q), 'after the window: saves resume without any re-arm step').toBeTruthy()
        } finally {
            delete wildflower._queryTeardownGraceMs
        }
    })

    it('WF-988 names a suppressed save once per clear in dev builds', async () => {
        if (isMinifiedBuild()) return // dev-only diagnostic; stripped from min builds
        const q = track(uname('q'))
        const warnings = []
        const realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
        try {
            window.fetch = async () => jsonResponse([{ id: 1, v: 'server' }])
            wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
            const h = wildflower.getQuery(q)
            await settle()

            wildflower.clearPersisted(q)
            await h.invalidate()
            await settle(30)
            await h.refresh()
            await settle(30)

            const hits = warnings.filter(w => w.includes('[WF WF-988]'))
            expect(hits.length, 'one diagnostic per clear, not per suppressed save').toBe(1)
            expect(hits[0], 'naming the query').toContain(q)
        } finally {
            console.warn = realWarn
        }
    })

    // ── Poison-pill snapshot (survey batch 8, Lane B row 17) ────────────
    // A snapshot whose rows fail the query's own data-expect declaration is
    // one the app has said it cannot use. Nothing removed it, so every load
    // for the next 24 hours restored the same unusable rows, painted them,
    // and warned again. A shape the app rejects can never become valid on
    // its own, so the restore discards it the way a fingerprint mismatch
    // does, and the next load starts clean.
    it('a restored snapshot that fails data-expect is removed, not re-restored', async () => {
        if (isMinifiedBuild()) return // data-expect is a dev-only declaration
        const q = track(uname('q'))
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1 }], etag: null, savedAt: Date.now() - 60000
        }))
        const held = deferred()
        window.fetch = () => held.promise
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        container.innerHTML = `
            <div data-component="${q}c">
                <ul data-query="${q}" data-expect="id:number, name:string">
                    <template><li data-bind="name"></li></template>
                </ul>
            </div>
        `
        wildflower.component(q + 'c', { state: {} })
        wildflower.scan(container)
        await settle(40)

        expect(localStorage.getItem(keyFor(q)),
            'a snapshot the app declared unusable does not survive the restore').toBe(null)
        held.resolve(jsonResponse([{ id: 1, name: 'real' }]))
        await settle(20)
    })

    // ── WF-992 / WF-994 (bug-history survey, diagnostics pass) ──────────
    // Two silent persistence failures get names. WF-992: a Date/Map/Set
    // reaches a save — JSON round-trips a Date to a string and a Map/Set
    // to {}, so the rows come back retyped (or emptied) only after a
    // reload (redux-persist #82 asked for exactly this warning and never
    // got it). WF-994: a save that THROWS (quota, unserializable row) is
    // dropped along with the old snapshot — the right stance, but it
    // silently disables persistence for the session (TanStack #1701).

    it('WF-992 names a field JSON cannot round-trip, once per query, in dev builds', async () => {
        if (isMinifiedBuild()) return // dev-only diagnostic; stripped from min builds
        const q = track(uname('q'))
        const warnings = []
        const realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
        try {
            wildflower.query(q, {
                from: async () => [{ id: 1, created: new Date(), tags: new Set(['a']) }],
                key: 'id', persist: true
            })
            const h = wildflower.getQuery(q)
            await settle()
            expect(readEnvelope(q), 'the save itself still lands').toBeTruthy()

            const hits = warnings.filter(w => w.includes('[WF WF-992]'))
            expect(hits.length, 'one diagnostic').toBe(1)
            expect(hits[0], 'naming the first offending field').toContain('created')
            expect(hits[0], 'naming its type').toContain('Date')

            await h.refresh()
            await settle(30)
            expect(warnings.filter(w => w.includes('[WF WF-992]')).length,
                'once per query, not per save').toBe(1)
        } finally {
            console.warn = realWarn
        }
    })

    it('WF-992 calibration: plain JSON rows through a save stay silent', async () => {
        if (isMinifiedBuild()) return
        const q = track(uname('q'))
        const warnings = []
        const realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
        try {
            window.fetch = async () => jsonResponse([{ id: 1, name: 'a', meta: { n: 2 }, list: [1, 2] }])
            wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
            wildflower.getQuery(q)
            await settle()
            expect(readEnvelope(q)).toBeTruthy()
            expect(warnings.filter(w => w.includes('[WF WF-992]')).length).toBe(0)
        } finally {
            console.warn = realWarn
        }
    })

    it('WF-994 names a dropped save once in dev builds; the old snapshot still goes', async () => {
        if (isMinifiedBuild()) return // dev-only diagnostic; stripped from min builds
        const q = track(uname('q'))
        const warnings = []
        const realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
        try {
            window.fetch = async () => jsonResponse([{ id: 1, n: 1 }])
            wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
            const h = wildflower.getQuery(q)
            await settle()
            expect(readEnvelope(q), 'first save landed').toBeTruthy()

            const origSet = Storage.prototype.setItem
            Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError') }
            try {
                await h.invalidate()
                await settle(20)
                await h.refresh()
                await settle(20)
            } finally {
                Storage.prototype.setItem = origSet
            }

            const hits = warnings.filter(w => w.includes('[WF WF-994]'))
            expect(hits.length, 'one diagnostic per query, not per failed save').toBe(1)
            expect(hits[0], 'naming the query').toContain(q)
            expect(localStorage.getItem(keyFor(q)),
                'the drop-and-remove behavior is unchanged').toBe(null)
        } finally {
            console.warn = realWarn
        }
    })

    // ── URL guard on restore (bug-history survey ruling #1, 2026-08-28) ──
    // Rows act only for the URL that produced them — the rule the restored
    // VALIDATOR has always followed (env.etagUrl), extended to the rows.
    // Three survey lanes independently derived the failure: reload on
    // article B restored article A's persisted rows until the catch-up
    // fetch landed, or indefinitely if it failed. isStale can say "may be
    // out of date"; it cannot say "belongs to a different resource".

    it('the envelope stamps the resolved URL that produced the rows', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse([{ id: 1, v: 'a' }])
        wildflower.query(q, {
            from: '/api/articles/:slug', key: 'id', persist: true,
            params: { slug: 'alpha' }
        })
        wildflower.getQuery(q)
        await settle()
        expect(readEnvelope(q).url).toBe('/api/articles/alpha')
    })

    it('a restore whose URL matches paints and revalidates; a mismatch withholds', async () => {
        const q = track(uname('q')); const s = uname('route')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'article-A' }], { ETag: 'W/"a1"' })
        wildflower.store(s, { state: { slug: 'a' } })
        const declare = () => wildflower.query(q, {
            from: '/api/articles/:slug', key: 'id', persist: true,
            params: () => ({ slug: wildflower.getStore(s).slug })
        })
        declare()
        wildflower.getQuery(q)
        await settle()
        expect(readEnvelope(q).url).toBe('/api/articles/a')

        // Next session, same slug: the snapshot is for this URL — paint it.
        resetFramework()
        wildflower.store(s, { state: { slug: 'a' } })
        let held = deferred()
        const headers = []
        window.fetch = (url, opts) => { headers.push(opts && opts.headers); return held.promise }
        declare()
        let h = wildflower.getQuery(q)
        await settle(20)
        expect(h.rows, 'matching URL restores').toEqual([{ id: 1, title: 'article-A' }])
        expect(headers[0] && headers[0]['If-None-Match'], 'and the validator rides').toBe('W/"a1"')
        held.resolve(new Response(null, { status: 304 }))
        await settle(20)
        expect(h.isStale).toBe(false)

        // Next session, DIFFERENT slug: article A's rows must not paint
        // into article B's page. The snapshot stays on disk — a later
        // visit to A may still claim it — and the fetch owns the paint.
        resetFramework()
        wildflower.store(s, { state: { slug: 'b' } })
        held = deferred()
        window.fetch = () => held.promise
        declare()
        h = wildflower.getQuery(q)
        await settle(20)
        expect(h.rows, 'a mismatched snapshot is withheld').toEqual([])
        expect(h.isLoading, 'the load presents as a load, not as cached data').toBe(true)
        expect(readEnvelope(q), 'the snapshot is kept, not deleted').toBeTruthy()
        held.resolve(jsonResponse([{ id: 2, title: 'article-B' }]))
        await settle(20)
        expect(h.rows).toEqual([{ id: 2, title: 'article-B' }])
    })

    it('query-string variance guards the same way as path tokens', async () => {
        const q = track(uname('q')); const s = uname('route')
        window.fetch = async () => jsonResponse([{ id: 31, v: 'page-3-row' }])
        wildflower.store(s, { state: { page: 3 } })
        const declare = () => wildflower.query(q, {
            from: '/api/items', key: 'id', persist: true,
            params: () => ({ page: wildflower.getStore(s).page })
        })
        declare()
        wildflower.getQuery(q)
        await settle()
        expect(readEnvelope(q).url).toBe('/api/items?page=3')

        resetFramework()
        wildflower.store(s, { state: { page: 1 } })
        const held = deferred()
        window.fetch = () => held.promise
        declare()
        const h = wildflower.getQuery(q)
        await settle(20)
        expect(h.rows, "page 3's rows never paint as page 1").toEqual([])
        held.resolve(jsonResponse([{ id: 1, v: 'page-1-row' }]))
        await settle(20)
        expect(h.rows[0].v).toBe('page-1-row')
    })

    it('an unresolvable token defers the comparison; the resolving fetch paints a match pre-network', async () => {
        const q = track(uname('q')); const s = uname('route')
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1, title: 'article-A' }], etag: null,
            url: '/api/articles/a', savedAt: Date.now() - 60000
        }))
        wildflower.store(s, { state: { slug: null } })
        const held = deferred()
        window.fetch = () => held.promise
        wildflower.query(q, {
            from: '/api/articles/:slug', key: 'id', persist: true,
            params: () => ({ slug: wildflower.getStore(s).slug })
        })
        const h = wildflower.getQuery(q)
        await settle(20)
        expect(h.rows, 'nothing paints while the token is unresolved').toEqual([])

        // The token lands as the URL the snapshot came from: the fetch
        // that carries it settles the comparison and paints BEFORE the
        // network answers.
        wildflower.getStore(s).slug = 'a'
        h.refresh()
        await settle(20)
        expect(h.rows, 'the deferred restore painted ahead of the response').toEqual([{ id: 1, title: 'article-A' }])
        expect(h.isStale, 'restored rows are stale until confirmed').toBe(true)
        held.resolve(jsonResponse([{ id: 1, title: 'article-A-fresh' }]))
        await settle(20)
        expect(h.rows[0].title).toBe('article-A-fresh')
    })

    it('a deferred comparison that resolves to a different URL discards the claim', async () => {
        const q = track(uname('q')); const s = uname('route')
        localStorage.setItem(keyFor(q), JSON.stringify({
            v: 1, rows: [{ id: 1, title: 'article-A' }], etag: null,
            url: '/api/articles/a', savedAt: Date.now() - 60000
        }))
        wildflower.store(s, { state: { slug: null } })
        const held = deferred()
        window.fetch = () => held.promise
        wildflower.query(q, {
            from: '/api/articles/:slug', key: 'id', persist: true,
            params: () => ({ slug: wildflower.getStore(s).slug })
        })
        const h = wildflower.getQuery(q)
        await settle(20)

        wildflower.getStore(s).slug = 'b'
        h.refresh()
        await settle(20)
        expect(h.rows, "article A's rows never paint for article B").toEqual([])
        held.resolve(jsonResponse([{ id: 2, title: 'article-B' }]))
        await settle(20)
        expect(h.rows[0].title).toBe('article-B')
    })

    // ── Shape fingerprint (survey ruling #4, 2026-08-29) ─────────────────
    // A snapshot outlives the code that produced it. Rows are stored
    // post-`select:` while the ETag validates the server's raw BYTES, so
    // a deploy that changes only the client-side shaping (select, key)
    // restores old-shaped rows and the catch-up 304 CONFIRMS them fresh —
    // a stable wrong state, no signal (apollo-cache-persist #323 /
    // TanStack `buster`). The envelope now carries a fingerprint of the
    // client-side shapers, hashed from source TEXT: it can only
    // over-discard (any real shape change changes the text), never
    // under-discard, and an over-discard costs one cold reload.
    // Server-side shape changes need no fingerprint: new shape = new
    // bytes = no 304, and the 200 replaces the restore.

    it('the envelope stamps a shape fingerprint; matching shapers restore', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse({ rows: [{ id: 1, v: 'a' }] })
        const declare = () => wildflower.query(q, {
            from: '/api/x', key: 'id', persist: true,
            select: d => d.rows
        })
        declare()
        wildflower.getQuery(q)
        await settle()
        const env = readEnvelope(q)
        expect(typeof env.fp, 'the fingerprint is stamped').toBe('number')
        expect(env.rows).toEqual([{ id: 1, v: 'a' }])

        // Next session, byte-identical declaration: restores as always.
        resetFramework()
        const held = deferred()
        window.fetch = () => held.promise
        declare()
        const h = wildflower.getQuery(q)
        await settle(20)
        expect(h.rows, 'an unchanged shape restores').toEqual([{ id: 1, v: 'a' }])
        held.resolve(jsonResponse({ rows: [{ id: 1, v: 'a2' }] }))
        await settle(20)
        expect(h.rows[0].v).toBe('a2')
    })

    it('a changed select: source discards the snapshot instead of restoring it', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse({ rows: [{ id: 1, v: 'old-shape' }] })
        wildflower.query(q, {
            from: '/api/x', key: 'id', persist: true,
            select: d => d.rows
        })
        wildflower.getQuery(q)
        await settle()
        expect(readEnvelope(q)).toBeTruthy()

        // The deploy changed the shaping code. The old snapshot can never
        // be valid again, so it is REMOVED (unlike a URL mismatch, where
        // a later visit may still claim the snapshot).
        resetFramework()
        const held = deferred()
        window.fetch = () => held.promise
        wildflower.query(q, {
            from: '/api/x', key: 'id', persist: true,
            select: d => d.rows.map(r => ({ id: r.id, label: r.v }))
        })
        const h = wildflower.getQuery(q)
        await settle(20)
        expect(h.rows, 'old-shaped rows never paint under new shaping').toEqual([])
        expect(readEnvelope(q), 'the dead snapshot is removed').toBe(null)
        held.resolve(jsonResponse({ rows: [{ id: 1, v: 'fresh' }] }))
        await settle(20)
        expect(h.rows[0].label, 'the fetch paints the new shape').toBe('fresh')
        const env2 = readEnvelope(q)
        expect(env2 && env2.rows[0].label, 'the new save carries the new shape').toBe('fresh')
    })

    it('a changed key discards the snapshot the same way', async () => {
        const q = track(uname('q'))
        window.fetch = async () => jsonResponse([{ id: 1, slug: 's1', v: 'a' }])
        wildflower.query(q, { from: '/api/x', key: 'id', persist: true })
        wildflower.getQuery(q)
        await settle()
        expect(readEnvelope(q)).toBeTruthy()

        resetFramework()
        const held = deferred()
        window.fetch = () => held.promise
        wildflower.query(q, { from: '/api/x', key: 'slug', persist: true })
        const h = wildflower.getQuery(q)
        await settle(20)
        expect(h.rows, 'a re-keyed query starts cold').toEqual([])
        expect(readEnvelope(q)).toBe(null)
        held.resolve(jsonResponse([{ id: 1, slug: 's1', v: 'a2' }]))
        await settle(20)
        expect(h.rows[0].v).toBe('a2')
    })

    it('a pre-fingerprint envelope restores only when the query declares no select', async () => {
        // Lenient half: no select declared means no client-side shaping to
        // have drifted; the hand-written/pre-upgrade envelope is safe.
        const qa = track(uname('q'))
        localStorage.setItem(keyFor(qa), JSON.stringify({
            v: 1, rows: [{ id: 1, v: 'disk' }], etag: null, url: '/api/x', savedAt: Date.now()
        }))
        const heldA = deferred()
        window.fetch = () => heldA.promise
        wildflower.query(qa, { from: '/api/x', key: 'id', persist: true })
        const ha = wildflower.getQuery(qa)
        await settle(20)
        expect(ha.rows, 'no select: the unstamped envelope restores').toEqual([{ id: 1, v: 'disk' }])
        heldA.resolve(jsonResponse([{ id: 1, v: 'fresh' }]))
        await settle(10)

        // Strict half: a select-bearing query cannot vouch for which
        // shaping produced an unstamped envelope.
        const qb = track(uname('q'))
        localStorage.setItem(keyFor(qb), JSON.stringify({
            v: 1, rows: [{ id: 1, v: 'disk' }], etag: null, url: '/api/x', savedAt: Date.now()
        }))
        const heldB = deferred()
        window.fetch = () => heldB.promise
        wildflower.query(qb, {
            from: '/api/x', key: 'id', persist: true,
            select: d => d.rows
        })
        const hb = wildflower.getQuery(qb)
        await settle(20)
        expect(hb.rows, 'select declared: the unstamped envelope is withheld').toEqual([])
        heldB.resolve(jsonResponse({ rows: [{ id: 1, v: 'fresh' }] }))
        await settle(10)
        expect(hb.rows[0].v).toBe('fresh')
    })

    it('a pre-guard envelope (no url field) still restores for a single-URL query, and only there', async () => {
        // The lenient half: a static query's every save came from its one
        // URL, so a hand-written or pre-upgrade envelope is safe to paint.
        const qa = track(uname('q'))
        localStorage.setItem(keyFor(qa), JSON.stringify({
            v: 1, rows: [{ id: 1, v: 'disk' }], etag: null, savedAt: Date.now()
        }))
        const heldA = deferred()
        window.fetch = () => heldA.promise
        wildflower.query(qa, { from: '/api/x', key: 'id', persist: true })
        const ha = wildflower.getQuery(qa)
        await settle(20)
        expect(ha.rows, 'static query: the unstamped envelope restores').toEqual([{ id: 1, v: 'disk' }])
        heldA.resolve(jsonResponse([{ id: 1, v: 'fresh' }]))
        await settle(10)

        // The strict half: a query that CAN vary cannot vouch for which
        // URL an unstamped envelope came from — withheld.
        const qb = track(uname('q')); const s = uname('route')
        localStorage.setItem(keyFor(qb), JSON.stringify({
            v: 1, rows: [{ id: 1, v: 'disk' }], etag: null, savedAt: Date.now()
        }))
        wildflower.store(s, { state: { page: 2 } })
        const heldB = deferred()
        window.fetch = () => heldB.promise
        wildflower.query(qb, {
            from: '/api/items', key: 'id', persist: true,
            params: () => ({ page: wildflower.getStore(s).page })
        })
        const hb = wildflower.getQuery(qb)
        await settle(20)
        expect(hb.rows, 'varying query: the unstamped envelope is withheld').toEqual([])
        heldB.resolve(jsonResponse([{ id: 21, v: 'page-2' }]))
        await settle(10)
        expect(hb.rows[0].v).toBe('page-2')
    })
})
