/**
 * WF-214: dev warning when a zero-arg computed referenced in a list row
 * reads this.<prop> that is undefined on the component but present on the
 * current list item — the signature-based item-computed contract trap
 * (the computed should declare the item parameter: fn(item)).
 *
 * The trigger is the miss-on-this + hit-on-item conjunction, so legitimate
 * zero-arg component computeds referenced inside rows (options arrays,
 * global counts) never fire it, and neither do correct (item) computeds.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 60) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

function wf214Calls(spy) {
    // Count only the main emission line; wfError also prints Suggestion/Docs
    // follow-up lines (the Docs URL contains the code string too).
    return spy.mock.calls.filter(args => String(args[0]).includes('[WF WF-214]'))
}

describe('WF-214 item-computed this-miss dev warning', () => {
    let testContainer
    let wildflower
    let warnSpy

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        warnSpy = vi.spyOn(console, 'warn')
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        warnSpy.mockRestore()
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    // __DEV__-gated: on min builds the detection block (and the WF-214
    // message) is stripped, so the warning never fires there by design.
    it.skipIf(isMinifiedBuild())('warns once when a zero-arg computed reads this.<itemProp> in a row', async () => {
        wildflower.component('wf214-trap', {
            state: {
                rows: [
                    { id: 1, kind: 'alpha' },
                    { id: 2, kind: 'beta' }
                ]
            },
            computed: {
                kindBadge() {
                    return 'badge-' + (this.kind || 'unknown')
                }
            }
        })
        testContainer.innerHTML = `
            <div data-component="wf214-trap">
                <div data-list="rows" data-key="id">
                    <template><span data-bind-class="kindBadge"><i data-bind="kind"></i></span></template>
                </div>
            </div>`
        wildflower.scan()
        await waitForUpdate()

        const calls = wf214Calls(warnSpy)
        expect(calls.length).toBe(1) // once per (component, computed), not per row
        const msg = calls.map(a => a.join(' ')).join(' ')
        expect(msg).toContain('kindBadge')
        expect(msg).toContain('kind')
    })

    it('does not warn for a legit zero-arg component computed used in a row', async () => {
        wildflower.component('wf214-legit', {
            state: {
                total: 2,
                rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }]
            },
            computed: {
                totalBadge() { return 'of-' + this.total }
            }
        })
        testContainer.innerHTML = `
            <div data-component="wf214-legit">
                <div data-list="rows" data-key="id">
                    <template><span data-bind-class="totalBadge"><i data-bind="label"></i></span></template>
                </div>
            </div>`
        wildflower.scan()
        await waitForUpdate()

        expect(wf214Calls(warnSpy).length).toBe(0)
    })

    it('does not warn for a correct (item) parameterized computed', async () => {
        wildflower.component('wf214-correct', {
            state: {
                rows: [{ id: 1, kind: 'alpha' }, { id: 2, kind: 'beta' }]
            },
            computed: {
                kindBadge(item) { return 'badge-' + item.kind }
            }
        })
        testContainer.innerHTML = `
            <div data-component="wf214-correct">
                <div data-list="rows" data-key="id">
                    <template><span data-bind-class="kindBadge"><i data-bind="kind"></i></span></template>
                </div>
            </div>`
        wildflower.scan()
        await waitForUpdate()

        expect(wf214Calls(warnSpy).length).toBe(0)
    })

    it('does not warn when the prop exists on component state too', async () => {
        wildflower.component('wf214-shared-name', {
            state: {
                kind: 'component-level',
                rows: [{ id: 1, kind: 'alpha' }]
            },
            computed: {
                kindBadge() { return 'badge-' + this.kind }
            }
        })
        testContainer.innerHTML = `
            <div data-component="wf214-shared-name">
                <div data-list="rows" data-key="id">
                    <template><span data-bind-class="kindBadge"><i data-bind="kind"></i></span></template>
                </div>
            </div>`
        wildflower.scan()
        await waitForUpdate()

        expect(wf214Calls(warnSpy).length).toBe(0)
    })
})
