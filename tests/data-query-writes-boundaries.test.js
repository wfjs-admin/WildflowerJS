/**
 * Boundary intersections for declarative writes (hardening investigation
 * C, 2026-08-16): two pieces of
 * documented machinery cross the write feature untested.
 *
 * 1. SSR-adopted rows × writes. Adoption seeds rows with lastSync ===
 *    null; activation fires a catch-up fetch. A write supersedes that
 *    catch-up (runId bump), so the write's settle is what decides how
 *    the store ever gets validated: the first-load recovery must fire
 *    on BOTH settle arms (reject: pinned by writes test 28; confirm:
 *    pinned here — a reconcile stamps lastSync and would otherwise
 *    silently discard the interrupted first load).
 *
 * 2. Action-replay queue × writes. Actions fired before init are queued
 *    and replayed after init; a data-action calling write() must land
 *    exactly once, through the same settle discipline.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-dqwb-${++seq}`

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

suite('data-query writes — boundary intersections', () => {
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

    // Adopted list: two server-rendered rows, keyed by rendered sku.
    // Every fetch is held in `releases` so the test controls delivery.
    function mountAdopted(q, c, extra = '') {
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <table><tbody data-query="${q}"${extra}>
                    <template>
                        <tr><td class="sku" data-bind="sku"></td><td class="stock" data-bind="stock" data-type="number"></td></tr>
                    </template>
                    <tr><td class="sku" data-bind="sku">AX-100</td><td class="stock" data-bind="stock" data-type="number">45</td></tr>
                    <tr><td class="sku" data-bind="sku">BX-200</td><td class="stock" data-bind="stock" data-type="number">12</td></tr>
                </tbody></table>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    // C1 — adopted rows, write UPDATE, CONFIRM arm. The write supersedes
    // the adoption catch-up fetch, so its confirming settle must recover
    // the interrupted first load: the OTHER adopted row is still parsed
    // display text the server never validated.
    it('adopted rows: a confirming write recovers the superseded catch-up fetch', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/inventory', key: 'sku',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountAdopted(q, c)
        await settle(40)

        const h = wildflower.getQuery(q)
        expect(h.rows.map(r => r.stock), 'adopted from the DOM').toEqual([45, 12])
        expect(h.lastSync, 'seeded, never synced').toBe(null)
        expect(releases.length, 'adoption catch-up in flight').toBe(1)

        const p = h.write({ sku: 'AX-100', stock: 99 })
        await settle(20)
        expect(h.rows.find(r => r.sku === 'AX-100').stock, 'optimistic').toBe(99)

        // The superseded catch-up delivers and must be discarded.
        releases[0]([{ sku: 'AX-100', stock: 40 }, { sku: 'BX-200', stock: 7 }])
        await settle(20)
        expect(h.rows.find(r => r.sku === 'AX-100').stock, 'discarded arrival never lands').toBe(99)
        expect(h.rows.find(r => r.sku === 'BX-200').stock).toBe(12)

        pending[0].resolve({ sku: 'AX-100', stock: 99 })
        await p
        await settle(20)
        expect(releases.length, 'the confirm recovers the interrupted first load').toBe(2)

        releases[1]([{ sku: 'AX-100', stock: 99 }, { sku: 'BX-200', stock: 7 }])
        await settle(20)
        expect(h.rows.find(r => r.sku === 'BX-200').stock, 'the other adopted row is validated').toBe(7)
        expect(h.rows.find(r => r.sku === 'AX-100').stock).toBe(99)
        expect(h.lastSync).not.toBe(null)
        expect(h.isStale).toBe(false)

        const controller = wildflower._queryControllers.get(q)
        expect(controller.fieldClaims.size).toBe(0)
        expect(controller.pendingWrites).toBe(0)
        expect(controller.rowClaims.size).toBe(0)
    })

    // C2 — adopted rows, write UPDATE, REJECT arm (the survey doc's
    // "correct, but unpinned" path): rollback restores the DOM-parsed
    // value, then the first-load recovery delivers truth.
    it('adopted rows: a rejected write rolls back to parsed values, then recovery delivers truth', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/inventory', key: 'sku',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountAdopted(q, c)
        await settle(40)
        const h = wildflower.getQuery(q)

        const p = h.write({ sku: 'AX-100', stock: 99 })
        await settle(20)

        pending[0].reject(new Error('409'))
        await expect(p).rejects.toThrow('409')
        await settle(20)
        expect(h.rows.find(r => r.sku === 'AX-100').stock, 'rolled back to the parsed value').toBe(45)
        expect(h.syncError, 'reported while recovery runs').toBeTruthy()
        expect(releases.length, 'rejection recovers the first load (writes test 28 class)').toBe(2)

        releases[1]([{ sku: 'AX-100', stock: 40 }, { sku: 'BX-200', stock: 7 }])
        await settle(20)
        expect(h.rows.map(r => r.stock), 'recovery delivers truth').toEqual([40, 7])
        expect(h.syncError, 'the confirming recovery clears the transient error').toBe(null)
        expect(h.isLoading).toBe(false)
        expect(h.isStale).toBe(false)
    })

    // C3 — adopted store, CREATE, confirm arm: the new row reconciles
    // under the server record, no duplicate against the adopted rows,
    // and the recovery validates the rest.
    it('adopted rows: a confirmed create lands once and the store still gets validated', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/inventory', key: 'sku',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountAdopted(q, c)
        await settle(40)
        const h = wildflower.getQuery(q)

        const p = h.write({ sku: 'CX-300', stock: 5 })
        await settle(20)
        expect(h.rows.length, 'optimistic create appends').toBe(3)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.rowClaims.size, 'existence claim held').toBe(1)

        pending[0].resolve({ sku: 'CX-300', stock: 5 })
        await p
        await settle(20)
        expect(h.rows.filter(r => r.sku === 'CX-300').length, 'no duplicate').toBe(1)
        expect(controller.rowClaims.size, 'existence claim released').toBe(0)
        expect(releases.length, 'the confirm recovers the interrupted first load').toBe(2)

        releases[1]([{ sku: 'AX-100', stock: 40 }, { sku: 'BX-200', stock: 7 }, { sku: 'CX-300', stock: 5 }])
        await settle(20)
        expect(h.rows.map(r => r.stock).sort((a, b) => a - b), 'full truth lands, create included')
            .toEqual([5, 7, 40])
        expect(controller.fieldClaims.size).toBe(0)
        expect(controller.pendingWrites).toBe(0)
    })

    // C4 — adopted store, tombstone DELETE, reject arm: the row restores
    // from registry pre-images (the parsed values), and recovery then
    // delivers truth.
    it('adopted rows: a rejected delete restores the parsed row, then recovery delivers truth', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/inventory', key: 'sku', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountAdopted(q, c)
        await settle(40)
        const h = wildflower.getQuery(q)

        const p = h.write({ sku: 'AX-100', gone: true })
        await settle(20)
        expect(h.rows.length, 'optimistic delete removes').toBe(1)
        expect(h.rows.some(r => r.sku === 'AX-100')).toBe(false)

        pending[0].reject(new Error('403'))
        await expect(p).rejects.toThrow('403')
        await settle(20)
        const restored = h.rows.find(r => r.sku === 'AX-100')
        expect(restored, 'rejected delete restores the row').toBeTruthy()
        expect(restored.stock, 'restored with the parsed value').toBe(45)
        expect(releases.length, 'rejection recovers the first load').toBe(2)

        releases[1]([{ sku: 'AX-100', stock: 40 }, { sku: 'BX-200', stock: 7 }])
        await settle(20)
        expect(h.rows.map(r => r.stock)).toEqual([40, 7])
        const controller = wildflower._queryControllers.get(q)
        expect(controller.rowClaims.size).toBe(0)
        expect(controller.fieldClaims.size).toBe(0)
    })

    // C5 — action-replay × write racing the first load. A click in the
    // same task as mount queues (init has not run); the replay executes
    // the write EXACTLY once. The write supersedes the in-flight first
    // load, so its confirm must recover it (same asymmetry as C1, via
    // the replay window).
    it('a data-action write fired before init lands once; its confirm recovers the first load', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        const toCalls = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: (item) => {
                toCalls.push(Object.assign({}, item))
                const d = deferred(); pending.push(d); return d.promise
            }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <button class="save" data-action="save">save</button>
                <ul data-query="${q}"><template><li class="row" data-bind="title"></li></template></ul>
            </div>
        `
        const saves = []
        wildflower.component(c, {
            state: {},
            save() {
                saves.push('ran')
                return wildflower.getQuery(q).write({ id: 1, title: 'clicked' }).catch(() => {})
            }
        })
        wildflower.scan(container)
        // Same task as mount: init has not run yet, so this queues.
        container.querySelector('.save').click()
        expect(saves.length, 'the action is queued, not run synchronously').toBe(0)
        await settle(40)

        expect(saves.length, 'replayed exactly once').toBe(1)
        expect(toCalls.length, 'one write reaches the transport').toBe(1)
        const h = wildflower.getQuery(q)
        expect(h.rows.find(r => r.id === 1).title, 'optimistic value visible').toBe('clicked')

        pending[0].resolve({ id: 1, title: 'clicked', done: false })
        await settle(20)
        expect(releases.length, 'the confirm recovers the superseded first load').toBe(2)

        releases[1]([{ id: 1, title: 'clicked', done: false }, { id: 2, title: 'other', done: true }])
        await settle(20)
        expect(h.rows.length, 'the full first load lands').toBe(2)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.fieldClaims.size).toBe(0)
        expect(controller.pendingWrites).toBe(0)
        expect(controller.rowClaims.size).toBe(0)
    })

    // C6 — the reject arm through the replay window: the write lands
    // once, rejection reports, and the existing first-load recovery
    // (writes test 28) covers the replay crossing too.
    it('a data-action write fired before init: rejection reports and recovers the first load', async () => {
        const q = uname('q'); const c = uname('c')
        const releases = []
        window.fetch = () => new Promise(res => { releases.push((data) => res(jsonResponse(data))) })
        const pending = []
        wildflower.query(q, {
            from: '/api/todos', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <button class="save" data-action="save">save</button>
                <ul data-query="${q}"><template><li class="row" data-bind="title"></li></template></ul>
            </div>
        `
        const saves = []
        wildflower.component(c, {
            state: {},
            save() {
                saves.push('ran')
                return wildflower.getQuery(q).write({ id: 1, title: 'clicked' }).catch(() => {})
            }
        })
        wildflower.scan(container)
        container.querySelector('.save').click()
        await settle(40)
        expect(saves.length, 'replayed exactly once').toBe(1)
        const h = wildflower.getQuery(q)

        pending[0].reject(new Error('409'))
        await settle(20)
        expect(h.syncError, 'the rejection is reported').toBeTruthy()
        expect(h.rows.some(r => r.id === 1), 'the optimistic create rolls back out').toBe(false)
        expect(releases.length, 'rejection recovers the first load').toBe(2)

        releases[1]([{ id: 2, title: 'other', done: true }])
        await settle(20)
        expect(h.rows.length, 'the first load lands').toBe(1)
        expect(h.rows[0].title).toBe('other')
        expect(h.syncError, 'the confirming recovery clears the transient error').toBe(null)
        expect(h.isLoading).toBe(false)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.pendingWrites).toBe(0)
        expect(controller.fieldClaims.size).toBe(0)
    })

    // D — the multi-query entity boundary (investigation D). Queries are
    // deliberately independent stores: the same server entity in two
    // queries is two rows with independent claims. A write through one
    // leaves the other's copy alone until that query syncs; the
    // documented pattern (invalidate the sibling) converges them. This
    // pins the boundary so a future shared-entity idea has to knowingly
    // change a test, not drift into the Apollo normalization bug family.
    it('two queries over the same entity: a write through one leaves the other alone until its own sync', async () => {
        const qa = uname('qa'); const qb = uname('qb'); const c = uname('c')
        let serverRow = { id: 1, name: 'v0', qty: 2 }
        window.fetch = async () => jsonResponse([Object.assign({}, serverRow)])
        const pending = []
        wildflower.query(qa, {
            from: '/api/detail', key: 'id',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        wildflower.query(qb, { from: '/api/list', key: 'id' })
        container.innerHTML = `
            <div data-component="${c}">
                <ul class="la" data-query="${qa}"><template><li data-bind="name"></li></template></ul>
                <ul class="lb" data-query="${qb}"><template><li data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(60)

        const ha = wildflower.getQuery(qa)
        const hb = wildflower.getQuery(qb)
        expect(ha.rows[0].name).toBe('v0')
        expect(hb.rows[0].name).toBe('v0')
        // Two copies, not one shared record.
        expect(wildflower.toRaw(ha.rows[0]), 'independent copies')
            .not.toBe(wildflower.toRaw(hb.rows[0]))

        const p = ha.write({ id: 1, name: 'v1' })
        await settle(20)
        expect(ha.rows[0].name, 'A shows the optimistic value').toBe('v1')
        expect(hb.rows[0].name, "B's copy is untouched").toBe('v0')
        expect(container.querySelector('.la li').textContent).toBe('v1')
        expect(container.querySelector('.lb li').textContent).toBe('v0')
        expect(wildflower._queryControllers.get(qb).fieldClaims.size,
            "B carries none of A's claims").toBe(0)

        serverRow = { id: 1, name: 'v1', qty: 2 }
        pending[0].resolve(Object.assign({}, serverRow))
        await p
        await settle(20)
        expect(ha.rows[0].name).toBe('v1')
        expect(hb.rows[0].name, 'confirmed truth still does not cross the boundary').toBe('v0')

        // The documented pattern: invalidate the sibling to converge now.
        await hb.invalidate()
        await settle(20)
        expect(hb.rows[0].name, 'B converges on its own sync').toBe('v1')
        expect(container.querySelector('.lb li').textContent).toBe('v1')
        const ca = wildflower._queryControllers.get(qa)
        expect(ca.fieldClaims.size).toBe(0)
        expect(ca.pendingWrites).toBe(0)
    })
})
