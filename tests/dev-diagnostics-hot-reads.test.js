/**
 * Sealing-the-graph row 6 (WF-216) — hot-loop facade reads made LOUD.
 *
 * Reading reactive state through the facade costs ~100x a plain property
 * read (proxy physics; every fine-grained framework pays it). The framework
 * cannot remove the cost, but it can catch the pattern: dev builds count
 * untracked facade reads per (object, property); a property crossing the
 * burst threshold on several consecutive animation-frame-scale windows is a
 * sustained hot loop, and the warning teaches the fix at the moment it
 * happens (hoist to a local).
 *
 * Design pins:
 *  - One-shot synchronous sweeps (init building a big structure) do NOT
 *    warn — crossings inside one synchronous batch are ignored.
 *  - The warning fires once per property name.
 *
 * __DEV__-gated; skipped on min variants.
 * Ledger: docs/future/paths_forward/03-sealing-the-graph.md (row 6).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild())('Dev-mode hot-loop facade-read warning (sealing row 6)', () => {
    let testContainer
    let warnings
    let originalWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)
        warnings = []
        originalWarn = console.warn
        console.warn = (...args) => { warnings.push(args.join(' ')) }
    })

    afterEach(() => {
        console.warn = originalWarn
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    function hotReadWarnings(prop) {
        return warnings.filter(w => w.includes('[WF WF-216]') && w.includes(`'${prop}'`))
    }

    async function mountComponent(name, def) {
        window.wildflower.component(name, def)
        testContainer.innerHTML = `<div data-component="${name}"><span data-bind="label"></span></div>`
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        const el = testContainer.querySelector(`[data-component="${name}"]`)
        return window.wildflower.componentInstances.get(el.dataset.componentId)
    }

    it('warns once for a sustained cross-frame hot read, and teaches hoisting', async () => {
        const inst = await mountComponent('hr-hot', {
            state: { label: 'x', hotSpeed42: 5 },
            burn() {
                let s = 0
                for (let i = 0; i < 1200; i++) s += this.state.hotSpeed42
                return s
            }
        })

        // Six frame-scale windows of 1200 reads each = a sustained hot loop
        for (let tick = 0; tick < 6; tick++) {
            inst.context.burn()
            await new Promise(r => setTimeout(r, 30))
        }

        const found = hotReadWarnings('hotSpeed42')
        expect(found.length).toBe(1)
        expect(warnings.join('\n')).toContain('hoist')

        // Keep burning: must not warn again for the same property
        for (let tick = 0; tick < 4; tick++) {
            inst.context.burn()
            await new Promise(r => setTimeout(r, 30))
        }
        expect(hotReadWarnings('hotSpeed42').length).toBe(1)
    })

    it('stays silent for a one-shot synchronous sweep, however large', async () => {
        const inst = await mountComponent('hr-oneshot', {
            state: { label: 'x', bulkVal7: 1 },
            sweep() {
                let s = 0
                for (let i = 0; i < 20000; i++) s += this.state.bulkVal7
                return s
            }
        })

        inst.context.sweep()
        await new Promise(r => setTimeout(r, 100))

        expect(hotReadWarnings('bulkVal7')).toEqual([])
    })

    it('stays silent for ordinary read rates', async () => {
        const inst = await mountComponent('hr-calm', {
            state: { label: 'x', calmVal9: 2 },
            poke() { return this.state.calmVal9 + 1 }
        })

        for (let tick = 0; tick < 8; tick++) {
            inst.context.poke()
            await new Promise(r => setTimeout(r, 20))
        }

        expect(hotReadWarnings('calmVal9')).toEqual([])
    })
})
