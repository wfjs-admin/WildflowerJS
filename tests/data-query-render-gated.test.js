/**
 * A data-query element inside a data-render section.
 *
 * data-render REMOVES its subtree from the DOM when the condition is false, so
 * a [data-query] inside one is absent at first scan and arrives later, when the
 * condition flips. The primary transform runs from
 * RenderingCore._processComponentBindings, once per component instance, so
 * nodes that appear after that pass have to be picked up some other way.
 *
 * This is the shape Conduit's `tags` query actually has: the sidebar tag-list
 * lives inside <section data-render="$route.page === 'feed'">, and the query is
 * declared in queries.js well before any scan. The app carries an explicit
 * getQuery('tags').refresh() at boot; removing it fails the "should display
 * popular tags" e2e, and restoring it passes. So whatever this is, it is NOT
 * the late-registration defect fixed in data-query-late-registration.test.js,
 * which reproduced the same reported STATE from a different cause.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-rendergate-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 120) {
    await new Promise(r => setTimeout(r, ms))
}

suite('data-query inside data-render', () => {
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
    })

    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('CONTROL: visible from the start fetches and renders', async () => {
        const q = uname('q'); const c = uname('c')
        let fetches = 0
        window.fetch = async () => { fetches++; return jsonResponse([{ name: 'popular' }, { name: 'trending' }]) }
        wildflower.query(q, { key: 'name', from: '/api/tags' })

        container.innerHTML = `
            <div data-component="${c}">
                <section data-render="visible">
                    <div class="tag-list" data-query="${q}">
                        <template><a class="tag-pill" data-bind="name"></a></template>
                    </div>
                </section>
            </div>
        `
        wildflower.component(c, { state: { visible: true } })
        wildflower.scan(container)
        await settle()

        expect(fetches).toBe(1)
        expect(container.querySelectorAll('.tag-pill').length).toBe(2)
    })

    it('hidden at scan, revealed later, still fetches and renders', async () => {
        const q = uname('q'); const c = uname('c')
        let fetches = 0
        window.fetch = async () => { fetches++; return jsonResponse([{ name: 'popular' }, { name: 'trending' }]) }
        wildflower.query(q, { key: 'name', from: '/api/tags' })

        container.innerHTML = `
            <div data-component="${c}">
                <section data-render="visible">
                    <div class="tag-list" data-query="${q}">
                        <template><a class="tag-pill" data-bind="name"></a></template>
                    </div>
                </section>
            </div>
        `
        wildflower.component(c, { state: { visible: false } })
        wildflower.scan(container)
        await settle()

        wildflower.getComponent(c).visible = true
        await settle(200)

        expect({ fetches, rendered: container.querySelectorAll('.tag-pill').length })
            .toEqual({ fetches: 1, rendered: 2 })
    })
})
