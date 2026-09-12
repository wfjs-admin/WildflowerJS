/**
 * `subscribe:` must be honoured whether or not the component defines init().
 *
 * At page load the batched orchestrator queues only components WITH an init()
 * for the deferred init sequence, which is where the store wait lives (a
 * component with subscribe: ['cart'] holds until 'cart' is registered, up to
 * subscribeTimeout). This test checks that a component with subscribe: and NO
 * init() still gets its stores when the store is registered a macrotask later,
 * on both init paths, and that an action fired after that can read
 * this.stores.<name>. Written after the tick() gap in the same branch.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js'
import { INIT_PATHS } from './helpers/init-paths.js'

const macrotask = () => new Promise(resolve => setTimeout(resolve, 0))

describe('subscribe: without init()', () => {
    let container
    let wildflower

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        wildflower = window.wildflower
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    describe.each(Object.entries(INIT_PATHS))('via %s path', (name, run) => {
        it('a no-init component sees a store registered after the scan', async () => {
            let seen = null
            wildflower.component('late-reader', {
                state: {},
                subscribe: ['late-store'],
                read() { seen = this.stores && this.stores['late-store'] ? this.stores['late-store'].value : 'MISSING' }
            })
            container.innerHTML = `
                <div data-component="late-reader">
                    <button data-action="read">read</button>
                    <span data-bind="$late-store.value"></span>
                </div>
            `

            run(wildflower)
            await macrotask()                     // scan settles; the store is not there yet

            wildflower.store('late-store', { state: { value: 42 } })
            await macrotask()
            await waitForUpdate()

            container.querySelector('button').click()
            await waitForUpdate()

            expect(seen).toBe(42)
            expect(container.querySelector('span').textContent).toBe('42')
        })

        it('control: the same component with init() sees a store registered before the scan', async () => {
            // After document load a missing subscribed store fails fast (see the
            // 1.4.1 "late registration" entry), and the two orchestrators differ
            // on whether init() then waits; that divergence is tracked separately.
            // Here the store exists first, the ordinary case.
            let seen = null
            let initStores = 'not-run'
            wildflower.store('late-store-2', { state: { value: 7 } })
            wildflower.component('late-reader-init', {
                state: {},
                subscribe: ['late-store-2'],
                init() { initStores = this.stores && this.stores['late-store-2'] ? this.stores['late-store-2'].value : 'MISSING' },
                read() { seen = this.stores['late-store-2'].value }
            })
            container.innerHTML = `<div data-component="late-reader-init"><button data-action="read">read</button></div>`

            run(wildflower)
            await macrotask()
            await waitForUpdate()

            container.querySelector('button').click()
            await waitForUpdate()

            expect(initStores).toBe(7)
            expect(seen).toBe(7)
        })
    })
})
