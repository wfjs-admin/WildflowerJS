/**
 * A throw inside a list's update is logged, as a throw inside any other
 * effect is, and the list renders again on the next change. Before, the
 * error was stored on the graph node and never read, so the list kept its old
 * rows with nothing in the console (the frozen-array defect hid that way).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise(r => setTimeout(r, ms))

describe.skipIf(!hasFeature('lists'))('an error inside a list update', () => {
    let wildflower
    let container
    let errorSpy

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        errorSpy.mockRestore()
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('is logged, and the list renders again on the next change', async () => {
        wildflower.component('lu-err', { state: { items: [{ k: 1 }, { k: 2 }] } })
        container.innerHTML = `<div data-component="lu-err">
            <ul data-list="items" data-key="k"><template><li data-bind="k"></li></template></ul>
        </div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelectorAll('li').length).toBe(2)

        // A key the list cannot read: the getter throws when the list keys
        // the row. Non-enumerable, so only the list's key read reaches it.
        const bad = {}
        Object.defineProperty(bad, 'k', { get() { throw new Error('lu-boom') }, enumerable: false })
        const c = wildflower.getComponent('lu-err')
        c.items = [bad]
        await settle()
        const logged = errorSpy.mock.calls.filter(args => args.some(a => a instanceof Error && a.message === 'lu-boom'))
        expect(logged.length).toBe(1)
        expect(String(logged[0][0])).toContain('data-list')
        expect(String(logged[0][0])).toContain('items')

        c.items = [{ k: 3 }]
        await settle()
        const rows = container.querySelectorAll('li')
        expect(rows.length).toBe(1)
        expect(rows[0].textContent).toBe('3')
    })
})
