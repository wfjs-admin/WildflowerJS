/**
 * A form's submit runs the handler once, wherever the form is.
 *
 * Three places used to handle a submit: a document-level handler, each list's
 * own submit listener, and a direct listener attached whenever a component's
 * actions were (re)bound. Each did a different part of the job (prevent the
 * default, sync inputs, validate, pick the method, build `details`), and where
 * two of them claimed the same form the handler ran twice:
 *
 *   - a form that is the row's root element
 *   - a form in a row after rebindActions(), or in any component that also
 *     has a data-bind-html (its paint re-binds actions)
 *   - a form inside a child component that sits in a row
 *
 * and where only the list's listener ran, the parts it did not do were
 * missing: no submit validation in a row, no input sync in a nested row.
 *
 * Every case crosses where the form is with what has happened to the
 * component before the submit.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('form submit: one dispatcher', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    const rows = (n, p = 'i') => Array.from({ length: n }, (_, i) => ({ id: p + i, name: 'n' + i }))
    const LIST = (row) => `<div class="L" data-list="items" data-key="id"><template>${row}</template></div>`

    // Where the form is. html(form) wraps the form markup; target is the index
    // of the form to submit among `.f`; want is what the handler must be told.
    const PLACES = {
        'outside any list': { html: (f) => f, target: 0, want: { item: null, index: null, parent: null } },
        'inside a row': { html: (f) => LIST(`<div>${f}</div>`), target: 1, want: { item: 'i1', index: 1, parent: null } },
        'as the row root': { html: (f) => LIST(f), target: 1, want: { item: 'i1', index: 1, parent: null } },
        'inside a row of a nested list': {
            html: (f) => `<div data-list="groups" data-key="id"><template><section>${LIST(`<span>${f}</span>`)}</section></template></div>`,
            target: 3, want: { item: 'h1', index: 1, parent: 'g1' }
        },
        'inside a row of a twelve-row list': { html: (f) => LIST(`<div>${f}</div>`), n: 12, target: 11, want: { item: 'i11', index: 11, parent: null } },
        'inside a child component that sits in a row': { html: (f, c) => LIST(`<div><i data-component="${c}-kid">${f}</i></div>`), kid: true, target: 1, want: { item: 'i1', index: 1, parent: null } }
    }
    // What has happened to the component before the submit. A component-level
    // data-bind-html re-binds the component's actions each time it paints,
    // the first paint included, so only that case has one in its markup.
    const BEFORE = {
        'nothing': { run: async () => {} },
        'rebindActions()': { run: async (ctx) => { ctx.rebindActions(); await settle(40) } },
        'a data-bind-html has painted and changed': { html: true, run: async (ctx) => { ctx.html = '<b>changed</b>'; await settle(120) } }
    }

    let n = 0
    const mount = async (place, formHtml, handlers, withHtml = false) => {
        const c = 'fs' + (++n)
        const P = PLACES[place]
        const count = P.n || 2
        const state = () => ({ html: '<b>first</b>', name: '', items: rows(count), groups: [{ id: 'g0', items: rows(2, 'g') }, { id: 'g1', items: rows(2, 'h') }] })
        if (P.kid) {
            wildflower.component(c + '-kid', { state: { name: '' }, ...handlers })
            wildflower.component(c, { state: state() })
        } else {
            wildflower.component(c, { state: state(), ...handlers })
        }
        host.innerHTML = `<div data-component="${c}">${withHtml ? '<div class="h" data-bind-html="html"></div>' : ''}${P.html(formHtml, c)}</div>`
        wildflower.scan()
        await settle(120)
        const ctx = wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context
        return { ctx, form: () => host.querySelectorAll('.f')[P.target], P }
    }
    const fire = async (form) => {
        const ev = new Event('submit', { bubbles: true, cancelable: true })
        form.dispatchEvent(ev)
        await settle(40)
        return ev
    }
    const told = (details) => ({
        item: (details && details.item && details.item.id) || null,
        index: details && details.index !== undefined ? details.index : null,
        parent: (details && details.parent && details.parent.item && details.parent.item.id) || null
    })

    describe('one call, with the row, default prevented, inputs synced first', () => {
        let i = 0
        for (const place of Object.keys(PLACES)) {
            for (const before of Object.keys(BEFORE)) {
                it(`F${String(++i).padStart(2, '0')} ${place}; before the submit: ${before}`, async () => {
                    const calls = []
                    const { ctx, form, P } = await mount(place,
                        '<form class="f" data-action="save"><input class="in" data-model="name"><button type="submit">go</button></form>', {
                            save(event, element, details) {
                                // What the model held when the handler ran: the row's
                                // item in a list, the component's own state otherwise.
                                const holder = details && details.item && !PLACES[place].kid ? details.item : this
                                calls.push({ ...told(details), nameAtCall: holder.name })
                            }
                        }, !!BEFORE[before].html)
                    await BEFORE[before].run(ctx)
                    const f = form()
                    // Typed but no input event: only the submit-time sync can carry it.
                    f.querySelector('.in').value = 'typed'
                    const ev = await fire(f)
                    expect(calls).toEqual([{ ...P.want, nameAtCall: 'typed' }])
                    expect(ev.defaultPrevented).toBe(true)
                })
            }
        }
    })

    describe('data-validate-on="submit" holds the handler back and shows the error', () => {
        let i = 0
        for (const place of Object.keys(PLACES)) {
            it(`V${String(++i).padStart(2, '0')} ${place}`, async () => {
                const calls = []
                const { form } = await mount(place,
                    '<form class="f" data-validate-on="submit" data-action="save" novalidate><input class="in" type="text" data-model="req" required><span class="err" data-error-for="req"></span><button type="submit">go</button></form>', {
                        save(event, element, details) { calls.push(told(details)) }
                    })
                const f = form()
                const ev = await fire(f)
                expect(calls).toEqual([])
                expect(f.querySelector('.err').textContent).not.toBe('')
                expect(ev.defaultPrevented).toBe(true)
                // Filled in: the same form now submits, once.
                f.querySelector('.in').value = 'ok'
                f.querySelector('.in').dispatchEvent(new Event('input', { bubbles: true }))
                await settle(40)
                await fire(f)
                expect(calls.length).toBe(1)
            })
        }
    })

    describe('the action declared for submit is the one that runs', () => {
        let i = 0
        for (const place of ['outside any list', 'inside a row', 'as the row root']) {
            for (const attr of ['keydown:foo submit:save', 'submit:save keydown:foo', 'save', 'submit:save']) {
                it(`A${String(++i).padStart(2, '0')} ${place}; data-action="${attr}"`, async () => {
                    const calls = []
                    const { form } = await mount(place, `<form class="f" data-action="${attr}"><input class="in"></form>`, {
                        save() { calls.push('save') },
                        foo() { calls.push('foo') }
                    })
                    await fire(form())
                    expect(calls).toEqual(['save'])
                })
            }
        }
    })

    describe('forms that are not where their component is: portals and slots', () => {
        const ctxOf = (c) => wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context
        afterEach(() => document.querySelectorAll('.pf').forEach((e) => e.remove()))
        const describeIfPortals = hasFeature('portals') ? describe : describe.skip

        describeIfPortals('a form inside data-portal markup', () => {
            for (const attr of ['save', 'submit:save']) {
                it(`P-${attr} is called once on submit, never on a click inside it, and syncs to its own component`, async () => {
                    const calls = []
                    const c = 'fs' + (++n)
                    wildflower.component(c, { state: { name: '' }, save(event) { calls.push([event.type, this.name]) } })
                    host.innerHTML = `<div data-component="${c}"><div data-portal="body"><form class="pf" data-action="${attr}"><label class="lb">l</label><input class="in" data-model="name"><button type="submit">go</button></form></div></div>`
                    wildflower.scan()
                    await settle(150)
                    const form = document.querySelector('form.pf')
                    expect(host.contains(form)).toBe(false)
                    form.querySelector('.lb').click()
                    form.querySelector('.in').click()
                    await settle(30)
                    expect(calls).toEqual([])
                    form.querySelector('.in').value = 'typed'
                    const ev = await fire(form)
                    expect(calls).toEqual([['submit', 'typed']])
                    expect(ev.defaultPrevented).toBe(true)
                    expect(ctxOf(c).name).toBe('typed')
                })
            }

            it('P-other a portal target that sits inside another component: the form still belongs to the component it came from', async () => {
                const calls = []
                const a = 'fs' + (++n), b = 'fs' + (++n)
                wildflower.component(a, { state: { name: '' }, save() { calls.push('owner') } })
                wildflower.component(b, { state: { name: 'untouched' }, save() { calls.push('bystander') } })
                host.innerHTML = `<div data-component="${b}"><div data-portal-target="fs-slot-${n}"></div></div>
                    <div data-component="${a}"><div data-portal="fs-slot-${n}"><form class="pf" data-action="save"><input class="in" data-model="name"></form></div></div>`
                wildflower.scan()
                await settle(150)
                const form = document.querySelector('form.pf')
                form.querySelector('.in').value = 'typed'
                await fire(form)
                expect(calls).toEqual(['owner'])
                expect(ctxOf(a).name).toBe('typed')
                expect(ctxOf(b).name).toBe('untouched')
            })
        })

        for (const attr of ['save', 'submit:save']) {
            it(`S-${attr} a form rendered through data-use-template + data-with: one call, with the slot's data, inputs synced into that data`, async () => {
                const calls = []
                const p = 'fs' + (++n), c = 'fs' + (++n)
                wildflower.component(p, { state: {} })
                wildflower.component(c, {
                    state: { formData: { name: 'Alice' }, name: 'component-level' },
                    save(event, element, details) { calls.push({ keys: details ? Object.keys(details).sort() : null, item: details && details.item && details.item.name, path: details && details.path }) }
                })
                host.innerHTML = `<div data-component="${p}">
                    <template data-item-template="ff${n}"><form class="sf" data-action="${attr}"><input class="in" data-model="name"><button type="submit">go</button></form></template>
                    <div data-component="${c}"><template data-use-template="ff${n}" data-with="formData"></template></div></div>`
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
    })

    describe('the rest of what a submit carries', () => {
        const ctxOf = (c) => wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context

        it('D01 a form in a child component in a row: details describe the parent\'s list', async () => {
            const seen = []
            const { form } = await mount('inside a child component that sits in a row', '<form class="f" data-action="save"><input></form>', {
                save(event, element, details) { seen.push({ index: details.index, length: details.length, last: details.last, listIds: details.list && details.list.map((x) => x.id) }) }
            })
            await fire(form())
            expect(seen).toEqual([{ index: 1, length: 2, last: true, listIds: ['i0', 'i1'] }])
        })

        it('D02 a form in a nested row writes its inputs to that row only, not to a top-level list of the same name', async () => {
            const { ctx, form } = await mount('inside a row of a nested list', '<form class="f" data-action="save"><input class="in" data-model="name"></form>', { save() {} })
            const f = form()
            f.querySelector('.in').value = 'typed'
            await fire(f)
            expect(ctx.groups[1].items[1].name).toBe('typed')
            expect(ctx.items.map((x) => x.name)).toEqual(['n0', 'n1'])
            expect(ctx.groups[0].items.map((x) => x.name)).toEqual(['n0', 'n1'])
        })

        it('D03 rows from a store and from a computed: details resolve and inputs are synced', async () => {
            const c = 'fs' + (++n)
            const calls = []
            wildflower.store(c + 's', { state: { items: rows(2, 's') } })
            wildflower.component(c, {
                state: { all: rows(3, 'c') },
                computed: { some() { return this.all.slice(0, 2) } },
                save(event, element, details) { calls.push([details.item.id, details.index, details.length, details.item.name]) }
            })
            const L = (cls, path) => `<div class="${cls}" data-list="${path}" data-key="id"><template><div><form class="f" data-action="save"><input class="in" data-model="name"></form></div></template></div>`
            host.innerHTML = `<div data-component="${c}">${L('st', '$' + c + 's.items')}${L('co', 'some')}</div>`
            wildflower.scan()
            await settle(150)
            const run = async (sel) => { const f = host.querySelectorAll(sel + ' .f')[1]; f.querySelector('.in').value = 'typed'; await fire(f) }
            await run('.st')
            await run('.co')
            expect(calls).toEqual([['s1', 1, 2, 'typed'], ['c1', 1, 2, 'typed']])
            expect(wildflower.getStore(c + 's').items[1].name).toBe('typed')
            expect(ctxOf(c).all[1].name).toBe('typed')
        })

        it('D10 a click in a row of a store-sourced list is told the list and its length (the same details a form relies on)', async () => {
            const c = 'fs' + (++n)
            const seen = []
            wildflower.store(c + 's', { state: { items: rows(3, 's') } })
            wildflower.component(c, { state: {}, pick(event, element, details) { seen.push([details.index, details.length, details.last, details.list && details.list.length]) } })
            host.innerHTML = `<div data-component="${c}"><div class="L" data-list="$${c}s.items" data-key="id"><template><div><a class="go" data-action="pick" data-bind="name"></a></div></template></div></div>`
            wildflower.scan()
            await settle(150)
            host.querySelectorAll('.L .go')[2].click()
            await settle(30)
            expect(seen).toEqual([[2, 3, true, 3]])
        })

        it('D11 a row of a SORTED computed list, two inputs: both values land on the row that was submitted', async () => {
            // Writing the first input can change the row's position in the
            // computed; the second must still go to the same item.
            const c = 'fs' + (++n)
            const told = []
            wildflower.component(c, {
                state: { people: [{ id: 'a', name: 'Al', note: '' }, { id: 'b', name: 'Bo', note: '' }, { id: 'c', name: 'Cy', note: '' }] },
                computed: { sorted() { return [...this.people].sort((x, y) => x.name.localeCompare(y.name)) } },
                save(event, element, details) { told.push(details.item.id) }
            })
            host.innerHTML = `<div data-component="${c}"><div class="L" data-list="sorted" data-key="id"><template>
                <div><form class="f" data-action="save"><input class="nm" data-model="name"><input class="nt" data-model="note"></form></div></template></div></div>`
            wildflower.scan()
            await settle(150)
            const f = host.querySelectorAll('.L .f')[0]   // Al, first while sorted
            f.querySelector('.nm').value = 'Zed'
            f.querySelector('.nt').value = 'moved'
            await fire(f)
            const people = ctxOf(c).people.map((p) => [p.id, p.name, p.note])
            expect(people).toEqual([['a', 'Zed', 'moved'], ['b', 'Bo', ''], ['c', 'Cy', '']])
            expect(told).toEqual(['a'])
        })

        it('D04 arguments on a form action reach the handler as they do on a button', async () => {
            const seen = []
            const shape = (args) => args.map((a) => (a instanceof Event ? 'event' : a instanceof Element ? 'element' : a && typeof a === 'object' ? { args: a.args, item: a.item ? a.item.id : undefined } : a))
            const c = 'fs' + (++n)
            wildflower.component(c, { state: { items: rows(2) }, save(...args) { seen.push(shape(args)) }, pick(...args) { seen.push(shape(args)) } })
            host.innerHTML = `<div data-component="${c}"><form class="f out" data-action="save(7)"><input></form><button class="b" data-action="pick(7)">x</button>
                ${LIST('<div><form class="f in" data-action="save(7)"><input></form></div>')}</div>`
            wildflower.scan()
            await settle(120)
            host.querySelector('.b').click()
            await settle(30)
            await fire(host.querySelector('.f.out'))
            await fire(host.querySelectorAll('.f.in')[1])
            const [button, outside, inRow] = seen
            expect(outside).toEqual(button)
            expect(inRow).toEqual(['event', 'element', { args: [7], item: 'i1' }, 7])
        })

        it('D05 a keydown action on a row form still fires after rebindActions()', async () => {
            const calls = []
            const { ctx } = await mount('inside a row', '<form class="f" data-action="submit:save keydown:foo"><input class="in"></form>', {
                save() { calls.push('save') }, foo() { calls.push('foo') }
            })
            const key = async () => { host.querySelectorAll('.L .in')[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })); await settle(30) }
            await key()
            ctx.rebindActions()
            await settle(40)
            await key()
            expect(calls).toEqual(['foo', 'foo'])
        })

        it('D06 an ancestor with its own submit action still runs, after the form\'s', async () => {
            const calls = []
            const c = 'fs' + (++n)
            wildflower.component(c, { state: {}, outer() { calls.push('outer') }, save() { calls.push('save') } })
            host.innerHTML = `<div data-component="${c}"><div data-action="submit:outer"><form class="f" data-action="save"><input></form></div></div>`
            wildflower.scan()
            await settle(120)
            await fire(host.querySelector('.f'))
            expect(calls).toEqual(['save', 'outer'])
        })

        it('D07 several data-bind-html paints, then a re-bind: still one call', async () => {
            const calls = []
            const { ctx, form } = await mount('inside a row', '<form class="f" data-action="save"><input></form>', { save(e, el, d) { calls.push(d.index) } }, true)
            for (const v of ['<b>1</b>', '<b>2</b>', '<b>3</b>']) { ctx.html = v; await settle(120) }
            ctx.rebindActions()
            await settle(40)
            await fire(form())
            expect(calls).toEqual([1])
        })

        it('D08 a form with no action: prevented as the row root and in a child component in a row; left alone inside a row', async () => {
            const out = {}
            for (const place of ['as the row root', 'inside a child component that sits in a row', 'inside a row']) {
                const { form } = await mount(place, '<form class="f"><input></form>', {})
                out[place] = (await fire(form())).defaultPrevented
                host.innerHTML = ''
                await settle(20)
            }
            expect(out).toEqual({ 'as the row root': true, 'inside a child component that sits in a row': true, 'inside a row': false })
        })

        const itIfSSR = hasFeature('ssr') ? it : it.skip
        itIfSSR('D09 server-rendered rows holding a form: one call, with the row', async () => {
            const calls = []
            const c = 'fs' + (++n)
            wildflower.component(c, { state: { items: [] }, save(e, el, d) { calls.push(d ? d.index : null) } })
            const row = (v) => `<li><span data-bind="name">${v}</span><form class="f" data-action="save"><button type="submit">go</button></form></li>`
            host.innerHTML = `<div data-component="${c}" data-ssr="true"><ul data-list="items"><template><li><span data-bind="name"></span><form class="f" data-action="save"><button type="submit">go</button></form></li></template>${row('a')}${row('b')}</ul></div>`
            wildflower.scan()
            await settle(120)
            if (wildflower.ssrManager && wildflower.ssrManager.activateAllComponents) wildflower.ssrManager.activateAllComponents()
            await settle(150)
            const ev = await fire(host.querySelectorAll('form.f')[1])
            expect(calls).toEqual([1])
            expect(ev.defaultPrevented).toBe(true)
        })
    })

    describe('what must not change', () => {
        it('K01 a form with no action inside a component is still prevented from submitting', async () => {
            const { form } = await mount('outside any list', '<form class="f"><input></form>', {})
            const ev = await fire(form())
            expect(ev.defaultPrevented).toBe(true)
        })

        it('K02 a handler that throws is reported once and the next submit still works', async () => {
            let calls = 0
            const { form } = await mount('inside a row', '<form class="f" data-action="save"><input></form>', {
                save() { calls++; if (calls === 1) throw new Error('boom') }
            })
            const errors = []
            const orig = console.error
            console.error = (...a) => { errors.push(a.map(String).join(' ')) }
            try {
                await fire(form())
                await fire(form())
            } finally { console.error = orig }
            expect(calls).toBe(2)
            expect(errors.filter((e) => e.includes('boom')).length).toBe(1)
        })

        it('K03 submitting one row\'s form does not run another row\'s or another list\'s', async () => {
            const calls = []
            const c = 'fs' + (++n)
            wildflower.component(c, {
                state: { a: rows(2, 'a'), b: rows(2, 'b') },
                save(event, element, details) { calls.push(details.item.id) }
            })
            const L = (path) => `<div class="${path}" data-list="${path}" data-key="id"><template><div><form class="f" data-action="save"><input></form></div></template></div>`
            host.innerHTML = `<div data-component="${c}">${L('a')}${L('b')}</div>`
            wildflower.scan()
            await settle(120)
            await fire(host.querySelectorAll('.b .f')[1])
            await fire(host.querySelectorAll('.a .f')[0])
            expect(calls).toEqual(['b1', 'a0'])
        })
    })
})
