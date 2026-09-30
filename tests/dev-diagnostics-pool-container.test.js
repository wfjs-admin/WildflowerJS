/**
 * Sealing-the-graph row 3: a data-pool container whose pool is never declared
 * and never populated renders nothing forever and says nothing. Two shapes:
 *
 *  (a) WF-408 — the container's name doesn't match any pool in the component's
 *      declared pools block (near-certain typo). Deterministic at setup;
 *      warns immediately with a did-you-mean over the declared names.
 *  (b) WF-409 — the container is wired but nothing was ever added by the
 *      settle window (dev note; apps that populate on interaction can ignore).
 *
 * __DEV__-gated; skipped on min variants. Requires the pools feature.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild() || !hasFeature('pools'))('Dev-mode pool-container diagnostics (sealing row 3)', () => {
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
        // Shrink the settle window so the never-populated note is testable
        window.wildflower._devPoolSettleMs = 40
    })

    afterEach(() => {
        console.warn = originalWarn
        delete window.wildflower._devPoolSettleMs
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    function undeclaredWarnings(name) {
        return warnings.filter(w => w.includes('WF-408') && w.includes(`'${name}'`))
    }
    function neverPopulatedWarnings(name) {
        return warnings.filter(w => w.includes('WF-409') && w.includes(`'${name}'`))
    }

    // ------------------------------------------------- (a) undeclared / typo

    it('warns at setup when the container name misses the declared pools block, with did-you-mean', async () => {
        window.wildflower.component('pc-typo', {
            state: {},
            pools: { items: {} }
        })
        testContainer.innerHTML = '<div data-component="pc-typo"><div data-pool="itmes"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 20))

        const found = undeclaredWarnings('pc-typo')
        expect(found.length).toBe(1)
        expect(found[0]).toContain('itmes')
        // The suggestion interpolates the user's own declared pool name
        const all = warnings.join('\n')
        expect(all).toContain('data-pool="items"')
    })

    it('does not stack the never-populated note on top of the undeclared warning', async () => {
        window.wildflower.component('pc-typo-once', {
            state: {},
            pools: { rows: {} }
        })
        testContainer.innerHTML = '<div data-component="pc-typo-once"><div data-pool="rowz"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 120))

        expect(undeclaredWarnings('pc-typo-once').length).toBe(1)
        expect(warnings.filter(w => w.includes('WF-409') && w.includes('rowz'))).toEqual([])
    })

    it('stays silent when the container matches a declared pool that is populated', async () => {
        window.wildflower.component('pc-good', {
            state: {},
            pools: { items: {} },
            init() { this.getPool('items').add({ id: 1, label: 'a' }) }
        })
        testContainer.innerHTML = '<div data-component="pc-good"><div data-pool="items"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 120))

        expect(undeclaredWarnings('pc-good')).toEqual([])
        expect(neverPopulatedWarnings('items')).toEqual([])
    })

    it('stays silent for a markup-only pool (no pools block) populated programmatically', async () => {
        window.wildflower.component('pc-markup-only', {
            state: {},
            init() { this.getPool('sprites').add({ id: 1, label: 's' }) }
        })
        testContainer.innerHTML = '<div data-component="pc-markup-only"><div data-pool="sprites"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 120))

        expect(undeclaredWarnings('pc-markup-only')).toEqual([])
        expect(neverPopulatedWarnings('sprites')).toEqual([])
    })

    // ------------------------------------------------ (b) never populated

    it('notes a wired container that was never populated once the settle window passes', async () => {
        window.wildflower.component('pc-empty', {
            state: {},
            pools: { orbs: {} }
        })
        testContainer.innerHTML = '<div data-component="pc-empty"><div data-pool="orbs"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 150))

        const found = neverPopulatedWarnings('orbs')
        expect(found.length).toBe(1)
        expect(found[0]).toContain('pc-empty')
        // The suggestion interpolates the user's own pool name
        expect(warnings.join('\n')).toContain("getPool('orbs')")
        // and leads with the common harmless case: a pool that fills later
        // (on interaction, after loading) is fine, so that reads first.
        const suggestion = warnings.find(w => w.includes('Suggestion') && w.includes("getPool('orbs')"))
        expect(suggestion).toMatch(/Suggestion: If this pool fills later/)
    })

    it('stays silent when the pool was populated and later cleared', async () => {
        window.wildflower.component('pc-cleared', {
            state: {},
            pools: { dots: {} },
            init() {
                const p = this.getPool('dots')
                p.add({ id: 1, label: 'd' })
                p.clear()
            }
        })
        testContainer.innerHTML = '<div data-component="pc-cleared"><div data-pool="dots"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 150))

        expect(neverPopulatedWarnings('dots')).toEqual([])
    })

    it('stays silent when the component is torn down before the window elapses', async () => {
        // Wider window so the teardown below reliably happens inside it
        window.wildflower._devPoolSettleMs = 500
        window.wildflower.component('pc-teardown', {
            state: {},
            pools: { stars: {} }
        })
        testContainer.innerHTML = '<div data-component="pc-teardown"><div data-pool="stars"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const el = testContainer.querySelector('[data-component="pc-teardown"]')
        const id = el.dataset.componentId
        el.remove()
        window.wildflower.destroyComponent(id)
        await new Promise(r => setTimeout(r, 650))

        expect(neverPopulatedWarnings('stars')).toEqual([])
    })

    // ------------- (b2) never populated because it points at a data-only pool
    // A data-pool container renders only its own component's pool. Pointing it
    // at a store's or plugin's pool (by name, or as a $store.name path) leaves
    // it empty; the note must say that, not advise getPool(name).add(...).

    function waitForSettle(ms = 150) {
        return new Promise(r => setTimeout(r, ms))
    }

    it('WF-409 names the store when the container points at a store pool by name', async () => {
        window.wildflower.store('pcSwarm', { pools: { bees: {} } })
        window.wildflower.component('pc-store-name', { subscribe: ['pcSwarm'] })
        testContainer.innerHTML = '<div data-component="pc-store-name"><div data-pool="bees"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await waitForSettle()

        const found = neverPopulatedWarnings('bees')
        expect(found.length).toBe(1)
        const all = warnings.join('\n')
        expect(all).toContain("store 'pcSwarm'")
        expect(all).toContain('this.stores.pcSwarm.pools.bees')
        expect(all).not.toContain("getPool('bees').add")
    })

    it('WF-409 names the store when the container is a $store.pool path', async () => {
        window.wildflower.store('pcHive', { pools: { cells: {} } })
        window.wildflower.component('pc-store-path', { subscribe: ['pcHive'] })
        testContainer.innerHTML = '<div data-component="pc-store-path"><div data-pool="$pcHive.cells"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await waitForSettle()

        const found = neverPopulatedWarnings('$pcHive.cells')
        expect(found.length).toBe(1)
        const all = warnings.join('\n')
        expect(all).toContain("store 'pcHive'")
        expect(all).toContain('a pool name, not a path')
        expect(all).not.toContain("getPool('$pcHive.cells').add")
    })

    it('WF-409 says data-pool takes a name when a $path matches no store pool', async () => {
        window.wildflower.component('pc-bad-path', {})
        testContainer.innerHTML = '<div data-component="pc-bad-path"><div data-pool="$nowhere.items"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await waitForSettle()

        expect(neverPopulatedWarnings('$nowhere.items').length).toBe(1)
        const all = warnings.join('\n')
        expect(all).toContain('a pool name, not a path')
        expect(all).not.toContain("getPool('$nowhere.items').add")
    })

    ;(hasFeature('plugins') ? it : it.skip)('WF-409 names the plugin when the container points at a plugin pool', async () => {
        window.wildflower.plugin({ name: 'pcFlockPlugin', pools: { flock: {} } })
        window.wildflower.component('pc-plugin-name', {})
        testContainer.innerHTML = '<div data-component="pc-plugin-name"><div data-pool="flock"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await waitForSettle()

        expect(neverPopulatedWarnings('flock').length).toBe(1)
        const all = warnings.join('\n')
        expect(all).toContain("plugin 'pcFlockPlugin'")
        expect(all).not.toContain("getPool('flock').add")
    })

    it('WF-408 names the store too, when the component declares pools of its own', async () => {
        window.wildflower.store('pcMeadow', { pools: { bees: {} } })
        window.wildflower.component('pc-own-pools', { subscribe: ['pcMeadow'], pools: { mine: {} } })
        testContainer.innerHTML = '<div data-component="pc-own-pools">'
            + '<div data-pool="bees"><template><span data-bind="label"></span></template></div>'
            + '<div data-pool="mine"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await waitForSettle()

        expect(undeclaredWarnings('pc-own-pools').length).toBe(1)
        const all = warnings.join('\n')
        expect(all).toContain("store 'pcMeadow'")
        expect(all).toContain('this.stores.pcMeadow.pools.bees')
        expect(all).not.toContain("getPool('bees').add")
    })

    it('WF-409 keeps its populate advice for an ordinary empty container', async () => {
        window.wildflower.component('pc-plain-empty', {})
        testContainer.innerHTML = '<div data-component="pc-plain-empty"><div data-pool="motes"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await waitForSettle()

        expect(neverPopulatedWarnings('motes').length).toBe(1)
        expect(warnings.join('\n')).toContain("getPool('motes').add")
    })

    // ------------------------------------ (c) declared, but no container at all

    function declaredNoContainerWarnings(name) {
        return warnings.filter(w => w.includes('WF-416') && w.includes(`'${name}'`))
    }

    it('WF-416: a pool declared in a component with no data-pool container warns once after the page settles', async () => {
        window.wildflower.component('pc-nocontainer', {
            state: {},
            pools: { agents: {} },
            init() { this.seen = this.pools.agents }
        })
        testContainer.innerHTML = '<div data-component="pc-nocontainer"><p>no pool markup</p></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 150))

        const found = declaredNoContainerWarnings('agents')
        expect(found.length).toBe(1)
        expect(found[0]).toContain('pc-nocontainer')
        const all = warnings.join('\n')
        expect(all).toContain('data-pool="agents"')
        expect(all).toContain('store')
    })

    it('WF-416 stays silent when the declared pool has its container', async () => {
        window.wildflower.component('pc-hascontainer', {
            state: {},
            pools: { items: {} },
            init() { this.getPool('items').add({ id: 1, label: 'a' }) }
        })
        testContainer.innerHTML = '<div data-component="pc-hascontainer"><div data-pool="items"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 150))

        expect(declaredNoContainerWarnings('items')).toEqual([])
    })

    // ------------------------ (d) data-key and the block's key disagree

    function keyMismatchWarnings(name) {
        return warnings.filter(w => w.includes('WF-417') && w.includes(`'${name}'`))
    }

    it('WF-417: data-key on the container and key in the pools block disagree; warns once, data-key wins', async () => {
        let ctx = null
        window.wildflower.component('pc-keymismatch', {
            state: {},
            pools: { items: { key: 'uid' } },
            init() { ctx = this }
        })
        testContainer.innerHTML = '<div data-component="pc-keymismatch"><div data-pool="items" data-key="sku"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 20))

        const found = keyMismatchWarnings('items')
        expect(found.length).toBe(1)
        expect(found[0]).toContain('sku')
        expect(found[0]).toContain('uid')
        ctx.pools.items.add({ sku: 'k1', uid: 1, label: 'a' })
        expect(ctx.pools.items.get('k1')).toBeTruthy()
    })

    it('WF-417 stays silent when data-key and the block key agree, or only one is given', async () => {
        window.wildflower.component('pc-keyagree', {
            state: {},
            pools: { same: { key: 'sku' }, attrOnly: {}, blockOnly: { key: 'uid' } }
        })
        testContainer.innerHTML = '<div data-component="pc-keyagree">' +
            '<div data-pool="same" data-key="sku"><template><i></i></template></div>' +
            '<div data-pool="attrOnly" data-key="sku"><template><i></i></template></div>' +
            '<div data-pool="blockOnly"><template><i></i></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 20))

        expect(warnings.filter(w => w.includes('WF-417'))).toEqual([])
    })

    // ------------------------ (e) a pools-block key that is not a non-empty string

    function badKeyWarnings(name) {
        return warnings.filter(w => w.includes('WF-418') && w.includes(`'${name}'`))
    }

    it('WF-418: a component pools-block key that is not a non-empty string warns once and keys on id', async () => {
        let ctx = null
        window.wildflower.component('pc-badkey', {
            state: {},
            pools: { nums: { key: 5 }, empty: { key: '' } },
            init() { ctx = this }
        })
        testContainer.innerHTML = '<div data-component="pc-badkey">' +
            '<div data-pool="nums"><template><i></i></template></div>' +
            '<div data-pool="empty"><template><i></i></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 20))

        expect(badKeyWarnings('nums').length).toBe(1)
        expect(badKeyWarnings('empty').length).toBe(1)
        ctx.pools.nums.add({ id: 7 })
        expect(ctx.pools.nums.get(7)).toBeTruthy()
    })

    it('WF-418: a store or plugin pools-block key that is not a non-empty string warns once', async () => {
        const store = window.wildflower.store('pc-badkey-store', {
            state: {},
            pools: { bees: { key: ['uid'] }, fine: { key: 'uid' }, plain: {} }
        })
        // lite and mini-pool carry pools without plugins
        const plugins = hasFeature('plugins')
        if (plugins) {
            window.wildflower.plugin({
                name: 'pc-badkey-plugin',
                pools: { ants: { key: null } }
            })
        }
        await new Promise(r => setTimeout(r, 20))

        expect(badKeyWarnings('bees').length).toBe(1)
        if (plugins) expect(badKeyWarnings('ants').length).toBe(1)
        expect(badKeyWarnings('fine')).toEqual([])
        expect(badKeyWarnings('plain')).toEqual([])
        store.pools.bees.add({ id: 'b1' })
        expect(store.pools.bees.get('b1')).toBeTruthy()
    })

    it('WF-416 does not stack on WF-408 when the container name is a typo of the declared pool', async () => {
        window.wildflower.component('pc-typo-416', {
            state: {},
            pools: { items: {} }
        })
        testContainer.innerHTML = '<div data-component="pc-typo-416"><div data-pool="itmes"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 150))

        expect(undeclaredWarnings('pc-typo-416').length).toBe(1)
        expect(declaredNoContainerWarnings('items')).toEqual([])
    })
})
