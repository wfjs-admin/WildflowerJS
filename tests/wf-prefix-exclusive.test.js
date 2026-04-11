/**
 * WildflowerJS Exclusive data-wf-prefix Mode Test Suite
 *
 * Tests for the exclusive prefix mode where WildflowerJS ONLY processes
 * data-wf-* attributes and ignores standard data-* attributes.
 * This allows third-party libraries to use data-action, data-bind, etc.
 * without conflict.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Exclusive data-wf-prefix Mode', () => {
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

        // Ensure exclusive mode is OFF by default for each test
        if (wildflower.options) {
            wildflower.options.useWfPrefixOnly = false
        }
    })

    afterEach(() => {
        // Reset to default mode after each test
        if (wildflower.options) {
            wildflower.options.useWfPrefixOnly = false
        }

        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    describe('Configuration', () => {
        it('options.useWfPrefixOnly defaults to false', () => {
            expect(wildflower.options.useWfPrefixOnly).toBe(false)
        })

        it('setWfPrefixMode(true) enables exclusive mode', () => {
            wildflower.setWfPrefixMode(true)
            expect(wildflower.options.useWfPrefixOnly).toBe(true)
        })

        it('setWfPrefixMode(false) returns to dual mode', () => {
            wildflower.setWfPrefixMode(true)
            expect(wildflower.options.useWfPrefixOnly).toBe(true)

            wildflower.setWfPrefixMode(false)
            expect(wildflower.options.useWfPrefixOnly).toBe(false)
        })
    })

    describe('Helper Methods in Exclusive Mode', () => {
        it.skipIf(isMinifiedBuild())('_getAttr returns null for data-* when exclusive mode enabled', () => {
            const el = document.createElement('div')
            el.setAttribute('data-bind', 'message')

            // Default mode: should find data-bind
            expect(wildflower._getAttr(el, 'bind')).toBe('message')

            // Exclusive mode: should NOT find data-bind
            wildflower.setWfPrefixMode(true)
            expect(wildflower._getAttr(el, 'bind')).toBeNull()
        })

        it.skipIf(isMinifiedBuild())('_getAttr returns value for data-wf-* when exclusive mode enabled', () => {
            const el = document.createElement('div')
            el.setAttribute('data-wf-bind', 'message')

            wildflower.setWfPrefixMode(true)
            expect(wildflower._getAttr(el, 'bind')).toBe('message')
        })

        it.skipIf(isMinifiedBuild())('_hasAttr returns false for data-* when exclusive mode enabled', () => {
            const el = document.createElement('div')
            el.setAttribute('data-action', 'click')

            // Default mode: should find data-action
            expect(wildflower._hasAttr(el, 'action')).toBe(true)

            // Exclusive mode: should NOT find data-action
            wildflower.setWfPrefixMode(true)
            expect(wildflower._hasAttr(el, 'action')).toBe(false)
        })

        it.skipIf(isMinifiedBuild())('_hasAttr returns true for data-wf-* when exclusive mode enabled', () => {
            const el = document.createElement('div')
            el.setAttribute('data-wf-action', 'click')

            wildflower.setWfPrefixMode(true)
            expect(wildflower._hasAttr(el, 'action')).toBe(true)
        })

        it.skipIf(isMinifiedBuild())('_attrSelector only includes data-wf-* when exclusive mode enabled', () => {
            // Default mode: selector includes both
            const defaultSelector = wildflower._attrSelector('bind')
            expect(defaultSelector).toContain('[data-bind]')
            expect(defaultSelector).toContain('[data-wf-bind]')

            // Exclusive mode: selector only includes data-wf-*
            wildflower.setWfPrefixMode(true)
            const exclusiveSelector = wildflower._attrSelector('bind')
            expect(exclusiveSelector).toBe('[data-wf-bind]')
            expect(exclusiveSelector).not.toContain('[data-bind],')
        })

        it.skipIf(isMinifiedBuild())('_attrSelector with value only includes data-wf-* when exclusive', () => {
            wildflower.setWfPrefixMode(true)
            const selector = wildflower._attrSelector('component', 'my-app')
            expect(selector).toBe('[data-wf-component="my-app"]')
        })
    })

    describe('Exclusive Mode Ignores Standard Attributes', () => {
        it('ignores data-bind when exclusive mode enabled', async () => {
            wildflower.setWfPrefixMode(true)

            wildflower.component('exclusive-bind-test', {
                state: { message: 'Hello World' }
            })

            testContainer.innerHTML = `
                <div data-wf-component="exclusive-bind-test">
                    <span id="standard-bind" data-bind="message">original</span>
                    <span id="wf-bind" data-wf-bind="message">original</span>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            const standardBind = document.getElementById('standard-bind')
            const wfBind = document.getElementById('wf-bind')

            // Standard data-bind should NOT be processed
            expect(standardBind.textContent).toBe('original')
            // data-wf-bind should be processed
            expect(wfBind.textContent).toBe('Hello World')
        })

        it('ignores data-action when exclusive mode enabled', async () => {
            wildflower.setWfPrefixMode(true)

            let standardClicked = false
            let wfClicked = false

            wildflower.component('exclusive-action-test', {
                state: {},
                standardClick() { standardClicked = true },
                wfClick() { wfClicked = true }
            })

            testContainer.innerHTML = `
                <div data-wf-component="exclusive-action-test">
                    <button id="standard-action" data-action="standardClick">Standard</button>
                    <button id="wf-action" data-wf-action="wfClick">WF</button>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            // Click both buttons
            document.getElementById('standard-action').click()
            document.getElementById('wf-action').click()
            await waitForUpdate(50)

            // Standard data-action should NOT trigger
            expect(standardClicked).toBe(false)
            // data-wf-action should trigger
            expect(wfClicked).toBe(true)
        })

        it('ignores data-show when exclusive mode enabled', async () => {
            wildflower.setWfPrefixMode(true)

            wildflower.component('exclusive-show-test', {
                state: { visible: false }
            })

            testContainer.innerHTML = `
                <div data-wf-component="exclusive-show-test">
                    <div id="standard-show" data-show="visible">Standard</div>
                    <div id="wf-show" data-wf-show="visible">WF</div>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            const standardShow = document.getElementById('standard-show')
            const wfShow = document.getElementById('wf-show')

            // Standard data-show should NOT be hidden (not processed)
            expect(standardShow.style.display).not.toBe('none')
            // data-wf-show should be hidden
            expect(wfShow.style.display).toBe('none')
        })

        it('ignores data-model when exclusive mode enabled', async () => {
            wildflower.setWfPrefixMode(true)

            wildflower.component('exclusive-model-test', {
                state: { name: 'initial' }
            })

            testContainer.innerHTML = `
                <div data-wf-component="exclusive-model-test">
                    <input id="standard-model" data-model="name" value="standard">
                    <input id="wf-model" data-wf-model="name" value="wf">
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            const standardModel = document.getElementById('standard-model')
            const wfModel = document.getElementById('wf-model')

            // Standard data-model should retain original value (not bound)
            expect(standardModel.value).toBe('standard')
            // data-wf-model should be bound to state
            expect(wfModel.value).toBe('initial')
        })

        it('ignores data-list when exclusive mode enabled', async () => {
            wildflower.setWfPrefixMode(true)

            wildflower.component('exclusive-list-test', {
                state: {
                    items: [{ name: 'A' }, { name: 'B' }]
                }
            })

            testContainer.innerHTML = `
                <div data-wf-component="exclusive-list-test">
                    <ul id="standard-list" data-list="items">
                        <template><li data-wf-bind="name"></li></template>
                    </ul>
                    <ul id="wf-list" data-wf-list="items">
                        <template><li data-wf-bind="name"></li></template>
                    </ul>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            const standardList = document.getElementById('standard-list')
            const wfList = document.getElementById('wf-list')

            // Standard data-list should NOT render items
            const standardItems = standardList.querySelectorAll('li')
            expect(standardItems.length).toBe(0)

            // data-wf-list should render items
            const wfItems = wfList.querySelectorAll('li')
            expect(wfItems.length).toBe(2)
        })

        it('ignores data-component when exclusive mode enabled', async () => {
            wildflower.setWfPrefixMode(true)

            wildflower.component('exclusive-component-test', {
                state: { initialized: true }
            })

            testContainer.innerHTML = `
                <div id="standard-component" data-component="exclusive-component-test"></div>
                <div id="wf-component" data-wf-component="exclusive-component-test"></div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            const standardComponent = document.getElementById('standard-component')
            const wfComponent = document.getElementById('wf-component')

            // Standard data-component should NOT have component ID
            expect(standardComponent.dataset.componentId).toBeUndefined()
            // data-wf-component should have component ID
            expect(wfComponent.dataset.componentId).toBeDefined()
        })
    })

    describe('Exclusive Mode Processes data-wf-* Attributes', () => {
        it('processes data-wf-bind correctly', async () => {
            wildflower.setWfPrefixMode(true)

            wildflower.component('wf-bind-test', {
                state: { count: 42 }
            })

            testContainer.innerHTML = `
                <div data-wf-component="wf-bind-test">
                    <span id="count" data-wf-bind="count"></span>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            expect(document.getElementById('count').textContent).toBe('42')
        })

        it('processes data-wf-action correctly', async () => {
            wildflower.setWfPrefixMode(true)

            let clicked = false
            wildflower.component('wf-action-test', {
                state: {},
                handleClick() { clicked = true }
            })

            testContainer.innerHTML = `
                <div data-wf-component="wf-action-test">
                    <button id="btn" data-wf-action="handleClick">Click</button>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            document.getElementById('btn').click()
            await waitForUpdate(50)

            expect(clicked).toBe(true)
        })

        it('processes data-wf-show correctly', async () => {
            wildflower.setWfPrefixMode(true)

            wildflower.component('wf-show-test', {
                state: { visible: true }
            })

            testContainer.innerHTML = `
                <div data-wf-component="wf-show-test">
                    <div id="shown" data-wf-show="visible">Visible</div>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            expect(document.getElementById('shown').style.display).not.toBe('none')
        })

        it('processes data-wf-list correctly', async () => {
            wildflower.setWfPrefixMode(true)

            wildflower.component('wf-list-test', {
                state: {
                    users: [{ name: 'Alice' }, { name: 'Bob' }]
                }
            })

            testContainer.innerHTML = `
                <div data-wf-component="wf-list-test">
                    <ul data-wf-list="users">
                        <template><li data-wf-bind="name"></li></template>
                    </ul>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('li')
            expect(items.length).toBe(2)
            expect(items[0].textContent).toBe('Alice')
            expect(items[1].textContent).toBe('Bob')
        })

        it('processes data-wf-model correctly', async () => {
            wildflower.setWfPrefixMode(true)

            wildflower.component('wf-model-test', {
                state: { email: 'test@example.com' }
            })

            testContainer.innerHTML = `
                <div data-wf-component="wf-model-test">
                    <input id="email" data-wf-model="email">
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            expect(document.getElementById('email').value).toBe('test@example.com')
        })

        it('processes data-wf-component correctly', async () => {
            wildflower.setWfPrefixMode(true)

            wildflower.component('wf-component-test', {
                state: { ready: true }
            })

            testContainer.innerHTML = `
                <div data-wf-component="wf-component-test" id="app"></div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            const app = document.getElementById('app')
            expect(app.dataset.componentId).toBeDefined()

            const instance = wildflower.componentInstances.get(app.dataset.componentId)
            expect(instance).toBeDefined()
            expect(instance.state.ready).toBe(true)
        })
    })

    describe('Third-Party Conflict Prevention', () => {
        it('allows data-action for third-party while using data-wf-action for framework', async () => {
            wildflower.setWfPrefixMode(true)

            let frameworkCalled = false
            wildflower.component('conflict-test', {
                state: {},
                frameworkMethod() { frameworkCalled = true }
            })

            // Simulate third-party library that uses data-action
            let thirdPartyCalled = false
            document.addEventListener('click', (e) => {
                if (e.target.dataset.action === 'thirdPartyMethod') {
                    thirdPartyCalled = true
                }
            }, { once: true })

            testContainer.innerHTML = `
                <div data-wf-component="conflict-test">
                    <button id="third-party" data-action="thirdPartyMethod">Third Party</button>
                    <button id="framework" data-wf-action="frameworkMethod">Framework</button>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            // Click third-party button
            document.getElementById('third-party').click()
            await waitForUpdate(50)

            // Third-party should work, framework should not interfere
            expect(thirdPartyCalled).toBe(true)
            expect(frameworkCalled).toBe(false)

            // Click framework button
            document.getElementById('framework').click()
            await waitForUpdate(50)

            expect(frameworkCalled).toBe(true)
        })

        it('does not call non-existent methods for third-party data-action', async () => {
            wildflower.setWfPrefixMode(true)

            let errorThrown = false
            const originalError = console.error
            console.error = () => { errorThrown = true }

            wildflower.component('no-error-test', {
                state: {}
                // Note: no 'bootstrapAction' method defined
            })

            testContainer.innerHTML = `
                <div data-wf-component="no-error-test">
                    <button id="bootstrap-btn" data-action="bootstrapAction">Bootstrap Button</button>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            // Click button with data-action (should be ignored by WildflowerJS)
            document.getElementById('bootstrap-btn').click()
            await waitForUpdate(50)

            console.error = originalError

            // No error should be thrown because WildflowerJS ignores data-action in exclusive mode
            expect(errorThrown).toBe(false)
        })
    })

    describe('Mixed Mode Behavior (Default)', () => {
        it('processes both data-* and data-wf-* in default mode', async () => {
            // Ensure we're in default mode
            wildflower.setWfPrefixMode(false)

            wildflower.component('mixed-mode-test', {
                state: { standard: 'Standard', wf: 'WF Prefix' }
            })

            testContainer.innerHTML = `
                <div data-component="mixed-mode-test">
                    <span id="standard" data-bind="standard"></span>
                    <span id="wf" data-wf-bind="wf"></span>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            // Both should be processed in default mode
            expect(document.getElementById('standard').textContent).toBe('Standard')
            expect(document.getElementById('wf').textContent).toBe('WF Prefix')
        })

        it('data-wf-* takes precedence when both exist on same element', async () => {
            wildflower.setWfPrefixMode(false)

            wildflower.component('precedence-test', {
                state: { value: 'state-value' }
            })

            testContainer.innerHTML = `
                <div data-component="precedence-test">
                    <span id="both" data-bind="nonexistent" data-wf-bind="value"></span>
                </div>
            `
            wildflower.scan()
            await waitForUpdate(100)

            // data-wf-bind should take precedence
            expect(document.getElementById('both').textContent).toBe('state-value')
        })
    })
})
