/**
 * wfYield setTimeout-fallback parity (scheduler deleted pre-load)
 *
 * Removes the Prioritized Task Scheduling API BEFORE the framework bundle
 * loads, so wfYield's load-time detect (wfUtils) compiles the setTimeout
 * fallback in — the path Safari takes (no scheduler.yield/postTask through
 * Safari 27 / iOS 26.5, caniuse 2026-07). Asserts the async page-load
 * orchestrator's jog phase completes and initializes everything on that
 * path. Same per-file iframe-realm isolation argument as
 * movebefore-fallback.test.js.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const N_COMPONENTS = 240

async function waitFor(cond, timeout = 15000) {
    const start = performance.now()
    while (!cond()) {
        if (performance.now() - start > timeout) throw new Error('waitFor timeout')
        await new Promise(r => setTimeout(r, 25))
    }
}

describe('wfYield setTimeout fallback (no scheduler API)', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        // Must precede the bundle's load-time detect. delete alone can be
        // insufficient for platform interfaces; the undefined assignment makes
        // `typeof scheduler` report 'undefined' either way.
        try { delete window.scheduler } catch (e) { /* non-configurable */ }
        if (typeof window.scheduler !== 'undefined') window.scheduler = undefined
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

    it('sanity: the scheduler API is absent in this realm', () => {
        expect(typeof window.scheduler).toBe('undefined')
    })

    it('async orchestrator completes sprint+jog on the setTimeout path', async () => {
        let initCount = 0
        wildflower.component('yield-fallback-probe', {
            state: { items: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }], n: 7 },
            computed: {
                doubled() { return this.state.n * 2 }
            },
            init() { initCount++ }
        })

        const parts = []
        for (let i = 0; i < N_COMPONENTS; i++) {
            parts.push(`
                <div data-component="yield-fallback-probe">
                    <span class="doubled" data-bind="doubled"></span>
                    <ul data-list="items" data-key="id">
                        <template><li class="row" data-bind="label"></li></template>
                    </ul>
                </div>`)
        }
        testContainer.innerHTML = parts.join('')

        await wildflower._scanForComponentsAsync()
        await waitFor(() => initCount >= N_COMPONENTS)

        expect(initCount).toBe(N_COMPONENTS)
        const components = testContainer.querySelectorAll('[data-component="yield-fallback-probe"]')
        expect(components.length).toBe(N_COMPONENTS)
        const last = components[N_COMPONENTS - 1]
        expect(last.querySelector('.doubled').textContent).toBe('14')
        expect(last.querySelectorAll('.row').length).toBe(2)
    })
})
