/**
 * Scoped per-item wake on a direct item-field mutation.
 *
 * Regression origin — the project-management demo bulk-edit lag:
 *   `pm-issue-list` renders a data-list of store issue rows. An item-level
 *   computed reads BOTH the row's own field (`item.priority`, graph-tracked
 *   via the item proxy, which IS the store entity proxy) AND shared store
 *   config via an external getter (`this.stores.pm.getPriority(...)` reading
 *   `pm.priorities`, which the graph does NOT see). A bulk priority edit
 *   mutates only the selected issues' `.priority`, yet
 *   EntitySystem._handleEntityStateChange called `sm._dirtyAllItemEffects()`
 *   — the blanket wake of EVERY row — because the changed path (`issues`) is
 *   subscribed. Result: all rows re-ran their item computeds (mostly no-op
 *   DOM) on every edit.
 *
 * Contract locked here: cross-entity reactivity is graph-driven. A direct
 * item-field mutation wakes ONLY the affected row (its item proxy IS the store
 * entity, so its per-item computed read forms a graph edge the write notifies).
 * A change to shared config the rows read via an external getter wakes every
 * row that read it — also through the graph (external store reads track through
 * the one graph). The legacy blanket per-item wake (which re-ran every row on
 * any relevant store change) is gated to RSM; ReactiveGraph needs neither it nor
 * the eager computed sweep.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Scoped per-item wake on direct item-field mutation', () => {
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

    function buildBoard(suffix, evals) {
        wildflower.store('s-oi-' + suffix, {
            state: {
                items: [
                    { id: 'a', value: 1, kind: 'x' },
                    { id: 'b', value: 1, kind: 'x' },
                    { id: 'c', value: 1, kind: 'x' },
                ],
                // Shared config read only via the external getter below — the
                // graph never forms an edge from a row effect to this path.
                config: { x: 'X', y: 'Y' },
            },
            lookup(kind) { return this.config[kind] || '?' },
            bump(id) { const it = this.items.find(i => i.id === id); if (it) it.value++ },
        })

        wildflower.component('list-oi-' + suffix, {
            subscribe: { ['s-oi-' + suffix]: ['items', 'config'] },
            computed: {
                rows() { return this.stores['s-oi-' + suffix].items },
                // item.value is graph-tracked (item proxy === store entity).
                // the lookup() call reads config externally (untracked).
                decor(item) {
                    if (!item || item.id === undefined) return ''
                    evals[item.id] = (evals[item.id] || 0) + 1
                    return item.value + ':' + this.stores['s-oi-' + suffix].lookup(item.kind)
                },
            },
        })

        testContainer.innerHTML = `
            <div data-component="list-oi-${suffix}">
                <ul data-list="rows" data-key="id">
                    <template><li><span class="d" data-bind="decor"></span></li></template>
                </ul>
            </div>
        `
    }

    const decor = () => Array.from(testContainer.querySelectorAll('.d')).map(d => d.textContent)

    it('a direct item-field mutation wakes ONLY the changed row', async () => {
        const evals = {}
        buildBoard('1', evals)
        await waitForCompleteRender()
        expect(decor()).toEqual(['1:X', '1:X', '1:X'])

        const base = { ...evals }

        // Mutate only row 'b'. The graph wakes b's effect via the item proxy;
        // the blanket wake must be skipped so a and c do NOT re-evaluate.
        wildflower.getStore('s-oi-1').bump('b')
        await waitForCompleteRender()

        expect(decor()).toEqual(['1:X', '2:X', '1:X'])
        expect(evals.b).toBeGreaterThan(base.b)
        expect(evals.a).toBe(base.a)
        expect(evals.c).toBe(base.c)
    })

    it('CONTROL: a shared-config change (untracked external read) wakes every row', async () => {
        const evals = {}
        buildBoard('2', evals)
        await waitForCompleteRender()
        expect(decor()).toEqual(['1:X', '1:X', '1:X'])

        const base = { ...evals }

        // Rows read config only via the external lookup() — no graph edge — so
        // the blanket wake is required for every row to pick up the change.
        wildflower.getStore('s-oi-2').config = { x: 'XX', y: 'Y' }
        await waitForCompleteRender()

        expect(decor()).toEqual(['1:XX', '1:XX', '1:XX'])
        expect(evals.a).toBeGreaterThan(base.a)
        expect(evals.b).toBeGreaterThan(base.b)
        expect(evals.c).toBeGreaterThan(base.c)
    })
})
