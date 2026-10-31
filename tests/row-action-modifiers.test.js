/**
 * Actions on list rows behave as actions do everywhere else.
 *
 * An action outside a list is bound by its component, which reads the
 * element's data-event-* modifiers. An action in a list row is dispatched by
 * the list's shared listener from a record made when the row is first used,
 * and that record carried no modifiers: on a row, data-event-self, -prevent,
 * -stop, -once, -debounce, -throttle, -delay and -if did nothing. The list
 * also listened for a fixed set of event types, so a row's dblclick,
 * contextmenu or pointerdown action was never called.
 *
 * A re-bind of the component's actions (rebindActions(), or any paint of a
 * component-level data-bind-html) used to visit rendered rows and bind them
 * directly, which made some of this start working, on rows that still had
 * their data-action attribute (lists under ten rows) and not on the others.
 * So every case here runs at nine and at twelve rows, fresh and after a
 * re-bind.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('actions on list rows: modifiers and event types', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    const SIZES = [9, 12]
    // What has happened to the component before the action is used.
    const BEFORE = {
        'fresh': { run: async () => {} },
        'after rebindActions()': { run: async (ctx) => { ctx.rebindActions(); await settle(40) } },
        'after a data-bind-html paint': { html: true, run: async (ctx) => { ctx.html = '<b>changed</b>'; await settle(120) } }
    }
    const items = (k) => Array.from({ length: k }, (_, i) => ({ id: 'i' + i, name: 'n' + i }))
    const LIST = (row) => `<div class="L" data-list="items" data-key="id"><template>${row}</template></div>`

    let n = 0
    const mount = async (rows, rowHtml, def = {}, before = 'fresh', around = (list) => list) => {
        const c = 'ra' + (++n)
        wildflower.component(c, { state: { html: '<b>first</b>', flag: true, items: items(rows) }, ...def })
        host.innerHTML = `<div data-component="${c}">${BEFORE[before].html ? '<div class="h" data-bind-html="html"></div>' : ''}${around(LIST(rowHtml))}</div>`
        wildflower.scan()
        await settle(110)
        const ctx = wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context
        await BEFORE[before].run(ctx)
        return ctx
    }
    const last = (sel) => { const all = host.querySelectorAll(sel); return all[all.length - 1] }
    const record = (calls, name = 'pick') => function (event, element, details) { calls.push([name, details ? details.index : null, details && details.item ? details.item.id : null]) }

    // Each modifier: the row template, and a check that returns a list of
    // what went wrong (empty when the modifier did its job).
    const MODIFIERS = {
        'data-event-self': {
            row: '<div><span class="f" data-action="pick" data-event-self><b class="in">x</b></span></div>',
            check: async (rows, calls) => {
                const wrong = []
                last('.L .f .in').click(); await settle(20)
                if (calls.length) wrong.push('a click on a descendant ran the handler')
                calls.length = 0
                last('.L .f').click(); await settle(20)
                if (JSON.stringify(calls) !== JSON.stringify([['pick', rows - 1, 'i' + (rows - 1)]])) wrong.push('a click on the element gave ' + JSON.stringify(calls))
                return wrong
            }
        },
        'data-event-prevent': {
            row: '<div><a class="f" href="#ra" data-action="pick" data-event-prevent>x</a></div>',
            check: async (rows, calls) => {
                const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
                last('.L .f').dispatchEvent(ev); await settle(20)
                const wrong = []
                if (!ev.defaultPrevented) wrong.push('the default was not prevented')
                if (calls.length !== 1) wrong.push('handler calls: ' + calls.length)
                return wrong
            }
        },
        'data-event-stop': {
            // A shared listener on the list can stop the event from going
            // further than the list. (It cannot stop it between the element
            // and the list; nothing in a row sits there but the row itself.)
            row: '<div><button class="f" data-action="pick" data-event-stop>x</button></div>',
            around: (list) => `<div class="above">${list}</div>`,
            check: async (rows, calls) => {
                let above = 0
                host.querySelector('.above').addEventListener('click', () => { above++ })
                last('.L .f').click(); await settle(20)
                const wrong = []
                if (above !== 0) wrong.push('a listener above the list still got the click')
                if (calls.length !== 1) wrong.push('handler calls: ' + calls.length)
                return wrong
            }
        },
        'data-event-once': {
            row: '<div><button class="f" data-action="pick" data-event-once>x</button></div>',
            check: async (rows, calls) => {
                last('.L .f').click(); await settle(20); last('.L .f').click(); await settle(20)
                const wrong = calls.length === 1 ? [] : ['two clicks ran the handler ' + calls.length + ' times']
                // Another row's element has its own "once".
                calls.length = 0
                host.querySelectorAll('.L .f')[0].click(); await settle(20)
                if (calls.length !== 1) wrong.push('the first row was used up by the last row')
                return wrong
            }
        },
        'data-event-debounce': {
            row: '<div><button class="f" data-action="pick" data-event-debounce="40">x</button></div>',
            check: async (rows, calls) => {
                const el = last('.L .f')
                el.click(); el.click(); el.click()
                const immediately = calls.length
                await settle(150)
                const wrong = []
                if (immediately !== 0) wrong.push('ran before the wait was over')
                if (JSON.stringify(calls) !== JSON.stringify([['pick', rows - 1, 'i' + (rows - 1)]])) wrong.push('three quick clicks gave ' + JSON.stringify(calls))
                return wrong
            }
        },
        'data-event-throttle': {
            row: '<div><button class="f" data-action="pick" data-event-throttle="200">x</button></div>',
            check: async (rows, calls) => {
                const el = last('.L .f')
                el.click(); el.click(); el.click(); await settle(40)
                return calls.length === 1 ? [] : ['three quick clicks ran the handler ' + calls.length + ' times']
            }
        },
        'data-event-delay': {
            row: '<div><button class="f" data-action="pick" data-event-delay="60">x</button></div>',
            check: async (rows, calls) => {
                last('.L .f').click(); await settle(15)
                const early = calls.length
                await settle(120)
                const wrong = []
                if (early !== 0) wrong.push('ran before the delay was over')
                if (JSON.stringify(calls) !== JSON.stringify([['pick', rows - 1, 'i' + (rows - 1)]])) wrong.push('after the delay: ' + JSON.stringify(calls))
                return wrong
            }
        },
        'data-event-if': {
            row: '<div><button class="f" data-action="pick" data-event-if="flag">x</button></div>',
            check: async (rows, calls, ctx) => {
                const wrong = []
                last('.L .f').click(); await settle(20)
                if (calls.length !== 1) wrong.push('with the condition true: ' + calls.length + ' calls')
                calls.length = 0
                ctx.flag = false; await settle(30)
                last('.L .f').click(); await settle(20)
                if (calls.length !== 0) wrong.push('with the condition false the handler still ran')
                return wrong
            }
        }
    }

    describe('modifiers', () => {
        for (const [name, M] of Object.entries(MODIFIERS)) {
            for (const rows of SIZES) {
                for (const before of Object.keys(BEFORE)) {
                    it(`M ${name}, ${rows} rows, ${before}`, async () => {
                        const calls = []
                        const ctx = await mount(rows, M.row, { pick: record(calls) }, before, M.around)
                        expect(await M.check(rows, calls, ctx)).toEqual([])
                    })
                }
            }
        }
    })

    describe('event types', () => {
        for (const type of ['dblclick', 'contextmenu', 'pointerdown', 'mousedown', 'paste', 'my-custom-event']) {
            for (const rows of SIZES) {
                for (const before of ['fresh', 'after rebindActions()']) {
                    it(`T ${type} on a row, ${rows} rows, ${before}: called once, with the row`, async () => {
                        const calls = []
                        await mount(rows, `<div><b class="f" data-action="${type}:pick">x</b></div>`, { pick: record(calls) }, before)
                        last('.L .f').dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
                        await settle(30)
                        expect(calls).toEqual([['pick', rows - 1, 'i' + (rows - 1)]])
                    })
                }
            }
        }

        for (const rows of SIZES) {
            it(`T a focus action on a row runs once per focus, also after a re-bind (${rows} rows)`, async () => {
                const calls = []
                const ctx = await mount(rows, '<div><input class="f" data-action="focus:pick"></div>', { pick: record(calls) })
                const focus = async () => { calls.length = 0; last('.L .f').dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await settle(30); return calls.length }
                expect(await focus()).toBe(1)
                ctx.rebindActions()
                await settle(40)
                calls.length = 0
                last('.L .f').focus()
                await settle(40)
                // A real focus fires both focus and focusin; one call either way.
                expect(calls.length <= 1).toBe(true)
                expect(await focus()).toBe(1)
            })

            it(`T three actions on one row element each keep working, also after a re-bind (${rows} rows)`, async () => {
                const calls = []
                const ctx = await mount(rows, '<div><input class="f" data-action="click:a keydown:b focus:c"></div>', {
                    a: record(calls, 'a'), b: record(calls, 'b'), c: record(calls, 'c')
                })
                const all = async () => {
                    calls.length = 0
                    const el = last('.L .f')
                    el.click(); await settle(20)
                    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })); await settle(20)
                    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await settle(20)
                    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await settle(20)
                    el.click(); await settle(20)
                    return calls.map((x) => x[0])
                }
                expect(await all()).toEqual(['a', 'b', 'c', 'c', 'a'])
                ctx.rebindActions()
                await settle(40)
                expect(await all()).toEqual(['a', 'b', 'c', 'c', 'a'])
            })

            it(`T an element with a key action inside an element with a click action: the click still reaches the outer one (${rows} rows)`, async () => {
                const calls = []
                await mount(rows, '<div class="outer" data-action="select"><input class="in" data-action="keydown:k"></div>', {
                    select: record(calls, 'select'), k: record(calls, 'k')
                })
                last('.L .in').click(); await settle(20)
                last('.L .in').dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })); await settle(20)
                expect(calls.map((x) => x[0])).toEqual(['select', 'k'])
            })
        }
    })

    describe('data-event-outside on a row element', () => {
        for (const rows of SIZES) {
            for (const before of ['fresh', 'after rebindActions()']) {
                it(`O ${rows} rows, ${before}: a click inside the element is not an outside click for it; a click elsewhere reaches every row, with its row`, async () => {
                    const calls = []
                    await mount(rows, '<div><b class="f" data-action="close" data-event-outside>x</b></div>', { close: record(calls, 'close') }, before)
                    last('.L .f').click(); await settle(30)
                    // Outside for every OTHER row's element, inside for this one.
                    expect(calls.map((x) => x[1]).sort((a, b) => a - b)).toEqual(Array.from({ length: rows - 1 }, (_, i) => i))
                    calls.length = 0
                    document.body.click(); await settle(30)
                    expect(calls.map((x) => x[1]).sort((a, b) => a - b)).toEqual(Array.from({ length: rows }, (_, i) => i))
                })
            }
        }
    })

    describe('a deferred row action', () => {
        for (const rows of SIZES) {
            it(`D a debounced action whose row is removed during the wait is dropped (${rows} rows)`, async () => {
                const calls = []
                const ctx = await mount(rows, '<div><button class="f" data-action="pick" data-event-debounce="60">x</button></div>', { pick: record(calls) })
                last('.L .f').click()
                await settle(10)
                ctx.items.pop()
                await settle(160)
                expect(calls).toEqual([])
            })

            it(`D a delayed action is told about its row as it is when it runs: rows above it were removed meanwhile (${rows} rows)`, async () => {
                const calls = []
                const ctx = await mount(rows, '<div><button class="f" data-action="pick" data-event-delay="60">x</button></div>', { pick: record(calls) })
                last('.L .f').click()
                await settle(10)
                ctx.items.splice(0, 2)
                await settle(160)
                expect(calls).toEqual([['pick', rows - 3, 'i' + (rows - 1)]])
            })

            it(`D a debounced row action claims the event at once: an action on the row and one above the list do not run (${rows} rows)`, async () => {
                const calls = []
                await mount(rows, '<div class="row" data-action="rowPick"><button class="f" data-action="pick" data-event-debounce="40">x</button></div>', {
                    pick: record(calls), rowPick: record(calls, 'rowPick'), above: record(calls, 'above')
                }, 'fresh', (list) => `<div data-action="above">${list}</div>`)
                last('.L .f').click()
                await settle(150)
                expect(calls.map((x) => x[0])).toEqual(['pick'])
            })
        }
    })

    describe('the same rules outside lists, where a record has no modifiers of its own', () => {
        it('R modifiers on an action inside a data-render section still work after the section is hidden and shown', async () => {
            const calls = []
            const c = 'ra' + (++n)
            wildflower.component(c, { state: { open: true }, pick: record(calls) })
            host.innerHTML = `<div data-component="${c}"><section data-render="open">
                <span class="f" data-action="pick" data-event-self><b class="in">x</b></span><a class="p" href="#q" data-action="pick" data-event-prevent>y</a></section></div>`
            wildflower.scan()
            await settle(110)
            const ctx = wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context
            const run = async () => {
                calls.length = 0
                host.querySelector('.f .in').click(); await settle(20)
                const selfHonoured = calls.length === 0
                const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
                host.querySelector('.p').dispatchEvent(ev); await settle(20)
                return [selfHonoured, ev.defaultPrevented]
            }
            expect(await run()).toEqual([true, true])
            ctx.open = false; await settle(80)
            ctx.open = true; await settle(120)
            expect(await run()).toEqual([true, true])
        })

        it('C two elements calling one method, each debounced: each runs as itself, with its own arguments', async () => {
            const seen = []
            const c = 'ra' + (++n)
            wildflower.component(c, { state: {}, pick(e, el, d, arg) { seen.push([el.id, arg]) } })
            host.innerHTML = `<div data-component="${c}"><button id="ra-b1" data-action="pick(1)" data-event-debounce="40">1</button><button id="ra-b2" data-action="pick(2)" data-event-debounce="40">2</button></div>`
            wildflower.scan()
            await settle(110)
            host.querySelector('#ra-b2').click()
            await settle(150)
            expect(seen).toEqual([['ra-b2', 2]])
            seen.length = 0
            host.querySelector('#ra-b1').click(); host.querySelector('#ra-b2').click()
            await settle(150)
            expect(seen.sort()).toEqual([['ra-b1', 1], ['ra-b2', 2]])
        })
    })

    describe('modifiers and event types', () => {
        const ctxOf = (c) => wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context

        const itIfSSR = hasFeature('ssr') ? it : it.skip
        itIfSSR('V01 server-rendered rows, after the page-load activation: a row action runs, once, with its row and its modifiers', async () => {
            const calls = []
            const c = 'ra' + (++n)
            wildflower.component(c, { state: { items: [] }, pick: record(calls), twice: record(calls, 'twice') })
            const row = (v) => `<li><span data-bind="name">${v}</span><a class="f" href="#v" data-action="pick" data-event-prevent>x</a><b class="d" data-action="dblclick:twice">y</b></li>`
            host.innerHTML = `<div data-component="${c}" data-ssr="true"><ul class="L" data-list="items"><template><li><span data-bind="name"></span><a class="f" href="#v" data-action="pick" data-event-prevent>x</a><b class="d" data-action="dblclick:twice">y</b></li></template>${row('a')}${row('b')}</ul></div>`
            wildflower.scan()
            await settle(120)
            if (wildflower.ssrManager && wildflower.ssrManager.activateAllComponents) wildflower.ssrManager.activateAllComponents()
            await settle(150)
            const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
            last('.L .f').dispatchEvent(ev)
            await settle(30)
            last('.L .d').dispatchEvent(new Event('dblclick', { bubbles: true }))
            await settle(30)
            expect(calls.map((x) => [x[0], x[1]])).toEqual([['pick', 1], ['twice', 1]])
            expect(ev.defaultPrevented).toBe(true)
        })

        for (const rows of SIZES) {
            it(`V02 once and delay together: two quick clicks run the handler once (${rows} rows)`, async () => {
                const calls = []
                await mount(rows, '<div><button class="f" data-action="pick" data-event-once data-event-delay="60">x</button></div>', { pick: record(calls) })
                last('.L .f').click(); await settle(10); last('.L .f').click()
                await settle(160)
                expect(calls.length).toBe(1)
            })

            it(`V03 throttle lets the next call through once its window has passed (${rows} rows)`, async () => {
                const calls = []
                await mount(rows, '<div><button class="f" data-action="pick" data-event-throttle="60">x</button></div>', { pick: record(calls) })
                last('.L .f').click(); last('.L .f').click(); await settle(100)
                last('.L .f').click(); await settle(20)
                expect(calls.length).toBe(2)
            })

            it(`V04 a row action of any event type in a NESTED list, and in a row that is itself a list (${rows} rows)`, async () => {
                const calls = []
                const c = 'ra' + (++n)
                const groups = Array.from({ length: rows }, (_, g) => ({ id: 'g' + g, items: items(2) }))
                wildflower.component(c, { state: { groups }, pick: record(calls), ctx: record(calls, 'ctx') })
                const inner = '<template><b class="f" data-action="dblclick:pick contextmenu:ctx">x</b></template>'
                host.innerHTML = `<div data-component="${c}">
                    <div class="nested" data-list="groups" data-key="id"><template><section><p data-list="items" data-key="id">${inner}</p></section></template></div>
                    <div class="rowlist" data-list="groups" data-key="id"><template><p data-list="items" data-key="id">${inner}</p></template></div></div>`
                wildflower.scan()
                await settle(150)
                for (const sel of ['.nested .f', '.rowlist .f']) {
                    calls.length = 0
                    last(sel).dispatchEvent(new Event('dblclick', { bubbles: true })); await settle(20)
                    last(sel).dispatchEvent(new Event('contextmenu', { bubbles: true })); await settle(20)
                    expect([sel, ...calls.map((x) => [x[0], x[1]])]).toEqual([sel, ['pick', 1], ['ctx', 1]])
                }
            })

            it(`V05 a custom event that does not bubble, dispatched on the row element that declares it (${rows} rows)`, async () => {
                const calls = []
                await mount(rows, '<div><b class="f" data-action="refresh:pick"><i class="in">x</i></b></div>', { pick: record(calls) })
                last('.L .f').dispatchEvent(new CustomEvent('refresh'))
                await settle(30)
                expect(calls).toEqual([['pick', rows - 1, 'i' + (rows - 1)]])
                // Not for an element inside it: a non-bubbling event belongs to its target.
                calls.length = 0
                last('.L .f .in').dispatchEvent(new CustomEvent('refresh'))
                await settle(30)
                expect(calls).toEqual([])
            })

            it(`V06 an outside action inside a row that has its own click action: a click inside it reaches the row's action (${rows} rows)`, async () => {
                const calls = []
                await mount(rows, '<div class="row" data-action="select"><b class="f" data-action="close" data-event-outside>x</b></div>', {
                    select: record(calls, 'select'), close: record(calls, 'close')
                })
                last('.L .f').click(); await settle(30)
                // This row's select, and close for every OTHER row (the click is outside them).
                expect(calls.filter((x) => x[0] === 'select')).toEqual([['select', rows - 1, 'i' + (rows - 1)]])
                expect(calls.filter((x) => x[0] === 'close').length).toBe(rows - 1)
            })

            it(`V07 markup put inside a row by the app, then rebindActions(): its actions run, whatever their event type (${rows} rows)`, async () => {
                const calls = []
                const ctx = await mount(rows, '<div class="row"><span data-bind="name"></span></div>', { pick: record(calls), ctx2: record(calls, 'ctx2') })
                last('.L .row').insertAdjacentHTML('beforeend', '<button class="added" data-action="pick">+</button><i class="added2" data-action="auxclick:ctx2">!</i>')
                ctx.rebindActions()
                await settle(40)
                last('.L .added').click(); await settle(20)
                last('.L .added2').dispatchEvent(new Event('auxclick', { bubbles: true })); await settle(20)
                expect(calls.map((x) => [x[0], x[1]])).toEqual([['pick', rows - 1], ['ctx2', rows - 1]])
            })
        }

        it('V08 a submit action on a row element (not a form) runs when a form inside the row is submitted, after the form\'s own', async () => {
            const calls = []
            await mount(3, '<div class="row" data-action="submit:rowDone"><form class="f" data-action="save"><input></form></div>', {
                save: record(calls, 'save'), rowDone: record(calls, 'rowDone')
            })
            last('.L .f').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            await settle(40)
            expect(calls.map((x) => [x[0], x[1]])).toEqual([['save', 2], ['rowDone', 2]])
        })

        it('V09 an outside action in a data-render section that starts hidden: outside clicks reach it, inside clicks do not', async () => {
            const calls = []
            const c = 'ra' + (++n)
            wildflower.component(c, { state: { open: false }, close() { calls.push('close') } })
            host.innerHTML = `<div data-component="${c}"><section data-render="open"><div class="menu" data-action="close" data-event-outside><b class="in">x</b></div></section></div>`
            wildflower.scan()
            await settle(110)
            ctxOf(c).open = true
            await settle(120)
            host.querySelector('.menu .in').click(); await settle(30)
            expect(calls).toEqual([])
            document.body.click(); await settle(30)
            expect(calls).toEqual(['close'])
            // And again after another hide and show.
            ctxOf(c).open = false; await settle(80)
            ctxOf(c).open = true; await settle(120)
            calls.length = 0
            host.querySelector('.menu .in').click(); await settle(30)
            document.body.click(); await settle(30)
            expect(calls).toEqual(['close'])
        })

        it('V11 a child component\'s own list template inside a row does not hide the row\'s declared event types', async () => {
            const calls = []
            const kid = 'ra' + (++n) + 'kid'
            wildflower.component(kid, { state: { things: [{ id: 1 }] } })
            await mount(3, `<div class="row"><b class="f" data-action="dblclick:pick">x</b><i data-component="${kid}"><u data-list="things" data-key="id"><template><s data-bind="id"></s></template></u></i></div>`, { pick: record(calls) })
            await settle(80)
            last('.L .f').dispatchEvent(new Event('dblclick', { bubbles: true })); await settle(30)
            expect(calls.map((x) => [x[0], x[1]])).toEqual([['pick', 2]])
        })

        it('V13 a submit action on a row element with an action-less form inside: the form is not submitted for real', async () => {
            const calls = []
            await mount(3, '<div class="row" data-action="submit:rowDone"><form class="f"><input></form></div>', { rowDone: record(calls, 'rowDone') })
            const ev = new Event('submit', { bubbles: true, cancelable: true })
            last('.L .f').dispatchEvent(ev)
            await settle(40)
            expect(calls.map((x) => [x[0], x[1]])).toEqual([['rowDone', 2]])
            expect(ev.defaultPrevented).toBe(true)
        })

        for (const [mod, attr] of [['once', 'data-event-once'], ['throttle', 'data-event-throttle="400"'], ['debounce', 'data-event-debounce="40"']]) {
            it(`V14 an action on the list container itself keeps its ${mod} when the row template declares the same event type`, async () => {
                const calls = []
                const c = 'ra' + (++n)
                wildflower.component(c, { state: { items: items(3) }, onDbl() { calls.push('onDbl') }, pick() { calls.push('pick') } })
                host.innerHTML = `<div data-component="${c}"><div class="L" data-list="items" data-key="id" data-action="dblclick:onDbl" ${attr}><template><div><b class="f" data-action="dblclick:pick">x</b></div></template></div></div>`
                wildflower.scan()
                await settle(110)
                const list = host.querySelector('.L')
                for (let i = 0; i < 3; i++) list.dispatchEvent(new Event('dblclick', { bubbles: true }))
                await settle(120)
                expect(calls).toEqual(['onDbl'])
            })
        }

        it('V15 an outside action in a data-render section inside a row keeps its row details after the section is hidden and shown', async () => {
            const calls = []
            const ctx = await mount(3, '<div class="row"><section data-render="flag"><b class="menu" data-action="close" data-event-outside>x</b></section></div>', {
                close(event, element, details) { calls.push(details ? [details.index, details.item && details.item.id] : 'no details') }
            })
            document.body.click(); await settle(30)
            expect(calls.slice().sort()).toEqual([[0, 'i0'], [1, 'i1'], [2, 'i2']])
            ctx.flag = false; await settle(80)
            ctx.flag = true; await settle(120)
            calls.length = 0
            document.body.click(); await settle(30)
            expect(calls.slice().sort()).toEqual([[0, 'i0'], [1, 'i1'], [2, 'i2']])
        })

        it('V16 an element in a nested row with an action for another event type does not swallow the outer row\'s click action', async () => {
            const calls = []
            const c = 'ra' + (++n)
            wildflower.component(c, {
                state: { groups: [{ id: 'g0', kids: [{ id: 'k0' }] }, { id: 'g1', kids: [{ id: 'k1' }] }] },
                outer: record(calls, 'outer'), edit: record(calls, 'edit')
            })
            host.innerHTML = `<div data-component="${c}"><div class="L" data-list="groups" data-key="id"><template><div class="row" data-action="outer"><div data-list="kids" data-key="id"><template><p><span class="plain">a</span><span class="dbl" data-action="dblclick:edit">b</span></p></template></div></div></template></div></div>`
            wildflower.scan()
            await settle(150)
            last('.L .plain').click(); await settle(20)
            last('.L .dbl').click(); await settle(20)
            expect(calls).toEqual([['outer', 1, 'g1'], ['outer', 1, 'g1']])
            calls.length = 0
            last('.L .dbl').dispatchEvent(new Event('dblclick', { bubbles: true })); await settle(20)
            expect(calls).toEqual([['edit', 0, 'k1']])
        })

        it('V16b a row that is itself a list: a cell with an action for another event type does not swallow the row\'s click action', async () => {
            const calls = []
            const c = 'ra' + (++n)
            wildflower.component(c, {
                state: { members: [{ id: 'm0', cells: [{ id: 'c0' }] }, { id: 'm1', cells: [{ id: 'c1' }] }] },
                selectRow: record(calls, 'selectRow'), edit: record(calls, 'edit')
            })
            host.innerHTML = `<div data-component="${c}"><table><tbody class="L" data-list="members" data-key="id"><template><tr data-list="cells" data-key="id" data-action="selectRow"><template><td class="cell" data-action="dblclick:edit">x</td></template></tr></template></tbody></table></div>`
            wildflower.scan()
            await settle(150)
            last('.L .cell').click(); await settle(20)
            expect(calls).toEqual([['selectRow', 1, 'm1']])
        })

        it('V19 an action on a nested list\'s container (an element of the outer row) runs with the outer row', async () => {
            const calls = []
            const c = 'ra' + (++n)
            wildflower.component(c, {
                state: { groups: [{ id: 'g0', kids: [{ id: 'k0' }] }, { id: 'g1', kids: [{ id: 'k1' }] }] },
                open: record(calls, 'open')
            })
            host.innerHTML = `<div data-component="${c}"><div class="L" data-list="groups" data-key="id"><template><div class="row"><div class="kids" data-list="kids" data-key="id" data-action="open"><template><p class="kid">a</p></template></div></div></template></div></div>`
            wildflower.scan()
            await settle(150)
            last('.L .kid').click(); await settle(20)
            last('.L .kids').click(); await settle(20)
            expect(calls).toEqual([['open', 1, 'g1'], ['open', 1, 'g1']])
        })

        it('V17 an event whose target is a text node inside a nested row does not throw in the outer list', async () => {
            const calls = []
            const errors = []
            const onError = (e) => { errors.push(String(e.message || e)) }
            window.addEventListener('error', onError)
            const c = 'ra' + (++n)
            wildflower.component(c, {
                state: { groups: [{ id: 'g0', kids: [{ id: 'k0' }] }] },
                outer: record(calls, 'outer'), inner: record(calls, 'inner')
            })
            host.innerHTML = `<div data-component="${c}"><div class="L" data-list="groups" data-key="id"><template><div class="row" data-action="ping:outer"><div data-list="kids" data-key="id"><template><p class="kid" data-action="ping:inner">text</p></template></div></div></template></div></div>`
            wildflower.scan()
            await settle(150)
            try {
                last('.L .kid').firstChild.dispatchEvent(new Event('ping', { bubbles: true }))
                await settle(30)
            } finally {
                window.removeEventListener('error', onError)
            }
            expect(errors).toEqual([])
            expect(calls).toEqual([['inner', 0, 'k0']])
        })

        const describeIfPool = hasFeature('pools') ? describe : describe.skip
        describeIfPool('pool forms', () => {
            it('V18 a form in a pool row with submit: and click: actions runs each on its own event', async () => {
                const calls = []
                const c = 'ra' + (++n)
                wildflower.component(c, {
                    state: {}, pools: { tasks: {} }, init() { this.pools.tasks.add({ id: 1 }) },
                    save(item, event) { calls.push(['save', event.type]) }, track(item, event) { calls.push(['track', event.type]) }
                })
                host.innerHTML = `<div data-component="${c}"><div class="P" data-pool="tasks" data-key="id"><template><div><form class="f" data-action="submit:save click:track"><label class="lb">l</label></form></div></template></div></div>`
                wildflower.scan()
                await settle(150)
                last('.P .f').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle(30)
                expect(calls).toEqual([['save', 'submit']])
            })

            it('V12 a bare action on a form in a pool row runs on submit, not on a click inside the form', async () => {
                const calls = []
                const c = 'ra' + (++n)
                wildflower.component(c, { state: {}, pools: { tasks: {} }, init() { this.pools.tasks.add({ id: 1 }); this.pools.tasks.add({ id: 2 }) }, save(item, event) { calls.push([item.id, event.type]) } })
                host.innerHTML = `<div data-component="${c}"><div class="P" data-pool="tasks" data-key="id"><template><div><form class="f" data-action="save"><label class="lb">l</label><input></form></div></template></div></div>`
                wildflower.scan()
                await settle(150)
                last('.P .lb').click(); await settle(30)
                expect(calls).toEqual([])
                const ev = new Event('submit', { bubbles: true, cancelable: true })
                last('.P .f').dispatchEvent(ev); await settle(30)
                expect(calls).toEqual([[2, 'submit']])
                expect(ev.defaultPrevented).toBe(true)
            })
        })
    })

    describe('what must not change', () => {
        it('K a plain click action: one call, with the row, at both sizes, fresh and after a re-bind', async () => {
            for (const rows of SIZES) {
                for (const before of Object.keys(BEFORE)) {
                    const calls = []
                    await mount(rows, '<div><a class="f" data-action="pick" data-bind="name"></a></div>', { pick: record(calls) }, before)
                    last('.L .f').click(); await settle(20)
                    expect(calls).toEqual([['pick', rows - 1, 'i' + (rows - 1)]])
                    host.innerHTML = ''
                    await settle(10)
                }
            }
        })

        it('K an action in a child component inside a row is the child\'s, bound by the child', async () => {
            const calls = []
            const kid = 'ra' + (++n) + 'kid'
            wildflower.component(kid, { state: {}, pick() { calls.push('child') } })
            await mount(3, `<div><i data-component="${kid}"><button class="f" data-action="pick" data-event-once>x</button></i></div>`, { pick() { calls.push('parent') } })
            await settle(60)
            last('.L .f').click(); await settle(20); last('.L .f').click(); await settle(20)
            expect(calls).toEqual(['child'])
        })
    })

    const itDev = isMinifiedBuild() ? it.skip : it
    itDev('W data-event-capture on a row action cannot be honoured: a development warning says so', async () => {
        const warnings = []
        const orig = console.warn
        console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
        try {
            await mount(3, '<div><button class="f" data-action="pick" data-event-capture>x</button></div>', { pick() {} })
            last('.L .f').click()
            await settle(30)
        } finally { console.warn = orig }
        // One warning for the element, however often it is used. (The warning
        // prints a second line with the docs link; count the first.)
        last('.L .f').click()
        await settle(30)
        expect(warnings.filter((w) => w.includes('[WF-607]')).length).toBe(1)
    })

    const describeIfPool = hasFeature('pools') ? describe : describe.skip
    describeIfPool('pools', () => {
        const mountPool = async (def, tpl) => {
            const c = 'ra' + (++n)
            wildflower.component(c, { state: {}, pools: { tasks: {} }, init() { this.pools.tasks.add({ id: 1 }); this.pools.tasks.add({ id: 2 }) }, ...def })
            host.innerHTML = `<div data-component="${c}"><div class="P" data-pool="tasks" data-key="id"><template>${tpl}</template></div></div>`
            wildflower.scan()
            await settle(150)
        }

        it('P several actions on one pool element each run on their own event', async () => {
            const calls = []
            await mountPool({ a(item) { calls.push(['a', item.id]) }, b(item) { calls.push(['b', item.id]) } }, '<div><button class="f" data-action="click:a keydown:b">x</button></div>')
            const el = last('.P .f')
            el.click(); await settle(30)
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })); await settle(30)
            expect(calls).toEqual([['a', 2], ['b', 2]])
        })

        it('P arguments on a pool action arrive after (item, event)', async () => {
            const seen = []
            await mountPool({ pick(...a) { seen.push([a.length, a[0].id, a[1] instanceof Event, a[2]]) } },
                '<div><button class="plain" data-action="pick">y</button><button class="args" data-action="pick(7)">x</button></div>')
            last('.P .plain').click(); await settle(30)
            last('.P .args').click(); await settle(30)
            expect(seen).toEqual([[2, 2, true, undefined], [3, 2, true, 7]])
        })
    })
})
