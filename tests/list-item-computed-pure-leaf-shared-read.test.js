/**
 * An item-level computed reading a field that ALSO has exactly one plain text
 * binding (statically "kind-pure"). The targeted one-write fast path in the
 * per-list computed sink must NOT skip the full-row apply for such a field:
 * the item computed is a reader the static classifier cannot see (its reads
 * partition to sink stamps under the list tracking frame, not to computed-node
 * edges), so skipping the full-row apply leaves the computed's binding
 * permanently stale.
 *
 * Found 2026-07-03 by the krausest computed-clone smoke check (col-md-6
 * item-computed column went stale after `update every 10th row` on the
 * S5b/S5c working tree while the S5a bundle tracked correctly).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Item computed reading a kind-pure text field (sink fast-path soundness)', () => {
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

    function mount(name) {
        testContainer.innerHTML = `
            <div data-component="${name}">
                <ul data-list="items" data-key="id">
                    <template>
                        <li><span class="raw" data-bind="label"></span><span class="derived" data-bind="labelText"></span></li>
                    </template>
                </ul>
            </div>
        `
        wildflower.scan()
    }

    it('PLSR-A. derived column follows a write to the shared field', async () => {
        wildflower.component('plsr-A', {
            state: { items: [{ id: 1, label: 'alpha' }, { id: 2, label: 'beta' }] },
            computed: {
                labelText(item) { return item.label + '*' }
            },
            init() { componentRef = this }
        })
        mount('plsr-A')
        await waitForCompleteRender()

        let rows = testContainer.querySelectorAll('li')
        expect(rows.length).toBe(2)
        expect(rows[0].querySelector('.raw').textContent).toBe('alpha')
        expect(rows[0].querySelector('.derived').textContent).toBe('alpha*')

        componentRef.state.items[0].label = 'gamma'
        await waitForCompleteRender()

        rows = testContainer.querySelectorAll('li')
        expect(rows[0].querySelector('.raw').textContent).toBe('gamma')
        expect(rows[0].querySelector('.derived').textContent).toBe('gamma*')
    })

    it('PLSR-B. repeated writes keep both columns live (krausest update shape)', async () => {
        wildflower.component('plsr-B', {
            state: { items: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }, { id: 3, label: 'three' }] },
            computed: {
                labelText(item) { return item.label }
            },
            init() { componentRef = this }
        })
        mount('plsr-B')
        await waitForCompleteRender()

        for (let pass = 0; pass < 3; pass++) {
            componentRef.state.items[0].label += ' !!!'
            componentRef.state.items[2].label += ' !!!'
            await waitForCompleteRender()
        }

        const rows = testContainer.querySelectorAll('li')
        expect(rows[0].querySelector('.raw').textContent).toBe('one !!! !!! !!!')
        expect(rows[0].querySelector('.derived').textContent).toBe('one !!! !!! !!!')
        expect(rows[2].querySelector('.derived').textContent).toBe('three !!! !!! !!!')
        expect(rows[1].querySelector('.derived').textContent).toBe('two')
    })
})
