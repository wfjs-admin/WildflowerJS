/**
 * Nested child lists unmounting INSIDE a parent apply — the mid-flush shape
 * the quiescent churn test (list-stable-effect-unmount-churn) does not reach.
 *
 * NMU-A: the parent dispatcher's render arm (synchronous, in the set trap)
 * flips a row's detail subtree off; the child data-list inside it detaches
 * mid-apply. Detached-but-live semantics (synopsis invariant #6): the child
 * keeps receiving applies behind its placeholder, and re-reveal must show
 * values written WHILE hidden (nested revealed-subtree freshness).
 *
 * NMU-B: the reviewer's exact shape — a SHARED store dep read by an item
 * computed that gates data-render; flipping the store field wakes the parent
 * list's STABLE effect, whose synchronous re-apply flips every row's render
 * off, unmounting ALL child lists inside the stable effect's own run. Then a
 * full teardown retention probe: after destroyComponent, store writes must
 * evaluate zero item computeds.
 *
 * External review 2026-07-04 round 2, gap (A).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Nested child-list unmount inside a parent apply', () => {
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

    it('NMU-A. render-arm flip detaches a child list mid-apply; re-reveal shows values written while hidden', async () => {
        wildflower.component('nmu-a', {
            state: {
                items: [
                    { id: 1, name: 'p1', showSubs: true, subs: [{ id: 11, tag: 's11' }, { id: 12, tag: 's12' }] },
                    { id: 2, name: 'p2', showSubs: true, subs: [{ id: 21, tag: 's21' }] },
                ]
            },
            init() { window.__nmuA = this }
        })
        testContainer.innerHTML = `
            <div data-component="nmu-a">
                <ul data-list="items" data-key="id">
                    <template>
                        <li>
                            <span class="pname" data-bind="name"></span>
                            <div class="detail" data-render="showSubs">
                                <ul class="subs" data-list="subs" data-key="id">
                                    <template>
                                        <li class="sub" data-bind="tag"></li>
                                    </template>
                                </ul>
                            </div>
                        </li>
                    </template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const instance = window.__nmuA
        expect(testContainer.querySelectorAll('.sub').length).toBe(3)

        // Flip off: the render arm runs synchronously inside the item write's
        // set trap; the child list detaches inside that apply. Must not throw,
        // must not disturb the sibling row's child list.
        instance.state.items[0].showSubs = false
        await waitForCompleteRender()
        expect(testContainer.querySelectorAll('li')[0].querySelector('.sub')).toBeNull()
        expect(testContainer.querySelectorAll('.sub').length).toBe(1) // row 2 intact

        // Mutate the hidden child's data (detached-but-live must track it),
        // then re-reveal: the subtree must be FRESH, not a stale snapshot.
        instance.state.items[0].subs[0].tag = 'edited-hidden'
        instance.state.items[0].subs.push({ id: 13, tag: 's13-new' })
        await waitForCompleteRender()

        instance.state.items[0].showSubs = true
        await waitForCompleteRender()
        const row0subs = testContainer.querySelectorAll('li')[0].querySelectorAll('.sub')
        expect(row0subs.length).toBe(3)
        expect(row0subs[0].textContent).toBe('edited-hidden')
        expect(row0subs[2].textContent).toBe('s13-new')
    })

    it('NMU-B. store-driven stable-effect re-apply unmounts ALL child lists mid-run; teardown then evaluates zero computeds', async () => {
        window.__nmuEvals = 0
        wildflower.store('nmu-cfg', { state: { on: true } })
        // subVisible is an item computed reading a SHARED store dep: the store
        // read gives the parent list's stable effect its external edge, so
        // flipping cfg.on drives the flip through the stable effect's own
        // synchronous full-row re-applies (the reviewer's mid-flush shape).
        wildflower.component('nmu-b', {
            state: {
                items: [
                    { id: 1, showSubs: true, subs: [{ id: 11, tag: 'b11' }] },
                    { id: 2, showSubs: true, subs: [{ id: 21, tag: 'b21' }] },
                    { id: 3, showSubs: true, subs: [{ id: 31, tag: 'b31' }] },
                ]
            },
            subscribe: { 'nmu-cfg': [] },
            computed: {
                subVisible(item) {
                    window.__nmuEvals++
                    return item.showSubs && this.stores['nmu-cfg'].on
                }
            },
            init() { window.__nmuB = this }
        })
        testContainer.innerHTML = `
            <div data-component="nmu-b">
                <ul data-list="items" data-key="id">
                    <template>
                        <li>
                            <div class="detail" data-render="subVisible">
                                <ul data-list="subs" data-key="id">
                                    <template>
                                        <li class="sub" data-bind="tag"></li>
                                    </template>
                                </ul>
                            </div>
                        </li>
                    </template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const store = wildflower.getStore('nmu-cfg')
        expect(testContainer.querySelectorAll('.sub').length).toBe(3)

        // One store write -> stable effect wakes -> every row's render arm
        // flips off -> three child lists unmount inside the effect's run.
        store.on = false
        await waitForCompleteRender()
        expect(testContainer.querySelectorAll('.sub').length).toBe(0)

        // Edit hidden children, then restore: all three revive fresh.
        const instance = window.__nmuB
        instance.state.items[1].subs[0].tag = 'b21-hidden-edit'
        await waitForCompleteRender()
        store.on = true
        await waitForCompleteRender()
        const subs = testContainer.querySelectorAll('.sub')
        expect(subs.length).toBe(3)
        expect(subs[1].textContent).toBe('b21-hidden-edit')

        // Full-teardown retention probe (mid-flush lifecycle variant of
        // SEC-A): destroy while everything is live, then poke both the store
        // dep and child data — nothing may evaluate.
        const el = testContainer.querySelector('[data-component="nmu-b"]')
        wildflower.destroyComponent(el.dataset.componentId)
        el.remove()
        await waitForCompleteRender()

        window.__nmuEvals = 0
        store.on = false
        store.on = true
        await waitForCompleteRender()
        expect(window.__nmuEvals).toBe(0)
    })
})
