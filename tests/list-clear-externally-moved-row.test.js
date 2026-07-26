/**
 * Clearing a list must remove its tracked row elements even when a row was
 * physically moved OUT of the list container by external code (SortableJS
 * cross-list drag).
 *
 * Found 2026-07-25 via the docs/third-party "SortableJS with data-list
 * (Cross-List Drag-and-Drop)" example, which promises exactly this
 * integration: Sortable moves the DOM node between columns, the app updates
 * both state arrays, the framework reconciles. That works — EXCEPT when the
 * drag empties the source list. The reconciler's n===0 full-clear fast path
 * ends in `element.replaceChildren()` on the SOURCE container; the dragged
 * element is no longer in that container, so it survives as an orphan in the
 * TARGET container right next to the target list's own framework-rendered row
 * for the same item: a visible duplicate. The per-item removal path (source
 * not emptied) removes the tracked element wherever it lives, which is why
 * only last-card-out drags duplicated.
 *
 * The control test pins the working non-emptying path so a fix can't trade
 * one case for the other.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('List clear with externally-moved row (SortableJS cross-list pattern)', () => {
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

    function mountBoard(sourceCards) {
        wildflower.component('xlist-board', {
            state: {
                sourceCards,
                targetCards: [{ id: 100, title: 'existing' }]
            },
            // The docs example's moveCard, verbatim in shape.
            moveCard(cardId, fromName, toName, newIndex) {
                const fromList = this[fromName]
                const card = fromList.find(c => c.id === cardId)
                const newFrom = fromList.filter(c => c.id !== cardId)
                const newTo = [...this[toName]]
                newTo.splice(newIndex, 0, card)
                this[fromName] = newFrom
                this[toName] = newTo
            }
        })

        testContainer.innerHTML = `
            <div data-component="xlist-board">
                <div class="src" data-list="sourceCards" data-key="id">
                    <template><div class="card-row" data-bind-attr="({ 'data-card-id': id })"><span data-bind="title"></span></div></template>
                </div>
                <div class="tgt" data-list="targetCards" data-key="id">
                    <template><div class="card-row" data-bind-attr="({ 'data-card-id': id })"><span data-bind="title"></span></div></template>
                </div>
            </div>
        `
    }

    const idsIn = (sel) => Array.from(
        testContainer.querySelector(sel).querySelectorAll('[data-card-id]')
    ).map(el => el.getAttribute('data-card-id'))

    // Replays exactly what SortableJS does on a cross-list drop: physically
    // reparent the row element, then the app's onEnd updates both arrays.
    async function externalDragToTarget(cardId) {
        const src = testContainer.querySelector('.src')
        const tgt = testContainer.querySelector('.tgt')
        const el = src.querySelector(`[data-card-id="${cardId}"]`)
        expect(el).toBeTruthy()
        tgt.appendChild(el)                      // Sortable's DOM move
        const board = testContainer.querySelector('[data-component="xlist-board"]')
        const inst = wildflower.componentInstances.get(board.dataset.componentId)
        inst.context.moveCard(cardId, 'sourceCards', 'targetCards', 1)
        await waitForCompleteRender()
    }

    it('no duplicate when the drag EMPTIES the source list (bulk-clear path)', async () => {
        mountBoard([{ id: 1, title: 'only card' }])
        await waitForCompleteRender()
        expect(idsIn('.src')).toEqual(['1'])

        await externalDragToTarget(1)

        expect(idsIn('.src')).toEqual([])
        // The failure mode: ['100', '1', '1'] — orphaned Sortable-moved node
        // plus the framework's own render of the same item.
        expect(idsIn('.tgt').filter(id => id === '1')).toHaveLength(1)
        expect(idsIn('.tgt').sort()).toEqual(['1', '100'])
    })

    it('CONTROL: no duplicate when the source keeps other cards (per-item path)', async () => {
        mountBoard([{ id: 1, title: 'first' }, { id: 2, title: 'second' }])
        await waitForCompleteRender()

        await externalDragToTarget(1)

        expect(idsIn('.src')).toEqual(['2'])
        expect(idsIn('.tgt').filter(id => id === '1')).toHaveLength(1)
    })

    it('emptied source stays healthy: a later add renders normally', async () => {
        mountBoard([{ id: 1, title: 'only card' }])
        await waitForCompleteRender()
        await externalDragToTarget(1)

        const board = testContainer.querySelector('[data-component="xlist-board"]')
        const inst = wildflower.componentInstances.get(board.dataset.componentId)
        inst.context.moveCard(1, 'targetCards', 'sourceCards', 0)
        // NOTE: this move is state-only (no external DOM move this time — the
        // reverse direction without Sortable), exercising the normal render
        // path into the previously bulk-cleared container.
        await waitForCompleteRender()

        expect(idsIn('.src')).toEqual(['1'])
        expect(idsIn('.tgt')).toEqual(['100'])
    })
})
