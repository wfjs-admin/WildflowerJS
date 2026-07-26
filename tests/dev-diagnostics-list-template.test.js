/**
 * A3+A4 (DX diagnostics sweep): when a data-list resolves NO template, the
 * dev warning names the CAUSE — row markup as direct children, a genuinely
 * empty container, or a parser-hostile ancestor (<svg>, <select>) where the
 * HTML parser removed/inerted the <template> before any script ran.
 *
 * Design rule (Chris): we diagnose only our own resolution failures. The
 * silence suite pins that templates anywhere HTML-legal are never warned
 * about and never touched.
 *
 * __DEV__-gated; skipped on min variants. Requires the lists feature.
 * Plan: docs/future/DX_DIAGNOSTICS_SWEEP_2026-07-12.md (items A3, A4).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild() || !hasFeature('lists'))('Dev-mode list-template diagnostics (A3/A4)', () => {
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
        testContainer = null
    })

    function templateWarnings() {
        return warnings.filter(w => w.includes('rendered nothing'))
    }

    // ------------------------------------------------------------ firing cases

    it('diagnoses row markup written as direct children', async () => {
        window.wildflower.component('lt-direct', {
            state: { rows: [{ id: 1, label: 'a' }] }
        })
        testContainer.innerHTML = `
            <div data-component="lt-direct">
                <ul data-list="rows" data-key="id">
                    <li data-bind="label"></li>
                </ul>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = templateWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('[WF WF-401]')
        expect(found[0]).toContain('direct children')
        expect(found[0]).toContain('<template>')
        expect(found[0]).toContain("data-list=\"rows\"")
    })

    it('diagnoses a genuinely empty list container', async () => {
        window.wildflower.component('lt-empty', {
            state: { rows: [{ id: 1 }] }
        })
        testContainer.innerHTML = '<div data-component="lt-empty"><div data-list="rows" data-key="id"></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = templateWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('[WF WF-401]')
        expect(found[0]).toContain('resolved no template')
        expect(found[0]).toContain('inherited templates')
    })

    it('diagnoses a data-list inside an <svg> subtree (parser strips the template)', async () => {
        window.wildflower.component('lt-svg', {
            state: { ticks: [{ id: 1, x: 10 }] }
        })
        testContainer.innerHTML = `
            <div data-component="lt-svg">
                <svg viewBox="0 0 100 100">
                    <g data-list="ticks" data-key="id">
                        <template><line y1="0" y2="100"></line></template>
                    </g>
                </svg>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = templateWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('[WF WF-401]')
        expect(found[0]).toContain('<svg> subtree')
        expect(found[0]).toContain('parser')
    })

    it('stays silent for <select data-list><template> — template is spec-legal in select', async () => {
        // The HTML parser processes <template> in the "in select" insertion
        // mode via the in-head rules, so it SURVIVES — unlike arbitrary row
        // markup. Valid usage: never warned, and it renders.
        window.wildflower.component('lt-select', {
            state: { opts: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }] }
        })
        testContainer.innerHTML = `
            <div data-component="lt-select">
                <select data-list="opts" data-key="id">
                    <template><option data-bind="label"></option></template>
                </select>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        expect(templateWarnings()).toEqual([])
        expect(testContainer.querySelectorAll('option').length).toBe(2)
    })

    // ----------------------------------------------------------- silence suite
    // Valid HTML is never "unexpected" to us: templates in legal places carry
    // zero warnings and zero behavior change.

    it('stays silent for <tbody data-list><template> (spec-legal table context)', async () => {
        window.wildflower.component('lt-tbody', {
            state: { rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }] }
        })
        testContainer.innerHTML = `
            <div data-component="lt-tbody">
                <table><tbody data-list="rows" data-key="id">
                    <template><tr><td data-bind="label"></td></tr></template>
                </tbody></table>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        expect(templateWarnings()).toEqual([])
        expect(testContainer.querySelectorAll('tbody tr').length).toBe(2)
    })

    it('stays silent for nested child-list templates', async () => {
        window.wildflower.component('lt-nested', {
            state: { groups: [{ id: 1, name: 'g', items: [{ id: 11, label: 'x' }] }] }
        })
        testContainer.innerHTML = `
            <div data-component="lt-nested">
                <div data-list="groups" data-key="id">
                    <template>
                        <div>
                            <h4 data-bind="name"></h4>
                            <ul data-list="items" data-key="id">
                                <template><li data-bind="label"></li></template>
                            </ul>
                        </div>
                    </template>
                </div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 50))

        expect(templateWarnings()).toEqual([])
        expect(testContainer.querySelectorAll('li').length).toBe(1)
    })

    it('stays silent for polymorphic multi-template lists', async () => {
        window.wildflower.component('lt-poly', {
            state: { rows: [{ id: 1, kind: 'a', label: 'x' }, { id: 2, kind: 'b', label: 'y' }] }
        })
        testContainer.innerHTML = `
            <div data-component="lt-poly">
                <div data-list="rows" data-key="id" data-template-key="kind">
                    <template data-type="a"><p class="a" data-bind="label"></p></template>
                    <template data-type="b"><p class="b" data-bind="label"></p></template>
                </div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        expect(templateWarnings()).toEqual([])
        expect(testContainer.querySelectorAll('p.a').length).toBe(1)
        expect(testContainer.querySelectorAll('p.b').length).toBe(1)
    })

    it('stays silent for (and never touches) an unaffiliated template no feature owns', async () => {
        window.wildflower.component('lt-bystander', {
            state: { label: 'x' }
        })
        testContainer.innerHTML = `
            <div data-component="lt-bystander">
                <span data-bind="label"></span>
                <template id="just-sitting-here"><div class="inert">hello</div></template>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        expect(templateWarnings()).toEqual([])
        const bystander = testContainer.querySelector('#just-sitting-here')
        expect(bystander).not.toBeNull()
        expect(bystander.content.querySelector('.inert')).not.toBeNull()
    })
})
