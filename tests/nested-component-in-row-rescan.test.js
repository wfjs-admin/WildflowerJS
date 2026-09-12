/**
 * @vitest-environment browser
 *
 * Review finding: a component
 * nested inside ANOTHER component's list row must keep its own bindings
 * across a meta rescan.
 *
 * The rescan's list-interior exclusion in _collectComponentBindingMeta
 * exists so a component's OWN rendered rows stay row-owned (the Conduit
 * avatar paint-then-revert case, pinned in list-row-decor-render-rescan).
 * But the ancestor walk is not ownership-scoped by itself: for the
 * supported one-component-per-row pattern, every element of the nested
 * component finds the PARENT's list container as its closest list
 * ancestor. Unscoped, that excluded the nested component's entire subtree
 * from its own meta, so any rescan trigger — its own data-render toggle,
 * a portal, a props refresh — silently dropped every data-bind it had.
 * The exclusion must ask WHOSE list it found, exactly as the init-time
 * guard in _processConditionalElements does.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 80) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe('Nested component in a list row: meta rescan', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
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

    it('keeps its data-bind live after its own data-render toggle', async () => {
        wildflower.component('rescan-row-parent', {
            state: { rows: [{ id: 1 }] }
        })
        wildflower.component('rescan-row-child', {
            state: { label: 'first', open: false }
        })

        testContainer.innerHTML = `
            <div data-component="rescan-row-parent">
                <div data-list="rows"><template><div data-component="rescan-row-child">
                    <span class="lbl" data-bind="label"></span>
                    <div data-render="open"><em class="extra">extra</em></div>
                </div></template></div>
            </div>
        `
        ensureComponentScanning(wildflower)
        wildflower.scan(testContainer)
        await waitForUpdate(150)

        const lbl = testContainer.querySelector('.lbl')
        expect(lbl, 'row rendered with the nested component').not.toBeNull()
        expect(lbl.textContent).toBe('first')

        const childEl = testContainer.querySelector('[data-component="rescan-row-child"]')
        const child = wildflower.componentInstances.get(childEl.dataset.componentId)
        expect(child, 'child instance exists').toBeTruthy()

        // Calibration: the binding is live before any rescan.
        child.state.label = 'pre-toggle'
        await waitForUpdate()
        expect(lbl.textContent, 'binding live before the data-render toggle').toBe('pre-toggle')

        // The child's own data-render toggle walks the rescan path
        // (ContextRecords -> _collectComponentBindingMeta).
        child.state.open = true
        await waitForUpdate(150)
        expect(testContainer.querySelector('.extra'), 'data-render revealed its block').not.toBeNull()

        child.state.label = 'post-toggle'
        await waitForUpdate(150)
        expect(lbl.textContent, 'data-bind must survive the rescan').toBe('post-toggle')

        // And the data-render itself still works both ways after that.
        child.state.open = false
        await waitForUpdate(150)
        expect(testContainer.querySelector('.extra'), 'data-render re-hides').toBeNull()
        child.state.label = 'final'
        await waitForUpdate(150)
        expect(lbl.textContent, 'binding still live after a second rescan').toBe('final')
    })

    it('a nested component with its OWN list keeps that list row-owned on rescan', async () => {
        // The other direction, so the fix cannot overcorrect: when the
        // rescanned component owns the list, row interiors stay excluded
        // from component meta (they are row-owned; re-collecting them
        // re-evaluates row expressions in component scope — the Conduit
        // paint-then-revert). data-bind inside this component's own row
        // must still render item values after the component's rescan.
        wildflower.component('rescan-own-list', {
            state: {
                open: false,
                items: [{ id: 1, name: 'ada' }, { id: 2, name: 'grace' }]
            }
        })

        testContainer.innerHTML = `
            <div data-component="rescan-own-list">
                <div data-render="open"><em class="extra">extra</em></div>
                <ul data-list="items"><template><li class="row" data-bind="name"></li></template></ul>
            </div>
        `
        ensureComponentScanning(wildflower)
        wildflower.scan(testContainer)
        await waitForUpdate(150)

        const rowTexts = () => [...testContainer.querySelectorAll('.row')].map(e => e.textContent)
        expect(rowTexts()).toEqual(['ada', 'grace'])

        const el = testContainer.querySelector('[data-component="rescan-own-list"]')
        const inst = wildflower.componentInstances.get(el.dataset.componentId)

        // Trigger the component's own rescan, then verify rows still
        // render item-scope values (not component-scope undefined).
        inst.state.open = true
        await waitForUpdate(150)
        expect(testContainer.querySelector('.extra')).not.toBeNull()
        expect(rowTexts(), 'rows keep item-scope values after the rescan').toEqual(['ada', 'grace'])

        inst.state.items = [{ id: 1, name: 'ada' }, { id: 2, name: 'hopper' }]
        await waitForUpdate(150)
        expect(rowTexts(), 'list updates still work after the rescan').toEqual(['ada', 'hopper'])
    })
})
