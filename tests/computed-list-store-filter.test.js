/**
 * Test: computed list backed by store filter - prefix vs no-prefix
 *
 * Tests that a data-list using a computed property that filters data
 * from an external store reactively updates when the store changes.
 *
 * This is the exact pattern used in the kanban demo: a "cards" computed
 * filters cards by searchQuery from the store.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForCompleteRender } from './helpers/load-framework.js'

describe('computed list backed by store filter', () => {
    let testContainer, wildflower

    beforeAll(async () => { await loadFramework() })

    beforeEach(async () => {
        wildflower = window.wildflower
        await resetFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        testContainer?.parentNode?.removeChild(testContainer)
    })

    // Simple case: component subscribes to all relevant store paths
    it('simple: WITH prefix - subscribes to searchQuery', async () => {
        wildflower.store('fs1', {
            state: {
                items: [
                    { id: 1, name: 'Apple' },
                    { id: 2, name: 'Banana' },
                    { id: 3, name: 'Apricot' }
                ],
                searchQuery: ''
            }
        })

        wildflower.component('fc1', {
            subscribe: { fs1: ['items', 'searchQuery'] },
            computed: {
                filteredItems() {
                    if (!this.stores.fs1) return []
                    var items = this.stores.fs1.state.items || []
                    var query = (this.stores.fs1.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return items
                    return items.filter(function(item) {
                        return item.name.toLowerCase().includes(query)
                    })
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="fc1">
                <div data-list="computed:filteredItems" data-key="id">
                    <template>
                        <div class="item"><span data-bind="name"></span></div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 200))

        expect(testContainer.querySelectorAll('.item').length).toBe(3)

        wildflower.getStore('fs1').state.searchQuery = 'ap'
        await new Promise(r => setTimeout(r, 300))
        await waitForCompleteRender()

        var items = testContainer.querySelectorAll('.item')
        expect(items.length).toBe(2)
    })

    it('simple: WITHOUT prefix - subscribes to searchQuery', async () => {
        wildflower.store('fs2', {
            state: {
                items: [
                    { id: 1, name: 'Apple' },
                    { id: 2, name: 'Banana' },
                    { id: 3, name: 'Apricot' }
                ],
                searchQuery: ''
            }
        })

        wildflower.component('fc2', {
            subscribe: { fs2: ['items', 'searchQuery'] },
            computed: {
                filteredItems() {
                    if (!this.stores.fs2) return []
                    var items = this.stores.fs2.state.items || []
                    var query = (this.stores.fs2.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return items
                    return items.filter(function(item) {
                        return item.name.toLowerCase().includes(query)
                    })
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="fc2">
                <div data-list="filteredItems" data-key="id">
                    <template>
                        <div class="item"><span data-bind="name"></span></div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 200))

        expect(testContainer.querySelectorAll('.item').length).toBe(3)

        wildflower.getStore('fs2').state.searchQuery = 'ap'
        await new Promise(r => setTimeout(r, 300))
        await waitForCompleteRender()

        var items = testContainer.querySelectorAll('.item')
        expect(items.length).toBe(2)
    })

    // Kanban pattern: component-in-list, subscribes only to columns NOT searchQuery
    it('kanban pattern: WITH prefix - no searchQuery subscription', async () => {
        wildflower.store('ks1', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', cards: [
                        { id: 1, title: 'Apple' },
                        { id: 2, title: 'Banana' }
                    ]},
                    { id: 'col-2', name: 'Done', cards: [
                        { id: 3, title: 'Apricot' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('kcol1', {
            subscribe: { ks1: ['columns'] },
            state: { _colId: null },
            computed: {
                column() {
                    if (!this.stores.ks1 || !this.state._colId) return null
                    return this.stores.ks1.state.columns.find(function(c) { return c.id === this.state._colId }.bind(this)) || null
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.ks1 || !col) return []
                    var allCards = col.cards || []
                    var query = (this.stores.ks1.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return allCards
                    return allCards.filter(function(c) {
                        return c.title.toLowerCase().includes(query)
                    })
                }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                }
            }
        })

        wildflower.component('kboard1', {
            subscribe: { ks1: ['columns'] },
            computed: {
                columns() {
                    return this.stores.ks1 ? this.stores.ks1.state.columns : []
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="kboard1">
                <div data-list="$ks1.columns" data-key="id">
                    <template>
                        <div data-component="kcol1" class="column">
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

        var cards = testContainer.querySelectorAll('.card')
        expect(cards.length).toBe(3)

        // Filter: "ap" should match Apple and Apricot
        wildflower.getStore('ks1').state.searchQuery = 'ap'
        await new Promise(r => setTimeout(r, 500))
        await waitForCompleteRender()

        cards = testContainer.querySelectorAll('.card')
        expect(cards.length).toBe(2)
        expect(cards[0].textContent).toBe('Apple')
        expect(cards[1].textContent).toBe('Apricot')
    })

    // Component-in-list with state array whose name collides with parent data property.
    // The parent list items each have a "tags" property. The child component also has
    // state.tags with DIFFERENT data. data-list="tags" must render the component's
    // state, not the parent item's property.
    it('component-in-list: state array name collides with parent data property', async () => {
        wildflower.store('cs1', {
            state: {
                projects: [
                    { id: 1, name: 'Alpha', tags: ['backend', 'api'] },
                    { id: 2, name: 'Beta', tags: ['frontend', 'ui'] }
                ]
            }
        })

        wildflower.component('project-card-cs1', {
            state: {
                tags: []
            },
            beforeInit() {
                // Component creates its OWN tags — different from parent item's tags
                this.state.tags = [
                    { id: 1, label: 'Component Tag A' },
                    { id: 2, label: 'Component Tag B' },
                    { id: 3, label: 'Component Tag C' }
                ]
            }
        })

        wildflower.component('project-list-cs1', {
            subscribe: { cs1: ['projects'] },
            computed: {
                projects() {
                    return this.stores.cs1 ? this.stores.cs1.state.projects : []
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="project-list-cs1">
                <div data-list="$cs1.projects" data-key="id">
                    <template>
                        <div data-component="project-card-cs1" class="project">
                            <span class="project-name" data-bind="name"></span>
                            <div class="tag-list" data-list="tags" data-key="id">
                                <template>
                                    <span class="tag" data-bind="label"></span>
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

        // Each project-card should show 3 component tags, NOT 2 parent tags
        var projects = testContainer.querySelectorAll('.project')
        expect(projects.length).toBe(2)

        projects.forEach(function(project) {
            var tags = project.querySelectorAll('.tag')
            // Must be 3 (component state), not 2 (parent item data)
            expect(tags.length).toBe(3)
            expect(tags[0].textContent).toBe('Component Tag A')
            expect(tags[1].textContent).toBe('Component Tag B')
            expect(tags[2].textContent).toBe('Component Tag C')
        })
    })

    it('kanban pattern: WITHOUT prefix - no searchQuery subscription', async () => {
        wildflower.store('ks2', {
            state: {
                columns: [
                    { id: 'col-1', name: 'To Do', cards: [
                        { id: 1, title: 'Apple' },
                        { id: 2, title: 'Banana' }
                    ]},
                    { id: 'col-2', name: 'Done', cards: [
                        { id: 3, title: 'Apricot' }
                    ]}
                ],
                searchQuery: ''
            }
        })

        wildflower.component('kcol2', {
            subscribe: { ks2: ['columns'] },
            state: { _colId: null },
            computed: {
                column() {
                    if (!this.stores.ks2 || !this.state._colId) return null
                    return this.stores.ks2.state.columns.find(function(c) { return c.id === this.state._colId }.bind(this)) || null
                },
                cards() {
                    if (!this.state._colId) return []
                    var col = this.computed.column
                    if (!this.stores.ks2 || !col) return []
                    var allCards = col.cards || []
                    var query = (this.stores.ks2.state.searchQuery || '').toLowerCase().trim()
                    if (!query) return allCards
                    return allCards.filter(function(c) {
                        return c.title.toLowerCase().includes(query)
                    })
                }
            },
            beforeInit() {
                if (this.listItem) {
                    this.state._colId = this.listItem.id
                }
            }
        })

        wildflower.component('kboard2', {
            subscribe: { ks2: ['columns'] },
            computed: {
                columns() {
                    return this.stores.ks2 ? this.stores.ks2.state.columns : []
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="kboard2">
                <div data-list="$ks2.columns" data-key="id">
                    <template>
                        <div data-component="kcol2" class="column">
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

        var cards = testContainer.querySelectorAll('.card')
        expect(cards.length).toBe(3)

        // Filter: "ap" should match Apple and Apricot
        wildflower.getStore('ks2').state.searchQuery = 'ap'
        await new Promise(r => setTimeout(r, 500))
        await waitForCompleteRender()

        cards = testContainer.querySelectorAll('.card')
        expect(cards.length).toBe(2)
        expect(cards[0].textContent).toBe('Apple')
        expect(cards[1].textContent).toBe('Apricot')
    })
})
