/**
 * data-query declarative transport form (v1.5).
 *
 * The surface under test:
 *
 *   from:   URL string (now a template), or a function (unchanged escape hatch)
 *   to:     URL string, or a map of named operations, or a function (unchanged)
 *   create: its own key, because it alone mints identity
 *   select / body / confirmation: payload shape, overridable per operation
 *   headers: origin-scoped framework default, per-query override
 *
 * Hard constraint running through every test here: ADDITIVE ONLY. `from:` has
 * been public since 1.3.0, so a declaration that does not use the new keys must
 * behave exactly as it did — which is why the token grammar refuses to read a
 * port or a query-string colon as a token.
 *
 * fetch is stubbed per test and restored after.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
// Diagnostics are __DEV__-gated and stripped from production builds, so the
// tests that assert one only run where one can exist. The BEHAVIOR each
// diagnostic accompanies is pinned separately, in tests that run everywhere.
const devIt = isMinifiedBuild() ? it.skip : it

let seq = 0
const uname = (p) => `${p}-${++seq}`

function jsonResponse(data, { status = 200, etag } = {}) {
    const headers = new Headers()
    if (etag) headers.set('ETag', etag)
    return new Response(JSON.stringify(data), { status, headers })
}

async function settle(ms = 80) {
    await new Promise((r) => setTimeout(r, ms))
}

suite('data-query: declarative transport form', () => {
    let container
    let wildflower
    let realFetch
    let realWarn
    let calls
    let warnings

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        calls = []
        warnings = []
        realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')); realWarn.apply(console, a) }
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        delete wildflower.options.queryCacheEntries
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    const warnsWith = (code) => warnings.filter((w) => w.includes('[WF ' + code + ']'))

    // Records the whole request, not just the URL: a wrong verb, a missing body
    // and an unsent header are all silent failures the URL alone cannot show.
    function stubFetch(handler) {
        window.fetch = (url, init) => {
            calls.push({
                url: String(url),
                method: (init && init.method) || 'GET',
                headers: (init && init.headers) || {},
                body: init && init.body
            })
            return Promise.resolve(handler(String(url), calls.length, init || {}))
        }
    }

    function mountList(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <ul data-query="${qname}"><template><li data-bind="name"></li></template></ul>
            </div>
        `
    }

    const lastCall = () => calls[calls.length - 1]
    // A write with no `confirmation` fires a conditional refetch when it
    // settles, so the LAST request is a GET. The write itself is the last
    // non-GET, and asserting on that is the only way to see what was sent.
    const writes = () => calls.filter((k) => k.method !== 'GET')
    const lastWrite = () => writes()[writes().length - 1]

    describe('path tokens in from:', () => {
        it('interpolates a :token from params and drops it from the query string', async () => {
            const q = uname('tk'); const c = uname('tkc')
            stubFetch(() => jsonResponse([{ id: 1, name: 'a' }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/articles/:slug/comments',
                key: 'id',
                params: () => ({ slug: 'how-to-train', limit: 5 })
            })
            mountList(q, c)
            await settle()

            const url = calls[0].url
            expect(url, 'the token was interpolated into the path').toContain('/api/articles/how-to-train/comments')
            expect(url, 'a param consumed by the path leaves the query-string merge').not.toContain('slug=')
            expect(url, 'params the path did not consume still serialize').toContain('limit=5')
        })

        it('encodes token values so one token is always exactly one segment', async () => {
            const q = uname('tke'); const c = uname('tkec')
            stubFetch(() => jsonResponse([]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items/:id', key: 'id', params: { id: 'a/b c' } })
            mountList(q, c)
            await settle()

            expect(calls[0].url, 'a slash in the value cannot become a path segment')
                .toBe('/api/items/a%2Fb%20c')
        })

        it('does not read a port as a token', async () => {
            const q = uname('tkp'); const c = uname('tkpc')
            stubFetch(() => jsonResponse([]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: 'http://localhost:3000/api/tasks', key: 'id' })
            mountList(q, c)
            await settle()

            expect(calls[0].url, 'the token grammar refuses a digit-leading match')
                .toBe('http://localhost:3000/api/tasks')
        })

        it('does not read a colon in the query string as a token', async () => {
            const q = uname('tkq'); const c = uname('tkqc')
            stubFetch(() => jsonResponse([]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/search?filter=type:book', key: 'id' })
            mountList(q, c)
            await settle()

            expect(calls[0].url, 'only the path component is scanned')
                .toBe('/api/search?filter=type:book')
        })

        it('does not read credentials in the authority as a token', async () => {
            const q = uname('tka'); const c = uname('tkac')
            stubFetch(() => jsonResponse([]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: 'https://user:pass@example.com/api/items', key: 'id' })
            mountList(q, c)
            await settle()

            expect(calls[0].url, 'the authority is not scanned')
                .toBe('https://user:pass@example.com/api/items')
        })

        it('a null param is treated as absent, never interpolated as "null"', async () => {
            const q = uname('tkn'); const c = uname('tknc')
            stubFetch(() => jsonResponse([]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/articles/:slug', key: 'id', params: () => ({ slug: null }) })
            mountList(q, c)
            await settle()

            expect(calls.length, 'no request goes out with an unresolved token').toBe(0)
        })
    })

    // A route-driven query is declared before its route parameter exists. The
    // function form has always had an answer (`if (!route.slug) return []`),
    // which is what the flagship demo does; the declarative form needs one too,
    // or every such query paints an error banner until the router catches up.
    // Peer libraries spell this `enabled:`. Here it falls out of the token
    // itself: a read whose path cannot be resolved has not been asked for yet.
    describe('a read whose token is unresolved is not-ready, not failed', () => {
        it('sends nothing and reports no error', async () => {
            const q = uname('nr'); const c = uname('nrc')
            stubFetch(() => jsonResponse([]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/articles/:slug/comments', key: 'id', params: () => ({}) })
            mountList(q, c)
            await settle()

            const store = wildflower.getStore(q)
            expect(calls.length, 'a request with an unresolved path must not be sent').toBe(0)
            expect(store.error, 'waiting is not failing').toBe(null)
            expect(store.syncError, 'nor a transient failure').toBe(null)
        })

        it('stays in its first-load state rather than rendering an empty result', async () => {
            const q = uname('nl'); const c = uname('nlc')
            stubFetch(() => jsonResponse([]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/articles/:slug', key: 'id', params: () => ({ slug: null }) })
            mountList(q, c)
            await settle()

            const store = wildflower.getStore(q)
            // isLoading is "no usable data yet", which is exactly true here. The
            // alternative reads as an empty result set, which is a different and
            // false claim about the server.
            expect(store.isLoading, 'the query has no data and has not given up').toBe(true)
            expect(store.rows.length).toBe(0)
        })

        it('fetches as soon as the value arrives', async () => {
            const q = uname('nw'); const c = uname('nwc')
            let slug = null
            stubFetch(() => jsonResponse([{ id: 1, name: 'a comment' }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/articles/:slug/comments', key: 'id', params: () => ({ slug }) })
            mountList(q, c)
            await settle()
            expect(calls.length).toBe(0)

            slug = 'how-to-train'
            await wildflower.getQuery(q).refresh()
            await settle()

            const store = wildflower.getStore(q)
            expect(calls[0].url).toBe('/api/articles/how-to-train/comments')
            expect(store.rows.length, 'and recovers with no trace of the wait').toBe(1)
            expect(store.isLoading).toBe(false)
            expect(store.error).toBe(null)
        })

        it('keeps the rows it already has when a later refetch cannot resolve', async () => {
            const q = uname('nk'); const c = uname('nkc')
            let slug = 'first-post'
            stubFetch(() => jsonResponse([{ id: 1, name: 'a comment' }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/articles/:slug/comments', key: 'id', params: () => ({ slug }) })
            mountList(q, c)
            await settle()
            expect(wildflower.getStore(q).rows.length).toBe(1)

            const before = calls.length
            slug = null
            wildflower.getQuery(q).invalidate()
            await settle()

            const store = wildflower.getStore(q)
            expect(calls.length, 'nothing was requested').toBe(before)
            expect(store.rows.length, 'what is on screen stays on screen').toBe(1)
            expect(store.syncError, 'and is not marked as a failed sync').toBe(null)
            expect(store.isStale, 'nor stuck syncing forever').toBe(false)
        })

        it('a WRITE with an unresolved token still fails loudly', async () => {
            // The asymmetry is the point. A read fires on the framework's
            // schedule and may simply be early; a write happens because
            // somebody called it, so a missing token is a bug in the call.
            const { handle } = await mountWith({
                to: { move: { url: '/api/boards/:boardId/items/:id', method: 'POST' } }
            })

            let threw = null
            try { await handle.write('move', { id: 1 }) } catch (e) { threw = e }
            expect(threw, 'an explicit call gets an explicit failure').toBeTruthy()
            expect(String(threw.message)).toContain('boardId')
        })

        devIt('names the wait once, not on every skipped attempt', async () => {
            const q = uname('no'); const c = uname('noc')
            stubFetch(() => jsonResponse([]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/articles/:slug', key: 'id', params: () => ({}) })
            mountList(q, c)
            await settle()

            const first = warnsWith('WF-972').length
            expect(first, 'a silently idle query is worth naming once').toBeGreaterThan(0)

            wildflower.getQuery(q).invalidate()
            wildflower.getQuery(q).invalidate()
            await settle()
            expect(warnsWith('WF-972').length, 'but a normal waiting state must not spam').toBe(first)
        })

        it('refresh({ params }) merges per key, so a structural param is never dropped', async () => {
            const q = uname('tkr'); const c = uname('tkrc')
            stubFetch(() => jsonResponse([]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/articles/:slug/comments',
                key: 'id',
                params: () => ({ slug: 'how-to-train', page: 1 })
            })
            mountList(q, c)
            await settle()

            // The merge was always per key, but it becomes load-bearing once a
            // param can be structural: dropping slug here would not change a
            // query string, it would render the path unresolvable.
            await wildflower.getQuery(q).refresh({ params: { page: 2 } })
            await settle()
            expect(lastCall().url).toBe('/api/articles/how-to-train/comments?page=2')
        })

        it('the ETag follows the resolved path, not just the query string', async () => {
            const q = uname('tket'); const c = uname('tketc')
            let slug = 'first-post'
            stubFetch((url) => jsonResponse([], { etag: 'W/"' + url + '"' }))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/articles/:slug', key: 'id', params: () => ({ slug }) })
            mountList(q, c)
            await settle()

            // Once a param is consumed into the path it has left the query
            // string, so a param signature no longer identifies the resource.
            // The resolved URL does.
            slug = 'second-post'
            wildflower.getQuery(q).invalidate()
            await settle()

            const second = calls.find((k) => k.url.indexOf('second-post') >= 0)
            expect(second, 'the second article was requested').toBeTruthy()
            expect(second.headers['If-None-Match'], "the first article's validator must not ride it").toBeFalsy()
        })

        it('a URL with no tokens is byte-identical to what was declared', async () => {
            const q = uname('tkz'); const c = uname('tkzc')
            stubFetch(() => jsonResponse([{ id: 1, name: 'a' }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id' })
            mountList(q, c)
            await settle()

            expect(calls[0].url).toBe('/api/items')
        })
    })

    // The rows every write test starts from.
    const ROWS = [{ id: 1, name: 'first', done: false }, { id: 2, name: 'second', done: false }]

    // A query whose read is stubbed with ROWS and whose write config is
    // whatever the test is pinning. Returns the query handle, mounted and
    // loaded, so each test starts from real rows rather than an empty list.
    async function mountWith(config, respond) {
        const q = uname('w'); const c = uname('wc')
        stubFetch(respond || ((url, n, init) => {
            if (!init.method || init.method === 'GET') return jsonResponse(ROWS.map((r) => ({ ...r })))
            return new Response(null, { status: 204 })
        }))
        wildflower.component(c, { state: {} })
        wildflower.query(q, { from: '/api/items', key: 'id', ...config })
        mountList(q, c)
        await settle()
        return { q, handle: wildflower.getQuery(q), store: wildflower.getStore(q) }
    }

    describe('to: as a destination', () => {
        it('a bare string expands to update and delete at the URL as written', async () => {
            const { handle } = await mountWith({ to: '/api/items/:id', deleted: 'gone' })

            await handle.write({ id: 2, name: 'renamed' })
            await settle()
            expect(lastWrite().url, 'update addresses the row').toBe('/api/items/2')
            expect(lastWrite().method, 'a partial field merge is a PATCH, not a PUT').toBe('PATCH')

            await handle.write({ id: 1, gone: true })
            await settle()
            expect(lastWrite().url).toBe('/api/items/1')
            expect(lastWrite().method, 'the declared deleted field derives the verb').toBe('DELETE')
        })

        it('routes a named operation to its own URL and verb', async () => {
            const { handle } = await mountWith({
                to: {
                    favorite: { url: '/api/items/:id/favorite', method: 'POST' },
                    unfavorite: { url: '/api/items/:id/favorite', method: 'DELETE' }
                }
            })

            await handle.write('favorite', { id: 2, favorited: true })
            await settle()
            expect(lastWrite().url).toBe('/api/items/2/favorite')
            expect(lastWrite().method).toBe('POST')

            await handle.write('unfavorite', { id: 2, favorited: false })
            await settle()
            expect(lastWrite().url).toBe('/api/items/2/favorite')
            expect(lastWrite().method, 'the toggle idiom: same URL, opposite verb').toBe('DELETE')
        })

        it('an operation the query does not declare is a named error, not a guess', async () => {
            const { handle } = await mountWith({ to: { favorite: { url: '/api/items/:id/fav', method: 'POST' } } })

            let threw = null
            try { await handle.write('archive', { id: 1 }) } catch (e) { threw = e }
            expect(threw, 'an undeclared operation must not fall back to update').toBeTruthy()
            expect(String(threw.message), 'the error names the operation').toContain('archive')
            expect(calls.some((k) => k.method !== 'GET'), 'nothing was sent').toBe(false)
        })

        it('update and delete stay reserved: a map entry named delete IS the lifecycle delete', async () => {
            const { handle, store } = await mountWith({
                deleted: 'gone',
                to: { delete: { url: '/api/items/:id', method: 'DELETE' } }
            })

            // Reached BY NAME, not by derivation: the framework still applies
            // the declared tombstone field, so one entry cannot behave two ways.
            const p = handle.write('delete', { id: 1 })
            expect(store.rows.some((r) => r.id === 1), 'the row was tombstoned optimistically').toBe(false)
            await p
            await settle()
            expect(lastWrite().method).toBe('DELETE')
        })

        devIt('warns at declaration when deleted: is declared with no delete route', async () => {
            await mountWith({
                deleted: 'gone',
                to: { favorite: { url: '/api/items/:id/fav', method: 'POST' } }
            })
            expect(warnsWith('WF-975').length, 'announced at load').toBeGreaterThan(0)
        })

        it('and errors at the call site when that delete is attempted', async () => {
            const { handle, store } = await mountWith({
                deleted: 'gone',
                to: { favorite: { url: '/api/items/:id/fav', method: 'POST' } }
            })

            let threw = null
            try { await handle.write({ id: 1, gone: true }) } catch (e) { threw = e }
            expect(threw, 'loud where it matters, in every build').toBeTruthy()
            expect(String(threw.message)).toContain('delete')
            expect(store.rows.some((r) => r.id === 1), 'and no row was tombstoned on the way out').toBe(true)
        })

        it('a function to: is untouched — the escape hatch, forever', async () => {
            const seen = []
            const { handle, store } = await mountWith({
                to: (item) => { seen.push(item); return Promise.resolve({ ...item }) }
            })

            await handle.write({ id: 2, name: 'renamed' })
            await settle()
            expect(seen.length, 'the function received the item, exactly as before').toBe(1)
            expect(seen[0].name).toBe('renamed')
            expect(store.rows.find((r) => r.id === 2).name).toBe('renamed')
            expect(calls.filter((k) => k.method !== 'GET').length, 'the engine sent nothing itself').toBe(0)
        })

        it('a named operation on a function to: is an error, not a silent single-transport call', async () => {
            const { handle } = await mountWith({ to: (item) => Promise.resolve({ ...item }) })

            let threw = null
            try { await handle.write('favorite', { id: 1 }) } catch (e) { threw = e }
            expect(threw, 'the function form carries no operation hint').toBeTruthy()
            expect(String(threw.message)).toContain('favorite')
        })
    })

    describe('path tokens in write URLs', () => {
        it("resolves from the item's fields first and falls back to params", async () => {
            const { handle } = await mountWith({
                params: () => ({ slug: 'from-the-route' }),
                to: { delete: { url: '/api/articles/:slug/comments/:id', method: 'DELETE' } },
                deleted: 'gone'
            })

            // :id is the item's; :slug is nowhere on the item, so params supply it.
            await handle.write('delete', { id: 7 })
            await settle()
            expect(lastWrite().url).toBe('/api/articles/from-the-route/comments/7')
        })

        it('the item wins over params for the same token', async () => {
            const { handle } = await mountWith({
                key: 'slug',
                params: () => ({ slug: 'the-routed-article' }),
                to: { favorite: { url: '/api/articles/:slug/favorite', method: 'POST' } }
            })

            // The failure this ordering exists to prevent: favoriting a row that
            // is not the currently-routed article must address THAT row.
            await handle.write('favorite', { slug: 'some-other-article', favorited: true })
            await settle()
            expect(lastWrite().url).toBe('/api/articles/some-other-article/favorite')
        })

        it('an unresolvable write token rejects the write and sends nothing', async () => {
            const { handle } = await mountWith({
                to: { move: { url: '/api/boards/:boardId/items/:id', method: 'POST' } }
            })

            let threw = null
            try { await handle.write('move', { id: 1 }) } catch (e) { threw = e }
            expect(threw).toBeTruthy()
            expect(String(threw.message), 'names the token').toContain('boardId')
            expect(String(threw.message), 'and the operation').toContain('move')
            expect(calls.some((k) => k.method !== 'GET'), 'no request went out').toBe(false)
        })
    })

    // Survey 🔬 #2 (Lane C #5, the axios-CVE-2025-27152 empty-segment
    // class): '' consumed by a token encodes to an EMPTY path segment, so
    // write({ id: '' }) against to: '/api/items/:id' silently addressed
    // THE COLLECTION — PATCH /api/items/ — and the delete shape was
    // DELETE /api/items/. An empty string can never name one path
    // segment, so it is no value: reads wait, writes reject naming the
    // token.
    describe('an empty-string token value is unresolved, never an empty segment', () => {
        it('a write whose key is the empty string rejects and sends nothing', async () => {
            const { handle, store } = await mountWith({ to: '/api/items/:id' })

            let threw = null
            try { await handle.write({ id: '', name: 'renamed' }) } catch (e) { threw = e }
            await settle(20)
            expect(threw, 'the write rejected').toBeTruthy()
            expect(String(threw.message), 'names the token').toContain('id')
            expect(calls.some((k) => k.method !== 'GET'),
                'nothing was sent — the collection URL was never addressed').toBe(false)
            // The optimistic phantom (an unseen key appends) rolled back.
            expect(store.rows.length, 'no phantom row survives the rejection').toBe(2)
        })

        it('a delete whose key is the empty string rejects and sends nothing', async () => {
            const { handle } = await mountWith({ to: '/api/items/:id', deleted: 'gone' })

            let threw = null
            try { await handle.write({ id: '', gone: true }) } catch (e) { threw = e }
            await settle(20)
            expect(threw, 'the delete rejected').toBeTruthy()
            expect(calls.some((k) => k.method === 'DELETE'),
                'DELETE /api/items/ was never sent').toBe(false)
        })

        it('a read whose token resolves to the empty string waits, exactly like a missing one', async () => {
            const q = uname('tkz'); const c = uname('tkzc')
            stubFetch(() => jsonResponse([]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/articles/:slug', key: 'id', params: () => ({ slug: '' }) })
            mountList(q, c)
            await settle()

            expect(calls.length, 'no request goes out with an empty-segment path').toBe(0)
            const h = wildflower.getQuery(q)
            expect(h.error, 'waiting is not failure').toBe(null)
        })
    })

    // Survey 🔬 #4 (Lane E #10, urql's dev error 13): undefined is a
    // third meaning RFC 7396 does not have — null deletes a field,
    // absent leaves it alone. JSON.stringify already drops an
    // undefined-valued field from any declarative body, so the wire says
    // "absent" while the client wrote `undefined` over the row's real
    // value and claimed the field. The ruling: an undefined-valued field
    // is ABSENT everywhere — not merged, not claimed, no pre-image, and
    // a function `to:` receives the item without it.
    describe('an undefined-valued field is absent, not a value', () => {
        const CLAIM_SEP = String.fromCharCode(0)

        it('is not merged, not claimed, and rolls back nothing', async () => {
            const pending = []
            const { q, handle, store } = await mountWith({
                to: () => new Promise((resolve, reject) => { pending.push({ resolve, reject }) })
            })

            const p = handle.write({ id: 1, name: undefined, done: true })
            p.catch(() => {})
            await settle(20)
            expect(store.rows[0].name, 'the real value survives the optimistic merge').toBe('first')
            expect(store.rows[0].done, 'a defined field still applies').toBe(true)
            const controller = wildflower._queryControllers.get(q)
            expect(controller.fieldClaims.has('1' + CLAIM_SEP + 'name'),
                'no claim is taken for an absent field').toBe(false)
            expect(controller.fieldClaims.get('1' + CLAIM_SEP + 'done'),
                'the defined field is claimed normally').toBe(1)

            pending[0].reject(new Error('409'))
            await settle(20)
            expect(store.rows[0].name, 'rollback leaves the untouched field untouched').toBe('first')
            expect(store.rows[0].done, 'rollback reverts only what was written').toBe(false)
        })

        it('a function to: receives the item without the field', async () => {
            const seen = []
            const { handle } = await mountWith({
                to: (item) => { seen.push(item); return Promise.resolve(undefined) }
            })

            await handle.write({ id: 2, name: undefined, done: true })
            await settle(20)
            expect('name' in seen[0], 'the transport sees what the wire would carry').toBe(false)
            expect(seen[0].done).toBe(true)
        })

        it('null stays a VALUE: merged, claimed, and distinct from absent', async () => {
            const pending = []
            const { q, handle, store } = await mountWith({
                to: () => new Promise((resolve, reject) => { pending.push({ resolve, reject }) })
            })

            const p = handle.write({ id: 1, name: null })
            p.catch(() => {})
            await settle(20)
            expect(store.rows[0].name, 'null applies optimistically').toBe(null)
            const controller = wildflower._queryControllers.get(q)
            expect(controller.fieldClaims.has('1' + CLAIM_SEP + 'name'),
                'null is claimed like any value').toBe(true)

            pending[0].reject(new Error('409'))
            await settle(20)
            expect(store.rows[0].name, 'and rolls back like any value').toBe('first')
        })

        devIt('WF-987 names the dropped fields once in dev builds', async () => {
            const { handle } = await mountWith({
                to: () => Promise.resolve(undefined)
            })

            await handle.write({ id: 1, name: undefined })
            await settle(20)
            const hits = warnsWith('WF-987')
            expect(hits.length, 'one diagnostic').toBe(1)
            expect(hits[0], 'naming the field').toContain('name')

            await handle.write({ id: 2, done: undefined })
            await settle(20)
            expect(warnsWith('WF-987').length, 'once per query, not per call').toBe(1)
        })
    })

    describe('create: mints identity', () => {
        it('POSTs to its own URL and adds the row optimistically under a minted key', async () => {
            const { handle, store } = await mountWith({
                create: { url: '/api/items', body: (item) => ({ name: item.name }) }
            })

            const before = store.rows.length
            // Read the optimistic state synchronously: the apply happens inside
            // the create() call, and the stubbed transport settles fast enough
            // that any await here would race the follow-up refetch.
            const p = handle.create({ name: 'third' })
            expect(store.rows.length, 'the row is on screen before the server answers').toBe(before + 1)
            const minted = store.rows[store.rows.length - 1]
            expect(minted.id, 'the framework minted the temp key').toBeTruthy()
            expect(String(minted.id)).toContain('tmp-')

            await p.catch(() => {})
            await settle()
            expect(lastWrite().url, 'the create URL is not the item URL').toBe('/api/items')
            expect(lastWrite().method).toBe('POST')
            expect(JSON.parse(lastWrite().body), 'the declared body shaped the payload').toEqual({ name: 'third' })
        })

        it('reconciles the minted key to the server key with no duplicate row', async () => {
            const { handle, store } = await mountWith({
                create: {
                    url: '/api/items',
                    body: (item) => ({ name: item.name }),
                    confirmation: (d) => d.item
                }
            }, (url, n, init) => {
                if (!init.method || init.method === 'GET') return jsonResponse(ROWS.map((r) => ({ ...r })))
                return jsonResponse({ item: { id: 99, name: 'third' } })
            })

            await handle.create({ name: 'third' })
            await settle()

            const tmp = store.rows.filter((r) => String(r.id).indexOf('tmp-') === 0)
            expect(tmp.length, 'the optimistic row was renamed, not left beside the real one').toBe(0)
            expect(store.rows.filter((r) => r.id === 99).length, 'exactly one server row').toBe(1)
        })

        it('rejects a create by removing the row it alone brought into existence', async () => {
            const { handle, store } = await mountWith({
                create: { url: '/api/items', body: (item) => ({ name: item.name }) }
            }, (url, n, init) => {
                if (!init.method || init.method === 'GET') return jsonResponse(ROWS.map((r) => ({ ...r })))
                return new Response(null, { status: 500 })
            })

            const before = store.rows.length
            let threw = null
            try { await handle.create({ name: 'third' }) } catch (e) { threw = e }
            await settle()
            expect(threw, 'the caller sees the failure').toBeTruthy()
            expect(store.rows.length, 'the optimistic row is gone').toBe(before)
        })

        it('create() with no create: declared is a named error', async () => {
            const { handle } = await mountWith({ to: '/api/items/:id' })
            let threw = null
            try { await handle.create({ name: 'x' }) } catch (e) { threw = e }
            expect(threw).toBeTruthy()
            expect(String(threw.message)).toContain('create')
        })

        devIt('flags a create URL that interpolates the key token', async () => {
            const q = uname('ck'); const c = uname('ckc')
            stubFetch(() => jsonResponse([]))
            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id', create: '/api/items/:id' })
            mountList(q, c)
            await settle()
            expect(warnsWith('WF-973').length, 'announced at declaration').toBeGreaterThan(0)
        })

        it('refuses to send a create whose URL would interpolate a key the framework minted', async () => {
            const { handle, store } = await mountWith({ create: '/api/items/:id' })
            const before = store.rows.length

            let threw = null
            try { await handle.create({ name: 'third' }) } catch (e) { threw = e }
            expect(threw, 'that URL would name a temp id the server never issued').toBeTruthy()
            expect(String(threw.message)).toContain('minted')
            expect(writes().length, 'nothing was sent').toBe(0)
            await settle()
            expect(store.rows.length, 'and the optimistic row was unwound').toBe(before)
        })

        it('allows the same URL when the caller supplies the key (client-generated ids)', async () => {
            // A PUT-style create against a client-chosen id is a real pattern,
            // and the key token resolves correctly there because the key is the
            // caller's own data.
            const { handle } = await mountWith({
                create: { url: '/api/items/:id', method: 'PUT', body: (item) => item }
            })

            await handle.create({ id: 'uuid-abc', name: 'third' }).catch(() => {})
            await settle()
            expect(lastWrite().url).toBe('/api/items/uuid-abc')
            expect(lastWrite().method).toBe('PUT')
        })

        it('does not send a key the framework minted in the request body', async () => {
            const { handle } = await mountWith({
                create: { url: '/api/items', body: (item) => item }
            })

            await handle.create({ name: 'third' }).catch(() => {})
            await settle()
            const sent = JSON.parse(lastWrite().body)
            expect(sent.name).toBe('third')
            expect(sent.id, 'the minted key is bookkeeping, not the author\'s payload').toBeUndefined()
        })

        it('mints nothing when the caller supplies its own temp key', async () => {
            const { handle, store } = await mountWith({
                create: { url: '/api/items', body: (item) => item }
            })

            handle.create({ id: 'my-own-tmp', name: 'third' }).catch(() => {})
            expect(store.rows.some((r) => r.id === 'my-own-tmp'), "the caller's key is honored").toBe(true)
        })

        devIt('refuses create declared inside the to: map', async () => {
            const q = uname('cm'); const c = uname('cmc')
            stubFetch(() => jsonResponse([]))
            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/items', key: 'id',
                to: { create: { url: '/api/items', method: 'POST' } }
            })
            mountList(q, c)
            await settle()
            expect(warnsWith('WF-971').length, 'create is its own top-level key').toBeGreaterThan(0)
        })
    })

    describe('select: turns a read response into rows', () => {
        it('unwraps an envelope', async () => {
            const q = uname('sl'); const c = uname('slc')
            stubFetch(() => jsonResponse({ articles: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }], articlesCount: 47 }))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/articles', key: 'id', select: (d) => d.articles })
            mountList(q, c)
            await settle()

            const store = wildflower.getStore(q)
            expect(store.rows.length, 'the envelope was unwrapped into rows').toBe(2)
            expect(store.rows[0].name).toBe('a')
        })

        devIt('an envelope with no select is one row whose fields are the envelope — and says so', async () => {
            const q = uname('sn'); const c = uname('snc')
            stubFetch(() => jsonResponse({ articles: [{ id: 1 }], articlesCount: 47 }))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/articles', key: 'id' })
            mountList(q, c)
            await settle()

            // The silent version of this is what made the declarative read form
            // unusable for a real API and went unnoticed until it was designed for.
            expect(warnsWith('WF-980').length, 'the shape failure is named, not silent').toBeGreaterThan(0)
        })

        devIt('select returning nothing empties the list and says which of the two happened', async () => {
            const q = uname('se'); const c = uname('sec')
            stubFetch(() => jsonResponse({ items: [{ id: 1 }] }))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/articles', key: 'id', select: (d) => d.articles })
            mountList(q, c)
            await settle()

            expect(wildflower.getStore(q).rows.length).toBe(0)
            const w = warnsWith('WF-980')
            expect(w.length).toBeGreaterThan(0)
            expect(w.join(' '), 'the emptied case is named as such, not as a wrong shape')
                .toMatch(/empty/i)
            // wfError emits context and suggestion as separate console.warn
            // calls, so the follow-up line is where the two causes are told apart.
            expect(warnings.join(' '), 'distinguishes "the server sent nothing" from "your transform missed"')
                .toMatch(/select/i)
        })

        it('a record-shaped query returning one object is not a shape failure', async () => {
            const q = uname('sr'); const c = uname('src')
            stubFetch(() => jsonResponse({ id: 1, name: 'only' }))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/article', key: 'id' })
            // No <template>: record shape, where a single object IS the answer.
            container.innerHTML = `
                <div data-component="${c}">
                    <div data-query="${q}"><span id="rn" data-bind="name"></span></div>
                </div>
            `
            await settle()

            expect(warnsWith('WF-980').length, 'record queries legitimately return one object').toBe(0)
            expect(document.getElementById('rn').textContent).toBe('only')
        })

        devIt('is ignored on a function from:, and says so at declaration', async () => {
            const q = uname('sf'); const c = uname('sfc')
            stubFetch(() => jsonResponse([]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: () => Promise.resolve([{ id: 1, name: 'a' }]),
                key: 'id',
                select: (d) => d.articles
            })
            mountList(q, c)
            await settle()

            expect(warnsWith('WF-978').length, 'a function from builds and parses its own request').toBeGreaterThan(0)
            expect(wildflower.getStore(q).rows.length, 'the function form is untouched').toBe(1)
        })
    })

    describe('body: and confirmation: are payload shape, per operation', () => {
        it('a query-level body applies to update and create, and nothing else', async () => {
            const { handle } = await mountWith({
                to: {
                    update: { url: '/api/items/:id', method: 'PATCH' },
                    favorite: { url: '/api/items/:id/fav', method: 'POST' }
                },
                create: '/api/items',
                body: (item) => ({ item })
            })

            await handle.write({ id: 2, name: 'renamed' })
            await settle()
            expect(JSON.parse(lastWrite().body), 'update takes the query-level envelope')
                .toEqual({ item: { id: 2, name: 'renamed' } })

            await handle.create({ name: 'third' }).catch(() => {})
            await settle()
            expect(JSON.parse(lastWrite().body).item.name, 'so does create').toBe('third')

            await handle.write('favorite', { id: 2, favorited: true })
            await settle()
            expect(lastWrite().body, 'a named operation sends no body it did not declare').toBeFalsy()
        })

        it('an entry-level body overrides the query-level one', async () => {
            const { handle } = await mountWith({
                to: { update: { url: '/api/items/:id', method: 'PATCH', body: (item) => ({ patch: item.name }) } },
                body: (item) => ({ item })
            })

            await handle.write({ id: 2, name: 'renamed' })
            await settle()
            expect(JSON.parse(lastWrite().body)).toEqual({ patch: 'renamed' })
        })

        devIt('warns when an update carries fields it has no declared way to send', async () => {
            const { handle } = await mountWith({ to: '/api/items/:id' })
            await handle.write({ id: 2, name: 'renamed' })
            await settle()
            expect(warnsWith('WF-977').length, 'a silent no-op becomes a named one').toBeGreaterThan(0)
        })

        // A query-level body reaches update and create ONLY (pinned above).
        // An author who declared one and then adds a named operation gets a
        // request that sends nothing, which is the exact surprise the
        // diagnostic exists for, and it was the one case it stayed quiet on.
        devIt('warns when a named operation drops a declared query-level body', async () => {
            const { handle } = await mountWith({
                to: { publish: { url: '/api/items/:id/publish', method: 'POST' } },
                body: (item) => item
            })
            await handle.write('publish', { id: 2, note: 'ship it' })
            await settle()

            expect(lastWrite().body, 'the request really does depart empty').toBeFalsy()
            const w = warnsWith('WF-977')
            expect(w.length, 'and the author is told why').toBeGreaterThan(0)
            expect(w[0], 'the message names the operation that dropped it').toContain('publish')
        })

        // The calibration that decides how wide the gate may open. A named
        // operation whose URL IS the verb sends nothing on purpose, which is
        // the dominant shape for named operations. Warning on it would fire
        // on correct code, so the query-level body is what separates a
        // surprise from a deliberate body-less action.
        devIt('stays quiet for a body-less named operation when no query-level body exists', async () => {
            const { handle } = await mountWith({
                to: { publish: { url: '/api/items/:id/publish', method: 'POST' } }
            })
            await handle.write('publish', { id: 2, note: 'ship it' })
            await settle()
            expect(warnsWith('WF-977').length, 'the URL is the verb; nothing was dropped').toBe(0)
        })

        devIt('stays quiet for a named operation that declares its own body', async () => {
            const { handle } = await mountWith({
                to: { publish: { url: '/api/items/:id/publish', method: 'POST', body: (i) => ({ note: i.note }) } },
                body: (item) => item
            })
            await handle.write('publish', { id: 2, note: 'ship it' })
            await settle()
            expect(JSON.parse(lastWrite().body), 'its own body wins').toEqual({ note: 'ship it' })
            expect(warnsWith('WF-977').length, 'nothing was dropped').toBe(0)
        })

        // WF-940 is WF-977's twin. `confirmation` inherits by the identical
        // rule (update and create only), and until now only the body half
        // said so. The costs differ: a dropped body sends nothing, while a
        // dropped confirmation still WORKS and then pays a full collection
        // refetch for every write, because no confirmation means transport
        // only. The shape that triggers it is the ordinary one, since a
        // favorite or publish endpoint usually answers with the updated row.
        const GETS = () => calls.filter((k) => k.method === 'GET').length

        // Answers every write with a real record, so a confirmation that IS
        // in play can reconcile and the refetch becomes observable by absence.
        const echo = (url, n, init) => {
            if (!init.method || init.method === 'GET') return jsonResponse(ROWS.map((r) => ({ ...r })))
            return jsonResponse({ item: { id: 2, name: 'second', favorited: true } })
        }

        devIt('warns when a named operation drops a declared query-level confirmation', async () => {
            const { handle } = await mountWith({
                to: { favorite: { url: '/api/items/:id/favorite', method: 'POST' } },
                confirmation: (b) => b.item
            }, echo)

            const before = GETS()
            await handle.write('favorite', { id: 2, favorited: true })
            await settle()

            const w = warnsWith('WF-940')
            expect(w.length, 'the dropped declaration is named').toBeGreaterThan(0)
            expect(w[0], 'the message names the operation that dropped it').toContain('favorite')
            expect(GETS(), 'and the refetch it warns about really happens').toBeGreaterThan(before)
        })

        devIt('stays quiet for a named operation that declares its own confirmation', async () => {
            const { handle } = await mountWith({
                to: { favorite: { url: '/api/items/:id/favorite', method: 'POST', confirmation: (b) => b.item } },
                confirmation: (b) => b.item
            }, echo)

            const before = GETS()
            await handle.write('favorite', { id: 2, favorited: true })
            await settle()

            expect(warnsWith('WF-940').length, 'nothing was dropped').toBe(0)
            expect(GETS(), 'and reconciling from the response spends no refetch').toBe(before)
        })

        // The calibration, matching WF-977's: a named operation with no
        // confirmation anywhere is the deliberate refetch-after-write shape,
        // which is correct code. The declared-and-not-inherited query-level
        // one is what separates a surprise from a choice.
        devIt('stays quiet for a named operation when no query-level confirmation exists', async () => {
            const { handle } = await mountWith({
                to: { favorite: { url: '/api/items/:id/favorite', method: 'POST' } }
            }, echo)
            await handle.write('favorite', { id: 2, favorited: true })
            await settle()
            expect(warnsWith('WF-940').length, 'refetching on purpose is not a mistake').toBe(0)
        })

        devIt('stays quiet for update and create, which do inherit it', async () => {
            const { handle } = await mountWith({
                to: '/api/items/:id', create: '/api/items',
                body: (i) => i, confirmation: (b) => b.item
            }, echo)

            await handle.write({ id: 2, name: 'renamed' })
            await handle.create({ name: 'third' }).catch(() => {})
            await settle()
            expect(warnsWith('WF-940').length, 'these are the two that inherit').toBe(0)
        })

        // Exempt for the same reason it is exempt from WF-977: 204 is the
        // ordinary answer to a delete and carries nothing to confirm.
        devIt('stays quiet for delete', async () => {
            const { handle } = await mountWith({
                to: { delete: { url: '/api/items/:id', method: 'DELETE' } },
                deleted: 'gone', confirmation: (b) => b.item
            }, echo)
            await handle.write({ id: 2, gone: true })
            await settle()
            expect(warnsWith('WF-940').length, 'a delete has nothing to confirm').toBe(0)
        })

        devIt('names it once per query, not once per write', async () => {
            const { handle } = await mountWith({
                to: { favorite: { url: '/api/items/:id/favorite', method: 'POST' } },
                confirmation: (b) => b.item
            }, echo)

            await handle.write('favorite', { id: 2, favorited: true })
            await settle()
            await handle.write('favorite', { id: 1, favorited: true })
            await settle()
            expect(warnsWith('WF-940').length, 'a per-write warning would drown the console').toBe(1)
        })

        // WF-998: the server answered ok, but the app's confirmation: threw
        // (classically `r => r.json()` — it receives the parsed body, not the
        // Response). The write must still reject and roll back exactly as
        // before, and dev builds must say which function raised, because the
        // symptom is otherwise indistinguishable from a server rejection.
        devIt('a confirmation that throws is named (WF-998) and the write still rejects', async () => {
            const { handle, store } = await mountWith({
                to: '/api/items/:id',
                body: (item) => item,
                confirmation: (r) => r.json()   // the trap: parsed body has no .json()
            }, (url, n, init) => {
                if (!init.method || init.method === 'GET') return jsonResponse(ROWS.map((r) => ({ ...r })))
                return jsonResponse({ id: 1, name: 'saved' })
            })

            const before = store.rows.find((r) => r.id === 1).name
            let threw = null
            try { await handle.write({ id: 1, name: 'renamed' }) } catch (e) { threw = e }
            await settle(20)

            expect(threw, 'the write rejected').toBeTruthy()
            expect(store.rows.find((r) => r.id === 1).name, 'and rolled back to the pre-image').toBe(before)
            expect(warnsWith('WF-998').length, 'dev builds name the confirmation as the thrower').toBe(1)
            expect(warnsWith('WF-998')[0], 'the warn names the op').toContain('"update" confirmation: threw')
        })

        it('a declared confirmation reconciles the response as server truth', async () => {
            const { handle, store } = await mountWith({
                to: { update: { url: '/api/items/:id', method: 'PATCH' } },
                body: (item) => item,
                confirmation: (d) => d.item
            }, (url, n, init) => {
                if (!init.method || init.method === 'GET') return jsonResponse(ROWS.map((r) => ({ ...r })))
                return jsonResponse({ item: { id: 2, name: 'server-said-so', done: true } })
            })

            await handle.write({ id: 2, name: 'renamed' })
            await settle()

            const row = store.rows.find((r) => r.id === 2)
            expect(row.name, "the server's answer replaced the optimistic value").toBe('server-said-so')
            expect(row.done, 'and carried fields the write never touched').toBe(true)
        })

        // Survey probe #5b (Lane F #2, the axios error.response scar;
        // ruled 2026-08-29): a rejected write carried only the string
        // 'HTTP 422', so a validation response's field errors could not
        // reach the UI through a declarative to:. The rejection now
        // carries `status` (the number) and `body` (the parsed JSON, or
        // undefined when the body is not JSON) as additive properties on
        // the same Error. syncError stays the plain string — it is bound
        // in markup as text.
        it('a rejected declarative write carries status and the parsed body', async () => {
            const { handle, store } = await mountWith(
                { to: '/api/items/:id' },
                (url, n, init) => {
                    if (!init.method || init.method === 'GET') return jsonResponse(ROWS.map((r) => ({ ...r })))
                    return jsonResponse({ errors: { title: ['is too long'] } }, { status: 422 })
                }
            )

            let threw = null
            try { await handle.write({ id: 1, name: 'nope' }) } catch (e) { threw = e }
            await settle(20)
            expect(threw, 'the write rejected').toBeTruthy()
            expect(threw.message, 'the message keeps its shape').toBe('HTTP 422')
            expect(threw.status, 'the status is a number on the error').toBe(422)
            expect(threw.body && threw.body.errors.title[0], 'the parsed body rides along').toBe('is too long')
            expect(store.syncError, 'syncError stays the plain string').toBe('HTTP 422')
        })

        it('a raw Response from a function to: gets the same error shape', async () => {
            const { handle } = await mountWith({
                to: () => Promise.resolve(jsonResponse({ errors: { base: ['conflict'] } }, { status: 409 }))
            })

            let threw = null
            try { await handle.write({ id: 2, name: 'nope' }) } catch (e) { threw = e }
            await settle(20)
            expect(threw.status).toBe(409)
            expect(threw.body && threw.body.errors.base[0]).toBe('conflict')
        })

        it('a non-JSON error body leaves body undefined, status still set', async () => {
            const { handle } = await mountWith(
                { to: '/api/items/:id' },
                (url, n, init) => {
                    if (!init.method || init.method === 'GET') return jsonResponse(ROWS.map((r) => ({ ...r })))
                    return new Response('<html>bad gateway</html>', { status: 502 })
                }
            )

            let threw = null
            try { await handle.write({ id: 1, name: 'nope' }) } catch (e) { threw = e }
            await settle(20)
            expect(threw.status).toBe(502)
            expect(threw.body, 'an unparseable body is not an exception').toBe(undefined)
        })

        it('no confirmation means the ok response is transport, so the query refetches', async () => {
            let served = 0
            const { handle } = await mountWith({
                to: { update: { url: '/api/items/:id', method: 'PATCH' } },
                body: (item) => item
            }, (url, n, init) => {
                if (!init.method || init.method === 'GET') {
                    served++
                    return jsonResponse(ROWS.map((r) => ({ ...r })))
                }
                return new Response(null, { status: 204 })
            })

            const before = served
            await handle.write({ id: 2, name: 'renamed' })
            await settle()
            expect(served, 'a query with no confirmation gets no confirmation, so it refetches')
                .toBeGreaterThan(before)
        })
    })

    describe('headers: credentials the string form could never send', () => {
        afterEach(() => {
            wildflower.config({ headers: undefined })
        })

        it('a per-query declaration rides both the read and the write', async () => {
            const { handle } = await mountWith({
                to: '/api/items/:id',
                body: (item) => item,
                headers: { Authorization: 'Token abc' }
            })

            expect(calls[0].headers.Authorization, 'the read carried it').toBe('Token abc')
            await handle.write({ id: 2, name: 'renamed' })
            await settle()
            expect(lastWrite().headers.Authorization, 'and so did the write').toBe('Token abc')
        })

        it('a function form is resolved per request, so a refreshed token is the one sent', async () => {
            let token = 'first'
            const { handle } = await mountWith({
                to: '/api/items/:id',
                body: (item) => item,
                headers: () => ({ Authorization: 'Token ' + token })
            })
            expect(calls[0].headers.Authorization).toBe('Token first')

            token = 'second'
            await handle.write({ id: 2, name: 'renamed' })
            await settle()
            expect(lastWrite().headers.Authorization, 'not captured at declaration').toBe('Token second')
        })

        it('the retry ladder re-issues with the CURRENT credential, not the failed one', async () => {
            const q = uname('hr'); const c = uname('hrc')
            let token = 'expired'
            wildflower._queryRetryBaseMs = 30
            stubFetch((url, n) => (n === 1 ? new Response(null, { status: 401 }) : jsonResponse([{ id: 1, name: 'a' }])))

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/items', key: 'id', retry: 2,
                headers: () => ({ Authorization: 'Token ' + token })
            })
            mountList(q, c)
            await settle(20)
            token = 'refreshed'
            await settle(200)

            delete wildflower._queryRetryBaseMs
            expect(calls.length, 'the ladder fired').toBeGreaterThan(1)
            expect(calls[0].headers.Authorization).toBe('Token expired')
            expect(calls[1].headers.Authorization, 'headers resolve per attempt').toBe('Token refreshed')
        })

        it('an origin-scoped default applies to that origin and to no other', async () => {
            wildflower.config({
                headers: { 'https://api.example.com': { Authorization: 'Token org' } }
            })

            const q = uname('ho'); const c = uname('hoc')
            const q2 = uname('ho2'); const c2 = uname('ho2c')
            stubFetch(() => jsonResponse([{ id: 1, name: 'a' }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: 'https://api.example.com/items', key: 'id' })
            wildflower.component(c2, { state: {} })
            wildflower.query(q2, { from: 'https://third-party.example.net/items', key: 'id' })
            container.innerHTML = `
                <div data-component="${c}"><ul data-query="${q}"><template><li data-bind="name"></li></template></ul></div>
                <div data-component="${c2}"><ul data-query="${q2}"><template><li data-bind="name"></li></template></ul></div>
            `
            await settle()

            const mine = calls.find((k) => k.url.indexOf('https://api.example.com') === 0)
            const theirs = calls.find((k) => k.url.indexOf('https://third-party') === 0)
            expect(mine.headers.Authorization, 'the declared origin gets the credential').toBe('Token org')
            expect(theirs.headers.Authorization, 'a third-party origin never does').toBeUndefined()
        })

        it("'self' is the document's own origin, which is what a relative URL matches", async () => {
            wildflower.config({ headers: { self: () => ({ Authorization: 'Token self' }) } })
            const { handle } = await mountWith({ to: '/api/items/:id', body: (i) => i })

            expect(calls[0].headers.Authorization).toBe('Token self')
            await handle.write({ id: 2, name: 'renamed' })
            await settle()
            expect(lastWrite().headers.Authorization).toBe('Token self')
        })

        it('a per-query declaration overrides the default per key and inherits the rest', async () => {
            wildflower.config({
                headers: { self: { Authorization: 'Token default', 'X-Client': 'wf' } }
            })
            await mountWith({ headers: { Authorization: 'Token query' } })

            expect(calls[0].headers.Authorization, 'the query wins for the key it names').toBe('Token query')
            expect(calls[0].headers['X-Client'], 'and inherits the ones it does not').toBe('wf')
        })

        devIt('a headers function that throws is named, and the request still goes', async () => {
            const q = uname('ht'); const c = uname('htc')
            stubFetch(() => jsonResponse([{ id: 1, name: 'a' }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/items', key: 'id',
                headers: () => { throw new Error('no session') }
            })
            mountList(q, c)
            await settle()

            expect(warnsWith('WF-981').length).toBeGreaterThan(0)
            expect(calls.length, 'a missing credential is the server\'s call to make, not a reason to send nothing').toBe(1)
        })
    })

    // A query is one named entity whose params change, so returning to a page
    // already seen used to re-request it and wait. The cache keeps the last few
    // resolved URLs' rows in memory and repaints instantly while the
    // revalidation is in flight. No API: the declaration and the binding are
    // unchanged, and $name.rows simply repopulates without the wait.
    describe('result cache: returning to a URL already fetched', () => {
        // Holds each response open so a test can observe the state BETWEEN the
        // request going out and the answer arriving, which is the entire window
        // this feature exists to fill.
        function heldFetch(rowsFor) {
            const held = []
            window.fetch = (url, init) => {
                calls.push({ url: String(url), method: (init && init.method) || 'GET', headers: (init && init.headers) || {} })
                let release
                const p = new Promise((r) => { release = () => r(jsonResponse(rowsFor(String(url)))) })
                held.push(release)
                return p
            }
            return {
                // Yield BEFORE releasing: component scanning issues the
                // activation fetch asynchronously, so splicing immediately
                // after mount finds an empty queue and lets that request land
                // late and superseded, which silently empties the rows every
                // later assertion is written against.
                releaseAll: async () => {
                    await settle(20)
                    held.splice(0).forEach((r) => r())
                    await settle()
                }
            }
        }

        const pageRows = (url) => [{ id: url.indexOf('page=2') >= 0 ? 2 : 1, name: url.indexOf('page=2') >= 0 ? 'from-page-2' : 'from-page-1' }]

        it('repaints from memory before the revalidation answers', async () => {
            const q = uname('rc'); const c = uname('rcc')
            let page = 1
            const gate = heldFetch(pageRows)

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id', params: () => ({ page }) })
            mountList(q, c)
            await gate.releaseAll()
            const store = wildflower.getStore(q)
            expect(store.rows[0].name).toBe('from-page-1')

            page = 2
            wildflower.getQuery(q).refresh()
            await gate.releaseAll()
            expect(store.rows[0].name).toBe('from-page-2')

            // Back to a URL already seen, with the response still held open.
            page = 1
            const before = calls.length
            wildflower.getQuery(q).refresh()
            expect(store.rows[0].name, 'painted from memory, synchronously').toBe('from-page-1')
            expect(store.isStale, 'and honestly marked as awaiting confirmation').toBe(true)
            expect(calls.length, 'while the revalidation is genuinely in flight').toBe(before + 1)

            await gate.releaseAll()
            expect(store.isStale, 'which clears when the server confirms').toBe(false)
        })

        it('does not repaint a URL it has never fetched', async () => {
            const q = uname('rn'); const c = uname('rnc')
            let page = 1
            const gate = heldFetch(pageRows)

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id', params: () => ({ page }) })
            mountList(q, c)
            await gate.releaseAll()

            const store = wildflower.getStore(q)
            page = 2
            wildflower.getQuery(q).refresh()
            expect(store.rows[0].name, 'an unseen URL leaves the old rows alone until it answers').toBe('from-page-1')
            await gate.releaseAll()
            expect(store.rows[0].name).toBe('from-page-2')
        })

        it('does not repaint when the URL has not changed', async () => {
            const q = uname('rs'); const c = uname('rsc')
            const gate = heldFetch(pageRows)

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id', params: () => ({ page: 1 }) })
            mountList(q, c)
            await gate.releaseAll()

            const store = wildflower.getStore(q)
            const rowsBefore = store.rows
            wildflower.getQuery(q).refresh()
            // Repainting identical rows would be a wasted list re-render.
            expect(store.rows, 'the same URL is already on screen').toBe(rowsBefore)
            await gate.releaseAll()
        })

        it('leaves accumulated pages alone', async () => {
            const q = uname('ra'); const c = uname('rac')
            let page = 1
            const gate = heldFetch((url) => [{ id: url.indexOf('page=2') >= 0 ? 2 : 1, name: 'p' + (url.indexOf('page=2') >= 0 ? 2 : 1) }])

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id', params: () => ({ page }) })
            mountList(q, c)
            await gate.releaseAll()

            page = 2
            wildflower.getQuery(q).refresh({ append: true })
            await gate.releaseAll()
            const store = wildflower.getStore(q)
            expect(store.rows.length, 'both pages are on screen').toBe(2)

            // An accumulating query's rows are a merge across URLs, so no single
            // URL's snapshot describes them and repainting one would drop a page.
            page = 1
            wildflower.getQuery(q).refresh({ append: true })
            expect(store.rows.length, 'accumulation survives the round trip').toBe(2)
            await gate.releaseAll()
        })

        it('does not paint over an unsettled optimistic write', async () => {
            const q = uname('rw'); const c = uname('rwc')
            let page = 1
            let holdWrite
            window.fetch = (url, init) => {
                const u = String(url)
                calls.push({ url: u, method: (init && init.method) || 'GET' })
                if (init && init.method && init.method !== 'GET') {
                    return new Promise((r) => { holdWrite = () => r(new Response(null, { status: 204 })) })
                }
                return Promise.resolve(jsonResponse(pageRows(u)))
            }

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/items', key: 'id', params: () => ({ page }),
                to: '/api/items/:id', body: (i) => i
            })
            mountList(q, c)
            await settle()

            page = 2
            await wildflower.getQuery(q).refresh()
            await settle()

            const store = wildflower.getStore(q)
            wildflower.getQuery(q).write({ id: 2, name: 'edited-locally' }).catch(() => {})
            expect(store.rows[0].name).toBe('edited-locally')

            // Navigating back with the write still unsettled must not restore a
            // snapshot over it; the write owns that row until it settles.
            page = 1
            wildflower.getQuery(q).refresh()
            expect(store.rows[0].name, 'the optimistic value stands').toBe('edited-locally')

            holdWrite()
            await settle()
        })

        it('is bounded, so a long session cannot grow without limit', async () => {
            const q = uname('rb'); const c = uname('rbc')
            // The bound itself, not its default: queryCacheEntries sets it, and
            // pinning the shipped number here would make every future change to
            // it look like a regression.
            wildflower.config({ queryCacheEntries: 3 })
            let page = 1
            stubFetch((url) => {
                const n = url.split('page=')[1]
                return jsonResponse([{ id: Number(n), name: 'page-' + n }])
            })

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id', params: () => ({ page }) })
            mountList(q, c)
            await settle()

            // Walk far enough to evict the first page from a bounded cache.
            for (let p = 2; p <= 8; p++) {
                page = p
                await wildflower.getQuery(q).refresh()
                await settle(5)
            }

            const store = wildflower.getStore(q)
            page = 1
            wildflower.getQuery(q).refresh()
            expect(store.rows[0].name, 'the oldest entry was evicted, so this waits for the network')
                .toBe('page-8')
            await settle()
            expect(store.rows[0].name, 'and then arrives normally').toBe('page-1')
        })
    })

    // The test that caught every blocker found while designing this: could
    // Conduit (www/demos/conduit_private/queries.js — a RealWorld API client
    // that today uses the function form for every from: and every to:,
    // because it needs Authorization headers and its API answers with
    // envelopes) be rewritten onto this surface? These are its real
    // declarations, against its real request and response shapes.
    describe('adoptability: Conduit rewritten onto this surface', () => {
        const route = { slug: 'how-to-train', tag: null, feedTotal: 0, page: 1 }

        afterEach(() => { wildflower.config({ headers: undefined }) })

        it('the article feed: envelope response, paginated params, favorite toggle', async () => {
            wildflower.config({ headers: { self: () => ({ Authorization: 'Token jwt' }) } })
            const q = uname('cf'); const c = uname('cfc')
            stubFetch((url, n, init) => {
                if (!init.method || init.method === 'GET') {
                    return jsonResponse({
                        articles: [
                            { slug: 'how-to-train', title: 'A', favorited: false, favoritesCount: 0 },
                            { slug: 'other-post', title: 'B', favorited: false, favoritesCount: 3 }
                        ],
                        articlesCount: 47
                    })
                }
                // Deliberately NOT the optimistic value: a count of 4 would be
                // whatever the write already applied, so the assertion below
                // could not tell a reconcile from no reconcile at all.
                return jsonResponse({ article: { slug: 'other-post', title: 'B', favorited: true, favoritesCount: 99 } })
            })

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                key: 'slug',
                from: '/api/articles',
                params: () => ({ limit: 10, offset: (route.page - 1) * 10, tag: route.tag }),
                select: (d) => { route.feedTotal = d.articlesCount; return d.articles },
                to: {
                    favorite: { url: '/api/articles/:slug/favorite', method: 'POST', confirmation: (d) => d.article },
                    unfavorite: { url: '/api/articles/:slug/favorite', method: 'DELETE', confirmation: (d) => d.article }
                }
            })
            container.innerHTML = `
                <div data-component="${c}">
                    <ul data-query="${q}"><template><li data-bind="title"></li></template></ul>
                </div>
            `
            await settle()

            expect(calls[0].url, 'a null param is not serialized').toBe('/api/articles?limit=10&offset=0')
            expect(calls[0].headers.Authorization, 'the blocker that forced the function form').toBe('Token jwt')
            const store = wildflower.getStore(q)
            expect(store.rows.length, 'select unwrapped the envelope').toBe(2)
            expect(route.feedTotal, 'the total outside the page came through select').toBe(47)

            // Favorite the row that is NOT the routed article: the whole reason
            // tokens resolve item-first.
            await wildflower.getQuery(q).write('favorite', { slug: 'other-post', favorited: true, favoritesCount: 4 })
            await settle()
            expect(lastWrite().url).toBe('/api/articles/other-post/favorite')
            expect(lastWrite().method).toBe('POST')
            expect(store.rows.find((r) => r.slug === 'other-post').favoritesCount, 'the confirmation reconciled the server count over the optimistic one').toBe(99)
            expect(store.rows.find((r) => r.slug === 'how-to-train').favorited, 'the routed article was untouched').toBe(false)
        })

        it('comments: a body-less delete beside an envelope-carrying create, in ONE query', async () => {
            const q = uname('cc'); const c = uname('ccc')
            stubFetch((url, n, init) => {
                if (!init.method || init.method === 'GET') {
                    return jsonResponse({ comments: [{ id: 11, body: 'existing' }] })
                }
                if (init.method === 'DELETE') return new Response(null, { status: 200 })
                return jsonResponse({ comment: { id: 42, body: 'new one', createdAt: '2026-08-24' } })
            })

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                key: 'id',
                deleted: 'removed',
                from: '/api/articles/:slug/comments',
                params: () => ({ slug: route.slug }),
                select: (d) => d.comments,
                to: {
                    delete: { url: '/api/articles/:slug/comments/:id', method: 'DELETE' }
                },
                create: {
                    url: '/api/articles/:slug/comments',
                    method: 'POST',
                    body: (item) => ({ comment: { body: item.body } }),
                    confirmation: (d) => d.comment
                }
            })
            container.innerHTML = `
                <div data-component="${c}">
                    <ul data-query="${q}"><template><li data-bind="body"></li></template></ul>
                </div>
            `
            await settle()

            expect(calls[0].url, 'the read consumed slug into the path').toBe('/api/articles/how-to-train/comments')
            const store = wildflower.getStore(q)
            expect(store.rows.length).toBe(1)

            await wildflower.getQuery(q).create({ body: 'new one' })
            await settle()
            const created = writes().find((k) => k.method === 'POST')
            expect(created.url, 'create posts to the collection, never to the key').toBe('/api/articles/how-to-train/comments')
            expect(JSON.parse(created.body)).toEqual({ comment: { body: 'new one' } })
            expect(store.rows.some((r) => r.id === 42), 'the confirmed record replaced the minted key').toBe(true)
            expect(store.rows.some((r) => String(r.id).indexOf('tmp-') === 0), 'no orphan optimistic row').toBe(false)

            await wildflower.getQuery(q).write('delete', { id: 42 })
            await settle()
            const removed = writes().find((k) => k.method === 'DELETE')
            expect(removed.url, ':id from the item, :slug from params').toBe('/api/articles/how-to-train/comments/42')
            expect(removed.body, 'a delete declares no body, so none is sent').toBeFalsy()
            expect(store.rows.some((r) => r.id === 42), 'and the row was tombstoned').toBe(false)
        })

        it('a query reading from two endpoints keeps the function from: and still declares its writes', async () => {
            // The one shape the declarative read form cannot express: Conduit's
            // feed switches between /articles and /articles/feed at runtime, and
            // a static URL is one endpoint. Partial adoption is the answer — the
            // write side becomes legible even where the read side cannot.
            const q = uname('cm'); const c = uname('cmc')
            let following = true
            stubFetch((url, n, init) => {
                if (!init.method || init.method === 'GET') {
                    return jsonResponse({ articles: [{ slug: 'a-post', title: 'A' }], articlesCount: 1 })
                }
                return jsonResponse({ article: { slug: 'a-post', title: 'A', favorited: true } })
            })

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                key: 'slug',
                from: () => window.fetch(following ? '/api/articles/feed' : '/api/articles', {})
                    .then((r) => r.json()).then((d) => d.articles),
                // Declared for the WRITE URLs, which is why this must not warn.
                params: () => ({ slug: route.slug }),
                to: {
                    favorite: { url: '/api/articles/:slug/favorite', method: 'POST', confirmation: (d) => d.article }
                }
            })
            container.innerHTML = `
                <div data-component="${c}">
                    <ul data-query="${q}"><template><li data-bind="title"></li></template></ul>
                </div>
            `
            await settle()

            expect(calls[0].url, 'the function chose the endpoint').toBe('/api/articles/feed')
            expect(warnsWith('WF-978').length, 'params are not ignored here — the write URLs use them').toBe(0)

            await wildflower.getQuery(q).write('favorite', { slug: 'a-post', favorited: true })
            await settle()
            expect(lastWrite().url).toBe('/api/articles/a-post/favorite')
        })
    })

    // ── Write-path diagnostics (bug-history survey, diagnostics pass) ────
    // Pass two's structural finding: neither TanStack nor SWR ever shipped
    // a runtime diagnostic for a mutation footgun — every remedy was an
    // API split, an option, or docs. WF's residue of those API changes is
    // a numbered code. Each diagnostic here is dev-only and changes no
    // behavior; the calibration beside each pins that correct code stays
    // silent.
    describe('write-path diagnostics (survey pass, WF-989+)', () => {

        // WF-990 — the unhandled write rejection (TanStack's mutate/
        // mutateAsync split). Fire-and-forget is the NATURAL WF call since
        // rollback and syncError are automatic, so nothing handles the
        // rejection. The warn is microtask-deferred and additive: never an
        // internal catch — the rejection still propagates, and the
        // documented try/catch contract stands. The tests attach their own
        // late .catch inside the same task, after the warn deadline, so
        // the runner never sees a platform unhandledrejection.
        devIt('WF-990: a fire-and-forget rejection is named once', async () => {
            let rejectTo
            const { q, handle } = await mountWith({
                to: () => new Promise((resolve, reject) => { rejectTo = reject })
            })

            const p = handle.write({ id: 1, name: 'renamed' })   // no handler attached
            await settle(20)
            expect(typeof rejectTo).toBe('function')

            rejectTo(new Error('boom'))
            for (let i = 0; i < 12; i++) await Promise.resolve()

            // Past the warn deadline; acknowledge before the task ends so
            // the runner never sees a platform unhandledrejection.
            p.catch(() => {})

            const hits = warnsWith('WF-990')
            expect(hits.length, 'the unhandled rejection is named').toBe(1)
            expect(hits[0], 'naming the query').toContain(q)
        })

        devIt('WF-990 calibration: an attached .catch stays silent', async () => {
            let rejectTo
            const { handle } = await mountWith({
                to: () => new Promise((resolve, reject) => { rejectTo = reject })
            })

            const p = handle.write({ id: 1, name: 'renamed' }).catch(() => {})
            await settle(20)
            rejectTo(new Error('boom'))
            for (let i = 0; i < 12; i++) await Promise.resolve()

            expect(warnsWith('WF-990').length).toBe(0)
            await p
        })

        devIt('WF-990 calibration: awaiting in try/catch stays silent', async () => {
            let rejectTo
            const { handle, store } = await mountWith({
                to: () => new Promise((resolve, reject) => { rejectTo = reject })
            })

            const p = handle.write({ id: 1, name: 'renamed' })
            await settle(20)
            rejectTo(new Error('boom'))
            let caught = null
            try { await p } catch (e) { caught = e }
            for (let i = 0; i < 12; i++) await Promise.resolve()

            expect(caught && caught.message, 'the contract stands: the caller sees the failure').toBe('boom')
            expect(store.rows[0].name, 'and the rollback already ran').toBe('first')
            expect(warnsWith('WF-990').length).toBe(0)
        })

        // WF-991 — a write pending past the threshold (urql #159: optimistic
        // state never cleared). A `to` that never settles holds claims,
        // pendingWrites, persistence, and the whole refresh ladder, forever,
        // silently. Warn only: no timeout, no behavior change.
        devIt('WF-991: a write pending past the threshold is named; nothing is aborted', async () => {
            const { q, handle } = await mountWith({
                to: () => new Promise(() => {})   // never settles
            })
            wildflower._queryWritePendingWarnMs = 60
            try {
                handle.write({ id: 1, name: 'renamed' })
                await settle(20)
                expect(warnsWith('WF-991').length, 'not before the threshold').toBe(0)

                await settle(90)
                const hits = warnsWith('WF-991')
                expect(hits.length, 'the hung write is named').toBe(1)
                expect(hits[0], 'naming the query').toContain(q)
                expect(handle.pendingWrites, 'no timeout was imposed — the write still pends').toBe(1)
            } finally {
                delete wildflower._queryWritePendingWarnMs
            }
        })

        devIt('WF-991 calibration: a write that settles inside the threshold stays silent', async () => {
            const { handle } = await mountWith({ to: '/api/items/:id', body: (i) => i })
            wildflower._queryWritePendingWarnMs = 60
            try {
                await handle.write({ id: 1, name: 'renamed' })
                await settle(120)
                expect(warnsWith('WF-991').length).toBe(0)
            } finally {
                delete wildflower._queryWritePendingWarnMs
            }
        })

        // WF-995 — write(item, opts) silently drops the second argument
        // (TanStack paid a major version to delete overload-shaped call
        // signatures; SWR's mutate options are the habit being imported).
        devIt('WF-995: a second argument to write(item) is named and ignored', async () => {
            const { q, handle } = await mountWith({ to: '/api/items/:id', body: (i) => i })

            await handle.write({ id: 1, name: 'renamed' }, { optimistic: false })
            await settle(20)

            const hits = warnsWith('WF-995')
            expect(hits.length, 'the dropped argument is named').toBe(1)
            expect(hits[0], 'naming the query').toContain(q)
            expect(writes().length, 'the write itself still went out').toBe(1)

            await handle.write({ id: 2, name: 'again' }, { onSuccess: () => {} })
            await settle(20)
            expect(warnsWith('WF-995').length, 'once per query, not per call').toBe(1)
        })

        devIt('WF-995 calibration: the two documented forms stay silent', async () => {
            const { handle } = await mountWith({
                to: { update: { url: '/api/items/:id', body: (i) => i } }
            })

            await handle.write({ id: 1, name: 'renamed' })
            await handle.write('update', { id: 2, name: 'again' })
            await settle(20)
            expect(warnsWith('WF-995').length).toBe(0)
        })

        // WF-996 — a no-item write flowing past the WF-969 keyless guard
        // (Lane D #3): on a record query (or an unbound keyless one) the
        // guard legitimately passes keyless writes, so write("favorite")
        // with no item at all sailed through — claiming nothing, rolling
        // back nothing — while WF-976 fired downstream with key-centric
        // advice that misdescribes the actual mistake.
        devIt('WF-996: a no-item write on a record query is named; WF-976 stays quiet', async () => {
            const q = uname('ni'); const c = uname('nic')
            stubFetch((url, n, init) => {
                if (!init.method || init.method === 'GET') return jsonResponse({ id: 7, name: 'me', published: false })
                return new Response(null, { status: 204 })
            })
            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/profile',
                to: { publish: { url: '/api/profile/publish', method: 'POST' } }
            })
            container.innerHTML = `
                <div data-component="${c}">
                    <div data-query="${q}"><span data-bind="name"></span></div>
                </div>
            `
            await settle()

            await wildflower.getQuery(q).write('publish').catch(() => {})
            await settle(20)

            const hits = warnsWith('WF-996')
            expect(hits.length, 'the missing item is named').toBe(1)
            expect(hits[0], 'naming the query').toContain(q)
            expect(warnsWith('WF-976').length, 'one mistake, one warning').toBe(0)
            expect(writes().length, 'behavior unchanged: the request still departs').toBe(1)

            await wildflower.getQuery(q).write('publish').catch(() => {})
            await settle(20)
            expect(warnsWith('WF-996').length, 'once per query per operation').toBe(1)
        })

        devIt('WF-996 calibration: a record write carrying fields stays silent', async () => {
            const q = uname('nc'); const c = uname('ncc')
            stubFetch((url, n, init) => {
                if (!init.method || init.method === 'GET') return jsonResponse({ id: 7, name: 'me' })
                return new Response(null, { status: 204 })
            })
            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/profile', to: '/api/profile', body: (i) => i })
            container.innerHTML = `
                <div data-component="${c}">
                    <div data-query="${q}"><span data-bind="name"></span></div>
                </div>
            `
            await settle()

            await wildflower.getQuery(q).write({ name: 'renamed' })
            await settle(20)
            expect(warnsWith('WF-996').length, 'the documented keyless record write is not the mistake').toBe(0)
        })

        // WF-993 — a header-config origin key no request can ever match
        // (Lane F #4): wrong scheme or port, or `:443` spelled out, and the
        // Authorization never ships, with no trace. Origins compare exactly,
        // so the near-miss (same host, different scheme/port) is nameable at
        // the first request it fails to match.
        devIt('WF-993: a key differing only by an explicit port is named at first request, once', async () => {
            const q = uname('hp'); const c = uname('hpc')
            wildflower.config({ headers: { 'https://api.example.com:443': { Authorization: 'Token x' } } })
            try {
                stubFetch(() => jsonResponse([]))
                wildflower.component(c, { state: {} })
                wildflower.query(q, { from: 'https://api.example.com/items', key: 'id' })
                mountList(q, c)
                await settle()

                const hits = warnsWith('WF-993')
                expect(hits.length, 'the near-miss is named').toBe(1)
                expect(hits[0], 'naming the declared key').toContain('https://api.example.com:443')
                expect(calls[0].headers.Authorization, 'and indeed nothing shipped').toBeUndefined()

                wildflower.getQuery(q).refresh()
                await settle()
                expect(warnsWith('WF-993').length, 'once per declared key, not per request').toBe(1)
            } finally {
                wildflower.config({ headers: undefined })
            }
        })

        devIt('WF-993: a wrong-scheme key is named', async () => {
            const q = uname('hs'); const c = uname('hsc')
            wildflower.config({ headers: { 'http://api.example.com': { Authorization: 'Token x' } } })
            try {
                stubFetch(() => jsonResponse([]))
                wildflower.component(c, { state: {} })
                wildflower.query(q, { from: 'https://api.example.com/items', key: 'id' })
                mountList(q, c)
                await settle()

                expect(warnsWith('WF-993').length, 'http declared, https requested').toBe(1)
            } finally {
                wildflower.config({ headers: undefined })
            }
        })

        devIt('WF-993 calibration: an exactly-matching key ships and stays silent', async () => {
            const q = uname('hm'); const c = uname('hmc')
            wildflower.config({ headers: { 'https://api.example.com': { Authorization: 'Token x' } } })
            try {
                stubFetch(() => jsonResponse([]))
                wildflower.component(c, { state: {} })
                wildflower.query(q, { from: 'https://api.example.com/items', key: 'id' })
                mountList(q, c)
                await settle()

                expect(calls[0].headers.Authorization).toBe('Token x')
                expect(warnsWith('WF-993').length).toBe(0)
            } finally {
                wildflower.config({ headers: undefined })
            }
        })

        devIt('WF-993 calibration: a declared origin for a genuinely different host never warns', async () => {
            const q = uname('hd'); const c = uname('hdc')
            wildflower.config({ headers: { 'https://api.other.com': { Authorization: 'Token x' } } })
            try {
                stubFetch(() => jsonResponse([]))
                wildflower.component(c, { state: {} })
                wildflower.query(q, { from: 'https://api.example.com/items', key: 'id' })
                mountList(q, c)
                await settle()

                expect(warnsWith('WF-993').length, 'a different host is not a near-miss').toBe(0)
            } finally {
                wildflower.config({ headers: undefined })
            }
        })
    })
})
