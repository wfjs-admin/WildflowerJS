/**
 * Custom Elements Everywhere — WildflowerJS
 *
 * Regression suite adapted from https://github.com/webcomponents/custom-elements-everywhere
 * Same shared web components, same assertions, vitest browser harness.
 *
 * Tests verify WildflowerJS can:
 * - Render custom elements with/without Shadow DOM
 * - Pass primitive data via attributes (data-bind-attr)
 * - Pass complex data via init() property assignment
 * - Handle custom events with any casing
 * - Work with unregistered/unupgraded custom elements
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

// ============================================================================
// Shared Web Components (from custom-elements-everywhere)
// Identical to upstream: https://github.com/webcomponents/custom-elements-everywhere/tree/main/libraries/__shared__/webcomponents/src
// ============================================================================

function defineSharedElements() {
    if (!customElements.get('ce-without-children')) {
        customElements.define('ce-without-children', class extends HTMLElement {
            constructor() { super() }
        })
    }

    if (!customElements.get('ce-with-children')) {
        customElements.define('ce-with-children', class extends HTMLElement {
            constructor() {
                super()
                this.attachShadow({ mode: 'open' })
                this.shadowRoot.innerHTML = `
                    <h1>Test h1</h1>
                    <div><p>Test p</p></div>
                    <slot></slot>
                `
            }
        })
    }

    if (!customElements.get('ce-with-properties')) {
        customElements.define('ce-with-properties', class extends HTMLElement {
            set bool(v)         { this._bool = v }
            get bool()          { return this._bool }
            set num(v)          { this._num = v }
            get num()           { return this._num }
            set str(v)          { this._str = v }
            get str()           { return this._str }
            set arr(v)          { this._arr = v }
            get arr()           { return this._arr }
            set obj(v)          { this._obj = v }
            get obj()           { return this._obj }
            set camelCaseObj(v) { this._camelCaseObj = v }
            get camelCaseObj()  { return this._camelCaseObj }
        })
    }

    if (!customElements.get('ce-with-event')) {
        customElements.define('ce-with-event', class extends HTMLElement {
            constructor() {
                super()
                this.addEventListener('click', this.onClick)
            }
            onClick() {
                this.dispatchEvent(new CustomEvent('lowercaseevent'))
                this.dispatchEvent(new CustomEvent('kebab-event'))
                this.dispatchEvent(new CustomEvent('camelEvent'))
                this.dispatchEvent(new CustomEvent('CAPSevent'))
                this.dispatchEvent(new CustomEvent('PascalEvent'))
            }
        })
    }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Custom Elements Everywhere', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
        defineSharedElements()
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

    async function mount(html) {
        testContainer.innerHTML = html
        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()
    }

    function expectHasChildren(wc) {
        expect(wc).toBeTruthy()
        const shadowRoot = wc.shadowRoot
        const heading = shadowRoot.querySelector('h1')
        expect(heading).toBeTruthy()
        expect(heading.textContent).toBe('Test h1')
        const paragraph = shadowRoot.querySelector('p')
        expect(paragraph).toBeTruthy()
        expect(paragraph.textContent).toBe('Test p')
    }

    // ================================================================
    // BASIC SUPPORT
    // ================================================================

    describe('basic support', () => {

        describe('no children', () => {
            it('can display a Custom Element with no children', async () => {
                wildflower.component('cee-no-children', { state: {} })
                await mount(`
                    <div data-component="cee-no-children">
                        <ce-without-children id="wc"></ce-without-children>
                    </div>
                `)
                expect(testContainer.querySelector('#wc')).toBeTruthy()
            })
        })

        describe('with children', () => {
            it('can display a Custom Element with children in a Shadow Root', async () => {
                wildflower.component('cee-with-children', { state: {} })
                await mount(`
                    <div data-component="cee-with-children">
                        <ce-with-children id="wc"></ce-with-children>
                    </div>
                `)
                expectHasChildren(testContainer.querySelector('#wc'))
            })

            it('can display a Custom Element with children in a Shadow Root and pass in Light DOM children', async () => {
                wildflower.component('cee-rerender', {
                    state: { count: 1 },
                    init() { this.state.count += 1 }
                })
                await mount(`
                    <div data-component="cee-rerender">
                        <ce-with-children id="wc"><span data-bind="count"></span></ce-with-children>
                    </div>
                `)
                const wc = testContainer.querySelector('#wc')
                expectHasChildren(wc)
                expect(wc.textContent).toContain('2')
            })

            it('can handle hiding and showing a Custom Element', async () => {
                wildflower.component('cee-toggle', {
                    state: { showWC: true },
                    toggle() { this.state.showWC = !this.state.showWC }
                })
                await mount(`
                    <div data-component="cee-toggle">
                        <div id="toggler" data-action="toggle"></div>
                        <ce-with-children id="wc" data-render="showWC"></ce-with-children>
                        <div id="dummy" data-render="!showWC">Dummy view</div>
                    </div>
                `)
                let wc = testContainer.querySelector('#wc')
                expectHasChildren(wc)

                // Toggle: hide CE, show dummy
                testContainer.querySelector('#toggler').click()
                await waitForCompleteRender()
                const dummy = testContainer.querySelector('#dummy')
                expect(dummy).toBeTruthy()
                expect(dummy.textContent).toBe('Dummy view')

                // Toggle back: show CE again
                testContainer.querySelector('#toggler').click()
                await waitForCompleteRender()
                wc = testContainer.querySelector('#wc')
                expectHasChildren(wc)
            })
        })

        describe('attributes and properties', () => {
            it('will pass boolean data as either an attribute or a property', async () => {
                wildflower.component('cee-props-bool', {
                    state: { bool: true, num: 42, str: 'WildflowerJS' }
                })
                await mount(`
                    <div data-component="cee-props-bool">
                        <ce-with-properties id="wc"
                            data-bind-attr="{ bool: bool, num: num, str: str }">
                        </ce-with-properties>
                    </div>
                `)
                const wc = testContainer.querySelector('#wc')
                const data = wc.bool || wc.hasAttribute('bool')
                expect(data).toBe(true)
            })

            it('will pass numeric data as either an attribute or a property', async () => {
                wildflower.component('cee-props-num', {
                    state: { bool: true, num: 42, str: 'WildflowerJS' }
                })
                await mount(`
                    <div data-component="cee-props-num">
                        <ce-with-properties id="wc"
                            data-bind-attr="{ bool: bool, num: num, str: str }">
                        </ce-with-properties>
                    </div>
                `)
                const wc = testContainer.querySelector('#wc')
                const data = wc.num || wc.getAttribute('num')
                expect(parseInt(data, 10)).toBe(42)
            })

            it('will pass string data as either an attribute or a property', async () => {
                wildflower.component('cee-props-str', {
                    state: { bool: true, num: 42, str: 'WildflowerJS' }
                })
                await mount(`
                    <div data-component="cee-props-str">
                        <ce-with-properties id="wc"
                            data-bind-attr="{ bool: bool, num: num, str: str }">
                        </ce-with-properties>
                    </div>
                `)
                const wc = testContainer.querySelector('#wc')
                const data = wc.str || wc.getAttribute('str')
                expect(data).toBe('WildflowerJS')
            })

            // Unregistered CE tests — <ce-unregistered> is intentionally never
            // defined via customElements.define(). Verifies the framework works
            // with custom elements that haven't been upgraded yet.

            it('will set boolean attributes on an unregistered Custom Element', async () => {
                wildflower.component('cee-unreg-bool', {
                    state: { bool: true, num: 42, str: 'WildflowerJS' }
                })
                await mount(`
                    <div data-component="cee-unreg-bool">
                        <ce-unregistered id="wc"
                            data-bind-attr="{ bool: bool, num: num, str: str }">
                        </ce-unregistered>
                    </div>
                `)
                expect(testContainer.querySelector('#wc').hasAttribute('bool')).toBe(true)
            })

            it('will set numeric attributes on an unregistered Custom Element', async () => {
                wildflower.component('cee-unreg-num', {
                    state: { bool: true, num: 42, str: 'WildflowerJS' }
                })
                await mount(`
                    <div data-component="cee-unreg-num">
                        <ce-unregistered id="wc"
                            data-bind-attr="{ bool: bool, num: num, str: str }">
                        </ce-unregistered>
                    </div>
                `)
                expect(testContainer.querySelector('#wc').getAttribute('num')).toBe('42')
            })

            it('will set string attributes on an unregistered Custom Element', async () => {
                wildflower.component('cee-unreg-str', {
                    state: { bool: true, num: 42, str: 'WildflowerJS' }
                })
                await mount(`
                    <div data-component="cee-unreg-str">
                        <ce-unregistered id="wc"
                            data-bind-attr="{ bool: bool, num: num, str: str }">
                        </ce-unregistered>
                    </div>
                `)
                expect(testContainer.querySelector('#wc').getAttribute('str')).toBe('WildflowerJS')
            })

            it('will set array properties on an unregistered Custom Element', async () => {
                wildflower.component('cee-unreg-arr', {
                    state: { arr: ['W', 'f', 'J', 'S'] },
                    init() {
                        const wc = this.$el('#wc')?.el
                        if (wc) { wc.arr = [...this.state.arr] }
                    }
                })
                await mount(`
                    <div data-component="cee-unreg-arr">
                        <ce-unregistered id="wc"></ce-unregistered>
                    </div>
                `)
                expect(testContainer.querySelector('#wc').arr).toEqual(['W', 'f', 'J', 'S'])
            })

            it('will set object properties on an unregistered Custom Element', async () => {
                wildflower.component('cee-unreg-obj', {
                    state: { obj: { org: 'wildflowerjs', repo: 'wildflower' } },
                    init() {
                        const wc = this.$el('#wc')?.el
                        if (wc) { wc.obj = JSON.parse(JSON.stringify(this.state.obj)) }
                    }
                })
                await mount(`
                    <div data-component="cee-unreg-obj">
                        <ce-unregistered id="wc"></ce-unregistered>
                    </div>
                `)
                expect(testContainer.querySelector('#wc').obj).toEqual({ org: 'wildflowerjs', repo: 'wildflower' })
            })
        })

        describe('events', () => {
            it('can imperatively listen to a DOM event dispatched by a Custom Element', async () => {
                wildflower.component('cee-event-imperative', {
                    state: { eventHandled: false },
                    init() {
                        const wc = this.$el('#wc')?.el
                        if (wc) {
                            wc.addEventListener('camelEvent', () => {
                                this.state.eventHandled = true
                            })
                        }
                    }
                })
                await mount(`
                    <div data-component="cee-event-imperative">
                        <div id="handled" data-bind="eventHandled"></div>
                        <ce-with-event id="wc"></ce-with-event>
                    </div>
                `)
                expect(testContainer.querySelector('#handled').textContent).toBe('false')
                testContainer.querySelector('#wc').click()
                await waitForCompleteRender()
                expect(testContainer.querySelector('#handled').textContent).toBe('true')
            })
        })
    })

    // ================================================================
    // ADVANCED SUPPORT
    // ================================================================

    describe('advanced support', () => {

        describe('attributes and properties', () => {
            it('will pass array data as a property', async () => {
                wildflower.component('cee-props-arr', {
                    state: {
                        arr: ['W', 'f', 'J', 'S'],
                        obj: { org: 'wildflowerjs', repo: 'wildflower' },
                        camelCaseObj: { label: 'passed' }
                    },
                    init() {
                        const wc = this.$el('#wc')?.el
                        if (wc) {
                            wc.arr = JSON.parse(JSON.stringify(this.state.arr))
                            wc.obj = JSON.parse(JSON.stringify(this.state.obj))
                            wc.camelCaseObj = JSON.parse(JSON.stringify(this.state.camelCaseObj))
                        }
                    }
                })
                await mount(`
                    <div data-component="cee-props-arr">
                        <ce-with-properties id="wc"></ce-with-properties>
                    </div>
                `)
                expect(testContainer.querySelector('#wc').arr).toEqual(['W', 'f', 'J', 'S'])
            })

            it('will pass object data as a property', async () => {
                wildflower.component('cee-props-obj', {
                    state: {
                        arr: ['W', 'f', 'J', 'S'],
                        obj: { org: 'wildflowerjs', repo: 'wildflower' },
                        camelCaseObj: { label: 'passed' }
                    },
                    init() {
                        const wc = this.$el('#wc')?.el
                        if (wc) {
                            wc.arr = JSON.parse(JSON.stringify(this.state.arr))
                            wc.obj = JSON.parse(JSON.stringify(this.state.obj))
                            wc.camelCaseObj = JSON.parse(JSON.stringify(this.state.camelCaseObj))
                        }
                    }
                })
                await mount(`
                    <div data-component="cee-props-obj">
                        <ce-with-properties id="wc"></ce-with-properties>
                    </div>
                `)
                expect(testContainer.querySelector('#wc').obj).toEqual({ org: 'wildflowerjs', repo: 'wildflower' })
            })

            it('will pass object data to a camelCase-named property', async () => {
                wildflower.component('cee-props-camel', {
                    state: {
                        arr: ['W', 'f', 'J', 'S'],
                        obj: { org: 'wildflowerjs', repo: 'wildflower' },
                        camelCaseObj: { label: 'passed' }
                    },
                    init() {
                        const wc = this.$el('#wc')?.el
                        if (wc) {
                            wc.arr = JSON.parse(JSON.stringify(this.state.arr))
                            wc.obj = JSON.parse(JSON.stringify(this.state.obj))
                            wc.camelCaseObj = JSON.parse(JSON.stringify(this.state.camelCaseObj))
                        }
                    }
                })
                await mount(`
                    <div data-component="cee-props-camel">
                        <ce-with-properties id="wc"></ce-with-properties>
                    </div>
                `)
                expect(testContainer.querySelector('#wc').camelCaseObj).toEqual({ label: 'passed' })
            })
        })

        describe('events', () => {
            it('can listen to a lowercase DOM event dispatched by a Custom Element', async () => {
                wildflower.component('cee-evt-lower', {
                    state: { handled: false },
                    init() {
                        const wc = this.$el('#wc')?.el
                        if (wc) wc.addEventListener('lowercaseevent', () => { this.state.handled = true })
                    }
                })
                await mount(`
                    <div data-component="cee-evt-lower">
                        <div id="result" data-bind="handled"></div>
                        <ce-with-event id="wc"></ce-with-event>
                    </div>
                `)
                expect(testContainer.querySelector('#result').textContent).toBe('false')
                testContainer.querySelector('#wc').click()
                await waitForCompleteRender()
                expect(testContainer.querySelector('#result').textContent).toBe('true')
            })

            it('can listen to a kebab-case DOM event dispatched by a Custom Element', async () => {
                wildflower.component('cee-evt-kebab', {
                    state: { handled: false },
                    init() {
                        const wc = this.$el('#wc')?.el
                        if (wc) wc.addEventListener('kebab-event', () => { this.state.handled = true })
                    }
                })
                await mount(`
                    <div data-component="cee-evt-kebab">
                        <div id="result" data-bind="handled"></div>
                        <ce-with-event id="wc"></ce-with-event>
                    </div>
                `)
                expect(testContainer.querySelector('#result').textContent).toBe('false')
                testContainer.querySelector('#wc').click()
                await waitForCompleteRender()
                expect(testContainer.querySelector('#result').textContent).toBe('true')
            })

            it('can listen to a camelCase DOM event dispatched by a Custom Element', async () => {
                wildflower.component('cee-evt-camel', {
                    state: { handled: false },
                    init() {
                        const wc = this.$el('#wc')?.el
                        if (wc) wc.addEventListener('camelEvent', () => { this.state.handled = true })
                    }
                })
                await mount(`
                    <div data-component="cee-evt-camel">
                        <div id="result" data-bind="handled"></div>
                        <ce-with-event id="wc"></ce-with-event>
                    </div>
                `)
                expect(testContainer.querySelector('#result').textContent).toBe('false')
                testContainer.querySelector('#wc').click()
                await waitForCompleteRender()
                expect(testContainer.querySelector('#result').textContent).toBe('true')
            })

            it('can listen to a CAPScase DOM event dispatched by a Custom Element', async () => {
                wildflower.component('cee-evt-caps', {
                    state: { handled: false },
                    init() {
                        const wc = this.$el('#wc')?.el
                        if (wc) wc.addEventListener('CAPSevent', () => { this.state.handled = true })
                    }
                })
                await mount(`
                    <div data-component="cee-evt-caps">
                        <div id="result" data-bind="handled"></div>
                        <ce-with-event id="wc"></ce-with-event>
                    </div>
                `)
                expect(testContainer.querySelector('#result').textContent).toBe('false')
                testContainer.querySelector('#wc').click()
                await waitForCompleteRender()
                expect(testContainer.querySelector('#result').textContent).toBe('true')
            })

            it('can listen to a PascalCase DOM event dispatched by a Custom Element', async () => {
                wildflower.component('cee-evt-pascal', {
                    state: { handled: false },
                    init() {
                        const wc = this.$el('#wc')?.el
                        if (wc) wc.addEventListener('PascalEvent', () => { this.state.handled = true })
                    }
                })
                await mount(`
                    <div data-component="cee-evt-pascal">
                        <div id="result" data-bind="handled"></div>
                        <ce-with-event id="wc"></ce-with-event>
                    </div>
                `)
                expect(testContainer.querySelector('#result').textContent).toBe('false')
                testContainer.querySelector('#wc').click()
                await waitForCompleteRender()
                expect(testContainer.querySelector('#result').textContent).toBe('true')
            })
        })
    })
})
