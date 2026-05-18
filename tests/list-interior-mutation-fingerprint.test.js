/**
 * ListRenderer change-detection fingerprint at the 100–1000 boundary.
 *
 * The fingerprint used to sample only 3 positions for arrays > 100 items,
 * so an interior-only mutation (length unchanged, head/tail unchanged)
 * could be missed and the list wouldn't re-render. Now full-item hashing
 * runs up to 1000 items; 7-position sampling beyond that.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('List fingerprint — interior mutations at the 100–1000 boundary', () => {
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

    function makeRows(n) {
        const out = new Array(n)
        for (let i = 0; i < n; i++) out[i] = { id: 'r' + i, label: 'L' + i }
        return out
    }

    async function runForSize(size) {
        wildflower.component('fingerprint-list-' + size, {
            state: { rows: makeRows(size) }
        })
        testContainer.innerHTML = `
            <div data-component="fingerprint-list-${size}">
                <ul data-list="rows" data-key="id">
                    <template><li class="row" data-bind="label"></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        const labels = () => Array.from(testContainer.querySelectorAll('.row')).map(el => el.textContent)
        const initial = labels()
        expect(initial.length).toBe(size)

        // Mutate ONLY the interior — head, tail, and length unchanged.
        // Pick an index near the middle so the old 3-sample fingerprint
        // (head/middle/tail) and a 7-sample stride both notice it; we
        // explicitly target a position that earlier sampling would have
        // skipped (~25% mark).
        const inst = wildflower.getComponent('fingerprint-list-' + size)
        const targetIdx = Math.floor(size * 0.27)
        const newRows = inst.state.rows.slice()
        newRows[targetIdx] = { id: 'r' + targetIdx, label: 'CHANGED' }
        inst.state.rows = newRows
        await waitForCompleteRender()

        const after = labels()
        expect(after[targetIdx]).toBe('CHANGED')
        // Adjacent items unchanged
        expect(after[targetIdx - 1]).toBe('L' + (targetIdx - 1))
        expect(after[targetIdx + 1]).toBe('L' + (targetIdx + 1))
        // Head/tail unchanged
        expect(after[0]).toBe('L0')
        expect(after[size - 1]).toBe('L' + (size - 1))
    }

    it('detects interior mutation in a 150-row list', async () => {
        await runForSize(150)
    })

    it('detects interior mutation in a 500-row list', async () => {
        await runForSize(500)
    })

    it('detects interior mutation in a 999-row list (just below 1000 boundary)', async () => {
        await runForSize(999)
    })
})
