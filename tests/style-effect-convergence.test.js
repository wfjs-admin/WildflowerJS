/**
 * data-bind-style !important + prev-clear convergence (applyStyleObj)
 *
 * The initial-render path (_applyObjectBinding) always handled !important and
 * stale-key clearing, but the EFFECT-UPDATE path (_executeStyleBindForEffect)
 * did neither — so a component whose style binding re-evaluated silently lost
 * !important priority and left dropped keys' inline styles behind. Both paths
 * now route through BindingWriters.applyStyleObj. This guards the update path.
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

describe('data-bind-style !important + prev-clear on effect updates', () => {
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
        testContainer = null
    })

    it('preserves !important when a component style binding re-evaluates', async () => {
        wildflower.component('style-imp-update', {
            state: { box: { color: 'red !important' } }
        })

        const instance = await setupComponent(wildflower, testContainer, `
            <div data-component="style-imp-update">
                <div class="target" data-bind-style="box"></div>
            </div>
        `)
        await waitForUpdate(120)

        const el = testContainer.querySelector('.target')
        // initial render (already worked)
        expect(el.style.getPropertyValue('color')).toBe('red')
        expect(el.style.getPropertyPriority('color')).toBe('important')

        // UPDATE -> effect-path apply (_executeStyleBindForEffect). Pre-fix this
        // assigned el.style.color = 'green !important', which the browser rejects,
        // dropping the priority (and often the value).
        instance.state.box = { color: 'green !important' }
        await waitForUpdate(120)

        expect(el.style.getPropertyValue('color')).toBe('green')
        expect(el.style.getPropertyPriority('color')).toBe('important')
    })

    it('clears a dropped style key on a component style re-evaluation', async () => {
        wildflower.component('style-drop-update', {
            state: { box: { color: 'red', background: 'blue' } }
        })

        const instance = await setupComponent(wildflower, testContainer, `
            <div data-component="style-drop-update">
                <div class="target" data-bind-style="box"></div>
            </div>
        `)
        await waitForUpdate(120)

        const el = testContainer.querySelector('.target')
        expect(el.style.background).toBe('blue')

        // Drop the background key — effect-path apply must clear it (it never did)
        instance.state.box = { color: 'red' }
        await waitForUpdate(120)

        expect(el.style.color).toBe('red')
        expect(el.style.background).toBe('')
    })
})
