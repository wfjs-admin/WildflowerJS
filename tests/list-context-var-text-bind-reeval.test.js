import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForCompleteRender, createTestContainer } from '../packages/test-utils/index.js'

describe('List-context-var text data-bind re-evaluation', () => {
    let testContainer, cleanup
    beforeAll(async () => { await loadFramework() })
    beforeEach(() => { resetFramework(); const c = createTestContainer({ visible: true }); testContainer = c.container; cleanup = c.cleanup })
    afterEach(() => { if (cleanup) cleanup() })

    it('re-evaluates a text data-bind using _index after removing the first item', async () => {
        wildflower.component('idx-text', {
            state: { items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
            removeFirst() { this.state.items.shift() }
        })
        testContainer.innerHTML = `
            <div data-component="idx-text">
                <button class="rm" data-action="removeFirst">rm</button>
                <ul data-list="items">
                    <template><li data-bind="name + ' #' + (_index + 1)"></li></template>
                </ul>
            </div>`
        wildflower.scan()
        await waitForCompleteRender()
        let lis = testContainer.querySelectorAll('li')
        expect(Array.from(lis).map(l => l.textContent)).toEqual(['A #1', 'B #2', 'C #3'])

        testContainer.querySelector('.rm').click()
        await waitForCompleteRender()
        lis = testContainer.querySelectorAll('li')
        expect(Array.from(lis).map(l => l.textContent)).toEqual(['B #1', 'C #2'])
    })

    it('re-evaluates a text data-bind using _index after adding an item', async () => {
        wildflower.component('idx-add', {
            state: { items: [{ name: 'A' }, { name: 'B' }] },
            addItem() { this.state.items.push({ name: 'C' }) }
        })
        testContainer.innerHTML = `
            <div data-component="idx-add">
                <button class="add" data-action="addItem">add</button>
                <ul data-list="items">
                    <template><li data-bind="name + ' #' + (_index + 1)"></li></template>
                </ul>
            </div>`
        wildflower.scan()
        await waitForCompleteRender()
        let lis = testContainer.querySelectorAll('li')
        expect(Array.from(lis).map(l => l.textContent)).toEqual(['A #1', 'B #2'])

        testContainer.querySelector('.add').click()
        await waitForCompleteRender()
        lis = testContainer.querySelectorAll('li')
        expect(Array.from(lis).map(l => l.textContent)).toEqual(['A #1', 'B #2', 'C #3'])
    })

    // KNOWN ISSUE (deeper than the resolveData conversion): a list-row data-show
    // using a position var (_last/_first/_index) is double-driven. The index-shift
    // re-eval (_updateListContextClassBindings → _reEvalItemContextShow) now computes
    // the correct value, but a per-item effect re-applies data-show with a stale
    // value AFTER it, overriding the result (verified via applyShow call-order probe:
    // the new-last item is set visible, then hidden again). Fixing this requires the
    // per-item effect to re-evaluate position vars on sibling removal — its own slice.
    it('re-evaluates data-show using _last on a child element after removing the last item', async () => {
        wildflower.component('last-show', {
            state: { items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
            removeLast() { this.state.items.pop() }
        })
        testContainer.innerHTML = `
            <div data-component="last-show">
                <button class="rm" data-action="removeLast">rm</button>
                <ul data-list="items">
                    <template><li><span data-bind="name"></span><em class="badge" data-show="_last">LAST</em></li></template>
                </ul>
            </div>`
        wildflower.scan()
        await waitForCompleteRender()
        let badges = testContainer.querySelectorAll('.badge')
        expect(Array.from(badges).map(b => b.style.display !== 'none')).toEqual([false, false, true])

        testContainer.querySelector('.rm').click()
        await waitForCompleteRender()
        badges = testContainer.querySelectorAll('.badge')
        // The formerly-second item is now last; its badge must become visible.
        expect(Array.from(badges).map(b => b.style.display !== 'none')).toEqual([false, true])
    })
})
