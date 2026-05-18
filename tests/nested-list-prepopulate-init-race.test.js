/**
 * Regression test: nested data-list inner renders on first paint when multiple
 * components are scanned together.
 *
 * Bug: _scanForComponentsAsync ran component features (creating render effects
 * that fire synchronously) before _setupListContexts populated _listRelationships.
 * The first batch of components rendered with hasChildLists=false, so
 * _processNestedListsForItem was never invoked for outer-list items — section
 * headers appeared but inner rows stayed as bare <template> elements.
 *
 * Surfaced in www/demos/project-management on cold load with #/project/p-mobile,
 * ~7/10 fail rate in Firefox. Originally misdiagnosed as a hash-route race; the
 * actual trigger is multi-component scan where pm-issue-list's outer groups
 * list renders during the sprint phase before any component's SLC has run.
 *
 * Fix: _prepopulateListRelationships walks the entire root once before any
 * features run, so _listRelationships is fully populated before the first
 * render effect fires.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Nested data-list multi-component scan init race', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'prepop-test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    it('renders inner data-list on cold scan when multiple components share the page', async () => {
        wildflower.store('prepop-store', {
            state: {
                groups: [
                    { id: 'g1', name: 'Group One',   rows: [
                        { id: 'r1', label: 'one',   tags: [{ id: 't1', name: 'a' }, { id: 't2', name: 'b' }] },
                        { id: 'r2', label: 'two',   tags: [{ id: 't3', name: 'c' }] }
                    ]},
                    { id: 'g2', name: 'Group Two',   rows: [
                        { id: 'r3', label: 'three', tags: [{ id: 't4', name: 'd' }] }
                    ]},
                    { id: 'g3', name: 'Group Three', rows: [
                        { id: 'r4', label: 'four',  tags: [{ id: 't5', name: 'e' }, { id: 't6', name: 'f' }] }
                    ]}
                ]
            }
        })

        // Container component — analogous to pm-app. Its presence forces the
        // affected nested-list component to be processed alongside siblings,
        // which is what hits the scan ordering bug.
        wildflower.component('prepop-shell', {
            subscribe: { 'prepop-store': ['groups'] }
        })

        // Sibling components scanned alongside the inner-list component.
        // We need several of these so the affected component lands inside
        // the sprint window of the async scan, where the bug surfaces.
        for (let i = 0; i < 4; i++) {
            wildflower.component(`prepop-sibling-${i}`, {
                state: { value: i }
            })
        }

        // The component with the three-deep nested data-list (groups -> rows -> tags).
        wildflower.component('prepop-list', {
            subscribe: { 'prepop-store': ['groups'] },
            computed: {
                groups() { return this.stores['prepop-store'].groups }
            }
        })

        testContainer.innerHTML = `
            <div data-component="prepop-shell">
                <div data-component="prepop-sibling-0"></div>
                <div data-component="prepop-sibling-1"></div>
                <div data-component="prepop-list">
                    <div data-list="groups" data-key="id">
                        <template>
                            <section class="prepop-group">
                                <header class="prepop-group-name" data-bind="name"></header>
                                <div data-list="rows" data-key="id">
                                    <template>
                                        <div class="prepop-row">
                                            <span class="prepop-label" data-bind="label"></span>
                                            <span class="prepop-tags" data-list="tags" data-key="id">
                                                <template>
                                                    <span class="prepop-tag" data-bind="name"></span>
                                                </template>
                                            </span>
                                        </div>
                                    </template>
                                </div>
                            </section>
                        </template>
                    </div>
                </div>
                <div data-component="prepop-sibling-2"></div>
                <div data-component="prepop-sibling-3"></div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const headers = testContainer.querySelectorAll('.prepop-group-name')
        const rows    = testContainer.querySelectorAll('.prepop-row')
        const tags    = testContainer.querySelectorAll('.prepop-tag')

        // 3 groups, 4 rows, 6 tags (2+1+1+2)
        expect(headers.length).toBe(3)
        expect(rows.length).toBe(4)
        expect(tags.length).toBe(6)
    })

    /*
     * Same shape, repeated many times to force the race even when ordering
     * happens to be benign on a given run. Pre-fix this loop reliably failed
     * on at least one iteration; post-fix all iterations render fully.
     */
    it('renders inner data-list across repeated cold mounts (race repro)', async () => {
        wildflower.store('prepop-loop-store', {
            state: {
                groups: [
                    { id: 'g1', name: 'A', rows: [{ id: 'r1', label: 'one' }, { id: 'r2', label: 'two' }] },
                    { id: 'g2', name: 'B', rows: [{ id: 'r3', label: 'three' }] }
                ]
            }
        })

        wildflower.component('prepop-loop-shell', {
            subscribe: { 'prepop-loop-store': ['groups'] }
        })
        for (let i = 0; i < 4; i++) {
            wildflower.component(`prepop-loop-sibling-${i}`, { state: { value: i } })
        }
        wildflower.component('prepop-loop-list', {
            subscribe: { 'prepop-loop-store': ['groups'] },
            computed: {
                groups() { return this.stores['prepop-loop-store'].groups }
            }
        })

        const ITERATIONS = 15
        for (let iter = 0; iter < ITERATIONS; iter++) {
            testContainer.innerHTML = `
                <div data-component="prepop-loop-shell" id="loop-${iter}">
                    <div data-component="prepop-loop-sibling-0"></div>
                    <div data-component="prepop-loop-sibling-1"></div>
                    <div data-component="prepop-loop-list">
                        <div data-list="groups" data-key="id">
                            <template>
                                <section class="loop-group">
                                    <header class="loop-name" data-bind="name"></header>
                                    <div data-list="rows" data-key="id">
                                        <template>
                                            <div class="loop-row" data-bind="label"></div>
                                        </template>
                                    </div>
                                </section>
                            </template>
                        </div>
                    </div>
                    <div data-component="prepop-loop-sibling-2"></div>
                    <div data-component="prepop-loop-sibling-3"></div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const groups = testContainer.querySelectorAll('.loop-group')
            const rows = testContainer.querySelectorAll('.loop-row')
            expect(groups.length, `iter ${iter} groups`).toBe(2)
            expect(rows.length,   `iter ${iter} rows`).toBe(3)
        }
    })
})
