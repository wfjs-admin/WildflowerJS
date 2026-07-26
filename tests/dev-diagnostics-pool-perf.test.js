/**
 * Sealing-the-graph rows 5 + 7 — the two pool PHYSICS cliffs made LOUD:
 *
 *  Row 5 (WF-410) — mixed-shape entity spawns. V8 gives a pool one fast
 *  hidden class only when every spawn path produces entities with the same
 *  fields in the same order; a divergent spawn silently deoptimizes every
 *  hot-loop read. Dev builds compare each entity's post-merge key signature
 *  against the pool's first-seen shape and warn once per pool.
 *
 *  Row 7 (WF-411) — entity.computed frame budget (~60us/entity/flush,
 *  uncached by contract). Dev builds warn once when a non-passive pool with
 *  entity.computed reaches the budget threshold (200 entities).
 *
 * __DEV__-gated; skipped on min variants. Requires the pools feature.
 * Ledger: docs/future/paths_forward/03-sealing-the-graph.md (rows 5, 7).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild() || !hasFeature('pools'))('Dev-mode pool performance diagnostics (sealing rows 5 + 7)', () => {
    let testContainer
    let warnings
    let originalWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)
        warnings = []
        originalWarn = console.warn
        console.warn = (...args) => { warnings.push(args.join(' ')) }
        // Keep the row-3 settle note out of these captures
        window.wildflower._devPoolSettleMs = 60000
    })

    afterEach(() => {
        console.warn = originalWarn
        delete window.wildflower._devPoolSettleMs
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    async function mount(name, def, containerAttrs = '') {
        window.wildflower.component(name, def)
        testContainer.innerHTML = `<div data-component="${name}"><div data-pool="p" ${containerAttrs}><template><span data-bind="label"></span></template></div></div>`
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 50))
    }

    // Match only the main diagnostic line — wfError also prints a docs-URL
    // line containing the bare code, which must not inflate the count.
    function shapeWarnings() {
        return warnings.filter(w => w.includes('[WF WF-410]'))
    }
    function budgetWarnings() {
        return warnings.filter(w => w.includes('[WF WF-411]'))
    }

    // ------------------------------------------------- row 5: mixed shapes

    it('warns once when a spawn diverges from the pool\'s first-seen shape', async () => {
        await mount('pp-mixed', {
            state: {},
            pools: { p: {} },
            init() {
                const p = this.getPool('p')
                p.add({ id: 1, x: 0, y: 0, label: 'a' })
                p.add({ id: 2, y: 0, x: 0, label: 'b' })   // same fields, different order
                p.add({ id: 3, x: 0, label: 'c' })          // missing field
            }
        })

        const found = shapeWarnings()
        expect(found.length).toBe(1)
        const all = warnings.join('\n')
        expect(all).toContain('id, x, y, label')
        expect(all).toContain('id, y, x, label')
    })

    it('stays silent for uniform spawns', async () => {
        await mount('pp-uniform', {
            state: {},
            pools: { p: {} },
            init() {
                const p = this.getPool('p')
                for (let i = 0; i < 50; i++) p.add({ id: i, x: i, label: 'l' + i })
            }
        })

        expect(shapeWarnings()).toEqual([])
    })

    it('stays silent when entity.state defaults normalize a missing field', async () => {
        await mount('pp-normalized', {
            state: {},
            pools: { p: { entity: { state: { hp: 100 } } } },
            init() {
                const p = this.getPool('p')
                p.add({ id: 1, label: 'a', hp: 5 })
                p.add({ id: 2, label: 'b' })   // hp filled by the template, same final order
            }
        })

        expect(shapeWarnings()).toEqual([])
    })

    // --------------------------------------------- row 7: computed budget

    it('warns once when a pool with entity.computed reaches the budget threshold', async () => {
        await mount('pp-budget', {
            state: {},
            pools: { p: { entity: { computed: { double() { return this.n * 2 } } } } },
            init() {
                const items = []
                for (let i = 0; i < 200; i++) items.push({ id: i, n: i, label: 'x' })
                this.getPool('p').add(items)
                // Crossing the threshold again must not re-warn
                this.getPool('p').add({ id: 999, n: 1, label: 'y' })
            }
        })

        const found = budgetWarnings()
        expect(found.length).toBe(1)
        const all = warnings.join('\n')
        expect(all).toContain("'double'")
    })

    it('stays silent below the threshold', async () => {
        await mount('pp-under', {
            state: {},
            pools: { p: { entity: { computed: { double() { return this.n * 2 } } } } },
            init() {
                const items = []
                for (let i = 0; i < 150; i++) items.push({ id: i, n: i, label: 'x' })
                this.getPool('p').add(items)
            }
        })

        expect(budgetWarnings()).toEqual([])
    })

    it('stays silent without entity.computed', async () => {
        await mount('pp-nocomputed', {
            state: {},
            pools: { p: {} },
            init() {
                const items = []
                for (let i = 0; i < 250; i++) items.push({ id: i, label: 'x' })
                this.getPool('p').add(items)
            }
        })

        expect(budgetWarnings()).toEqual([])
    })

    it('stays silent for a passive (data-pool-static) pool', async () => {
        await mount('pp-passive', {
            state: {},
            pools: { p: { entity: { computed: { double() { return this.n * 2 } } } } },
            init() {
                const items = []
                for (let i = 0; i < 250; i++) items.push({ id: i, n: i, label: 'x' })
                this.getPool('p').add(items)
            }
        }, 'data-pool-static')

        expect(budgetWarnings()).toEqual([])
    })
})
