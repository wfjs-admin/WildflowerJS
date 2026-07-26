/**
 * Sealing-the-graph row 10: wildflower.whenSettled() as the ONE public
 * quiescence awaitable. The historical implementation drained the four async
 * layers (microtask, setTimeout(0), rAF, final microtask) exactly once, which
 * misses framework work that spans passes: a component whose init() injects
 * another component schedules a second scan + init window that a single pass
 * resolves straight past.
 *
 * The contract pinned here:
 *  - whenSettled() resolves only when framework-scheduled work has drained:
 *    pending effect flushes, scheduled renders, and open init windows,
 *    looping passes until a pass observes no new work (bounded pass cap, so
 *    the promise ALWAYS resolves).
 *  - The pool rAF loop is excluded by contract: pools write plain objects
 *    outside the reactive graph, so a running pool animation neither blocks
 *    settling nor counts as work. That boundary sentence IS the contract.
 *
 * Runs on ALL variants including min (public API, prod semantics matter).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe('whenSettled() quiescence contract (sealing row 10)', () => {
    let testContainer

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    it('spans the init window of a component injected during another init()', async () => {
        window.wildflower.component('ws-inner', { state: { label: 'inner-ready' } })
        window.wildflower.component('ws-outer', {
            state: { label: 'outer' },
            init() {
                this.element.insertAdjacentHTML('beforeend',
                    '<div data-component="ws-inner"><b data-bind="label"></b></div>')
            }
        })
        testContainer.innerHTML = '<div data-component="ws-outer"></div>'
        ensureComponentScanning(window.wildflower)

        await window.wildflower.whenSettled()

        const inner = testContainer.querySelector('b')
        expect(inner).toBeTruthy()
        expect(inner.textContent).toBe('inner-ready')
    })

    it.skipIf(!hasFeature('lists'))('spans list-mounted component rows appearing from a state write', async () => {
        window.wildflower.component('ws-row', { state: { tag: 'row-ready' } })
        window.wildflower.component('ws-list-host', {
            state: { rows: [] },
            fill() { this.state.rows = [{ id: 1 }, { id: 2 }, { id: 3 }] }
        })
        testContainer.innerHTML = `
            <div data-component="ws-list-host">
                <div data-list="rows" data-key="id">
                    <template><div><div data-component="ws-row"><i data-bind="tag"></i></div></div></template>
                </div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await window.wildflower.whenSettled()

        const host = testContainer.querySelector('[data-component="ws-list-host"]')
        const inst = window.wildflower.componentInstances.get(host.dataset.componentId)
        inst.context.fill()
        await window.wildflower.whenSettled()

        const tags = Array.from(testContainer.querySelectorAll('i')).map(el => el.textContent)
        expect(tags).toEqual(['row-ready', 'row-ready', 'row-ready'])
    })

    it('DOM is current after a state write once whenSettled resolves', async () => {
        window.wildflower.component('ws-write', {
            state: { label: 'before' }
        })
        testContainer.innerHTML = '<div data-component="ws-write"><span data-bind="label"></span></div>'
        ensureComponentScanning(window.wildflower)
        await window.wildflower.whenSettled()

        const el = testContainer.querySelector('[data-component="ws-write"]')
        const inst = window.wildflower.componentInstances.get(el.dataset.componentId)
        inst.context.state.label = 'after'
        await window.wildflower.whenSettled()

        expect(testContainer.querySelector('span').textContent).toBe('after')
    })

    it.skipIf(!hasFeature('pools'))('resolves promptly while a pool animation loop is running', async () => {
        window.wildflower.component('ws-pool', {
            state: {},
            pools: { dots: {} },
            init() {
                const p = this.getPool('dots')
                for (let i = 0; i < 10; i++) p.add({ id: i, x: 0, label: 'd' + i })
            },
            tick(dt) {
                // Mutate pool entities only: plain objects, outside the graph.
                // Null guard: the shared rAF loop can tick once more after a
                // test teardown clears the instance registry.
                const p = this.getPool('dots')
                if (p) p.forEach(d => { d.x += dt })
            }
        })
        testContainer.innerHTML = '<div data-component="ws-pool"><div data-pool="dots"><template><i data-bind="label"></i></template></div></div>'
        ensureComponentScanning(window.wildflower)

        const t0 = performance.now()
        await window.wildflower.whenSettled()
        const elapsed = performance.now() - t0

        // The pool loop is live, but settling must not wait on it.
        expect(testContainer.querySelectorAll('i').length).toBe(10)
        expect(elapsed).toBeLessThan(2000)
    })

    it('always resolves, even on a page doing continuous reactive writes (bounded passes)', async () => {
        window.wildflower.component('ws-churn', {
            state: { n: 0, label: 'x' }
        })
        testContainer.innerHTML = '<div data-component="ws-churn"><span data-bind="n"></span></div>'
        ensureComponentScanning(window.wildflower)
        await window.wildflower.whenSettled()

        const el = testContainer.querySelector('[data-component="ws-churn"]')
        const inst = window.wildflower.componentInstances.get(el.dataset.componentId)
        const churn = setInterval(() => { inst.context.state.n++ }, 10)
        try {
            const t0 = performance.now()
            await window.wildflower.whenSettled()
            expect(performance.now() - t0).toBeLessThan(5000)
        } finally {
            clearInterval(churn)
        }
    })
})
