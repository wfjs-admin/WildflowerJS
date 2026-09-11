/**
 * The result cache's bounds, and the dwell filter that keeps churn out of it.
 *
 * The cache exists so returning to a page, filter, or detail view you have
 * already seen paints immediately. Its bound was a fixed five entries, which
 * is low for paging, and raising it alone would have made the cache worse
 * rather than better: `params:` as a function makes search-as-you-type
 * natural, and every debounced keystroke resolves its own URL. A sentence
 * typed into a search box fills the cache with prefixes nobody navigates back
 * to, evicting the entries that are actually revisited.
 *
 * What separates the two is dwell rather than size. A URL superseded a few
 * hundred milliseconds later was a keystroke; one that stayed current while
 * the page was read was a view. So a URL whose successor arrives inside
 * `queryCacheMinDwell` drops out, and the bounds that remain are an entry cap
 * and a row budget, since entry count alone says nothing about how much a
 * query retains.
 *
 * All three are global config with defaults, not per-query options: recourse
 * for a pathological pattern without a per-query cache API.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-rcache-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

function jsonResponse(data) {
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    return new Response(JSON.stringify(data), { headers })
}

const CACHE_KEYS = ['queryCacheEntries', 'queryCacheRows', 'queryCacheMinDwell']

suite('data-query result cache bounds', () => {
    let container
    let wildflower
    let realFetch

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        // Each page yields `size` rows, so the row budget can be driven
        // independently of the entry count.
        window.fetch = (url) => {
            const u = String(url)
            const page = Number((u.match(/page=(\d+)/) || [])[1] || 1)
            const size = Number((u.match(/size=(\d+)/) || [])[1] || 2)
            const rows = Array.from({ length: size }, (_, i) => ({
                id: page * 1000 + i,
                name: `p${page}r${i}`
            }))
            return Promise.resolve(jsonResponse(rows))
        }
    })

    afterEach(() => {
        window.fetch = realFetch
        for (const k of CACHE_KEYS) delete wildflower.options[k]
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function declare(q, state) {
        wildflower.query(q, {
            from: '/api/items',
            key: 'id',
            params: () => ({ page: state.page, size: state.size })
        })
    }

    function mount(q, c) {
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    const snaps = (q) => wildflower._queryControllers.get(q)?.snapshots
    const size = (q) => (snaps(q) ? snaps(q).size : 0)

    // Walk to a new page and let its response land.
    async function goTo(q, state, page) {
        state.page = page
        await wildflower.getQuery(q).refresh({ params: { page, size: state.size } })
        await settle(20)
    }

    it('CONTROL: a resolved URL is cached', async () => {
        const q = uname('q'); const c = uname('c')
        const state = { page: 1, size: 2 }
        declare(q, state)
        mount(q, c)
        await settle(120)

        expect(size(q), 'the first resolved URL is held').toBe(1)
    })

    it('a URL superseded inside the dwell window does not stay cached', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.config({ queryCacheMinDwell: 300 })
        const state = { page: 1, size: 2 }
        declare(q, state)
        mount(q, c)
        await settle(120)
        expect(size(q)).toBe(1)

        // Three pages in quick succession, each superseding the last well
        // inside the window: the typed-sentence shape.
        await goTo(q, state, 2)
        await goTo(q, state, 3)

        expect(size(q), 'only the URL still on screen survives').toBe(1)
        expect([...snaps(q).keys()][0], 'and it is the last one').toContain('page=3')
    })

    it('a URL that stayed current is kept', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.config({ queryCacheMinDwell: 100 })
        const state = { page: 1, size: 2 }
        declare(q, state)
        mount(q, c)
        await settle(120)

        await settle(250)          // page 1 dwells past the window
        await goTo(q, state, 2)

        expect(size(q), 'a page that was actually read is retained').toBe(2)
    })

    it('minDwell 0 turns the dwell filter off', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.config({ queryCacheMinDwell: 0 })
        const state = { page: 1, size: 2 }
        declare(q, state)
        mount(q, c)
        await settle(120)

        await goTo(q, state, 2)
        await goTo(q, state, 3)

        expect(size(q), 'every URL is kept when dwell is not required').toBe(3)
    })

    it('the entry cap evicts the oldest', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.config({ queryCacheMinDwell: 0, queryCacheEntries: 3 })
        const state = { page: 1, size: 2 }
        declare(q, state)
        mount(q, c)
        await settle(120)

        for (const p of [2, 3, 4, 5]) await goTo(q, state, p)

        expect(size(q), 'held at the configured cap').toBe(3)
        const keys = [...snaps(q).keys()].join(' ')
        expect(keys, 'the newest survive').toContain('page=5')
        expect(keys, 'the oldest are gone').not.toContain('page=1')
    })

    it('the row budget evicts even when the entry cap has room', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.config({ queryCacheMinDwell: 0, queryCacheEntries: 50, queryCacheRows: 5 })
        const state = { page: 1, size: 2 }
        declare(q, state)
        mount(q, c)
        await settle(120)

        await goTo(q, state, 2)
        await goTo(q, state, 3)

        // Three pages of two rows is six, over the budget of five, so the
        // oldest goes and four rows remain.
        expect(size(q), 'bounded by rows, not by entry count').toBe(2)
    })

    it('a single result larger than the whole budget is still cached', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.config({ queryCacheMinDwell: 0, queryCacheRows: 5 })
        const state = { page: 1, size: 40 }
        declare(q, state)
        mount(q, c)
        await settle(120)

        expect(size(q), 'the budget never empties the cache entirely').toBe(1)
    })

    it('queryCacheEntries 0 disables the cache', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.config({ queryCacheEntries: 0, queryCacheMinDwell: 0 })
        const state = { page: 1, size: 2 }
        declare(q, state)
        mount(q, c)
        await settle(120)
        await goTo(q, state, 2)

        expect(size(q), 'nothing is retained').toBe(0)
    })

    it('the default cap is well above the old fixed five', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.config({ queryCacheMinDwell: 0 })
        const state = { page: 1, size: 2 }
        declare(q, state)
        mount(q, c)
        await settle(120)

        for (const p of [2, 3, 4, 5, 6, 7, 8]) await goTo(q, state, p)

        expect(size(q), 'eight distinct pages all fit').toBe(8)
    })
})
