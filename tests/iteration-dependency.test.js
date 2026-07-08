/**
 * Iteration-dependency tracking (ownKeys / ITERATE node).
 *
 * A computed that iterates a reactive object's keys — Object.keys(),
 * for...in, spread — must re-run when a key is ADDED or DELETED, not only
 * when the object is reassigned. Value updates to an existing key must NOT
 * wake a keys-only iterator (values flow through per-key nodes).
 *
 * Motivating case: the lists.html saveable-products demo, where
 * savedCount() { return Object.keys(this.saved).length } stayed stale
 * when items were saved (key add) or unsaved (key delete).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 60) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Iteration dependencies (Object.keys / for...in / spread)', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    it('Object.keys count re-runs when a key is added (component state)', async () => {
        wildflower.component('keys-add-test', {
            state: { saved: { p1: true } },
            computed: {
                savedCount() { return Object.keys(this.saved).length }
            },
            save() { this.saved.p2 = true }
        })
        testContainer.innerHTML = `
            <div data-component="keys-add-test">
                <strong id="kc" data-bind="savedCount"></strong>
                <button id="kbtn" data-action="save">save</button>
            </div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('kc').textContent).toBe('1')

        document.getElementById('kbtn').click()
        await waitForUpdate()
        expect(document.getElementById('kc').textContent).toBe('2')
    })

    it('Object.keys count re-runs when a key is deleted', async () => {
        wildflower.component('keys-del-test', {
            state: { saved: { p1: true, p2: true } },
            computed: {
                savedCount() { return Object.keys(this.saved).length }
            },
            unsave() { delete this.saved.p2 }
        })
        testContainer.innerHTML = `
            <div data-component="keys-del-test">
                <strong id="dc" data-bind="savedCount"></strong>
                <button id="dbtn" data-action="unsave">unsave</button>
            </div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('dc').textContent).toBe('2')

        document.getElementById('dbtn').click()
        await waitForUpdate()
        expect(document.getElementById('dc').textContent).toBe('1')
    })

    it('spread over reactive state re-runs on key add', async () => {
        wildflower.component('spread-test', {
            state: { flags: { a: 1 } },
            computed: {
                flagList() { return Object.entries({ ...this.flags }).map(([k, v]) => k + '=' + v).join(',') }
            },
            add() { this.flags.b = 2 }
        })
        testContainer.innerHTML = `
            <div data-component="spread-test">
                <span id="sp" data-bind="flagList"></span>
                <button id="sbtn" data-action="add">add</button>
            </div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('sp').textContent).toBe('a=1')

        document.getElementById('sbtn').click()
        await waitForUpdate()
        expect(document.getElementById('sp').textContent).toBe('a=1,b=2')
    })

    it('for...in count re-runs on key add', async () => {
        wildflower.component('forin-test', {
            state: { bag: { x: true } },
            computed: {
                bagCount() { let n = 0; for (const k in this.bag) n++; return n }
            },
            add() { this.bag.y = true }
        })
        testContainer.innerHTML = `
            <div data-component="forin-test">
                <span id="fc" data-bind="bagCount"></span>
                <button id="fbtn" data-action="add">add</button>
            </div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('fc').textContent).toBe('1')

        document.getElementById('fbtn').click()
        await waitForUpdate()
        expect(document.getElementById('fc').textContent).toBe('2')
    })

    it('updating an EXISTING key value does not re-run a keys-only iterator', async () => {
        let runs = 0
        wildflower.component('keys-noise-test', {
            state: { saved: { p1: 1 } },
            computed: {
                savedCount() { runs++; return Object.keys(this.saved).length }
            },
            bump() { this.saved.p1 = this.saved.p1 + 1 }
        })
        testContainer.innerHTML = `
            <div data-component="keys-noise-test">
                <strong id="nc" data-bind="savedCount"></strong>
                <button id="nbtn" data-action="bump">bump</button>
            </div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('nc').textContent).toBe('1')
        const runsAfterMount = runs

        document.getElementById('nbtn').click()
        await waitForUpdate()
        expect(document.getElementById('nc').textContent).toBe('1')
        // Value update on an existing key pulses only that key's node; the
        // iterator must not have been re-evaluated.
        expect(runs).toBe(runsAfterMount)
    })

    it('Object.keys over a reactive ARRAY re-runs on push (length aliasing)', async () => {
        wildflower.component('arr-keys-test', {
            state: { items: ['a'] },
            computed: {
                keyCount() { return Object.keys(this.items).length }
            },
            add() { this.items.push('b') }
        })
        testContainer.innerHTML = `
            <div data-component="arr-keys-test">
                <span id="ac" data-bind="keyCount"></span>
                <button id="abtn" data-action="add">add</button>
            </div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('ac').textContent).toBe('1')

        document.getElementById('abtn').click()
        await waitForUpdate()
        expect(document.getElementById('ac').textContent).toBe('2')
    })

    it('store computed iterating store state re-runs on key add', async () => {
        wildflower.store('iterStore', {
            state: { registry: { one: true } },
            computed: {
                registryCount() { return Object.keys(this.registry).length }
            },
            register() { this.registry.two = true }
        })
        wildflower.component('store-iter-test', {
            stores: ['iterStore'],
            computed: {
                count() { return wildflower.getStore('iterStore').registryCount }
            },
            add() { wildflower.getStore('iterStore').register() }
        })
        testContainer.innerHTML = `
            <div data-component="store-iter-test">
                <span id="stc" data-bind="count"></span>
                <button id="stbtn" data-action="add">add</button>
            </div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('stc').textContent).toBe('1')

        document.getElementById('stbtn').click()
        await waitForUpdate()
        expect(document.getElementById('stc').textContent).toBe('2')
    })

    it('the saveable-products docs demo shape end to end', async () => {
        wildflower.component('demo-shape-test', {
            state: {
                products: [
                    { id: 'p1', name: 'A' },
                    { id: 'p2', name: 'B' }
                ],
                saved: {}
            },
            computed: {
                savedCount() { return Object.keys(this.saved).length },
                isSaved(item) { return !!this.saved[item.id] }
            },
            toggleSave(event, element, details) {
                const item = details && details.item
                if (!item) return
                if (this.saved[item.id]) delete this.saved[item.id]
                else this.saved[item.id] = { savedAt: 1 }
            }
        })
        testContainer.innerHTML = `
            <div data-component="demo-shape-test">
                <strong id="pc" data-bind="savedCount"></strong>
                <ul data-list="products" data-key="id">
                    <template>
                        <li>
                            <span data-bind="name"></span>
                            <button class="tgl" data-action="toggleSave">save</button>
                        </li>
                    </template>
                </ul>
            </div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('pc').textContent).toBe('0')

        document.querySelector('.tgl').click()
        await waitForUpdate()
        expect(document.getElementById('pc').textContent).toBe('1')

        document.querySelector('.tgl').click()
        await waitForUpdate()
        expect(document.getElementById('pc').textContent).toBe('0')
    })
})
