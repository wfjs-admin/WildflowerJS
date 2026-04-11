/**
 * Dollar Syntax Binding Tests - Vitest Browser Mode
 *
 * Tests that $name.path shorthand works in data-bind, data-show,
 * data-bind-class, and expressions for stores, plugins, and components.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describe('Dollar Syntax ($name.path) in Data Attributes', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        // Reset plugin system state
        if (wildflower._plugins) wildflower._plugins = []
        if (wildflower._pluginsByName) wildflower._pluginsByName.clear()
        if (wildflower._customDirectives) wildflower._customDirectives.clear()
        if (wildflower._hooks) wildflower._hooks.clear()
        if (wildflower._pluginStates) wildflower._pluginStates.clear()
        if (wildflower._providers) wildflower._providers = new Map()

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

    // =========================================================================
    // STORE: $storeName.path in data-bind
    // =========================================================================
    describe('Store: $storeName.path', () => {
        it('data-bind with $store.path renders store value', async () => {
            wildflower.store('appConfig', {
                state: { title: 'My App' }
            })

            wildflower.component('store-bind-test', {
                state: {},
                subscribe: { appConfig: ['title'] }
            })

            testContainer.innerHTML = `
                <div data-component="store-bind-test">
                    <span class="output" data-bind="$appConfig.title"></span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.output').textContent).toBe('My App')
        })

        it('data-bind with $store.path updates reactively', async () => {
            wildflower.store('counter', {
                state: { count: 0 },
                increment() { this.state.count++ }
            })

            wildflower.component('store-reactive-test', {
                state: {},
                subscribe: { counter: ['count'] }
            })

            testContainer.innerHTML = `
                <div data-component="store-reactive-test">
                    <span class="output" data-bind="$counter.count"></span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.output').textContent).toBe('0')

            wildflower.getStore('counter').increment()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.output').textContent).toBe('1')
        })

        it('data-show with $store.path expression', async () => {
            wildflower.store('visibility', {
                state: { isVisible: true }
            })

            wildflower.component('store-show-test', {
                state: {},
                subscribe: { visibility: ['isVisible'] }
            })

            testContainer.innerHTML = `
                <div data-component="store-show-test">
                    <span class="target" data-show="$visibility.isVisible">Visible</span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            const target = testContainer.querySelector('.target')
            expect(target.style.display).not.toBe('none')

            wildflower.getStore('visibility').state.isVisible = false
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(target.style.display).toBe('none')
        })

        it('$store.path in expressions with operators', async () => {
            wildflower.store('pricing', {
                state: { taxRate: 0.1 }
            })

            wildflower.component('store-expr-test', {
                state: { price: 100 },
                subscribe: { pricing: ['taxRate'] }
            })

            testContainer.innerHTML = `
                <div data-component="store-expr-test">
                    <span class="output" data-bind="price + price * $pricing.taxRate"></span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.output').textContent).toBe('110')
        })
    })

    // =========================================================================
    // PLUGIN: $pluginName.path in data-bind
    // =========================================================================
    describeIfPlugins('Plugin: $pluginName.path', () => {
        it('data-bind with $plugin.path renders plugin state', async () => {
            wildflower.plugin({
                name: 'cart',
                state: { total: 42 },
                install() {}
            })

            wildflower.component('plugin-bind-test', {
                state: {}
            })

            testContainer.innerHTML = `
                <div data-component="plugin-bind-test">
                    <span class="output" data-bind="$cart.total"></span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.output').textContent).toBe('42')
        })

        it('data-bind with $plugin.path updates reactively', async () => {
            wildflower.plugin({
                name: 'notifications',
                state: { count: 0 },
                add() { this.count++ },
                install() {}
            })

            wildflower.component('plugin-reactive-test', {
                state: {}
            })

            testContainer.innerHTML = `
                <div data-component="plugin-reactive-test">
                    <span class="output" data-bind="$notifications.count"></span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.output').textContent).toBe('0')

            wildflower.$notifications.add()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.output').textContent).toBe('1')
        })

        it('data-show with $plugin.path', async () => {
            wildflower.plugin({
                name: 'auth',
                state: { loggedIn: false },
                login() { this.loggedIn = true },
                install() {}
            })

            wildflower.component('plugin-show-test', {
                state: {}
            })

            testContainer.innerHTML = `
                <div data-component="plugin-show-test">
                    <span class="logged-in" data-show="$auth.loggedIn">Welcome</span>
                    <span class="logged-out" data-show="!$auth.loggedIn">Please log in</span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.logged-in').style.display).toBe('none')
            expect(testContainer.querySelector('.logged-out').style.display).not.toBe('none')

            wildflower.$auth.login()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.logged-in').style.display).not.toBe('none')
            expect(testContainer.querySelector('.logged-out').style.display).toBe('none')
        })

        it('data-bind-class with $plugin.path', async () => {
            wildflower.plugin({
                name: 'theme',
                state: { mode: 'dark' },
                install() {}
            })

            wildflower.component('plugin-class-test', {
                state: {}
            })

            testContainer.innerHTML = `
                <div data-component="plugin-class-test">
                    <div class="target" data-bind-class="$theme.mode">Content</div>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.target').classList.contains('dark')).toBe(true)
        })

        it('$plugin.computed in data-bind', async () => {
            wildflower.plugin({
                name: 'cartComputed',
                state: {
                    items: [
                        { price: 10 },
                        { price: 20 },
                        { price: 30 }
                    ]
                },
                computed: {
                    total() {
                        return this.items.reduce((sum, item) => sum + item.price, 0)
                    }
                },
                install() {}
            })

            wildflower.component('plugin-computed-test', {
                state: {}
            })

            testContainer.innerHTML = `
                <div data-component="plugin-computed-test">
                    <span class="output" data-bind="$cartComputed.total"></span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.output').textContent).toBe('60')
        })

        it('$plugin.path in list item context', async () => {
            wildflower.plugin({
                name: 'listConfig',
                state: { currency: 'USD' },
                install() {}
            })

            wildflower.component('plugin-list-test', {
                state: {
                    products: [
                        { name: 'Widget', price: 10 },
                        { name: 'Gadget', price: 20 }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="plugin-list-test">
                    <ul data-list="products">
                        <template>
                            <li>
                                <span class="name" data-bind="name"></span>
                                <span class="currency" data-bind="$listConfig.currency"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            const currencies = testContainer.querySelectorAll('.currency')
            expect(currencies.length).toBe(2)
            expect(currencies[0].textContent).toBe('USD')
            expect(currencies[1].textContent).toBe('USD')
        })

        it('$plugin.path mixed with local state in expression', async () => {
            wildflower.plugin({
                name: 'tax',
                state: { rate: 0.08 },
                install() {}
            })

            wildflower.component('plugin-expr-test', {
                state: { subtotal: 100 }
            })

            testContainer.innerHTML = `
                <div data-component="plugin-expr-test">
                    <span class="output" data-bind="subtotal + subtotal * $tax.rate"></span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.output').textContent).toBe('108')
        })
    })

    // =========================================================================
    // COMPONENT: $componentName.path in data-bind
    // =========================================================================
    describe('Component: $componentName.path', () => {
        it('data-bind with $component.path renders sibling component state', async () => {
            wildflower.component('source-comp', {
                state: { message: 'From Source' }
            })

            wildflower.component('reader-comp', {
                state: {}
            })

            testContainer.innerHTML = `
                <div data-component="source-comp" id="source-comp"></div>
                <div data-component="reader-comp">
                    <span class="output" data-bind="$source-comp.message"></span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.output').textContent).toBe('From Source')
        })
    })
})
