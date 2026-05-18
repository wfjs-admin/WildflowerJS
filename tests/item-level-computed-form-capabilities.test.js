/**
 * Capability tests for parameterised item-level computeds:
 *   function name(item, index, info) { ... }
 *
 * Where:
 *   - `this` is the component context (full Proxy with state/props/stores/computed/getStore).
 *   - `item` is the current row.
 *   - `index` is its position in the list.
 *   - `info` is `{ first, last, length }`.
 *
 * v1.1 also surfaces a __DEV__ warning when a zero-arg computed is
 * referenced inside a list-template binding (the misuse pattern).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Item-level computed form capabilities', () => {
    let testContainer
    let cleanup

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    it('parameterised: third info arg provides first/last/length', async () => {
        wildflower.component('param-info', {
            state: {
                items: [
                    { id: 'a', label: 'A' },
                    { id: 'b', label: 'B' },
                    { id: 'c', label: 'C' }
                ]
            },
            computed: {
                positionLabel(item, index, info) {
                    if (info.first) return 'FIRST: ' + item.label
                    if (info.last) return 'LAST: ' + item.label + ' (of ' + info.length + ')'
                    return item.label
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="param-info">
                <div data-list="items" data-key="id">
                    <template>
                        <span class="p" data-bind="positionLabel"></span>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const spans = testContainer.querySelectorAll('span.p')
        expect(spans.length).toBe(3)
        expect(spans[0].textContent).toBe('FIRST: A')
        expect(spans[1].textContent).toBe('B')
        expect(spans[2].textContent).toBe('LAST: C (of 3)')
    })

    it('parameterised: third arg is optional — fn(item) and fn(item, index) still work', async () => {
        // The new info arg is appended to the call. JS ignores extra args, so
        // existing fn(item) and fn(item, index) signatures keep working.
        wildflower.component('param-back-compat', {
            state: { items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }] },
            computed: {
                upper(item) { return item.name.toUpperCase() },
                indexed(item, index) { return index + ': ' + item.name }
            }
        })

        testContainer.innerHTML = `
            <div data-component="param-back-compat">
                <div data-list="items" data-key="id">
                    <template>
                        <li>
                            <span class="u" data-bind="upper"></span>
                            <span class="i" data-bind="indexed"></span>
                        </li>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const ups = testContainer.querySelectorAll('span.u')
        const ixs = testContainer.querySelectorAll('span.i')
        expect(ups[0].textContent).toBe('ALPHA')
        expect(ups[1].textContent).toBe('BETA')
        expect(ixs[0].textContent).toBe('0: Alpha')
        expect(ixs[1].textContent).toBe('1: Beta')
    })

    it('parameterised: this.stores is the component context (subscribed store access)', async () => {
        wildflower.store('cat-store', {
            state: { mapping: { a: 'red', b: 'blue' } },
            update(id, color) { this.state.mapping[id] = color }
        })

        wildflower.component('param-stores', {
            subscribe: { 'cat-store': ['mapping'] },
            state: { items: [{ id: 'a' }, { id: 'b' }] },
            computed: {
                color(item) {
                    const m = this.stores['cat-store'].mapping
                    return m[item.id] || 'gray'
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="param-stores">
                <div data-list="items" data-key="id">
                    <template>
                        <span class="c" data-bind="color"></span>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const spans = testContainer.querySelectorAll('span.c')
        expect(spans[0].textContent).toBe('red')
        expect(spans[1].textContent).toBe('blue')

        wildflower.getStore('cat-store').update('a', 'green')
        await waitForCompleteRender()
        expect(spans[0].textContent).toBe('green')
    })
})
