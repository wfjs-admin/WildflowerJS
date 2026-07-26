/**
 * Mutable/immutable style-parity matrix for list updates.
 *
 * The framework documents in-place mutation as the preferred idiom but fully
 * supports immutable replacement — and 2026-07-25 produced two reconciler bugs
 * that lived exclusively on the immutable side of interactions the suite never
 * crossed (same-key identity replacement leaving a row deaf; replacement-to-
 * empty missing an externally-moved row). A census showed ~50 test files use
 * mutable idioms, ~25 immutable, and only 6 ever mix the two styles on one
 * list. This file makes the crossing systematic.
 *
 * Matrix: OPERATION x OP-STYLE x FOLLOW-UP-STYLE. Every cell asserts DOM
 * convergence TWICE: after the operation, and after a follow-up write in each
 * style. The second assertion is the point — the 2026-07-25 proxy-handoff bug
 * rendered the operation itself correctly and only went deaf on the NEXT
 * write, so op-only assertions cannot catch this class.
 *
 * Rows carry a text binding and a nested list so both flat and nested binding
 * paths are exercised per cell.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

const item = (id, name) => ({ id, name, tags: [{ id: id * 10, label: `t${id}` }] })

// Each op: apply in either style, and declare the surviving ids afterwards.
// `survivor` names an id that remains, for the follow-up deafness probes
// (null when nothing survives).
const OPS = [
    {
        name: 'append',
        mutable(c) { c.items.push(item(4, 'delta')) },
        immutable(c) { c.items = [...c.items, item(4, 'delta')] },
        after: [1, 2, 3, 4], survivor: 2
    },
    {
        name: 'prepend',
        mutable(c) { c.items.unshift(item(4, 'delta')) },
        immutable(c) { c.items = [item(4, 'delta'), ...c.items] },
        after: [4, 1, 2, 3], survivor: 2
    },
    {
        name: 'remove-middle',
        mutable(c) { c.items.splice(1, 1) },
        immutable(c) { c.items = c.items.filter(x => x.id !== 2) },
        after: [1, 3], survivor: 3
    },
    {
        name: 'remove-to-empty',
        mutable(c) { c.items.splice(0, c.items.length) },
        immutable(c) { c.items = [] },
        after: [], survivor: null
    },
    {
        name: 'reorder-reverse',
        mutable(c) { c.items.reverse() },
        immutable(c) { c.items = [...c.items].reverse() },
        after: [3, 2, 1], survivor: 2
    },
    {
        name: 'replace-one-same-key',
        // The 2026-07-25 proxy-handoff cell: same id, NEW object identity.
        mutable(c) { c.items[1] = { ...c.items[1], name: 'swapped' } },
        immutable(c) {
            const next = [...c.items]
            next[1] = { ...next[1], name: 'swapped' }
            c.items = next
        },
        after: [1, 2, 3], survivor: 2, renamed: { id: 2, name: 'swapped' }
    },
    {
        name: 'replace-all-same-keys',
        mutable(c) { for (let i = 0; i < c.items.length; i++) c.items[i] = { ...c.items[i], name: c.items[i].name + '!' } },
        immutable(c) { c.items = c.items.map(x => ({ ...x, name: x.name + '!' })) },
        after: [1, 2, 3], survivor: 2
    },
    {
        name: 'nested-field-update',
        mutable(c) { c.items[1].tags.push({ id: 99, label: 'extra' }) },
        immutable(c) {
            const next = [...c.items]
            next[1] = { ...next[1], tags: [...next[1].tags, { id: 99, label: 'extra' }] }
            c.items = next
        },
        after: [1, 2, 3], survivor: 2, nestedCount: { id: 2, count: 2 }
    },
    {
        // Two bare index writes: the mutable arm drives the reconciler's
        // in-place-swap structural fast path, whose prev-entry re-keying the
        // positional regime depends on (stale index keys mis-key the NEXT
        // reconcile — the fast-path sibling of the remove-one staleness).
        name: 'swap-first-last',
        mutable(c) { const t = c.items[0]; c.items[0] = c.items[2]; c.items[2] = t },
        immutable(c) { c.items = [c.items[2], c.items[1], c.items[0]] },
        after: [3, 2, 1], survivor: 2
    },
]

const FOLLOWUPS = {
    mutable: {
        add(c) { c.items.push(item(9, 'omega')) },
        rename(c, id) { const r = c.items.find(x => x.id === id); r.name = 'renamed' },
        nest(c, id) { const r = c.items.find(x => x.id === id); r.tags.push({ id: 999, label: 'late' }) },
    },
    immutable: {
        add(c) { c.items = [...c.items, item(9, 'omega')] },
        rename(c, id) { c.items = c.items.map(x => x.id === id ? { ...x, name: 'renamed' } : x) },
        nest(c, id) { c.items = c.items.map(x => x.id === id ? { ...x, tags: [...x.tags, { id: 999, label: 'late' }] } : x) },
    },
}

describe('List update style parity (mutable x immutable matrix)', () => {
    let testContainer
    let cleanup
    let seq = 0

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    async function mount() {
        const name = `parity-${++seq}`
        wildflower.component(name, {
            state: { items: [item(1, 'alpha'), item(2, 'beta'), item(3, 'gamma')] }
        })
        testContainer.innerHTML = `
            <div data-component="${name}">
                <div class="l" data-list="items" data-key="id">
                    <template>
                        <div class="row" data-bind-attr="({ 'data-rid': id })">
                            <span class="nm" data-bind="name"></span>
                            <div class="tags" data-list="tags" data-key="id">
                                <template><i class="tag" data-bind="label"></i></template>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        `
        await waitForCompleteRender()
        const el = testContainer.querySelector('[data-component-id]')
        return wildflower.componentInstances.get(el.dataset.componentId).context
    }

    const domIds = () => Array.from(testContainer.querySelectorAll('.row')).map(r => Number(r.getAttribute('data-rid')))
    const rowByIdEl = (id) => testContainer.querySelector(`.row[data-rid="${id}"]`)

    for (const op of OPS) {
        for (const opStyle of ['mutable', 'immutable']) {
            for (const fuStyle of ['mutable', 'immutable']) {
                it(`${op.name} [op:${opStyle}] then follow-ups [${fuStyle}]`, async () => {
                    const ctx = await mount()

                    // 1) The operation, in its style
                    op[opStyle](ctx)
                    await waitForCompleteRender()
                    expect(domIds()).toEqual(op.after)
                    if (op.renamed) {
                        expect(rowByIdEl(op.renamed.id).querySelector('.nm').textContent).toBe(op.renamed.name)
                    }
                    if (op.nestedCount) {
                        expect(rowByIdEl(op.nestedCount.id).querySelectorAll('.tag')).toHaveLength(op.nestedCount.count)
                    }

                    // 2) Deafness probes: follow-up writes in the other axis's style
                    const fu = FOLLOWUPS[fuStyle]
                    fu.add(ctx)
                    await waitForCompleteRender()
                    expect(domIds()).toEqual([...op.after, 9])

                    if (op.survivor != null) {
                        fu.rename(ctx, op.survivor)
                        await waitForCompleteRender()
                        expect(rowByIdEl(op.survivor).querySelector('.nm').textContent).toBe('renamed')

                        const tagsBefore = rowByIdEl(op.survivor).querySelectorAll('.tag').length
                        fu.nest(ctx, op.survivor)
                        await waitForCompleteRender()
                        expect(rowByIdEl(op.survivor).querySelectorAll('.tag')).toHaveLength(tagsBefore + 1)
                    }

                    // 3) State/DOM convergence, final word
                    expect(domIds()).toEqual(ctx.items.map(x => x.id))
                })
            }
        }
    }
})

/**
 * Regime 2: IMPLICIT id-keying. A list with NO data-key attribute still keys
 * by 'id' when items carry one (ListRenderer keyProp default). Discovered the
 * hard way on 2026-07-25: "unkeyed" demo lists with id fields took the keyed
 * row-reuse path. This block pins that default with the full matrix — the
 * expectations are identical to the explicit-key block above, and that
 * IDENTITY is the assertion.
 */
describe('List update style parity — implicit id-keying (no data-key, items have ids)', () => {
    let testContainer
    let cleanup
    let seq = 100

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    async function mount() {
        const name = `parity-${++seq}`
        wildflower.component(name, {
            state: { items: [item(1, 'alpha'), item(2, 'beta'), item(3, 'gamma')] }
        })
        testContainer.innerHTML = `
            <div data-component="${name}">
                <div class="l" data-list="items">
                    <template>
                        <div class="row" data-bind-attr="({ 'data-rid': id })">
                            <span class="nm" data-bind="name"></span>
                            <div class="tags" data-list="tags">
                                <template><i class="tag" data-bind="label"></i></template>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        `
        await waitForCompleteRender()
        const el = testContainer.querySelector('[data-component-id]')
        return wildflower.componentInstances.get(el.dataset.componentId).context
    }

    const domIds = () => Array.from(testContainer.querySelectorAll('.row')).map(r => Number(r.getAttribute('data-rid')))
    const rowByIdEl = (id) => testContainer.querySelector(`.row[data-rid="${id}"]`)

    for (const op of OPS) {
        for (const opStyle of ['mutable', 'immutable']) {
            for (const fuStyle of ['mutable', 'immutable']) {
                it(`${op.name} [op:${opStyle}] then follow-ups [${fuStyle}]`, async () => {
                    const ctx = await mount()

                    op[opStyle](ctx)
                    await waitForCompleteRender()
                    expect(domIds()).toEqual(op.after)
                    if (op.renamed) {
                        expect(rowByIdEl(op.renamed.id).querySelector('.nm').textContent).toBe(op.renamed.name)
                    }
                    if (op.nestedCount) {
                        expect(rowByIdEl(op.nestedCount.id).querySelectorAll('.tag')).toHaveLength(op.nestedCount.count)
                    }

                    const fu = FOLLOWUPS[fuStyle]
                    fu.add(ctx)
                    await waitForCompleteRender()
                    expect(domIds()).toEqual([...op.after, 9])

                    if (op.survivor != null) {
                        fu.rename(ctx, op.survivor)
                        await waitForCompleteRender()
                        expect(rowByIdEl(op.survivor).querySelector('.nm').textContent).toBe('renamed')

                        const tagsBefore = rowByIdEl(op.survivor).querySelectorAll('.tag').length
                        fu.nest(ctx, op.survivor)
                        await waitForCompleteRender()
                        expect(rowByIdEl(op.survivor).querySelectorAll('.tag')).toHaveLength(tagsBefore + 1)
                    }

                    expect(domIds()).toEqual(ctx.items.map(x => x.id))
                })
            }
        }
    }
})

/**
 * Regime 3: POSITIONAL keying. No data-key AND id-less items — the keyProp
 * default finds no item.id, so keys fall back to the index. Structurally
 * different reconcile semantics: a whole-array replacement is N same-position
 * same-key updates (row reuse + rebind), a reorder is in-place rewrites rather
 * than DOM moves. The contract asserted here is deliberately semantics-
 * agnostic: after every operation and every follow-up, visible text order
 * equals state order. Identity is by NAME since there are no ids.
 */
const nitem = (name) => ({ name, tags: [{ label: `t-${name}` }] })

const OPS_POS = [
    {
        name: 'append',
        mutable(c) { c.items.push(nitem('delta')) },
        immutable(c) { c.items = [...c.items, nitem('delta')] },
        after: ['alpha', 'beta', 'gamma', 'delta'], survivor: 'beta'
    },
    {
        name: 'prepend',
        mutable(c) { c.items.unshift(nitem('delta')) },
        immutable(c) { c.items = [nitem('delta'), ...c.items] },
        after: ['delta', 'alpha', 'beta', 'gamma'], survivor: 'beta'
    },
    {
        name: 'remove-middle',
        mutable(c) { c.items.splice(1, 1) },
        immutable(c) { c.items = c.items.filter(x => x.name !== 'beta') },
        after: ['alpha', 'gamma'], survivor: 'gamma'
    },
    {
        name: 'remove-to-empty',
        mutable(c) { c.items.splice(0, c.items.length) },
        immutable(c) { c.items = [] },
        after: [], survivor: null
    },
    {
        name: 'reorder-reverse',
        mutable(c) { c.items.reverse() },
        immutable(c) { c.items = [...c.items].reverse() },
        after: ['gamma', 'beta', 'alpha'], survivor: 'beta'
    },
    {
        name: 'replace-one-same-position',
        mutable(c) { c.items[1] = { ...c.items[1], name: 'swapped' } },
        immutable(c) {
            const next = [...c.items]
            next[1] = { ...next[1], name: 'swapped' }
            c.items = next
        },
        after: ['alpha', 'swapped', 'gamma'], survivor: 'swapped'
    },
    {
        name: 'replace-all-same-positions',
        mutable(c) { for (let i = 0; i < c.items.length; i++) c.items[i] = { ...c.items[i], name: c.items[i].name + '!' } },
        immutable(c) { c.items = c.items.map(x => ({ ...x, name: x.name + '!' })) },
        after: ['alpha!', 'beta!', 'gamma!'], survivor: 'beta!'
    },
    {
        name: 'nested-field-update',
        mutable(c) { c.items[1].tags.push({ label: 'extra' }) },
        immutable(c) {
            const next = [...c.items]
            next[1] = { ...next[1], tags: [...next[1].tags, { label: 'extra' }] }
            c.items = next
        },
        after: ['alpha', 'beta', 'gamma'], survivor: 'beta', nestedCount: { name: 'beta', count: 2 }
    },
    {
        // See the keyed block's swap-first-last note: in the positional regime
        // this is the swap fast path's stale-key exposure.
        name: 'swap-first-last',
        mutable(c) { const t = c.items[0]; c.items[0] = c.items[2]; c.items[2] = t },
        immutable(c) { c.items = [c.items[2], c.items[1], c.items[0]] },
        after: ['gamma', 'beta', 'alpha'], survivor: 'beta'
    },
]

const FOLLOWUPS_POS = {
    mutable: {
        add(c) { c.items.push(nitem('omega')) },
        rename(c, name) { const r = c.items.find(x => x.name === name); r.name = 'renamed' },
        nest(c, name) { const r = c.items.find(x => x.name === name); r.tags.push({ label: 'late' }) },
    },
    immutable: {
        add(c) { c.items = [...c.items, nitem('omega')] },
        rename(c, name) { c.items = c.items.map(x => x.name === name ? { ...x, name: 'renamed' } : x) },
        nest(c, name) { c.items = c.items.map(x => x.name === name ? { ...x, tags: [...x.tags, { label: 'late' }] } : x) },
    },
}

describe('List update style parity — positional keying (no data-key, id-less items)', () => {
    let testContainer
    let cleanup
    let seq = 200

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    async function mount() {
        const name = `parity-${++seq}`
        wildflower.component(name, {
            state: { items: [nitem('alpha'), nitem('beta'), nitem('gamma')] }
        })
        testContainer.innerHTML = `
            <div data-component="${name}">
                <div class="l" data-list="items">
                    <template>
                        <div class="row">
                            <span class="nm" data-bind="name"></span>
                            <div class="tags" data-list="tags">
                                <template><i class="tag" data-bind="label"></i></template>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        `
        await waitForCompleteRender()
        const el = testContainer.querySelector('[data-component-id]')
        return wildflower.componentInstances.get(el.dataset.componentId).context
    }

    const domNames = () => Array.from(testContainer.querySelectorAll('.row .nm')).map(n => n.textContent)
    const rowByName = (name) => Array.from(testContainer.querySelectorAll('.row'))
        .find(r => r.querySelector('.nm').textContent === name)

    for (const op of OPS_POS) {
        for (const opStyle of ['mutable', 'immutable']) {
            for (const fuStyle of ['mutable', 'immutable']) {
                it(`${op.name} [op:${opStyle}] then follow-ups [${fuStyle}]`, async () => {
                    const ctx = await mount()

                    op[opStyle](ctx)
                    await waitForCompleteRender()
                    expect(domNames()).toEqual(op.after)
                    if (op.nestedCount) {
                        expect(rowByName(op.nestedCount.name).querySelectorAll('.tag')).toHaveLength(op.nestedCount.count)
                    }

                    const fu = FOLLOWUPS_POS[fuStyle]
                    fu.add(ctx)
                    await waitForCompleteRender()
                    expect(domNames()).toEqual([...op.after, 'omega'])

                    if (op.survivor != null) {
                        fu.rename(ctx, op.survivor)
                        await waitForCompleteRender()
                        expect(rowByName('renamed')).toBeTruthy()

                        const tagsBefore = rowByName('renamed').querySelectorAll('.tag').length
                        fu.nest(ctx, 'renamed')
                        await waitForCompleteRender()
                        expect(rowByName('renamed').querySelectorAll('.tag')).toHaveLength(tagsBefore + 1)
                    }

                    expect(domNames()).toEqual(ctx.items.map(x => x.name))
                })
            }
        }
    }
})
