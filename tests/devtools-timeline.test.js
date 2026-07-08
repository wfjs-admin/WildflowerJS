/**
 * DevTools timeline (Phase 2, coarse) — microtask/rAF frame recorder.
 *
 * Verifies the dev-only hook surface (startTimelineRecording /
 * stopTimelineRecording / getTimelineSnapshot), that recording is off by
 * default (no frames accrue when not started), and that while recording the
 * per-frame records carry microtask drain + effect counts and an rAF duration.
 *
 * The recorder is dev-only (stripped from production), so the functional
 * assertions are gated on hook.dev.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const tick = (ms = 40) => new Promise(r => setTimeout(r, ms))
function hook() { return window.__WF_DEVTOOLS_GLOBAL_HOOK__ }

describe('DevTools timeline (Phase 2 coarse)', () => {
    let wildflower
    beforeAll(async () => { await loadFramework() })
    beforeEach(() => { wildflower = window.wildflower; resetFramework() })

    it('timeline methods are dev-only', () => {
        const h = hook()
        if (h.dev) {
            expect(typeof h.startTimelineRecording).toBe('function')
            expect(typeof h.stopTimelineRecording).toBe('function')
            expect(typeof h.getTimelineSnapshot).toBe('function')
        } else {
            expect(h.startTimelineRecording).toBeUndefined()
            expect(h.stopTimelineRecording).toBeUndefined()
            expect(h.getTimelineSnapshot).toBeUndefined()
        }
    })

    it('off by default: no frames accrue while not recording', async () => {
        const h = hook()
        if (!h.dev) return
        // ensure not recording
        h.stopTimelineRecording()
        const container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
        try {
            wildflower.component('tl-off', {
                state: { n: 0 },
                computed: { doubled() { return this.state.n * 2 } },
                bump() { this.state.n++ }
            })
            container.innerHTML = `<div data-component="tl-off"><span data-bind="doubled"></span></div>`
            wildflower.scan()
            await tick()
            const before = h.getTimelineSnapshot().length
            const inst = wildflower.getComponentsByType('tl-off')[0]
            inst.context.bump(); await tick()
            inst.context.bump(); await tick()
            const after = h.getTimelineSnapshot().length
            expect(after).toBe(before) // nothing recorded while off
        } finally {
            container.remove()
        }
    })

    // The frame recorder instruments the active scheduler's microtask drains.
    // Meadow's Set-deduped scheduler reports its per-drain node count through the
    // facade's flush observer (entity-handle wires meadow-core's setFlushObserver
    // to timelineNoteFlush in dev), so drain counts accrue here too.
    it('records per-frame microtask + rAF metrics while recording', async () => {
        const h = hook()
        if (!h.dev) return
        const container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
        try {
            wildflower.component('tl-demo', {
                state: { n: 0 },
                computed: { doubled() { return this.state.n * 2 } },
                bump() { this.state.n++ }
            })
            container.innerHTML = `<div data-component="tl-demo"><span data-bind="doubled"></span></div>`
            wildflower.scan()
            await tick()

            h.startTimelineRecording({ maxFrames: 100 })
            const inst = wildflower.getComponentsByType('tl-demo')[0]
            for (let i = 0; i < 5; i++) { inst.context.bump(); await tick(30) }
            const frames = h.stopTimelineRecording()

            expect(Array.isArray(frames)).toBe(true)
            expect(frames.length).toBeGreaterThan(0)

            const f = frames[0]
            expect(f).toHaveProperty('frameNo')
            expect(f).toHaveProperty('t0')
            expect(f).toHaveProperty('drains')
            expect(f).toHaveProperty('effectCount')
            expect(f).toHaveProperty('rafMs')
            // counters are non-negative numbers
            expect(typeof f.rafMs).toBe('number')
            expect(f.rafMs).toBeGreaterThanOrEqual(0)
            expect(f.drains).toBeGreaterThanOrEqual(0)
            // frameNo increases monotonically across the recording
            expect(frames[frames.length - 1].frameNo).toBeGreaterThanOrEqual(frames[0].frameNo)
            // the mutations drove at least one microtask drain across the window
            expect(frames.reduce((s, fr) => s + fr.drains, 0)).toBeGreaterThan(0)
        } finally {
            container.remove()
        }
    })

    it('start resets the ring; snapshot returns chronological frames', async () => {
        const h = hook()
        if (!h.dev) return
        h.startTimelineRecording({ maxFrames: 10 })
        // immediately after start, before any frame finalizes, snapshot is empty
        expect(h.getTimelineSnapshot().length).toBe(0)
        h.stopTimelineRecording()
    })
})
