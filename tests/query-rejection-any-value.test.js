/**
 * A source or transport may reject with any value, and the query still
 * settles.
 *
 * The error text was built with String(err), which throws for a value with
 * no prototype (Object.create(null), or an object whose toString is not
 * callable). A function `from` rejecting that way left the query loading
 * forever and turned its refresh promise into an unhandled rejection; a
 * function `to` rejecting that way skipped the rollback, so the optimistic
 * value stayed on screen with no syncError and isStale stuck. The rejection
 * value reaches error or syncError as text whatever its shape, and the
 * write still rolls back and rejects to its caller.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-rv-${++seq}`
const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))

suite('a rejection whose value cannot become a string', () => {
    let container
    let wildflower
    let realFetch
    let origError

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        origError = console.error
        console.error = () => {}   // a function source's failure is logged by design
    })

    afterEach(() => {
        window.fetch = realFetch
        console.error = origError
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mountList(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row"><span data-bind="title"></span></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }
    const dom = () => [...container.querySelectorAll('li.row')].map(li => li.textContent)

    it('a function from rejecting with a null-prototype object ends loading with an error', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: () => Promise.reject(Object.create(null)) })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)
        expect(h.isLoading).toBe(false)
        expect(typeof h.error).toBe('string')
        let rejected = false
        await h.refresh().catch(() => { rejected = true })
        expect(rejected).toBe(false)
    })

    it('a function to rejecting with a null-prototype object rolls back and rejects', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => new Response('[{"id":1,"title":"a"}]', { status: 200 })
        wildflower.query(q, { from: '/api/x', to: () => Promise.reject(Object.create(null)) })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)
        let rejected = false
        await h.write({ id: 1, title: 'optimistic' }).catch(() => { rejected = true })
        await settle()
        expect(rejected).toBe(true)
        expect(dom()).toEqual(['a'])
        expect(typeof h.syncError).toBe('string')
        expect(h.isStale).toBe(false)
    })
})
