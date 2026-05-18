/**
 * Nested data-list whose source array is an item-level computed property.
 *
 * Background: data-bind inside a list template falls back to implicit
 * computed evaluation when item[path] is undefined (ListItemBinding.js
 * line 301-303). data-list for nested arrays previously read the array
 * directly off the parent item with no fallback (ListNestedManager.js
 * line 211 and 35), so an item-level computed could not be used as a
 * nested-list source. This test locks in the symmetry fix.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Nested data-list source via item-level computed', () => {
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

    it('renders nested list whose source is a parameterised item-level computed', async () => {
        wildflower.component('nested-computed-source-bare', {
            state: {
                groups: [
                    { id: 'g1', name: 'Group 1', tagIds: ['t1', 't2'] },
                    { id: 'g2', name: 'Group 2', tagIds: ['t3'] }
                ],
                tags: {
                    t1: { id: 't1', label: 'alpha' },
                    t2: { id: 't2', label: 'beta' },
                    t3: { id: 't3', label: 'gamma' }
                }
            },
            computed: {
                // Item-level computed: receives the outer-list's current group.
                tagObjects(group) {
                    if (!group || group.tagIds === undefined) return []
                    var lookup = window.__nestedTestLookup
                    return group.tagIds.map(function (id) { return lookup[id] })
                }
            }
        })

        // Simple lookup table the computed reads. Stored on window so the
        // computed has a stable reference unrelated to component state.
        window.__nestedTestLookup = {
            t1: { id: 't1', label: 'alpha' },
            t2: { id: 't2', label: 'beta' },
            t3: { id: 't3', label: 'gamma' }
        }

        testContainer.innerHTML = `
            <div data-component="nested-computed-source-bare">
                <ul class="groups" data-list="groups" data-key="id">
                    <template>
                        <li class="group">
                            <span class="group-name" data-bind="name"></span>
                            <ul class="tags" data-list="tagObjects" data-key="id">
                                <template>
                                    <li class="tag" data-bind="label"></li>
                                </template>
                            </ul>
                        </li>
                    </template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        const groups = testContainer.querySelectorAll('li.group')
        expect(groups.length).toBe(2)

        const g1Tags = groups[0].querySelectorAll('li.tag')
        expect(g1Tags.length).toBe(2)
        expect(g1Tags[0].textContent).toBe('alpha')
        expect(g1Tags[1].textContent).toBe('beta')

        const g2Tags = groups[1].querySelectorAll('li.tag')
        expect(g2Tags.length).toBe(1)
        expect(g2Tags[0].textContent).toBe('gamma')

        delete window.__nestedTestLookup
    })

    it('renders nested list whose source is a parameterized item-level computed (fn(item))', async () => {
        wildflower.component('nested-computed-source-param', {
            state: {
                groups: [
                    { id: 'g1', name: 'Group 1', count: 3 },
                    { id: 'g2', name: 'Group 2', count: 1 }
                ]
            },
            computed: {
                // Parameterized item-level form (fn.length > 0).
                rangeItems(item) {
                    var out = []
                    for (var i = 1; i <= item.count; i++) {
                        out.push({ id: item.id + '-' + i, label: 'n' + i })
                    }
                    return out
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="nested-computed-source-param">
                <ul class="groups" data-list="groups" data-key="id">
                    <template>
                        <li class="group">
                            <span class="group-name" data-bind="name"></span>
                            <ul class="nums" data-list="rangeItems" data-key="id">
                                <template>
                                    <li class="num" data-bind="label"></li>
                                </template>
                            </ul>
                        </li>
                    </template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        const groups = testContainer.querySelectorAll('li.group')
        expect(groups.length).toBe(2)

        const g1Nums = groups[0].querySelectorAll('li.num')
        expect(g1Nums.length).toBe(3)
        expect(Array.from(g1Nums).map(n => n.textContent)).toEqual(['n1', 'n2', 'n3'])

        const g2Nums = groups[1].querySelectorAll('li.num')
        expect(g2Nums.length).toBe(1)
        expect(g2Nums[0].textContent).toBe('n1')
    })

    // Action handlers fired from inside a nested data-list whose source is an
    // item-level computed must receive the correct item in details. The
    // action-dispatch path resolves the inner list's data the same way the
    // rendering path does, including the item-level computed fallback when
    // the parent item has no own field of that name.
    it('action handler in nested list with item-computed source receives the correct details.item', async () => {
        let captured = null

        wildflower.component('action-in-nested-computed', {
            state: {
                groups: [
                    { id: 'g1', name: 'Group 1', count: 3 },
                    { id: 'g2', name: 'Group 2', count: 1 }
                ]
            },
            computed: {
                rangeItems(item) {
                    var out = []
                    for (var i = 1; i <= item.count; i++) {
                        out.push({ id: item.id + '-' + i, label: 'n' + i })
                    }
                    return out
                }
            },
            pickItem(event, element, details) {
                captured = details && details.item ? Object.assign({}, details.item) : null
            }
        })

        testContainer.innerHTML = `
            <div data-component="action-in-nested-computed">
                <ul data-list="groups" data-key="id">
                    <template>
                        <li class="group">
                            <ul data-list="rangeItems" data-key="id">
                                <template>
                                    <li>
                                        <button class="pick" data-action="pickItem" data-bind="label" type="button"></button>
                                    </li>
                                </template>
                            </ul>
                        </li>
                    </template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        const buttons = testContainer.querySelectorAll('button.pick')
        // Three chips on group 1 + one on group 2 = 4 total.
        expect(buttons.length).toBe(4)

        // Click the second chip on group 1 (id 'g1-2' / label 'n2').
        buttons[1].click()
        await waitForCompleteRender()

        expect(captured).not.toBeNull()
        expect(captured.id).toBe('g1-2')
        expect(captured.label).toBe('n2')

        // Click the only chip on group 2 to confirm the parent index is also
        // resolved correctly when the item lives in a different parent row.
        buttons[3].click()
        await waitForCompleteRender()

        expect(captured.id).toBe('g2-1')
        expect(captured.label).toBe('n1')
    })

    it('action handler in double-nested list with item-computed sources at both levels resolves details.item', async () => {
        let captured = null

        wildflower.component('action-in-deep-nested-computed', {
            state: {
                projects: [
                    { id: 'p1', name: 'Project 1', issueCount: 2, repliesPerIssue: 2 },
                    { id: 'p2', name: 'Project 2', issueCount: 1, repliesPerIssue: 1 }
                ]
            },
            computed: {
                issueRows(project) {
                    var out = []
                    for (var i = 1; i <= project.issueCount; i++) {
                        out.push({
                            id: project.id + '-i' + i,
                            title: 'Issue ' + i,
                            // Carry the parent's reply count so the next-level
                            // computed has something to read.
                            _replies: project.repliesPerIssue
                        })
                    }
                    return out
                },
                replyChips(issue) {
                    var out = []
                    for (var i = 1; i <= issue._replies; i++) {
                        out.push({ id: issue.id + '-r' + i, label: 'r' + i })
                    }
                    return out
                }
            },
            pickReply(event, element, details) {
                captured = details && details.item ? Object.assign({}, details.item) : null
            }
        })

        testContainer.innerHTML = `
            <div data-component="action-in-deep-nested-computed">
                <ul data-list="projects" data-key="id">
                    <template>
                        <li class="project">
                            <ul data-list="issueRows" data-key="id">
                                <template>
                                    <li class="issue">
                                        <ul data-list="replyChips" data-key="id">
                                            <template>
                                                <li>
                                                    <button class="reply" data-action="pickReply" data-bind="label" type="button"></button>
                                                </li>
                                            </template>
                                        </ul>
                                    </li>
                                </template>
                            </ul>
                        </li>
                    </template>
                </ul>
            </div>
        `
        await waitForCompleteRender()

        // p1: 2 issues × 2 replies = 4 buttons; p2: 1 issue × 1 reply = 1.
        const buttons = testContainer.querySelectorAll('button.reply')
        expect(buttons.length).toBe(5)

        // Click the second reply on the second issue of project 1.
        buttons[3].click()
        await waitForCompleteRender()

        expect(captured).not.toBeNull()
        expect(captured.id).toBe('p1-i2-r2')
        expect(captured.label).toBe('r2')

        // Click the only reply on the only issue of project 2.
        buttons[4].click()
        await waitForCompleteRender()

        expect(captured.id).toBe('p2-i1-r1')
        expect(captured.label).toBe('r1')
    })
})
