/**
 * PROBE (2026-08-30): does a rejected create leave an orphan row?
 *
 * QuerySystem's rejected-create branch removes the row only when no OTHER
 * write claims fields on it (:3490-3499, the sole _queryRemoveRow call in the
 * reject path). When another write does claim it, that write's outcome is said
 * to own the row. But if that write ALSO rejects, its reject takes the
 * field-revert branch, because from its issue point the row existed, and the
 * create's row claim has already been released. Nothing is then left to remove
 * a row the server never created.
 *
 * Written because the model oracle learned this rule by copying the engine,
 * which is circular: if the engine leaks here, the model agrees with the leak.
 * This asks the question directly instead.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-orphan-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

async function settle(ms = 100) {
    await new Promise(r => setTimeout(r, ms))
}

suite('rejected create with an overlapping write', () => {
    let container, wildflower, realFetch

    beforeAll(async () => { await loadFramework() })

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

    it('both writes reject: the row the server never created is gone', async () => {
        const q = uname('q'); const c = uname('c'); const pending = []
        window.fetch = async () => jsonResponse([{ id: 1, title: 'one' }])
        wildflower.query(q, {
            from: '/api/rows', key: 'id', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row" data-bind="title"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()
        const h = wildflower.getQuery(q)

        // W1 creates a row the server does not have.
        h.write({ id: 900, title: 'ghost' }).catch(() => {})
        await settle()
        // W2 claims a different field on that same, still-pending, row.
        h.write({ id: 900, note: 'n' }).catch(() => {})
        await settle()
        const afterBoth = h.rows.map(r => r.id)

        pending[0].reject(new Error('create refused'))
        await settle()
        const afterCreateReject = h.rows.map(r => r.id)

        pending[1].reject(new Error('edit refused'))
        await settle()

        expect({
            afterBoth,
            // The create's rejection alone must NOT drop the row: the later
            // write still owns fields on it and its outcome decides.
            afterCreateReject,
            // Once that write also rejects, nothing the server ever
            // acknowledged remains, so the row must go.
            final: h.rows.map(r => r.id),
            domRows: container.querySelectorAll('.row').length
        }).toEqual({ afterBoth: [1, 900], afterCreateReject: [1, 900], final: [1], domRows: 1 })
    })

    it('the claiming write CONFIRMING keeps the row: the server knows it now', async () => {
        const q = uname('q'); const c = uname('c'); const pending = []
        window.fetch = async () => jsonResponse([{ id: 1, title: 'one' }])
        wildflower.query(q, {
            from: '/api/rows', key: 'id', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row" data-bind="title"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()
        const h = wildflower.getQuery(q)

        h.write({ id: 900, title: 'ghost' }).catch(() => {})
        await settle()
        h.write({ id: 900, note: 'n' }).catch(() => {})
        await settle()

        pending[0].reject(new Error('create refused'))
        await settle()
        pending[1].resolve({ id: 900, title: 'ghost', note: 'n' })
        await settle()

        // A confirm means the server acknowledged the row, so it stays even
        // though the create that introduced it was refused.
        expect(h.rows.map(r => r.id)).toEqual([1, 900])
    })

    // Found by a lifecycle sweep of the registry maps (what creates an entry,
    // what removes it, is there a path that creates without removing). The
    // unacknowledged-create debt is discharged in the ordinary-reject branch
    // and in the create-reject branch, but NOT in the delete-reject branch —
    // and a delete is a perfectly good way to claim an optimistic row.
    it('a rejected delete on an unacknowledged row does not resurrect an orphan', async () => {
        const q = uname('q'); const c = uname('c'); const pending = []
        window.fetch = async () => jsonResponse([{ id: 1, title: 'one' }])
        wildflower.query(q, {
            from: '/api/rows', key: 'id', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row" data-bind="title"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()
        const h = wildflower.getQuery(q)

        // W1 introduces the row optimistically; the server never sees it.
        h.write({ id: 900, title: 'ghost' }).catch(() => {})
        await settle()
        // W2 deletes that same optimistic row, claiming its tombstone field.
        h.write({ id: 900, gone: true }).catch(() => {})
        await settle()

        // The create is refused, but W2 claims the row, so it survives (hidden
        // by the pending delete) and the debt passes to W2.
        pending[0].reject(new Error('create refused'))
        await settle()

        // W2 is refused too. Its rollback restores the row it had hidden — but
        // nothing ever made the server acknowledge that row, so restoring it
        // would put an orphan back on screen.
        pending[1].reject(new Error('delete refused'))
        await settle()

        expect(h.rows.map(r => r.id), 'the row the server never created stays gone').toEqual([1])
        expect(container.querySelectorAll('.row').length).toBe(1)
    })
})
