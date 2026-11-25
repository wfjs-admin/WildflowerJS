/**
 * A child's props are refreshed once per flush.
 *
 * A write to a store, or to a parent's state, that can change a child's props
 * marks them stale. They are resolved when the child reads them, so a read in
 * the same turn as the write gives the new value, and the child's bindings and
 * its onPropsChange hook follow once, when the turn's updates are flushed,
 * with the final value. The parent's computed is not evaluated again for
 * every write.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-prpf-${++seq}`
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))

describe('child props refresh once per flush', () => {
    let wildflower
    let container

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
        container.remove()
    })

    const mountOverStore = async () => {
        const storeName = uname('items')
        const parent = uname('parent')
        const kid = uname('kid')
        const seen = { evaluations: 0, changes: [], kid: null }
        wildflower.store(storeName, { state: { items: Array.from({ length: 20 }, (_, i) => ({ id: i, done: false })) } })
        wildflower.component(parent, {
            computed: {
                doneCount() { seen.evaluations++; return wildflower.getStore(storeName).items.filter(t => t.done).length },
            },
        })
        wildflower.component(kid, {
            props: { a: { type: Number, default: -1 } },
            init() { seen.kid = this },
            onPropsChange() { seen.changes.push(this.props.a) },
        })
        container.innerHTML = `
            <div data-component="${parent}">
                <div data-component="${kid}" data-prop-a="doneCount"><span class="kid-done" data-bind="props.a"></span></div>
            </div>
        `
        wildflower.scan(container)
        await settle()
        return { store: wildflower.getStore(storeName), seen }
    }

    it('ten store writes in one turn: one onPropsChange, with the final value', async () => {
        const { store, seen } = await mountOverStore()
        expect(container.querySelector('.kid-done').textContent).toBe('0')
        seen.changes.length = 0

        for (let i = 0; i < 10; i++) store.items[i].done = true
        await settle()

        expect(container.querySelector('.kid-done').textContent).toBe('10')
        expect(seen.changes).toEqual([10])
    })

    it('ten store writes in one turn do not evaluate the parent computed ten times', async () => {
        const { store, seen } = await mountOverStore()
        seen.evaluations = 0

        for (let i = 0; i < 10; i++) store.items[i].done = true
        await settle()

        expect(seen.evaluations).toBeLessThanOrEqual(2)
    })

    it('a read of this.props in the same turn as the write gives the new value', async () => {
        const { store, seen } = await mountOverStore()

        store.items[0].done = true
        store.items[1].done = true
        expect(seen.kid.props.a).toBe(2)

        await settle()
        expect(container.querySelector('.kid-done').textContent).toBe('2')
    })

    it('a read in the same turn does not swallow the change: the binding and the hook still follow', async () => {
        const { store, seen } = await mountOverStore()
        seen.changes.length = 0

        store.items[0].done = true
        expect(seen.kid.props.a).toBe(1)
        await settle()

        expect(container.querySelector('.kid-done').textContent).toBe('1')
        expect(seen.changes).toEqual([1])
    })

    it('writes that leave the value where it started fire no onPropsChange', async () => {
        const { store, seen } = await mountOverStore()
        seen.changes.length = 0

        store.items[0].done = true
        store.items[0].done = false
        await settle()

        expect(container.querySelector('.kid-done').textContent).toBe('0')
        expect(seen.changes).toEqual([])
    })

    it('ten writes to parent state in one turn: one onPropsChange, with the final value', async () => {
        const parent = uname('parent')
        const kid = uname('kid')
        const changes = []
        let kidContext = null
        wildflower.component(parent, { state: { n: 0 } })
        wildflower.component(kid, {
            props: { a: { type: Number, default: -1 } },
            init() { kidContext = this },
            onPropsChange() { changes.push(this.props.a) },
        })
        container.innerHTML = `
            <div data-component="${parent}">
                <div data-component="${kid}" data-prop-a="n"><span class="kid-n" data-bind="props.a"></span></div>
            </div>
        `
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.kid-n').textContent).toBe('0')

        const p = wildflower.getComponents(parent)[0]
        for (let i = 1; i <= 10; i++) p.n = i
        expect(kidContext.props.a).toBe(10)
        await settle()

        expect(container.querySelector('.kid-n').textContent).toBe('10')
        expect(changes).toEqual([10])
    })
})
