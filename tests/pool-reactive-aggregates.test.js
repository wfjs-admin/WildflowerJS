/**
 * B2 (DX diagnostics sweep): pool.length / pool.size are REACTIVE on demand.
 * A computed or effect reading an aggregate materializes a lazy one-field
 * reactive box; structural mutations (add single/bulk, remove, clear) keep it
 * in sync with one pulse per API call. Pools never read reactively never
 * allocate the box, and per-frame entity FIELD mutation stays non-reactive
 * (the pool contract is untouched).
 *
 * This is production behavior — the suite runs on ALL variants (no
 * isMinifiedBuild skip). Requires the pools feature.
 * Plan: docs/future/DX_DIAGNOSTICS_SWEEP_2026-07-12.md (item B2).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, waitForCompleteRender, waitForUpdate } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(!hasFeature('pools'))('Reactive pool aggregates (B2)', () => {
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

    async function mount(name, extra = {}) {
        let pool = null
        window.wildflower.component(name, {
            state: { note: '' },
            computed: {
                count() { return this.getPool('items') ? this.getPool('items').length : 0 }
            },
            pools: { items: {} },
            init() { pool = this.getPool('items') },
            ...extra
        })
        testContainer.innerHTML = `
            <div data-component="${name}">
                <b class="count" data-bind="count"></b>
                <div data-pool="items"><template><span data-bind="label"></span></template></div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 60))
        return pool
    }

    it('a computed reading pool.length re-evaluates on add, remove, and clear', async () => {
        const pool = await mount('ra-live')
        const countEl = testContainer.querySelector('.count')
        expect(countEl.textContent).toBe('0')

        pool.add({ id: 1, label: 'a' })
        await waitForUpdate(30)
        expect(countEl.textContent).toBe('1')

        pool.add([{ id: 2, label: 'b' }, { id: 3, label: 'c' }, { id: 4, label: 'd' }])
        await waitForUpdate(30)
        expect(countEl.textContent).toBe('4')

        pool.remove(2)
        await waitForUpdate(30)
        expect(countEl.textContent).toBe('3')

        pool.clear()
        await waitForUpdate(30)
        expect(countEl.textContent).toBe('0')
    })

    it('size and length share the same reactive source', async () => {
        const pool = await mount('ra-alias', {
            computed: {
                count() { return this.getPool('items') ? this.getPool('items').size : 0 }
            }
        })
        pool.add([{ id: 1, label: 'a' }, { id: 2, label: 'b' }])
        await waitForUpdate(30)
        expect(testContainer.querySelector('.count').textContent).toBe('2')
        expect(pool.length).toBe(2)
        expect(pool.size).toBe(2)
    })

    it('stays lazy: plain (non-reactive) reads never allocate the box', async () => {
        let pool = null
        window.wildflower.component('ra-lazy', {
            state: {},
            pools: { items: {} },
            init() { pool = this.getPool('items') }
        })
        testContainer.innerHTML = `
            <div data-component="ra-lazy">
                <div data-pool="items"><template><span data-bind="label"></span></template></div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 60))

        pool.add({ id: 1, label: 'a' })
        // Plain reads from an action-handler-like context:
        expect(pool.length).toBe(1)
        expect(pool.size).toBe(1)
        pool.remove(1)
        expect(pool.length).toBe(0)
        expect(pool._lenBox).toBeUndefined()
    })

    it('the box initializes from the CURRENT size at first reactive read', async () => {
        // Pool populated before anything reads the aggregate reactively:
        // the computed's first evaluation must see the true count, not 0.
        const pool = await mount('ra-late')
        pool.add([{ id: 1, label: 'a' }, { id: 2, label: 'b' }])
        await waitForUpdate(30)
        expect(testContainer.querySelector('.count').textContent).toBe('2')
    })

    // F1 (AI-surface eval, 2026-07-14): a computed reading the aggregate via the
    // PROPERTY accessor this.pools.name.length must be as reactive as the method
    // accessor this.getPool(name).length. llms.txt documents the two as equivalent;
    // sonnet generated the property form and its count binding was permanently
    // dead (the plain `pools` property is undefined at the computed's first
    // evaluation, so nothing pool-related is tracked and it never re-runs).
    async function mountProp(name, extra = {}) {
        let pool = null
        window.wildflower.component(name, {
            state: { note: '' },
            computed: {
                count() { return this.pools.items ? this.pools.items.length : 0 }
            },
            pools: { items: {} },
            init() { pool = this.getPool('items') },
            ...extra
        })
        testContainer.innerHTML = `
            <div data-component="${name}">
                <b class="count" data-bind="count"></b>
                <div data-pool="items"><template><span data-bind="label"></span></template></div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 60))
        return pool
    }

    it('a computed reading this.pools.name.length is reactive (property accessor parity)', async () => {
        const pool = await mountProp('ra-prop')
        const countEl = testContainer.querySelector('.count')
        expect(countEl.textContent).toBe('0')

        pool.add({ id: 1, label: 'a' })
        await waitForUpdate(30)
        expect(countEl.textContent).toBe('1')

        pool.add([{ id: 2, label: 'b' }, { id: 3, label: 'c' }])
        await waitForUpdate(30)
        expect(countEl.textContent).toBe('3')

        pool.remove(2)
        await waitForUpdate(30)
        expect(countEl.textContent).toBe('2')

        pool.clear()
        await waitForUpdate(30)
        expect(countEl.textContent).toBe('0')
    })

    // F1 gap probe (AI-surface eval P6, 2026-07-15): the eval's per-frame pool-sim
    // apps wire the count as `computed: { pcount() { return this.pools.particles.length } }`
    // bound with data-bind, populate the pool with a BULK push in init, and run a
    // tick(dt) loop that iterates the pool every frame. Two independent sonnet cells
    // had a permanently-dead count with this shape even though the simpler B2/F1 tests
    // pass. This reproduces that exact shape.
    it('per-frame pool: bulk-push init + tick loop + this.pools.x.length computed stays reactive', async () => {
        let pool = null
        window.wildflower.component('ra-perframe', {
            state: { paused: false },
            computed: {
                pcount() { return this.pools.particles.length }
            },
            pools: { particles: {} },
            init() {
                this._nextId = 0
                const batch = []
                for (let i = 0; i < 200; i++) batch.push({ id: this._nextId++, x: 1, y: 1, vx: 1, vy: 1 })
                this.pools.particles.push(batch)
                pool = this.pools.particles
            },
            add50() {
                const batch = []
                for (let i = 0; i < 50; i++) batch.push({ id: this._nextId++, x: 1, y: 1, vx: 1, vy: 1 })
                this.pools.particles.push(batch)
            },
            clearAll() { this.pools.particles.clear() },
            tick(dt) {
                if (this.paused) return
                for (const p of this.pools.particles) { p.x += p.vx; p.y += p.vy }
            }
        })
        testContainer.innerHTML = `
            <div data-component="ra-perframe">
                <b class="count" data-bind="pcount"></b>
                <div id="stage" data-pool="particles" data-key="id"><template><div class="particle"></div></template></div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 120)) // let a few tick frames run

        const countEl = testContainer.querySelector('.count')
        expect(pool.length).toBe(200)                 // pool really has 200
        expect(countEl.textContent).toBe('200')       // and the bound computed shows it

        pool.push(Array.from({ length: 50 }, (_, i) => ({ id: 1000 + i, x: 1, y: 1, vx: 1, vy: 1 })))
        await waitForUpdate(60)
        expect(countEl.textContent).toBe('250')

        pool.clear()
        await waitForUpdate(60)
        expect(countEl.textContent).toBe('0')
    })

    // Regression for the AI-surface eval P6 finding (2026-07-15): the reactive
    // pool-count computed bound with data-bind was permanently empty on the async
    // SCANNER init path (wildflower.scan / real page load), while every other test
    // used the _initializeComponentElement path and passed. Root cause: the scanner's
    // _setupSingleInstanceComputed injected store refs but not pool refs, so
    // context.pools stayed aliased to the definition block and this.pools.x.length
    // read the empty config (undefined, no tracking). This test drives the SCANNER
    // path explicitly so the divergence can never silently return.
    it('reactive pool count binding works through the async scanner path (wildflower.scan)', async () => {
        window.wildflower.component('ra-scanner', {
            state: {},
            computed: { pcount() { return this.pools.particles.length } },
            pools: { particles: {} },
            init() {
                const batch = []
                for (let i = 0; i < 200; i++) batch.push({ id: i })
                this.pools.particles.push(batch)
            }
        })
        testContainer.innerHTML = `
            <div data-component="ra-scanner">
                <div data-pool="particles" data-key="id"><template><i class="particle"></i></template></div>
                <b class="count" data-bind="pcount"></b>
            </div>
        `
        // Drive the BATCHED page-load orchestrator (_scanForComponents ->
        // _setupSingleInstanceComputed), the path real page loads use via
        // _scanForComponentsAsync. wildflower.scan() and the mutation observer both
        // route through _initializeComponentElement instead, which is why the rest of
        // the suite never exercises this orchestrator.
        window.wildflower._scanForComponents()
        await waitForCompleteRender()
        await waitForUpdate(120)

        const countEl = testContainer.querySelector('.count')
        expect(countEl.textContent).toBe('200')
    })

    // Isolates the t7-c2/c3 eval failure: same as above, but the bound count element
    // sits AFTER the data-pool in DOM order (stage first, HUD/controls below — the most
    // common game/sim layout). If this fails while the before-pool version passes, the
    // bug is that component bindings following a data-pool element are not processed.
    it('a component binding placed AFTER a data-pool element is processed', async () => {
        window.wildflower.component('ra-afterpool', {
            state: { paused: false },
            computed: {
                pcount() { return this.pools.particles.length },
                toggleLabel() { return this.paused ? 'Resume' : 'Pause' }
            },
            pools: { particles: {} },
            init() {
                this._nextId = 0
                const batch = []
                for (let i = 0; i < 200; i++) batch.push({ id: this._nextId++, x: 1, y: 1, vx: 1, vy: 1 })
                this.pools.particles.push(batch)
            },
            tick(dt) { if (this.paused) return; for (const p of this.pools.particles) { p.x += p.vx } }
        })
        testContainer.innerHTML = `
            <div data-component="ra-afterpool">
                <div id="stage" data-pool="particles" data-key="id">
                    <template><div class="particle" data-bind-style="{ left: x + 'px' }"></div></template>
                </div>
                <div class="controls">
                    <button data-bind="toggleLabel"></button>
                    <span>Particles: <b class="count" data-bind="pcount"></b></span>
                </div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 120))

        const countEl = testContainer.querySelector('.count')
        expect(countEl.textContent).toBe('200')
    })

    it('the UNGUARDED property form (this.pools.name.length, no ternary) is reactive', async () => {
        // The exact shape the sonnet AI-surface cell generated and that broke:
        // no `this.pools.x ? ... : 0` guard. Must reach parity with the
        // equally-unguarded method form (this.getPool(x).length), which works.
        const pool = await mountProp('ra-prop-unguarded', {
            computed: {
                count() { return this.pools.items.length }
            }
        })
        const countEl = testContainer.querySelector('.count')
        expect(countEl.textContent).toBe('0')

        pool.add({ id: 1, label: 'a' })
        await waitForUpdate(30)
        expect(countEl.textContent).toBe('1')

        pool.add([{ id: 2, label: 'b' }])
        await waitForUpdate(30)
        expect(countEl.textContent).toBe('2')

        pool.clear()
        await waitForUpdate(30)
        expect(countEl.textContent).toBe('0')
    })
})
