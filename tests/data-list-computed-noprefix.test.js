/**
 * Test for data-list with computed property WITHOUT the computed: prefix.
 *
 * Currently data-list="computed:items" works but data-list="items" does not
 * when "items" is a computed property in certain scenarios (e.g., component
 * rendered inside another list). The computed: prefix should be optional
 * for data-list, just as it is for data-bind, data-show, data-bind-class, etc.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForCompleteRender } from './helpers/load-framework.js'

describe('data-list computed property without prefix', () => {
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

    it('should render a list from a computed property with computed: prefix', async () => {
        wildflower.component('list-with-prefix', {
            state: {
                rawItems: [
                    { id: 1, name: 'Alpha' },
                    { id: 2, name: 'Beta' },
                    { id: 3, name: 'Gamma' }
                ]
            },
            computed: {
                items() {
                    return this.state.rawItems
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-with-prefix">
                <div data-list="computed:items" data-key="id">
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
        expect(items.length).toBe(3)
        expect(items[0].textContent).toBe('Alpha')
        expect(items[1].textContent).toBe('Beta')
        expect(items[2].textContent).toBe('Gamma')
    })

    it('should render a list from a computed property WITHOUT computed: prefix', async () => {
        wildflower.component('list-no-prefix', {
            state: {
                rawItems: [
                    { id: 1, name: 'Alpha' },
                    { id: 2, name: 'Beta' },
                    { id: 3, name: 'Gamma' }
                ]
            },
            computed: {
                items() {
                    return this.state.rawItems
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-no-prefix">
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
        expect(items.length).toBe(3)
        expect(items[0].textContent).toBe('Alpha')
        expect(items[1].textContent).toBe('Beta')
        expect(items[2].textContent).toBe('Gamma')
    })

    it('should render computed list inside a component rendered inside another list (kanban pattern) WITH prefix', async () => {
        // Store with columns containing cards
        wildflower.store('testkanban', {
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

        // Child component rendered per-column inside a list
        wildflower.component('test-column-wp', {
            subscribe: { testkanban: ['columns'] },
            state: { _colId: null },
            computed: {
                column() {
                    if (!this.stores.testkanban || !this.state._colId) return null
                    return this.stores.testkanban.state.columns.find(c => c.id === this.state._colId) || null
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

        // Parent component
        wildflower.component('test-board-wp', {
            subscribe: { testkanban: ['columns'] },
            computed: {
                columns() {
                    return this.stores.testkanban ? this.stores.testkanban.state.columns : []
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-wp">
                <div data-list="$testkanban.columns" data-key="id">
                    <template>
                        <div data-component="test-column-wp" data-bind-attr="({ 'data-column-id': id })">
                            <span class="col-name" data-bind="name"></span>
                            <div class="card-list" data-list="computed:cards" data-key="id">
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

    it('should render computed list inside a component rendered inside another list (kanban pattern) WITHOUT prefix', async () => {
        // Store with columns containing cards
        wildflower.store('testkanban2', {
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

        // Child component rendered per-column inside a list
        wildflower.component('test-column-np', {
            subscribe: { testkanban2: ['columns'] },
            state: { _colId: null },
            computed: {
                column() {
                    if (!this.stores.testkanban2 || !this.state._colId) return null
                    return this.stores.testkanban2.state.columns.find(c => c.id === this.state._colId) || null
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

        // Parent component
        wildflower.component('test-board-np', {
            subscribe: { testkanban2: ['columns'] },
            computed: {
                columns() {
                    return this.stores.testkanban2 ? this.stores.testkanban2.state.columns : []
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-np">
                <div data-list="$testkanban2.columns" data-key="id">
                    <template>
                        <div data-component="test-column-np" data-bind-attr="({ 'data-column-id': id })">
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

    // ── Progressive kanban feature tests (no prefix) ──
    // Each test adds one more feature from the real kanban demo

    it('PROG 1: + searchQuery in store and cards computed filter (no prefix)', async () => {
        wildflower.store('testkanban3', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', cards: [
                        { id: 1, title: 'Card A', description: 'First card' },
                        { id: 2, title: 'Card B', description: 'Second card' }
                    ]},
                    { id: 'col-2', name: 'Done', cards: [
                        { id: 3, title: 'Card C', description: 'Third card' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p1', {
            subscribe: { testkanban3: ['columns'] },
            state: { _colId: null },
            computed: {
                column() {
                    if (!this.stores.testkanban3 || !this.state._colId) return null
                    return this.stores.testkanban3.state.columns.find(c => c.id === this.state._colId) || null
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban3 || !col) return []
                    var allCards = col.cards || []
                    var query = (this.stores.testkanban3.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return allCards
                    return allCards.filter(function(c) {
                        return c.title.toLowerCase().includes(query) ||
                               (c.description && c.description.toLowerCase().includes(query))
                    })
                }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                }
            }
        })

        wildflower.component('test-board-p1', {
            subscribe: { testkanban3: ['columns'] },
            computed: {
                columns() {
                    return this.stores.testkanban3 ? this.stores.testkanban3.state.columns : []
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p1">
                <div data-list="$testkanban3.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p1" data-bind-attr="({ 'data-column-id': id })">
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

    it('PROG 2: + onStoreUpdate callback (no prefix)', async () => {
        wildflower.store('testkanban4', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', cards: [
                        { id: 1, title: 'Card A', description: 'First card' },
                        { id: 2, title: 'Card B', description: 'Second card' }
                    ]},
                    { id: 'col-2', name: 'Done', cards: [
                        { id: 3, title: 'Card C', description: 'Third card' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p2', {
            subscribe: { testkanban4: ['columns'] },
            state: {
                _colId: null,
                currentColor: '#ebecf0',
                settingsName: '',
                settingsColor: ''
            },
            computed: {
                column() {
                    if (!this.stores.testkanban4 || !this.state._colId) return null
                    return this.stores.testkanban4.state.columns.find(c => c.id === this.state._colId) || null
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban4 || !col) return []
                    var allCards = col.cards || []
                    var query = (this.stores.testkanban4.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return allCards
                    return allCards.filter(function(c) {
                        return c.title.toLowerCase().includes(query) ||
                               (c.description && c.description.toLowerCase().includes(query))
                    })
                }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban4' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p2', {
            subscribe: { testkanban4: ['columns'] },
            computed: {
                columns() {
                    return this.stores.testkanban4 ? this.stores.testkanban4.state.columns : []
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p2">
                <div data-list="$testkanban4.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p2" data-bind-attr="({ 'data-column-id': id })">
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

    it('PROG 3: + many computed properties matching kanban-column (no prefix)', async () => {
        wildflower.store('testkanban5', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3', {
            subscribe: { testkanban5: ['columns'] },
            state: {
                _colId: null,
                currentColor: '#ebecf0',
                isAdding: false,
                newTitle: '',
                newDescription: '',
                newPriority: 'medium',
                isSettingsOpen: false,
                settingsName: '',
                settingsColor: ''
            },
            computed: {
                colId() {
                    return this.state._colId
                },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban5 || !colId) return null
                    return this.stores.testkanban5.state.columns.find(function(c) { return c.id === colId }) || null
                },
                columnName() {
                    var col = this.computed.column
                    return col ? col.name : ''
                },
                columnColor() {
                    var col = this.computed.column
                    return col ? col.color : '#ebecf0'
                },
                bgStyle() {
                    return { backgroundColor: this.state.currentColor }
                },
                headerStyle() {
                    return { color: '#172b4d' }
                },
                countStyle() {
                    return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' }
                },
                settingsBtnStyle() {
                    return { color: '#172b4d' }
                },
                addCardBtnStyle() {
                    return { color: '#5e6c84' }
                },
                canDeleteColumn() {
                    return this.stores.testkanban5 && this.stores.testkanban5.state.columns.length > 1
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban5 || !col) return []
                    var allCards = col.cards || []
                    var query = (this.stores.testkanban5.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return allCards
                    return allCards.filter(function(c) {
                        return c.title.toLowerCase().includes(query) ||
                               (c.description && c.description.toLowerCase().includes(query))
                    })
                },
                cardCount() {
                    return this.computed.cards.length
                }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban5' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3', {
            subscribe: { testkanban5: ['columns'] },
            computed: {
                columns() {
                    return this.stores.testkanban5 ? this.stores.testkanban5.state.columns : []
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3">
                <div data-list="$testkanban5.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3" data-bind-attr="({ 'data-column-id': id })">
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

    // ── Sub-tests between PROG 3 and PROG 4 ──
    // Same component definition as PROG 4, but incrementally adding HTML features

    it('PROG 3.1: + data-bind-style on wrapper div (no prefix)', async () => {
        wildflower.store('testkanban6a', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3a', {
            subscribe: { testkanban6a: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6a || !colId) return null
                    return this.stores.testkanban6a.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6a || !col) return []
                    var allCards = col.cards || []
                    var query = (this.stores.testkanban6a.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return allCards
                    return allCards.filter(function(c) {
                        return c.title.toLowerCase().includes(query) ||
                               (c.description && c.description.toLowerCase().includes(query))
                    })
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6a' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3a', {
            subscribe: { testkanban6a: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6a ? this.stores.testkanban6a.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3a">
                <div data-list="$testkanban6a.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3a" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <span class="col-name" data-bind="name"></span>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card"><span data-bind="title"></span></div>
                                    </template>
                                </div>
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

    it('PROG 3.2: + column header bindings (settingsName, cardCount, styles) (no prefix)', async () => {
        wildflower.store('testkanban6b', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3b', {
            subscribe: { testkanban6b: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6b || !colId) return null
                    return this.stores.testkanban6b.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                headerStyle() { return { color: '#172b4d' } },
                countStyle() { return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' } },
                settingsBtnStyle() { return { color: '#172b4d' } },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6b || !col) return []
                    var allCards = col.cards || []
                    var query = (this.stores.testkanban6b.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return allCards
                    return allCards.filter(function(c) {
                        return c.title.toLowerCase().includes(query) ||
                               (c.description && c.description.toLowerCase().includes(query))
                    })
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6b' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3b', {
            subscribe: { testkanban6b: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6b ? this.stores.testkanban6b.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3b">
                <div data-list="$testkanban6b.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3b" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                    <button class="column-settings-btn" data-bind-style="computed:settingsBtnStyle"></button>
                                </div>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card"><span data-bind="title"></span></div>
                                    </template>
                                </div>
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

    it('PROG 3.3: + data-show elements (isSettingsOpen, canDeleteColumn, isAdding) (no prefix)', async () => {
        wildflower.store('testkanban6c', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3c', {
            subscribe: { testkanban6c: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6c || !colId) return null
                    return this.stores.testkanban6c.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                headerStyle() { return { color: '#172b4d' } },
                countStyle() { return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' } },
                settingsBtnStyle() { return { color: '#172b4d' } },
                addCardBtnStyle() { return { color: '#5e6c84' } },
                canDeleteColumn() {
                    return this.stores.testkanban6c && this.stores.testkanban6c.state.columns.length > 1
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6c || !col) return []
                    var allCards = col.cards || []
                    var query = (this.stores.testkanban6c.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return allCards
                    return allCards.filter(function(c) {
                        return c.title.toLowerCase().includes(query) ||
                               (c.description && c.description.toLowerCase().includes(query))
                    })
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6c' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3c', {
            subscribe: { testkanban6c: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6c ? this.stores.testkanban6c.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3c">
                <div data-list="$testkanban6c.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3c" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                    <button class="column-settings-btn" data-bind-style="computed:settingsBtnStyle"></button>
                                    <div class="column-settings-popover" data-show="isSettingsOpen">
                                        <button class="settings-delete-btn" data-show="computed:canDeleteColumn"></button>
                                    </div>
                                </div>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card"><span data-bind="title"></span></div>
                                    </template>
                                </div>
                                <div class="add-card-section">
                                    <div data-show="!isAdding">
                                        <button class="add-card-btn" data-bind-style="computed:addCardBtnStyle">+ Add</button>
                                    </div>
                                    <div data-show="isAdding">
                                        <input type="text" data-model="newTitle">
                                    </div>
                                </div>
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

    it('PROG 3.3a: 3.3 card template + data-bind-attr only (no prefix)', async () => {
        wildflower.store('testkanban6e', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3e', {
            subscribe: { testkanban6e: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6e || !colId) return null
                    return this.stores.testkanban6e.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                headerStyle() { return { color: '#172b4d' } },
                countStyle() { return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' } },
                settingsBtnStyle() { return { color: '#172b4d' } },
                addCardBtnStyle() { return { color: '#5e6c84' } },
                canDeleteColumn() {
                    return this.stores.testkanban6e && this.stores.testkanban6e.state.columns.length > 1
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6e || !col) return []
                    return col.cards || []
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6e' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3e', {
            subscribe: { testkanban6e: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6e ? this.stores.testkanban6e.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3e">
                <div data-list="$testkanban6e.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3e" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                    <button class="column-settings-btn" data-bind-style="computed:settingsBtnStyle"></button>
                                    <div class="column-settings-popover" data-show="isSettingsOpen">
                                        <button class="settings-delete-btn" data-show="computed:canDeleteColumn"></button>
                                    </div>
                                </div>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card" data-bind-attr="({ 'data-card-id': id })">
                                            <span data-bind="title"></span>
                                        </div>
                                    </template>
                                </div>
                                <div class="add-card-section">
                                    <div data-show="!isAdding">
                                        <button class="add-card-btn" data-bind-style="computed:addCardBtnStyle">+ Add</button>
                                    </div>
                                    <div data-show="isAdding">
                                        <input type="text" data-model="newTitle">
                                    </div>
                                </div>
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

    it('PROG 3.3b: 3.3 card template + data-bind-class only (no prefix)', async () => {
        wildflower.store('testkanban6f', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3f', {
            subscribe: { testkanban6f: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6f || !colId) return null
                    return this.stores.testkanban6f.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                headerStyle() { return { color: '#172b4d' } },
                countStyle() { return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' } },
                settingsBtnStyle() { return { color: '#172b4d' } },
                addCardBtnStyle() { return { color: '#5e6c84' } },
                canDeleteColumn() {
                    return this.stores.testkanban6f && this.stores.testkanban6f.state.columns.length > 1
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6f || !col) return []
                    return col.cards || []
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6f' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3f', {
            subscribe: { testkanban6f: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6f ? this.stores.testkanban6f.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3f">
                <div data-list="$testkanban6f.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3f" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                    <button class="column-settings-btn" data-bind-style="computed:settingsBtnStyle"></button>
                                    <div class="column-settings-popover" data-show="isSettingsOpen">
                                        <button class="settings-delete-btn" data-show="computed:canDeleteColumn"></button>
                                    </div>
                                </div>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card" data-bind-class="'card priority-' + priority">
                                            <span data-bind="title"></span>
                                        </div>
                                    </template>
                                </div>
                                <div class="add-card-section">
                                    <div data-show="!isAdding">
                                        <button class="add-card-btn" data-bind-style="computed:addCardBtnStyle">+ Add</button>
                                    </div>
                                    <div data-show="isAdding">
                                        <input type="text" data-model="newTitle">
                                    </div>
                                </div>
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

    it('PROG 3.3c: 3.3 card template + extra data-bind elements only (no prefix)', async () => {
        wildflower.store('testkanban6g', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3g', {
            subscribe: { testkanban6g: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6g || !colId) return null
                    return this.stores.testkanban6g.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                headerStyle() { return { color: '#172b4d' } },
                countStyle() { return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' } },
                settingsBtnStyle() { return { color: '#172b4d' } },
                addCardBtnStyle() { return { color: '#5e6c84' } },
                canDeleteColumn() {
                    return this.stores.testkanban6g && this.stores.testkanban6g.state.columns.length > 1
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6g || !col) return []
                    return col.cards || []
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6g' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3g', {
            subscribe: { testkanban6g: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6g ? this.stores.testkanban6g.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3g">
                <div data-list="$testkanban6g.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3g" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                    <button class="column-settings-btn" data-bind-style="computed:settingsBtnStyle"></button>
                                    <div class="column-settings-popover" data-show="isSettingsOpen">
                                        <button class="settings-delete-btn" data-show="computed:canDeleteColumn"></button>
                                    </div>
                                </div>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card">
                                            <span class="card-title" data-bind="title"></span>
                                            <span class="card-priority" data-bind="priority"></span>
                                            <div class="card-desc" data-bind="description"></div>
                                        </div>
                                    </template>
                                </div>
                                <div class="add-card-section">
                                    <div data-show="!isAdding">
                                        <button class="add-card-btn" data-bind-style="computed:addCardBtnStyle">+ Add</button>
                                    </div>
                                    <div data-show="isAdding">
                                        <input type="text" data-model="newTitle">
                                    </div>
                                </div>
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
        // Use class selectors since data-bind may be compiled away
        expect(cards[0].querySelector('.card-title').textContent).toBe('Card A')
        expect(cards[1].querySelector('.card-title').textContent).toBe('Card B')
        expect(cards[2].querySelector('.card-title').textContent).toBe('Card C')
    })

    it('PROG 3.3c-prefix: same as 3.3c but WITH computed: prefix', async () => {
        wildflower.store('testkanban6h', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3h', {
            subscribe: { testkanban6h: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6h || !colId) return null
                    return this.stores.testkanban6h.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                headerStyle() { return { color: '#172b4d' } },
                countStyle() { return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' } },
                settingsBtnStyle() { return { color: '#172b4d' } },
                addCardBtnStyle() { return { color: '#5e6c84' } },
                canDeleteColumn() {
                    return this.stores.testkanban6h && this.stores.testkanban6h.state.columns.length > 1
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6h || !col) return []
                    return col.cards || []
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6h' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3h', {
            subscribe: { testkanban6h: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6h ? this.stores.testkanban6h.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3h">
                <div data-list="$testkanban6h.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3h" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                    <button class="column-settings-btn" data-bind-style="computed:settingsBtnStyle"></button>
                                    <div class="column-settings-popover" data-show="isSettingsOpen">
                                        <button class="settings-delete-btn" data-show="computed:canDeleteColumn"></button>
                                    </div>
                                </div>
                                <div class="card-list" data-list="computed:cards" data-key="id">
                                    <template>
                                        <div class="card">
                                            <span class="card-title" data-bind="title"></span>
                                            <span class="card-priority" data-bind="priority"></span>
                                            <div class="card-desc" data-bind="description"></div>
                                        </div>
                                    </template>
                                </div>
                                <div class="add-card-section">
                                    <div data-show="!isAdding">
                                        <button class="add-card-btn" data-bind-style="computed:addCardBtnStyle">+ Add</button>
                                    </div>
                                    <div data-show="isAdding">
                                        <input type="text" data-model="newTitle">
                                    </div>
                                </div>
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
        expect(cards[0].querySelector('.card-title').textContent).toBe('Card A')
        expect(cards[1].querySelector('.card-title').textContent).toBe('Card B')
        expect(cards[2].querySelector('.card-title').textContent).toBe('Card C')
    })

    it('PROG 3.3d: 3.3c + data-bind-class on card div (no prefix)', async () => {
        wildflower.store('testkanban6i', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3i', {
            subscribe: { testkanban6i: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6i || !colId) return null
                    return this.stores.testkanban6i.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                headerStyle() { return { color: '#172b4d' } },
                countStyle() { return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' } },
                settingsBtnStyle() { return { color: '#172b4d' } },
                addCardBtnStyle() { return { color: '#5e6c84' } },
                canDeleteColumn() {
                    return this.stores.testkanban6i && this.stores.testkanban6i.state.columns.length > 1
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6i || !col) return []
                    return col.cards || []
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6i' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3i', {
            subscribe: { testkanban6i: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6i ? this.stores.testkanban6i.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3i">
                <div data-list="$testkanban6i.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3i" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                </div>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card" data-bind-class="'card priority-' + priority">
                                            <span class="card-title" data-bind="title"></span>
                                            <span class="card-priority" data-bind="priority"></span>
                                            <div class="card-desc" data-bind="description"></div>
                                        </div>
                                    </template>
                                </div>
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
        expect(cards[0].querySelector('.card-title').textContent).toBe('Card A')
        expect(cards[1].querySelector('.card-title').textContent).toBe('Card B')
        expect(cards[2].querySelector('.card-title').textContent).toBe('Card C')
    })

    it('PROG 3.3e: 3.3c + data-bind-attr on card div (no prefix)', async () => {
        wildflower.store('testkanban6j', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3j', {
            subscribe: { testkanban6j: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6j || !colId) return null
                    return this.stores.testkanban6j.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                headerStyle() { return { color: '#172b4d' } },
                countStyle() { return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' } },
                settingsBtnStyle() { return { color: '#172b4d' } },
                addCardBtnStyle() { return { color: '#5e6c84' } },
                canDeleteColumn() {
                    return this.stores.testkanban6j && this.stores.testkanban6j.state.columns.length > 1
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6j || !col) return []
                    return col.cards || []
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6j' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3j', {
            subscribe: { testkanban6j: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6j ? this.stores.testkanban6j.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3j">
                <div data-list="$testkanban6j.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3j" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                </div>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card" data-bind-attr="({ 'data-card-id': id })">
                                            <span class="card-title" data-bind="title"></span>
                                            <span class="card-priority" data-bind="priority"></span>
                                            <div class="card-desc" data-bind="description"></div>
                                        </div>
                                    </template>
                                </div>
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
        expect(cards[0].querySelector('.card-title').textContent).toBe('Card A')
        expect(cards[1].querySelector('.card-title').textContent).toBe('Card B')
        expect(cards[2].querySelector('.card-title').textContent).toBe('Card C')
    })

    it('PROG 3.3f: 3.3c + data-bind-class AND data-bind-attr on card (no prefix)', async () => {
        wildflower.store('testkanban6k', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3k', {
            subscribe: { testkanban6k: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6k || !colId) return null
                    return this.stores.testkanban6k.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                headerStyle() { return { color: '#172b4d' } },
                countStyle() { return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' } },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6k || !col) return []
                    return col.cards || []
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6k' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3k', {
            subscribe: { testkanban6k: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6k ? this.stores.testkanban6k.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3k">
                <div data-list="$testkanban6k.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3k" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                </div>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card" data-bind-class="'card priority-' + priority"
                                             data-bind-attr="({ 'data-card-id': id })">
                                            <span class="card-title" data-bind="title"></span>
                                            <span class="card-priority" data-bind="priority"></span>
                                            <div class="card-desc" data-bind="description"></div>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        `

        // Intercept console.warn to verify no errors during component initialization
        const warnings = []
        const origWarn = console.warn
        console.warn = (...args) => {
            warnings.push(args.join(' '))
            origWarn.apply(console, args)
        }

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 300))

        console.warn = origWarn

        const cards = testContainer.querySelectorAll('.card')
        expect(cards.length).toBe(3)
        expect(cards[0].querySelector('.card-title').textContent).toBe('Card A')
        expect(cards[1].querySelector('.card-title').textContent).toBe('Card B')
        expect(cards[2].querySelector('.card-title').textContent).toBe('Card C')

        // Verify no errors during component initialization (regression test for
        // _updateClassBindingElement and prototype chain issues)
        const initErrors = warnings.filter(w => w.includes('Error initializing component'))
        expect(initErrors).toEqual([])
    })

    it('PROG 3.3f-prefix: same as 3.3f but WITH computed: prefix', async () => {
        wildflower.store('testkanban6l', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3l', {
            subscribe: { testkanban6l: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6l || !colId) return null
                    return this.stores.testkanban6l.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                headerStyle() { return { color: '#172b4d' } },
                countStyle() { return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' } },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6l || !col) return []
                    return col.cards || []
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6l' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3l', {
            subscribe: { testkanban6l: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6l ? this.stores.testkanban6l.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3l">
                <div data-list="$testkanban6l.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3l" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                </div>
                                <div class="card-list" data-list="computed:cards" data-key="id">
                                    <template>
                                        <div class="card" data-bind-class="'card priority-' + priority"
                                             data-bind-attr="({ 'data-card-id': id })">
                                            <span class="card-title" data-bind="title"></span>
                                            <span class="card-priority" data-bind="priority"></span>
                                            <div class="card-desc" data-bind="description"></div>
                                        </div>
                                    </template>
                                </div>
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
        expect(cards[0].querySelector('.card-title').textContent).toBe('Card A')
        expect(cards[1].querySelector('.card-title').textContent).toBe('Card B')
        expect(cards[2].querySelector('.card-title').textContent).toBe('Card C')
    })

    it('PROG 3.4: + richer card template with data-bind-class (no prefix)', async () => {
        wildflower.store('testkanban6d', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p3d', {
            subscribe: { testkanban6d: ['columns'] },
            state: {
                _colId: null, currentColor: '#ebecf0', isAdding: false,
                newTitle: '', newDescription: '', newPriority: 'medium',
                isSettingsOpen: false, settingsName: '', settingsColor: ''
            },
            computed: {
                colId() { return this.state._colId },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6d || !colId) return null
                    return this.stores.testkanban6d.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() { return { backgroundColor: this.state.currentColor } },
                headerStyle() { return { color: '#172b4d' } },
                countStyle() { return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' } },
                settingsBtnStyle() { return { color: '#172b4d' } },
                addCardBtnStyle() { return { color: '#5e6c84' } },
                canDeleteColumn() {
                    return this.stores.testkanban6d && this.stores.testkanban6d.state.columns.length > 1
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6d || !col) return []
                    var allCards = col.cards || []
                    var query = (this.stores.testkanban6d.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return allCards
                    return allCards.filter(function(c) {
                        return c.title.toLowerCase().includes(query) ||
                               (c.description && c.description.toLowerCase().includes(query))
                    })
                },
                cardCount() { return this.computed.cards.length }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6d' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p3d', {
            subscribe: { testkanban6d: ['columns'] },
            computed: {
                columns() { return this.stores.testkanban6d ? this.stores.testkanban6d.state.columns : [] }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p3d">
                <div data-list="$testkanban6d.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p3d" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                    <button class="column-settings-btn" data-bind-style="computed:settingsBtnStyle"></button>
                                    <div class="column-settings-popover" data-show="isSettingsOpen">
                                        <button class="settings-delete-btn" data-show="computed:canDeleteColumn"></button>
                                    </div>
                                </div>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card" data-bind-class="'card priority-' + priority"
                                             data-bind-attr="({ 'data-card-id': id })">
                                            <span class="card-title" data-bind="title"></span>
                                            <span class="priority-badge" data-bind="priority"></span>
                                            <div class="card-description" data-bind="description"></div>
                                        </div>
                                    </template>
                                </div>
                                <div class="add-card-section">
                                    <div data-show="!isAdding">
                                        <button class="add-card-btn" data-bind-style="computed:addCardBtnStyle">+ Add</button>
                                    </div>
                                    <div data-show="isAdding">
                                        <input type="text" data-model="newTitle">
                                    </div>
                                </div>
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
        expect(cards[0].querySelector('.card-title').textContent).toBe('Card A')
        expect(cards[1].querySelector('.card-title').textContent).toBe('Card B')
        expect(cards[2].querySelector('.card-title').textContent).toBe('Card C')
    })

    it('PROG 4: + richer HTML with data-bind-style, data-show, data-bind-class (no prefix)', async () => {
        wildflower.store('testkanban6', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p4', {
            subscribe: { testkanban6: ['columns'] },
            state: {
                _colId: null,
                currentColor: '#ebecf0',
                isAdding: false,
                newTitle: '',
                newDescription: '',
                newPriority: 'medium',
                isSettingsOpen: false,
                settingsName: '',
                settingsColor: ''
            },
            computed: {
                colId() {
                    return this.state._colId
                },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban6 || !colId) return null
                    return this.stores.testkanban6.state.columns.find(function(c) { return c.id === colId }) || null
                },
                columnName() {
                    var col = this.computed.column
                    return col ? col.name : ''
                },
                bgStyle() {
                    return { backgroundColor: this.state.currentColor }
                },
                headerStyle() {
                    return { color: '#172b4d' }
                },
                countStyle() {
                    return { color: '#172b4d', backgroundColor: 'rgba(0,0,0,0.1)' }
                },
                settingsBtnStyle() {
                    return { color: '#172b4d' }
                },
                addCardBtnStyle() {
                    return { color: '#5e6c84' }
                },
                canDeleteColumn() {
                    return this.stores.testkanban6 && this.stores.testkanban6.state.columns.length > 1
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban6 || !col) return []
                    var allCards = col.cards || []
                    var query = (this.stores.testkanban6.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return allCards
                    return allCards.filter(function(c) {
                        return c.title.toLowerCase().includes(query) ||
                               (c.description && c.description.toLowerCase().includes(query))
                    })
                },
                cardCount() {
                    return this.computed.cards.length
                }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban6' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p4', {
            subscribe: { testkanban6: ['columns'] },
            computed: {
                columns() {
                    return this.stores.testkanban6 ? this.stores.testkanban6.state.columns : []
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p4">
                <div data-list="$testkanban6.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p4" data-bind-attr="({ 'data-column-id': id })">
                            <div class="kanban-column" data-bind-style="computed:bgStyle">
                                <div class="column-header" data-bind-style="computed:headerStyle">
                                    <span data-bind="computed:settingsName"></span>
                                    <span class="column-count" data-bind="computed:cardCount" data-bind-style="computed:countStyle"></span>
                                    <button class="column-settings-btn" data-bind-style="computed:settingsBtnStyle"></button>
                                    <div class="column-settings-popover" data-show="isSettingsOpen">
                                        <button class="settings-delete-btn" data-show="computed:canDeleteColumn"></button>
                                    </div>
                                </div>
                                <div class="card-list" data-list="cards" data-key="id">
                                    <template>
                                        <div class="card" data-bind-class="'card priority-' + priority"
                                             data-bind-attr="({ 'data-card-id': id })">
                                            <span class="card-title" data-bind="title"></span>
                                            <span class="priority-badge" data-bind="priority"></span>
                                            <div class="card-description" data-bind="description"></div>
                                        </div>
                                    </template>
                                </div>
                                <div class="add-card-section">
                                    <div data-show="!isAdding">
                                        <button class="add-card-btn" data-bind-style="computed:addCardBtnStyle">+ Add</button>
                                    </div>
                                    <div data-show="isAdding">
                                        <input type="text" data-model="newTitle">
                                    </div>
                                </div>
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
        expect(cards[0].querySelector('.card-title').textContent).toBe('Card A')
        expect(cards[1].querySelector('.card-title').textContent).toBe('Card B')
        expect(cards[2].querySelector('.card-title').textContent).toBe('Card C')
    })

    it('PROG 5: + storageKey/autoSave on store (no prefix)', async () => {
        // Clean up any stored data first
        try { localStorage.removeItem('testkanban7-data') } catch(e) {}

        wildflower.store('testkanban7', {
            storageKey: 'testkanban7-data',
            autoSave: true,
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', color: '#ebecf0', cards: [
                        { id: 1, title: 'Card A', description: 'First card', priority: 'high' },
                        { id: 2, title: 'Card B', description: 'Second card', priority: 'medium' }
                    ]},
                    { id: 'col-2', name: 'Done', color: '#e8f5e9', cards: [
                        { id: 3, title: 'Card C', description: 'Third card', priority: 'low' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('test-column-p5', {
            subscribe: { testkanban7: ['columns'] },
            state: {
                _colId: null,
                currentColor: '#ebecf0',
                isAdding: false,
                newTitle: '',
                newDescription: '',
                newPriority: 'medium',
                isSettingsOpen: false,
                settingsName: '',
                settingsColor: ''
            },
            computed: {
                colId() {
                    return this.state._colId
                },
                column() {
                    var colId = this.computed.colId
                    if (!this.stores.testkanban7 || !colId) return null
                    return this.stores.testkanban7.state.columns.find(function(c) { return c.id === colId }) || null
                },
                bgStyle() {
                    return { backgroundColor: this.state.currentColor }
                },
                canDeleteColumn() {
                    return this.stores.testkanban7 && this.stores.testkanban7.state.columns.length > 1
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.testkanban7 || !col) return []
                    var allCards = col.cards || []
                    var query = (this.stores.testkanban7.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return allCards
                    return allCards.filter(function(c) {
                        return c.title.toLowerCase().includes(query) ||
                               (c.description && c.description.toLowerCase().includes(query))
                    })
                },
                cardCount() {
                    return this.computed.cards.length
                }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                    this.state.settingsName = this.listItem.name || ''
                    this.state.settingsColor = this.listItem.color || '#ebecf0'
                    this.state.currentColor = this.listItem.color || '#ebecf0'
                }
            },
            onStoreUpdate(storeName, path, newValue) {
                if (storeName === 'testkanban7' && path === 'columns') {
                    if (!newValue) return
                    var self = this
                    var col = newValue.find(function(c) { return c.id === self.state._colId })
                    if (col) {
                        this.state.settingsName = col.name
                        this.state.settingsColor = col.color || '#ebecf0'
                        this.state.currentColor = col.color || '#ebecf0'
                    }
                }
            }
        })

        wildflower.component('test-board-p5', {
            subscribe: { testkanban7: ['columns'] },
            computed: {
                columns() {
                    return this.stores.testkanban7 ? this.stores.testkanban7.state.columns : []
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-board-p5">
                <div data-list="$testkanban7.columns" data-key="id">
                    <template>
                        <div data-component="test-column-p5" data-bind-attr="({ 'data-column-id': id })">
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

        // Clean up
        try { localStorage.removeItem('testkanban7-data') } catch(e) {}
    })
})
