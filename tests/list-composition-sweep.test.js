/**
 * List composition sweep.
 *
 * Each feature a row can carry is well tested on its own, in the shape we
 * write ourselves: inside the row, in a flat list of a few rows, with the data
 * there from the start. The faults those tests miss are the same
 * feature somewhere else: on the row's ROOT element, in a NESTED list's row, in
 * a row that is itself a list, in a list of ten or more rows (a different
 * row-building path), or after something arrived late (an array, a rescan).
 *
 * So this file crosses them:
 *
 *   feature  x  where it sits  x  how many rows
 *
 * and takes every cell through the same sequence of operations, checking the
 * whole rendered list after each one.
 *
 * The oracle is the data. Every feature says what one item should look like
 * (`want`) and how to read that off the DOM (`read`); the expectation for a
 * step is computed from the component's state at that moment, never written by
 * hand. Actions and forms are checked by use: the handler must run exactly
 * once, with the row it was triggered on.
 *
 * A cell reports every step that went wrong, not only the first.
 *
 * The full-dev lane runs every cell (about 165 s); the other list lanes run
 * the two-row cells only, so the sweep stays inside their usual time.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { loadFramework, resetFramework, hasFeature, getDistMode } from './helpers/load-framework.js'

// The framework's own settle point, then a frame and a task for anything
// queued behind it (a fixed sleep made each cell about 760 ms). ms waits
// that long as well, for a timer the step itself starts (a debounce).
const settle = async (ms = 0) => {
    await window.wildflower.whenSettled()
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, ms)))
}
const describeIfLists = hasFeature('lists') ? describe : describe.skip
const J = (v) => JSON.stringify(v)
const text = (el) => (el ? (el.textContent || '').trim() : null)

// ── Where the feature sits ────────────────────────────────────────────────
// form: 'root' puts the feature on the row's root element, 'child' on an
// element inside it. The list under test always has class "L"; for the nested
// shapes it is groups[g].items, one list per group.
const LIST = (row) => `<div class="L" data-list="items" data-key="id"><template>${row}</template></div>`
const POSITIONS = {
    'flat, row root': { form: 'root', nested: false, wrap: LIST },
    'flat, inside the row': { form: 'child', nested: false, wrap: LIST },
    'nested list, row root': { form: 'root', nested: true, wrap: (row) => `<div data-list="groups" data-key="id"><template><section>${LIST(row)}</section></template></div>` },
    'nested list, inside the row': { form: 'child', nested: true, wrap: (row) => `<div data-list="groups" data-key="id"><template><section>${LIST(row)}</section></template></div>` },
    'list that is itself a row, row root': { form: 'root', nested: true, wrap: (row) => `<div data-list="groups" data-key="id"><template>${LIST(row)}</template></div>` },
    'list that is itself a row, inside the row': { form: 'child', nested: true, wrap: (row) => `<div data-list="groups" data-key="id"><template>${LIST(row)}</template></div>` }
}

// ── What sits in the row ──────────────────────────────────────────────────
// root / child: the row template with the feature element (class "f") as the
// row itself or inside it. read(el, row) reads the feature off one rendered
// row (el is null when the feature element is absent); want(item, index, list)
// is what the data says it should be.
const ID = '<i class="id" data-bind="id"></i>'
const idOf = (row) => text(row.querySelector('.id'))
const OPTIONS = '<template><option data-bind="name" data-bind-attr="{ value: id }"></option></template>'
const TAGS = '<template><b data-bind="t"></b></template>'
const place = (index, length) => index + '/' + length + (index === 0 ? 'F' : '') + (index === length - 1 ? 'L' : '')

const FEATURES = {
    'text': {
        root: () => '<div class="f" data-bind="name"></div>',
        child: () => '<div><span class="f" data-bind="name"></span></div>',
        read: (el) => text(el),
        want: (it) => it.name
    },
    'class': {
        root: () => `<div class="f" data-bind-class="{ on: on }">${ID}</div>`,
        child: () => `<div><span class="f" data-bind-class="{ on: on }"></span>${ID}</div>`,
        read: (el, row) => [idOf(row), !!el && el.classList.contains('on')],
        want: (it) => [it.id, !!it.on]
    },
    'attribute': {
        root: () => `<div class="f" data-bind-attr="{ title: name }">${ID}</div>`,
        child: () => `<div><span class="f" data-bind-attr="{ title: name }"></span>${ID}</div>`,
        read: (el, row) => [idOf(row), el ? el.getAttribute('title') : null],
        want: (it) => [it.id, it.name]
    },
    'show': {
        root: () => `<div class="f" data-show="visible">${ID}</div>`,
        child: () => `<div><span class="f" data-show="visible">x</span>${ID}</div>`,
        read: (el, row) => [idOf(row), !!el && getComputedStyle(el).display !== 'none'],
        want: (it) => [it.id, !!it.visible]
    },
    'render': {
        // data-render on a row's root element is not supported (WF-517).
        root: null,
        child: () => `<div><span class="f" data-render="visible">x</span>${ID}</div>`,
        read: (el, row) => [idOf(row), !!el],
        want: (it) => [it.id, !!it.visible]
    },
    'item-level computed': {
        computed: { shout(it) { return it.name + '!' } },
        root: () => '<div class="f" data-bind="shout"></div>',
        child: () => '<div><span class="f" data-bind="shout"></span></div>',
        read: (el) => text(el),
        want: (it) => it.name + '!'
    },
    'position (index, first, last, length) as text': {
        computed: { place(it, index, info) { return index + '/' + info.length + (info.first ? 'F' : '') + (info.last ? 'L' : '') } },
        root: () => '<div class="f" data-bind="place"></div>',
        child: () => `<div><span class="f" data-bind="place"></span>${ID}</div>`,
        read: (el) => text(el),
        want: (it, index, list) => place(index, list.length)
    },
    'position (last) as a class': {
        computed: { isLast(it, index, info) { return info.last } },
        root: () => `<div class="f" data-bind-class="{ last: isLast }">${ID}</div>`,
        child: () => `<div><span class="f" data-bind-class="{ last: isLast }"></span>${ID}</div>`,
        read: (el, row) => [idOf(row), !!el && el.classList.contains('last')],
        want: (it, index, list) => [it.id, index === list.length - 1]
    },
    'position through an item-level computed, as show': {
        computed: { isLast(it, index, info) { return info.last } },
        root: () => `<div class="f" data-show="isLast">${ID}</div>`,
        child: () => `<div><span class="f" data-show="isLast">x</span>${ID}</div>`,
        read: (el, row) => [idOf(row), !!el && getComputedStyle(el).display !== 'none'],
        want: (it, index, list) => [it.id, index === list.length - 1]
    },
    'position written inline (_index, _length), as text': {
        root: () => `<div class="f" data-bind="_index + '/' + _length"></div>`,
        child: () => `<div><span class="f" data-bind="_index + '/' + _length"></span>${ID}</div>`,
        read: (el) => text(el),
        want: (it, index, list) => index + '/' + list.length
    },
    'position written inline (_first, _last), as a class': {
        root: () => `<div class="f" data-bind-class="{ first: _first, last: _last }">${ID}</div>`,
        child: () => `<div><span class="f" data-bind-class="{ first: _first, last: _last }"></span>${ID}</div>`,
        read: (el, row) => [idOf(row), !!el && el.classList.contains('first'), !!el && el.classList.contains('last')],
        want: (it, index, list) => [it.id, index === 0, index === list.length - 1]
    },
    'position written inline (_index), as an attribute': {
        root: () => `<div class="f" data-bind-attr="{ title: 'row ' + _index }">${ID}</div>`,
        child: () => `<div><span class="f" data-bind-attr="{ title: 'row ' + _index }"></span>${ID}</div>`,
        read: (el, row) => [idOf(row), el ? el.getAttribute('title') : null],
        want: (it, index) => [it.id, 'row ' + index]
    },
    'style': {
        root: () => `<div class="f" data-bind-style="{ opacity: on ? '1' : '0.5' }">${ID}</div>`,
        child: () => `<div><span class="f" data-bind-style="{ opacity: on ? '1' : '0.5' }">x</span>${ID}</div>`,
        read: (el, row) => [idOf(row), el ? el.style.opacity : null],
        want: (it) => [it.id, it.on ? '1' : '0.5']
    },
    'model (checkbox)': {
        root: () => '<input class="f" type="checkbox" data-model="on">',
        child: () => `<div><input class="f" type="checkbox" data-model="on">${ID}</div>`,
        read: (el) => (el ? el.checked : null),
        want: (it) => !!it.on,
        poke: async (el, cell, target) => {
            const before = !!target.live().on
            el.click()
            await settle()
            return !!target.live().on === !before ? null : `ticking left the item at ${J(target.live().on)}`
        }
    },
    'select with fixed options, value from a model': {
        root: () => '<select class="f" data-model="choice"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select>',
        child: () => `<div><select class="f" data-model="choice"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select>${ID}</div>`,
        read: (el) => (el ? el.value : null),
        want: (it) => it.choice
    },
    'action (keydown)': {
        methods: (cell) => ({ key(event, element, details) { cell.calls.push([details && details.item && details.item.id, details && details.index, (details && details.parent && details.parent.item && details.parent.item.id) || null]) } }),
        root: () => `<div class="f" tabindex="0" data-action="keydown:key">${ID}</div>`,
        child: () => `<div><span class="f" tabindex="0" data-action="keydown:key">k</span>${ID}</div>`,
        read: (el, row) => idOf(row),
        want: (it) => it.id,
        poke: async (el, cell, target) => {
            cell.calls.length = 0
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
            await settle(20)
            const wantCalls = [[target.item.id, target.index, target.groupId]]
            return J(cell.calls) === J(wantCalls) ? null : `keydown ran the handler with ${J(cell.calls)}, wanted ${J(wantCalls)}`
        }
    },
    // Event modifiers. Each says what must NOT run the handler as well as what must.
    'modifier: data-event-self': {
        methods: (cell) => ({ pick(event, element, details) { cell.calls.push([details && details.item && details.item.id, details && details.index, (details && details.parent && details.parent.item && details.parent.item.id) || null]) } }),
        root: () => `<div class="f" data-action="pick" data-event-self>${ID}</div>`,
        child: () => `<div><span class="f" data-action="pick" data-event-self><b class="inner">x</b></span>${ID}</div>`,
        read: (el, row) => idOf(row),
        want: (it) => it.id,
        poke: async (el, cell, target) => {
            cell.calls.length = 0
            const inner = el.querySelector('.inner') || el.querySelector('.id')
            inner.click()
            await settle(20)
            if (cell.calls.length) return `a click on a descendant ran the handler (${J(cell.calls)})`
            el.click()
            await settle(20)
            const wantCalls = [[target.item.id, target.index, target.groupId]]
            return J(cell.calls) === J(wantCalls) ? null : `a click on the element ran the handler with ${J(cell.calls)}, wanted ${J(wantCalls)}`
        }
    },
    'modifier: data-event-stop': {
        methods: (cell) => ({
            pick(event, element, details) { cell.calls.push(['pick', details && details.item && details.item.id, details && details.index]) },
            rowPick(event, element, details) { cell.calls.push(['rowPick', details && details.item && details.item.id, details && details.index]) }
        }),
        root: null,
        child: () => `<div data-action="rowPick"><button class="f" data-action="pick" data-event-stop>go</button>${ID}</div>`,
        read: (el, row) => idOf(row),
        want: (it) => it.id,
        poke: async (el, cell, target) => {
            cell.calls.length = 0
            el.click()
            await settle(20)
            const wantCalls = [['pick', target.item.id, target.index]]
            return J(cell.calls) === J(wantCalls) ? null : `click ran ${J(cell.calls)}, wanted ${J(wantCalls)}`
        }
    },
    'modifier: data-event-prevent': {
        methods: (cell) => ({ pick(event, element, details) { cell.calls.push([details && details.item && details.item.id, details && details.index, event.defaultPrevented]) } }),
        root: () => `<a class="f" href="#sweep" data-action="pick" data-event-prevent>${ID}</a>`,
        child: () => `<div><a class="f" href="#sweep" data-action="pick" data-event-prevent>go</a>${ID}</div>`,
        read: (el, row) => idOf(row),
        want: (it) => it.id,
        poke: async (el, cell, target) => {
            cell.calls.length = 0
            const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
            el.dispatchEvent(ev)
            await settle(20)
            const wantCalls = [[target.item.id, target.index, true]]
            if (J(cell.calls) !== J(wantCalls)) return `click ran the handler with ${J(cell.calls)}, wanted ${J(wantCalls)}`
            return ev.defaultPrevented ? null : 'the default action was not prevented'
        }
    },
    'modifier: data-event-key-enter': {
        methods: (cell) => ({ key(event, element, details) { cell.calls.push([details && details.item && details.item.id, details && details.index, event.key]) } }),
        root: () => `<div class="f" tabindex="0" data-action="keydown:key" data-event-key-enter>${ID}</div>`,
        child: () => `<div><span class="f" tabindex="0" data-action="keydown:key" data-event-key-enter>k</span>${ID}</div>`,
        read: (el, row) => idOf(row),
        want: (it) => it.id,
        poke: async (el, cell, target) => {
            cell.calls.length = 0
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
            await settle(20)
            if (cell.calls.length) return `another key ran the handler (${J(cell.calls)})`
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
            await settle(20)
            const wantCalls = [[target.item.id, target.index, 'Enter']]
            return J(cell.calls) === J(wantCalls) ? null : `Enter ran the handler with ${J(cell.calls)}, wanted ${J(wantCalls)}`
        }
    },
    'modifier: data-event-debounce': {
        methods: (cell) => ({ pick(event, element, details) { cell.calls.push([details && details.item && details.item.id, details && details.index]) } }),
        root: () => `<div class="f" data-action="pick" data-event-debounce="40">${ID}</div>`,
        child: () => `<div><button class="f" data-action="pick" data-event-debounce="40">go</button>${ID}</div>`,
        read: (el, row) => idOf(row),
        want: (it) => it.id,
        poke: async (el, cell, target) => {
            cell.calls.length = 0
            el.click(); el.click(); el.click()
            await settle(140)
            const wantCalls = [[target.item.id, target.index]]
            return J(cell.calls) === J(wantCalls) ? null : `three quick clicks ran the handler with ${J(cell.calls)}, wanted ${J(wantCalls)}`
        }
    },
    'modifier: focus action': {
        methods: (cell) => ({ pick(event, element, details) { cell.calls.push([details && details.item && details.item.id, details && details.index]) } }),
        root: () => '<input class="f" data-action="focus:pick">',
        child: () => `<div><input class="f" data-action="focus:pick">${ID}</div>`,
        read: (el) => (el ? el.tagName : null),
        want: () => 'INPUT',
        poke: async (el, cell, target) => {
            cell.calls.length = 0
            el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
            await settle(20)
            const wantCalls = [[target.item.id, target.index]]
            return J(cell.calls) === J(wantCalls) ? null : `focus ran the handler with ${J(cell.calls)}, wanted ${J(wantCalls)}`
        }
    },
    'model (text input)': {
        root: () => '<input class="f" data-model="name">',
        child: () => `<div><input class="f" data-model="name">${ID}</div>`,
        read: (el) => (el ? el.value : null),
        want: (it) => it.name,
        // Typing into the row writes that row's item.
        poke: async (el, cell, target) => {
            const typed = 'typed-' + target.item.id + '-' + (cell.seq++)
            el.value = typed
            el.dispatchEvent(new Event('input', { bubbles: true }))
            await settle()
            return target.live().name === typed ? null : `typing wrote ${J(target.live().name)}, not ${J(typed)}`
        }
    },
    'select (options from a list, value from a model)': {
        root: () => `<select class="f" data-list="options" data-key="id" data-model="choice">${OPTIONS}</select>`,
        child: () => `<div><select class="f" data-list="options" data-key="id" data-model="choice">${OPTIONS}</select>${ID}</div>`,
        read: (el) => (el ? [el.options.length, el.value] : null),
        want: (it) => [it.options ? it.options.length : 0, it.options && it.options.length ? it.choice : ''],
        poke: async (el, cell, target) => {
            const next = { x: 'y', y: 'z', z: 'x' }[target.live().choice]
            el.value = next
            el.dispatchEvent(new Event('change', { bubbles: true }))
            await settle()
            return target.live().choice === next ? null : `choosing wrote ${J(target.live().choice)}, not ${J(next)}`
        }
    },
    'select, options arrive later': {
        late: 'options',
        root: () => `<select class="f" data-list="options" data-key="id" data-model="choice">${OPTIONS}</select>`,
        child: () => `<div><select class="f" data-list="options" data-key="id" data-model="choice">${OPTIONS}</select>${ID}</div>`,
        read: (el) => (el ? [el.options.length, el.value] : null),
        want: (it) => [it.options ? it.options.length : 0, it.options && it.options.length ? it.choice : '']
    },
    'action (click)': {
        methods: (cell) => ({ pick(event, element, details) { cell.calls.push([details && details.item && details.item.id, details && details.index, (details && details.parent && details.parent.item && details.parent.item.id) || null]) } }),
        root: () => `<div class="f" data-action="pick">${ID}</div>`,
        child: () => `<div><button class="f" data-action="pick">go</button>${ID}</div>`,
        read: (el, row) => idOf(row),
        want: (it) => it.id,
        poke: async (el, cell, target) => {
            cell.calls.length = 0
            el.click()
            await settle(20)
            const wantCalls = [[target.item.id, target.index, target.groupId]]
            return J(cell.calls) === J(wantCalls) ? null : `click ran the handler with ${J(cell.calls)}, wanted ${J(wantCalls)}`
        }
    },
    'form (submit)': {
        methods: (cell) => ({ save(event, element, details) { cell.calls.push([details && details.item && details.item.id, details && details.index, (details && details.parent && details.parent.item && details.parent.item.id) || null]) } }),
        root: () => `<form class="f" data-action="save">${ID}</form>`,
        child: () => `<div><form class="f" data-action="save"><button type="submit">go</button></form>${ID}</div>`,
        read: (el, row) => idOf(row),
        want: (it) => it.id,
        poke: async (el, cell, target) => {
            cell.calls.length = 0
            el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            await settle(20)
            const wantCalls = [[target.item.id, target.index, target.groupId]]
            return J(cell.calls) === J(wantCalls) ? null : `submit ran the handler with ${J(cell.calls)}, wanted ${J(wantCalls)}`
        }
    },
    'child component given the row as a prop': {
        kid: (c) => ({ name: c + '-kid', def: { props: { it: { type: 'object' } }, computed: { label() { return this.props.it ? this.props.it.name : 'no-prop' } } } }),
        root: (c) => `<i class="f" data-component="${c}-kid" data-prop-it="."><b data-bind="label"></b></i>`,
        child: (c) => `<div><i class="f" data-component="${c}-kid" data-prop-it="."><b data-bind="label"></b></i>${ID}</div>`,
        read: (el) => (el ? text(el.querySelector('b')) : null),
        want: (it) => it.name
    },
    'list inside the row': {
        root: () => `<div class="f" data-list="tags" data-key="id">${TAGS}</div>`,
        child: () => `<div><span class="f" data-list="tags" data-key="id">${TAGS}</span>${ID}</div>`,
        read: (el) => (el ? [...el.querySelectorAll(':scope > b')].map(text) : null),
        want: (it) => (it.tags || []).map((t) => t.t)
    },
    'list inside the row, array arrives later': {
        late: 'tags',
        root: () => `<div class="f" data-list="tags" data-key="id">${TAGS}</div>`,
        child: () => `<div><span class="f" data-list="tags" data-key="id">${TAGS}</span>${ID}</div>`,
        read: (el) => (el ? [...el.querySelectorAll(':scope > b')].map(text) : null),
        want: (it) => (it.tags || []).map((t) => t.t)
    }
}

const ROW_COUNTS = getDistMode() === 'full-dev' ? [2, 12] : [2]

describeIfLists('list composition sweep', () => {
    let host, wildflower, errors
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        host = document.createElement('div')
        document.body.appendChild(host)
        errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => { errors.mockRestore(); host.remove() })

    let cellNo = 0
    for (const [fname, F] of Object.entries(FEATURES)) {
        for (const [pname, P] of Object.entries(POSITIONS)) {
            if (!F[P.form]) continue
            for (const n of ROW_COUNTS) {
                const c = 'sw' + (++cellNo)
                it(`${c}: ${fname} / ${pname} / ${n} rows`, async () => {
                    const cell = { calls: [], seq: 0 }
                    let next = 0
                    const mk = (late) => {
                        const i = next++
                        const item = {
                            id: 'i' + i, name: 'n' + i, on: i % 2 === 0, visible: i % 3 !== 1, choice: ['x', 'y', 'z'][i % 3],
                            options: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }, { id: 'z', name: 'Z' }],
                            tags: [{ id: 't' + i + 'a', t: 'A' + i }, { id: 't' + i + 'b', t: 'B' + i }]
                        }
                        // The late variants start every other item without its array.
                        if (late && i % 2 === 0) delete item[late]
                        return item
                    }
                    const many = () => Array.from({ length: n }, () => mk(F.late))
                    const state = P.nested
                        ? { showNote: false, groups: Array.from({ length: n }, (_, g) => ({ id: 'g' + g, items: many() })) }
                        : { showNote: false, items: many() }

                    if (F.kid) { const k = F.kid(c); wildflower.component(k.name, k.def) }
                    const def = { state }
                    if (F.computed) def.computed = F.computed
                    Object.assign(def, F.methods ? F.methods(cell) : {})
                    wildflower.component(c, def)
                    host.innerHTML = `<div data-component="${c}"><p class="note" data-render="showNote">note</p>${P.wrap(F[P.form](c))}</div>`
                    wildflower.scan()
                    await settle()

                    const ctx = wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context
                    const owner = () => (P.nested ? ctx.groups[0] : ctx)   // holds the list the operations act on
                    const list = () => owner().items
                    const plain = (v) => JSON.parse(JSON.stringify(v))
                    const lists = () => (P.nested ? plain(ctx.groups).map((g) => g.items) : [plain(ctx.items)])
                    const rowsOf = (L) => [...L.children].filter((e) => e.tagName !== 'TEMPLATE')
                    const featureOf = (row) => (P.form === 'root' ? row : row.querySelector('.f'))

                    const faults = []
                    const check = (step) => {
                        const want = lists().map((items) => items.map((item, i, all) => F.want(item, i, all)))
                        const got = [...host.querySelectorAll('.L')].map((L) => rowsOf(L).map((row) => F.read(featureOf(row), row)))
                        if (J(want) === J(got)) return
                        if (want.length !== got.length) { faults.push(`${step}: ${got.length} lists rendered, wanted ${want.length}`); return }
                        for (let g = 0; g < want.length; g++) {
                            if (J(want[g]) === J(got[g])) continue
                            if (want[g].length !== got[g].length) { faults.push(`${step}: list ${g} has ${got[g].length} rows, wanted ${want[g].length}`); return }
                            const r = want[g].findIndex((w, i) => J(w) !== J(got[g][i]))
                            const others = want[g].filter((w, i) => J(w) !== J(got[g][i])).length - 1
                            faults.push(`${step}: list ${g} row ${r} shows ${J(got[g][r])}, wanted ${J(want[g][r])}` + (others > 0 ? ` (and ${others} more rows in this list)` : ''))
                            return
                        }
                    }
                    // Use the feature on a few rows: first and last of the list
                    // the operations act on, and the first row of the next list.
                    const poke = async (step) => {
                        if (!F.poke) return
                        const Ls = [...host.querySelectorAll('.L')]
                        const targets = [[0, 0], [0, list().length - 1]]
                        if (P.nested && Ls.length > 1) targets.push([1, 0])
                        for (const [g, i] of targets) {
                            const L = Ls[g]
                            const row = L && rowsOf(L)[i]
                            const el = row && featureOf(row)
                            if (!el) { faults.push(`${step}: no feature element to use in list ${g} row ${i}`); continue }
                            const src = () => (P.nested ? ctx.groups[g].items : ctx.items)
                            const target = { item: plain(src()[i]), index: i, groupId: P.nested ? ctx.groups[g].id : null, live: () => src()[i] }
                            const fault = await F.poke(el, cell, target)
                            if (fault) faults.push(`${step}: list ${g} row ${i}: ${fault}`)
                        }
                        check(step + ', after using it')
                    }
                    const edit = (item) => {
                        item.name = item.name + 'e'
                        item.on = !item.on
                        item.visible = !item.visible
                        item.choice = { x: 'y', y: 'z', z: 'x' }[item.choice]
                        if (item.tags) { item.tags.push({ id: 'te' + (cell.seq++), t: 'E' + cell.seq }); item.tags[0].t = item.tags[0].t + 'e' }
                    }
                    const ends = () => { edit(list()[0]); if (list().length > 1) edit(list()[list().length - 1]) }

                    const steps = [
                        ['first render', null, true],
                        F.late && ['the missing arrays arrive', () => {
                            const fill = (items) => items.forEach((item) => { if (!item[F.late]) item[F.late] = mk()[F.late] })
                            if (P.nested) ctx.groups.forEach((g) => fill(g.items)); else fill(ctx.items)
                        }, false],
                        ['edit the first and last rows', ends, false],
                        ['push a row', () => list().push(mk()), true],
                        ['edit the pushed row', () => edit(list()[list().length - 1]), false],
                        ['insert a row at the front', () => list().unshift(mk()), false],
                        ['reverse', () => list().reverse(), true],
                        ['remove the first row', () => list().splice(0, 1), false],
                        ['remove the last row', () => list().pop(), false],
                        ['push two rows', () => list().push(mk(), mk()), false],
                        ['remove a middle row', () => list().splice(1, 1), false],
                        ['swap the first and last rows', () => { const a = list(); const last = a.length - 1; const t = a[0]; a[0] = a[last]; a[last] = t }, false],
                        ['replace the array with new objects, same keys', () => { owner().items = plain(list()).map((item) => ({ ...item, name: item.name + 'r' })) }, true],
                        ['a data-render elsewhere in the component turns on', () => { ctx.showNote = true }, true],
                        ['edit the first and last rows again', ends, false]
                    ].filter(Boolean)

                    for (const [step, run, use] of steps) {
                        try {
                            if (run) { run(); await settle() }
                            check(step)
                            if (use) await poke(step)
                        } catch (e) {
                            faults.push(`${step}: threw ${e && e.message}`)
                        }
                    }
                    if (errors.mock.calls.length) {
                        faults.push(`console.error x${errors.mock.calls.length}: ${String(errors.mock.calls[0].map(String).join(' ')).slice(0, 160)}`)
                    }
                    // One machine-readable line per failing cell, for the
                    // fault-list script (the runner merges identical failures).
                    if (faults.length) console.warn('[SWEEP] ' + J({ cell: c, feature: fname, pos: pname, n, faults }))
                    expect(faults).toEqual([])
                })
            }
        }
    }
})
