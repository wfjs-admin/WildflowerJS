/**
 * A store read inside a computed makes the component a dependent of the store
 * on every build.
 *
 * A parent's computed reads a store through getStore(), with no subscribe:
 * block, and a child receives that computed as a prop. A write to a field of
 * one store item has to reach the child's prop. The component is registered
 * as the store's dependent when its computed reads the store, and a store
 * with no dependents skips the work that refreshes children's props.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-sccp-${++seq}`
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))

describe('a store read in a computed, passed to a child as a prop', () => {
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

    const mount = async ({ renderLater }) => {
        const storeName = uname('items')
        const parent = uname('parent')
        const kid = uname('kid')
        wildflower.store(storeName, { state: { items: [{ id: 1, done: true }, { id: 2, done: false }, { id: 3, done: false }] } })
        wildflower.component(parent, {
            state: { show: !renderLater },
            computed: {
                mine() { return wildflower.getStore(storeName).items.filter(t => t.id > 0) },
                doneCount() { return this.mine.filter(t => t.done).length },
            },
        })
        wildflower.component(kid, { props: { a: { type: Number, default: -1 } } })
        container.innerHTML = `
            <div data-component="${parent}">
                <p class="parent-done" data-bind="doneCount"></p>
                <div data-render="show">
                    <div data-component="${kid}" data-prop-a="doneCount"><span class="kid-done" data-bind="props.a"></span></div>
                </div>
            </div>
        `
        wildflower.scan(container)
        await settle()
        if (renderLater) {
            wildflower.getComponents(parent)[0].show = true
            await settle()
        }
        return wildflower.getStore(storeName)
    }

    const read = () => [container.querySelector('.parent-done').textContent, container.querySelector('.kid-done').textContent]

    it('the child prop follows a write to a store item, child rendered from the start', async () => {
        const store = await mount({ renderLater: false })
        expect(read()).toEqual(['1', '1'])

        store.items[1].done = true
        await settle()
        expect(read()).toEqual(['2', '2'])

        store.items[2].done = true
        await settle()
        expect(read()).toEqual(['3', '3'])
    })

    it('the child prop follows a write to a store item, child rendered later by data-render', async () => {
        const store = await mount({ renderLater: true })
        expect(read()).toEqual(['1', '1'])

        store.items[1].done = true
        await settle()
        expect(read()).toEqual(['2', '2'])
    })

    it('the child prop follows the store array being replaced', async () => {
        const store = await mount({ renderLater: false })
        store.items = [{ id: 7, done: true }, { id: 8, done: true }]
        await settle()
        expect(read()).toEqual(['2', '2'])
    })
})
