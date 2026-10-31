/**
 * A row's position (index, first, last, list length) stays right when rows
 * are added, removed or moved, in every kind of binding that reads it.
 *
 * Position reaches a row two ways: the inline tokens (_index, _first, _last,
 * _length) and an item-level computed that takes (item, index, info). After a
 * change to the list, the rows whose position moved have to be repainted, and
 * which bindings were repainted depended on the kind of binding, on how
 * position was read, on the operation and on where the list's data came from:
 * a class with an inline token followed every change, a child's attribute
 * with the same token did not, and a computed's text was right after a
 * removal and wrong after a single push.
 *
 * So this is a grid. Every kind of binding, the same sequence of operations,
 * and after each one every row is checked against its place in the list.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms))
const text = (el) => (el ? (el.textContent || '').trim() : null)
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('list rows: position stays right in every binding', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    const ID = '<i class="id" data-bind="id"></i>'
    const computed = {
        place(it, index, info) { return index + '/' + info.length + (info.first ? 'F' : '') + (info.last ? 'L' : '') },
        isLast(it, index, info) { return info.last },
        posAttr(it, index) { return { title: 'row ' + index } }
    }
    const place = (i, n) => i + '/' + n + (i === 0 ? 'F' : '') + (i === n - 1 ? 'L' : '')

    // Each kind: a row template, how to read the row, and what a row at
    // index i of n should read as.
    const KINDS = {
        'inline tokens as text': {
            row: `<div><b class="f" data-bind="_index + '/' + _length"></b>${ID}</div>`,
            read: (row) => text(row.querySelector('.f')),
            want: (i, n) => i + '/' + n
        },
        'a bare inline token as text': {
            row: `<div><b class="f" data-bind="_index"></b>${ID}</div>`,
            read: (row) => text(row.querySelector('.f')),
            want: (i) => String(i)
        },
        'inline tokens as a class on a child': {
            row: `<div><b class="f" data-bind-class="{ first: _first, last: _last }"></b>${ID}</div>`,
            read: (row) => [row.querySelector('.f').classList.contains('first'), row.querySelector('.f').classList.contains('last')],
            want: (i, n) => [i === 0, i === n - 1]
        },
        'inline tokens as a class on the row': {
            row: `<div class="f" data-bind-class="{ first: _first, last: _last }">${ID}</div>`,
            read: (row) => [row.classList.contains('first'), row.classList.contains('last')],
            want: (i, n) => [i === 0, i === n - 1]
        },
        'an inline token in a child\'s attribute': {
            row: `<div><b class="f" data-bind-attr="{ title: 'row ' + _index }"></b>${ID}</div>`,
            read: (row) => row.querySelector('.f').getAttribute('title'),
            want: (i) => 'row ' + i
        },
        'an inline token in the row\'s attribute': {
            row: `<div class="f" data-bind-attr="{ title: 'row ' + _index }">${ID}</div>`,
            read: (row) => row.getAttribute('title'),
            want: (i) => 'row ' + i
        },
        'an inline token in a style': {
            row: `<div><b class="f" data-bind-style="{ order: _index }">s</b>${ID}</div>`,
            read: (row) => row.querySelector('.f').style.order,
            want: (i) => String(i)
        },
        'an inline token in html': {
            row: `<div><b class="f" data-bind-html="'#' + _index"></b>${ID}</div>`,
            read: (row) => text(row.querySelector('.f')),
            want: (i) => '#' + i
        },
        'an inline token in data-show': {
            row: `<div><b class="f" data-show="_last">x</b>${ID}</div>`,
            read: (row) => getComputedStyle(row.querySelector('.f')).display !== 'none',
            want: (i, n) => i === n - 1
        },
        'an inline token in a compound data-render': {
            row: `<div><b class="f" data-render="_index > 0">x</b>${ID}</div>`,
            read: (row) => !!row.querySelector('.f'),
            want: (i) => i > 0
        },
        'a computed as text': {
            row: `<div><b class="f" data-bind="place"></b>${ID}</div>`,
            read: (row) => text(row.querySelector('.f')),
            want: (i, n) => place(i, n)
        },
        'a computed as text on the row': {
            row: `<div class="f" data-bind="place"></div>`,
            read: (row) => text(row),
            want: (i, n) => place(i, n),
            noId: true
        },
        'a computed as a class': {
            row: `<div><b class="f" data-bind-class="{ last: isLast }"></b>${ID}</div>`,
            read: (row) => row.querySelector('.f').classList.contains('last'),
            want: (i, n) => i === n - 1
        },
        'a computed in data-show': {
            row: `<div><b class="f" data-show="isLast">x</b>${ID}</div>`,
            read: (row) => getComputedStyle(row.querySelector('.f')).display !== 'none',
            want: (i, n) => i === n - 1
        }
    }

    const items = (k) => Array.from({ length: k }, (_, i) => ({ id: 'i' + i }))
    let fresh = 0
    const newItem = () => ({ id: 'n' + (++fresh) })

    // The same operations for every kind. Each works on the list's own array.
    const OPS = [
        ['push one', (a) => { a.push(newItem()) }],
        ['push two', (a) => { a.push(newItem(), newItem()) }],
        ['insert at the front', (a) => { a.unshift(newItem()) }],
        ['remove from the middle', (a) => { a.splice(1, 1) }],
        ['remove the last', (a) => { a.pop() }],
        ['reverse', (a) => { a.reverse() }],
        ['insert in the middle', (a) => { a.splice(2, 0, newItem()) }],
        ['remove the first', (a) => { a.shift() }]
    ]

    // Where the list's rows come from. `array` returns the array to change.
    let n = 0
    const SOURCES = {
        'component state': {
            mount: async (kind, rows) => {
                const c = 'pos' + (++n)
                wildflower.component(c, { state: { items: items(rows) }, computed })
                host.innerHTML = `<div data-component="${c}"><div class="L" data-list="items" data-key="id"><template>${kind.row}</template></div></div>`
                wildflower.scan()
                await settle(110)
                const ctx = wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context
                return () => ctx.items
            }
        },
        'a computed': {
            mount: async (kind, rows) => {
                const c = 'pos' + (++n)
                wildflower.component(c, { state: { all: items(rows) }, computed: { ...computed, visible() { return this.all.filter((x) => !x.hidden) } } })
                host.innerHTML = `<div data-component="${c}"><div class="L" data-list="visible" data-key="id"><template>${kind.row}</template></div></div>`
                wildflower.scan()
                await settle(110)
                const ctx = wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context
                return () => ctx.all
            }
        },
        'a store': {
            mount: async (kind, rows) => {
                const c = 'pos' + (++n)
                wildflower.store(c + 's', { state: { items: items(rows) } })
                wildflower.component(c, { state: {}, computed })
                host.innerHTML = `<div data-component="${c}"><div class="L" data-list="$${c}s.items" data-key="id"><template>${kind.row}</template></div></div>`
                wildflower.scan()
                await settle(110)
                return () => wildflower.getStore(c + 's').items
            }
        }
    }

    const check = (kind) => {
        const rows = [...host.querySelector('.L').children].filter((el) => el.localName !== 'template')
        const wrong = []
        rows.forEach((row, i) => {
            const got = JSON.stringify(kind.read(row))
            const want = JSON.stringify(kind.want(i, rows.length))
            if (got !== want) wrong.push(`row ${i}: ${got}, wanted ${want}`)
        })
        return { count: rows.length, wrong }
    }

    const run = async (kind, source, rows) => {
        const array = await source.mount(kind, rows)
        const failures = []
        const first = check(kind)
        if (first.count !== rows) failures.push(`first render: ${first.count} rows`)
        if (first.wrong.length) failures.push(`first render: ${first.wrong.join('; ')}`)
        for (const [label, op] of OPS) {
            const a = array()
            op(a)
            await settle()
            const after = check(kind)
            if (after.count !== array().length) failures.push(`${label}: ${after.count} rows for ${array().length} items`)
            if (after.wrong.length) failures.push(`${label}: ${after.wrong.join('; ')}`)
        }
        return failures
    }

    describe('position stays current in every binding', () => {
        const ctxOf = (c) => wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context
        const rowsOf = () => [...host.querySelector('.L').children].filter((el) => el.localName !== 'template')

        for (const src of ['a computed', 'a store']) {
            it(`P01 a class that reads a position token and a store value, on a list over ${src}`, async () => {
                const c = 'posr' + (++n)
                wildflower.store(c + 'flag', { state: { on: true } })
                wildflower.store(c + 's', { state: { items: items(4) } })
                wildflower.component(c, { state: { all: items(4) }, computed: { visible() { return this.all.filter((x) => !x.hidden) } } })
                const list = src === 'a store' ? `$${c}s.items` : 'visible'
                host.innerHTML = `<div data-component="${c}"><div class="L" data-list="${list}" data-key="id"><template><div><b class="f" data-bind-class="{ last: _last && $${c}flag.on }"></b>${ID}</div></template></div></div>`
                wildflower.scan()
                await settle(110)
                const arr = () => (src === 'a store' ? wildflower.getStore(c + 's').items : ctxOf(c).all)
                const read = () => rowsOf().map((r) => r.querySelector('.f').classList.contains('last'))
                expect(read()).toEqual([false, false, false, true])
                arr().push(newItem()); await settle()
                expect(read()).toEqual([false, false, false, false, true])
                arr().shift(); await settle()
                expect(read()).toEqual([false, false, false, true])
            })
        }

        it('P02 html that reads position: an edit to the row between two changes of position does not leave old html behind', async () => {
            const c = 'posr' + (++n)
            wildflower.component(c, { state: { items: [{ id: 'a', note: 'A' }, { id: 'b', note: '' }] } })
            host.innerHTML = `<div data-component="${c}"><div class="L" data-list="items" data-key="id"><template><div><b class="f" data-bind-html="_first ? '' : note"></b>${ID}</div></template></div></div>`
            wildflower.scan()
            await settle(110)
            const ctx = ctxOf(c)
            const read = () => rowsOf().map((r) => r.querySelector('.f').innerHTML)
            expect(read()).toEqual(['', ''])
            ctx.items.push({ id: 'c', note: 'C' }); await settle()
            ctx.items[1].note = '<i>hi</i>'; await settle()
            expect(read()).toEqual(['', '<i>hi</i>', 'C'])
            ctx.items.shift(); await settle()
            expect(read()).toEqual(['', 'C'])
        })

        it('P03 a field edit after the list grew repaints the row with the current length (a list over a computed)', async () => {
            const c = 'posr' + (++n)
            wildflower.component(c, { state: { all: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }, computed: { visible() { return this.all.filter((x) => !x.hidden) } } })
            host.innerHTML = `<div data-component="${c}"><div class="L" data-list="visible" data-key="id"><template><div><b class="f" data-bind="_last ? 'end' : name"></b></div></template></div></div>`
            wildflower.scan()
            await settle(110)
            const ctx = ctxOf(c)
            const read = () => rowsOf().map((r) => text(r.querySelector('.f')))
            expect(read()).toEqual(['A', 'end'])
            ctx.all.push({ id: 'c', name: 'C' }); await settle()
            expect(read()).toEqual(['A', 'B', 'end'])
            ctx.all[1].name = 'B2'; await settle()
            expect(read()).toEqual(['A', 'B2', 'end'])
            ctx.all[2].name = 'C2'; await settle()
            expect(read()).toEqual(['A', 'B2', 'end'])
        })

        it('P04 a computed that declares its index with a default value, or takes the rest, is kept current', async () => {
            const c = 'posr' + (++n)
            wildflower.component(c, {
                state: { items: items(3) },
                computed: {
                    withDefault(it, index = 0, info = {}) { return index + '/' + info.length },
                    withRest(it, ...rest) { return String(rest[0]) },
                    withComment(
                        // the row's item
                        it,
                        index = 0) { return String(index) },
                    withBlock(it /* ( */, index = 0) { return String(index) },
                    withRegex({ id = /\{/.source }, index = 0) { return String(index) }
                }
            })
            host.innerHTML = `<div data-component="${c}"><div class="L" data-list="items" data-key="id"><template><div><b class="d" data-bind="withDefault"></b><b class="r" data-bind="withRest"></b><b class="c" data-bind="withComment"></b><b class="k" data-bind="withBlock"></b><b class="x" data-bind="withRegex"></b></div></template></div></div>`
            wildflower.scan()
            await settle(110)
            const ctx = ctxOf(c)
            const read = () => rowsOf().map((r) => [text(r.querySelector('.d')), text(r.querySelector('.r'))])
            const others = () => rowsOf().map((r) => [text(r.querySelector('.c')), text(r.querySelector('.k')), text(r.querySelector('.x'))].join(','))
            ctx.items.unshift(newItem()); await settle()
            expect(read()).toEqual([['0/4', '0'], ['1/4', '1'], ['2/4', '2'], ['3/4', '3']])
            expect(others()).toEqual(['0,0,0', '1,1,1', '2,2,2', '3,3,3'])
            ctx.items.push(newItem()); await settle()
            expect(read()).toEqual([['0/5', '0'], ['1/5', '1'], ['2/5', '2'], ['3/5', '3'], ['4/5', '4']])
        })

        it('P05 a structural change on a list that reads position in a class runs only the computeds its position bindings name', async () => {
            const c = 'posr' + (++n)
            let otherCalls = 0
            wildflower.component(c, { state: { items: items(20) }, computed: { other(it) { otherCalls++; return it.id } } })
            host.innerHTML = `<div data-component="${c}"><div class="L" data-list="items" data-key="id"><template><div><b class="f" data-bind-class="{ last: _last }"></b><i data-bind="other"></i></div></template></div></div>`
            wildflower.scan()
            await settle(110)
            otherCalls = 0
            ctxOf(c).items.push(newItem()); await settle()
            // The new row's own text, and nothing for the twenty rows already there.
            expect(otherCalls).toBeLessThanOrEqual(3)
            expect(rowsOf().map((r) => r.querySelector('.f').classList.contains('last')).lastIndexOf(true)).toBe(20)
        })
    })

    // Every kind on a plain state list, under ten rows and over (the two row
    // paths), then the kinds that go through each mechanism on the other two
    // sources.
    describe('a list over component state', () => {
        for (const [label, kind] of Object.entries(KINDS)) {
            for (const rows of [4, 12]) {
                it(`${label} (${rows} rows)`, async () => {
                    expect(await run(kind, SOURCES['component state'], rows)).toEqual([])
                })
            }
        }
    })

    for (const src of ['a computed', 'a store']) {
        describe(`a list over ${src}`, () => {
            for (const label of ['inline tokens as text', 'inline tokens as a class on a child', 'an inline token in a child\'s attribute', 'a computed as text', 'a computed as a class', 'a computed in data-show']) {
                it(`${label}`, async () => {
                    expect(await run(KINDS[label], SOURCES[src], 4)).toEqual([])
                })
            }
        })
    }
})
