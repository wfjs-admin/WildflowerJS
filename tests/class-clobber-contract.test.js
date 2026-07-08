/**
 * Convergence regression guard for the binding-kernel CLASS slice (applyClass).
 *
 * The CLASS slice routes ListItemBinding's class-application paths through the
 * BindingWriters.applyClass leaf-writer. applyClass diff-tracks via
 * element._prevBoundClasses: it removes only the classes it previously applied
 * and preserves every non-bound class (static template classes, .wf-show, other
 * bindings). It replaces a dead compiled-rebind path that used
 * `el.className = value` (a full replace that would have wiped non-bound classes).
 *
 * These tests exercise the LIVE list-row class-update path and lock in the
 * preserve-non-bound + clear-on-empty contract the kernel writer must hold. They
 * do not fail against pre-fix HEAD (the live _toggleBoundClass path already
 * diff-tracked correctly); they guard against a future regression in the writer.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('data-bind-class clobber contract (compiled-rebind / computed: path)', () => {
    let testContainer
    let cleanup
    let componentRef

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
        componentRef = null
    })

    afterEach(() => {
        if (cleanup) cleanup()
    })

    it('preserves a static template class when a string class binding changes', async () => {
        wildflower.component('cc-static', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                shares: { a: true },
            },
            computed: {
                // Item-level (fn.length > 0) string-returning class computed.
                // Returns ONLY the dynamic class; 'card' stays a static template class.
                extraClass(item) { return this.state.shares[item.id] ? 'shared' : '' }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="cc-static">
                <ul data-list="items" data-key="id">
                    <template>
                        <li class="card" data-bind-class="computed:extraClass" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards.length).toBe(2)
        // Initial: both keep static 'card'; only card0 has 'shared'.
        expect(cards[0].classList.contains('card')).toBe(true)
        expect(cards[0].classList.contains('shared')).toBe(true)
        expect(cards[1].classList.contains('card')).toBe(true)
        expect(cards[1].classList.contains('shared')).toBe(false)

        // Change the bound class on card1 (gains 'shared') and card0 (loses 'shared').
        componentRef.state.shares.b = true
        componentRef.state.shares.a = false
        await waitForCompleteRender()

        // The static 'card' class MUST survive on both rows (className= would wipe it).
        expect(cards[0].classList.contains('card')).toBe(true)
        expect(cards[1].classList.contains('card')).toBe(true)
        // Bound class tracks the new state.
        expect(cards[0].classList.contains('shared')).toBe(false)
        expect(cards[1].classList.contains('shared')).toBe(true)
    })

    it('clears a string class binding without touching non-bound classes', async () => {
        wildflower.component('cc-clear', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }],
                on: true,
            },
            computed: {
                flag(item) { return this.state.on ? 'lit' : '' }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="cc-clear">
                <ul data-list="items" data-key="id">
                    <template>
                        <li class="card base" data-bind-class="computed:flag" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const li = testContainer.querySelector('li')
        expect(li.classList.contains('lit')).toBe(true)

        // Bound class goes empty: 'lit' removed, static 'card'/'base' preserved.
        componentRef.state.on = false
        await waitForCompleteRender()

        expect(li.classList.contains('lit')).toBe(false)
        expect(li.classList.contains('card')).toBe(true)
        expect(li.classList.contains('base')).toBe(true)
    })
})
