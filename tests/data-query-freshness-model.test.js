/**
 * Model-based property suite for the freshness/read machinery (v1.5).
 * Read-side sibling of data-query-writes-model.test.js, whose architecture
 * this file inherits wholesale: held-fetch parking, engine-stamped park
 * ids, an independent runId bump mirror asserted in lockstep, an oracle
 * checked after EVERY event with the seed and event trace joined into
 * every assertion message. NO writes ride here — the combo tier in the
 * write-model file owns those crossings.
 *
 * A seeded random walk over the freshness surface: focus/reconnect/sse
 * rungs, conditional revalidation (304 vs 200 decided by If-None-Match
 * against a per-page mock server), stream lifecycle (pushes, invalidation
 * signals, transient errors, reopen catch-ups, dead-stream revival),
 * page moves with result-cache repaints, and the persist envelope — read
 * back from localStorage at every check, so validator hygiene (the
 * stream-save etag:null rule, the per-URL validator keying, the url/fp
 * stamps) is under standing randomized pressure.
 *
 * The oracle is deliberately a SECOND implementation of the declared
 * semantics. The rules it encodes (each verified against QuerySystem.js):
 *
 * - A fetch start with data present marks isStale; a conditional fetch
 *   carries the PER-URL stored validator (controller.etags), never
 *   another URL's.
 * - A release DELIVERS iff its engine-stamped park id is still the
 *   current run; a dropped delivery sets the missed-arrival debt, which
 *   only a later full delivery (200/304/stream push) clears — the read
 *   side has no write drain to spend it.
 * - A delivered 304 stamps lastSync, clears isStale/syncError, moves
 *   lastUrl, refreshes the snapshot AND re-saves the persist envelope
 *   with the LAST VALIDATOR pair (controller.etag/etagUrl) — which may
 *   name a different URL than the envelope's url stamp when the last
 *   200-with-ETag answered another page. The oracle models that exactly.
 * - A delivered 200 replaces rows, stores the new etag under its URL,
 *   and persists rows+etag+url+fp.
 * - A stream data push bumps runId (supersedes every held fetch),
 *   applies gently, advances lastSync, and persists with etag NULL (the
 *   cb7ccdec hygiene rule) under the unchanged lastUrl.
 * - A stream error after a first sync sets syncError/isStale and nothing
 *   else; an onopen after error clears syncError and parks one
 *   conditional catch-up (the hadError gate: a first open fetches
 *   nothing). A DEAD stream (readyState 2) revives only at the next
 *   fetch start, which closes the corpse and constructs a new
 *   EventSource — randomized pressure on the 8e9c1fd5 reopen condition.
 * - A fetch start whose URL differs from lastUrl repaints from the
 *   result cache when a snapshot exists: rows seed-ingest (no flag
 *   block, no persist save), isStale true.
 *
 * EXCLUSIONS, each deliberate (scope doc 2026-08-29):
 * - Poll timer: a poll tick is _queryFetch({conditional:true}) behind the
 *   lifecycle check — behaviorally identical to a focus firing, which the
 *   generator drives without timers. Declaring poll would add wall-clock
 *   nondeterminism for zero new coverage.
 * - fresh:N windows: the gate compares Date.now() - lastSync — wall
 *   clock, breaks seeded determinism. Directed tests (query-freshness)
 *   keep it.
 * - Teardown/re-activation cycles: the unobserved grace is a fixed ~5s
 *   with no knob; each cycle costs five real seconds. Directed tests
 *   cover restore-at-activation and the persist URL/fingerprint guards.
 * - Writes: the combo tier's job (deliverable 2).
 * - retry ladder: no retry: declared, so no failure answers ride here;
 *   the ladder keeps its directed suite (query-retry).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-dqfm-${++seq}`

async function settle(ms = 5) {
    await new Promise(r => setTimeout(r, ms))
}

// Deterministic PRNG (mulberry32) so every run of a seed is identical.
function rng(seed) {
    let a = seed >>> 0
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// Fake EventSource: the engine touches onmessage/onerror/onopen/close/
// readyState and nothing else. readyState stays undefined (healthy) until
// an event marks the instance dead — the engine's revival check is
// `readyState !== 2`, so undefined reads as alive, matching the fake in
// the directed sse suites.
class FakeEventSource {
    constructor(url) {
        this.url = url
        this.closed = false
        FakeEventSource.instances.push(this)
    }
    close() { this.closed = true }
}
FakeEventSource.instances = []

// Coverage tally across the fixed seeds: the final test asserts floors,
// so the generator can never silently stop exercising a class
// (vacuous-pass guard, write-model style).
const tally = { s200: 0, s304: 0, dropped: 0, pushes: 0, invalidations: 0, transients: 0, deaths: 0, revives: 0, repaints: 0, moves: 0 }

suite('data-query freshness — model-based interleavings', () => {
    let container
    let wildflower
    let realFetch
    let realEventSource
    const persistKeys = []

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
        while (persistKeys.length) { try { localStorage.removeItem(persistKeys.pop()) } catch { /* read-only storage */ } }
    })

    async function runSequence(seed) {
        const rand = rng(seed)
        const q = uname('q'); const c = uname('c')
        persistKeys.push('wf:query:' + q)

        // The simulated server: TWO pages, each its own resource with its
        // own rows and its own validator (the scope's single-resource
        // sketch, strengthened so the per-URL machinery — etags keyed by
        // URL, the result cache, the persist URL stamp — answers against
        // genuinely distinct content). Content-change events mutate one
        // page's rows AND rotate that page's etag; the fetch mock answers
        // 304 iff the If-None-Match it captured at park time equals the
        // target page's etag at RELEASE time, else 200 with the current
        // rows and an ETag header.
        const mkRows = (ids) => ids.map(id => ({ id, alpha: 'a' + id, beta: 'b' + id }))
        const server = {
            1: { rows: mkRows([1, 2, 3]), etag: 'e1-0' },
            2: { rows: mkRows([11, 12, 13]), etag: 'e2-0' }
        }
        let stamp = 0
        let rowSeq = 100
        const pageState = { page: 1 }
        const pageUrl = (p) => '/api/items?page=' + p
        const pageOf = (url) => (url.indexOf('page=2') >= 0 ? 2 : 1)
        const cp = (rows) => rows.map(r => Object.assign({}, r))
        // One server-side change: add a row, remove a row, or mutate a
        // field — and rotate the page's validator either way.
        const mutateServer = (p) => {
            const pg = server[p]
            const r2 = rand()
            if (r2 < 0.2 && pg.rows.length < 6) {
                const id = ++rowSeq
                pg.rows.push({ id, alpha: 'a' + id, beta: 'b' + id })
                trace.push(`C:p${p}+${id}`)
            } else if (r2 < 0.35 && pg.rows.length > 1) {
                const i = Math.floor(rand() * pg.rows.length)
                trace.push(`C:p${p}-${pg.rows[i].id}`)
                pg.rows.splice(i, 1)
            } else {
                const row = pg.rows[Math.floor(rand() * pg.rows.length)]
                const f = rand() < 0.5 ? 'alpha' : 'beta'
                row[f] = 'x' + (++stamp)
                trace.push(`C:p${p}.${row.id}.${f}`)
            }
            pg.etag = 'e' + p + '-' + (++stamp)
        }

        let vCounter = 0
        let controller = null   // assigned after activation; the mock reads it lazily (TDZ note in the scope)
        const held = []   // {id, url, page, inm, released, release()}
        // Each parked fetch is stamped with the ENGINE's runId at park time
        // — _queryFetch bumped it just before calling fetch, so that IS the
        // id the response guard will compare — while vCounter remains the
        // harness's independent bump-for-bump mirror (fetch starts here,
        // stream pushes at the push event), asserted in lockstep at every
        // check (the write model's seed-1234 lesson).
        window.fetch = (url, init) => new Promise((res) => {
            ++vCounter
            const rec = {
                id: controller ? controller.runId : vCounter,
                url,
                page: pageOf(url),
                inm: init && init.headers ? init.headers['If-None-Match'] : undefined,
                released: false
            }
            rec.release = () => {
                rec.released = true
                const pg = server[rec.page]
                if (rec.inm !== undefined && rec.inm === pg.etag) {
                    res(new Response(null, { status: 304 }))
                } else {
                    res(new Response(JSON.stringify(pg.rows), {
                        status: 200, headers: { ETag: pg.etag }
                    }))
                }
            }
            held.push(rec)
        })
        const unreleased = () => held.filter(r => !r.released)

        wildflower.query(q, {
            from: '/api/items', key: 'id',
            params: () => ({ page: pageState.page }),
            refresh: ['focus', 'reconnect', 'sse'],
            stream: '/api/stream',
            persist: true
        })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row">
                    <span class="fa" data-bind="alpha"></span>
                    <span class="fb" data-bind="beta"></span>
                </li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(30)
        held[0].release()   // the activation fetch (unconditional, page 1): first load lands
        await settle(30)

        const h = wildflower.getQuery(q)
        controller = wildflower._queryControllers.get(q)
        expect(h.lastSync, `first load landed: seed ${seed}`).not.toBe(null)
        expect(FakeEventSource.instances.length, `activation opened one stream: seed ${seed}`).toBe(1)

        const trace = []
        const promises = []

        // The oracle: expected rows, the per-URL validator map, the "last
        // validator" pair persistence reads, the on-screen URL, the result
        // cache mirror, and the last save-eligible persist envelope.
        const oracle = {
            rows: cp(server[1].rows),
            etags: { [pageUrl(1)]: server[1].etag },
            etag: server[1].etag,
            etagUrl: pageUrl(1),
            lastUrl: pageUrl(1),
            snapshots: new Map([[pageUrl(1), cp(server[1].rows)]]),
            saved: { rows: cp(server[1].rows), etag: server[1].etag, etagUrl: pageUrl(1), url: pageUrl(1) }
        }
        const flags = { stale: false, syncErr: false, advanced: false, missed: false }
        let prevLastSync = h.lastSync
        let parkedTotal = 1        // the activation fetch
        let esCount = 1            // FakeEventSource instances so far
        let es = { dead: false, hadError: false }   // the CURRENT instance's mirror
        let fpSeen = null

        const check = async (label) => {
            await settle(20)
            const ctx = `seed ${seed}, after ${label}\ntrace: ${trace.join(' | ')}`
            // Rows: replace-mode deliveries land verbatim, so ORDER is part
            // of the contract, not just membership.
            expect(h.rows.length, `row count: ${ctx}`).toBe(oracle.rows.length)
            for (let i = 0; i < oracle.rows.length; i++) {
                const exp = oracle.rows[i]
                const act = h.rows[i]
                expect(act && act.id, `row ${i} id: ${ctx}`).toBe(exp.id)
                expect(act.alpha, `row ${i} alpha: ${ctx}`).toBe(exp.alpha)
                expect(act.beta, `row ${i} beta: ${ctx}`).toBe(exp.beta)
            }
            const domRows = [...container.querySelectorAll('.row')]
            expect(domRows.length, `dom row count: ${ctx}`).toBe(oracle.rows.length)
            for (let i = 0; i < domRows.length; i++) {
                expect(domRows[i].querySelector('.fa').textContent, `dom alpha of row ${i}: ${ctx}`).toBe(String(oracle.rows[i].alpha))
                expect(domRows[i].querySelector('.fb').textContent, `dom beta of row ${i}: ${ctx}`).toBe(String(oracle.rows[i].beta))
            }
            // Flag truthfulness at every step. isLoading stays false for
            // the whole run (data present throughout); error stays null
            // (the mock never fails a request).
            expect(h.isLoading, `isLoading: ${ctx}`).toBe(false)
            expect(h.error, `error: ${ctx}`).toBe(null)
            expect(h.isStale, `isStale: ${ctx}`).toBe(flags.stale)
            if (flags.syncErr) expect(h.syncError, `syncError truthy: ${ctx}`).toBeTruthy()
            else expect(h.syncError, `syncError null: ${ctx}`).toBe(null)
            if (flags.advanced) expect(h.lastSync, `lastSync advanced: ${ctx}`).toBeGreaterThan(prevLastSync)
            else expect(h.lastSync, `lastSync unchanged: ${ctx}`).toBe(prevLastSync)
            prevLastSync = h.lastSync
            flags.advanced = false
            // The runId mirror holds bump-for-bump; a bump the engine
            // drops or invents diverges here.
            expect(controller.runId, `runId mirror: ${ctx}`).toBe(vCounter)
            expect(held.length, `no spurious fetches: ${ctx}`).toBe(parkedTotal)
            expect(!!controller.missedArrival, `missedArrival: ${ctx}`).toBe(flags.missed)
            expect(controller.active, `active: ${ctx}`).toBe(true)
            // Read-only walk: the write bookkeeping must never move.
            expect(h.pendingWrites, `pendingWrites: ${ctx}`).toBe(0)
            expect(controller.pendingWrites, `controller pendingWrites: ${ctx}`).toBe(0)
            expect(controller.inflightWrites.size, `inflightWrites: ${ctx}`).toBe(0)
            expect(controller.fieldClaims.size, `fieldClaims: ${ctx}`).toBe(0)
            expect(controller.rowClaims.size, `rowClaims: ${ctx}`).toBe(0)
            expect(controller.keyAliases.size, `keyAliases: ${ctx}`).toBe(0)
            expect(!!controller.deferredConfirm, `deferredConfirm: ${ctx}`).toBe(false)
            // Validator bookkeeping, keyed per URL.
            expect(controller.etag, `last validator: ${ctx}`).toBe(oracle.etag)
            expect(controller.etagUrl, `last validator url: ${ctx}`).toBe(oracle.etagUrl)
            expect(controller.etags || {}, `per-url validators: ${ctx}`).toEqual(oracle.etags)
            expect(controller.lastUrl, `lastUrl: ${ctx}`).toBe(oracle.lastUrl)
            // Result cache mirror: keys and rows.
            const snaps = controller.snapshots || new Map()
            expect([...snaps.keys()].sort(), `snapshot urls: ${ctx}`).toEqual([...oracle.snapshots.keys()].sort())
            for (const [u, rows] of oracle.snapshots) {
                expect(snaps.get(u), `snapshot rows for ${u}: ${ctx}`).toEqual(rows)
            }
            // Stream lifecycle: instance count and closed states. Every
            // superseded instance is closed; the current one is open even
            // while dead (the engine closes a corpse only at revival).
            expect(FakeEventSource.instances.length, `stream instances: ${ctx}`).toBe(esCount)
            for (let i = 0; i < esCount - 1; i++) {
                expect(FakeEventSource.instances[i].closed, `stream ${i} closed: ${ctx}`).toBe(true)
            }
            expect(FakeEventSource.instances[esCount - 1].closed, `current stream open: ${ctx}`).toBe(false)
            // The persist envelope, read from disk at every check: rows of
            // the last SAVE-ELIGIBLE delivery (cache repaints never save),
            // etag null iff that save was stream-sourced, the url and fp
            // stamps of e352e509 / a4b8c996.
            const env = JSON.parse(localStorage.getItem('wf:query:' + q))
            expect(env && env.v, `envelope version: ${ctx}`).toBe(1)
            expect(env.rows, `envelope rows: ${ctx}`).toEqual(oracle.saved.rows)
            expect(env.etag, `envelope etag: ${ctx}`).toBe(oracle.saved.etag)
            expect(env.etagUrl, `envelope etagUrl: ${ctx}`).toBe(oracle.saved.etagUrl)
            expect(env.url, `envelope url: ${ctx}`).toBe(oracle.saved.url)
            expect(typeof env.fp, `envelope fp present: ${ctx}`).toBe('number')
            if (fpSeen === null) fpSeen = env.fp
            else expect(env.fp, `envelope fp stable: ${ctx}`).toBe(fpSeen)
            expect(typeof env.savedAt, `envelope savedAt: ${ctx}`).toBe('number')
        }

        // A fetch-starting event: fire it, then assert exactly one fetch
        // parked for the CURRENT page's URL carrying the per-URL validator
        // (conditional) or none (unconditional), model the fetch-start
        // transitions (isStale, the cache repaint), and handle dead-stream
        // revival — _querySyncStream runs beside every fetch start, closes
        // a readyState-2 corpse, and constructs a new EventSource.
        const startFetch = (label, conditional, fire) => {
            const wasDead = es.dead
            const before = held.length
            fire()
            const ctx = `seed ${seed}, at ${label}\ntrace: ${trace.join(' | ')}`
            if (wasDead) {
                expect(FakeEventSource.instances.length, `dead stream revived: ${ctx}`).toBe(esCount + 1)
                expect(FakeEventSource.instances[esCount - 1].closed, `corpse closed at revival: ${ctx}`).toBe(true)
                esCount++
                es = { dead: false, hadError: false }
                tally.revives++
            } else {
                expect(FakeEventSource.instances.length, `no spurious stream: ${ctx}`).toBe(esCount)
            }
            expect(held.length, `one fetch parked: ${ctx}`).toBe(before + 1)
            const rec = held[held.length - 1]
            const url = pageUrl(pageState.page)
            expect(rec.url, `parked url: ${ctx}`).toBe(url)
            expect(rec.inm, `parked If-None-Match: ${ctx}`).toBe(conditional ? oracle.etags[url] : undefined)
            parkedTotal++
            flags.stale = true   // fetch-start transition (data present)
            // Result-cache repaint: a URL other than the one on screen,
            // seen before — rows seed-ingest before the request departs.
            if (url !== oracle.lastUrl && oracle.snapshots.has(url)) {
                oracle.rows = cp(oracle.snapshots.get(url))
                tally.repaints++
            }
        }

        // A release DELIVERS iff its fetch is still the current run; a
        // delivering release answers 304 or 200 per the If-None-Match rule.
        const releaseOne = () => {
            const open = unreleased()
            // Biased toward the NEWEST parked fetch: only the current run
            // can deliver, so uniform picking starves the delivered-304
            // class (one hit across ten seeds before the bias) while drops
            // stay abundant either way.
            const rec = rand() < 0.65
                ? open[open.length - 1]
                : open[Math.floor(rand() * open.length)]
            const delivers = rec.id === controller.runId
            const pg = server[rec.page]
            const is304 = rec.inm !== undefined && rec.inm === pg.etag
            rec.release()
            if (!delivers) {
                tally.dropped++
                trace.push(`A${rec.id}✗dropped`)
                flags.missed = true
            } else if (is304) {
                tally.s304++
                trace.push(`A${rec.id}✓304`)
                // Rows confirmed as-is; the snapshot and the envelope both
                // refresh. The envelope's validator pair is the LAST 200's
                // (controller.etag/etagUrl), not necessarily this URL's.
                flags.stale = false; flags.syncErr = false
                flags.advanced = true; flags.missed = false
                oracle.lastUrl = rec.url
                oracle.snapshots.set(rec.url, cp(oracle.rows))
                oracle.saved = { rows: cp(oracle.rows), etag: oracle.etag, etagUrl: oracle.etagUrl, url: rec.url }
            } else {
                tally.s200++
                trace.push(`A${rec.id}✓200`)
                const rows = cp(pg.rows)
                oracle.rows = cp(rows)
                oracle.etags[rec.url] = pg.etag
                oracle.etag = pg.etag
                oracle.etagUrl = rec.url
                oracle.lastUrl = rec.url
                oracle.snapshots.set(rec.url, cp(rows))
                oracle.saved = { rows: cp(rows), etag: pg.etag, etagUrl: rec.url, url: rec.url }
                flags.stale = false; flags.syncErr = false
                flags.advanced = true; flags.missed = false
            }
            return trace[trace.length - 1]
        }

        const EVENTS = 26
        for (let ev = 0; ev < EVENTS; ev++) {
            const roll = rand()
            const canRelease = unreleased().length > 0
            // Stream events fire only on a plausible instance: a dead ES
            // emits nothing, and a real one that errored fires onopen
            // before any further message — so push/invalidate require a
            // healthy mirror, reopen requires a prior error.
            const healthy = !es.dead && !es.hadError
            if (roll < 0.10) {
                // Pure server-side change: no engine interaction, no flags.
                mutateServer(rand() < 0.5 ? 1 : 2)
                await check(`content ${trace[trace.length - 1]}`)
                continue
            }
            if (roll < 0.34 && canRelease) {
                const l = releaseOne()
                await check(`release ${l}`)
                continue
            }
            if (roll < 0.39) {
                trace.push('F')
                startFetch('focus', true, () => window.dispatchEvent(new Event('focus')))
                await check('focus')
                continue
            }
            if (roll < 0.44) {
                trace.push('N')
                startFetch('reconnect', true, () => window.dispatchEvent(new Event('online')))
                await check('reconnect')
                continue
            }
            if (roll < 0.53 && healthy) {
                // The stream covers the resource the reads last fetched
                // ("the stream follows the reads"), which is also the URL
                // scope the engine's stream-save comment claims for the
                // envelope: mutate that page, push its new rows.
                const p = pageOf(oracle.lastUrl)
                mutateServer(p)
                const pushed = cp(server[p].rows)
                vCounter++   // mirror the push's runId bump (supersedes every held fetch)
                FakeEventSource.instances[esCount - 1].onmessage({ data: JSON.stringify(pushed) })
                tally.pushes++
                trace.push(`P:p${p}`)
                oracle.rows = cp(pushed)
                // Stream save: etag NULL (cb7ccdec), url = lastUrl (a push
                // moves no URL).
                oracle.saved = { rows: cp(pushed), etag: null, etagUrl: null, url: oracle.lastUrl }
                flags.stale = false; flags.syncErr = false
                flags.advanced = true; flags.missed = false
                await check(`sse_push ${trace[trace.length - 1]}`)
                continue
            }
            if (roll < 0.58 && healthy) {
                trace.push('SI')
                tally.invalidations++
                startFetch('sse_invalidate', true, () => FakeEventSource.instances[esCount - 1].onmessage({ data: '' }))
                await check('sse_invalidate')
                continue
            }
            if (roll < 0.63 && !es.dead) {
                // Transient stream error: syncError + isStale, rows kept,
                // the browser owns reconnection. Repeats are legal (each
                // failed reconnect attempt fires onerror again).
                FakeEventSource.instances[esCount - 1].onerror()
                es.hadError = true
                flags.syncErr = true; flags.stale = true
                tally.transients++
                trace.push('E~')
                await check('sse_error_transient')
                continue
            }
            if (roll < 0.68 && !es.dead && es.hadError) {
                // Reopen after error: syncError clears, one conditional
                // catch-up parks (the hadError gate).
                es.hadError = false
                flags.syncErr = false
                trace.push('O')
                startFetch('sse_reopen', true, () => FakeEventSource.instances[esCount - 1].onopen())
                await check('sse_reopen')
                continue
            }
            if (roll < 0.73 && !es.dead) {
                // Platform-permanent failure: readyState 2, no
                // auto-reconnect. The corpse stays installed until the
                // next fetch start revives it.
                const inst = FakeEventSource.instances[esCount - 1]
                inst.readyState = 2
                inst.onerror()
                es.dead = true; es.hadError = true
                flags.syncErr = true; flags.stale = true
                tally.deaths++
                trace.push('E✗dead')
                await check('sse_dead')
                continue
            }
            if (roll < 0.83) {
                pageState.page = pageState.page === 1 ? 2 : 1
                tally.moves++
                trace.push(`M:p${pageState.page}`)
                startFetch('page_move', false, () => { promises.push(h.refresh().catch(() => {})) })
                await check(`page_move ${trace[trace.length - 1]}`)
                continue
            }
            if (roll < 0.92) {
                trace.push('INV')
                startFetch('invalidate_call', true, () => { promises.push(h.invalidate().catch(() => {})) })
                await check('invalidate_call')
                continue
            }
            trace.push('REF')
            startFetch('refresh_call', false, () => { promises.push(h.refresh().catch(() => {})) })
            await check('refresh_call')
        }
        // Drain: release every held fetch, checking each. The walk may
        // legitimately end with missed-arrival debt standing (the read
        // side spends it only on the next delivery) — the mirror says so
        // truthfully either way.
        while (unreleased().length > 0) {
            const l = releaseOne()
            await check(`drain ${l}`)
        }
        await Promise.all(promises)
        expect(controller.runId, `runId drained: seed ${seed}`).toBe(vCounter)
    }

    // A fixed spread of seeds: deterministic in CI, wide enough that the
    // tallies clear their floors with margin.
    for (const seed of [3, 17, 71, 439, 2027, 65537, 90001, 424243, 1299709, 7654321]) {
        it(`random freshness walk holds the read-side model (seed ${seed})`, async () => {
            await runSequence(seed)
        })
    }

    // Vacuous-pass guard: with fixed seeds the event mix is deterministic,
    // so these floors fail loudly if a generator change ever stops
    // exercising a class.
    it('the freshness generator exercised every class', () => {
        expect(tally.s200, '200s delivered').toBeGreaterThanOrEqual(15)
        expect(tally.s304, '304s delivered').toBeGreaterThanOrEqual(6)
        expect(tally.dropped, 'deliveries dropped by supersession').toBeGreaterThanOrEqual(40)
        expect(tally.pushes, 'stream pushes').toBeGreaterThanOrEqual(10)
        expect(tally.invalidations, 'stream invalidations').toBeGreaterThanOrEqual(6)
        expect(tally.transients, 'transient stream errors').toBeGreaterThanOrEqual(15)
        expect(tally.deaths, 'stream deaths').toBeGreaterThanOrEqual(12)
        expect(tally.revives, 'dead-stream reopens').toBeGreaterThanOrEqual(12)
        expect(tally.repaints, 'cache repaints').toBeGreaterThanOrEqual(10)
    })
})
