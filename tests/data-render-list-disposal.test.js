/**
 * data-render removal disposes the lists in the removed subtree, and a list
 * that is off the DOM does not count as query observation.
 *
 * Found 2026-09-03 through the polling-query pattern: a data-query list
 * wrapped in data-render kept polling after the wrapper went false. Two
 * defects behind it, pinned here:
 *
 *  1. _removeRenderElement destroyed nested components and unhooked actions
 *     but never disposed the subtree's mapArray reconcilers. Re-insertion
 *     clones the template and mounts a fresh list, so every toggle orphaned
 *     one structural effect that kept reconciling off-DOM on each source
 *     change (a leak on plain stores; measured 3 live effects after two
 *     removals).
 *  2. The list's array source re-normalizes its $-shorthand path on every
 *     run, and normalization stamps the query as observed. An orphaned or
 *     hand-removed list therefore kept its query alive through its own
 *     reconcile: each ingest re-ran the list, which stamped lastRead, which
 *     kept the rungs firing. Observation now requires the element to be
 *     connected; the first run always normalizes so activation is unchanged.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const listsSuite = hasFeature('lists') ? describe : describe.skip
const querySuite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-rld-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

let container
let wildflower
let realWarn

beforeAll(async () => {
    await loadFramework()
})

beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
    realWarn = console.warn
    console.warn = () => {}
})

afterEach(() => {
    console.warn = realWarn
    delete wildflower._queryTeardownGraceMs
    if (container && container.parentNode) container.parentNode.removeChild(container)
    container = null
})

function mountToggle(cname, inner) {
    container.innerHTML = `
        <div data-component="${cname}">
            <button class="hide" data-action="hide">hide</button>
            <button class="reveal" data-action="reveal">reveal</button>
            <div data-render="show">${inner}</div>
        </div>
    `
    wildflower.component(cname, {
        state: { show: true },
        hide() { this.show = false },
        reveal() { this.show = true }
    })
    wildflower.scan(container)
}

listsSuite('data-render removal disposes the subtree lists', () => {
    it('a list removed by data-render stops reconciling; re-insertion renders fresh', async () => {
        const s = uname('s'); const c = uname('c')
        wildflower.store(s, { state: { items: [{ id: 1, name: 'a' }] } })
        mountToggle(c, `<ul data-list="$${s}.items" data-key="id"><template><li data-bind="name"></li></template></ul>`)
        await settle(100)

        const ul = container.querySelector('ul')
        expect(ul.querySelectorAll('li').length).toBe(1)

        container.querySelector('.hide').click()
        await settle(100)
        expect(ul.isConnected).toBe(false)

        // The orphaned list must not follow the source any more.
        const store = wildflower.getStore(s)
        store.items = store.items.concat({ id: 2, name: 'b' })
        await settle(120)
        expect(ul.querySelectorAll('li').length).toBe(1)

        // Re-insertion mounts a fresh list against the current data.
        container.querySelector('.reveal').click()
        await settle(150)
        const fresh = container.querySelector('ul')
        expect(fresh).not.toBe(ul)
        expect(fresh.querySelectorAll('li').length).toBe(2)
        expect(fresh.textContent).toContain('b')
    })
})

querySuite('off-DOM lists do not keep a query alive', () => {
    function pollingQuery(q) {
        const counter = { calls: 0 }
        wildflower.query(q, {
            from: async () => { counter.calls++; return [{ id: 1, name: 'x' }] },
            key: 'id',
            refresh: 0.1
        })
        wildflower._queryTeardownGraceMs = 150
        return counter
    }

    it('data-render false idles a polling data-query list; true resumes it', async () => {
        const q = uname('q'); const c = uname('c')
        const counter = pollingQuery(q)
        mountToggle(c, `<ul data-query="${q}"><template><li data-bind="name"></li></template></ul>`)
        await settle(250)

        const controller = wildflower._queryControllers.get(q)
        expect(controller.active).toBe(true)
        expect(container.querySelectorAll('li').length).toBe(1)

        container.querySelector('.hide').click()
        await settle(700) // grace + several would-be rungs
        expect(controller.active).toBe(false)
        const idleCalls = counter.calls
        await settle(300)
        expect(counter.calls).toBe(idleCalls)

        container.querySelector('.reveal').click()
        await settle(300)
        expect(controller.active).toBe(true)
        expect(counter.calls).toBeGreaterThan(idleCalls)
        expect(container.querySelectorAll('li').length).toBe(1)
    })

    it('a data-query list removed by plain DOM code idles after the grace', async () => {
        const q = uname('q'); const c = uname('c')
        const counter = pollingQuery(q)
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(250)

        const controller = wildflower._queryControllers.get(q)
        expect(controller.active).toBe(true)

        const ul = container.querySelector('ul')
        ul.parentNode.removeChild(ul)
        await settle(700)
        expect(controller.active).toBe(false)
        const idleCalls = counter.calls
        await settle(300)
        expect(counter.calls).toBe(idleCalls)
    })

    it('a $query data-bind under data-render false does not keep the query alive', async () => {
        const q = uname('q'); const c = uname('c')
        const counter = pollingQuery(q)
        mountToggle(c, `<span class="count" data-bind="$${q}.count"></span>`)
        await settle(250)

        const controller = wildflower._queryControllers.get(q)
        expect(controller.active).toBe(true)

        container.querySelector('.hide').click()
        await settle(700)
        expect(controller.active).toBe(false)
        const idleCalls = counter.calls
        await settle(300)
        expect(counter.calls).toBe(idleCalls)
    })

    it('a connected $query.rows list still keeps the query alive', async () => {
        const q = uname('q'); const c = uname('c')
        const counter = pollingQuery(q)
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="$${q}.rows" data-key="id"><template><li data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(250)

        const controller = wildflower._queryControllers.get(q)
        expect(controller.active).toBe(true)
        const callsBefore = counter.calls
        await settle(700) // well past the grace: the connected list is observation
        expect(controller.active).toBe(true)
        expect(counter.calls).toBeGreaterThan(callsBefore)
        expect(container.querySelectorAll('li').length).toBe(1)
    })
})
