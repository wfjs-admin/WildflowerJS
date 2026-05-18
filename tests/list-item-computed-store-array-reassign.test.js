/**
 * Item-level computed inside a list re-runs when an EXTERNAL store's
 * array is REASSIGNED, even when the parent list's iterated rows keep
 * the same identity.
 *
 * This is the project-management-internal demo scenario:
 *
 *   - List iterates parent issues (filter excludes subtasks)
 *   - Each row has an item-level computed `subCount` that reads
 *     `wildflower.getStore('items').children(this.id)` — counts
 *     subtasks of this parent
 *   - User adds a subtask via store: `items = items.concat([newSub])`
 *
 * Because the parent rows' identities haven't changed (the new row is a
 * subtask, filtered out of `issuesForProject`), mapArray's per-row
 * identity check sees "no list change" and may skip re-running the
 * per-item effect that contains `subCount`. Result: the badge doesn't
 * update until something else triggers a render.
 *
 * Coverage for this pattern doesn't exist yet:
 *   - list-item-computed-other-binding-gaps.test.js: same-component
 *     nested-state mutation, not external store
 *   - cross-store-dependencies.test.js: COMPONENT-level computed reading
 *     external store, or list contents that grow with the mutation
 *
 * Symptom: `result wildflower-pool-…` 09_clear_x8 medians; demo-side
 * "subtask badge appears 5–6s after add" matches the toast 5000ms
 * auto-dismiss tick.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Item-level computed reacts to external-store array reassignment', () => {
    let testContainer
    let cleanup

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    it('per-row badge updates when an unrelated store row is added (parent rows unchanged)', async () => {
        // Store mirrors the PM shape: a single flat `items` array containing
        // both parent issues and child subtasks. children() returns those
        // whose .parent matches.
        wildflower.store('items', {
            state: {
                items: [
                    { id: 'p1', name: 'Parent 1', parent: null },
                    { id: 'p2', name: 'Parent 2', parent: null },
                    { id: 's1', name: 'Sub of P1', parent: 'p1' }
                ]
            },
            children(parentId) {
                return this.items.filter(function (i) { return i.parent === parentId })
            }
        })

        wildflower.component('parent-list', {
            subscribe: { items: ['items'] },
            computed: {
                // Component-level: filter to parents. Returns the same row
                // refs straight from the store, so per-row identity is
                // stable across a child-only store mutation.
                parents() {
                    return this.stores.items.items.filter(function (i) { return i.parent === null })
                },

                // Item-level: count this row's children. Reads the store
                // via getStore() to register a cross-entity dep.
                subCount(row) {
                    if (!row || row.id === undefined) return ''
                    return String(wildflower.getStore('items').children(row.id).length)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="parent-list">
                <ul data-list="parents" data-key="id">
                    <template>
                        <li>
                            <span class="name" data-bind="name"></span>
                            <span class="badge" data-bind="subCount"></span>
                        </li>
                    </template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        const badges = () => Array.from(testContainer.querySelectorAll('.badge')).map(b => b.textContent)
        expect(badges()).toEqual(['1', '0'])

        // === Mutation A: REASSIGN the array (the PM internal demo path)
        // Add a subtask of p2 by reassigning items. Parent row identities
        // are unchanged because the existing parent objects are kept.
        const store = wildflower.getStore('items')
        store.items = store.items.concat([{ id: 's2', name: 'Sub of P2', parent: 'p2' }])
        await waitForCompleteRender()

        // p2's badge should update from '0' to '1'. p1 stays at '1'.
        expect(badges()).toEqual(['1', '1'])

        // === Mutation B: REASSIGN again, adding another sub of p1
        store.items = store.items.concat([{ id: 's3', name: 'Sub of P1 again', parent: 'p1' }])
        await waitForCompleteRender()

        // p1 should be '2', p2 stays at '1'.
        expect(badges()).toEqual(['2', '1'])

        // === Mutation C: REASSIGN with removal. Drop s2.
        store.items = store.items.filter(function (i) { return i.id !== 's2' })
        await waitForCompleteRender()

        // p2 back to '0', p1 stays at '2'.
        expect(badges()).toEqual(['2', '0'])
    })

    it('per-row badge updates when the store array is mutated in place (.push / .splice)', async () => {
        // Control case: same scenario but using direct mutation. WF's
        // ArrayOperationDetector is supposed to make this the cheap path.
        // Asserting it works keeps the test honest — if THIS one fails we
        // have a deeper problem than the reassignment path.
        wildflower.store('items2', {
            state: {
                items: [
                    { id: 'p1', name: 'Parent 1', parent: null },
                    { id: 'p2', name: 'Parent 2', parent: null }
                ]
            },
            children(parentId) {
                return this.items.filter(function (i) { return i.parent === parentId })
            }
        })

        wildflower.component('parent-list-2', {
            subscribe: { items2: ['items'] },
            computed: {
                parents() {
                    return this.stores.items2.items.filter(function (i) { return i.parent === null })
                },
                subCount(row) {
                    if (!row || row.id === undefined) return ''
                    return String(wildflower.getStore('items2').children(row.id).length)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="parent-list-2">
                <ul data-list="parents" data-key="id">
                    <template>
                        <li>
                            <span class="badge" data-bind="subCount"></span>
                        </li>
                    </template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        const badges = () => Array.from(testContainer.querySelectorAll('.badge')).map(b => b.textContent)
        expect(badges()).toEqual(['0', '0'])

        const store = wildflower.getStore('items2')
        store.items.push({ id: 's1', name: 'Sub of P2', parent: 'p2' })
        await waitForCompleteRender()
        expect(badges()).toEqual(['0', '1'])
    })

    it('CONTROL: component-level computed DOES update on same external mutation', async () => {
        // Same store / mutation shape as case 1, but the badge is sourced
        // from a COMPONENT-level computed instead of an item-level one.
        // Expectation: this works today. If it doesn't, the bug is bigger
        // than item-effect scope — it's full cross-entity tracking.
        wildflower.store('itemsC', {
            state: {
                items: [
                    { id: 'p1', parent: null }, { id: 'p2', parent: null },
                    { id: 's1', parent: 'p1' }
                ]
            },
            childCount(parentId) {
                return this.items.filter(function (i) { return i.parent === parentId }).length
            }
        })

        wildflower.component('parent-list-c', {
            subscribe: { itemsC: ['items'] },
            computed: {
                parents() {
                    return this.stores.itemsC.items.filter(function (i) { return i.parent === null })
                },
                p1Count() { return String(wildflower.getStore('itemsC').childCount('p1')) },
                p2Count() { return String(wildflower.getStore('itemsC').childCount('p2')) }
            }
        })

        testContainer.innerHTML = `
            <div data-component="parent-list-c">
                <span class="b1" data-bind="p1Count"></span>
                <span class="b2" data-bind="p2Count"></span>
            </div>
        `
        await waitForCompleteRender()
        const b = () => [
            testContainer.querySelector('.b1').textContent,
            testContainer.querySelector('.b2').textContent
        ]
        expect(b()).toEqual(['1', '0'])

        const store = wildflower.getStore('itemsC')
        store.items = store.items.concat([{ id: 's2', parent: 'p2' }])
        await waitForCompleteRender()
        expect(b()).toEqual(['1', '1'])
    })

    it('per-row property mutation on a row not in the iterated list (reads external store)', async () => {
        // The row template iterates parents. The row's item-level computed
        // reads a property off a sibling (subtask) row in the same store.
        // We mutate that subtask row's property in place — no array change,
        // no parent-row identity change. Does the item-effect re-run?
        wildflower.store('itemsD', {
            state: {
                items: [
                    { id: 'p1', parent: null },
                    { id: 'p2', parent: null },
                    { id: 's1', parent: 'p1', label: 'one' },
                    { id: 's2', parent: 'p2', label: 'two' }
                ]
            },
            firstChildLabel(parentId) {
                const c = this.items.find(function (i) { return i.parent === parentId })
                return c ? c.label : ''
            }
        })

        wildflower.component('parent-list-d', {
            subscribe: { itemsD: ['items'] },
            computed: {
                parents() {
                    return this.stores.itemsD.items.filter(function (i) { return i.parent === null })
                },
                childLabel(row) {
                    if (!row || row.id === undefined) return ''
                    return wildflower.getStore('itemsD').firstChildLabel(row.id)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="parent-list-d">
                <ul data-list="parents" data-key="id">
                    <template><li><span class="lab" data-bind="childLabel"></span></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()
        const labs = () => Array.from(testContainer.querySelectorAll('.lab')).map(b => b.textContent)
        expect(labs()).toEqual(['one', 'two'])

        const store = wildflower.getStore('itemsD')
        // Mutate a non-iterated row's property in place
        const s1 = store.items.find(function (i) { return i.id === 's1' })
        s1.label = 'ONE'
        await waitForCompleteRender()
        expect(labs()).toEqual(['ONE', 'two'])
    })

    it('reorder of iterated rows preserves badge<->row pairing on external-store-derived computed', async () => {
        // Reordering the parent list. Since identities are preserved,
        // mapArray should keep effects bound to the same rows. This is
        // mostly a control to ensure any fix doesn't break reorder.
        wildflower.store('itemsE', {
            state: {
                items: [
                    { id: 'p1', parent: null }, { id: 'p2', parent: null },
                    { id: 's1', parent: 'p1' }, { id: 's2', parent: 'p2' }, { id: 's3', parent: 'p2' }
                ]
            },
            children(parentId) {
                return this.items.filter(function (i) { return i.parent === parentId })
            }
        })

        wildflower.component('parent-list-e', {
            subscribe: { itemsE: ['items'] },
            computed: {
                parents() {
                    return this.stores.itemsE.items.filter(function (i) { return i.parent === null })
                },
                subCount(row) {
                    if (!row || row.id === undefined) return ''
                    return String(wildflower.getStore('itemsE').children(row.id).length)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="parent-list-e">
                <ul data-list="parents" data-key="id">
                    <template><li><span class="i" data-bind="id"></span>:<span class="b" data-bind="subCount"></span></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()
        const pairs = () => Array.from(testContainer.querySelectorAll('li')).map(li => [
            li.querySelector('.i').textContent, li.querySelector('.b').textContent
        ])
        expect(pairs()).toEqual([['p1','1'], ['p2','2']])

        // Reverse the parent rows (still no array growth, same identities)
        const store = wildflower.getStore('itemsE')
        const reversed = store.items.slice().reverse()
        store.items = reversed
        await waitForCompleteRender()
        expect(pairs()).toEqual([['p2','2'], ['p1','1']])
    })

    it('keyed-lookup computed: reads store.itemsById[this.id]', async () => {
        // Different shape — computed reads a specific keyed slot on an
        // external map, not a filtered reduction over an array. This is
        // the case where Option 1 (per-item dep tracking) would give
        // precision over Option 2 (regenerate all rows).
        wildflower.store('itemsF', {
            state: {
                rows: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
                meta: { p1: 'A', p2: 'B', p3: 'C' }
            }
        })

        wildflower.component('parent-list-f', {
            subscribe: { itemsF: ['rows', 'meta'] },
            computed: {
                rows() { return this.stores.itemsF.rows },
                myMeta(row) {
                    if (!row || row.id === undefined) return ''
                    return wildflower.getStore('itemsF').meta[row.id] || ''
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="parent-list-f">
                <ul data-list="rows" data-key="id">
                    <template><li><span class="m" data-bind="myMeta"></span></li></template>
                </ul>
            </div>
        `
        await waitForCompleteRender()
        const metas = () => Array.from(testContainer.querySelectorAll('.m')).map(b => b.textContent)
        expect(metas()).toEqual(['A', 'B', 'C'])

        // Mutate just one slot — only the matching row should need re-eval
        const store = wildflower.getStore('itemsF')
        store.meta = Object.assign({}, store.meta, { p2: 'BB' })
        await waitForCompleteRender()
        expect(metas()).toEqual(['A', 'BB', 'C'])
    })
})
