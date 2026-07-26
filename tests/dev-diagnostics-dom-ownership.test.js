/**
 * DOM-ownership diagnostics: the $el() wrapper warns when a component
 * manually overwrites nodes the engine owns (.text() on a data-bind node,
 * .html() on a data-list/data-bind-html node, .remove() on a managed
 * node). The silence suite pins that unmanaged nodes and the sanctioned
 * .val() reactivity bridge never warn.
 *
 * Warns are gated on framework.debug, which defaults to __DEV__, so they
 * are on by default in dev builds. Skipped on min variants.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild())('Dev-mode DOM-ownership diagnostics', () => {
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

    function ownershipWarnings() {
        return warnings.filter(w => w.includes('Manual .'))
    }

    // ------------------------------------------------------------ firing cases

    it('warns on .text() against a data-bind node', async () => {
        window.wildflower.component('dom-own-text', {
            state: { label: 'bound' },
            init() {
                this.$el('span').text('overwritten')
            }
        })
        testContainer.innerHTML = `
            <div data-component="dom-own-text">
                <span data-bind="label"></span>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = ownershipWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('[WF WF-105]')
        expect(found[0]).toContain('Manual .text() overwrite on bound node')
    })

    it('warns on .html() against a data-list node', async () => {
        window.wildflower.component('dom-own-html', {
            state: { rows: [{ id: 1, label: 'a' }] },
            init() {
                this.$el('ul').html('<li>injected</li>')
            }
        })
        testContainer.innerHTML = `
            <div data-component="dom-own-html">
                <ul data-list="rows" data-key="id">
                    <template><li data-bind="label"></li></template>
                </ul>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = ownershipWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('Manual .html() overwrite on reactive node')
    })

    it('warns on .remove() against a managed (data-component) node', async () => {
        window.wildflower.component('dom-own-child', {
            state: {}
        })
        window.wildflower.component('dom-own-remove', {
            state: {},
            init() {
                this.$el('[data-component="dom-own-child"]').remove()
            }
        })
        testContainer.innerHTML = `
            <div data-component="dom-own-remove">
                <div data-component="dom-own-child"></div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = ownershipWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('Manual .remove() on managed node')
    })

    // ----------------------------------------------------------- silence suite

    it('stays silent for .text() on an unmanaged node', async () => {
        window.wildflower.component('dom-own-plain', {
            state: { label: 'x' },
            init() {
                this.$el('.free').text('fine')
            }
        })
        testContainer.innerHTML = `
            <div data-component="dom-own-plain">
                <span data-bind="label"></span>
                <span class="free"></span>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        expect(ownershipWarnings()).toEqual([])
        expect(testContainer.querySelector('.free').textContent).toBe('fine')
    })

    it('stays silent for .val() on a data-model input (sanctioned bridge)', async () => {
        window.wildflower.component('dom-own-val', {
            state: { name: 'start' },
            init() {
                this.$el('input').val('bridged')
            }
        })
        testContainer.innerHTML = `
            <div data-component="dom-own-val">
                <input data-model="name">
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        expect(ownershipWarnings()).toEqual([])
    })
})
