/**
 * A query bound only inside a data-render section whose initial condition is
 * false must not activate (and fetch) at component init. The section is
 * removed by the conditional pass a moment after the query transform and the
 * binding pass ran over it, and both used to observe or touch the query on
 * the way through. Revealing the section activates the query once.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-hid-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

function jsonResponse(data) {
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    return new Response(JSON.stringify(data), { status: 200, headers })
}

suite('queries inside an initially hidden data-render section', () => {
    let container
    let wildflower
    let realFetch
    let realWarn
    let calls

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        realWarn = console.warn
        console.warn = () => {}
        calls = []
        window.fetch = (url) => {
            calls.push(String(url))
            return Promise.resolve(jsonResponse([{ id: 1, name: 'x' }]))
        }
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        delete wildflower._queryTeardownGraceMs
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    const callsTo = (q) => calls.filter(u => u.includes('/api/' + q)).length

    function mount(c, show, inner) {
        container.innerHTML = `
            <div data-component="${c}">
                <button class="reveal" data-action="reveal">reveal</button>
                <div data-render="show">${inner}</div>
            </div>
        `
        wildflower.component(c, { state: { show }, reveal() { this.show = true } })
        wildflower.scan(container)
    }

    it('a data-query list under a hidden section does not fetch until revealed', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        mount(c, false, `<ul data-query="${q}"><template><li data-bind="name"></li></template></ul>`)
        await settle(200)
        expect(callsTo(q)).toBe(0)
        expect(container.querySelectorAll('li').length).toBe(0)

        container.querySelector('.reveal').click()
        await settle(200)
        expect(callsTo(q)).toBe(1)
        expect(container.querySelectorAll('li').length).toBe(1)
    })

    it('a $query binding under a hidden section does not fetch until revealed', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        mount(c, false, `<span class="count" data-bind="$${q}.count"></span>`)
        await settle(200)
        expect(callsTo(q)).toBe(0)

        container.querySelector('.reveal').click()
        await settle(200)
        expect(callsTo(q)).toBe(1)
        expect(container.querySelector('.count').textContent).toBe('1')
    })

    it('a $query.rows list under a hidden section does not fetch until revealed', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        mount(c, false, `<ul data-list="$${q}.rows" data-key="id"><template><li data-bind="name"></li></template></ul>`)
        await settle(200)
        expect(callsTo(q)).toBe(0)

        container.querySelector('.reveal').click()
        await settle(200)
        expect(callsTo(q)).toBe(1)
        expect(container.querySelectorAll('li').length).toBe(1)
    })

    it('the same section shown from the start fetches once', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        mount(c, true, `<ul data-query="${q}"><template><li data-bind="name"></li></template></ul><span data-bind="$${q}.count"></span>`)
        await settle(200)
        expect(callsTo(q)).toBe(1)
        expect(container.querySelectorAll('li').length).toBe(1)
    })

    it('a section gated by a $store expression: hidden at init, fetches once when the store shows it', async () => {
        const q = uname('q'); const c = uname('c'); const s = uname('s')
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        wildflower.store(s, { state: { page: null } })
        container.innerHTML = `
            <div data-component="${c}">
                <div data-render="$${s}.page === 'list'">
                    <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
                    <span class="count" data-bind="$${q}.count"></span>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(200)
        expect(callsTo(q)).toBe(0)

        wildflower.getStore(s).page = 'list'
        await settle(250)
        expect(callsTo(q)).toBe(1)
        expect(container.querySelectorAll('li').length).toBe(1)
        expect(container.querySelector('.count').textContent).toBe('1')
    })

    it('nested conditionals on the query inside a hidden section do not wake it', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        mount(c, false, `
            <p class="loading" data-show="$${q}.isLoading">loading</p>
            <p class="empty" data-render="!$${q}.isLoading && $${q}.count === 0">empty</p>
            <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
        `)
        await settle(200)
        expect(callsTo(q)).toBe(0)

        container.querySelector('.reveal').click()
        await settle(250)
        expect(callsTo(q)).toBe(1)
        expect(container.querySelectorAll('li').length).toBe(1)
        expect(container.querySelector('.empty')).toBeNull()
    })

    it('a state change elsewhere does not wake a query whose section is still hidden', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        container.innerHTML = `
            <div data-component="${c}">
                <span class="n" data-bind="n"></span>
                <div data-render="show"><span data-bind="$${q}.count"></span></div>
            </div>
        `
        wildflower.component(c, { state: { show: false, n: 0 } })
        wildflower.scan(container)
        await settle(200)
        expect(callsTo(q)).toBe(0)

        const comp = wildflower.getComponent(c)
        comp.state.n = 1
        await settle(200)
        expect(container.querySelector('.n').textContent).toBe('1')
        expect(callsTo(q)).toBe(0)
    })
})
