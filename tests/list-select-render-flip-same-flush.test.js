/**
 * Same-flush selection change (tier 3: component refresh effect, class
 * partition) + data-render flip (tier 2: dispatcher render arm, synchronous in
 * the set trap). Pins invariant #8 of the list-pipeline synopsis: sink applies
 * are synchronous, the refresh effect is microtask-deferred, so restructure
 * always completes before the selection class applies — and the selection
 * lands on the POST-restructure elements via the re-resolved element arrays.
 *
 * If sink applies are ever batched/deferred (e.g. a create-path optimization),
 * this test is the tripwire. External review 2026-07-04, finding #5.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Same-flush selection + data-render flip ordering', () => {
    let testContainer
    let cleanup

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => {
        if (cleanup) cleanup()
    })

    it('SRF-A. selecting a row and revealing its detail subtree in one method lands both on the final elements', async () => {
        wildflower.component('srf-list', {
            state: {
                selectedId: 0,
                items: [
                    { id: 1, name: 'a', showDetail: false },
                    { id: 2, name: 'b', showDetail: false },
                    { id: 3, name: 'c', showDetail: false },
                ]
            },
            selectAndReveal(ev) {
                // One synchronous action: component-state write (selection,
                // tier 3) + item-field write (render flip, tier 2).
                const id = 2
                this.state.selectedId = id
                const item = this.state.items.find(i => i.id === id)
                item.showDetail = true
            },
            init() { window.__srfRef = this }
        })
        testContainer.innerHTML = `
            <div data-component="srf-list">
                <button id="srf-go" data-action="selectAndReveal">go</button>
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind-class="({ selected: id === selectedId })">
                            <span class="name" data-bind="name"></span>
                            <span class="detail" data-render="showDetail">detail-<span data-bind="name"></span></span>
                        </li>
                    </template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const rows = () => testContainer.querySelectorAll('li')
        expect(rows().length).toBe(3)
        expect(testContainer.querySelectorAll('.detail').length).toBe(0)

        testContainer.querySelector('#srf-go').click()
        await waitForCompleteRender()

        // The flip restructured row 2; the selection class must sit on the
        // POST-restructure element (not a detached pre-restructure one), and
        // the revealed subtree must be fresh.
        const row2 = rows()[1]
        expect(row2.classList.contains('selected')).toBe(true)
        expect(rows()[0].classList.contains('selected')).toBe(false)
        const detail = row2.querySelector('.detail')
        expect(detail).not.toBeNull()
        expect(detail.textContent).toBe('detail-b')

        // Reverse order in a second flush: hide + move selection away, one action.
        const instance = window.__srfRef
        instance.state.selectedId = 3
        instance.state.items[1].showDetail = false
        await waitForCompleteRender()
        expect(rows()[1].classList.contains('selected')).toBe(false)
        expect(rows()[2].classList.contains('selected')).toBe(true)
        expect(rows()[1].querySelector('.detail')).toBeNull()
    })
})
