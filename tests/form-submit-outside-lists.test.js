/**
 * Form submit, everywhere a form can be that is not a list row.
 *
 * The companion of form-submit-one-dispatcher.test.js (which covers rows) and
 * deliberately free of lists, so it runs on every build tier: the submit
 * dispatcher ships in all of them.
 *
 * One handler dispatches every submit. A form reaches it by where it sits
 * (the nearest component), by where the portal system moved it from, or, for
 * a form some other code has moved out of its component after it was bound
 * (a dialog library appending to <body>), by the component it was bound in.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))

describe('form submit outside lists', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => { host.remove(); document.querySelectorAll('.fso-moved').forEach((e) => e.remove()) })

    let n = 0
    const ctxOf = (c) => wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context
    const mount = async (def, html) => {
        const c = 'fo' + (++n)
        wildflower.component(c, def)
        host.innerHTML = `<div data-component="${c}">${html}</div>`
        wildflower.scan()
        await settle(120)
        return c
    }
    const fire = async (form) => {
        const ev = new Event('submit', { bubbles: true, cancelable: true })
        form.dispatchEvent(ev)
        await settle(40)
        return ev
    }
    const kinds = (args) => args.map((a) => (a instanceof Event ? 'event' : a instanceof Element ? 'element' : a && typeof a === 'object' ? { args: a.args } : a))

    it('O01 one call with (event, form), default prevented, inputs synced first', async () => {
        const calls = []
        const c = await mount({ state: { name: '' }, save(...args) { calls.push([kinds(args), this.name]) } },
            '<form class="f" data-action="save"><input class="in" data-model="name"><button type="submit">go</button></form>')
        const form = host.querySelector('.f')
        form.querySelector('.in').value = 'typed'   // no input event: only the submit-time sync carries it
        const ev = await fire(form)
        expect(calls).toEqual([[['event', 'element'], 'typed']])
        expect(ev.defaultPrevented).toBe(true)
        expect(ctxOf(c).name).toBe('typed')
    })

    it('O02 still one call after rebindActions(), and after it again', async () => {
        const calls = []
        const c = await mount({ state: {}, save() { calls.push(1) } }, '<form class="f" data-action="save"><input></form>')
        ctxOf(c).rebindActions()
        await settle(40)
        ctxOf(c).rebindActions()
        await settle(40)
        await fire(host.querySelector('.f'))
        expect(calls).toEqual([1])
    })

    it('O03 data-validate-on="submit" holds the handler back and shows the error; filled in, it submits once', async () => {
        const calls = []
        await mount({ state: { req: '' }, save() { calls.push(1) } },
            '<form class="f" data-validate-on="submit" data-action="save" novalidate><input class="in" type="text" data-model="req" required><span class="err" data-error-for="req"></span></form>')
        const form = host.querySelector('.f')
        const ev = await fire(form)
        expect(calls).toEqual([])
        expect(form.querySelector('.err').textContent).not.toBe('')
        expect(ev.defaultPrevented).toBe(true)
        form.querySelector('.in').value = 'ok'
        form.querySelector('.in').dispatchEvent(new Event('input', { bubbles: true }))
        await settle(40)
        await fire(form)
        expect(calls).toEqual([1])
    })

    for (const attr of ['save', 'submit:save', 'keydown:foo submit:save', 'submit:save keydown:foo', 'keydown:foo save']) {
        it(`O04 data-action="${attr}": save runs on submit, and only save`, async () => {
            const calls = []
            await mount({ state: {}, save() { calls.push('save') }, foo() { calls.push('foo') } }, `<form class="f" data-action="${attr}"><input></form>`)
            await fire(host.querySelector('.f'))
            expect(calls).toEqual(['save'])
        })
    }

    it('O05 arguments on a form action reach the handler as they do on a button', async () => {
        const seen = []
        await mount({ state: {}, save(...args) { seen.push(kinds(args)) }, pick(...args) { seen.push(kinds(args)) } },
            '<form class="f" data-action="save(7)"><input></form><button class="b" data-action="pick(7)">x</button>')
        host.querySelector('.b').click()
        await settle(30)
        await fire(host.querySelector('.f'))
        expect(seen[0]).toEqual(['event', 'element', { args: [7] }, 7])
        expect(seen[1]).toEqual(seen[0])
    })

    it('O06 a form with no action is still prevented from submitting', async () => {
        await mount({ state: {} }, '<form class="f"><input></form>')
        expect((await fire(host.querySelector('.f'))).defaultPrevented).toBe(true)
    })

    it('O07 an ancestor with its own submit action still runs, after the form\'s', async () => {
        const calls = []
        await mount({ state: {}, outer() { calls.push('outer') }, save() { calls.push('save') } },
            '<div data-action="submit:outer"><form class="f" data-action="save"><input></form></div>')
        await fire(host.querySelector('.f'))
        expect(calls).toEqual(['save', 'outer'])
    })

    it('O08 a form that is itself a component root: its own handler, once', async () => {
        const calls = []
        const c = 'fo' + (++n)
        wildflower.component(c, { state: { name: '' }, save() { calls.push(this.name) } })
        host.innerHTML = `<form class="f" data-component="${c}" data-action="save"><input class="in" data-model="name"></form>`
        wildflower.scan()
        await settle(120)
        const form = host.querySelector('.f')
        form.querySelector('.in').value = 'typed'
        const ev = await fire(form)
        expect(calls).toEqual(['typed'])
        expect(ev.defaultPrevented).toBe(true)
    })

    it('O09 a form in a child component belongs to the child', async () => {
        const calls = []
        const kid = 'fo' + (++n)
        wildflower.component(kid, { state: { name: '' }, save() { calls.push(['child', this.name]) } })
        const c = await mount({ state: { name: 'parent' }, save() { calls.push(['parent']) } },
            `<div data-component="${kid}"><form class="f" data-action="save"><input class="in" data-model="name"></form></div>`)
        const form = host.querySelector('.f')
        form.querySelector('.in').value = 'typed'
        await fire(form)
        expect(calls).toEqual([['child', 'typed']])
        expect(ctxOf(c).name).toBe('parent')
    })

    it('O10 a form that other code moves out of every component after it was bound still belongs to its component', async () => {
        // What a dialog library does: lift the element and append it to <body>.
        const calls = []
        const c = await mount({ state: { name: '' }, save(event) { calls.push([event.type, this.name]) } },
            '<div class="dlg fso-moved"><form class="f" data-action="save"><input class="in" data-model="name"><button type="submit">go</button></form></div>')
        const dlg = host.querySelector('.dlg')
        document.body.appendChild(dlg)
        const form = dlg.querySelector('.f')
        expect(host.contains(form)).toBe(false)
        form.querySelector('.in').value = 'typed'
        const ev = await fire(form)
        expect(calls).toEqual([['submit', 'typed']])
        expect(ev.defaultPrevented).toBe(true)
        expect(ctxOf(c).name).toBe('typed')
    })

    it('O11 a form outside every component, never bound, is not touched', async () => {
        const form = document.createElement('form')
        form.className = 'fso-moved'
        form.innerHTML = '<input>'
        document.body.appendChild(form)
        const ev = new Event('submit', { bubbles: true, cancelable: true })
        form.addEventListener('submit', (e) => e.preventDefault())   // keep the test page from navigating
        let preventedByFramework = null
        document.addEventListener('submit', function probe(e) { preventedByFramework = e.defaultPrevented; document.removeEventListener('submit', probe, true) }, true)
        form.dispatchEvent(ev)
        await settle(20)
        expect(preventedByFramework).toBe(false)
    })

    for (const attr of ['save', 'submit:save']) {
        it(`O12 a form rendered through data-use-template + data-with (data-action="${attr}"): one call, with the slot's data, inputs synced into that data`, async () => {
            const calls = []
            const p = 'fo' + (++n), c = 'fo' + (++n)
            wildflower.component(p, { state: {} })
            wildflower.component(c, {
                state: { formData: { name: 'Alice' }, name: 'component-level' },
                save(event, element, details) { calls.push({ keys: details ? Object.keys(details).sort() : null, item: details && details.item && details.item.name, path: details && details.path }) }
            })
            host.innerHTML = `<div data-component="${p}">
                <template data-item-template="fo-ff${n}"><form class="sf" data-action="${attr}"><input class="in" data-model="name"><button type="submit">go</button></form></template>
                <div data-component="${c}"><template data-use-template="fo-ff${n}" data-with="formData"></template></div></div>`
            wildflower.scan()
            await settle(200)
            const form = host.querySelector('form.sf')
            form.querySelector('.in').value = 'typed'
            const ev = await fire(form)
            expect(calls).toEqual([{ keys: ['item', 'path', 'slotContext'], item: 'typed', path: 'formData' }])
            expect(ev.defaultPrevented).toBe(true)
            expect(ctxOf(c).formData.name).toBe('typed')
            expect(ctxOf(c).name).toBe('component-level')
        })
    }

    const describeIfPortals = hasFeature('portals') ? describe : describe.skip
    describeIfPortals('portaled forms', () => {
        afterEach(() => document.querySelectorAll('.pf').forEach((e) => e.remove()))

        it('O20 a child component that is the portaled content: its form belongs to the child', async () => {
            const calls = []
            const kid = 'fo' + (++n)
            wildflower.component(kid, { state: { x: '' }, save() { calls.push(['child', this.x]) } })
            const c = await mount({ state: { x: 'parent' }, save() { calls.push(['parent']) } },
                `<div data-portal="body"><div class="pf" data-component="${kid}"><form class="f" data-action="save"><input class="in" data-model="x"></form></div></div>`)
            await settle(100)
            const form = document.querySelector('.pf form.f')
            form.querySelector('.in').value = 'typed'
            await fire(form)
            expect(calls).toEqual([['child', 'typed']])
            expect(ctxOf(c).x).toBe('parent')
        })

        it('O21 a key action on a portaled form keeps working, alone or beside a submit action', async () => {
            const calls = []
            await mount({ state: {}, esc() { calls.push('esc') }, save() { calls.push('save') } },
                `<div data-portal="body"><form class="pf one" data-action="keydown:esc"><input class="in"></form>
                 <form class="pf two" data-action="keydown:esc save"><label class="lb">l</label><input class="in"></form></div>`)
            await settle(100)
            const key = async (sel) => { document.querySelector(sel + ' .in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(30) }
            await key('form.one')
            await key('form.two')
            expect(calls).toEqual(['esc', 'esc'])
            calls.length = 0
            document.querySelector('form.two .lb').click()
            await settle(30)
            expect(calls).toEqual([])
            await fire(document.querySelector('form.two'))
            expect(calls).toEqual(['save'])
        })
    })
})
