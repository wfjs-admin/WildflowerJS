/**
 * Companion tests to list-item-computed-class-binding-gaps.test.js.
 *
 * The class-binding fix in commit 2fe7b45 covers `data-bind-class` only.
 * The same chain of issues (item-level computed not evaluated in expressions,
 * object-literal results stringified to "[object Object]", per-item dep
 * tracking missed for sibling-state reads inside item-level computeds)
 * almost certainly affects every other binding type that supports
 * expressions in list-template scope.
 *
 * These tests reproduce the bug across `data-bind-style`, `data-bind-attr`,
 * `data-show`, `data-bind`, and `data-render`. They are EXPECTED TO FAIL
 * before the follow-up fix and EXPECTED TO PASS after.
 *
 * See docs/future/LIST_ITEM_COMPUTED_BINDING_GAPS_OTHER_BINDINGS_PLAN.md
 * for the fix specification.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Item-level computed bug across non-class bindings (Claude Design follow-up)', () => {
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

    // -----------------------------------------------------------------------
    // data-bind-style — object syntax with item-level computed
    // -----------------------------------------------------------------------

    it('STYLE-A. data-bind-style object syntax + item-level computed (initial render)', async () => {
        wildflower.component('style-A', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                themes: { a: 'red', b: 'blue' },
            },
            computed: {
                itemColor(item) { return this.state.themes[item.id] || 'black' }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="style-A">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind-style="({ color: itemColor })" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards.length).toBe(2)
        expect(cards[0].style.color).toBe('red')
        expect(cards[1].style.color).toBe('blue')
    })

    it('STYLE-B. data-bind-style reacts to nested-state mutation', async () => {
        wildflower.component('style-B', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                themes: { a: 'red' },
            },
            computed: {
                itemColor(item) { return this.state.themes[item.id] || 'black' }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="style-B">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind-style="({ color: itemColor })" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        componentRef.state.themes.b = 'green'
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards[1].style.color).toBe('green')
    })

    // -----------------------------------------------------------------------
    // data-bind-attr — object syntax with item-level computed
    // -----------------------------------------------------------------------

    it('ATTR-A. data-bind-attr object syntax + item-level computed (initial render)', async () => {
        wildflower.component('attr-A', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                pressed: { a: true },
            },
            computed: {
                isPressed(item) { return !!this.state.pressed[item.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="attr-A">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind-attr="({ 'aria-pressed': isPressed })" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards.length).toBe(2)
        expect(cards[0].getAttribute('aria-pressed')).toBe('true')
        // For falsy values, attribute should either be absent or 'false'
        const c1 = cards[1].getAttribute('aria-pressed')
        expect(c1 === null || c1 === 'false').toBe(true)
    })

    it('ATTR-B. data-bind-attr reacts to nested-state mutation', async () => {
        wildflower.component('attr-B', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                pressed: { a: true },
            },
            computed: {
                isPressed(item) { return !!this.state.pressed[item.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="attr-B">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind-attr="({ 'aria-pressed': isPressed })" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        componentRef.state.pressed.b = true
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards[1].getAttribute('aria-pressed')).toBe('true')
    })

    // -----------------------------------------------------------------------
    // data-show — expression with item-level computed
    // -----------------------------------------------------------------------

    it('SHOW-A. data-show expression with item-level computed (initial render)', async () => {
        wildflower.component('show-A', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                visibility: { a: true },
            },
            computed: {
                isVisible(item) { return !!this.state.visibility[item.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="show-A">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-show="isVisible && true" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards.length).toBe(2)
        // First item visible, second hidden (display: none or similar)
        const c0Style = window.getComputedStyle(cards[0])
        const c1Style = window.getComputedStyle(cards[1])
        expect(c0Style.display).not.toBe('none')
        expect(c1Style.display).toBe('none')
    })

    it('SHOW-B. data-show reacts to nested-state mutation', async () => {
        wildflower.component('show-B', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                visibility: { a: true },
            },
            computed: {
                isVisible(item) { return !!this.state.visibility[item.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="show-B">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-show="isVisible && true" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        componentRef.state.visibility.b = true
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        const c1Style = window.getComputedStyle(cards[1])
        expect(c1Style.display).not.toBe('none')
    })

    // -----------------------------------------------------------------------
    // data-bind — text expression with item-level computed
    // -----------------------------------------------------------------------

    it('BIND-A. data-bind ternary with item-level computed (initial render)', async () => {
        wildflower.component('bind-A', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                badges: { a: 'NEW' },
            },
            computed: {
                badge(item) { return this.state.badges[item.id] || '' }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="bind-A">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind="badge ? '[' + badge + '] ' + name : name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards.length).toBe(2)
        expect(cards[0].textContent).toBe('[NEW] Alpha')
        expect(cards[1].textContent).toBe('Beta')
    })

    it('BIND-B. data-bind reacts to nested-state mutation', async () => {
        wildflower.component('bind-B', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                badges: { a: 'NEW' },
            },
            computed: {
                badge(item) { return this.state.badges[item.id] || '' }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="bind-B">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind="badge ? '[' + badge + '] ' + name : name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        componentRef.state.badges.b = 'HOT'
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards[1].textContent).toBe('[HOT] Beta')
    })

    // -----------------------------------------------------------------------
    // data-render — conditional render with item-level computed
    // -----------------------------------------------------------------------

    it('RENDER-A. data-render expression with item-level computed (initial render)', async () => {
        wildflower.component('render-A', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                renderable: { a: true },
            },
            computed: {
                shouldRender(item) { return !!this.state.renderable[item.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="render-A">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-render="shouldRender && true" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        // Only one item should be in the DOM (shouldRender = true for 'a' only)
        // data-render REMOVES the element, unlike data-show which only hides it
        const visibleItems = testContainer.querySelectorAll('li')
        // Either 1 item rendered, or 2 items but second is unrendered (no name text)
        const renderedCount = Array.from(visibleItems).filter(el => el.textContent.trim() !== '').length
        expect(renderedCount).toBe(1)
    })

    it('RENDER-B. data-render reacts to nested-state mutation', async () => {
        wildflower.component('render-B', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                renderable: { a: true },
            },
            computed: {
                shouldRender(item) { return !!this.state.renderable[item.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="render-B">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-render="shouldRender && true" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        // Initial assertion verifies the bug fix: only item 'a' should render
        // initially (state.renderable = { a: true }). Without this assertion the
        // test would pass even if both items always rendered — see the plan doc
        // for why this previously "passed accidentally".
        const initialItems = testContainer.querySelectorAll('li')
        const initialRendered = Array.from(initialItems).filter(el => el.textContent.trim() !== '').length
        expect(initialRendered).toBe(1)

        componentRef.state.renderable.b = true
        await waitForCompleteRender()

        const visibleItems = testContainer.querySelectorAll('li')
        const renderedCount = Array.from(visibleItems).filter(el => el.textContent.trim() !== '').length
        expect(renderedCount).toBe(2)
    })

    // -----------------------------------------------------------------------
    // Nested lists — item-level computed receives the INNER item (not the outer)
    // and `this.X` shortcut resolves through state/computed.
    // -----------------------------------------------------------------------

    it('NESTED-A. item-level computed in a nested list receives the inner item', async () => {
        wildflower.component('nested-A', {
            state: {
                departments: [
                    {
                        id: 'eng',
                        name: 'Engineering',
                        employees: [
                            { id: 'a', name: 'Alice' },
                            { id: 'b', name: 'Bob' }
                        ]
                    }
                ],
                // Sibling lookup keyed by employee id
                onCall: { a: true }
            },
            computed: {
                // Item-level — uses this.X shortcut (proxy routes to state)
                isOnCall(emp) { return !!this.onCall[emp.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="nested-A">
                <ul data-list="departments" data-key="id">
                    <template>
                        <li>
                            <span class="dept" data-bind="name"></span>
                            <ul class="emp-list" data-list="employees" data-key="id">
                                <template>
                                    <li class="emp" data-bind-class="{ oncall: isOnCall }">
                                        <span data-bind="name"></span>
                                        <span class="badge" data-show="isOnCall">on call</span>
                                    </li>
                                </template>
                            </ul>
                        </li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const empItems = testContainer.querySelectorAll('.emp')
        expect(empItems.length).toBe(2)
        // Alice is on call, Bob is not — item-level computed must receive employee, not department
        expect(empItems[0].classList.contains('oncall')).toBe(true)
        expect(empItems[1].classList.contains('oncall')).toBe(false)
        expect(window.getComputedStyle(empItems[0].querySelector('.badge')).display).not.toBe('none')
        expect(window.getComputedStyle(empItems[1].querySelector('.badge')).display).toBe('none')
    })

    it('NESTED-B. nested-list item-level computed reacts to mutation', async () => {
        wildflower.component('nested-B', {
            state: {
                departments: [
                    {
                        id: 'eng',
                        name: 'Engineering',
                        employees: [
                            { id: 'a', name: 'Alice' },
                            { id: 'b', name: 'Bob' }
                        ]
                    }
                ],
                onCall: { a: true }
            },
            computed: {
                isOnCall(emp) { return !!this.onCall[emp.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="nested-B">
                <ul data-list="departments" data-key="id">
                    <template>
                        <li>
                            <ul class="emp-list" data-list="employees" data-key="id">
                                <template>
                                    <li class="emp" data-bind-class="{ oncall: isOnCall }"
                                        data-bind="isOnCall ? '★ ' + name : name"></li>
                                </template>
                            </ul>
                        </li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        // Direct nested mutation — onCall lookup map keyed by employee id
        componentRef.state.onCall.b = true
        await waitForCompleteRender()

        const empItems = testContainer.querySelectorAll('.emp')
        expect(empItems[0].classList.contains('oncall')).toBe(true)
        expect(empItems[1].classList.contains('oncall')).toBe(true)
        expect(empItems[0].textContent.trim()).toBe('★ Alice')
        expect(empItems[1].textContent.trim()).toBe('★ Bob')
    })
})
