/**
 * $ Universal Entity Accessor — Cross-Component Access Tests
 *
 * The $ accessor works uniformly for stores, components, and plugins.
 * Store tests are in store-subscription-syntax.test.js.
 * These tests verify cross-component access via $componentName.path.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js'

describe('$component.path Cross-Component Access', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    it('should bind to another component state using $component.path in data-bind', async () => {
        wildflower.component('provider-comp', {
            state: {
                message: 'Hello from provider'
            }
        })

        wildflower.component('consumer-comp', {
            state: {}
        })

        testContainer.innerHTML = `
            <div data-component="provider-comp"></div>
            <div data-component="consumer-comp">
                <span class="result" data-bind="$provider-comp.message"></span>
            </div>
        `

        await waitForUpdate(200)

        const result = testContainer.querySelector('.result')
        expect(result.textContent).toBe('Hello from provider')
    })

    it('should bind to another component state using $component.path in data-show', async () => {
        wildflower.component('toggle-provider', {
            state: {
                isVisible: true
            }
        })

        wildflower.component('toggle-consumer', {
            state: {}
        })

        testContainer.innerHTML = `
            <div data-component="toggle-provider"></div>
            <div data-component="toggle-consumer">
                <div class="conditional" data-show="$toggle-provider.isVisible">Shown!</div>
            </div>
        `

        await waitForUpdate(200)

        const el = testContainer.querySelector('.conditional')
        expect(el.style.display).not.toBe('none')
    })

    it('should bind to another component list using $component.path in data-list', async () => {
        wildflower.component('list-provider', {
            state: {
                items: [
                    { id: 1, name: 'Item A' },
                    { id: 2, name: 'Item B' }
                ]
            }
        })

        wildflower.component('list-consumer', {
            state: {}
        })

        testContainer.innerHTML = `
            <div data-component="list-provider"></div>
            <div data-component="list-consumer">
                <div data-list="$list-provider.items" data-key="id">
                    <template>
                        <div class="item" data-bind="name"></div>
                    </template>
                </div>
            </div>
        `

        await waitForUpdate(200)

        const items = testContainer.querySelectorAll('.item')
        expect(items.length).toBe(2)
        expect(items[0].textContent).toBe('Item A')
        expect(items[1].textContent).toBe('Item B')
    })

    it('should access nested child component state from parent template via $child.path', async () => {
        wildflower.component('outer-parent', {
            state: {
                parentLabel: 'Parent says hi'
            }
        })

        wildflower.component('inner-child', {
            state: {
                childMessage: 'Hello from child'
            }
        })

        testContainer.innerHTML = `
            <div data-component="outer-parent">
                <div data-component="inner-child"></div>
                <span class="from-child" data-bind="$inner-child.childMessage"></span>
            </div>
        `

        await waitForUpdate(200)

        const result = testContainer.querySelector('.from-child')
        expect(result.textContent).toBe('Hello from child')
    })

    it('should access component computed property via $component.path', async () => {
        wildflower.component('computed-provider', {
            state: {
                firstName: 'John',
                lastName: 'Doe'
            },
            computed: {
                fullName() {
                    return this.state.firstName + ' ' + this.state.lastName
                }
            }
        })

        wildflower.component('computed-consumer', {
            state: {}
        })

        testContainer.innerHTML = `
            <div data-component="computed-provider"></div>
            <div data-component="computed-consumer">
                <span class="name" data-bind="$computed-provider.fullName"></span>
            </div>
        `

        await waitForUpdate(200)

        const nameEl = testContainer.querySelector('.name')
        // This might need computed: prefix — let's see what happens
        // If it shows the computed value, $ resolves components too
        expect(nameEl.textContent).toBe('John Doe')
    })
})
