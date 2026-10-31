/**
 * A list row whose root element is itself a list.
 *
 *   <tbody data-list="members">
 *     <template>
 *       <tr data-list="cells"><template><td data-bind="label"></td></template></tr>
 *     </template>
 *   </tbody>
 *
 * The <tr> is two things at once: a row of `members` and the container of
 * `cells`. A table is where this shape is forced, because a <tr> may only hold
 * cells, so there is nowhere to put a wrapper for the inner list.
 *
 * Rows rendered in the browser only. Server-rendered rows adopted through
 * data-ssr go through a separate renderer and are not covered here.
 *
 * Every case must pass when run ALONE (`-t "<id> "`).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('a list row that is itself a list', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    const ctxOf = (name) => wildflower.componentInstances.get(host.querySelector(`[data-component="${name}"]`).dataset.componentId).context
    // One array of cell texts per row, in DOM order.
    const grid = (rowSel = 'tbody > tr', cellSel = 'td') =>
        [...host.querySelectorAll(rowSel)].map((r) => [...r.querySelectorAll(':scope > ' + cellSel)].map((c) => c.textContent.trim()))

    const members = () => [
        { key: 'ana', name: 'Ana', cells: [{ key: 'travel', label: '320' }, { key: 'food', label: '150' }] },
        { key: 'ben', name: 'Ben', cells: [{ key: 'travel', label: '0' }, { key: 'food', label: '80' }] }
    ]
    const table = (c, row = '<tr data-list="cells" data-key="key"><template><td data-bind="label"></td></template></tr>') => `
        <div data-component="${c}">
            <table><tbody data-list="members" data-key="key"><template>${row}</template></tbody></table>
        </div>`

    it('R01 renders one row per item and one cell per inner item', async () => {
        wildflower.component('rl-r01', { state: { members: members() } })
        host.innerHTML = table('rl-r01')
        wildflower.scan()
        await settle()
        expect(grid()).toEqual([['320', '150'], ['0', '80']])
        // Nothing but cells inside a row: the inner template is gone and the
        // outer list's row data did not leak in as cells.
        expect(host.querySelectorAll('tbody > tr > :not(td)').length).toBe(0)
    })

    it('R02 an edit to an inner item reaches its cell, and only its cell', async () => {
        wildflower.component('rl-r02', { state: { members: members() } })
        host.innerHTML = table('rl-r02')
        wildflower.scan()
        await settle()
        const before = [...host.querySelectorAll('td')]
        ctxOf('rl-r02').members[1].cells[0].label = '45'
        await settle()
        ctxOf('rl-r02').members[0].cells[1].label = '151'
        await settle()
        expect(grid()).toEqual([['320', '151'], ['45', '80']])
        // Same elements: an edit must not rebuild the rows.
        expect([...host.querySelectorAll('td')]).toEqual(before)
    })

    it('R03 a column is added to and removed from every row', async () => {
        wildflower.component('rl-r03', {
            state: { members: members() },
            addColumn() { this.members.forEach((m) => m.cells.push({ key: 'software', label: 's-' + m.key })) },
            dropFirst() { this.members.forEach((m) => m.cells.shift()) }
        })
        host.innerHTML = table('rl-r03')
        wildflower.scan()
        await settle()
        ctxOf('rl-r03').addColumn()
        await settle()
        expect(grid()).toEqual([['320', '150', 's-ana'], ['0', '80', 's-ben']])
        ctxOf('rl-r03').dropFirst()
        await settle()
        expect(grid()).toEqual([['150', 's-ana'], ['80', 's-ben']])
    })

    it('R04 rows are added, reordered and removed, each keeping its own cells', async () => {
        wildflower.component('rl-r04', { state: { members: members() } })
        host.innerHTML = table('rl-r04')
        wildflower.scan()
        await settle()
        const ctx = ctxOf('rl-r04')
        ctx.members.push({ key: 'cara', name: 'Cara', cells: [{ key: 'travel', label: '7' }, { key: 'food', label: '9' }] })
        await settle()
        expect(grid()).toEqual([['320', '150'], ['0', '80'], ['7', '9']])
        const anaRow = host.querySelector('tbody > tr')
        ctx.members.reverse()
        await settle()
        expect(grid()).toEqual([['7', '9'], ['0', '80'], ['320', '150']])
        // Keyed: the row element moved, it was not rebuilt.
        expect(host.querySelectorAll('tbody > tr')[2]).toBe(anaRow)
        ctx.members.splice(1, 1)
        await settle()
        expect(grid()).toEqual([['7', '9'], ['320', '150']])
        // An edit after the reorder still lands on the right row.
        ctx.members[1].cells[0].label = '321'
        await settle()
        expect(grid()).toEqual([['7', '9'], ['321', '150']])
        ctx.members = []
        await settle()
        expect(grid()).toEqual([])
    })

    it('R05 cells from an item-level computed follow the data they are computed from', async () => {
        wildflower.component('rl-r05', {
            state: {
                categories: [{ key: 'travel' }, { key: 'food' }],
                members: [{ key: 'ana' }, { key: 'ben' }],
                expenses: [{ member: 'ana', category: 'travel', amount: 320 }, { member: 'ben', category: 'food', amount: 80 }]
            },
            computed: {
                cells(member) {
                    return this.categories.map((c) => ({
                        key: c.key,
                        id: 'cell-' + member.key + '-' + c.key,
                        label: String(this.expenses
                            .filter((e) => e.member === member.key && e.category === c.key)
                            .reduce((s, e) => s + e.amount, 0))
                    }))
                }
            }
        })
        host.innerHTML = table('rl-r05',
            '<tr data-list="cells" data-key="key"><template><td data-bind="label" data-bind-attr="{ id: id }"></td></template></tr>')
        wildflower.scan()
        await settle()
        expect(grid()).toEqual([['320', '0'], ['0', '80']])
        expect(host.querySelector('#cell-ben-food').textContent.trim()).toBe('80')
        const ctx = ctxOf('rl-r05')
        ctx.expenses.push({ member: 'ana', category: 'food', amount: 150 })
        await settle()
        expect(grid()).toEqual([['320', '150'], ['0', '80']])
        ctx.categories.push({ key: 'software' })
        await settle()
        expect(grid()).toEqual([['320', '150', '0'], ['0', '80', '0']])
        expect(host.querySelector('#cell-ana-software')).not.toBeNull()
        ctx.members.push({ key: 'cara' })
        await settle()
        expect(grid()).toEqual([['320', '150', '0'], ['0', '80', '0'], ['0', '0', '0']])
    })

    it('R06 an action inside a cell gets the cell as its item and the row as its parent', async () => {
        const seen = []
        wildflower.component('rl-r06', {
            state: { members: members() },
            pick(event, element, details) {
                seen.push([details.item.key, details.index, details.parent && details.parent.item.key, details.parent && details.parent.index])
            }
        })
        host.innerHTML = table('rl-r06',
            '<tr data-list="cells" data-key="key"><template><td><button data-action="pick" data-bind="label"></button></td></template></tr>')
        wildflower.scan()
        await settle()
        const buttons = host.querySelectorAll('button')
        expect(buttons.length).toBe(4)
        buttons[3].click()
        buttons[0].click()
        await settle()
        expect(seen).toEqual([['food', 1, 'ben', 1], ['travel', 0, 'ana', 0]])
    })

    it('R07 an action on a cell root (the inner row itself) gets the cell', async () => {
        const seen = []
        wildflower.component('rl-r07', {
            state: { members: members() },
            pick(event, element, details) { seen.push([details.item.key, details.parent && details.parent.item.key]) }
        })
        host.innerHTML = table('rl-r07',
            '<tr data-list="cells" data-key="key"><template><td data-action="pick" data-bind="label"></td></template></tr>')
        wildflower.scan()
        await settle()
        host.querySelectorAll('td')[2].click()
        await settle()
        expect(seen).toEqual([['travel', 'ben']])
    })

    it('R08 bindings on the row root read the outer item', async () => {
        wildflower.component('rl-r08', {
            state: { members: members().map((m, i) => ({ ...m, on: i === 0 })) }
        })
        host.innerHTML = table('rl-r08',
            '<tr data-list="cells" data-key="key" data-bind-attr="{ id: key, title: name }" data-bind-class="{ active: on }"><template><td data-bind="label"></td></template></tr>')
        wildflower.scan()
        await settle()
        const rows = host.querySelectorAll('tbody > tr')
        expect([...rows].map((r) => [r.id, r.title, r.classList.contains('active')])).toEqual([['ana', 'Ana', true], ['ben', 'Ben', false]])
        expect(grid()).toEqual([['320', '150'], ['0', '80']])
        const ctx = ctxOf('rl-r08')
        ctx.members[1].on = true
        ctx.members[0].name = 'Anna'
        await settle()
        expect([...rows].map((r) => [r.title, r.classList.contains('active')])).toEqual([['Anna', true], ['Ben', true]])
        expect(grid()).toEqual([['320', '150'], ['0', '80']])
    })

    it('R09 the same shape outside a table', async () => {
        wildflower.component('rl-r09', {
            state: { groups: [{ id: 1, items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }, { id: 2, items: [{ id: 'c', name: 'C' }] }] }
        })
        host.innerHTML = `
            <div data-component="rl-r09">
                <div class="groups" data-list="groups" data-key="id"><template>
                    <ul data-list="items" data-key="id"><template><li data-bind="name"></li></template></ul>
                </template></div>
            </div>`
        wildflower.scan()
        await settle()
        expect(grid('.groups > ul', 'li')).toEqual([['A', 'B'], ['C']])
        const ctx = ctxOf('rl-r09')
        ctx.groups[1].items.push({ id: 'd', name: 'D' })
        ctx.groups[0].items[0].name = 'A2'
        await settle()
        expect(grid('.groups > ul', 'li')).toEqual([['A2', 'B'], ['C', 'D']])
    })

    it('R10 three levels, each row the container of the next', async () => {
        wildflower.component('rl-r10', {
            state: { a: [{ id: 1, b: [{ id: 1, c: [{ id: 1, t: 'x' }, { id: 2, t: 'y' }] }, { id: 2, c: [{ id: 3, t: 'z' }] }] }] }
        })
        host.innerHTML = `
            <div data-component="rl-r10">
                <div class="la" data-list="a" data-key="id"><template>
                    <div class="lb" data-list="b" data-key="id"><template>
                        <div class="lc" data-list="c" data-key="id"><template><span data-bind="t"></span></template></div>
                    </template></div>
                </template></div>
            </div>`
        wildflower.scan()
        await settle()
        const read = () => [...host.querySelectorAll('.la > .lb > .lc')].map((r) => [...r.querySelectorAll(':scope > span')].map((s) => s.textContent.trim()))
        expect(read()).toEqual([['x', 'y'], ['z']])
        ctxOf('rl-r10').a[0].b[1].c.push({ id: 4, t: 'w' })
        ctxOf('rl-r10').a[0].b[0].c[1].t = 'y2'
        await settle()
        expect(read()).toEqual([['x', 'y2'], ['z', 'w']])
    })

    it('R11 a store-backed outer list', async () => {
        wildflower.store('rl-r11-store', { state: { members: members() } })
        wildflower.component('rl-r11', { state: {} })
        host.innerHTML = `
            <div data-component="rl-r11">
                <table><tbody data-list="$rl-r11-store.members" data-key="key"><template>
                    <tr data-list="cells" data-key="key"><template><td data-bind="label"></td></template></tr>
                </template></tbody></table>
            </div>`
        wildflower.scan()
        await settle()
        expect(grid()).toEqual([['320', '150'], ['0', '80']])
        const store = wildflower.getStore('rl-r11-store')
        store.members[0].cells[0].label = '1'
        store.members.push({ key: 'cara', name: 'Cara', cells: [{ key: 'travel', label: '2' }] })
        await settle()
        expect(grid()).toEqual([['1', '150'], ['0', '80'], ['2']])
    })

    it('R12 a model input inside a cell writes the inner item', async () => {
        wildflower.component('rl-r12', { state: { members: members() } })
        host.innerHTML = table('rl-r12',
            '<tr data-list="cells" data-key="key"><template><td><input data-model="label"><span data-bind="label"></span></td></template></tr>')
        wildflower.scan()
        await settle()
        const input = host.querySelectorAll('input')[3]
        expect(input.value).toBe('80')
        input.value = '81'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(ctxOf('rl-r12').members[1].cells[1].label).toBe('81')
        expect(host.querySelectorAll('td > span')[3].textContent.trim()).toBe('81')
        expect(ctxOf('rl-r12').members[0].cells[1].label).toBe('150')
    })

    it('R13 a row list next to an ordinary nested list in the same template', async () => {
        wildflower.component('rl-r13', {
            state: { rows: [{ id: 1, cells: [{ id: 1, tags: [{ id: 1, t: 'p' }, { id: 2, t: 'q' }] }, { id: 2, tags: [] }] }] }
        })
        host.innerHTML = `
            <div data-component="rl-r13">
                <table><tbody data-list="rows" data-key="id"><template>
                    <tr data-list="cells" data-key="id"><template>
                        <td><i data-list="tags" data-key="id"><template><b data-bind="t"></b></template></i></td>
                    </template></tr>
                </template></tbody></table>
            </div>`
        wildflower.scan()
        await settle()
        const read = () => [...host.querySelectorAll('tbody > tr > td')].map((td) => [...td.querySelectorAll('b')].map((b) => b.textContent.trim()))
        expect(read()).toEqual([['p', 'q'], []])
        ctxOf('rl-r13').rows[0].cells[1].tags.push({ id: 3, t: 'r' })
        await settle()
        expect(read()).toEqual([['p', 'q'], ['r']])
    })

    it('R14 destroying the component and mounting it again renders the same grid, with no errors', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            wildflower.component('rl-r14', { state: { members: members() } })
            host.innerHTML = table('rl-r14')
            wildflower.scan()
            await settle()
            expect(grid()).toEqual([['320', '150'], ['0', '80']])
            host.innerHTML = ''
            await settle()
            host.innerHTML = table('rl-r14')
            wildflower.scan()
            await settle()
            expect(grid()).toEqual([['320', '150'], ['0', '80']])
            ctxOf('rl-r14').members[0].cells[0].label = '5'
            await settle()
            expect(grid()).toEqual([['5', '150'], ['0', '80']])
            expect(errors).not.toHaveBeenCalled()
        } finally {
            errors.mockRestore()
        }
    })

    it('R15 the whole inner array is replaced on one row', async () => {
        wildflower.component('rl-r15', { state: { members: members() } })
        host.innerHTML = table('rl-r15')
        wildflower.scan()
        await settle()
        ctxOf('rl-r15').members[0].cells = [{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }, { key: 'z', label: 'Z' }]
        await settle()
        expect(grid()).toEqual([['X', 'Y', 'Z'], ['0', '80']])
        ctxOf('rl-r15').members[0].cells = []
        await settle()
        expect(grid()).toEqual([[], ['0', '80']])
    })

    it('R17 an action on the row root gets the outer item, exactly as it does with a wrapper element', async () => {
        // The row root carries both the action and the inner list. Whatever a
        // click on the row, and on one of its cells, does in the wrapper shape,
        // it must do here.
        const run = async (c, html, rowSel, cellSel) => {
            const seen = []
            wildflower.component(c, {
                state: { members: members() },
                pickRow(event, element, details) { seen.push([details.item.key, details.index]) }
            })
            host.innerHTML = `<div data-component="${c}">${html}</div>`
            wildflower.scan()
            await settle()
            host.querySelectorAll(rowSel)[1].click()
            await settle()
            host.querySelectorAll(cellSel)[0].click()
            await settle()
            return seen
        }
        const wrapped = await run('rl-r17-w', `
            <div class="outer" data-list="members" data-key="key"><template>
                <section data-action="pickRow"><p data-list="cells" data-key="key"><template><span data-bind="label"></span></template></p></section>
            </template></div>`, '.outer > section', '.outer > section > p > span')
        host.innerHTML = ''
        await settle()
        const rowList = await run('rl-r17-r', `
            <table><tbody data-list="members" data-key="key"><template>
                <tr data-list="cells" data-key="key" data-action="pickRow"><template><td data-bind="label"></td></template></tr>
            </template></tbody></table>`, 'tbody > tr', 'tbody > tr > td')
        expect(wrapped).toEqual([['ben', 1], ['ana', 0]])
        expect(rowList).toEqual(wrapped)
    })

    it('R18 a class on the row root that depends on the row position behaves as on an ordinary row', async () => {
        const run = async (c, row) => {
            wildflower.component(c, {
                state: { members: members() },
                computed: { isLast(member, index, info) { return info.last } }
            })
            host.innerHTML = table(c, row)
            wildflower.scan()
            await settle()
            const flags = () => [...host.querySelectorAll('tbody > tr')].map((r) => r.classList.contains('last'))
            const out = [flags()]
            ctxOf(c).members.push({ key: 'cara', name: 'Cara', cells: [{ key: 'travel', label: '1' }] })
            await settle()
            out.push(flags())
            ctxOf(c).members.splice(0, 1)
            await settle()
            out.push(flags())
            return out
        }
        const plain = await run('rl-r18-p', '<tr data-bind-class="{ last: isLast }"><td data-bind="name"></td></tr>')
        host.innerHTML = ''
        await settle()
        const rowList = await run('rl-r18-r',
            '<tr data-list="cells" data-key="key" data-bind-class="{ last: isLast }"><template><td data-bind="label"></td></template></tr>')
        expect(plain[0]).toEqual([false, true])
        expect(rowList).toEqual(plain)
        expect(grid()).toEqual([['0', '80'], ['1']])
    })

    it('R19 data-show on the row root hides and shows that row, cells intact', async () => {
        wildflower.component('rl-r19', { state: { members: members().map((m) => ({ ...m, visible: true })) } })
        host.innerHTML = table('rl-r19',
            '<tr data-list="cells" data-key="key" data-show="visible"><template><td data-bind="label"></td></template></tr>')
        wildflower.scan()
        await settle()
        const shown = () => [...host.querySelectorAll('tbody > tr')].map((r) => getComputedStyle(r).display !== 'none')
        expect(shown()).toEqual([true, true])
        ctxOf('rl-r19').members[0].visible = false
        await settle()
        expect(shown()).toEqual([false, true])
        ctxOf('rl-r19').members[0].cells[0].label = '321'
        ctxOf('rl-r19').members[0].visible = true
        await settle()
        expect(shown()).toEqual([true, true])
        expect(grid()).toEqual([['321', '150'], ['0', '80']])
    })

    it('R20 a cell binding that mixes a cell field and a store value follows the store', async () => {
        wildflower.store('rl-r20-s', { state: { limit: 100, unit: 'EUR' } })
        wildflower.component('rl-r20', {
            state: {
                members: [
                    { key: 'ana', cells: [{ key: 'travel', amount: 320 }, { key: 'food', amount: 150 }] },
                    { key: 'ben', cells: [{ key: 'travel', amount: 0 }, { key: 'food', amount: 80 }] }
                ]
            }
        })
        host.innerHTML = table('rl-r20', `<tr data-list="cells" data-key="key"><template>
            <td data-bind-class="{ hot: amount > $rl-r20-s.limit }"><b data-bind="amount"></b> <i data-bind="$rl-r20-s.unit"></i></td>
        </template></tr>`)
        wildflower.scan()
        await settle()
        const hot = () => [...host.querySelectorAll('tbody > tr')].map((r) => [...r.querySelectorAll(':scope > td')].map((c) => c.classList.contains('hot')))
        const amounts = () => [...host.querySelectorAll('td > b')].map((b) => b.textContent.trim())
        const units = () => [...host.querySelectorAll('td > i')].map((b) => b.textContent.trim())
        expect(hot()).toEqual([[true, true], [false, false]])
        expect(units()).toEqual(['EUR', 'EUR', 'EUR', 'EUR'])
        // The 320 cell is hot before and after: its class must not be touched
        // on the way (taken off against the ROW, where amount is undefined,
        // then put back by the inner list).
        const steady = host.querySelector('tbody > tr > td')
        let touched = 0
        const watch = new MutationObserver((records) => { touched += records.filter((r) => r.target === steady).length })
        watch.observe(steady, { attributes: true, attributeFilter: ['class'] })
        wildflower.getStore('rl-r20-s').limit = 200
        wildflower.getStore('rl-r20-s').unit = 'USD'
        await settle()
        watch.disconnect()
        expect(touched).toBe(0)
        expect(hot()).toEqual([[true, false], [false, false]])
        expect(units()).toEqual(['USD', 'USD', 'USD', 'USD'])
        expect(amounts()).toEqual(['320', '150', '0', '80'])
        wildflower.getStore('rl-r20-s').limit = 50
        await settle()
        expect(hot()).toEqual([[true, true], [false, true]])
        expect(amounts()).toEqual(['320', '150', '0', '80'])
    })

    it('R21 a form as the row root, its fields the inner list: submit gets the outer item, as with a wrapper', async () => {
        const run = async (c, html) => {
            const seen = []
            wildflower.component(c, {
                state: { forms: [{ id: 'f1', fields: [{ id: 'a', value: 'x' }] }, { id: 'f2', fields: [{ id: 'b', value: 'y' }, { id: 'c', value: 'z' }] }] },
                save(event, element, details) { seen.push([details && details.item && details.item.id, details && details.index]) }
            })
            host.innerHTML = `<div data-component="${c}">${html}</div>`
            wildflower.scan()
            await settle()
            const forms = host.querySelectorAll('form')
            expect(forms.length).toBe(2)
            expect(forms[1].querySelectorAll('input').length).toBe(2)
            forms[1].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            await settle()
            return seen
        }
        const wrapped = await run('rl-r21-w', `
            <div data-list="forms" data-key="id"><template>
                <form data-action="save"><p data-list="fields" data-key="id"><template><input data-model="value"></template></p></form>
            </template></div>`)
        host.innerHTML = ''
        await settle()
        const rowList = await run('rl-r21-r', `
            <div data-list="forms" data-key="id"><template>
                <form data-list="fields" data-key="id" data-action="save"><template><input data-model="value"></template></form>
            </template></div>`)
        // The handler's last call carries the row. (Compared with the wrapper
        // shape as a whole rather than against a fixed list, so this case
        // says nothing about how many times a form row's handler runs.)
        expect(wrapped[wrapped.length - 1]).toEqual(['f2', 1])
        expect(rowList).toEqual(wrapped)
    })

    it('R22 an item-level computed in a cell (computed: prefix) follows component state', async () => {
        wildflower.component('rl-r22', {
            state: { suffix: '!', members: members() },
            computed: { shout(cell) { return cell.label + this.suffix } }
        })
        host.innerHTML = table('rl-r22',
            '<tr data-list="cells" data-key="key"><template><td><span data-bind="computed:shout"></span></td></template></tr>')
        wildflower.scan()
        await settle()
        expect(grid()).toEqual([['320!', '150!'], ['0!', '80!']])
        ctxOf('rl-r22').suffix = '?'
        await settle()
        expect(grid()).toEqual([['320?', '150?'], ['0?', '80?']])
        ctxOf('rl-r22').members[1].cells[1].label = '81'
        await settle()
        expect(grid()).toEqual([['320?', '150?'], ['0?', '81?']])
    })

    it('R23 the table sits in a data-render section that is removed and put back', async () => {
        wildflower.component('rl-r23', { state: { open: true, members: members().map((m) => ({ ...m, on: false, visible: true })) } })
        host.innerHTML = `
            <div data-component="rl-r23">
                <section data-render="open">
                    <table><tbody data-list="members" data-key="key"><template>
                        <tr data-list="cells" data-key="key" data-show="visible" data-bind-class="{ on: on }" data-bind-attr="{ title: name }"><template><td data-bind="label"></td></template></tr>
                    </template></tbody></table>
                </section>
            </div>`
        wildflower.scan()
        await settle()
        expect(grid()).toEqual([['320', '150'], ['0', '80']])
        const ctx = ctxOf('rl-r23')
        ctx.open = false
        await settle()
        expect(host.querySelector('table')).toBeNull()
        ctx.members[0].cells[0].label = '321'
        ctx.open = true
        await settle()
        expect(grid()).toEqual([['321', '150'], ['0', '80']])
        ctx.members[1].on = true
        ctx.members[1].name = 'Benny'
        ctx.members[1].cells[1].label = '81'
        await settle()
        const rows = [...host.querySelectorAll('tbody > tr')]
        expect(rows.map((r) => [r.title, r.classList.contains('on')])).toEqual([['Ana', false], ['Benny', true]])
        expect(grid()).toEqual([['321', '150'], ['0', '81']])
        // The row root's own data-show still reads the row, not the component
        // (where `visible` does not exist and the row would be hidden).
        const shown = () => rows.map((r) => getComputedStyle(r).display !== 'none')
        expect(shown()).toEqual([true, true])
        ctx.members[0].visible = false
        await settle()
        expect(shown()).toEqual([false, true])
    })

    it('R24 a removed row releases its inner list: later edits to its data touch nothing and raise nothing', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            wildflower.component('rl-r24', { state: { members: members() } })
            host.innerHTML = table('rl-r24')
            wildflower.scan()
            await settle()
            const ctx = ctxOf('rl-r24')
            const instance = wildflower.componentInstances.get(host.querySelector('[data-component]').dataset.componentId)
            const gone = ctx.members[0]
            const goneRow = host.querySelector('tbody > tr')
            ctx.members.splice(0, 1)
            await settle()
            expect(grid()).toEqual([['0', '80']])
            expect(goneRow.isConnected).toBe(false)
            // The removed row's inner list is torn down, not left running: a
            // later change to its data draws nothing into the detached row.
            const cellsBefore = goneRow.querySelectorAll('td').length
            gone.cells.push({ key: 'late', label: 'late' })
            await settle()
            expect(goneRow.querySelectorAll('td').length).toBe(cellsBefore)
            // Internal names are renamed in production builds.
            if (!isMinifiedBuild()) {
                expect(goneRow._disposeMapArray == null).toBe(true)
                // No nested-list context of a removed row stays registered.
                const keys = [...instance._listContexts.keys()]
                expect(keys.filter((k) => k.includes('].cells')).length).toBe(1)
            }
            expect(errors).not.toHaveBeenCalled()
        } finally {
            errors.mockRestore()
        }
    })

    // Twelve rows: ten or more rows created at once take the bulk row path,
    // which builds rows from a stripped copy of the template.
    const manyMembers = (n = 12) => Array.from({ length: n }, (_, i) => ({
        key: 'm' + i, name: 'M' + i,
        cells: [{ key: 'a', label: i + 'a' }, { key: 'b', label: i + 'b' }, { key: 'c', label: i + 'c' }]
    }))

    it('R25 twelve rows: cells stay keyed by the inner data-key (a removed column removes its cells, the rest keep theirs)', async () => {
        wildflower.component('rl-r25', {
            state: { members: manyMembers() },
            dropFirst() { this.members.forEach((m) => m.cells.shift()) },
            // New objects, same keys, new order: only the key can match them.
            rotate() { this.members.forEach((m) => { m.cells = [m.cells[1], m.cells[0]].map((c) => ({ ...c })) }) }
        })
        host.innerHTML = table('rl-r25')
        wildflower.scan()
        await settle()
        expect(grid().length).toBe(12)
        expect(grid()[11]).toEqual(['11a', '11b', '11c'])
        const rows = [...host.querySelectorAll('tbody > tr')]
        const before = rows.map((r) => [...r.querySelectorAll(':scope > td')])
        ctxOf('rl-r25').dropFirst()
        await settle()
        expect(grid()[0]).toEqual(['0b', '0c'])
        expect(grid()[11]).toEqual(['11b', '11c'])
        // Keyed: the b and c cells are the same elements as before, in every row.
        rows.forEach((r, i) => {
            const now = [...r.querySelectorAll(':scope > td')]
            expect(now[0]).toBe(before[i][1])
            expect(now[1]).toBe(before[i][2])
        })
        ctxOf('rl-r25').rotate()
        await settle()
        expect(grid()[0]).toEqual(['0c', '0b'])
        expect(grid()[11]).toEqual(['11c', '11b'])
        // The c cell moved to the front; it was not repainted in place.
        rows.forEach((r, i) => {
            const now = [...r.querySelectorAll(':scope > td')]
            expect(now[0]).toBe(before[i][2])
            expect(now[1]).toBe(before[i][1])
        })
    })

    it('R26 twelve rows: an action on the row root fires from a click on a cell and on the row', async () => {
        const seen = []
        wildflower.component('rl-r26', {
            state: { members: manyMembers() },
            pickRow(event, element, details) { seen.push([details.item.key, details.index]) }
        })
        host.innerHTML = table('rl-r26',
            '<tr data-list="cells" data-key="key" data-action="pickRow"><template><td data-bind="label"></td></template></tr>')
        wildflower.scan()
        await settle()
        const rows = host.querySelectorAll('tbody > tr')
        rows[11].querySelectorAll('td')[1].click()
        rows[3].click()
        await settle()
        expect(seen).toEqual([['m11', 11], ['m3', 3]])
    })

    it('R27 a data-render elsewhere in the component turning on leaves the row roots bound to their rows', async () => {
        wildflower.component('rl-r27', {
            state: { showNote: false, members: members().map((m, i) => ({ ...m, visible: true, on: i === 0 })) }
        })
        host.innerHTML = `
            <div data-component="rl-r27">
                <p class="note" data-render="showNote">note</p>
                <table><tbody data-list="members" data-key="key"><template>
                    <tr data-list="cells" data-key="key" data-show="visible" data-bind-class="{ on: on }" data-bind-attr="{ title: name }"><template><td data-bind="label"></td></template></tr>
                </template></tbody></table>
            </div>`
        wildflower.scan()
        await settle()
        const rows = [...host.querySelectorAll('tbody > tr')]
        const read = () => rows.map((r) => [getComputedStyle(r).display !== 'none', r.title, r.classList.contains('on')])
        expect(read()).toEqual([[true, 'Ana', true], [true, 'Ben', false]])
        ctxOf('rl-r27').showNote = true
        await settle()
        expect(host.querySelector('.note')).not.toBeNull()
        expect(read()).toEqual([[true, 'Ana', true], [true, 'Ben', false]])
        expect(grid()).toEqual([['320', '150'], ['0', '80']])
        ctxOf('rl-r27').members[1].on = true
        ctxOf('rl-r27').members[0].visible = false
        await settle()
        expect(read()).toEqual([[false, 'Ana', true], [true, 'Ben', true]])
    })

    it('R28 a subscribed store read by an item-level computed in a cell: a store write repaints cells from the cell', async () => {
        wildflower.store('rl-r28-prefs', { state: { unit: 'EUR' } })
        wildflower.component('rl-r28', {
            subscribe: { 'rl-r28-prefs': ['unit'] },
            state: { members: members() },
            computed: { fmt(cell) { return cell.label + ' ' + this.stores['rl-r28-prefs'].unit } }
        })
        host.innerHTML = table('rl-r28',
            '<tr data-list="cells" data-key="key"><template><td><span data-bind="computed:fmt"></span></td></template></tr>')
        wildflower.scan()
        await settle()
        expect(grid()).toEqual([['320 EUR', '150 EUR'], ['0 EUR', '80 EUR']])
        // Every text a cell ever shows, not just the last one: a cell painted
        // from the ROW (label undefined) and then repainted correctly would
        // pass a final-state check.
        // (Records are delivered after the writes, so the text at delivery
        // is the final one; an intermediate value shows up as the OLD value
        // of the write that replaced it.)
        const painted = []
        const watch = new MutationObserver((records) => {
            for (const r of records) {
                painted.push((r.target.textContent || '').trim())
                if (r.oldValue != null) painted.push(String(r.oldValue).trim())
                r.removedNodes.forEach((n) => painted.push((n.textContent || '').trim()))
            }
        })
        watch.observe(host.querySelector('tbody'), { subtree: true, childList: true, characterData: true, characterDataOldValue: true })
        const store = wildflower.getStore('rl-r28-prefs')
        store.unit = 'USD'
        await settle()
        expect(grid()).toEqual([['320 USD', '150 USD'], ['0 USD', '80 USD']])
        watch.disconnect()
        expect(painted.length).toBeGreaterThan(0)
        expect(painted.filter((t) => t.includes('undefined'))).toEqual([])
        // The inner array replaced and grown, then the store written again:
        // nothing left over from the old array may be used to repaint.
        const ctx = ctxOf('rl-r28')
        ctx.members[0].cells = [{ key: 'x', label: '1' }, { key: 'y', label: '2' }, { key: 'z', label: '3' }]
        ctx.members[1].cells.push({ key: 'late', label: '9' })
        await settle()
        store.unit = 'GBP'
        await settle()
        expect(grid()).toEqual([['1 GBP', '2 GBP', '3 GBP'], ['0 GBP', '80 GBP', '9 GBP']])
    })

    it('R29 the inner array arrives after the row exists, as it does with a wrapper element', async () => {
        const run = async (c, html, read) => {
            wildflower.component(c, { state: { members: [{ key: 'ana' }, { key: 'ben', cells: [{ key: 'k', label: 'B' }] }] } })
            host.innerHTML = `<div data-component="${c}">${html}</div>`
            wildflower.scan()
            await settle()
            const out = [read()]
            ctxOf(c).members[0].cells = [{ key: 'travel', label: '320' }]
            await settle()
            out.push(read())
            ctxOf(c).members[0].cells.push({ key: 'food', label: '150' })
            await settle()
            out.push(read())
            return out
        }
        const wrapped = await run('rl-r29-w', `
            <div class="outer" data-list="members" data-key="key"><template>
                <section><p data-list="cells" data-key="key"><template><span data-bind="label"></span></template></p></section>
            </template></div>`, () => grid('.outer > section > p', 'span'))
        host.innerHTML = ''
        await settle()
        const rowList = await run('rl-r29-r', `
            <div class="outer" data-list="members" data-key="key"><template>
                <p data-list="cells" data-key="key"><template><span data-bind="label"></span></template></p>
            </template></div>`, () => grid('.outer > p', 'span'))
        // Parity only. Whether an inner array that arrives late renders at
        // all is a separate question about nested lists in general, and this
        // case takes no position on it.
        expect(wrapped[0]).toEqual([[], ['B']])
        expect(rowList).toEqual(wrapped)
    })

    it('R30 the outer array replaced by new objects with the same keys: rows are kept and follow the new objects', async () => {
        wildflower.component('rl-r30', { state: { members: members() } })
        host.innerHTML = table('rl-r30')
        wildflower.scan()
        await settle()
        const rows = [...host.querySelectorAll('tbody > tr')]
        const ctx = ctxOf('rl-r30')
        const fresh = members()
        fresh[0].cells[0].label = '999'
        ctx.members = fresh
        await settle()
        expect(grid()).toEqual([['999', '150'], ['0', '80']])
        expect([...host.querySelectorAll('tbody > tr')]).toEqual(rows)
        ctx.members[1].cells[1].label = '81'
        ctx.members[0].cells.push({ key: 'software', label: '5' })
        await settle()
        expect(grid()).toEqual([['999', '150', '5'], ['0', '81']])
    })

    it('R31 an action in a cell whose cells come from an item-level computed', async () => {
        const seen = []
        wildflower.component('rl-r31', {
            state: { categories: [{ key: 'travel' }, { key: 'food' }], members: [{ key: 'ana' }, { key: 'ben' }] },
            computed: { cells(member) { return this.categories.map((c) => ({ key: c.key, label: member.key + '-' + c.key })) } },
            pick(event, element, details) {
                seen.push([details.item.label, details.index, details.parent && details.parent.item.key, details.length])
            }
        })
        host.innerHTML = table('rl-r31',
            '<tr data-list="cells" data-key="key"><template><td><button data-action="pick" data-bind="label"></button></td></template></tr>')
        wildflower.scan()
        await settle()
        host.querySelectorAll('button')[3].click()
        await settle()
        expect(seen).toEqual([['ben-food', 1, 'ben', 2]])
    })

    it('R32 inner lists are released on a multi-row removal, a full clear and component destroy', async () => {
        wildflower.component('rl-r32', { state: { members: manyMembers(6) } })
        host.innerHTML = table('rl-r32')
        wildflower.scan()
        await settle()
        const instance = wildflower.componentInstances.get(host.querySelector('[data-component]').dataset.componentId)
        const ctx = ctxOf('rl-r32')
        // Internal names are renamed in production builds; the checks on
        // them run on the other lanes, the behaviour checks run everywhere.
        const internals = !isMinifiedBuild()
        const nestedKeys = () => [...instance._listContexts.keys()].filter((k) => k.includes('].cells'))
        const cellCounts = (els) => els.map((r) => r.querySelectorAll('td').length)
        // A released inner list draws nothing when its data changes later.
        const staysReleased = async (els, items) => {
            const before = cellCounts(els)
            items.forEach((m) => m.cells.push({ key: 'late', label: 'late' }))
            await settle()
            expect(cellCounts(els)).toEqual(before)
        }
        const rows = [...host.querySelectorAll('tbody > tr')]
        const items = [...ctx.members]
        if (internals) {
            expect(rows.every((r) => typeof r._disposeMapArray === 'function')).toBe(true)
            expect(nestedKeys().length).toBe(6)
        }
        // Three rows removed in one write.
        ctx.members = ctx.members.filter((m, i) => i % 2 === 0)
        await settle()
        const goneIdx = rows.map((r, i) => (r.isConnected ? -1 : i)).filter((i) => i !== -1)
        expect(goneIdx).toEqual([1, 3, 5])
        const gone = goneIdx.map((i) => rows[i])
        await staysReleased(gone, goneIdx.map((i) => items[i]))
        if (internals) expect(gone.every((r) => r._disposeMapArray == null)).toBe(true)
        // Full clear.
        const keptIdx = [0, 2, 4]
        const kept = keptIdx.map((i) => rows[i])
        ctx.members = []
        await settle()
        expect(kept.every((r) => !r.isConnected)).toBe(true)
        await staysReleased(kept, keptIdx.map((i) => items[i]))
        if (internals) {
            expect(kept.every((r) => r._disposeMapArray == null)).toBe(true)
            expect(nestedKeys().length).toBe(0)
        }
        // Rows again, then the component goes away.
        ctx.members = manyMembers(3)
        await settle()
        const last = [...host.querySelectorAll('tbody > tr')]
        const lastItems = [...ctx.members]
        expect(last.length).toBe(3)
        host.innerHTML = ''
        await settle()
        await staysReleased(last, lastItems)
        if (internals) expect(last.every((r) => r._disposeMapArray == null)).toBe(true)
    })

    it('R33 a keyboard action on the row root fires from a key press inside a cell, as it does with a wrapper', async () => {
        const run = async (c, html, cellSel) => {
            const seen = []
            wildflower.component(c, {
                state: { members: members() },
                onKey(event, element, details) { seen.push([details && details.item && details.item.key, event.key]) }
            })
            host.innerHTML = `<div data-component="${c}">${html}</div>`
            wildflower.scan()
            await settle()
            host.querySelectorAll(cellSel)[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
            await settle()
            return seen
        }
        const wrapped = await run('rl-r33-w', `
            <div class="outer" data-list="members" data-key="key"><template>
                <section data-action="keydown:onKey"><p data-list="cells" data-key="key"><template><span tabindex="0" data-bind="label"></span></template></p></section>
            </template></div>`, '.outer span')
        host.innerHTML = ''
        await settle()
        const rowList = await run('rl-r33-r', `
            <div class="outer" data-list="members" data-key="key"><template>
                <p data-list="cells" data-key="key" data-action="keydown:onKey"><template><span tabindex="0" data-bind="label"></span></template></p>
            </template></div>`, '.outer span')
        expect(wrapped).toEqual([['ben', 'x']])
        expect(rowList).toEqual(wrapped)
    })

    it('R34 a <select> as the row root, its options the inner list and its value a model on the row, as with a wrapper', async () => {
        const run = async (c, html) => {
            wildflower.component(c, {
                state: {
                    rows: [
                        { id: 1, choice: 'b', options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
                        { id: 2, choice: 'a', options: [{ id: 'a', name: 'A' }, { id: 'c', name: 'C' }] }
                    ]
                }
            })
            host.innerHTML = `<div data-component="${c}">${html}</div>`
            wildflower.scan()
            await settle()
            const selects = [...host.querySelectorAll('select')]
            const out = [selects.map((s) => [s.options.length, s.value])]
            selects[1].value = 'c'
            selects[1].dispatchEvent(new Event('change', { bubbles: true }))
            await settle()
            out.push(ctxOf(c).rows.map((r) => r.choice))
            ctxOf(c).rows[0].choice = 'a'
            await settle()
            out.push(selects.map((s) => s.value))
            return out
        }
        const option = '<template><option data-bind="name" data-bind-attr="{ value: id }"></option></template>'
        const wrapped = await run('rl-r34-w', `
            <div data-list="rows" data-key="id"><template>
                <label><select data-list="options" data-key="id" data-model="choice">${option}</select></label>
            </template></div>`)
        host.innerHTML = ''
        await settle()
        const rowList = await run('rl-r34-r', `
            <div data-list="rows" data-key="id"><template>
                <select data-list="options" data-key="id" data-model="choice">${option}</select>
            </template></div>`)
        // Options render, a change writes the row, and a write to the row
        // moves the selection. (The selection shown on first render is left
        // to the comparison: it depends on whether the options exist yet
        // when the model is applied, in either shape.)
        expect(wrapped[0].map((s) => s[0])).toEqual([2, 2])
        expect(wrapped[1]).toEqual(['b', 'c'])
        expect(wrapped[2]).toEqual(['a', 'c'])
        expect(rowList).toEqual(wrapped)
    })

    it('R35 the documented row properties: an ordinary row keeps _listContext; a row that is a list has its own', async () => {
        wildflower.component('rl-r35', { state: { members: members() } })
        host.innerHTML = table('rl-r35')
        wildflower.scan()
        await settle()
        const tbody = host.querySelector('tbody')
        const tr = host.querySelector('tbody > tr')
        const td = tr.querySelector('td')
        // An ordinary row (a cell): the list it belongs to, as documented.
        expect(td._listContext).toBe(tr._listContext)
        expect(td._itemData.label).toBe('320')
        // A row that is a list: _listContext is the list it renders.
        expect(tr._listContext).not.toBe(tbody._listContext)
        expect(tr._listContext.path).toBe('cells')
        expect(tr._itemData.key).toBe('ana')
        expect(tr._listIndex).toBe(0)
    })

    it('R36 the same shape written with data-wf- attributes', async () => {
        wildflower.component('rl-r36', { state: { members: members() } })
        host.innerHTML = `
            <div data-wf-component="rl-r36">
                <table><tbody data-wf-list="members" data-wf-key="key"><template>
                    <tr data-wf-list="cells" data-wf-key="key"><template><td data-wf-bind="label"></td></template></tr>
                </template></tbody></table>
            </div>`
        wildflower.scan()
        await settle()
        expect(grid()).toEqual([['320', '150'], ['0', '80']])
        const instance = wildflower.componentInstances.get(host.querySelector('[data-wf-component]').dataset.componentId)
        instance.context.members[1].cells[0].label = '45'
        instance.context.members[0].cells.shift()
        await settle()
        expect(grid()).toEqual([['150'], ['45', '80']])
    })

    it('R37 the inner list reads a store array, registered after the rows exist, as with a wrapper', async () => {
        const run = async (c, s, html, read) => {
            wildflower.component(c, { state: { members: [{ key: 'ana' }, { key: 'ben' }] } })
            host.innerHTML = `<div data-component="${c}">${html}</div>`
            wildflower.scan()
            await settle()
            const out = [read()]
            wildflower.store(s, { state: { columns: [{ key: 'travel', label: 'T' }] } })
            await settle(150)
            out.push(read())
            wildflower.getStore(s).columns.push({ key: 'food', label: 'F' })
            await settle()
            out.push(read())
            wildflower.getStore(s).columns[0].label = 'T2'
            await settle()
            out.push(read())
            return out
        }
        const wrapped = await run('rl-r37-w', 'rl-r37-ws', `
            <div class="outer" data-list="members" data-key="key"><template>
                <section><p data-list="$rl-r37-ws.columns" data-key="key"><template><span data-bind="label"></span></template></p></section>
            </template></div>`, () => grid('.outer > section > p', 'span'))
        host.innerHTML = ''
        await settle()
        const rowList = await run('rl-r37-r', 'rl-r37-rs', `
            <div class="outer" data-list="members" data-key="key"><template>
                <p data-list="$rl-r37-rs.columns" data-key="key"><template><span data-bind="label"></span></template></p>
            </template></div>`, () => grid('.outer > p', 'span'))
        expect(wrapped[wrapped.length - 1]).toEqual([['T2', 'F'], ['T2', 'F']])
        expect(rowList).toEqual(wrapped)
    })

    it('R38 a child component inside a cell receives the cell as its prop, as with a wrapper', async () => {
        const run = async (c, html, read) => {
            wildflower.component(c + '-cell', {
                props: { cell: { type: 'object' } },
                computed: { text() { return this.props.cell ? this.props.cell.label : 'no-prop' } }
            })
            wildflower.component(c, { state: { members: members() } })
            host.innerHTML = `<div data-component="${c}">${html}</div>`
            wildflower.scan()
            await settle(150)
            const out = [read()]
            ctxOf(c).members[1].cells.push({ key: 'late', label: '9' })
            await settle(150)
            out.push(read())
            return out
        }
        const cell = (c) => `<span class="cell"><i data-component="${c}-cell" data-prop-cell="."><b data-bind="text"></b></i></span>`
        const wrapped = await run('rl-r38-w', `
            <div class="outer" data-list="members" data-key="key"><template>
                <section><p data-list="cells" data-key="key"><template>${cell('rl-r38-w')}</template></p></section>
            </template></div>`, () => grid('.outer > section > p', '.cell'))
        host.innerHTML = ''
        await settle()
        const rowList = await run('rl-r38-r', `
            <div class="outer" data-list="members" data-key="key"><template>
                <p data-list="cells" data-key="key"><template>${cell('rl-r38-r')}</template></p>
            </template></div>`, () => grid('.outer > p', '.cell'))
        // Compared with the wrapper shape as a whole: this case is about the
        // two shapes agreeing, not about what a child component in a nested
        // list's row receives on the first render.
        expect(wrapped[1][1][2]).toBe('9')
        expect(rowList).toEqual(wrapped)
    })

    it('R39 a component template-key swap while rows exist leaves the row roots bound to their rows', async () => {
        // The swap re-runs the component's own binding setup with rendered
        // rows in the DOM. A row root must not be picked up there: `visible`
        // is a row field, and against component state it is undefined.
        const run = async (c, row) => {
            wildflower.component(c, { state: { mode: 'a', members: members().map((m) => ({ ...m, visible: true })) } })
            host.innerHTML = `
                <div data-component="${c}" data-template-key="mode">
                    <template data-type="a"><p class="va">A</p></template>
                    <template data-type="b"><p class="vb">B</p></template>
                    <table><tbody data-list="members" data-key="key"><template>${row}</template></tbody></table>
                </div>`
            wildflower.scan()
            await settle()
            const rows = [...host.querySelectorAll('tbody > tr')]
            const shown = () => rows.map((r) => r.isConnected && getComputedStyle(r).display !== 'none')
            const out = [shown()]
            ctxOf(c).mode = 'b'
            await settle()
            expect(host.querySelector('.vb')).not.toBeNull()
            out.push(shown())
            ctxOf(c).members[0].visible = false
            await settle()
            out.push(shown())
            return out
        }
        const plain = await run('rl-r39-p', '<tr data-show="visible"><td data-bind="name"></td></tr>')
        host.innerHTML = ''
        await settle()
        const rowList = await run('rl-r39-r',
            '<tr data-list="cells" data-key="key" data-show="visible"><template><td data-bind="label"></td></template></tr>')
        expect(plain).toEqual([[true, true], [true, true], [false, true]])
        expect(rowList).toEqual(plain)
    })

    it('R40 wrapper shape: a nested list container keeps its own data-show bound to the row after a component rescan', async () => {
        // Not the row-as-list shape. The rescan rule changed with it: a list
        // container inside a row is the row's, whichever kind of field it reads.
        wildflower.component('rl-r40', {
            state: {
                showNote: false, showKids: true,
                groups: [{ id: 1, open: true, kids: [{ id: 'a', name: 'A' }] }, { id: 2, open: false, kids: [{ id: 'b', name: 'B' }] }]
            }
        })
        host.innerHTML = `
            <div data-component="rl-r40">
                <p class="note" data-render="showNote">note</p>
                <ul data-list="groups" data-key="id"><template>
                    <li>
                        <ul class="by-item" data-list="kids" data-key="id" data-show="open"><template><li data-bind="name"></li></template></ul>
                        <ul class="by-state" data-list="kids" data-key="id" data-show="showKids"><template><li data-bind="name"></li></template></ul>
                    </li>
                </template></ul>
            </div>`
        wildflower.scan()
        await settle()
        const shown = (sel) => [...host.querySelectorAll(sel)].map((u) => getComputedStyle(u).display !== 'none')
        expect(shown('.by-item')).toEqual([true, false])
        expect(shown('.by-state')).toEqual([true, true])
        const ctx = ctxOf('rl-r40')
        ctx.showNote = true
        await settle()
        expect(host.querySelector('.note')).not.toBeNull()
        expect(shown('.by-item')).toEqual([true, false])
        expect(shown('.by-state')).toEqual([true, true])
        ctx.groups[1].open = true
        ctx.groups[0].open = false
        await settle()
        expect(shown('.by-item')).toEqual([false, true])
        ctx.showKids = false
        await settle()
        expect(shown('.by-state')).toEqual([false, false])
        ctx.showKids = true
        await settle()
        expect(shown('.by-state')).toEqual([true, true])
        expect([...host.querySelectorAll('.by-state > li')].map((l) => l.textContent.trim())).toEqual(['A', 'B'])
    })

    it('R16 control: the same data with a wrapper element between the two lists', async () => {
        // The shape that has always worked. If this fails, the cases above are
        // failing for a reason that has nothing to do with the row being a list.
        wildflower.component('rl-r16', { state: { members: members() } })
        host.innerHTML = `
            <div data-component="rl-r16">
                <div class="outer" data-list="members" data-key="key"><template>
                    <section><p data-list="cells" data-key="key"><template><span data-bind="label"></span></template></p></section>
                </template></div>
            </div>`
        wildflower.scan()
        await settle()
        expect(grid('.outer > section > p', 'span')).toEqual([['320', '150'], ['0', '80']])
        ctxOf('rl-r16').members[1].cells[0].label = '45'
        await settle()
        expect(grid('.outer > section > p', 'span')).toEqual([['320', '150'], ['45', '80']])
    })
})
