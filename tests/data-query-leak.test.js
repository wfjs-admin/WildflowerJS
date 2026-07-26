/**
 * data-query teardown retention tests (full tier only; rides __FEATURE_QUERY__).
 *
 * The observer set (controller.elements) holds strong references to bound
 * [data-query] elements and prunes them lazily: at each rung firing
 * (_queryLifecycleCheck) and at each new observation (observeElement's
 * prune-then-add). These tests pin the release behavior and the two
 * accepted retention windows (focus-only and rungless queries hold their
 * last subtree until the next prune opportunity).
 *
 * Heap-level measurement (forced GC + DOM counters across mount/unmount
 * cycles) lives in tmp/query-leak-run.cjs; this file covers the functional
 * layer that runs on every variant.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-leak-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query teardown retention', () => {
    let container
    let wildflower
    let realFetch
    let realWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        realWarn = console.warn
        console.warn = () => {}
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        delete wildflower._queryTeardownGraceMs
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mountList(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <ul data-query="${qname}">
                    <template><li class="row" data-bind="name"></li></template>
                </ul>
            </div>
        `
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    it('poll rung: element refs released at the next firing after subtree removal', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: async () => [{ id: 1, name: 'x' }], refresh: 0.1 })
        wildflower._queryTeardownGraceMs = 60000 // isolate pruning from teardown
        mountList(q, c)
        await settle(150)

        const controller = wildflower._queryControllers.get(q)
        expect(controller.elements.size).toBe(1)

        const ul = container.querySelector('[data-query]')
        ul.parentNode.removeChild(ul)
        await settle(250) // at least one rung firing

        // Pruned at the firing; the query is still active (grace not expired)
        expect(controller.elements.size).toBe(0)
        expect(controller.active).toBe(true)
    })

    it('focus rung: holds the detached subtree until the next focus, then releases', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: async () => [{ id: 1, name: 'x' }], refresh: 'focus' })
        wildflower._queryTeardownGraceMs = 60000
        mountList(q, c)
        await settle(120)

        const controller = wildflower._queryControllers.get(q)
        const ul = container.querySelector('[data-query]')
        ul.parentNode.removeChild(ul)
        await settle(120)

        // Accepted design cost: no rung has fired, so the strong ref is
        // still held. If this assertion ever fails, the retention window
        // was closed and the docs/review notes should be updated.
        expect(controller.elements.size).toBe(1)

        window.dispatchEvent(new Event('focus'))
        await settle(80)
        expect(controller.elements.size).toBe(0)
    })

    it('teardown releases every resource: timers, listeners, stream, abort, elements', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: async () => [{ id: 1, name: 'x' }], refresh: [0.1, 'focus', 'reconnect'] })
        wildflower._queryTeardownGraceMs = 150
        mountList(q, c)
        await settle(150)

        const controller = wildflower._queryControllers.get(q)
        expect(controller._listeners.length).toBeGreaterThan(0)

        container.innerHTML = ''
        await settle(600) // grace + at least two would-be ticks

        expect(controller.active).toBe(false)
        expect(controller.timerId).toBeNull()
        expect(controller.lifecycleTimerId).toBeNull()
        expect(controller.es).toBeNull()
        expect(controller.abort).toBeNull()
        expect(controller._listeners.length).toBe(0)
        expect(controller.elements.size).toBe(0)
    })

    it('rungless (once) query: stale element ref dropped at the next observation', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: async () => [{ id: 1, name: 'x' }] })
        mountList(q, c)
        await settle(120)

        const controller = wildflower._queryControllers.get(q)
        const oldUl = container.querySelector('[data-query]')
        expect(controller.elements.has(oldUl)).toBe(true)

        container.innerHTML = ''
        await settle(80)
        // No rungs, so nothing prunes yet: the last subtree is held.
        expect(controller.elements.has(oldUl)).toBe(true)

        // A fresh view for the same query prunes the dead ref on observation.
        const c2 = uname('c')
        mountList(q, c2)
        await settle(120)
        expect(controller.elements.has(oldUl)).toBe(false)
        expect(controller.elements.size).toBe(1)
    })

    it('mount/unmount churn: the observer set never accumulates', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: async () => [{ id: 1, name: 'x' }], refresh: 0.1 })
        wildflower._queryTeardownGraceMs = 60000
        wildflower.component(c, { state: {} })

        for (let i = 0; i < 10; i++) {
            container.innerHTML = `
                <div data-component="${c}">
                    <ul data-query="${q}">
                        <template><li class="row" data-bind="name"></li></template>
                    </ul>
                </div>
            `
            wildflower.scan(container)
            await settle(60)
            container.innerHTML = ''
        }
        await settle(250) // let a rung fire after the last removal

        const controller = wildflower._queryControllers.get(q)
        expect(controller.elements.size).toBe(0)
        expect(controller.active).toBe(true) // grace not expired; rungs alive
    })
})
