/**
 * Nested lists fed from shared sources: a list inside a row template may name
 * a $store.path, a $query.rows path, or carry data-query, and it renders that
 * source in every row instead of a field of the row item.
 *
 * Before 2026-09-04 the nested mount read item[childPath], got undefined for a
 * $ path, and skipped the list without a warning (lifecycle sweep, cell C3).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const listsSuite = hasFeature('lists') ? describe : describe.skip
const querySuite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-nss-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

let container
let wildflower
let realWarn
let warns

beforeAll(async () => {
    await loadFramework()
})

beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
    realWarn = console.warn
    warns = []
    console.warn = (...args) => { warns.push(args.map(String).join(' ')) }
})

afterEach(() => {
    console.warn = realWarn
    delete wildflower._queryTeardownGraceMs
    if (container && container.parentNode) container.parentNode.removeChild(container)
    container = null
})

function innerCounts() {
    return Array.from(container.querySelectorAll('.inner')).map(ul => ul.querySelectorAll('li').length)
}

listsSuite('nested data-list="$store.path"', () => {
    it('renders the store list in every row and follows the store', async () => {
        const rows = uname('rows'); const opts = uname('opts'); const c = uname('c')
        wildflower.store(rows, { state: { rows: [{ id: 1, label: 'r1' }, { id: 2, label: 'r2' }] } })
        wildflower.store(opts, { state: { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] } })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="$${rows}.rows" data-key="id">
                    <template>
                        <li>
                            <span class="label" data-bind="label"></span>
                            <ul class="inner" data-list="$${opts}.items" data-key="id">
                                <template><li data-bind="name"></li></template>
                            </ul>
                        </li>
                    </template>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(200)

        expect(innerCounts()).toEqual([2, 2])
        expect(container.querySelector('.inner').textContent).toBe('ab')
        expect(Array.from(container.querySelectorAll('.label')).map(e => e.textContent)).toEqual(['r1', 'r2'])

        // The shared source changes: every row follows.
        const store = wildflower.getStore(opts)
        store.items = store.items.concat({ id: 3, name: 'c' })
        await settle(150)
        expect(innerCounts()).toEqual([3, 3])

        // The row list changes: new rows get the nested list too.
        const rowStore = wildflower.getStore(rows)
        rowStore.rows = rowStore.rows.concat({ id: 3, label: 'r3' })
        await settle(150)
        expect(innerCounts()).toEqual([3, 3, 3])

        // A row-level field change must not disturb the nested list.
        rowStore.rows[0].label = 'r1!'
        await settle(150)
        expect(container.querySelector('.label').textContent).toBe('r1!')
        expect(innerCounts()).toEqual([3, 3, 3])

        // Coded warnings (and their continuation lines) are expected: the
        // sub-second refresh above trips the poll-value diagnostic on purpose.
        expect(warns.filter(w => !w.includes('WF-') && !w.trim().startsWith('↳'))).toEqual([])
    })

    it('a removed row stops following the shared source', async () => {
        const rows = uname('rows'); const opts = uname('opts'); const c = uname('c')
        wildflower.store(rows, { state: { rows: [{ id: 1 }, { id: 2 }] } })
        wildflower.store(opts, { state: { items: [{ id: 1, name: 'a' }] } })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="$${rows}.rows" data-key="id">
                    <template><li><ul class="inner" data-list="$${opts}.items" data-key="id"><template><li data-bind="name"></li></template></ul></li></template>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(200)
        const inners = container.querySelectorAll('.inner')
        expect(inners.length).toBe(2)
        const removed = inners[0]

        const rowStore = wildflower.getStore(rows)
        rowStore.rows = rowStore.rows.filter(r => r.id !== 1)
        await settle(150)
        expect(removed.isConnected).toBe(false)

        const store = wildflower.getStore(opts)
        store.items = store.items.concat({ id: 2, name: 'b' })
        await settle(150)
        expect(removed.querySelectorAll('li').length).toBe(1)
        expect(innerCounts()).toEqual([2])
    })
})

querySuite('nested query lists inside rows', () => {
    function pollingQuery(q) {
        const counter = { calls: 0 }
        wildflower.query(q, {
            from: async () => { counter.calls++; return [{ id: 1, name: 'x' }, { id: 2, name: 'y' }] },
            key: 'id',
            refresh: 0.1
        })
        wildflower._queryTeardownGraceMs = 150
        return counter
    }

    it('data-query inside a row renders in every row, updates on ingest, and idles once the rows are gone', async () => {
        const q = uname('q'); const rows = uname('rows'); const c = uname('c')
        const counter = pollingQuery(q)
        wildflower.store(rows, { state: { rows: [{ id: 1 }, { id: 2 }] } })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="$${rows}.rows" data-key="id">
                    <template>
                        <li>
                            <ul class="inner" data-query="${q}">
                                <template><li data-bind="name"></li></template>
                            </ul>
                        </li>
                    </template>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(300)

        const controller = wildflower._queryControllers.get(q)
        expect(controller.active).toBe(true)
        expect(counter.calls).toBeGreaterThan(0)
        expect(innerCounts()).toEqual([2, 2])
        expect(container.querySelector('.inner').textContent).toBe('xy')

        const rowStore = wildflower.getStore(rows)
        rowStore.rows = []
        await settle(700)
        expect(controller.active).toBe(false)
        const idle = counter.calls
        await settle(300)
        expect(counter.calls).toBe(idle)

        // Coded warnings (and their continuation lines) are expected: the
        // sub-second refresh above trips the poll-value diagnostic on purpose.
        expect(warns.filter(w => !w.includes('WF-') && !w.trim().startsWith('↳'))).toEqual([])
    })

    it('data-list="$query.rows" inside a row behaves the same', async () => {
        const q = uname('q'); const rows = uname('rows'); const c = uname('c')
        const counter = pollingQuery(q)
        wildflower.store(rows, { state: { rows: [{ id: 1 }] } })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="$${rows}.rows" data-key="id">
                    <template><li><ul class="inner" data-list="$${q}.rows" data-key="id"><template><li data-bind="name"></li></template></ul></li></template>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(300)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.active).toBe(true)
        expect(innerCounts()).toEqual([2])

        wildflower.getStore(rows).rows = []
        await settle(700)
        expect(controller.active).toBe(false)
        const idle = counter.calls
        await settle(300)
        expect(counter.calls).toBe(idle)
    })

    it('a query declared after the component mounted still renders inside rows', async () => {
        const q = uname('q'); const rows = uname('rows'); const c = uname('c')
        wildflower.store(rows, { state: { rows: [{ id: 1 }] } })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="$${rows}.rows" data-key="id">
                    <template><li><ul class="inner" data-query="${q}"><template><li data-bind="name"></li></template></ul></li></template>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(200)
        expect(innerCounts()).toEqual([0])

        wildflower.query(q, { from: async () => [{ id: 1, name: 'late' }], key: 'id' })
        await settle(400)
        expect(innerCounts()).toEqual([1])
        expect(container.querySelector('.inner').textContent).toBe('late')
    })
})
