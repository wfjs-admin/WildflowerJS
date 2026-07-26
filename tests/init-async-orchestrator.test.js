/**
 * Async page-load orchestrator (_scanForComponentsAsync) coverage
 *
 * The REAL page-load path is the async batched orchestrator (bootstrap ->
 * _scanForComponentsAsync, sprint-then-jog with cooperative yields), but the
 * whole suite historically drove only the incremental path and the SYNC
 * batched proxy (init-contract.dual.test.js — see its caveat). This file
 * drives the async orchestrator directly with enough components to push past
 * the 20 ms sprint budget, so the jog phase (wfYield budget-chunks) actually
 * executes. On the Playwright Chromium (129+) that exercises the
 * scheduler.yield path; scheduler-yield-fallback.test.js pins the setTimeout
 * fallback.
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

describe('Async page-load orchestrator', () => {
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

    it('initializes every component through the sprint+jog phases', async () => {
        let initCount = 0
        wildflower.component('async-scan-probe', {
            state: { items: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }], n: 7 },
            computed: {
                doubled() { return this.state.n * 2 }
            },
            init() { initCount++ }
        })

        const parts = []
        for (let i = 0; i < N_COMPONENTS; i++) {
            parts.push(`
                <div data-component="async-scan-probe">
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

        // Bindings and lists rendered on the first and last component — the
        // last is guaranteed jog-phase work with this component count.
        const components = testContainer.querySelectorAll('[data-component="async-scan-probe"]')
        expect(components.length).toBe(N_COMPONENTS)
        const first = components[0]
        const last = components[N_COMPONENTS - 1]
        for (const el of [first, last]) {
            expect(el.querySelector('.doubled').textContent).toBe('14')
            expect(el.querySelectorAll('.row').length).toBe(2)
            expect(el.querySelectorAll('.row')[1].textContent).toBe('b')
        }
    })

    it('components stay reactive after the jog-phase init', async () => {
        wildflower.component('async-scan-reactive', {
            state: { count: 0 },
            bump() { this.state.count++ }
        })

        const parts = []
        for (let i = 0; i < N_COMPONENTS; i++) {
            parts.push(`
                <div data-component="async-scan-reactive">
                    <span class="count" data-bind="count"></span>
                    <button class="bump" data-action="bump">+</button>
                </div>`)
        }
        testContainer.innerHTML = parts.join('')

        await wildflower._scanForComponentsAsync()
        await waitFor(() => {
            const spans = testContainer.querySelectorAll('.count')
            return spans.length === N_COMPONENTS && spans[N_COMPONENTS - 1].textContent === '0'
        })

        // Interact with a jog-phase component (the last one).
        const lastComp = testContainer.querySelectorAll('[data-component="async-scan-reactive"]')[N_COMPONENTS - 1]
        lastComp.querySelector('.bump').click()
        await waitFor(() => lastComp.querySelector('.count').textContent === '1')
        expect(lastComp.querySelector('.count').textContent).toBe('1')
    })
})
