/**
 * A differential test of list rendering.
 *
 * Each case takes one row shape, applies a seeded run of array operations to
 * a component's list, and after every operation compares the rows in the DOM
 * with what a plain array that received the same operations says they
 * should be. The operations are the ones application code uses: push, pop,
 * shift, unshift, splice, reverse, sort, swap, move, a write to one field,
 * an entry replaced by a new object with the same key or a new key, an entry
 * set to null or undefined, the whole array replaced by copies, a filter, a
 * truncation, and a clear.
 *
 * The plain array and the component's array never share an object: every
 * item is copied on its way into each, so a row that goes wrong cannot hide
 * behind a shared reference.
 *
 * A failure prints the shape, the seed, the step, and the operations up to
 * that step, which is enough to replay it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, whenSettled } from './helpers/load-framework.js'

const describeIfLists = hasFeature('lists') ? describe : describe.skip
let seq = 0

// mulberry32: a small seeded generator, so a run can be replayed.
function generator(seed) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const copy = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)))
const WORDS = ['ash', 'birch', 'cedar', 'elm', 'fir', 'hazel', 'larch', 'oak', 'pine', 'rowan', 'yew']

/**
 * Chooses the next operation from the plain array's current contents. The
 * result is data only, so the same operation can be applied to the plain
 * array and to the component's array.
 */
function nextOperation(model, random, shape, fresh) {
    const length = model.length
    const at = () => Math.floor(random() * length)
    const live = model.map((item, i) => (item == null ? -1 : i)).filter(i => i >= 0)
    const liveAt = () => live[Math.floor(random() * live.length)]
    const word = () => WORDS[Math.floor(random() * WORDS.length)] + Math.floor(random() * 90)

    const choices = ['push', 'push', 'unshift', 'insert']
    if (length) choices.push('pop', 'shift', 'remove', 'replaceAll', 'filter', 'toNull', 'toUndefined', 'newEntry')
    if (length > 1) choices.push('reverse', 'swap', 'move', 'truncate', 'spliceMany')
    if (length > 1 && shape.sortable) choices.push('sort')
    if (live.length && shape.fields) choices.push('write', 'write', 'sameKey', 'sameKey')
    if (live.length && shape.toggles) choices.push('toggle')
    if (live.length && shape.kids) choices.push('kidPush', 'kidRemove')
    if (live.length && shape.kinds) choices.push('otherKind', 'otherKind', 'sameKeyOtherKind', 'sameKeyOtherKind')
    if (random() < 0.04) choices.push('clear')

    const kind = choices[Math.floor(random() * choices.length)]
    switch (kind) {
        case 'push': return { kind, item: fresh() }
        case 'unshift': return { kind, item: fresh() }
        case 'insert': return { kind, index: Math.floor(random() * (length + 1)), item: fresh() }
        case 'pop': case 'shift': case 'reverse': case 'sort': case 'clear': return { kind }
        case 'remove': return { kind, index: at() }
        case 'spliceMany': {
            const index = at()
            return { kind, index, remove: 1 + Math.floor(random() * 3), items: [fresh(), fresh()].slice(0, Math.floor(random() * 3)) }
        }
        case 'swap': return { kind, a: at(), b: at() }
        case 'move': return { kind, from: at(), to: at() }
        case 'truncate': return { kind, length: Math.floor(random() * length) }
        case 'filter': return { kind, keepEvery: 2 + Math.floor(random() * 2) }
        case 'replaceAll': return { kind, changed: live.length ? liveAt() : -1, text: word() }
        case 'toNull': return { kind, index: at() }
        case 'toUndefined': return { kind, index: at() }
        case 'newEntry': return { kind, index: at(), item: fresh() }
        case 'write': return { kind, index: liveAt(), text: word() }
        case 'sameKey': return { kind, index: liveAt(), text: word() }
        case 'toggle': return { kind, index: liveAt() }
        case 'kidPush': return { kind, index: liveAt(), kid: { id: 'k' + Math.floor(random() * 1e6), label: word() } }
        case 'kidRemove': return { kind, index: liveAt() }
        case 'otherKind': return { kind, index: liveAt() }
        case 'sameKeyOtherKind': return { kind, index: liveAt() }
    }
}

/**
 * Applies one operation. `read()` returns the array to change in place and
 * `write(array)` replaces it; for the plain array both act on a variable,
 * for the component they act on its state.
 */
function apply(operation, read, write, shape) {
    const list = read()
    const o = operation
    const relabel = (item, text) => (shape.fields ? { ...item, label: text } : text)
    switch (o.kind) {
        case 'push': list.push(copy(o.item)); break
        case 'unshift': list.unshift(copy(o.item)); break
        case 'insert': list.splice(o.index, 0, copy(o.item)); break
        case 'pop': list.pop(); break
        case 'shift': list.shift(); break
        case 'remove': list.splice(o.index, 1); break
        case 'spliceMany': list.splice(o.index, o.remove, ...o.items.map(copy)); break
        case 'reverse': list.reverse(); break
        case 'sort': list.sort((x, y) => String(x == null ? '' : x.label).localeCompare(String(y == null ? '' : y.label)) || String(x == null ? '' : x.id).localeCompare(String(y == null ? '' : y.id))); break
        case 'swap': { const held = list[o.a]; list[o.a] = list[o.b]; list[o.b] = held; break }
        case 'move': { const [held] = list.splice(o.from, 1); list.splice(o.to, 0, held); break }
        case 'truncate': list.length = o.length; break
        case 'clear': write([]); break
        case 'filter': write(list.filter((item, i) => i % o.keepEvery !== 0)); break
        case 'replaceAll': write(list.map((item, i) => (item == null ? item : i === o.changed ? relabel(copy(item), o.text) : copy(item)))); break
        case 'toNull': list[o.index] = null; break
        case 'toUndefined': list[o.index] = undefined; break
        case 'newEntry': list[o.index] = copy(o.item); break
        case 'write': if (shape.fields) list[o.index].label = o.text; break
        case 'sameKey': list[o.index] = relabel(copy(list[o.index]), o.text); break
        case 'toggle': list[o.index].on = !list[o.index].on; break
        case 'kidPush': list[o.index].kids.push(copy(o.kid)); break
        case 'kidRemove': list[o.index].kids.shift(); break
        case 'otherKind': list[o.index].kind = list[o.index].kind === 'a' ? 'b' : 'a'; break
        case 'sameKeyOtherKind': { const item = copy(list[o.index]); item.kind = item.kind === 'a' ? 'b' : 'a'; list[o.index] = item; break }
    }
}

// The row shapes. `expected(item)` is what one entry should show, in the
// same form `shown(row)` reads back from a rendered row.
const text = (el) => (el ? el.textContent : '(missing)')
const SHAPES = {
    'keyed rows, text': {
        fields: true, sortable: true,
        html: (list) => `<ul data-list="${list}" data-key="id"><template><li class="row" data-bind="label"></li></template></ul>`,
        expected: (item) => (item == null ? '' : item.label),
        shown: (row) => row.textContent
    },
    'rows with no key, text': {
        fields: true, sortable: true,
        html: (list) => `<ul data-list="${list}"><template><li class="row" data-bind="label"></li></template></ul>`,
        expected: (item) => (item == null ? '' : item.label),
        shown: (row) => row.textContent
    },
    'primitives': {
        fields: false,
        fresh: (random) => (random() < 0.5 ? Math.floor(random() * 1000) : WORDS[Math.floor(random() * WORDS.length)]),
        html: (list) => `<ul data-list="${list}"><template><li class="row" data-bind="$item"></li></template></ul>`,
        expected: (item) => (item == null ? '' : String(item)),
        shown: (row) => row.textContent
    },
    'keyed rows, text, attribute, class and data-show': {
        fields: true, sortable: true, toggles: true,
        html: (list) => `<ul data-list="${list}" data-key="id"><template><li class="row" data-bind-attr="{ title: label }" data-bind-class="{ on: on }"><b data-bind="label"></b><i data-show="on">!</i></li></template></ul>`,
        expected: (item) => (item == null ? '||off|hidden' : `${item.label}|${item.label}|${item.on ? 'on' : 'off'}|${item.on ? 'shown' : 'hidden'}`),
        shown: (row) => `${text(row.querySelector('b'))}|${row.getAttribute('title') || ''}|${row.classList.contains('on') ? 'on' : 'off'}|${row.querySelector('i') && row.querySelector('i').style.display === 'none' ? 'hidden' : 'shown'}`
    },
    'keyed rows, a computed that takes the item': {
        fields: true, sortable: true,
        definition: { computed: { shout(item) { return item && item.label ? item.label.toUpperCase() + '!' : '' } } },
        html: (list) => `<ul data-list="${list}" data-key="id"><template><li class="row" data-bind="shout"></li></template></ul>`,
        expected: (item) => (item == null ? '' : item.label.toUpperCase() + '!'),
        shown: (row) => row.textContent
    },
    'keyed rows, each with a nested list': {
        fields: true, sortable: true, kids: true,
        html: (list) => `<ul data-list="${list}" data-key="id"><template><li class="row"><b data-bind="label"></b><ul data-list="kids" data-key="id"><template><li class="kid" data-bind="label"></li></template></ul></li></template></ul>`,
        expected: (item) => (item == null ? '[]' : `${item.label}[${item.kids.map(kid => kid.label).join(',')}]`),
        shown: (row) => `${text(row.querySelector('b'))}[${[...row.querySelectorAll('.kid')].map(kid => kid.textContent).join(',')}]`
    },
    'keyed rows, each holding a component that reads listItem': {
        fields: true, sortable: true, cell: true,
        html: (list, cell) => `<ul data-list="${list}" data-key="id"><template><li class="row"><span data-component="${cell}"><b data-bind="mine"></b></span></li></template></ul>`,
        expected: (item) => (item == null ? '' : item.label),
        shown: (row) => text(row.querySelector('b'))
    },
    // The field changes two ways here: a write to it on a live entry, and a
    // new object under the same key that names the other template.
    'keyed rows, a template chosen by a field': {
        fields: true, sortable: true, kinds: true,
        html: (list) => `<ul data-list="${list}" data-key="id" data-template-key="kind"><template data-type="a"><li class="row a"><b data-bind="label"></b></li></template><template data-type="b"><li class="row b"><b data-bind="label"></b></li></template></ul>`,
        expected: (item) => `${item.kind}:${item.label}`,
        shown: (row) => `${row.classList.contains('a') ? 'a' : row.classList.contains('b') ? 'b' : '?'}:${text(row.querySelector('b'))}`,
        noEmptyEntries: true
    }
}

// Where the array lives: component state, a computed over it, or a store.
const SOURCES = ['state', 'computed', 'store']

describeIfLists('lists: the DOM against a plain array, operation by operation', () => {
    let wildflower
    let container

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        container.remove()
    })

    async function run(shapeName, source, seed, steps, startLength) {
        const shape = SHAPES[shapeName]
        const random = generator(seed)
        let nextId = 0
        const fresh = () => {
            if (shape.fresh) return shape.fresh(random)
            const item = { id: 'r' + (++nextId), label: WORDS[Math.floor(random() * WORDS.length)] + nextId }
            if (shape.toggles) item.on = random() < 0.5
            if (shape.kids) item.kids = [{ id: 'k' + nextId + 'a', label: 'kid' + nextId }].slice(0, Math.floor(random() * 2))
            if (shape.kinds) item.kind = random() < 0.5 ? 'a' : 'b'
            return item
        }

        let model = []
        for (let i = 0; i < startLength; i++) model.push(fresh())

        const name = `ld-${++seq}`
        const cell = `${name}-cell`
        const storeName = `${name}-store`
        let context
        const definition = { ...(shape.definition || {}), init() { context = this } }
        let listPath = 'items'
        let read
        let write
        if (source === 'store') {
            wildflower.store(storeName, { state: { items: model.map(copy) } })
            const store = wildflower.getStore(storeName)
            definition.state = {}
            listPath = `$${storeName}.items`
            read = () => store.items
            write = (array) => { store.items = array }
        } else {
            definition.state = { items: model.map(copy) }
            if (source === 'computed') {
                definition.computed = { ...(definition.computed || {}), view() { return this.items } }
                listPath = 'view'
            }
            read = () => context.items
            write = (array) => { context.items = array }
        }
        if (shape.cell) {
            wildflower.component(cell, { computed: { mine() { return this.listItem && this.listItem.label ? this.listItem.label : '' } } })
        }
        wildflower.component(name, definition)
        container.innerHTML = `<div data-component="${name}">${shape.html(listPath, cell)}</div>`
        wildflower.scan(container)
        await whenSettled()
        await new Promise(r => setTimeout(r, 30))

        const rows = () => [...container.querySelectorAll('.row')].map(shape.shown)
        const log = []
        const check = (step) => {
            const want = model.map(shape.expected)
            const got = rows()
            if (JSON.stringify(got) !== JSON.stringify(want)) {
                throw new Error(`${shapeName} / ${source} / seed ${seed} / step ${step}\n` +
                    `operations: ${JSON.stringify(log)}\n` +
                    `array:    ${JSON.stringify(want)}\n` +
                    `rendered: ${JSON.stringify(got)}`)
            }
        }
        check('start')

        for (let step = 0; step < steps; step++) {
            let operation = nextOperation(model, random, shape, fresh)
            // A template chosen by a field needs the field: no empty entries there.
            if (shape.noEmptyEntries && (operation.kind === 'toNull' || operation.kind === 'toUndefined')) operation = { kind: 'push', item: fresh() }
            log.push(operation)
            apply(operation, () => model, (array) => { model = array }, shape)
            apply(operation, read, write, shape)
            await whenSettled()
            check(step)
        }
        expect(rows().length).toBe(model.length)
    }

    for (const shapeName of Object.keys(SHAPES)) {
        describe(shapeName, () => {
            for (const source of SOURCES) {
                it(`${source}: a short list, 40 operations`, async () => {
                    await run(shapeName, source, 11, 40, 3)
                })
                it(`${source}: a list of 45, 40 operations`, async () => {
                    await run(shapeName, source, 29, 40, 45)
                })
            }
        })
    }
})
