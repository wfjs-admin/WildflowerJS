/**
 * source descriptor at the ingestion choke point (envelope provenance
 * ruling, 2026-07-26).
 *
 * Every _queryIngest call declares source: 'fetch' | 'stream' | 'ssr' |
 * 'patch'. The descriptor is recorded on the controller and exposed ONLY
 * through the dev-build devtools hook (getQueries()); it never appears on
 * the public store surface, and production hooks do not carry getQueries.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const devIt = isMinifiedBuild() ? it.skip : it
const minIt = isMinifiedBuild() ? it : it.skip

let seq = 0
const uname = (p) => `${p}-src-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

const hook = () => window.__WF_DEVTOOLS_GLOBAL_HOOK__

suite('query source descriptor (R1)', () => {
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

    devIt('getQueries() reports lastSource "fetch" after a fetch ingest', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        const entry = hook().getQueries().find(e => e.name === q)
        expect(entry, 'query should appear in getQueries()').toBeTruthy()
        expect(entry.lastSource).toBe('fetch')
        expect(entry.active).toBe(true)
        expect(entry.rows).toBe(1)
    })

    devIt('ssr adoption records lastSource "ssr", then "fetch" when the network wins', async () => {
        const q = uname('q'); const c = uname('c')
        let release
        window.fetch = () => new Promise(res => {
            release = () => res(jsonResponse([{ sku: 'AX-100', stock: 40 }]))
        })
        wildflower.query(q, { from: '/api/inventory.json', key: 'sku' })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <table><tbody data-query="${q}">
                    <template>
                        <tr><td data-bind="sku"></td><td data-bind="stock" data-type="number"></td></tr>
                    </template>
                    <tr><td data-bind="sku">AX-100</td><td data-bind="stock" data-type="number">45</td></tr>
                </tbody></table>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(hook().getQueries().find(e => e.name === q).lastSource).toBe('ssr')

        release()
        await settle()
        expect(hook().getQueries().find(e => e.name === q).lastSource).toBe('fetch')
    })

    devIt('the descriptor never appears on the public store surface', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        const h = wildflower.getQuery(q)
        expect(h.lastSource).toBeUndefined()
        expect(h.source).toBeUndefined()
    })

    devIt('getQueries() covers registered-but-inactive queries', async () => {
        const q = uname('q')
        window.fetch = async () => jsonResponse([])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })

        const entry = hook().getQueries().find(e => e.name === q)
        expect(entry).toBeTruthy()
        expect(entry.active).toBe(false)
        expect(entry.lastSource).toBe(null)
    })

    minIt('production hook does not carry getQueries', async () => {
        expect(hook().getQueries).toBeUndefined()
    })
})
