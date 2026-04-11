/**
 * innerHTML fast path vs mapFn parity tests.
 *
 * Validates that list templates rendered through the innerHTML optimization
 * produce identical DOM output to those forced through the mapFn (cloneNode)
 * path. The innerHTML path is used when templates contain only simple
 * data-bind text bindings; the mapFn path kicks in when templates include
 * data-model, data-show, data-bind-style, data-bind-attr, data-bind-html,
 * computed class bindings, or nested lists.
 *
 * Strategy: render the same data through both paths (side by side in one
 * component) and assert identical visible text + class state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForCompleteRender } from './helpers/load-framework.js'

let storeCounter = 0
function uniqueStore() { return `parityStore${++storeCounter}` }

describe('innerHTML vs mapFn Parity', () => {
    let testContainer
    let wildflower

    beforeEach(async () => {
        await resetFramework()
        wildflower = await loadFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(async () => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        await resetFramework()
    })

    // Helper: extract visible text from each list item row
    function textOfRows(container, selector) {
        return Array.from(container.querySelectorAll(selector))
            .map(el => el.textContent.trim())
    }

    // Helper: extract class lists from each list item row
    function classesOfRows(container, selector) {
        return Array.from(container.querySelectorAll(selector))
            .map(el => [...el.classList].sort().join(' '))
    }

    it('simple data-bind text: innerHTML path matches mapFn path', async () => {
        // innerHTML path: template with only data-bind (simple text)
        // mapFn path: same template but with a data-show that forces mapFn
        wildflower.component('parity-text', {
            state: {
                items: [
                    { id: 1, name: 'Alice', role: 'Admin' },
                    { id: 2, name: 'Bob', role: 'User' },
                    { id: 3, name: 'Carol', role: 'Editor' }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="parity-text">
                <!-- innerHTML path: simple bindings only -->
                <div id="inner-list" data-list="items" data-key="id">
                    <template>
                        <div class="row"><span class="name" data-bind="name"></span> - <span class="role" data-bind="role"></span></div>
                    </template>
                </div>
                <!-- mapFn path: adding data-show forces cloneNode path -->
                <div id="map-list" data-list="items" data-key="id">
                    <template>
                        <div class="row" data-show="name"><span class="name" data-bind="name"></span> - <span class="role" data-bind="role"></span></div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()

        const innerRows = textOfRows(testContainer, '#inner-list .row')
        const mapRows = textOfRows(testContainer, '#map-list .row')

        expect(innerRows.length).toBe(3)
        expect(mapRows.length).toBe(3)
        expect(innerRows).toEqual(mapRows)

        // Verify actual content
        expect(innerRows[0]).toContain('Alice')
        expect(innerRows[1]).toContain('Bob')
        expect(innerRows[2]).toContain('Carol')
    })

    it('data-bind-class: innerHTML path matches mapFn path', async () => {
        wildflower.component('parity-class', {
            state: {
                items: [
                    { id: 1, label: 'Active', active: true },
                    { id: 2, label: 'Inactive', active: false },
                    { id: 3, label: 'Active Too', active: true }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="parity-class">
                <!-- innerHTML path: data-bind + data-bind-class (no computed, no expression) -->
                <div id="inner-list" data-list="items" data-key="id">
                    <template>
                        <div class="row" data-bind-class="active ? 'is-active' : ''"><span data-bind="label"></span></div>
                    </template>
                </div>
                <!-- mapFn path: same but with data-bind-attr to force cloneNode -->
                <div id="map-list" data-list="items" data-key="id">
                    <template>
                        <div class="row" data-bind-class="active ? 'is-active' : ''" data-bind-attr="data-testid:label"><span data-bind="label"></span></div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()

        const innerText = textOfRows(testContainer, '#inner-list .row')
        const mapText = textOfRows(testContainer, '#map-list .row')

        expect(innerText).toEqual(mapText)

        const innerClasses = classesOfRows(testContainer, '#inner-list .row')
        const mapClasses = classesOfRows(testContainer, '#map-list .row')

        // Both should have is-active on items 0 and 2
        expect(innerClasses[0]).toContain('is-active')
        expect(innerClasses[1]).not.toContain('is-active')
        expect(innerClasses[2]).toContain('is-active')
        expect(innerClasses).toEqual(mapClasses)
    })

    it('multiple data-bind fields: innerHTML path matches mapFn path', async () => {
        wildflower.component('parity-multi', {
            state: {
                people: [
                    { id: 1, first: 'John', last: 'Doe', age: '30' },
                    { id: 2, first: 'Jane', last: 'Smith', age: '25' }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="parity-multi">
                <!-- innerHTML path -->
                <div id="inner-list" data-list="people" data-key="id">
                    <template>
                        <div class="row">
                            <span class="first" data-bind="first"></span>
                            <span class="last" data-bind="last"></span>
                            <span class="age" data-bind="age"></span>
                        </div>
                    </template>
                </div>
                <!-- mapFn path: data-model forces cloneNode -->
                <div id="map-list" data-list="people" data-key="id">
                    <template>
                        <div class="row">
                            <span class="first" data-bind="first"></span>
                            <span class="last" data-bind="last"></span>
                            <span class="age" data-bind="age"></span>
                            <input type="hidden" data-model="age" style="display:none">
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()

        // Compare only the text spans, not the hidden input
        const innerFirst = textOfRows(testContainer, '#inner-list .first')
        const mapFirst = textOfRows(testContainer, '#map-list .first')
        const innerLast = textOfRows(testContainer, '#inner-list .last')
        const mapLast = textOfRows(testContainer, '#map-list .last')
        const innerAge = textOfRows(testContainer, '#inner-list .age')
        const mapAge = textOfRows(testContainer, '#map-list .age')

        expect(innerFirst).toEqual(mapFirst)
        expect(innerLast).toEqual(mapLast)
        expect(innerAge).toEqual(mapAge)

        expect(innerFirst).toEqual(['John', 'Jane'])
        expect(innerLast).toEqual(['Doe', 'Smith'])
    })

    it('computed list source: innerHTML path matches mapFn path', async () => {
        wildflower.component('parity-computed', {
            state: {
                rawTasks: [
                    { id: 1, title: 'Task A', done: false },
                    { id: 2, title: 'Task B', done: true },
                    { id: 3, title: 'Task C', done: false }
                ]
            },
            computed: {
                activeTasks() {
                    return this.state.rawTasks.filter(t => !t.done)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="parity-computed">
                <!-- innerHTML path: computed source, simple bind -->
                <div id="inner-list" data-list="activeTasks" data-key="id">
                    <template>
                        <div class="row"><span data-bind="title"></span></div>
                    </template>
                </div>
                <!-- mapFn path: same computed source, data-show forces cloneNode -->
                <div id="map-list" data-list="activeTasks" data-key="id">
                    <template>
                        <div class="row" data-show="title"><span data-bind="title"></span></div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()

        const innerRows = textOfRows(testContainer, '#inner-list .row')
        const mapRows = textOfRows(testContainer, '#map-list .row')

        // Only non-done tasks should appear (2 items)
        expect(innerRows.length).toBe(2)
        expect(mapRows.length).toBe(2)
        expect(innerRows).toEqual(mapRows)
        expect(innerRows[0]).toBe('Task A')
        expect(innerRows[1]).toBe('Task C')
    })

    it('store-backed computed: innerHTML path matches mapFn path', async () => {
        const storeName = uniqueStore()

        wildflower.store(storeName, {
            state: {
                multiplier: 2
            }
        })

        wildflower.component('parity-store', {
            subscribe: { [storeName]: ['multiplier'] },
            state: {
                baseItems: [
                    { id: 1, label: 'X', value: 10 },
                    { id: 2, label: 'Y', value: 20 }
                ]
            },
            computed: {
                scaledItems() {
                    const mult = this.stores[storeName].state.multiplier
                    return this.state.baseItems.map(item => ({
                        ...item,
                        display: `${item.label}: ${item.value * mult}`
                    }))
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="parity-store">
                <!-- innerHTML path -->
                <div id="inner-list" data-list="scaledItems" data-key="id">
                    <template>
                        <div class="row"><span data-bind="display"></span></div>
                    </template>
                </div>
                <!-- mapFn path -->
                <div id="map-list" data-list="scaledItems" data-key="id">
                    <template>
                        <div class="row" data-show="display"><span data-bind="display"></span></div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()

        const innerRows = textOfRows(testContainer, '#inner-list .row')
        const mapRows = textOfRows(testContainer, '#map-list .row')

        expect(innerRows.length).toBe(2)
        expect(innerRows).toEqual(mapRows)
        expect(innerRows[0]).toBe('X: 20')
        expect(innerRows[1]).toBe('Y: 40')
    })

    it('object class binding expression: innerHTML path matches mapFn path', async () => {
        wildflower.component('parity-obj-class', {
            state: {
                tags: [
                    { id: 1, text: 'Important', urgent: true, archived: false },
                    { id: 2, text: 'Normal', urgent: false, archived: false },
                    { id: 3, text: 'Old', urgent: false, archived: true }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="parity-obj-class">
                <!-- innerHTML path: simple class expression -->
                <div id="inner-list" data-list="tags" data-key="id">
                    <template>
                        <div class="tag" data-bind-class="urgent ? 'is-urgent' : ''"><span data-bind="text"></span></div>
                    </template>
                </div>
                <!-- mapFn path: same class + data-bind-style forces cloneNode -->
                <div id="map-list" data-list="tags" data-key="id">
                    <template>
                        <div class="tag" data-bind-class="urgent ? 'is-urgent' : ''" data-bind-style="opacity:archived ? '0.5' : '1'"><span data-bind="text"></span></div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()

        const innerText = textOfRows(testContainer, '#inner-list .tag')
        const mapText = textOfRows(testContainer, '#map-list .tag')

        expect(innerText).toEqual(mapText)

        // Class parity: is-urgent should appear on first item only
        const innerClasses = classesOfRows(testContainer, '#inner-list .tag')
        const mapClasses = classesOfRows(testContainer, '#map-list .tag')

        expect(innerClasses[0]).toContain('is-urgent')
        expect(innerClasses[1]).not.toContain('is-urgent')
        expect(innerClasses[2]).not.toContain('is-urgent')

        // The text and class state should match across both paths
        expect(innerClasses).toEqual(mapClasses)
    })

    it('empty list renders identically on both paths', async () => {
        wildflower.component('parity-empty', {
            state: { items: [] }
        })

        testContainer.innerHTML = `
            <div data-component="parity-empty">
                <div id="inner-list" data-list="items" data-key="id">
                    <template>
                        <div class="row"><span data-bind="name"></span></div>
                    </template>
                </div>
                <div id="map-list" data-list="items" data-key="id">
                    <template>
                        <div class="row" data-show="name"><span data-bind="name"></span></div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()

        const innerRows = testContainer.querySelectorAll('#inner-list .row')
        const mapRows = testContainer.querySelectorAll('#map-list .row')

        expect(innerRows.length).toBe(0)
        expect(mapRows.length).toBe(0)
    })

    it('single item renders identically on both paths', async () => {
        wildflower.component('parity-single', {
            state: {
                items: [{ id: 1, name: 'Solo' }]
            }
        })

        testContainer.innerHTML = `
            <div data-component="parity-single">
                <div id="inner-list" data-list="items" data-key="id">
                    <template>
                        <div class="row"><span data-bind="name"></span></div>
                    </template>
                </div>
                <div id="map-list" data-list="items" data-key="id">
                    <template>
                        <div class="row" data-show="name"><span data-bind="name"></span></div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()

        const innerRows = textOfRows(testContainer, '#inner-list .row')
        const mapRows = textOfRows(testContainer, '#map-list .row')

        expect(innerRows).toEqual(['Solo'])
        expect(mapRows).toEqual(['Solo'])
    })
})
