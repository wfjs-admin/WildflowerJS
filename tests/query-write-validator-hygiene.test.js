/**
 * @vitest-environment browser
 *
 * Write-settle validator hygiene (bug-history survey pass 1, 2026-08-28 —
 * the "scope drifting away from the decision point" family).
 *
 * A settled write changes server state, so every validator and cached row
 * set the query holds describes PRE-write content. Before this fix:
 *  - a transport-only write's follow-up revalidation carried the pre-write
 *    ETag, and a lagging origin's 304 stamped the OPTIMISTIC rows as
 *    confirmed truth (the d6bd925e bug class by a new route — mapped from
 *    apollo-client #9901 + urql #3618);
 *  - the per-URL result cache kept pre-write rows, repainting them on a
 *    params round-trip (redux-toolkit #3251 class);
 *  - an SSE push's persist save paired stream-modified rows with the last
 *    FETCH's validator on disk — the exact pairing the reconcile path's
 *    own comment forbids (found reading the source; sibling of d6bd925e).
 *
 * The rule now: write settles drop the held validators and the snapshot
 *
 * cache; persist saves carry a validator only when the FETCH produced the
 * rows being saved.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-qwvh-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query write-settle validator hygiene', () => {
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

    function mountList(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row" data-bind="title"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    it('a stream-modified persist save carries NO validator', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => {
            const headers = new Headers()
            headers.set('ETag', 'W/"fetch-1"')
            return new Response(JSON.stringify([{ id: 1, title: 'from-fetch' }]), { status: 200, headers })
        }
        wildflower.query(q, {
            from: '/api/items', key: 'id', persist: true,
            refresh: 'sse', stream: '/api/stream'
        })
        mountList(q, c)
        await settle()

        const before = JSON.parse(localStorage.getItem('wf:query:' + q))
        expect(before.etag, 'the fetch save carries its validator').toBe('W/"fetch-1"')

        FakeEventSource.instances[0].onmessage({
            data: JSON.stringify([{ id: 1, title: 'from-stream' }])
        })
        await settle()

        const after = JSON.parse(localStorage.getItem('wf:query:' + q))
        expect(after.rows[0].title, 'the push is persisted').toBe('from-stream')
        expect(after.etag, 'the last FETCH\'s validator must not vouch for stream-modified rows').toBe(null)

        localStorage.removeItem('wf:query:' + q)
    })

    it('a transport-only write\'s follow-up revalidation is unconditional — a lagging 304 cannot confirm optimistic rows', async () => {
        const q = uname('q'); const c = uname('c')
        let sawIfNoneMatch = false
        let gets = 0
        window.fetch = async (url, init) => {
            const method = (init && init.method) || 'GET'
            if (method !== 'GET') return new Response(null, { status: 204 })
            gets++
            const inm = init && init.headers && new Headers(init.headers).get('If-None-Match')
            if (inm) {
                // The lagging origin: still serving the pre-write content,
                // so it happily confirms the old validator.
                sawIfNoneMatch = true
                return new Response(null, { status: 304 })
            }
            const headers = new Headers()
            headers.set('ETag', 'W/"' + gets + '"')
            const body = gets === 1
                ? [{ id: 1, title: 'server-v1' }]
                : [{ id: 1, title: 'server-v2' }]
            return new Response(JSON.stringify(body), { status: 200, headers })
        }
        wildflower.query(q, { from: '/api/items', key: 'id', to: '/api/items/:id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        await h.write({ id: 1, title: 'mine-optimistic' })
        await settle(80)

        expect(sawIfNoneMatch, 'the post-write refetch must not carry the pre-write validator').toBe(false)
        expect(h.rows[0].title, 'the refetch brought real server truth, not a confirmed guess').toBe('server-v2')
        expect(wildflower.getStore(q).isStale).toBe(false)
    })

    // The drain-by-rejection landing saves a HELD confirm's rows (a server
    // arrival landed mid-writes; no reconcile will ever save it), and that
    // save carries controller.etag on the stated premise that "the
    // arrival's response already updated it". True for a fetch arrival —
    // false for a STREAM push, which never touches controller.etag: the
    // push moved the rows past the held validator, and the drain then
    // persisted the pair. A later restore + lagging 304 against that
    // validator would confirm rows the validator never vouched for — the
    // d6bd925e class by a third route (fetch-after-write and push-save
    // were the first two). Found building the combo tier's oracle
    // (freshness × writes model, 2026-08-29).
    it('a drain-by-rejection landing a STREAM-deferred confirm persists NO validator', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => {
            const headers = new Headers()
            headers.set('ETag', 'W/"fetch-1"')
            return new Response(JSON.stringify([{ id: 1, title: 'from-fetch' }]), { status: 200, headers })
        }
        const pending = []
        wildflower.query(q, {
            from: '/api/items', key: 'id', persist: true,
            refresh: 'sse', stream: '/api/stream',
            to: () => new Promise((resolve, reject) => { pending.push({ resolve, reject }) })
        })
        mountList(q, c)
        await settle()
        expect(JSON.parse(localStorage.getItem('wf:query:' + q)).etag,
            'the fetch save carries its validator').toBe('W/"fetch-1"')

        const h = wildflower.getQuery(q)
        const p = h.write({ id: 1, title: 'mine' })
        await settle(20)
        // The push lands mid-write: applied claim-honored, its confirm and
        // its save DEFER (pendingWrites > 0).
        FakeEventSource.instances[0].onmessage({
            data: JSON.stringify([{ id: 1, title: 'from-stream' }])
        })
        await settle(20)
        expect(JSON.parse(localStorage.getItem('wf:query:' + q)).rows[0].title,
            'the deferred push has not saved yet').toBe('from-fetch')

        // The write rejects: the drain lands the held confirm and saves
        // the converged rows (correct), pairing them with the last FETCH's
        // validator (the defect under test).
        pending[0].reject(new Error('409'))
        await p.catch(() => {})
        await settle(20)

        const env = JSON.parse(localStorage.getItem('wf:query:' + q))
        expect(env.rows[0].title, 'the held arrival is persisted at the drain').toBe('from-stream')
        expect(env.etag,
            'stream-moved rows must not pair with the last fetch\'s validator').toBe(null)

        localStorage.removeItem('wf:query:' + q)
    })

    it('a settled write drops pre-write result-cache entries (the refetch re-caches fresh ones)', async () => {
        const q = uname('q'); const c = uname('c')
        let gets = 0
        window.fetch = async (url, init) => {
            const method = (init && init.method) || 'GET'
            if (method !== 'GET') return new Response(null, { status: 204 })
            gets++
            return new Response(JSON.stringify([{ id: 1, title: 'server-v' + gets }]), { status: 200 })
        }
        wildflower.query(q, { from: '/api/items', key: 'id', to: '/api/items/:id' })
        mountList(q, c)
        await settle()

        const controller = wildflower._queryControllers.get(q)
        expect(controller.snapshots && controller.snapshots.size, 'the fetch cached its URL').toBeTruthy()

        await wildflower.getQuery(q).write({ id: 1, title: 'mine' })
        await settle(80)

        // The settle cleared the cache; the follow-up refetch legitimately
        // re-cached its own FRESH result. What must be gone is the
        // pre-write row set.
        const snaps = controller.snapshots ? [...controller.snapshots.values()] : []
        const holdsPreWrite = snaps.some(s =>
            JSON.stringify(s).includes('server-v1'))
        expect(holdsPreWrite, 'no cached entry still holds pre-write rows').toBe(false)
        expect(wildflower.getQuery(q).rows[0].title, 'the refetch brought fresh truth').toBe('server-v2')
    })
})
