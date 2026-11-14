/**
 * An appended page is never dropped by a later fetch on the same query.
 *
 * Every read used to supersede the read in flight (last call wins, the
 * older request aborted), append mode included. Two "load more" calls made
 * before the first page landed, the documented pattern of a page counter
 * bumped per click, requested page 3 while page 2 was still on the wire,
 * and page 2 never arrived. A refresh rung firing while one load-more was
 * in flight (a poll tick, a focus refetch, the invalidate after a write)
 * aborted it, so the click appended nothing while the page counter had
 * moved on. Neither case raised an error or a flag.
 *
 * Pinned: queued appends land in the order they were asked for; an engine
 * refetch that arrives during an append waits for it instead of aborting
 * it; an explicit refresh() without append is still a reset and still
 * replaces the accumulated rows.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-apsup-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

const pageRows = (p) => [1, 2, 3].map((i) => ({ id: (p - 1) * 3 + i, name: 'r' + ((p - 1) * 3 + i) }))

suite('append mode under supersession', () => {
    let container
    let wildflower
    let realFetch
    let realWarn

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        realWarn = console.warn
        console.warn = () => {}
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    // A paged server whose response time is chosen per page; honours abort.
    function pagedServer(delayFor) {
        window.fetch = (url, init) => new Promise((resolve, reject) => {
            const p = +(new URL(String(url), location.href).searchParams.get('page') || 1)
            const t = setTimeout(() => resolve(new Response(JSON.stringify(pageRows(p)), { status: 200 })), delayFor(p))
            if (init && init.signal) {
                init.signal.addEventListener('abort', () => {
                    clearTimeout(t)
                    reject(new DOMException('aborted', 'AbortError'))
                })
            }
        })
    }

    it('two load-mores before the first lands append both pages, in order', async () => {
        const q = uname('feed')
        pagedServer(() => 80)
        wildflower.query(q, { from: `/api/${q}`, key: 'id' })
        const feed = wildflower.getQuery(q)
        await settle(200)

        let page = 1
        const loadMore = () => feed.refresh({ params: { page: ++page }, append: true })
        loadMore()
        await settle(10)
        loadMore()
        await settle(400)

        expect(feed.rows.map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    })

    it('a poll tick during an in-flight load-more does not drop the page', async () => {
        const q = uname('feed'); const c = uname('c')
        pagedServer((p) => (p === 2 ? 400 : 20))
        wildflower.query(q, { from: `/api/${q}`, key: 'id', refresh: [0.1] })
        container.innerHTML = `<div data-component="${c}"><ul data-query="${q}"><template><li data-bind="name"></li></template></ul></div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(150)

        const feed = wildflower.getQuery(q)
        feed.refresh({ params: { page: 2 }, append: true })
        await settle(700)

        expect(feed.rows.map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('an explicit refresh() without append still resets an accumulated list', async () => {
        const q = uname('feed')
        pagedServer(() => 20)
        wildflower.query(q, { from: `/api/${q}`, key: 'id' })
        const feed = wildflower.getQuery(q)
        await settle(100)
        await feed.refresh({ params: { page: 2 }, append: true })
        expect(feed.rows.map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6])

        await feed.refresh()
        expect(feed.rows.map(r => r.id)).toEqual([1, 2, 3])
    })
})
