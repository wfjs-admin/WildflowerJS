/**
 * Activation when the query is registered AFTER its markup is bound.
 *
 * Every existing data-query suite calls wildflower.query() before
 * wildflower.scan(), so the reverse order has never been pinned. A real app
 * can reach it: the component that owns the markup initializes from one
 * module while the query is declared in another, and module order is not
 * something the markup states.
 *
 * Reproduces the Conduit "tags never fetches" report (memory:
 * data-query-once-activation-gap), where a data-query-bound list sometimes
 * never fired its initial fetch at all, with isLoading false, count 0, and
 * error null, meaning no fetch was ever attempted rather than one that failed.
 * The repro produces that state exactly.
 *
 * ROOT CAUSE. Activation is a one-shot event during a component's binding
 * compilation. _transformQueryElements is hooked from
 * RenderingCore._processComponentBindings, and when the named query is not
 * registered at that instant it warns and `continue`s (QuerySystem.js:1008-1015)
 * without setting _wfQueryBound and without recording that the element is
 * waiting. Nothing re-runs the transform for a component that is already
 * initialized, so a later wildflower.query() never reaches the markup. The
 * query exists, its store exists, and refresh() works; only the bound element
 * is permanently inert.
 *
 * The $name.rows shorthand fails the same way for the same reason: its touch
 * runs during binding normalization, and with no store to depend on the
 * binding never re-evaluates, so the touch never happens again.
 *
 * In an app this presents as intermittent because it is an ordering race
 * between a component's first bind and the module that declares the query.
 * Conduit's `feed` looked healthy only because its router called refresh()
 * explicitly, which activates the controller without the transform.
 *
 * SECOND BLOCKER, found while choosing a fix. Repairing the transform alone is
 * not enough. Two probes (removed after they answered, results recorded here):
 *
 *   1. Hand-writing the attributes the transform would have written, so the
 *      list binding compiles at the normal time against a query store that
 *      does not exist yet, then registering and refreshing: the store reaches
 *      2 rows and the list renders 0.
 *   2. The same shape with a plain wildflower.store() instead of a query:
 *      0 rendered after registration, and still 0 after mutating the store.
 *
 * So a $entity binding compiled before its entity registers was permanently
 * inert, and that was never query-specific. The query case inherited it. The
 * general half is fixed in EntitySystem/StoreManager and pinned separately in
 * late-entity-registration.test.js; this file pins the query half, which is the
 * transform writing what it can without a controller so a real binding exists
 * for that machinery to wake.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-latereg-${++seq}`

function jsonResponse(data, { status = 200 } = {}) {
    return new Response(JSON.stringify(data), { status })
}

async function settle(ms = 120) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query: registration after binding', () => {
    let container
    let wildflower
    let realFetch
    let warnings
    let realWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        warnings = []
        realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')); }
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        delete wildflower._queryTeardownGraceMs
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('CONTROL: query registered before the scan fetches on activation', async () => {
        const q = uname('q'); const c = uname('c')
        let fetches = 0
        window.fetch = async () => { fetches++; return jsonResponse([{ name: 'a' }, { name: 'b' }]) }

        wildflower.query(q, { key: 'name', from: '/api/tags' })

        container.innerHTML = `
            <div data-component="${c}">
                <div class="tag-list" data-query="${q}">
                    <template><span class="tag" data-bind="name"></span></template>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(fetches).toBe(1)
        expect(container.querySelectorAll('.tag').length).toBe(2)
    })

    it('REPRO: query registered after the scan still fetches', async () => {
        const q = uname('q'); const c = uname('c')
        let fetches = 0
        window.fetch = async () => { fetches++; return jsonResponse([{ name: 'a' }, { name: 'b' }]) }

        container.innerHTML = `
            <div data-component="${c}">
                <div class="tag-list" data-query="${q}">
                    <template><span class="tag" data-bind="name"></span></template>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        // The component is bound and the query does not exist yet. Now declare
        // it, exactly as a later-loading module would.
        wildflower.query(q, { key: 'name', from: '/api/tags' })
        await settle()

        const state = wildflower.getQuery(q)
        expect({
            fetches,
            isLoading: state.isLoading,
            error: state.error,
            rendered: container.querySelectorAll('.tag').length
        }).toEqual({ fetches: 1, isLoading: false, error: null, rendered: 2 })
    })

    it('REPRO: record shape registered after the scan still fetches', async () => {
        const q = uname('q'); const c = uname('c')
        let fetches = 0
        window.fetch = async () => { fetches++; return jsonResponse({ version: '9.9.9' }) }

        container.innerHTML = `
            <div data-component="${c}">
                <article data-query="${q}"><b class="v" data-bind="version"></b></article>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        wildflower.query(q, { from: '/api/release' })
        await settle()

        expect(fetches).toBe(1)
        expect(container.querySelector('.v').textContent).toBe('9.9.9')
    })

    it('COMPARISON: the $name.rows shorthand under the same ordering', async () => {
        const q = uname('q'); const c = uname('c')
        let fetches = 0
        window.fetch = async () => { fetches++; return jsonResponse([{ name: 'a' }, { name: 'b' }]) }

        container.innerHTML = `
            <div data-component="${c}">
                <div data-list="$${q}.rows" data-key="name">
                    <template><span class="tag" data-bind="name"></span></template>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        wildflower.query(q, { key: 'name', from: '/api/tags' })
        await settle()

        // Recorded rather than asserted-blind: this is the path Conduit's
        // working `feed` query used, and the point is whether it differs.
        expect({ fetches, rendered: container.querySelectorAll('.tag').length })
            .toEqual({ fetches: 1, rendered: 2 })
    })

    // Warnings are stripped from production builds, so both warning pins are
    // dev-arm only. The rendering half of late registration is covered in both
    // arms by the REPRO cases above.
    it.skipIf(isMinifiedBuild())('a query that arrives in time is not warned about', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ name: 'a' }])
        wildflower._queryTeardownGraceMs = 40

        container.innerHTML = `
            <div data-component="${c}">
                <div class="tag-list" data-query="${q}">
                    <template><span class="tag" data-bind="name"></span></template>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        wildflower.query(q, { key: 'name', from: '/api/tags' })
        await settle(120)

        // Declaring after the markup binds is a legal ordering now, so warning
        // at bind time would fire on correct code. The warning is armed and the
        // arrival disarms it.
        expect(warnings.filter(w => w.includes('WF-955') && w.includes(q))).toEqual([])
        expect(container.querySelectorAll('.tag').length).toBe(1)
    })

    it.skipIf(isMinifiedBuild())('a query that never arrives is named after the grace', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower._queryTeardownGraceMs = 40

        container.innerHTML = `
            <div data-component="${c}">
                <div class="tag-list" data-query="${q}">
                    <template><span class="tag" data-bind="name"></span></template>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(160)

        const hits = warnings.filter(w => w.includes('WF-955') && w.includes(q))
        expect(hits.length).toBe(1)
        expect(hits[0]).toContain('waiting for one that has not arrived')
    })
})
