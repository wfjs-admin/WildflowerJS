/**
 * Path-scoped entity invalidation.
 *
 * When a component declares `subscribe: { store: [...] }`, a mutation to a
 * store path the component does NOT read must not force-rerun the
 * component's per-item effects (nor re-dirty its computeds).
 *
 * Regression origin — the project-management demo:
 *   `pm-issue-list` does `subscribe: { ui: ['route','filters','selectedIssueIds',...] }`.
 *   The sidebar hover handler wrote `ui.sidebarHover` on every mouse-move.
 *   Nothing in the issue list reads `sidebarHover`, yet every hover
 *   force-reran all ~150 issue-row effects: EntitySystem._handleEntityStateChange
 *   walked `ui`'s dependents and called `sm._dirtyAllItemEffects()` on each,
 *   regardless of which path changed. Profiled as a full
 *   `_renderListWithMapArray` on every mouse-move.
 *
 * Contract locked here: entity-change invalidation is PATH-SCOPED for
 * components that declare a `subscribe: {}` contract. A mutation whose
 * path prefix-relates to neither a subscribed path nor a runtime-tracked
 * store dependency is skipped for that dependent. Mutations that DO
 * prefix-relate (including mutations deeper than a subscribed path, e.g.
 * `filters.text` under subscribed `filters`) still invalidate.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Path-scoped entity invalidation', () => {
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

    it('per-item effects do NOT re-run when an unsubscribed store path mutates', async () => {
        // `ui` carries two unrelated fields. The component subscribes to
        // `selected` only — `hover` is the sidebarHover analogue.
        wildflower.store('ui-pscope-1', {
            state: { selected: null, hover: null }
        })

        let evalCount = 0
        wildflower.component('list-pscope-1', {
            subscribe: { 'ui-pscope-1': ['selected'] },
            state: { rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] },
            computed: {
                // Item-level computed — one per-item effect per row. Reads
                // the SUBSCRIBED path so the component genuinely depends on
                // `ui-pscope-1.selected`.
                rowDecor(row) {
                    if (!row || row.id === undefined) return ''
                    evalCount++
                    return this.stores['ui-pscope-1'].selected === row.id ? 'on' : 'off'
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-pscope-1">
                <ul data-list="rows" data-key="id">
                    <template><li><span class="d" data-bind="rowDecor"></span></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        const decor = () => Array.from(testContainer.querySelectorAll('.d')).map(d => d.textContent)
        expect(decor()).toEqual(['off', 'off', 'off'])

        const baseline = evalCount

        // Mutate the UNSUBSCRIBED path. Nothing the component reads depends
        // on `hover`, so no per-item effect should re-run.
        wildflower.getStore('ui-pscope-1').hover = 'r2'
        await waitForCompleteRender()

        expect(evalCount).toBe(baseline)
        expect(decor()).toEqual(['off', 'off', 'off'])
    })

    it('CONTROL: per-item effects DO re-run when the subscribed path mutates', async () => {
        wildflower.store('ui-pscope-2', {
            state: { selected: null, hover: null }
        })

        let evalCount = 0
        wildflower.component('list-pscope-2', {
            subscribe: { 'ui-pscope-2': ['selected'] },
            state: { rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] },
            computed: {
                rowDecor(row) {
                    if (!row || row.id === undefined) return ''
                    evalCount++
                    return this.stores['ui-pscope-2'].selected === row.id ? 'on' : 'off'
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-pscope-2">
                <ul data-list="rows" data-key="id">
                    <template><li><span class="d" data-bind="rowDecor"></span></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()
        const decor = () => Array.from(testContainer.querySelectorAll('.d')).map(d => d.textContent)
        expect(decor()).toEqual(['off', 'off', 'off'])

        const baseline = evalCount

        // Mutate the SUBSCRIBED path — per-item effects must re-run and the
        // DOM must reflect the new selection.
        wildflower.getStore('ui-pscope-2').selected = 'r2'
        await waitForCompleteRender()

        expect(evalCount).toBeGreaterThan(baseline)
        expect(decor()).toEqual(['off', 'on', 'off'])
    })

    it('CONTROL: a mutation DEEPER than a subscribed path still invalidates', async () => {
        // Subscribed path is `filters` (an object). A nested mutation
        // `filters.text` must still invalidate — the match is prefix-aware.
        wildflower.store('ui-pscope-3', {
            state: { filters: { text: '' }, hover: null }
        })

        let evalCount = 0
        wildflower.component('list-pscope-3', {
            subscribe: { 'ui-pscope-3': ['filters'] },
            state: { rows: [{ id: 'r1' }, { id: 'r2' }] },
            computed: {
                rowDecor(row) {
                    if (!row || row.id === undefined) return ''
                    evalCount++
                    return this.stores['ui-pscope-3'].filters.text || 'empty'
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-pscope-3">
                <ul data-list="rows" data-key="id">
                    <template><li><span class="d" data-bind="rowDecor"></span></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()
        const decor = () => Array.from(testContainer.querySelectorAll('.d')).map(d => d.textContent)
        expect(decor()).toEqual(['empty', 'empty'])

        const baseline = evalCount

        wildflower.getStore('ui-pscope-3').filters.text = 'hello'
        await waitForCompleteRender()

        expect(evalCount).toBeGreaterThan(baseline)
        expect(decor()).toEqual(['hello', 'hello'])
    })

    it('component-level computed is NOT re-dirtied when an unsubscribed path mutates', async () => {
        wildflower.store('ui-pscope-4', {
            state: { count: 0, hover: null }
        })

        let evalCount = 0
        wildflower.component('view-pscope-4', {
            subscribe: { 'ui-pscope-4': ['count'] },
            computed: {
                label() {
                    evalCount++
                    return 'count:' + this.stores['ui-pscope-4'].count
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="view-pscope-4">
                <span class="l" data-bind="label"></span>
            </div>
        `
        await waitForCompleteRender()
        expect(testContainer.querySelector('.l').textContent).toBe('count:0')

        const baseline = evalCount

        // Unsubscribed path — the computed must not be re-evaluated.
        wildflower.getStore('ui-pscope-4').hover = 'x'
        await waitForCompleteRender()
        expect(evalCount).toBe(baseline)

        // Subscribed path — the computed must re-evaluate.
        wildflower.getStore('ui-pscope-4').count = 5
        await waitForCompleteRender()
        expect(evalCount).toBeGreaterThan(baseline)
        expect(testContainer.querySelector('.l').textContent).toBe('count:5')
    })
})
