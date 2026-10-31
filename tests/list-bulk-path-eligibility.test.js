/**
 * Which row templates may take the bulk row path.
 *
 * Ten or more rows created at once are built from a STRIPPED copy of the row
 * template: binding attributes are removed and the bindings are applied from
 * compiled metadata. That is only correct for a template whose every framework
 * attribute is one the bulk path is known to serve. The check used to be a
 * list of exclusions, so anything nobody had listed took the stripped path by
 * default; a <form data-action> in a row worked at nine rows and was dead at
 * ten, because a submit is dispatched from the attribute the path had removed.
 *
 * The rule is now the other way round: a template qualifies only when every
 * framework attribute in it is on the allow-list. Anything else, including a
 * framework attribute added later, takes the per-row path.
 *
 * How a test tells the two paths apart: the bulk path strips `data-bind` from
 * the rendered rows and the per-row path keeps it. Application code must never
 * rely on that; here it is the thing under test.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('bulk row path: which templates qualify', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    let n = 0
    // Renders `rows` rows of the template and reports which path built them.
    // Every template carries <span class="probe" data-bind="name">.
    const render = async (rowHtml, { rows = 12, def = {}, attr = 'data-' } = {}) => {
        const c = 'bp' + (++n)
        wildflower.component(c, {
            state: { visible: true, items: Array.from({ length: rows }, (_, i) => ({ id: i + 1, name: 'n' + i, on: i % 2 === 0, kids: [] })) },
            pick() {}, save() {}, ...def
        })
        host.innerHTML = `<div ${attr}component="${c}"><div class="L" ${attr}list="items" ${attr}key="id"><template>${rowHtml}</template></div></div>`
        wildflower.scan()
        await settle()
        const probes = [...host.querySelectorAll('.L .probe')]
        expect(probes.length).toBe(rows)
        expect(probes.map((p) => p.textContent.trim())).toEqual(Array.from({ length: rows }, (_, i) => 'n' + i))
        const kept = probes.filter((p) => p.hasAttribute('data-bind') || p.hasAttribute('data-wf-bind')).length
        expect(kept === 0 || kept === rows).toBe(true)
        return kept === 0 ? 'bulk' : 'per-row'
    }
    const PROBE = '<span class="probe" data-bind="name"></span>'

    describe('templates that qualify', () => {
        it('B01 control: fewer than ten rows never take the bulk path', async () => {
            expect(await render(`<div>${PROBE}</div>`, { rows: 9 })).toBe('per-row')
        })

        it('B02 text, class and click: the benchmark row shape', async () => {
            expect(await render(`<div data-bind-class="on ? 'danger' : ''">${PROBE}<a class="go" data-action="pick">x</a></div>`)).toBe('bulk')
        })

        it('B03 the author\'s own data- attributes and ordinary attributes do not disqualify a row', async () => {
            expect(await render(`<div data-testid="row" data-id="7" aria-label="row" title="t">${PROBE}<b data-foo="1" data-anything-else>x</b></div>`)).toBe('bulk')
        })

        it('B04 event modifiers on an action', async () => {
            expect(await render(`<div>${PROBE}<a href="#x" data-action="pick" data-event-stop data-event-prevent>x</a><i tabindex="0" data-action="keydown:pick" data-event-key-enter>k</i></div>`)).toBe('bulk')
        })

        it('B05 data-cloak and data-no-router', async () => {
            expect(await render(`<div data-cloak>${PROBE}<a href="/x" data-no-router>x</a></div>`)).toBe('bulk')
        })

        it('B08 data-event-outside (wired per row as the rows are built)', async () => {
            expect(await render(`<div>${PROBE}<b data-action="pick" data-event-outside>x</b></div>`)).toBe('bulk')
        })

        it('B07 data-type on a row element (a common styling hook; the framework reads it only on server-rendered rows)', async () => {
            expect(await render(`<div data-type="primary">${PROBE}<b data-type="number">1</b></div>`)).toBe('bulk')
        })

        it('B06 the same row written with data-wf- attributes', async () => {
            const c = await render(`<div data-wf-bind-class="on ? 'danger' : ''"><span class="probe" data-wf-bind="name"></span><a data-wf-action="pick">x</a></div>`, { attr: 'data-wf-' })
            expect(c).toBe('bulk')
        })
    })

    describe('templates that must take the per-row path', () => {
        // One framework attribute each, on a row that would otherwise qualify.
        // The first group was already excluded; the second was not, and took
        // the stripped path until the rule was inverted.
        const ALREADY = {
            'data-model': `<div>${PROBE}<input data-model="name"></div>`,
            'data-show': `<div>${PROBE}<b data-show="on">x</b></div>`,
            'data-render': `<div>${PROBE}<b data-render="on">x</b></div>`,
            'data-bind-style': `<div>${PROBE}<b data-bind-style="{ opacity: on ? '1' : '0.5' }">x</b></div>`,
            'data-bind-attr': `<div>${PROBE}<b data-bind-attr="{ title: name }">x</b></div>`,
            'data-bind-html': `<div>${PROBE}<b data-bind-html="name"></b></div>`,
            'data-list (inside the row)': `<div>${PROBE}<p data-list="kids" data-key="id"><template><i data-bind="id"></i></template></p></div>`,
            'data-show on the row root': `<div data-show="on">${PROBE}</div>`,
            'data-bind-attr on the row root': `<div data-bind-attr="{ title: name }">${PROBE}</div>`
        }
        const NEWLY = {
            '<form data-action>': `<div>${PROBE}<form data-action="save"><button type="submit">go</button></form></div>`,
            '<form data-action> as the row root': `<form data-action="save">${PROBE}</form>`,
            'data-transition': `<div data-transition="fade">${PROBE}</div>`,
            'data-validate-on': `<div>${PROBE}<p data-validate-on="blur">x</p></div>`,
            'data-seed': `<div data-seed='{"a":1}'>${PROBE}</div>`,
            'data-with': `<div>${PROBE}<b data-with="name">x</b></div>`,
            'data-external': `<div>${PROBE}<b data-external="x">x</b></div>`,
            'data-expect': `<div>${PROBE}<b data-expect="x">x</b></div>`,
            'data-pool-static': `<div data-pool-static>${PROBE}</div>`,
            'data-prop-x on a plain element': `<div>${PROBE}<b data-prop-x="name">x</b></div>`,
            'data-model-lazy without a model': `<div>${PROBE}<b data-model-lazy>x</b></div>`,
            'data-storage-key': `<div data-storage-key="k">${PROBE}</div>`,
            'data-wf-transition (prefixed form)': `<div data-wf-transition="fade">${PROBE}</div>`
        }
        let i = 0
        for (const [name, row] of Object.entries(ALREADY)) {
            it(`B1${String(i++).padStart(2, '0')} already excluded: ${name}`, async () => {
                expect(await render(row)).toBe('per-row')
            })
        }
        i = 0
        for (const [name, row] of Object.entries(NEWLY)) {
            it(`B2${String(i++).padStart(2, '0')} excluded by the allow-list: ${name}`, async () => {
                expect(await render(row)).toBe('per-row')
            })
        }
    })

    // The same template at nine rows (per-row path) and at twelve (bulk path,
    // when it qualifies) must behave the same. Each case here was a difference
    // between the two.
    describe('nine rows and twelve rows behave the same', () => {
        const SIZES = [9, 12]

        it('B40 a form that is the row root is submitted once, with its row', async () => {
            for (const rows of SIZES) {
                const seen = []
                await render(`<form data-action="save">${PROBE}</form>`, {
                    rows,
                    def: { save(event, element, details) { seen.push([details && details.item && details.item.name, details && details.index]) } }
                })
                host.querySelectorAll('.L form')[rows - 1].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
                await settle(30)
                expect(seen).toEqual([['n' + (rows - 1), rows - 1]])
            }
        })

        it('B41 data-bind on an input, a textarea and a select shows the value (and the select keeps its options)', async () => {
            for (const rows of SIZES) {
                await render(`<div>${PROBE}<input class="in" data-bind="name" readonly><textarea class="ta" data-bind="name"></textarea>
                    <select class="se" data-bind="pick"><option value="a">A</option><option value="b">B</option></select></div>`, {
                    rows,
                    def: { init() { this.items.forEach((it, i) => { it.pick = i % 2 ? 'b' : 'a' }) } }
                })
                const row = host.querySelectorAll('.L > div')[rows - 1]
                expect(row.querySelector('.in').value).toBe('n' + (rows - 1))
                expect(row.querySelector('.ta').value).toBe('n' + (rows - 1))
                expect(row.querySelector('.se').options.length).toBe(2)
                expect(row.querySelector('.se').value).toBe((rows - 1) % 2 ? 'b' : 'a')
            }
        })

        it('B42 an action inside an element that has its own action: the inner one runs, also after the outer one has', async () => {
            for (const rows of SIZES) {
                const seen = []
                await render(`<div class="row" data-action="select">${PROBE}<button class="x" data-action="remove">x</button></div>`, {
                    rows,
                    def: {
                        select(event, element, details) { seen.push(['select', details.index]) },
                        remove(event, element, details) { seen.push(['remove', details.index]) }
                    }
                })
                const row = host.querySelectorAll('.L > .row')[rows - 1]
                row.querySelector('.probe').click()
                await settle(20)
                row.querySelector('.x').click()
                await settle(20)
                expect(seen[0]).toEqual(['select', rows - 1])
                expect(seen[1]).toEqual(['remove', rows - 1])
            }
        })

        it('B43 two actions on one element (click and focus): each keeps working after the other has run', async () => {
            for (const rows of SIZES) {
                const seen = []
                await render(`<div>${PROBE}<input class="in" data-action="click:open focus:hilite"></div>`, {
                    rows,
                    def: {
                        open(event, element, details) { seen.push(['open', details.index]) },
                        hilite(event, element, details) { seen.push(['hilite', details.index]) }
                    }
                })
                const input = host.querySelectorAll('.L .in')[rows - 1]
                input.click()
                await settle(20)
                input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
                await settle(20)
                input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
                await settle(20)
                input.click()
                await settle(20)
                expect(seen).toEqual([['open', rows - 1], ['hilite', rows - 1], ['hilite', rows - 1], ['open', rows - 1]])
            }
        })

        it('B44 data-wf- only mode: another library\'s bare data- attributes stay on the rows', async () => {
            wildflower.setWfPrefixMode(true)
            try {
                for (const rows of SIZES) {
                    await render(`<div><span class="probe" data-wf-bind="name"></span>
                        <b class="other" data-action="click->c#m" data-bind="theirs" data-show="x" data-model="y" data-bind-class="z">x</b></div>`, { rows, attr: 'data-wf-' })
                    const other = host.querySelectorAll('.L .other')[rows - 1]
                    expect(['data-action', 'data-bind', 'data-show', 'data-model', 'data-bind-class'].filter((a) => !other.hasAttribute(a))).toEqual([])
                    expect(other.textContent).toBe('x')
                }
            } finally {
                wildflower.setWfPrefixMode(false)
            }
        })

        it('B45 the author\'s own data-key on an element inside the row stays', async () => {
            for (const rows of SIZES) {
                await render(`<div>${PROBE}<b class="k" data-key="mine">x</b></div>`, { rows })
                expect(host.querySelectorAll('.L .k')[rows - 1].getAttribute('data-key')).toBe('mine')
            }
        })

        it('B46 data-event-outside: a click outside reaches every row\'s handler', async () => {
            const counts = []
            for (const rows of SIZES) {
                const seen = []
                await render(`<div>${PROBE}<b class="o" data-action="close" data-event-outside>x</b></div>`, {
                    rows,
                    def: { close(event, element, details) { seen.push(details ? details.index : null) } }
                })
                document.body.click()
                await settle(30)
                counts.push(seen.length / rows)
            }
            // The same number of calls per row at both sizes, and at least one.
            expect(counts[1]).toBe(counts[0])
            expect(counts[0]).toBeGreaterThan(0)
        })
    })

    describe('what the exclusion buys', () => {
        it('B30 a form in a row is submitted once, with its row, at nine rows and at twelve', async () => {
            for (const rows of [9, 12]) {
                const seen = []
                await render(`<div>${PROBE}<form data-action="save"><button type="submit">go</button></form></div>`, {
                    rows,
                    def: { save(event, element, details) { seen.push([details && details.item && details.item.name, details && details.index, event.defaultPrevented]) } }
                })
                const forms = host.querySelectorAll('.L form')
                forms[rows - 1].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
                await settle(30)
                expect(seen).toEqual([['n' + (rows - 1), rows - 1, true]])
            }
        })

        it('B31 a click action still works on rows built by the bulk path', async () => {
            const seen = []
            const path = await render(`<div>${PROBE}<a class="go" data-action="pick">x</a></div>`, {
                def: { pick(event, element, details) { seen.push([details.item.name, details.index]) } }
            })
            expect(path).toBe('bulk')
            host.querySelectorAll('.L .go')[11].click()
            await settle(30)
            expect(seen).toEqual([['n11', 11]])
        })
    })
})
