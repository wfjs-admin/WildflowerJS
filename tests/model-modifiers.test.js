/**
 * Model Modifiers Tests
 *
 * Tests for data-model-number, data-model-trim, and data-model-lazy modifiers.
 * These modifiers transform input values before updating component state.
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

describe('Model Modifiers', () => {
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
        testContainer = null
    })

    describe('data-model-number', () => {
        it('should convert text input value to number', async () => {
            wildflower.component('number-basic', {
                state: {
                    price: 0
                }
            })

            testContainer.innerHTML = `
                <div data-component="number-basic">
                    <input type="text" data-model="price" data-model-number class="price-input">
                    <span data-bind="price" class="price-display"></span>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="number-basic"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.price-input')

            // Type a number
            input.value = '42'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            // Should be a number, not string
            expect(instance.state.price).toBe(42)
            expect(typeof instance.state.price).toBe('number')
        })

        it('should handle decimal numbers', async () => {
            wildflower.component('number-decimal', {
                state: {
                    value: 0
                }
            })

            testContainer.innerHTML = `
                <div data-component="number-decimal">
                    <input type="text" data-model="value" data-model-number class="value-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="number-decimal"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.value-input')

            input.value = '3.14159'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.value).toBe(3.14159)
            expect(typeof instance.state.value).toBe('number')
        })

        it('should preserve empty string for empty input', async () => {
            wildflower.component('number-empty', {
                state: {
                    quantity: 5
                }
            })

            testContainer.innerHTML = `
                <div data-component="number-empty">
                    <input type="text" data-model="quantity" data-model-number class="qty-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="number-empty"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.qty-input')

            // Clear the input
            input.value = ''
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            // Should preserve empty string for validation purposes
            expect(instance.state.quantity).toBe('')
        })

        it('should return original string for invalid number input', async () => {
            wildflower.component('number-invalid', {
                state: {
                    value: 0
                }
            })

            testContainer.innerHTML = `
                <div data-component="number-invalid">
                    <input type="text" data-model="value" data-model-number class="value-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="number-invalid"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.value-input')

            // Type invalid input
            input.value = 'abc'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            // Should return original string
            expect(instance.state.value).toBe('abc')
        })

        it('should work inside list items', async () => {
            wildflower.component('number-list', {
                state: {
                    items: [
                        { id: 1, price: 10 },
                        { id: 2, price: 20 }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="number-list">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <input type="text" data-model="price" data-model-number class="price-input">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="number-list"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const inputs = testContainer.querySelectorAll('.price-input')

            inputs[0].value = '99.99'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.items[0].price).toBe(99.99)
            expect(typeof instance.state.items[0].price).toBe('number')
        })

        it('should work inside computed lists', async () => {
            wildflower.component('number-computed-list', {
                state: {
                    products: [
                        { id: 1, price: 10, active: true },
                        { id: 2, price: 20, active: true }
                    ]
                },
                computed: {
                    activeProducts() {
                        return this.state.products.filter(p => p.active)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="number-computed-list">
                    <div data-list="computed:activeProducts">
                        <template>
                            <div class="product">
                                <input type="text" data-model="price" data-model-number class="price-input">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="number-computed-list"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const inputs = testContainer.querySelectorAll('.price-input')

            inputs[0].value = '55.50'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.products[0].price).toBe(55.50)
        })

        it('should work with nested property paths', async () => {
            wildflower.component('number-nested', {
                state: {
                    item: {
                        details: {
                            price: 0
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="number-nested">
                    <input type="text" data-model="item.details.price" data-model-number class="price-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="number-nested"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.price-input')

            input.value = '199.99'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.item.details.price).toBe(199.99)
        })
    })

    describe('data-model-trim', () => {
        it('should trim leading whitespace', async () => {
            wildflower.component('trim-leading', {
                state: {
                    name: ''
                }
            })

            testContainer.innerHTML = `
                <div data-component="trim-leading">
                    <input type="text" data-model="name" data-model-trim class="name-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="trim-leading"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.name-input')

            input.value = '   hello'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.name).toBe('hello')
        })

        it('should trim trailing whitespace', async () => {
            wildflower.component('trim-trailing', {
                state: {
                    name: ''
                }
            })

            testContainer.innerHTML = `
                <div data-component="trim-trailing">
                    <input type="text" data-model="name" data-model-trim class="name-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="trim-trailing"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.name-input')

            input.value = 'hello   '
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.name).toBe('hello')
        })

        it('should trim both leading and trailing whitespace', async () => {
            wildflower.component('trim-both', {
                state: {
                    email: ''
                }
            })

            testContainer.innerHTML = `
                <div data-component="trim-both">
                    <input type="email" data-model="email" data-model-trim class="email-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="trim-both"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.email-input')

            input.value = '   test@example.com   '
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.email).toBe('test@example.com')
        })

        it('should preserve internal whitespace', async () => {
            wildflower.component('trim-internal', {
                state: {
                    message: ''
                }
            })

            testContainer.innerHTML = `
                <div data-component="trim-internal">
                    <input type="text" data-model="message" data-model-trim class="message-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="trim-internal"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.message-input')

            input.value = '  hello   world  '
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.message).toBe('hello   world')
        })

        it('should handle whitespace-only string', async () => {
            wildflower.component('trim-whitespace-only', {
                state: {
                    value: 'initial'
                }
            })

            testContainer.innerHTML = `
                <div data-component="trim-whitespace-only">
                    <input type="text" data-model="value" data-model-trim class="value-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="trim-whitespace-only"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.value-input')

            input.value = '     '
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.value).toBe('')
        })

        it('should work inside list items', async () => {
            wildflower.component('trim-list', {
                state: {
                    users: [
                        { id: 1, name: 'Alice' },
                        { id: 2, name: 'Bob' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="trim-list">
                    <div data-list="users">
                        <template>
                            <div class="user">
                                <input type="text" data-model="name" data-model-trim class="name-input">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="trim-list"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const inputs = testContainer.querySelectorAll('.name-input')

            inputs[0].value = '  Charlie  '
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.users[0].name).toBe('Charlie')
        })

        it('should work with textarea elements', async () => {
            wildflower.component('trim-textarea', {
                state: {
                    bio: ''
                }
            })

            testContainer.innerHTML = `
                <div data-component="trim-textarea">
                    <textarea data-model="bio" data-model-trim class="bio-input"></textarea>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="trim-textarea"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const textarea = testContainer.querySelector('.bio-input')

            textarea.value = '   This is my bio   '
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.bio).toBe('This is my bio')
        })

    })

    describe('data-model-lazy', () => {
        it('should not update state on input event', async () => {
            wildflower.component('lazy-no-input', {
                state: {
                    username: 'initial'
                }
            })

            testContainer.innerHTML = `
                <div data-component="lazy-no-input">
                    <input type="text" data-model="username" data-model-lazy class="username-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="lazy-no-input"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.username-input')

            // Type characters
            input.value = 'newuser'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            // State should NOT be updated
            expect(instance.state.username).toBe('initial')
        })

        it('should update state on blur event', async () => {
            wildflower.component('lazy-blur', {
                state: {
                    name: 'initial'
                }
            })

            testContainer.innerHTML = `
                <div data-component="lazy-blur">
                    <input type="text" data-model="name" data-model-lazy class="name-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="lazy-blur"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.name-input')

            // Type and then blur
            input.value = 'updated'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.name).toBe('initial') // Still initial

            input.dispatchEvent(new Event('blur', { bubbles: true }))
            await waitForUpdate()

            // Now should be updated
            expect(instance.state.name).toBe('updated')
        })

        it('should update state on change event', async () => {
            wildflower.component('lazy-change', {
                state: {
                    value: 'initial'
                }
            })

            testContainer.innerHTML = `
                <div data-component="lazy-change">
                    <input type="text" data-model="value" data-model-lazy class="value-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="lazy-change"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.value-input')

            input.value = 'changed'
            input.dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.value).toBe('changed')
        })

        it('should work with textarea elements', async () => {
            wildflower.component('lazy-textarea', {
                state: {
                    content: 'initial'
                }
            })

            testContainer.innerHTML = `
                <div data-component="lazy-textarea">
                    <textarea data-model="content" data-model-lazy class="content-input"></textarea>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="lazy-textarea"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const textarea = testContainer.querySelector('.content-input')

            textarea.value = 'new content'
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.content).toBe('initial') // Still initial

            textarea.dispatchEvent(new Event('blur', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.content).toBe('new content')
        })

        it('should work inside list items', async () => {
            wildflower.component('lazy-list', {
                state: {
                    items: [
                        { id: 1, title: 'Item 1' },
                        { id: 2, title: 'Item 2' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="lazy-list">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <input type="text" data-model="title" data-model-lazy class="title-input">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="lazy-list"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const inputs = testContainer.querySelectorAll('.title-input')

            inputs[0].value = 'Updated Item'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.items[0].title).toBe('Item 1') // Still original

            inputs[0].dispatchEvent(new Event('blur', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.items[0].title).toBe('Updated Item')
        })

        it('should combine with data-model-trim', async () => {
            wildflower.component('lazy-trim', {
                state: {
                    email: ''
                }
            })

            testContainer.innerHTML = `
                <div data-component="lazy-trim">
                    <input type="email" data-model="email" data-model-lazy data-model-trim class="email-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="lazy-trim"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.email-input')

            input.value = '   test@example.com   '
            input.dispatchEvent(new Event('blur', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.email).toBe('test@example.com')
        })

        it('should combine with data-model-number', async () => {
            wildflower.component('lazy-number', {
                state: {
                    price: 0
                }
            })

            testContainer.innerHTML = `
                <div data-component="lazy-number">
                    <input type="text" data-model="price" data-model-lazy data-model-number class="price-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="lazy-number"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.price-input')

            input.value = '42'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.price).toBe(0) // Still initial

            input.dispatchEvent(new Event('blur', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.price).toBe(42)
            expect(typeof instance.state.price).toBe('number')
        })

    })

    describe('Combined Modifiers', () => {
        it('should apply trim before number conversion', async () => {
            wildflower.component('combined-trim-number', {
                state: {
                    price: 0
                }
            })

            testContainer.innerHTML = `
                <div data-component="combined-trim-number">
                    <input type="text" data-model="price" data-model-trim data-model-number class="price-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="combined-trim-number"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.price-input')

            input.value = '   42.50   '
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.price).toBe(42.50)
            expect(typeof instance.state.price).toBe('number')
        })

        it('should work with trim + number + lazy', async () => {
            wildflower.component('combined-trim-number-lazy', {
                state: {
                    price: 0
                }
            })

            testContainer.innerHTML = `
                <div data-component="combined-trim-number-lazy">
                    <input type="text" data-model="price" data-model-trim data-model-number data-model-lazy class="price-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="combined-trim-number-lazy"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.price-input')

            input.value = '   75.25   '
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.price).toBe(0) // Still initial (lazy)

            input.dispatchEvent(new Event('blur', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.price).toBe(75.25)
            expect(typeof instance.state.price).toBe('number')
        })

        it('should handle trim + number with invalid input', async () => {
            wildflower.component('combined-invalid', {
                state: {
                    value: 0
                }
            })

            testContainer.innerHTML = `
                <div data-component="combined-invalid">
                    <input type="text" data-model="value" data-model-trim data-model-number class="value-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="combined-invalid"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.value-input')

            input.value = '   abc   '
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            // Should return trimmed original string since it's not a valid number
            expect(instance.state.value).toBe('abc')
        })

        it('should handle trim + number with empty input', async () => {
            wildflower.component('combined-empty', {
                state: {
                    value: 100
                }
            })

            testContainer.innerHTML = `
                <div data-component="combined-empty">
                    <input type="text" data-model="value" data-model-trim data-model-number class="value-input">
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="combined-empty"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const input = testContainer.querySelector('.value-input')

            input.value = '     '
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            // Trim results in '', number modifier preserves ''
            expect(instance.state.value).toBe('')
        })
    })
})
