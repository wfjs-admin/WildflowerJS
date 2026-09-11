/**
 * Server-assigned keys: a create sent with a client temp id that the server
 * confirms under a DIFFERENT, real id.
 *
 * The engine has full machinery for this (_queryRenameRowKey, keyAliases, and
 * a rekey pass over claims / inflightWrites pre-images / rowClaims), but the
 * model suite asserts keyAliases stays EMPTY at every check, so it does not
 * merely skip renaming, it pins that renaming never happens. Nothing else
 * exercised the path either. That combination is how an unexamined assumption
 * hides, which the rejected-create orphan just demonstrated.
 *
 * Written specifically to check the rekey pass against state added the same
 * day: deletePositions is keyed by writeId and unaffected, but unackedRows is
 * keyed by ROW KEY and looked like it had to travel with the rename.
 *
 * IT DOES NOT, and the reason is ORDERING rather than design. Both live in
 * onResolve: the unackedRows delete runs early (~:3291), the rename block much
 * later (~:3426). At delete time no alias exists yet, so kk() still resolves to
 * the temp key and clears the right entry. Correct by sequence, not by
 * construction, which is exactly the kind of thing that breaks silently when
 * someone moves a block. These pins exist to make that move fail loudly, and to
 * give the rename path its first coverage of any kind.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-svrkey-${++seq}`

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

suite('server-assigned keys', () => {
    let container, wildflower, realFetch, controllerOf

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        controllerOf = (q) => wildflower._queryControllers.get(q)
    })

    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mount(q, c, pending) {
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
    }

    it('a confirm under a new id renames the row in place', async () => {
        const q = uname('q'); const c = uname('c'); const pending = []
        mount(q, c, pending)
        await settle()
        const h = wildflower.getQuery(q)

        h.write({ id: 'tmp-1', title: 'draft' }).catch(() => {})
        await settle()
        expect(h.rows.map(r => r.id)).toEqual([1, 'tmp-1'])

        pending[0].resolve({ id: 42, title: 'draft' })
        await settle()

        // The row keeps its slot and takes the server's key.
        expect(h.rows.map(r => r.id)).toEqual([1, 42])
        expect(h.rows.find(r => r.id === 42).title).toBe('draft')
    })

    it('the rename leaves no bookkeeping behind under the old key', async () => {
        const q = uname('q'); const c = uname('c'); const pending = []
        mount(q, c, pending)
        await settle()
        const h = wildflower.getQuery(q)
        const ctl = controllerOf(q)

        h.write({ id: 'tmp-2', title: 'draft' }).catch(() => {})
        await settle()
        // The create is optimistic, so the row carries an unacknowledged debt.
        expect(ctl.unackedRows && ctl.unackedRows.has('tmp-2'), 'debt recorded under the temp key').toBe(true)

        pending[0].resolve({ id: 77, title: 'draft' })
        await settle()

        // Every per-row map must travel with the rename or drain on the
        // confirm. A leftover entry under the temp key is a leak, and worse if
        // a later key ever collides with it.
        expect(ctl.unackedRows ? [...ctl.unackedRows] : [], 'no stale debt under the old key').toEqual([])
        expect(ctl.rowClaims.has('tmp-2'), 'no stale row claim').toBe(false)
        expect(ctl.keyAliases.size, 'aliases drain once nothing is in flight').toBe(0)
    })
})
