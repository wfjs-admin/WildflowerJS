/**
 * List Item data-show Nested Property Access Tests
 *
 * Tests that data-show within list items correctly handles nested property paths
 * using _getValueFromItem instead of direct item[path] access.
 *
 * This test exists to prevent regression of a fix where _executeFallbackShow
 * was changed from `item[path]` to `this._getValueFromItem(item, path)`.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle (for lists)
async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe('List Item data-show Nested Property Access', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        // Clear the context registry to prevent cross-test contamination
        if (wildflower._contextRegistry) {
            wildflower._contextRegistry.contexts?.clear()
            wildflower._contextRegistry.contextsByType?.clear()
            wildflower._contextRegistry.contextsByComponent?.clear()
            wildflower._contextRegistry.dependencies?.clear()
            wildflower._contextRegistry._contextTypeCache?.clear()
            wildflower._contextRegistry._contextModificationCounter = 0
        }

        // Create and append test container
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        // Clean up test container
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    it('should handle nested property paths in data-show within list items', async () => {
        wildflower.component('test-nested-show', {
            state: {
                items: [
                    { name: 'Item 1', settings: { visible: true } },
                    { name: 'Item 2', settings: { visible: false } },
                    { name: 'Item 3', settings: { visible: true } }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-nested-show">
                <div data-list="items">
                    <template>
                        <div class="item">
                            <span class="name" data-bind="name"></span>
                            <span class="indicator" data-show="settings.visible">VISIBLE</span>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const items = testContainer.querySelectorAll('.item')
        expect(items.length).toBe(3)

        // Item 1: settings.visible = true -> should be visible
        expect(items[0].querySelector('.indicator').style.display).not.toBe('none')

        // Item 2: settings.visible = false -> should be hidden
        expect(items[1].querySelector('.indicator').style.display).toBe('none')

        // Item 3: settings.visible = true -> should be visible
        expect(items[2].querySelector('.indicator').style.display).not.toBe('none')
    })

    it('should handle deeply nested property paths in data-show', async () => {
        wildflower.component('test-deep-nested-show', {
            state: {
                departments: [
                    {
                        name: 'Engineering',
                        config: {
                            display: {
                                showDetails: true
                            }
                        }
                    },
                    {
                        name: 'Marketing',
                        config: {
                            display: {
                                showDetails: false
                            }
                        }
                    }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-deep-nested-show">
                <div data-list="departments">
                    <template>
                        <div class="dept">
                            <span class="name" data-bind="name"></span>
                            <div class="details" data-show="config.display.showDetails">
                                Department Details Here
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const depts = testContainer.querySelectorAll('.dept')
        expect(depts.length).toBe(2)

        // Engineering: showDetails = true
        expect(depts[0].querySelector('.details').style.display).not.toBe('none')

        // Marketing: showDetails = false
        expect(depts[1].querySelector('.details').style.display).toBe('none')
    })

    it('should handle negated nested property paths in data-show', async () => {
        wildflower.component('test-negated-nested-show', {
            state: {
                items: [
                    { name: 'Item 1', flags: { isHidden: true } },
                    { name: 'Item 2', flags: { isHidden: false } }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-negated-nested-show">
                <div data-list="items">
                    <template>
                        <div class="item">
                            <span class="name" data-bind="name"></span>
                            <span class="shown-when-not-hidden" data-show="!flags.isHidden">NOT HIDDEN</span>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const items = testContainer.querySelectorAll('.item')
        expect(items.length).toBe(2)

        // Item 1: isHidden = true, !isHidden = false -> should be hidden
        expect(items[0].querySelector('.shown-when-not-hidden').style.display).toBe('none')

        // Item 2: isHidden = false, !isHidden = true -> should be visible
        expect(items[1].querySelector('.shown-when-not-hidden').style.display).not.toBe('none')
    })

    it('should handle simple property paths (non-nested) in data-show', async () => {
        // Ensure the fix doesn't break simple property access
        wildflower.component('test-simple-show', {
            state: {
                items: [
                    { name: 'Item 1', active: true },
                    { name: 'Item 2', active: false }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-simple-show">
                <div data-list="items">
                    <template>
                        <div class="item">
                            <span class="name" data-bind="name"></span>
                            <span class="active-indicator" data-show="active">ACTIVE</span>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const items = testContainer.querySelectorAll('.item')
        expect(items.length).toBe(2)

        // Item 1: active = true
        expect(items[0].querySelector('.active-indicator').style.display).not.toBe('none')

        // Item 2: active = false
        expect(items[1].querySelector('.active-indicator').style.display).toBe('none')
    })

    it('should handle expression conditions in data-show within list items', async () => {
        wildflower.component('test-expression-show', {
            state: {
                items: [
                    { name: 'Item 1', count: 5 },
                    { name: 'Item 2', count: 0 },
                    { name: 'Item 3', count: 10 }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-expression-show">
                <div data-list="items">
                    <template>
                        <div class="item">
                            <span class="name" data-bind="name"></span>
                            <span class="has-items" data-show="count > 0">Has Items</span>
                            <span class="empty" data-show="count === 0">Empty</span>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const items = testContainer.querySelectorAll('.item')
        expect(items.length).toBe(3)

        // Item 1: count = 5, count > 0 = true
        expect(items[0].querySelector('.has-items').style.display).not.toBe('none')
        expect(items[0].querySelector('.empty').style.display).toBe('none')

        // Item 2: count = 0, count > 0 = false
        expect(items[1].querySelector('.has-items').style.display).toBe('none')
        expect(items[1].querySelector('.empty').style.display).not.toBe('none')

        // Item 3: count = 10, count > 0 = true
        expect(items[2].querySelector('.has-items').style.display).not.toBe('none')
        expect(items[2].querySelector('.empty').style.display).toBe('none')
    })

    it('should handle data-show in computed lists', async () => {
        wildflower.component('test-computed-show', {
            state: {
                items: [
                    { name: 'Item 1', active: true, visible: true },
                    { name: 'Item 2', active: false, visible: true },
                    { name: 'Item 3', active: true, visible: false }
                ]
            },
            computed: {
                visibleItems() {
                    return this.state.items.filter(i => i.visible)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-computed-show">
                <div data-list="computed:visibleItems">
                    <template>
                        <div class="item">
                            <span class="name" data-bind="name"></span>
                            <span class="active-badge" data-show="active">Active</span>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const items = testContainer.querySelectorAll('.item')
        // Only 2 items should be rendered (Item 3 is not visible)
        expect(items.length).toBe(2)

        // Item 1: active = true
        expect(items[0].querySelector('.active-badge').style.display).not.toBe('none')

        // Item 2: active = false
        expect(items[1].querySelector('.active-badge').style.display).toBe('none')
    })

    it('should handle nested property paths in data-show within computed lists', async () => {
        wildflower.component('test-computed-nested-show', {
            state: {
                tasks: [
                    { title: 'Task 1', status: { completed: true } },
                    { title: 'Task 2', status: { completed: false } },
                    { title: 'Task 3', status: { completed: true } }
                ]
            },
            computed: {
                allTasks() {
                    return this.state.tasks
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="test-computed-nested-show">
                <div data-list="computed:allTasks">
                    <template>
                        <div class="task">
                            <span class="title" data-bind="title"></span>
                            <span class="done-badge" data-show="status.completed">Done</span>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const tasks = testContainer.querySelectorAll('.task')
        expect(tasks.length).toBe(3)

        // Task 1: completed = true
        expect(tasks[0].querySelector('.done-badge').style.display).not.toBe('none')

        // Task 2: completed = false
        expect(tasks[1].querySelector('.done-badge').style.display).toBe('none')

        // Task 3: completed = true
        expect(tasks[2].querySelector('.done-badge').style.display).not.toBe('none')
    })
})
