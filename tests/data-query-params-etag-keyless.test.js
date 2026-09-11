/**
 * Three pre-existing data-query defects, found 2026-08-24 while designing the
 * declarative transport form. None needed that design to justify them; all are
 * reachable in shipped code. Landing order matters: the ETag fix depends on
 * resolved params, so it follows the params fix.
 *
 *  1. Internal refetches discarded the query's params. Of ten _queryFetch call
 *     sites only refresh() carried params, and there is no params memory, so the
 *     URL builder fell back to the static config object. A query showing page 2
 *     refetched page 1 after any write settled, poll tick, or visibility resume,
 *     and reconciled it as truth — wrong displayed data from a successful
 *     request, with no error. Fixed by letting `params:` be a function resolved
 *     once per run into the captured fetchArgs, so every fetch (internal ones
 *     included) derives current values, and a retry re-issues the values it
 *     failed with rather than re-deriving them.
 *
 *  2. `controller.etag` was a single unkeyed field, so a validator obtained for
 *     one URL rode a request for another. Keyed by the fully resolved request
 *     URL: once a param can be consumed into the path, a param signature no
 *     longer identifies the resource, but the resolved URL always does.
 *
 *  3. A keyless write() silently merged into row zero
 *     (`keyed ? rows.find(...) : rows[0]`). Now a hard error.
 *
 * fetch is stubbed per test and restored after.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

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

suite('data-query: params on internal refetch, ETag keying, keyless write', () => {
    let container
    let wildflower
    let realFetch
    let calls

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
    })

    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    // Records every request so a test can assert what the engine actually sent,
    // which is the only way to see a refetch that silently used stale params.
    function stubFetch(handler) {
        window.fetch = (url, init) => {
            calls.push({ url: String(url), ifNoneMatch: (init && init.headers && init.headers['If-None-Match']) || null })
            return Promise.resolve(handler(String(url), calls.length))
        }
    }

    function mountList(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <ul data-query="${qname}"><template><li data-bind="name"></li></template></ul>
            </div>
        `
    }

    describe('params are carried by internal refetches', () => {
        it('a params function is resolved on every fetch, not just refresh()', async () => {
            const q = uname('pf'); const c = uname('pfc')
            let page = 1
            stubFetch((url) => jsonResponse([{ id: 1, name: 'row-' + url.split('page=')[1] }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id', params: () => ({ page }) })
            mountList(q, c)
            await settle()

            expect(calls.length, 'initial fetch happened').toBeGreaterThan(0)
            expect(calls[0].url, 'params function supplied the first URL').toContain('page=1')

            // Move to page 2 the way an app would: change the source the function
            // reads, then ask for a refresh.
            page = 2
            await wildflower.getQuery(q).refresh()
            await settle()
            const afterRefresh = calls[calls.length - 1].url
            expect(afterRefresh, 'refresh uses the current value').toContain('page=2')

            // The defect: an INTERNAL refetch (no params argument anywhere) must
            // still request page 2, not fall back to the static config.
            const before = calls.length
            wildflower.getQuery(q).invalidate()
            await settle()

            expect(calls.length, 'invalidate() issued a request').toBeGreaterThan(before)
            expect(calls[calls.length - 1].url, 'internal refetch kept the query on page 2').toContain('page=2')
        })

        it('a static params object still applies (unchanged behavior)', async () => {
            const q = uname('ps'); const c = uname('psc')
            stubFetch(() => jsonResponse([{ id: 1, name: 'a' }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id', params: { limit: 5 } })
            mountList(q, c)
            await settle()

            expect(calls[0].url).toContain('limit=5')
            wildflower.getQuery(q).invalidate()
            await settle()
            expect(calls[calls.length - 1].url, 'static params survive an internal refetch').toContain('limit=5')
        })

        it('explicit refresh({ params }) merges over the resolved values per key', async () => {
            const q = uname('pm'); const c = uname('pmc')
            stubFetch(() => jsonResponse([{ id: 1, name: 'a' }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id', params: () => ({ tag: 'js', page: 1 }) })
            mountList(q, c)
            await settle()

            await wildflower.getQuery(q).refresh({ params: { page: 3 } })
            await settle()
            const url = calls[calls.length - 1].url
            // page overridden, tag preserved: a per-key merge, not a replacement.
            expect(url, 'explicit param overrides').toContain('page=3')
            expect(url, 'unlisted params survive the merge').toContain('tag=js')
        })
    })

    describe('ETag is keyed to the request it came from', () => {
        it('a validator obtained for one URL is not sent with another', async () => {
            const q = uname('et'); const c = uname('etc')
            stubFetch((url) => jsonResponse([{ id: 1, name: 'x' }], { etag: 'W/"' + url.split('page=')[1] + '"' }))

            wildflower.component(c, { state: {} })
            let page = 1
            wildflower.query(q, { from: '/api/items', key: 'id', params: () => ({ page }) })
            mountList(q, c)
            await settle()
            expect(calls[0].ifNoneMatch, 'first fetch has no validator').toBe(null)

            // Page 1 answered with an ETag. Now move to page 2: a DIFFERENT
            // resource, so page 1's validator must not ride along.
            page = 2
            wildflower.getQuery(q).invalidate()
            await settle()

            const page2 = calls.find((k) => k.url.includes('page=2'))
            expect(page2, 'page 2 was requested').toBeTruthy()
            expect(page2.ifNoneMatch, "page 1's ETag must not validate page 2").toBe(null)
        })

        it('a validator IS reused when the same URL is requested again', async () => {
            const q = uname('er'); const c = uname('erc')
            stubFetch(() => jsonResponse([{ id: 1, name: 'x' }], { etag: 'W/"v1"' }))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id', params: { page: 1 } })
            mountList(q, c)
            await settle()

            wildflower.getQuery(q).invalidate()
            await settle()

            const second = calls[calls.length - 1]
            expect(second.url, 'same resource').toContain('page=1')
            expect(second.ifNoneMatch, 'conditional request reuses the validator for the same URL').toBe('W/"v1"')
        })
    })

    // A record-shaped query is one bound with no <template>: the subtree binds
    // to the single result record. It declares no key and legitimately writes
    // keyless items, which is the case the declared-key gate exists to protect.
    function mountRecord(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <div data-query="${qname}"><span id="rn" data-bind="name"></span></div>
            </div>
        `
    }

    // Adversarial review finding A, found by two
    // lenses independently. `key` defaults to 'id' and llms.txt documents that,
    // and the read path uses the default throughout. The write path instead
    // asks whether `key:` was TEXTUALLY declared, so a list query that omits it
    // is keyed for reading and keyless for writing. Shape is DOM-determined;
    // whether the author typed `key:` is an independent signal, and the two
    // disagree for the shortest correct spelling of the common case.
    describe('the default key is honored by writes, not only by reads', () => {
        it('create() on a list query that omits key: appends instead of merging into row zero', async () => {
            const q = uname('dk'); const c = uname('dkc')
            // Only the first GET answers; everything after is held open, so
            // this asserts the OPTIMISTIC state and cannot pass by way of a
            // later repaint restoring server truth.
            stubFetch((url, n) => n === 1
                ? jsonResponse([{ id: 1, name: 'first' }, { id: 2, name: 'second' }])
                : new Promise(() => {}))

            wildflower.component(c, { state: {} })
            // No key: declared. 'id' is the documented default.
            wildflower.query(q, { from: '/api/items', create: '/api/items' })
            mountList(q, c)
            await settle()

            const store = wildflower.getStore(q)
            expect(store.rows.length, 'two rows loaded').toBe(2)

            wildflower.getQuery(q).create({ name: 'Widget' }).catch(() => {})
            await settle()

            expect(store.rows[0].name, 'row zero must not be overwritten by a create').toBe('first')
            expect(store.rows[1].name, 'row one must not be overwritten either').toBe('second')
            expect(store.rows.length, 'the created row was appended').toBe(3)
            expect(String(store.rows[2]['id'] || ''), 'and carries a minted temp key').toMatch(/^tmp-/)
        })

        // Settled by asking whether a keyless write to a list has ANY
        // legitimate reading. It does not: "update the only row" means the
        // query is a record, "update every row" is not semantics this engine
        // has, and "append" is create(). That leaves a forgotten key or an
        // author who correctly believes the documented 'id' default applies.
        // Both are mistakes, so this is an error rather than a warning, on the
        // same reasoning WF-969 already records at QuerySystem.js:2054: there
        // is no sane row to infer, so it is an error rather than a guess.
        it('a keyless write() on a list query that omits key: rejects rather than merging', async () => {
            const q = uname('dkw'); const c = uname('dkwc')
            stubFetch(() => jsonResponse([{ id: 1, name: 'first' }, { id: 2, name: 'second' }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', to: () => Promise.resolve() })
            mountList(q, c)
            await settle()

            const store = wildflower.getStore(q)
            let threw = null
            try {
                await wildflower.getQuery(q).write({ name: 'CLOBBER' })
            } catch (e) {
                threw = e
            }
            await settle()

            expect(threw, 'the same rejection a declared key already produces').toBeTruthy()
            expect(store.rows[0].name, 'row zero untouched').toBe('first')
            expect(store.rows[1].name, 'row one untouched').toBe('second')
        })

        // THE CALIBRATION. This is what the declared-key gate was protecting and
        // it must keep working: a record query has one row and no key to mint,
        // so an unkeyed payload merging into it is the documented behavior, not
        // the defect. A fix that makes this red has overcorrected.
        it('a record-shaped query still merges an unkeyed write into its record', async () => {
            const q = uname('rec'); const c = uname('recc')
            // Resolving with nothing triggers invalidate(), so the follow-up
            // GET is held open. Otherwise the stub would re-serve status:'open'
            // over the optimistic merge and the test would fail on the repaint
            // rather than on the merge it is here to pin.
            stubFetch((url, n) => n === 1
                ? jsonResponse({ name: 'solo', status: 'open' })
                : new Promise(() => {}))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/device', to: () => Promise.resolve() })
            mountRecord(q, c)
            await settle()

            const store = wildflower.getStore(q)
            expect(store.rows.length, 'a record query holds one row').toBe(1)
            expect(store.rows[0].name, 'the record loaded').toBe('solo')

            // Not awaited: resolving with nothing triggers invalidate(), whose
            // GET is held open above, so the write's own promise never settles.
            // The optimistic merge is what this pins, and it lands before the
            // round trip either way.
            wildflower.getQuery(q).write({ status: 'closed' }).catch(() => {})
            await settle()

            expect(store.rows.length, 'still one row').toBe(1)
            expect(store.rows[0].status, 'the unkeyed write merged into the record').toBe('closed')
            expect(store.rows[0].name, 'and unnamed fields survived the merge').toBe('solo')
        })

        // The other half of "shape decides": a record query holds one record,
        // so there is no second one to create. Minting a temp key here would
        // append a row to a query whose whole contract is that it has one.
        it('create() on a record-shaped query is an error, not a second row', async () => {
            const q = uname('rc'); const c = uname('rcc')
            stubFetch((url, n) => n === 1
                ? jsonResponse({ name: 'solo', status: 'open' })
                : new Promise(() => {}))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/device', create: '/api/device' })
            mountRecord(q, c)
            await settle()

            const store = wildflower.getStore(q)
            expect(store.rows.length, 'the record loaded').toBe(1)

            let threw = null
            try {
                await wildflower.getQuery(q).create({ name: 'second' })
            } catch (e) {
                threw = e
            }
            await settle()

            expect(threw, 'a record query has one record; there is no second to create').toBeTruthy()
            expect(store.rows.length, 'and no row was appended').toBe(1)
            expect(store.rows[0].name, 'the record is untouched').toBe('solo')
        })

        // "One query, many views" is supported, and hasRecord is set once and
        // never cleared, so a query bound BOTH ways would look record-shaped
        // forever. A list binding proves the rows carry keys, so writes take
        // the list reading and create() still has somewhere to append.
        it('create() still works on a query bound as a list AND as a record', async () => {
            const q = uname('mix'); const c = uname('mixc')
            stubFetch((url, n) => n === 1
                ? jsonResponse([{ id: 1, name: 'first' }, { id: 2, name: 'second' }])
                : new Promise(() => {}))

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id', create: '/api/items' })
            container.innerHTML = `
                <div data-component="${c}">
                    <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
                    <div data-query="${q}"><span class="feature" data-bind="name"></span></div>
                </div>
            `
            await settle()

            const store = wildflower.getStore(q)
            expect(store.rows.length, 'the list view loaded').toBe(2)

            wildflower.getQuery(q).create({ name: 'Widget' }).catch(() => {})
            await settle()

            expect(store.rows.length, 'the create appended rather than rejecting').toBe(3)
            expect(store.rows[0].name, 'and row zero was not merged into').toBe('first')
        })
    })

    // Adversarial review finding D. The ETag
    // header is read and stored before resp.json() is called, so a body that
    // fails to parse still leaves its validator behind. Nothing applied that
    // response, but the validator now vouches for it: the next conditional
    // request sends it, a 304 marks the query fresh, and with persist on those
    // stale rows are written to localStorage as confirmed truth, which is the
    // only failure in this review that outlives the tab.
    describe('an ETag only vouches for a response that was applied', () => {
        it('a body that fails to parse does not leave its validator behind', async () => {
            const q = uname('et'); const c = uname('etc')
            let phase = 1
            stubFetch(() => {
                if (phase === 1) {
                    return jsonResponse([{ id: 1, name: 'first' }], { etag: 'W/"v1"' })
                }
                if (phase === 2) {
                    // 200, a real ETag, and a body that is not JSON at all —
                    // an HTML error page served with the wrong status is the
                    // usual way this happens.
                    const headers = new Headers()
                    headers.set('ETag', 'W/"v2"')
                    return new Response('<html><body>502 Bad Gateway</body></html>',
                        { status: 200, headers })
                }
                return jsonResponse([{ id: 1, name: 'first' }], { etag: 'W/"v1"' })
            })

            wildflower.component(c, { state: {} })
            wildflower.query(q, { from: '/api/items', key: 'id' })
            mountList(q, c)
            await settle()

            const store = wildflower.getStore(q)
            expect(store.rows.length, 'the first response applied').toBe(1)

            phase = 2
            await wildflower.getQuery(q).refresh()
            await settle()

            expect(store.rows.length, 'the unparseable response changed nothing').toBe(1)
            expect(store.syncError, 'and surfaced as a transient error').toBeTruthy()

            phase = 3
            calls.length = 0
            await wildflower.getQuery(q).invalidate()
            await settle()

            const sent = calls[calls.length - 1].ifNoneMatch
            expect(sent, 'the validator sent is the one for content actually applied')
                .not.toBe('W/"v2"')
            expect(sent, 'which is the first response, still the newest thing on screen')
                .toBe('W/"v1"')
        })
    })

    // Adversarial review finding B. Three guards
    // handle a write's resolved value: `result == null` invalidates, and two
    // more both require `typeof result === 'object'`. A PRIMITIVE fails both
    // and reaches _queryIngest, where an unkeyed single payload with reconcile
    // set collapses the whole rows array to one element holding the primitive.
    // WF-965 exists for exactly this author mistake — its own message names a
    // status envelope — but cannot fire for the primitive shape.
    describe('a write confirmation that is not a record', () => {
        const ROWS2 = [{ id: 1, name: 'first' }, { id: 2, name: 'second' }]

        it('a primitive confirmation does not collapse the rows array', async () => {
            const q = uname('pc'); const c = uname('pcc')
            // The POST answers with a status envelope, which is what makes
            // `r.ok` resolve to the boolean rather than to undefined. A stub
            // serving rows to every URL would send the write down the
            // resolve-with-nothing path instead and never reach this defect.
            stubFetch((url) => url.indexOf('/fav') !== -1
                ? jsonResponse({ ok: true })
                : jsonResponse(ROWS2.map((r) => ({ ...r }))))

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/items',
                key: 'id',
                // Declared ON the operation: a query-level confirmation reaches
                // update and create only, so a named operation must carry its
                // own or none applies at all.
                to: {
                    favorite: {
                        url: '/api/items/:id/fav',
                        method: 'POST',
                        // The mistake: extracting a status flag, not the record.
                        confirmation: (r) => r.ok
                    }
                }
            })
            mountList(q, c)
            await settle()

            const store = wildflower.getStore(q)
            expect(store.rows.length, 'two rows loaded').toBe(2)

            await wildflower.getQuery(q).write('favorite', { id: 2, favorited: true }).catch(() => {})
            await settle()

            expect(store.rows.length, 'the row set survives a primitive confirmation').toBe(2)
            expect(store.rows[0].name, 'row zero is still a row').toBe('first')
            expect(store.rows[1].name, 'row one is still a row').toBe('second')
        })

        it('a primitive confirmation does not blank a record query', async () => {
            const q = uname('pcr'); const c = uname('pcrc')
            stubFetch((url) => url.indexOf('/ping') !== -1
                ? jsonResponse({ ok: true })
                : jsonResponse({ name: 'solo', status: 'open' }))

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/device',
                to: {
                    ping: {
                        url: '/api/device/ping',
                        method: 'POST',
                        confirmation: (r) => r.ok
                    }
                }
            })
            mountRecord(q, c)
            await settle()

            const store = wildflower.getStore(q)
            expect(store.rows[0].name, 'the record loaded').toBe('solo')

            await wildflower.getQuery(q).write('ping', { status: 'pinged' }).catch(() => {})
            await settle()

            expect(store.rows.length, 'still one record').toBe(1)
            expect(store.rows[0].name, 'the record was not replaced by the primitive').toBe('solo')
        })

        // CALIBRATION. A real record confirmation must still reconcile as
        // server truth on the fast path, with no refetch. A fix that routes
        // every confirmation to invalidate() would pass the vectors above and
        // silently delete the feature.
        it('a record confirmation still reconciles as server truth', async () => {
            const q = uname('cok'); const c = uname('cokc')
            let gets = 0
            stubFetch((url, n) => {
                if (calls[n - 1].url.indexOf('/fav') === -1) gets++
                return jsonResponse(ROWS2.map((r) => ({ ...r })))
            })

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/items',
                key: 'id',
                to: {
                    favorite: {
                        url: '/api/items/:id/fav',
                        method: 'POST',
                        confirmation: () => ({ id: 2, name: 'CONFIRMED' })
                    }
                }
            })
            mountList(q, c)
            await settle()
            const getsBefore = gets

            await wildflower.getQuery(q).write('favorite', { id: 2, favorited: true }).catch(() => {})
            await settle()

            const store = wildflower.getStore(q)
            expect(store.rows[1].name, 'the confirmed record was applied directly').toBe('CONFIRMED')
            expect(gets, 'and no refetch was needed').toBe(getsBefore)
        })
    })

    describe('a keyless write is an error, not a row-zero merge', () => {
        it('write() without the key field rejects and leaves rows untouched', async () => {
            const q = uname('kw'); const c = uname('kwc')
            stubFetch(() => jsonResponse([{ id: 1, name: 'first' }, { id: 2, name: 'second' }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/items',
                key: 'id',
                to: () => Promise.resolve()
            })
            mountList(q, c)
            await settle()

            const store = wildflower.getStore(q)
            expect(store.rows.length).toBe(2)

            let threw = null
            try {
                await wildflower.getQuery(q).write({ name: 'CLOBBER' })
            } catch (e) {
                threw = e
            }
            await settle()

            expect(threw, 'a keyless write must reject rather than silently target row zero').toBeTruthy()
            expect(String(threw.message || threw), 'the error names the problem').toMatch(/key/i)
            expect(store.rows[0].name, 'row zero was not modified').toBe('first')
            expect(store.rows[1].name, 'row one was not modified').toBe('second')
        })

        it('write() with the key field still works', async () => {
            const q = uname('kok'); const c = uname('kokc')
            stubFetch(() => jsonResponse([{ id: 1, name: 'first' }, { id: 2, name: 'second' }]))

            wildflower.component(c, { state: {} })
            wildflower.query(q, {
                from: '/api/items',
                key: 'id',
                // Resolve WITH the record so this takes the reconcile arm. A bare
                // resolve would take the refetch arm, and the stub above replays
                // the original rows, which would look like the write was lost.
                to: (item) => Promise.resolve(Object.assign({}, item))
            })
            mountList(q, c)
            await settle()

            await wildflower.getQuery(q).write({ id: 2, name: 'renamed' })
            await settle()

            const store = wildflower.getStore(q)
            expect(store.rows.find((r) => r.id === 2).name, 'keyed write merged into its own row').toBe('renamed')
            expect(store.rows.find((r) => r.id === 1).name, 'other rows untouched').toBe('first')
        })
    })
})
