/**
 * Two data-lists in one component over the same computed, where the computed
 * returns fresh objects on every evaluation. Both lists render and follow a
 * state change without tripping the flush loop breaker (WF-238).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise(r => setTimeout(r, ms))

describe.skipIf(!hasFeature('lists'))('two lists over one computed that returns fresh objects', () => {
    let wildflower
    let container
    let n = 0
    let warnSpy
    let errorSpy

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        n++
        warnSpy = vi.spyOn(console, 'warn')
        errorSpy = vi.spyOn(console, 'error')
    })

    afterEach(() => {
        warnSpy.mockRestore()
        errorSpy.mockRestore()
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    const loopMessages = () => [...warnSpy.mock.calls, ...errorSpy.mock.calls]
        .map(args => args.map(String).join(' '))
        .filter(s => /loop breaker|WF-238/i.test(s))

    // Poll until read() equals want.
    async function until(read, want, limit = 4000) {
        const t0 = performance.now()
        while (performance.now() - t0 < limit) {
            try { expect(read()).toEqual(want); return } catch (e) { /* not yet */ }
            await settle(10)
        }
        expect(read()).toEqual(want)
    }

    // The loop this pins re-ran the computed, whose fresh objects made each
    // list reconcile again, until the breaker stopped it at a million
    // updates. A count of the computed's runs after one write says the same
    // as the 3 s it took, without reading a clock a loaded machine stretches.
    const RERUNS = 20

    it('both lists render and follow a state change without tripping the loop breaker', async () => {
        const comp = `tl-state-${n}`
        let evals = 0
        wildflower.component(comp, {
            state: { suffix: '1' },
            computed: { letters() { evals++; return ['A', 'B', 'C'].map(ch => ({ ch: ch + this.suffix })) } },
        })
        container.innerHTML = `<div data-component="${comp}">
            <p class="one" data-list="letters"><template><span data-bind="ch"></span></template></p>
            <p class="two" data-list="letters"><template><i data-bind="ch"></i></template></p>
        </div>`
        wildflower.scan(container)
        const one = () => [...container.querySelectorAll('.one span')].map(e => e.textContent)
        const two = () => [...container.querySelectorAll('.two i')].map(e => e.textContent)
        await until(one, ['A1', 'B1', 'C1'])
        await until(two, ['A1', 'B1', 'C1'])
        await wildflower.whenSettled()
        const mounted = evals
        wildflower.getComponent(comp).suffix = '2'
        await until(two, ['A2', 'B2', 'C2'])
        await wildflower.whenSettled()
        expect(one()).toEqual(['A2', 'B2', 'C2'])
        expect(loopMessages()).toEqual([])
        // One write re-runs the computed once (measured: 1 on every build).
        expect(evals - mounted).toBeLessThan(RERUNS)
    })

    it('rows in both lists follow a store field without tripping the loop breaker', async () => {
        const store = `tl-k-${n}`
        const comp = `tl-store-${n}`
        let evals = 0
        wildflower.store(store, { state: { time: 0 } })
        wildflower.component(comp, {
            subscribe: { [store]: ['time'] },
            computed: { letters() { evals++; return ['A', 'B', 'C'].map(ch => ({ ch })) } },
        })
        container.innerHTML = `<div data-component="${comp}">
            <b class="outside" data-bind="$${store}.time"></b>
            <p class="one" data-list="letters"><template><span data-bind="$${store}.time"></span></template></p>
            <p class="two" data-list="letters"><template><i data-bind="$${store}.time"></i></template></p>
        </div>`
        wildflower.scan(container)
        const one = () => [...container.querySelectorAll('.one span')].map(e => e.textContent)
        const two = () => [...container.querySelectorAll('.two i')].map(e => e.textContent)
        await until(one, ['0', '0', '0'])
        await until(two, ['0', '0', '0'])
        await wildflower.whenSettled()
        const mounted = evals
        wildflower.getStore(store).time = 6
        await until(two, ['6', '6', '6'])
        await wildflower.whenSettled()
        expect(one()).toEqual(['6', '6', '6'])
        expect(loopMessages()).toEqual([])
        // The computed does not read the store (measured: 0 on every build).
        expect(evals - mounted).toBeLessThan(RERUNS)
    })
})
