/**
 * Multi-Store Coordination Test Suite
 *
 * Multiple stores interacting — mutations in store A affecting computed/rendering
 * dependent on store B, and vice versa. Tests the kind of multi-store coordination
 * every real app uses (e.g., data store + filter store + sort store).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

let counter = 0
function unique(prefix) { return `${prefix}-${++counter}` }

describe('Multi-Store Coordination', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('component subscribes to 2 stores, computed uses both', async () => {
    const sn1 = unique('msc-users')
    const sn2 = unique('msc-prefs')
    const cn = unique('msc-comp')

    wildflower.store(sn1, {
      state: { name: 'Alice' }
    })

    wildflower.store(sn2, {
      state: { greeting: 'Hello' }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <span id="msg" data-bind="computed:message"></span>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn1]: ['name'], [sn2]: ['greeting'] },
      computed: {
        message() {
          const name = this.stores[sn1].name
          const greeting = this.stores[sn2].greeting
          return `${greeting}, ${name}!`
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelector('#msg').textContent).toBe('Hello, Alice!')
  })

  it('update store A → computed re-evaluates using store A + store B', async () => {
    const sn1 = unique('msc-price')
    const sn2 = unique('msc-tax')
    const cn = unique('msc-comp')

    wildflower.store(sn1, {
      state: { amount: 100 }
    })

    wildflower.store(sn2, {
      state: { bonus: 10 }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <span id="total" data-bind="computed:total"></span>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn1]: ['amount'], [sn2]: ['bonus'] },
      computed: {
        total() {
          const amount = this.stores[sn1].amount || 0
          const bonus = this.stores[sn2].bonus || 0
          return amount + bonus
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelector('#total').textContent).toBe('110')

    // Update only store A
    const priceStore = wildflower.getStore(sn1)
    priceStore.state.amount = 200
    await waitForCompleteRender()

    expect(testContainer.querySelector('#total').textContent).toBe('210')
  })

  it('update both stores in same tick → single render', async () => {
    const sn1 = unique('msc-a')
    const sn2 = unique('msc-b')
    const cn = unique('msc-comp')

    wildflower.store(sn1, {
      state: { x: 10 }
    })

    wildflower.store(sn2, {
      state: { y: 20 }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <span id="sum" data-bind="computed:sum"></span>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn1]: ['x'], [sn2]: ['y'] },
      computed: {
        sum() {
          const x = this.stores[sn1].x || 0
          const y = this.stores[sn2].y || 0
          return x + y
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelector('#sum').textContent).toBe('30')

    // Update both in same tick
    const storeA = wildflower.getStore(sn1)
    const storeB = wildflower.getStore(sn2)
    storeA.state.x = 100
    storeB.state.y = 200
    await waitForCompleteRender()

    expect(testContainer.querySelector('#sum').textContent).toBe('300')
  })

  it('store A onStoreUpdate reacts to store B change → cascading update', async () => {
    const sn1 = unique('msc-source')
    const sn2 = unique('msc-mirror')
    const cn = unique('msc-comp')

    // Create source store
    wildflower.store(sn1, {
      state: { value: 'original' }
    })

    // Create mirror store that subscribes to source and cascades
    wildflower.store(sn2, {
      state: { mirroredValue: '' },
      subscribe: {
        [sn1]: ['value']
      },
      onStoreUpdate(storeName, path, newValue) {
        if (storeName === sn1 && path === 'value') {
          this.state.mirroredValue = newValue
        }
      }
    })

    // Component renders both stores
    testContainer.innerHTML = `
      <div data-component="${cn}">
        <span id="source" data-bind="computed:sourceVal"></span>
        <span id="mirror" data-bind="computed:mirrorVal"></span>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn1]: ['value'], [sn2]: ['mirroredValue'] },
      computed: {
        sourceVal() {
          return this.stores[sn1].value || ''
        },
        mirrorVal() {
          return this.stores[sn2].mirroredValue || 'empty'
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelector('#source').textContent).toBe('original')
    expect(testContainer.querySelector('#mirror').textContent).toBe('empty')

    // Update source store — mirror should cascade via onStoreUpdate
    const sourceStore = wildflower.getStore(sn1)
    sourceStore.state.value = 'updated'
    await waitForCompleteRender()

    expect(testContainer.querySelector('#source').textContent).toBe('updated')
    const mirrorStore = wildflower.getStore(sn2)
    expect(mirrorStore.state.mirroredValue).toBe('updated')
    expect(testContainer.querySelector('#mirror').textContent).toBe('updated')
  })

  it('component list depends on store A filtered by store B value', async () => {
    const dataSn = unique('msc-data')
    const filterSn = unique('msc-filter')
    const cn = unique('msc-comp')

    wildflower.store(dataSn, {
      state: {
        items: [
          { id: 1, name: 'Red Apple', color: 'red' },
          { id: 2, name: 'Green Apple', color: 'green' },
          { id: 3, name: 'Red Pepper', color: 'red' },
          { id: 4, name: 'Yellow Banana', color: 'yellow' }
        ]
      }
    })

    wildflower.store(filterSn, {
      state: { selectedColor: 'red' }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="filtered">
          <template>
            <span class="filtered-item" data-bind="name"></span>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [dataSn]: ['items'], [filterSn]: ['selectedColor'] },
      computed: {
        filtered() {
          const items = this.stores[dataSn].items || []
          const color = this.stores[filterSn].selectedColor
          return items.filter(i => i.color === color)
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.filtered-item').length).toBe(2)

    // Change filter
    const filterStore = wildflower.getStore(filterSn)
    filterStore.state.selectedColor = 'yellow'
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.filtered-item')
    expect(items.length).toBe(1)
    expect(items[0].textContent).toBe('Yellow Banana')
  })

  it('update store B filter → list from store A re-renders', async () => {
    const dataSn = unique('msc-products')
    const filterSn = unique('msc-cat')
    const cn = unique('msc-comp')

    wildflower.store(dataSn, {
      state: {
        products: [
          { id: 1, name: 'Laptop', category: 'tech' },
          { id: 2, name: 'Shirt', category: 'fashion' },
          { id: 3, name: 'Phone', category: 'tech' },
          { id: 4, name: 'Dress', category: 'fashion' }
        ]
      }
    })

    wildflower.store(filterSn, {
      state: { category: 'tech' }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="catProducts">
          <template>
            <span class="prod" data-bind="name"></span>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [dataSn]: ['products'], [filterSn]: ['category'] },
      computed: {
        catProducts() {
          const products = this.stores[dataSn].products || []
          const cat = this.stores[filterSn].category
          return products.filter(p => p.category === cat)
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.prod').length).toBe(2)
    expect(testContainer.querySelectorAll('.prod')[0].textContent).toBe('Laptop')

    // Change the filter store — this is an indirect trigger for the data list
    const catStore = wildflower.getStore(filterSn)
    catStore.state.category = 'fashion'
    await waitForCompleteRender()

    const prods = testContainer.querySelectorAll('.prod')
    expect(prods.length).toBe(2)
    expect(prods[0].textContent).toBe('Shirt')
    expect(prods[1].textContent).toBe('Dress')
  })

  it('three stores: data store + filter store + sort store → component combines all', async () => {
    const dataSn = unique('msc-data3')
    const filterSn = unique('msc-filter3')
    const sortSn = unique('msc-sort3')
    const cn = unique('msc-comp')

    wildflower.store(dataSn, {
      state: {
        employees: [
          { id: 1, name: 'Charlie', dept: 'eng', salary: 80000 },
          { id: 2, name: 'Alice', dept: 'eng', salary: 90000 },
          { id: 3, name: 'Bob', dept: 'sales', salary: 70000 },
          { id: 4, name: 'Diana', dept: 'eng', salary: 85000 }
        ]
      }
    })

    wildflower.store(filterSn, {
      state: { dept: 'eng' }
    })

    wildflower.store(sortSn, {
      state: { field: 'name', direction: 'asc' }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="results">
          <template>
            <span class="emp" data-bind="name"></span>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [dataSn]: ['employees'], [filterSn]: ['dept'], [sortSn]: ['field', 'direction'] },
      computed: {
        results() {
          const employees = this.stores[dataSn].employees || []
          const dept = this.stores[filterSn].dept
          const sortField = this.stores[sortSn].field || 'name'
          const sortDir = this.stores[sortSn].direction || 'asc'

          return employees
            .filter(e => e.dept === dept)
            .sort((a, b) => {
              const cmp = String(a[sortField]).localeCompare(String(b[sortField]))
              return sortDir === 'asc' ? cmp : -cmp
            })
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // eng dept, sorted by name asc: Alice, Charlie, Diana
    let emps = testContainer.querySelectorAll('.emp')
    expect(emps.length).toBe(3)
    expect(emps[0].textContent).toBe('Alice')
    expect(emps[1].textContent).toBe('Charlie')
    expect(emps[2].textContent).toBe('Diana')

    // Change sort direction
    const sortStore = wildflower.getStore(sortSn)
    sortStore.state.direction = 'desc'
    await waitForCompleteRender()

    emps = testContainer.querySelectorAll('.emp')
    expect(emps[0].textContent).toBe('Diana')
    expect(emps[1].textContent).toBe('Charlie')
    expect(emps[2].textContent).toBe('Alice')

    // Change filter
    const filterStore = wildflower.getStore(filterSn)
    filterStore.state.dept = 'sales'
    await waitForCompleteRender()

    emps = testContainer.querySelectorAll('.emp')
    expect(emps.length).toBe(1)
    expect(emps[0].textContent).toBe('Bob')
  })

  it('rapid alternating updates to store A and store B', async () => {
    const sn1 = unique('msc-rapid-a')
    const sn2 = unique('msc-rapid-b')
    const cn = unique('msc-comp')

    wildflower.store(sn1, {
      state: { count: 0 }
    })

    wildflower.store(sn2, {
      state: { count: 0 }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <span id="combined" data-bind="computed:combined"></span>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn1]: ['count'], [sn2]: ['count'] },
      computed: {
        combined() {
          const a = this.stores[sn1].count || 0
          const b = this.stores[sn2].count || 0
          return a + b
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelector('#combined').textContent).toBe('0')

    // Rapid alternating updates
    const storeA = wildflower.getStore(sn1)
    const storeB = wildflower.getStore(sn2)
    storeA.state.count = 1
    storeB.state.count = 2
    storeA.state.count = 3
    storeB.state.count = 4
    storeA.state.count = 5
    await waitForCompleteRender()

    expect(testContainer.querySelector('#combined').textContent).toBe('9') // 5 + 4
  })
})
