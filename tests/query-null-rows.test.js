/**
 * A null entry in a list response does not take the list down with it.
 *
 * Rows were stored exactly as they arrived, so a response (or a persisted
 * snapshot) such as [null, { id: 2, ... }] reached the list renderer, whose
 * first field read threw. On a first load nothing rendered, the good rows
 * included. On a refresh over existing data the store reported a clean,
 * fresh sync while the screen kept the previous rows, presenting stale
 * data as current. A null or undefined entry carries no row, so ingest
 * drops it and the other rows render.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-nr-${++seq}`
const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))

suite('a null entry in a list response', () => {
    let container
    let wildflower
    let realFetch
    let keys

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        keys = []
    })

    afterEach(() => {
        window.fetch = realFetch
        for (const k of keys) localStorage.removeItem(k)
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

    it('a first load renders the rows beside the null', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => new Response('[null,{"id":2,"title":"b"},null]', { status: 200 })
        wildflower.query(q, { from: '/api/x' })
        mountList(q, c)
        await settle()
        expect(dom()).toEqual(['b'])
        expect(wildflower.getQuery(q).rows.length).toBe(1)
    })

    it('a refresh never leaves the previous rows on screen beside a fresh sync', async () => {
        const q = uname('q'); const c = uname('c')
        let n = 0
        window.fetch = async () => new Response(n++ === 0
            ? '[{"id":1,"title":"a"}]'
            : '[null,{"id":2,"title":"b"}]', { status: 200 })
        wildflower.query(q, { from: '/api/x' })
        mountList(q, c)
        await settle()
        await wildflower.getQuery(q).refresh()
        await settle()
        expect(wildflower.getQuery(q).isStale).toBe(false)
        expect(dom()).toEqual(['b'])
    })

    it('a restored snapshot holding a null renders its other rows', async () => {
        const q = uname('q'); const c = uname('c'); const k = 'wf:query:' + q
        keys.push(k)
        localStorage.setItem(k, JSON.stringify({ v: 1, rows: [null, { id: 1, title: 'a' }], savedAt: Date.now() }))
        window.fetch = () => new Promise(() => {})
        wildflower.query(q, { from: '/api/x', persist: true })
        mountList(q, c)
        await settle()
        expect(dom()).toEqual(['a'])
    })
})
