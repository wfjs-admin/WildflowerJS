/**
 * Auto-retry with backoff (V1_4_ROADMAP §2).
 *
 * Contract: opt-in via `retry: N` (max attempts, fixed doubling curve from
 * 1s, capped at 30s — no policy object; that is extension territory).
 * While the ladder runs, neither error nor syncError is written and rows
 * are never wiped; the state lands only when the ladder exhausts. Any
 * successful sync (200 or 304) resets the ladder. A fresh refresh()/
 * invalidate() cancels a pending retry and starts a new episode. Going
 * offline suspends the ladder without burning attempts; reconnect resumes
 * it. AbortError (supersession) never triggers a retry.
 *
 * Timing: tests tune the internal base delay (wildflower._queryRetryBaseMs,
 * same pattern as _queryTeardownGraceMs) — the curve shape is what's under
 * test, not wall-clock seconds.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const devIt = isMinifiedBuild() ? it.skip : it

let seq = 0
const uname = (p) => `${p}-retry-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

const hook = () => window.__WF_DEVTOOLS_GLOBAL_HOOK__

suite('query auto-retry with backoff', () => {
    let container
    let wildflower
    let realFetch

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        // 60ms base: wide enough that a settle(30) assertion can observe
        // the pre-retry state without racing the first timer.
        wildflower._queryRetryBaseMs = 60
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
    })

    afterEach(() => {
        delete wildflower._queryRetryBaseMs
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    function mountList(qname, cname) {
        container.innerHTML = `
            <div data-component="${cname}">
                <ul data-query="${qname}"><template><li class="row" data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
    }

    it('without retry config, the first failure lands immediately (shipped behavior)', async () => {
        const q = uname('q'); const c = uname('c')
        let calls = 0
        window.fetch = async () => { calls++; throw new Error('boom') }
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        mountList(q, c)
        await settle()

        const h = wildflower.getQuery(q)
        expect(h.error).toBeTruthy()
        expect(calls).toBe(1)
    })

    it('initial-load failures retry on the curve; error lands only on exhaustion', async () => {
        const q = uname('q'); const c = uname('c')
        let calls = 0
        window.fetch = async () => { calls++; throw new Error('boom ' + calls) }
        wildflower.query(q, { from: '/api/x.json', key: 'id', retry: 2 })
        mountList(q, c)
        await settle(30)

        const h = wildflower.getQuery(q)
        expect(calls).toBe(1)
        expect(h.error, 'error must not land while the ladder runs').toBe(null)
        expect(h.isLoading, 'still loading during the ladder').toBe(true)

        await settle(400)
        expect(calls, 'original + 2 retries').toBe(3)
        expect(h.error, 'exhaustion lands the hard error').toBeTruthy()
        expect(h.isLoading).toBe(false)
    })

    it('a mid-ladder success lands rows and resets the ladder', async () => {
        const q = uname('q'); const c = uname('c')
        let calls = 0
        window.fetch = async () => {
            calls++
            if (calls < 2) throw new Error('boom')
            return jsonResponse([{ id: 1, name: 'ok' }])
        }
        wildflower.query(q, { from: '/api/x.json', key: 'id', retry: 3 })
        mountList(q, c)
        await settle(250)

        const h = wildflower.getQuery(q)
        expect(h.rows.length).toBe(1)
        expect(h.error).toBe(null)
        expect(h.syncError).toBe(null)
        expect(container.querySelector('.row').textContent).toBe('ok')
        if (!isMinifiedBuild()) {
            const entry = hook().getQueries().find(e => e.name === q)
            expect(entry.retry.attempt, 'success resets the ladder').toBe(0)
        }
    })

    it('background-sync failures keep rows and hold syncError until exhaustion', async () => {
        const q = uname('q'); const c = uname('c')
        let fail = false
        let calls = 0
        window.fetch = async () => {
            calls++
            if (fail) throw new Error('down')
            return jsonResponse([{ id: 1, name: 'good' }])
        }
        wildflower.query(q, { from: '/api/x.json', key: 'id', retry: 2 })
        mountList(q, c)
        await settle()
        const h = wildflower.getQuery(q)
        expect(h.rows.length).toBe(1)

        fail = true
        const callsBefore = calls
        h.invalidate()
        await settle(30)
        expect(h.syncError, 'no syncError while the ladder runs').toBe(null)
        expect(h.rows.length, 'rows never wiped').toBe(1)

        await settle(400)
        expect(calls - callsBefore, 'original + 2 retries').toBe(3)
        expect(h.syncError, 'exhaustion lands the transient error').toBeTruthy()
        expect(h.rows.length, 'rows survive exhaustion too').toBe(1)
        expect(container.querySelector('.row').textContent).toBe('good')
    })

    it('a fresh refresh() cancels the pending ladder and starts a new episode', async () => {
        const q = uname('q'); const c = uname('c')
        let fail = true
        let calls = 0
        window.fetch = async () => {
            calls++
            if (fail) throw new Error('down')
            return jsonResponse([{ id: 1, name: 'back' }])
        }
        wildflower.query(q, { from: '/api/x.json', key: 'id', retry: 5 })
        mountList(q, c)
        await settle(30)
        expect(calls).toBe(1)

        fail = false
        wildflower.getQuery(q).refresh()
        await settle(60)

        const h = wildflower.getQuery(q)
        expect(h.rows.length).toBe(1)
        expect(h.error).toBe(null)
        const callsAfter = calls
        await settle(200)
        expect(calls, 'no zombie retries after the manual refresh').toBe(callsAfter)
    })

    devIt('going offline suspends the ladder without burning attempts; online resumes it', async () => {
        const q = uname('q'); const c = uname('c')
        let calls = 0
        window.fetch = async () => { calls++; throw new Error('down') }
        wildflower.query(q, { from: '/api/x.json', key: 'id', retry: 2 })

        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
        try {
            mountList(q, c)
            await settle(200)
            const suspendedCalls = calls
            expect(suspendedCalls, 'offline: ladder suspended after the first failure').toBe(1)
            const entry = hook().getQueries().find(e => e.name === q)
            expect(entry.retry.attempt, 'suspension must not burn attempts').toBe(0)

            Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
            window.dispatchEvent(new Event('online'))
            await settle(400)
            expect(calls, 'resume runs the full ladder').toBe(1 + 3)
        } finally {
            delete navigator.onLine
        }
    })

    devIt('getQueries() exposes ladder progress while a retry is pending', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => { throw new Error('down') }
        wildflower.query(q, { from: '/api/x.json', key: 'id', retry: 3 })
        mountList(q, c)
        await settle(30)

        const entry = hook().getQueries().find(e => e.name === q)
        expect(entry.retry).toBeTruthy()
        expect(entry.retry.max).toBe(3)
        expect(entry.retry.attempt).toBeGreaterThan(0)
        expect(entry.retry.pending).toBe(true)
    })
})
