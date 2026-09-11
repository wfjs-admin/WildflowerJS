/**
 * Where a rejected delete puts the row back.
 *
 * The delete pre-image captures every FIELD of the removed row but never its
 * position, and the patch merge appends any key it does not already hold, so a
 * restored row landed at the bottom of the list regardless of where it had
 * been. Reported from the optimistic-tasks demo: arm "reject the next write",
 * delete a row, watch it reappear last.
 *
 * A default sort is not the explanation. Sorting a query's rows in place is an
 * external write to a query-owned store (WF-950); the sanctioned form is a
 * derived view, which leaves store.rows in engine order and would merely mask
 * a wrong underlying order.
 *
 * The rule these pins hold to:
 *   - nothing arrived while the write was in flight, so the saved index is
 *     still true: restore exactly there.
 *   - a server arrival replaced the rows mid-flight, so the saved index
 *     describes an order that no longer exists: restore the row and let a
 *     revalidation settle its position rather than inventing one.
 *
 * Peer survey (2026-08-30) found all four majors preserve position, none by
 * tracking an index: TanStack and SWR restore a whole previous value, Apollo
 * discards an optimistic layer, RTK applies Immer inverse patches. None faces
 * index staleness because none of them leaves the prior state behind. Our
 * field-level claims registry does, which is what buys overlapping-write
 * rollback and what makes position something we have to carry ourselves.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-delpos-${++seq}`

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

const THREE = [
    { id: 1, title: 'first' },
    { id: 2, title: 'second' },
    { id: 3, title: 'third' }
]

suite('rejected delete: where the row comes back', () => {
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

    const titles = () => Array.from(container.querySelectorAll('.row')).map(el => el.textContent)

    async function setup(q, c, pending) {
        window.fetch = async () => jsonResponse(THREE)
        wildflower.query(q, {
            from: '/api/todos', key: 'id', deleted: 'gone',
            to: () => { const d = deferred(); pending.push(d); return d.promise }
        })
        mountList(q, c)
        await settle()
    }

    it('a rejected middle delete restores the row to its own position', async () => {
        const q = uname('q'); const c = uname('c'); const pending = []
        await setup(q, c, pending)
        const h = wildflower.getQuery(q)
        expect(titles()).toEqual(['first', 'second', 'third'])

        const p = h.write({ id: 2, gone: true })
        p.catch(() => {})
        await settle()
        expect(titles()).toEqual(['first', 'third'])

        pending[0].reject(new Error('nope'))
        await settle()

        expect(titles()).toEqual(['first', 'second', 'third'])
        expect(h.rows.map(r => r.id)).toEqual([1, 2, 3])
    })

    it('a rejected first-row delete restores at the head, not the tail', async () => {
        const q = uname('q'); const c = uname('c'); const pending = []
        await setup(q, c, pending)
        const h = wildflower.getQuery(q)

        const p = h.write({ id: 1, gone: true })
        p.catch(() => {})
        await settle()
        expect(titles()).toEqual(['second', 'third'])

        pending[0].reject(new Error('nope'))
        await settle()

        expect(titles()).toEqual(['first', 'second', 'third'])
    })

    it('the restored row keeps its fields, not only its slot', async () => {
        const q = uname('q'); const c = uname('c'); const pending = []
        await setup(q, c, pending)
        const h = wildflower.getQuery(q)

        h.write({ id: 2, gone: true }).catch(() => {})
        await settle()
        pending[0].reject(new Error('nope'))
        await settle()

        const row = h.rows.find(r => r.id === 2)
        expect(row.title).toBe('second')
    })

    it('a server arrival mid-flight makes the saved index stale, so position is not invented', async () => {
        const q = uname('q'); const c = uname('c'); const pending = []
        await setup(q, c, pending)
        const h = wildflower.getQuery(q)

        h.write({ id: 2, gone: true }).catch(() => {})
        await settle()

        // The server reorders and adds a row while the delete is in flight. It
        // still carries id 2, because it has not accepted the delete (it is
        // about to reject it); the pending delete's claim on that row's absence
        // is what keeps it off screen meanwhile.
        window.fetch = async () => jsonResponse([
            { id: 3, title: 'third' },
            { id: 9, title: 'ninth' },
            { id: 1, title: 'first' },
            { id: 2, title: 'second' }
        ])
        await h.refresh()
        await settle()
        expect(titles(), 'the claim holds the row out while the delete pends')
            .toEqual(['third', 'ninth', 'first'])

        pending[0].reject(new Error('nope'))
        await settle()

        // The row comes back, and its slot is the server's to decide rather
        // than an index captured against an order that no longer exists.
        const row = h.rows.find(r => r.id === 2)
        expect(row, 'the rejected delete still restores the row').toBeTruthy()
        expect(row.title).toBe('second')
        expect(h.rows.map(r => r.id)).toEqual([3, 9, 1, 2])
    })
})
