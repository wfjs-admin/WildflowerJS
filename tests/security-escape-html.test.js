/**
 * @vitest-environment browser
 *
 * Security tests for _escapeHTML single quote escaping.
 * Verifies that single quotes are escaped to prevent attribute context breakout
 * in the innerHTML fast path for list rendering.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Security: _escapeHTML single quote escaping', () => {
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

    it('should escape single quotes in _escapeHTML', async () => {
        // Access _escapeHTML directly on the framework prototype
        const escaped = wildflower._escapeHTML("it's a test")
        expect(escaped).toContain('&#39;')
        expect(escaped).not.toContain("'")
    })

    it('should escape all dangerous characters together', async () => {
        const escaped = wildflower._escapeHTML(`<script>alert('xss' & "more")</script>`)
        expect(escaped).not.toContain('<')
        expect(escaped).not.toContain('>')
        expect(escaped).not.toContain("'")
        expect(escaped).not.toContain('"')
        expect(escaped).toContain('&lt;')
        expect(escaped).toContain('&gt;')
        expect(escaped).toContain('&#39;')
        expect(escaped).toContain('&quot;')
    })

    it('should render single quotes safely in list items', async () => {
        wildflower.component('escape-list-test', {
            state: {
                items: [
                    { name: "O'Brien" },
                    { name: "it's <dangerous>" }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="escape-list-test">
                <div data-list="items">
                    <template>
                        <div class="item"><span data-bind="name"></span></div>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForUpdate(300)

        const items = testContainer.querySelectorAll('.item')
        expect(items.length).toBe(2)
        // Content should be text, not interpreted as HTML
        expect(items[0].textContent).toContain("O'Brien")
        expect(items[1].textContent).toContain("it's <dangerous>")
    })
})
