/**
 * Test: List Inside data-show Block
 *
 * This test verifies that data-list elements inside data-show blocks
 * are properly tracked and update when the underlying array changes.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// Create conditional test runner for external template tests (not in lite build)
const itIfConfigurableTemplates = hasFeature('configurable-templates') ? it : it.skip

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('List inside data-show block', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        // Clear the context registry to prevent cross-test contamination
        if (wildflower._contextRegistry) {
            wildflower._contextRegistry.contexts?.clear()
            wildflower._contextRegistry.contextsByType?.clear()
            wildflower._contextRegistry.contextsByComponent?.clear()
            wildflower._contextRegistry.dependencies?.clear()
            wildflower._contextRegistry._contextTypeCache?.clear()
            wildflower._contextRegistry._contextModificationCounter = 0
        }

        // Clear list relationships
        if (wildflower._listRelationships) {
            wildflower._listRelationships.clear()
        }

        // Create test container
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    it('should track and render list inside initially visible data-show block (empty start)', async () => {
        // Register component with a list inside a data-show - starting EMPTY
        wildflower.component('list-show-empty', {
            state: {
                sectionVisible: true,
                items: []  // EMPTY - this is the paint mixer scenario
            },

            computed: {
                itemCount() {
                    return this.state.items.length
                }
            },

            addItem() {
                const id = this.state.items.length + 1
                this.state.items = [...this.state.items, { id, name: 'Item ' + id }]
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-show-empty">
                <p>Items: <span data-bind="computed:itemCount"></span></p>

                <!-- List inside data-show (the problematic pattern) -->
                <div data-show="sectionVisible" class="conditional-section">
                    <div class="inside-list" data-list="items">
                        <template>
                            <div class="item">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>

                <!-- Control list NOT inside data-show -->
                <div class="control-section">
                    <div class="control-list" data-list="items">
                        <template>
                            <div class="item control-item">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(100)

        // Get component instance
        const componentEl = testContainer.querySelector('[data-component="list-show-empty"]')
        const component = wildflower.componentInstances.get(componentEl.dataset.componentId)
        expect(component).toBeTruthy()

        // Get references to both list containers
        const insideShowList = testContainer.querySelector('.inside-list[data-list="items"]')
        const controlList = testContainer.querySelector('.control-list[data-list="items"]')

        expect(insideShowList).toBeTruthy()
        expect(controlList).toBeTruthy()

        // Check what's actually in domElements.lists
        console.log('domElements.lists contents:')
        wildflower.domElements.lists.forEach((el, i) => {
            console.log(`  [${i}]:`, el?.tagName, el?.className, el?.dataset?.list)
        })

        // Check context registry for list contexts
        const listContexts = []
        if (wildflower._contextRegistry?.contexts) {
            wildflower._contextRegistry.contexts.forEach((ctx, id) => {
                if (ctx.type === 'list') {
                    listContexts.push({ id, path: ctx.path, element: ctx.element })
                }
            })
        }
        console.log('List contexts in registry:', listContexts.length)
        listContexts.forEach(ctx => {
            console.log('  Context:', ctx.path, ctx.element?.className)
        })

        // Verify both lists are tracked in domElements.lists
        const insideShowTracked = wildflower.domElements.lists.includes(insideShowList)
        const controlTracked = wildflower.domElements.lists.includes(controlList)

        console.log('Inside data-show list tracked:', insideShowTracked)
        console.log('Control list tracked:', controlTracked)
        console.log('Total lists tracked:', wildflower.domElements.lists.length)

        // Add items and verify both lists render them
        component.addItem()
        component.addItem()
        component.addItem()

        await waitForUpdate(100)

        // Check rendered items
        const insideShowRendered = insideShowList.querySelectorAll('.item').length
        const controlRendered = controlList.querySelectorAll('.item').length

        console.log('Items in state:', component.state.items.length)
        console.log('Inside data-show rendered:', insideShowRendered)
        console.log('Control list rendered:', controlRendered)

        // Both lists should render all items
        expect(component.state.items.length).toBe(3)
        expect(controlRendered).toBe(3)
        expect(insideShowRendered).toBe(3) // This is the key assertion
    })

    it('should track and render list inside initially visible data-show block (with initial data)', async () => {
        // Register component with a list inside a data-show - starting WITH DATA
        wildflower.component('list-show-with-data', {
            state: {
                sectionVisible: true,
                items: [
                    { id: 1, name: 'Initial Item 1' },
                    { id: 2, name: 'Initial Item 2' }
                ]
            },

            computed: {
                itemCount() {
                    return this.state.items.length
                }
            },

            addItem() {
                const id = this.state.items.length + 1
                this.state.items = [...this.state.items, { id, name: 'Item ' + id }]
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-show-with-data">
                <p>Items: <span data-bind="computed:itemCount"></span></p>

                <!-- List inside data-show -->
                <div data-show="sectionVisible" class="conditional-section">
                    <div class="inside-list" data-list="items">
                        <template>
                            <div class="item">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>

                <!-- Control list NOT inside data-show -->
                <div class="control-section">
                    <div class="control-list" data-list="items">
                        <template>
                            <div class="item control-item">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(100)

        // Get component instance
        const componentEl = testContainer.querySelector('[data-component="list-show-with-data"]')
        const component = wildflower.componentInstances.get(componentEl.dataset.componentId)
        expect(component).toBeTruthy()

        // Get references to both list containers
        const insideShowList = testContainer.querySelector('.inside-list[data-list="items"]')
        const controlList = testContainer.querySelector('.control-list[data-list="items"]')

        // Check initial rendering
        const insideShowRendered = insideShowList.querySelectorAll('.item').length
        const controlRendered = controlList.querySelectorAll('.item').length

        console.log('With initial data - Inside data-show rendered:', insideShowRendered)
        console.log('With initial data - Control list rendered:', controlRendered)

        // Should render initial items
        expect(insideShowRendered).toBe(2)
        expect(controlRendered).toBe(2)

        // Add more items and verify
        component.addItem()
        await waitForUpdate(100)

        const finalInside = insideShowList.querySelectorAll('.item').length
        const finalControl = controlList.querySelectorAll('.item').length

        console.log('After adding - Inside:', finalInside, 'Control:', finalControl)
        expect(finalInside).toBe(3)
        expect(finalControl).toBe(3)
    })

    it('should work with negated data-show condition (paint mixer pattern)', async () => {
        // This matches the paint mixer exactly:
        // - calibrationMode starts as false
        // - data-show="!calibrationMode" means the section is initially VISIBLE
        // - savedColors starts empty
        wildflower.component('paint-mixer-pattern', {
            state: {
                calibrationMode: false,  // Section visible when false
                savedColors: []  // Empty like paint mixer
            },

            computed: {
                hasSavedColors() {
                    return this.state.savedColors.length > 0
                }
            },

            saveColor() {
                const id = Date.now()
                this.state.savedColors = [...this.state.savedColors, {
                    id,
                    hex: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
                    valuesDisplay: 'Y:10 S:3 W:1 G:4'
                }]
                console.log('Saved color, total:', this.state.savedColors.length)
            }
        })

        testContainer.innerHTML = `
            <div data-component="paint-mixer-pattern">
                <!-- Calibration Mode (hidden when calibrationMode is false) -->
                <div data-show="calibrationMode" class="calibration-section">
                    <h2>Calibration Mode</h2>
                </div>

                <!-- Main Interface (visible when calibrationMode is false) -->
                <div data-show="!calibrationMode" class="main-interface">
                    <h2>Main Interface</h2>
                    <button data-action="saveColor">Save Color</button>

                    <!-- Saved Colors Section - the problematic list -->
                    <div class="saved-colors-section">
                        <h4>Saved Colors</h4>
                        <div class="saved-colors-grid" data-list="savedColors">
                            <template>
                                <div class="saved-color-card">
                                    <span data-bind="hex"></span>
                                    <span data-bind="valuesDisplay"></span>
                                </div>
                            </template>
                        </div>
                        <div class="saved-colors-empty" data-show="!computed:hasSavedColors">
                            <em>No saved colors yet.</em>
                        </div>
                    </div>
                </div>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(100)

        const componentEl = testContainer.querySelector('[data-component="paint-mixer-pattern"]')
        const component = wildflower.componentInstances.get(componentEl.dataset.componentId)
        expect(component).toBeTruthy()

        // Main interface should be visible (calibrationMode is false)
        const mainInterface = testContainer.querySelector('.main-interface')
        console.log('Main interface display:', mainInterface.style.display)
        expect(mainInterface.style.display).not.toBe('none')

        // Check if savedColors list is found
        const savedColorsList = testContainer.querySelector('[data-list="savedColors"]')
        expect(savedColorsList).toBeTruthy()
        console.log('savedColors list element found:', !!savedColorsList)

        // Check list contexts
        const listContexts = []
        if (wildflower._contextRegistry?.contexts) {
            wildflower._contextRegistry.contexts.forEach((ctx, id) => {
                if (ctx.type === 'list') {
                    listContexts.push({ id, path: ctx.path, element: ctx.element?.className })
                }
            })
        }
        console.log('List contexts found:', listContexts.length)
        listContexts.forEach(ctx => console.log('  -', ctx.path, ctx.element))

        // Save some colors
        component.saveColor()
        component.saveColor()
        await waitForUpdate(100)

        console.log('State savedColors length:', component.state.savedColors.length)

        // Check rendered items
        const renderedCards = savedColorsList.querySelectorAll('.saved-color-card').length
        console.log('Rendered cards:', renderedCards)

        expect(component.state.savedColors.length).toBe(2)
        expect(renderedCards).toBe(2)
    })

    it('should track list when data-show becomes visible after init', async () => {
        // Register component with initially hidden section
        wildflower.component('list-show-delayed', {
            state: {
                sectionVisible: false, // Start hidden
                items: [{ id: 1, name: 'Pre-loaded Item' }]
            },

            showSection() {
                this.state.sectionVisible = true
            },

            addItem() {
                const id = this.state.items.length + 1
                this.state.items = [...this.state.items, { id, name: 'Item ' + id }]
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-show-delayed">
                <!-- List inside initially hidden data-show -->
                <div data-show="sectionVisible" class="conditional-section">
                    <div class="delayed-list" data-list="items">
                        <template>
                            <div class="item">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
                <button data-action="showSection">Show</button>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(100)

        const componentEl = testContainer.querySelector('[data-component="list-show-delayed"]')
        const component = wildflower.componentInstances.get(componentEl.dataset.componentId)
        expect(component).toBeTruthy()

        const delayedList = testContainer.querySelector('.delayed-list[data-list="items"]')

        // Section is hidden initially
        const conditionalSection = testContainer.querySelector('.conditional-section')
        expect(conditionalSection.style.display).toBe('none')

        // Show the section
        component.showSection()
        await waitForUpdate(100)

        // Section should now be visible
        expect(conditionalSection.style.display).not.toBe('none')

        // Check if list is tracked after becoming visible
        const isTracked = wildflower.domElements.lists.includes(delayedList)
        console.log('Delayed list tracked after show:', isTracked)

        // List should render the pre-loaded item
        const renderedItems = delayedList.querySelectorAll('.item').length
        console.log('Rendered items after show:', renderedItems)

        expect(renderedItems).toBe(1)

        // Add more items and verify they render
        component.addItem()
        component.addItem()
        await waitForUpdate(100)

        const finalRendered = delayedList.querySelectorAll('.item').length
        console.log('Final rendered items:', finalRendered)
        expect(finalRendered).toBe(3)
    })

    it('should maintain list tracking when data-show toggles', async () => {
        wildflower.component('list-show-toggle', {
            state: {
                sectionVisible: true,
                items: [{ id: 1, name: 'Item 1' }]
            },

            toggle() {
                this.state.sectionVisible = !this.state.sectionVisible
            },

            addItem() {
                const id = this.state.items.length + 1
                this.state.items = [...this.state.items, { id, name: 'Item ' + id }]
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-show-toggle">
                <div data-show="sectionVisible" class="toggle-section">
                    <div class="toggle-list" data-list="items">
                        <template>
                            <div class="item"><span data-bind="name"></span></div>
                        </template>
                    </div>
                </div>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(100)

        const componentEl = testContainer.querySelector('[data-component="list-show-toggle"]')
        const component = wildflower.componentInstances.get(componentEl.dataset.componentId)
        const toggleList = testContainer.querySelector('.toggle-list[data-list="items"]')
        const toggleSection = testContainer.querySelector('.toggle-section')

        // Initially visible with 1 item
        expect(toggleSection.style.display).not.toBe('none')
        expect(toggleList.querySelectorAll('.item').length).toBe(1)

        // Hide the section
        component.toggle()
        await waitForUpdate(100)
        expect(toggleSection.style.display).toBe('none')

        // Add item while hidden
        component.addItem()
        await waitForUpdate(100)

        // Show the section again
        component.toggle()
        await waitForUpdate(100)

        // Should now show both items
        const finalItems = toggleList.querySelectorAll('.item').length
        console.log('Items after toggle cycle:', finalItems)
        expect(finalItems).toBe(2)
    })

    itIfConfigurableTemplates('should render list with external template when data is set in init()', async () => {
        // This tests the combination of:
        // 1. Data loaded in init() (like from localStorage)
        // 2. List using external template (data-use-template / scoped slots)

        // Parent provides the template
        wildflower.component('template-provider', {
            state: {}
        })

        // Child loads data in init() and uses parent's template
        wildflower.component('data-loader-with-external-template', {
            state: {
                items: []  // Start empty, will be set in init()
            },

            init() {
                // Simulate loading from localStorage
                this.state.items = [
                    { id: 1, name: 'Loaded Item 1', color: '#ff0000' },
                    { id: 2, name: 'Loaded Item 2', color: '#00ff00' },
                    { id: 3, name: 'Loaded Item 3', color: '#0000ff' }
                ]
            },

            addItem() {
                const id = this.state.items.length + 1
                this.state.items = [...this.state.items, {
                    id,
                    name: 'New Item ' + id,
                    color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
                }]
            }
        })

        testContainer.innerHTML = `
            <div data-component="template-provider">
                <!-- Parent defines the template that child will use -->
                <template data-item-template="customCard">
                    <div class="custom-card">
                        <span class="card-name" data-bind="name"></span>
                        <span class="card-color" data-bind="color"></span>
                    </div>
                </template>

                <div data-component="data-loader-with-external-template">
                    <!-- Child uses parent's template for its list -->
                    <div class="items-list" data-list="items">
                        <template data-use-template="customCard"></template>
                    </div>
                </div>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(150)

        // Get the child component
        const childEl = testContainer.querySelector('[data-component="data-loader-with-external-template"]')
        const child = wildflower.componentInstances.get(childEl.dataset.componentId)
        expect(child).toBeTruthy()

        // The list should have rendered all 3 items from init()
        const renderedCards = testContainer.querySelectorAll('.custom-card')
        console.log('External template - Items in state:', child.state.items.length)
        console.log('External template - Rendered cards:', renderedCards.length)

        expect(child.state.items.length).toBe(3)
        expect(renderedCards.length).toBe(3)

        // Verify the content is correct
        const names = Array.from(testContainer.querySelectorAll('.card-name')).map(el => el.textContent)
        expect(names).toContain('Loaded Item 1')
        expect(names).toContain('Loaded Item 2')
        expect(names).toContain('Loaded Item 3')

        // Verify adding more items still works
        child.addItem()
        await waitForUpdate(100)

        const updatedCards = testContainer.querySelectorAll('.custom-card')
        console.log('After add - Rendered cards:', updatedCards.length)
        expect(updatedCards.length).toBe(4)
    })

    itIfConfigurableTemplates('should render list with external template in data-show when data is set in init()', async () => {
        // Combines all three scenarios:
        // 1. Data loaded in init()
        // 2. List using external template
        // 3. List is inside a data-show block

        wildflower.component('complex-parent', {
            state: {}
        })

        wildflower.component('complex-child', {
            state: {
                showSection: true,
                savedItems: []  // Empty, populated in init()
            },

            init() {
                // Simulate localStorage load
                this.state.savedItems = [
                    { id: 1, label: 'Saved A' },
                    { id: 2, label: 'Saved B' }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="complex-parent">
                <template data-item-template="savedItemTemplate">
                    <div class="saved-item-card">
                        <span class="saved-label" data-bind="label"></span>
                    </div>
                </template>

                <div data-component="complex-child">
                    <!-- Section with data-show containing a list with external template -->
                    <div data-show="showSection" class="saved-section">
                        <div class="saved-list" data-list="savedItems">
                            <template data-use-template="savedItemTemplate"></template>
                        </div>
                    </div>
                </div>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(150)

        const childEl = testContainer.querySelector('[data-component="complex-child"]')
        const child = wildflower.componentInstances.get(childEl.dataset.componentId)
        expect(child).toBeTruthy()

        // Section should be visible
        const section = testContainer.querySelector('.saved-section')
        expect(section.style.display).not.toBe('none')

        // Items should be rendered
        const renderedItems = testContainer.querySelectorAll('.saved-item-card')
        console.log('Complex scenario - Items in state:', child.state.savedItems.length)
        console.log('Complex scenario - Rendered items:', renderedItems.length)

        expect(child.state.savedItems.length).toBe(2)
        expect(renderedItems.length).toBe(2)

        // Verify content
        const labels = Array.from(testContainer.querySelectorAll('.saved-label')).map(el => el.textContent)
        expect(labels).toContain('Saved A')
        expect(labels).toContain('Saved B')
    })
})
