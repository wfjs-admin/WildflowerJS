/**
 * data-action="$entity.path" — the validator names the real problem.
 *
 * $ is a read accessor for external state; it works on every read binding and
 * cannot name an action handler (actions are methods on the component). The
 * validator previously fell through to the generic "references undefined
 * method \"$probe.bump\" ... Available methods: ..." message, which sends the
 * author hunting for a typo among their own methods instead of saying $ does
 * not apply here (session purple-square-41, $ support matrix).
 *
 * This pins the SPECIFIC message. Whether $ should be SUPPORTED in data-action
 * (delegating to a store method from markup) is a separate product decision —
 * if that ever lands, this suite flips from "warns" to "invokes".
 *
 * __DEV__-gated; skipped on min variants.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild())('Dev-mode data-action $-shorthand diagnostic', () => {
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
        console.warn = (...args) => { warnings.push(args.map(a => (a && a.nodeType) ? '<el>' : String(a)).join(' ')) }
    })

    afterEach(() => {
        console.warn = originalWarn
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    async function mount(actionAttr) {
        window.wildflower.store('act-probe', {
            state: { n: 0 },
            bump() { this.n++ }
        })
        window.wildflower.component('action-probe-app', {
            state: { x: 1 },
            realMethod() { this.x++ }
        })
        testContainer.innerHTML = `
            <div data-component="action-probe-app">
                <button id="b" data-action="${actionAttr}">go</button>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        window.wildflower.scan()
        await waitForCompleteRender()
    }

    it('names the $ semantics instead of "undefined method" for data-action="$store.method"', async () => {
        await mount('$act-probe.bump')
        const hit = warnings.find(w => w.includes('$act-probe.bump'))
        expect(hit).toBeDefined()
        // The real explanation, not the typo hunt:
        expect(hit).toMatch(/read accessor|cannot name an action|external state/i)
        // And the misleading parts are gone:
        expect(hit).not.toContain('Available methods')
        expect(hit).not.toContain('Did you mean')
    })

    it('points at the delegation pattern in the same warning', async () => {
        await mount('$act-probe.bump')
        const hit = warnings.find(w => w.includes('$act-probe.bump'))
        // The pre-fix generic message ALSO contains "getStore" — inside its
        // "Available methods:" dump — so a bare /getStore/ match passed for the
        // wrong reason. Require the delegation EXAMPLE (a call), not the word.
        expect(hit).toMatch(/getStore\('act-probe'\)|stores\.act-probe/)
        expect(hit).not.toContain('Available methods')
    })

    it('names the delegation wrapper after the METHOD segment on dotted paths', async () => {
        await mount('$act-probe.util.bump')
        const hit = warnings.find(w => w.includes('$act-probe.util.bump'))
        expect(hit).toBeDefined()
        // The wrapper is named for the method being invoked (last segment),
        // not the first path segment: bump() { ...util.bump(); }, not util().
        expect(hit).toContain("bump() { this.getStore('act-probe').util.bump(); }")
    })

    it('still emits the generic undefined-method message for a plain typo', async () => {
        await mount('realMehtod')
        const hit = warnings.find(w => w.includes('realMehtod'))
        expect(hit).toBeDefined()
        expect(hit).toContain('undefined method')
        expect(hit).toContain('Available methods')
    })

    it('stays silent for a valid method', async () => {
        await mount('realMethod')
        expect(warnings.filter(w => /Binding validation: data-action/.test(w))).toEqual([])
    })
})
