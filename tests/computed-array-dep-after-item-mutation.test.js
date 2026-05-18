/**
 * @vitest-environment browser
 *
 * Regression test for: computed loses its array-root dep after a re-eval
 * triggered by an item-property mutation, causing subsequent splice operations
 * to fail to dirty the computed.
 *
 * The integration-showcase-wf demo exhibits this bug; the templates.html demo
 * does not. This test pairs the two patterns to isolate the trigger.
 *
 * See docs/future/COMPUTED_DROPS_ARRAY_ROOT_DEP_ON_ITEM_RE_EVAL.md
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function setupComponent(wildflower, testContainer, html) {
    testContainer.innerHTML = html
    wildflower.scan()
    await waitForUpdate()
    const componentEl = testContainer.querySelector('[data-component]')
    const componentId = componentEl?.dataset?.componentId
    return componentId ? wildflower.componentInstances.get(componentId) : null
}

describe('Computed re-evaluation: array-root dep after item-property mutation', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        if (wildflower.componentDefinitions) wildflower.componentDefinitions.clear()
        if (wildflower.componentInstances) wildflower.componentInstances.clear()

        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    it('FAILING: integration-showcase exact bindings (class + text on LI, action toggle, findIndex/splice)', async () => {
        let countEvals = 0
        let completedEvals = 0

        wildflower.component('integration-pattern', {
            state: {
                tasks: [
                    { id: 1, text: 'a', done: false },
                    { id: 2, text: 'b', done: false },
                    { id: 3, text: 'c', done: true }
                ]
            },
            computed: {
                count() { countEvals++; return this.tasks.length },
                completed() { completedEvals++; return this.tasks.filter(t => t.done).length }
            },
            // Action-based toggle (matches integration-showcase-wf)
            toggleTask(event, element, details) {
                details.item.done = !details.item.done
            },
            // findIndex + splice (matches integration-showcase-wf)
            removeTask(event, element, details) {
                const i = this.tasks.findIndex(t => t.id === details.item.id)
                if (i !== -1) this.tasks.splice(i, 1)
            }
        })

        // Match integration demo's exact LI bindings: data-bind-class + data-bind text
        const component = await setupComponent(wildflower, testContainer, `
            <div data-component="integration-pattern">
                <ul data-list="tasks" data-key="id">
                    <template>
                        <li class="js-item" data-bind-class="{ done: done }">
                            <span class="js-checkbox" data-action="toggleTask"></span>
                            <span class="js-text" data-bind="text"></span>
                            <span class="js-remove" data-action="removeTask">x</span>
                        </li>
                    </template>
                </ul>
                <span class="js-count" data-bind="count"></span>
                <span class="js-completed" data-bind="completed"></span>
            </div>
        `)

        expect(testContainer.querySelector('.js-count').textContent).toBe('3')

        // Toggle first row's done property via action
        testContainer.querySelector('.js-item:first-child .js-checkbox').click()
        await waitForUpdate()
        expect(testContainer.querySelector('.js-completed').textContent).toBe('2')

        const countAfterToggle = countEvals
        const completedAfterToggle = completedEvals

        // Remove second row via action (uses findIndex + splice)
        testContainer.querySelectorAll('.js-item')[1].querySelector('.js-remove').click()
        await waitForUpdate()

        expect(component.state.tasks.length).toBe(2)
        // Both computeds should re-evaluate
        expect(countEvals).toBeGreaterThan(countAfterToggle)
        expect(completedEvals).toBeGreaterThan(completedAfterToggle)
        expect(testContainer.querySelector('.js-count').textContent).toBe('2')
    })

    it('FAILING: demo with tasks watcher (matches integration-showcase-wf init)', async () => {
        let countEvals = 0
        let completedEvals = 0
        let watcherFireCount = 0

        wildflower.component('demo-with-watcher', {
            state: {
                tasks: [
                    { id: 1, done: false },
                    { id: 2, done: false },
                    { id: 3, done: false },
                    { id: 4, done: true }
                ]
            },
            computed: {
                count() { countEvals++; return this.tasks.length },
                completed() { completedEvals++; return this.tasks.filter(t => t.done).length }
            },
            watch: {
                tasks() {
                    watcherFireCount++
                    // Simulate the demo's setTimeout(initSortable, 0)
                    setTimeout(() => {}, 0)
                }
            },
            toggleTask(event, element, details) {
                details.item.done = !details.item.done
            },
            removeTask(event, element, details) {
                const i = this.tasks.findIndex(t => t.id === details.item.id)
                if (i !== -1) this.tasks.splice(i, 1)
            }
        })

        const component = await setupComponent(wildflower, testContainer, `
            <div data-component="demo-with-watcher">
                <ul data-list="tasks" data-key="id">
                    <template>
                        <li class="js-item">
                            <span class="js-checkbox" data-action="toggleTask"></span>
                            <span class="js-remove" data-action="removeTask">x</span>
                        </li>
                    </template>
                </ul>
                <span class="js-count" data-bind="count"></span>
                <span class="js-completed" data-bind="completed"></span>
            </div>
        `)

        expect(testContainer.querySelector('.js-count').textContent).toBe('4')

        // Toggle first row
        testContainer.querySelector('.js-item:first-child .js-checkbox').click()
        await waitForUpdate()
        expect(testContainer.querySelector('.js-completed').textContent).toBe('2')

        const countAfter = countEvals
        const completedAfter = completedEvals

        // Delete second row
        testContainer.querySelectorAll('.js-item')[1].querySelector('.js-remove').click()
        await waitForUpdate()

        expect(component.state.tasks.length).toBe(3)
        expect(countEvals).toBeGreaterThan(countAfter)
        expect(completedEvals).toBeGreaterThan(completedAfter)
        expect(testContainer.querySelector('.js-count').textContent).toBe('3')
    })

    it('FAILING: exact demo sequence — add, toggle the added, delete any row', async () => {
        // Mirrors the user's reported repro for integration-showcase-wf:
        //   page load → add new task → toggle the new one → delete any row
        // Initial state has 4 tasks with id 4 already done (matches demo).
        let countEvals = 0
        let completedEvals = 0
        let nextId = 5

        wildflower.component('demo-sequence', {
            state: {
                tasks: [
                    { id: 1, text: 'Book flights',         done: false, order: 0 },
                    { id: 2, text: 'Reserve hotels',       done: false, order: 1 },
                    { id: 3, text: 'Pack luggage',         done: false, order: 2 },
                    { id: 4, text: 'Get travel insurance', done: true,  order: 3 }
                ]
            },
            computed: {
                count() { countEvals++; return this.tasks.length },
                completed() { completedEvals++; return this.tasks.filter(t => t.done).length }
            },
            addTask() {
                this.tasks.push({
                    id: nextId++, text: 'New task', done: false, order: this.tasks.length
                })
            },
            toggleTask(event, element, details) {
                details.item.done = !details.item.done
            },
            removeTask(event, element, details) {
                const i = this.tasks.findIndex(t => t.id === details.item.id)
                if (i !== -1) this.tasks.splice(i, 1)
            }
        })

        const component = await setupComponent(wildflower, testContainer, `
            <div data-component="demo-sequence">
                <ul data-list="tasks" data-key="id">
                    <template>
                        <li class="js-item">
                            <span class="js-checkbox" data-action="toggleTask"></span>
                            <span class="js-text" data-bind="text"></span>
                            <span class="js-remove" data-action="removeTask">x</span>
                        </li>
                    </template>
                </ul>
                <button class="js-add" data-action="addTask">add</button>
                <span class="js-count" data-bind="count"></span>
                <span class="js-completed" data-bind="completed"></span>
            </div>
        `)

        expect(testContainer.querySelector('.js-count').textContent).toBe('4')
        expect(testContainer.querySelector('.js-completed').textContent).toBe('1')

        // Step 1: add a task
        testContainer.querySelector('.js-add').click()
        await waitForUpdate()
        expect(testContainer.querySelector('.js-count').textContent).toBe('5')
        expect(component.state.tasks.length).toBe(5)

        // Step 2: toggle the newly-added (last) task
        const items = testContainer.querySelectorAll('.js-item')
        const lastCheckbox = items[items.length - 1].querySelector('.js-checkbox')
        lastCheckbox.click()
        await waitForUpdate()
        expect(testContainer.querySelector('.js-completed').textContent).toBe('2')

        const countAfter = countEvals
        const completedAfter = completedEvals

        // Step 3: delete any row (e.g., the first)
        testContainer.querySelector('.js-item:first-child .js-remove').click()
        await waitForUpdate()

        expect(component.state.tasks.length).toBe(4)
        // REGRESSION: count + completed should re-evaluate
        expect(countEvals).toBeGreaterThan(countAfter)
        expect(completedEvals).toBeGreaterThan(completedAfter)
        expect(testContainer.querySelector('.js-count').textContent).toBe('4')
    })

    // Reads internal state-manager Maps (computedDependencies, _computedDependsOn,
    // _computedNodes, _effectDependents) via their unmangled names; min builds
    // rename those properties so the lookups return undefined. The test contains
    // only console.warn diagnostics (no assertions), so it adds no behavior
    // coverage. Skipped on min builds where it cannot run; remains useful on
    // dev/raw builds when investigating dep-tracking regressions.
    it.skipIf(isMinifiedBuild())('diagnostic: dep state with item-level bindings present', async () => {
        wildflower.component('arr-dep-diag2', {
            state: {
                tasks: [
                    { id: 1, text: 'a', done: false },
                    { id: 2, text: 'b', done: true }
                ]
            },
            computed: {
                count() { return this.tasks.length },
                completed() { return this.tasks.filter(t => t.done).length }
            },
            toggleTask(event, element, details) { details.item.done = !details.item.done }
        })

        const component = await setupComponent(wildflower, testContainer, `
            <div data-component="arr-dep-diag2">
                <ul data-list="tasks" data-key="id">
                    <template>
                        <li class="js-item" data-bind-class="{ done: done }">
                            <span class="js-checkbox" data-action="toggleTask"></span>
                            <span class="js-text" data-bind="text"></span>
                        </li>
                    </template>
                </ul>
                <span class="js-count" data-bind="count"></span>
                <span class="js-completed" data-bind="completed"></span>
            </div>
        `)

        const sm = component.stateManager

        // Snapshot before toggle
        const countDepsBefore = sm._computedDependsOn.get('count')
        const completedDepsBefore = sm._computedDependsOn.get('completed')
        const lengthDepsBefore = sm.computedDependencies.get('tasks.length')
        const tasksDepsBefore = sm.computedDependencies.get('tasks')
        console.warn('[diag2] BEFORE toggle:')
        console.warn('  count deps:', countDepsBefore ? Array.from(countDepsBefore) : null)
        console.warn('  completed deps:', completedDepsBefore ? Array.from(completedDepsBefore) : null)
        console.warn('  tasks.length is dep of:', lengthDepsBefore ? Array.from(lengthDepsBefore) : null)
        console.warn('  tasks is dep of:', tasksDepsBefore ? Array.from(tasksDepsBefore) : null)

        // Toggle
        testContainer.querySelector('.js-item:first-child .js-checkbox').click()
        await waitForUpdate()

        // Snapshot after toggle
        const countDepsAfter = sm._computedDependsOn.get('count')
        const completedDepsAfter = sm._computedDependsOn.get('completed')
        const lengthDepsAfter = sm.computedDependencies.get('tasks.length')
        const tasksDepsAfter = sm.computedDependencies.get('tasks')
        console.warn('[diag2] AFTER toggle:')
        console.warn('  count deps:', countDepsAfter ? Array.from(countDepsAfter) : null)
        console.warn('  completed deps:', completedDepsAfter ? Array.from(completedDepsAfter) : null)
        console.warn('  tasks.length is dep of:', lengthDepsAfter ? Array.from(lengthDepsAfter) : null)
        console.warn('  tasks is dep of:', tasksDepsAfter ? Array.from(tasksDepsAfter) : null)

        const countNode = sm._computedNodes.get('count')
        console.warn('[diag2] count node flags before splice:', countNode.flags, 'value:', countNode.value)

        component.state.tasks.splice(0, 1)
        await waitForUpdate()

        console.warn('[diag2] AFTER splice:')
        console.warn('  count node flags:', countNode.flags, 'value:', countNode.value)
        console.warn('  count DOM:', testContainer.querySelector('.js-count').textContent, 'expected: 1')
        console.warn('  effects on computed:count:', sm._effectDependents.get('computed:count')?.size)
        console.warn('  effects on tasks.length:', sm._effectDependents.get('tasks.length')?.size)
    })

    it('FAILING: add then remove with watcher + order field (full demo shape)', async () => {
        let countEvals = 0
        let completedEvals = 0
        let nextId = 5

        wildflower.component('add-then-remove-full', {
            state: {
                tasks: [
                    { id: 1, text: 'Book flights',         done: false, order: 0 },
                    { id: 2, text: 'Reserve hotels',       done: false, order: 1 },
                    { id: 3, text: 'Pack luggage',         done: false, order: 2 },
                    { id: 4, text: 'Get travel insurance', done: true,  order: 3 }
                ]
            },
            computed: {
                count() { countEvals++; return this.tasks.length },
                completed() { completedEvals++; return this.tasks.filter(t => t.done).length }
            },
            watch: {
                tasks() {
                    setTimeout(() => {}, 0)
                }
            },
            addTask() {
                this.tasks.push({ id: nextId++, text: 'New task', done: false, order: this.tasks.length })
            },
            removeTask(event, element, details) {
                const i = this.tasks.findIndex(t => t.id === details.item.id)
                if (i !== -1) this.tasks.splice(i, 1)
            }
        })

        const component = await setupComponent(wildflower, testContainer, `
            <div data-component="add-then-remove-full">
                <ul data-list="tasks" data-key="id">
                    <template>
                        <li class="js-item" data-bind-class="{ done: done }">
                            <span class="drag-handle">::</span>
                            <span class="js-text" data-bind="text"></span>
                            <span class="js-remove" data-action="removeTask">x</span>
                        </li>
                    </template>
                </ul>
                <button class="js-add" data-action="addTask">add</button>
                <span class="js-count" data-bind="count"></span>
                <span class="js-completed" data-bind="completed"></span>
            </div>
        `)

        expect(testContainer.querySelector('.js-count').textContent).toBe('4')
        expect(testContainer.querySelector('.js-completed').textContent).toBe('1')

        // Add a task
        testContainer.querySelector('.js-add').click()
        await waitForUpdate()
        expect(testContainer.querySelector('.js-count').textContent).toBe('5')

        const countAfter = countEvals
        const completedAfter = completedEvals

        // Remove first row (no toggle in between)
        testContainer.querySelector('.js-item:first-child .js-remove').click()
        await waitForUpdate()

        expect(component.state.tasks.length).toBe(4)
        expect(countEvals).toBeGreaterThan(countAfter)
        expect(completedEvals).toBeGreaterThan(completedAfter)
        expect(testContainer.querySelector('.js-count').textContent).toBe('4')
    })

    it('CONTROL: templates.html pattern (data-model toggle + details.index splice)', async () => {
        let countEvals = 0
        let completedEvals = 0

        wildflower.component('templates-pattern', {
            state: {
                tasks: [
                    { id: 1, done: false },
                    { id: 2, done: false },
                    { id: 3, done: true }
                ]
            },
            computed: {
                count() { countEvals++; return this.tasks.length },
                completed() { completedEvals++; return this.tasks.filter(t => t.done).length }
            },
            // data-model based toggle (no method) + details.index for remove
            removeTask(event, element, details) {
                this.tasks.splice(details.index, 1)
            }
        })

        const component = await setupComponent(wildflower, testContainer, `
            <div data-component="templates-pattern">
                <ul data-list="tasks" data-key="id">
                    <template>
                        <li class="js-item">
                            <input class="js-checkbox" type="checkbox" data-model="done">
                            <span class="js-remove" data-action="removeTask">x</span>
                        </li>
                    </template>
                </ul>
                <span class="js-count" data-bind="count"></span>
                <span class="js-completed" data-bind="completed"></span>
            </div>
        `)

        expect(testContainer.querySelector('.js-count').textContent).toBe('3')

        // Toggle first row via data-model (check the checkbox)
        const firstCheckbox = testContainer.querySelector('.js-item:first-child .js-checkbox')
        firstCheckbox.checked = true
        firstCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
        firstCheckbox.dispatchEvent(new Event('input', { bubbles: true }))
        await waitForUpdate()
        expect(testContainer.querySelector('.js-completed').textContent).toBe('2')

        const countAfterToggle = countEvals
        const completedAfterToggle = completedEvals

        // Remove second row via details.index splice
        testContainer.querySelectorAll('.js-item')[1].querySelector('.js-remove').click()
        await waitForUpdate()

        expect(component.state.tasks.length).toBe(2)
        expect(countEvals).toBeGreaterThan(countAfterToggle)
        expect(completedEvals).toBeGreaterThan(completedAfterToggle)
        expect(testContainer.querySelector('.js-count').textContent).toBe('2')
    })
})
