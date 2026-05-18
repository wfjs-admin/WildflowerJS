/**
 * Regression test: nested data-list intermittent render after post-mount store hydration.
 *
 * Repro from test-cases/nested-data-list-intermittent-render.html. The bug was that
 * the outer list's context.data was only refreshed by _renderList, never by mapArray's
 * reactive structural effect. When a store hydrated AFTER the initial empty render,
 * mapArray would invoke the per-item mapFn with the new items, but
 * context.createChildContext(index, childPath) read the stale empty context.data,
 * returned null, and the inner data-list never received a context — so inner items
 * never rendered. The bug was timing-dependent (~10–25% on full reload) because the
 * race depended on whether the first framework render cycle ran before or after the
 * setTimeout(hydrate) macrotask.
 *
 * Trigger conditions (all required):
 *   1. Nested data-list (outer iterates groups, inner iterates per-group items).
 *   2. Inner-list items attached to the outer item (item.rows).
 *   3. Outer wrapped in data-show.
 *   4. Store data populated after component mount (setTimeout/async).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Nested data-list with post-mount store hydration', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    function buildIssues() {
        const statuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done']
        const out = []
        for (let i = 0; i < 70; i++) {
            const labels = []
            const n = 1 + (i % 3)
            for (let k = 0; k < n; k++) {
                labels.push({ id: 'l-' + ((i + k) % 5), name: 'lab' + k })
            }
            out.push({
                id: 'i-' + i,
                ref: 'A-' + (i + 1),
                title: 'Issue ' + (i + 1),
                status: statuses[i % statuses.length],
                priority: i % 5,
                labels
            })
        }
        return out
    }

    it('renders inner list after store hydrates post-mount (with data-show wrapper)', async () => {
        wildflower.store('hydrate-repro-1', {
            state: { issues: [], statuses: [] },
            hydrate() {
                this.statuses = [
                    { id: 'backlog', name: 'Backlog' },
                    { id: 'todo', name: 'Todo' },
                    { id: 'in_progress', name: 'In Progress' },
                    { id: 'in_review', name: 'In Review' },
                    { id: 'done', name: 'Done' }
                ]
                this.issues = buildIssues()
            }
        })

        wildflower.component('hydrate-repro-app-1', {
            subscribe: { 'hydrate-repro-1': ['issues', 'statuses'] },
            state: { visible: false },
            init() {
                const self = this
                setTimeout(() => { self.state.visible = true }, 0)
            },
            computed: {
                groups() {
                    const pm = this.stores['hydrate-repro-1']
                    const byStatus = {}
                    for (const r of pm.issues) {
                        (byStatus[r.status] = byStatus[r.status] || []).push(r)
                    }
                    const out = []
                    for (const st of pm.statuses) {
                        const bucket = byStatus[st.id] || []
                        if (bucket.length === 0) continue
                        out.push({ status: st.id, statusName: st.name, count: bucket.length, rows: bucket })
                    }
                    return out
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="hydrate-repro-app-1">
                <section data-show="visible">
                    <div data-list="groups" data-key="status">
                        <template>
                            <div class="group">
                                <div class="group-header">
                                    <span class="status-name" data-bind="statusName"></span>
                                </div>
                                <div data-list="rows" data-key="id">
                                    <template>
                                        <div class="row">
                                            <span class="row-ref" data-bind="ref"></span>
                                            <span class="labels" data-list="labels" data-key="id">
                                                <template>
                                                    <span class="label" data-bind="name"></span>
                                                </template>
                                            </span>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </section>
            </div>
        `

        wildflower.scan()

        // Hydrate AFTER mount, mirroring autoSave/route-handler timing.
        setTimeout(() => {
            wildflower.getStore('hydrate-repro-1').hydrate()
        }, 0)

        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 30))
        await waitForCompleteRender()

        const headers = testContainer.querySelectorAll('.group-header')
        const rows = testContainer.querySelectorAll('.row')
        const labels = testContainer.querySelectorAll('.label')

        // 5 status groups, 70 issues, 1-3 labels per issue (140 total: i%3 = 1,2,0 => actual avg 2)
        expect(headers.length).toBe(5)
        expect(rows.length).toBe(70)
        expect(labels.length).toBeGreaterThan(0)
    })

    /*
     * Bug repro at full-feature parity with the test-cases HTML file. Runs the
     * full mount-then-hydrate flow many times within one test to catch the
     * race even on systems where ordering differs from the original ~25% rate.
     */
    it('renders inner list across many mount/hydrate cycles', async () => {
        wildflower.store('hydrate-repro-2', {
            state: { items: [] },
            hydrate() {
                this.items = [
                    { id: 'g1', name: 'group-1', rows: [
                        { id: 'r1', label: 'a' },
                        { id: 'r2', label: 'b' }
                    ]},
                    { id: 'g2', name: 'group-2', rows: [
                        { id: 'r3', label: 'c' }
                    ]}
                ]
            }
        })

        wildflower.component('hydrate-repro-app-2', {
            subscribe: { 'hydrate-repro-2': ['items'] },
            state: { ready: false },
            init() {
                const self = this
                setTimeout(() => { self.state.ready = true }, 0)
            },
            computed: {
                groups() {
                    return this.stores['hydrate-repro-2'].items
                }
            }
        })

        const ITERATIONS = 10
        for (let iter = 0; iter < ITERATIONS; iter++) {
            // Reset store to empty before each iteration so the race is re-armed.
            const store = wildflower.getStore('hydrate-repro-2')
            store.items = []

            testContainer.innerHTML = `
                <div data-component="hydrate-repro-app-2" id="repro-app-${iter}">
                    <section data-show="ready">
                        <div data-list="groups" data-key="id">
                            <template>
                                <div class="g">
                                    <span class="g-name" data-bind="name"></span>
                                    <div data-list="rows" data-key="id">
                                        <template>
                                            <span class="r" data-bind="label"></span>
                                        </template>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </section>
                </div>
            `

            wildflower.scan()

            // Hydrate post-mount, exactly as the production race surfaces.
            setTimeout(() => { store.hydrate() }, 0)

            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 20))
            await waitForCompleteRender()

            const groups = testContainer.querySelectorAll('.g')
            const rows = testContainer.querySelectorAll('.r')

            expect(groups.length, `iter ${iter}: outer groups`).toBe(2)
            expect(rows.length, `iter ${iter}: inner rows`).toBe(3)
        }
    })
})
