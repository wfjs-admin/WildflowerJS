/**
 * Structural-change guards for item-level computeds that read the position frame
 * (info.first/last/length) through data-show and data-render.
 *
 * Complements list-item-computed-position-frame.test.js, which covers initial
 * render. After a row is added or removed, the row that becomes last must have
 * its `info.last` / `info.length` conditional re-evaluated. A computed *named*
 * onLast does not contain a literal `_last` token, so the list-context re-eval
 * sweep (which matches expressions on those tokens) does not pick it up; this
 * path is driven by the component-level conditional re-evaluation instead.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForCompleteRender, createTestContainer } from '../packages/test-utils/index.js'

describe('Item-level computed position frame across structural changes', () => {
    let testContainer, cleanup
    beforeAll(async () => { await loadFramework() })
    beforeEach(() => { resetFramework(); const c = createTestContainer({ visible: true }); testContainer = c.container; cleanup = c.cleanup })
    afterEach(() => { if (cleanup) cleanup() })

    it('data-show onLast computed re-evals after pop', async () => {
        wildflower.component('s-show-last', {
            state: { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            computed: { onLast(item, index, info) { return info.last } },
            popRow() { this.state.rows.pop() }
        })
        testContainer.innerHTML = `
            <div data-component="s-show-last">
                <button class="rm" data-action="popRow">rm</button>
                <ul data-list="rows" data-key="id">
                    <template><li><span class="m" data-show="onLast">X</span></li></template>
                </ul>
            </div>`
        wildflower.scan()
        await waitForCompleteRender(); await waitForCompleteRender()
        let m = testContainer.querySelectorAll('span.m')
        expect(Array.from(m).map(x => x.style.display)).toEqual(['none', 'none', ''])

        testContainer.querySelector('.rm').click()
        await waitForCompleteRender(); await waitForCompleteRender()
        m = testContainer.querySelectorAll('span.m')
        // After pop, the formerly-second row is now last → its badge must show.
        expect(Array.from(m).map(x => x.style.display)).toEqual(['none', ''])
    })

    it('data-render onLast computed re-evals after pop', async () => {
        wildflower.component('s-render-last', {
            state: { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            computed: { onLast(item, index, info) { return info.last } },
            popRow() { this.state.rows.pop() }
        })
        testContainer.innerHTML = `
            <div data-component="s-render-last">
                <button class="rm" data-action="popRow">rm</button>
                <ul data-list="rows" data-key="id">
                    <template><li><span class="r" data-render="onLast">L</span></li></template>
                </ul>
            </div>`
        wildflower.scan()
        await waitForCompleteRender(); await waitForCompleteRender()
        expect(testContainer.querySelectorAll('span.r').length).toBe(1)

        testContainer.querySelector('.rm').click()
        await waitForCompleteRender(); await waitForCompleteRender()
        // Still exactly one rendered (the new last row).
        expect(testContainer.querySelectorAll('span.r').length).toBe(1)
    })
})
