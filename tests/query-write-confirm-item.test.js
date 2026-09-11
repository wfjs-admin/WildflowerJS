/**
 * `confirmation` receives the written item as its second argument.
 *
 * An ok response can mean three different things, and which one it means
 * depends on the body, so the decision belongs in the function rather than
 * in the declaration. Returning a record reconciles it; throwing rejects the
 * write and rolls it back. The third answer had no expression: the server
 * accepted the write and sent nothing worth applying, so there is nothing to
 * reconcile and nothing to look up either.
 *
 * With the item in hand, returning it says "the row is what I sent", which
 * is a claim about this one response, checked against the body right where
 * the decision is made:
 *
 *     confirmation: (body, item) => {
 *         if (!body.success) throw new Error(body.error);
 *         return item;
 *     }
 *
 * A 200 carrying `{ success: false }` is the case that rules out deciding
 * this in the declaration: the status alone cannot tell the two apart.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// data-query ships in the full tier only, so every other lane has no engine to
// exercise. Without this gate the file failed all 18 non-full lanes of the
// 21-lane matrix while full stayed green.
const suite = hasFeature('query') ? describe : describe.skip

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
const json = (d) => new Response(JSON.stringify(d), {
    status: 200, headers: { 'Content-Type': 'application/json' }
})

let seq = 0
const uname = (p) => `${p}-ci-${++seq}`

suite('confirmation receives the written item', () => {
    let container, wildflower, realFetch, reads, stored

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        reads = 0
        stored = [{ id: 1, name: 'first', done: false }]
    })

    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    /** Reads count themselves; writes store the change and answer with `answer`. */
    function serve(answer) {
        window.fetch = async (url, init) => {
            const method = (init && init.method) || 'GET'
            if (method === 'GET') { reads++; return json(stored.map(r => ({ ...r }))) }
            const sent = JSON.parse(init.body)
            const row = stored.find(r => r.id === sent.id)
            if (row && answer.success !== false) Object.assign(row, sent)
            return json(answer)
        }
    }

    function mount(q, c) {
        container.innerHTML = `<div data-component="${c}"><ul data-query="${q}"><template><li class="r" data-bind="name"></li></template></ul></div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    const declare = (q, confirmation) => wildflower.query(q, {
        from: '/api/' + q, key: 'id',
        to: '/api/' + q + '/:id', body: (i) => i,
        confirmation
    })

    it('hands the written item over as the second argument', async () => {
        const q = uname('q'), c = uname('c')
        let seen
        serve({ success: true })
        declare(q, (body, item) => { seen = { body, item }; return item })
        mount(q, c)
        await settle()

        await wildflower.getQuery(q).write({ id: 1, done: true })
        await settle()

        expect(seen.body, 'the parsed response body still comes first').toEqual({ success: true })
        expect(seen.item, 'the written item comes second').toEqual({ id: 1, done: true })
    })

    it('returning the item keeps the write and skips the refetch', async () => {
        const q = uname('q'), c = uname('c')
        serve({ success: true })
        declare(q, (body, item) => item)
        mount(q, c)
        await settle()
        const readsAfterLoad = reads

        await wildflower.getQuery(q).write({ id: 1, done: true })
        await settle(250)

        expect(reads, 'no refetch: the response already answered').toBe(readsAfterLoad)
        expect(wildflower.getQuery(q).rows[0].done, 'the written field stands').toBe(true)
        expect(wildflower.getQuery(q).rows[0].name, 'and the rest of the row is untouched').toBe('first')
    })

    it('a 200 carrying success:false still rejects and rolls back', async () => {
        const q = uname('q'), c = uname('c')
        serve({ success: false, error: 'refused' })
        declare(q, (body, item) => {
            if (!body.success) throw new Error(body.error)
            return item
        })
        mount(q, c)
        await settle()

        let rejected = null
        await wildflower.getQuery(q).write({ id: 1, done: true }).catch(e => { rejected = e })
        await settle()

        expect(rejected, 'the body said no').not.toBeNull()
        expect(wildflower.getQuery(q).rows[0].done, 'the optimistic value rolled back').toBe(false)
    })

    it('returning a record still reconciles, and returning nothing still refetches', async () => {
        const q1 = uname('q'), c1 = uname('c')
        serve({ success: true, row: { id: 1, name: 'renamed by server' } })
        declare(q1, (body) => body.row)
        mount(q1, c1)
        await settle()
        let readsBefore = reads
        await wildflower.getQuery(q1).write({ id: 1, done: true })
        await settle(250)
        expect(reads, 'a record needs no refetch').toBe(readsBefore)
        expect(wildflower.getQuery(q1).rows[0].name).toBe('renamed by server')

        // A confirmation that yields nothing keeps the fallback.
        const q2 = uname('q'), c2 = uname('c')
        reads = 0
        stored = [{ id: 1, name: 'first', done: false }]
        serve({ success: true })
        declare(q2, () => undefined)
        mount(q2, c2)
        await settle()
        readsBefore = reads
        await wildflower.getQuery(q2).write({ id: 1, done: true })
        await settle(250)
        expect(reads, 'nothing to apply: the query goes and looks').toBeGreaterThan(readsBefore)
    })

    it('an existing one-argument confirmation is unaffected', async () => {
        const q = uname('q'), c = uname('c')
        serve({ success: true, row: { id: 1, done: true, name: 'first' } })
        declare(q, (body) => body.row)
        mount(q, c)
        await settle()

        await wildflower.getQuery(q).write({ id: 1, done: true })
        await settle()
        expect(wildflower.getQuery(q).rows[0].done).toBe(true)
    })
})
