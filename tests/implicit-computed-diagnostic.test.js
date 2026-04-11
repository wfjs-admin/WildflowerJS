/**
 * @vitest-environment browser
 * 
 * Diagnostic test to verify implicit computed detection
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Implicit Computed Diagnostic', () => {
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

    it('data-bind (text) - implicit computed INITIAL value', async () => {
        wildflower.component('text-implicit-test', {
            state: { value: 'A' },
            computed: {
                computedValue() { return 'COMPUTED-' + this.state.value }
            }
        })

        testContainer.innerHTML = `
            <div data-component="text-implicit-test">
                <span id="result" data-bind="computedValue"></span>
            </div>
        `
        await waitForUpdate()

        const result = testContainer.querySelector('#result')
        console.log('[TEXT] Initial textContent:', result.textContent)
        expect(result.textContent).toBe('COMPUTED-A')
    })

    it('data-bind-class - implicit computed INITIAL value', async () => {
        wildflower.component('class-implicit-test', {
            state: { size: 'normal' },
            computed: {
                sizeClass() {
                    return this.state.size === 'large' ? 'lg' : 'md'
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="class-implicit-test">
                <div id="box" data-bind-class="sizeClass">Box</div>
            </div>
        `
        await waitForUpdate()

        const box = testContainer.querySelector('#box')
        console.log('[CLASS] Initial classes:', box.className)
        expect(box.classList.contains('md')).toBe(true)
    })

    it('data-bind-style - implicit computed INITIAL value', async () => {
        wildflower.component('style-implicit-test', {
            state: { active: false },
            computed: {
                boxStyle() {
                    return { backgroundColor: this.state.active ? 'green' : 'red' }
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="style-implicit-test">
                <div id="box" data-bind-style="boxStyle">Box</div>
            </div>
        `
        await waitForUpdate()

        const box = testContainer.querySelector('#box')
        console.log('[STYLE] Initial backgroundColor:', box.style.backgroundColor)
        expect(box.style.backgroundColor).toBe('red')
    })

    it('data-bind-html - implicit computed INITIAL value', async () => {
        wildflower.component('html-implicit-test', {
            state: { format: 'bold' },
            computed: {
                content() {
                    return this.state.format === 'bold' ? '<b>Bold</b>' : 'Plain'
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="html-implicit-test">
                <div id="box" data-bind-html="content"></div>
            </div>
        `
        await waitForUpdate()

        const box = testContainer.querySelector('#box')
        console.log('[HTML] Initial innerHTML:', box.innerHTML)
        expect(box.innerHTML).toBe('<b>Bold</b>')
    })
})
