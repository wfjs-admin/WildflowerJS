/**
 * @vitest-environment browser
 *
 * Security tests for data-bind-attr in the effect-based code path.
 * Verifies that the attribute blocklist and sanitization are applied
 * consistently between the list path and the component/effect path.
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

describe('Security: data-bind-attr effect path', () => {
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

    it('should block onclick attribute via data-bind-attr', async () => {
        wildflower.component('attr-xss-test-1', {
            state: {
                attrs: { onclick: 'alert(1)', title: 'safe' }
            }
        })

        const instance = await setupComponent(wildflower, testContainer, `
            <div data-component="attr-xss-test-1">
                <span data-bind-attr="attrs" id="target"></span>
            </div>
        `)

        await waitForUpdate(200)
        const el = document.getElementById('target')
        // onclick should be blocked, title should be set
        expect(el.hasAttribute('onclick')).toBe(false)
        expect(el.getAttribute('title')).toBe('safe')
    })

    it('should block onerror attribute via data-bind-attr', async () => {
        wildflower.component('attr-xss-test-2', {
            state: {
                attrs: { onerror: 'alert(1)' }
            }
        })

        const instance = await setupComponent(wildflower, testContainer, `
            <div data-component="attr-xss-test-2">
                <img data-bind-attr="attrs" id="target">
            </div>
        `)

        await waitForUpdate(200)
        const el = document.getElementById('target')
        expect(el.hasAttribute('onerror')).toBe(false)
    })

    it('should sanitize javascript: URL in href via data-bind-attr', async () => {
        wildflower.component('attr-xss-test-3', {
            state: {
                attrs: { href: 'javascript:alert(1)' }
            }
        })

        const instance = await setupComponent(wildflower, testContainer, `
            <div data-component="attr-xss-test-3">
                <a data-bind-attr="attrs" id="target">link</a>
            </div>
        `)

        await waitForUpdate(200)
        const el = document.getElementById('target')
        const href = el.getAttribute('href')
        // Should either be blocked entirely or sanitized
        expect(href === null || !href.toLowerCase().includes('javascript:')).toBe(true)
    })

    it('should block framework directive attributes via data-bind-attr', async () => {
        wildflower.component('attr-xss-test-4', {
            state: {
                attrs: { 'data-action': 'malicious', 'data-bind': 'malicious', 'aria-label': 'safe' }
            }
        })

        const instance = await setupComponent(wildflower, testContainer, `
            <div data-component="attr-xss-test-4">
                <span data-bind-attr="attrs" id="target"></span>
            </div>
        `)

        await waitForUpdate(200)
        const el = document.getElementById('target')
        expect(el.hasAttribute('data-action')).toBe(false)
        expect(el.hasAttribute('data-bind')).toBe(false)
        expect(el.getAttribute('aria-label')).toBe('safe')
    })
})
