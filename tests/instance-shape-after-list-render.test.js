/**
 * A component instance keeps its set of properties when its list renders.
 *
 * The list renderer caches a per-instance verdict the first time a list of
 * the component renders rows. When that cache was a property the instance was
 * not created with, the write changed the instance's shape after the engine
 * had optimized code against it: the optimized code was thrown away and
 * compiled again during the next interactions. The first row selections on a
 * page were measurably slower for it (shipped in 1.5.5).
 *
 * The pin is the shape, not the timing: nothing the list does on its first
 * render, on an item edit, or on a selection adds a property to the instance.
 * Property names are mangled in production builds, so the cases compare the
 * list of keys and never name one.
 *
 * A component's first method call and its first state write each add a
 * bookkeeping property of their own. Those are outside this pin: each case
 * makes both happen while the list is still empty, then takes its snapshot.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('a component instance keeps its properties when its list renders', () => {
    let host, wildflower, n = 0
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    const rows = (count) => Array.from({ length: count }, (_, i) => ({ id: i + 1, label: 'row ' + (i + 1) }))
    const mount = async (template) => {
        const name = 'isl-' + (++n)
        wildflower.component(name, {
            state: { rows: [], selectedId: null },
            fill(count) { this.rows = rows(count) },
            edit() { this.rows[0].label += ' !' },
            pick(id) { this.selectedId = id }
        })
        host.innerHTML = `<div data-component="${name}"><table><tbody data-list="rows" data-key="id"><template>${template}</template></tbody></table></div>`
        wildflower.scan()
        await settle()
        const el = host.querySelector(`[data-component="${name}"]`)
        const instance = wildflower.componentInstances.get(el.dataset.componentId)
        return { instance, ctx: instance.context }
    }
    const added = (instance, before) => Object.keys(instance).filter((k) => !before.includes(k)).join(' ')

    const TEMPLATES = {
        'a row with a class expression and child text bindings':
            `<tr data-bind-class="id === selectedId ? 'danger' : ''"><td data-bind="id"></td><td><a data-bind="label"></a></td></tr>`,
        'a row with child text bindings only':
            `<tr><td data-bind="id"></td><td><span data-bind="label"></span></td></tr>`
    }

    for (const [title, template] of Object.entries(TEMPLATES)) {
        it(`${title}: the first render, an item edit, and a selection add no property`, async () => {
            const { instance, ctx } = await mount(template)
            ctx.pick(0)
            await settle()
            const before = Object.keys(instance)

            ctx.fill(20)
            await settle()
            expect(host.querySelectorAll('tbody tr').length).toBe(20)
            expect(added(instance, before), 'after the first render').toBe('')

            ctx.edit()
            await settle()
            expect(host.querySelector('tbody tr').textContent).toContain('row 1 !')
            expect(added(instance, before), 'after an item edit').toBe('')

            ctx.pick(3)
            await settle()
            expect(added(instance, before), 'after a selection').toBe('')
        })
    }
})
