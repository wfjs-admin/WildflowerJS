/**
 * Debug test: Why do no-prefix computed properties fail inside list templates?
 *
 * This test exists to trace the actual execution path and identify
 * where the resolution breaks down.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForCompleteRender } from './helpers/load-framework.js'

describe('computed in list debug', () => {
    let testContainer, wildflower

    beforeAll(async () => { await loadFramework() })

    beforeEach(async () => {
        wildflower = window.wildflower
        await resetFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        testContainer?.parentNode?.removeChild(testContainer)
    })

    it('data-bind with computed: prefix should work', async () => {
        wildflower.component('dbg-prefix', {
            state: {
                items: [
                    { id: 1, name: 'Gizmo', price: 9.99 },
                    { id: 2, name: 'Widget', price: 29.99 }
                ]
            },
            computed: {
                formattedPrice() {
                    return this.price !== undefined ? '$' + this.price.toFixed(2) : '';
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="dbg-prefix">
                <div data-list="items" data-key="id">
                    <template>
                        <div class="item">
                            <span class="price" data-bind="computed:formattedPrice"></span>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 300))

        var prices = testContainer.querySelectorAll('.price')
        expect(prices.length).toBe(2)
        expect(prices[0].textContent).toBe('$9.99')
        expect(prices[1].textContent).toBe('$29.99')
    })

    it('data-bind WITHOUT prefix should also work (implicit computed detection)', async () => {
        wildflower.component('dbg-noprefix', {
            state: {
                items: [
                    { id: 1, name: 'Gizmo', price: 9.99 },
                    { id: 2, name: 'Widget', price: 29.99 }
                ]
            },
            computed: {
                formattedPrice() {
                    return this.price !== undefined ? '$' + this.price.toFixed(2) : '';
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="dbg-noprefix">
                <div data-list="items" data-key="id">
                    <template>
                        <div class="item">
                            <span class="price" data-bind="formattedPrice"></span>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 300))

        var prices = testContainer.querySelectorAll('.price')
        expect(prices.length).toBe(2)

        // Debug: what does the instance look like?
        var compEl = testContainer.querySelector('[data-component="dbg-noprefix"]')
        var compId = compEl?.getAttribute('data-component-id')
        var instance = compId ? wildflower.componentInstances.get(compId) : null
        console.warn('DEBUG: instance exists:', !!instance)
        console.warn('DEBUG: stateManager exists:', !!instance?.stateManager)
        console.warn('DEBUG: computed keys:', instance?.stateManager?.computed ? Object.keys(instance.stateManager.computed) : 'none')
        console.warn('DEBUG: _originalComputedFunctions keys:', instance?.stateManager?._originalComputedFunctions ? Array.from(instance.stateManager._originalComputedFunctions.keys()) : 'none')

        // Debug: what does the list context look like?
        var listEl = testContainer.querySelector('[data-list]')
        var listCtx = listEl?._listContext
        console.warn('DEBUG: listContext exists:', !!listCtx)
        console.warn('DEBUG: listContext.componentInstance exists:', !!listCtx?.componentInstance)
        console.warn('DEBUG: listContext.componentInstance.stateManager exists:', !!listCtx?.componentInstance?.stateManager)
        console.warn('DEBUG: listContext.componentInstance.stateManager.computed.formattedPrice exists:', !!listCtx?.componentInstance?.stateManager?.computed?.formattedPrice)

        // Debug: check actual price text content
        console.warn('DEBUG: price[0] textContent:', JSON.stringify(prices[0]?.textContent))
        console.warn('DEBUG: price[1] textContent:', JSON.stringify(prices[1]?.textContent))

        // Debug: check if items have formattedPrice as a data property
        var items = listEl?.querySelectorAll('.item')
        if (items?.length > 0) {
            var firstItem = items[0]
            console.warn('DEBUG: firstItem._itemData:', firstItem?._itemData)
            console.warn('DEBUG: firstItem._itemData.formattedPrice:', firstItem?._itemData?.formattedPrice)
        }

        expect(prices[0].textContent).toBe('$9.99')
        expect(prices[1].textContent).toBe('$29.99')
    })

    it('data-show WITHOUT prefix should work (implicit computed detection)', async () => {
        wildflower.component('dbg-show', {
            state: {
                items: [
                    { id: 1, name: 'Gizmo', price: 9.99 },
                    { id: 2, name: 'Widget', price: 29.99 },
                    { id: 3, name: 'Gadget', price: 49.99 }
                ]
            },
            computed: {
                isPremium() {
                    return this.price > 20;
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="dbg-show">
                <div data-list="items" data-key="id">
                    <template>
                        <div class="item">
                            <span data-bind="name"></span>
                            <span class="badge" data-show="isPremium">Premium</span>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 300))

        var badges = testContainer.querySelectorAll('.badge')
        expect(badges.length).toBe(3)

        // Debug: check visibility
        badges.forEach(function(b, i) {
            console.warn('DEBUG: badge[' + i + '] display:', b.style.display, 'offsetParent:', b.offsetParent)
        })

        // Gizmo (price 9.99) should be hidden, Widget and Gadget should be visible
        expect(badges[0].style.display).toBe('none')
        expect(badges[1].style.display).toBe('')
        expect(badges[2].style.display).toBe('')
    })
})
