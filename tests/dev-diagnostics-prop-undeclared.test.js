/**
 * Sealing-the-graph row 12 (WF-508): a data-prop-* attribute (or data-props
 * key) naming a prop the child never declared is never read at all; the
 * prop-NAME typo, sibling of row 1's path typo (WF-507). Deterministic at
 * init, so no settle window: _initializeProps diffs the parsed attribute
 * map against the declared props and warns once per (component, key).
 *
 * Two shapes:
 *  - The component declares props and the key misses them: warn with a
 *    did-you-mean. Flagging is unconditional (a name with NO close match
 *    is the case most in need of noise); distance gates only the
 *    suggestion line.
 *  - The component declares no props block at all: every prop attribute
 *    on it is dead, and the warning teaches the declaration.
 *
 * __DEV__-gated; skipped on min variants.
 * Ledger: docs/future/paths_forward/03-sealing-the-graph.md (row 12).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild())('Dev-mode undeclared prop attribute warning (sealing row 12)', () => {
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

    function undeclaredWarnings(key) {
        return warnings.filter(w => w.includes('[WF WF-508]') && w.includes(`'${key}'`))
    }

    async function mount(suffix, childDef, childAttrs) {
        window.wildflower.component(`pu-parent-${suffix}`, { state: { cardTitle: 'Hello' } })
        window.wildflower.component(`pu-child-${suffix}`, childDef)
        testContainer.innerHTML = `
            <div data-component="pu-parent-${suffix}">
                <div data-component="pu-child-${suffix}" ${childAttrs}><span data-bind="label"></span></div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 50))
    }

    // -------------------------------------- shape 1: props block, key misses

    it('warns for a prop-name typo with a did-you-mean over the declared props', async () => {
        await mount('typo',
            { props: { title: { type: String } }, state: { label: 'x' } },
            'data-prop-titel="cardTitle"')

        const found = undeclaredWarnings('titel')
        expect(found.length).toBe(1)
        expect(found[0]).toContain('pu-child-typo')
        expect(warnings.join('\n')).toContain("'title'")
    })

    it('warns even when the name has no close match (unconditional flagging)', async () => {
        await mount('nomatch',
            { props: { title: { type: String } }, state: { label: 'x' } },
            'data-prop-zzgloborp="cardTitle"')

        expect(undeclaredWarnings('zzgloborp').length).toBe(1)
    })

    it('warns for an undeclared key in the data-props bulk form too', async () => {
        await mount('bulk',
            { props: { title: { type: String } }, state: { label: 'x' } },
            'data-props="{ titel: cardTitle }"')

        expect(undeclaredWarnings('titel').length).toBe(1)
    })

    it('warns once per key even with multiple instances', async () => {
        window.wildflower.component('pu-parent-once', { state: { cardTitle: 'Hello' } })
        window.wildflower.component('pu-child-once', { props: { title: { type: String } }, state: { label: 'x' } })
        testContainer.innerHTML = `
            <div data-component="pu-parent-once">
                <div data-component="pu-child-once" data-prop-titel="cardTitle"><span data-bind="label"></span></div>
                <div data-component="pu-child-once" data-prop-titel="cardTitle"><span data-bind="label"></span></div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 50))

        expect(undeclaredWarnings('titel').length).toBe(1)
    })

    it('stays silent when every passed prop is declared', async () => {
        await mount('good',
            { props: { title: { type: String }, count: { type: Number, default: 0 } }, state: { label: 'x' } },
            'data-prop-title="cardTitle" data-prop-count="2"')

        expect(warnings.filter(w => w.includes('[WF WF-508]'))).toEqual([])
    })

    // ------------------------------------------ shape 2: no props block

    it('warns when a component with no props block receives a prop attribute', async () => {
        await mount('noblock',
            { state: { label: 'x' } },
            'data-prop-title="cardTitle"')

        const found = undeclaredWarnings('title')
        expect(found.length).toBe(1)
        expect(found[0]).toContain('declares no props')
        expect(warnings.join('\n')).toContain('props:')
    })

    it('stays silent for a no-props component with no prop attributes', async () => {
        await mount('plain',
            { state: { label: 'x' } },
            '')

        expect(warnings.filter(w => w.includes('[WF WF-508]'))).toEqual([])
    })
})
