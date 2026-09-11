/**
 * A `$queryName.path` markup binding must activate the query, with no
 * `[data-query]` container required anywhere.
 *
 * getQuery()'s own design note already states the intended contract:
 * "markup bindings and tracked JS reads alike signal lifecycle interest."
 * That principle was implemented for JS reads (getQuery() stamps lastRead
 * and deferred-activates on first read) but never extended to markup's
 * `$name.path` shorthand — every binding type (data-bind, data-list,
 * data-show, data-bind-class/style/attr) funnels through the SAME
 * normalizer, `_normalizeStoreShorthands`, so a query referenced only via
 * `$name.path` markup silently stayed dormant forever: no fetch, no rows,
 * no error, no warning — just a permanently empty `[]`.
 *
 * Two confirmed real-world sightings before this fix: the site's version
 * badge (a standalone `data-bind="$latestRelease...`" with no container)
 * and the Conduit build's `data-list="$feed.rows"` profile lists.
 *
 * Fix: `_normalizeStoreShorthands` now touches the matching query controller
 * on every shorthand it resolves — same lastRead-stamp + deferred-activate
 * pattern getQuery() already uses, reused rather than duplicated.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('$queryName.path markup activates the query with no container', () => {
    let container
    let wildflower
    let realFetch

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
    })

    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('data-list="$q.rows" alone activates and populates (the Conduit shape)', async () => {
        const q = uname('feed'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'alpha' }, { id: 2, name: 'beta' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })

        // No [data-query] container anywhere — only a $-path data-list.
        container.innerHTML = `
            <div data-component="${c}">
                <ul id="rows" data-list="$${q}.rows" data-key="id">
                    <template><li class="row" data-bind="name"></li></template>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(300)

        const texts = [...container.querySelectorAll('.row')].map(el => el.textContent)
        expect(texts).toEqual(['alpha', 'beta'])
    })

    it('a standalone data-bind="$q.path" alone activates (the version-badge shape)', async () => {
        const q = uname('release'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, version: '1.5.0' }])
        wildflower.query(q, { from: '/api/release.json', key: 'id' })

        container.innerHTML = `
            <div data-component="${c}">
                <span class="v" data-bind="$${q}.rows.0.version">unknown</span>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(300)

        expect(container.querySelector('.v').textContent).toBe('1.5.0')
    })

    it('a $q.path inside a compound data-show expression also activates', async () => {
        const q = uname('status'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, ready: true }])
        wildflower.query(q, { from: '/api/status.json', key: 'id' })

        container.innerHTML = `
            <div data-component="${c}">
                <p class="banner" data-show="!$${q}.isLoading && $${q}.count > 0">Ready</p>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(300)

        expect(getComputedStyle(container.querySelector('.banner')).display).not.toBe('none')
    })

    it('a registered query with no reference anywhere stays dormant (no eager activation)', async () => {
        const q = uname('unused'); const c = uname('c')
        let fetched = false
        window.fetch = async () => { fetched = true; return jsonResponse([]) }
        wildflower.query(q, { from: '/api/unused.json', key: 'id' })

        container.innerHTML = `<div data-component="${c}"><p>nothing references the query</p></div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(300)

        expect(fetched).toBe(false)
        expect(wildflower.getQuery(q).rows.length).toBe(0)
    })

    it('a [data-query] container still activates correctly (regression guard)', async () => {
        const q = uname('classic'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'gamma' }])
        wildflower.query(q, { from: '/api/classic.json', key: 'id' })

        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}">
                    <template><li class="row" data-bind="name"></li></template>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(300)

        expect(container.querySelector('.row').textContent).toBe('gamma')
    })
})
