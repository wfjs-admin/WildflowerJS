/**
 * Declarative writes (v1.5 feature 2) — step 0: patch() field-merge
 * conformance, then write() itself.
 *
 * The provenance line:
 * client intents MERGE, server truth REPLACES, write() confirmations
 * MERGE-PATCH. patch() and write()'s optimistic apply field-merge partial
 * payloads into key-matched rows ({...currentRow, ...incoming}); the record
 * branch merges into rows[0]. Fetch, SSE, gentle-merge, and append arrivals
 * keep replacing matched rows — a server payload there is a complete row.
 *
 * UPDATED 2026-08-26:
 * write()'s reconcile no longer replaces verbatim. It follows JSON Merge
 * Patch (RFC 7396) instead — a field present with a value applies, present
 * as `null` deletes, ABSENT is left untouched. A confirmation is a patch,
 * not an exhaustive read, and treating it as one silently dropped fields an
 * endpoint simply didn't echo back (found via the data-query tutorial's
 * mock server, tests 45-48). Fetch/SSE/append are unaffected — see test 48.
 *
 * Step-0e audit of existing patch pins (2026-08-15): every keyed patch
 * pin in query-patch.test.js sends full rows, where merge ≡ replace; the
 * record pin in data-query-multi-element.test.js (patch({version}))
 * asserts only the patched field. No test pins replace-on-partial, so no
 * existing pin changes with this conformance.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-dqw-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query writes — step 0: patch() field-merge conformance', () => {
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

    function mountList(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <ul data-query="${qname}"><template><li class="row" data-bind="title"></li></template></ul>
            </div>
        `
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    // 0a
    it('patch() with a partial keyed row merges fields; unnamed fields survive', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([
            { id: 1, title: 'Buy milk', done: false },
            { id: 2, title: 'Walk dog', done: true }
        ])
        wildflower.query(q, { from: '/api/todos', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        h.patch([{ id: 1, done: true }])
        await settle(40)

        expect(h.rows[0].title, 'unnamed field must survive a partial patch').toBe('Buy milk')
        expect(h.rows[0].done).toBe(true)
        expect(h.rows[1]).toEqual({ id: 2, title: 'Walk dog', done: true })
        expect(h.isStale).toBe(true)
    })

    // 0b
    it('patch() with a full row behaves as before (merge ≡ replace for complete payloads)', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a', done: false }])
        wildflower.query(q, { from: '/api/todos', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        h.patch([{ id: 1, title: 'A!', done: true }])
        await settle(40)

        expect(h.rows[0]).toEqual({ id: 1, title: 'A!', done: true })
        const texts = [...container.querySelectorAll('.row')].map(e => e.textContent)
        expect(texts).toEqual(['A!'])
    })

    // 0c
    it('record query: patch({field}) merges into rows[0]; other record fields survive', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ name: 'Ada', role: 'eng' })
        wildflower.query(q, { from: '/api/me' })
        container.innerHTML = `
            <div data-component="${c}">
                <div data-query="${q}">
                    <span class="who" data-bind="name"></span>
                    <span class="role" data-bind="role"></span>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.who').textContent).toBe('Ada')

        const h = wildflower.getQuery(q)
        h.patch({ name: 'Grace' })
        await settle(40)

        expect(container.querySelector('.who').textContent).toBe('Grace')
        expect(container.querySelector('.role').textContent, 'unnamed record field must survive').toBe('eng')
        expect(h.rows[0]).toEqual({ name: 'Grace', role: 'eng' })
        expect(h.isStale).toBe(true)
    })

    // 0d (gentle-merge arrival)
    it('gentle arrivals over an accumulated store REPLACE matched rows (server truth)', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: true }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/todos', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        payload = [{ id: 3, title: 'c', done: false }]
        h.refresh({ append: true })
        await settle()
        expect(h.rows.length).toBe(3)

        // Server sends a row WITHOUT `done`: the fresh row stands verbatim.
        payload = [{ id: 1, title: 'A!' }]
        h.invalidate()
        await settle()

        const row1 = h.rows.find(r => r.id === 1)
        expect(row1).toEqual({ id: 1, title: 'A!' })
        expect('done' in row1, 'a server row is complete; fields it drops are dropped').toBe(false)
        expect(h.rows.map(r => r.id).sort()).toEqual([1, 2, 3])
    })

    // 0d (append arrival)
    it('append arrivals REPLACE matched rows (server truth)', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, title: 'a', done: false }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/todos', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        payload = [{ id: 1, title: 'A2' }]
        h.refresh({ append: true })
        await settle()

        expect(h.rows[0]).toEqual({ id: 1, title: 'A2' })
        expect('done' in h.rows[0]).toBe(false)
    })

    // 0f — the internal flavor write()'s reconcile rides. UPDATED
    // 2026-08-26 alongside the merge-patch fix: this used
    // to pin verbatim-replace ("done" dropped because the resolved payload
    // omitted it). That was the exact bug the tutorial hit. reconcile now
    // follows JSON Merge Patch (RFC 7396) — absent fields survive.
    // Dev-only: it reaches _queryIngest by name, and engine methods are
    // property-mangled in production builds. The same merge-patch rule is
    // pinned through the public path — a write whose confirmation omits a
    // field — by the confirmation tests above, which run in both arms.
    it.skipIf(isMinifiedBuild())('internal reconcile flavor follows JSON Merge Patch: absent fields survive, present fields apply', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'milk', done: false }])
        wildflower.query(q, { from: '/api/todos', key: 'id' })
        mountList(q, c)
        await settle()

        const controller = wildflower._queryControllers.get(q)
        wildflower._queryIngest(controller, { id: 1, title: 'oat' }, { patch: true, reconcile: true, source: 'write' })
        await settle(40)

        const h = wildflower.getQuery(q)
        expect(h.rows[0], 'title applies, done (absent from the resolved payload) survives')
            .toEqual({ id: 1, title: 'oat', done: false })
    })
})

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

suite('data-query writes — write(): one option, one method', () => {
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

    function mountList(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <ul data-query="${qname}"><template><li class="row" data-bind="title"></li></template></ul>
            </div>
        `
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    // 1
    it('optimistic apply is visible immediately, isStale true, other fields survive', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'Buy milk', done: false }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => new Promise(() => {})   // never settles: pure optimistic window
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        h.write({ id: 1, done: true })
        await settle(40)

        expect(h.rows[0]).toEqual({ id: 1, title: 'Buy milk', done: true })
        expect(h.isStale).toBe(true)
        expect(container.querySelector('.row').textContent).toBe('Buy milk')
    })

    // 2
    it('resolve with a record, same key: server version replaces optimistic; isStale clears; claims released', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'Buy milk', done: false }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.resolve({ id: 1, title: 'Buy milk (server)', done: true })
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, done: true })
        await settle(40)

        expect(h.rows[0]).toEqual({ id: 1, title: 'Buy milk (server)', done: true })
        expect(h.isStale, 'confirming reconcile clears staleness').toBe(false)
        expect(h.syncError).toBe(null)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.fieldClaims.size, 'claims released on settle').toBe(0)
    })

    // 3
    it('resolve with a CHANGED key (tmp-id → real id): no duplicate, tmp row gone', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a', done: false }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        const p = h.write({ id: 'tmp-9', title: 'New item' })
        await settle(20)
        expect(h.rows.some(r => r.id === 'tmp-9'), 'optimistic row visible').toBe(true)

        pending[0].resolve({ id: 42, title: 'New item', done: false })
        await p
        await settle(40)
        expect(h.rows.some(r => r.id === 'tmp-9'), 'tmp row corrected away').toBe(false)
        expect(h.rows.filter(r => r.title === 'New item').length, 'no duplicate').toBe(1)
        expect(h.rows.find(r => r.id === 42)).toEqual({ id: 42, title: 'New item', done: false })
    })

    // 4 — UPDATED 2026-08-28 (write-settle validator hygiene, bug-history
    // survey): this used to pin the refetch as CONDITIONAL, carrying the
    // pre-write ETag. That was the reproduced defect: a lagging origin's
    // 304 against that validator stamped the optimistic rows as confirmed
    // truth. A settled write drops the held validators, so the follow-up
    // refetch is deliberately UNCONDITIONAL — the data just changed, and
    // only a full response can say what it changed to.
    it('resolve with nothing: invalidate() refetches unconditionally (validators dropped at settle)', async () => {
        const q = uname('q'); const c = uname('c')
        let fetchCount = 0
        let lastHeaders = null
        window.fetch = async (url, opts) => {
            fetchCount++
            lastHeaders = (opts && opts.headers) || {}
            return new Response(JSON.stringify([{ id: 1, title: 'a', done: false }]),
                { status: 200, headers: { ETag: '"v1"' } })
        }
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.resolve()   // 204-style: no body
        })
        mountList(q, c)
        await settle()
        const before = fetchCount

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, done: true })
        await settle()

        expect(fetchCount, 'reconcile refetches').toBe(before + 1)
        const inm = lastHeaders && (lastHeaders['If-None-Match'] || (lastHeaders.get && lastHeaders.get('If-None-Match')))
        expect(inm, 'the refetch must NOT carry the pre-write validator').toBeFalsy()
        expect(h.isStale).toBe(false)
    })

    // 5 — the design doc's worked example verbatim.
    it('reject: field-level rollback — failed write reverts only the fields it set', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'Buy milk', done: false }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: (item) => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        // t=0: user ticks the checkbox (write A)
        const pA = h.write({ id: 1, done: true })
        await settle(20)
        expect(h.rows[0]).toEqual({ id: 1, title: 'Buy milk', done: true })

        // t=200: user renames while A is in flight (write B)
        const pB = h.write({ id: 1, title: 'Buy oat milk' })
        await settle(20)
        expect(h.rows[0]).toEqual({ id: 1, title: 'Buy oat milk', done: true })

        // t=400: A FAILS — done reverts, the rename stays put
        pending[0].reject(new Error('409 conflict'))
        await expect(pA).rejects.toThrow('409 conflict')
        await settle(40)
        expect(h.rows[0]).toEqual({ id: 1, title: 'Buy oat milk', done: false })
        expect(h.syncError).toBeTruthy()

        // B then resolves: its record confirms
        pending[1].resolve({ id: 1, title: 'Buy oat milk', done: false })
        await pB
        await settle(40)
        expect(h.rows[0]).toEqual({ id: 1, title: 'Buy oat milk', done: false })
        expect(h.isStale).toBe(false)
    })

    // 6
    it('rollback tie-break: a later write owns the field; the earlier rollback skips it', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'original', done: false }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const pA = h.write({ id: 1, title: 'AAA' })
        await settle(20)
        const pB = h.write({ id: 1, title: 'BBB' })
        await settle(20)
        expect(h.rows[0].title).toBe('BBB')

        pending[0].reject(new Error('rejected'))
        await expect(pA).rejects.toThrow('rejected')
        await settle(40)
        expect(h.rows[0].title, "B owns the field; B's answer is still coming").toBe('BBB')

        pending[1].resolve({ id: 1, title: 'BBB', done: false })
        await pB
    })

    // 7
    it('reject sets syncError (not error), rejects the promise, and never touches the retry ladder', async () => {
        const q = uname('q'); const c = uname('c')
        let fetchCount = 0
        let toCalls = 0
        window.fetch = async () => { fetchCount++; return jsonResponse([{ id: 1, title: 'a', done: false }]) }
        wildflower._queryRetryBaseMs = 20
        wildflower.query(q, {
            from: '/api/todos', key: 'id', retry: 3,
            to: () => { toCalls++; return Promise.reject(new Error('500 server error')) }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)
        const fetchesBefore = fetchCount

        await expect(h.write({ id: 1, done: true })).rejects.toThrow('500 server error')
        await settle(300)   // several retry-base periods: nothing may fire

        expect(h.syncError).toBeTruthy()
        expect(h.error, 'a write failure is transient; rows are preserved').toBe(null)
        expect(toCalls, 'writes never auto-retry').toBe(1)
        expect(fetchCount, 'the read ladder stays untouched').toBe(fetchesBefore)
        delete wildflower._queryRetryBaseMs
    })

    // 8 — UPDATED after review: every write()/create() failure REJECTS.
    // This used to pin a synchronous throw, which was the two-rule contract
    // the review flagged: three declaration mistakes threw before a promise
    // existed (so .catch never attached) while two data mistakes rejected.
    it('write() with no `to` declared rejects WF-964', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a', done: false }])
        wildflower.query(q, { from: '/api/todos', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await expect(h.write({ id: 1, done: true })).rejects.toThrow(/WF-964/)
    })

    // 9
    it('record-shape query: write() merges into rows[0]; rollback reverts fields on the record', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ name: 'Ada', role: 'eng' })
        const pending = []
        wildflower.query(q, {
            from: '/api/me',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <div data-query="${q}">
                    <span class="who" data-bind="name"></span>
                    <span class="role" data-bind="role"></span>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        const h = wildflower.getQuery(q)
        const p = h.write({ name: 'Grace' })
        await settle(40)
        expect(container.querySelector('.who').textContent).toBe('Grace')
        expect(container.querySelector('.role').textContent).toBe('eng')

        pending[0].reject(new Error('403 forbidden'))
        await expect(p).rejects.toThrow('403 forbidden')
        await settle(40)
        expect(h.rows[0]).toEqual({ name: 'Ada', role: 'eng' })
        expect(container.querySelector('.who').textContent).toBe('Ada')
        expect(h.syncError).toBeTruthy()
    })

    // 10 — decision (a): a write supersedes any in-flight refetch.
    it('write during an in-flight refresh: the stale fetch is discarded; optimistic state survives', async () => {
        const q = uname('q'); const c = uname('c')
        const fetches = []
        window.fetch = (url, opts) => {
            const d = deferred()
            fetches.push(d)
            return d.promise
        }
        const toPending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); toPending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle(20)
        fetches[0].resolve(jsonResponse([{ id: 1, title: 'server-v1', done: false }]))
        await settle()
        const h = wildflower.getQuery(q)
        expect(h.rows[0].title).toBe('server-v1')

        // A refresh goes out and hangs; the user writes while it is in flight.
        h.refresh()
        await settle(20)
        const p = h.write({ id: 1, title: 'optimistic' })
        await settle(20)
        expect(h.rows[0].title).toBe('optimistic')

        // The old read finally lands — and is discarded (superseded).
        fetches[1].resolve(jsonResponse([{ id: 1, title: 'server-v1', done: false }]))
        await settle()
        expect(h.rows[0].title, 'a write supersedes an in-flight refetch').toBe('optimistic')

        // The write's reconcile confirms it, and the drain re-runs the
        // interrupted refresh (its delivery was dropped; see tests 35/36).
        toPending[0].resolve({ id: 1, title: 'optimistic', done: false })
        await p
        await settle(40)
        expect(h.rows[0]).toEqual({ id: 1, title: 'optimistic', done: false })
        expect(fetches.length, 'the superseded refresh is re-run at the drain').toBe(3)
        fetches[2].resolve(jsonResponse([{ id: 1, title: 'optimistic', done: false }]))
        await settle(40)
        expect(h.rows[0]).toEqual({ id: 1, title: 'optimistic', done: false })
        expect(h.isStale).toBe(false)
    })

    // 11 — declare-to-delete, both arms.
    it('tombstone delete requires the declared field: declared removes, undeclared merges', async () => {
        const qA = uname('qa'); const qB = uname('qb'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: false }])
        wildflower.query(qA, {
            from: '/api/todos', key: 'id', deleted: 'gone',
            to: () => new Promise(() => {})
        })
        wildflower.query(qB, {
            from: '/api/todos', key: 'id',   // no `deleted` declaration
            to: () => new Promise(() => {})
        })
        container.innerHTML = `
            <div data-component="${c}">
                <ul class="la" data-query="${qA}"><template><li class="row" data-bind="title"></li></template></ul>
                <ul class="lb" data-query="${qB}"><template><li class="row" data-bind="title"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        const hA = wildflower.getQuery(qA)
        hA.write({ id: 1, gone: true })
        await settle(40)
        expect(hA.rows.length, 'declared tombstone removes the row').toBe(1)
        expect(hA.rows[0].id).toBe(2)

        const hB = wildflower.getQuery(qB)
        hB.write({ id: 1, gone: true })
        await settle(40)
        expect(hB.rows.length, 'without the declaration the row stays').toBe(2)
        expect(hB.rows[0].gone, 'the field merges as plain data').toBe(true)
    })

    // 13 — nested reference values. The rollback snapshot stores the field's
    // previous REFERENCE; this holds because no engine path ever deep-mutates
    // (merges replace slots, server arrivals replace rows), so the snapshot
    // cannot be contaminated by later writes. Also pins the proxy round-trip:
    // the captured value is read through the reactive facade and written back
    // through the ingest, and must come back content-identical.
    it('rollback restores nested array values intact across overlapping writes', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, tags: ['urgent'], title: 'Fix Bug' }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        // A writes the nested field; B edits a disjoint field while A flies.
        const pA = h.write({ id: 1, tags: ['urgent', 'ui'] })
        await settle(20)
        const pB = h.write({ id: 1, title: 'Fix Bug (edited)' })
        await settle(20)
        expect(h.rows[0].tags).toEqual(['urgent', 'ui'])

        pending[0].reject(new Error('409'))
        await expect(pA).rejects.toThrow('409')
        await settle(40)
        expect(h.rows[0].tags, 'nested value restored content-intact').toEqual(['urgent'])
        expect(h.rows[0].title, "B's disjoint edit survives").toBe('Fix Bug (edited)')

        // Rapid-fire on the SAME nested field: D's snapshot is C's payload
        // array, which nothing mutates while D flies.
        const pC = h.write({ id: 1, tags: ['a', 'b'] })
        await settle(20)
        const pD = h.write({ id: 1, tags: ['a', 'b', 'c'] })
        await settle(20)
        expect(h.rows[0].tags).toEqual(['a', 'b', 'c'])

        pending[3].reject(new Error('409'))
        await expect(pD).rejects.toThrow('409')
        await settle(40)
        expect(h.rows[0].tags, "D reverts to C's optimistic value, uncontaminated").toEqual(['a', 'b'])

        // Settle the survivors so nothing rejects after teardown.
        pending[1].resolve({ id: 1, tags: ['a', 'b'], title: 'Fix Bug (edited)' })
        pending[2].resolve({ id: 1, tags: ['a', 'b'], title: 'Fix Bug (edited)' })
        await Promise.all([pB, pC])
    })

    // 14 — out-of-order double reject. When the later claimant of a field
    // rejects, its rollback hands the claim back to the most recent still-
    // pending earlier writer of that field, so the earlier write's own
    // rollback can still run. Both failing must land on the original value.
    it('both overlapping writes reject out of order: the field unwinds to the original value', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'v0' }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const pA = h.write({ id: 1, name: 'v1' })
        await settle(20)
        const pB = h.write({ id: 1, name: 'v2' })
        await settle(20)
        expect(h.rows[0].name).toBe('v2')

        pending[1].reject(new Error('B failed'))
        await expect(pB).rejects.toThrow('B failed')
        await settle(40)
        expect(h.rows[0].name, "B unwinds to its pre-image (A's optimistic value)").toBe('v1')

        pending[0].reject(new Error('A failed'))
        await expect(pA).rejects.toThrow('A failed')
        await settle(40)
        expect(h.rows[0].name, 'A then unwinds to the original').toBe('v0')
        expect(wildflower._queryControllers.get(q).fieldClaims.size).toBe(0)
    })

    // 14b — the resolve counterpart must NOT unwind: once the later write
    // confirms, the field is server truth and the earlier rejection skips it.
    it('later write resolves, earlier rejects: the confirmed value stands', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'v0' }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const pA = h.write({ id: 1, name: 'v1' })
        await settle(20)
        const pB = h.write({ id: 1, name: 'v2' })
        await settle(20)

        pending[1].resolve({ id: 1, name: 'v2' })
        await pB
        await settle(20)

        pending[0].reject(new Error('A failed'))
        await expect(pA).rejects.toThrow('A failed')
        await settle(40)
        expect(h.rows[0].name, 'server-confirmed value is not unwound').toBe('v2')
    })

    // 15 — a confirm deferred by an overlapping pending write must still land
    // when that write settles by rejection: isStale cannot stick forever.
    it('fast write confirms, slow write then rejects: staleness clears, syncError stays', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const pA = h.write({ id: 1, name: 'A-slow' })
        await settle(20)
        const pB = h.write({ id: 2, name: 'B-fast' })
        await settle(20)

        pending[1].resolve({ id: 2, name: 'B-fast' })
        await pB
        await settle(20)
        expect(h.isStale, 'confirm defers while another write is pending').toBe(true)

        const lastSyncBefore = h.lastSync
        pending[0].reject(new Error('A failed'))
        await expect(pA).rejects.toThrow('A failed')
        await settle(40)
        expect(h.isStale, 'the deferred confirm lands once nothing is pending').toBe(false)
        expect(h.syncError, 'the rejection is still reported').toBeTruthy()
        expect(h.lastSync, 'the confirmed sync is stamped').not.toBe(lastSyncBefore)
        expect(h.rows.find(r => r.id === 1).name, "A's field rolled back").toBe('a')
        expect(h.rows.find(r => r.id === 2).name).toBe('B-fast')
    })

    // 16 — a synchronous throw inside to() takes the full rejection path.
    it('to() throwing synchronously rejects, rolls back, and leaks nothing', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'v0' }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { throw new Error('sync throw') }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        await expect(h.write({ id: 1, name: 'v1' })).rejects.toThrow('sync throw')
        await settle(40)
        expect(h.rows[0].name, 'optimistic value rolled back').toBe('v0')
        expect(h.syncError).toBeTruthy()
        const controller = wildflower._queryControllers.get(q)
        expect(controller.fieldClaims.size).toBe(0)
        expect(controller.pendingWrites).toBe(0)
    })

    // 17 — a rejected delete restores the pre-image WITHOUT clobbering fields
    // an overlapping in-flight write claims on the re-created row.
    it('delete rejects while an overlapping write holds a field: the claim is honored', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'v0', done: false }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const pA = h.write({ id: 1, gone: true })
        await settle(20)
        expect(h.rows.length, 'optimistic delete').toBe(0)

        const pB = h.write({ id: 1, name: 'vB' })
        await settle(20)
        expect(h.rows[0].name, 'B re-creates the row').toBe('vB')

        pending[0].reject(new Error('delete failed'))
        await expect(pA).rejects.toThrow('delete failed')
        await settle(40)
        expect(h.rows.length).toBe(1)
        expect(h.rows[0].name, "B's in-flight optimistic field survives the restore").toBe('vB')
        expect(h.rows[0].done, 'unclaimed pre-image fields are restored').toBe(false)

        pending[1].resolve({ id: 1, name: 'vB', done: false })
        await pB
        await settle(40)
        expect(h.rows[0]).toEqual({ id: 1, name: 'vB', done: false })
    })

    // 20 — repeated overlapping write/reject cycles must not corrupt row
    // identity. The ingest historically carried facade-proxied rows back
    // into the raw graph (one wrap layer per cycle), which corrupts
    // path/NODES lookups (bindings update the wrong fields) and walks
    // ever-deeper ownKeys chains (the demo froze after a few cycles).
    it('many overlapping write/reject cycles keep values, DOM routing, and bookkeeping intact', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([
            { id: 1, title: 'alpha', done: false },
            { id: 2, title: 'beta', done: false }
        ])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row">
                    <span class="t" data-bind="title"></span>
                    <span class="d" data-bind="done"></span>
                </li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()
        const h = wildflower.getQuery(q)

        for (let i = 0; i < 12; i++) {
            const base = pending.length
            const pA = h.write({ id: 1, done: true })            // doomed
            const pB = h.write({ id: 2, done: true })            // doomed
            const pC = h.write({ id: 1, title: 'cycle ' + i })   // survives
            pending[base].reject(new Error('409 cycle ' + i))
            pending[base + 1].reject(new Error('409 cycle ' + i))
            pending[base + 2].resolve({ id: 1, title: 'cycle ' + i, done: false })
            await expect(pA).rejects.toThrow('409')
            await expect(pB).rejects.toThrow('409')
            await pC
            await settle(25)
        }

        expect(h.rows.find(r => r.id === 1)).toEqual({ id: 1, title: 'cycle 11', done: false })
        expect(h.rows.find(r => r.id === 2)).toEqual({ id: 2, title: 'beta', done: false })
        const rowEls = [...container.querySelectorAll('.row')]
        expect(rowEls.map(el => el.querySelector('.t').textContent)).toEqual(['cycle 11', 'beta'])
        expect(rowEls.map(el => el.querySelector('.d').textContent)).toEqual(['false', 'false'])
        const controller = wildflower._queryControllers.get(q)
        expect(controller.fieldClaims.size).toBe(0)
        expect(controller.pendingWrites).toBe(0)
    })

    // 21 — a confirm's replace honors other writes' claims. Write A's
    // server record carries the PRE-B value of a field B still has in
    // flight; applying it verbatim would flicker B's optimistic value
    // away and back. The field-ownership rule extends to confirms: B owns
    // title, and B's answer is still coming.
    it("a confirm never overwrites a field another in-flight write claims", async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'old title', done: true }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const pA = h.write({ id: 1, done: false })          // reopen
        await settle(20)
        const pB = h.write({ id: 1, title: 'new title' })   // rename, in flight throughout
        await settle(20)
        expect(h.rows[0]).toEqual({ id: 1, title: 'new title', done: false })

        // A confirms with the server's record, whose title predates B.
        pending[0].resolve({ id: 1, title: 'old title', done: false })
        await pA
        await settle(40)
        expect(h.rows[0].done, "A's field is server truth").toBe(false)
        expect(h.rows[0].title, "B's claimed field is untouched").toBe('new title')

        pending[1].resolve({ id: 1, title: 'new title', done: false })
        await pB
        await settle(40)
        expect(h.rows[0]).toEqual({ id: 1, title: 'new title', done: false })
        expect(h.isStale).toBe(false)
    })

    // 19 — the design's flagship form: `to: item => fetch(...)` with no
    // .json(). A raw Response is transport, never a record: ok normalizes
    // to the invalidate path, not-ok to the rejection path (read-side
    // 'HTTP <status>' shape). Parsing (.then(r => r.json())) is the way
    // to opt into record reconcile.
    it('to resolving with a raw ok Response invalidates instead of ingesting the Response', async () => {
        const q = uname('q'); const c = uname('c')
        let fetchCount = 0
        window.fetch = async () => { fetchCount++; return jsonResponse([{ id: 1, name: 'a' }]) }
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.resolve(new Response('{}', { status: 201 }))
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)
        const before = fetchCount

        await h.write({ id: 1, name: 'b' })
        await settle()

        expect(fetchCount, 'reconciles by refetch').toBe(before + 1)
        expect(h.rows[0], 'no Response object ever reaches the rows').toEqual({ id: 1, name: 'a' })
        expect(h.isStale).toBe(false)
    })

    it('to resolving with a raw non-ok Response takes the rejection path', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'v0' }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.resolve(new Response('nope', { status: 500 }))
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        await expect(h.write({ id: 1, name: 'v1' })).rejects.toThrow('HTTP 500')
        await settle(40)
        expect(h.rows[0].name, 'optimistic value rolled back').toBe('v0')
        expect(h.syncError).toBeTruthy()
        expect(h.error).toBe(null)
    })

    // 24 — temp-id correction under an in-flight edit (the key-alias fix).
    // The edit's claims must follow the row through the rename (its
    // optimistic value survives the create's reconcile), and its eventual
    // rollback must target the REAL row — never resurrect a tmp ghost.
    it('an in-flight edit follows a temp-id correction: claim survives, rollback targets the real row', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a', done: false }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const pA = h.write({ id: 'tmp-9', title: 'New item', done: false })   // create
        await settle(20)
        const pB = h.write({ id: 'tmp-9', done: true })                        // edit the tmp row
        await settle(20)
        expect(h.rows.find(r => r.id === 'tmp-9').done).toBe(true)

        pending[0].resolve({ id: 42, title: 'New item', done: false })         // correction
        await pA
        await settle(40)
        expect(h.rows.some(r => r.id === 'tmp-9'), 'tmp row gone').toBe(false)
        const row42 = h.rows.find(r => r.id === 42)
        expect(row42, 'corrected row exists').toBeTruthy()
        expect(row42.done, "the edit's optimistic value survives the correction").toBe(true)

        pending[1].reject(new Error('409'))
        await expect(pB).rejects.toThrow('409')
        await settle(40)
        expect(h.rows.some(r => r.id === 'tmp-9'), 'no ghost tmp row after rollback').toBe(false)
        expect(h.rows.find(r => r.id === 42).done, 'rollback lands on the confirmed record value').toBe(false)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.fieldClaims.size).toBe(0)
        expect(controller.pendingWrites).toBe(0)
    })

    // 25 — out-of-band arrival vs in-flight write: the arrival defers to
    // the claim (no mid-write flicker), updates unclaimed fields, and
    // refreshes the rollback target so a rejection lands on the NEW truth,
    // never clobbering another client's change with pre-arrival state.
    it('a server arrival honors an in-flight claim and refreshes its rollback target', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, status: 'A', note: 'n0' }]
        window.fetch = async () => jsonResponse(payload)
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const p = h.write({ id: 1, status: 'B' })
        await settle(20)
        expect(h.rows[0].status).toBe('B')

        payload = [{ id: 1, status: 'C', note: 'n1' }]   // another client changed it
        await h.invalidate()
        await settle()
        expect(h.rows[0].status, 'claimed field keeps the optimistic value').toBe('B')
        expect(h.rows[0].note, 'unclaimed fields take the arrival').toBe('n1')

        pending[0].reject(new Error('409'))
        await expect(p).rejects.toThrow('409')
        await settle(40)
        expect(h.rows[0].status, "rollback lands on the arrival's truth, not pre-arrival state").toBe('C')
    })

    // 26 — pagination append re-delivering an in-flight row: same contract
    // as any server arrival — claim honored, rollback target refreshed.
    it('an append page re-delivering an in-flight row honors the claim and refreshes rollback', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, title: 'a1', tag: 'g1' }]
        window.fetch = async () => jsonResponse(payload)
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const p = h.write({ id: 1, title: 'optimistic' })
        await settle(20)

        payload = [{ id: 1, title: 'server-shift', tag: 'g2' }, { id: 2, title: 'a2', tag: 'g1' }]
        await h.refresh({ append: true })
        await settle()
        expect(h.rows.find(r => r.id === 1).title, 'claim survives the append').toBe('optimistic')
        expect(h.rows.find(r => r.id === 1).tag, 'unclaimed fields take the page').toBe('g2')
        expect(h.rows.length).toBe(2)

        pending[0].reject(new Error('409'))
        await expect(p).rejects.toThrow('409')
        await settle(40)
        expect(h.rows.find(r => r.id === 1).title, 'rollback lands on the page value').toBe('server-shift')
    })

    // 27 — the push-collision (Apollo #9414 / Ember Data #6149 class): an
    // out-of-band arrival delivers the SAME entity under its real id while
    // the tmp create and an edit are still in flight. The correction must
    // merge onto the arrived row — one row, claimed fields surviving —
    // never a permanent duplicate.
    it('a temp-id correction merges with a row that already arrived under the real id', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, title: 'a', done: false }]
        window.fetch = async () => jsonResponse(payload)
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const pA = h.write({ id: 'tmp-9', title: 'New item', done: false })  // create
        await settle(20)
        const pB = h.write({ id: 'tmp-9', done: true })                       // edit the tmp row
        await settle(20)

        // The server pushes the created entity (real id) before the create's
        // own confirm returns — e.g. via SSE or another client's refresh.
        payload = [{ id: 1, title: 'a', done: false }, { id: 42, title: 'New item', done: false }]
        await h.invalidate()
        await settle()

        pending[0].resolve({ id: 42, title: 'New item', done: false })       // correction collides
        await pA
        await settle(40)
        expect(h.rows.filter(r => r.id === 42).length, 'exactly one row under the real id').toBe(1)
        expect(h.rows.some(r => r.id === 'tmp-9'), 'tmp twin gone').toBe(false)
        expect(h.rows.find(r => r.id === 42).done, "the edit's optimistic value survives the merge").toBe(true)

        pending[1].reject(new Error('409'))
        await expect(pB).rejects.toThrow('409')
        await settle(40)
        expect(h.rows.filter(r => r.id === 42).length).toBe(1)
        expect(h.rows.find(r => r.id === 42).done, 'rollback lands on the record value').toBe(false)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.fieldClaims.size).toBe(0)
        expect(controller.keyAliases.size, 'aliases drain with the registry').toBe(0)
    })

    // Survey batch 8 (Lane A #19): the alias chain is walked with a while
    // loop and had no cycle guard. Aliases come from server-issued key
    // corrections, so a server that renamed A to B and later B back to A
    // closes a loop, and the walk spins forever with the page frozen. The
    // guard stops at the first key already visited. Constructed directly,
    // since no legitimate sequence of corrections produces a cycle today.
    it('a cyclic key alias chain terminates instead of hanging the page', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            to: () => Promise.resolve(undefined)
        })
        mountList(q, c)
        await settle()

        const controller = wildflower._queryControllers.get(q)
        controller.keyAliases.set('1', 2)
        controller.keyAliases.set('2', 1)   // closes the loop

        // Without the guard this never returns and the test times out.
        const done = await Promise.race([
            wildflower.getQuery(q).write({ id: 1, name: 'b' }).then(() => 'settled', () => 'settled'),
            new Promise(r => setTimeout(() => r('hung'), 2000))
        ])
        expect(done, 'the alias walk terminates').toBe('settled')
    })

    // 28 — write-before-first-load (RTK #4271 class): the write supersedes
    // the initial fetch; if it then REJECTS, the query must recover the
    // interrupted load instead of stranding an empty, forever-loading store.
    it('a rejected write issued before the first load recovers the initial fetch', async () => {
        const q = uname('q'); const c = uname('c')
        const fetches = []
        window.fetch = () => {
            const d = deferred()
            fetches.push(d)
            return d.promise
        }
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle(20)

        const h = wildflower.getQuery(q)
        const p = h.write({ id: 'tmp-1', title: 'Eager' })   // supersedes the first load
        await settle(20)
        expect(h.rows.length).toBe(1)

        fetches[0].resolve(jsonResponse([{ id: 1, title: 'server' }]))  // superseded: discarded
        await settle()
        expect(h.rows[0].title, 'the write outranks the stale first load').toBe('Eager')

        pending[0].reject(new Error('409'))
        await expect(p).rejects.toThrow('409')
        await settle()
        expect(fetches.length, 'the rejection recovers the interrupted load').toBeGreaterThan(1)
        expect(h.syncError, 'the failure is reported while recovery runs').toBeTruthy()
        fetches[fetches.length - 1].resolve(jsonResponse([{ id: 1, title: 'server' }]))
        await settle()
        expect(h.rows.length, 'server rows land after recovery').toBe(1)
        expect(h.rows[0].title).toBe('server')
        expect(h.isLoading, 'not stuck loading').toBe(false)
        expect(h.syncError, 'the confirming recovery clears the transient error').toBe(null)
    })

    // 29 — isLoading means "nothing to show", on every path (survey batch 8,
    // Lane A #21; peer survey 2026-08-30). The fetch path has always taken
    // rows as data: `hadData` is `lastSync !== null || rows.length > 0`, so a
    // seeded or restored query reports stale rather than loading. The
    // optimistic write branch was the one place that skipped the rule, so a
    // write issued before the first load left isLoading true WITH its own
    // rows painted, and a bound spinner rendered over real content.
    //
    // TanStack derives status from data presence (`hasData ? 'success' :
    // 'pending'`) and RTK Query gates on it (`!hasData && isFetching`); both
    // end loading when optimistic data lands. Apollo keeps loading
    // request-driven, but affords that with a nine-value networkStatus plus
    // previousData. With one boolean, request-driven means a spinner over
    // content. isStale keeps carrying "unconfirmed".
    it('a write before the first load ends the loading state and marks the rows stale', async () => {
        const q = uname('q'); const c = uname('c')
        const fetches = []
        window.fetch = () => { const d = deferred(); fetches.push(d); return d.promise }
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle(20)

        const h = wildflower.getQuery(q)
        expect(h.isLoading, 'nothing to show yet').toBe(true)

        const p = h.write({ id: 'tmp-1', title: 'Eager' })
        await settle(20)

        expect(h.rows.length, 'the optimistic row is on screen').toBe(1)
        expect(h.isLoading, 'there is something to show, so loading is over').toBe(false)
        expect(h.isStale, 'but it is unconfirmed, which is what isStale is for').toBe(true)
        expect(h.lastSync, 'and nothing has synced').toBe(null)

        // The rejected create removes the row, so there is nothing to show
        // again and the recovery fetch re-raises the flag on its own.
        pending[0].reject(new Error('409'))
        await expect(p).rejects.toThrow('409')
        await settle(40)
        expect(h.rows.length, 'the optimistic row is gone').toBe(0)
        expect(h.isLoading, 'empty again, so loading again').toBe(true)
    })

    // 30 — teardown between a confirm's invalidate and its fetch settling
    // (TanStack #5968 class: unmount-aborted reconcile refetch stranded a
    // permanently-fetching query). Reactivation's catch-up fetch must
    // deliver truth with no stuck flags.
    it('teardown during a reconcile refetch recovers via reactivation catch-up', async () => {
        const q = uname('q'); const c = uname('c')
        const fetches = []
        window.fetch = () => {
            const d = deferred()
            fetches.push(d)
            return d.promise
        }
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.resolve()   // resolve-with-nothing: reconcile via invalidate
        })
        mountList(q, c)
        await settle(20)
        fetches[0].resolve(jsonResponse([{ id: 1, title: 'v1' }]))
        await settle()
        const h = wildflower.getQuery(q)
        const controller = wildflower._queryControllers.get(q)

        const wp = h.write({ id: 1, title: 'v2' })
        wp.catch(() => {})
        await settle(20)
        expect(fetches.length, 'the confirm fired its reconcile refetch').toBe(2)

        wildflower._queryTeardown(controller)                 // aborts the refetch
        fetches[1].resolve(jsonResponse([{ id: 1, title: 'stale' }]))
        await settle()

        wildflower.getQuery(q)                                 // re-observation reactivates
        await settle(20)
        expect(fetches.length, 'reactivation issues a catch-up fetch').toBe(3)
        fetches[2].resolve(jsonResponse([{ id: 1, title: 'v2-server' }]))
        await settle()
        expect(h.rows[0].title, 'truth lands after recovery').toBe('v2-server')
        expect(h.isLoading).toBe(false)
        expect(h.isStale, 'no stuck staleness').toBe(false)
        expect(controller.pendingWrites).toBe(0)
    })

    // 29 — the delete-side existence claim: an arrival re-delivering a row
    // mid-optimistic-delete must not resurrect it; and a rejected delete
    // restores with the ARRIVAL's fresh values (registry pre-images are
    // refresh targets), not the stale pre-delete snapshot.
    it('a pending delete holds against arrivals; a rejected delete restores fresh values', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, title: 'old', done: false }, { id: 2, title: 'b', done: false }]
        window.fetch = async () => jsonResponse(payload)
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const p = h.write({ id: 1, gone: true })
        await settle(20)
        expect(h.rows.length, 'optimistic removal').toBe(1)

        payload = [{ id: 1, title: 'fresh', done: true }, { id: 2, title: 'b', done: false }]
        await h.invalidate()
        await settle()
        expect(h.rows.length, 'the absence holds against the arrival').toBe(1)
        expect(h.rows[0].id).toBe(2)

        pending[0].reject(new Error('409'))
        await expect(p).rejects.toThrow('409')
        await settle(40)
        expect(h.rows.length, 'the rejected delete restores the row').toBe(2)
        const restored = h.rows.find(r => r.id === 1)
        expect(restored.title, "restored with the arrival's fresh value").toBe('fresh')
        expect(restored.done).toBe(true)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.rowClaims.size, 'row claims drain').toBe(0)
        expect(controller.fieldClaims.size).toBe(0)
    })

    // 23 — the status-envelope footgun: a KEYED write resolving with an
    // object that lacks the query key ({ success: true }) cannot be the
    // row's record. It takes the resolve-with-nothing arm (invalidate)
    // instead of mangling rows, and dev builds warn (WF-965).
    it('a keyed write resolving with a keyless object invalidates instead of ingesting it', async () => {
        const q = uname('q'); const c = uname('c')
        let fetchCount = 0
        window.fetch = async () => { fetchCount++; return jsonResponse([{ id: 1, name: 'v0' }, { id: 2, name: 'w0' }]) }
        const warnings = []
        const realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
        try {
            wildflower.query(q, {
                from: '/api/todos', key: 'id',
                to: () => Promise.resolve({ success: true })
            })
            mountList(q, c)
            await settle()
            const h = wildflower.getQuery(q)
            const before = fetchCount

            await h.write({ id: 1, name: 'v1' })
            await settle()

            expect(fetchCount, 'falls back to the refetch arm').toBe(before + 1)
            expect(h.rows.length, 'rows are not wholesale-replaced by the envelope').toBe(2)
            expect(h.rows.find(r => r.success), 'the envelope never enters the rows').toBeUndefined()
            expect(h.rows[0].name, 'refetch restored server truth').toBe('v0')
            if (!isMinifiedBuild()) {
                expect(warnings.some(w => w.includes('WF-965')), 'dev warn names the footgun').toBe(true)
            }
        } finally {
            console.warn = realWarn
        }
    })

    // 22 — an aborted write is a FAILURE, unlike the read path where
    // AbortError means supersession and is silently ignored. A transport
    // timeout (AbortController) must roll back and report; a future
    // error-handling unification must not make write-aborts vanish.
    it('an AbortError rejection from to() rolls back like any failure', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'v0' }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        await expect(h.write({ id: 1, name: 'v1' })).rejects.toThrow('aborted')
        await settle(40)
        expect(h.rows[0].name, 'rolled back').toBe('v0')
        expect(h.syncError, 'reported as a sync failure').toBeTruthy()
        expect(h.error).toBe(null)
    })

    // 18 — teardown is a lifecycle PAUSE, not destruction: data and write
    // bookkeeping persist so re-observation shows last-good instantly. A
    // write in flight across teardown settles cleanly — the confirmed
    // record lands in the persisted rows and the bookkeeping drains.
    it('a write in flight across query teardown settles cleanly and persists', async () => {
        const q = uname('q'); const c = uname('c')
        // Server-side record, mutated in lockstep with the write's own
        // resolve below — a realistic backend's GET reflects the PUT it
        // already accepted. A stub frozen at 'v0' regardless of the write
        // is unrealistic: still-mounted $q.* markup re-touches the query on
        // every render (including the ones the write itself causes), which
        // can legitimately reactivate it mid-settle — see the shorthand
        // activation fix — and a frozen stub would make that timing-honest
        // refetch look like data corruption when it is really just a
        // GET landing with the SAME confirmed value a real server would
        // already be serving.
        let serverRecord = { id: 1, name: 'v0' }
        window.fetch = async () => jsonResponse([serverRecord])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)
        const controller = wildflower._queryControllers.get(q)

        const p = h.write({ id: 1, name: 'v1' })
        await settle(20)
        wildflower._queryTeardown(controller)

        // The confirmed value becomes the server's own truth in the same
        // tick it confirms, exactly like a real backend: the response to an
        // accepted write already IS the entity's new state.
        serverRecord = { id: 1, name: 'v1-confirmed' }
        pending[0].resolve({ id: 1, name: 'v1-confirmed' })
        await p
        await settle(40)

        expect(h.rows[0].name, 'the confirmed record persists for re-observation').toBe('v1-confirmed')
        expect(h.isStale).toBe(false)
        expect(controller.fieldClaims.size).toBe(0)
        expect(controller.pendingWrites).toBe(0)
        expect(controller.inflightWrites.size).toBe(0)
    })

    // 12 — beyond the matrix: the design doc's motivating failure path for
    // creates. A rejected optimistic create must remove the row, not leave
    // "data the server never accepted" on screen (nor a ghost of undefineds).
    it('reject of an optimistic create removes the row', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a', done: false }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const p = h.write({ id: 'tmp-1', title: 'New item' })
        await settle(20)
        expect(h.rows.length).toBe(2)

        pending[0].reject(new Error('422 invalid'))
        await expect(p).rejects.toThrow('422 invalid')
        await settle(40)
        expect(h.rows.length, 'a rejected create rolls the row back out').toBe(1)
        expect(h.rows.some(r => r.id === 'tmp-1')).toBe(false)
        expect(h.syncError).toBeTruthy()
        expect(container.querySelectorAll('.row').length).toBe(1)
    })

    // 31 — a full sync that arrives while a write pends cannot report
    // fresh: claim-honored fields still carry unconfirmed optimistic
    // values (test 15's rationale, applied to the arrival arm). The
    // confirm is DEFERRED — flags and the sync stamp land when the last
    // pending write settles, here by rejection. Found by the model
    // suite's flag oracle (hardening investigation B).
    it('a full sync while a write pends defers freshness; the rejection lands it', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, title: 'a', note: 'n0' }]
        window.fetch = async () => jsonResponse(payload)
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const p = h.write({ id: 1, title: 'optimistic' })
        await settle(20)
        expect(h.isStale, 'optimistic apply stales').toBe(true)
        const lastSyncBefore = h.lastSync

        // Out-of-band change arrives while the write is in flight.
        payload = [{ id: 1, title: 'server', note: 'n1' }]
        await h.invalidate()
        await settle(20)
        expect(h.rows[0].note, 'unclaimed field updates').toBe('n1')
        expect(h.rows[0].title, 'claimed field holds').toBe('optimistic')
        expect(h.isStale, 'the arrival cannot report fresh while the write pends').toBe(true)
        expect(h.lastSync, 'the sync stamp waits for the drain').toBe(lastSyncBefore)

        pending[0].reject(new Error('409'))
        await expect(p).rejects.toThrow('409')
        await settle(40)
        expect(h.rows[0].title, 'rollback lands on the arrival-refreshed value').toBe('server')
        expect(h.isStale, 'the deferred confirm lands once nothing is pending').toBe(false)
        expect(h.syncError, 'the rejection is still reported').toBeTruthy()
        expect(h.lastSync, 'the held sync is stamped at the drain').not.toBe(lastSyncBefore)
    })

    // 32 — the confirm arm of the same crossing: after a mid-pending
    // full sync, the write's own confirming resolve clears everything.
    it('a full sync while a write pends: the confirming resolve still clears flags', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, title: 'a', note: 'n0' }]
        window.fetch = async () => jsonResponse(payload)
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const p = h.write({ id: 1, title: 'optimistic' })
        await settle(20)
        payload = [{ id: 1, title: 'server', note: 'n1' }]
        await h.invalidate()
        await settle(20)
        expect(h.isStale, 'deferred while the write pends').toBe(true)

        pending[0].resolve({ id: 1, title: 'optimistic', note: 'n1' })
        await p
        await settle(40)
        expect(h.rows[0].title).toBe('optimistic')
        expect(h.isStale, 'the confirming reconcile clears staleness').toBe(false)
        expect(h.syncError).toBe(null)
    })

    // 33 — the 304 arm: "nothing changed on the server" is still a
    // confirming sync, so it defers the same way while a write pends.
    it('a 304 while a write pends defers freshness the same way', async () => {
        const q = uname('q'); const c = uname('c')
        let first = true
        window.fetch = async () => {
            if (first) {
                first = false
                return new Response(JSON.stringify([{ id: 1, title: 'a' }]),
                    { status: 200, headers: { ETag: '"v1"' } })
            }
            return new Response(null, { status: 304 })
        }
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const p = h.write({ id: 1, title: 'x' })
        await settle(20)
        const lastSyncBefore = h.lastSync

        await h.invalidate()
        await settle(20)
        expect(h.isStale, 'a 304 cannot report fresh while the write pends').toBe(true)
        expect(h.lastSync, 'the sync stamp waits for the drain').toBe(lastSyncBefore)

        pending[0].reject(new Error('409'))
        await expect(p).rejects.toThrow('409')
        await settle(40)
        expect(h.rows[0].title, 'rollback restores').toBe('a')
        expect(h.isStale, 'the deferred 304 confirm lands at the drain').toBe(false)
        expect(h.lastSync, 'stamped at the drain').not.toBe(lastSyncBefore)
    })

    // 34 — a lone rejected write must not strand the store stale. After
    // the rollback, the rows equal the last known server truth — nothing
    // optimistic remains — so staleness ends with the drain even though
    // no confirm was ever held. lastSync does NOT move (there was no
    // sync); syncError carries the news. Found by the optimistic-tasks
    // demo canary: an armed rejection left "syncing…" up forever.
    it('a lone rejected write clears staleness at the drain; lastSync does not move', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a', done: false }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)
        const lastSyncBefore = h.lastSync
        expect(h.isStale).toBe(false)

        const p = h.write({ id: 1, title: 'doomed' })
        await settle(20)
        expect(h.isStale, 'optimistic apply stales').toBe(true)

        pending[0].reject(new Error('409'))
        await expect(p).rejects.toThrow('409')
        await settle(40)
        expect(h.rows[0].title, 'rolled back').toBe('a')
        expect(h.isStale, 'nothing pending, nothing optimistic: not stale').toBe(false)
        expect(h.syncError, 'the rejection is the news').toBeTruthy()
        expect(h.lastSync, 'no sync happened; the stamp holds').toBe(lastSyncBefore)
    })

    // 35 — a write that supersedes an in-flight arrival must not lose it.
    // The runId guard discards the delivery (correct: it may predate the
    // optimistic state), but the invalidation signal that triggered the
    // fetch is already consumed — for notification-driven syncs (the SSE
    // pattern, the shared-favorites demo) nothing re-delivers it. The
    // drain must catch up. Found by the demo canary: a star failed to
    // propagate when the other panel wrote during its catch-up fetch.
    it('a write superseding an in-flight arrival re-fetches at the drain (confirm arm)', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle(20)
        releases[0]([{ id: 1, title: 'a' }, { id: 2, title: 'b' }])
        await settle(20)
        const h = wildflower.getQuery(q)
        expect(h.rows.length).toBe(2)

        // Out-of-band change: an invalidation signal fires a catch-up.
        const p1 = h.invalidate()
        await settle(20)
        expect(releases.length, 'catch-up in flight').toBe(2)

        // A write lands while the arrival is in flight and supersedes it.
        const p = h.write({ id: 1, title: 'mine' })
        await settle(20)
        releases[1]([{ id: 1, title: 'a' }, { id: 2, title: 'THEIRS' }])
        await p1.catch(() => {})
        await settle(20)
        expect(h.rows.find(r => r.id === 2).title, 'superseded arrival discarded').toBe('b')

        pending[0].resolve({ id: 1, title: 'mine' })
        await p
        await settle(20)
        expect(releases.length, 'the drain re-fetches the missed arrival').toBe(3)
        releases[2]([{ id: 1, title: 'mine' }, { id: 2, title: 'THEIRS' }])
        await settle(20)
        expect(h.rows.find(r => r.id === 2).title, 'the lost change lands').toBe('THEIRS')
        expect(h.rows.find(r => r.id === 1).title, 'the confirmed write stands').toBe('mine')
        expect(h.isStale).toBe(false)
    })

    // 36 — the reject arm of the same crossing shares the drain point.
    it('a write superseding an in-flight arrival re-fetches at the drain (reject arm)', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle(20)
        releases[0]([{ id: 1, title: 'a' }, { id: 2, title: 'b' }])
        await settle(20)
        const h = wildflower.getQuery(q)

        const p1 = h.invalidate()
        await settle(20)
        const p = h.write({ id: 1, title: 'doomed' })
        await settle(20)
        releases[1]([{ id: 1, title: 'a' }, { id: 2, title: 'THEIRS' }])
        await p1.catch(() => {})
        await settle(20)

        pending[0].reject(new Error('409'))
        await expect(p).rejects.toThrow('409')
        await settle(20)
        expect(h.rows.find(r => r.id === 1).title, 'rolled back').toBe('a')
        expect(releases.length, 'the drain re-fetches the missed arrival').toBe(3)
        releases[2]([{ id: 1, title: 'a' }, { id: 2, title: 'THEIRS' }])
        await settle(20)
        expect(h.rows.find(r => r.id === 2).title, 'the lost change lands').toBe('THEIRS')
        expect(h.syncError, 'the confirming catch-up clears the transient error').toBe(null)
    })

    // 37 — the miss survives intermediate settles: with two writes over
    // one dropped arrival, the catch-up fires at the LAST settle, once.
    it('a dropped arrival under overlapping writes catches up at the last settle only', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle(20)
        releases[0]([{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: false }])
        await settle(20)
        const h = wildflower.getQuery(q)

        const p1 = h.invalidate()
        await settle(20)
        const pa = h.write({ id: 1, title: 'mine' })
        await settle(20)
        releases[1]([{ id: 1, title: 'a', done: false }, { id: 2, title: 'THEIRS', done: false }])
        await p1.catch(() => {})
        const pb = h.write({ id: 1, done: true })
        await settle(20)

        pending[0].resolve({ id: 1, title: 'mine', done: false })
        await pa
        await settle(20)
        expect(releases.length, 'no catch-up while a write still pends').toBe(2)

        pending[1].resolve({ id: 1, title: 'mine', done: true })
        await pb
        await settle(20)
        expect(releases.length, 'the last settle spends the miss, once').toBe(3)
        releases[2]([{ id: 1, title: 'mine', done: true }, { id: 2, title: 'THEIRS', done: false }])
        await settle(20)
        expect(h.rows.find(r => r.id === 2).title, 'the lost change lands').toBe('THEIRS')
        const controller = wildflower._queryControllers.get(q)
        expect(controller.pendingWrites).toBe(0)
        expect(controller.fieldClaims.size).toBe(0)
    })

    // 38 — the crossing survives teardown: the write settles after the
    // query stood down; the catch-up still runs, and a remount paints
    // current truth instantly.
    it('a dropped arrival with the write settling after teardown still catches up', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle(20)
        releases[0]([{ id: 1, title: 'a' }, { id: 2, title: 'b' }])
        await settle(20)
        const h = wildflower.getQuery(q)

        const p1 = h.invalidate()
        await settle(20)
        const p = h.write({ id: 1, title: 'mine' })
        await settle(20)
        releases[1]([{ id: 1, title: 'a' }, { id: 2, title: 'THEIRS' }])
        await p1.catch(() => {})
        await settle(20)

        // Teardown: the panel leaves; the write is still in flight.
        container.innerHTML = ''
        await settle(20)

        pending[0].resolve({ id: 1, title: 'mine' })
        await p
        await settle(20)
        const fetchesAfterSettle = releases.length
        expect(fetchesAfterSettle, 'the drain catch-up still fires').toBe(3)
        releases[2]([{ id: 1, title: 'mine' }, { id: 2, title: 'THEIRS' }])
        await settle(20)
        expect(releases.length, 'one catch-up, no fetch storm').toBe(3)
        expect(h.rows.find(r => r.id === 2).title, 'truth lands in the store').toBe('THEIRS')

        // Remount paints from the current store.
        mountList(q, c)
        await settle(20)
        const rendered = [...container.querySelectorAll('.row')].map(e => e.textContent)
        expect(rendered).toContain('THEIRS')
        expect(rendered).toContain('mine')
    })

    // 39 — temp-id correction under a dropped arrival: the create's
    // rename machinery and the drain catch-up compose; no ghost, no
    // duplicate, the other client's change lands.
    it('a create confirming with a changed key under a dropped arrival converges', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle(20)
        releases[0]([{ id: 1, title: 'a' }])
        await settle(20)
        const h = wildflower.getQuery(q)

        const p1 = h.invalidate()
        await settle(20)
        const p = h.write({ id: 'tmp-7', title: 'New item' })
        await settle(20)
        releases[1]([{ id: 1, title: 'CHANGED' }])
        await p1.catch(() => {})
        await settle(20)

        pending[0].resolve({ id: 42, title: 'New item' })
        await p
        await settle(20)
        expect(h.rows.some(r => r.id === 'tmp-7'), 'tmp row corrected away').toBe(false)
        expect(h.rows.filter(r => r.title === 'New item').length, 'no duplicate').toBe(1)
        expect(releases.length, 'the drain catch-up fires').toBe(3)
        releases[2]([{ id: 1, title: 'CHANGED' }, { id: 42, title: 'New item' }])
        await settle(20)
        expect(h.rows.find(r => r.id === 1).title, 'the lost change lands').toBe('CHANGED')
        expect(h.rows.filter(r => r.title === 'New item').length, 'still no duplicate').toBe(1)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.keyAliases.size).toBe(0)
        expect(controller.rowClaims.size).toBe(0)
    })

    // 40 — rejected delete under a dropped arrival: the restore uses
    // pre-arrival pre-images (the arrival never landed to refresh them),
    // and the drain catch-up then delivers truth.
    it('a rejected delete under a dropped arrival restores, then the catch-up delivers truth', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle(20)
        releases[0]([{ id: 1, title: 'a' }, { id: 2, title: 'b' }])
        await settle(20)
        const h = wildflower.getQuery(q)

        const p1 = h.invalidate()
        await settle(20)
        const p = h.write({ id: 1, gone: true })
        await settle(20)
        expect(h.rows.length, 'optimistic delete removes').toBe(1)
        releases[1]([{ id: 1, title: 'FRESH' }, { id: 2, title: 'b' }])
        await p1.catch(() => {})
        await settle(20)

        pending[0].reject(new Error('403'))
        await expect(p).rejects.toThrow('403')
        await settle(20)
        expect(h.rows.find(r => r.id === 1), 'the row restores').toBeTruthy()
        expect(releases.length, 'the drain catch-up fires').toBe(3)
        releases[2]([{ id: 1, title: 'FRESH' }, { id: 2, title: 'b' }])
        await settle(20)
        expect(h.rows.find(r => r.id === 1).title, 'truth lands after the restore').toBe('FRESH')
        const controller = wildflower._queryControllers.get(q)
        expect(controller.rowClaims.size).toBe(0)
        expect(controller.fieldClaims.size).toBe(0)
    })

    function mountStatus(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <ul data-query="${qname}"><template><li class="row">
                    <span class="ti" data-bind="title"></span>
                    <span class="st" data-bind="status"></span>
                </li></template></ul>
            </div>
        `
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    // 41 — a delete racing a claim ISSUED BEFORE it: the delete's own
    // full-row snapshot is taken after that claim's optimistic apply
    // (never stale relative to it), so a rejected delete restores the
    // field to that write's own value rather than leaving it absent.
    it('a delete-reject restores a field an EARLIER-issued pending write still claims', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a', status: 'open' }, { id: 2, title: 'b', status: 'open' }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountStatus(q, c)
        await settle(20)
        const h = wildflower.getQuery(q)

        const pA = h.write({ id: 1, status: 'closed' })   // edit, still pending
        await settle(20)
        expect(h.rows.find(r => r.id === 1).status, 'optimistic edit visible').toBe('closed')

        const pD = h.write({ id: 1, gone: true })   // delete, captures the CURRENT (edited) row
        await settle(20)
        expect(h.rows.some(r => r.id === 1), 'optimistic delete removes the row').toBe(false)

        pending[1].reject(new Error('403'))   // the delete rejects
        await expect(pD).rejects.toThrow('403')
        await settle(20)
        const row = h.rows.find(r => r.id === 1)
        expect(row, 'the row restores').toBeTruthy()
        expect(row.title, 'unclaimed field restores fine').toBe('a')
        expect(row.status, "the earlier claim's own current value stands, not undefined").toBe('closed')

        pending[0].resolve({ id: 1, title: 'a', status: 'closed' })
        await pA
        await settle(20)
        expect(h.rows.find(r => r.id === 1)).toEqual({ id: 1, title: 'a', status: 'closed' })
    })

    // 42 — the mirror case: a claim issued AFTER the delete (recreating
    // the row the delete's own snapshot never saw) must NOT be clobbered
    // by the delete's stale pre-image when it rejects. Same mechanism as
    // the existing "claim is honored" pin above, from the delete's own
    // reject side.
    it('a delete-reject leaves a field a LATER-issued write claims for that write to decide', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a', status: 'open' }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountStatus(q, c)
        await settle(20)
        const h = wildflower.getQuery(q)

        const pD = h.write({ id: 1, gone: true })   // delete first
        await settle(20)
        const pB = h.write({ id: 1, status: 'reopened' })   // recreates the row, after the delete's snapshot
        await settle(20)
        expect(h.rows.find(r => r.id === 1).status, "B's recreate is visible").toBe('reopened')

        pending[0].reject(new Error('delete failed'))
        await expect(pD).rejects.toThrow('delete failed')
        await settle(20)
        expect(h.rows.find(r => r.id === 1).status, "B's later claim survives the delete's stale restore").toBe('reopened')

        pending[1].resolve({ id: 1, title: 'a', status: 'reopened' })
        await pB
        await settle(20)
        expect(h.rows.find(r => r.id === 1)).toEqual({ id: 1, title: 'a', status: 'reopened' })
    })

    // 43 — a claiming write's OWN reject must not resurrect a row an
    // UNRELATED delete on that same row still claims as absent. Before
    // the fix, a plain client-patch rollback (no reconcile flag) was
    // not subject to the deleteClaimed exclusion, so it could bypass a
    // still-pending delete entirely.
    it("a claiming write's own reject does not resurrect a row its pending delete still claims", async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a', status: 'open' }, { id: 2, title: 'b', status: 'open' }])
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountStatus(q, c)
        await settle(20)
        const h = wildflower.getQuery(q)

        const pA = h.write({ id: 1, status: 'closed' })
        await settle(20)
        const pD = h.write({ id: 1, gone: true })
        await settle(20)
        expect(h.rows.some(r => r.id === 1), 'row absent: delete is pending').toBe(false)

        pending[0].reject(new Error('409'))   // the EDIT rejects; the DELETE is still pending
        await expect(pA).rejects.toThrow('409')
        await settle(20)
        expect(h.rows.some(r => r.id === 1), "the pending delete's claim still holds").toBe(false)

        pending[1].reject(new Error('403'))
        await expect(pD).rejects.toThrow('403')
        await settle(20)
        expect(h.rows.find(r => r.id === 1), 'the delete rejects too: the row restores').toBeTruthy()
        const controller = wildflower._queryControllers.get(q)
        expect(controller.rowClaims.size).toBe(0)
        expect(controller.fieldClaims.size).toBe(0)
    })

    // 44 — review finding C, which testing
    // WITHDREW. Kept as a characterization: the mechanism below is real, the
    // defect it was reported as is not, and this pins the difference so the
    // same conclusion is not re-derived from reading the code again.
    //
    // Test 43 covers both writes REJECTING. This covers the delete SUCCEEDING
    // while the later write is still in flight, which is the case the root
    // cause was deferred on.
    //
    // Issuing a write on a row a pending delete already owns reclassifies it as
    // a CREATE, because the delete's optimistic apply already removed the row so
    // rowExisted reads false. That silently overwrites the delete's rowClaims
    // entry with a 'create' claim. When the delete then CONFIRMS, its own
    // release is a no-op (the claim belongs to the other write now), so the
    // create claim outlives it — and the replace branch keeps a row a pending
    // create owns even when the arrival correctly omits it.
    //
    // Documented as STILL OPEN (2026-08-16); the model fuzzer excludes it by restricting deletes to unclaimed rows.
    it('a confirmed delete is not undone by a later write on the same row', async () => {
        const q = uname('q'); const c = uname('c')
        let serverHasRow1 = true
        window.fetch = async () => jsonResponse(
            serverHasRow1
                ? [{ id: 1, title: 'a', status: 'open' }, { id: 2, title: 'b', status: 'open' }]
                : [{ id: 2, title: 'b', status: 'open' }]
        )
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountStatus(q, c)
        await settle(20)
        const h = wildflower.getQuery(q)
        expect(h.rows.length, 'two rows loaded').toBe(2)

        const pD = h.write({ id: 1, gone: true })
        await settle(20)
        expect(h.rows.some((r) => r.id === 1), 'the optimistic delete hid the row').toBe(false)

        // A write lands on the row while the delete is unsettled. The row is
        // hidden, so this is reclassified as a create and resurrects it.
        const pE = h.write({ id: 1, status: 'reopened' })
        await settle(20)

        // COVERAGE: prove the reclassification actually happened before
        // asserting anything about its consequences. Without these the test
        // could pass by never reaching the branch under test.
        const ctl = wildflower._queryControllers.get(q)
        expect(h.rows.some((r) => r.id === 1),
            'the later write resurrected the hidden row').toBe(true)
        expect(ctl.rowClaims.get('1') && ctl.rowClaims.get('1').kind,
            "and took the delete's claim, reclassified as a create").toBe('create')

        // The server accepts the delete. From here the row genuinely does not
        // exist, and every later arrival will correctly omit it.
        serverHasRow1 = false
        pending[0].resolve(undefined)          // delete confirmed, resolve-with-nothing
        await pD
        await settle(30)

        // THE WINDOW. The delete is confirmed and its catch-up fetch has landed
        // omitting the row, but the later write is still unsettled and its
        // create claim holds the row on screen. This is the state the review
        // called a permanent ghost; recorded here as what it actually is, a
        // window bounded by the second write settling.
        const ghostWhilePending = h.rows.some((r) => r.id === 1)
        expect(ghostWhilePending,
            'an unsettled write still claims the row, so it stays visible').toBe(true)

        // The later write then fails, because its row is gone server-side.
        pending[1].reject(new Error('404'))
        await expect(pE).rejects.toThrow('404')
        await settle(30)

        expect(h.rows.some((r) => r.id === 1),
            'a server-confirmed delete must stay deleted').toBe(false)
        expect(h.rows.length, 'only the surviving row remains').toBe(1)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.rowClaims.size, 'no claim outlives both writes').toBe(0)
    })

    // 45 — write()'s confirming resolve follows JSON Merge Patch (RFC 7396): a
    // field ABSENT from the resolved record is left untouched, not dropped.
    // Found via the data-query tutorial's mock server, which only echoed
    // back the fields it received — exactly this shape.
    it('resolve with a PARTIAL record (keyed list row): fields absent from the response survive', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'Buy milk', done: false, aisle: 'dairy' }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.resolve({ id: 1, done: true })   // aisle, title NOT echoed back
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, done: true })
        await settle(40)

        expect(h.rows[0], 'fields the response omitted must survive, not vanish')
            .toEqual({ id: 1, title: 'Buy milk', done: true, aisle: 'dairy' })
        expect(container.querySelector('.row').textContent).toBe('Buy milk')
    })

    // 46 — the other half of RFC 7396: an explicit `null` is the deletion
    // signal, distinct from mere absence.
    it('resolve with a field explicitly null (keyed list row): that field is removed', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'Buy milk', done: false, aisle: 'dairy' }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.resolve({ id: 1, done: true, aisle: null })   // aisle explicitly cleared
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, done: true })
        await settle(40)

        expect(h.rows[0], 'a field resolved as null must be removed, not kept')
            .toEqual({ id: 1, title: 'Buy milk', done: true })
        expect('aisle' in h.rows[0]).toBe(false)
    })

    // 47 — same rule, the record-shaped (unkeyed) branch: patch({field})
    // reconciling a record query must also preserve fields the response omits.
    it('resolve with a PARTIAL record (record query): fields absent from the response survive', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ name: 'Ada', role: 'eng', team: 'core' })
        wildflower.query(q, {
            from: '/api/me',
            to: () => Promise.resolve({ role: 'staff eng' })   // name, team NOT echoed back
        })
        container.innerHTML = `
            <div data-component="${c}">
                <div data-query="${q}">
                    <span class="who" data-bind="name"></span>
                    <span class="role" data-bind="role"></span>
                    <span class="team" data-bind="team"></span>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ role: 'staff eng' })
        await settle(40)

        expect(h.rows[0], 'record fields the response omitted must survive')
            .toEqual({ name: 'Ada', role: 'staff eng', team: 'core' })
        expect(container.querySelector('.who').textContent).toBe('Ada')
        expect(container.querySelector('.team').textContent).toBe('core')
    })

    // 48 — calibration: a GENUINE server arrival (a plain fetch, not a
    // write confirmation) still replaces verbatim and drops fields the
    // response omits. Merge-patch semantics are scoped to write()'s
    // reconcile only; this proves that scoping held and the channel that
    // depends on "server truth replaces" (test 0d, gentle-merge) isn't
    // silently disabled by the fix above.
    it('calibration: a plain fetch (not a write) still replaces a row verbatim', async () => {
        const q = uname('q'); const c = uname('c')
        let payload = [{ id: 1, title: 'Buy milk', done: false, aisle: 'dairy' }]
        window.fetch = async () => jsonResponse(payload)
        wildflower.query(q, { from: '/api/todos', key: 'id' })
        mountList(q, c)
        await settle()
        expect(wildflower.getQuery(q).rows[0].aisle).toBe('dairy')

        payload = [{ id: 1, title: 'Buy milk', done: true }]   // server now omits aisle
        wildflower.getQuery(q).refresh()
        await settle(40)

        expect(wildflower.getQuery(q).rows[0],
            'a genuine fetch arrival is exhaustive: an omitted field is really gone')
            .toEqual({ id: 1, title: 'Buy milk', done: true })
    })

    // 49 — review finding. A
    // confirmation carrying the key as an explicit null slipped the
    // keyless guard (which tested `=== undefined` only), rode the
    // tmp-id rename machinery with null as the "corrected" key, and the
    // merge-patch null-delete then stripped the key field so the dedup
    // set missed and the payload appended as a DUPLICATE row. A null
    // key is "without the key" for every practical purpose, so it takes
    // the same arm as a missing one: warn, invalidate, let the next
    // fetch carry the truth.
    it('resolve with the key explicitly null: keyless arm, no duplicate row, no key rename', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'Buy milk', done: false }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.resolve({ id: null, title: 'oat' })
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, title: 'oat' })
        await settle(60)

        expect(h.rows.length, 'no duplicate row appears').toBe(1)
        expect(h.rows[0], 'the invalidate refetch restored server truth, key intact')
            .toEqual({ id: 1, title: 'Buy milk', done: false })
        const controller = wildflower._queryControllers.get(q)
        expect(controller.keyAliases.size, 'no alias registered for a null "rename"').toBe(0)
    })

    // 50 — review finding. RFC 7396's MergePatch is RECURSIVE: when both the
    // row's field and the resolved field are plain objects, absent nested
    // members survive too. A shallow merge would reintroduce the exact
    // absence-drops-fields bug one level down. The nested partial comes
    // from the SERVER for a field the client payload never touched — a
    // nested object IN the client payload is a top-level field VALUE and
    // replaces optimistically by design, which is a different rule.
    it('resolve with a partial NESTED object: nested fields absent from the response survive', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([
            { id: 1, title: 'Buy milk', author: { name: 'ada', bio: 'wrote this' } }
        ])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            // The server decorates its confirmation with a partial author.
            to: () => Promise.resolve({ id: 1, title: 'oat', author: { name: 'grace' } })
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, title: 'oat' })   // client never touches author
        await settle(40)

        expect(h.rows[0].author, 'nested absent field must survive; nested present applies')
            .toEqual({ name: 'grace', bio: 'wrote this' })
        expect(h.rows[0].title).toBe('oat')
    })

    // 51 — nested null is the nested deletion signal, same rule as the top
    // level; nested absent members beside it survive.
    it('resolve with a nested field explicitly null: that nested field is removed', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([
            { id: 1, title: 'Buy milk', author: { name: 'ada', bio: 'wrote this' } }
        ])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.resolve({ id: 1, author: { bio: null } })
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, title: 'oat' })   // client never touches author
        await settle(40)

        expect(h.rows[0].author, 'nested null deletes; nested absent (name) survives')
            .toEqual({ name: 'ada' })
        expect('bio' in h.rows[0].author).toBe(false)
        expect(h.rows[0].title, 'absent top-level field keeps the optimistic value').toBe('oat')
    })

    // 52 — calibration: arrays are values under RFC 7396, never merged.
    it('calibration: an array field in the resolution replaces wholesale, never merges', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([
            { id: 1, title: 'Buy milk', tags: ['urgent', 'dairy'] }
        ])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.resolve({ id: 1, tags: ['done'] })
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, tags: ['done'] })
        await settle(40)

        expect(h.rows[0].tags, 'array replaced, not element-merged').toEqual(['done'])
        expect(h.rows[0].title).toBe('Buy milk')
    })

    // 53 — review finding. Naming an operation on a function `to` REJECTS
    // (it used to throw a bare Error with no WF code, before any promise
    // existed, so the .catch an author attached never ran). The docs have
    // always attributed this case to WF-974; now the code agrees.
    it('naming an operation on a function `to` rejects, catchably', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, title: 'a', done: false }])
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => Promise.resolve()
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        let caught = null
        await h.write('publish', { id: 1 }).catch((e) => { caught = e })
        expect(caught, 'the failure reaches the .catch the author wrote').not.toBe(null)
        expect(String(caught)).toMatch(/operation hint/)
    })

    // 54 — review finding. the refactor-typo shape: an undeclared operation
    // name rejects with the declared list in the message, applies nothing
    // optimistically, and sends nothing.
    it('an undeclared operation name rejects, catchably, touching nothing', async () => {
        const q = uname('q'); const c = uname('c')
        let nonGet = 0
        window.fetch = async (url, init) => {
            if (init && init.method && init.method !== 'GET') nonGet++
            return jsonResponse([{ id: 1, title: 'a', done: false }])
        }
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: { update: '/api/todos/:id' }
        })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        let caught = null
        await h.write('updte', { id: 1, done: true }).catch((e) => { caught = e })
        expect(caught).not.toBe(null)
        expect(String(caught), 'the declared operations are named').toMatch(/update/)
        expect(h.rows[0].done, 'nothing applied optimistically').toBe(false)
        expect(nonGet, 'no request departed').toBe(0)
        expect(h.pendingWrites, 'no pending write registered').toBe(0)
    })

    // 55 — survey ruling #3 (RTK Query #4271's class): a read STARTED during
    // the write window carries pre-write server state. While the write
    // pends, claim-honor protects its arrival; if it lands AFTER the settle
    // released the claims, nothing did — the stale answer replaced the
    // confirmed record. A confirmed settle now supersedes in-flight reads
    // exactly as write ISSUE does (the settle is a call; any read in flight
    // at that moment predates the server-state change by construction).
    it('a confirmed settle supersedes a read started during the write window', async () => {
        const q = uname('q'); const c = uname('c')
        let resolveWrite, resolveRead
        let gets = 0
        window.fetch = async () => {
            gets++
            if (gets === 1) return jsonResponse([{ id: 1, v: 'server-v1' }])
            // The mid-window refresh: held until after the settle.
            return new Promise((res) => { resolveRead = res })
        }
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            to: () => new Promise((res) => { resolveWrite = res })
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)
        expect(h.rows[0].v).toBe('server-v1')

        const p = h.write({ id: 1, v: 'mine' })
        await settle(20)
        h.refresh()               // app-called refresh during the window
        await settle(20)

        resolveWrite({ id: 1, v: 'mine-confirmed' })  // record: reconcile
        await p
        await settle(20)
        expect(h.rows[0].v, 'the confirmation applied').toBe('mine-confirmed')

        // The held read lands AFTER the settle, carrying pre-write rows.
        resolveRead(jsonResponse([{ id: 1, v: 'server-v1' }]))
        await settle(20)
        expect(h.rows[0].v,
            'a read from before the settle cannot overwrite the confirmed record').toBe('mine-confirmed')
    })

    // 56 — calibration for 55: a REJECTED settle changed nothing on the
    // server, so a read in flight when it rejects is still valid truth and
    // must apply normally. Only confirmed settles supersede.
    it('calibration: a rejected settle does not discard an in-flight read', async () => {
        const q = uname('q'); const c = uname('c')
        let rejectWrite, resolveRead
        let gets = 0
        window.fetch = async () => {
            gets++
            if (gets === 1) return jsonResponse([{ id: 1, v: 'server-v1' }])
            return new Promise((res) => { resolveRead = res })
        }
        wildflower.query(q, {
            from: '/api/items', key: 'id',
            to: () => new Promise((_, rej) => { rejectWrite = rej })
        })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)

        const p = h.write({ id: 1, v: 'mine' }).catch(() => {})
        await settle(20)
        h.refresh()
        await settle(20)

        rejectWrite(new Error('nope'))
        await p
        await settle(20)
        expect(h.rows[0].v, 'the rollback restored the pre-image').toBe('server-v1')

        // The in-flight read is real server truth (the server may even have
        // moved for another reason); it applies.
        resolveRead(jsonResponse([{ id: 1, v: 'server-v2-from-elsewhere' }]))
        await settle(20)
        expect(h.rows[0].v, 'valid truth from the read applies').toBe('server-v2-from-elsewhere')
    })
})
