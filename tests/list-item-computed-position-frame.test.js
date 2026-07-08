/**
 * Position-frame guards for item-level computeds across binding forms.
 *
 * Background: docs/BINDING_VALUE_RESOLUTION_INVESTIGATION_2026-05-23.md flagged two
 * call sites that invoke an item-level computed with a dropped position frame:
 *   - _resolveListExprArgs (ListExpressionEval.js:1282): itemIndex=undefined, context=null
 *   - _evaluateListItemCondition (EventSystem.js:1950/1957): context=null
 * The worry was that a computed reading index / info.first / info.last / info.length
 * would get a wrong answer through data-show / data-render / data-bind-class.
 *
 * Instrumented finding (2026-05-23): on INITIAL RENDER neither produces an
 * observable wrong result.
 *   - _evaluateListItemCondition DOES run with the broken null context (info.last
 *     false, info.length 0), but a redundant, context-aware re-evaluation runs
 *     afterward with the correct frame and determines the actual DOM. The broken
 *     value is computed and discarded.
 *   - _resolveListExprArgs is NOT reached by a data-bind-class expression on initial
 *     render; that binding is evaluated with the correct context.
 *
 * So these are regression guards that lock in correct position resolution through
 * all four binding forms. They also guard against a future refactor accidentally
 * letting the broken null-frame evaluation win. (A residual timing risk remains:
 * the documented _executeShows / ContextManager race — see
 * data-show-item-level-computed-component-state.test.js — could in principle let
 * the broken path's value surface transiently. Not reproduced here.)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Item-level computed position frame across binding forms', () => {
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

    // ---------------------------------------------------------------------
    // data-bind (the reference path; mirrors item-level-computed-form-capabilities)
    // ---------------------------------------------------------------------
    it('data-bind: item-level computed reads index / info.first / info.last / info.length', async () => {
        wildflower.component('pos-control', {
            state: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            computed: {
                posLabel(item, index, info) {
                    return `${index}|first=${info.first}|last=${info.last}|len=${info.length}`
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="pos-control">
                <div data-list="items" data-key="id">
                    <template><span class="p" data-bind="posLabel"></span></template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const p = testContainer.querySelectorAll('span.p')
        expect(p[0].textContent).toBe('0|first=true|last=false|len=3')
        expect(p[1].textContent).toBe('1|first=false|last=false|len=3')
        expect(p[2].textContent).toBe('2|first=false|last=true|len=3')
    })

    // ---------------------------------------------------------------------
    // data-show with an item-level computed (routes via _evaluateListItemCondition,
    // which runs a redundant null-context eval that is masked by a correct one)
    // ---------------------------------------------------------------------

    it('data-show: item-level computed reading info.first', async () => {
        wildflower.component('show-first', {
            state: { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            computed: { onFirst(item, index, info) { return info.first } }
        })

        testContainer.innerHTML = `
            <div data-component="show-first">
                <ul data-list="rows" data-key="id">
                    <template><li><span class="m" data-show="onFirst">X</span></li></template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()
        await waitForCompleteRender()

        const m = testContainer.querySelectorAll('span.m')
        expect(m[0].style.display).toBe('')
        expect(m[1].style.display).toBe('none')
        expect(m[2].style.display).toBe('none')
    })

    it('data-show: item-level computed reading info.last (only last row visible)', async () => {
        wildflower.component('show-last', {
            state: { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            computed: { onLast(item, index, info) { return info.last } }
        })

        testContainer.innerHTML = `
            <div data-component="show-last">
                <ul data-list="rows" data-key="id">
                    <template><li><span class="m" data-show="onLast">X</span></li></template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()
        await waitForCompleteRender()

        const m = testContainer.querySelectorAll('span.m')
        expect(m[2].style.display).toBe('')
        expect(m[0].style.display).toBe('none')
        expect(m[1].style.display).toBe('none')
    })

    it('data-show: item-level computed reading info.length (all visible when length >= 3)', async () => {
        wildflower.component('show-len', {
            state: { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            computed: { longList(item, index, info) { return info.length >= 3 } }
        })

        testContainer.innerHTML = `
            <div data-component="show-len">
                <ul data-list="rows" data-key="id">
                    <template><li><span class="m" data-show="longList">X</span></li></template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()
        await waitForCompleteRender()

        const m = testContainer.querySelectorAll('span.m')
        expect(m[0].style.display).toBe('')
        expect(m[1].style.display).toBe('')
        expect(m[2].style.display).toBe('')
    })

    // ---------------------------------------------------------------------
    // data-bind-class expression referencing an item-level computed
    // (does NOT reach _resolveListExprArgs on initial render; evaluated with context)
    // ---------------------------------------------------------------------

    it('data-bind: item-level computed combining info.first / info.last', async () => {
        wildflower.component('edge-control', {
            state: { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            computed: {
                edgeLabel(item, index, info) { return (info.first || info.last) ? 'edge' : 'middle' }
            }
        })

        testContainer.innerHTML = `
            <div data-component="edge-control">
                <ul data-list="rows" data-key="id">
                    <template><li><span class="e" data-bind="edgeLabel"></span></li></template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const e = testContainer.querySelectorAll('span.e')
        expect(e[0].textContent).toBe('edge')    // first
        expect(e[1].textContent).toBe('middle')
        expect(e[2].textContent).toBe('edge')    // last
    })

    it('data-bind-class expression referencing an item-level computed resolves position', async () => {
        wildflower.component('edge-class', {
            state: { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            computed: {
                isEdge(item, index, info) { return info.first || info.last }
            }
        })

        testContainer.innerHTML = `
            <div data-component="edge-class">
                <ul data-list="rows" data-key="id">
                    <template><li class="r" data-bind-class="isEdge ? 'edge' : 'middle'"></li></template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const r = testContainer.querySelectorAll('li.r')
        expect(r[0].classList.contains('edge')).toBe(true)
        expect(r[2].classList.contains('edge')).toBe(true)
        expect(r[1].classList.contains('middle')).toBe(true)
    })

    // ---------------------------------------------------------------------
    // data-render variant: removes the element entirely (vs data-show toggling
    // display). Same masking behavior — the correct re-evaluation wins.
    // ---------------------------------------------------------------------

    it('data-render: item-level computed reading info.last (only last element present)', async () => {
        wildflower.component('render-last', {
            state: { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            computed: { onLast(item, index, info) { return info.last } }
        })

        testContainer.innerHTML = `
            <div data-component="render-last">
                <ul data-list="rows" data-key="id">
                    <template><li><span class="r" data-render="onLast">L</span></li></template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()
        await waitForCompleteRender()

        const r = testContainer.querySelectorAll('span.r')
        expect(r.length).toBe(1)
    })

    it('data-render: item-level computed reading info.length (all elements present)', async () => {
        wildflower.component('render-len', {
            state: { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            computed: { longList(item, index, info) { return info.length >= 3 } }
        })

        testContainer.innerHTML = `
            <div data-component="render-len">
                <ul data-list="rows" data-key="id">
                    <template><li><span class="r" data-render="longList">L</span></li></template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()
        await waitForCompleteRender()

        const r = testContainer.querySelectorAll('span.r')
        expect(r.length).toBe(3)
    })
})
