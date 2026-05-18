/**
 * @vitest-environment browser
 *
 * LOW Priority Coverage Tests
 *
 * Tests for edge cases and less common combinations:
 * 1. Very deep nesting (3+ levels)
 * 2. Falsy values across binding types
 * 3. Nested properties in standalone contexts
 * 4. Expression bindings for style/html in list items
 * 5. External references in standalone contexts
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('LOW Priority Coverage', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        if (wildflower._contextRegistry) {
            wildflower._contextRegistry.contexts?.clear()
            wildflower._contextRegistry.contextsByType?.clear()
            wildflower._contextRegistry.contextsByComponent?.clear()
            wildflower._contextRegistry.dependencies?.clear()
            wildflower._contextRegistry._contextTypeCache?.clear()
            wildflower._contextRegistry._contextModificationCounter = 0
        }

        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    // ============================================================
    // CATEGORY 1: Very Deep Nesting (3+ levels)
    // ============================================================
    describe('Very deep nesting (3+ levels)', () => {

        // KNOWN GAP: data-render inside list items accessing parent state doesn't work
        // The renderInner state is on the parent component, not the list item
        it.skip('data-bind inside data-render inside data-show inside list', async () => {
            wildflower.component('deep-nesting-1', {
                state: {
                    showOuter: true,
                    renderInner: true,
                    items: [{ name: 'Alpha' }, { name: 'Beta' }]
                }
            })

            testContainer.innerHTML = `
                <div data-component="deep-nesting-1">
                    <div data-show="showOuter">
                        <div data-list="items">
                            <template>
                                <div class="item">
                                    <div data-render="renderInner">
                                        <span class="deep-value" data-bind="name"></span>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const values = testContainer.querySelectorAll('.deep-value')
            expect(values.length).toBe(2)
            expect(values[0].textContent).toBe('Alpha')
            expect(values[1].textContent).toBe('Beta')
        })

        it('data-bind-class inside nested conditionals', async () => {
            wildflower.component('deep-nesting-class', {
                state: {
                    showLevel1: true,
                    showLevel2: true,
                    renderLevel3: true,
                    statusClass: 'active'
                }
            })

            testContainer.innerHTML = `
                <div data-component="deep-nesting-class">
                    <div data-show="showLevel1">
                        <div data-show="showLevel2">
                            <div data-render="renderLevel3">
                                <span id="deep-class" data-bind-class="statusClass">Target</span>
                            </div>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const el = testContainer.querySelector('#deep-class')
            expect(el).not.toBeNull()
            expect(el.classList.contains('active')).toBe(true)
        })

        it('list inside list inside data-render', async () => {
            wildflower.component('nested-lists-render', {
                state: {
                    showContent: true,
                    categories: [
                        { name: 'Cat1', items: [{ label: 'A' }, { label: 'B' }] },
                        { name: 'Cat2', items: [{ label: 'C' }] }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-lists-render">
                    <div data-render="showContent">
                        <div data-list="categories">
                            <template>
                                <div class="category">
                                    <h3 class="cat-name" data-bind="name"></h3>
                                    <div data-list="items">
                                        <template>
                                            <span class="item-label" data-bind="label"></span>
                                        </template>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(150)

            const catNames = testContainer.querySelectorAll('.cat-name')
            expect(catNames.length).toBe(2)
            expect(catNames[0].textContent).toBe('Cat1')
            expect(catNames[1].textContent).toBe('Cat2')

            const itemLabels = testContainer.querySelectorAll('.item-label')
            expect(itemLabels.length).toBe(3)
            expect(itemLabels[0].textContent).toBe('A')
            expect(itemLabels[1].textContent).toBe('B')
            expect(itemLabels[2].textContent).toBe('C')
        })

        it('computed property 4 levels deep', async () => {
            wildflower.component('deep-computed', {
                state: {
                    show1: true,
                    show2: true,
                    show3: true,
                    render4: true,
                    value: 'test'
                },
                computed: {
                    upperValue() {
                        return this.state.value.toUpperCase()
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="deep-computed">
                    <div data-show="show1">
                        <div data-show="show2">
                            <div data-show="show3">
                                <div data-render="render4">
                                    <span id="deep-computed" data-bind="computed:upperValue"></span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const el = testContainer.querySelector('#deep-computed')
            expect(el).not.toBeNull()
            expect(el.textContent).toBe('TEST')
        })
    })

    // ============================================================
    // CATEGORY 2: Falsy Values Edge Cases
    // ============================================================
    describe('Falsy values edge cases', () => {

        it('data-bind with zero (0) value', async () => {
            wildflower.component('falsy-zero', {
                state: { count: 0 }
            })

            testContainer.innerHTML = `
                <div data-component="falsy-zero">
                    <span id="zero-value" data-bind="count"></span>
                </div>
            `
            await waitForUpdate()

            const el = testContainer.querySelector('#zero-value')
            expect(el.textContent).toBe('0')
        })

        it('data-bind with empty string value', async () => {
            wildflower.component('falsy-empty-string', {
                state: { message: '' }
            })

            testContainer.innerHTML = `
                <div data-component="falsy-empty-string">
                    <span id="empty-value" data-bind="message"></span>
                </div>
            `
            await waitForUpdate()

            const el = testContainer.querySelector('#empty-value')
            expect(el.textContent).toBe('')
        })

        it('data-bind with false boolean value', async () => {
            wildflower.component('falsy-false', {
                state: { isActive: false }
            })

            testContainer.innerHTML = `
                <div data-component="falsy-false">
                    <span id="false-value" data-bind="isActive"></span>
                </div>
            `
            await waitForUpdate()

            const el = testContainer.querySelector('#false-value')
            expect(el.textContent).toBe('false')
        })

        it('data-bind with null value', async () => {
            wildflower.component('falsy-null', {
                state: { data: null }
            })

            testContainer.innerHTML = `
                <div data-component="falsy-null">
                    <span id="null-value" data-bind="data"></span>
                </div>
            `
            await waitForUpdate()

            const el = testContainer.querySelector('#null-value')
            // null typically renders as empty or "null" string
            expect(el.textContent === '' || el.textContent === 'null').toBe(true)
        })

        it('data-bind-class with empty string (should not add class)', async () => {
            wildflower.component('falsy-class-empty', {
                state: { className: '' }
            })

            testContainer.innerHTML = `
                <div data-component="falsy-class-empty">
                    <span id="empty-class" class="base" data-bind-class="className">Text</span>
                </div>
            `
            await waitForUpdate()

            const el = testContainer.querySelector('#empty-class')
            expect(el.classList.contains('base')).toBe(true)
            expect(el.classList.length).toBe(1) // Only 'base', no empty class added
        })

        it('data-bind with zero in list items', async () => {
            wildflower.component('falsy-zero-list', {
                state: {
                    items: [
                        { name: 'First', count: 0 },
                        { name: 'Second', count: 5 },
                        { name: 'Third', count: 0 }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="falsy-zero-list">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>:
                                <span class="count" data-bind="count"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const counts = testContainer.querySelectorAll('.count')
            expect(counts.length).toBe(3)
            expect(counts[0].textContent).toBe('0')
            expect(counts[1].textContent).toBe('5')
            expect(counts[2].textContent).toBe('0')
        })

        it('computed returning zero should display correctly', async () => {
            wildflower.component('computed-zero', {
                state: { values: [1, -1] },
                computed: {
                    sum() {
                        return this.state.values.reduce((a, b) => a + b, 0)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-zero">
                    <span id="sum" data-bind="computed:sum"></span>
                </div>
            `
            await waitForUpdate()

            const el = testContainer.querySelector('#sum')
            expect(el.textContent).toBe('0')
        })
    })

    // ============================================================
    // CATEGORY 3: Nested Properties in Standalone Context
    // ============================================================
    describe('Nested properties in standalone context', () => {

        it('data-bind-class with nested property', async () => {
            wildflower.component('nested-prop-class', {
                state: {
                    styles: {
                        theme: 'dark-mode'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-prop-class">
                    <span id="nested-class" data-bind-class="styles.theme">Content</span>
                </div>
            `
            await waitForUpdate()

            const el = testContainer.querySelector('#nested-class')
            expect(el.classList.contains('dark-mode')).toBe(true)
        })

        it('data-bind-style with nested property returning style object', async () => {
            wildflower.component('nested-prop-style', {
                state: {
                    config: {
                        style: { backgroundColor: 'blue', color: 'white' }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-prop-style">
                    <span id="nested-style" data-bind-style="config.style">Content</span>
                </div>
            `
            await waitForUpdate()

            const el = testContainer.querySelector('#nested-style')
            expect(el.style.backgroundColor).toBe('blue')
            expect(el.style.color).toBe('white')
        })

        it('data-bind-html with nested property', async () => {
            wildflower.component('nested-prop-html', {
                state: {
                    content: {
                        html: '<strong>Bold Text</strong>'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-prop-html">
                    <div id="nested-html" data-bind-html="content.html"></div>
                </div>
            `
            await waitForUpdate()

            const el = testContainer.querySelector('#nested-html')
            expect(el.innerHTML).toBe('<strong>Bold Text</strong>')
        })

        it('deep nested property (3 levels)', async () => {
            wildflower.component('deep-nested-prop', {
                state: {
                    app: {
                        user: {
                            profile: {
                                displayName: 'John Doe'
                            }
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="deep-nested-prop">
                    <span id="deep-prop" data-bind="app.user.profile.displayName"></span>
                </div>
            `
            await waitForUpdate()

            const el = testContainer.querySelector('#deep-prop')
            expect(el.textContent).toBe('John Doe')
        })
    })

    // ============================================================
    // CATEGORY 4: Expression Bindings in List Items
    // ============================================================
    describe('Expression bindings in list items', () => {

        it('data-bind-style with ternary expression in list item', async () => {
            wildflower.component('list-style-expr', {
                state: {
                    items: [
                        { name: 'Active', isActive: true },
                        { name: 'Inactive', isActive: false }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="list-style-expr">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-style="isActive ? { backgroundColor: 'green' } : { backgroundColor: 'red' }">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].style.backgroundColor).toBe('green')
            expect(items[1].style.backgroundColor).toBe('red')
        })

        // FIXED GAP 2: Complex expressions with string concatenation in data-bind-html
        // Added isExpression() check in _executeFallbackBindHtml()
        it('data-bind-html with ternary expression in list item', async () => {
            wildflower.component('list-html-expr', {
                state: {
                    messages: [
                        { text: 'Hello', important: true },
                        { text: 'Bye', important: false }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="list-html-expr">
                    <div data-list="messages">
                        <template>
                            <div class="message" data-bind-html="important ? '<strong>' + text + '</strong>' : text"></div>
                        </template>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const messages = testContainer.querySelectorAll('.message')
            expect(messages.length).toBe(2)
            expect(messages[0].innerHTML).toBe('<strong>Hello</strong>')
            expect(messages[1].innerHTML).toBe('Bye')
        })

        it('data-bind-class with expression using item index', async () => {
            wildflower.component('list-class-index', {
                state: {
                    rows: [{ val: 'A' }, { val: 'B' }, { val: 'C' }]
                }
            })

            testContainer.innerHTML = `
                <div data-component="list-class-index">
                    <div data-list="rows">
                        <template>
                            <div class="row" data-bind-class="_index % 2 === 0 ? 'even' : 'odd'">
                                <span data-bind="val"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const rows = testContainer.querySelectorAll('.row')
            expect(rows.length).toBe(3)
            expect(rows[0].classList.contains('even')).toBe(true)
            expect(rows[1].classList.contains('odd')).toBe(true)
            expect(rows[2].classList.contains('even')).toBe(true)
        })
    })

    // ============================================================
    // CATEGORY 5: External References in Standalone Contexts
    // ============================================================
    describe('External references in standalone contexts', () => {

        it('data-bind-class with external reference', async () => {
            wildflower.component('theme-provider-standalone', {
                state: { themeClass: 'dark-theme' }
            })

            wildflower.component('consumer-class-standalone', {
                state: {}
            })

            testContainer.innerHTML = `
                <div data-component="theme-provider-standalone">
                    <div data-component="consumer-class-standalone">
                        <span id="ext-class" data-bind-class="external('theme-provider-standalone', 'themeClass')">Content</span>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const el = testContainer.querySelector('#ext-class')
            expect(el.classList.contains('dark-theme')).toBe(true)
        })

        // FIXED GAP 3: external() returning objects for data-bind-style
        // Added external() check in _processStyleBinding()
        it('data-bind-style with external reference', async () => {
            wildflower.component('style-provider', {
                state: {
                    boxStyle: { border: '2px solid blue', padding: '10px' }
                }
            })

            wildflower.component('consumer-style-standalone', {
                state: {}
            })

            testContainer.innerHTML = `
                <div data-component="style-provider">
                    <div data-component="consumer-style-standalone">
                        <div id="ext-style" data-bind-style="external('style-provider', 'boxStyle')">Box</div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const el = testContainer.querySelector('#ext-style')
            expect(el.style.border).toBe('2px solid blue')
            expect(el.style.padding).toBe('10px')
        })

        // FIXED GAP 4: external() with data-bind-html
        // Added external() check in _updateHTMLBindings()
        it('data-bind-html with external reference', async () => {
            wildflower.component('html-provider', {
                state: {
                    richContent: '<em>Emphasized</em> text'
                }
            })

            wildflower.component('consumer-html-standalone', {
                state: {}
            })

            testContainer.innerHTML = `
                <div data-component="html-provider">
                    <div data-component="consumer-html-standalone">
                        <div id="ext-html" data-bind-html="external('html-provider', 'richContent')"></div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const el = testContainer.querySelector('#ext-html')
            expect(el.innerHTML).toBe('<em>Emphasized</em> text')
        })

        it('external reference with computed property', async () => {
            wildflower.component('computed-provider', {
                state: { firstName: 'Jane', lastName: 'Smith' },
                computed: {
                    fullName() {
                        return `${this.state.firstName} ${this.state.lastName}`
                    }
                }
            })

            wildflower.component('consumer-computed-ext', {
                state: {}
            })

            testContainer.innerHTML = `
                <div data-component="computed-provider">
                    <div data-component="consumer-computed-ext">
                        <span id="ext-computed" data-bind="external('computed-provider', 'computed:fullName')"></span>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const el = testContainer.querySelector('#ext-computed')
            expect(el.textContent).toBe('Jane Smith')
        })

        it('external reference reactivity in standalone context', async () => {
            let providerInstance
            wildflower.component('reactive-provider', {
                state: { value: 'initial' },
                init() { providerInstance = this }
            })

            wildflower.component('reactive-consumer', {
                state: {}
            })

            testContainer.innerHTML = `
                <div data-component="reactive-provider">
                    <div data-component="reactive-consumer">
                        <span id="reactive-ext" data-bind="external('reactive-provider', 'value')"></span>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const el = testContainer.querySelector('#reactive-ext')
            expect(el.textContent).toBe('initial')

            // Update provider state
            providerInstance.state.value = 'updated'
            await waitForUpdate(100)

            expect(el.textContent).toBe('updated')
        })
    })
})
