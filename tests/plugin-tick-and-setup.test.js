/**
 * Plugin lifecycle keys that silently did nothing (review C-10, predates 1.5.3).
 *
 * tick: registration lived in the full-state setup path, so a plugin with
 * only tick, with install + tick, or with methods + tick (the lightweight
 * path) never ticked. setup: accepted as a contract key but never called by
 * anything, and never documented.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const frames = (ms = 300) => new Promise(r => setTimeout(r, ms))

describe.skipIf(!hasFeature('plugins'))('plugin tick and setup', () => {
    let wf
    beforeAll(async () => { await loadFramework() })
    beforeEach(() => { resetFramework(); wf = window.wildflower })

    // The per-frame loop ships with pools, so plugin tick exists only there.
    describe.skipIf(!hasFeature('pools'))('tick runs for every plugin shape', () => {
        it('a plugin with only tick', async () => {
            let n = 0
            wf.plugin({ name: 'tickOnly', tick() { n++ } })
            await frames()
            expect(n, 'tick never ran').toBeGreaterThan(0)
        })

        it('a plugin with install and tick', async () => {
            let n = 0
            wf.plugin({ name: 'installTick', install() {}, tick() { n++ } })
            await frames()
            expect(n, 'tick never ran').toBeGreaterThan(0)
        })

        it('a plugin with methods and tick but no state', async () => {
            let n = 0
            wf.plugin({ name: 'methodsTick', ping() { return 'pong' }, tick() { n++ } })
            await frames()
            expect(n, 'tick never ran').toBeGreaterThan(0)
            expect(wf.$methodsTick.ping()).toBe('pong')
        })

        it('a plugin with state and tick still ticks (unchanged)', async () => {
            let n = 0
            wf.plugin({ name: 'stateTick', state: { k: 0 }, tick() { n++ } })
            await frames()
            expect(n).toBeGreaterThan(0)
        })
    })

    describe.skipIf(isMinifiedBuild())('setup is not a plugin hook (dev builds)', () => {
        let warnings
        const realWarn = console.warn
        beforeEach(() => { warnings = []; console.warn = (...a) => { warnings.push(a.join(' ')) } })
        afterEach(() => { console.warn = realWarn })

        it('warns WF-219 for a setup() function, which nothing calls', () => {
            wf.plugin({ name: 'hasSetup', install() {}, setup() {} })
            const hits = warnings.filter(w => w.startsWith('[WF WF-219]'))
            expect(hits.length).toBe(1)
            expect(hits[0]).toContain('setup')
        })
    })
})
