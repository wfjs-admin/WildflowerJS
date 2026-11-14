/**
 * A computed read from tick(): the redraw pattern.
 *
 *     computed: { frame() { draw(this.canvas, this.a, store.zoom); return ++n } },
 *     tick() { this.frame }
 *
 * The computed stands for a draw function. Nothing binds to it; tick() reads
 * it once a frame. The reactive graph tracks what the draw read, so the draw
 * runs again on the next frame after any of that changes, once however many
 * writes came in, and not at all otherwise. These cases pin that as
 * supported behavior, so a canvas page can rely on it in place of a watcher
 * and a dirty flag per input.
 *
 * tick() needs the frame loop, which ships with pools (wildflower.features.pools).
 * Each case waits on the tick count itself, never on a number of frames.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

let seq = 0

describe.skipIf(!hasFeature('pools'))('a computed read from tick()', () => {
    let wildflower
    let container
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => { container.remove() })

    // Resolves once read() has grown by n (ticks counted by the entity under test).
    const grown = async (read, n = 3) => {
        const from = read()
        const deadline = performance.now() + 5000
        while (read() - from < n) {
            if (performance.now() > deadline) throw new Error(`tick() ran ${read() - from} times in 5 s; expected ${n}`)
            await new Promise(r => requestAnimationFrame(r))
        }
    }

    // A component whose computed reads two state fields, a store field and a
    // version counter on an object in state; `c` counts ticks and runs.
    const mount = async () => {
        const name = `crft-${++seq}`; const store = `crftstore${seq}`
        const c = { ticks: 0, runs: 0, seen: null, store }
        wildflower.store(store, { state: { zoom: 1, unrelated: 0 } })
        wildflower.component(name, {
            state: { a: 1, b: 2, other: 0, big: { version: 0, label: 'x' } },
            computed: {
                frame() {
                    c.runs++
                    c.seen = [this.a, this.b, wildflower.getStore(store).zoom, this.big.version]
                    return c.runs
                },
            },
            tick() { c.ticks++; this.frame },
        })
        container.innerHTML = `<div data-component="${name}"><canvas></canvas></div>`
        wildflower.scan(container)
        c.ctx = wildflower.getComponent(name)
        await grown(() => c.ticks)
        return c
    }

    it('has run once by the first tick(), and stays cached while nothing it read changes', async () => {
        const c = await mount()
        expect(c.runs).toBe(1)
        await grown(() => c.ticks, 10)
        expect(c.runs).toBe(1)
        // A read from outside tick() is served from the same cache.
        expect(c.ctx.frame).toBe(1)
        expect(c.runs).toBe(1)
    })

    it('does not run for writes to state, or to a store, that it does not read', async () => {
        const c = await mount()
        c.ctx.other = 5
        c.ctx.big.label = 'y'
        wildflower.getStore(c.store).unrelated = 9
        await grown(() => c.ticks)
        expect(c.runs).toBe(1)
    })

    it('runs once for a write to a state field it reads', async () => {
        const c = await mount()
        c.ctx.a = 10
        await grown(() => c.ticks)
        expect(c.runs).toBe(2)
        expect(c.seen).toEqual([10, 2, 1, 0])
    })

    it('runs once for a write to a store field it reads through getStore()', async () => {
        const c = await mount()
        wildflower.getStore(c.store).zoom = 3
        await grown(() => c.ticks)
        expect(c.runs).toBe(2)
        expect(c.seen).toEqual([1, 2, 3, 0])
    })

    it('runs once when a version counter it reads is bumped (large data kept out of state)', async () => {
        const c = await mount()
        c.ctx.big.version++
        await grown(() => c.ticks)
        expect(c.runs).toBe(2)
        expect(c.seen).toEqual([1, 2, 1, 1])
    })

    it('runs once for several writes made before the next frame', async () => {
        const c = await mount()
        c.ctx.a = 11
        c.ctx.b = 12
        c.ctx.a = 13
        wildflower.getStore(c.store).zoom = 4
        c.ctx.big.version++
        await grown(() => c.ticks)
        expect(c.runs).toBe(2)
        expect(c.seen).toEqual([13, 12, 4, 1])
        await grown(() => c.ticks, 5)
        expect(c.runs).toBe(2)
    })

    // A draw that branches reads different state in different modes. What it
    // tracks is what its last run read: a field only the other branch reads
    // does not wake it, and does once the branch is taken.
    it('a draw that branches is woken by what its last run read, and by nothing else', async () => {
        const name = `crft-${++seq}`
        const c = { ticks: 0, runs: 0 }
        wildflower.component(name, {
            state: { view: 'map', zoom: 1, fit: 1 },
            computed: { frame() { c.runs++; return this.view === 'spec' ? 'spec ' + this.fit : 'map ' + this.zoom } },
            tick() { c.ticks++; this.frame },
        })
        container.innerHTML = `<div data-component="${name}"></div>`
        wildflower.scan(container)
        const ctx = wildflower.getComponent(name)
        await grown(() => c.ticks)
        // [what is written, how many runs it costs, what the draw then holds]
        const steps = [
            [() => { ctx.fit = 2 }, 0, 'map 1'],        // read by the other branch only
            [() => { ctx.zoom = 2 }, 1, 'map 2'],       // read by this branch
            [() => { ctx.view = 'spec' }, 1, 'spec 2'], // the branch flips
            [() => { ctx.zoom = 3 }, 0, 'spec 2'],      // no longer read
            [() => { ctx.fit = 3 }, 1, 'spec 3'],       // read now
            [() => { ctx.view = 'map' }, 1, 'map 3'],   // and back
            [() => { ctx.fit = 4 }, 0, 'map 3'],        // dropped again
        ]
        for (const [write, cost, holds] of steps) {
            const before = c.runs
            write()
            await grown(() => c.ticks)
            expect([c.runs - before, ctx.frame]).toEqual([cost, holds])
        }
    })

    it('a draw that throws: one run, one onError, tick() keeps going, and the next change to what it read runs it again', async () => {
        const name = `crft-${++seq}`
        const c = { ticks: 0, runs: 0, errors: [] }
        wildflower.component(name, {
            state: { a: 1, bad: false },
            computed: { frame() { c.runs++; if (this.bad) throw new Error('draw failed'); return this.a } },
            tick() { c.ticks++; this.frame },
            onError(error) { c.errors.push(String(error && error.message)) },
        })
        container.innerHTML = `<div data-component="${name}"></div>`
        wildflower.scan(container)
        const ctx = wildflower.getComponent(name)
        await grown(() => c.ticks)
        expect(c.runs).toBe(1)
        ctx.bad = true
        // More frames than the five in a row that stop a tick() which keeps throwing.
        await grown(() => c.ticks, 12)
        expect(c.runs).toBe(2)
        expect(c.errors.length).toBe(1)
        expect(c.errors[0]).toContain('draw failed')
        ctx.bad = false
        await grown(() => c.ticks)
        expect(c.runs).toBe(3)
        expect(ctx.frame).toBe(1)
        ctx.a = 2
        await grown(() => c.ticks)
        expect(c.runs).toBe(4)
        expect(ctx.frame).toBe(2)
        expect(c.errors.length).toBe(1)
    })

    // A component's computeds are each run once while the component is set
    // up, before init(). A draw that needs what init() prepares returns early
    // on that run, and what it read before returning is what wakes it later.
    // init() keeping the canvas in an untracked field wakes nothing.
    const early = (init) => {
        const name = `crft-${++seq}`
        const c = { ticks: 0, early: 0, drawn: 0, initedAtFirstRun: null, inited: false }
        wildflower.component(name, {
            state: { layout: 0 },
            computed: {
                frame() {
                    if (c.initedAtFirstRun === null) c.initedAtFirstRun = c.inited
                    this.layout
                    if (!this._ready) { c.early++; return 0 }
                    return ++c.drawn
                },
            },
            init() { c.inited = true; init.call(this) },
            tick() { c.ticks++; this.frame },
        })
        container.innerHTML = `<div data-component="${name}"></div>`
        wildflower.scan(container)
        c.ctx = wildflower.getComponent(name)
        return c
    }

    it('is first run before init(), and then waits for a change to what that run read', async () => {
        const c = early(function () { this._ready = true })
        await grown(() => c.ticks, 6)
        expect([c.initedAtFirstRun, c.early, c.drawn]).toEqual([false, 1, 0])
        c.ctx.layout++
        await grown(() => c.ticks)
        expect([c.early, c.drawn]).toEqual([1, 1])
    })

    it('a write in init() to state the early run read gets the first draw on the next frame', async () => {
        const c = early(function () { this._ready = true; this.layout++ })
        await grown(() => c.ticks, 6)
        expect([c.initedAtFirstRun, c.early, c.drawn]).toEqual([false, 1, 1])
    })

    it('a store\'s computed read from the store\'s tick() behaves the same', async () => {
        const store = `crftstore${++seq}`
        const c = { ticks: 0, runs: 0 }
        wildflower.store(store, {
            state: { z: 1, other: 0 },
            computed: { frame() { c.runs++; return this.z } },
            tick() { c.ticks++; this.frame },
        })
        await grown(() => c.ticks)
        expect(c.runs).toBe(1)
        const s = wildflower.getStore(store)
        s.other = 1
        await grown(() => c.ticks)
        expect(c.runs).toBe(1)
        s.z = 2
        s.z = 3
        await grown(() => c.ticks)
        expect(c.runs).toBe(2)
        expect(s.frame).toBe(3)
    })
})
