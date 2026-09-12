/**
 * tick() must register whether or not the component defines init().
 *
 * Regression (found 2026-09-11): at page load the
 * batched orchestrator queued only components WITH an init() for the deferred
 * init sequence, and tick registration lived inside that sequence. A component
 * with tick() and no init() therefore never ticked when the page loaded, while
 * the same component mounted dynamically (scan() / MutationObserver) ticked
 * fine. The docs' first pool example (pools.html, particle-demo) has exactly
 * the failing shape: pools + spawn() + tick(), no init().
 *
 * Runs on every tier that has the frame loop (pools feature), on all builds.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'
import { INIT_PATHS } from './helpers/init-paths.js'

const describeIfPools = hasFeature('pools') ? describe : describe.skip
const waitForFrames = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms))

describeIfPools('tick() registration without init()', () => {
    let container
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        wildflower = window.wildflower
        if (wildflower._tickableInstances) wildflower._tickableInstances.length = 0
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    describe.each(Object.entries(INIT_PATHS))('via %s path', (name, run) => {
        it('ticks a component that defines tick() and no init()', async () => {
            let ticks = 0
            wildflower.component('tick-no-init', {
                state: {},
                tick() { ticks++ }
            })
            container.innerHTML = '<div data-component="tick-no-init"></div>'

            run(wildflower)
            await waitForFrames()

            expect(ticks).toBeGreaterThanOrEqual(3)
        })

        it('ticks a pool component with tick() and no init(), spawned from an action', async () => {
            let ticks = 0
            wildflower.component('pool-no-init', {
                state: { n: 1 },
                pools: { dots: {} },
                spawn() { this.pools.dots.add({ id: this.n++, x: 0 }) },
                tick() {
                    ticks++
                    for (const d of this.pools.dots.items) d.x += 1
                }
            })
            container.innerHTML = `
                <div data-component="pool-no-init">
                    <button data-action="spawn">go</button>
                    <div data-pool="dots" data-key="id">
                        <template><i data-bind-style="{ left: x + 'px' }"></i></template>
                    </div>
                </div>
            `

            run(wildflower)
            await waitForFrames(50)
            container.querySelector('button').click()
            await waitForFrames()

            expect(ticks).toBeGreaterThanOrEqual(3)
            const dot = container.querySelector('[data-pool] i')
            expect(dot).not.toBeNull()
            expect(parseFloat(dot.style.left)).toBeGreaterThan(0)
        })

        it('still ticks when init() is present (control)', async () => {
            let ticks = 0
            let initRan = false
            wildflower.component('tick-with-init', {
                state: {},
                init() { initRan = true },
                tick() { ticks++ }
            })
            container.innerHTML = '<div data-component="tick-with-init"></div>'

            run(wildflower)
            await waitForFrames()

            expect(initRan).toBe(true)
            expect(ticks).toBeGreaterThanOrEqual(3)
        })
    })
})
