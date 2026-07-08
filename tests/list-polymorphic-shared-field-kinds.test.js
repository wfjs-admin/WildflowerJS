/**
 * Polymorphic list where two template variants read the SAME item field
 * through DIFFERENT binding kinds (text in one variant, class in the other),
 * interleaved in one array.
 *
 * Pins the routing decision that makes this safe: polymorphic templates go to
 * the computed dispatcher with per-row metadata (applies are full-row per the
 * row's OWN variant), and the pure/suppression fast paths are skipped — so
 * there is no per-(node,kind) tier decision for one variant to win over the
 * other. External review 2026-07-04, finding #2
 * (docs/future/LIST_PIPELINE_SYNOPSIS_FOR_REVIEW_2026-07-04.md Appendix A).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Polymorphic variants reading one shared field via different binding kinds', () => {
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

    it('PSF-A. text variant and class variant both track writes to the shared field', async () => {
        wildflower.component('psf-list', {
            state: {
                items: [
                    { id: 1, type: 'plain', flag: false },
                    { id: 2, type: 'fancy', flag: false },
                    { id: 3, type: 'plain', flag: true },
                    { id: 4, type: 'fancy', flag: true },
                ]
            },
            init() { window.__psfRef = this }
        })
        testContainer.innerHTML = `
            <div data-component="psf-list">
                <div data-list="items" data-key="id" data-template-key="type">
                    <template data-type="plain">
                        <div class="row plain"><span class="txt" data-bind="flag"></span></div>
                    </template>
                    <template data-type="fancy">
                        <div class="row fancy" data-bind-class="({ lit: flag })"><span class="label">x</span></div>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const rows = () => testContainer.querySelectorAll('.row')
        expect(rows().length).toBe(4)
        const instance = window.__psfRef

        // Initial: plain rows show text, fancy rows show class per flag.
        expect(rows()[0].querySelector('.txt').textContent).toBe('false')
        expect(rows()[1].classList.contains('lit')).toBe(false)
        expect(rows()[2].querySelector('.txt').textContent).toBe('true')
        expect(rows()[3].classList.contains('lit')).toBe(true)

        // Flip the shared field on one row of EACH variant; both binding kinds
        // must apply. (A last-writer-wins tier decision on the shared node
        // leaves one variant's kind unserviced.)
        instance.state.items[0].flag = true
        instance.state.items[1].flag = true
        await waitForCompleteRender()
        expect(rows()[0].querySelector('.txt').textContent).toBe('true')
        expect(rows()[1].classList.contains('lit')).toBe(true)

        // And back, repeatedly (a stamped-then-stale path shows on write 2+).
        instance.state.items[0].flag = false
        instance.state.items[1].flag = false
        await waitForCompleteRender()
        expect(rows()[0].querySelector('.txt').textContent).toBe('false')
        expect(rows()[1].classList.contains('lit')).toBe(false)

        instance.state.items[3].flag = false
        await waitForCompleteRender()
        expect(rows()[3].classList.contains('lit')).toBe(false)
    })
})
