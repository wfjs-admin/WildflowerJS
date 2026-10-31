/**
 * data-template-key on a component, and the component's own watch on the
 * same property.
 *
 * The template swap is driven by a watcher the framework registers for the
 * key property. Watchers are kept one per path, and the framework's was
 * registered after the component's own, so a `watch: { mode() {} }` on a
 * component with data-template-key="mode" was never called.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))
const describeIfPoly = hasFeature('polymorphic-templates') ? describe : describe.skip

describeIfPoly('data-template-key and a watch on the key property', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    const TEMPLATES = '<template data-type="a"><p class="va">A</p></template><template data-type="b"><p class="vb">B</p></template>'
    const ctxOf = (c) => wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context

    it('W01 the watcher is called with the new and old value, and the template is swapped', async () => {
        const seen = []
        wildflower.component('tkw1', { state: { mode: 'a' }, watch: { mode(n, o) { seen.push([n, o]) } } })
        host.innerHTML = `<div data-component="tkw1" data-template-key="mode">${TEMPLATES}</div>`
        wildflower.scan(); await settle(110)
        expect(host.querySelector('.va')).not.toBe(null)
        ctxOf('tkw1').mode = 'b'; await settle(110)
        expect(seen).toEqual([['b', 'a']])
        expect(host.querySelector('.vb')).not.toBe(null)
        expect(host.querySelector('.va')).toBe(null)
        ctxOf('tkw1').mode = 'a'; await settle(110)
        expect(seen).toEqual([['b', 'a'], ['a', 'b']])
        expect(host.querySelector('.va')).not.toBe(null)
    })

    it('W02 the template is already swapped when the watcher runs', async () => {
        const seen = []
        wildflower.component('tkw2', { state: { mode: 'a' }, watch: { mode() { seen.push(!!host.querySelector('.vb')) } } })
        host.innerHTML = `<div data-component="tkw2" data-template-key="mode">${TEMPLATES}</div>`
        wildflower.scan(); await settle(110)
        ctxOf('tkw2').mode = 'b'; await settle(110)
        expect(seen).toEqual([true])
    })

    it('W03 a watch on another property and a component with no watch are unaffected', async () => {
        const seen = []
        wildflower.component('tkw3', { state: { mode: 'a', other: 1 }, watch: { other(n) { seen.push(n) } } })
        wildflower.component('tkw4', { state: { mode: 'a' } })
        host.innerHTML = `<div data-component="tkw3" data-template-key="mode">${TEMPLATES}</div><div data-component="tkw4" data-template-key="mode">${TEMPLATES}</div>`
        wildflower.scan(); await settle(110)
        ctxOf('tkw3').mode = 'b'; ctxOf('tkw3').other = 2; ctxOf('tkw4').mode = 'b'; await settle(110)
        expect(seen).toEqual([2])
        expect(host.querySelectorAll('.vb').length).toBe(2)
    })
})
