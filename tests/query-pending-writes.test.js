/**
 * $q.pendingWrites — public reactive count of unsettled writes on a query.
 *
 * The engine always tracked controller.pendingWrites internally; this pins
 * the public store flag that makes it bindable: saving indicators
 * (data-show="$q.pendingWrites > 0"), beforeunload gating while writes are
 * in flight (the page.reload()-cancels-my-POST report from the Conduit
 * build), and plain getQuery() reads.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-pw-${++seq}`

async function settle(ms = 80) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

suite('query pendingWrites — public reactive flag', () => {
    let container
    let wildflower

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    // A query over local data with a manually-settled transport: each write's
    // to() hands its resolve/reject out through `gates`.
    function declareQuery(q, gates) {
        wildflower.query(q, {
            from: () => [{ id: 1, title: 'one', done: false }, { id: 2, title: 'two', done: false }],
            key: 'id',
            to: (item) => new Promise((resolve, reject) => { gates.push({ item, resolve, reject }) })
        })
    }

    function mount(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}">
                    <template><li class="row"><span data-bind="title"></span>:<span class="dn" data-bind="done"></span></li></template>
                </ul>
                <p class="saving" data-show="$${q}.pendingWrites > 0">Saving…</p>
                <span class="pw" data-bind="$${q}.pendingWrites">0</span>
            </div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    it('starts at 0 and is readable through the query handle', async () => {
        const q = uname('q'); const c = uname('c'); const gates = []
        declareQuery(q, gates)
        mount(q, c)
        await settle()

        expect(wildflower.getQuery(q).pendingWrites).toBe(0)
        expect(container.querySelector('.pw').textContent.trim()).toBe('0')
        expect(getComputedStyle(container.querySelector('.saving')).display).toBe('none')
    })

    it('counts one in-flight write up and back down on confirm; settled after await', async () => {
        const q = uname('q'); const c = uname('c'); const gates = []
        declareQuery(q, gates)
        mount(q, c)
        await settle()

        const p = wildflower.getQuery(q).write({ id: 1, done: true })
        await settle()

        // In flight: flag up, binding painted, indicator visible.
        expect(wildflower.getQuery(q).pendingWrites).toBe(1)
        expect(container.querySelector('.pw').textContent.trim()).toBe('1')
        expect(getComputedStyle(container.querySelector('.saving')).display).not.toBe('none')

        gates[0].resolve({ id: 1, done: true })
        await p
        // The promise settles only after the flag has come back down.
        expect(wildflower.getQuery(q).pendingWrites).toBe(0)
        await settle()
        expect(container.querySelector('.pw').textContent.trim()).toBe('0')
        expect(getComputedStyle(container.querySelector('.saving')).display).toBe('none')
    })

    it('overlapping writes count 2 → 1 → 0 as each settles', async () => {
        const q = uname('q'); const c = uname('c'); const gates = []
        declareQuery(q, gates)
        mount(q, c)
        await settle()

        const store = wildflower.getQuery(q)
        const p1 = store.write({ id: 1, done: true })
        const p2 = store.write({ id: 2, done: true })
        await settle()
        expect(store.pendingWrites).toBe(2)

        gates[0].resolve({ id: 1, done: true })
        await p1
        expect(store.pendingWrites).toBe(1)

        gates[1].resolve({ id: 2, done: true })
        await p2
        expect(store.pendingWrites).toBe(0)
    })

    it('out-of-order settles still land at 0 (later write settles first)', async () => {
        const q = uname('q'); const c = uname('c'); const gates = []
        declareQuery(q, gates)
        mount(q, c)
        await settle()

        const store = wildflower.getQuery(q)
        const p1 = store.write({ id: 1, title: 'first' })
        const p2 = store.write({ id: 2, title: 'second' })
        await settle()
        expect(store.pendingWrites).toBe(2)

        gates[1].resolve({ id: 2, title: 'second' })
        await p2
        expect(store.pendingWrites).toBe(1)

        gates[0].resolve({ id: 1, title: 'first' })
        await p1
        expect(store.pendingWrites).toBe(0)
    })

    it('a rejected write decrements alongside its rollback', async () => {
        const q = uname('q'); const c = uname('c'); const gates = []
        declareQuery(q, gates)
        mount(q, c)
        await settle()

        const store = wildflower.getQuery(q)
        const p = store.write({ id: 1, done: true })
        await settle()
        expect(store.pendingWrites).toBe(1)

        gates[0].reject(new Error('HTTP 409'))
        await p.catch(() => {})
        await settle()

        expect(store.pendingWrites).toBe(0)
        expect(store.syncError).toContain('409')
        // Rollback happened: the optimistic done=true reverted.
        const dn = [...container.querySelectorAll('.row')][0].querySelector('.dn')
        expect(dn.textContent.trim()).toBe('false')
        expect(getComputedStyle(container.querySelector('.saving')).display).toBe('none')
    })

    it('indicator stays up until the LAST overlapping write settles', async () => {
        const q = uname('q'); const c = uname('c'); const gates = []
        declareQuery(q, gates)
        mount(q, c)
        await settle()

        const store = wildflower.getQuery(q)
        const p1 = store.write({ id: 1, done: true })
        const p2 = store.write({ id: 2, done: true })
        await settle()

        gates[0].resolve({ id: 1, done: true })
        await p1
        await settle()
        // One still pending: indicator must remain visible.
        expect(getComputedStyle(container.querySelector('.saving')).display).not.toBe('none')

        gates[1].resolve({ id: 2, done: true })
        await p2
        await settle()
        expect(getComputedStyle(container.querySelector('.saving')).display).toBe('none')
    })
})
