/**
 * clearPersisted() with no names clears every snapshot the framework wrote.
 *
 * The documented logout step is one call: wildflower.clearPersisted()
 * "removes every persisted query's snapshot", so one user's rows never
 * restore for the next. The page that runs it is often not the page that
 * saved them: a multi-page app, or a router that declares queries per route,
 * signs out from wherever the user happens to be.
 *
 * What is the framework's: a derived key (persist: true stores under
 * wf:query:<name>), and a custom key (persist: 'orders-42') that the
 * framework itself saved a snapshot under. Nothing else in storage is
 * touched, whatever its name or shape.
 *
 * What used to happen: the no-argument form walked only the queries
 * registered in the current page load, so snapshots saved by another page
 * (or another route not yet visited this load) stayed on disk, and restored
 * for whoever signed in next within the day.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// data-query ships in the full tier only.
const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-cpa-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

const jsonResponse = (data) => new Response(JSON.stringify(data), { status: 200 })

suite('clearPersisted() with no names, across pages', () => {
    let wildflower
    let realFetch
    const touched = []

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        realFetch = window.fetch
        window.fetch = async () => jsonResponse([{ id: 1, owner: 'previous user' }])
    })

    afterEach(() => {
        window.fetch = realFetch
        while (touched.length) { try { localStorage.removeItem(touched.pop()) } catch {} }
    })

    // One "page": declare persisted queries, let each save once.
    async function page(decls) {
        resetFramework()
        for (const [name, persist] of decls) {
            wildflower.query(name, { from: '/api/' + name, key: 'id', persist })
            wildflower.getQuery(name)
            touched.push(persist === true ? 'wf:query:' + name : persist)
        }
        await settle()
    }

    it('removes snapshots saved by a page that is no longer loaded, derived and custom keys alike', async () => {
        const orders = uname('orders')
        const custom = uname('acct') + '-orders'
        const profile = uname('profile')

        await page([[orders, true], [custom.replace('-orders', '-q'), custom]])   // page one
        expect(localStorage.getItem('wf:query:' + orders)).not.toBe(null)
        expect(localStorage.getItem(custom)).not.toBe(null)

        await page([[profile, true]])                                            // page two: logout lives here
        const n = wildflower.clearPersisted()

        expect(localStorage.getItem('wf:query:' + orders), 'derived key from another page').toBe(null)
        expect(localStorage.getItem(custom), 'custom key the framework saved on another page').toBe(null)
        expect(localStorage.getItem('wf:query:' + profile), 'this page\'s own query').toBe(null)
        // It clears every snapshot in storage, and the test files share one
        // origin's storage: the count is these three plus any snapshot another
        // file left there.
        expect(n).toBeGreaterThanOrEqual(3)
    })

    it('never touches a key the framework did not write', async () => {
        const foreign = ['other-lib:state', 'wf:query', 'wf:queryish', uname('app-setting')]
        for (const k of foreign) { localStorage.setItem(k, JSON.stringify({ v: 1, rows: [], savedAt: Date.now() })); touched.push(k) }
        await page([[uname('q'), true]])

        wildflower.clearPersisted()

        for (const k of foreign) expect(localStorage.getItem(k), k).not.toBe(null)
    })

    it('the named form is unchanged: it clears only the queries named', async () => {
        const a = uname('a'), b = uname('b')
        await page([[a, true], [b, true]])
        expect(wildflower.clearPersisted(a)).toBe(1)
        expect(localStorage.getItem('wf:query:' + a)).toBe(null)
        expect(localStorage.getItem('wf:query:' + b)).not.toBe(null)
    })
})
