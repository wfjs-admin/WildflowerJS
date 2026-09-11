/**
 * One query, many views: several elements declaring the same data-query.
 *
 * The transform loop binds every [data-query] element to its controller
 * independently, so one registered query can drive any number of views from
 * one store and one fetch. The wildflowerjs.com homepage relies on this in
 * production: the hero version badge and the Page Contents utility line are
 * two record-shape elements bound to the same latestRelease query.
 *
 * Pinned here so the behavior is a contract rather than an accident of the
 * loop. Per-query attributes (data-expect) resolve first-declaring-element
 * wins, per the transform comment in QuerySystem.js.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-multiel-${++seq}`

function jsonResponse(data, { status = 200 } = {}) {
    return new Response(JSON.stringify(data), { status })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query: multiple elements, one query', () => {
    let container
    let wildflower
    let realFetch
    let warnings
    let realWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        warnings = []
        realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')); }
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('two record-shape elements render from one store and one fetch', async () => {
        const q = uname('q'); const c = uname('c')
        let fetches = 0
        window.fetch = async () => { fetches++; return jsonResponse({ version: '9.9.9', name: 'Ada' }) }
        wildflower.query(q, { from: '/api/release' })

        container.innerHTML = `
            <div data-component="${c}">
                <article class="badge" data-query="${q}">
                    v<span class="badge-version" data-bind="version"></span>
                </article>
                <aside class="footer-line" data-query="${q}">
                    <span class="footer-version" data-bind="version"></span>
                    by <span class="footer-name" data-bind="name"></span>
                </aside>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(container.querySelector('.badge-version').textContent).toBe('9.9.9')
        expect(container.querySelector('.footer-version').textContent).toBe('9.9.9')
        expect(container.querySelector('.footer-name').textContent).toBe('Ada')
        expect(fetches).toBe(1)
    })

    it('a patch updates every bound element', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ version: '1.0.0', name: 'Ada' })
        wildflower.query(q, { from: '/api/release' })

        container.innerHTML = `
            <div data-component="${c}">
                <span class="a" data-query="${q}"><b data-bind="version"></b></span>
                <span class="b" data-query="${q}"><b data-bind="version"></b></span>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(container.querySelector('.a b').textContent).toBe('1.0.0')
        expect(container.querySelector('.b b').textContent).toBe('1.0.0')

        wildflower.getQuery(q).patch({ version: '2.0.0' })
        await settle()

        expect(container.querySelector('.a b').textContent).toBe('2.0.0')
        expect(container.querySelector('.b b').textContent).toBe('2.0.0')
    })

    it('list and record views of the same query coexist', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])
        wildflower.query(q, { from: '/api/rows', key: 'id' })

        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}">
                    <template><li class="row" data-bind="name"></li></template>
                </ul>
                <span class="count" data-bind="$${q}.count"></span>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(container.querySelectorAll('.row').length).toBe(2)
        expect(container.querySelector('.count').textContent).toBe('2')
    })

    it.skipIf(isMinifiedBuild())('data-expect resolves first-declaring-element wins', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse({ version: 42 })
        wildflower.query(q, { from: '/api/release' })

        // First element expects version:string (violated: 42 is a number);
        // second expects version:number (satisfied). First wins, so exactly
        // the string-expectation warning fires.
        container.innerHTML = `
            <div data-component="${c}">
                <span data-query="${q}" data-expect="version:string"><b data-bind="version"></b></span>
                <span data-query="${q}" data-expect="version:number"><b data-bind="version"></b></span>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(150)

        const driftWarnings = warnings.filter(w => w.includes('WF-962') || /expect/i.test(w))
        expect(driftWarnings.length).toBeGreaterThan(0)
        expect(driftWarnings.join(' ')).toContain('string')
    })
})
