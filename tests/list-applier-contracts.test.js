/**
 * P6-S0 applier-contract matrix — class drop-out semantics per binding form,
 * element position, and driving channel.
 *
 * Phase 6 merges the three class appliers (_executeClassBindings toggle,
 * _applyClassBindingsToRow additive/removeDropped, _processOptimizedClassBinding
 * fallback) into one core. These tests pin the semantics every caller must
 * preserve. Written matrix-first at S0: any cell that is RED on the current
 * tree is a LATENT bug (the P4-S6c falsification showed additive mode never
 * removes — root-form was protected by heavy classification, but child-element
 * fields are deco-stamped and rely on the additive path).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Applier contracts: class drop-out matrix (P6-S0)', () => {
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

    it('CHILD element, STRING-form ternary, item-driven flip on -> off', async () => {
        wildflower.component('cm-child-string', {
            state: { items: [{ id: 1, label: 'a', hot: true }, { id: 2, label: 'b', hot: false }] },
            init() { componentRef = this }
        })
        testContainer.innerHTML = `
            <div data-component="cm-child-string">
                <ul data-list="items" data-key="id">
                    <template>
                        <li><span class="cell" data-bind-class="hot ? 'is-hot' : ''" data-bind="label"></span></li>
                    </template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        let cells = testContainer.querySelectorAll('.cell')
        expect(cells[0].classList.contains('is-hot')).toBe(true)
        expect(cells[1].classList.contains('is-hot')).toBe(false)

        componentRef.state.items[0].hot = false
        componentRef.state.items[1].hot = true
        await waitForCompleteRender()

        cells = testContainer.querySelectorAll('.cell')
        expect(cells[1].classList.contains('is-hot')).toBe(true)
        expect(cells[0].classList.contains('is-hot')).toBe(false)
    })

    it('CHILD element, STRING-form value swap a -> b removes the old class', async () => {
        wildflower.component('cm-child-swap', {
            state: { items: [{ id: 1, label: 'a', tone: 'warm' }] },
            init() { componentRef = this }
        })
        testContainer.innerHTML = `
            <div data-component="cm-child-swap">
                <ul data-list="items" data-key="id">
                    <template>
                        <li><span class="cell" data-bind-class="tone === 'warm' ? 'tone-warm' : 'tone-cool'" data-bind="label"></span></li>
                    </template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        let cell = testContainer.querySelector('.cell')
        expect(cell.classList.contains('tone-warm')).toBe(true)

        componentRef.state.items[0].tone = 'cool'
        await waitForCompleteRender()

        cell = testContainer.querySelector('.cell')
        expect(cell.classList.contains('tone-cool')).toBe(true)
        expect(cell.classList.contains('tone-warm')).toBe(false)
    })

    it('CHILD element, OBJECT-form, item-driven flip on -> off', async () => {
        wildflower.component('cm-child-object', {
            state: { items: [{ id: 1, label: 'a', sel: true }] },
            init() { componentRef = this }
        })
        testContainer.innerHTML = `
            <div data-component="cm-child-object">
                <ul data-list="items" data-key="id">
                    <template>
                        <li><span class="cell" data-bind-class="({ picked: sel })" data-bind="label"></span></li>
                    </template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        let cell = testContainer.querySelector('.cell')
        expect(cell.classList.contains('picked')).toBe(true)

        componentRef.state.items[0].sel = false
        await waitForCompleteRender()

        cell = testContainer.querySelector('.cell')
        expect(cell.classList.contains('picked')).toBe(false)
    })

    it('ROOT element, STRING-form ternary, item-driven flip on -> off (S6c pin)', async () => {
        wildflower.component('cm-root-string', {
            state: { items: [{ id: 1, label: 'a', active: true }] },
            init() { componentRef = this }
        })
        testContainer.innerHTML = `
            <div data-component="cm-root-string">
                <ul data-list="items" data-key="id">
                    <template>
                        <li class="row" data-bind-class="active ? 'row on' : 'row'"><span data-bind="label"></span></li>
                    </template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        let row = testContainer.querySelector('.row')
        expect(row.classList.contains('on')).toBe(true)

        componentRef.state.items[0].active = false
        await waitForCompleteRender()

        row = testContainer.querySelector('.row')
        expect(row.classList.contains('on')).toBe(false)
    })
})
