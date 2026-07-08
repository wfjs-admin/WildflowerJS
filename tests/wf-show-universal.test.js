/**
 * Universal wf-show class contract
 *
 * data-show toggles display AND a `.wf-show` class so the documented anti-FOUC CSS
 * contract — [data-show]:not(.wf-show) { display: none } — works on every path.
 * Previously the class was added only on the context path, so data-show inside a
 * list row silently lacked it. This guards the convergence (BindingWriters.applyShow):
 * visible => has .wf-show + display:'' ; hidden => no .wf-show + display:'none'.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Universal wf-show class contract', () => {
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

    it('adds .wf-show to visible data-show elements inside list rows (and omits it when hidden)', async () => {
        wildflower.component('wf-show-list', {
            state: {
                items: [
                    { name: 'A', on: true },
                    { name: 'B', on: false },
                    { name: 'C', on: true }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="wf-show-list">
                <div data-list="items">
                    <template>
                        <div class="row">
                            <span class="badge" data-show="on">ON</span>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const badges = testContainer.querySelectorAll('.badge')
        expect(badges.length).toBe(3)

        // Visible rows: display shown AND .wf-show present (anti-FOUC contract holds)
        expect(badges[0].style.display).toBe('')
        expect(badges[0].classList.contains('wf-show')).toBe(true)

        // Hidden row: display none AND .wf-show absent
        expect(badges[1].style.display).toBe('none')
        expect(badges[1].classList.contains('wf-show')).toBe(false)

        expect(badges[2].style.display).toBe('')
        expect(badges[2].classList.contains('wf-show')).toBe(true)
    })
})
