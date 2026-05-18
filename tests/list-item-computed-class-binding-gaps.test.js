/**
 * Verifies Claude Design's report that `data-bind-class="{ shared: isShared }"`
 * inside a data-list template produced literal `[object Object]` as the class.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('data-bind-class object syntax in data-list scope (Claude Design repro)', () => {
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

    it('A. UNPARENTHESIZED object syntax + item-level computed (Claude exact pattern)', async () => {
        wildflower.component('cd-A', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                shares: { a: true },
            },
            computed: {
                isShared(item) { return !!this.state.shares[item.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="cd-A">
                <ul data-list="items" data-key="id">
                    <template>
                        <li class="card" data-bind-class="{ shared: isShared }" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards.length).toBe(2)

        const c0 = cards[0].getAttribute('class') || ''
        const c1 = cards[1].getAttribute('class') || ''

        expect(c0).toContain('card')
        expect(c0).toContain('shared')
        expect(c1).toContain('card')
        expect(c1).not.toContain('shared')
    })

    it('B. PARENTHESIZED object syntax + item-level computed (canonical form)', async () => {
        wildflower.component('cd-B', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                shares: { a: true },
            },
            computed: {
                isShared(item) { return !!this.state.shares[item.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="cd-B">
                <ul data-list="items" data-key="id">
                    <template>
                        <li class="card" data-bind-class="({ shared: isShared })" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards.length).toBe(2)

        const c0 = cards[0].getAttribute('class') || ''
        const c1 = cards[1].getAttribute('class') || ''
        expect(c0).toContain('shared')
        expect(c1).not.toContain('shared')
    })

    it('B2. PARENTHESIZED object syntax + item-level data property (no computed, control)', async () => {
        wildflower.component('cd-B2', {
            state: {
                items: [
                    { id: 'a', name: 'Alpha', isShared: true },
                    { id: 'b', name: 'Beta', isShared: false },
                ],
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="cd-B2">
                <ul data-list="items" data-key="id">
                    <template>
                        <li class="card" data-bind-class="({ shared: isShared })" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        const c0 = cards[0].getAttribute('class') || ''
        const c1 = cards[1].getAttribute('class') || ''

        console.warn(`[B2 paren+prop] card0 class="${c0}"`)
        console.warn(`[B2 paren+prop] card1 class="${c1}"`)

        expect(cards[0].classList.contains('shared')).toBe(true)
        expect(cards[1].classList.contains('shared')).toBe(false)
    })

    it('D. data-bind-class="isShared" (bare reference, no object literal) + item-level computed', async () => {
        wildflower.component('cd-D', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                shares: { a: true },
            },
            computed: {
                isShared(item) { return !!this.state.shares[item.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="cd-D">
                <ul data-list="items" data-key="id">
                    <template>
                        <li class="card" data-bind-class="isShared" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        const c0 = cards[0].getAttribute('class') || ''
        const c1 = cards[1].getAttribute('class') || ''
        console.warn(`[D bare-ref] card0 class="${c0}"`)
        console.warn(`[D bare-ref] card1 class="${c1}"`)
    })

    it('E. data-bind-class="isShared ? \'shared\' : \'\'" (ternary) + item-level computed', async () => {
        wildflower.component('cd-E', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                shares: { a: true },
            },
            computed: {
                isShared(item) { return !!this.state.shares[item.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="cd-E">
                <ul data-list="items" data-key="id">
                    <template>
                        <li class="card" data-bind-class="isShared ? 'shared' : ''" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        const c0 = cards[0].getAttribute('class') || ''
        const c1 = cards[1].getAttribute('class') || ''
        expect(c0).toContain('shared')
        expect(c1).not.toContain('shared')
    })

    it('F. String-returning computed: data-bind-class="cardClass" where cardClass(item) returns "card shared" or "card"', async () => {
        wildflower.component('cd-F', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                shares: { a: true },
            },
            computed: {
                cardClass(item) {
                    return this.state.shares[item.id] ? 'card shared' : 'card'
                }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="cd-F">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind-class="cardClass" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        const c0 = cards[0].getAttribute('class') || ''
        const c1 = cards[1].getAttribute('class') || ''
        console.warn(`[F string-computed] card0 class="${c0}"`)
        console.warn(`[F string-computed] card1 class="${c1}"`)
    })

    it('F2. STRING-COMPUTED reacts to direct nested mutation', async () => {
        wildflower.component('cd-F2', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                shares: { a: true },
            },
            computed: {
                cardClass(item) {
                    return this.state.shares[item.id] ? 'card shared' : 'card'
                }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="cd-F2">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind-class="cardClass" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        componentRef.state.shares.b = true
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards[1].classList.contains('shared')).toBe(true)
    })

    it('C. Direct nested mutation triggers reactivity (object-syntax with item-level computed)', async () => {
        wildflower.component('cd-C', {
            state: {
                items: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
                shares: { a: true },
            },
            computed: {
                isShared(item) { return !!this.state.shares[item.id] }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="cd-C">
                <ul data-list="items" data-key="id">
                    <template>
                        <li class="card" data-bind-class="({ shared: isShared })" data-bind="name"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        componentRef.state.shares.b = true
        await waitForCompleteRender()

        const cards = testContainer.querySelectorAll('li')
        expect(cards[1].classList.contains('shared')).toBe(true)
    })
})
