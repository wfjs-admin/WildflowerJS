/**
 * Model-based property suite for declarative writes (v1.5).
 *
 * Seeded random sequences of overlapping partial writes settle in random
 * order (resolve-with-server-record or reject), and after EVERY event the
 * query's rows AND the rendered DOM are checked against an independent
 * oracle that models the declared semantics:
 *
 * - optimistic apply field-merges; later write to a field owns it
 * - reject reverts a field to what the most recent still-pending earlier
 *   writer wrote (or the base value), never touching later-owned fields
 * - resolve applies the server record EXCEPT fields other in-flight
 *   writes still claim (claim-honored confirm)
 * - the server's record is its base row merged with the write's partial
 *
 * The oracle is deliberately a SECOND implementation of the semantics
 * (per-field overlay stacks), so agreement is meaningful. On failure the
 * seed and event trace print for exact reproduction.
 *
 * Settle rules the stacks encode: an owner's REJECT removes only its own
 * overlay, so an earlier still-pending writer's value resurfaces (the
 * hand-back). A CONFIRM merges the record into the base and removes the
 * confirmer AND every entry below it on the fields it wrote — earlier
 * writers are permanently dispossessed of those fields; a superseded
 * value never resurfaces after a later confirm. Entries above the
 * confirmer stay (the claim-honored confirm).
 *
 * Three further dimensions ride every check (hardening investigation B):
 *
 * - FLAG TRUTHFULNESS: the oracle predicts isLoading/isStale/syncError/
 *   lastSync per event. Staleness is set by optimistic applies and
 *   rollback re-applies; it clears only when a confirming sync lands
 *   with NOTHING pending — a confirm (reconcile, full sync, or 304)
 *   arriving while other writes pend is DEFERRED and lands when the
 *   last pending write settles (the writes-suite test-15 semantics).
 *   syncError is set by rejections and cleared only by a confirming
 *   sync landing with nothing pending. lastSync advances exactly when
 *   confirmed flags land.
 * - BOOKKEEPING BOUNDS: fieldClaims (sizes AND owners, matched against
 *   the oracle's overlay stacks), inflightWrites, pendingWrites,
 *   rowClaims, and keyAliases are asserted at EVERY check, not just
 *   drained at the end (the Apollo-#5706 sustained-use lesson).
 * - DERIVED READS: a sync computed and an async computed digest the
 *   rows; both are asserted against f(expectedRows) each check, so
 *   read-side propagation rides every interleaving.
 *
 * HELD ARRIVALS (the canary-find-#2 widening): fetches park in a held
 * queue and release on their own generator events, so writes, settles,
 * and further syncs interleave with arrivals IN FLIGHT. The harness
 * mirrors the engine's runId bumps — every fetch start, every write
 * issue, and every CONFIRMED settle (survey ruling #3: the settle is a
 * call, so a read in flight across it carries pre-write server state
 * and is dropped; rejections change nothing on the server and bump
 * nothing) — so it knows deterministically whether each release
 * delivers or is dropped by supersession; a drop sets the
 * missed-arrival debt, asserted against the controller every check,
 * and the write drain that spends it (spawning a catch-up fetch, which
 * joins the held queue) is part of the flag model.
 *
 * A THIRD generator (runComboSequence, the combo tier) rides the same
 * keyed semantics with the freshness event set from
 * data-query-freshness-model.test.js — conditional 304s, stream pushes/
 * invalidations/errors/deaths, focus and reconnect — and a persist
 * envelope read back from disk every check. Its own seeds, its own
 * tally: keyed/record seed failures stay attributable.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-dqwm-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

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

const ROW_IDS = [1, 2, 3]
const FIELDS = ['alpha', 'beta']
// Coverage tally across the fixed keyed seeds: the final test asserts
// floors, so the held-arrival machinery can never silently stop being
// exercised by a generator regression (vacuous-pass guard).
const tally = { begins: 0, delivered: 0, dropped: 0, catchups: 0, deleted: 0, deleteConfirmed: 0, deleteRejected: 0 }
// The engine's claim-key separator (QuerySystem CLAIM_SEP). Constructed,
// never escaped: a literal NUL escape would corrupt the file.
const CLAIM_SEP = String.fromCharCode(0)

// Fake EventSource for the combo tier: the engine touches onmessage/
// onerror/onopen/close/readyState and nothing else. readyState stays
// undefined (healthy) until an event marks the instance dead — the
// engine's revival check is `readyState !== 2`, so undefined reads as
// alive, matching the fake in the directed sse suites.
class FakeEventSource {
    constructor(url) {
        this.url = url
        this.closed = false
        FakeEventSource.instances.push(this)
    }
    close() { this.closed = true }
}
FakeEventSource.instances = []

// Combo-tier coverage tally (its own block, so keyed/record floor
// failures stay attributable to their own generators).
const comboTally = {
    s200: 0, s304: 0, deferred304: 0, dropped: 0,
    pushes: 0, pushesDeferred: 0, invalidations: 0,
    transients: 0, deaths: 0, revives: 0, catchups: 0,
    drainConfirmSaves: 0, rejectDrainSaves: 0, rejectDrainSavesStream: 0
}

/**
 * Oracle: per row+field, a base value plus an ordered list of pending
 * overlays (writeId, value). Visible value = last overlay or base.
 * - write: push overlay per field; server base NOT touched.
 * - reject: remove that write's overlays; visible value falls out naturally.
 * - resolve: server base row merges the write's partial; the resolved
 *   record (new base) becomes the visible base; the write's overlays are
 *   removed; fields with remaining overlays stay overlay-valued (claim
 *   honor falls out naturally: base updates, overlays sit on top).
 */
class Oracle {
    constructor(rows) {
        this.base = new Map()          // id -> {field: value}
        this.overlays = new Map()      // id -> {field: [{w, v}...]}
        // Row existence (DELETE only — see the header note on scope: a
        // pending create changing an existing write's classification
        // mid-flight is a separate, deeper interaction deliberately not
        // modeled here). `alive` is what checks iterate; `base`/
        // `overlays` keep updating underneath a dead row exactly as they
        // would for a live one — the engine's "arrival refresh keeps
        // pre-images current" is automatic in this stack model, since
        // there is no separate frozen snapshot to refresh.
        this.alive = new Set()
        // ORDER (added 2026-08-30). `alive` answers WHICH rows show; `order`
        // answers in what sequence, which the set cannot express and which the
        // engine's rejected-delete restore is defined in terms of. Stated here
        // as an independent second implementation, exactly like the overlay
        // stacks: never read back from the engine.
        //
        // The rules this encodes:
        //   - seed and every full server arrival: payload order
        //   - a delete removes the row and REMEMBERS where it was
        //   - a rejected delete puts it back at that index, clamped
        //   - an arrival mid-flight re-reads the remembered index out of the
        //     payload, because the payload is a newer order and the row is
        //     still in it (the claim hides it from view, it is not dropped)
        this.order = []
        this.deletePos = new Map()     // id -> index remembered at delete time
        // Rows introduced optimistically that the server has not answered for.
        // A confirm from any write clears the debt; the last rejection with no
        // claimant left removes the row.
        this.unacked = new Set()
        this.rowClaims = new Map()     // id -> {w, kind: 'delete'}
        for (const r of rows) {
            this.base.set(r.id, Object.assign({}, r))
            this.overlays.set(r.id, {})
            this.alive.add(r.id)
            this.order.push(r.id)
        }
    }
    // Ordered ids of the rows currently on screen.
    orderedAlive() { return this.order.filter(id => this.alive.has(id)) }
    // `order` can also hold ids hidden by OTHER pending deletes, so a remembered
    // index (which counts live rows) has to be translated into a slot in it.
    slotForLiveIndex(arr, liveIndex) {
        let live = 0
        for (let i = 0; i < arr.length; i++) {
            if (live === liveIndex) return i
            if (this.alive.has(arr[i])) live++
        }
        return arr.length
    }
    write(w, id, partial) {
        const o = this.overlays.get(id)
        for (const f of Object.keys(partial)) {
            if (f === 'id') continue
            if (!o[f]) o[f] = []
            o[f].push({ w, v: partial[f] })
        }
    }
    settle(w, id, rejected, serverRecord) {
        const o = this.overlays.get(id)
        if (!rejected) {
            // Any confirm answers for the row's existence, paying an
            // unacknowledged-create debt it may have inherited.
            this.unacked.delete(id)
            const b = this.base.get(id)
            for (const f of Object.keys(serverRecord)) {
                if (f !== 'id') b[f] = serverRecord[f]
            }
            for (const f of Object.keys(o)) {
                if (!o[f].some(e => e.w === w)) continue // fields I never wrote keep their stacks
                o[f] = o[f].filter(e => e.w > w)         // dispossess me and everyone below
                if (o[f].length === 0) delete o[f]
            }
        } else {
            for (const f of Object.keys(o)) {
                o[f] = o[f].filter(e => e.w !== w)
                if (o[f].length === 0) delete o[f]
            }
            // Inherited create debt: the row exists only because an optimistic
            // create put it there, that create was refused, and this write held
            // it up by claiming fields. With this rejection, nobody is left who
            // could make the server answer for it, so it goes.
            if (this.unacked.has(id)) {
                let stillClaimed = false
                for (const f of Object.keys(o)) {
                    if (o[f] && o[f].length) { stillClaimed = true; break }
                }
                if (!stillClaimed) {
                    this.unacked.delete(id)
                    this.alive.delete(id)
                    this.order = this.order.filter(x => x !== id)
                    this.base.delete(id)
                    this.overlays.delete(id)
                }
            }
        }
    }
    // Out-of-band arrival: server truth replaces the base; pending
    // overlays stand (claim-honored arrival), and the implementation's
    // rollback targets refresh so full unwinds land here.
    serverSync(rows) {
        for (const r of rows) {
            this.base.set(r.id, Object.assign({}, r))
            // A row the client has never seen becomes visible on arrival. The
            // one exception is a row a pending delete owns: that claim holds
            // its absence against arrivals, which is why the engine keeps it
            // off screen even though the payload still carries it.
            if (!this.overlays.has(r.id)) this.overlays.set(r.id, {})
            if (!this.alive.has(r.id) && !this.rowClaims.has(r.id)) this.alive.add(r.id)
        }
        // A full arrival is a newer row ORDER, so it replaces ours. It also
        // refreshes the remembered index of any pending delete, since the
        // payload still carries that row: the engine reads position out of
        // `arrived` in the same block that refreshes field pre-images.
        this.order = rows.map(r => r.id)
        // A row a pending CREATE owns survives an arrival that omits it: the
        // server does not know it yet, so it has no opinion on where it sits,
        // and the engine appends it (QuerySystem's rowClaims create branch).
        for (const [cid, rc] of this.rowClaims) {
            if (rc.kind === 'create' && !this.order.includes(cid)) this.order.push(cid)
        }
        for (const id of this.deletePos.keys()) {
            const at = this.order.indexOf(id)
            if (at >= 0) this.deletePos.set(id, at)
        }
    }
    expectedRow(id) {
        const out = Object.assign({}, this.base.get(id))
        const o = this.overlays.get(id)
        for (const f of Object.keys(o)) out[f] = o[f][o[f].length - 1].v
        return out
    }
    // Tombstone delete: claims its own field like any written field
    // (the engine claims every field in the write payload, including
    // the declared deleted: field itself), takes a row-existence claim,
    // and removes the row from view immediately. rowClaims uses
    // overwrite-by-key semantics matching the engine — a later claim
    // on the same id (out of this widening's scope) would replace this
    // entry entirely, which is exactly why creates are excluded above.
    delete(w, id) {
        this.write(w, id, { gone: true })
        this.rowClaims.set(id, { w, kind: 'delete' })
        // Remember the slot before hiding the row. The index is taken against
        // the rows on screen, which is what the engine captures too.
        this.deletePos.set(id, this.orderedAlive().indexOf(id))
        this.alive.delete(id)
    }
    // CREATE, restricted form (2026-08-30): the client chooses the key and the
    // server confirms that same key. A server-ASSIGNED key, which renames the
    // row mid-flight and exercises keyAliases, is the deeper interaction the
    // header excludes and stays excluded — this suite asserts keyAliases stays
    // empty at every check.
    create(w, id, fields) {
        this.base.set(id, { id })
        this.overlays.set(id, {})
        this.write(w, id, fields)
        this.rowClaims.set(id, { w, kind: 'create' })
        this.unacked.add(id)       // the server has not answered for it yet
        this.alive.add(id)
        this.order.push(id)        // an optimistic create appends
    }
    settleCreate(w, id, rejected, record) {
        const rc = this.rowClaims.get(id)
        if (rc && rc.w === w) this.rowClaims.delete(id)
        if (rejected) {
            // The row's existence was this write's doing, so it goes away —
            // UNLESS a later write claimed fields on it, in which case that
            // write INHERITS responsibility and its own settle decides.
            //
            // Derived, not copied. The first version of this rule was read
            // straight out of the engine, and the engine was wrong: it handed
            // ownership to a write with no removal semantics, so both writes
            // rejecting left a row the server never created sitting on screen
            // (data-query-orphan-create-probe). The rule that survives scrutiny
            // is about ACKNOWLEDGEMENT: a row introduced optimistically stays
            // only while some write can still make the server answer for it.
            // Any confirm pays the debt; the last rejection removes the row.
            const o = this.overlays.get(id) || {}
            let claimedByOther = false
            for (const f of Object.keys(o)) {
                const st = o[f]
                for (const e of st) if (e.w !== w) { claimedByOther = true; break }
                if (claimedByOther) break
            }
            if (claimedByOther) {
                // Keep the row, and keep the debt: whoever settles last owes
                // its removal unless somebody confirms first.
                this.unacked.add(id)
                this.settle(w, id, true, null)
            } else {
                this.unacked.delete(id)
                this.alive.delete(id)
                this.order = this.order.filter(x => x !== id)
                this.base.delete(id)
                this.overlays.delete(id)
            }
        } else {
            this.unacked.delete(id)   // confirmed: the server answered for it
            this.settle(w, id, false, record)
        }
    }
    settleDelete(w, id, rejected) {
        const rc = this.rowClaims.get(id)
        if (rc && rc.w === w) this.rowClaims.delete(id)
        if (rejected) {
            // alpha/beta were never touched by the delete itself (only
            // 'gone' was), so they are already current — including any
            // arrival that landed while the delete was pending. Un-hide
            // the row and let the normal reject path drop the 'gone'
            // overlay.
            this.settle(w, id, true, null)
            this.alive.add(id)
            // Back to the remembered slot, clamped: rows may have left while
            // the delete was in flight. `order` still holds the id (only
            // `alive` hid it), so re-place rather than merely re-admit.
            const at = this.deletePos.get(id)
            this.deletePos.delete(id)
            if (at !== undefined && at >= 0) {
                const without = this.order.filter(x => x !== id)
                without.splice(this.slotForLiveIndex(without, at), 0, id)
                this.order = without
            }
        } else {
            // This harness always confirms a delete by resolving null
            // (the documented idiom: "the query invalidates instead").
            // That path never merges a record into base, so pass an
            // empty one — settle() then only releases this write's own
            // 'gone' claim, touching nothing else.
            this.settle(w, id, false, {})
            // Confirmed: the row stays gone, so its remembered slot has
            // nothing left to restore (mirrors the engine dropping it on the
            // resolve path).
            this.deletePos.delete(id)
        }
    }
}

suite('data-query writes — model-based interleavings', () => {
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
        // The combo tier's fixtures; no-ops for the keyed/record
        // generators, which declare no sse rung and no persist.
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
        const initial = ROW_IDS.map(id => ({ id, alpha: 'a' + id, beta: 'b' + id }))

        // The simulated server: canonical rows; save merges and returns the
        // record. Settlement order is driven by the sequence, not timers.
        //
        // Fetches are HELD: every fetch parks in `held` until a
        // release_sync event lets it answer (with the server's rows AT
        // RELEASE time). vCounter mirrors the engine's runId bumps —
        // every fetch start, every write(), and every CONFIRMED settle
        // — so the harness knows deterministically whether a given
        // release DELIVERS (its id is still current) or is DROPPED by
        // the supersession guard (a write, a newer fetch, or a settle
        // bumped past it), including the catch-up fetches the engine
        // spawns at a write drain after a miss.
        const serverRows = new Map(initial.map(r => [r.id, Object.assign({}, r)]))
        let vCounter = 0
        let controller = null   // assigned after activation; the mock reads it lazily
        const held = []   // {id, released, release()}
        // Each parked fetch is stamped with the ENGINE's runId at park time
        // — _queryFetch bumped it just before calling fetch, so that IS the
        // id the response guard will compare — while vCounter remains the
        // harness's independent bump-for-bump mirror, asserted in lockstep
        // at every check. A settle burst interleaves the engine's settle
        // bumps with a spawned catch-up's park in an order the synchronous
        // event loop cannot reproduce, so numbering parks from the mirror
        // misassigns exactly that catch-up's identity (found by seed 1234).
        window.fetch = () => new Promise((res) => {
            ++vCounter
            const rec = { id: controller ? controller.runId : vCounter, released: false }
            rec.release = () => {
                rec.released = true
                res(jsonResponse([...serverRows.values()].map(r => Object.assign({}, r))))
            }
            held.push(rec)
        })
        const unreleased = () => held.filter(r => !r.released)
        // A real backend is free to return its rows in a different order than
        // last time (a sort changed, a row was touched, the plan differs).
        // Reordering serverRows itself is how the harness says so: payloads are
        // built from it in rec.release, and the oracle syncs from it in the same
        // synchronous block, so the two cannot disagree.
        const shuffleServer = () => {
            const arr = [...serverRows.entries()]
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(rand() * (i + 1))
                const t = arr[i]; arr[i] = arr[j]; arr[j] = t
            }
            serverRows.clear()
            for (const [k, v] of arr) serverRows.set(k, v)
        }
        const inflight = []   // {w, id, partial, resolve, reject}
        let writeSeq = 0
        wildflower.query(q, {
            from: '/api/model', key: 'id', deleted: 'gone',
            to: (item) => new Promise((resolve, reject) => {
                inflight.push({
                    w: ++writeSeq, id: item.id, partial: Object.assign({}, item),
                    isDelete: !!item.gone,
                    // A write whose key the server does not yet hold is a CREATE.
                    isCreate: !item.gone && !serverRows.has(item.id),
                    resolve, reject
                })
            })
        })
        container.innerHTML = `
            <div data-component="${c}">
                <span class="derived" data-bind="digest"></span>
                <span class="aderived" data-bind="adigest"></span>
                <ul data-query="${q}"><template><li class="row">
                    <span class="fa" data-bind="alpha"></span>
                    <span class="fb" data-bind="beta"></span>
                </li></template></ul>
            </div>
        `
        // Derived reads: a sync computed and an async computed over the
        // query handle, so read-side propagation (including the async
        // computed path) rides every interleaving.
        const digestOf = (rows) => [...rows]
            .sort((a, b) => (a.id > b.id ? 1 : -1))
            .map(r => r.id + ':' + r.alpha + '/' + r.beta).join('|')
        wildflower.component(c, {
            state: {},
            computed: {
                digest() { const hh = wildflower.getQuery(q); return digestOf(hh.rows || []) },
                adigest() { const hh = wildflower.getQuery(q); return Promise.resolve('A' + digestOf(hh.rows || [])) }
            }
        })
        wildflower.scan(container)
        await settle(30)
        held[0].release()   // the activation fetch: first load lands
        await settle(30)

        const h = wildflower.getQuery(q)
        controller = wildflower._queryControllers.get(q)
        const oracle = new Oracle(initial)
        const promises = []
        const trace = []

        // Flag oracle — the declared semantics, not the implementation:
        // see the header comment. `advanced` marks that lastSync must
        // have moved since the previous check; `missed` mirrors the
        // engine's missedArrival debt (a delivery was dropped and no
        // full delivery or drain has settled the account since).
        const flags = { stale: false, syncErr: false, deferred: false, advanced: false, missed: false }
        let prevLastSync = h.lastSync

        const check = async (label) => {
            await settle(20)
            // Existence is dynamic once deletes are in play: iterate the
            // oracle's own alive set (the second implementation), not a
            // fixed universe, and assert the count matches exactly so a
            // ghost or a missing row is caught even where find() alone
            // would not notice.
            const aliveIds = [...oracle.alive].sort((a, b) => a - b)
            const ctx0 = `seed ${seed}, after ${label}\ntrace: ${trace.join(' | ')}`
            expect(h.rows.length, `row count: ${ctx0}`).toBe(aliveIds.length)
            // Order rides ALONGSIDE the set checks rather than replacing them:
            // a set violation reports as a set violation and an order violation
            // as an order violation, so a wrong ordering model never costs the
            // signal on claims, flags, and bookkeeping.
            // DOM order needs no separate assertion: the dom loop below pairs
            // domRows[i] with h.rows[i].id positionally, so once rows order is
            // pinned the dom comparison inherits it.
            expect(h.rows.map(r => r.id), `row ORDER: ${ctx0}`).toEqual(oracle.orderedAlive())
            for (const id of aliveIds) {
                const expected = oracle.expectedRow(id)
                const actual = h.rows.find(r => r.id === id)
                const ctx = ctx0
                expect(actual, ctx).toBeTruthy()
                for (const f of FIELDS) {
                    expect(actual[f], `state ${f} of row ${id}: ${ctx}`).toBe(expected[f])
                }
            }
            const domRows = [...container.querySelectorAll('.row')]
            expect(domRows.length, `dom row count: seed ${seed} after ${label}`).toBe(aliveIds.length)
            for (let i = 0; i < domRows.length; i++) {
                const id = h.rows[i].id
                const expected = oracle.expectedRow(id)
                expect(domRows[i].querySelector('.fa').textContent, `dom alpha of row ${id}: seed ${seed} after ${label}`).toBe(String(expected.alpha))
                expect(domRows[i].querySelector('.fb').textContent, `dom beta of row ${id}: seed ${seed} after ${label}`).toBe(String(expected.beta))
            }
            // Flag truthfulness at every step.
            const fctx = `seed ${seed}, after ${label}\ntrace: ${trace.join(' | ')}`
            expect(h.isLoading, `isLoading: ${fctx}`).toBe(false)
            expect(h.error, `error: ${fctx}`).toBe(null)
            expect(h.isStale, `isStale: ${fctx}`).toBe(flags.stale)
            if (flags.syncErr) expect(h.syncError, `syncError truthy: ${fctx}`).toBeTruthy()
            else expect(h.syncError, `syncError null: ${fctx}`).toBe(null)
            if (flags.advanced) expect(h.lastSync, `lastSync advanced: ${fctx}`).toBeGreaterThan(prevLastSync)
            else expect(h.lastSync, `lastSync unchanged: ${fctx}`).toBe(prevLastSync)
            prevLastSync = h.lastSync
            flags.advanced = false
            expect(!!controller.deferredConfirm, `deferredConfirm: ${fctx}`).toBe(flags.deferred)
            expect(!!controller.missedArrival, `missedArrival: ${fctx}`).toBe(flags.missed)
            // Bookkeeping bounds at every step, not just at drain: sizes
            // AND owners must match the oracle's pending-overlay picture.
            // The runId mirror holds bump-for-bump: fetch starts, write
            // issues, and confirmed settles all move it, and a bump the
            // engine drops or invents diverges here.
            expect(controller.runId, `runId mirror: ${fctx}`).toBe(vCounter)
            expect(controller.pendingWrites, `pendingWrites: ${fctx}`).toBe(inflight.length)
            expect(controller.inflightWrites.size, `inflightWrites: ${fctx}`).toBe(inflight.length)
            let nClaims = 0
            // A claim can outlive a row's visibility (a pending delete's
            // own tombstone-field claim on a currently-dead row), so
            // this counts over every id the oracle has ever tracked
            // overlays for, not just the alive ones.
            for (const id of oracle.overlays.keys()) {
                const o = oracle.overlays.get(id)
                for (const f of Object.keys(o)) {
                    nClaims++
                    expect(controller.fieldClaims.get(String(id) + CLAIM_SEP + f),
                        `claim owner ${id}.${f}: ${fctx}`).toBe(o[f][o[f].length - 1].w)
                }
            }
            expect(controller.fieldClaims.size, `fieldClaims size: ${fctx}`).toBe(nClaims)
            for (const wid of controller.fieldClaims.values()) {
                expect(controller.inflightWrites.has(wid), `claim owner ${wid} still pending: ${fctx}`).toBe(true)
            }
            expect(controller.rowClaims.size, `rowClaims size: ${fctx}`).toBe(oracle.rowClaims.size)
            for (const [id, rc] of oracle.rowClaims) {
                expect(controller.rowClaims.get(String(id)), `rowClaim ${id}: ${fctx}`).toEqual(rc)
            }
            expect(controller.keyAliases.size, `keyAliases: ${fctx}`).toBe(0)
            // Derived reads propagate every interleaving.
            const expDigest = digestOf(aliveIds.map(id => oracle.expectedRow(id)))
            expect(container.querySelector('.derived').textContent, `computed digest: ${fctx}`).toBe(expDigest)
            expect(container.querySelector('.aderived').textContent, `async computed digest: ${fctx}`).toBe('A' + expDigest)
        }

        // One settle, oracle and flag model updated in engine handler
        // order (handlers run in settlement order; within a burst the
        // pending count the engine sees equals inflight.length after
        // this splice).
        const settleOne = () => {
            const fl = inflight.splice(Math.floor(rand() * inflight.length), 1)[0]
            const rejected = rand() < 0.45
            if (fl.isCreate) {
                // A create resolves WITH a record, so it settles exactly like a
                // normal confirmed write (the delete branch differs only
                // because it resolves null and short-circuits to invalidate).
                const record = Object.assign({ id: fl.id }, fl.partial)
                if (rejected) {
                    trace.push(`R${fl.w}✗new`)
                    oracle.settleCreate(fl.w, fl.id, true, null)
                    flags.syncErr = true
                    flags.stale = true
                    if (inflight.length === 0) {
                        if (flags.deferred) flags.advanced = true
                        flags.deferred = false
                        flags.stale = false
                        if (flags.missed) { tally.catchups++; flags.missed = false; flags.stale = true }
                    }
                    fl.reject(new Error('409 seed ' + seed))
                } else {
                    trace.push(`R${fl.w}✓new`)
                    // Confirmed: the server holds it now, so it rides every
                    // later payload at whatever slot the server gives it.
                    serverRows.set(fl.id, Object.assign({}, record))
                    oracle.settleCreate(fl.w, fl.id, false, record)
                    if (inflight.length === 0) {
                        flags.stale = false; flags.syncErr = false
                        flags.deferred = false; flags.advanced = true
                        if (flags.missed) { tally.catchups++; flags.missed = false; flags.stale = true }
                    } else {
                        flags.deferred = true
                    }
                    vCounter++   // mirror the confirmed settle's runId bump
                    fl.resolve(record)
                }
                return trace[trace.length - 1]
            }
            if (fl.isDelete) {
                oracle.settleDelete(fl.w, fl.id, rejected)
                if (rejected) {
                    tally.deleteRejected++
                    trace.push(`R${fl.w}✗del`)
                    flags.syncErr = true
                    // Nothing else can ever claim a dead row's fields in
                    // this widening's scope (edits/second-deletes on a
                    // dead row are excluded from the generator — see the
                    // Oracle header note), so this write always still
                    // owns its 'gone' claim at reject time and the
                    // un-hide is always a visible change.
                    flags.stale = true
                    if (inflight.length === 0) {
                        if (flags.deferred) flags.advanced = true
                        flags.deferred = false
                        flags.stale = false
                        if (flags.missed) {
                            tally.catchups++
                            flags.missed = false
                            flags.stale = true
                        }
                    }
                    fl.reject(new Error('409 seed ' + seed))
                } else {
                    tally.deleteConfirmed++
                    trace.push(`R${fl.w}✓del`)
                    serverRows.delete(fl.id)
                    // Confirms by resolving null: onResolve short-circuits
                    // straight to store.invalidate() before reaching the
                    // normal "pendingWrites===0 -> full clear" landing —
                    // a fetch joins the held queue (mirroring begin_sync's
                    // isStale=true transition), and THAT fetch's own
                    // delivery decides deferred/missed/lastSync later.
                    flags.stale = true
                    vCounter++   // mirror the confirmed settle's runId bump
                    fl.resolve(null)
                }
                return trace[trace.length - 1]
            }
            if (rejected) {
                trace.push(`R${fl.w}✗`)
                // The rollback re-applies (re-staling) only if the
                // rejecter still owns at least one of its fields.
                const o = oracle.overlays.get(fl.id)
                let owned = false
                for (const f of Object.keys(fl.partial)) {
                    if (f === 'id') continue
                    const st = o[f]
                    if (st && st.length && st[st.length - 1].w === fl.w) owned = true
                }
                flags.syncErr = true
                if (owned) flags.stale = true
                oracle.settle(fl.w, fl.id, true, null)
                if (inflight.length === 0) {
                    // Nothing pending after the drain: the rollback left
                    // rows equal to last known truth, so staleness ends.
                    // lastSync moves only if a confirm was actually held.
                    if (flags.deferred) flags.advanced = true
                    flags.deferred = false
                    flags.stale = false
                    if (flags.missed) {
                        // The drain spends the missed-arrival debt: a
                        // catch-up fetch spawns (transition staleness)
                        // and joins the held queue via the mock.
                        tally.catchups++
                        flags.missed = false
                        flags.stale = true
                    }
                }
                fl.reject(new Error('409 seed ' + seed))
            } else {
                const base = serverRows.get(fl.id)
                for (const f of Object.keys(fl.partial)) {
                    if (f !== 'id') base[f] = fl.partial[f]
                }
                const record = Object.assign({}, base)
                trace.push(`R${fl.w}✓`)
                oracle.settle(fl.w, fl.id, false, record)
                if (inflight.length === 0) {
                    flags.stale = false; flags.syncErr = false
                    flags.deferred = false; flags.advanced = true
                    if (flags.missed) {
                        tally.catchups++
                        flags.missed = false
                        flags.stale = true   // the spawned catch-up's transition
                    }
                } else {
                    flags.deferred = true
                }
                vCounter++   // mirror the confirmed settle's runId bump
                fl.resolve(record)
            }
            return trace[trace.length - 1]
        }

        // A release DELIVERS iff its fetch is still the current run (no
        // write or newer fetch bumped past it); otherwise the engine
        // drops it and owes a catch-up at the next write drain.
        const releaseOne = () => {
            const open = unreleased()
            const rec = open[Math.floor(rand() * open.length)]
            const delivers = rec.id === controller.runId
            rec.release()
            if (delivers) {
                tally.delivered++
                trace.push(`A${rec.id}✓`)
                oracle.serverSync([...serverRows.values()])
                if (inflight.length === 0) {
                    flags.stale = false; flags.syncErr = false
                    flags.deferred = false; flags.advanced = true
                } else {
                    // A full sync while writes pend cannot report fresh:
                    // the confirm defers exactly like the reconcile arm.
                    flags.deferred = true
                }
                flags.missed = false
            } else {
                tally.dropped++
                trace.push(`A${rec.id}✗dropped`)
                flags.missed = true
            }
            return trace[trace.length - 1]
        }

        const EVENTS = 22
        for (let ev = 0; ev < EVENTS; ev++) {
            const canSettle = inflight.length > 0
            const canRelease = unreleased().length > 0
            const roll = rand()
            // Out-of-band arrival BEGINS: another client changed the
            // server; the catch-up fetch starts and PARKS in the held
            // queue. Everything after this interleaves with it in flight.
            if (roll < 0.12) {
                // Draw from what the server still canonically has — a
                // CONFIRMED delete removes the row from serverRows for
                // good (a real backend has actually deleted it too), so
                // an id ROW_IDS still names but serverRows no longer
                // holds is not a live arrival target. A row with only a
                // PENDING delete stays a valid, and interesting, target
                // (deleteClaimed exclusion — the row's absence holds
                // even though the arrival's payload still carries it).
                const liveIds = [...serverRows.keys()]
                const id = liveIds[Math.floor(rand() * liveIds.length)]
                const field = FIELDS[Math.floor(rand() * FIELDS.length)]
                serverRows.get(id)[field] = 's' + ev
                // Half of these out-of-band changes also REORDER the server's
                // list. Without this the payload is always seed order minus
                // deletions, so the order assertion pins "order never changes"
                // and the engine's re-read of a pending delete's position out
                // of each arrival is exercised without being tested. Mutating
                // serverRows itself keeps the payload (built in rec.release)
                // and oracle.serverSync in lockstep: both read it in the same
                // synchronous block.
                // Every out-of-band change reorders. At half this rate only 2
                // of 31 seeds ever reached an order-discriminating state
                // (measured by mutating the oracle's order rule), which is too
                // thin to call the property covered.
                shuffleServer()
                // Sometimes another client also CREATES a row. serverRows never
                // grew before, so "a row the client has never seen arrives while
                // a delete is pending" — the interleaving where a remembered
                // index is most likely to drift — was unreachable.
                if (rand() < 0.35) {
                    const nid = 100 + ev
                    serverRows.set(nid, { id: nid, alpha: 'n' + ev, beta: 'n' + ev })
                    shuffleServer()
                    trace.push(`S:${id}.${field}=s${ev}+ord+new${nid}`)
                } else {
                    trace.push(`S:${id}.${field}=s${ev}+ord`)
                }
                tally.begins++
                h.invalidate().catch(() => {})
                flags.stale = true   // fetch-start transition (data present)
                await check(`begin_sync ${trace[trace.length - 1]}`)
                continue
            }
            if (roll < 0.24 && canRelease) {
                const l = releaseOne()
                await check(`release ${l}`)
                continue
            }
            // Tombstone delete: only an UNCLAIMED alive row (no other
            // write currently owns any of its fields), and only while
            // more than one row remains alive (keeps at least one row
            // visible throughout, so the rest of the suite's assertions
            // never go vacuous over an empty list). Deleting a row with
            // a pending edit is deliberately excluded — see the Oracle
            // header note AND the tracking doc: it uncovered a real,
            // deeper interaction (the delete-reject restore excludes
            // claimed fields, which can leave the restored row missing
            // that field entirely, or the claiming write's own later
            // settle can re-add the row while the delete is STILL
            // pending) that is a separate investigation, not this one.
            const unclaimedAlive = [...oracle.alive].filter(id =>
                Object.keys(oracle.overlays.get(id)).length === 0)
            if (roll < 0.30 && oracle.alive.size > 1 && unclaimedAlive.length > 0) {
                const id = unclaimedAlive[Math.floor(rand() * unclaimedAlive.length)]
                const w = writeSeq + 1   // the to: callback assigns the real w
                trace.push(`D${w}:${id}`)
                oracle.delete(w, id)
                flags.stale = true
                vCounter++   // mirror the write's runId bump
                tally.deleted++
                promises.push(h.write({ id, gone: true }).catch(() => {}))
                await check(`delete ${trace[trace.length - 1]}`)
                continue
            }
            // CLIENT CREATE: a key the server does not hold. Kept to its own id
            // space (900+) so it can never collide with a delete target, since
            // rowClaims is overwrite-by-key and a create claim landing on a
            // delete-claimed id is the deeper interaction still out of scope.
            if (canSettle && roll >= 0.62 && roll < 0.68) {
                const nid = 900 + ev
                const fields = { alpha: 'c' + ev, beta: 'c' + ev }
                trace.push(`C${writeSeq + 1}:new${nid}`)
                oracle.create(writeSeq + 1, nid, fields)
                flags.stale = true
                vCounter++
                promises.push(h.write(Object.assign({ id: nid }, fields)).catch(() => {}))
                await check(`create ${trace[trace.length - 1]}`)
                continue
            }
            const doWrite = !canSettle || roll < 0.62
            if (doWrite) {
                const aliveNow = [...oracle.alive]
                const id = aliveNow[Math.floor(rand() * aliveNow.length)]
                const field = FIELDS[Math.floor(rand() * FIELDS.length)]
                // Colliding values on purpose (urql #1639/#2478 class):
                // value-equality must never stand in for write identity.
                const value = 'v' + Math.floor(rand() * 3)
                const partial = { id, [field]: value }
                trace.push(`W${writeSeq + 1}:${id}.${field}=${value}`)
                oracle.write(writeSeq + 1, id, partial)
                flags.stale = true
                vCounter++   // mirror the write's runId bump
                promises.push(h.write(partial).catch(() => {}))
                await check(`write ${trace[trace.length - 1]}`)
            } else {
                // Sometimes settle several writes back-to-back with NO await
                // between them, so multiple settle-path ingests land inside
                // one flush window — sub-event races that per-event settling
                // can never produce.
                const burst = Math.min(inflight.length, 1 + Math.floor(rand() * 3))
                const labels = []
                for (let b = 0; b < burst; b++) labels.push(settleOne())
                await check(`settle burst [${labels.join(' ')}]`)
            }
        }
        // Drain: settle every write and release every held fetch —
        // including catch-ups spawned during the drain — checking each.
        while (inflight.length > 0 || unreleased().length > 0) {
            if (inflight.length > 0 && (unreleased().length === 0 || rand() < 0.5)) {
                const l = settleOne()
                await check(`drain ${l}`)
            } else {
                const l = releaseOne()
                await check(`drain ${l}`)
            }
        }
        await Promise.all(promises)
        expect(controller.fieldClaims.size, `claims drained: seed ${seed}`).toBe(0)
        expect(controller.pendingWrites, `pendingWrites drained: seed ${seed}`).toBe(0)
        expect(controller.inflightWrites.size, `inflightWrites drained: seed ${seed}`).toBe(0)
        expect(controller.rowClaims.size, `rowClaims drained: seed ${seed}`).toBe(0)
    }

    // A fixed spread of seeds: deterministic in CI, wide enough to cover
    // hundreds of distinct interleavings across the matrix's 17 lanes.
    for (const seed of [1, 7, 42, 99, 1234, 5678, 20260816, 314159, 271828, 999983]) {
        it(`random interleaving holds the field-ownership model (seed ${seed})`, async () => {
            await runSequence(seed)
        })
    }

    // Vacuous-pass guard: with fixed seeds the event mix is
    // deterministic, so these floors fail loudly if a generator change
    // ever stops exercising held arrivals, drops, or drain catch-ups.
    it('the widened generator exercised held arrivals', () => {
        expect(tally.begins, 'arrivals began').toBeGreaterThanOrEqual(10)
        expect(tally.delivered, 'arrivals delivered').toBeGreaterThanOrEqual(5)
        expect(tally.dropped, 'arrivals dropped by supersession').toBeGreaterThanOrEqual(5)
        expect(tally.catchups, 'write drains spent missed-arrival debts').toBeGreaterThanOrEqual(3)
        expect(tally.deleted, 'tombstone deletes issued').toBeGreaterThanOrEqual(5)
        expect(tally.deleteConfirmed, 'deletes confirmed (permanently gone)').toBeGreaterThanOrEqual(1)
        expect(tally.deleteRejected, 'deletes rejected (row restored)').toBeGreaterThanOrEqual(1)
    })

    // Record (unkeyed) mode: the same ownership semantics with no ID-based
    // routing — a single record, keyless partial writes, claims keyed
    // under the undefined row key. Held arrivals (the same begin_sync/
    // release_sync widening as the keyed sequence): fetches park until
    // released, so a write can supersede one, drop its delivery, and owe
    // a drain catch-up — record-mode's own copy of that machinery.
    const recordTally = { begins: 0, delivered: 0, dropped: 0, catchups: 0 }
    async function runRecordSequence(seed) {
        const rand = rng(seed)
        const q = uname('rq'); const c = uname('rc')
        const server = { alpha: 'a0', beta: 'b0' }
        let vCounter = 0
        let controller = null   // assigned after activation; the mock reads it lazily
        const held = []   // {id, released, release()}
        // Park ids come from the engine's runId (the fetch's real identity);
        // vCounter stays the independent bump mirror, asserted in lockstep
        // at every check — see the keyed harness's mock comment.
        window.fetch = () => new Promise((res) => {
            ++vCounter
            const rec = { id: controller ? controller.runId : vCounter, released: false }
            rec.release = () => {
                rec.released = true
                res(jsonResponse(Object.assign({}, server)))
            }
            held.push(rec)
        })
        const unreleased = () => held.filter(r => !r.released)
        const inflight = []
        let writeSeq = 0
        wildflower.query(q, {
            from: '/api/record',
            to: (item) => new Promise((resolve, reject) => {
                inflight.push({ w: ++writeSeq, partial: Object.assign({}, item), resolve, reject })
            })
        })
        container.innerHTML = `
            <div data-component="${c}">
                <span class="derived" data-bind="digest"></span>
                <div data-query="${q}">
                    <span class="fa" data-bind="alpha"></span>
                    <span class="fb" data-bind="beta"></span>
                </div>
            </div>
        `
        const digestOf = (r) => (r ? r.alpha + '/' + r.beta : '')
        wildflower.component(c, {
            state: {},
            computed: {
                digest() { const hh = wildflower.getQuery(q); return digestOf(hh.rows && hh.rows[0]) }
            }
        })
        wildflower.scan(container)
        await settle(30)
        held[0].release()   // the activation fetch: first load lands
        await settle(30)
        const h = wildflower.getQuery(q)
        controller = wildflower._queryControllers.get(q)

        const base = Object.assign({}, server)
        const overlays = {}
        const trace = []
        const promises = []
        const flags = { stale: false, syncErr: false, deferred: false, advanced: false, missed: false }
        let prevLastSync = h.lastSync
        const expected = () => {
            const out = Object.assign({}, base)
            for (const f of Object.keys(overlays)) out[f] = overlays[f][overlays[f].length - 1].v
            return out
        }
        const check = async (label) => {
            await settle(20)
            const exp = expected()
            const ctx = `record seed ${seed}, after ${label}\ntrace: ${trace.join(' | ')}`
            for (const f of FIELDS) {
                expect(h.rows[0] && h.rows[0][f], `state ${f}: ${ctx}`).toBe(exp[f])
            }
            expect(container.querySelector('.fa').textContent, `dom alpha: ${ctx}`).toBe(String(exp.alpha))
            expect(container.querySelector('.fb').textContent, `dom beta: ${ctx}`).toBe(String(exp.beta))
            // Flag truthfulness at every step.
            expect(h.isLoading, `isLoading: ${ctx}`).toBe(false)
            expect(h.error, `error: ${ctx}`).toBe(null)
            expect(h.isStale, `isStale: ${ctx}`).toBe(flags.stale)
            if (flags.syncErr) expect(h.syncError, `syncError truthy: ${ctx}`).toBeTruthy()
            else expect(h.syncError, `syncError null: ${ctx}`).toBe(null)
            if (flags.advanced) expect(h.lastSync, `lastSync advanced: ${ctx}`).toBeGreaterThan(prevLastSync)
            else expect(h.lastSync, `lastSync unchanged: ${ctx}`).toBe(prevLastSync)
            prevLastSync = h.lastSync
            flags.advanced = false
            expect(!!controller.deferredConfirm, `deferredConfirm: ${ctx}`).toBe(flags.deferred)
            expect(!!controller.missedArrival, `missedArrival: ${ctx}`).toBe(flags.missed)
            // Bookkeeping bounds at every step (claims keyed under the
            // undefined row key in record mode).
            expect(controller.runId, `runId mirror: ${ctx}`).toBe(vCounter)
            expect(controller.pendingWrites, `pendingWrites: ${ctx}`).toBe(inflight.length)
            expect(controller.inflightWrites.size, `inflightWrites: ${ctx}`).toBe(inflight.length)
            let nClaims = 0
            for (const f of Object.keys(overlays)) {
                nClaims++
                expect(controller.fieldClaims.get(String(undefined) + CLAIM_SEP + f),
                    `claim owner ${f}: ${ctx}`).toBe(overlays[f][overlays[f].length - 1].w)
            }
            expect(controller.fieldClaims.size, `fieldClaims size: ${ctx}`).toBe(nClaims)
            expect(controller.rowClaims.size, `rowClaims: ${ctx}`).toBe(0)
            expect(controller.keyAliases.size, `keyAliases: ${ctx}`).toBe(0)
            // Derived read propagates every interleaving.
            expect(container.querySelector('.derived').textContent, `computed digest: ${ctx}`).toBe(digestOf(exp))
        }
        const settleOne = () => {
            const fl = inflight.splice(Math.floor(rand() * inflight.length), 1)[0]
            if (rand() < 0.45) {
                trace.push(`R${fl.w}✗`)
                let owned = false
                for (const f of Object.keys(fl.partial)) {
                    const st = overlays[f]
                    if (st && st.length && st[st.length - 1].w === fl.w) owned = true
                }
                flags.syncErr = true
                if (owned) flags.stale = true
                for (const f of Object.keys(overlays)) {
                    overlays[f] = overlays[f].filter(e => e.w !== fl.w)
                    if (!overlays[f].length) delete overlays[f]
                }
                if (inflight.length === 0) {
                    // Drain by rejection: staleness ends; lastSync moves
                    // only if a confirm was held (same rule as keyed).
                    if (flags.deferred) flags.advanced = true
                    flags.deferred = false
                    flags.stale = false
                    if (flags.missed) {
                        recordTally.catchups++
                        flags.missed = false
                        flags.stale = true   // the spawned catch-up's transition
                    }
                }
                fl.reject(new Error('409 record seed ' + seed))
            } else {
                for (const f of Object.keys(fl.partial)) server[f] = fl.partial[f]
                const record = Object.assign({}, server)
                trace.push(`R${fl.w}✓`)
                for (const f of Object.keys(record)) base[f] = record[f]
                for (const f of Object.keys(overlays)) {
                    if (!overlays[f].some(e => e.w === fl.w)) continue
                    overlays[f] = overlays[f].filter(e => e.w > fl.w)
                    if (!overlays[f].length) delete overlays[f]
                }
                if (inflight.length === 0) {
                    flags.stale = false; flags.syncErr = false
                    flags.deferred = false; flags.advanced = true
                    if (flags.missed) {
                        recordTally.catchups++
                        flags.missed = false
                        flags.stale = true
                    }
                } else {
                    flags.deferred = true
                }
                vCounter++   // mirror the confirmed settle's runId bump
                fl.resolve(record)
            }
            return trace[trace.length - 1]
        }

        // Same delivers-or-dropped determination as the keyed sequence:
        // a release DELIVERS iff its fetch is still the current run.
        const releaseOne = () => {
            const open = unreleased()
            const rec = open[Math.floor(rand() * open.length)]
            const delivers = rec.id === controller.runId
            rec.release()
            if (delivers) {
                recordTally.delivered++
                trace.push(`A${rec.id}✓`)
                Object.assign(base, server)
                if (inflight.length === 0) {
                    flags.stale = false; flags.syncErr = false
                    flags.deferred = false; flags.advanced = true
                } else {
                    flags.deferred = true
                }
                flags.missed = false
            } else {
                recordTally.dropped++
                trace.push(`A${rec.id}✗dropped`)
                flags.missed = true
            }
            return trace[trace.length - 1]
        }

        for (let ev = 0; ev < 16; ev++) {
            const canSettle = inflight.length > 0
            const canRelease = unreleased().length > 0
            const roll = rand()
            // Out-of-band arrival BEGINS and parks in the held queue.
            if (roll < 0.12) {
                const field = FIELDS[Math.floor(rand() * FIELDS.length)]
                server[field] = 's' + ev
                trace.push(`S:${field}=s${ev}`)
                recordTally.begins++
                h.invalidate().catch(() => {})
                flags.stale = true
                await check(`begin_sync ${trace[trace.length - 1]}`)
                continue
            }
            if (roll < 0.24 && canRelease) {
                const l = releaseOne()
                await check(`release ${l}`)
                continue
            }
            if (!canSettle || roll < 0.62) {
                const field = FIELDS[Math.floor(rand() * FIELDS.length)]
                const value = 'v' + Math.floor(rand() * 3)
                trace.push(`W${writeSeq + 1}:${field}=${value}`)
                if (!overlays[field]) overlays[field] = []
                overlays[field].push({ w: writeSeq + 1, v: value })
                flags.stale = true
                vCounter++   // mirror the write's runId bump
                promises.push(h.write({ [field]: value }).catch(() => {}))
                await check(`write ${trace[trace.length - 1]}`)
            } else {
                const burst = Math.min(inflight.length, 1 + Math.floor(rand() * 3))
                const labels = []
                for (let b = 0; b < burst; b++) labels.push(settleOne())
                await check(`settle burst [${labels.join(' ')}]`)
            }
        }
        // Drain: settle every write and release every held fetch,
        // including catch-ups spawned during the drain.
        while (inflight.length > 0 || unreleased().length > 0) {
            if (inflight.length > 0 && (unreleased().length === 0 || rand() < 0.5)) {
                const l = settleOne()
                await check(`drain ${l}`)
            } else {
                const l = releaseOne()
                await check(`drain ${l}`)
            }
        }
        await Promise.all(promises)
        expect(controller.fieldClaims.size, `record claims drained: seed ${seed}`).toBe(0)
        expect(controller.pendingWrites, `record pendingWrites drained: seed ${seed}`).toBe(0)
    }

    for (const seed of [11, 23, 47, 811, 4093, 65537]) {
        it(`record-mode interleaving holds the field-ownership model (seed ${seed})`, async () => {
            await runRecordSequence(seed)
        })
    }

    it('the widened record-mode generator exercised held arrivals', () => {
        expect(recordTally.begins, 'arrivals began').toBeGreaterThanOrEqual(6)
        expect(recordTally.delivered, 'arrivals delivered').toBeGreaterThanOrEqual(3)
        expect(recordTally.dropped, 'arrivals dropped by supersession').toBeGreaterThanOrEqual(3)
        expect(recordTally.catchups, 'write drains spent missed-arrival debts').toBeGreaterThanOrEqual(2)
    })

    // ── Combo tier: writes × freshness (the third generator) ────────────
    //
    // The read-side event dispatchers (content change + etag rule, focus,
    // online, the sse_* set — from data-query-freshness-model.test.js)
    // riding the keyed write generator, with its own seeds and its own
    // tally, so existing-seed failures stay attributable. The oracle is
    // the union: claims/overlays/pre-images from the write Oracle above,
    // plus the read-side flag and persist-envelope rules. The crossings
    // this tier walks (each pinned individually elsewhere; here composed):
    //
    // - A stream push during pending writes applies gently and
    //   claim-honored; its persist save DEFERS (pendingWrites > 0 skips
    //   the save; the drain's settle saves converged rows).
    // - A confirmed settle bumps runId (d8cbd330), so held reads AND the
    //   stream-follow check interleave with settles; rejections never
    //   bump. Every confirm also drops the held validators and the result
    //   cache (validator hygiene), so a later conditional fetch goes
    //   unconditional until a 200 re-arms it.
    // - A drain that lands by REJECTION with a confirm held saves the
    //   envelope with the CURRENT validator pair. The oracle applies the
    //   strict cb7ccdec reading: the validator rides only when the
    //   deferring arrival was fetch-sourced (a fetch updated
    //   controller.etag; a 304 re-vouched it) — a STREAM-deferred confirm
    //   moved the rows past the held validator, so it must not pair.
    // - A dead stream (readyState 2) revives at the NEXT fetch start —
    //   including engine-spawned ones: a drain catch-up and a confirmed
    //   delete's invalidate reach _querySyncStream like any read.
    async function runComboSequence(seed) {
        const rand = rng(seed)
        const q = uname('cq'); const c = uname('cc')
        persistKeys.push('wf:query:' + q)
        const URL = '/api/combo'
        const initial = ROW_IDS.map(id => ({ id, alpha: 'a' + id, beta: 'b' + id }))
        const cp = (rows) => rows.map(r => Object.assign({}, r))
        const sortByKey = (rows) => [...rows].sort((a, b) => (String(a.id) > String(b.id) ? 1 : -1))

        // The simulated server: canonical rows plus ONE validator that
        // rotates on every content change — confirmed writes and deletes
        // included, since they change server content too (a mock that
        // kept the etag across them would answer bogus 304s).
        const serverRows = new Map(initial.map(r => [r.id, Object.assign({}, r)]))
        let stamp = 0
        let serverEtag = 'e-0'
        const rotate = () => { serverEtag = 'e-' + (++stamp) }
        const mutateField = (label) => {
            const ids = [...serverRows.keys()]
            const id = ids[Math.floor(rand() * ids.length)]
            const field = FIELDS[Math.floor(rand() * FIELDS.length)]
            serverRows.get(id)[field] = 'x' + (++stamp)
            rotate()
            trace.push(`${label}:${id}.${field}`)
        }

        let vCounter = 0
        let controller = null   // assigned after activation; the mock reads it lazily
        const held = []   // {id, inm, released, release()}
        // Engine-stamped park ids + the independent vCounter mirror, as in
        // the keyed harness — plus If-None-Match capture at park time: a
        // release answers 304 iff the CAPTURED validator equals the
        // server's at release time.
        window.fetch = (url, init) => new Promise((res) => {
            ++vCounter
            const rec = {
                id: controller ? controller.runId : vCounter,
                inm: init && init.headers ? init.headers['If-None-Match'] : undefined,
                released: false
            }
            rec.release = () => {
                rec.released = true
                if (rec.inm !== undefined && rec.inm === serverEtag) {
                    res(new Response(null, { status: 304 }))
                } else {
                    res(new Response(JSON.stringify([...serverRows.values()].map(r => Object.assign({}, r))), {
                        status: 200, headers: { ETag: serverEtag }
                    }))
                }
            }
            held.push(rec)
        })
        const unreleased = () => held.filter(r => !r.released)
        const inflight = []   // {w, id, partial, isDelete, resolve, reject}
        let writeSeq = 0
        wildflower.query(q, {
            from: URL, key: 'id', deleted: 'gone',
            refresh: ['focus', 'reconnect', 'sse'],
            stream: URL + '/stream',
            persist: true,
            to: (item) => new Promise((resolve, reject) => {
                inflight.push({ w: ++writeSeq, id: item.id, partial: Object.assign({}, item), isDelete: !!item.gone, resolve, reject })
            })
        })
        container.innerHTML = `
            <div data-component="${c}">
                <span class="derived" data-bind="digest"></span>
                <ul data-query="${q}"><template><li class="row">
                    <span class="fa" data-bind="alpha"></span>
                    <span class="fb" data-bind="beta"></span>
                </li></template></ul>
            </div>
        `
        const digestOf = (rows) => [...rows]
            .sort((a, b) => (a.id > b.id ? 1 : -1))
            .map(r => r.id + ':' + r.alpha + '/' + r.beta).join('|')
        wildflower.component(c, {
            state: {},
            computed: {
                digest() { const hh = wildflower.getQuery(q); return digestOf(hh.rows || []) }
            }
        })
        wildflower.scan(container)
        await settle(30)
        held[0].release()   // the activation fetch (unconditional): first load lands
        await settle(30)

        const h = wildflower.getQuery(q)
        controller = wildflower._queryControllers.get(q)
        expect(h.lastSync, `combo first load landed: seed ${seed}`).not.toBe(null)
        expect(FakeEventSource.instances.length, `combo activation opened one stream: seed ${seed}`).toBe(1)

        const oracle = new Oracle(initial)
        const promises = []
        const trace = []
        const flags = { stale: false, syncErr: false, deferred: false, advanced: false, missed: false }
        let prevLastSync = h.lastSync
        // Read-side mirrors: the armed validator (undefined = none — every
        // confirmed settle clears it), the result-cache occupancy, the
        // last save-eligible envelope, the parked-fetch count, and the
        // stream instance mirror.
        let oEtag = serverEtag
        let oSnap = true
        let lastSaved = { rows: cp(initial), etag: serverEtag, etagUrl: URL }
        let deferredSource = null   // 'fetch' | 'stream' | 'reconcile' while flags.deferred
        let parkedTotal = 1
        let esCount = 1
        let es = { dead: false, hadError: false }
        let fpSeen = null
        const visibleRows = () => [...oracle.alive].sort((a, b) => a - b).map(id => oracle.expectedRow(id))

        // Every fetch start — event-driven or engine-spawned (a drain
        // catch-up, a confirmed delete's invalidate) — parks one request,
        // marks the transition staleness, and revives a dead stream
        // (_querySyncStream runs beside each fetch, closes a readyState-2
        // corpse, and constructs a new EventSource).
        const spawnedFetch = () => {
            if (es.dead) {
                esCount++
                es = { dead: false, hadError: false }
                comboTally.revives++
            }
            parkedTotal++
            flags.stale = true
        }

        const check = async (label) => {
            await settle(20)
            const ctx = `combo seed ${seed}, after ${label}\ntrace: ${trace.join(' | ')}`
            const aliveIds = [...oracle.alive].sort((a, b) => a - b)
            expect(h.rows.length, `row count: ${ctx}`).toBe(aliveIds.length)
            expect(h.rows.map(r => r.id), `row ORDER: ${ctx}`).toEqual(oracle.orderedAlive())
            for (const id of aliveIds) {
                const expected = oracle.expectedRow(id)
                const actual = h.rows.find(r => r.id === id)
                expect(actual, `row ${id} present: ${ctx}`).toBeTruthy()
                for (const f of FIELDS) {
                    expect(actual[f], `state ${f} of row ${id}: ${ctx}`).toBe(expected[f])
                }
            }
            const domRows = [...container.querySelectorAll('.row')]
            expect(domRows.length, `dom row count: ${ctx}`).toBe(aliveIds.length)
            for (let i = 0; i < domRows.length; i++) {
                const id = h.rows[i].id
                const expected = oracle.expectedRow(id)
                expect(domRows[i].querySelector('.fa').textContent, `dom alpha of row ${id}: ${ctx}`).toBe(String(expected.alpha))
                expect(domRows[i].querySelector('.fb').textContent, `dom beta of row ${id}: ${ctx}`).toBe(String(expected.beta))
            }
            // Flag truthfulness at every step.
            expect(h.isLoading, `isLoading: ${ctx}`).toBe(false)
            expect(h.error, `error: ${ctx}`).toBe(null)
            expect(h.isStale, `isStale: ${ctx}`).toBe(flags.stale)
            if (flags.syncErr) expect(h.syncError, `syncError truthy: ${ctx}`).toBeTruthy()
            else expect(h.syncError, `syncError null: ${ctx}`).toBe(null)
            if (flags.advanced) expect(h.lastSync, `lastSync advanced: ${ctx}`).toBeGreaterThan(prevLastSync)
            else expect(h.lastSync, `lastSync unchanged: ${ctx}`).toBe(prevLastSync)
            prevLastSync = h.lastSync
            flags.advanced = false
            expect(!!controller.deferredConfirm, `deferredConfirm: ${ctx}`).toBe(flags.deferred)
            expect(!!controller.missedArrival, `missedArrival: ${ctx}`).toBe(flags.missed)
            // Bookkeeping bounds at every step (the write model's rules).
            expect(controller.runId, `runId mirror: ${ctx}`).toBe(vCounter)
            expect(held.length, `no spurious fetches: ${ctx}`).toBe(parkedTotal)
            expect(controller.pendingWrites, `pendingWrites: ${ctx}`).toBe(inflight.length)
            expect(controller.inflightWrites.size, `inflightWrites: ${ctx}`).toBe(inflight.length)
            let nClaims = 0
            for (const id of oracle.overlays.keys()) {
                const o = oracle.overlays.get(id)
                for (const f of Object.keys(o)) {
                    nClaims++
                    expect(controller.fieldClaims.get(String(id) + CLAIM_SEP + f),
                        `claim owner ${id}.${f}: ${ctx}`).toBe(o[f][o[f].length - 1].w)
                }
            }
            expect(controller.fieldClaims.size, `fieldClaims size: ${ctx}`).toBe(nClaims)
            expect(controller.rowClaims.size, `rowClaims size: ${ctx}`).toBe(oracle.rowClaims.size)
            for (const [id, rc] of oracle.rowClaims) {
                expect(controller.rowClaims.get(String(id)), `rowClaim ${id}: ${ctx}`).toEqual(rc)
            }
            expect(controller.keyAliases.size, `keyAliases: ${ctx}`).toBe(0)
            // Validator hygiene mirrors: armed by delivered 200s, dropped
            // by every confirmed settle.
            expect(controller.etag, `last validator: ${ctx}`).toBe(oEtag !== undefined ? oEtag : null)
            expect(controller.etagUrl, `validator url: ${ctx}`).toBe(oEtag !== undefined ? URL : null)
            expect(controller.etags || {}, `per-url validators: ${ctx}`).toEqual(oEtag !== undefined ? { [URL]: oEtag } : {})
            expect(controller.snapshots ? controller.snapshots.size : 0, `result cache size: ${ctx}`).toBe(oSnap ? 1 : 0)
            // Stream lifecycle: instance count and closed states.
            expect(FakeEventSource.instances.length, `stream instances: ${ctx}`).toBe(esCount)
            for (let i = 0; i < esCount - 1; i++) {
                expect(FakeEventSource.instances[i].closed, `stream ${i} closed: ${ctx}`).toBe(true)
            }
            expect(FakeEventSource.instances[esCount - 1].closed, `current stream open: ${ctx}`).toBe(false)
            // The persist envelope, read from disk every check.
            const env = JSON.parse(localStorage.getItem('wf:query:' + q))
            expect(env && env.v, `envelope version: ${ctx}`).toBe(1)
            // ORDER-INSENSITIVE ON PURPOSE (2026-08-30), unlike the rows check
            // above. A snapshot is restored and then revalidated, so what it
            // owes is the right rows and values; the order the user sees comes
            // from the revalidation, not from disk. Sorting both sides states
            // that envelope order is not a contract, rather than leaving it
            // untested by accident.
            expect(sortByKey(env.rows), `envelope rows: ${ctx}`).toEqual(sortByKey(lastSaved.rows))
            expect(env.etag, `envelope etag: ${ctx}`).toBe(lastSaved.etag)
            expect(env.etagUrl, `envelope etagUrl: ${ctx}`).toBe(lastSaved.etagUrl)
            expect(env.url, `envelope url: ${ctx}`).toBe(URL)
            expect(typeof env.fp, `envelope fp present: ${ctx}`).toBe('number')
            if (fpSeen === null) fpSeen = env.fp
            else expect(env.fp, `envelope fp stable: ${ctx}`).toBe(fpSeen)
            expect(typeof env.savedAt, `envelope savedAt: ${ctx}`).toBe('number')
            // Derived read propagates every interleaving.
            const expDigest = digestOf(aliveIds.map(id => oracle.expectedRow(id)))
            expect(container.querySelector('.derived').textContent, `computed digest: ${ctx}`).toBe(expDigest)
        }

        // One settle: the keyed model's semantics, plus the combo's
        // read-side consequences — every confirm rotates the server
        // validator (content changed) and drops the client's held
        // validators and result cache; the drain's landing decides the
        // envelope; catch-ups and a confirmed delete's invalidate are
        // fetch starts (stream revival included).
        const settleOne = () => {
            const fl = inflight.splice(Math.floor(rand() * inflight.length), 1)[0]
            const rejected = rand() < 0.45
            if (fl.isDelete) {
                oracle.settleDelete(fl.w, fl.id, rejected)
                if (rejected) {
                    trace.push(`R${fl.w}✗del`)
                    flags.syncErr = true
                    flags.stale = true
                    if (inflight.length === 0) {
                        if (flags.deferred) {
                            flags.advanced = true
                            comboTally.rejectDrainSaves++
                            if (deferredSource === 'stream') comboTally.rejectDrainSavesStream++
                            lastSaved = {
                                rows: visibleRows(),
                                etag: deferredSource === 'stream' ? null : (oEtag !== undefined ? oEtag : null),
                                etagUrl: deferredSource === 'stream' ? null : (oEtag !== undefined ? URL : null)
                            }
                        }
                        flags.deferred = false
                        flags.stale = false
                        deferredSource = null
                        if (flags.missed) {
                            comboTally.catchups++
                            flags.missed = false
                            spawnedFetch()
                        }
                    }
                    fl.reject(new Error('409 combo seed ' + seed))
                } else {
                    trace.push(`R${fl.w}✓del`)
                    serverRows.delete(fl.id)
                    rotate()
                    vCounter++   // mirror the confirmed settle's runId bump
                    oEtag = undefined   // validator hygiene: confirm drops it
                    oSnap = false
                    fl.resolve(null)
                    // Confirms by resolving null: onResolve short-circuits
                    // to store.invalidate() — a fetch start with all its
                    // consequences; the held deferred/missed state rides
                    // until THAT delivery decides it.
                    spawnedFetch()
                }
                return trace[trace.length - 1]
            }
            if (rejected) {
                trace.push(`R${fl.w}✗`)
                const o = oracle.overlays.get(fl.id)
                let owned = false
                for (const f of Object.keys(fl.partial)) {
                    if (f === 'id') continue
                    const st = o[f]
                    if (st && st.length && st[st.length - 1].w === fl.w) owned = true
                }
                flags.syncErr = true
                if (owned) flags.stale = true
                oracle.settle(fl.w, fl.id, true, null)
                if (inflight.length === 0) {
                    if (flags.deferred) {
                        flags.advanced = true
                        // The drain-by-rejection landing (held confirm)
                        // saves the converged rows. The validator rides
                        // only for a fetch-sourced deferral — the stream
                        // case is the pin in query-write-validator-hygiene
                        // ("drain-by-rejection landing a STREAM-deferred
                        // confirm"), kept under randomized pressure here.
                        comboTally.rejectDrainSaves++
                        if (deferredSource === 'stream') comboTally.rejectDrainSavesStream++
                        lastSaved = {
                            rows: visibleRows(),
                            etag: deferredSource === 'stream' ? null : (oEtag !== undefined ? oEtag : null),
                            etagUrl: deferredSource === 'stream' ? null : (oEtag !== undefined ? URL : null)
                        }
                    }
                    flags.deferred = false
                    flags.stale = false
                    deferredSource = null
                    if (flags.missed) {
                        comboTally.catchups++
                        flags.missed = false
                        spawnedFetch()
                    }
                }
                fl.reject(new Error('409 combo seed ' + seed))
            } else {
                const base = serverRows.get(fl.id)
                for (const f of Object.keys(fl.partial)) {
                    if (f !== 'id') base[f] = fl.partial[f]
                }
                rotate()   // server content changed
                const record = Object.assign({}, base)
                trace.push(`R${fl.w}✓`)
                oracle.settle(fl.w, fl.id, false, record)
                oEtag = undefined   // validator hygiene: confirm drops etags + cache
                oSnap = false
                if (inflight.length === 0) {
                    flags.stale = false; flags.syncErr = false
                    flags.deferred = false; flags.advanced = true
                    deferredSource = null
                    // The drain's reconcile saves the converged rows —
                    // reconcile-sourced, so no validator rides.
                    comboTally.drainConfirmSaves++
                    lastSaved = { rows: visibleRows(), etag: null, etagUrl: null }
                    if (flags.missed) {
                        comboTally.catchups++
                        flags.missed = false
                        spawnedFetch()
                    }
                } else {
                    flags.deferred = true
                    deferredSource = 'reconcile'
                }
                vCounter++   // mirror the confirmed settle's runId bump
                fl.resolve(record)
            }
            return trace[trace.length - 1]
        }

        // A release DELIVERS iff its fetch is still the current run; a
        // delivering release answers 304 or 200 per the captured
        // If-None-Match against the server validator at release time.
        const releaseOne = () => {
            const open = unreleased()
            // Biased toward the newest parked fetch — only the current run
            // can deliver, and delivered 304s need it (freshness-model
            // calibration lesson).
            const rec = rand() < 0.65
                ? open[open.length - 1]
                : open[Math.floor(rand() * open.length)]
            const delivers = rec.id === controller.runId
            const is304 = rec.inm !== undefined && rec.inm === serverEtag
            rec.release()
            if (!delivers) {
                comboTally.dropped++
                trace.push(`A${rec.id}✗dropped`)
                flags.missed = true
            } else if (is304) {
                comboTally.s304++
                trace.push(`A${rec.id}✓304`)
                flags.missed = false
                if (inflight.length === 0) {
                    flags.stale = false; flags.syncErr = false
                    flags.deferred = false; flags.advanced = true
                    deferredSource = null
                    oSnap = true
                    // The 304 arm re-saves with the validator pair AT SAVE
                    // TIME — a confirm may have dropped the one the request
                    // carried, and then the envelope pairs rows with null.
                    lastSaved = {
                        rows: visibleRows(),
                        etag: oEtag !== undefined ? oEtag : null,
                        etagUrl: oEtag !== undefined ? URL : null
                    }
                } else {
                    // "Nothing changed" cannot report fresh over pending
                    // optimistic state: the confirm defers, nothing saves.
                    // A 304 carries no body, so it cannot un-taint a
                    // standing stream/reconcile deferral — 'fetch' only
                    // when this is the first deferring arrival.
                    comboTally.deferred304++
                    if (!flags.deferred) deferredSource = 'fetch'
                    flags.deferred = true
                }
            } else {
                comboTally.s200++
                trace.push(`A${rec.id}✓200`)
                oracle.serverSync([...serverRows.values()])
                oEtag = serverEtag   // a delivered 200 arms the validator even mid-writes
                flags.missed = false
                if (inflight.length === 0) {
                    flags.stale = false; flags.syncErr = false
                    flags.deferred = false; flags.advanced = true
                    deferredSource = null
                    oSnap = true
                    lastSaved = { rows: visibleRows(), etag: serverEtag, etagUrl: URL }
                } else {
                    flags.deferred = true
                    deferredSource = 'fetch'
                }
            }
            return trace[trace.length - 1]
        }

        const EVENTS = 24
        for (let ev = 0; ev < EVENTS; ev++) {
            const canSettle = inflight.length > 0
            const canRelease = unreleased().length > 0
            const healthy = !es.dead && !es.hadError
            const roll = rand()
            if (roll < 0.06) {
                // Pure server-side change: content + validator move, no
                // engine interaction (a later conditional answers 200).
                mutateField('C')
                await check(`content ${trace[trace.length - 1]}`)
                continue
            }
            if (roll < 0.14) {
                // Out-of-band arrival BEGINS: content changed AND the
                // change signal fires — the catch-up parks.
                mutateField('S')
                promises.push(h.invalidate().catch(() => {}))
                spawnedFetch()
                await check(`begin_sync ${trace[trace.length - 1]}`)
                continue
            }
            if (roll < 0.34 && canRelease) {
                const l = releaseOne()
                await check(`release ${l}`)
                continue
            }
            if (roll < 0.40) {
                trace.push('F')
                window.dispatchEvent(new Event('focus'))
                spawnedFetch()
                await check('focus')
                continue
            }
            if (roll < 0.44) {
                trace.push('N')
                window.dispatchEvent(new Event('online'))
                spawnedFetch()
                await check('reconnect')
                continue
            }
            if (roll < 0.52 && healthy) {
                // Stream push: newest truth, gently applied, claim-honored;
                // bumps runId; the persist save DEFERS while writes pend.
                mutateField('P')
                const pushed = [...serverRows.values()].map(r => Object.assign({}, r))
                vCounter++   // mirror the push's runId bump
                FakeEventSource.instances[esCount - 1].onmessage({ data: JSON.stringify(pushed) })
                comboTally.pushes++
                oracle.serverSync(pushed)
                flags.missed = false
                if (inflight.length === 0) {
                    flags.stale = false; flags.syncErr = false
                    flags.deferred = false; flags.advanced = true
                    deferredSource = null
                    lastSaved = { rows: visibleRows(), etag: null, etagUrl: null }
                } else {
                    comboTally.pushesDeferred++
                    flags.deferred = true
                    deferredSource = 'stream'
                }
                await check(`sse_push ${trace[trace.length - 1]}`)
                continue
            }
            if (roll < 0.56 && healthy) {
                trace.push('SI')
                comboTally.invalidations++
                FakeEventSource.instances[esCount - 1].onmessage({ data: '' })
                spawnedFetch()
                await check('sse_invalidate')
                continue
            }
            if (roll < 0.60 && !es.dead) {
                FakeEventSource.instances[esCount - 1].onerror()
                es.hadError = true
                flags.syncErr = true; flags.stale = true
                comboTally.transients++
                trace.push('E~')
                await check('sse_error_transient')
                continue
            }
            if (roll < 0.64 && !es.dead && es.hadError) {
                es.hadError = false
                flags.syncErr = false
                trace.push('O')
                FakeEventSource.instances[esCount - 1].onopen()
                spawnedFetch()
                await check('sse_reopen')
                continue
            }
            if (roll < 0.68 && !es.dead) {
                const inst = FakeEventSource.instances[esCount - 1]
                inst.readyState = 2
                inst.onerror()
                es.dead = true; es.hadError = true
                flags.syncErr = true; flags.stale = true
                comboTally.deaths++
                trace.push('E✗dead')
                await check('sse_dead')
                continue
            }
            const unclaimedAlive = [...oracle.alive].filter(id =>
                Object.keys(oracle.overlays.get(id)).length === 0)
            if (roll < 0.74 && oracle.alive.size > 1 && unclaimedAlive.length > 0) {
                const id = unclaimedAlive[Math.floor(rand() * unclaimedAlive.length)]
                const w = writeSeq + 1   // the to: callback assigns the real w
                trace.push(`D${w}:${id}`)
                oracle.delete(w, id)
                flags.stale = true
                vCounter++   // mirror the write's runId bump
                promises.push(h.write({ id, gone: true }).catch(() => {}))
                await check(`delete ${trace[trace.length - 1]}`)
                continue
            }
            if (!canSettle || roll < 0.87) {
                const aliveNow = [...oracle.alive]
                const id = aliveNow[Math.floor(rand() * aliveNow.length)]
                const field = FIELDS[Math.floor(rand() * FIELDS.length)]
                const value = 'v' + Math.floor(rand() * 3)
                const partial = { id, [field]: value }
                trace.push(`W${writeSeq + 1}:${id}.${field}=${value}`)
                oracle.write(writeSeq + 1, id, partial)
                flags.stale = true
                vCounter++   // mirror the write's runId bump
                promises.push(h.write(partial).catch(() => {}))
                await check(`write ${trace[trace.length - 1]}`)
            } else {
                const burst = Math.min(inflight.length, 1 + Math.floor(rand() * 3))
                const labels = []
                for (let b = 0; b < burst; b++) labels.push(settleOne())
                await check(`settle burst [${labels.join(' ')}]`)
            }
        }
        // Drain: settle every write and release every held fetch —
        // including catch-ups spawned during the drain — checking each.
        while (inflight.length > 0 || unreleased().length > 0) {
            if (inflight.length > 0 && (unreleased().length === 0 || rand() < 0.5)) {
                const l = settleOne()
                await check(`drain ${l}`)
            } else {
                const l = releaseOne()
                await check(`drain ${l}`)
            }
        }
        await Promise.all(promises)
        expect(controller.fieldClaims.size, `combo claims drained: seed ${seed}`).toBe(0)
        expect(controller.pendingWrites, `combo pendingWrites drained: seed ${seed}`).toBe(0)
        expect(controller.inflightWrites.size, `combo inflightWrites drained: seed ${seed}`).toBe(0)
        expect(controller.rowClaims.size, `combo rowClaims drained: seed ${seed}`).toBe(0)
        expect(controller.runId, `combo runId drained: seed ${seed}`).toBe(vCounter)
    }

    // Seeds picked by calibration (2026-08-29): 251 and 4093 walk the
    // stream-deferred reject-drain save (the fixed path the hygiene pin
    // covers directly); 3671 and 121393 produce deferred 304s; 127 and
    // 16381 top up transient-error and invalidation coverage.
    for (const seed of [31, 127, 251, 613, 2999, 3671, 4093, 7549, 7919, 16381, 104729, 121393]) {
        it(`combo interleaving holds the write × freshness model (seed ${seed})`, async () => {
            await runComboSequence(seed)
        })
    }

    // Vacuous-pass guard for the combo tier.
    it('the combo generator exercised every crossing', () => {
        expect(comboTally.s200, 'combo 200s delivered').toBeGreaterThanOrEqual(15)
        expect(comboTally.s304, 'combo 304s delivered').toBeGreaterThanOrEqual(5)
        expect(comboTally.deferred304, '304s delivered mid-write (confirm deferred)').toBeGreaterThanOrEqual(2)
        expect(comboTally.dropped, 'combo drops by supersession').toBeGreaterThanOrEqual(30)
        expect(comboTally.pushes, 'combo stream pushes').toBeGreaterThanOrEqual(12)
        expect(comboTally.pushesDeferred, 'pushes with writes pending (deferred saves)').toBeGreaterThanOrEqual(10)
        expect(comboTally.invalidations, 'combo stream invalidations').toBeGreaterThanOrEqual(3)
        expect(comboTally.transients, 'combo transient stream errors').toBeGreaterThanOrEqual(5)
        expect(comboTally.revives, 'combo dead-stream reopens').toBeGreaterThanOrEqual(8)
        expect(comboTally.catchups, 'combo drain catch-ups').toBeGreaterThanOrEqual(6)
        expect(comboTally.drainConfirmSaves, 'drain-by-confirm envelope saves').toBeGreaterThanOrEqual(6)
        expect(comboTally.rejectDrainSaves, 'drain-by-rejection held-confirm saves').toBeGreaterThanOrEqual(4)
        expect(comboTally.rejectDrainSavesStream, 'stream-deferred reject-drain saves (the pinned hygiene path)').toBeGreaterThanOrEqual(1)
    })
})
