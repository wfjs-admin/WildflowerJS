/**
 * Regression tests for binding-drop-out clearing.
 *
 * When a list-item binding's evaluated object drops a key (e.g.
 * `assigneeStyle(item)` returns `{}` after the assignee is set back to
 * null), the framework must CLEAR the previously-applied style/attr/class
 * from the element — not leave it on. PM tracker hit this when an
 * assignee was unassigned: style was the last-applied colour, but
 * class+text correctly reverted to empty, producing a "color circle with
 * dashed border and no initials".
 *
 * Tests cover all three binding types (style, attr, class) across the
 * paths they can take:
 *   - _applyObjectBinding (slow path; inline expressions)
 *   - _applyStyleBindingsToRow / _applyAttrBindingsToRow (row-level
 *     evaluator fast path; computed-name bindings)
 *   - _executeClassBindings (class binding via _toggleBoundClass)
 *
 * Note: `_applyClassBindingsToRow` is additive-only at the source level,
 * which initially looked like a parallel bug — but in practice no class
 * binding pattern routes through it with drop-out semantics. Class
 * bindings that need diff/remove all go through `_executeClassBindings`,
 * which delegates to `_toggleBoundClass`. Tests below confirm.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Binding drop-out clearing', () => {
    let testContainer
    let cleanup

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    it('row-evaluator fast-path: data-bind-style clears dropped key when computed returns {}', async () => {
        // Mirrors the PM-tracker avatar bug: assigneeStyle returns
        // {background: color} when assigned, {} when unassigned.
        wildflower.component('drop-style-row', {
            state: {
                items: [{ id: 'a', assignee: null }]
            },
            computed: {
                avatarStyle(item) {
                    return item.assignee ? { background: '#ff0000' } : {}
                }
            },
            assignA() { this.state.items[0].assignee = 'user-1' },
            unassignA() { this.state.items[0].assignee = null }
        })

        testContainer.innerHTML = `
            <div data-component="drop-style-row">
                <div data-list="items" data-key="id">
                    <template>
                        <span class="dot" data-bind-style="avatarStyle"></span>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const dot = testContainer.querySelector('.dot')

        // Initially unassigned — no background.
        expect(dot.style.background).toBe('')

        // Assign — background applied.
        wildflower.getComponentsByType('drop-style-row')[0].context.assignA()
        await waitForCompleteRender()
        expect(dot.style.background).toContain('rgb(255, 0, 0)')

        // Unassign — background MUST clear (was the bug).
        wildflower.getComponentsByType('drop-style-row')[0].context.unassignA()
        await waitForCompleteRender()
        expect(dot.style.background).toBe('')
    })

    it('row-evaluator fast-path: data-bind-attr clears dropped key when computed returns {}', async () => {
        wildflower.component('drop-attr-row', {
            state: {
                items: [{ id: 'a', pressed: false }]
            },
            computed: {
                ariaState(item) {
                    return item.pressed ? { 'aria-pressed': 'true' } : {}
                }
            },
            press() { this.state.items[0].pressed = true },
            release() { this.state.items[0].pressed = false }
        })

        testContainer.innerHTML = `
            <div data-component="drop-attr-row">
                <div data-list="items" data-key="id">
                    <template>
                        <button class="b" data-bind-attr="ariaState"></button>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const btn = testContainer.querySelector('.b')

        expect(btn.hasAttribute('aria-pressed')).toBe(false)

        wildflower.getComponentsByType('drop-attr-row')[0].context.press()
        await waitForCompleteRender()
        expect(btn.getAttribute('aria-pressed')).toBe('true')

        // Drop-out: aria-pressed MUST be removed (was the bug).
        wildflower.getComponentsByType('drop-attr-row')[0].context.release()
        await waitForCompleteRender()
        expect(btn.hasAttribute('aria-pressed')).toBe(false)
    })

    it('inline-expression path (_applyObjectBinding): style clears dropped key', async () => {
        // This exercises the slower _processObjectBinding path (inline
        // object expression rather than a computed name reference).
        wildflower.component('drop-style-inline', {
            state: {
                items: [{ id: 'a', on: true }]
            },
            toggle() { this.state.items[0].on = !this.state.items[0].on }
        })

        testContainer.innerHTML = `
            <div data-component="drop-style-inline">
                <div data-list="items" data-key="id">
                    <template>
                        <span class="dot" data-bind-style="on ? { background: '#00ff00' } : {}"></span>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const dot = testContainer.querySelector('.dot')
        expect(dot.style.background).toContain('rgb(0, 255, 0)')

        wildflower.getComponentsByType('drop-style-inline')[0].context.toggle()
        await waitForCompleteRender()
        expect(dot.style.background).toBe('')
    })

    // Class drop-out scenarios — verify all the common patterns clear
    // correctly. The originally-suspected bug in `_applyClassBindingsToRow`
    // turned out NOT to manifest in practice because class bindings with
    // drop-out semantics route through `_executeClassBindings`, which
    // delegates to `_toggleBoundClass` (handles diff/remove correctly).

    it('class drop-out: object form `{is-active: cond}` clears when cond goes false', async () => {
        wildflower.component('class-obj-form', {
            state: { items: [{ id: 'a', on: true }] },
            toggle() { this.state.items[0].on = !this.state.items[0].on }
        })
        testContainer.innerHTML = `
            <div data-component="class-obj-form">
                <div data-list="items" data-key="id">
                    <template>
                        <span class="dot" data-bind-class="{ 'is-active': on }"></span>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()
        const dot = testContainer.querySelector('.dot')
        expect(dot.classList.contains('is-active')).toBe(true)

        wildflower.getComponentsByType('class-obj-form')[0].context.toggle()
        await waitForCompleteRender()
        expect(dot.classList.contains('is-active')).toBe(false)
    })

    it('class drop-out: computed returning string drops a class when state changes', async () => {
        wildflower.component('class-computed-string', {
            state: { items: [{ id: 'a', completed: false, priority: 'High' }] },
            computed: {
                cls(item) {
                    return item.completed
                        ? 'bg-light border-success'
                        : 'border-primary' // 'bg-light' and 'border-success' drop
                }
            },
            complete() { this.state.items[0].completed = true },
            uncomplete() { this.state.items[0].completed = false }
        })
        testContainer.innerHTML = `
            <div data-component="class-computed-string">
                <div data-list="items" data-key="id">
                    <template>
                        <div class="card" data-bind-class="computed:cls"></div>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()
        const card = testContainer.querySelector('.card')

        expect(card.classList.contains('border-primary')).toBe(true)
        expect(card.classList.contains('bg-light')).toBe(false)

        wildflower.getComponentsByType('class-computed-string')[0].context.complete()
        await waitForCompleteRender()
        expect(card.classList.contains('bg-light')).toBe(true)
        expect(card.classList.contains('border-success')).toBe(true)
        expect(card.classList.contains('border-primary')).toBe(false) // dropped

        wildflower.getComponentsByType('class-computed-string')[0].context.uncomplete()
        await waitForCompleteRender()
        expect(card.classList.contains('bg-light')).toBe(false) // dropped
        expect(card.classList.contains('border-success')).toBe(false) // dropped
        expect(card.classList.contains('border-primary')).toBe(true)
    })
})
