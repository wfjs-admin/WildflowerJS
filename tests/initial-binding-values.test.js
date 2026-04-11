/**
 * Initial Binding Values Test Suite
 *
 * Tests that data-bind elements are populated with their initial state values
 * immediately when a component is created, without requiring any state changes.
 *
 * This addresses a bug where binding contexts were created but initial values
 * were not rendered into the DOM until a state change triggered an update.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Initial Binding Values', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        // Re-initialize the context system
        if (wildflower._initContextSystem) {
            wildflower._contextSystemInitialized = false
            wildflower._initContextSystem()
        }

        // Create test container
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
    })

    describe('Simple Bindings', () => {
        it('should display initial string value on component creation', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-string-test">
                    <span data-bind="message"></span>
                </div>
            `

            wildflower.component('initial-string-test', {
                state: {
                    message: 'Hello World'
                }
            })

            await waitForUpdate()

            const span = testContainer.querySelector('[data-bind="message"]')
            // The span should immediately have the initial value - no state change needed
            expect(span.textContent).toBe('Hello World')
        })

        it('should display initial number value on component creation', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-number-test">
                    <span data-bind="count"></span>
                </div>
            `

            wildflower.component('initial-number-test', {
                state: {
                    count: 42
                }
            })

            await waitForUpdate()

            const span = testContainer.querySelector('[data-bind="count"]')
            expect(span.textContent).toBe('42')
        })

        it('should display initial zero value on component creation', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-zero-test">
                    <span data-bind="count"></span>
                </div>
            `

            wildflower.component('initial-zero-test', {
                state: {
                    count: 0
                }
            })

            await waitForUpdate()

            const span = testContainer.querySelector('[data-bind="count"]')
            // Zero is a falsy value but should still render as "0"
            expect(span.textContent).toBe('0')
        })

        it('should display initial false value as string on component creation', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-false-test">
                    <span data-bind="isActive"></span>
                </div>
            `

            wildflower.component('initial-false-test', {
                state: {
                    isActive: false
                }
            })

            await waitForUpdate()

            const span = testContainer.querySelector('[data-bind="isActive"]')
            expect(span.textContent).toBe('false')
        })

        it('should display empty string for null initial value', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-null-test">
                    <span data-bind="value"></span>
                </div>
            `

            wildflower.component('initial-null-test', {
                state: {
                    value: null
                }
            })

            await waitForUpdate()

            const span = testContainer.querySelector('[data-bind="value"]')
            expect(span.textContent).toBe('')
        })

        it('should display empty string for undefined initial value', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-undefined-test">
                    <span data-bind="value"></span>
                </div>
            `

            wildflower.component('initial-undefined-test', {
                state: {
                    value: undefined
                }
            })

            await waitForUpdate()

            const span = testContainer.querySelector('[data-bind="value"]')
            expect(span.textContent).toBe('')
        })
    })

    describe('Nested Property Bindings', () => {
        it('should display initial nested object property value', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-nested-test">
                    <span data-bind="user.name"></span>
                    <span data-bind="user.email"></span>
                </div>
            `

            wildflower.component('initial-nested-test', {
                state: {
                    user: {
                        name: 'John Doe',
                        email: 'john@example.com'
                    }
                }
            })

            await waitForUpdate()

            const nameSpan = testContainer.querySelector('[data-bind="user.name"]')
            const emailSpan = testContainer.querySelector('[data-bind="user.email"]')

            expect(nameSpan.textContent).toBe('John Doe')
            expect(emailSpan.textContent).toBe('john@example.com')
        })

        it('should display initial deeply nested property value', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-deep-nested-test">
                    <span data-bind="config.settings.display.theme"></span>
                </div>
            `

            wildflower.component('initial-deep-nested-test', {
                state: {
                    config: {
                        settings: {
                            display: {
                                theme: 'dark'
                            }
                        }
                    }
                }
            })

            await waitForUpdate()

            const span = testContainer.querySelector('[data-bind="config.settings.display.theme"]')
            expect(span.textContent).toBe('dark')
        })
    })

    describe('Computed Property Bindings', () => {
        it('should display initial computed property value', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-computed-test">
                    <span data-bind="computed:fullName"></span>
                </div>
            `

            wildflower.component('initial-computed-test', {
                state: {
                    firstName: 'John',
                    lastName: 'Doe'
                },
                computed: {
                    fullName() {
                        return `${this.state.firstName} ${this.state.lastName}`
                    }
                }
            })

            await waitForUpdate()

            const span = testContainer.querySelector('[data-bind="computed:fullName"]')
            expect(span.textContent).toBe('John Doe')
        })

        it('should display initial computed property that depends on nested state', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-computed-nested-test">
                    <span data-bind="computed:displayName"></span>
                </div>
            `

            wildflower.component('initial-computed-nested-test', {
                state: {
                    user: {
                        name: 'Alice',
                        role: 'Admin'
                    }
                },
                computed: {
                    displayName() {
                        return `${this.state.user.name} (${this.state.user.role})`
                    }
                }
            })

            await waitForUpdate()

            const span = testContainer.querySelector('[data-bind="computed:displayName"]')
            expect(span.textContent).toBe('Alice (Admin)')
        })
    })

    describe('Multiple Bindings', () => {
        it('should display all initial values when component has multiple bindings', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-multiple-test">
                    <h1 data-bind="title"></h1>
                    <h2 data-bind="subtitle"></h2>
                    <span class="count" data-bind="count"></span>
                    <span class="name" data-bind="user.name"></span>
                    <span class="status" data-bind="user.status"></span>
                    <span class="summary" data-bind="computed:summary"></span>
                </div>
            `

            wildflower.component('initial-multiple-test', {
                state: {
                    title: 'Welcome',
                    subtitle: 'To the app',
                    count: 5,
                    user: {
                        name: 'Bob',
                        status: 'online'
                    }
                },
                computed: {
                    summary() {
                        return `${this.state.title} - ${this.state.count} items`
                    }
                }
            })

            await waitForUpdate()

            expect(testContainer.querySelector('[data-bind="title"]').textContent).toBe('Welcome')
            expect(testContainer.querySelector('[data-bind="subtitle"]').textContent).toBe('To the app')
            expect(testContainer.querySelector('[data-bind="count"]').textContent).toBe('5')
            expect(testContainer.querySelector('[data-bind="user.name"]').textContent).toBe('Bob')
            expect(testContainer.querySelector('[data-bind="user.status"]').textContent).toBe('online')
            expect(testContainer.querySelector('[data-bind="computed:summary"]').textContent).toBe('Welcome - 5 items')
        })
    })

    describe('Input Element Bindings', () => {
        it('should set initial value on text input', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-input-test">
                    <input type="text" data-bind="username">
                </div>
            `

            wildflower.component('initial-input-test', {
                state: {
                    username: 'testuser'
                }
            })

            await waitForUpdate()

            const input = testContainer.querySelector('input[data-bind="username"]')
            expect(input.value).toBe('testuser')
        })

        it('should set initial value on textarea', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-textarea-test">
                    <textarea data-bind="description"></textarea>
                </div>
            `

            wildflower.component('initial-textarea-test', {
                state: {
                    description: 'This is a description'
                }
            })

            await waitForUpdate()

            const textarea = testContainer.querySelector('textarea[data-bind="description"]')
            expect(textarea.value).toBe('This is a description')
        })
    })

    describe('Component with init() method', () => {
        it('should display initial values even when component has init() method', async () => {
            let initCalled = false

            testContainer.innerHTML = `
                <div data-component="initial-with-init-test">
                    <span data-bind="message"></span>
                    <span data-bind="count"></span>
                </div>
            `

            wildflower.component('initial-with-init-test', {
                state: {
                    message: 'Initial message',
                    count: 10
                },
                init() {
                    initCalled = true
                    // init() should NOT be required for initial values to render
                }
            })

            await waitForUpdate()

            expect(initCalled).toBe(true)
            expect(testContainer.querySelector('[data-bind="message"]').textContent).toBe('Initial message')
            expect(testContainer.querySelector('[data-bind="count"]').textContent).toBe('10')
        })

        it('should display values set during init()', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-set-in-init-test">
                    <span data-bind="message"></span>
                </div>
            `

            wildflower.component('initial-set-in-init-test', {
                state: {
                    message: 'Before init'
                },
                init() {
                    this.state.message = 'Set in init'
                }
            })

            await waitForUpdate()

            const span = testContainer.querySelector('[data-bind="message"]')
            // Value should reflect what was set in init()
            expect(span.textContent).toBe('Set in init')
        })
    })

    describe('Empty Initial Content', () => {
        it('should overwrite existing element content with state value', async () => {
            testContainer.innerHTML = `
                <div data-component="initial-overwrite-test">
                    <span data-bind="message">Placeholder text</span>
                </div>
            `

            wildflower.component('initial-overwrite-test', {
                state: {
                    message: 'From state'
                }
            })

            await waitForUpdate()

            const span = testContainer.querySelector('[data-bind="message"]')
            // State value should replace the placeholder
            expect(span.textContent).toBe('From state')
        })
    })
})
