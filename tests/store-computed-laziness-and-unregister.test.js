/**
 * Two store behaviours extensions build on, pinned:
 *
 * - A store computed nothing reads is never evaluated, however often its
 *   inputs change; once a binding, watcher or subscription reads it, it
 *   re-evaluates on change. (The three.js extension's `hovered` does its
 *   picking inside such a computed, so an unwatched view never picks.)
 * - wildflower.unregister(name) runs the store's destroy(). (Threads ends its
 *   worker there; a three.js view frees its scene there.)
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework } from './helpers/load-framework.js'

let n = 0
const live = []
const uniq = (base) => base + (++n)
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => { await loadFramework() })
afterEach(() => {
    while (live.length) { try { wildflower.unregister(live.pop()) } catch (e) { /* already gone */ } }
    document.querySelectorAll('.lazy-host').forEach((el) => el.remove())
})

function lazyStore(counter) {
    const name = uniq('lazy'); live.push(name)
    wildflower.store(name, {
        state: { x: 0 },
        computed: { costly() { counter.runs++; return this.x * 2 } },
    })
    return name
}

describe('an unread store computed', () => {
    // Registration may evaluate it once; changes to its inputs never do.
    it('is not re-evaluated by input changes while nothing reads it', async () => {
        const c = { runs: 0 }
        const s = wildflower.getStore(lazyStore(c))
        await tick(50)
        const afterRegister = c.runs
        expect(afterRegister).toBeLessThanOrEqual(1)
        for (let i = 1; i <= 5; i++) { s.x = i; await tick(5) }
        await tick(50)
        expect(c.runs).toBe(afterRegister)
    })

    it('re-evaluates on change once a subscription reads it', async () => {
        const c = { runs: 0 }
        const s = wildflower.getStore(lazyStore(c))
        const seen = []
        s.subscribe('costly', (v) => seen.push(v))
        await tick()
        s.x = 3
        await tick()
        expect(seen).toContain(6)
        expect(c.runs).toBeGreaterThan(0)
    })

    it('re-evaluates on change once markup binds it', async () => {
        const c = { runs: 0 }
        const name = lazyStore(c), comp = uniq('lazy-view')
        wildflower.component(comp, { subscribe: { [name]: [] } })
        const host = document.createElement('div')
        host.className = 'lazy-host'
        host.innerHTML = `<div data-component="${comp}"><span class="out" data-bind="$${name}.costly"></span></div>`
        document.body.appendChild(host)
        wildflower.scan()
        await tick(100)
        wildflower.getStore(name).x = 4
        await tick(100)
        expect(host.querySelector('.out').textContent).toBe('8')
    })
})

describe('unregister()', () => {
    it("runs the store's destroy()", () => {
        const name = uniq('unreg')
        let destroyed = 0
        wildflower.store(name, { state: { a: 1 }, destroy() { destroyed++ } })
        wildflower.unregister(name)
        expect(destroyed).toBe(1)
        expect(wildflower.getStore(name)).toBeFalsy()
    })
})
