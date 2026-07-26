/**
 * Sealing-the-graph row 1 (WF-507): a typo'd data-prop path resolves to
 * undefined exactly like a real prop, silently. The naive warning would
 * false-positive during the init window (parents legitimately set state in
 * init(), after the child's first prop resolution), so the check is
 * settle-based: a prop that resolved to undefined is re-checked against the
 * parent (state existence, computed names, methods) after the settle window,
 * and warns only if the path still cannot resolve.
 *
 * Design pins:
 *  - init()-set parent state inside the window stays silent (the deferral
 *    trap called out in docs/future/paths_forward/03-sealing-the-graph.md).
 *  - A declared default absorbing the miss stays silent (path + default is
 *    a legitimate optional-passthrough pattern).
 *  - Literals and $-paths are out of scope (own handling, own tests).
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

describe.skipIf(isMinifiedBuild())('Dev-mode unresolvable data-prop path warning (sealing row 1)', () => {
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
        window.wildflower._devPropsSettleMs = 60
    })

    afterEach(() => {
        console.warn = originalWarn
        delete window.wildflower._devPropsSettleMs
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    function propPathWarnings(path) {
        return warnings.filter(w => w.includes('[WF WF-507]') && w.includes(`"${path}"`))
    }

    async function mountPair(suffix, parentDef, childAttr, childProps) {
        window.wildflower.component(`pp-parent-${suffix}`, parentDef)
        window.wildflower.component(`pp-child-${suffix}`, {
            props: childProps || { title: { type: String } },
            state: { label: 'x' }
        })
        testContainer.innerHTML = `
            <div data-component="pp-parent-${suffix}">
                <div data-component="pp-child-${suffix}" ${childAttr}><span data-bind="label"></span></div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
    }

    it('warns after settle for a typo path, with did-you-mean from the parent state', async () => {
        await mountPair('typo',
            { state: { cardTitle: 'Hello' } },
            'data-prop-title="cardTtile"')
        await new Promise(r => setTimeout(r, 300))

        const found = propPathWarnings('cardTtile')
        expect(found.length).toBe(1)
        expect(found[0]).toContain('pp-child-typo')
        expect(warnings.join('\n')).toContain("'cardTitle'")
    })

    it('stays silent for a correct path', async () => {
        await mountPair('good',
            { state: { cardTitle: 'Hello' } },
            'data-prop-title="cardTitle"')
        await new Promise(r => setTimeout(r, 300))

        expect(propPathWarnings('cardTitle')).toEqual([])
    })

    it('stays silent when the parent sets the key in init() (the deferral window)', async () => {
        await mountPair('late',
            {
                state: {},
                init() { this.state.lateGreeting = 'hi' }
            },
            'data-prop-title="lateGreeting"')
        await new Promise(r => setTimeout(r, 300))

        expect(propPathWarnings('lateGreeting')).toEqual([])
    })

    it('stays silent for a string-literal prop value', async () => {
        await mountPair('literal',
            { state: { cardTitle: 'Hello' } },
            'data-prop-title="Just a plain title"')
        await new Promise(r => setTimeout(r, 300))

        expect(warnings.filter(w => w.includes('[WF WF-507]'))).toEqual([])
    })

    it('stays silent when a declared default absorbs the miss', async () => {
        await mountPair('default',
            { state: { cardTitle: 'Hello' } },
            'data-prop-title="cardTtile"',
            { title: { type: String, default: 'Fallback' } })
        await new Promise(r => setTimeout(r, 300))

        expect(propPathWarnings('cardTtile')).toEqual([])
    })

    it('warns for a method-name typo too (methods are part of the lookup)', async () => {
        await mountPair('method',
            {
                state: {},
                formatPrice() { return '$5' }
            },
            'data-prop-title="formatPrise"')
        await new Promise(r => setTimeout(r, 300))

        const found = propPathWarnings('formatPrise')
        expect(found.length).toBe(1)
        expect(warnings.join('\n')).toContain("'formatPrice'")
    })
})
