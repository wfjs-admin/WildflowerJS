/**
 * data-list over a dotted path, at the top level and inside a row.
 *
 * The rule (agreed 2026-10-03):
 *   - computed: is optional on a list path: computed:menu.items reads exactly
 *     what menu.items does, and computed:tags what tags does, everywhere.
 *   - Inside a row, a DOTTED path reads the COMPONENT when the component
 *     declares the head (a state key of its definition, or a computed), and
 *     the ROW ITEM otherwise (the path walked through the item). The route is
 *     decided by the declaration, never by row data, so every row, a same-key
 *     replace, a click and the server-row parse agree.
 *   - Inside a row, an UNDOTTED name reads the row item, then a component
 *     computed of that name, never component state (unchanged).
 *
 * Before the fix, data-list="computed:menu.items" and a dotted path into the
 * component inside a row rendered nothing, silently, in every build.
 *
 * Every case runs twice: bare, and with the computed: prefix.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, hasConsoleWarnings, whenSettled } from './helpers/load-framework.js'

const listsSuite = hasFeature('lists') ? describe : describe.skip
const ssrSuite = hasFeature('lists') && hasFeature('ssr') ? describe : describe.skip
const devIt = hasConsoleWarnings() ? it : it.skip

let seq = 0
const uname = (p) => `${p}-ldp-${++seq}`

let container
let wildflower
let warns
let realWarn

async function settle() {
    await whenSettled()
    await new Promise(r => setTimeout(r, 30))
    await whenSettled()
}

function texts(root, selector) {
    return Array.from(root.querySelectorAll(selector)).map(el => el.textContent)
}

// One array of nested-row texts per outer row.
function innerTexts(cls = 'inner') {
    return Array.from(container.querySelectorAll('.row')).map(row => texts(row, '.' + cls + ' li'))
}

beforeAll(async () => {
    await loadFramework()
})

beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
    warns = []
    realWarn = console.warn
    console.warn = (...args) => { warns.push(args.map(String).join(' ')); realWarn.apply(console, args) }
})

afterEach(() => {
    console.warn = realWarn
    if (container && container.parentNode) container.parentNode.removeChild(container)
    container = null
})

// A computed that returns an object with an array field, over plain state.
function menuDefinition(extraState = {}) {
    return {
        state: {
            all: [
                { id: 1, name: 'soup', on: true },
                { id: 2, name: 'tea', on: false }
            ],
            ...extraState
        },
        computed: {
            menu() {
                return { title: 'Today', items: this.all.filter(item => item.on) }
            }
        }
    }
}

async function mount(name, definition, html) {
    wildflower.component(name, definition)
    container.innerHTML = `<div data-component="${name}">${html}</div>`
    wildflower.scan(container)
    await settle()
    return wildflower.getComponent(name)
}

// An outer list of rows, each holding a nested list over `path`.
const nestedHtml = (path, extra = '') => `
    <ul class="outer" data-list="rows" data-key="id">
        <template>
            <li class="row">
                <span class="row-name" data-bind="name"></span>
                <ul class="inner" data-list="${path}" data-key="id">
                    <template><li data-bind="name"></li></template>
                </ul>${extra}
            </li>
        </template>
    </ul>
`

const rows = () => [{ id: 'r1', name: 'row one' }, { id: 'r2', name: 'row two' }]

for (const P of ['', 'computed:']) {
    const label = P ? 'with the computed: prefix' : 'bare'

    listsSuite(`top-level dotted path (${label})`, () => {
        it(`(a) data-list="${P}menu.items" renders the computed's field and follows it`, async () => {
            const ctx = await mount(uname('menu-top'), menuDefinition(), `
                <h3 class="title" data-bind="menu.title"></h3>
                <ul class="out" data-list="${P}menu.items" data-key="id">
                    <template><li data-bind="name"></li></template>
                </ul>
            `)
            expect(container.querySelector('.title').textContent).toBe('Today')
            expect(texts(container, '.out li')).toEqual(['soup'])

            ctx.all.push({ id: 3, name: 'pie', on: true })
            await settle()
            expect(texts(container, '.out li')).toEqual(['soup', 'pie'])

            ctx.all[1].on = true
            await settle()
            expect(texts(container, '.out li')).toEqual(['soup', 'tea', 'pie'])

            ctx.all[0].name = 'broth'
            await settle()
            expect(texts(container, '.out li')).toEqual(['broth', 'tea', 'pie'])

            ctx.all = [{ id: 9, name: 'cake', on: true }]
            await settle()
            expect(texts(container, '.out li')).toEqual(['cake'])
        })

        it(`(c) data-list="${P}settings.options" renders a state object's field and follows it`, async () => {
            const ctx = await mount(uname('settings-top'), {
                state: { settings: { options: [{ id: 1, name: 's' }, { id: 2, name: 'm' }] } }
            }, `
                <ul class="out" data-list="${P}settings.options" data-key="id">
                    <template><li data-bind="name"></li></template>
                </ul>
            `)
            expect(texts(container, '.out li')).toEqual(['s', 'm'])

            ctx.settings.options.push({ id: 3, name: 'l' })
            await settle()
            expect(texts(container, '.out li')).toEqual(['s', 'm', 'l'])

            ctx.settings.options[0].name = 'xs'
            await settle()
            expect(texts(container, '.out li')).toEqual(['xs', 'm', 'l'])

            ctx.settings.options = [{ id: 7, name: 'xl' }]
            await settle()
            expect(texts(container, '.out li')).toEqual(['xl'])
        })
    })

    listsSuite(`inside a row, a dotted path the component declares reads the component (${label})`, () => {
        it(`(d) data-list="${P}menu.items" renders the computed in every row, including rows added later`, async () => {
            const ctx = await mount(uname('menu-nested'), menuDefinition({ rows: rows() }), nestedHtml(`${P}menu.items`))
            expect(texts(container, '.row-name')).toEqual(['row one', 'row two'])
            expect(innerTexts()).toEqual([['soup'], ['soup']])

            ctx.all.push({ id: 3, name: 'pie', on: true })
            await settle()
            expect(innerTexts()).toEqual([['soup', 'pie'], ['soup', 'pie']])

            ctx.all[1].on = true
            await settle()
            expect(innerTexts()).toEqual([['soup', 'tea', 'pie'], ['soup', 'tea', 'pie']])

            ctx.rows.push({ id: 'r3', name: 'row three' })
            await settle()
            expect(innerTexts()).toEqual([
                ['soup', 'tea', 'pie'], ['soup', 'tea', 'pie'], ['soup', 'tea', 'pie']
            ])
        })

        it(`(e) data-list="${P}settings.options" renders the state in every row; added rows and same-key replaces keep reading it`, async () => {
            const ctx = await mount(uname('settings-nested'), {
                state: {
                    rows: rows(),
                    settings: { options: [{ id: 1, name: 's' }, { id: 2, name: 'm' }] }
                }
            }, nestedHtml(`${P}settings.options`))
            expect(texts(container, '.row-name')).toEqual(['row one', 'row two'])
            expect(innerTexts()).toEqual([['s', 'm'], ['s', 'm']])

            ctx.settings.options.push({ id: 3, name: 'l' })
            await settle()
            expect(innerTexts()).toEqual([['s', 'm', 'l'], ['s', 'm', 'l']])

            ctx.settings.options[0].name = 'xs'
            await settle()
            expect(innerTexts()).toEqual([['xs', 'm', 'l'], ['xs', 'm', 'l']])

            ctx.settings.options = [{ id: 7, name: 'xl' }]
            await settle()
            expect(innerTexts()).toEqual([['xl'], ['xl']])

            // A row added later reads the component too.
            ctx.rows.push({ id: 'r3', name: 'row three' })
            await settle()
            expect(innerTexts()).toEqual([['xl'], ['xl'], ['xl']])

            // A same-key replace, even by an item that has a field of the
            // head's name, does not change the route.
            ctx.rows = ctx.rows.map(r => r.id === 'r1'
                ? { id: 'r1', name: 'row one!', settings: { options: [{ id: 99, name: 'own' }] } }
                : r)
            await settle()
            expect(texts(container, '.row-name')).toEqual(['row one!', 'row two', 'row three'])
            expect(innerTexts()).toEqual([['xl'], ['xl'], ['xl']])

            // Removing a row leaves the others following the state.
            ctx.rows = ctx.rows.filter(r => r.id !== 'r2')
            await settle()
            ctx.settings.options.push({ id: 8, name: 'xxl' })
            await settle()
            expect(innerTexts()).toEqual([['xl', 'xxl'], ['xl', 'xxl']])
        })

        it(`(e2) a row without the head field reads the component like the others (${label})`, async () => {
            const ctx = await mount(uname('settings-nested-mixed'), {
                state: {
                    rows: [
                        { id: 'r1', name: 'one', settings: { options: [{ id: 50, name: 'own' }] } },
                        { id: 'r2', name: 'two' }
                    ],
                    settings: { options: [{ id: 1, name: 's' }] }
                }
            }, nestedHtml(`${P}settings.options`))
            expect(innerTexts()).toEqual([['s'], ['s']])
            // The item's own field never takes over, however it changes.
            ctx.rows[1].settings = { options: [{ id: 51, name: 'late' }] }
            await settle()
            expect(innerTexts()).toEqual([['s'], ['s']])
        })

        devIt(`WF-519 (dev): once, when the first row also holds the head the component declares (${label})`, async () => {
            const name = uname('collision')
            await mount(name, {
                state: {
                    rows: [
                        { id: 'r1', name: 'one', settings: { options: [{ id: 50, name: 'own' }] } },
                        { id: 'r2', name: 'two', settings: { options: [{ id: 51, name: 'own2' }] } }
                    ],
                    settings: { options: [{ id: 1, name: 's' }] }
                }
            }, nestedHtml(`${P}settings.options`))
            expect(innerTexts()).toEqual([['s'], ['s']])
            const hits = warns.filter(w => w.includes('WF-519') && w.includes(name))
            expect(hits.length).toBe(1)
            expect(hits[0]).toContain(`data-list="${P}settings.options"`)
            expect(hits[0]).toContain('reads the component\'s "settings"')
        })

        it(`(j) data-list="${P}props.opts" inside a row reads the component's props`, async () => {
            const parent = uname('props-parent')
            const child = parent + '-c'
            wildflower.component(child, { props: { opts: {} }, state: { rows: rows() } })
            const ctx = await mount(parent, {
                state: { options: [{ id: 1, name: 'p1' }, { id: 2, name: 'p2' }] }
            }, `<div data-component="${child}" data-prop-opts="options">${nestedHtml(`${P}props.opts`)}</div>`)
            expect(innerTexts()).toEqual([['p1', 'p2'], ['p1', 'p2']])

            ctx.options.push({ id: 3, name: 'p3' })
            await settle()
            expect(innerTexts()).toEqual([['p1', 'p2', 'p3'], ['p1', 'p2', 'p3']])
        })

        it(`(h) a click in a nested row gets the component list's item, index and length (${label})`, async () => {
            const seen = []
            const ctx = await mount(uname('scope-nested'), {
                state: {
                    rows: rows(),
                    settings: { options: [{ id: 1, name: 'opt a' }, { id: 2, name: 'opt b' }, { id: 3, name: 'opt c' }] }
                },
                pick(event, element, details) {
                    seen.push(details ? {
                        name: details.item ? details.item.name : null,
                        index: details.index,
                        length: details.length,
                        parent: details.parent && details.parent.item ? details.parent.item.name : null
                    } : null)
                }
            }, `
                <ul class="outer" data-list="rows" data-key="id">
                    <template>
                        <li class="row">
                            <span class="row-name" data-bind="name"></span>
                            <ul class="inner" data-list="${P}settings.options" data-key="id">
                                <template><li><button class="pick" data-action="pick" data-bind="name"></button></li></template>
                            </ul>
                        </li>
                    </template>
                </ul>
            `)
            expect(innerTexts()).toEqual([['opt a', 'opt b', 'opt c'], ['opt a', 'opt b', 'opt c']])

            container.querySelectorAll('.row')[1].querySelectorAll('.pick')[1].click()
            await settle()
            expect(seen).toEqual([{ name: 'opt b', index: 1, length: 3, parent: 'row two' }])

            // A write to the outer row's item reaches only the outer binding.
            ctx.rows[0].name = 'row one!'
            await settle()
            expect(texts(container, '.row-name')).toEqual(['row one!', 'row two'])
            expect(innerTexts()).toEqual([['opt a', 'opt b', 'opt c'], ['opt a', 'opt b', 'opt c']])
        })
    })

    listsSuite(`inside a row, every other path reads the row item (${label})`, () => {
        it(`(f) data-list="${P}children" renders the row item's array and follows it`, async () => {
            const ctx = await mount(uname('children-nested'), {
                state: {
                    rows: [
                        { id: 'g1', name: 'one', children: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] },
                        { id: 'g2', name: 'two', children: [{ id: 3, name: 'c' }] }
                    ]
                }
            }, nestedHtml(`${P}children`))
            expect(innerTexts()).toEqual([['a', 'b'], ['c']])

            ctx.rows[1].children.push({ id: 4, name: 'd' })
            await settle()
            expect(innerTexts()).toEqual([['a', 'b'], ['c', 'd']])

            ctx.rows[0].children[0].name = 'a!'
            await settle()
            expect(innerTexts()).toEqual([['a!', 'b'], ['c', 'd']])
        })

        it(`(g) data-list="${P}group.items" walks the row item and follows it`, async () => {
            const ctx = await mount(uname('item-dotted'), {
                state: {
                    rows: [
                        { id: 'r1', group: { items: [{ id: 1, name: 'x' }] } },
                        { id: 'r2', group: { items: [{ id: 2, name: 'y' }] } }
                    ]
                }
            }, nestedHtml(`${P}group.items`))
            expect(innerTexts()).toEqual([['x'], ['y']])

            ctx.rows[0].group.items.push({ id: 3, name: 'z' })
            await settle()
            expect(innerTexts()).toEqual([['x', 'z'], ['y']])

            ctx.rows[0].group.items[0].name = 'x!'
            await settle()
            expect(innerTexts()).toEqual([['x!', 'z'], ['y']])

            // Replacing the object the path runs through moves the rows too.
            ctx.rows[1].group = { items: [{ id: 4, name: 'w' }, { id: 5, name: 'v' }] }
            await settle()
            expect(innerTexts()).toEqual([['x!', 'z'], ['w', 'v']])

            // A row whose group has no array yet renders it once one is assigned.
            ctx.rows.push({ id: 'r3', group: {} })
            await settle()
            expect(innerTexts()).toEqual([['x!', 'z'], ['w', 'v'], []])
            ctx.rows[2].group.items = [{ id: 6, name: 'u' }]
            await settle()
            expect(innerTexts()).toEqual([['x!', 'z'], ['w', 'v'], ['u']])
        })

        it(`(g2) a row without the head renders nothing, gains its own list when the field arrives, and keeps the item route through a same-key replace (${label})`, async () => {
            const ctx = await mount(uname('item-dotted-absent'), {
                state: {
                    rows: [
                        { id: 'r1', group: { items: [{ id: 1, name: 'x' }] } },
                        { id: 'r2' }
                    ]
                },
                init() {
                    // State the definition does not declare: not a source
                    // for the nested list, so the row without `group` does
                    // not fall back to it.
                    this.group = { items: [{ id: 90, name: 'component' }] }
                }
            }, nestedHtml(`${P}group.items`))
            expect(innerTexts()).toEqual([['x'], []])

            ctx.rows[1].group = { items: [{ id: 2, name: 'y' }] }
            await settle()
            expect(innerTexts()).toEqual([['x'], ['y']])

            // Same-key replaces: a new group, then no group at all.
            ctx.rows = ctx.rows.map(r => r.id === 'r1' ? { id: 'r1', group: { items: [{ id: 3, name: 'z' }] } } : r)
            await settle()
            expect(innerTexts()).toEqual([['z'], ['y']])
            ctx.rows = ctx.rows.map(r => r.id === 'r2' ? { id: 'r2' } : r)
            await settle()
            expect(innerTexts()).toEqual([['z'], []])
        })

        it(`(j2) data-list="${P}props.opts" reads the row item when the component declares no props`, async () => {
            const ctx = await mount(uname('props-undeclared'), {
                state: {
                    rows: [
                        { id: 'r1', props: { opts: [{ id: 1, name: 'a' }] } },
                        { id: 'r2', props: { opts: [{ id: 2, name: 'b' }, { id: 3, name: 'c' }] } }
                    ]
                }
            }, nestedHtml(`${P}props.opts`))
            expect(innerTexts()).toEqual([['a'], ['b', 'c']])

            ctx.rows[0].props.opts.push({ id: 4, name: 'd' })
            await settle()
            expect(innerTexts()).toEqual([['a', 'd'], ['b', 'c']])
            expect(warns.filter(w => w.includes('WF-519'))).toEqual([])
        })

        it(`(k) data-list="${P}stats.items" with an item-level computed stats(row) evaluates it for each row`, async () => {
            const ctx = await mount(uname('item-computed-head'), {
                state: { rows: [{ id: 'r1', n: 2 }, { id: 'r2', n: 1 }] },
                computed: {
                    stats(row) {
                        const items = []
                        for (let i = 0; i < row.n; i++) items.push({ id: row.id + i, name: 'i' + i })
                        return { items }
                    }
                }
            }, nestedHtml(`${P}stats.items`))
            expect(innerTexts()).toEqual([['i0', 'i1'], ['i0']])

            ctx.rows[1].n = 3
            await settle()
            expect(innerTexts()).toEqual([['i0', 'i1'], ['i0', 'i1', 'i2']])
        })

        devIt(`WF-519 (dev): once, when the head is not declared and the first row lacks it (${label})`, async () => {
            const name = uname('undeclared')
            await mount(name, {
                state: { rows: [{ id: 'r1' }, { id: 'r2', group: { items: [{ id: 1, name: 'x' }] } }] }
            }, nestedHtml(`${P}group.items`))
            expect(innerTexts()).toEqual([[], ['x']])
            const hits = warns.filter(w => w.includes('WF-519') && w.includes(name))
            expect(hits.length).toBe(1)
            expect(hits[0]).toContain(`data-list="${P}group.items"`)
            expect(hits[0]).toContain('the first row has no "group"')
            expect(warns.some(w => w.includes('declare "group" in the component\'s state: block'))).toBe(true)
        })

        devIt(`WF-519 (dev) stays quiet when the route and the first row agree (${label})`, async () => {
            const name = uname('agree')
            await mount(name, {
                state: {
                    rows: [{ id: 'r1', group: { items: [{ id: 1, name: 'x' }] } }, { id: 'r2' }],
                    settings: { options: [{ id: 1, name: 's' }] }
                }
            }, nestedHtml(`${P}group.items`, `<ul class="inner2" data-list="${P}settings.options" data-key="id"><template><li data-bind="name"></li></template></ul>`))
            expect(innerTexts()).toEqual([['x'], []])
            expect(warns.filter(w => w.includes('WF-519'))).toEqual([])
        })

        it(`(i) data-list="${P}tags" (undotted) reads the row item first, then a component computed, never state`, async () => {
            const ctx = await mount(uname('undotted-nested'), {
                state: {
                    rows: [{ id: 'r1', count: 2 }, { id: 'r2', count: 1, tags: [{ id: 't', name: 'own' }] }],
                    all: [{ id: 1, name: 'a', on: true }, { id: 2, name: 'b', on: false }],
                    stateList: [{ id: 1, name: 'state' }]
                },
                computed: {
                    tags() {
                        return this.all.filter(t => t.on)
                    },
                    upTo(row) {
                        const out = []
                        for (let i = 1; i <= row.count; i++) out.push({ id: row.id + '-' + i, name: 'n' + i })
                        return out
                    }
                }
            }, `
                <ul class="outer" data-list="rows" data-key="id">
                    <template>
                        <li class="row">
                            <ul class="tags" data-list="${P}tags" data-key="id"><template><li data-bind="name"></li></template></ul>
                            <ul class="per-row" data-list="${P}upTo" data-key="id"><template><li data-bind="name"></li></template></ul>
                            <ul class="state" data-list="${P}stateList" data-key="id"><template><li data-bind="name"></li></template></ul>
                        </li>
                    </template>
                </ul>
            `)
            // Row r2's own `tags` field wins over the computed.
            expect(innerTexts('tags')).toEqual([['a'], ['own']])
            expect(innerTexts('per-row')).toEqual([['n1', 'n2'], ['n1']])
            expect(innerTexts('state')).toEqual([[], []])

            ctx.all[1].on = true
            await settle()
            expect(innerTexts('tags')).toEqual([['a', 'b'], ['own']])

            ctx.rows[1].count = 3
            await settle()
            expect(innerTexts('per-row')).toEqual([['n1', 'n2'], ['n1', 'n2', 'n3']])
        })
    })
}

ssrSuite('server-rendered rows over a dotted nested path', () => {
    const optTpl = '<template><li data-bind="name"></li></template>'
    const rowTpl = (path) => `<template><li class="row"><b class="row-name" data-bind="name"></b><ul class="inner" data-list="${path}" data-key="id">${optTpl}</ul></li></template>`
    const serverRow = (id, name, path, opts = [[1, 's'], [2, 'm']]) =>
        `<li class="row" data-seed='{"id":"${id}"}'><b class="row-name" data-bind="name">${name}</b>` +
        `<ul class="inner" data-list="${path}" data-key="id">${optTpl}` +
        opts.map(([oid, text]) => `<li data-bind="name" data-seed='{"id":${oid}}'>${text}</li>`).join('') + '</ul></li>'

    async function mountSSR(name, definition, inner) {
        wildflower.component(name, definition)
        container.innerHTML = `<div class="host" data-component="${name}" data-ssr="true">${inner}</div>`
        wildflower.scan(container)
        await new Promise(r => setTimeout(r, 200))
        await settle()
        const host = container.querySelector('.host')
        return wildflower.getComponentInstance(host.dataset.componentId).context
    }

    const settingsDef = () => ({
        state: { rows: [], settings: { options: [{ id: 1, name: 's' }, { id: 2, name: 'm' }] } }
    })

    for (const P of ['', 'computed:']) {
        it(`server rows of data-list="${P}settings.options" follow the component with no outer-row change first`, async () => {
            const path = `${P}settings.options`
            const ctx = await mountSSR(uname('ssr-follow'), settingsDef(),
                `<ul class="outer" data-list="rows" data-key="id">${rowTpl(path)}${serverRow('r1', 'one', path)}${serverRow('r2', 'two', path)}</ul>`)
            expect(ctx.rows.map(r => r.id)).toEqual(['r1', 'r2'])
            expect(ctx.rows.map(r => r.settings)).toEqual([undefined, undefined])
            expect(innerTexts()).toEqual([['s', 'm'], ['s', 'm']])

            ctx.settings.options.push({ id: 3, name: 'l' })
            await settle()
            expect(innerTexts()).toEqual([['s', 'm', 'l'], ['s', 'm', 'l']])

            ctx.settings.options[0].name = 'S'
            await settle()
            expect(innerTexts()).toEqual([['S', 'm', 'l'], ['S', 'm', 'l']])

            ctx.settings.options = [{ id: 7, name: 'xl' }]
            await settle()
            expect(innerTexts()).toEqual([['xl'], ['xl']])

            // A client row renders the same list as the server rows.
            ctx.rows.push({ id: 'r3', name: 'three' })
            await settle()
            expect(innerTexts()).toEqual([['xl'], ['xl'], ['xl']])
        })
    }

    it('a key that only the server markup adds (data-bind="group.title") does not make group.items read the component', async () => {
        const rowsTpl = rowTpl('group.items')
        // Plain client rendering of the same component and data.
        const a = uname('csr-group')
        wildflower.component(a, { state: { rows: [{ id: 'r1', group: { items: [{ id: 1, name: 'x' }] } }] } })
        container.innerHTML = `<div data-component="${a}"><h1 data-bind="group.title"></h1><ul class="outer" data-list="rows" data-key="id">${rowsTpl}</ul></div>`
        wildflower.scan(container)
        await settle()
        const client = innerTexts()
        expect(client).toEqual([['x']])
        container.innerHTML = ''

        const ctx = await mountSSR(uname('ssr-group'), { state: { rows: [] } },
            `<h1 data-bind="group.title">Hello</h1><ul class="outer" data-list="rows" data-key="id">${rowsTpl}` +
            serverRow('r1', 'one', 'group.items', [[1, 'x']]) + '</ul>')
        expect(innerTexts()).toEqual(client)
        expect(ctx.rows[0].group.items.map(i => i.name)).toEqual(['x'])

        ctx.rows.push({ id: 'r2', group: { items: [{ id: 2, name: 'y' }] } })
        await settle()
        expect(innerTexts()).toEqual([['x'], ['y']])
    })

    it('a $store list nested under data-list="computed:menu.groups" takes a store write without throwing', async () => {
        const s = uname('tags').replace(/-/g, '')
        wildflower.store(s, { state: { items: [{ id: 1, name: 't1' }] } })
        const errors = []
        const onError = (e) => { errors.push(String(e.error || e.message)); e.preventDefault() }
        window.addEventListener('error', onError)
        try {
            const innerTpl = `<ul class="inner" data-list="$${s}.items" data-key="id">${optTpl}`
            await mountSSR(uname('ssr-menu'), {
                state: { all: [{ id: 'g1', name: 'G1' }] },
                computed: { menu() { return { groups: this.all } } }
            }, `<ul class="outer" data-list="computed:menu.groups" data-key="id"><template><li class="row"><b data-bind="name"></b>${innerTpl}</ul></li></template>` +
                `<li class="row" data-seed='{"id":"g1"}'><b data-bind="name">G1</b>${innerTpl}<li data-bind="name" data-seed='{"id":1}'>t1</li></ul></li></ul>`)
            expect(innerTexts()).toEqual([['t1']])

            let thrown = null
            try {
                wildflower.getStore(s).items.push({ id: 2, name: 't2' })
                await settle()
            } catch (e) { thrown = e }
            expect(thrown).toBe(null)
            expect(errors).toEqual([])
            expect(innerTexts()).toEqual([['t1', 't2']])
        } finally {
            window.removeEventListener('error', onError)
        }
    })
})
