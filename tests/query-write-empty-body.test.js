/**
 * A successful write whose response carries no body.
 *
 * 204 No Content is the ordinary answer to a DELETE, and plenty of APIs
 * answer a PATCH with 200 and an empty body. When `confirmation` is
 * declared, the write path parses the body to hand it over. An empty body
 * is not JSON, so the parse rejects — and a rejection in that position is
 * indistinguishable from the server refusing the write, so the change rolls
 * back. The write succeeded and the screen says it did not.
 *
 * This is the case an app cannot design around: it does not own the endpoint
 * and cannot make it return a body.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// data-query ships in the full tier only; see the sibling gate in every other
// data-query suite. Ungated, this file failed all 18 non-full matrix lanes.
const suite = hasFeature('query') ? describe : describe.skip

async function settle(ms = 120) {
    await new Promise(r => setTimeout(r, ms))
}

let seq = 0
const uname = (p) => `${p}-eb-${++seq}`

const jsonResponse = (data) => new Response(JSON.stringify(data), {
    status: 200, headers: { 'Content-Type': 'application/json' }
})

suite('a write whose response has no body', () => {
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

    /**
     * A server that actually stores the write, then answers it with `status`
     * and no body at all. Storing matters: "nothing to apply" means the query
     * refetches, so the row afterwards is whatever the server really holds.
     */
    function serve(writeStatus, rows) {
        const stored = rows.map(r => ({ ...r }))
        window.fetch = async (url, init) => {
            const method = (init && init.method) || 'GET'
            if (method === 'GET') return jsonResponse(stored.map(r => ({ ...r })))
            if (writeStatus < 400 && init && init.body) {
                const sent = JSON.parse(init.body)
                const row = stored.find(r => r.id === sent.id)
                if (row) Object.assign(row, sent)
            }
            return new Response(null, { status: writeStatus })
        }
    }

    function mount(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <ul data-query="${qname}">
                    <template><li class="row" data-bind="name"></li></template>
                </ul>
            </div>`
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    const declare = (q) => wildflower.query(q, {
        from: '/api/' + q,
        key: 'id',
        to: '/api/' + q + '/:id',
        body: (item) => item,
        confirmation: (d) => d && d.row
    })

    it('204 with a declared confirmation must not roll the write back', async () => {
        const q = uname('q'), c = uname('c')
        serve(204, [{ id: 1, name: 'first', done: false }])
        declare(q)
        mount(q, c)
        await settle()
        expect(wildflower.getQuery(q).rows.length, 'rows loaded').toBe(1)

        let rejected = null
        await wildflower.getQuery(q).write({ id: 1, done: true }).catch(e => { rejected = e })
        await settle()

        expect(rejected, 'an empty body is not a rejection: the server accepted the write').toBeNull()
        // Nothing to apply, so the query refetches and the row shows what the
        // server actually stored — which is the write.
        expect(wildflower.getQuery(q).rows[0].done, 'the write stands').toBe(true)
    })

    it('200 with an empty body behaves the same way', async () => {
        const q = uname('q'), c = uname('c')
        serve(200, [{ id: 1, name: 'first', done: false }])
        declare(q)
        mount(q, c)
        await settle()
        expect(wildflower.getQuery(q).rows.length).toBe(1)

        let rejected = null
        await wildflower.getQuery(q).write({ id: 1, done: true }).catch(e => { rejected = e })
        await settle()

        expect(rejected, 'an empty body is not a rejection').toBeNull()
        expect(wildflower.getQuery(q).rows[0].done).toBe(true)
    })

    it('a real rejection still rolls back', async () => {
        const q = uname('q'), c = uname('c')
        serve(500, [{ id: 1, name: 'first', done: false }])
        declare(q)
        mount(q, c)
        await settle()
        expect(wildflower.getQuery(q).rows.length).toBe(1)

        let rejected = null
        await wildflower.getQuery(q).write({ id: 1, done: true }).catch(e => { rejected = e })
        await settle()

        expect(rejected, 'a 500 is still a rejection').not.toBeNull()
        expect(wildflower.getQuery(q).rows[0].done, 'and the optimistic value rolls back').toBe(false)
    })
})
