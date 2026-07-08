/**
 * Component-destroy effect sweep cleans up every effect on the component's
 * reactive surface — `instance._effects`, `instance.context._effects`,
 * AND every effect on `instance.stateManager._effects`.
 *
 * Regression history:
 *   - v1.0: only `instance._effects` was swept. Effects scoped to a
 *     context the component owned survived destroy.
 *   - v1.1: extended to `instance._effects` + `instance.context._effects`.
 *     But framework-internal effects scoped to the RSM's `component` stub
 *     (`{id, name}` set in ComponentLifecycle._createComponentStateManager,
 *     since the actual instance doesn't exist yet at RSM construction)
 *     still survived. The mapArray structural effect and per-item list
 *     effects fall into this category — they'd keep firing against
 *     external store mutations after the owning component was destroyed.
 *   - now: sweep also walks the RSM's `_effects` set, which contains
 *     every effect created on this RSM regardless of scope object.
 *     `_disposeEffect` is idempotent, so the redundancy is safe.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Effect cleanup on component destroy', () => {
    let testContainer
    let cleanup

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    it('disposes every effect on the component (instance/context/RSM scopes) on destroy', async () => {
        wildflower.component('cleanup-test', {
            state: {
                rows: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }],
                tick: 0
            },
            computed: {
                sum() { return this.state.rows.reduce(function (s, r) { return s + r.n }, 0) }
            },
            init() {
                // User-created effect via createEffect with explicit scope.
                // Lives on instance.context._effects.
                this.stateManager.createEffect(() => {
                    const _ = this.state.tick
                }, { scope: this })
            }
        })

        testContainer.innerHTML = `
            <div data-component="cleanup-test">
                <span class="sum" data-bind="sum"></span>
                <ul data-list="rows" data-key="id">
                    <template><li data-bind="n"></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        const compEl = testContainer.querySelector('[data-component-id]')
        const compId = compEl.dataset.componentId
        const inst = wildflower.componentInstances.get(compId)
        expect(inst).toBeDefined()

        // Snapshot every effect across all three places they can live.
        const snapshot = new Set()
        if (inst._effects) for (const e of inst._effects) snapshot.add(e)
        if (inst.context && inst.context._effects) {
            for (const e of inst.context._effects) snapshot.add(e)
        }
        if (inst.stateManager && inst.stateManager._effects) {
            for (const e of inst.stateManager._effects) snapshot.add(e)
        }

        // Sanity: we should be capturing both instance-scoped framework
        // effects (_renderEffect) AND RSM-internal effects (the mapArray
        // structural effect). Per-row effects no longer exist (P4-S6: rows
        // update through the per-list dispatcher), so the floor is
        // structural + user effect + render effect → at least 3.
        expect(snapshot.size).toBeGreaterThan(2)

        // Detach + destroy.
        compEl.remove()
        wildflower.destroyComponent(compId)

        // Every previously-live effect must be disposed. No exceptions.
        const stillLive = Array.from(snapshot).filter(e => !e.disposed)
        expect(stillLive).toEqual([])

        expect(wildflower.componentInstances.has(compId)).toBe(false)
    })
})
