/**
 * tick(dt) under a controlled clock
 *
 * The frame loop reads requestAnimationFrame and performance.now() on every
 * frame, so a page (a video renderer, a test) can drive it with a virtual
 * clock. Two edges of that clock:
 *
 * - Time can start at 0. The first frame at now = 0 sets the reference time,
 *   and the next frame ticks with the elapsed time.
 * - Time can move backward (a seek). tick never receives a negative dt.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

const describeIfPools = hasFeature('pools') ? describe : describe.skip

describeIfPools('tick(dt) under a controlled clock', () => {
    let wildflower
    let container
    let realRaf
    let realCaf
    let queue
    let nextId
    let virtualNow

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        wildflower = window.wildflower
        container = document.createElement('div')
        container.style.position = 'absolute'
        container.style.left = '-9999px'
        document.body.appendChild(container)

        realRaf = window.requestAnimationFrame
        realCaf = window.cancelAnimationFrame
        queue = []
        nextId = 1e6
        virtualNow = 0
        window.requestAnimationFrame = (cb) => { const id = nextId++; queue.push({ id, cb }); return id }
        window.cancelAnimationFrame = (id) => {
            const i = queue.findIndex(e => e.id === id)
            if (i !== -1) queue.splice(i, 1)
            else realCaf(id)
        }
        performance.now = () => virtualNow
    })

    afterEach(() => {
        window.requestAnimationFrame = realRaf
        window.cancelAnimationFrame = realCaf
        delete performance.now
        container.remove()
        // Drop the queued frames. The next resetFramework() marks the loop
        // stopped and the next scan starts it on whichever clock is installed;
        // handing these to the real clock would leave a second loop running.
        queue.length = 0
    })

    // Run one frame of every queued callback at virtual time t.
    function frame(t) {
        virtualNow = t
        const callbacks = queue.splice(0)
        callbacks.forEach(e => e.cb(t))
    }

    // Mount a ticking component and wait until the loop is queued on the
    // virtual clock (a frame already requested from the real clock runs once
    // and re-queues here).
    async function mountTicker(name) {
        const dts = []
        container.innerHTML = `<div data-component="${name}"></div>`
        wildflower.component(name, {
            state: {},
            tick(dt) { dts.push(dt) }
        })
        wildflower.scan()
        const deadline = Date.now() + 2000
        while (queue.length === 0 && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 20))
        }
        expect(queue.length).toBeGreaterThan(0)
        return dts
    }

    it.skipIf(isMinifiedBuild())('the frame after a first frame at now = 0 ticks with the elapsed time', async () => {
        const dts = await mountTicker('clock-zero')
        // Start from a loop that has not seen a frame yet.
        wildflower._lastTickTime = undefined
        dts.length = 0

        frame(0)
        frame(16)
        frame(32)

        expect(dts).toEqual([16, 16])
    })

    it.skipIf(isMinifiedBuild())('time moving backward ticks with dt 0, never a negative dt', async () => {
        const dts = await mountTicker('clock-backward')
        wildflower._lastTickTime = undefined
        dts.length = 0

        frame(100)
        frame(116)
        frame(50)   // a seek back
        frame(66)

        expect(dts).toEqual([16, 0, 16])
        expect(dts.every(dt => dt >= 0)).toBe(true)
    })

    it('a large forward jump is still clamped to 250 ms', async () => {
        const dts = await mountTicker('clock-jump')
        dts.length = 0

        frame(1000)
        frame(1016)
        frame(5016)

        expect(dts.length).toBeGreaterThanOrEqual(2)
        expect(dts[dts.length - 1]).toBe(250)
        expect(dts.every(dt => dt >= 0 && dt <= 250)).toBe(true)
    })
})
