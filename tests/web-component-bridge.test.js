/**
 * Web Component Bridge Tests
 *
 * Tests for the Web Component adapter system that enables data-model
 * and data-bind to work with custom elements (Shadow DOM libraries
 * like Shoelace, IBM Carbon, etc).
 *
 * Phase 1 covers:
 * - wildflower.registerAdapter() API
 * - Property-over-attribute for custom elements
 * - Custom event listening for data-model
 * - data-model-event attribute override
 * - Deferred binding for unregistered custom elements
 * - e.detail value extraction from CustomEvent
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

// ============================================================================
// Mock Web Component Helpers
//
// We define real custom elements in the browser for these tests.
// This is more realistic than mocking and tests the actual integration path.
// ============================================================================

/**
 * Define a mock web component that behaves like a Shoelace-style input.
 * Fires a custom event (e.g., 'wc-input') instead of the standard 'input' event.
 * Uses a JS property for its value (not just the attribute).
 */
function defineMockInput(tagName, eventName) {
    if (customElements.get(tagName)) return // Already defined

    class MockInput extends HTMLElement {
        constructor() {
            super()
            this._value = ''
            // Attach shadow DOM to prove WF doesn't need to pierce it
            this.attachShadow({ mode: 'open' })
            this.shadowRoot.innerHTML = '<input type="text">'

            // Forward internal input events as custom events
            this.shadowRoot.querySelector('input').addEventListener('input', (e) => {
                this._value = e.target.value
                this.dispatchEvent(new CustomEvent(eventName, {
                    bubbles: true,
                    detail: { value: this._value }
                }))
            })
        }

        get value() { return this._value }
        set value(v) {
            this._value = v
            if (this.shadowRoot) {
                this.shadowRoot.querySelector('input').value = v
            }
        }
    }

    customElements.define(tagName, MockInput)
}

/**
 * Define a mock checkbox web component (like sl-checkbox).
 * Uses 'checked' property and fires a custom change event.
 */
function defineMockCheckbox(tagName, eventName) {
    if (customElements.get(tagName)) return

    class MockCheckbox extends HTMLElement {
        constructor() {
            super()
            this._checked = false
            this.attachShadow({ mode: 'open' })
            this.shadowRoot.innerHTML = '<input type="checkbox">'

            this.shadowRoot.querySelector('input').addEventListener('change', (e) => {
                this._checked = e.target.checked
                this.dispatchEvent(new CustomEvent(eventName, {
                    bubbles: true,
                    detail: { checked: this._checked }
                }))
            })
        }

        get checked() { return this._checked }
        set checked(v) {
            this._checked = !!v
            if (this.shadowRoot) {
                this.shadowRoot.querySelector('input').checked = this._checked
            }
        }
    }

    customElements.define(tagName, MockCheckbox)
}


/**
 * Define a mock web component that fires NATIVE input/change events.
 * Used to test the smart default path (no adapter registered).
 */
function defineMockNativeInput(tagName) {
    if (customElements.get(tagName)) return

    class MockNativeInput extends HTMLElement {
        constructor() {
            super()
            this._value = ''
            this.attachShadow({ mode: 'open' })
            this.shadowRoot.innerHTML = '<input type="text">'

            // Fire NATIVE input event (not custom) — composes through shadow DOM
            this.shadowRoot.querySelector('input').addEventListener('input', (e) => {
                this._value = e.target.value
                this.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
            })
        }

        get value() { return this._value }
        set value(v) {
            this._value = v
            if (this.shadowRoot) {
                this.shadowRoot.querySelector('input').value = v
            }
        }
    }

    customElements.define(tagName, MockNativeInput)
}

/**
 * Define a mock native-event checkbox web component.
 * Fires native 'change' event — tests smart default with boolean prop.
 */
function defineMockNativeCheckbox(tagName) {
    if (customElements.get(tagName)) return

    class MockNativeCheckbox extends HTMLElement {
        constructor() {
            super()
            this._checked = false
            this.attachShadow({ mode: 'open' })
            this.shadowRoot.innerHTML = '<input type="checkbox">'

            this.shadowRoot.querySelector('input').addEventListener('change', (e) => {
                this._checked = e.target.checked
                this.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
            })
        }

        get checked() { return this._checked }
        set checked(v) {
            this._checked = !!v
            if (this.shadowRoot) {
                this.shadowRoot.querySelector('input').checked = this._checked
            }
        }
    }

    customElements.define(tagName, MockNativeCheckbox)
}


describe('Web Component Bridge', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()

        // Define mock web components once (customElements.define is permanent per page)
        defineMockInput('wc-input', 'wc-input')
        defineMockInput('wc-text-field', 'wc-change')
        defineMockCheckbox('wc-checkbox', 'wc-change')

        // Native-event mocks for smart default testing
        defineMockNativeInput('wc-native-input')
        defineMockNativeCheckbox('wc-native-check')
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
        testContainer = null
    })

    // ========================================================================
    // 1. ADAPTER REGISTRY API
    // ========================================================================

    describe('Adapter Registry', () => {
        it('should expose wildflower.registerAdapter() method', () => {
            expect(typeof wildflower.registerAdapter).toBe('function')
        })

        it('should store registered adapters', () => {
            wildflower.registerAdapter('wc-input', {
                prop: 'value',
                event: 'wc-input'
            })

            const adapter = wildflower.getAdapter('wc-input')
            expect(adapter).toBeTruthy()
            expect(adapter.prop).toBe('value')
            expect(adapter.event).toBe('wc-input')
        })

        it('should normalize tag names to lowercase', () => {
            wildflower.registerAdapter('WC-Input', {
                prop: 'value',
                event: 'wc-input'
            })

            const adapter = wildflower.getAdapter('wc-input')
            expect(adapter).toBeTruthy()
        })

        it('should allow overwriting an adapter', () => {
            wildflower.registerAdapter('wc-input', {
                prop: 'value',
                event: 'wc-input'
            })

            wildflower.registerAdapter('wc-input', {
                prop: 'value',
                event: 'wc-custom-event'
            })

            const adapter = wildflower.getAdapter('wc-input')
            expect(adapter.event).toBe('wc-custom-event')
        })
    })

    // ========================================================================
    // 2. DATA-MODEL WITH ADAPTERS (User Input → State)
    // ========================================================================

    describe('data-model with Web Component adapter', () => {
        it('should listen for the adapter-specified event instead of input/change', async () => {
            wildflower.registerAdapter('wc-input', {
                prop: 'value',
                event: 'wc-input'
            })

            wildflower.component('wc-model-test', {
                state: { name: '' }
            })

            testContainer.innerHTML = `
                <div data-component="wc-model-test">
                    <wc-input data-model="name"></wc-input>
                    <span data-bind="name" class="display"></span>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcInput = testContainer.querySelector('wc-input')
            const display = testContainer.querySelector('.display')

            // Simulate user typing inside the shadow DOM input
            wcInput.shadowRoot.querySelector('input').value = 'Hello'
            wcInput.shadowRoot.querySelector('input').dispatchEvent(
                new Event('input', { bubbles: true })
            )

            await waitForUpdate(100)

            const component = testContainer.querySelector('[data-component="wc-model-test"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            expect(instance.state.name).toBe('Hello')
        })

        it('should use property assignment (not setAttribute) for initial value', async () => {
            wildflower.registerAdapter('wc-input', {
                prop: 'value',
                event: 'wc-input'
            })

            wildflower.component('wc-init-value', {
                state: { greeting: 'Hello World' }
            })

            testContainer.innerHTML = `
                <div data-component="wc-init-value">
                    <wc-input data-model="greeting"></wc-input>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcInput = testContainer.querySelector('wc-input')

            // The adapter should have set the JS property, not just the attribute
            expect(wcInput.value).toBe('Hello World')
        })

        it('should read value from adapter-specified property', async () => {
            wildflower.registerAdapter('wc-checkbox', {
                prop: 'checked',
                event: 'wc-change'
            })

            wildflower.component('wc-checkbox-test', {
                state: { agreed: false }
            })

            testContainer.innerHTML = `
                <div data-component="wc-checkbox-test">
                    <wc-checkbox data-model="agreed"></wc-checkbox>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcCheckbox = testContainer.querySelector('wc-checkbox')

            // Simulate checking the internal checkbox
            wcCheckbox.shadowRoot.querySelector('input').checked = true
            wcCheckbox.shadowRoot.querySelector('input').dispatchEvent(
                new Event('change', { bubbles: true })
            )

            await waitForUpdate(100)

            const component = testContainer.querySelector('[data-component="wc-checkbox-test"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            expect(instance.state.agreed).toBe(true)
        })
    })

    // ========================================================================
    // 3. DATA-MODEL-EVENT OVERRIDE (Escape Hatch)
    // ========================================================================

    describe('data-model-event override', () => {
        it('should use data-model-event attribute over adapter config', async () => {
            // Register adapter with one event
            wildflower.registerAdapter('wc-text-field', {
                prop: 'value',
                event: 'wc-change'
            })

            wildflower.component('wc-event-override', {
                state: { text: '' }
            })

            // Override with data-model-event attribute
            testContainer.innerHTML = `
                <div data-component="wc-event-override">
                    <wc-text-field data-model="text" data-model-event="wc-change"></wc-text-field>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcField = testContainer.querySelector('wc-text-field')

            // Dispatch the overridden event name
            wcField._value = 'override works'
            wcField.dispatchEvent(new CustomEvent('wc-change', {
                bubbles: true,
                detail: { value: 'override works' }
            }))

            await waitForUpdate(100)

            const component = testContainer.querySelector('[data-component="wc-event-override"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            expect(instance.state.text).toBe('override works')
        })

        it('should work with data-model-event even without a registered adapter', async () => {
            // No adapter registered for this tag
            wildflower.component('wc-no-adapter', {
                state: { val: '' }
            })

            testContainer.innerHTML = `
                <div data-component="wc-no-adapter">
                    <wc-text-field data-model="val" data-model-event="wc-change"></wc-text-field>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcField = testContainer.querySelector('wc-text-field')

            // Dispatch the event specified by data-model-event
            wcField._value = 'no adapter needed'
            wcField.dispatchEvent(new CustomEvent('wc-change', {
                bubbles: true,
                detail: { value: 'no adapter needed' }
            }))

            await waitForUpdate(100)

            const component = testContainer.querySelector('[data-component="wc-no-adapter"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            expect(instance.state.val).toBe('no adapter needed')
        })
    })

    // ========================================================================
    // 4. CUSTOM EVENT VALUE EXTRACTION (e.detail)
    // ========================================================================

    describe('CustomEvent detail extraction', () => {
        it('should extract value from e.detail.value for custom events', async () => {
            wildflower.registerAdapter('wc-input', {
                prop: 'value',
                event: 'wc-input'
            })

            wildflower.component('wc-detail-test', {
                state: { data: '' }
            })

            testContainer.innerHTML = `
                <div data-component="wc-detail-test">
                    <wc-input data-model="data"></wc-input>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcInput = testContainer.querySelector('wc-input')

            // Fire CustomEvent with detail.value (common Web Component pattern)
            wcInput.dispatchEvent(new CustomEvent('wc-input', {
                bubbles: true,
                detail: { value: 'from detail' }
            }))

            await waitForUpdate(100)

            const component = testContainer.querySelector('[data-component="wc-detail-test"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            expect(instance.state.data).toBe('from detail')
        })
    })

    // ========================================================================
    // 5. DATA-BIND OUTPUT TO WEB COMPONENTS
    // ========================================================================

    describe('data-bind with Web Components', () => {
        it('should use property assignment for data-bind on custom elements', async () => {
            wildflower.registerAdapter('wc-input', {
                prop: 'value',
                event: 'wc-input'
            })

            wildflower.component('wc-bind-test', {
                state: { name: 'Initial' }
            })

            testContainer.innerHTML = `
                <div data-component="wc-bind-test">
                    <wc-input data-bind="name"></wc-input>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcInput = testContainer.querySelector('wc-input')

            // The framework should have set the JS property
            expect(wcInput.value).toBe('Initial')
        })

        it('should update Web Component property when state changes', async () => {
            wildflower.registerAdapter('wc-input', {
                prop: 'value',
                event: 'wc-input'
            })

            wildflower.component('wc-bind-update', {
                state: { name: 'Before' },
                changeName() {
                    this.state.name = 'After'
                }
            })

            testContainer.innerHTML = `
                <div data-component="wc-bind-update">
                    <wc-input data-bind="name"></wc-input>
                    <button data-action="changeName">Change</button>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcInput = testContainer.querySelector('wc-input')
            expect(wcInput.value).toBe('Before')

            // Trigger state change
            const button = testContainer.querySelector('button')
            button.click()
            await waitForCompleteRender()

            expect(wcInput.value).toBe('After')
        })
    })

    // ========================================================================
    // 6. DEFERRED BINDING (Async Gate)
    // ========================================================================

    describe('Deferred binding for custom elements', () => {
        it('should bind standard HTML elements synchronously (unchanged behavior)', async () => {
            wildflower.component('std-sync-test', {
                state: { text: 'Hello' }
            })

            testContainer.innerHTML = `
                <div data-component="std-sync-test">
                    <input data-model="text" class="std-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const input = testContainer.querySelector('.std-input')
            expect(input.value).toBe('Hello')
        })

        it('should defer binding for custom elements not yet defined', async () => {
            // Use a tag name that will be defined AFTER scan
            const uniqueTag = `wc-deferred-${Date.now()}`

            wildflower.registerAdapter(uniqueTag, {
                prop: 'value',
                event: 'custom-input'
            })

            wildflower.component('wc-deferred-test', {
                state: { text: 'Deferred Value' }
            })

            testContainer.innerHTML = `
                <div data-component="wc-deferred-test">
                    <${uniqueTag} data-model="text"></${uniqueTag}>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(50)

            // Element exists but custom element is not yet defined
            const wcEl = testContainer.querySelector(uniqueTag)
            expect(wcEl).toBeTruthy()

            // Now define the custom element
            class DeferredInput extends HTMLElement {
                constructor() {
                    super()
                    this._value = ''
                }
                get value() { return this._value }
                set value(v) { this._value = v }
            }
            customElements.define(uniqueTag, DeferredInput)

            // Wait for whenDefined to resolve and binding to complete
            await customElements.whenDefined(uniqueTag)
            await waitForUpdate(200)

            // The deferred binding should have set the value
            expect(wcEl.value).toBe('Deferred Value')
        })
    })

    // ========================================================================
    // 7. ZERO REGRESSION FOR STANDARD ELEMENTS
    // ========================================================================

    describe('Standard element regression checks', () => {
        it('should handle standard text input exactly as before', async () => {
            wildflower.component('std-text-test', {
                state: { name: '' }
            })

            testContainer.innerHTML = `
                <div data-component="std-text-test">
                    <input type="text" data-model="name" class="text-input">
                    <span data-bind="name" class="text-display"></span>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const input = testContainer.querySelector('.text-input')
            const display = testContainer.querySelector('.text-display')

            input.value = 'Standard'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            const component = testContainer.querySelector('[data-component="std-text-test"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            expect(instance.state.name).toBe('Standard')
        })

        it('should handle standard checkbox exactly as before', async () => {
            wildflower.component('std-check-test', {
                state: { enabled: false }
            })

            testContainer.innerHTML = `
                <div data-component="std-check-test">
                    <input type="checkbox" data-model="enabled" class="check-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const input = testContainer.querySelector('.check-input')

            input.checked = true
            input.dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate()

            const component = testContainer.querySelector('[data-component="std-check-test"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            expect(instance.state.enabled).toBe(true)
        })

        it('should handle standard select exactly as before', async () => {
            wildflower.component('std-select-test', {
                state: { color: 'red' }
            })

            testContainer.innerHTML = `
                <div data-component="std-select-test">
                    <select data-model="color" class="select-input">
                        <option value="red">Red</option>
                        <option value="blue">Blue</option>
                    </select>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const select = testContainer.querySelector('.select-input')

            select.value = 'blue'
            select.dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate()

            const component = testContainer.querySelector('[data-component="std-select-test"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            expect(instance.state.color).toBe('blue')
        })
    })

    // ========================================================================
    // 8. TWO-WAY BINDING (Full Round-Trip)
    // ========================================================================

    describe('Full two-way binding round-trip', () => {
        it('should support state → WC → user input → state cycle', async () => {
            wildflower.registerAdapter('wc-input', {
                prop: 'value',
                event: 'wc-input'
            })

            wildflower.component('wc-roundtrip', {
                state: { message: 'Start' },
                reset() {
                    this.state.message = 'Reset'
                }
            })

            testContainer.innerHTML = `
                <div data-component="wc-roundtrip">
                    <wc-input data-model="message"></wc-input>
                    <span data-bind="message" class="display"></span>
                    <button data-action="reset">Reset</button>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcInput = testContainer.querySelector('wc-input')
            const display = testContainer.querySelector('.display')
            const component = testContainer.querySelector('[data-component="wc-roundtrip"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // 1. Initial state → WC property
            expect(wcInput.value).toBe('Start')
            expect(display.textContent).toBe('Start')

            // 2. User types in WC → state updates
            wcInput.shadowRoot.querySelector('input').value = 'UserTyped'
            wcInput.shadowRoot.querySelector('input').dispatchEvent(
                new Event('input', { bubbles: true })
            )
            await waitForUpdate(100)

            expect(instance.state.message).toBe('UserTyped')

            // 3. Programmatic state change → WC property updates
            const button = testContainer.querySelector('button')
            button.click()
            await waitForCompleteRender()

            expect(wcInput.value).toBe('Reset')
            expect(instance.state.message).toBe('Reset')
        })
    })

    // ========================================================================
    // 9. WEB COMPONENTS INSIDE LIST ITEMS
    // ========================================================================

    describe('Web Components inside data-list', () => {
        it('should render data-bind on WC inside each list item', async () => {
            wildflower.registerAdapter('wc-input', {
                prop: 'value',
                event: 'wc-input'
            })

            wildflower.component('wc-list-bind', {
                state: {
                    people: [
                        { name: 'Alice' },
                        { name: 'Bob' },
                        { name: 'Carol' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="wc-list-bind">
                    <div data-list="people">
                        <template>
                            <div class="person">
                                <wc-input data-bind="name"></wc-input>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const inputs = testContainer.querySelectorAll('wc-input')
            expect(inputs.length).toBe(3)

            // Each WC should have its list item's name set via property
            expect(inputs[0].value).toBe('Alice')
            expect(inputs[1].value).toBe('Bob')
            expect(inputs[2].value).toBe('Carol')
        })

        it('should update WC properties when list data changes', async () => {
            wildflower.registerAdapter('wc-input', {
                prop: 'value',
                event: 'wc-input'
            })

            wildflower.component('wc-list-update', {
                state: {
                    items: [
                        { label: 'First' },
                        { label: 'Second' }
                    ]
                },
                replaceItems() {
                    this.state.items = [
                        { label: 'Alpha' },
                        { label: 'Beta' },
                        { label: 'Gamma' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="wc-list-update">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <wc-input data-bind="label"></wc-input>
                            </div>
                        </template>
                    </div>
                    <button data-action="replaceItems">Replace</button>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            let inputs = testContainer.querySelectorAll('wc-input')
            expect(inputs.length).toBe(2)
            expect(inputs[0].value).toBe('First')

            // Replace the list
            testContainer.querySelector('button').click()
            await waitForCompleteRender()

            inputs = testContainer.querySelectorAll('wc-input')
            expect(inputs.length).toBe(3)
            expect(inputs[0].value).toBe('Alpha')
            expect(inputs[1].value).toBe('Beta')
            expect(inputs[2].value).toBe('Gamma')
        })

        it('should bind data-bind on WC-checkbox (checked prop) inside list items', async () => {
            wildflower.registerAdapter('wc-checkbox', {
                prop: 'checked',
                event: 'wc-change'
            })

            wildflower.component('wc-list-checkbox', {
                state: {
                    tasks: [
                        { done: true },
                        { done: false },
                        { done: true }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="wc-list-checkbox">
                    <div data-list="tasks">
                        <template>
                            <div class="task">
                                <wc-checkbox data-bind="done"></wc-checkbox>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const checkboxes = testContainer.querySelectorAll('wc-checkbox')
            expect(checkboxes.length).toBe(3)

            expect(checkboxes[0].checked).toBe(true)
            expect(checkboxes[1].checked).toBe(false)
            expect(checkboxes[2].checked).toBe(true)
        })
    })

    // ========================================================================
    // 10. SMART DEFAULT (No Adapter Registered)
    // ========================================================================

    describe('Smart default auto-detection (no adapter)', () => {
        it('should auto-detect value property for native-event web component', async () => {
            // NO adapter registered for wc-native-input
            wildflower.component('wc-smart-value', {
                state: { text: 'auto-detected' }
            })

            testContainer.innerHTML = `
                <div data-component="wc-smart-value">
                    <wc-native-input data-model="text"></wc-native-input>
                    <span data-bind="text" class="display"></span>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcInput = testContainer.querySelector('wc-native-input')

            // Initial value should be set via auto-detected 'value' property
            expect(wcInput.value).toBe('auto-detected')
        })

        it('should listen for native input event without adapter', async () => {
            wildflower.component('wc-smart-event', {
                state: { text: '' }
            })

            testContainer.innerHTML = `
                <div data-component="wc-smart-event">
                    <wc-native-input data-model="text"></wc-native-input>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcInput = testContainer.querySelector('wc-native-input')

            // Simulate user typing — fires native 'input' event
            wcInput.shadowRoot.querySelector('input').value = 'typed'
            wcInput.shadowRoot.querySelector('input').dispatchEvent(
                new Event('input', { bubbles: true })
            )

            await waitForUpdate(100)

            const component = testContainer.querySelector('[data-component="wc-smart-event"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            expect(instance.state.text).toBe('typed')
        })

        it('should auto-detect checked property for boolean web component', async () => {
            // NO adapter registered for wc-native-check
            wildflower.component('wc-smart-checked', {
                state: { enabled: true }
            })

            testContainer.innerHTML = `
                <div data-component="wc-smart-checked">
                    <wc-native-check data-model="enabled"></wc-native-check>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcCheck = testContainer.querySelector('wc-native-check')

            // Should auto-detect 'checked' prop since typeof element.checked === 'boolean'
            expect(wcCheck.checked).toBe(true)
        })

        it('should listen for native change event on boolean web component', async () => {
            wildflower.component('wc-smart-check-event', {
                state: { agreed: false }
            })

            testContainer.innerHTML = `
                <div data-component="wc-smart-check-event">
                    <wc-native-check data-model="agreed"></wc-native-check>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const wcCheck = testContainer.querySelector('wc-native-check')

            // Simulate clicking the internal checkbox — fires native 'change' event
            wcCheck.shadowRoot.querySelector('input').checked = true
            wcCheck.shadowRoot.querySelector('input').dispatchEvent(
                new Event('change', { bubbles: true })
            )

            await waitForUpdate(100)

            const component = testContainer.querySelector('[data-component="wc-smart-check-event"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            expect(instance.state.agreed).toBe(true)
        })

        it('should work with smart default inside list items', async () => {
            // NO adapter registered — relies entirely on smart default
            wildflower.component('wc-smart-list', {
                state: {
                    entries: [
                        { text: 'First' },
                        { text: 'Second' },
                        { text: 'Third' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="wc-smart-list">
                    <div data-list="entries">
                        <template>
                            <div class="entry">
                                <wc-native-input data-bind="text"></wc-native-input>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const inputs = testContainer.querySelectorAll('wc-native-input')
            expect(inputs.length).toBe(3)

            // Smart default should detect 'value' prop and set each item's text
            expect(inputs[0].value).toBe('First')
            expect(inputs[1].value).toBe('Second')
            expect(inputs[2].value).toBe('Third')
        })
    })
})
