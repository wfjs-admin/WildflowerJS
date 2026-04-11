/**
 * @vitest-environment browser
 *
 * Binding Type Coverage Tests
 *
 * Tests all binding types (data-bind, data-bind-class, data-bind-style, data-bind-html)
 * with computed properties to catch gaps like the one fixed in computed-class-binding.
 *
 * This test suite was created to systematically detect framework gaps where
 * computed property changes don't propagate to all binding types.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Binding Type Coverage - Computed Properties', () => {
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
        testContainer.style.position = 'absolute'
        testContainer.style.left = '-9999px'
        testContainer.style.opacity = '0'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    // ============================================================
    // data-bind (text) with computed
    // ============================================================
    describe('data-bind (text) with computed', () => {
        it('should update text when state dependency changes', async () => {
            wildflower.component('text-computed-test', {
                state: {
                    firstName: 'John',
                    lastName: 'Doe'
                },
                computed: {
                    fullName() {
                        return `${this.state.firstName} ${this.state.lastName}`
                    }
                },
                changeFirstName() {
                    this.state.firstName = 'Jane'
                }
            })

            testContainer.innerHTML = `
                <div data-component="text-computed-test">
                    <span id="full-name" data-bind="fullName"></span>
                    <button data-action="changeFirstName">Change</button>
                </div>
            `

            await waitForUpdate()

            const nameSpan = testContainer.querySelector('#full-name')
            const changeBtn = testContainer.querySelector('[data-action="changeFirstName"]')

            // Initial state
            expect(nameSpan.textContent).toBe('John Doe')

            // Change state
            changeBtn.click()
            await waitForUpdate()

            // Verify computed updated
            expect(nameSpan.textContent).toBe('Jane Doe')
        })

        it('should update text with expression containing computed', async () => {
            wildflower.component('text-expr-computed-test', {
                state: {
                    count: 5
                },
                computed: {
                    doubled() {
                        return this.state.count * 2
                    }
                },
                increment() {
                    this.state.count++
                }
            })

            testContainer.innerHTML = `
                <div data-component="text-expr-computed-test">
                    <span id="result" data-bind="'Result: ' + doubled"></span>
                    <button data-action="increment">Increment</button>
                </div>
            `

            await waitForUpdate()

            const resultSpan = testContainer.querySelector('#result')
            const incrementBtn = testContainer.querySelector('[data-action="increment"]')

            // Initial state
            expect(resultSpan.textContent).toBe('Result: 10')

            // Change state
            incrementBtn.click()
            await waitForUpdate()

            // Verify computed updated
            expect(resultSpan.textContent).toBe('Result: 12')
        })
    })

    // ============================================================
    // data-bind-style with computed
    // ============================================================
    describe('data-bind-style with computed', () => {
        it('should update style when state dependency changes', async () => {
            wildflower.component('style-computed-test', {
                state: {
                    theme: 'light'
                },
                computed: {
                    containerStyle() {
                        return {
                            backgroundColor: this.state.theme === 'dark' ? '#333' : '#fff',
                            color: this.state.theme === 'dark' ? '#fff' : '#333'
                        }
                    }
                },
                toggleTheme() {
                    this.state.theme = this.state.theme === 'light' ? 'dark' : 'light'
                }
            })

            testContainer.innerHTML = `
                <div data-component="style-computed-test">
                    <div id="styled-container" data-bind-style="containerStyle">
                        Content here
                    </div>
                    <button data-action="toggleTheme">Toggle Theme</button>
                </div>
            `

            await waitForUpdate()

            const container = testContainer.querySelector('#styled-container')
            const toggleBtn = testContainer.querySelector('[data-action="toggleTheme"]')

            // Initial state: light theme
            expect(container.style.backgroundColor).toBe('rgb(255, 255, 255)')
            expect(container.style.color).toBe('rgb(51, 51, 51)')

            // Toggle to dark
            toggleBtn.click()
            await waitForUpdate()

            // Verify style updated
            expect(container.style.backgroundColor).toBe('rgb(51, 51, 51)')
            expect(container.style.color).toBe('rgb(255, 255, 255)')
        })

        it('should update style with simple computed property name', async () => {
            wildflower.component('style-simple-computed-test', {
                state: {
                    isActive: false
                },
                computed: {
                    activeStyle() {
                        return {
                            opacity: this.state.isActive ? '1' : '0.5',
                            transform: this.state.isActive ? 'scale(1.1)' : 'scale(1)'
                        }
                    }
                },
                toggle() {
                    this.state.isActive = !this.state.isActive
                }
            })

            testContainer.innerHTML = `
                <div data-component="style-simple-computed-test">
                    <div id="active-box" data-bind-style="activeStyle">
                        Box
                    </div>
                    <button data-action="toggle">Toggle</button>
                </div>
            `

            await waitForUpdate()

            const box = testContainer.querySelector('#active-box')
            const toggleBtn = testContainer.querySelector('[data-action="toggle"]')

            // Initial state: inactive
            expect(box.style.opacity).toBe('0.5')

            // Toggle to active
            toggleBtn.click()
            await waitForUpdate()

            // Verify style updated
            expect(box.style.opacity).toBe('1')
        })
    })

    // ============================================================
    // data-bind-html with computed
    // ============================================================
    describe('data-bind-html with computed', () => {
        it('should update HTML when state dependency changes', async () => {
            wildflower.component('html-computed-test', {
                state: {
                    format: 'plain'
                },
                computed: {
                    formattedContent() {
                        if (this.state.format === 'bold') {
                            return '<strong>Bold Text</strong>'
                        } else if (this.state.format === 'italic') {
                            return '<em>Italic Text</em>'
                        }
                        return 'Plain Text'
                    }
                },
                setFormat(format) {
                    this.state.format = format
                },
                makeBold() {
                    this.state.format = 'bold'
                },
                makeItalic() {
                    this.state.format = 'italic'
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-computed-test">
                    <div id="html-container" data-bind-html="formattedContent"></div>
                    <button data-action="makeBold">Bold</button>
                    <button data-action="makeItalic">Italic</button>
                </div>
            `

            await waitForUpdate()

            const container = testContainer.querySelector('#html-container')
            const boldBtn = testContainer.querySelector('[data-action="makeBold"]')
            const italicBtn = testContainer.querySelector('[data-action="makeItalic"]')

            // Initial state: plain
            expect(container.innerHTML).toBe('Plain Text')

            // Make bold
            boldBtn.click()
            await waitForUpdate()

            // Verify HTML updated
            expect(container.innerHTML).toBe('<strong>Bold Text</strong>')

            // Make italic
            italicBtn.click()
            await waitForUpdate()

            // Verify HTML updated again
            expect(container.innerHTML).toBe('<em>Italic Text</em>')
        })

        it('should update HTML with simple computed property name', async () => {
            wildflower.component('html-simple-computed-test', {
                state: {
                    showDetails: false
                },
                computed: {
                    detailsHtml() {
                        if (this.state.showDetails) {
                            return '<ul><li>Detail 1</li><li>Detail 2</li></ul>'
                        }
                        return '<p>Click to show details</p>'
                    }
                },
                toggle() {
                    this.state.showDetails = !this.state.showDetails
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-simple-computed-test">
                    <div id="details" data-bind-html="detailsHtml"></div>
                    <button data-action="toggle">Toggle</button>
                </div>
            `

            await waitForUpdate()

            const details = testContainer.querySelector('#details')
            const toggleBtn = testContainer.querySelector('[data-action="toggle"]')

            // Initial state
            expect(details.innerHTML).toBe('<p>Click to show details</p>')

            // Toggle
            toggleBtn.click()
            await waitForUpdate()

            // Verify HTML updated
            expect(details.innerHTML).toBe('<ul><li>Detail 1</li><li>Detail 2</li></ul>')
        })
    })

    // ============================================================
    // List context coverage
    // ============================================================
    describe('List context coverage', () => {
        it('data-bind-style computed in list item', async () => {
            wildflower.component('list-style-computed-test', {
                state: {
                    theme: 'light',
                    items: [
                        { name: 'Item 1' },
                        { name: 'Item 2' }
                    ]
                },
                computed: {
                    itemStyle() {
                        return {
                            backgroundColor: this.state.theme === 'dark' ? '#555' : '#eee'
                        }
                    }
                },
                toggleTheme() {
                    this.state.theme = this.state.theme === 'light' ? 'dark' : 'light'
                }
            })

            testContainer.innerHTML = `
                <div data-component="list-style-computed-test">
                    <div data-list="items">
                        <template>
                            <div class="list-item" data-bind-style="itemStyle">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                    <button data-action="toggleTheme">Toggle</button>
                </div>
            `

            await waitForUpdate()

            const items = testContainer.querySelectorAll('.list-item')
            const toggleBtn = testContainer.querySelector('[data-action="toggleTheme"]')

            // Initial state: light theme
            expect(items.length).toBe(2)
            expect(items[0].style.backgroundColor).toBe('rgb(238, 238, 238)')

            // Toggle to dark
            toggleBtn.click()
            await waitForUpdate()

            // Verify all items updated
            const updatedItems = testContainer.querySelectorAll('.list-item')
            expect(updatedItems[0].style.backgroundColor).toBe('rgb(85, 85, 85)')
            expect(updatedItems[1].style.backgroundColor).toBe('rgb(85, 85, 85)')
        })

        it('data-bind-html computed in list item', async () => {
            wildflower.component('list-html-computed-test', {
                state: {
                    useRichText: false,
                    articles: [
                        { title: 'Article 1' },
                        { title: 'Article 2' }
                    ]
                },
                computed: {
                    titleHtml() {
                        if (this.state.useRichText) {
                            return '<strong>Rich</strong> Title'
                        }
                        return 'Plain Title'
                    }
                },
                toggleRich() {
                    this.state.useRichText = !this.state.useRichText
                }
            })

            testContainer.innerHTML = `
                <div data-component="list-html-computed-test">
                    <div data-list="articles">
                        <template>
                            <div class="article">
                                <div class="article-title" data-bind-html="titleHtml"></div>
                            </div>
                        </template>
                    </div>
                    <button data-action="toggleRich">Toggle Rich</button>
                </div>
            `

            await waitForUpdate()

            const titles = testContainer.querySelectorAll('.article-title')
            const toggleBtn = testContainer.querySelector('[data-action="toggleRich"]')

            // Initial state: plain
            expect(titles.length).toBe(2)
            expect(titles[0].innerHTML).toBe('Plain Title')

            // Toggle to rich
            toggleBtn.click()
            await waitForUpdate()

            // Verify all items updated
            const updatedTitles = testContainer.querySelectorAll('.article-title')
            expect(updatedTitles[0].innerHTML).toBe('<strong>Rich</strong> Title')
            expect(updatedTitles[1].innerHTML).toBe('<strong>Rich</strong> Title')
        })
    })

    // ============================================================
    // data-bind-class with computed (reference to existing tests)
    // ============================================================
    describe('data-bind-class with computed', () => {
        // Note: Comprehensive tests exist in computed-class-binding.test.js
        // This is a quick verification that the fix is still working

        it('should update class when state dependency changes (quick check)', async () => {
            wildflower.component('class-computed-quick-test', {
                state: {
                    size: 'normal'
                },
                computed: {
                    sizeClass() {
                        const sizes = {
                            'small': 'size-sm',
                            'normal': 'size-md',
                            'large': 'size-lg'
                        }
                        return sizes[this.state.size] || 'size-md'
                    }
                },
                enlarge() {
                    this.state.size = 'large'
                }
            })

            testContainer.innerHTML = `
                <div data-component="class-computed-quick-test">
                    <div id="sized-box" data-bind-class="sizeClass">Box</div>
                    <button data-action="enlarge">Enlarge</button>
                </div>
            `

            await waitForUpdate()

            const box = testContainer.querySelector('#sized-box')
            const enlargeBtn = testContainer.querySelector('[data-action="enlarge"]')

            // Initial state
            expect(box.classList.contains('size-md')).toBe(true)
            expect(box.classList.contains('size-lg')).toBe(false)

            // Enlarge
            enlargeBtn.click()
            await waitForUpdate()

            // Verify class updated
            expect(box.classList.contains('size-lg')).toBe(true)
            expect(box.classList.contains('size-md')).toBe(false)
        })
    })
})
