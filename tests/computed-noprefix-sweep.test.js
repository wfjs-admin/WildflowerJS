/**
 * Comprehensive test sweep for computed property auto-detection.
 *
 * Validates that all binding types work identically with and without
 * the computed: prefix, and that binding processors inside data-list
 * containers are not double-processed by the parent component.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForCompleteRender } from './helpers/load-framework.js'

// Unique store counter to avoid cross-test collisions
let storeCounter = 0
function uniqueStore() { return `sweepStore${++storeCounter}` }

describe('Computed No-Prefix Sweep', () => {
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

    // ═══════════════════════════════════════════════════════════════
    // TIER 1 — Fix Validation
    // ═══════════════════════════════════════════════════════════════

    describe('Tier 1: Fix Validation', () => {

        it('1a: data-list="items" renders when items is computed (no prefix)', async () => {
            wildflower.component('t1a-list', {
                state: {
                    rawItems: [
                        { id: 1, name: 'Alpha' },
                        { id: 2, name: 'Beta' }
                    ]
                },
                computed: {
                    items() {
                        return this.state.rawItems
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t1a-list">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item"><span data-bind="name"></span></div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].textContent).toBe('Alpha')
            expect(items[1].textContent).toBe('Beta')
        })

        it('1b: component-in-list: data-list="cards" identical to computed:cards', async () => {
            const storeName = uniqueStore()
            wildflower.store(storeName, {
                state: {
                    columns: [
                        { id: 'col-1', name: 'To Do', cards: [
                            { id: 1, title: 'Card A' },
                            { id: 2, title: 'Card B' }
                        ]},
                        { id: 'col-2', name: 'Done', cards: [
                            { id: 3, title: 'Card C' }
                        ]}
                    ]
                }
            })

            wildflower.component('t1b-column', {
                subscribe: { [storeName]: ['columns'] },
                state: { _colId: null },
                computed: {
                    column() {
                        if (!this.stores[storeName] || !this.state._colId) return null
                        return this.stores[storeName].state.columns.find(c => c.id === this.state._colId) || null
                    },
                    cards() {
                        var col = this.computed.column
                        return col ? col.cards : []
                    }
                },
                beforeInit() {
                    if (this.listItem) {
                        this.state._colId = this.listItem.id
                    }
                }
            })

            wildflower.component('t1b-board', {
                subscribe: { [storeName]: ['columns'] },
                computed: {
                    columns() {
                        return this.stores[storeName] ? this.stores[storeName].state.columns : []
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t1b-board">
                    <div data-list="$${storeName}.columns" data-key="id">
                        <template>
                            <div data-component="t1b-column" data-bind-attr="({ 'data-column-id': id })">
                                <span class="col-name" data-bind="name"></span>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card"><span data-bind="title"></span></div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 300))

            const cards = testContainer.querySelectorAll('.card')
            expect(cards.length).toBe(3)
            expect(cards[0].textContent).toBe('Card A')
            expect(cards[1].textContent).toBe('Card B')
            expect(cards[2].textContent).toBe('Card C')
        })

        it('1c: store update triggers re-render of no-prefix computed list', async () => {
            const storeName = uniqueStore()
            wildflower.store(storeName, {
                state: {
                    rawItems: [
                        { id: 1, label: 'First' }
                    ]
                },
                addItem(item) {
                    this.state.rawItems.push(item)
                }
            })

            wildflower.component('t1c-comp', {
                subscribe: { [storeName]: ['rawItems'] },
                computed: {
                    items() {
                        return this.stores[storeName] ? this.stores[storeName].state.rawItems : []
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t1c-comp">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item"><span data-bind="label"></span></div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 200))

            expect(testContainer.querySelectorAll('.item').length).toBe(1)

            // Mutate store
            wildflower.getStore(storeName).addItem({ id: 2, label: 'Second' })
            await new Promise(r => setTimeout(r, 300))

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[1].textContent).toBe('Second')
        })

        it('1d: data-bind-html inside list NOT processed by parent component', async () => {
            wildflower.component('t1d-comp', {
                state: {
                    items: [
                        { id: 1, content: '<em>bold</em>' },
                        { id: 2, content: '<strong>strong</strong>' }
                    ],
                    parentHtml: '<span>parent</span>'
                }
            })

            testContainer.innerHTML = `
                <div data-component="t1d-comp">
                    <div class="parent-html" data-bind-html="parentHtml"></div>
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item" data-bind-html="content"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            // Parent HTML binding should work
            expect(testContainer.querySelector('.parent-html').innerHTML).toContain('parent')

            // List item HTML bindings should bind to item data, not parent state
            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].innerHTML).toContain('bold')
            expect(items[1].innerHTML).toContain('strong')
        })

        it('1e: data-bind-style inside list NOT processed by parent component', async () => {
            wildflower.component('t1e-comp', {
                state: {
                    items: [
                        { id: 1, color: 'red' },
                        { id: 2, color: 'blue' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="t1e-comp">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item" data-bind-style="({ color: color })">
                                <span data-bind="color"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            // Items should have their own color, not undefined from parent scope
            expect(items[0].style.color).toBe('red')
            expect(items[1].style.color).toBe('blue')
        })

        it('1f: data-bind-attr inside list NOT processed by parent component', async () => {
            wildflower.component('t1f-comp', {
                state: {
                    items: [
                        { id: 1, tooltip: 'Tip A' },
                        { id: 2, tooltip: 'Tip B' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="t1f-comp">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item" data-bind-attr="({ title: tooltip })">
                                <span data-bind="tooltip"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].getAttribute('title')).toBe('Tip A')
            expect(items[1].getAttribute('title')).toBe('Tip B')
        })

        it('1g: data-model inside list NOT processed by parent component', async () => {
            wildflower.component('t1g-comp', {
                state: {
                    items: [
                        { id: 1, value: 'hello' },
                        { id: 2, value: 'world' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="t1g-comp">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item">
                                <input type="text" data-model="value" />
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            const inputs = testContainer.querySelectorAll('.item input')
            expect(inputs.length).toBe(2)
            // Inputs should reflect item value, not parent component state
            expect(inputs[0].value).toBe('hello')
            expect(inputs[1].value).toBe('world')
        })

        it('1h: list context preserves Context prototype chain', async () => {
            wildflower.component('t1h-comp', {
                state: {
                    items: [
                        { id: 1, name: 'test' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="t1h-comp">
                    <div class="list-el" data-list="items" data-key="id">
                        <template>
                            <div class="item"><span data-bind="name"></span></div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            const listEl = testContainer.querySelector('.list-el')
            expect(listEl._listContext).toBeDefined()
            // Context prototype chain should be intact — resolveData should be available
            expect(typeof listEl._listContext.resolveData).toBe('function')
        })
    })

    // ═══════════════════════════════════════════════════════════════
    // TIER 2 — Parity Tests (prefix vs no-prefix)
    // ═══════════════════════════════════════════════════════════════

    describe('Tier 2: Parity Tests', () => {

        it('2a: data-bind with computed in list: prefix vs no-prefix', async () => {
            // Test both prefix and no-prefix produce same result
            wildflower.component('t2a-prefix', {
                state: { rawItems: [{ id: 1, name: 'Test' }] },
                computed: {
                    items() { return this.state.rawItems }
                }
            })
            wildflower.component('t2a-noprefix', {
                state: { rawItems: [{ id: 1, name: 'Test' }] },
                computed: {
                    items() { return this.state.rawItems }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t2a-prefix">
                    <div data-list="computed:items" data-key="id">
                        <template>
                            <div class="prefix-item"><span data-bind="name"></span></div>
                        </template>
                    </div>
                </div>
                <div data-component="t2a-noprefix">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="noprefix-item"><span data-bind="name"></span></div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            const prefixItems = testContainer.querySelectorAll('.prefix-item')
            const noPrefixItems = testContainer.querySelectorAll('.noprefix-item')
            expect(prefixItems.length).toBe(1)
            expect(noPrefixItems.length).toBe(1)
            expect(prefixItems[0].textContent).toBe(noPrefixItems[0].textContent)
        })

        it('2b: data-bind-class with computed in list: prefix vs no-prefix', async () => {
            wildflower.component('t2b-prefix', {
                state: { rawItems: [{ id: 1, active: true, name: 'X' }] },
                computed: {
                    items() { return this.state.rawItems }
                }
            })
            wildflower.component('t2b-noprefix', {
                state: { rawItems: [{ id: 1, active: true, name: 'X' }] },
                computed: {
                    items() { return this.state.rawItems }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t2b-prefix">
                    <div data-list="computed:items" data-key="id">
                        <template>
                            <div class="prefix-item" data-bind-class="({ 'is-active': active })">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
                <div data-component="t2b-noprefix">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="noprefix-item" data-bind-class="({ 'is-active': active })">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            const prefixItem = testContainer.querySelector('.prefix-item')
            const noPrefixItem = testContainer.querySelector('.noprefix-item')
            expect(prefixItem.classList.contains('is-active')).toBe(true)
            expect(noPrefixItem.classList.contains('is-active')).toBe(true)
        })

        it('2c: data-bind-style with computed in list: prefix vs no-prefix', async () => {
            wildflower.component('t2c-prefix', {
                state: { rawItems: [{ id: 1, bg: 'red' }] },
                computed: {
                    items() { return this.state.rawItems }
                }
            })
            wildflower.component('t2c-noprefix', {
                state: { rawItems: [{ id: 1, bg: 'red' }] },
                computed: {
                    items() { return this.state.rawItems }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t2c-prefix">
                    <div data-list="computed:items" data-key="id">
                        <template>
                            <div class="prefix-item" data-bind-style="({ backgroundColor: bg })"></div>
                        </template>
                    </div>
                </div>
                <div data-component="t2c-noprefix">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="noprefix-item" data-bind-style="({ backgroundColor: bg })"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            const prefixItem = testContainer.querySelector('.prefix-item')
            const noPrefixItem = testContainer.querySelector('.noprefix-item')
            expect(prefixItem.style.backgroundColor).toBe('red')
            expect(noPrefixItem.style.backgroundColor).toBe('red')
        })

        it('2d: data-bind-attr with computed in list: prefix vs no-prefix', async () => {
            wildflower.component('t2d-prefix', {
                state: { rawItems: [{ id: 1, tip: 'hello' }] },
                computed: {
                    items() { return this.state.rawItems }
                }
            })
            wildflower.component('t2d-noprefix', {
                state: { rawItems: [{ id: 1, tip: 'hello' }] },
                computed: {
                    items() { return this.state.rawItems }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t2d-prefix">
                    <div data-list="computed:items" data-key="id">
                        <template>
                            <div class="prefix-item" data-bind-attr="({ title: tip })"></div>
                        </template>
                    </div>
                </div>
                <div data-component="t2d-noprefix">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="noprefix-item" data-bind-attr="({ title: tip })"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            expect(testContainer.querySelector('.prefix-item').getAttribute('title')).toBe('hello')
            expect(testContainer.querySelector('.noprefix-item').getAttribute('title')).toBe('hello')
        })

        it('2e: data-bind-html with computed in list: prefix vs no-prefix', async () => {
            wildflower.component('t2e-prefix', {
                state: { rawItems: [{ id: 1, html: '<em>hi</em>' }] },
                computed: {
                    items() { return this.state.rawItems }
                }
            })
            wildflower.component('t2e-noprefix', {
                state: { rawItems: [{ id: 1, html: '<em>hi</em>' }] },
                computed: {
                    items() { return this.state.rawItems }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t2e-prefix">
                    <div data-list="computed:items" data-key="id">
                        <template>
                            <div class="prefix-item" data-bind-html="html"></div>
                        </template>
                    </div>
                </div>
                <div data-component="t2e-noprefix">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="noprefix-item" data-bind-html="html"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            expect(testContainer.querySelector('.prefix-item').innerHTML).toContain('<em>hi</em>')
            expect(testContainer.querySelector('.noprefix-item').innerHTML).toContain('<em>hi</em>')
        })

        it('2f: data-model inside list binds to item property, not component state', async () => {
            wildflower.component('t2f-comp', {
                state: {
                    value: 'component-level',
                    items: [
                        { id: 1, value: 'item-one' },
                        { id: 2, value: 'item-two' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="t2f-comp">
                    <input class="comp-input" type="text" data-model="value" />
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item">
                                <input class="list-input" type="text" data-model="value" />
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            const compInput = testContainer.querySelector('.comp-input')
            const listInputs = testContainer.querySelectorAll('.list-input')

            expect(compInput.value).toBe('component-level')
            expect(listInputs.length).toBe(2)
            expect(listInputs[0].value).toBe('item-one')
            expect(listInputs[1].value).toBe('item-two')
        })

        it('2g: data-show with computed in list without prefix', async () => {
            wildflower.component('t2g-comp', {
                state: {
                    rawItems: [
                        { id: 1, name: 'Visible', hidden: false },
                        { id: 2, name: 'Hidden', hidden: true }
                    ]
                },
                computed: {
                    items() { return this.state.rawItems }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t2g-comp">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item" data-show="!hidden">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            // First item visible, second hidden
            expect(items[0].style.display).not.toBe('none')
            expect(items[1].style.display).toBe('none')
        })

        it('2h: component-in-list with all binding types on inner list items', async () => {
            const storeName = uniqueStore()
            wildflower.store(storeName, {
                state: {
                    groups: [
                        { id: 'g1', items: [
                            { id: 1, name: 'Item 1', active: true, color: 'green', tip: 'Tip 1' }
                        ]}
                    ]
                }
            })

            wildflower.component('t2h-group', {
                subscribe: { [storeName]: ['groups'] },
                state: { _gid: null },
                computed: {
                    group() {
                        if (!this.stores[storeName] || !this.state._gid) return null
                        return this.stores[storeName].state.groups.find(g => g.id === this.state._gid) || null
                    },
                    items() {
                        var g = this.computed.group
                        return g ? g.items : []
                    }
                },
                beforeInit() {
                    if (this.listItem) this.state._gid = this.listItem.id
                }
            })

            wildflower.component('t2h-board', {
                subscribe: { [storeName]: ['groups'] },
                computed: {
                    groups() {
                        return this.stores[storeName] ? this.stores[storeName].state.groups : []
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t2h-board">
                    <div data-list="$${storeName}.groups" data-key="id">
                        <template>
                            <div data-component="t2h-group">
                                <div data-list="items" data-key="id">
                                    <template>
                                        <div class="item"
                                             data-bind-class="({ 'is-active': active })"
                                             data-bind-style="({ color: color })"
                                             data-bind-attr="({ title: tip })">
                                            <span data-bind="name"></span>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 300))

            const item = testContainer.querySelector('.item')
            expect(item).not.toBeNull()
            expect(item.textContent).toBe('Item 1')
            expect(item.classList.contains('is-active')).toBe(true)
            expect(item.style.color).toBe('green')
            expect(item.getAttribute('title')).toBe('Tip 1')
        })

        it('2i: onStoreUpdate + computed chain + list re-renders', async () => {
            const storeName = uniqueStore()
            wildflower.store(storeName, {
                state: {
                    items: [
                        { id: 1, label: 'A' },
                        { id: 2, label: 'B' }
                    ],
                    filter: ''
                },
                setFilter(f) { this.state.filter = f }
            })

            wildflower.component('t2i-comp', {
                subscribe: { [storeName]: ['items', 'filter'] },
                state: { updateCount: 0 },
                computed: {
                    filteredItems() {
                        if (!this.stores[storeName]) return []
                        var items = this.stores[storeName].state.items
                        var f = this.stores[storeName].state.filter.toLowerCase()
                        if (!f) return items
                        return items.filter(function(i) { return i.label.toLowerCase().includes(f) })
                    }
                },
                onStoreUpdate() {
                    this.state.updateCount++
                }
            })

            testContainer.innerHTML = `
                <div data-component="t2i-comp">
                    <span class="count" data-bind="updateCount"></span>
                    <div data-list="filteredItems" data-key="id">
                        <template>
                            <div class="item"><span data-bind="label"></span></div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 200))

            expect(testContainer.querySelectorAll('.item').length).toBe(2)

            // Update store filter to narrow results
            wildflower.getStore(storeName).setFilter('A')
            await new Promise(r => setTimeout(r, 300))

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(1)
            expect(items[0].textContent).toBe('A')
        })
    })

    // ═══════════════════════════════════════════════════════════════
    // TIER 3 — Stress Combinations
    // ═══════════════════════════════════════════════════════════════

    describe('Tier 3: Stress Combinations', () => {

        it('3a: multiple binding types on same element in list', async () => {
            wildflower.component('t3a-comp', {
                state: {
                    rawItems: [
                        { id: 1, name: 'Test', active: true, bg: 'yellow', tip: 'Info' }
                    ]
                },
                computed: {
                    items() { return this.state.rawItems }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t3a-comp">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item"
                                 data-bind-class="({ 'is-active': active })"
                                 data-bind-style="({ backgroundColor: bg })"
                                 data-bind-attr="({ title: tip })">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            const item = testContainer.querySelector('.item')
            expect(item.textContent).toBe('Test')
            expect(item.classList.contains('is-active')).toBe(true)
            expect(item.style.backgroundColor).toBe('yellow')
            expect(item.getAttribute('title')).toBe('Info')
        })

        it('3b: 3-level nesting: board -> columns -> column component -> cards', async () => {
            const storeName = uniqueStore()
            wildflower.store(storeName, {
                state: {
                    columns: [
                        { id: 'col-1', name: 'Backlog', cards: [
                            { id: 1, title: 'Task 1' },
                            { id: 2, title: 'Task 2' }
                        ]},
                        { id: 'col-2', name: 'In Progress', cards: [
                            { id: 3, title: 'Task 3' }
                        ]},
                        { id: 'col-3', name: 'Done', cards: [] }
                    ]
                }
            })

            wildflower.component('t3b-column', {
                subscribe: { [storeName]: ['columns'] },
                state: { _colId: null },
                computed: {
                    column() {
                        if (!this.stores[storeName] || !this.state._colId) return null
                        return this.stores[storeName].state.columns.find(c => c.id === this.state._colId) || null
                    },
                    columnName() {
                        var col = this.computed.column
                        return col ? col.name : ''
                    },
                    cards() {
                        var col = this.computed.column
                        return col ? col.cards : []
                    },
                    cardCount() {
                        return this.computed.cards.length
                    }
                },
                beforeInit() {
                    if (this.listItem) this.state._colId = this.listItem.id
                }
            })

            wildflower.component('t3b-board', {
                subscribe: { [storeName]: ['columns'] },
                computed: {
                    columns() {
                        return this.stores[storeName] ? this.stores[storeName].state.columns : []
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t3b-board">
                    <div data-list="$${storeName}.columns" data-key="id">
                        <template>
                            <div data-component="t3b-column" data-bind-attr="({ 'data-column-id': id })">
                                <h3 class="col-name" data-bind="columnName"></h3>
                                <span class="card-count" data-bind="cardCount"></span>
                                <div data-list="cards" data-key="id">
                                    <template>
                                        <div class="card">
                                            <span class="card-title" data-bind="title"></span>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 400))

            // Verify column names
            const colNames = testContainer.querySelectorAll('.col-name')
            expect(colNames.length).toBe(3)
            expect(colNames[0].textContent).toBe('Backlog')
            expect(colNames[1].textContent).toBe('In Progress')
            expect(colNames[2].textContent).toBe('Done')

            // Verify card counts
            const cardCounts = testContainer.querySelectorAll('.card-count')
            expect(cardCounts[0].textContent).toBe('2')
            expect(cardCounts[1].textContent).toBe('1')
            expect(cardCounts[2].textContent).toBe('0')

            // Verify cards
            const cards = testContainer.querySelectorAll('.card')
            expect(cards.length).toBe(3)
            expect(cards[0].textContent).toBe('Task 1')
            expect(cards[1].textContent).toBe('Task 2')
            expect(cards[2].textContent).toBe('Task 3')
        })

        it('3c: computed chains across component boundaries', async () => {
            const storeName = uniqueStore()
            wildflower.store(storeName, {
                state: {
                    multiplier: 2,
                    rawItems: [
                        { id: 1, base: 10 },
                        { id: 2, base: 20 }
                    ]
                }
            })

            wildflower.component('t3c-comp', {
                subscribe: { [storeName]: ['rawItems', 'multiplier'] },
                computed: {
                    items() {
                        if (!this.stores[storeName]) return []
                        var m = this.stores[storeName].state.multiplier
                        return this.stores[storeName].state.rawItems.map(function(item) {
                            return { id: item.id, value: item.base * m }
                        })
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t3c-comp">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item"><span data-bind="value"></span></div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 200))

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].textContent).toBe('20')
            expect(items[1].textContent).toBe('40')
        })

        it('3d: full kanban pattern with zero computed: prefixes', async () => {
            const storeName = uniqueStore()
            wildflower.store(storeName, {
                state: {
                    columns: [
                        { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                            { id: 1, title: 'Design', priority: 'high' },
                            { id: 2, title: 'Develop', priority: 'medium' }
                        ]},
                        { id: 'col-2', name: 'Done', color: '#d4edda', cards: [
                            { id: 3, title: 'Plan', priority: 'low' }
                        ]}
                    ],
                    searchQuery: ''
                },
                setSearch(q) { this.state.searchQuery = q }
            })

            wildflower.component('t3d-column', {
                subscribe: { [storeName]: ['columns', 'searchQuery'] },
                state: { _colId: null },
                computed: {
                    column() {
                        if (!this.stores[storeName] || !this.state._colId) return null
                        return this.stores[storeName].state.columns.find(c => c.id === this.state._colId) || null
                    },
                    columnName() {
                        var col = this.computed.column
                        return col ? col.name : ''
                    },
                    cards() {
                        if (!this.state._colId) return []
                        var col = this.computed.column
                        if (!this.stores[storeName] || !col) return []
                        var allCards = col.cards || []
                        var query = (this.stores[storeName].state.searchQuery || '').toLowerCase().trim()
                        if (!query) return allCards
                        return allCards.filter(function(c) {
                            return c.title.toLowerCase().includes(query)
                        })
                    },
                    cardCount() {
                        return this.computed.cards.length
                    }
                },
                beforeInit() {
                    if (this.listItem) this.state._colId = this.listItem.id
                }
            })

            wildflower.component('t3d-board', {
                subscribe: { [storeName]: ['columns'] },
                computed: {
                    columns() {
                        return this.stores[storeName] ? this.stores[storeName].state.columns : []
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="t3d-board">
                    <div data-list="$${storeName}.columns" data-key="id">
                        <template>
                            <div data-component="t3d-column" data-bind-attr="({ 'data-column-id': id })">
                                <div class="col-header">
                                    <span class="col-name" data-bind="columnName"></span>
                                    <span class="badge" data-bind="cardCount"></span>
                                </div>
                                <div data-list="cards" data-key="id">
                                    <template>
                                        <div class="card"
                                             data-bind-class="({ 'priority-high': priority === 'high', 'priority-medium': priority === 'medium', 'priority-low': priority === 'low' })">
                                            <span class="card-title" data-bind="title"></span>
                                            <span class="card-priority" data-bind="priority"></span>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 400))

            // Verify structure
            const colNames = testContainer.querySelectorAll('.col-name')
            expect(colNames.length).toBe(2)
            expect(colNames[0].textContent).toBe('To Do')
            expect(colNames[1].textContent).toBe('Done')

            // Verify card counts
            const badges = testContainer.querySelectorAll('.badge')
            expect(badges[0].textContent).toBe('2')
            expect(badges[1].textContent).toBe('1')

            // Verify cards
            const cards = testContainer.querySelectorAll('.card')
            expect(cards.length).toBe(3)
            expect(cards[0].querySelector('.card-title').textContent).toBe('Design')
            expect(cards[0].classList.contains('priority-high')).toBe(true)
            expect(cards[1].querySelector('.card-title').textContent).toBe('Develop')
            expect(cards[1].classList.contains('priority-medium')).toBe(true)
            expect(cards[2].querySelector('.card-title').textContent).toBe('Plan')
            expect(cards[2].classList.contains('priority-low')).toBe(true)

            // Verify card priority text bindings
            expect(cards[0].querySelector('.card-priority').textContent).toBe('high')
            expect(cards[1].querySelector('.card-priority').textContent).toBe('medium')
            expect(cards[2].querySelector('.card-priority').textContent).toBe('low')
        })
    })
})
