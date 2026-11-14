/**
 * Replacing config({ headers }) at run time.
 *
 * The usual shape: an app sets a default before sign-in and replaces it
 * once a token exists. The origin map is built once per config object and
 * cached, so the case to pin is that a NEW object passed through config()
 * is the one the next request uses.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// data-query ships in the full tier only.
const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-hrc-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

suite('config({ headers }) replaced at run time', () => {
    let wildflower
    let realFetch

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        realFetch = window.fetch
    })

    afterEach(() => {
        window.fetch = realFetch
        wildflower.config({ headers: undefined })
    })

    it('the next request carries the replaced default', async () => {
        const seen = []
        window.fetch = async (u, o) => {
            seen.push(o.headers.Authorization || null)
            return new Response(JSON.stringify([{ id: 1 }]), { status: 200 })
        }
        wildflower.config({ headers: { self: { Authorization: 'anon' } } })
        const q = uname('q')
        wildflower.query(q, { from: '/api/x', key: 'id' })
        wildflower.getQuery(q)
        await settle()

        wildflower.config({ headers: { self: { Authorization: 'Bearer user' } } })
        await wildflower.getQuery(q).refresh()

        expect(seen).toEqual(['anon', 'Bearer user'])
    })
})
