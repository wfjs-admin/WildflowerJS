/**
 * Store teardown lifecycle: destroy() and beforeDestroy() must fire when a
 * store is torn down (wildflower.unregister -> destroyComponent).
 *
 * Found 2026-07-25 via the docs "Store Lifecycle" demo (advanced-stores): the
 * page claims stores support lifecycle "for initialization and cleanup", and
 * its data-service store clears its intervals in destroy() — but no store
 * destroy() has ever fired. Components attach EVERY definition function to the
 * context (_bindMethods), so destroyComponent's `instance.context.destroy`
 * check finds theirs; stores bind methods via _bindEntityMethods, which
 * EXCLUDES lifecycle names, and nothing else attaches the teardown pair. The
 * hooks are silently dropped at registration, so every store teardown skips
 * user cleanup — the docs demo leaks its sync/monitor/scheduler intervals as
 * zombies on every page visit.
 *
 * The component-side control test pins the asymmetry: if IT ever fails, the
 * teardown channel itself changed and the store assertions prove nothing.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 60) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Store destroy lifecycle', () => {
    let wildflower
    let testContainer

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
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

    it('fires destroy() when the store is unregistered', async () => {
        const calls = []
        wildflower.store('sdl-basic', {
            state: { n: 1 },
            init() { calls.push('init') },
            destroy() { calls.push('destroy') }
        })
        await waitForUpdate()
        expect(calls).toContain('init') // channel calibration: init DOES fire

        wildflower.unregister('sdl-basic')
        await waitForUpdate()

        expect(calls).toContain('destroy')
    })

    it('fires beforeDestroy() before destroy(), in order', async () => {
        const calls = []
        wildflower.store('sdl-order', {
            state: { n: 1 },
            beforeDestroy() { calls.push('beforeDestroy') },
            destroy() { calls.push('destroy') }
        })
        await waitForUpdate()

        wildflower.unregister('sdl-order')
        await waitForUpdate()

        expect(calls).toEqual(['beforeDestroy', 'destroy'])
    })

    it('destroy() can actually clean up — an interval started in init() stops ticking', async () => {
        let ticks = 0
        wildflower.store('sdl-interval', {
            state: { n: 0 },
            init() {
                this._timer = setInterval(() => { ticks++ }, 25)
            },
            destroy() {
                clearInterval(this._timer)
            }
        })
        await waitForUpdate(80) // let it tick a few times
        const ticksBeforeDestroy = ticks
        expect(ticksBeforeDestroy).toBeGreaterThan(0) // interval really ran

        wildflower.unregister('sdl-interval')
        await waitForUpdate(30) // absorb any in-flight tick
        const ticksAtDestroy = ticks
        await waitForUpdate(120)

        // Without a working destroy() the interval keeps ticking forever
        // (the docs-site zombie-timer leak). With it, the count freezes.
        expect(ticks).toBe(ticksAtDestroy)
    })

    it('destroy() sees store state and methods via this', async () => {
        let seen = null
        wildflower.store('sdl-this', {
            state: { label: 'alive' },
            helper() { return 'helped' },
            destroy() { seen = { label: this.label, helper: this.helper() } }
        })
        await waitForUpdate()

        wildflower.unregister('sdl-this')
        await waitForUpdate()

        expect(seen).toEqual({ label: 'alive', helper: 'helped' })
    })

    it('CONTROL: component destroy() fires on the same teardown path', async () => {
        const calls = []
        wildflower.component('sdl-comp-control', {
            state: { n: 1 },
            destroy() { calls.push('component-destroy') }
        })
        testContainer.innerHTML = '<div data-component="sdl-comp-control"></div>'
        await wildflower.scan(testContainer)
        await waitForUpdate()

        const el = testContainer.querySelector('[data-component-id]')
        expect(el).toBeTruthy()
        const id = el.dataset.componentId
        el.remove() // remove first: real teardown, no auto-resurrect warning
        wildflower.destroyComponent(id)
        await waitForUpdate()

        expect(calls).toEqual(['component-destroy'])
    })

    it('does not attach destroy as a callable ACTION surface (framework-driven only)', async () => {
        // destroy must fire on teardown, but must NOT become an ordinary bound
        // method that user code is encouraged to call like an action. We only
        // assert the framework path works AND a plain method named like a
        // helper still binds normally alongside the hooks.
        const calls = []
        wildflower.store('sdl-shape', {
            state: { n: 1 },
            doWork() { calls.push('work') },
            destroy() { calls.push('destroy') }
        })
        await waitForUpdate()

        const s = wildflower.getStore('sdl-shape')
        s.doWork()
        expect(calls).toEqual(['work'])

        wildflower.unregister('sdl-shape')
        await waitForUpdate()
        expect(calls).toEqual(['work', 'destroy'])
    })
})
