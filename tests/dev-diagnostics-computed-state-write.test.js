/**
 * Dev diagnostic: writing reactive state during computed evaluation.
 *
 * Found by the AI-surface modification-chain eval (F5, 2026-07-16): a
 * generated app's computed did `this.todos.sort(...)` (no copy) — an in-place
 * mutation of the computed's own dependency array. The bound data-list broke
 * SILENTLY (in the minimal repro it renders empty while state holds the
 * items), with zero console output. Computeds must be pure; the classic fix
 * is copy-before-sort. Dev builds now warn, naming the computed and the
 * mutation, once per computed node.
 *
 * __DEV__-gated; skipped on min variants.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe.skipIf(isMinifiedBuild())('Dev-mode computed-state-write diagnostic (F5)', () => {
    let testContainer
    let warnings
    let originalWarn
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)
        warnings = []
        originalWarn = console.warn
        console.warn = (...args) => { warnings.push(args.join(' ')) }
    })

    afterEach(() => {
        console.warn = originalWarn
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    const computedWriteWarnings = () =>
        warnings.filter(w => w.includes('[WF WF-217]') && /during .*(its own )?evaluation|computed .* mutated|mutated .*computed/i.test(w))

    it('warns when a computed in-place sorts its reactive dependency array', async () => {
        wildflower.component('f5-sort-in-computed', {
            state: { items: [{ id: 2, n: 2 }, { id: 1, n: 1 }] },
            computed: {
                sorted() {
                    return this.state.items.sort((a, b) => a.n - b.n) // no copy: the F5 trap
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="f5-sort-in-computed">
                <ul data-list="computed:sorted" data-key="id">
                    <template><li data-bind="n"></li></template>
                </ul>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()

        const hits = computedWriteWarnings()
        expect(hits.length).toBeGreaterThan(0)
        expect(hits.some(w => w.includes('sorted') && /sort/i.test(w))).toBe(true)
    })

    it('warns once per computed, not once per touched element', async () => {
        wildflower.component('f5-warn-once', {
            state: { list: [3, 1, 2, 5, 4] },
            computed: {
                ordered() { return this.state.list.sort() }
            }
        })

        testContainer.innerHTML = `
            <div data-component="f5-warn-once">
                <span data-bind="ordered"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()

        expect(computedWriteWarnings().length).toBe(1)
    })

    it('warns when a computed assigns to reactive state', async () => {
        wildflower.component('f5-assign-in-computed', {
            state: { count: 1, evaluations: 0 },
            computed: {
                doubled() {
                    this.state.evaluations++ // impure: state write during evaluation
                    return this.state.count * 2
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="f5-assign-in-computed">
                <span data-bind="doubled"></span>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()

        const hits = computedWriteWarnings()
        expect(hits.length).toBeGreaterThan(0)
        expect(hits.some(w => w.includes('doubled'))).toBe(true)
    })

    it('does NOT warn for the correct copy-before-sort pattern', async () => {
        wildflower.component('f5-copy-sort', {
            state: { items: [{ id: 2, n: 2 }, { id: 1, n: 1 }] },
            computed: {
                sorted() {
                    return [...this.state.items].sort((a, b) => a.n - b.n)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="f5-copy-sort">
                <ul data-list="computed:sorted" data-key="id">
                    <template><li data-bind="n"></li></template>
                </ul>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()

        expect(computedWriteWarnings()).toEqual([])

        // And the correct pattern actually renders, sorted.
        const texts = [...testContainer.querySelectorAll('li')].map(li => li.textContent)
        expect(texts).toEqual(['1', '2'])
    })

    it('does NOT warn for ordinary state writes from actions', async () => {
        wildflower.component('f5-action-write', {
            state: { count: 0 },
            computed: {
                label() { return 'count is ' + this.state.count }
            },
            bump() { this.state.count++ }
        })

        testContainer.innerHTML = `
            <div data-component="f5-action-write">
                <span data-bind="label"></span>
                <button id="f5-bump" data-action="bump">+</button>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()

        testContainer.querySelector('#f5-bump').click()
        await waitForCompleteRender()

        expect(computedWriteWarnings()).toEqual([])
    })
})
