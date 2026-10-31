/**
 * Development builds keep every coded diagnostic as data as well as printing
 * it: `wildflower.diagnostics` holds the newest 200 as plain objects, and each
 * one is also dispatched as a `wildflower:diagnostic` event on document. Code
 * that checks a page (a test, a dev overlay, an agent) reads what the console
 * shows without parsing console text. Production builds carry none of it.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, isMinifiedBuild } from './helpers/load-framework.js'

let n = 0
const live = []
const uniq = (base) => base + (++n)

beforeAll(async () => { await loadFramework() })
afterEach(() => {
    while (live.length) wildflower.unregister(live.pop())
})

// WF-236 (an underscore key in state) warns on every tier.
function trigger() {
    const name = uniq('diagStore'); live.push(name)
    wildflower.store(name, { state: { a: 1, _hidden: 0 } })
    return name
}

async function quietly(fn) {
    const w = console.warn, e = console.error
    console.warn = () => {}; console.error = () => {}
    try { await fn() } finally { console.warn = w; console.error = e }
}

// The printed line starts with the code alone, `[WF-236] `, as a production
// build's `[code] <url>` line does. Development builds printed
// `[WF WF-236]` before 1.5.5. (Production builds do not print WF-236.)
describe.skipIf(isMinifiedBuild())('the printed line (development builds)', () => {
    it('starts [WF-236] with no doubled prefix', async () => {
        const lines = []
        const w = console.warn, e = console.error
        console.warn = (...a) => lines.push(String(a[0]))
        console.error = (...a) => lines.push(String(a[0]))
        try { trigger() } finally { console.warn = w; console.error = e }
        expect(lines.filter((l) => /^\[WF-236\] /.test(l)).length).toBe(1)
        expect(lines.filter((l) => /\[WF WF-/.test(l))).toEqual([])
    })
})

describe.skipIf(isMinifiedBuild())('structured diagnostics (development builds)', () => {
    it('records a warning as a plain object on wildflower.diagnostics', async () => {
        wildflower.diagnostics.length = 0
        await quietly(trigger)
        const hit = wildflower.diagnostics.filter((d) => d.code === 'WF-236')
        expect(hit.length).toBe(1)
        const d = hit[0]
        expect(d.severity).toBe('warning')
        expect(typeof d.message).toBe('string')
        expect(d.message.length).toBeGreaterThan(0)
        expect(d.context).toContain('_hidden')
        expect(typeof d.suggestion).toBe('string')
        expect(d.docs).toContain('WF-236')
        expect(typeof d.time).toBe('number')
    })

    it('dispatches each one as a wildflower:diagnostic event on document', async () => {
        const got = []
        const on = (ev) => got.push(ev.detail)
        document.addEventListener('wildflower:diagnostic', on)
        try { await quietly(trigger) } finally { document.removeEventListener('wildflower:diagnostic', on) }
        const hit = got.filter((d) => d.code === 'WF-236')
        expect(hit.length).toBe(1)
        expect(hit[0]).toBe(wildflower.diagnostics[wildflower.diagnostics.length - 1])
    })

    it('keeps the newest 200, and clears with length = 0', async () => {
        wildflower.diagnostics.length = 0
        await quietly(() => { for (let i = 0; i < 205; i++) trigger() })
        expect(wildflower.diagnostics.length).toBe(200)
        const last = wildflower.diagnostics[199]
        expect(last.context).toContain(live[live.length - 1])
        wildflower.diagnostics.length = 0
        await quietly(trigger)
        expect(wildflower.diagnostics.length).toBe(1)
    })
})

describe.skipIf(!isMinifiedBuild())('structured diagnostics (production builds)', () => {
    it('are not there: no wildflower.diagnostics, no events', async () => {
        expect(wildflower.diagnostics).toBeUndefined()
        const got = []
        const on = (ev) => got.push(ev.detail)
        document.addEventListener('wildflower:diagnostic', on)
        try { await quietly(trigger) } finally { document.removeEventListener('wildflower:diagnostic', on) }
        expect(got.length).toBe(0)
    })
})
