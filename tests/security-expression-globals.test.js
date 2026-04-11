/**
 * @vitest-environment browser
 *
 * Security tests for expression evaluation global access.
 * Verifies that dangerous globals (window, document, etc.) are not
 * accessible from data-show/data-render/data-bind-class expressions.
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

describe('Security: expression evaluation global access', () => {
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

    it('should not allow window access in data-show expressions', async () => {
        // window should be shadowed/undefined, making this expression false
        wildflower.component('global-test-1', {
            state: { visible: true }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="global-test-1">
                <span id="target" data-show="typeof window !== 'undefined' && window.location">SHOULD BE HIDDEN</span>
            </div>
        `)

        await waitForUpdate(300)
        const el = document.getElementById('target')
        // If window is blocked, the expression evaluates to false (window is undefined)
        // and the element should be hidden
        expect(el.style.display).toBe('none')
    })

    it('should not allow document access in data-show expressions', async () => {
        wildflower.component('global-test-2', {
            state: { visible: true }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="global-test-2">
                <span id="target" data-show="typeof document !== 'undefined' && document.cookie !== undefined">SHOULD BE HIDDEN</span>
            </div>
        `)

        await waitForUpdate(300)
        const el = document.getElementById('target')
        expect(el.style.display).toBe('none')
    })

    it('should not allow fetch access in data-show expressions', async () => {
        wildflower.component('global-test-3', {
            state: { visible: true }
        })

        await setupComponent(wildflower, testContainer, `
            <div data-component="global-test-3">
                <span id="target" data-show="typeof fetch !== 'undefined'">SHOULD BE HIDDEN</span>
            </div>
        `)

        await waitForUpdate(300)
        const el = document.getElementById('target')
        expect(el.style.display).toBe('none')
    })
})
