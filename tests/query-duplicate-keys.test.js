/**
 * A response that repeats a row key never leaves the screen out of step
 * with the store.
 *
 * Appended pages and patches already keep one row per key, but a plain read
 * stored its rows exactly as they arrived. A response with two rows keyed 1
 * rendered both, and on the next read (one row keyed 1) the keyed list kept
 * one of the old copies on screen: the store held two rows and the page
 * showed three. Whichever copy a read keeps, what renders is what the store
 * holds.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-dk-${++seq}`
const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))

suite('a read that repeats a row key', () => {
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
    const stored = (q) => wildflower.getQuery(q).rows.map(r => r.title)

    it('the screen matches the store across a read with a repeated key and the read after it', async () => {
        const q = uname('q'); const c = uname('c')
        let n = 0
        window.fetch = async () => new Response(n++ === 0
            ? '[{"id":1,"title":"a"},{"id":1,"title":"b"},{"id":2,"title":"c"}]'
            : '[{"id":1,"title":"A"},{"id":2,"title":"C"}]', { status: 200 })
        wildflower.query(q, { from: '/api/x' })
        mountList(q, c)
        await settle()
        expect(dom()).toEqual(stored(q))
        await wildflower.getQuery(q).refresh()
        await settle()
        expect(stored(q)).toEqual(['A', 'C'])
        expect(dom()).toEqual(['A', 'C'])
    })

    it('rows with no key are all kept', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => new Response('[{"title":"a"},{"title":"b"}]', { status: 200 })
        wildflower.query(q, { from: '/api/x' })
        mountList(q, c)
        await settle()
        expect(dom()).toEqual(['a', 'b'])
    })
})
