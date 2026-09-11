/**
 * Record shape (data-query with no <template>) and what its bindings can see.
 *
 * Record mode has no real scope. It fakes one by REWRITING bare data-bind
 * paths to $name.rows.0.<path> (_queryRewriteRecordPaths), gated on
 * BARE_PATH = /^[a-zA-Z_][\w.]*$/ and applied only to data-bind and
 * data-wf-bind. Anything failing that regex passes through untouched and then
 * evaluates against COMPONENT scope, where the row's fields do not exist.
 *
 * These pins establish the exact boundary, and whether the limitation belongs
 * to record mode or to expressions generally. Reported from the Conduit build
 * (memory: data-query-record-mode-expression-gap), where an article page
 * rendered title and author.username correctly while a date expression, a
 * ternary, and two data-bind-attr values silently rendered wrong or not at all.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-recexpr-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 100) {
    await new Promise(r => setTimeout(r, ms))
}

// favorited is TRUE on purpose. With false, `favorited ? 'a' : 'b'` yields the
// same branch whether the field resolves or comes back undefined, so the test
// would pass without proving anything.
const ROW = { slug: 's1', title: 'Hello', favorited: true, favoritesCount: 2, createdAt: '2026-08-30T12:00:00.000Z', author: { username: 'johndoe', image: '/pic.png' } }

suite('data-query record shape: what bindings can see', () => {
    let container
    let wildflower
    let realFetch
    let warnings
    let realWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        window.fetch = async () => jsonResponse(ROW)
        warnings = []
        realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')); }
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    async function mount(qname, cname, inner) {
        wildflower.query(qname, { from: '/api/article' })
        container.innerHTML = `<div data-component="${cname}"><article data-query="${qname}">${inner}</article></div>`
        wildflower.component(cname, { state: {} })
        wildflower.scan(container)
        await settle()
    }

    it('CONTROL: bare paths resolve, nested included', async () => {
        const q = uname('q'); const c = uname('c')
        await mount(q, c, `
            <h1 class="t" data-bind="title"></h1>
            <span class="u" data-bind="author.username"></span>
        `)
        expect(container.querySelector('.t').textContent).toBe('Hello')
        expect(container.querySelector('.u').textContent).toBe('johndoe')
    })

    it('CONTROL: an explicit $name.rows.0 path works in an expression', async () => {
        const q = uname('q'); const c = uname('c')
        await mount(q, c, `
            <span class="e" data-bind="$${q}.rows.0.favorited ? 'Unfavorite' : 'Favorite'"></span>
        `)
        // Proves the expression evaluator and the binding are fine. What record
        // mode does not do is make the BARE name reach the row.
        expect(container.querySelector('.e').textContent).toBe('Unfavorite')
    })

    it('a ternary over bare field names resolves against the row', async () => {
        const q = uname('q'); const c = uname('c')
        await mount(q, c, `
            <span class="e" data-bind="favorited ? 'Unfavorite' : 'Favorite'"></span>
        `)
        expect(container.querySelector('.e').textContent).toBe('Unfavorite')
    })

    it('a concatenation over bare field names resolves against the row', async () => {
        const q = uname('q'); const c = uname('c')
        await mount(q, c, `
            <span class="e" data-bind="'(' + favoritesCount + ')'"></span>
        `)
        expect(container.querySelector('.e').textContent).toBe('(2)')
    })

    it('data-bind-attr over a bare field name resolves against the row', async () => {
        const q = uname('q'); const c = uname('c')
        await mount(q, c, `
            <a class="lnk" data-bind-attr="{href: '/profile/' + author.username}">x</a>
        `)
        expect(container.querySelector('.lnk').getAttribute('href')).toBe('/profile/johndoe')
    })

    it('data-bind-class over a bare field name resolves against the row', async () => {
        const q = uname('q'); const c = uname('c')
        await mount(q, c, `
            <span class="c1" data-bind-class="favorited ? 'on' : 'off'"></span>
        `)
        expect(container.querySelector('.c1').className).toContain('on')
    })

    it('data-show over a bare field name resolves against the row', async () => {
        const q = uname('q'); const c = uname('c')
        await mount(q, c, `
            <span class="s1" data-show="favoritesCount > 1">shown</span>
        `)
        expect(container.querySelector('.s1').style.display).not.toBe('none')
    })

    // A BARE field name (no operator) in the attributes the rewrite cannot
    // reach reads the record too (decided 2026-09-04): the merged scope is the
    // one rule for the whole subtree, data-bind's rewrite aside. data-model
    // stays on component state, since a record is read-only.
    it('a bare field name in data-show, negated or not, reads the row', async () => {
        const q = uname('q'); const c = uname('c')
        await mount(q, c, `
            <span class="on" data-show="favorited">on</span>
            <span class="off" data-show="!favorited">off</span>
        `)
        expect(container.querySelector('.on').style.display).not.toBe('none')
        expect(container.querySelector('.off').style.display).toBe('none')
    })

    it('a bare field name in data-bind-class, data-bind-html and data-bind-attr reads the row, and follows a new row', async () => {
        const q = uname('q'); const c = uname('c')
        await mount(q, c, `
            <span class="cls" data-bind-class="author.username">c</span>
            <span class="html" data-bind-html="title"></span>
            <span class="attr" data-bind-attr="attrs">a</span>
        `)
        expect(container.querySelector('.cls').classList.contains('johndoe')).toBe(true)
        expect(container.querySelector('.html').innerHTML).toBe('Hello')

        window.fetch = async () => jsonResponse({ ...ROW, title: '<b>Again</b>', favorited: false, author: { username: 'janedoe' }, attrs: { title: 'row-title' } })
        await wildflower.getQuery(q).refresh()
        await settle()
        expect(container.querySelector('.cls').classList.contains('janedoe')).toBe(true)
        expect(container.querySelector('.cls').classList.contains('johndoe')).toBe(false)
        expect(container.querySelector('.html').innerHTML).toBe('<b>Again</b>')
        expect(container.querySelector('.attr').getAttribute('title')).toBe('row-title')
    })

    it('a bare component-state name on a record element still resolves when the row lacks it', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/article' })
        container.innerHTML = `<div data-component="${c}"><article data-query="${q}">
            <span class="s" data-show="openFlag">x</span>
        </article></div>`
        wildflower.component(c, { state: { openFlag: true } })
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.s').style.display).not.toBe('none')
        wildflower.getComponent(c).openFlag = false
        await settle()
        expect(container.querySelector('.s').style.display).toBe('none')
    })

    // The dev-build binding validator (WF-509) judges bare names by component
    // state. Inside a record subtree those names read the row, so the validator
    // leaves them to WF-997, which fires once a row has arrived and names a
    // field neither scope carries. data-model stays on component state, so a
    // data-model typo inside the record still warns. A bare name outside the
    // record warns in the same setup, so a silent channel cannot pass this.
    it.skipIf(isMinifiedBuild())('WF-509 does not fire for bare row fields inside a record subtree', async () => {
        wildflower.options.debug = true
        wildflower.debug = true
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/article' })
        container.innerHTML = `<div data-component="${c}">
            <span data-show="notAState">control</span>
            <article data-query="${q}">
                <span data-show="favorited">on</span>
                <span data-show="!favorited">off</span>
                <span data-bind-class="author.username">c</span>
                <span data-bind-style="{ color: author.username }">s</span>
                <span data-bind-html="title"></span>
                <input data-model="draftTypo">
            </article>
        </div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        const wf509 = warnings.filter(w => w.includes('WF-509'))
        expect(wf509.some(w => w.includes('"notAState"'))).toBe(true)
        expect(wf509.some(w => w.includes('"draftTypo"'))).toBe(true)
        for (const name of ['favorited', 'author', 'title']) {
            expect(wf509.filter(w => w.includes(`"${name}"`))).toEqual([])
        }
    })

    // The computed: prefix names a component computed on purpose: the record
    // transform leaves it alone (no rewrite to $q.rows.0.x) and the effect has
    // to read it from the component rather than run it as an expression.
    // dashboard-pools binds its six KPI values this way inside the metrics
    // record, and they rendered blank when the row-scope routing sent the
    // prefixed path through the expression evaluator.
    it('a computed: prefixed binding inside a record subtree reads the component computed', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/article' })
        container.innerHTML = `<div data-component="${c}">
            <span class="ctl" data-bind="computed:display"></span>
            <article data-query="${q}">
                <span class="v" data-bind="computed:display"></span>
                <span class="h" data-bind-html="computed:display"></span>
                <span class="k" data-bind-class="computed:tone">k</span>
            </article>
        </div>`
        wildflower.component(c, {
            state: { n: 1284500 },
            computed: {
                display() { return '$' + (this.n / 1e6).toFixed(1) + 'M' },
                tone() { return this.n > 1e6 ? 'up' : 'down' }
            }
        })
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.ctl').textContent).toBe('$1.3M')
        expect(container.querySelector('.v').textContent).toBe('$1.3M')
        expect(container.querySelector('.h').innerHTML).toBe('$1.3M')
        expect(container.querySelector('.k').classList.contains('up')).toBe(true)

        wildflower.getComponent(c).n = 900000
        await settle()
        expect(container.querySelector('.v').textContent).toBe('$0.9M')
        expect(container.querySelector('.h').innerHTML).toBe('$0.9M')
        expect(container.querySelector('.k').classList.contains('down')).toBe(true)
    })

    // The merged scope is built by reading the row inside the render effect, so
    // the dependency has to register or the subtree would paint once and freeze.
    it('a new row re-renders expressions in the subtree', async () => {
        const q = uname('q'); const c = uname('c')
        await mount(q, c, `
            <span class="e" data-bind="'(' + favoritesCount + ')'"></span>
            <span class="t" data-bind="favorited ? 'Unfavorite' : 'Favorite'"></span>
            <a class="lnk" data-bind-attr="{href: '/profile/' + author.username}">x</a>
        `)
        expect(container.querySelector('.e').textContent).toBe('(2)')

        wildflower.getQuery(q).patch({ favoritesCount: 9, favorited: false, author: { username: 'ada' } })
        await settle()

        expect({
            count: container.querySelector('.e').textContent,
            label: container.querySelector('.t').textContent,
            href: container.querySelector('.lnk').getAttribute('href')
        }).toEqual({ count: '(9)', label: 'Favorite', href: '/profile/ada' })
    })

    // Precedence, matching the data-list item branch, which merges
    // {...componentState, ...item} so the item shadows the component.
    it('a row field shadows a same-named component state field', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/article' })
        container.innerHTML = `<div data-component="${c}"><article data-query="${q}">
            <span class="t" data-bind="title"></span>
            <span class="x" data-bind="title + '!'"></span>
        </article></div>`
        wildflower.component(c, { state: { title: 'COMPONENT' } })
        wildflower.scan(container)
        await settle()

        expect(container.querySelector('.t').textContent).toBe('Hello')
        expect(container.querySelector('.x').textContent).toBe('Hello!')
    })

    // Component state stays reachable for names the row does not carry.
    it('component state still resolves for names not on the row', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/article' })
        container.innerHTML = `<div data-component="${c}"><article data-query="${q}">
            <span class="o" data-bind="'[' + onlyOnComponent + ']'"></span>
        </article></div>`
        wildflower.component(c, { state: { onlyOnComponent: 'kept' } })
        wildflower.scan(container)
        await settle()

        expect(container.querySelector('.o').textContent).toBe('[kept]')
    })

    // WF-997 rides along with the scope merge: what the merge cannot reach is a
    // name neither scope provides, which renders empty in silence.
    it.skipIf(isMinifiedBuild())('WF-997 names a field neither the row nor the component has', async () => {
        const q = uname('q'); const c = uname('c')
        await mount(q, c, `<span class="z" data-bind="'[' + favoriteCount + ']'"></span>`)

        // wfError emits the message and a separate docs-link line, so filter on
        // the body rather than the code or one warning counts as two.
        const hits = warnings.filter(w => w.includes('WF-997') && w.includes('the binding'))
        expect(hits.length).toBe(1)
        expect(hits[0]).toContain('favoriteCount')
    })

    it.skipIf(isMinifiedBuild())('WF-997 stays silent on correct bindings', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/article' })
        container.innerHTML = `<div data-component="${c}"><article data-query="${q}">
            <span data-bind="title"></span>
            <span data-bind="favorited ? 'Unfavorite' : 'Favorite'"></span>
            <span data-bind="'(' + favoritesCount + ')'"></span>
            <span data-bind="new Date(createdAt).toLocaleDateString('en-US', { year: 'numeric' })"></span>
            <span data-bind="'[' + onComponent + ']'"></span>
            <a data-bind-attr="{href: '/profile/' + author.username}">x</a>
            <span data-bind-class="favorited ? 'on' : 'off'"></span>
        </article></div>`
        wildflower.component(c, { state: { onComponent: 'x' } })
        wildflower.scan(container)
        await settle()

        // Member names (toLocaleDateString), object-literal keys (href, year),
        // globals (Date), row fields and component fields must all be quiet.
        expect(warnings.filter(w => w.includes('WF-997'))).toEqual([])
    })

    // Is the limitation record-mode's, or does it belong to expressions
    // generally? A plain store reached through the documented $name.path form
    // inside the same expression shapes answers that.
    it('BOUNDARY: a plain store in an expression is unaffected', async () => {
        const s = uname('s'); const c = uname('c')
        wildflower.store(s, { state: { favorited: true, count: 2 } })
        container.innerHTML = `
            <div data-component="${c}">
                <span class="a" data-bind="$${s}.favorited ? 'Unfavorite' : 'Favorite'"></span>
                <span class="e" data-bind="$${s}.missingField ? 'yes' : 'no'"></span>
                <span class="b" data-bind="'(' + $${s}.count + ')'"></span>
                <a class="d" data-bind-attr="{href: '/p/' + $${s}.count}">x</a>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(container.querySelector('.a').textContent).toBe('Unfavorite')
        expect(warnings.filter(w => w.includes('WF-997'))).toEqual([])
        expect(container.querySelector('.b').textContent).toBe('(2)')
        expect(container.querySelector('.d').getAttribute('href')).toBe('/p/2')
        // Guards the three above from passing vacuously: an unresolved path
        // really does take the other branch here.
        expect(container.querySelector('.e').textContent).toBe('no')
    })
})
