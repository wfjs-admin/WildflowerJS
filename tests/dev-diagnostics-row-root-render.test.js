/**
 * WF-517: dev warning for data-render on a list row's ROOT element.
 *
 * Not currently supported: the row hides, but it does not come back (or comes back
 * stale), and removing or reordering it while hidden leaves a placeholder
 * behind or shows it twice. Found 2026-10-01 by the "render it twice" tests
 * (tests/render-it-twice-lists.test.js, X01 / X02 pin the behaviour).
 * What works: data-show on the row, a list bound to a filtering computed, or
 * data-render on an element INSIDE the row.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const wf517 = (spy) => spy.mock.calls.filter((args) => String(args[0]).includes('[WF-517]'))
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('WF-517: data-render on a list row root', () => {
    let host, wildflower, warnSpy

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        warnSpy = vi.spyOn(console, 'warn')
        host = document.createElement('div')
        document.body.appendChild(host)
    })
    afterEach(() => { warnSpy.mockRestore(); host.remove() })

    const items = () => [{ id: 1, name: 'A', on: true }, { id: 2, name: 'B', on: false }]

    it.skipIf(isMinifiedBuild())('warns once per list, naming the component, the list and the condition', async () => {
        wildflower.component('wf517-root', { state: { items: items(), more: items() } })
        host.innerHTML = `
            <div data-component="wf517-root">
                <ul data-list="items" data-key="id"><template><li data-render="on"><span data-bind="name"></span></li></template></ul>
                <ul data-list="more" data-key="id"><template><li data-wf-render="on" data-bind="name"></li></template></ul>
            </div>`
        wildflower.scan()
        await settle()
        const calls = wf517(warnSpy)
        expect(calls.length).toBe(2)
        const text = calls.map((c) => c.join(' ')).join('\n')
        expect(text).toContain('wf517-root')
        expect(text).toContain('"items"')
        expect(text).toContain('"more"')
        // The suggestion is logged on its own line, after the warning.
        const all = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n')
        expect(all).toContain('data-show="on"')
    })

    it.skipIf(isMinifiedBuild())('warns for a nested list\'s row root too', async () => {
        wildflower.component('wf517-nested', { state: { teams: [{ id: 1, members: items() }] } })
        host.innerHTML = `
            <div data-component="wf517-nested">
                <div data-list="teams" data-key="id"><template><section>
                    <ul data-list="members" data-key="id"><template><li data-render="on" data-bind="name"></li></template></ul>
                </section></template></div>
            </div>`
        wildflower.scan()
        await settle()
        const calls = wf517(warnSpy)
        expect(calls.length).toBe(1)
        expect(calls[0].join(' ')).toContain('"members"')
    })

    it.skipIf(isMinifiedBuild())('stays quiet for data-render inside the row, and for data-show on the root', async () => {
        wildflower.component('wf517-ok', { state: { items: items() } })
        host.innerHTML = `
            <div data-component="wf517-ok">
                <ul data-list="items" data-key="id"><template><li data-show="on"><b data-render="on" data-bind="name"></b></li></template></ul>
            </div>`
        wildflower.scan()
        await settle()
        expect(wf517(warnSpy).length).toBe(0)
        // And the supported shape works: the inner element comes and goes.
        expect(host.querySelectorAll('li b').length).toBe(1)
    })

    it('production builds carry no warning for it', async () => {
        if (!isMinifiedBuild()) return
        wildflower.component('wf517-min', { state: { items: items() } })
        host.innerHTML = `<div data-component="wf517-min"><ul data-list="items" data-key="id"><template><li data-render="on" data-bind="name"></li></template></ul></div>`
        wildflower.scan()
        await settle()
        expect(wf517(warnSpy).length).toBe(0)
    })
})
