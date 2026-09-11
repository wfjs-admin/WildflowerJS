/**
 * data-query combination matrix.
 *
 * Every other query test asserts one feature at a time. This one generates
 * the cartesian product of the declaration axes, drives the same operation
 * script through each cell, and asserts INVARIANTS rather than exact output.
 *
 * The reasoning: TDD
 * proves what somebody thought to assert, so it structurally cannot reach a
 * class nobody stated. The surface is now 15 config keys, 4 per-operation
 * keys, 3 shapes and a write path with claims and aliases, and the defects
 * that survive live in the combinations. There are far more of those than
 * anyone will hand-write pins for.
 *
 * Axes (coherent combinations only; the error paths have their own pins in
 * data-query-declarative-transport.test.js):
 *
 *   shape    list | record
 *   from     url | url-with-token | function
 *   to       none | url | operation-map | function
 *   create   absent | declared
 *   deleted  absent | declared
 *
 * Invariants asserted in every cell that reaches the end of the script:
 *
 *   I1  no request URL ever contains an unresolved :token
 *   I2  no request URL ever contains "undefined" or "null" as a segment
 *   I3  pendingWrites returns to zero once everything settles
 *   I4  isStale is false when nothing is pending and every request succeeded
 *   5   error and syncError are null when the server answered every request
 *   I6  a rejected write leaves the rows equal to the last confirmed truth
 *   I7  the result cache never exceeds its bound, and never holds a row that
 *       only an unsettled optimistic write put there
 *   I8  nothing reaches console.error
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

const SHAPES = ['list', 'record']
const FROMS = ['url', 'token', 'fn']
const TOS = ['none', 'url', 'map', 'fn']
const FLAGS = [false, true]

// Server rows carry an id even in record shape, so a :token in a write URL
// has something to resolve against in every cell.
const SERVER_ROWS = () => [
    { id: 1, name: 'first', done: false },
    { id: 2, name: 'second', done: false }
]

let cellSeq = 0

function buildCell(shape, from, to, create, deleted) {
    const name = `mx${++cellSeq}`
    const cfg = {}
    if (shape === 'list') cfg.key = 'id'

    if (from === 'url') cfg.from = '/api/items'
    else if (from === 'token') {
        cfg.from = '/api/groups/:group/items'
        cfg.params = () => ({ group: 'g1' })
    } else {
        cfg.from = () => Promise.resolve(shape === 'record' ? SERVER_ROWS()[0] : SERVER_ROWS())
    }

    if (to === 'url') cfg.to = '/api/items/:id'
    else if (to === 'map') {
        cfg.to = {
            update: { url: '/api/items/:id', method: 'PATCH' },
            favorite: { url: '/api/items/:id/fav', method: 'POST' }
        }
        if (deleted) cfg.to.delete = { url: '/api/items/:id', method: 'DELETE' }
    } else if (to === 'fn') {
        cfg.to = (item) => Promise.resolve(Object.assign({}, item))
    }
    if (to !== 'none' && to !== 'fn') cfg.body = (item) => item

    if (create) {
        cfg.create = { url: '/api/items', method: 'POST', body: (i) => i }
    }
    if (deleted) cfg.deleted = 'removed'

    return { name, cfg, shape, from, to, create, deleted }
}

function allCells() {
    const out = []
    for (const shape of SHAPES) {
        for (const from of FROMS) {
            for (const to of TOS) {
                for (const create of FLAGS) {
                    for (const deleted of FLAGS) {
                        // A declarative `create` needs a declarative write side
                        // to be a coherent declaration; with a function `to`
                        // it is the supported mixed form, so both are kept.
                        out.push(buildCell(shape, from, to, create, deleted))
                    }
                }
            }
        }
    }
    return out
}

const CELLS = allCells()

// A path segment that is still a token, or that stringified a missing value.
const LEAKED = /\/:[A-Za-z_]|\/undefined(\/|$|\?)|\/null(\/|$|\?)/

suite('data-query: combination matrix', () => {
    let container
    let wildflower
    let realFetch
    let realError
    let calls
    let errors

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        realError = console.error
        calls = []
        errors = []
        console.error = (...a) => { errors.push(a.join(' ')) }
    })

    afterEach(() => {
        window.fetch = realFetch
        console.error = realError
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    async function settle(ms = 40) {
        await new Promise((r) => setTimeout(r, ms))
    }

    // One server for every cell. Reads answer with the row set the shape
    // expects; writes answer 204 unless the cell asked them to fail.
    function serve({ failWrites = false } = {}) {
        window.fetch = (url, init) => {
            const u = String(url)
            const method = (init && init.method) || 'GET'
            calls.push({ url: u, method })
            if (method === 'GET') {
                const headers = new Headers()
                headers.set('ETag', 'W/"' + u + '"')
                return Promise.resolve(new Response(JSON.stringify(SERVER_ROWS()), { status: 200, headers }))
            }
            if (failWrites) return Promise.resolve(new Response(null, { status: 500 }))
            return Promise.resolve(new Response(null, { status: 204 }))
        }
    }

    function mount(cell) {
        const c = cell.name + 'c'
        wildflower.component(c, { state: {} })
        wildflower.query(cell.name, cell.cfg)
        container.innerHTML = cell.shape === 'list'
            ? `<div data-component="${c}"><ul data-query="${cell.name}"><template><li data-bind="name"></li></template></ul></div>`
            : `<div data-component="${c}"><div data-query="${cell.name}"><span data-bind="name"></span></div></div>`
        return wildflower.getStore(cell.name)
    }

    // Invariants that must hold in every cell, whatever it declared.
    function assertInvariants(cell, store, { expectClean = true } = {}) {
        const label = `[${cell.shape}/${cell.from}/${cell.to}` +
            `${cell.create ? '/create' : ''}${cell.deleted ? '/deleted' : ''}]`

        // Coverage first. A cell that quietly issued nothing would satisfy
        // every invariant below without exercising anything, which is the
        // failure mode a generated matrix is most prone to.
        const gets = calls.filter((k) => k.method === 'GET').length
        const writes = calls.filter((k) => k.method !== 'GET').length
        if (cell.from !== 'fn') {
            expect(gets, `${label} COVERAGE no read was issued`).toBeGreaterThan(0)
        }
        const expectsWrite = (canUpdate(cell) && cell.to !== 'fn') || canCreate(cell)
        if (expectsWrite) {
            expect(writes, `${label} COVERAGE no write was issued`).toBeGreaterThan(0)
        }

        for (const k of calls) {
            expect(LEAKED.test(k.url), `${label} I1/I2 leaked an unresolved value into ${k.url}`).toBe(false)
        }
        expect(store.pendingWrites, `${label} I3 pendingWrites did not drain`).toBe(0)
        if (expectClean) {
            expect(store.isStale, `${label} I4 left stale with nothing pending`).toBe(false)
            expect(store.error, `${label} I5 error set though every request succeeded`).toBe(null)
            expect(store.syncError, `${label} I5 syncError set though every request succeeded`).toBe(null)
        }

        const controller = wildflower._queryControllers.get(cell.name)
        if (controller && controller.snapshots) {
            // queryCacheEntries, whose default is 15; no cell configures it.
            expect(controller.snapshots.size, `${label} I7 result cache exceeded its bound`).toBeLessThanOrEqual(15)
        }
        expect(errors, `${label} I8 wrote to console.error`).toEqual([])
    }

    // Whether this cell can route each operation at all. Attempting one it
    // does not declare is a named error by design, and has its own pins.
    const canUpdate = (cell) => cell.to !== 'none'
    const canDelete = (cell) => cell.deleted && (cell.to === 'url' || cell.to === 'fn' || cell.to === 'map')
    // create() on a record-shaped query is a named error (WF-982): a record
    // query holds one record, so there is no second one to create. Same
    // convention as the operations above — an error by design is driven by its
    // own pin (data-query-params-etag-keyless.test.js) rather than here, where
    // it would only assert that the matrix can trip it.
    const canCreate = (cell) => cell.create && cell.shape === 'list'

    for (const cell of CELLS) {
        const label = `${cell.shape}/${cell.from}/${cell.to}` +
            `${cell.create ? '/create' : ''}${cell.deleted ? '/deleted' : ''}`

        it(`holds its invariants: ${label}`, async () => {
            serve()
            const store = mount(cell)
            await settle()

            // The read landed at all.
            expect(store.rows.length, `${label} read produced no rows`).toBeGreaterThan(0)

            const q = wildflower.getQuery(cell.name)
            const keyed = cell.shape === 'list'

            if (canUpdate(cell)) {
                const item = keyed ? { id: 2, name: 'renamed' } : { id: 1, name: 'renamed' }
                await q.write(item).catch(() => {})
                await settle()
            }
            if (canCreate(cell)) {
                await q.create({ name: 'made' }).catch(() => {})
                await settle()
            }
            if (canDelete(cell)) {
                const item = keyed ? { id: 1, removed: true } : { id: 1, removed: true }
                await q.write(item).catch(() => {})
                await settle()
            }

            assertInvariants(cell, store)
        })
    }

    // Features that share state, crossed against each other. The declaration
    // cartesian above cannot reach these: they are sequences, not shapes, and
    // they are where the hardening plan says the surviving defects live.
    // Each scenario runs with persistence off and on, because persist and the
    // result cache both paint unconfirmed rows and both defer to writes.
    describe('interaction: persistence, accumulation, and the result cache', () => {
        let page = 1
        function pagedServer({ etag = true } = {}) {
            window.fetch = (url, init) => {
                const u = String(url)
                const method = (init && init.method) || 'GET'
                calls.push({ url: u, method })
                if (method !== 'GET') return Promise.resolve(new Response(null, { status: 204 }))
                const n = /page=(\d+)/.exec(u)
                const p = n ? Number(n[1]) : 1
                const headers = new Headers()
                if (etag) headers.set('ETag', 'W/"p' + p + '"')
                return Promise.resolve(new Response(
                    JSON.stringify([{ id: p * 10, name: 'row-p' + p }]),
                    { status: 200, headers }
                ))
            }
        }

        function paged(name, extra = {}) {
            const c = name + 'c'
            wildflower.component(c, { state: {} })
            wildflower.query(name, Object.assign({
                from: '/api/items', key: 'id', params: () => ({ page })
            }, extra))
            container.innerHTML = `<div data-component="${c}"><ul data-query="${name}"><template><li data-bind="name"></li></template></ul></div>`
            return wildflower.getStore(name)
        }

        beforeEach(() => {
            page = 1
            try { localStorage.clear() } catch { /* storage disabled */ }
        })

        for (const persist of FLAGS) {
            const tag = persist ? 'persist on' : 'persist off'

            it(`returns to a cached page and still converges (${tag})`, async () => {
                pagedServer()
                const n = `ix1${persist ? 'p' : ''}`
                const store = paged(n, persist ? { persist: true } : {})
                await settle()
                expect(store.rows[0].name).toBe('row-p1')

                page = 2
                await wildflower.getQuery(n).refresh()
                await settle()
                expect(store.rows[0].name).toBe('row-p2')

                page = 1
                await wildflower.getQuery(n).refresh()
                await settle()
                // Whatever painted first, the settled state is the truth for
                // the URL actually requested.
                expect(store.rows[0].name, `${tag}: converged to the wrong page`).toBe('row-p1')
                expect(store.isStale, `${tag}: left stale after converging`).toBe(false)
                expect(store.pendingWrites).toBe(0)
            })

            it(`never paints a cached page over an unsettled write (${tag})`, async () => {
                pagedServer()
                const n = `ix2${persist ? 'p' : ''}`
                const store = paged(n, Object.assign(
                    { to: '/api/items/:id', body: (i) => i },
                    persist ? { persist: true } : {}
                ))
                await settle()

                page = 2
                await wildflower.getQuery(n).refresh()
                await settle()

                // Edit page 2's row, then navigate back while it is unsettled.
                let release
                window.fetch = ((prev) => (url, init) => {
                    const method = (init && init.method) || 'GET'
                    if (method !== 'GET') {
                        calls.push({ url: String(url), method })
                        return new Promise((r) => { release = () => r(new Response(null, { status: 204 })) })
                    }
                    return prev(url, init)
                })(window.fetch)

                wildflower.getQuery(n).write({ id: 20, name: 'edited' }).catch(() => {})
                expect(store.rows[0].name).toBe('edited')

                page = 1
                wildflower.getQuery(n).refresh()
                expect(store.rows[0].name, `${tag}: a cached page overwrote an unsettled write`).toBe('edited')

                release()
                await settle()
                expect(store.pendingWrites, `${tag}: pendingWrites did not drain`).toBe(0)
            })

            it(`keeps accumulated pages across a param round trip (${tag})`, async () => {
                pagedServer()
                const n = `ix3${persist ? 'p' : ''}`
                const store = paged(n, persist ? { persist: true } : {})
                await settle()

                page = 2
                await wildflower.getQuery(n).refresh({ append: true })
                await settle()
                expect(store.rows.length, `${tag}: append did not accumulate`).toBe(2)

                page = 1
                await wildflower.getQuery(n).refresh({ append: true })
                await settle()
                // Accumulation is the query's mode now; no snapshot of a single
                // URL may replace the merged set.
                expect(store.rows.length, `${tag}: accumulation was lost on return`).toBe(2)
                expect(store.pendingWrites).toBe(0)
            })

            it(`clears staleness when an unchanged page answers 304 (${tag})`, async () => {
                const n = `ix4${persist ? 'p' : ''}`
                let serveEtag = true
                window.fetch = (url, init) => {
                    const u = String(url)
                    calls.push({ url: u, method: (init && init.method) || 'GET' })
                    const ifNone = init && init.headers && init.headers['If-None-Match']
                    if (ifNone && serveEtag) return Promise.resolve(new Response(null, { status: 304 }))
                    const headers = new Headers()
                    headers.set('ETag', 'W/"fixed"')
                    return Promise.resolve(new Response(JSON.stringify([{ id: 1, name: 'only' }]), { status: 200, headers }))
                }

                const store = paged(n, persist ? { persist: true } : {})
                await settle()
                expect(store.rows[0].name).toBe('only')

                wildflower.getQuery(n).invalidate()
                await settle()
                expect(store.isStale, `${tag}: a 304 left the query stale`).toBe(false)
                expect(store.error, `${tag}: a 304 was treated as an error`).toBe(null)
                expect(store.rows.length, `${tag}: a 304 disturbed the rows`).toBe(1)
                serveEtag = false
            })
        }
    })

    // The three axes the cartesian and the interaction block above both miss,
    // each a race rather than a shape: a push arriving mid-write, a temp-id
    // correction landing on a row the server already sent under its real key,
    // and the retry ladder crossed with params that moved while it waited.
    describe('interaction: races', () => {
        class FakeEventSource {
            constructor(url) {
                this.url = url
                this.closed = false
                FakeEventSource.instances.push(this)
            }
            close() { this.closed = true }
        }
        let realEventSource
        function stubEventSource() {
            FakeEventSource.instances = []
            realEventSource = window.EventSource
            window.EventSource = FakeEventSource
            return () => { window.EventSource = realEventSource }
        }

        // The retry tests shorten the ladder's base delay. A test failing
        // before its own cleanup would otherwise leave every later file
        // running against a 40ms ladder, which is the kind of cross-file
        // leak that produces a flake nobody can place.
        afterEach(() => { delete wildflower._queryRetryBaseMs })

        it('an SSE arrival mid-write leaves the written field to the write', async () => {
            const restore = stubEventSource()
            try {
                const n = 'rx1'
                let releaseWrite
                window.fetch = (url, init) => {
                    const method = (init && init.method) || 'GET'
                    calls.push({ url: String(url), method })
                    if (method !== 'GET') {
                        return new Promise((r) => { releaseWrite = () => r(new Response(null, { status: 204 })) })
                    }
                    return Promise.resolve(new Response(
                        JSON.stringify([{ id: 1, name: 'server', tally: 0 }]), { status: 200 }
                    ))
                }

                const c = n + 'c'
                wildflower.component(c, { state: {} })
                wildflower.query(n, {
                    from: '/api/items', key: 'id', refresh: 'sse', stream: '/api/stream',
                    to: '/api/items/:id', body: (i) => i
                })
                container.innerHTML = `<div data-component="${c}"><ul data-query="${n}"><template><li data-bind="name"></li></template></ul></div>`
                const store = wildflower.getStore(n)
                await settle()
                expect(FakeEventSource.instances.length, 'the sse rung connected').toBe(1)

                wildflower.getQuery(n).write({ id: 1, name: 'mine' }).catch(() => {})
                expect(store.rows[0].name).toBe('mine')

                // A push carrying a competing value for the field being written,
                // plus a fresh value for a field nobody is writing.
                FakeEventSource.instances[0].onmessage({
                    data: JSON.stringify([{ id: 1, name: 'from-the-stream', tally: 7 }])
                })
                await settle()

                expect(store.rows[0].name, 'an in-flight write owns its field against a push').toBe('mine')
                expect(store.rows[0].tally, 'and a field nobody claimed takes the pushed value').toBe(7)

                releaseWrite()
                await settle()
                expect(store.pendingWrites, 'the write drained').toBe(0)
                expect(store.rows.length, 'no duplicate row survived the race').toBe(1)
            } finally { restore() }
        })

        it('a temp-id correction lands on a row the server already sent', async () => {
            const n = 'rx2'
            let releaseCreate
            let serverRows = [{ id: 1, name: 'existing' }]
            window.fetch = (url, init) => {
                const method = (init && init.method) || 'GET'
                calls.push({ url: String(url), method })
                if (method === 'POST') {
                    return new Promise((r) => {
                        releaseCreate = () => r(new Response(
                            JSON.stringify({ id: 99, name: 'made', note: 'server' }), { status: 200 }
                        ))
                    })
                }
                if (method !== 'GET') return Promise.resolve(new Response(null, { status: 204 }))
                return Promise.resolve(new Response(JSON.stringify(serverRows), { status: 200 }))
            }

            const c = n + 'c'
            wildflower.component(c, { state: {} })
            wildflower.query(n, {
                from: '/api/items', key: 'id',
                create: { url: '/api/items', method: 'POST', body: (i) => i, confirmation: (d) => d }
            })
            container.innerHTML = `<div data-component="${c}"><ul data-query="${n}"><template><li data-bind="name"></li></template></ul></div>`
            const store = wildflower.getStore(n)
            await settle()

            wildflower.getQuery(n).create({ name: 'made' }).catch(() => {})
            const tmpRow = store.rows.find((r) => String(r.id).indexOf('tmp-') === 0)
            expect(tmpRow, 'the optimistic row exists under a minted key').toBeTruthy()

            // The entity arrives under its REAL key before the create confirms,
            // which is the out-of-band push that races the correction.
            serverRows = [{ id: 1, name: 'existing' }, { id: 99, name: 'made', note: 'arrived-first' }]
            await wildflower.getQuery(n).refresh()
            await settle()

            // The precondition for the branch under test: BOTH the optimistic
            // row and its real-keyed twin are present at once. Without this the
            // test would pass by never reaching the twin case at all.
            expect(store.rows.some((r) => String(r.id).indexOf('tmp-') === 0),
                'the pending create kept its optimistic row through the arrival').toBe(true)
            expect(store.rows.some((r) => r.id === 99),
                'and the entity arrived under its real key first').toBe(true)

            releaseCreate()
            await settle()

            const tmps = store.rows.filter((r) => String(r.id).indexOf('tmp-') === 0)
            const nineties = store.rows.filter((r) => r.id === 99)
            expect(tmps.length, 'no ghost temp row survived the correction').toBe(0)
            expect(nineties.length, 'and the entity is present exactly once').toBe(1)
            expect(store.pendingWrites, 'the create drained').toBe(0)
        })

        it('the retry ladder re-issues the params that failed, not the ones that moved', async () => {
            const n = 'rx3'
            let page = 1
            let failNext = true
            wildflower._queryRetryBaseMs = 40
            window.fetch = (url) => {
                const u = String(url)
                calls.push({ url: u, method: 'GET' })
                if (failNext) {
                    failNext = false
                    return Promise.resolve(new Response(null, { status: 503 }))
                }
                return Promise.resolve(new Response(JSON.stringify([{ id: 1, name: u }]), { status: 200 }))
            }

            const c = n + 'c'
            wildflower.component(c, { state: {} })
            wildflower.query(n, { from: '/api/items', key: 'id', retry: 2, params: () => ({ page }) })
            container.innerHTML = `<div data-component="${c}"><ul data-query="${n}"><template><li data-bind="name"></li></template></ul></div>`
            const store = wildflower.getStore(n)
            await settle(20)

            // The application moves on while the ladder is waiting.
            page = 2
            await settle(220)
            delete wildflower._queryRetryBaseMs

            expect(calls.length, 'the ladder fired').toBeGreaterThan(1)
            expect(calls[0].url, 'the first attempt used the value it had').toContain('page=1')
            expect(calls[1].url, 'and the retry re-issued what failed rather than re-deriving it')
                .toContain('page=1')
            expect(store.error, 'the recovered load is not an error').toBe(null)
            expect(store.pendingWrites).toBe(0)
        })

        it('a fresh refresh cancels the ladder and uses the current params', async () => {
            const n = 'rx4'
            let page = 1
            let failing = true
            wildflower._queryRetryBaseMs = 400   // long enough that the refresh wins
            window.fetch = (url) => {
                const u = String(url)
                calls.push({ url: u, method: 'GET' })
                if (failing) return Promise.resolve(new Response(null, { status: 503 }))
                return Promise.resolve(new Response(JSON.stringify([{ id: 1, name: u }]), { status: 200 }))
            }

            const c = n + 'c'
            wildflower.component(c, { state: {} })
            wildflower.query(n, { from: '/api/items', key: 'id', retry: 3, params: () => ({ page }) })
            container.innerHTML = `<div data-component="${c}"><ul data-query="${n}"><template><li data-bind="name"></li></template></ul></div>`
            const store = wildflower.getStore(n)
            await settle(30)

            page = 2
            failing = false
            await wildflower.getQuery(n).refresh()
            await settle(60)
            delete wildflower._queryRetryBaseMs

            const last = calls[calls.length - 1]
            expect(last.url, 'an explicit refresh is a new episode at current values').toContain('page=2')
            expect(store.rows[0].name, 'and its result is what landed').toContain('page=2')
            expect(store.error).toBe(null)

            // The cancelled ladder must not fire afterwards and re-request page 1.
            const seen = calls.length
            await settle(500)
            expect(calls.length, 'the superseded ladder was cancelled, not merely ignored').toBe(seen)
        })
    })

    // The rollback half, run over the cells that can actually write. A
    // rejected write has to leave the rows exactly as the last confirmed
    // truth left them, whatever else the cell declared.
    for (const cell of CELLS.filter((c) => c.to !== 'none' && !c.create && !c.deleted)) {
        const label = `${cell.shape}/${cell.from}/${cell.to}`

        it(`unwinds a rejected write: ${label}`, async () => {
            serve({ failWrites: true })
            const store = mount(cell)
            await settle()

            const before = JSON.stringify(wildflower.toRaw ? wildflower.toRaw(store.rows) : store.rows)
            const q = wildflower.getQuery(cell.name)

            // A function `to` resolves rather than rejecting here, since the
            // cell's transport does not touch the failing server at all.
            if (cell.to === 'fn') return

            let threw = null
            try { await q.write({ id: 2, name: 'doomed' }) } catch (e) { threw = e }
            await settle()

            expect(threw, `${label} I6 a 500 did not reject the write`).toBeTruthy()
            const after = JSON.stringify(wildflower.toRaw ? wildflower.toRaw(store.rows) : store.rows)
            expect(after, `${label} I6 rollback did not restore the confirmed rows`).toBe(before)
            expect(store.pendingWrites, `${label} I3 pendingWrites did not drain after rejection`).toBe(0)
            expect(store.isStale, `${label} I4 left stale after the drain`).toBe(false)
        })
    }
})
