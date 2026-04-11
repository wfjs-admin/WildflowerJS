/**
 * @vitest-environment browser
 *
 * Tests for computed property error recovery
 * Verifies 3 bugs found in ComputedPropertyManager.js:
 * - Bug #1: activeComputation not restored when stable computed throws
 * - Bug #2: ERRORED computeds with no tracked deps stuck permanently
 * - Bug #3: DOM not notified when computed enters ERRORED state
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function setupComponent(wildflower, testContainer, html) {
    testContainer.innerHTML = html
    wildflower.scan()
    await waitForUpdate()
    const componentEl = testContainer.querySelector('[data-component]')
    const componentId = componentEl?.dataset?.componentId
    return componentId ? wildflower.componentInstances.get(componentId) : null
}

describe('Computed Property Error Recovery', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower

        if (wildflower.componentDefinitions) {
            wildflower.componentDefinitions.clear()
        }
        if (wildflower.componentInstances) {
            wildflower.componentInstances.clear()
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

    it('recovers ERRORED computed with no tracked deps when dependency changes', async () => {
        // Bug #2: ERRORED computeds with no tracked deps returned undefined forever
        let shouldThrow = true

        wildflower.component('err-nodep-recover', {
            state: {
                trigger: 0
            },
            computed: {
                risky() {
                    const t = this.state.trigger
                    if (shouldThrow && t === 0) {
                        throw new Error('intentional error')
                    }
                    return 'recovered-' + t
                }
            }
        })

        const instance = await setupComponent(wildflower, testContainer, `
            <div data-component="err-nodep-recover">
                <span data-bind="risky"></span>
                <span data-bind="trigger"></span>
            </div>
        `)

        await waitForUpdate(200)

        // Now stop throwing and change state to trigger re-evaluation
        shouldThrow = false
        instance.context.state.trigger = 1

        await waitForUpdate(300)
        const display = testContainer.querySelector('[data-bind="risky"]')
        expect(display.textContent).toBe('recovered-1')
    })

    it('notifies DOM when computed transitions from valid to ERRORED', async () => {
        // Bug #3: onStateChange not called when entering ERRORED, leaving stale DOM
        wildflower.component('err-dom-notify', {
            state: {
                mode: 'good'
            },
            computed: {
                derived() {
                    if (this.state.mode === 'bad') {
                        throw new Error('intentional error')
                    }
                    return 'value-' + this.state.mode
                }
            }
        })

        const instance = await setupComponent(wildflower, testContainer, `
            <div data-component="err-dom-notify">
                <span data-bind="derived"></span>
            </div>
        `)

        await waitForUpdate(200)
        const display = testContainer.querySelector('[data-bind="derived"]')
        expect(display.textContent).toBe('value-good')

        // Trigger the error — DOM should NOT still show stale 'value-good'
        instance.context.state.mode = 'bad'
        await waitForUpdate(300)
        expect(display.textContent).not.toBe('value-good')
    })

    it('does not corrupt sibling computed deps when stable computed throws', async () => {
        // Bug #1: _updateNode didn't restore activeComputation on throw,
        // corrupting dependency tracking for sibling computeds
        let throwOnce = false

        wildflower.component('err-sibling-deps', {
            state: {
                base: 10,
                multiplier: 2
            },
            computed: {
                fragile() {
                    const b = this.state.base
                    if (throwOnce) {
                        throwOnce = false
                        throw new Error('one-time error')
                    }
                    return b * 100
                },
                sibling() {
                    return this.state.multiplier * 3
                }
            }
        })

        const instance = await setupComponent(wildflower, testContainer, `
            <div data-component="err-sibling-deps">
                <span data-bind="fragile"></span>
                <span data-bind="sibling"></span>
            </div>
        `)

        await waitForUpdate(200)
        const fragileEl = testContainer.querySelector('[data-bind="fragile"]')
        const siblingEl = testContainer.querySelector('[data-bind="sibling"]')

        expect(fragileEl.textContent).toBe('1000')
        expect(siblingEl.textContent).toBe('6')

        // Trigger one-time throw in fragile, then update sibling's dep
        throwOnce = true
        instance.context.state.base = 20
        instance.context.state.multiplier = 5

        await waitForUpdate(400)
        // Sibling should update correctly despite fragile throwing
        expect(siblingEl.textContent).toBe('15')

        // Fragile should recover (throwOnce was reset to false by the throw)
        instance.context.state.base = 30
        await waitForUpdate(300)
        expect(fragileEl.textContent).toBe('3000')
    })

    it('recovers computed after error is fixed and dependency changes', async () => {
        // End-to-end: computed errors, deps change, computed recovers
        let externalData = null

        wildflower.component('err-full-cycle', {
            state: {
                version: 1
            },
            computed: {
                result() {
                    const v = this.state.version
                    if (externalData === null) {
                        throw new Error('data not loaded')
                    }
                    return externalData + '-v' + v
                }
            }
        })

        const instance = await setupComponent(wildflower, testContainer, `
            <div data-component="err-full-cycle">
                <span data-bind="result"></span>
            </div>
        `)

        await waitForUpdate(200)
        const display = testContainer.querySelector('[data-bind="result"]')

        // Initially errored
        expect(display.textContent).not.toBe('data not loaded')

        // "Load" the data and bump version to trigger re-eval
        externalData = 'loaded'
        instance.context.state.version = 2
        await waitForUpdate(300)
        expect(display.textContent).toBe('loaded-v2')
    })
})
