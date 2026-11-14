/**
 * WF-239: a getter (or setter) declared in `state`. State is copied when the
 * entity is created, and the copy reads each getter once and keeps the value,
 * so `state: { get double() { ... } }` never updates. The same holds for an
 * object in state that carries a getter (`state: { form: { get isDirty() } }`).
 * Development builds say so and point at computed, for components, stores and
 * plugins alike.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

let n = 0
const live = []
const uniq = (base) => base + (++n)

beforeAll(async () => { await loadFramework() })
afterEach(() => {
    while (live.length) wildflower.unregister(live.pop())
    document.querySelectorAll('.sacc-host').forEach((el) => el.remove())
})

async function captureWarnings(fn) {
    const lines = []
    const orig = console.warn
    console.warn = (...a) => { lines.push(a.map(String).join(' ')) }
    try { await fn() } finally { console.warn = orig }
    return lines
}

// The main line only (the "↳ Docs" follow-up carries the code too).
const mainLines = (lines) => lines.filter((l) => l.includes('WF-239') && !l.includes('Docs:'))

describe.skipIf(isMinifiedBuild())('WF-239: a getter in state', () => {
    it('a store with a getter in state warns, naming the key and computed', async () => {
        const name = uniq('saccStore'); live.push(name)
        const lines = await captureWarnings(() => {
            wildflower.store(name, { state: { n: 1, get double() { return this.n * 2 } } })
        })
        const hit = mainLines(lines)
        expect(hit.length).toBe(1)
        expect(hit[0]).toContain('double')
        // The suggestion prints on its own line.
        expect(lines.some((l) => l.includes('computed: { double()'))).toBe(true)
    })

    it('a getter on an object inside state warns, naming its path', async () => {
        const name = uniq('saccNested'); live.push(name)
        const form = { name: '', initial: '', get isDirty() { return this.name !== this.initial } }
        const lines = await captureWarnings(() => {
            wildflower.store(name, { state: { form } })
        })
        const hit = mainLines(lines)
        expect(hit.length).toBe(1)
        expect(hit[0]).toContain('form.isDirty')
    })

    it('a component with a getter in state warns', async () => {
        const comp = uniq('sacc-comp')
        const lines = await captureWarnings(async () => {
            wildflower.component(comp, { state: { n: 1, get double() { return this.n * 2 } } })
            const host = document.createElement('div')
            host.className = 'sacc-host'
            host.innerHTML = `<div data-component="${comp}"></div>`
            document.body.appendChild(host)
            wildflower.scan()
            await new Promise((r) => setTimeout(r, 100))
        })
        expect(mainLines(lines).some((l) => l.includes('double'))).toBe(true)
    })

    it.skipIf(!hasFeature('plugins'))('a plugin with a getter in state warns', async () => {
        const name = uniq('saccPlugin')
        const lines = await captureWarnings(() => {
            wildflower.plugin({ name, state: { n: 1, get double() { return this.n * 2 } }, ping() {} })
        })
        expect(mainLines(lines).some((l) => l.includes('double'))).toBe(true)
    })

    it('plain state, a class instance with a prototype getter, and a computed do not warn', async () => {
        class Point { constructor() { this.x = 1 } get twice() { return this.x * 2 } }
        const name = uniq('saccClean'); live.push(name)
        const lines = await captureWarnings(() => {
            wildflower.store(name, {
                state: { n: 1, list: [{ a: 1 }], when: new Date(0), p: new Point() },
                computed: { double() { return this.n * 2 } },
            })
        })
        expect(mainLines(lines)).toEqual([])
    })
})
