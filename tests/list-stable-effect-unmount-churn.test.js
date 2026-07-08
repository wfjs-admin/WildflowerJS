/**
 * Mount/churn/unmount loop for a computed-dispatcher list (stable per-list
 * effect + rows/rawStamps maps). Pins that NOTHING from a destroyed list keeps
 * reacting: after K mount→churn→destroy cycles, a write to the shared store
 * field must evaluate ZERO stale item computeds. A retained stable effect (or
 * un-pruned appended edges) would re-run walks/applies against dead rows and
 * increment the counter — the leak that would silently eat the per-row heap
 * win under list-churn workloads.
 *
 * Byte-level heap bounds live in the krausest memory harness; this is the
 * behavioral retention pin. External review 2026-07-04, finding #6.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Stable per-list effect + dispatcher retention across mount/unmount churn', () => {
    let testContainer
    let cleanup

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => {
        if (cleanup) cleanup()
    })

    it('SEC-A. after K mount/churn/destroy cycles, a store write evaluates zero stale item computeds', async () => {
        const K = 4
        const N = 20
        window.__secEvals = 0

        wildflower.store('sec-src', {
            state: { items: Array.from({ length: N }, (_, i) => ({ id: i + 1, raw: 'r' + i })) }
        })
        // Item computed forces the COMPUTED dispatcher (stable effect + runtime
        // dep walk) — the machinery under retention test.
        wildflower.component('sec-list', {
            state: {},
            computed: {
                label(item) { window.__secEvals++; return item.raw + '!' }
            }
        })

        const baselineInstances = wildflower.componentInstances.size
        const store = wildflower.getStore('sec-src')

        for (let k = 0; k < K; k++) {
            const host = document.createElement('div')
            testContainer.appendChild(host)
            host.innerHTML = `
                <div data-component="sec-list">
                    <ul data-list="external('sec-src', 'items')" data-key="id">
                        <template>
                            <li><span class="lbl" data-bind="label"></span></li>
                        </template>
                    </ul>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            expect(host.querySelectorAll('.lbl').length).toBe(N)
            // The store persists across cycles: the fresh mount must render
            // whatever the store currently holds (r0 on cycle 0, w<k-1> after).
            expect(host.querySelector('.lbl').textContent).toBe(store.items[0].raw + '!')

            // Churn: item write + full-array replace both flow through the
            // dispatcher while mounted.
            store.items[0].raw = 'w' + k
            await waitForCompleteRender()
            expect(host.querySelector('.lbl').textContent).toBe('w' + k + '!')
            store.items = store.items.map(i => ({ ...i }))
            await waitForCompleteRender()
            expect(host.querySelectorAll('.lbl').length).toBe(N)

            // Unmount: destroy the instance AND remove the subtree (removal
            // alone auto-resurrects on the next scan).
            const el = host.querySelector('[data-component="sec-list"]')
            wildflower.destroyComponent(el.dataset.componentId)
            host.remove()
            await waitForCompleteRender()
        }

        expect(wildflower.componentInstances.size).toBe(baselineInstances)

        // The retention probe: with every list destroyed, a store write must
        // evaluate no item computeds at all. A surviving stable effect (or
        // appended edge that outlived disposeNode) shows up as a nonzero delta.
        window.__secEvals = 0
        store.items[0].raw = 'final'
        store.items[1].raw = 'final2'
        await waitForCompleteRender()
        expect(window.__secEvals).toBe(0)
    })
})
