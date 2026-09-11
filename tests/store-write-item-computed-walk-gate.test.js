import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

/**
 * Store-write cost gate: the per-row item-computed refresh walk must not run
 * for components that have no item-level (parameterized) computeds.
 *
 * Measured 2026-08-24: every store write reaching a dependent component with a
 * rendered list walked EVERY row and called _refreshListItemComputedBindings on
 * it, which issues ~5-6 querySelectorAll per row. Cost was ~191ns x row count
 * per write, and it fired even when the written field was unrelated to the
 * list, read by nothing, and the component declared zero item-level computeds
 * (in which case every mutation inside the refresh body is already skipped by
 * its own isItemLevelComputed guard, so the walk did DOM queries and nothing
 * else). A 1,000-row list plus a search box paid ~191us per keystroke.
 *
 * The gate hoists that per-binding condition to the loop: instances record
 * _hasItemComputeds where the computed registry is built, and the walk is
 * skipped when it is false. These pins hold both halves: the walk is skipped
 * when it cannot do anything, and still runs (and still repaints) when it can.
 *
 * Instrumentation note: the "did the walk run" half spies on
 * _refreshListItemComputedBindings, which is listed in mangle-properties.json
 * and is therefore renamed out of every *.min.js build (verified: 0 occurrences
 * in wildflower.full.min.js, 3 in wildflower.full.dev.js). A spy installed
 * under the source name there never fires, which made the walk-runs assertion
 * FAIL on minified builds and its walk-skipped sibling pass for no reason at
 * all. So the call-count assertions run only where the name survives, and the
 * observable half — bindings actually repaint — is pinned separately and runs
 * everywhere, which is the half that matters most in a production build.
 */

async function settle(wf, ms = 50) {
    if (wf?._forceCompleteRender) await wf._forceCompleteRender()
    await new Promise((resolve) => setTimeout(resolve, ms))
}

// Call-count assertions need the un-mangled method name (see the header note).
const spyIt = isMinifiedBuild() ? it.skip : it

describe('store write: item-computed refresh walk gate', () => {
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

    function spyOnWalk() {
        const proto = Object.getPrototypeOf(wildflower)
        const original = proto._refreshListItemComputedBindings
        const calls = { count: 0 }
        proto._refreshListItemComputedBindings = function (...args) {
            calls.count++
            return original.apply(this, args)
        }
        calls.restore = () => { proto._refreshListItemComputedBindings = original }
        return calls
    }

    spyIt('skips the per-row walk when the component declares no item-level computeds', async () => {
        wildflower.store('gateA', {
            state: {
                rows: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }],
                unrelated: 'x'
            }
        })
        // No computed at all, so nothing the walk could ever repaint.
        wildflower.component('gate-a', { state: {} })

        container.innerHTML = `
            <div data-component="gate-a">
                <ul data-list="$gateA.rows"><template><li><span data-bind="text"></span></li></template></ul>
            </div>
        `
        await settle(wildflower)
        expect(container.querySelectorAll('li').length).toBe(3)

        const spy = spyOnWalk()
        try {
            // A write to a field the list does not use and nothing reads.
            wildflower.getStore('gateA').unrelated = 'y'
            await settle(wildflower)
        } finally {
            spy.restore()
        }

        expect(spy.count, 'per-row refresh walk ran despite no item-level computeds').toBe(0)
    })

    // Split from the call-count pin below so the observable half — the one that
    // would actually be noticed by a user — holds in production builds too.
    it('repaints item-level computed bindings when the store they read changes', async () => {
        wildflower.store('gateBr', {
            state: {
                rows: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }],
                suffix: '!'
            }
        })
        wildflower.component('gate-br', {
            state: {},
            computed: {
                label(item) {
                    return item.name + wildflower.getStore('gateBr').suffix
                }
            }
        })

        container.innerHTML = `
            <div data-component="gate-br">
                <ul data-list="$gateBr.rows"><template><li><span class="lbl" data-bind="computed:label"></span></li></template></ul>
            </div>
        `
        await settle(wildflower)

        const labels = () => Array.from(container.querySelectorAll('.lbl')).map((el) => el.textContent)
        expect(labels()).toEqual(['one!', 'two!'])

        wildflower.getStore('gateBr').suffix = '?'
        await settle(wildflower)

        expect(labels(), 'item-level computed bindings must repaint on store change').toEqual(['one?', 'two?'])
    })

    spyIt('still runs the walk and repaints when an item-level computed exists', async () => {
        wildflower.store('gateB', {
            state: {
                rows: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }],
                suffix: '!'
            }
        })
        // Parameterized computed => item-level => the walk is load-bearing here.
        wildflower.component('gate-b', {
            state: {},
            computed: {
                label(item) {
                    return item.name + wildflower.getStore('gateB').suffix
                }
            }
        })

        container.innerHTML = `
            <div data-component="gate-b">
                <ul data-list="$gateB.rows"><template><li><span class="lbl" data-bind="computed:label"></span></li></template></ul>
            </div>
        `
        await settle(wildflower)

        const labels = () => Array.from(container.querySelectorAll('.lbl')).map((el) => el.textContent)
        expect(labels()).toEqual(['one!', 'two!'])

        const spy = spyOnWalk()
        try {
            wildflower.getStore('gateB').suffix = '?'
            await settle(wildflower)
        } finally {
            spy.restore()
        }

        expect(spy.count, 'walk must still run for item-level computeds').toBeGreaterThan(0)
        expect(labels(), 'item-level computed bindings must repaint on store change').toEqual(['one?', 'two?'])
    })

    it('marks _hasItemComputeds only when a parameterized computed is declared', async () => {
        wildflower.store('gateC', { state: { rows: [{ id: 1, name: 'n' }], tick: 0 } })
        wildflower.component('gate-c-none', { state: {}, computed: { plain() { return 1 } } })
        wildflower.component('gate-c-item', { state: {}, computed: { withItem(item) { return item.name } } })

        container.innerHTML = `
            <div data-component="gate-c-none" id="none"></div>
            <div data-component="gate-c-item" id="item"></div>
        `
        await settle(wildflower)

        // The flag lives on the stateManager, beside the computed registry it
        // summarizes (the instance does not reliably exist yet at setup time).
        const smOf = (id) => {
            const el = container.querySelector('#' + id)
            return wildflower.componentInstances.get(el.dataset.componentId).stateManager
        }
        // A zero-arg computed is component-level and cannot be refreshed per row.
        expect(!!smOf('none')._hasItemComputeds, 'zero-arg computed must not set the flag').toBe(false)
        expect(!!smOf('item')._hasItemComputeds, 'parameterized computed must set the flag').toBe(true)
    })
})
