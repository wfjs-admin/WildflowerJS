/**
 * A $name.path binding keeps its query active while the binding is on the
 * page, whether or not the bound value is changing.
 *
 * The freshness docs list data-bind="$orders.count" as a consumer that
 * "starts the query, and keeps it active while the element is on the page".
 * A $-binding is not a [data-query] element, so it counted as observation
 * only through the read stamp its expression leaves when it is normalized,
 * which happens when the binding is compiled and again only when the bound
 * value changes. Once the source went quiet (304s, identical bodies under a
 * count, a silent stream) the stamp aged past the teardown grace, the next
 * rung firing tore the query down, and later server changes never reached
 * the page: a badge kept showing its old count with isStale false.
 *
 * The other half is pinned too: when the binding really leaves the page,
 * the query still tears down after the grace.
 *
 * Timing: tests shorten the internal teardown grace
 * (wildflower._queryTeardownGraceMs; there is no public option for it).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-shq-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('a $-binding keeps its query active over a quiet source', () => {
    let container
    let wildflower
    let realFetch
    let realWarn

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        realWarn = console.warn
        console.warn = () => {}
        wildflower._queryTeardownGraceMs = 200
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        delete wildflower._queryTeardownGraceMs
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    // First answer is a 200 with an ETag; every later answer is a 304 until
    // serverRows is replaced, which makes the next answer a 200 again.
    function etagServer(initialRows) {
        const s = { calls: 0, rows: initialRows, version: 1, sent: 0 }
        window.fetch = async () => {
            s.calls++
            if (s.sent === s.version) return new Response(null, { status: 304 })
            s.sent = s.version
            return new Response(JSON.stringify(s.rows), { status: 200, headers: { ETag: '"v' + s.version + '"' } })
        }
        s.change = (rows) => { s.rows = rows; s.version++ }
        return s
    }

    function mount(c, markup) {
        container.innerHTML = `<div data-component="${c}">${markup}</div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    it('data-bind="$q.count" keeps polling through 304s and shows the next change', async () => {
        const q = uname('orders'); const c = uname('c')
        const server = etagServer([{ id: 1 }])
        wildflower.query(q, { from: `/api/${q}`, refresh: [0.05] })
        mount(c, `<span class="n" data-bind="$${q}.count"></span>`)
        await settle(150)
        expect(container.querySelector('.n').textContent).toBe('1')

        await settle(800) // four times the grace, all 304s
        const before = server.calls
        server.change([{ id: 1 }, { id: 2 }, { id: 3 }])
        await settle(250)

        expect(server.calls).toBeGreaterThan(before)
        expect(container.querySelector('.n').textContent).toBe('3')
    })

    it('data-list="$q.rows" keeps polling through 304s', async () => {
        const q = uname('orders'); const c = uname('c')
        const server = etagServer([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: `/api/${q}`, refresh: [0.05] })
        mount(c, `<ul data-list="$${q}.rows" data-key="id"><template><li class="row" data-bind="name"></li></template></ul>`)
        await settle(800)
        server.change([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])
        await settle(250)

        expect([...container.querySelectorAll('.row')].map(el => el.textContent)).toEqual(['a', 'b'])
    })

    it('a data-query inside list rows keeps polling through 304s', async () => {
        const q = uname('orders'); const c = uname('c')
        const server = etagServer([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: `/api/${q}`, refresh: [0.05] })
        container.innerHTML = `<div data-component="${c}"><div data-list="groups" data-key="id"><template>` +
            `<section><ul data-query="${q}"><template><li class="row" data-bind="name"></li></template></ul></section>` +
            `</template></div></div>`
        wildflower.component(c, { state: { groups: [{ id: 1 }] } })
        wildflower.scan(container)
        await settle(800)
        server.change([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])
        await settle(250)

        expect([...container.querySelectorAll('.row')].map(el => el.textContent)).toEqual(['a', 'b'])
    })

    it('the query still tears down once the binding has left the page', async () => {
        const q = uname('orders'); const c = uname('c')
        const server = etagServer([{ id: 1 }])
        wildflower.query(q, { from: `/api/${q}`, refresh: [0.05] })
        mount(c, `<span class="n" data-bind="$${q}.count"></span>`)
        await settle(150)
        container.innerHTML = ''
        await settle(600)
        const after = server.calls
        await settle(300)

        expect(server.calls).toBe(after)
        expect(wildflower._queryControllers.get(q).active).toBe(false)
    })
})
