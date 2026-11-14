/**
 * A config({ headers }) key that is not an origin.
 *
 * Header defaults are keyed by origin ('https://api.example.com') or 'self'.
 * A key with no scheme and authority ('api.example.com', 'localhost:3000')
 * names no origin, so no request can match it: it is skipped, and
 * development builds say so (WF-981).
 *
 * What used to happen: the skip sat inside the development-only guard, so a
 * production build fell through and normalized the key with the same helper
 * that resolves a request URL. A string with no authority reads as relative,
 * and a relative URL is the document's own origin, so the misspelled key
 * became 'self'. Its headers rode every same-origin read and write, and
 * because it was set after the real 'self' entry, it replaced that entry:
 * the app's own Authorization header stopped being sent. Development builds
 * never showed it. The first test fails on the minified lane only.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

// data-query ships in the full tier only.
const suite = hasFeature('query') ? describe : describe.skip
const devIt = isMinifiedBuild() ? it.skip : it

let seq = 0
const uname = (p) => `${p}-hno-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

const jsonResponse = (data) => new Response(JSON.stringify(data), { status: 200 })

suite('config({ headers }): a key that is not an origin', () => {
    let wildflower
    let realFetch
    let realWarn
    let warnings

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        realFetch = window.fetch
        realWarn = console.warn
        warnings = []
        console.warn = (...a) => { warnings.push(a.map(String).join(' ')); realWarn.apply(console, a) }
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        wildflower.config({ headers: undefined })
    })

    function capture() {
        const sent = []
        window.fetch = async (url, opts) => { sent.push({ url: String(url), headers: (opts && opts.headers) || {} }); return jsonResponse([]) }
        return sent
    }

    it('is skipped in every build: its headers never reach the page\'s own origin, and self still ships', async () => {
        wildflower.config({ headers: {
            self: { Authorization: 'Token own-origin' },
            'api.example.com': { 'X-Api-Key': 'meant-for-the-api' }
        } })
        const sent = capture()
        const q = uname('q')
        wildflower.query(q, { from: '/api/items' })
        wildflower.getQuery(q)
        await settle()

        expect(sent.length).toBe(1)
        expect(sent[0].headers['X-Api-Key'], 'a key that is no origin matches no request').toBeUndefined()
        expect(sent[0].headers.Authorization, 'the real self entry is not replaced').toBe('Token own-origin')
    })

    it('a port-only key is skipped the same way', async () => {
        wildflower.config({ headers: { 'localhost:3000': { 'X-Api-Key': 'k' } } })
        const sent = capture()
        const q = uname('q')
        wildflower.query(q, { from: '/api/items' })
        wildflower.getQuery(q)
        await settle()
        expect(sent[0].headers['X-Api-Key']).toBeUndefined()
    })

    it('a write is covered as well as a read', async () => {
        wildflower.config({ headers: { self: { Authorization: 'Token own-origin' }, 'api.example.com': { 'X-Api-Key': 'k' } } })
        const sent = capture()
        const q = uname('q')
        wildflower.query(q, { from: '/api/items', key: 'id', to: '/api/items/:id', body: (i) => i })
        const h = wildflower.getQuery(q)
        await settle()
        h.patch([{ id: 1, name: 'a' }])
        await h.write({ id: 1, name: 'b' }).catch(() => {})
        const write = sent.find(s => s.url === '/api/items/1')
        expect(write).toBeTruthy()
        expect(write.headers['X-Api-Key']).toBeUndefined()
        expect(write.headers.Authorization).toBe('Token own-origin')
    })

    devIt('development builds name the key (WF-981)', async () => {
        wildflower.config({ headers: { 'api.example.com': { 'X-Api-Key': 'k' } } })
        capture()
        const q = uname('q')
        wildflower.query(q, { from: '/api/items' })
        wildflower.getQuery(q)
        await settle()
        expect(warnings.some(w => w.includes('WF-981') && w.includes('api.example.com'))).toBe(true)
    })
})
