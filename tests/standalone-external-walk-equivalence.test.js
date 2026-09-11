import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, skipIfNoFeature } from './helpers/load-framework.js'

/**
 * _refreshStandaloneExternalBindings: pruning-walk equivalence.
 *
 * The old implementation ran five whole-subtree querySelectorAll calls per
 * store write, matched every list row's bindings, then discarded them with a
 * per-match parent-chain rescan — O(all DOM) to refresh only the non-list
 * bindings. Measured 2026-08-24 at ~113 ns per row per write on top of an
 * already-gated item-computed walk. It now does one pre-order walk that prunes
 * at list roots.
 *
 * The retained set is defined exactly as before: descendants carrying the
 * binding attribute, whose expression references external state, with no
 * element STRICTLY BETWEEN the node and the component root carrying `list`.
 * Two edges make that "strictly between" load-bearing, and both are pinned
 * here because the obvious implementations get them wrong:
 *
 *   - A list ROOT that also carries its own binding must still refresh. The old
 *     `isInsideList` started at `element.parentElement`, so the node's own list
 *     attribute never excluded it. A TreeWalker with FILTER_REJECT on
 *     [data-list] — the natural first implementation — silently stops
 *     refreshing it. That is the "binding quietly goes stale" failure class,
 *     so it gets an explicit pin.
 *   - A component root that is itself a list must still have its descendants
 *     refreshed, because the old parent loop stopped AT the root.
 */

async function settle(wf, ms = 50) {
    if (wf?._forceCompleteRender) await wf._forceCompleteRender()
    await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('standalone external bindings: pruning walk equivalence', () => {
    let container
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container?.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    // NOTE: this end-to-end pin does NOT discriminate the prune-before-test bug.
    // Verified by inverting the walk to prune before testing: this test still
    // passed, because the list's own render path also refreshes a class binding
    // on the list root. It is kept as behavior documentation, but the pin that
    // actually guards the edge is the white-box collector test below, which does
    // go red against the inverted walk.
    it('refreshes a list ROOT that carries its own external binding', skipIfNoFeature('lists', async () => {
        wildflower.store('walkA', { state: { rows: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }], theme: 'light' } })
        wildflower.component('walk-a', { state: {} })

        // The <ul> is BOTH the list root AND carries an external class binding.
        container.innerHTML = `
            <div data-component="walk-a">
                <ul id="lst" data-list="$walkA.rows" data-bind-class="$walkA.theme">
                    <template><li><span data-bind="t"></span></li></template>
                </ul>
            </div>
        `
        await settle(wildflower)
        const ul = container.querySelector('#lst')
        expect(ul.classList.contains('light'), 'initial external class on the list root').toBe(true)

        wildflower.getStore('walkA').theme = 'dark'
        await settle(wildflower)

        expect(ul.classList.contains('dark'), 'list root with its own external binding must still refresh').toBe(true)
        expect(ul.classList.contains('light')).toBe(false)
    }))

    it('refreshes standalone bindings while skipping list interiors', skipIfNoFeature('lists', async () => {
        wildflower.store('walkB', { state: { rows: [{ id: 1, t: 'x' }, { id: 2, t: 'y' }], label: 'one' } })
        wildflower.component('walk-b', { state: {} })

        container.innerHTML = `
            <div data-component="walk-b">
                <h1 id="standalone" data-bind="$walkB.label"></h1>
                <ul data-list="$walkB.rows"><template><li><span data-bind="t"></span></li></template></ul>
                <p id="deep"><em><span id="nested" data-bind="$walkB.label"></span></em></p>
            </div>
        `
        await settle(wildflower)
        expect(container.querySelectorAll('li').length).toBe(2)
        expect(container.querySelector('#standalone').textContent).toBe('one')
        expect(container.querySelector('#nested').textContent).toBe('one')

        wildflower.getStore('walkB').label = 'two'
        await settle(wildflower)

        expect(container.querySelector('#standalone').textContent, 'shallow standalone binding').toBe('two')
        expect(container.querySelector('#nested').textContent, 'deeply nested standalone binding').toBe('two')
        // List rows keep rendering their own item data (owned by the sibling walk).
        expect(Array.from(container.querySelectorAll('li span')).map((e) => e.textContent)).toEqual(['x', 'y'])
    }))

    it('collector predicate matches the legacy retained set exactly', skipIfNoFeature('lists', async () => {
        // White-box pin on the predicate itself, on hand-built DOM — no render
        // machinery, so it states the contract directly rather than inferring it
        // from paint. Mirrors the dev-build differential oracle, which runs this
        // same comparison on every real invocation across the whole suite.
        const root = document.createElement('div')
        root.innerHTML = `
            <span id="a" data-bind="$s.x"></span>
            <ul id="listroot" data-list="$s.rows" data-bind-class="$s.theme">
                <li id="interior" data-bind="$s.x"></li>
            </ul>
            <section><em id="deep" data-bind="$s.x"></em></section>
            <span id="plain" data-bind="localOnly"></span>
        `
        container.appendChild(root)

        const walked = wildflower._collectStandaloneExternalBindings(root)
        const ids = (arr) => arr.map((e) => e.id)

        // The list ROOT is retained (its own list attribute never excluded it);
        // its INTERIOR is not. `localOnly` has no external ref, so it is absent.
        expect(ids(walked.bind), 'text bindings: standalone kept, list interior pruned').toEqual(['a', 'deep'])
        expect(ids(walked.cls), 'a list root carrying its own external binding is retained').toEqual(['listroot'])

        // Same shape, but the root ITSELF carries data-list: the legacy parent
        // loop stopped AT the root, so a root list attribute must not prune.
        const listRoot = document.createElement('div')
        listRoot.setAttribute('data-list', '$s.rows')
        listRoot.innerHTML = `<span id="child" data-bind="$s.x"></span>`
        container.appendChild(listRoot)
        expect(ids(wildflower._collectStandaloneExternalBindings(listRoot).bind),
            'a component root that is itself a list still yields its descendants').toEqual(['child'])
    }))

    it('keeps external attr/style bindings outside lists live', skipIfNoFeature('lists', async () => {
        wildflower.store('walkD', { state: { rows: [{ id: 1, t: 'q' }], w: '10px', title: 'first' } })
        wildflower.component('walk-d', { state: {} })

        container.innerHTML = `
            <div data-component="walk-d">
                <div id="styled" data-bind-style="{ width: $walkD.w }"></div>
                <div id="attred" data-bind-attr="{ title: $walkD.title }"></div>
                <ul data-list="$walkD.rows"><template><li data-bind="t"></li></template></ul>
            </div>
        `
        await settle(wildflower)
        expect(container.querySelector('#styled').style.width).toBe('10px')
        expect(container.querySelector('#attred').getAttribute('title')).toBe('first')

        const store = wildflower.getStore('walkD')
        store.w = '40px'
        store.title = 'second'
        await settle(wildflower)

        expect(container.querySelector('#styled').style.width, 'standalone style binding').toBe('40px')
        expect(container.querySelector('#attred').getAttribute('title'), 'standalone attr binding').toBe('second')
    }))

    it('collector cost does not scale with list length', skipIfNoFeature('lists', async () => {
        // Slope pin, not a threshold: the walk visits one node per list root
        // regardless of row count, so collection at 800 rows must cost about
        // the same as at 25. A regression to whole-subtree querying shows up
        // here as a ratio that tracks row count.
        const build = (n) => {
            const rows = []
            for (let i = 0; i < n; i++) rows.push({ id: i + 1, t: 't' + i })
            return rows
        }
        wildflower.store('walkE', { state: { rows: build(25), label: 'L' } })
        wildflower.component('walk-e', { state: {} })
        container.innerHTML = `
            <div data-component="walk-e">
                <h1 data-bind="$walkE.label"></h1>
                <ul data-list="$walkE.rows"><template><li><span data-bind="t"></span></li></template></ul>
            </div>
        `
        await settle(wildflower)

        const el = container.querySelector('[data-component="walk-e"]')
        const collect = (times) => {
            const t0 = performance.now()
            for (let i = 0; i < times; i++) wildflower._collectStandaloneExternalBindings(el)
            return performance.now() - t0
        }

        collect(200) // warm
        const small = collect(2000)

        wildflower.getStore('walkE').rows = build(800)
        await settle(wildflower)
        expect(container.querySelectorAll('li').length).toBe(800)

        collect(200) // warm
        const large = collect(2000)

        // Generous bound: this is catching O(rows), which would be ~30x here.
        expect(large, `collection must not scale with rows (25 rows: ${small.toFixed(1)}ms, 800 rows: ${large.toFixed(1)}ms)`)
            .toBeLessThan(small * 5 + 5)
    }))
})
