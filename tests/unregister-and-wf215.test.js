/**
 * wildflower.unregister(name) — unified definition teardown for components and
 * stores — plus WF-215, the dev warning for re-registering a name with a
 * DIFFERENT definition.
 *
 * Motivating case: docs live previews register the same component/store name on
 * multiple pages. Without a teardown API the first registration wins forever
 * (silent skip), so a later page's demo runs the earlier page's code. unregister
 * lets the incoming preview clear the stale definition first; WF-215 flags the
 * case where that did not happen and the definitions genuinely differ.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 60) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

function wf215Calls(spy) {
    return spy.mock.calls.filter(args => String(args[0]).includes('[WF WF-215]'))
}

describe('wildflower.unregister + WF-215', () => {
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

    it('unregister removes a component definition and destroys its instances', async () => {
        wildflower.component('unreg-comp', {
            state: { label: 'A' },
            computed: { shout() { return this.label + '!' } }
        })
        testContainer.innerHTML = `<div data-component="unreg-comp"><span id="s" data-bind="shout"></span></div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('s').textContent).toBe('A!')

        const removed = wildflower.unregister('unreg-comp')
        expect(removed).toBe(true)
        expect(wildflower.getComponentsByType('unreg-comp').length).toBe(0)

        // Re-register with a DIFFERENT definition and confirm the new one runs.
        wildflower.component('unreg-comp', {
            state: { label: 'B' },
            computed: { shout() { return '[' + this.label + ']' } }
        })
        testContainer.innerHTML = `<div data-component="unreg-comp"><span id="s2" data-bind="shout"></span></div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('s2').textContent).toBe('[B]')
    })

    it('unregister removes a store and lets a new definition take its place', async () => {
        wildflower.store('unreg-store', {
            state: { items: [] },
            addItem(x) { this.items.push(x) }
        })
        const s1 = wildflower.getStore('unreg-store')
        expect(typeof s1.addItem).toBe('function')
        s1.addItem('one')
        expect(s1.items.length).toBe(1)

        const removed = wildflower.unregister('unreg-store')
        expect(removed).toBe(true)

        // A fresh store under the same name with a DIFFERENT shape must win now.
        wildflower.store('unreg-store', {
            state: { total: 0 },
            bump() { this.total += 5 }
        })
        const s2 = wildflower.getStore('unreg-store')
        expect(typeof s2.bump).toBe('function')
        expect(s2.total).toBe(0)
        s2.bump()
        expect(s2.total).toBe(5)
        // Old shape is gone.
        expect(s2.items).toBeUndefined()
    })

    it('unregister returns false for an unknown name and does not throw', () => {
        expect(wildflower.unregister('does-not-exist-xyz')).toBe(false)
    })

    it('the collision scenario: stale definition no longer wins after unregister', async () => {
        // Page-A demo
        wildflower.component('collide-demo', {
            state: { rows: ['x'] },
            removeFirst() { this.rows.splice(0, 1) },
            computed: { first() { return this.rows[0] || '(none)' } }
        })
        testContainer.innerHTML = `<div data-component="collide-demo"><span id="c1" data-bind="first"></span></div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('c1').textContent).toBe('x')

        // Simulate navigating to Page-B, whose preview clears then re-registers.
        wildflower.unregister('collide-demo')
        wildflower.component('collide-demo', {
            state: { rows: ['y'] },
            removeFirst() { this.rows.splice(0, 1) },
            computed: { first() { return 'B:' + (this.rows[0] || '(none)') } }
        })
        testContainer.innerHTML = `<div data-component="collide-demo"><span id="c2" data-bind="first"></span></div>`
        wildflower.scan()
        await waitForUpdate()
        expect(document.getElementById('c2').textContent).toBe('B:y')
    })

    it.skipIf(isMinifiedBuild())('WF-215 warns when re-registering a component with a different definition', () => {
        wildflower.component('dup-comp', {
            state: { n: 1 },
            go() { return this.n + 1 }
        })
        wildflower.component('dup-comp', {
            state: { n: 1 },
            go() { return this.n * 10 }   // same name+shape, DIFFERENT body
        })
        expect(wf215Calls(warnSpy).length).toBe(1)
    })

    it.skipIf(isMinifiedBuild())('WF-215 does NOT warn when the re-registered definition is identical', () => {
        const def = { state: { n: 1 }, go() { return this.n + 1 } }
        wildflower.component('dup-same', def)
        wildflower.component('dup-same', { state: { n: 1 }, go() { return this.n + 1 } })
        expect(wf215Calls(warnSpy).length).toBe(0)
    })

    it.skipIf(isMinifiedBuild())('WF-215 does NOT warn after a clean unregister + re-register', () => {
        wildflower.component('dup-clean', { state: { n: 1 }, go() { return this.n + 1 } })
        wildflower.unregister('dup-clean')
        wildflower.component('dup-clean', { state: { n: 2 }, go() { return this.n * 99 } })
        expect(wf215Calls(warnSpy).length).toBe(0)
    })

    it.skipIf(isMinifiedBuild())('WF-215 warns for a store re-registered with a different definition', () => {
        wildflower.store('dup-store', { state: { a: 1 }, m() { return this.a } })
        wildflower.store('dup-store', { state: { a: 1 }, m() { return this.a + 1000 } })
        expect(wf215Calls(warnSpy).length).toBe(1)
    })
})
